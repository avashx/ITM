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

  external: {
    dataGovInKey: process.env.DATA_GOV_IN_API_KEY || '',
    maptilerKey: process.env.MAPTILER_KEY || '',
  },
};

module.exports = config;
