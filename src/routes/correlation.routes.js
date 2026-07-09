/** Module 3 API: insights, timeline overlays, surge predictions. */
const express = require('express');
const { CorrelationInsight } = require('../models');
const { asyncRoute } = require('../middleware/errorHandler');
const adminAuth = require('../middleware/adminAuth');
const engine = require('../modules/correlation/engine');
const predictor = require('../modules/correlation/predictor');

const router = express.Router();

/** GET /api/correlation/insights?department=&minConfidence= */
router.get(
  '/insights',
  asyncRoute(async (req, res) => {
    const filter = {};
    if (req.query.department) filter.department = req.query.department;
    if (req.query.category) filter.category = req.query.category;
    if (req.query.minConfidence) {
      const order = ['low', 'medium', 'high'];
      const idx = order.indexOf(req.query.minConfidence);
      if (idx > 0) filter.confidence = { $in: order.slice(idx) };
    }
    const insights = await CorrelationInsight.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(req.query.limit, 10) || 100, 500))
      .populate('service', 'url') // so the UI can hyperlink the service mention
      .lean();
    res.json(insights);
  })
);

/**
 * GET /api/correlation/timeline?category=Water%20Supply&days=60
 * (or ?department=...) - daily complaint counts + outage windows to overlay.
 */
router.get(
  '/timeline',
  asyncRoute(async (req, res) => {
    res.json(
      await engine.timeline({
        category: req.query.category,
        department: req.query.department,
        days: req.query.days,
      })
    );
  })
);

/** GET /api/correlation/predictions - live surge forecasts for open outages. */
router.get(
  '/predictions',
  asyncRoute(async (req, res) => {
    res.json(await predictor.predictOpenOutages({ notify: false }));
  })
);

/** POST /api/correlation/run (admin) - trigger an engine scan now. */
router.post(
  '/run',
  adminAuth,
  asyncRoute(async (req, res) => {
    const created = await engine.run({
      lookbackDays: parseInt(req.body?.lookbackDays, 10) || 90,
    });
    res.json({ created: created.length, insights: created });
  })
);

module.exports = router;
