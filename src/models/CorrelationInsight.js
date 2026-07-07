/**
 * A detected outage -> complaint-spike pattern, produced by the correlation
 * engine (Module 3). One insight links one incident window to one
 * department/category whose complaint volume rose significantly above its
 * trailing baseline within the post-outage window.
 */
const mongoose = require('mongoose');

const correlationInsightSchema = new mongoose.Schema(
  {
    incident: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Incident',
      required: true,
      index: true,
    },
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceEndpoint',
      required: true,
      index: true,
    },
    serviceName: { type: String },
    department: { type: String, required: true, index: true },
    category: { type: String, required: true },

    outage: {
      startedAt: { type: Date },
      resolvedAt: { type: Date },
      durationHours: { type: Number },
    },
    // Post-outage observation window scanned for the spike
    window: {
      from: { type: Date },
      to: { type: Date },
      days: [{ type: String }], // day buckets included
    },

    baselineDailyMean: { type: Number }, // trailing-28-day mean, complaints/day
    observedDailyMean: { type: Number }, // mean over the window days
    observedTotal: { type: Number },
    expectedTotal: { type: Number },
    spikeRatio: { type: Number }, // observed/expected, e.g. 1.4 = +40%
    zScore: { type: Number }, // Poisson approximation
    confidence: { type: String, enum: ['low', 'medium', 'high'] },

    // Human-readable finding, e.g. "e-District Delhi was down 6.2h on Tue 09
    // Jun; Certificates complaints rose 42% above baseline the next day."
    narrative: { type: String, required: true },
  },
  { timestamps: true }
);

correlationInsightSchema.index({ incident: 1, department: 1, category: 1 }, { unique: true });
correlationInsightSchema.index({ createdAt: -1 });

module.exports = mongoose.model('CorrelationInsight', correlationInsightSchema);
