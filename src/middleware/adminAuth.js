/**
 * Lightweight admin gate for mutating endpoints. If ADMIN_API_KEY is unset
 * (default in development) mutations are open; once set, requests must send
 * header `X-Admin-Key`. For production, put the whole app behind the
 * department SSO / reverse-proxy auth as described in DEPLOYMENT.md.
 */
const config = require('../config');

module.exports = function adminAuth(req, res, next) {
  if (!config.adminKey) return next();
  if (req.get('X-Admin-Key') === config.adminKey) return next();
  res.status(401).json({ error: 'admin key required (X-Admin-Key header)' });
};
