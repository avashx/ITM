/** Async route wrapper + centralized error responses. */
const log = require('../utils/logger')('http');

/** Wrap an async handler so rejections reach the error middleware. */
const asyncRoute = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

function notFound(req, res) {
  res.status(404).json({ error: 'not found', path: req.originalUrl });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || (err.name === 'ValidationError' ? 400 : 500);
  if (status >= 500) log.error(`${req.method} ${req.originalUrl}: ${err.message}`, err.stack);
  res.status(status).json({
    error: status >= 500 ? 'internal server error' : err.message,
    ...(process.env.NODE_ENV !== 'production' && status >= 500
      ? { detail: err.message }
      : {}),
  });
}

module.exports = { asyncRoute, notFound, errorHandler };
