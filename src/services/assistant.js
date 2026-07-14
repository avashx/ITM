/**
 * Assistant service — answers operator questions about the platform's own
 * live data (service health, incidents, grievance SLAs, correlation insights).
 *
 * Two modes, chosen automatically:
 *
 *  1. **Grounded LLM** (when ANTHROPIC_API_KEY is set): a compact snapshot of
 *     the CURRENT database state is built server-side and passed to Claude as
 *     context. Claude only summarises/reasons over that snapshot - it is never
 *     asked to recall facts about Delhi from memory, so answers stay tied to
 *     what the monitor actually measured.
 *  2. **Deterministic fallback** (no key, the zero-budget default): a rule-based
 *     responder answers the same suggested questions directly from the snapshot.
 *     It is clearly labelled in the UI as rule-based, never as AI.
 *
 * The snapshot is the single source of truth in both modes, so the fallback is
 * a genuinely useful degradation rather than a stub.
 */
const config = require('../config');
const {
  ServiceEndpoint,
  Incident,
  CorrelationInsight,
} = require('../models');
const analytics = require('../modules/grievance/analytics');
const predictor = require('../modules/correlation/predictor');
const log = require('../utils/logger')('assistant');

// Lazily constructed so the SDK is only touched when a key exists.
let client = null;
function getClient() {
  if (!config.assistant.apiKey) return null;
  if (!client) {
    const Anthropic = require('@anthropic-ai/sdk');
    client = new Anthropic({ apiKey: config.assistant.apiKey });
  }
  return client;
}

/**
 * Build a compact, factual snapshot of the platform's current state.
 * Kept small (a few KB) so it fits comfortably in one request and stays cheap.
 */
async function buildContext() {
  const [services, openIncidents, gSummary, byDept, insights, predictions] =
    await Promise.all([
      ServiceEndpoint.find({ enabled: true })
        .select('name url department category state.status state.lastLatencyMs state.lastError state.ssl.daysRemaining')
        .lean(),
      Incident.find({ status: 'open' })
        .populate('service', 'name url department')
        .sort({ startedAt: 1 })
        .lean(),
      analytics.summary({ days: 30 }),
      analytics.byDepartment({ days: 30 }),
      CorrelationInsight.find({}).sort({ createdAt: -1 }).limit(10).lean(),
      predictor.predictOpenOutages({ notify: false }),
    ]);

  const byStatus = { operational: 0, degraded: 0, down: 0, unknown: 0 };
  for (const s of services) byStatus[s.state.status] = (byStatus[s.state.status] || 0) + 1;

  return {
    generatedAt: new Date().toISOString(),
    simulated: config.monitor.simulate,
    services: {
      total: services.length,
      ...byStatus,
      down: services
        .filter((s) => s.state.status === 'down')
        .map((s) => ({ name: s.name, url: s.url, department: s.department, error: s.state.lastError })),
      degraded: services
        .filter((s) => s.state.status === 'degraded')
        .map((s) => ({ name: s.name, url: s.url, reason: s.state.lastError || 'slow response' })),
      sslExpiringSoon: services
        .filter((s) => s.state.ssl && s.state.ssl.daysRemaining != null && s.state.ssl.daysRemaining <= 30)
        .map((s) => ({ name: s.name, daysRemaining: s.state.ssl.daysRemaining }))
        .sort((a, b) => a.daysRemaining - b.daysRemaining),
    },
    openIncidents: openIncidents.map((i) => ({
      service: i.service ? i.service.name : 'unknown',
      url: i.service ? i.service.url : null,
      department: i.service ? i.service.department : null,
      startedAt: i.startedAt,
      hoursOpen: Math.round(((Date.now() - new Date(i.startedAt)) / 3600000) * 10) / 10,
      error: i.lastError,
    })),
    grievances30d: {
      total: gSummary.total,
      byStatus: gSummary.byStatus,
      slaBreachRatePct: gSummary.slaBreachRate,
      avgResolutionDays: gSummary.avgResolutionHours
        ? Math.round((gSummary.avgResolutionHours / 24) * 10) / 10
        : null,
      worstDepartmentsBySlaBreach: byDept
        .slice()
        .sort((a, b) => b.slaBreachPct - a.slaBreachPct)
        .slice(0, 5)
        .map((d) => ({ department: d.department, slaBreachPct: d.slaBreachPct, total: d.total })),
      busiestDepartments: byDept
        .slice(0, 5)
        .map((d) => ({ department: d.department, total: d.total, open: d.open })),
    },
    correlationInsights: insights.map((i) => ({
      narrative: i.narrative,
      service: i.serviceName,
      category: i.category,
      spikePct: Math.round((i.spikeRatio - 1) * 100),
      confidence: i.confidence,
    })),
    surgePredictions: predictions.map((p) => ({
      service: p.serviceName,
      category: p.category,
      department: p.department,
      extraPerDay: p.predictedExtraPerDay,
      outageOpenHours: p.outageOpenHours,
    })),
    dataNote:
      'Grievance figures are SYNTHETIC demo data (labelled source=synthetic). Service health, incidents and SSL data are REAL measurements from live probes.',
  };
}

