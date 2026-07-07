/**
 * SIMULATE_CHECKS mode: produces realistic probe results with NO network
 * traffic. Used for demos, development on restricted networks, and automated
 * verification. Behaviour per service is deterministic-ish (seeded by URL
 * hash) so the dashboard looks stable across cycles:
 *   - most services: operational, latency 150-1500ms
 *   - a few slow ones: latency near/over the degraded threshold
 *   - one or two: hard down (to exercise incidents/alerts end-to-end)
 */
const config = require('../../config');

/** Cheap stable hash of a string -> [0,1). */
function hash01(str, salt = 0) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

function simulateProbe(service) {
  const base = hash01(service.url);
  const jitter = Math.random();

  // ~4% of services are "down" in demo mode; another ~7% are slow.
  const DOWN_BAND = 0.04;
  const SLOW_BAND = 0.11;

  if (base < DOWN_BAND) {
    // Occasionally flap back up so recoveries are demonstrated too.
    if (jitter > 0.9) {
      return okResult(800 + jitter * 1200);
    }
    return {
      ok: false,
      httpStatus: jitter > 0.5 ? 503 : undefined,
      latencyMs: Math.round(config.monitor.timeoutMs * (0.7 + jitter * 0.3)),
      error: jitter > 0.5 ? 'HTTP 503' : `timeout after ${config.monitor.timeoutMs}ms`,
    };
  }
  if (base < SLOW_BAND) {
    return okResult(config.monitor.degradedLatencyMs * (0.8 + jitter * 0.8));
  }
  // Healthy: log-ish latency distribution 120ms - 1.8s
  return okResult(120 + Math.pow(jitter, 2) * 1700);
}

function okResult(latencyMs) {
  return { ok: true, httpStatus: 200, latencyMs: Math.round(latencyMs), error: '' };
}

/** Simulated certificate: expires 40-400 days out, seeded per URL. */
function simulateCert(service) {
  const days = Math.round(40 + hash01(service.url, 7) * 360);
  return {
    validTo: new Date(Date.now() + days * 86400000),
    issuer: 'Simulated CA (demo mode)',
  };
}

module.exports = { simulateProbe, simulateCert };
