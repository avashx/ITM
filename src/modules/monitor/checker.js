/**
 * Low-level HTTP(S) probe. Uses node's http/https directly (no fetch) so we
 * can measure latency precisely, read the TLS certificate off the socket, and
 * keep full control of timeouts and redirects.
 *
 * Politeness rules:
 *  - HEAD-like minimal GET (we abort the body early), honest User-Agent
 *  - hard timeout (CHECK_TIMEOUT_MS)
 *  - max 3 redirects followed
 *  - at most ONE follow-up request, and only when the strict attempt failed
 *    in a way browsers tolerate (see below) - never extra traffic to healthy
 *    or hard-down sites
 *
 * "Alive but unhealthy" detection: two failure modes that look like outages
 * to a strict client are NOT outages for citizens using browsers, so they are
 * re-checked once and reported as ok + `warning` (the scheduler renders them
 * as DEGRADED, not DOWN):
 *  1. Incomplete certificate chain ("unable to verify the first certificate")
 *     - browsers fetch missing intermediates via AIA; Node does not.
 *  2. Response slower than CHECK_TIMEOUT_MS - browsers wait far longer, so a
 *     single retry runs with a 2.5x budget to distinguish "very slow" from
 *     "dead".
 * Expired certificates and hostname mismatches stay hard failures: browsers
 * block those too.
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');
const config = require('../../config');

const MAX_REDIRECTS = 3;
// Chain errors browsers tolerate (they fetch intermediates; Node doesn't)
const CHAIN_ERROR_RE = /unable to verify the first certificate|unable to get (local )?issuer certificate/i;

/**
 * Probe a URL once (plus at most one tolerant follow-up, see header comment).
 * @returns {Promise<{ok:boolean, httpStatus?:number, latencyMs:number,
 *                    error:string, warning?:string,
 *                    cert?:{validTo:Date, issuer:string}}>}
 */
async function probe(url, { acceptableStatuses = [], wantCert = false } = {}) {
  let startedAt = process.hrtime.bigint();
  let result = await request(url, wantCert, 0, {});
  let latencyMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
  let warning = '';

  if (result.error && CHAIN_ERROR_RE.test(result.error)) {
    // Site likely serves fine in browsers; confirm reachability without chain
    // verification and downgrade the outage to a misconfiguration warning.
    startedAt = process.hrtime.bigint();
    const relaxed = await request(url, wantCert, 0, { insecureTls: true });
    if (!relaxed.error) {
      latencyMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
      result = relaxed;
      warning = 'TLS misconfigured: incomplete certificate chain (site loads in browsers)';
    }
  } else if (result.error && result.error.startsWith('timeout')) {
    // Browsers wait much longer than our polite timeout; one slow retry tells
    // "very slow" apart from "dead".
    const slowBudget = Math.round(config.monitor.timeoutMs * 2.5);
    startedAt = process.hrtime.bigint();
    const slow = await request(url, wantCert, 0, { timeoutMs: slowBudget });
    if (!slow.error) {
      latencyMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
      result = slow;
      warning = `very slow: responded in ${(latencyMs / 1000).toFixed(1)}s (over the ${config.monitor.timeoutMs / 1000}s budget)`;
    }
  }

  if (result.error) {
    return { ok: false, latencyMs, error: result.error, httpStatus: result.status };
  }
  const ok = isAcceptable(result.status, acceptableStatuses);
  return {
    ok,
    httpStatus: result.status,
    latencyMs,
    error: ok ? '' : `HTTP ${result.status}`,
    warning: ok ? warning : '',
    cert: result.cert,
  };
}

/** 2xx/3xx are UP by default; per-endpoint overrides may whitelist others. */
function isAcceptable(status, acceptableStatuses) {
  if (acceptableStatuses && acceptableStatuses.includes(status)) return true;
  return status >= 200 && status < 400;
}

function request(url, wantCert, redirectCount, { insecureTls = false, timeoutMs } = {}) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return resolve({ error: 'invalid URL' });
    }
    const budget = timeoutMs || config.monitor.timeoutMs;
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request(
      target,
      {
        method: 'GET',
        timeout: budget,
        headers: {
          'User-Agent': config.monitor.userAgent,
          Accept: 'text/html,*/*',
          Connection: 'close',
        },
        // Strict by default: expired/mismatched TLS is a real citizen-facing
        // failure. `insecureTls` is only used by probe()'s single follow-up to
        // confirm an incomplete-chain site is actually serving.
        rejectUnauthorized: !insecureTls,
      },
      (res) => {
        let cert;
        if (wantCert && res.socket.getPeerCertificate) {
          const raw = res.socket.getPeerCertificate();
          if (raw && raw.valid_to) {
            cert = {
              validTo: new Date(raw.valid_to),
              issuer: raw.issuer ? raw.issuer.O || raw.issuer.CN || '' : '',
            };
          }
        }
        // Follow same-origin-ish redirects a few hops (govt portals love them)
        if (
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location &&
          redirectCount < MAX_REDIRECTS
        ) {
          res.destroy();
          const next = new URL(res.headers.location, target).toString();
          return resolve(request(next, wantCert, redirectCount + 1, { insecureTls, timeoutMs }));
        }
        // We only need the status line - abort the body to save bandwidth.
        res.destroy();
        resolve({ status: res.statusCode, cert });
      }
    );
    req.on('timeout', () => {
      req.destroy(new Error('timeout'));
    });
    req.on('error', (err) => {
      resolve({ error: shortError(err, budget) });
    });
    req.end();
  });
}

/** Normalise node network errors into short, dashboard-friendly strings. */
function shortError(err, budget = config.monitor.timeoutMs) {
  const msg = err.message || String(err);
  if (msg.includes('timeout')) return `timeout after ${budget}ms`;
  if (err.code === 'ENOTFOUND') return 'DNS lookup failed';
  if (err.code === 'ECONNREFUSED') return 'connection refused';
  if (err.code === 'ECONNRESET') return 'connection reset';
  if (err.code === 'CERT_HAS_EXPIRED') return 'TLS certificate expired';
  if (msg.includes('certificate')) return `TLS error: ${msg.slice(0, 120)}`;
  return msg.slice(0, 160);
}

module.exports = { probe, isAcceptable };