const SYSTEM_PROMPT = `You are the operations assistant embedded in IT Monitor, a service-health and grievance-intelligence platform for the Information Technology Department, Government of NCT of Delhi (GNCTD).

You answer questions for IT officers about the platform's own monitoring data.

RULES:
- Answer ONLY from the JSON snapshot in the user message. It is the live state of the system right now.
- If the snapshot does not contain the answer, say so plainly and suggest which page of the platform would show it. Never guess, and never use outside knowledge about Delhi services as if it were measured data.
- Grievance figures are synthetic demo data — say so whenever you quote them. Service health, incidents and SSL data are real measurements.
- Be brief and operational: lead with the answer, then the supporting numbers. Name specific services and departments.
- Plain text only. No markdown headers, no bullet characters, no emoji. Two short paragraphs maximum.`;

/**
 * Answer a question. Returns { answer, mode, model?, contextAt }.
 * `mode` is 'claude' or 'rules' so the UI can label the source honestly.
 */
async function ask(question) {
  const context = await buildContext();
  const anthropic = getClient();

  if (!anthropic) {
    return {
      answer: ruleBasedAnswer(question, context),
      mode: 'rules',
      contextAt: context.generatedAt,
    };
  }

  try {
    const response = await anthropic.messages.create({
      model: config.assistant.model,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Live platform snapshot:\n\`\`\`json\n${JSON.stringify(context)}\n\`\`\`\n\nQuestion: ${question}`,
        },
      ],
    });
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    return {
      answer: text || 'No answer was returned.',
      mode: 'claude',
      model: config.assistant.model,
      contextAt: context.generatedAt,
    };
  } catch (err) {
    // Never fail the panel because the API is down / out of credit - fall back
    // to the deterministic responder and say why.
    log.error(`Claude call failed (${err.message}) - falling back to rules`);
    return {
      answer: ruleBasedAnswer(question, context),
      mode: 'rules',
      note: `AI unavailable (${err.message}); answered from live data with the built-in responder.`,
      contextAt: context.generatedAt,
    };
  }
}

/**
 * Deterministic responder. Matches the question against known intents and
 * answers straight from the same snapshot the LLM would see. This is the
 * zero-budget default - it must stay genuinely useful.
 */
