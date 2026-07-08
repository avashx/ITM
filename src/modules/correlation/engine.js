/**
 * Correlation engine (Module 3) - the differentiator.
 *
 * For every resolved outage incident, and for every grievance category the
 * affected service maps to (ServiceEndpoint.relatedGrievanceCategories), we
 * ask: did complaint volume in the post-outage window rise significantly
 * above that category's normal level?
 *
 * Statistics, kept deliberately explainable:
 *   baseline  = mean daily complaints over the trailing 28 days BEFORE the
 *               outage (per department+category)
 *   observed  = complaints during the post-outage window (outage start ->
 *               +CORRELATION_WINDOW_HOURS, whole IST days)
 *   ratio     = observed / expected  (expected = baseline x window days)
 *   z-score   = (observed - expected) / sqrt(expected)   [Poisson approx.]
 *
 * An insight is recorded when ratio >= CORRELATION_MIN_RATIO AND
 * z >= CORRELATION_MIN_Z. Confidence buckets: z>=4 high, z>=3 medium, else low.
 */
const config = require('../../config');
const {
  Incident,
  Grievance,
  ServiceEndpoint,
  CorrelationInsight,
} = require('../../models');
const { dayBucket, addDays } = require('../../utils/dates');
const socket = require('../../services/socket');
const log = require('../../utils/logger')('correlation');

const MIN_OUTAGE_HOURS = 1; // ignore blips; short outages rarely move complaint volume

/**
 * Scan incidents (default: last `lookbackDays`) and upsert insights.
 * Returns the list of insights created in this run.
 */
async function run({ lookbackDays = 90 } = {}) {
  const since = new Date(Date.now() - lookbackDays * 86400000);
  const incidents = await Incident.find({
    status: 'resolved',
    startedAt: { $gte: since },
    durationHours: { $gte: MIN_OUTAGE_HOURS },
  }).populate('service');

  const created = [];
  for (const incident of incidents) {
    const service = incident.service;
    if (!service || !service.relatedGrievanceCategories) continue;
    for (const category of service.relatedGrievanceCategories) {
      const insight = await evaluatePair(incident, service, category);
      if (insight) created.push(insight);
    }
  }
  log.info(`run complete: ${incidents.length} incidents scanned, ${created.length} new insights`);
  return created;
}

/** Evaluate one incident x category pair; upsert an insight if significant. */
async function evaluatePair(incident, service, category) {
  // Skip if already recorded for this incident+category (engine is idempotent)
  const dept = await departmentForCategory(category);
  const existing = await CorrelationInsight.findOne({
    incident: incident._id,
    department: dept,
    category,
  });
  if (existing) return null;

  // ---- observation window: IST days touched by [start, start+windowHours]
  const windowFrom = incident.startedAt;
  const windowTo = new Date(
    incident.startedAt.getTime() + config.correlation.windowHours * 3600000
  );
  const windowDays = dayRange(windowFrom, windowTo);

  // ---- baseline: trailing 28 full days before the outage day
  const baselineDays = [];
  for (let i = 1; i <= config.correlation.baselineDays; i++) {
    baselineDays.push(dayBucket(addDays(windowFrom, -i)));
  }

  const [baselineCount, observedCount] = await Promise.all([
    Grievance.countDocuments({ category, dayBucket: { $in: baselineDays } }),
    Grievance.countDocuments({ category, dayBucket: { $in: windowDays } }),
  ]);

  const baselineDailyMean = baselineCount / config.correlation.baselineDays;
  const expected = baselineDailyMean * windowDays.length;
  // A category with virtually no history can't produce a meaningful spike.
  if (expected < 1) return null;

  const ratio = observedCount / expected;
  const z = (observedCount - expected) / Math.sqrt(expected);
  if (ratio < config.correlation.minRatio || z < config.correlation.minZ) return null;

  const spikePct = Math.round((ratio - 1) * 100);
  const confidence = z >= 4 ? 'high' : z >= 3 ? 'medium' : 'low';
  const dayName = windowFrom.toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: config.timezone,
  });

  const insight = await CorrelationInsight.create({
    incident: incident._id,
    service: service._id,
    serviceName: service.name,
    department: dept,
    category,
    outage: {
      startedAt: incident.startedAt,
      resolvedAt: incident.resolvedAt,
      durationHours: incident.durationHours,
    },
    window: { from: windowFrom, to: windowTo, days: windowDays },
    baselineDailyMean: round2(baselineDailyMean),
    observedDailyMean: round2(observedCount / windowDays.length),
    observedTotal: observedCount,
    expectedTotal: round2(expected),
    spikeRatio: round2(ratio),
    zScore: round2(z),
    confidence,
    narrative:
      `${service.name} was down ${incident.durationHours}h starting ${dayName}; ` +
      `"${category}" complaints rose ${spikePct}% above baseline over the following ` +
      `${windowDays.length} day(s) (${observedCount} vs ~${Math.round(expected)} expected).`,
  });

  socket.emit('correlation:insight', {
    id: insight._id,
    serviceName: service.name,
    category,
    spikePct,
    confidence,
    narrative: insight.narrative,
  });
  log.info(`insight: ${insight.narrative}`);
  return insight;
}

/**
 * Timeline overlay data for the UI: daily grievance counts for a department
 * or category, plus outage windows of the mapped services in the same range.
 */
async function timeline({ category, department, days = 60 } = {}) {
  const nDays = Math.min(parseInt(days, 10) || 60, 180);
  const buckets = [];
  for (let i = nDays - 1; i >= 0; i--) buckets.push(dayBucket(addDays(new Date(), -i)));

  const gFilter = { dayBucket: { $gte: buckets[0] } };
  if (category) gFilter.category = category;
  else if (department) gFilter.department = department;

  const grievances = await Grievance.find(gFilter).select('dayBucket').lean();
  const counts = Object.fromEntries(buckets.map((b) => [b, 0]));
  for (const g of grievances) {
    if (counts[g.dayBucket] !== undefined) counts[g.dayBucket]++;
  }

  // Outages of services mapped to this category/department in range
  const sFilter = category
    ? { relatedGrievanceCategories: category }
    : department
      ? { department }
      : {};
  const services = await ServiceEndpoint.find(sFilter).select('_id name').lean();
  const incidents = await Incident.find({
    service: { $in: services.map((s) => s._id) },
    startedAt: { $gte: new Date(Date.now() - nDays * 86400000) },
  })
    .sort({ startedAt: 1 })
    .lean();
  const nameById = Object.fromEntries(services.map((s) => [String(s._id), s.name]));

  return {
    days: buckets,
    counts: buckets.map((b) => counts[b]),
    outages: incidents.map((i) => ({
      service: nameById[String(i.service)] || 'unknown',
      startedAt: i.startedAt,
      resolvedAt: i.resolvedAt,
      durationHours: i.durationHours,
      status: i.status,
    })),
  };
}

/** IST day buckets covered by a time range (inclusive). */
function dayRange(from, to) {
  const out = [];
  let t = new Date(from);
  while (t <= to) {
    const b = dayBucket(t);
    if (!out.includes(b)) out.push(b);
    t = new Date(t.getTime() + 6 * 3600000); // 6h steps safely catch each day
  }
  const lastB = dayBucket(to);
  if (!out.includes(lastB)) out.push(lastB);
  return out;
}

async function departmentForCategory(category) {
  const { departments } = require('../grievance/classifier');
  for (const d of departments()) {
    if (d.categories.includes(category)) return d.name;
  }
  return 'Public Grievances Commission';
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { run, timeline, evaluatePair };
