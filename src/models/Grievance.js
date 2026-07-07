/**
 * A citizen grievance/complaint. Fields modelled on PGMS Delhi's public
 * structure (department, category, priority incl. SOS, response/resolution
 * SLAs) without any personally identifiable information.
 *
 * `dayBucket` (registration day, IST) is denormalised at write time so trend
 * and correlation queries group on an indexed string - fast and portable.
 */
const mongoose = require('mongoose');

const STATUSES = ['registered', 'in_progress', 'resolved', 'rejected'];
const PRIORITIES = ['normal', 'urgent', 'sos'];
const CHANNELS = ['web', 'mobile_app', 'call_1076', 'janta_samvad', 'letter', 'import'];

const grievanceSchema = new mongoose.Schema(
  {
    grievanceId: { type: String, required: true, unique: true }, // e.g. PGMS-2026-000123
    source: {
      type: String,
      enum: ['synthetic', 'manual', 'import', 'api'],
      default: 'manual',
      index: true,
    },
    channel: { type: String, enum: CHANNELS, default: 'web' },

    description: { type: String, required: true, maxlength: 4000 },
    department: { type: String, required: true, index: true },
    category: { type: String, required: true, index: true },
    subcategory: { type: String, default: '' },
    // Classifier metadata: how the department/category was assigned
    classification: {
      method: { type: String, enum: ['keyword', 'provided'], default: 'provided' },
      confidence: { type: Number, min: 0, max: 1 },
      matchedKeywords: [{ type: String }],
    },

    status: { type: String, enum: STATUSES, default: 'registered', index: true },
    priority: { type: String, enum: PRIORITIES, default: 'normal' },

    registeredAt: { type: Date, required: true, default: Date.now, index: true },
    dayBucket: { type: String, required: true, index: true }, // YYYY-MM-DD IST
    firstResponseAt: { type: Date },
    resolvedAt: { type: Date },
    // SLA deadlines computed at registration from PGMS-style norms
    sla: {
      responseDueAt: { type: Date },
      resolutionDueAt: { type: Date },
      responseBreached: { type: Boolean, default: false },
      resolutionBreached: { type: Boolean, default: false },
    },
    resolutionHours: { type: Number }, // set when resolved

    location: {
      district: { type: String, index: true },
      ward: { type: String, index: true },
      wardNo: { type: String },
      assemblyConstituency: { type: String },
      // GeoJSON-style coordinates for the heatmap. Stored as plain numbers
      // (not a 2dsphere index) for engine portability; heat layers only need
      // the raw points.
      lat: { type: Number },
      lng: { type: Number },
    },
  },
  { timestamps: true }
);

grievanceSchema.index({ department: 1, dayBucket: 1 });
grievanceSchema.index({ category: 1, dayBucket: 1 });

grievanceSchema.statics.STATUSES = STATUSES;
grievanceSchema.statics.PRIORITIES = PRIORITIES;

module.exports = mongoose.model('Grievance', grievanceSchema);
