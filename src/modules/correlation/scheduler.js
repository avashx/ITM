/**
 * Correlation module scheduling:
 *  - nightly engine run (CORRELATION_CRON) to mine new outage->spike insights
 *  - hourly predictor pass over open incidents with notifications on
 */
const cron = require('node-cron');
const config = require('../../config');
const engine = require('./engine');
const predictor = require('./predictor');
const log = require('../../utils/logger')('correlation-cron');

let tasks = [];

function start() {
  tasks.push(
    cron.schedule(
      config.correlation.cron,
      async () => {
        try {
          await engine.run({});
        } catch (err) {
          log.error(`engine run failed: ${err.message}`);
        }
      },
      { timezone: config.timezone }
    )
  );
  tasks.push(
    cron.schedule(
      '5 * * * *',
      async () => {
        try {
          await predictor.predictOpenOutages({ notify: true });
        } catch (err) {
          log.error(`predictor run failed: ${err.message}`);
        }
      },
      { timezone: config.timezone }
    )
  );
  log.info(`correlation schedules active (engine="${config.correlation.cron}", predictor=hourly)`);
}

function stop() {
  tasks.forEach((t) => t.stop());
  tasks = [];
}

module.exports = { start, stop };
