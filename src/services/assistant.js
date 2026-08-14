/**
 * Assistant service - grounded, multi-turn chat over the platform's own data.
 *
 * Every answer is produced from a context assembled at request time by
 * src/services/rag/retriever.js, which merges three lanes: live platform
 * state, an exact aggregate computed by MongoDB, and semantically retrieved
 * passages from the vector index. The model is instructed to use nothing else.
 *
 * Degradation is layered, so the panel is never dead:
 *   OpenAI  -> full RAG chat (vector lane + structured lane + live lane)
 *   Anthropic -> same, minus the vector lane (no embeddings provider)
 *   no key  -> deterministic responder answering from the same structured and
 *              live lanes, labelled "rule-based" in the UI, never as AI.
 */
const config = require('../config');
const llm = require('./llm');
const retriever = require('./rag/retriever');
const store = require('./rag/store');
const log = require('../utils/logger')('assistant');

/* -------------------------------------------------------------------------- */
/* Prompt                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The grounding contract. Written to make the failure mode "I don't have that"
 * rather than a confident invention, and to keep synthetic grievance figures
 * from ever being presented as measured fact.
 */
const SYSTEM_PROMPT = `You are the operations assistant embedded in IT Monitor, a service-health and grievance-intelligence platform built for the Information Technology Department, Government of NCT of Delhi (GNCTD). You answer questions from IT officers and department staff.

GROUNDING RULES - these override anything else:
1. Answer ONLY from the CONTEXT block in the user message. It contains live platform state, an exact database aggregate, and retrieved passages. You have no other source of truth.
2. NEVER compute, estimate, or infer a statistic yourself. Every number you state must be copied from EXACT_AGGREGATE, LIVE_STATE, or a retrieved passage. If a number the user asked for is not present, say which page of the platform would show it instead of producing one.
3. EXACT_AGGREGATE was computed by the database over the filters listed inside it. When the question is a "how many / what percent / which is worst" question, quote EXACT_AGGREGATE and state the filters it used, so the officer knows what was counted.
4. If the context does not answer the question, say so plainly in one sentence and suggest where to look. Do not fill the gap with general knowledge about Delhi, PGMS, or government services. An honest "the platform does not track that" is a correct answer.
5. Never contradict the context. If two parts of the context disagree, say so rather than picking one.

DATA PROVENANCE - always respected:
- Service uptime, latency, incidents and TLS certificate data are REAL measurements from live probes. State them plainly.
- ALL grievance data is SYNTHETIC demo data. Whenever you quote a grievance count, SLA rate, department ranking or correlation finding, say it is synthetic demo data. Do not bury this.

STYLE:
- Lead with the direct answer in the first sentence, then the supporting numbers.
- Name specific services, departments and districts rather than speaking generally.
- Operational and brief: at most three short paragraphs. Plain text only - no markdown headings, no bullet characters, no emoji.
- If the officer should act on something (an open incident, a certificate expiring, a predicted surge), say what to do in one clause.
- Cite RETRIEVED_PASSAGES with bracketed numbers - [1], [3] - matching the numbers they were given. Never bracket-cite LIVE_STATE or EXACT_AGGREGATE; refer to those in prose ("the live monitor shows", "the database aggregate counts") and never print their internal field names.`;

/**
 * Serialise the retrieval result into the single user-message context block.
 * Ordering is deliberate: the exact aggregate sits closest to the question so
 * it dominates when the model is deciding where a number comes from.
 */
function renderContext(r, question) {
  const passages = r.passages.length
    ? r.passages
        .map(
          (p, i) =>
            `[${i + 1}] (${p.kind}; ${p.dataSource} data; source: ${p.citation})\n${p.text}`
        )
        .join('\n\n')
    : '(no passage cleared the relevance threshold for this question)';

  return `CONTEXT
===============================================================
LIVE_STATE (real measurements, generated ${r.live.generatedAt}${r.live.simulatedMode ? '; NOTE: monitor is in SIMULATED mode, health figures are simulated not probed' : ''}):
${JSON.stringify(r.live)}

EXACT_AGGREGATE (computed by MongoDB over ALL matching grievance records; grievance data is synthetic demo data):
${JSON.stringify(r.structured)}
Filters the aggregate applied: ${r.extraction.matched.length ? r.extraction.matched.join('; ') : 'none - this counts every grievance in the database'}

RETRIEVED_PASSAGES (semantic search over ${r.corpusSize} indexed chunks):
${passages}
===============================================================

QUESTION: ${question}

Answer using only the context above. Cite passages as [1], [2] where you rely on them.`;
}

