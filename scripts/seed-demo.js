/**
 * Full demo seed - one command to a living platform:
 *
 *   1. seeds the researched endpoint catalogue (data/endpoints.json)
 *   2. fabricates 90 days of uptime rollups + 6h of raw checks (mode='seeded')
 *   3. injects three resolved outage scenarios AND matching complaint spikes,
 *      so the Module 3 correlation engine has real patterns to find:
 *        A. e-District down 6h (21 days ago)  -> certificate complaints spike
 *        B. DJB portal down 9h (14 days ago)  -> water-billing complaints spike
 *        C. MCD portal down 5h  (7 days ago)  -> property-tax/B&D cert spike
 *      plus one OPEN incident (NFS ration portal) for the surge predictor
 *   4. seeds ~90 days of synthetic grievances (source='synthetic')
 *   5. runs the correlation engine and prints discovered insights
 *
 * Usage: node scripts/seed-demo.js [--days 90] [--scale 0.5] [--seed 42]
 * WARNING: replaces existing monitor history and synthetic grievances.
 */
const path = require('path');
const fs = require('fs');
const db = require('../src/config/db');
const {
  ServiceEndpoint,
  CheckResult,
  DailyUptime,
  Incident,
  Alert,
  Grievance,
  CorrelationInsight,
} = require('../src/models');
const { generate } = require('./lib/grievance-generator');
const { makeRng } = require('./lib/rng');
const engine = require('../src/modules/correlation/engine');
const predictor = require('../src/modules/correlation/predictor');
const { dayBucket } = require('../src/utils/dates');
const log = require('../src/utils/logger')('seed-demo');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// Outage scenarios: {url-match, daysAgo, startHour(IST-ish local), hours,
// spikes:[{category, multiplier, days}]}
const SCENARIOS = [
  {
    match: 'edistrict.delhigovt.nic.in',
    daysAgo: 21,
    startHour: 9,
    hours: 6.2,
    error: 'HTTP 503',
    spikes: [
      { category: 'Certificates (e-District)', multiplier: 1.55, days: 2 },
      { category: 'Portal & e-Service Issues', multiplier: 1.8, days: 2 },
    ],
  },
  {
    match: 'djb.gov.in',
    daysAgo: 14,
    startHour: 7,
    hours: 9.0,
    error: 'timeout after 10000ms',
    spikes: [
      { category: 'Water Billing', multiplier: 1.5, days: 2 },
      { category: 'Portal & e-Service Issues', multiplier: 1.35, days: 2 },
    ],
  },
  {
    match: 'mcdonline.nic.in/',
    daysAgo: 7,
    startHour: 11,
    hours: 5.5,
    error: 'connection reset',
    spikes: [
      { category: 'Property Tax', multiplier: 1.5, days: 2 },
      { category: 'Birth & Death Certificates', multiplier: 1.45, days: 2 },
    ],
  },
];
// Currently-open outage for the surge predictor demo
const OPEN_OUTAGE = { match: 'nfs.delhigovt.nic.in', hoursAgo: 4.5, error: 'HTTP 502' };

