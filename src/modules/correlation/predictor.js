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

  for (const incident of open) {
    const service = incident.service;
    if (!service) continue;
    const openHours = hoursBetween(incident.startedAt, new Date());
    if (openHours < MIN_OPEN_HOURS) continue;

    for (const category of service.relatedGrievanceCategories || []) {
      const ratio = await learnedRatio(service._id, category);
      const baseline = await baselineDaily(category);
      if (baseline <= 0) continue;

      const extraPerDay = Math.round(baseline * (ratio - 1));
      if (extraPerDay < 1) continue;

      const prediction = {
        incidentId: incident._id,
        serviceId: service._id,
        serviceName: service.name,
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

/** Elasticity from past insights: service+category -> service -> global. */
async function learnedRatio(serviceId, category) {
  const scoped = await CorrelationInsight.find({ service: serviceId, category })
    .select('spikeRatio')
    .lean();
  if (scoped.length) return mean(scoped.map((i) => i.spikeRatio));
  const byService = await CorrelationInsight.find({ service: serviceId })
    .select('spikeRatio')
    .lean();
  if (byService.length) return mean(byService.map((i) => i.spikeRatio));
  const all = await CorrelationInsight.find({}).select('spikeRatio').lean();
  return all.length ? mean(all.map((i) => i.spikeRatio)) : DEFAULT_RATIO;
}

/** Trailing-28-day mean daily volume for a category. */
async function baselineDaily(category) {
  const from = dayBucket(addDays(new Date(), -config.correlation.baselineDays));
  const count = await Grievance.countDocuments({
    category,
    dayBucket: { $gte: from },
  });
  return count / config.correlation.baselineDays;
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
