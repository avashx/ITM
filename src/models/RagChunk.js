/**
 * One retrievable unit of the assistant's knowledge base: a passage of text
 * plus its embedding vector.
 *
 * The vector is stored as a raw little-endian Float32 Buffer rather than an
 * array of doubles. That is 4x smaller on disk (matters on a 512MB Atlas M0),
 * loads into a typed array with zero per-element parsing, and stays portable -
 * BSON binData works on every MongoDB-wire engine (CLAUDE.md rule 4). We
 * deliberately do NOT use Atlas Vector Search: similarity is computed in
 * process, which keeps the platform runnable on FerretDB or a local mongod.
 *
 * `contentHash` lets a rebuild skip chunks whose text has not changed, so
 * re-indexing after adding a few hundred grievances costs a few cents, not a
 * full re-embed of the corpus.
 */
const mongoose = require('mongoose');

const KINDS = [
  'policy', // SLA norms, escalation rules, status lifecycle
  'taxonomy', // department -> category structure and its classifier keywords
  'endpoint', // the monitored service catalogue (static facts, not live state)
  'cluster', // aggregated grievance profile: department x category x district
  'grievance', // a single grievance record
  'insight', // a correlation-engine finding
  'doc', // prose from the repository's own documentation
];

const ragChunkSchema = new mongoose.Schema(
  {
    // Deterministic and stable across rebuilds, e.g. "grievance:SYN-000123".
    chunkId: { type: String, required: true, unique: true },
    kind: { type: String, enum: KINDS, required: true, index: true },

    title: { type: String, required: true },
    // The exact text that was embedded and that the model is shown.
    text: { type: String, required: true },
    // Human-readable provenance shown as a citation in the UI.
    citation: { type: String, required: true },

    // Filterable facets used to pre-narrow the vector search.
    metadata: {
      department: { type: String, index: true },
      category: { type: String },
      district: { type: String },
      status: { type: String },
      priority: { type: String },
      dayBucket: { type: String },
      url: { type: String },
      // 'synthetic' for generated grievances, 'real' for measured/reference
      // data. Surfaced verbatim so answers can never blur the two.
      dataSource: { type: String },
      recordCount: { type: Number },
    },

    embedding: { type: Buffer },
    dims: { type: Number },
    embedModel: { type: String },
    contentHash: { type: String, index: true },
    builtAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

ragChunkSchema.statics.KINDS = KINDS;

/** Buffer -> Float32Array without copying element by element. */
ragChunkSchema.statics.toVector = function toVector(buf) {
  if (!buf) return null;
  const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer || buf);
  // Copy into an aligned ArrayBuffer: BSON buffers can start at a byte offset
  // that Float32Array refuses to view directly.
  const copy = new ArrayBuffer(bytes.length);
  Buffer.from(copy).set(bytes);
  return new Float32Array(copy);
};

/** Float32Array -> Buffer for storage. */
ragChunkSchema.statics.toBuffer = function toBuffer(vec) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
};

module.exports = mongoose.model('RagChunk', ragChunkSchema);
