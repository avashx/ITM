/**
 * Minimal structured logger. Zero dependencies so it works everywhere
 * (app, seed scripts, PM2). Levels: debug < info < warn < error.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold =
  LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;

function write(level, scope, msg, extra) {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString();
  const line = `[${ts}] ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}`;
  const args = extra !== undefined ? [line, extra] : [line];
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : console.log)(...args);
}

/** Create a logger bound to a scope name, e.g. logger('monitor'). */
module.exports = function logger(scope) {
  return {
    debug: (msg, extra) => write('debug', scope, msg, extra),
    info: (msg, extra) => write('info', scope, msg, extra),
    warn: (msg, extra) => write('warn', scope, msg, extra),
    error: (msg, extra) => write('error', scope, msg, extra),
  };
};
