/**
 * Every notification the platform raises (outage, recovery, SSL expiry,
 * predicted complaint surge). Kept as an audit trail and rendered as the
 * dashboard alert feed; email dispatch status is recorded alongside.
 */
const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['outage', 'recovery', 'ssl_expiry', 'surge_prediction', 'info'],
      required: true,
      index: true,
    },
    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'warning' },
    title: { type: String, required: true },
    message: { type: String, required: true },
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceEndpoint' },
    incident: { type: mongoose.Schema.Types.ObjectId, ref: 'Incident' },
    department: { type: String },
    email: {
      attempted: { type: Boolean, default: false },
      sent: { type: Boolean, default: false },
      error: { type: String, default: '' },
    },
    acknowledged: { type: Boolean, default: false },
  },
  { timestamps: true }
);

alertSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Alert', alertSchema);
