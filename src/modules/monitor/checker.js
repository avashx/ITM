/**
 * Low-level HTTP(S) probe. Uses node's http/https directly (no fetch) so we
 * can measure latency precisely, read the TLS certificate off the socket, and
 * keep full control of timeouts and redirects.
 *
 * Politeness rules:
 *  - HEAD-like minimal GET (we abort the body early), honest User-Agent
 *  - hard timeout (CHECK_TIMEOUT_MS)
 *  - max 3 redirects followed
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');
const config = require('../../config');

const MAX_REDIRECTS = 3;

/**
 * Probe a URL once.
 * @returns {Promise<{ok:boolean, httpStatus?:number, latencyMs:number,
 *                    error:string, cert?:{validTo:Date, issuer:string}}>}
 */
async function probe(url, { acceptableStatuses = [], wantCert = false } = {}) {
  const startedAt = process.hrtime.bigint();
  const result = await request(url, wantCert, 0);
  const latencyMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);

  if (result.error) {
    return { ok: false, latencyMs, error: result.error, httpStatus: result.status };
  }
  const ok = isAcceptable(result.status, acceptableStatuses);
  return {
    ok,
    httpStatus: result.status,
    latencyMs,
    error: ok ? '' : `HTTP ${result.status}`,
    cert: result.cert,
  };
}

/** 2xx/3xx are UP by default; per-endpoint overrides may whitelist others. */
function isAcceptable(status, acceptableStatuses) {
  if (acceptableStatuses && acceptableStatuses.includes(status)) return true;
  return status >= 200 && status < 400;
}

function request(url, wantCert, redirectCount) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      return resolve({ error: 'invalid URL' });
    }
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request(
      target,
      {
        method: 'GET',
        timeout: config.monitor.timeoutMs,
        headers: {
          'User-Agent': config.monitor.userAgent,
          Accept: 'text/html,*/*',
          Connection: 'close',
        },
        // We still validate certs; expired/invalid TLS is a real citizen-facing
        // failure and must surface as DOWN, not be silently ignored.
        rejectUnauthorized: true,
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
          return resolve(request(next, wantCert, redirectCount + 1));
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
      resolve({ error: shortError(err) });
    });
    req.end();
  });
}

/** Normalise node network errors into short, dashboard-friendly strings. */
function shortError(err) {
  const msg = err.message || String(err);
  if (msg.includes('timeout')) return `timeout after ${config.monitor.timeoutMs}ms`;
  if (err.code === 'ENOTFOUND') return 'DNS lookup failed';
  if (err.code === 'ECONNREFUSED') return 'connection refused';
  if (err.code === 'ECONNRESET') return 'connection reset';
  if (err.code === 'CERT_HAS_EXPIRED') return 'TLS certificate expired';
  if (msg.includes('certificate')) return `TLS error: ${msg.slice(0, 120)}`;
  return msg.slice(0, 160);
}

module.exports = { probe, isAcceptable };
