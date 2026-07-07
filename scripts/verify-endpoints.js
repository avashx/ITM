/**
 * One-shot reachability check of every endpoint in data/endpoints.json.
 * Run this from any machine with normal internet access to re-verify the
 * researched catalogue (the monitor itself re-verifies continuously once
 * running). Requires NO database.
 *
 * Usage:
 *   node scripts/verify-endpoints.js            # print report
 *   node scripts/verify-endpoints.js --json     # machine-readable output
 *   node scripts/verify-endpoints.js --update   # also stamp results into MongoDB
 *
 * Probes run 5 at a time with the same polite User-Agent and timeout the
 * live monitor uses.
 */
const path = require('path');
const fs = require('fs');
const { probe } = require('../src/modules/monitor/checker');
const log = require('../src/utils/logger')('verify');

const CONCURRENCY = 5;

async function main() {
  const { endpoints } = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../data/endpoints.json'), 'utf8')
  );
  const results = [];

  for (let i = 0; i < endpoints.length; i += CONCURRENCY) {
    const batch = endpoints.slice(i, i + CONCURRENCY);
    const probed = await Promise.all(
      batch.map(async (e) => {
        const r = await probe(e.url, { acceptableStatuses: e.acceptableStatuses || [] });
        return { ...e, result: r };
      })
    );
    for (const p of probed) {
      results.push(p);
      if (!process.argv.includes('--json')) {
        const mark = p.result.ok ? 'UP  ' : 'DOWN';
        // eslint-disable-next-line no-console
        console.log(
          `${mark}  ${String(p.result.httpStatus || '-').padStart(3)}  ${String(
            p.result.latencyMs
          ).padStart(6)}ms  ${p.url}${p.result.error ? `  (${p.result.error})` : ''}`
        );
      }
    }
  }

  const up = results.filter((r) => r.result.ok).length;
  if (process.argv.includes('--json')) {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        results.map((r) => ({
          name: r.name,
          url: r.url,
          ok: r.result.ok,
          httpStatus: r.result.httpStatus,
          latencyMs: r.result.latencyMs,
          error: r.result.error,
        })),
        null,
        2
      )
    );
  } else {
    // eslint-disable-next-line no-console
    console.log(`\n${up}/${results.length} endpoints responded OK`);
    const bounced = results.filter((r) => !r.result.ok && r.result.httpStatus);
    if (bounced.length) {
      // eslint-disable-next-line no-console
      console.log(
        `note: ${bounced.length} answered with a blocking/unexpected HTTP status - a server ` +
          `that responds is not "dead"; consider acceptableStatuses overrides in data/endpoints.json`
      );
    }
  }

  if (process.argv.includes('--update')) {
    const db = require('../src/config/db');
    const { ServiceEndpoint } = require('../src/models');
    await db.connect();
    for (const r of results) {
      await ServiceEndpoint.updateOne(
        { url: r.url },
        {
          $set: {
            verification: {
              method: 'http',
              verifiedAt: new Date(),
              note: r.result.ok
                ? `HTTP ${r.result.httpStatus} in ${r.result.latencyMs}ms`
                : r.result.error,
            },
          },
        }
      );
    }
    await db.disconnect();
    log.info('verification stamps written to MongoDB');
  }
}

main().catch((err) => {
  log.error(err.message, err);
  process.exit(1);
});
