/**
 * Hybrid retrieval. Three lanes run in parallel and are merged into one
 * grounding context; the model is then forbidden to use anything else.
 *
 *  1. LIVE      - a snapshot of volatile state (what is down right now, open
 *                 incidents, certificate expiry, active surge forecasts).
 *                 Never indexed, always fresh.
 *  2. STRUCTURED- deterministic entity extraction off the question, then an
 *                 exact aggregate straight from MongoDB. This is what removes
 *                 numeric hallucination: when the answer is a count, the count
 *                 is computed by the database, and the model is told to quote
 *                 it verbatim rather than derive one from the passages.
 *  3. VECTOR    - semantic search over the embedded corpus for the narrative
 *                 material: policy, department taxonomy, service catalogue,
 *                 complaint themes, correlation findings, documentation.
 *
 * Lane 2 is the reason this is not just "stuff some text in the prompt". A
 * language model asked to count 812 retrieved passages will invent a number;
 * asked to read one it was handed, it will not.
 */
const config = require('../../config');
const llm = require('../llm');
const store = require('./store');
const {
  ServiceEndpoint,
  Incident,
  Grievance,
  CorrelationInsight,
} = require('../../models');
const analytics = require('../../modules/grievance/analytics');
const predictor = require('../../modules/correlation/predictor');
const { dayBucketMinus } = require('../../utils/dates');
const log = require('../../utils/logger')('rag:retrieve');

/* -------------------------------------------------------------------------- */
/* Short-lived memo                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Both the live snapshot and the unfiltered aggregate are relatively expensive
 * (six Atlas round trips; a full scan of the grievance collection) and both are
 * recomputed on every turn of a conversation. A few seconds of caching removes
 * that cost from follow-up questions without ever showing stale data: probes
 * only run every 5 minutes, so nothing meaningful changes inside the window.
 */
function memo(ttlMs) {
  const cache = new Map();
  return async function get(key, produce) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await produce();
    cache.set(key, { at: Date.now(), value });
    // The key space is bounded by distinct filter combinations; trim anyway so
    // a long-running process cannot accumulate them indefinitely.
    if (cache.size > 64) {
      for (const [k, v] of cache) if (Date.now() - v.at >= ttlMs) cache.delete(k);
    }
    return value;
  };
}

const snapshotMemo = memo(10000);
const aggregateMemo = memo(30000);

/* -------------------------------------------------------------------------- */
/* Lane 1: live snapshot                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Volatile platform state. Deliberately compact - a few KB - so it can ride
 * along on every single turn without dominating the token budget.
 */
async function liveSnapshot() {
  return snapshotMemo('live', buildLiveSnapshot);
}