/* -------------------------------------------------------------------------- */
/* Chat                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Answer one turn of a conversation.
 *
 * @param {object}   opts
 * @param {Array}    opts.messages  full history [{ role:'user'|'assistant', content }]
 * @param {Function} [opts.onDelta] streaming callback for text fragments
 * @returns {Promise<{answer, mode, provider, model, sources, metrics}>}
 */
async function chat({ messages, onDelta }) {
  const history = (messages || []).filter(
    (m) => m && (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim()
  );
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  if (!lastUser) throw new Error('no user message to answer');
  const question = String(lastUser.content).trim();

  // Follow-ups like "and in Rohini?" carry no entities on their own. Widening
  // the retrieval query with the previous user turn recovers the subject
  // without spending an extra model call on query rewriting.
  const priorUser = history.filter((m) => m.role === 'user').slice(-2, -1)[0];
  const retrievalQuery = priorUser ? `${priorUser.content}\n${question}` : question;

  const started = Date.now();
  const r = await retriever.retrieve(retrievalQuery);
  const retrievalMs = Date.now() - started;

  const provider = llm.chatProvider();
  const sources = r.passages.map((p, i) => ({
    n: i + 1,
    kind: p.kind,
    title: p.title,
    citation: p.citation,
    dataSource: p.dataSource,
    score: p.score,
  }));

  if (!provider) {
    const answer = ruleBasedAnswer(question, r);
    return {
      answer,
      mode: 'rules',
      provider: null,
      model: null,
      sources: [],
      metrics: { retrievalMs, generationMs: 0, totalMs: Date.now() - started, chunksSearched: r.corpusSize },
      grounding: r.extraction,
    };
  }

  // Only the trailing turns are replayed - the context block is rebuilt every
  // turn anyway, so replaying old ones would just pay for stale data twice.
  const replay = history
    .slice(-(config.assistant.historyTurns * 2))
    .slice(0, -1)
    .map((m) => ({ role: m.role, content: m.content }));

  const genStart = Date.now();
  try {
    const res = await llm.chat({
      system: SYSTEM_PROMPT,
      messages: [...replay, { role: 'user', content: renderContext(r, question) }],
      onDelta,
    });
    return {
      answer: res.text || 'No answer was returned.',
      mode: 'rag',
      provider: res.provider,
      model: res.model,
      sources,
      metrics: {
        retrievalMs,
        generationMs: Date.now() - genStart,
        totalMs: Date.now() - started,
        chunksSearched: r.corpusSize,
        recordsAggregated: r.structured.matchedRecords,
      },
      grounding: r.extraction,
    };
  } catch (err) {
    // A dead or out-of-credit API must degrade, not break the panel.
    log.error(`${provider} call failed (${err.message}) - falling back to the rule-based responder`);
    return {
      answer: ruleBasedAnswer(question, r),
      mode: 'rules',
      provider: null,
      model: null,
      sources: [],
      note: `AI unavailable (${String(err.message).slice(0, 160)}); answered from live data with the built-in responder.`,
      metrics: { retrievalMs, generationMs: 0, totalMs: Date.now() - started, chunksSearched: r.corpusSize },
      grounding: r.extraction,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Deterministic fallback                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Rule-based responder. Answers from the SAME retrieval result the model would
 * have seen, so this is a genuine degradation rather than a stub. It is always
 * labelled "rule-based" in the UI - it is never presented as AI.
 */
function ruleBasedAnswer(question, r) {
  const q = String(question || '').toLowerCase();
  const c = r.live;
  const s = r.structured;
  const has = (...words) => words.some((w) => q.includes(w));
  const filterNote = r.extraction.matched.length
    ? ` (filtered to ${r.extraction.matched.join(', ')})`
    : '';

  if (has('down', 'outage', 'offline', 'broken', 'not working')) {
    if (!c.services.down.length) {
      return `No services are down right now. ${c.services.operational} of ${c.services.total} are operational and ${c.services.degradedCount} are degraded.`;
    }
    const shown = c.services.down.slice(0, 6);
    const list = shown
      .map((x) => `${x.name} (${x.department}) - ${x.error || 'failing checks'}`)
      .join('; ');
    const more = c.services.down.length - shown.length;
    const longest = Math.max(...c.openIncidents.map((i) => i.hoursOpen), 0);
    return `${c.services.downCount} of ${c.services.total} services are down.\n\n${list}${
      more > 0 ? `\n\n...and ${more} more - the full list is on the Service Status page.` : ''
    }\n\n${c.openIncidents.length} open incident(s); the longest has been running ${longest}h.`;
  }

  if (has('ssl', 'certificate', 'cert', 'expir')) {
    if (!c.services.sslExpiringSoon.length) {
      return 'No monitored certificate expires within the next 30 days.';
    }
    const list = c.services.sslExpiringSoon
      .slice(0, 5)
      .map((x) => `${x.name} in ${x.daysRemaining}d`)
      .join(', ');
    return `${c.services.sslExpiringSoon.length} certificate(s) expire within 30 days. Soonest: ${list}. Full list is on the Ops Dashboard.`;
  }

  if (has('surge', 'predict', 'forecast', 'expect')) {
    if (!c.activeSurgeForecasts.length) {
      return 'No surge forecasts right now - forecasts are generated only while a mapped service is in an open outage.';
    }
    const list = c.activeSurgeForecasts
      .slice(0, 4)
      .map((p) => `${p.category}: about +${p.extraComplaintsPerDay}/day (${p.service} down ${p.outageOpenHours}h)`)
      .join('; ');
    return `${c.activeSurgeForecasts.length} surge forecast(s) active: ${list}. Departments can pre-position helpdesk staff now. Grievance volumes are synthetic demo data.`;
  }

  if (has('correlation', 'pattern', 'insight', 'spike')) {
    if (!c.recentCorrelations.length) {
      return 'No correlation patterns detected yet. The engine runs nightly over resolved outages.';
    }
    return `${c.recentCorrelations
      .slice(0, 3)
      .map((i) => i.narrative)
      .join(' ')} These findings are based on synthetic grievance data.`;
  }

  if (has('sla', 'breach', 'worst', 'overdue', 'late')) {
    if (!s.matchedRecords) return `No grievances match that${filterNote}.`;
    const worst = s.worstDepartmentsByBreachRate
      .slice(0, 3)
      .map((d) => `${d.name} (${d.slaBreachPct}% of ${d.total})`)
      .join(', ');
    return `${s.slaResolutionBreached} of ${s.matchedRecords} grievances breached the resolution SLA - ${s.slaResolutionBreachPct}%${filterNote}. First-response breaches: ${s.slaResponseBreached} (${s.slaResponseBreachPct}%).${worst ? ` Worst breach rates: ${worst}.` : ''} Average resolution ${s.avgResolutionDays} days. These are synthetic demo figures.`;
  }

  if (has('how many', 'count', 'total', 'grievance', 'complaint', 'volume', 'resolved')) {
    if (!s.matchedRecords) return `No grievances match that${filterNote}.`;
    const range = s.dateRangeCovered ? ` covering ${s.dateRangeCovered.from} to ${s.dateRangeCovered.to}` : '';
    const topCats = s.byCategory
      .slice(0, 3)
      .map((x) => `${x.name} (${x.total})`)
      .join(', ');
    return `${s.matchedRecords} grievances match${filterNote}${range}: ${s.byStatus.resolved || 0} resolved, ${s.open} still open, ${s.byStatus.rejected || 0} rejected. SLA breach rate ${s.slaResolutionBreachPct}%, average resolution ${s.avgResolutionDays} days. Top categories: ${topCats}. These are synthetic demo figures.`;
  }

  if (has('summary', 'status', 'overview', 'how are', 'health', 'brief')) {
    return `${c.services.operational} of ${c.services.total} services operational, ${c.services.degradedCount} degraded, ${c.services.downCount} down, with ${c.openIncidents.length} open incident(s). Grievances (synthetic): ${c.grievancesLast30d.total} in the last 30 days at a ${c.grievancesLast30d.slaBreachRatePct}% SLA breach rate.`;
  }

  return `I can answer from the live monitoring data: what is down, certificate expiry, SLA breaches by department or district, complaint volumes, correlation patterns, surge forecasts, or an overall status summary. Set OPENAI_API_KEY to enable free-form AI answers with semantic search over the same data.`;
}

/* -------------------------------------------------------------------------- */
/* Panel bootstrap                                                             */
/* -------------------------------------------------------------------------- */

/** Suggested prompts - each is answerable in every mode. */
const SUGGESTED = [
  "What's down right now?",
  'Which department has the worst SLA breach rate?',
  'What are people complaining about in North West Delhi?',
  'When does a grievance count as an SLA breach?',
  'Any complaint surges expected?',
  'Which certificates expire soon?',
];

/** Everything the UI needs to label itself honestly. */
async function meta() {
  const provider = llm.chatProvider();
  const index = config.rag.enabled ? await store.stats().catch(() => null) : null;
  return {
    mode: provider ? 'rag' : 'rules',
    provider,
    model: llm.chatModel(),
    retrieval: {
      vectorLane: Boolean(provider && llm.embeddingsAvailable() && index && index.chunks > 0),
      structuredLane: true,
      liveLane: true,
      index,
    },
    suggested: SUGGESTED,
  };
}

module.exports = {
  chat,
  meta,
  SUGGESTED,
  buildContext: retriever.liveSnapshot,
  SYSTEM_PROMPT,
};
