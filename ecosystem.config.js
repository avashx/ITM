/**
 * PM2 process file for production (see DEPLOYMENT.md).
 * Single instance ONLY: the cron scheduler must not run in multiple processes,
 * and Socket.io would need a Redis adapter under cluster mode.
 *
 * Usage on the server:
 *   pm2 start ecosystem.config.js
 *   pm2 save && pm2 startup systemd
 */
module.exports = {
  apps: [
    {
      name: 'it-monitor',
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '300M',
      time: true, // timestamps in pm2 logs
      env: {
        NODE_ENV: 'production',
        // Everything else (MONGODB_URI, SMTP_*, ADMIN_API_KEY...) comes from
        // the .env file next to server.js - never hardcode secrets here.
      },
      // modest restart hygiene
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 8000, // matches the graceful-shutdown window in server.js
    },
  ],
};
