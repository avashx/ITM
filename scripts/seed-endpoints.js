/**
 * Seed the monitored-service catalogue from data/endpoints.json.
 * Idempotent: upserts by URL, so re-running updates metadata without
 * destroying accumulated check history.
 *
 * Usage: node scripts/seed-endpoints.js
 */
const path = require('path');
const fs = require('fs');
const db = require('../src/config/db');
const { ServiceEndpoint } = require('../src/models');
const log = require('../src/utils/logger')('seed-endpoints');

async function main() {
  await db.connect();
  const file = path.join(__dirname, '../data/endpoints.json');
  const { endpoints } = JSON.parse(fs.readFileSync(file, 'utf8'));

  let created = 0;
  let updated = 0;
  for (const e of endpoints) {
    const res = await ServiceEndpoint.updateOne(
      { url: e.url },
      {
        $set: {
          name: e.name,
          department: e.department,
          category: e.category,
          description: e.description || '',
          relatedGrievanceCategories: e.relatedGrievanceCategories || [],
          acceptableStatuses: e.acceptableStatuses || [],
          checkSsl: e.url.startsWith('https:'),
          verification: {
            method: e.verification?.method || '',
            verifiedAt: e.verification?.verifiedAt
              ? new Date(e.verification.verifiedAt)
              : undefined,
            note: e.verification?.note || '',
          },
        },
        $setOnInsert: { enabled: true },
      },
      { upsert: true }
    );
    if (res.upsertedCount) created++;
    else if (res.modifiedCount) updated++;
  }
  log.info(`endpoints seeded: ${created} created, ${updated} updated, ${endpoints.length} total in catalogue`);
  await db.disconnect();
}

main().catch((err) => {
  log.error(err.message, err);
  process.exit(1);
});
