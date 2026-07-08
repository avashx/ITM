/** Shared metadata: geo layers, app config for the UI, health probe. */
const express = require('express');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const config = require('../config');
const { asyncRoute } = require('../middleware/errorHandler');

const router = express.Router();

const GEO_DIR = path.join(__dirname, '../../data/geo');
const GEO_LAYERS = {
  districts: 'delhi_districts.geojson',
  wards: 'delhi_wards.geojson',
  assembly: 'delhi_assembly.geojson',
  boundary: 'delhi_boundary.geojson',
};
// GeoJSON is static reference data; cache it in memory after first read.
const geoCache = {};

/** GET /api/meta/geo/:layer - districts | wards | assembly | boundary */
router.get(
  '/geo/:layer',
  asyncRoute(async (req, res) => {
    const file = GEO_LAYERS[req.params.layer];
    if (!file) {
      return res
        .status(404)
        .json({ error: `unknown layer; use one of ${Object.keys(GEO_LAYERS).join(', ')}` });
    }
    if (!geoCache[file]) {
      geoCache[file] = JSON.parse(fs.readFileSync(path.join(GEO_DIR, file), 'utf8'));
    }
    res.set('Cache-Control', 'public, max-age=86400');
    res.json(geoCache[file]);
  })
);

/** GET /api/meta/config - non-secret config the front-end needs. */
router.get('/config', (req, res) => {
  res.json({
    simulate: config.monitor.simulate,
    checkCron: config.monitor.cron,
    failThreshold: config.monitor.failThreshold,
    degradedLatencyMs: config.monitor.degradedLatencyMs,
    timezone: config.timezone,
    maptilerKey: config.external.maptilerKey || null,
    mailEnabled: config.mail.enabled,
  });
});

/** GET /api/health - liveness/readiness for PM2, Nginx, uptime robots. */
router.get('/health', (req, res) => {
  const dbState = mongoose.connection.readyState; // 1 = connected
  res.status(dbState === 1 ? 200 : 503).json({
    status: dbState === 1 ? 'ok' : 'degraded',
    db: ['disconnected', 'connected', 'connecting', 'disconnecting'][dbState] || 'unknown',
    uptimeSec: Math.round(process.uptime()),
    timestamp: new Date(),
  });
});

module.exports = router;