function ruleBasedAnswer(question, c) {
  const q = String(question || '').toLowerCase();
  const has = (...words) => words.some((w) => q.includes(w));

  if (has('down', 'outage', 'offline', 'broken')) {
    if (!c.services.down.length) {
      return `No services are down right now. ${c.services.operational} of ${c.services.total} are operational and ${c.services.degraded} are degraded.`;
    }
    const shown = c.services.down.slice(0, 6);
    const list = shown
      .map((s) => `${s.name} (${s.department}) — ${s.error || 'failing checks'}`)
      .join('; ');
    const more = c.services.down.length - shown.length;
    const longest = Math.max(...c.openIncidents.map((i) => i.hoursOpen), 0);
    return `${c.services.down.length} of ${c.services.total} services are down.\n\n${list}${more > 0 ? `\n\n…and ${more} more — the full list is on the Service Status page.` : ''}\n\n${c.openIncidents.length} open incident(s); the longest has been running ${longest}h.`;
  }

  if (has('ssl', 'certificate', 'cert', 'expir')) {
    if (!c.services.sslExpiringSoon.length) {
      return 'No monitored certificate expires within the next 30 days.';
    }
    const list = c.services.sslExpiringSoon
      .slice(0, 5)
      .map((s) => `${s.name} in ${s.daysRemaining}d`)
      .join(', ');
    return `${c.services.sslExpiringSoon.length} certificate(s) expire within 30 days. Soonest: ${list}. Full list is on the Ops Dashboard.`;
  }

  if (has('sla', 'breach', 'worst', 'slowest department')) {
    const w = c.grievances30d.worstDepartmentsBySlaBreach;
    if (!w.length) return 'No grievance data in the last 30 days.';
    const list = w.map((d) => `${d.department} (${d.slaBreachPct}% of ${d.total})`).join(', ');
    return `Worst SLA breach rates over 30 days: ${list}. Overall breach rate is ${c.grievances30d.slaBreachRatePct}% across ${c.grievances30d.total} grievances, averaging ${c.grievances30d.avgResolutionDays} days to resolve. Note: grievance figures are synthetic demo data.`;
  }

  if (has('surge', 'predict', 'forecast', 'expect')) {
    if (!c.surgePredictions.length) {
      return 'No surge forecasts right now — forecasts are generated only while a mapped service is in an open outage.';
    }
    const list = c.surgePredictions
      .slice(0, 4)
      .map((p) => `${p.category}: ~+${p.extraPerDay}/day (${p.service} down ${p.outageOpenHours}h)`)
      .join('; ');
    return `${c.surgePredictions.length} surge forecast(s) active: ${list}. Departments can pre-position helpdesk staff now. Grievance volumes are synthetic demo data.`;
  }

  if (has('correlation', 'pattern', 'insight', 'spike')) {
    if (!c.correlationInsights.length) {
      return 'No correlation patterns detected yet. The engine runs nightly over resolved outages.';
    }
    return c.correlationInsights
      .slice(0, 3)
      .map((i) => i.narrative)
      .join(' ');
  }

  if (has('grievance', 'complaint', 'volume', 'resolved')) {
    const g = c.grievances30d;
    return `${g.total} grievances in the last 30 days: ${g.byStatus.resolved || 0} resolved, ${(g.byStatus.registered || 0) + (g.byStatus.in_progress || 0)} still open. SLA breach rate ${g.slaBreachRatePct}%, average resolution ${g.avgResolutionDays} days. Busiest: ${g.busiestDepartments.map((d) => d.department).slice(0, 3).join(', ')}. These are synthetic demo figures.`;
  }

  if (has('summary', 'status', 'overview', 'how are', 'health')) {
    return `${c.services.operational} of ${c.services.total} services operational, ${c.services.degraded} degraded, ${c.services.down} down, with ${c.openIncidents.length} open incident(s). Grievances (synthetic): ${c.grievances30d.total} in 30 days at a ${c.grievances30d.slaBreachRatePct}% SLA breach rate.`;
  }

  return `I can answer from the live monitoring data: what's down, SSL expiry, SLA breaches by department, correlation patterns, surge forecasts, or an overall status summary. (Set ANTHROPIC_API_KEY to enable free-form AI answers over the same data.)`;
}

/** Suggested prompts shown in the panel - each is answerable in both modes. */
const SUGGESTED = [
  "What's down right now?",
  'Which certificates expire soon?',
  'Which department has the worst SLA?',
  'Any complaint surges expected?',
  'Show correlation patterns',
  'Give me an overall status summary',
];

module.exports = { ask, buildContext, SUGGESTED };
