/**
 * Per-service per-day rollup, upserted incrementally on every check.
 * Powers uptime % windows and the 90-day bars on the status page without
 * scanning raw CheckResults. `day` is "YYYY-MM-DD" in Asia/Kolkata.
 */
const mongoose = require('mongoose');

const dailyUptimeSchema = new mongoose.Schema(
  {
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceEndpoint',
      required: true,
    },
    day: { type: String, required: true }, // YYYY-MM-DD (IST)
    checks: { type: Number, default: 0 },
    ups: { type: Number, default: 0 },
    fails: { type: Number, default: 0 },
    latencySumMs: { type: Number, default: 0 }, // over successful checks
    latencyMaxMs: { type: Number, default: 0 },
    downtimeMinutes: { type: Number, default: 0 }, // approximated from failed checks x interval
  },
  { versionKey: false }
);

dailyUptimeSchema.index({ service: 1, day: 1 }, { unique: true });
dailyUptimeSchema.index({ day: 1 });

module.exports = mongoose.model('DailyUptime', dailyUptimeSchema);
