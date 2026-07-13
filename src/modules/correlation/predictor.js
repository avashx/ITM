/**
 * Surge predictor (Module 3, proactive half).
 *
 * While an outage is OPEN we forecast the complaint surge it is likely to
 * cause, using the historical "elasticity" learned by the correlation engine:
 * the mean spikeRatio of past insights for the same service+category (falling
 * back to the service-wide, then global mean). Departments get a proactive
 * alert so they can staff helpdesks / pre-draft responses BEFORE complaints
 * arrive - this is the platform's headline capability.
 */
const config = require('../../config');
const {
  Incident,
  ServiceEndpoint,
  Grievance,
  CorrelationInsight,
  Alert,
} = require('../../models');
const { raiseAlert } = require('../monitor/incidents');
const { alertTemplate } = require('../../services/mailer');
const { dayBucket, addDays, hoursBetween } = require('../../utils/dates');
const log = require('../../utils/logger')('predictor');

// Only predict for outages that have lasted at least this long.
const MIN_OPEN_HOURS = 1;
// Default assumed elasticity when no history exists yet (+25% complaints).
const DEFAULT_RATIO = 1.25;

/**
 * Produce predictions for all currently-open incidents.
 * @param {{notify:boolean}} opts when notify=true, raise surge_prediction
 *        alerts (email+socket), at most one per incident per 12h.
 */
async function predictOpenOutages({ notify = false } = {}) {
  const open = await Incident.find({ status: 'open' }).populate('service');
  const predictions = [];

  // Batch the lookups once per call instead of per incident x category:
  // with N open incidents this is 2 queries total rather than ~3N, which is
  // the difference between ~0.5s and ~8s against a remote Atlas cluster.
  const categories = [
    ...new Set(
      open.flatMap((i) => (i.service && i.service.relatedGrievanceCategories) || [])
    ),
  ];
  const [allInsights, baselineByCategory] = await Promise.all([
    CorrelationInsight.find({}).select('service category spikeRatio').lean(),
    baselineDailyByCategory(categories),
  ]);

  for (const incident of open) {
    const service = incident.service;
    if (!service) continue;
    const openHours = hoursBetween(incident.startedAt, new Date());
    if (openHours < MIN_OPEN_HOURS) continue;

    for (const category of service.relatedGrievanceCategories || []) {
      const ratio = learnedRatio(allInsights, service._id, category);
      const baseline = baselineByCategory[category] || 0;
      if (baseline <= 0) continue;

      const extraPerDay = Math.round(baseline * (ratio - 1));
      if (extraPerDay < 1) continue;

      const prediction = {
        incidentId: incident._id,
        serviceId: service._id,
        serviceName: service.name,
        serviceUrl: service.url,
        department: service.department,
        category,
        outageOpenHours: openHours,
        baselineDaily: Math.round(baseline * 10) / 10,
        predictedRatio: Math.round(ratio * 100) / 100,
        predictedExtraPerDay: extraPerDay,
        message:
          `${service.name} has been down ${openHours}h. Based on past outages, expect ` +
          `~${extraPerDay} extra "${category}" complaint(s)/day (+${Math.round((ratio - 1) * 100)}%) ` +
          `over the next ${Math.round(config.correlation.windowHours / 24)} day(s).`,
      };
      predictions.push(prediction);

      if (notify) await maybeNotify(incident, service, prediction);
    }
  }
  return predictions;
}

/** Elasticity from past insights (in-memory over one pre-fetched list):
 * service+category -> service -> global -> default. */
function learnedRatio(allInsights, serviceId, category) {
  const sid = String(serviceId);
  const scoped = allInsights.filter(
    (i) => String(i.service) === sid && i.category === category
  );
  if (scoped.length) return mean(scoped.map((i) => i.spikeRatio));
  const byService = allInsights.filter((i) => String(i.service) === sid);
  if (byService.length) return mean(byService.map((i) => i.spikeRatio));
  return allInsights.length
    ? mean(allInsights.map((i) => i.spikeRatio))
    : DEFAULT_RATIO;
}

/** Trailing-28-day mean daily volume for each category, in one query. */
async function baselineDailyByCategory(categories) {
  if (!categories.length) return {};
  const from = dayBucket(addDays(new Date(), -config.correlation.baselineDays));
  const docs = await Grievance.find({
    category: { $in: categories },
    dayBucket: { $gte: from },
  })
    .select('category')
    .lean();
  const counts = {};
  for (const d of docs) counts[d.category] = (counts[d.category] || 0) + 1;
  const out = {};
  for (const c of categories) out[c] = (counts[c] || 0) / config.correlation.baselineDays;
  return out;
}

/** Raise at most one surge alert per incident per 12 hours. */
async function maybeNotify(incident, service, p) {
  const recent = await Alert.findOne({
    type: 'surge_prediction',
    incident: incident._id,
    createdAt: { $gte: new Date(Date.now() - 12 * 3600000) },
  });
  if (recent) return;

  await raiseAlert({
    type: 'surge_prediction',
    severity: 'warning',
    title: `Complaint surge expected: ${p.category}`,
    message: p.message,
    service,
    incident,
    department: p.department,
    emailSubject: `Surge predicted: ${p.category} (${service.name} outage)`,
    emailHtml: alertTemplate({
      heading: 'Proactive alert: complaint surge predicted',
      color: '#8e44ad',
      lines: [
        ['Service down', `${service.name} (${p.outageOpenHours}h)`],
        ['Affected category', p.category],
        ['Baseline volume', `${p.baselineDaily}/day`],
        ['Predicted increase', `+${p.predictedExtraPerDay}/day (x${p.predictedRatio})`],
        ['Recommended action', 'Pre-position helpdesk staff; publish a status notice on the portal'],
      ],
    }),
  });
  log.info(`surge alert raised: ${p.message}`);
}

function mean(arr) {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

module.exports = { predictOpenOutages };