async function buildLiveSnapshot() {
  const [services, openIncidents, gSummary, byDept, insights, predictions] = await Promise.all([
    ServiceEndpoint.find({ enabled: true })
      .select(
        'name url department category state.status state.lastLatencyMs state.lastError state.ssl.daysRemaining'
      )
      .lean(),
    Incident.find({ status: 'open' })
      .populate('service', 'name url department')
      .sort({ startedAt: 1 })
      .lean(),
    analytics.summary({ days: 30 }),
    analytics.byDepartment({ days: 30 }),
    CorrelationInsight.find({}).sort({ createdAt: -1 }).limit(6).lean(),
    predictor.predictOpenOutages({ notify: false }),
  ]);

  const byStatus = { operational: 0, degraded: 0, down: 0, unknown: 0 };
  for (const s of services) byStatus[s.state.status] = (byStatus[s.state.status] || 0) + 1;

  return {
    generatedAt: new Date().toISOString(),
    simulatedMode: config.monitor.simulate,
    services: {
      total: services.length,
      operational: byStatus.operational,
      degradedCount: byStatus.degraded,
      downCount: byStatus.down,
      unknownCount: byStatus.unknown,
      down: services
        .filter((s) => s.state.status === 'down')
        .map((s) => ({
          name: s.name,
          url: s.url,
          department: s.department,
          error: s.state.lastError,
        })),
      degraded: services
        .filter((s) => s.state.status === 'degraded')
        .map((s) => ({
          name: s.name,
          latencyMs: s.state.lastLatencyMs,
          reason: s.state.lastError || 'slow response',
        })),
      sslExpiringSoon: services
        .filter(
          (s) =>
            s.state.ssl && s.state.ssl.daysRemaining != null && s.state.ssl.daysRemaining <= 30
        )
        .map((s) => ({ name: s.name, daysRemaining: s.state.ssl.daysRemaining }))
        .sort((a, b) => a.daysRemaining - b.daysRemaining),
    },
    openIncidents: openIncidents.map((i) => ({
      service: i.service ? i.service.name : 'unknown',
      department: i.service ? i.service.department : null,
      startedAt: i.startedAt,
      hoursOpen: Math.round(((Date.now() - new Date(i.startedAt)) / 3600000) * 10) / 10,
      error: i.lastError,
    })),
    grievancesLast30d: {
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
    recentCorrelations: insights.map((i) => ({
      narrative: i.narrative,
      service: i.serviceName,
      category: i.category,
      spikePct: Math.round((i.spikeRatio - 1) * 100),
      confidence: i.confidence,
    })),
    activeSurgeForecasts: predictions.map((p) => ({
      service: p.serviceName,
      category: p.category,
      department: p.department,
      extraComplaintsPerDay: p.predictedExtraPerDay,
      outageOpenHours: p.outageOpenHours,
    })),
  };
}

/* -------------------------------------------------------------------------- */
/* Lane 2: deterministic entity extraction + exact aggregates                  */
/* -------------------------------------------------------------------------- */

let vocabCache = null;
let vocabCachedAt = 0;
const VOCAB_TTL_MS = 5 * 60 * 1000;

/**
 * The set of values that actually exist in the data, so the extractor can only
 * ever produce a filter that matches something real.
 */
async function vocabulary() {
  if (vocabCache && Date.now() - vocabCachedAt < VOCAB_TTL_MS) return vocabCache;
  const [departments, categories, districts] = await Promise.all([
    Grievance.distinct('department'),
    Grievance.distinct('category'),
    Grievance.distinct('location.district'),
  ]);
  vocabCache = {
    departments: departments.filter(Boolean),
    categories: categories.filter(Boolean),
    districts: districts.filter(Boolean),
  };
  vocabCachedAt = Date.now();
  return vocabCache;
}

const STATUS_WORDS = {
  resolved: 'resolved',
  closed: 'resolved',
  pending: 'registered',
  registered: 'registered',
  'in progress': 'in_progress',
  ongoing: 'in_progress',
  rejected: 'rejected',
};
const PRIORITY_WORDS = { sos: 'sos', urgent: 'urgent', emergency: 'sos', critical: 'sos' };

const FILLER_WORDS = ['delhi', 'department', 'board', 'issues', 'other', 'general'];

/**
 * Match a question against a vocabulary, in two passes.
 *
 * Whole-phrase matches win outright, and a phrase contained inside a longer
 * match is discarded - otherwise "North West" also matches the district
 * "North", three districts match at once, and the filter is thrown away as
 * ambiguous. Only when nothing matches as a phrase do we fall back to matching
 * on distinctive words, which is loose enough that it is required to be
 * unambiguous before it is trusted.
 */
function matchVocab(question, values) {
  const q = question.toLowerCase();

  // A vocabulary value that is itself a filler word - the data contains a
  // catch-all district literally named "Delhi" - would match almost every
  // question asked of this platform, so it is never matchable.
  const candidates = values.filter((v) => !FILLER_WORDS.includes(String(v).toLowerCase()));

  const phrase = candidates.filter((v) => q.includes(String(v).toLowerCase()));
  if (phrase.length) {
    const distinct = phrase.filter(
      (v) =>
        !phrase.some(
          (other) => other !== v && String(other).toLowerCase().includes(String(v).toLowerCase())
        )
    );
    if (distinct.length <= 1) return distinct;
    // Several unrelated names matched. The longest is the most specific
    // signal, so it wins outright - but only if it is unambiguously longest.
    const sorted = distinct.slice().sort((a, b) => String(b).length - String(a).length);
    return String(sorted[0]).length > String(sorted[1]).length ? [sorted[0]] : distinct;
  }

  return candidates.filter((v) => {
    const words = String(v)
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 4 && !FILLER_WORDS.includes(w));
    return words.length > 0 && words.some((w) => q.includes(w));
  });
}

