#!/usr/bin/env node
/**
 * Build (or refresh) the assistant's vector index.
 *
 *   npm run rag:index              incremental - only re-embeds changed chunks
 *   npm run rag:index -- --force   re-embed everything (after changing model/dims)
 *   npm run rag:index -- --no-records   skip per-grievance chunks (smaller index)
 *   npm run rag:index -- --dry     show what would be embedded, spend nothing
 *
 * Safe to run against production: it only ever writes to the `ragchunks`
 * collection and never touches monitor history or grievances.
 */
const db = require('../src/config/db');
const config = require('../src/config');
const llm = require('../src/services/llm');
const indexer = require('../src/services/rag/indexer');
const { buildCorpus } = require('../src/services/rag/chunker');
const store = require('../src/services/rag/store');
const log = require('../src/utils/logger')('rag:cli');

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

async function main() {
  await db.connect();

  if (has('--dry')) {
    const { chunks, counts } = await buildCorpus({
      includeRecords: !has('--no-records'),
    });
    const byKind = chunks.reduce((a, c) => Object.assign(a, { [c.kind]: (a[c.kind] || 0) + 1 }), {});
    const chars = chunks.reduce((n, c) => n + c.text.length, 0);
    log.info(`DRY RUN - nothing embedded, nothing written.`);
    log.info(`  sources: ${counts.grievances} grievances, ${counts.insights} correlation insights`);
    log.info(`  chunks:  ${chunks.length}`);
    for (const [kind, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
      log.info(`    ${kind.padEnd(10)} ${n}`);
    }
    log.info(`  ~${Math.round(chars / 4).toLocaleString()} tokens to embed`);
    log.info(`  ~$${(Math.round((chars / 4 / 1e6) * 0.02 * 10000) / 10000).toFixed(4)} at text-embedding-3-small rates (full rebuild)`);
    return;
  }

  if (!llm.embeddingsAvailable()) {
    log.error('OPENAI_API_KEY is not set - embeddings are unavailable.');
    log.error('The assistant still works without the index (structured + live lanes),');
    log.error('but semantic search needs a key. Add OPENAI_API_KEY to .env and retry.');
    process.exitCode = 1;
    return;
  }

  log.info(
    `embedding with ${config.rag.embedModel} at ${config.rag.embedDims} dimensions` +
      (has('--force') ? ' (forced full rebuild)' : ' (incremental)')
  );

  let lastPct = -1;
  const summary = await indexer.buildIndex({
    force: has('--force'),
    includeRecords: !has('--no-records'),
    onProgress: ({ done, total }) => {
      const pct = Math.floor((done / total) * 100);
      if (pct >= lastPct + 5) {
        lastPct = pct;
        log.info(`  ${String(pct).padStart(3)}%  ${done}/${total} chunks embedded`);
      }
    },
  });

  const stats = await store.stats();
  log.info('---');
  log.info(`index:    ${stats.chunks} chunks (${summary.embedded} embedded now, ${summary.reused} reused)`);
  for (const [kind, n] of Object.entries(stats.byKind).sort((a, b) => b[1] - a[1])) {
    log.info(`  ${kind.padEnd(10)} ${n}`);
  }
  log.info(`cost:     ~$${summary.approxCostUsd} this run`);
  log.info(`elapsed:  ${Math.round(summary.elapsedMs / 1000)}s`);
  log.info('The assistant will pick the new index up on its next question.');
}

main()
  .catch((err) => {
    log.error(`failed: ${err.message}`, err.stack);
    process.exitCode = 1;
  })
  .finally(() => db.disconnect());
