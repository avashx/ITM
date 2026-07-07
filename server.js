/**
 * IT Monitor - entry point.
 * Boots: MongoDB -> HTTP server -> Socket.io -> monitor scheduler (Module 1)
 * -> correlation schedules (Module 3). Modules degrade gracefully: no SMTP =>
 * no emails (dashboard alerts still work); SIMULATE_CHECKS=true => demo mode.
 */
const http = require('http');
const config = require('./src/config');
const db = require('./src/config/db');
const app = require('./src/app');
const socket = require('./src/services/socket');
const monitorScheduler = require('./src/modules/monitor/scheduler');
const correlationScheduler = require('./src/modules/correlation/scheduler');
const log = require('./src/utils/logger')('server');

async function main() {
  await db.connect();

  const server = http.createServer(app);
  socket.init(server);

  server.listen(config.port, () => {
    log.info(`IT Monitor listening on http://localhost:${config.port} (${config.env})`);
    log.info(
      `status page: /  |  ops dashboard: /dashboard.html  |  grievances: /grievances.html  |  correlation: /correlation.html`
    );
    if (config.monitor.simulate) {
      log.warn('SIMULATE_CHECKS=true - probes are simulated (demo mode), no real HTTP traffic');
    }
    if (!config.mail.enabled) {
      log.warn('SMTP not configured - email alerts disabled (socket/dashboard alerts active)');
    }
  });

  monitorScheduler.start();
  correlationScheduler.start();

  // Graceful shutdown (PM2 reload / Ctrl-C)
  const shutdown = async (signal) => {
    log.info(`${signal} received - shutting down`);
    monitorScheduler.stop();
    correlationScheduler.stop();
    server.close(async () => {
      await db.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 8000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error(`fatal boot error: ${err.message}`, err);
  process.exit(1);
});