/**
 * Is this a question ABOUT the rules rather than a question about the records?
 * "When does a grievance count as an SLA breach" must not silently filter the
 * aggregate down to breached records and report a 100% breach rate.
 */
function isDefinitional(q) {
  return (
    /^\s*(what|when|how|why|who)\s+(is|are|was|were|does|do|did|should|would|counts?|happens)\b/.test(q) ||
    /\b(explain|define|definition|meaning of|what counts as|how does .* work)\b/.test(q)
  );
}

/** Pull an explicit time window out of the question, if there is one. */
function extractWindow(question) {
  const q = question.toLowerCase();
  let m = /(?:last|past|previous)\s+(\d{1,3})\s*(day|week|month)/.exec(q);
  if (m) {
    const n = parseInt(m[1], 10);
    const mult = m[2] === 'week' ? 7 : m[2] === 'month' ? 30 : 1;
    return { days: Math.min(n * mult, 730), label: `last ${n} ${m[2]}${n > 1 ? 's' : ''}` };
  }
  if (/\b(today)\b/.test(q)) return { days: 1, label: 'today' };
  if (/\b(yesterday)\b/.test(q)) return { days: 2, label: 'the last 2 days' };
  if (/\b(this|last|past)\s+week\b/.test(q)) return { days: 7, label: 'the last 7 days' };
  if (/\b(this|last|past)\s+month\b/.test(q)) return { days: 30, label: 'the last 30 days' };
  if (/\b(this|last|past)\s+(quarter|3 months)\b/.test(q)) return { days: 90, label: 'the last 90 days' };
  if (/\b(this|last|past)\s+year\b/.test(q)) return { days: 365, label: 'the last year' };
  return null;
}

/**
 * Turn a question into a structured filter. Everything it produces is drawn
 * from values that exist in the database, so an unmatched entity yields no
 * filter rather than a wrong one.
 */
/**
 * Is this a question about service health rather than about complaints?
 * "How many services are down" would otherwise word-match the grievance
 * category "Portal & e-Service Issues" and attach a filter that has nothing
 * to do with what was asked. These questions are answered from the live lane,
 * so the aggregate stays unfiltered.
 */
