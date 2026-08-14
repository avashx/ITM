/**
 * Corpus builder: turns the platform's own data into retrievable passages.
 *
 * Chunking here is semantic rather than fixed-window. Each source is cut along
 * the boundary that already carries meaning in this domain:
 *
 *   policy    - one passage per rule (SLA norms, lifecycle, spike maths)
 *   taxonomy  - one passage per department, with its categories and the
 *               classifier keywords that route complaints to it
 *   endpoint  - one passage per monitored service (static catalogue facts)
 *   cluster   - one passage per department x category x district, carrying
 *               PRE-COMPUTED counts so aggregate answers quote arithmetic the
 *               database did, never arithmetic the model did
 *   grievance - one passage per record, for "show me actual complaints about X"
 *   insight   - one passage per correlation finding
 *   doc       - repository documentation split on markdown headings, with
 *               overlap only where a section exceeds the size budget
 *
 * Volatile state (who is down right now, open incidents) is deliberately NOT
 * indexed: it would go stale between rebuilds. That is injected fresh on every
 * question by the retriever's live-snapshot lane.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../../config');
const { Grievance, CorrelationInsight } = require('../../models');

const DATA_DIR = path.join(__dirname, '../../../data');
const ROOT = path.join(__dirname, '../../../');

const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

/** Assemble a chunk, deriving its content hash from the embedded text. */
function chunk(kind, chunkId, title, text, citation, metadata = {}) {
  const body = text.trim();
  return { kind, chunkId, title, text: body, citation, metadata, contentHash: sha1(body) };
}

/* -------------------------------------------------------------------------- */
/* 1. Policy and method                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The rules the platform actually enforces, written out in prose so questions
 * like "when does a complaint breach SLA?" retrieve an authoritative answer
 * instead of being guessed from the model's general knowledge.
 * Every number is read from config, so the passage cannot drift from the code.
 */
