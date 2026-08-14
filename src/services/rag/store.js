/**
 * In-process vector store.
 *
 * The whole index is loaded from MongoDB into one flat Float32Array at boot
 * (N * dims contiguous floats) and searched by brute force. For this corpus -
 * roughly 14k chunks at 256 dims - that is ~14MB of RAM and ~4ms per query,
 * which is far below the latency budget and needs no vector database, no
 * Atlas Vector Search tier, and no extra dependency.
 *
 * Vectors are stored L2-normalised (see llm.normalise), so cosine similarity
 * is a plain dot product and the inner loop stays branch-free.
 */
const { RagChunk } = require('../../models');
const config = require('../../config');
const log = require('../../utils/logger')('rag:store');

let index = null; // { matrix, dims, count, meta[] }
let loading = null; // in-flight load, so concurrent callers share one query

/** Drop the cached index; the next search reloads from MongoDB. */
function invalidate() {
  index = null;
  loading = null;
}

/**
 * Load (or return the cached) index. Chunk text is kept in memory alongside
 * the vectors so a hit needs no second round trip to the database.
 */
async function load() {
  if (index) return index;
  if (loading) return loading;
  loading = (async () => {
    const started = Date.now();
    const docs = await RagChunk.find({ embedding: { $ne: null } })
      .select('chunkId kind title text citation metadata embedding dims')
      .lean();

    if (!docs.length) {
      index = { matrix: new Float32Array(0), dims: config.rag.embedDims, count: 0, meta: [] };
      loading = null;
      return index;
    }

    const dims = docs[0].dims || config.rag.embedDims;
    // Chunks embedded under a different dimension setting cannot share a
    // matrix; skip them rather than corrupting every similarity score.
    const usable = docs.filter((d) => (d.dims || dims) === dims && d.embedding);
    const skipped = docs.length - usable.length;

    const matrix = new Float32Array(usable.length * dims);
    const meta = new Array(usable.length);
    for (let i = 0; i < usable.length; i += 1) {
      const d = usable[i];
      matrix.set(RagChunk.toVector(d.embedding), i * dims);
      meta[i] = {
        chunkId: d.chunkId,
        kind: d.kind,
        title: d.title,
        text: d.text,
        citation: d.citation,
        metadata: d.metadata || {},
      };
    }

    index = { matrix, dims, count: usable.length, meta };
    log.info(
      `index loaded: ${usable.length} chunks x ${dims}d in ${Date.now() - started}ms ` +
        `(${Math.round((matrix.byteLength / 1048576) * 10) / 10}MB)` +
        (skipped ? ` - skipped ${skipped} with mismatched dims` : '')
    );
    loading = null;
    return index;
  })();
  return loading;
}

/**
 * Nearest neighbours by cosine similarity.
 *
 * @param {Float32Array} queryVec  normalised query embedding
 * @param {object}   [opts]
 * @param {number}   [opts.k]         how many to return
 * @param {number}   [opts.minScore]  similarity floor; below it, nothing is returned
 * @param {Function} [opts.filter]    (meta) => boolean facet pre-filter
 * @returns {Promise<Array<{score, ...meta, vectorOffset}>>}
 */
async function search(queryVec, opts = {}) {
  const { k = config.rag.candidateK, minScore = config.rag.minScore, filter } = opts;
  const idx = await load();
  if (!idx.count) return [];
  if (queryVec.length !== idx.dims) {
    throw new Error(
      `query is ${queryVec.length}d but the index is ${idx.dims}d - rebuild with: npm run rag:index`
    );
  }

  const { matrix, dims, meta } = idx;
  // Bounded insertion into a small sorted array beats a full sort of N.
  const top = [];
  for (let i = 0; i < idx.count; i += 1) {
    if (filter && !filter(meta[i])) continue;
    const base = i * dims;
    let score = 0;
    for (let j = 0; j < dims; j += 1) score += matrix[base + j] * queryVec[j];
    if (score < minScore) continue;
    if (top.length === k && score <= top[top.length - 1].score) continue;
    const entry = { i, score };
    let pos = top.length;
    while (pos > 0 && top[pos - 1].score < score) pos -= 1;
    top.splice(pos, 0, entry);
    if (top.length > k) top.pop();
  }

  return top.map((t) => ({ ...meta[t.i], score: t.score, vectorOffset: t.i * dims }));
}

/**
 * Maximal Marginal Relevance re-rank.
 *
 * Templated grievance text produces many near-identical chunks; taking the
 * raw top-k would hand the model eight paraphrases of one complaint and crowd
 * out the policy or endpoint chunk that actually answers the question. MMR
 * trades a little relevance for coverage.
 *
 * @param {Array} candidates  results from search(), highest score first
 * @param {number} k          how many to keep
 * @param {number} lambda     1 = pure relevance, 0 = pure diversity
 */
async function diversify(candidates, k, lambda = 0.72) {
  if (candidates.length <= k) return candidates;
  const idx = await load();
  const { matrix, dims } = idx;

  const sim = (a, b) => {
    let s = 0;
    for (let j = 0; j < dims; j += 1) s += matrix[a.vectorOffset + j] * matrix[b.vectorOffset + j];
    return s;
  };

  const picked = [candidates[0]];
  const rest = candidates.slice(1);
  while (picked.length < k && rest.length) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let r = 0; r < rest.length; r += 1) {
      let maxSim = -Infinity;
      for (const p of picked) maxSim = Math.max(maxSim, sim(rest[r], p));
      const mmr = lambda * rest[r].score - (1 - lambda) * maxSim;
      if (mmr > bestScore) {
        bestScore = mmr;
        bestIdx = r;
      }
    }
    picked.push(rest.splice(bestIdx, 1)[0]);
  }
  return picked;
}

/**
 * Index health for the UI badge and /api/assistant/meta.
 * Per-kind counts use plain countDocuments rather than an aggregation stage,
 * matching the engine-portability rule the rest of the analytics follow.
 */
async function stats() {
  const [total, kindCounts, newest] = await Promise.all([
    RagChunk.countDocuments({}),
    Promise.all(RagChunk.KINDS.map((kind) => RagChunk.countDocuments({ kind }))),
    RagChunk.findOne({}).sort({ builtAt: -1 }).select('builtAt embedModel dims').lean(),
  ]);
  return {
    chunks: total,
    byKind: RagChunk.KINDS.reduce(
      (acc, kind, i) => (kindCounts[i] ? Object.assign(acc, { [kind]: kindCounts[i] }) : acc),
      {}
    ),
    builtAt: newest ? newest.builtAt : null,
    embedModel: newest ? newest.embedModel : null,
    dims: newest ? newest.dims : null,
    loaded: Boolean(index),
  };
}

module.exports = { load, search, diversify, invalidate, stats };
