/**
 * Central configuration. Reads .env once and exposes typed, validated values.
 * Every value has a safe default so the app boots in development with just
 * MONGODB_URI (and even that defaults to a local instance).
 */
require('dotenv').config();

const int = (v, fallback) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};
const float = (v, fallback) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (v, fallback) => {
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
};

const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  timezone: process.env.TZ || 'Asia/Kolkata',

  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/itmonitor',

  monitor: {
    enabled: bool(process.env.MONITOR_ENABLED, true),
    cron: process.env.CHECK_CRON || '*/5 * * * *',
    timeoutMs: int(process.env.CHECK_TIMEOUT_MS, 10000),
    concurrency: int(process.env.CHECK_CONCURRENCY, 8),
    failThreshold: int(process.env.FAIL_THRESHOLD, 3),
    degradedLatencyMs: int(process.env.DEGRADED_LATENCY_MS, 4000),
    retentionDays: int(process.env.CHECK_RETENTION_DAYS, 30),
    sslWarnDays: int(process.env.SSL_WARN_DAYS, 30),
    userAgent:
      process.env.MONITOR_USER_AGENT ||
      'GNCTD-IT-Monitor/1.0 (+service-health-check)',
    simulate: bool(process.env.SIMULATE_CHECKS, false),
  },

  mail: {
    host: process.env.SMTP_HOST || '',
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.ALERT_EMAIL_FROM || 'IT Monitor <alerts@localhost>',
    to: (process.env.ALERT_EMAIL_TO || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    get enabled() {
      return Boolean(this.host && this.to.length);
    },
  },

  sla: {
    responseDays: int(process.env.SLA_RESPONSE_DAYS, 7),
    resolutionDays: int(process.env.SLA_RESOLUTION_DAYS, 30),
    sosDays: int(process.env.SLA_SOS_DAYS, 3),
  },

  correlation: {
    cron: process.env.CORRELATION_CRON || '15 2 * * *',
    minRatio: float(process.env.CORRELATION_MIN_RATIO, 1.3),
    minZ: float(process.env.CORRELATION_MIN_Z, 2.0),
    windowHours: int(process.env.CORRELATION_WINDOW_HOURS, 48),
    baselineDays: 28, // trailing window used to estimate normal complaint volume
  },

  adminKey: process.env.ADMIN_API_KEY || '',

  // Assistant / RAG chat. Provider is picked automatically: OpenAI first (it
  // is the only one of the two that also serves embeddings, so it unlocks the
  // vector-retrieval lane), then Anthropic, then the deterministic responder.
  // With no key at all the panel STILL works - see src/services/assistant.js.
  assistant: {
    // 'auto' | 'openai' | 'anthropic' | 'rules' - forces a provider for demos
    provider: (process.env.ASSISTANT_PROVIDER || 'auto').toLowerCase(),
    openaiKey: process.env.OPENAI_API_KEY || '',
    // gpt-4.1-mini is the default: cheap, fast first token, reliable at
    // "answer only from this context". gpt-5-mini / gpt-4.1-nano also work.
    openaiModel: process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    anthropicKey: process.env.ANTHROPIC_API_KEY || '',
    anthropicModel: process.env.ANTHROPIC_MODEL || process.env.ASSISTANT_MODEL || 'claude-opus-4-8',
    temperature: float(process.env.ASSISTANT_TEMPERATURE, 0.2),
    // Only sent to reasoning models (gpt-5*); keeps latency low by default.
    reasoningEffort: process.env.ASSISTANT_REASONING_EFFORT || 'minimal',
    maxTokens: int(process.env.ASSISTANT_MAX_TOKENS, 700),
    // How many prior turns of the conversation are replayed to the model.
    historyTurns: int(process.env.ASSISTANT_HISTORY_TURNS, 6),
    requestTimeoutMs: int(process.env.ASSISTANT_TIMEOUT_MS, 30000),
  },

  // Retrieval-augmented generation over the platform's own corpus.
  rag: {
    enabled: bool(process.env.RAG_ENABLED, true),
    // text-embedding-3-small supports Matryoshka truncation: 256 dims keeps
    // recall high while cutting index size ~6x vs the native 1536.
    embedModel: process.env.RAG_EMBED_MODEL || 'text-embedding-3-small',
    embedDims: int(process.env.RAG_EMBED_DIMS, 256),
    embedBatch: int(process.env.RAG_EMBED_BATCH, 96),
    // Chunks handed to the model per answer, after MMR diversification.
    topK: int(process.env.RAG_TOP_K, 8),
    // Wider net pulled from the vector index before re-ranking down to topK.
    candidateK: int(process.env.RAG_CANDIDATE_K, 40),
    // Cosine floor - below this a chunk is treated as irrelevant, so an
    // off-topic question retrieves nothing and the model must say so.
    minScore: float(process.env.RAG_MIN_SCORE, 0.18),
    // Embed individual grievance records as well as the cluster summaries.
    indexRecords: bool(process.env.RAG_INDEX_RECORDS, true),
    // Build the index on boot when the collection is empty (first deploy).
    autoBuild: bool(process.env.RAG_AUTO_BUILD, true),
  },

  external: {
    dataGovInKey: process.env.DATA_GOV_IN_API_KEY || '',
    maptilerKey: process.env.MAPTILER_KEY || '',
  },
};

module.exports = config;
