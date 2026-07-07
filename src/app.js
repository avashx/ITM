/**
 * Express application: security headers, compression, logging, static UI,
 * vendored front-end libraries (served from node_modules - no CDN dependency,
 * works on air-gapped government networks), and the REST API.
 */
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const config = require('./config');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.use(
  helmet({
    // The UI loads OSM/Carto map tiles + inline bootstrapping; keep CSP
    // pragmatic. Tighten `img-src` if you self-host tiles.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https://*.tile.openstreetmap.org', 'https://*.basemaps.cartocdn.com', 'https://api.maptiler.com'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);
app.use(compression());
app.use(express.json({ limit: '10mb' })); // bulk grievance imports
if (config.env !== 'test') {
  app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));
}

// ---- vendored client libraries (no CDN, no internet needed for the UI) ----
const nm = path.join(__dirname, '../node_modules');
app.use('/vendor/leaflet', express.static(path.join(nm, 'leaflet/dist')));
app.use('/vendor/leaflet.heat', express.static(path.join(nm, 'leaflet.heat/dist')));
app.use('/vendor/leaflet.markercluster', express.static(path.join(nm, 'leaflet.markercluster/dist')));
app.use('/vendor/chartjs', express.static(path.join(nm, 'chart.js/dist')));
// socket.io client is served automatically at /socket.io/socket.io.js

// ---- static UI ----
app.use(express.static(path.join(__dirname, '../public')));

// ---- API ----
app.use('/api/services', require('./routes/services.routes'));
app.use('/api/status', require('./routes/status.routes'));
app.use('/api/grievances', require('./routes/grievances.routes'));
app.use('/api/correlation', require('./routes/correlation.routes'));
app.use('/api/meta', require('./routes/meta.routes'));
// Back-compat alias so /api/health works (documented in API.md)
app.get('/api/health', (req, res, next) => {
  req.url = '/health';
  require('./routes/meta.routes')(req, res, next);
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
