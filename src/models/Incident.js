/**
 * An outage/degradation window for a service. Opened automatically when a
 * service fails FAIL_THRESHOLD consecutive checks; closed on recovery.
 * The correlation engine consumes closed incidents as "outage windows".
 */
const mongoose = require('mongoose');

const incidentSchema = new mongoose.Schema(
  {
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceEndpoint',
      required: true,
      index: true,
    },
    status: { type: String, enum: ['open', 'resolved'], default: 'open', index: true },
    severity: { type: String, enum: ['down', 'degraded'], default: 'down' },
    startedAt: { type: Date, required: true },
    resolvedAt: { type: Date },
    durationHours: { type: Number }, // set on resolution
    failedChecks: { type: Number, default: 0 },
    lastError: { type: String, default: '' },
    // Alert bookkeeping so we notify once per incident, not once per check
    alerts: {
      openedEmailAt: { type: Date },
      resolvedEmailAt: { type: Date },
    },
    note: { type: String, default: '' },
  },
  { timestamps: true }
);

incidentSchema.index({ startedAt: -1 });

module.exports = mongoose.model('Incident', incidentSchema);
