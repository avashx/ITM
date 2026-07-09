/**
 * Monitor scheduler (Module 1 core loop).
 *
 * Every CHECK_CRON tick (default: every 5 minutes):
 *   1. load enabled endpoints due for a check (exponential backoff can push
 *      a repeatedly-failing endpoint's nextCheckAt into the future)
 *   2. probe them in small concurrent batches (CHECK_CONCURRENCY) so we never
 *      hammer government infrastructure
 *   3. persist CheckResult, upsert the DailyUptime rollup, update live state
 *   4. drive the incident state machine (open after FAIL_THRESHOLD
 *      consecutive fails, resolve on recovery) and emit socket events
 *
 * Once per day per endpoint the TLS certificate expiry is refreshed.
 * A daily janitor prunes raw CheckResults past retention (portable fallback
 * for engines that don't enforce TTL indexes).
 */
const cron = require('node-cron');
const config = require('../../config');
const { ServiceEndpoint, CheckResult, DailyUptime } = require('../../models');
const { probe } = require('./checker');
const { simulateProbe, simulateCert } = require('./simulator');
const incidents = require('./incidents');
const socket = require('../../services/socket');
const { dayBucket } = require('../../utils/dates');
const log = require('../../utils/logger')('monitor');

// Backoff ladder for consecutively failing services: stay at 5-min checks for
// the first few fails (so incidents open promptly), then poll less often.
const BACKOFF_MINUTES = [0, 0, 0, 0, 10, 15, 30, 30, 60];

let running = false;
let cronTask = null;
let janitorTask = null;

async function runCycle() {
  if (running) {
    log.warn('previous cycle still running - skipping this tick');
    return;
  }
  running = true;
  const startedAt = Date.now();
  try {
    const now = new Date();
    const due = await ServiceEndpoint.find({
      enabled: true,
      'state.nextCheckAt': { $lte: now },
    }).sort({ 'state.lastCheckAt': 1 });

    let up = 0;
    let down = 0;
    for (let i = 0; i < due.length; i += config.monitor.concurrency) {
      const batch = due.slice(i, i + config.monitor.concurrency);
      const results = await Promise.all(batch.map((svc) => checkOne(svc)));
      for (const r of results) r.ok ? up++ : down++;
    }

    const tookMs = Date.now() - startedAt;
    log.info(`cycle done: ${due.length} checked (${up} up, ${down} down) in ${tookMs}ms`);
    socket.emit('monitor:cycle', {
      at: new Date(),
      checked: due.length,
      up,
      down,
      tookMs,
      simulated: config.monitor.simulate,
    });
  } catch (err) {
    log.error(`cycle failed: ${err.message}`, err);
  } finally {
    running = false;
  }
}