function policyChunks() {
  const { sla, correlation, monitor } = config;
  return [
    chunk(
      'policy',
      'policy:sla-norms',
      'SLA norms for citizen grievances',
      `IT Monitor tracks two service-level deadlines on every grievance, modelled on Delhi PGMS practice and configurable in the environment.
First response is due ${sla.responseDays} days after registration. Full resolution is due ${sla.resolutionDays} days after registration. Grievances marked SOS priority carry a compressed ${sla.sosDays}-day deadline for resolution instead of ${sla.resolutionDays} days.
Both deadlines are computed once, at registration time, and stored on the grievance as sla.responseDueAt and sla.resolutionDueAt. A grievance is counted as a response breach when it has no firstResponseAt and the response deadline has passed, and as a resolution breach when it is still unresolved after its resolution deadline, or when it was resolved later than that deadline.
The headline "SLA breach rate" quoted anywhere in the platform is the percentage of grievances in the selected window that breached the RESOLUTION deadline. A department with a high breach rate is slow to close complaints, which is not the same as being slow to acknowledge them.`,
      'IT Monitor SLA configuration (SLA_RESPONSE_DAYS, SLA_RESOLUTION_DAYS, SLA_SOS_DAYS)',
      { dataSource: 'real' }
    ),
    chunk(
      'policy',
      'policy:lifecycle',
      'Grievance status lifecycle, priorities and channels',
      `A grievance moves through four statuses: registered (logged, not yet picked up), in_progress (assigned and being worked), resolved (closed with an outcome, resolutionHours is set), and rejected (closed as invalid, out of scope, or duplicate).
"Open" anywhere in this platform means registered plus in_progress. Rejected grievances are closed but never count as resolved, so they are excluded from average-resolution figures.
Priority is one of normal, urgent, or sos. SOS is reserved for danger-to-life situations and gets the compressed ${sla.sosDays}-day deadline.
Intake channels recorded are web, mobile_app, call_1076, janta_samvad, letter, and import. Each grievance also carries a district, ward, and assembly constituency for the geographic views.
Every grievance is routed to one of 15 departments and one of 39 categories by a keyword classifier. The classifier stores its confidence, which is the winning department's share of the total keyword score, and the keywords that matched. Low confidence means the complaint text was ambiguous, not that the complaint is unimportant.`,
      'IT Monitor grievance model and classifier',
      { dataSource: 'real' }
    ),
    chunk(
      'policy',
      'policy:correlation-method',
      'How outage-to-complaint correlation and surge prediction work',
      `The correlation engine looks for complaint spikes that follow service outages. For each resolved incident it takes the affected service's mapped grievance categories, establishes a baseline from the trailing ${correlation.baselineDays} days of complaint volume for that category, then counts complaints in the ${correlation.windowHours}-hour window after the outage began.
A finding is recorded only when the observed volume is at least ${correlation.minRatio}x the baseline AND the Poisson z-score is at least ${correlation.minZ}. Confidence is reported as low, medium, or high from the strength of that z-score.
Surge prediction runs the same relationship forwards: while a mapped service is in an OPEN outage, the engine estimates how many extra complaints per day that category should expect, so a department can pre-position helpdesk staff before the queue builds.
This is a statistical association between two time series, not proof of causation. A finding says complaints rose after an outage; it does not by itself prove the outage caused them.`,
      'IT Monitor correlation engine (Module 3)',
      { dataSource: 'real' }
    ),
    chunk(
      'policy',
      'policy:monitoring-method',
      'How service health is measured',
      `Every enabled service in the catalogue is probed with a single lightweight GET request every 5 minutes, with a ${monitor.timeoutMs / 1000}-second timeout and an honest identifying user agent. Probes are issued in small concurrent batches and back off exponentially while a service is failing, so monitoring never adds load to a government server that is already struggling.
A service is marked down after ${monitor.failThreshold} consecutive failed checks, at which point an incident is opened and alerts are sent. A service is marked degraded when it answers correctly but slower than ${monitor.degradedLatencyMs} ms.
Some government sites return HTTP 403 to non-browser clients. That means alive-but-blocking, not down, and is handled per endpoint with an acceptableStatuses list rather than by pretending to be a browser.
TLS certificate expiry is recorded on every HTTPS check, and certificates within ${monitor.sslWarnDays} days of expiry are flagged.
Raw check results are retained for ${monitor.retentionDays} days; daily uptime rollups are kept permanently.`,
      'IT Monitor uptime scheduler (Module 1)',
      { dataSource: 'real' }
    ),
    chunk(
      'policy',
      'policy:data-provenance',
      'Which figures are real measurements and which are synthetic',
      `This platform mixes two kinds of data and they must never be quoted as if they were the same thing.
REAL MEASUREMENTS: service uptime, latency, HTTP status codes, incidents, TLS certificate expiry, and daily uptime rollups. These come from actual probes of live Delhi government endpoints. The service catalogue itself is researched and verified.
SYNTHETIC DEMO DATA: every grievance record, and therefore every grievance count, SLA breach rate, heatmap point, department ranking, and correlation finding derived from them. Synthetic records are labelled with source "synthetic" and carry SYN- grievance identifiers. They were generated to exercise the analytics until a real PGMS feed is connected.
Any answer that quotes a grievance number must say the figure is synthetic demo data. Any answer about uptime, incidents, or certificates is describing real measurements and should not be hedged as synthetic.`,
      'IT Monitor data provenance policy',
      { dataSource: 'real' }
    ),
  ];
}

/* -------------------------------------------------------------------------- */
/* 2. Department taxonomy                                                      */
/* -------------------------------------------------------------------------- */

function taxonomyChunks() {
  const { departments } = JSON.parse(
    fs.readFileSync(path.join(DATA_DIR, 'reference/departments.json'), 'utf8')
  );
  return departments.map((d) => {
    const cats = d.categories
      .map((c) => `- ${c.name}: routed on keywords such as ${c.keywords.slice(0, 10).join(', ')}.`)
      .join('\n');
    return chunk(
      'taxonomy',
      `taxonomy:${d.code || d.name}`,
      `${d.name} - categories and routing keywords`,
      `${d.name}${d.code ? ` (${d.code})` : ''} handles ${d.categories.length} grievance categories in this platform.
${cats}
A complaint is assigned to ${d.name} when its text matches these keywords more strongly than any other department's.`,
      `Department taxonomy - ${d.name}`,
      { department: d.name, dataSource: 'real' }
    );
  });
}

