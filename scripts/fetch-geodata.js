/**
 * (Re-)download the Delhi boundary files into data/geo/. The repository
 * already ships these files vendored (licences permit it - see
 * DATA_SOURCES.md); run this only to refresh them from their origins.
 *
 * Usage: node scripts/fetch-geodata.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');
const log = require('../src/utils/logger')('fetch-geodata');

const GEO_DIR = path.join(__dirname, '../data/geo');

const SOURCES = [
  {
    file: 'delhi_districts.geojson',
    url: 'https://raw.githubusercontent.com/datta07/INDIAN-SHAPEFILES/master/STATES/DELHI/DELHI_DISTRICTS.geojson',
    attribution: 'datta07/INDIAN-SHAPEFILES (MIT)',
  },
  {
    file: 'delhi_assembly.geojson',
    url: 'https://raw.githubusercontent.com/datta07/INDIAN-SHAPEFILES/master/STATES/DELHI/DELHI_ASSEMBLY.geojson',
    attribution: 'datta07/INDIAN-SHAPEFILES (MIT)',
  },
  {
    file: 'delhi_wards.geojson',
    url: 'https://raw.githubusercontent.com/datameet/Municipal_Spatial_Data/master/Delhi/Delhi_Wards.geojson',
    attribution: 'DataMeet Municipal_Spatial_Data (CC-BY-SA 2.5 IN)',
  },
  {
    file: 'delhi_boundary.geojson',
    url: 'https://raw.githubusercontent.com/datameet/Municipal_Spatial_Data/master/Delhi/Delhi_Boundary.geojson',
    attribution: 'DataMeet Municipal_Spatial_Data (CC-BY-SA 2.5 IN)',
  },
];

function download(url, dest) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { 'User-Agent': 'IT-Monitor-geodata-fetch/1.0' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(download(res.headers.location, dest));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
      })
      .on('error', reject);
  });
}

async function main() {
  fs.mkdirSync(GEO_DIR, { recursive: true });
  for (const s of SOURCES) {
    const dest = path.join(GEO_DIR, s.file);
    log.info(`downloading ${s.file} from ${s.attribution}...`);
    try {
      await download(s.url, dest);
      const parsed = JSON.parse(fs.readFileSync(dest, 'utf8'));
      log.info(`  ok - ${parsed.features.length} features`);
    } catch (err) {
      log.error(`  failed: ${err.message} (vendored copy in the repo remains usable)`);
    }
  }
}

main();