/** Probe one service and persist every consequence of the result. */
async function checkOne(service) {
  const needsSslRefresh =
    service.checkSsl &&
    service.url.startsWith('https:') &&
    (!service.state.ssl.checkedAt ||
      Date.now() - service.state.ssl.checkedAt.getTime() > 86400000);

  const result = config.monitor.simulate
    ? simulateProbe(service)
    : await probe(service.url, {
        acceptableStatuses: service.acceptableStatuses,
        wantCert: needsSslRefresh,
      });

  const mode = config.monitor.simulate ? 'simulated' : 'live';
  const now = new Date();

  await CheckResult.create({
    service: service._id,
    checkedAt: now,
    ok: result.ok,
    httpStatus: result.httpStatus,
    latencyMs: result.latencyMs,
    error: result.error || result.warning || '',
    mode,
  });
  await upsertRollup(service._id, now, result);

  // --- update live state ---
  const prevStatus = service.state.status;
  service.state.lastCheckAt = now;
  service.state.lastLatencyMs = result.latencyMs;
  service.state.lastHttpStatus = result.httpStatus;
  service.state.lastError = result.error || '';

  if (result.ok) {
    service.state.lastUpAt = now;
    service.state.consecutiveFails = 0;
    service.state.nextCheckAt = new Date(0); // back to normal cadence
    // A warning ("alive but unhealthy": broken cert chain / very slow) keeps
    // the reason visible on the dashboard while ranking below a real outage.
    service.state.status =
      result.warning || result.latencyMs >= config.monitor.degradedLatencyMs
        ? 'degraded'
        : 'operational';
    service.state.lastError = result.warning || '';
  } else {
    service.state.consecutiveFails += 1;
    const backoffIdx = Math.min(service.state.consecutiveFails, BACKOFF_MINUTES.length - 1);
    const backoffMin = BACKOFF_MINUTES[backoffIdx];
    service.state.nextCheckAt = backoffMin
      ? new Date(now.getTime() + backoffMin * 60000)
      : new Date(0);
    if (service.state.consecutiveFails >= config.monitor.failThreshold) {
      service.state.status = 'down';
    }
    // Below threshold we keep the previous public status (avoids flapping the
    // status page on a single blip) - the fail counter does the bookkeeping.
  }

  // SSL bookkeeping (live cert from probe, or simulated cert in demo mode)
  if (needsSslRefresh) {
    const cert = config.monitor.simulate ? simulateCert(service) : result.cert;
    if (cert && cert.validTo) {
      service.state.ssl = {
        validTo: cert.validTo,
        issuer: cert.issuer || '',
        daysRemaining: Math.floor((cert.validTo - now) / 86400000),
        checkedAt: now,
        error: '',
      };
    } else if (!config.monitor.simulate && result.error && /TLS|certificate/i.test(result.error)) {
      service.state.ssl.error = result.error;
      service.state.ssl.checkedAt = now;
    }
  }

  await service.save();

  // --- incident state machine + notifications ---
  if (!result.ok && service.state.consecutiveFails === config.monitor.failThreshold) {
    await incidents.openIncident(service, result);
  } else if (result.ok && prevStatus === 'down') {
    await incidents.resolveIncident(service);
  }
  if (service.checkSsl) await incidents.checkSslExpiry(service);

  socket.emit('check:result', {
    serviceId: service._id,
    name: service.name,
    ok: result.ok,
    httpStatus: result.httpStatus,
    latencyMs: result.latencyMs,
    error: result.error,
    status: service.state.status,
    checkedAt: now,
    mode,
  });
  if (prevStatus !== service.state.status) {
    socket.emit('service:status_change', {
      serviceId: service._id,
      name: service.name,
      from: prevStatus,
      to: service.state.status,
      at: now,
    });
  }
  return result;
}

/** Incremental per-day rollup so uptime stats never scan raw checks. */
async function upsertRollup(serviceId, when, result) {
  const inc = {
    checks: 1,
    ups: result.ok ? 1 : 0,
    fails: result.ok ? 0 : 1,
    latencySumMs: result.ok ? result.latencyMs || 0 : 0,
    // Each failed 5-min check approximates 5 minutes of downtime
    downtimeMinutes: result.ok ? 0 : 5,
  };
  const day = dayBucket(when);
  await DailyUptime.updateOne(
    { service: serviceId, day },
    { $inc: inc, $max: { latencyMaxMs: result.ok ? result.latencyMs || 0 : 0 } },
    { upsert: true }
  );
}

/** Prune raw checks past retention (fallback where TTL isn't enforced). */
async function pruneOldChecks() {
  const cutoff = new Date(Date.now() - config.monitor.retentionDays * 86400000);
  const { deletedCount } = await CheckResult.deleteMany({ checkedAt: { $lt: cutoff } });
  if (deletedCount) log.info(`janitor: pruned ${deletedCount} old check results`);
}

function start() {
  if (!config.monitor.enabled) {
    log.warn('MONITOR_ENABLED=false - scheduler not started');
    return;
  }
  cronTask = cron.schedule(config.monitor.cron, runCycle, {
    timezone: config.timezone,
  });
  janitorTask = cron.schedule('45 3 * * *', pruneOldChecks, {
    timezone: config.timezone,
  });
  log.info(
    `scheduler started (cron="${config.monitor.cron}", simulate=${config.monitor.simulate})`
  );
  // Kick off an immediate first cycle so the dashboard isn't empty on boot.
  setTimeout(runCycle, 2500);
}

function stop() {
  if (cronTask) cronTask.stop();
  if (janitorTask) janitorTask.stop();
}

module.exports = { start, stop, runCycle };