async function main() {
  await db.connect();
  const rng = makeRng(parseInt(arg('seed', '20260707'), 10) + 99);
  const days = parseInt(arg('days', '90'), 10);

  log.info('resetting monitor history, synthetic grievances and insights...');
  await Promise.all([
    ServiceEndpoint.deleteMany({}),
    CheckResult.deleteMany({}),
    DailyUptime.deleteMany({}),
    Incident.deleteMany({}),
    Alert.deleteMany({}),
    Grievance.deleteMany({ source: 'synthetic' }),
    CorrelationInsight.deleteMany({}),
  ]);

  // ---- 1. endpoint catalogue ----
  const { endpoints } = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../data/endpoints.json'), 'utf8')
  );
  const services = await ServiceEndpoint.insertMany(
    endpoints.map((e) => ({
      name: e.name,
      url: e.url,
      department: e.department,
      category: e.category,
      description: e.description || '',
      relatedGrievanceCategories: e.relatedGrievanceCategories || [],
      acceptableStatuses: e.acceptableStatuses || [],
      checkSsl: e.url.startsWith('https:'),
      verification: {
        method: e.verification?.method || '',
        verifiedAt: e.verification?.verifiedAt ? new Date(e.verification.verifiedAt) : undefined,
        note: e.verification?.note || '',
      },
    }))
  );
  log.info(`seeded ${services.length} service endpoints`);

  const now = new Date();
  const findSvc = (m) => services.find((s) => s.url.includes(m));

  // ---- 2. ninety days of DailyUptime rollups ----
  const CHECKS_PER_DAY = 288; // every 5 minutes
  const rollups = [];
  for (const svc of services) {
    const scenario = SCENARIOS.find((sc) => svc.url.includes(sc.match));
    for (let offset = days - 1; offset >= 0; offset--) {
      const d = new Date(now.getTime() - offset * 86400000);
      const day = dayBucket(d);
      // healthy baseline: 99.3-100% up, rare noisy days
      let fails = rng.random() < 0.06 ? rng.int(1, 4) : 0;
      if (scenario && offset === scenario.daysAgo) {
        fails = Math.round(scenario.hours * 12); // outage day
      }
      const isToday = offset === 0;
      const checksSoFar = isToday
        ? Math.max(24, Math.floor((CHECKS_PER_DAY * d.getHours()) / 24))
        : CHECKS_PER_DAY;
      fails = Math.min(fails, checksSoFar);
      const ups = checksSoFar - fails;
      const avgLat = 250 + rng.random() * 900;
      rollups.push({
        service: svc._id,
        day,
        checks: checksSoFar,
        ups,
        fails,
        latencySumMs: Math.round(ups * avgLat),
        latencyMaxMs: Math.round(avgLat * (2 + rng.random() * 3)),
        downtimeMinutes: fails * 5,
      });
    }
  }
  for (let i = 0; i < rollups.length; i += 2000) {
    await DailyUptime.insertMany(rollups.slice(i, i + 2000), { ordered: false });
  }
  log.info(`seeded ${rollups.length} daily uptime rollups`);

  // ---- 3. raw checks for the last 6 hours (charts + live feel) ----
  const openSvc = findSvc(OPEN_OUTAGE.match);
  const checks = [];
  for (const svc of services) {
    const baseLat = 200 + rng.random() * 800;
    for (let m = 6 * 60; m >= 0; m -= 5) {
      const at = new Date(now.getTime() - m * 60000);
      const isOpenOutage =
        openSvc &&
        String(svc._id) === String(openSvc._id) &&
        m <= OPEN_OUTAGE.hoursAgo * 60;
      checks.push({
        service: svc._id,
        checkedAt: at,
        ok: !isOpenOutage,
        httpStatus: isOpenOutage ? 502 : 200,
        latencyMs: isOpenOutage
          ? 10000
          : Math.round(baseLat * (0.8 + rng.random() * 0.6)),
        error: isOpenOutage ? OPEN_OUTAGE.error : '',
        mode: 'seeded',
      });
    }
  }
  for (let i = 0; i < checks.length; i += 2000) {
    await CheckResult.insertMany(checks.slice(i, i + 2000), { ordered: false });
  }
  log.info(`seeded ${checks.length} raw checks (last 6h)`);

  // ---- 4. live state on every service ----
  for (const svc of services) {
    const isDown = openSvc && String(svc._id) === String(openSvc._id);
    svc.state = {
      status: isDown ? 'down' : 'operational',
      lastCheckAt: now,
      lastUpAt: isDown ? new Date(now.getTime() - OPEN_OUTAGE.hoursAgo * 3600000) : now,
      lastLatencyMs: isDown ? 10000 : Math.round(200 + rng.random() * 900),
      lastHttpStatus: isDown ? 502 : 200,
      lastError: isDown ? OPEN_OUTAGE.error : '',
      consecutiveFails: isDown ? Math.round(OPEN_OUTAGE.hoursAgo * 12) : 0,
      nextCheckAt: new Date(0),
      ssl: svc.url.startsWith('https:')
        ? {
            validTo: new Date(now.getTime() + rng.int(25, 360) * 86400000),
            issuer: rng.pick(['DigiCert Inc', "Let's Encrypt", 'Sectigo Limited', 'GlobalSign']),
            checkedAt: now,
            error: '',
          }
        : {},
    };
    if (svc.state.ssl.validTo) {
      svc.state.ssl.daysRemaining = Math.floor((svc.state.ssl.validTo - now) / 86400000);
    }
    await svc.save();
  }
  log.info('set live state on all services');

  // ---- 5. incidents: three resolved scenarios + one open ----
  for (const sc of SCENARIOS) {
    const svc = findSvc(sc.match);
    if (!svc) continue;
    const start = new Date(now.getTime() - sc.daysAgo * 86400000);
    start.setHours(sc.startHour, rng.int(0, 40), 0, 0);
    const end = new Date(start.getTime() + sc.hours * 3600000);
    await Incident.create({
      service: svc._id,
      status: 'resolved',
      severity: 'down',
      startedAt: start,
      resolvedAt: end,
      durationHours: Math.round(sc.hours * 10) / 10,
      failedChecks: Math.round(sc.hours * 12),
      lastError: sc.error,
      note: 'seeded demo scenario',
    });
    log.info(`incident: ${svc.name} down ${sc.hours}h on ${dayBucket(start)}`);
  }
  if (openSvc) {
    const started = new Date(now.getTime() - OPEN_OUTAGE.hoursAgo * 3600000);
    const inc = await Incident.create({
      service: openSvc._id,
      status: 'open',
      severity: 'down',
      startedAt: started,
      failedChecks: Math.round(OPEN_OUTAGE.hoursAgo * 12),
      lastError: OPEN_OUTAGE.error,
      note: 'seeded demo scenario (open)',
    });
    await Alert.create({
      type: 'outage',
      severity: 'critical',
      title: `${openSvc.name} is DOWN`,
      message: `${openSvc.name} (${openSvc.url}) failing since ${started.toISOString()} - ${OPEN_OUTAGE.error}`,
      service: openSvc._id,
      incident: inc._id,
      department: openSvc.department,
    });
    log.info(`OPEN incident: ${openSvc.name} down for ${OPEN_OUTAGE.hoursAgo}h (predictor demo)`);
  }

  // ---- 6. synthetic grievances with outage-aligned spikes ----
  const spikes = [];
  for (const sc of SCENARIOS) {
    for (const s of sc.spikes) {
      spikes.push({
        category: s.category,
        fromDayOffset: sc.daysAgo,
        days: s.days,
        multiplier: s.multiplier,
      });
    }
  }
  const { docs, agreement } = generate({
    days,
    scale: parseFloat(arg('scale', '0.5')),
    seed: parseInt(arg('seed', '20260707'), 10),
    spikes,
  });
  for (let i = 0; i < docs.length; i += 1000) {
    await Grievance.insertMany(docs.slice(i, i + 1000), { ordered: false });
  }
  log.info(`seeded ${docs.length} synthetic grievances (classifier agreement ${agreement}%)`);

  // ---- 7. correlation engine + predictor over the seeded world ----
  const insights = await engine.run({ lookbackDays: days });
  for (const i of insights) log.info(`INSIGHT: ${i.narrative}`);
  const predictions = await predictor.predictOpenOutages({ notify: false });
  for (const p of predictions) log.info(`PREDICTION: ${p.message}`);

  log.info('demo seed complete. start the server with: npm start');
  await db.disconnect();
}

main().catch((err) => {
  log.error(err.message, err);
  process.exit(1);
});
