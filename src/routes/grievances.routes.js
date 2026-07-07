/** Module 2 API: grievance ingestion, listing, classification, analytics. */
const express = require('express');
const { Grievance } = require('../models');
const { asyncRoute } = require('../middleware/errorHandler');
const adminAuth = require('../middleware/adminAuth');
const { classify, departments } = require('../modules/grievance/classifier');
const { computeDeadlines } = require('../modules/grievance/sla');
const analytics = require('../modules/grievance/analytics');
const { dayBucket } = require('../utils/dates');
const socket = require('../services/socket');

const router = express.Router();

/** GET /api/grievances - filtered, paginated list. */
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const filter = analytics.buildFilter(req.query);
    if (req.query.q) filter.description = { $regex: escapeRe(req.query.q), $options: 'i' };
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit, 10) || 25, 200);
    const [items, total] = await Promise.all([
      Grievance.find(filter)
        .sort({ registeredAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Grievance.countDocuments(filter),
    ]);
    res.json({ page, limit, total, pages: Math.ceil(total / limit), items });
  })
);

/**
 * POST /api/grievances - register one grievance.
 * department/category are auto-classified from description when not given.
 */
router.post(
  '/',
  asyncRoute(async (req, res) => {
    const doc = await buildGrievance(req.body || {}, 'manual');
    const g = await Grievance.create(doc);
    socket.emit('grievance:new', {
      id: g._id,
      grievanceId: g.grievanceId,
      department: g.department,
      category: g.category,
      district: g.location?.district,
      priority: g.priority,
      registeredAt: g.registeredAt,
    });
    res.status(201).json(g);
  })
);

/**
 * POST /api/grievances/import (admin) - bulk import an array of grievances
 * (e.g. a CSV converted to JSON, or an open-data extract). Body:
 * { items: [...], source: "import" }. Returns per-row results.
 */
router.post(
  '/import',
  adminAuth,
  asyncRoute(async (req, res) => {
    const items = Array.isArray(req.body?.items) ? req.body.items : null;
    if (!items || !items.length) {
      return res.status(400).json({ error: 'body must be { items: [ ... ] }' });
    }
    if (items.length > 5000) {
      return res.status(400).json({ error: 'max 5000 items per import call' });
    }
    let inserted = 0;
    const errors = [];
    const docs = [];
    for (let i = 0; i < items.length; i++) {
      try {
        docs.push(await buildGrievance(items[i], req.body.source || 'import'));
      } catch (err) {
        errors.push({ index: i, error: err.message });
      }
    }
    if (docs.length) {
      const result = await Grievance.insertMany(docs, { ordered: false }).catch((e) => e);
      inserted = Array.isArray(result) ? result.length : result.insertedDocs?.length || 0;
    }
    res.status(errors.length && !inserted ? 400 : 201).json({ inserted, errors });
  })
);

/** POST /api/grievances/classify - dry-run the keyword classifier. */
router.post(
  '/classify',
  asyncRoute(async (req, res) => {
    const { description } = req.body || {};
    if (!description) return res.status(400).json({ error: 'description required' });
    res.json(classify(description));
  })
);

/** PATCH /api/grievances/:id/status - workflow transitions (admin). */
router.patch(
  '/:id/status',
  adminAuth,
  asyncRoute(async (req, res) => {
    const { status } = req.body || {};
    if (!Grievance.STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${Grievance.STATUSES}` });
    }
    const g = await Grievance.findById(req.params.id);
    if (!g) return res.status(404).json({ error: 'grievance not found' });
    g.status = status;
    const now = new Date();
    if (status === 'in_progress' && !g.firstResponseAt) g.firstResponseAt = now;
    if (status === 'resolved' && !g.resolvedAt) {
      g.resolvedAt = now;
      g.resolutionHours = Math.round(((now - g.registeredAt) / 3600000) * 10) / 10;
    }
    await g.save();
    res.json(g);
  })
);

/** GET /api/grievances/meta/departments - taxonomy for filters/forms. */
router.get('/meta/departments', (req, res) => res.json(departments()));

// ---- analytics endpoints ----
router.get('/stats/summary', asyncRoute(async (req, res) => res.json(await analytics.summary(req.query))));
router.get('/stats/departments', asyncRoute(async (req, res) => res.json(await analytics.byDepartment(req.query))));
router.get('/stats/trends', asyncRoute(async (req, res) => res.json(await analytics.trends(req.query))));
router.get('/stats/categories', asyncRoute(async (req, res) => res.json(await analytics.topCategories(req.query))));
router.get('/stats/heatmap', asyncRoute(async (req, res) => res.json(await analytics.heatmapPoints(req.query))));
router.get('/stats/choropleth', asyncRoute(async (req, res) => res.json(await analytics.choropleth(req.query))));
router.get('/stats/points', asyncRoute(async (req, res) => res.json(await analytics.points(req.query))));

/** Normalise+classify one input row into a Grievance document. */
async function buildGrievance(input, source) {
  if (!input.description) throw new Error('description is required');
  const registeredAt = input.registeredAt ? new Date(input.registeredAt) : new Date();
  if (Number.isNaN(registeredAt.getTime())) throw new Error('invalid registeredAt');
  const priority = Grievance.PRIORITIES.includes(input.priority) ? input.priority : 'normal';

  let department = input.department;
  let category = input.category;
  let classification = { method: 'provided' };
  if (!department || !category) {
    const c = classify(input.description);
    department = department || c.department;
    category = category || c.category;
    classification = {
      method: 'keyword',
      confidence: c.confidence,
      matchedKeywords: c.matchedKeywords,
    };
  }

  const grievanceId =
    input.grievanceId ||
    `PGMS-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  return {
    grievanceId,
    source: input.source || source,
    channel: input.channel,
    description: String(input.description).slice(0, 4000),
    department,
    category,
    subcategory: input.subcategory || '',
    classification,
    status: Grievance.STATUSES.includes(input.status) ? input.status : 'registered',
    priority,
    registeredAt,
    dayBucket: dayBucket(registeredAt),
    firstResponseAt: input.firstResponseAt ? new Date(input.firstResponseAt) : undefined,
    resolvedAt: input.resolvedAt ? new Date(input.resolvedAt) : undefined,
    resolutionHours: input.resolvedAt
      ? Math.round(((new Date(input.resolvedAt) - registeredAt) / 3600000) * 10) / 10
      : undefined,
    sla: computeDeadlines(registeredAt, priority),
    location: {
      district: input.district || input.location?.district,
      ward: input.ward || input.location?.ward,
      wardNo: input.wardNo || input.location?.wardNo,
      assemblyConstituency: input.assemblyConstituency || input.location?.assemblyConstituency,
      lat: numOrUndef(input.lat ?? input.location?.lat),
      lng: numOrUndef(input.lng ?? input.location?.lng),
    },
  };
}

function numOrUndef(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : undefined;
}
function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = router;