/* -------------------------------------------------------------------------- */
/* 3. Monitored service catalogue                                              */
/* -------------------------------------------------------------------------- */

function endpointChunks() {
  const { endpoints } = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'endpoints.json'), 'utf8'));
  return endpoints.map((e) =>
    chunk(
      'endpoint',
      `endpoint:${e.url}`,
      e.name,
      `${e.name} is a monitored Delhi government e-service at ${e.url}.
Owning department: ${e.department}. Service category: ${e.category}.
${e.description || ''}
${
  e.relatedGrievanceCategories && e.relatedGrievanceCategories.length
    ? `When this service is down, the correlation engine watches these grievance categories for a spike: ${e.relatedGrievanceCategories.join(', ')}.`
    : 'This service is not yet mapped to any grievance category for correlation.'
}
${e.acceptableStatuses ? `It is treated as healthy on HTTP statuses ${e.acceptableStatuses.join(', ')} because it blocks non-browser clients.` : ''}
This passage describes the catalogue entry only. It does not say whether the service is up right now.`,
      `Service catalogue - ${e.name}`,
      { department: e.department, category: e.category, url: e.url, dataSource: 'real' }
    )
  );
}

/* -------------------------------------------------------------------------- */
/* 4. Grievance clusters and records                                           */
/* -------------------------------------------------------------------------- */

const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0);

/**
 * Group every grievance by department x category x district and describe each
 * group as one passage. This is the workhorse of aggregate retrieval: asking
 * "what are people complaining about in North West Delhi" retrieves a handful
 * of these, each already carrying exact counts.
 */
function clusterChunks(grievances) {
  const groups = new Map();
  for (const g of grievances) {
    const district = (g.location && g.location.district) || 'Unassigned';
    const key = `${g.department}|${g.category}|${district}`;
    let grp = groups.get(key);
    if (!grp) {
      grp = {
        department: g.department,
        category: g.category,
        district,
        total: 0,
        status: {},
        priority: {},
        responseBreached: 0,
        resolutionBreached: 0,
        resolutionHoursSum: 0,
        resolvedCount: 0,
        wards: new Map(),
        samples: [],
        firstDay: g.dayBucket,
        lastDay: g.dayBucket,
      };
      groups.set(key, grp);
    }
    grp.total += 1;
    grp.status[g.status] = (grp.status[g.status] || 0) + 1;
    grp.priority[g.priority] = (grp.priority[g.priority] || 0) + 1;
    if (g.sla && g.sla.responseBreached) grp.responseBreached += 1;
    if (g.sla && g.sla.resolutionBreached) grp.resolutionBreached += 1;
    if (g.status === 'resolved' && g.resolutionHours) {
      grp.resolutionHoursSum += g.resolutionHours;
      grp.resolvedCount += 1;
    }
    const ward = g.location && g.location.ward;
    if (ward) grp.wards.set(ward, (grp.wards.get(ward) || 0) + 1);
    if (grp.samples.length < 4 && g.description) grp.samples.push(g.description);
    if (g.dayBucket < grp.firstDay) grp.firstDay = g.dayBucket;
    if (g.dayBucket > grp.lastDay) grp.lastDay = g.dayBucket;
  }

  return [...groups.values()].map((grp) => {
    const topWards = [...grp.wards.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([w, n]) => `${w} (${n})`)
      .join(', ');
    const open = (grp.status.registered || 0) + (grp.status.in_progress || 0);
    const avgDays = grp.resolvedCount
      ? Math.round((grp.resolutionHoursSum / grp.resolvedCount / 24) * 10) / 10
      : null;

    return chunk(
      'cluster',
      `cluster:${grp.department}|${grp.category}|${grp.district}`,
      `${grp.category} complaints in ${grp.district} (${grp.department})`,
      `SYNTHETIC DEMO DATA. Aggregated profile of ${grp.total} "${grp.category}" grievances filed against ${grp.department} in ${grp.district}, covering ${grp.firstDay} to ${grp.lastDay}.
Status: ${grp.status.resolved || 0} resolved, ${grp.status.in_progress || 0} in progress, ${grp.status.registered || 0} registered, ${grp.status.rejected || 0} rejected. ${open} are still open (${pct(open, grp.total)}% of the group).
SLA: ${grp.resolutionBreached} breached the resolution deadline (${pct(grp.resolutionBreached, grp.total)}%) and ${grp.responseBreached} breached the first-response deadline (${pct(grp.responseBreached, grp.total)}%).
Priority mix: ${grp.priority.normal || 0} normal, ${grp.priority.urgent || 0} urgent, ${grp.priority.sos || 0} SOS.
${avgDays !== null ? `Resolved cases took ${avgDays} days on average.` : 'Nothing in this group has been resolved yet, so there is no average resolution time.'}
${topWards ? `Most affected wards: ${topWards}.` : ''}
Representative complaints: ${grp.samples.map((s) => `"${s}"`).join(' ')}`,
      `Grievance analytics - ${grp.category} / ${grp.district} (synthetic)`,
      {
        department: grp.department,
        category: grp.category,
        district: grp.district,
        recordCount: grp.total,
        dataSource: 'synthetic',
      }
    );
  });
}