function isInfraQuestion(q) {
  return (
    /\b(down|outage|offline|uptime|incident|certificate|ssl|cert|latency|degraded|probe|responding)\b/.test(q) &&
    !/\b(grievance|complaint|sla|breach|citizen|department'?s? performance)\b/.test(q)
  );
}

async function extractFilters(question) {
  const q = question.toLowerCase();
  const vocab = await vocabulary();
  const filters = {};
  const matched = [];

  if (isInfraQuestion(q)) {
    return { filters, matched };
  }

  const depts = matchVocab(question, vocab.departments);
  if (depts.length === 1) {
    filters.department = depts[0];
    matched.push(`department = ${depts[0]}`);
  }
  const cats = matchVocab(question, vocab.categories);
  if (cats.length === 1) {
    filters.category = cats[0];
    matched.push(`category = ${cats[0]}`);
  }
  const dists = matchVocab(question, vocab.districts);
  if (dists.length === 1) {
    filters.district = dists[0];
    matched.push(`district = ${dists[0]}`);
  }

  for (const [word, status] of Object.entries(STATUS_WORDS)) {
    if (q.includes(word)) {
      filters.status = status;
      matched.push(`status = ${status}`);
      break;
    }
  }
  for (const [word, priority] of Object.entries(PRIORITY_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(q)) {
      filters.priority = priority;
      matched.push(`priority = ${priority}`);
      break;
    }
  }
  // Narrow to breached records only when the question is genuinely asking for
  // that subset. A definitional question ("what is an SLA breach") or a
  // comparison ("which department has the worst breach rate") must keep the
  // full denominator - filtering to breaches first would make every rate 100%.
  const isComparison = /\b(which|worst|best|rank|rate|compare|highest|lowest|top|most|least)\b/.test(q);
  if (
    /\b(breach|breached|overdue|late|missed sla|violat)/.test(q) &&
    !isDefinitional(q) &&
    !isComparison
  ) {
    filters.slaBreached = true;
    matched.push('resolution SLA breached');
  }

  const window = extractWindow(question);
  if (window) {
    filters.days = window.days;
    matched.push(`window = ${window.label}`);
  }

  return { filters, matched };
}

/**
 * Exact aggregates over the grievance collection.
 *
 * Uses a lean find plus an in-process reducer rather than an aggregation
 * pipeline, matching the engine-portability rule the rest of the analytics
 * follow (CLAUDE.md rule 4).
 */
async function aggregateGrievances(filters = {}) {
  return aggregateMemo(JSON.stringify(filters), () => computeAggregate(filters));
}

async function computeAggregate(filters) {
  const query = {};
  if (filters.department) query.department = filters.department;
  if (filters.category) query.category = filters.category;
  if (filters.district) query['location.district'] = filters.district;
  if (filters.status) query.status = filters.status;
  if (filters.priority) query.priority = filters.priority;
  if (filters.slaBreached) query['sla.resolutionBreached'] = true;
  if (filters.days) query.dayBucket = { $gte: dayBucketMinus(filters.days - 1) };

  const rows = await Grievance.find(query)
    .select(
      'department category status priority dayBucket resolutionHours sla.responseBreached sla.resolutionBreached location.district source'
    )
    .lean();

  const acc = { byStatus: {}, byPriority: {}, bySource: {} };
  // Per-facet rollups carry their own denominator, so "which department has
  // the worst breach RATE" is answerable without re-filtering the query - the
  // model reads a rate the database computed instead of dividing two numbers
  // itself.
  const facets = { department: new Map(), category: new Map(), district: new Map() };
  let responseBreached = 0;
  let resolutionBreached = 0;
  let resolvedHours = 0;
  let resolvedCount = 0;
  let firstDay = null;
  let lastDay = null;

  const bump = (map, key) => {
    if (key) map[key] = (map[key] || 0) + 1;
  };
  const facetBump = (map, key, r) => {
    if (!key) return;
    let f = map.get(key);
    if (!f) {
      f = { total: 0, breached: 0, open: 0, resolvedHours: 0, resolvedCount: 0 };
      map.set(key, f);
    }
    f.total += 1;
    if (r.sla && r.sla.resolutionBreached) f.breached += 1;
    if (r.status === 'registered' || r.status === 'in_progress') f.open += 1;
    if (r.status === 'resolved' && r.resolutionHours) {
      f.resolvedHours += r.resolutionHours;
      f.resolvedCount += 1;
    }
  };

  for (const r of rows) {
    bump(acc.byStatus, r.status);
    bump(acc.byPriority, r.priority);
    bump(acc.bySource, r.source);
    facetBump(facets.department, r.department, r);
    facetBump(facets.category, r.category, r);
    facetBump(facets.district, r.location && r.location.district, r);
    if (r.sla && r.sla.responseBreached) responseBreached += 1;
    if (r.sla && r.sla.resolutionBreached) resolutionBreached += 1;
    if (r.status === 'resolved' && r.resolutionHours) {
      resolvedHours += r.resolutionHours;
      resolvedCount += 1;
    }
    if (!firstDay || r.dayBucket < firstDay) firstDay = r.dayBucket;
    if (!lastDay || r.dayBucket > lastDay) lastDay = r.dayBucket;
  }

  const total = rows.length;
  const round1 = (n) => Math.round(n * 10) / 10;
  /** Rank a facet by volume, but carry the rate so either can be quoted. */
  const rank = (map, n = 8) =>
    [...map.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, n)
      .map(([name, f]) => ({
        name,
        total: f.total,
        open: f.open,
        slaBreached: f.breached,
        slaBreachPct: f.total ? round1((f.breached / f.total) * 100) : 0,
        avgResolutionDays: f.resolvedCount
          ? round1(f.resolvedHours / f.resolvedCount / 24)
          : null,
      }));
  /** Same facet, ordered by breach rate - the "who is worst" ordering. */
  const worst = (map, n = 5) =>
    [...map.entries()]
      // A handful of records makes a meaningless percentage; require a floor.
      .filter(([, f]) => f.total >= 20)
      .map(([name, f]) => ({
        name,
        total: f.total,
        slaBreached: f.breached,
        slaBreachPct: round1((f.breached / f.total) * 100),
      }))
      .sort((a, b) => b.slaBreachPct - a.slaBreachPct)
      .slice(0, n);

  return {
    // Carried inside the aggregate rather than stated once elsewhere in the
    // prompt: the label travels with the numbers, so a model quoting a figure
    // is reading its provenance in the same breath.
    dataProvenance:
      'SYNTHETIC DEMO DATA - every figure in this aggregate comes from generated grievance records. Any answer quoting these numbers must say they are synthetic demo data.',
    appliedFilters: filters,
    matchedRecords: total,
    dateRangeCovered: total ? { from: firstDay, to: lastDay } : null,
    byStatus: acc.byStatus,
    open: (acc.byStatus.registered || 0) + (acc.byStatus.in_progress || 0),
    byPriority: acc.byPriority,
    slaResolutionBreached: resolutionBreached,
    slaResolutionBreachPct: total ? round1((resolutionBreached / total) * 100) : 0,
    slaResponseBreached: responseBreached,
    slaResponseBreachPct: total ? round1((responseBreached / total) * 100) : 0,
    avgResolutionDays: resolvedCount ? round1(resolvedHours / resolvedCount / 24) : null,
    byDepartment: rank(facets.department),
    byCategory: rank(facets.category),
    byDistrict: rank(facets.district),
    worstDepartmentsByBreachRate: worst(facets.department),
    worstCategoriesByBreachRate: worst(facets.category),
    dataSourceMix: acc.bySource,
  };
}

/* -------------------------------------------------------------------------- */
/* Lane 3: vector search                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Semantic search, narrowed by any entity the extractor was confident about.
 *
 * The facet filter is applied optimistically: if it leaves too little to
 * retrieve, the search is retried unfiltered so a slightly-off entity guess
 * can never starve the model of context.
 */
async function vectorSearch(question, filters) {
  if (!config.rag.enabled || !llm.embeddingsAvailable()) return { passages: [], skipped: 'no-embeddings' };
  const idx = await store.load();
  if (!idx.count) return { passages: [], skipped: 'empty-index' };

  const [queryVec] = await llm.embed([question]);

  const facet = (meta) => {
    const m = meta.metadata || {};
    if (filters.department && m.department && m.department !== filters.department) return false;
    if (filters.district && m.district && m.district !== filters.district) return false;
    return true;
  };

  let hits = await store.search(queryVec, { k: config.rag.candidateK, filter: facet });
  if (hits.length < 3) hits = await store.search(queryVec, { k: config.rag.candidateK });

  const picked = await store.diversify(hits, config.rag.topK);
  return {
    passages: picked.map((p) => ({
      chunkId: p.chunkId,
      kind: p.kind,
      title: p.title,
      text: p.text,
      citation: p.citation,
      dataSource: (p.metadata && p.metadata.dataSource) || 'unknown',
      score: Math.round(p.score * 1000) / 1000,
    })),
    candidatesScanned: idx.count,
  };
}

/* -------------------------------------------------------------------------- */
/* Orchestration                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Run all three lanes for one question.
 * @returns {Promise<{ live, structured, passages, extraction, timings }>}
 */
async function retrieve(question) {
  const t0 = Date.now();
  const { filters, matched } = await extractFilters(question);
  const tExtract = Date.now() - t0;

  const t1 = Date.now();
  const [live, structured, vector] = await Promise.all([
    liveSnapshot(),
    aggregateGrievances(filters),
    vectorSearch(question, filters).catch((err) => {
      log.warn(`vector lane failed: ${err.message}`);
      return { passages: [], skipped: err.message };
    }),
  ]);

  const timings = {
    extractMs: tExtract,
    retrieveMs: Date.now() - t1,
    totalMs: Date.now() - t0,
  };

  return {
    live,
    structured,
    passages: vector.passages,
    extraction: { filters, matched, vectorSkipped: vector.skipped || null },
    corpusSize: vector.candidatesScanned || 0,
    timings,
  };
}

module.exports = {
  retrieve,
  liveSnapshot,
  aggregateGrievances,
  extractFilters,
  vectorSearch,
};
