/**
 * Index builder: embeds the corpus and writes it to MongoDB.
 *
 * Rebuilds are incremental. Each chunk carries a content hash, so a rebuild
 * after a seed that added a few hundred grievances only pays to embed what
 * actually changed - the policy, taxonomy, endpoint and doc passages are
 * untouched and cost nothing. Chunks whose source rows have disappeared are
 * deleted, so the index cannot answer from records that no longer exist.
 */
const config = require('../../config');
const llm = require('../llm');
const store = require('./store');
const { buildCorpus } = require('./chunker');
const { RagChunk } = require('../../models');
const log = require('../../utils/logger')('rag:index');

/**
 * Build or refresh the vector index.
 *
 * @param {object}   [opts]
 * @param {boolean}  [opts.force]         re-embed every chunk, ignoring hashes
 * @param {boolean}  [opts.includeRecords] embed individual grievance records
 * @param {Function} [opts.onProgress]    ({ done, total }) during embedding
 */
async function buildIndex(opts = {}) {
  if (!llm.embeddingsAvailable()) {
    throw new Error(
      'Building the vector index needs OPENAI_API_KEY (embeddings). ' +
        'Without it the assistant still runs on the structured + live-data lanes.'
    );
  }

  const started = Date.now();
  const { chunks, counts } = await buildCorpus(opts);
  log.info(
    `corpus: ${chunks.length} chunks from ${counts.grievances} grievances, ${counts.insights} insights`
  );

  // Which chunks already exist at the same hash, model and dimension?
  const existing = new Map();
  const known = await RagChunk.find({})
    .select('chunkId contentHash embedModel dims')
    .lean();
  for (const d of known) existing.set(d.chunkId, d);

  const fresh = [];
  const stale = [];
  for (const c of chunks) {
    const prev = existing.get(c.chunkId);
    const unchanged =
      prev &&
      !opts.force &&
      prev.contentHash === c.contentHash &&
      prev.embedModel === config.rag.embedModel &&
      prev.dims === config.rag.embedDims;
    (unchanged ? fresh : stale).push(c);
  }

  // Anything in the collection that the corpus no longer produces is dropped.
  const wanted = new Set(chunks.map((c) => c.chunkId));
  const orphaned = known.filter((d) => !wanted.has(d.chunkId)).map((d) => d.chunkId);
  if (orphaned.length) {
    await RagChunk.deleteMany({ chunkId: { $in: orphaned } });
    log.info(`removed ${orphaned.length} chunks whose source records are gone`);
  }

  log.info(`embedding ${stale.length} chunks (${fresh.length} unchanged, reused)`);

  let embedded = 0;
  const batchSize = config.rag.embedBatch;
  for (let i = 0; i < stale.length; i += batchSize) {
    const batch = stale.slice(i, i + batchSize);
    const vectors = await llm.embed(batch.map((c) => c.text));

    const ops = batch.map((c, j) => ({
      updateOne: {
        filter: { chunkId: c.chunkId },
        update: {
          $set: {
            kind: c.kind,
            title: c.title,
            text: c.text,
            citation: c.citation,
            metadata: c.metadata,
            contentHash: c.contentHash,
            embedding: RagChunk.toBuffer(vectors[j]),
            dims: config.rag.embedDims,
            embedModel: config.rag.embedModel,
            builtAt: new Date(),
          },
        },
        upsert: true,
      },
    }));
    await RagChunk.bulkWrite(ops, { ordered: false });

    embedded += batch.length;
    if (opts.onProgress) opts.onProgress({ done: embedded, total: stale.length });
    else if (embedded % (batchSize * 10) === 0 || embedded === stale.length) {
      log.info(`  embedded ${embedded}/${stale.length}`);
    }
  }

  store.invalidate();
  const summary = {
    total: chunks.length,
    embedded,
    reused: fresh.length,
    removed: orphaned.length,
    // text-embedding-3-small is $0.02 per million tokens; ~1 token per 4 chars.
    approxCostUsd:
      Math.round(
        (stale.reduce((n, c) => n + c.text.length, 0) / 4 / 1e6) * 0.02 * 10000
      ) / 10000,
    elapsedMs: Date.now() - started,
  };
  log.info(
    `index ready: ${summary.total} chunks (${summary.embedded} new, ${summary.reused} reused) ` +
      `in ${Math.round(summary.elapsedMs / 1000)}s, ~$${summary.approxCostUsd}`
  );
  return summary;
}

/**
 * Called once at boot. Builds the index only when it is empty and a key is
 * present, so a fresh deploy self-heals without re-paying on every restart.
 */
async function ensureIndex() {
  if (!config.rag.enabled || !config.rag.autoBuild) return null;
  if (!llm.embeddingsAvailable()) return null;
  const count = await RagChunk.countDocuments({});
  if (count > 0) {
    await store.load(); // warm the in-memory matrix before the first question
    return null;
  }
  log.info('no vector index found - building it once now');
  try {
    return await buildIndex();
  } catch (err) {
    log.error(`auto-build failed (${err.message}) - assistant will run without the vector lane`);
    return null;
  }
}

module.exports = { buildIndex, ensureIndex };