/** One passage per grievance, for questions that want the actual complaints. */
function grievanceChunks(grievances) {
  return grievances.map((g) => {
    const loc = g.location || {};
    const where = [loc.ward, loc.district].filter(Boolean).join(', ') || 'location not recorded';
    const breach = [];
    if (g.sla && g.sla.responseBreached) breach.push('first-response SLA breached');
    if (g.sla && g.sla.resolutionBreached) breach.push('resolution SLA breached');
    return chunk(
      'grievance',
      `grievance:${g.grievanceId}`,
      `${g.grievanceId} - ${g.category}`,
      `${g.source === 'synthetic' ? 'SYNTHETIC DEMO RECORD. ' : ''}Grievance ${g.grievanceId} filed ${g.dayBucket} via ${g.channel} in ${where}${loc.assemblyConstituency ? ` (${loc.assemblyConstituency} constituency)` : ''}.
Complaint: "${g.description}"
Routed to ${g.department} under category ${g.category}${g.subcategory ? ` / ${g.subcategory}` : ''}. Priority ${g.priority}. Status ${g.status}.
${g.status === 'resolved' && g.resolutionHours ? `Resolved in ${Math.round((g.resolutionHours / 24) * 10) / 10} days.` : ''} ${breach.length ? breach.join(' and ') + '.' : 'Within SLA.'}`,
      `${g.grievanceId} (${g.source === 'synthetic' ? 'synthetic' : g.source})`,
      {
        department: g.department,
        category: g.category,
        district: loc.district,
        status: g.status,
        priority: g.priority,
        dayBucket: g.dayBucket,
        dataSource: g.source === 'synthetic' ? 'synthetic' : 'real',
        recordCount: 1,
      }
    );
  });
}

/* -------------------------------------------------------------------------- */
/* 5. Correlation findings                                                     */
/* -------------------------------------------------------------------------- */

function insightChunks(insights) {
  return insights.map((i) =>
    chunk(
      'insight',
      `insight:${i._id}`,
      `Correlation: ${i.serviceName} outage vs ${i.category} complaints`,
      `${i.narrative}
Detail: ${i.serviceName} (${i.department}) was down${i.outage && i.outage.durationHours ? ` for ${i.outage.durationHours} hours` : ''}${i.outage && i.outage.startedAt ? ` starting ${new Date(i.outage.startedAt).toISOString().slice(0, 10)}` : ''}.
In the observation window that followed, "${i.category}" complaints ran at ${i.observedDailyMean} per day against a trailing baseline of ${i.baselineDailyMean} per day - ${i.observedTotal} observed against ${i.expectedTotal} expected, a ratio of ${i.spikeRatio} (z-score ${i.zScore}). Confidence: ${i.confidence}.
Grievance volumes here are synthetic demo data. This is a statistical association, not proof of causation.`,
      `Correlation insight - ${i.serviceName} / ${i.category}`,
      {
        department: i.department,
        category: i.category,
        dataSource: 'synthetic',
      }
    )
  );
}

