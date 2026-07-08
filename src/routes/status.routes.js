/** Public status page + incidents + alerts API (Module 1). */
const express = require('express');
const { ServiceEndpoint, Incident, Alert, DailyUptime } = require('../models');
const { asyncRoute } = require('../middleware/errorHandler');
const { lastNDayBuckets } = require('../utils/dates');
const config = require('../config');

const router = express.Router();

/**
 * GET /api/status/summary - everything the public status page needs in one
 * call: overall banner state, category groups with per-service status and
 * 90-day daily bars, active incidents.
 */
router.get(
  '/summary',
  asyncRoute(async (req, res) => {
    const services = await ServiceEndpoint.find({ enabled: true })
      .select('name url department category state')
      .sort({ category: 1, name: 1 })
      .lean();

    const days90 = lastNDayBuckets(90);
    const rollups = await DailyUptime.find({ day: { $gte: days90[0] } }).lean();
    const byService = {};
    for (const r of rollups) {
      const id = String(r.service);
      (byService[id] = byService[id] || {})[r.day] = r;
    }

    const categories = {};
    let downCount = 0;
    let degradedCount = 0;
    for (const s of services) {
      if (s.state.status === 'down') downCount++;
      if (s.state.status === 'degraded') degradedCount++;
      const cat = (categories[s.category] = categories[s.category] || {
        category: s.category,
        services: [],
      });
      const dayRolls = byService[String(s._id)] || {};
      // 90 compact daily cells: uptime % or null (no data)
      const bars = days90.map((d) => {
        const r = dayRolls[d];
        if (!r || !r.checks) return null;
        return Math.round((r.ups / r.checks) * 100);
      });
      const recent = Object.values(dayRolls);
      const ups = recent.reduce((s2, r) => s2 + r.ups, 0);
      const checks = recent.reduce((s2, r) => s2 + r.checks, 0);
      cat.services.push({
        id: s._id,
        name: s.name,
        url: s.url,
        department: s.department,
        status: s.state.status,
        latencyMs: s.state.lastLatencyMs,
        lastCheckAt: s.state.lastCheckAt,
        lastError: s.state.lastError,
        sslDaysRemaining: s.state.ssl ? s.state.ssl.daysRemaining : undefined,
        uptime90: checks ? Math.round((ups / checks) * 1000) / 10 : null,
        bars,
      });
    }

    const activeIncidents = await Incident.find({ status: 'open' })
      .populate('service', 'name url department')
      .sort({ startedAt: -1 })
      .lean();

    const overall =
      downCount > 0 ? 'outage' : degradedCount > 0 ? 'degraded' : 'operational';

    res.json({
      generatedAt: new Date(),
      simulated: config.monitor.simulate,
      overall,
      totals: {
        services: services.length,
        operational: services.length - downCount - degradedCount,
        degraded: degradedCount,
        down: downCount,
      },
      days: days90,
      categories: Object.values(categories),
      activeIncidents,
    });
  })
);

/** GET /api/status/incidents?active=true&days=30 */
router.get(
  '/incidents',
  asyncRoute(async (req, res) => {
    const filter = {};
    if (req.query.active === 'true') filter.status = 'open';
    if (req.query.days) {
      filter.startedAt = {
        $gte: new Date(Date.now() - Math.min(parseInt(req.query.days, 10) || 30, 365) * 86400000),
      };
    }
    const incidents = await Incident.find(filter)
      .populate('service', 'name url department category')
      .sort({ startedAt: -1 })
      .limit(200)
      .lean();
    res.json(incidents);
  })
);

/** GET /api/status/alerts?limit=50&type=outage */
router.get(
  '/alerts',
  asyncRoute(async (req, res) => {
    const filter = {};
    if (req.query.type) filter.type = req.query.type;
    const alerts = await Alert.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(req.query.limit, 10) || 50, 200))
      .lean();
    res.json(alerts);
  })
);

/** GET /api/status/ssl - certificate expiry board, soonest first. */
router.get(
  '/ssl',
  asyncRoute(async (req, res) => {
    const services = await ServiceEndpoint.find({
      enabled: true,
      checkSsl: true,
      'state.ssl.validTo': { $exists: true },
    })
      .select('name url department state.ssl')
      .lean();
    services.sort(
      (a, b) => (a.state.ssl.daysRemaining ?? 9999) - (b.state.ssl.daysRemaining ?? 9999)
    );
    res.json(
      services.map((s) => ({
        id: s._id,
        name: s.name,
        url: s.url,
        department: s.department,
        ...s.state.ssl,
      }))
    );
  })
);

module.exports = router;
