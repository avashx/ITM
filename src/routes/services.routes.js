/** Module 1 API: monitored services, checks, uptime, incidents. */
const express = require('express');
const { ServiceEndpoint, CheckResult, DailyUptime, Incident, Alert } = require('../models');
const { asyncRoute } = require('../middleware/errorHandler');
const adminAuth = require('../middleware/adminAuth');
const { lastNDayBuckets } = require('../utils/dates');
const config = require('../config');

const router = express.Router();

/** GET /api/services - all services with live state + uptime windows. */
router.get(
  '/',
  asyncRoute(async (req, res) => {
    const filter = {};
    if (req.query.category) filter.category = req.query.category;
    if (req.query.department) filter.department = req.query.department;
    if (req.query.status) filter['state.status'] = req.query.status;

    const services = await ServiceEndpoint.find(filter).sort({ category: 1, name: 1 }).lean();
    const uptimes = await uptimeWindows(services.map((s) => s._id));
    res.json(
      services.map((s) => ({
        ...s,
        uptime: uptimes[String(s._id)] || { d1: null, d7: null, d30: null, d90: null },
      }))
    );
  })
);

/** GET /api/services/:id - one service with recent checks + incidents + daily bars. */
router.get(
  '/:id',
  asyncRoute(async (req, res) => {
    const service = await ServiceEndpoint.findById(req.params.id).lean();
    if (!service) return res.status(404).json({ error: 'service not found' });

    const hours = Math.min(parseInt(req.query.hours, 10) || 24, 24 * 7);
    const [checks, incidents, daily] = await Promise.all([
      CheckResult.find({
        service: service._id,
        checkedAt: { $gte: new Date(Date.now() - hours * 3600000) },
      })
        .sort({ checkedAt: 1 })
        .lean(),
      Incident.find({ service: service._id }).sort({ startedAt: -1 }).limit(20).lean(),
      DailyUptime.find({ service: service._id, day: { $gte: lastNDayBuckets(90)[0] } })
        .sort({ day: 1 })
        .lean(),
    ]);
    const uptimes = await uptimeWindows([service._id]);
    res.json({
      ...service,
      uptime: uptimes[String(service._id)],
      checks,
      incidents,
      daily,
    });
  })
);

/** POST /api/services - register a new endpoint to monitor (admin). */
router.post(
  '/',
  adminAuth,
  asyncRoute(async (req, res) => {
    const { name, url, department, category } = req.body || {};
    if (!name || !url || !department || !category) {
      return res
        .status(400)
        .json({ error: 'name, url, department and category are required' });
    }
    const service = await ServiceEndpoint.create({
      name,
      url,
      department,
      category,
      description: req.body.description || '',
      relatedGrievanceCategories: req.body.relatedGrievanceCategories || [],
      acceptableStatuses: req.body.acceptableStatuses || [],
      checkSsl: req.body.checkSsl !== false,
      verification: { method: 'manual', verifiedAt: new Date() },
    });
    res.status(201).json(service);
  })
);

/** PUT /api/services/:id - update endpoint config (admin). */
router.put(
  '/:id',
  adminAuth,
  asyncRoute(async (req, res) => {
    const allowed = [
      'name', 'url', 'department', 'category', 'description', 'enabled',
      'relatedGrievanceCategories', 'acceptableStatuses', 'checkSsl',
    ];
    const update = {};
    for (const k of allowed) if (k in (req.body || {})) update[k] = req.body[k];
    const service = await ServiceEndpoint.findByIdAndUpdate(req.params.id, update, {
      new: true,
      runValidators: true,
    });
    if (!service) return res.status(404).json({ error: 'service not found' });
    res.json(service);
  })
);

/** DELETE /api/services/:id (admin). */
router.delete(
  '/:id',
  adminAuth,
  asyncRoute(async (req, res) => {
    const service = await ServiceEndpoint.findByIdAndDelete(req.params.id);
    if (!service) return res.status(404).json({ error: 'service not found' });
    await Promise.all([
      CheckResult.deleteMany({ service: service._id }),
      DailyUptime.deleteMany({ service: service._id }),
    ]);
    res.json({ deleted: true });
  })
);

/** GET /api/services/:id/checks?hours=24 - raw recent checks. */
router.get(
  '/:id/checks',
  asyncRoute(async (req, res) => {
    const hours = Math.min(parseInt(req.query.hours, 10) || 24, 24 * config.monitor.retentionDays);
    const checks = await CheckResult.find({
      service: req.params.id,
      checkedAt: { $gte: new Date(Date.now() - hours * 3600000) },
    })
      .sort({ checkedAt: 1 })
      .lean();
    res.json(checks);
  })
);

/**
 * Uptime % over 1/7/30/90-day windows from DailyUptime rollups.
 * Returns { [serviceId]: {d1,d7,d30,d90} } with values in % (1 decimal).
 */
async function uptimeWindows(serviceIds) {
  const from90 = lastNDayBuckets(90)[0];
  const rows = await DailyUptime.find({
    service: { $in: serviceIds },
    day: { $gte: from90 },
  }).lean();

  const cut = (n) => lastNDayBuckets(n)[0];
  const cuts = { d1: cut(1), d7: cut(7), d30: cut(30), d90: from90 };
  const acc = {};
  for (const r of rows) {
    const id = String(r.service);
    acc[id] = acc[id] || {
      d1: [0, 0], d7: [0, 0], d30: [0, 0], d90: [0, 0],
    };
    for (const w of ['d1', 'd7', 'd30', 'd90']) {
      if (r.day >= cuts[w]) {
        acc[id][w][0] += r.ups;
        acc[id][w][1] += r.checks;
      }
    }
  }
  const out = {};
  for (const [id, w] of Object.entries(acc)) {
    out[id] = {};
    for (const k of ['d1', 'd7', 'd30', 'd90']) {
      out[id][k] = w[k][1] ? Math.round((w[k][0] / w[k][1]) * 1000) / 10 : null;
    }
  }
  return out;
}

module.exports = router;