/* -------------------------------------------------------------------------- */
/* 6. Repository documentation                                                 */
/* -------------------------------------------------------------------------- */

const DOC_FILES = [
  'README.md',
  'API.md',
  'DATA_SOURCES.md',
  'DEPLOYMENT.md',
  'SETUP.md',
  'docs/EXECUTIVE_BRIEF.md',
  'docs/RESEARCH_FINDINGS.md',
  'docs/COMPLIANCE_ROADMAP.md',
];

const MAX_DOC_CHARS = 1600;
const DOC_OVERLAP = 200;

/**
 * Split markdown on its heading structure, which is the document's own
 * semantic outline. Only sections that exceed the budget get cut further, and
 * those cuts fall on paragraph boundaries with a small overlap so a sentence
 * straddling the seam is still retrievable from both halves.
 */
function splitMarkdown(md) {
  const lines = md.split('\n');
  const sections = [];
  let heading = 'Overview';
  let buf = [];
  const flush = () => {
    const body = buf.join('\n').trim();
    if (body) sections.push({ heading, body });
    buf = [];
  };
  let inFence = false;
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) inFence = !inFence;
    const m = !inFence && /^(#{1,3})\s+(.*)$/.exec(line);
    if (m) {
      flush();
      heading = m[2].trim();
    } else {
      buf.push(line);
    }
  }
  flush();

  const out = [];
  for (const s of sections) {
    if (s.body.length <= MAX_DOC_CHARS) {
      out.push(s);
      continue;
    }
    const paras = s.body.split(/\n{2,}/);
    let piece = '';
    let part = 1;
    for (const p of paras) {
      if (piece && piece.length + p.length > MAX_DOC_CHARS) {
        out.push({ heading: `${s.heading} (part ${part})`, body: piece.trim() });
        piece = `${piece.slice(-DOC_OVERLAP)}\n\n`;
        part += 1;
      }
      piece += `${p}\n\n`;
    }
    if (piece.trim()) out.push({ heading: part > 1 ? `${s.heading} (part ${part})` : s.heading, body: piece.trim() });
  }
  return out;
}

function docChunks() {
  const out = [];
  for (const rel of DOC_FILES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const sections = splitMarkdown(fs.readFileSync(abs, 'utf8'));
    sections.forEach((s, i) => {
      if (s.body.length < 120) return; // navigation stubs carry no answer
      out.push(
        chunk(
          'doc',
          `doc:${rel}#${i}`,
          `${rel} - ${s.heading}`,
          `From the IT Monitor documentation file ${rel}, section "${s.heading}":\n\n${s.body}`,
          `${rel} - ${s.heading}`,
          { url: rel, dataSource: 'real' }
        )
      );
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Build the full corpus. Requires an active mongoose connection.
 * @param {object} [opts]
 * @param {boolean} [opts.includeRecords] embed individual grievances too
 */
async function buildCorpus(opts = {}) {
  const includeRecords =
    opts.includeRecords !== undefined ? opts.includeRecords : config.rag.indexRecords;

  const [grievances, insights] = await Promise.all([
    Grievance.find({})
      .select(
        'grievanceId source channel description department category subcategory status priority dayBucket resolutionHours sla.responseBreached sla.resolutionBreached location'
      )
      .lean(),
    CorrelationInsight.find({}).lean(),
  ]);

  const chunks = [
    ...policyChunks(),
    ...taxonomyChunks(),
    ...endpointChunks(),
    ...docChunks(),
    ...clusterChunks(grievances),
    ...insightChunks(insights),
    ...(includeRecords ? grievanceChunks(grievances) : []),
  ];

  return { chunks, counts: { grievances: grievances.length, insights: insights.length } };
}

module.exports = { buildCorpus, splitMarkdown };
