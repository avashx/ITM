/**
 * Seed synthetic grievances only (Module 2 data).
 *
 * Usage:
 *   node scripts/seed-grievances.js [--days 90] [--scale 0.5] [--seed 42] [--keep]
 *
 * --keep appends instead of replacing previously-seeded synthetic data.
 * Real (manual/import/api) grievances are never touched.
 */
const db = require('../src/config/db');
const { Grievance } = require('../src/models');
const { generate } = require('./lib/grievance-generator');
const log = require('../src/utils/logger')('seed-grievances');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  await db.connect();

  if (!process.argv.includes('--keep')) {
    const { deletedCount } = await Grievance.deleteMany({ source: 'synthetic' });
    if (deletedCount) log.info(`removed ${deletedCount} previously-seeded synthetic grievances`);
  }

  const days = parseInt(arg('days', '90'), 10);
  const scale = parseFloat(arg('scale', '0.5'));
  const seed = parseInt(arg('seed', '20260707'), 10);

  log.info(`generating ~${days} days of synthetic grievances (scale=${scale}, seed=${seed})...`);
  const { docs, agreement } = generate({ days, scale, seed });

  for (let i = 0; i < docs.length; i += 1000) {
    await Grievance.insertMany(docs.slice(i, i + 1000), { ordered: false });
  }
  log.info(`inserted ${docs.length} synthetic grievances`);
  log.info(`keyword-classifier agreement with generator labels: ${agreement}%`);
  await db.disconnect();
}

main().catch((err) => {
  log.error(err.message, err);
  process.exit(1);
});
