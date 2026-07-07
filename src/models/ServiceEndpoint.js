/**
 * A monitored GNCTD service endpoint. One document per public URL.
 * `state` holds the live monitoring state machine; long-term history lives in
 * CheckResult (raw, TTL-bound) and DailyUptime (permanent rollups).
 */
const mongoose = require('mongoose');

const STATUSES = ['operational', 'degraded', 'down', 'maintenance', 'unknown'];

const serviceEndpointSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true, unique: true, trim: true },
    department: { type: String, required: true, index: true },
    // Coarse grouping used by the public status page (e.g. "Certificates &
    // e-District", "Water", "Municipal", "Transport"...)
    category: { type: String, required: true, index: true },
    description: { type: String, default: '' },

    // Grievance categories this service maps to - the correlation engine uses
    // this to link outages of this endpoint to complaint categories.
    relatedGrievanceCategories: [{ type: String }],

    // Monitoring behaviour overrides
    enabled: { type: Boolean, default: true },
    // HTTP statuses treated as UP. Default 200-399. Some govt portals answer
    // 403 to non-browser agents; list it here if the site is known to do so.
    acceptableStatuses: [{ type: Number }],
    checkSsl: { type: Boolean, default: true },

    // Verification metadata from research / verify-endpoints script
    verification: {
      method: { type: String, default: '' }, // e.g. 'search-confirmed', 'http'
      verifiedAt: { type: Date },
      note: { type: String, default: '' },
    },

    // ---- Live state (updated by the monitor) ----
    state: {
      status: { type: String, enum: STATUSES, default: 'unknown' },
      lastCheckAt: { type: Date },
      lastUpAt: { type: Date },
      lastLatencyMs: { type: Number },
      lastHttpStatus: { type: Number },
      lastError: { type: String, default: '' },
      consecutiveFails: { type: Number, default: 0 },
      // Exponential backoff: when a service keeps failing we check it less
      // often to stay polite. nextCheckAt in the future => skip this cycle.
      nextCheckAt: { type: Date, default: () => new Date(0) },
      ssl: {
        validTo: { type: Date },
        issuer: { type: String, default: '' },
        daysRemaining: { type: Number },
        checkedAt: { type: Date },
        error: { type: String, default: '' },
      },
    },
  },
  { timestamps: true }
);

serviceEndpointSchema.index({ category: 1, name: 1 });

serviceEndpointSchema.statics.STATUSES = STATUSES;

module.exports = mongoose.model('ServiceEndpoint', serviceEndpointSchema);
