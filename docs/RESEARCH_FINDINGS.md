# Research Findings & Decisions Log

Autonomous research conducted for IT Monitor, **2026-07-07**. This documents what was
discovered, the decisions taken, and the honest limitations - so the next person can
verify and extend without re-doing the work.

## 1. GNCTD service endpoints

**Goal:** compile 50-100 real, live public GNCTD/Delhi service URLs to monitor.

**Result:** **85 endpoints** compiled into [`data/endpoints.json`](../data/endpoints.json)
across 12 status-page categories, spanning: e-District (legacy + new), PGMS/grievance
portals, Revenue/DORIS/land records, Delhi Jal Board, MCD (+ birth/death, NDMC),
Transport/DTC/Parivahan/SARATHI, NFS ration/food supplies, Delhi Police (+ traffic, lost
& found), all four power DISCOMs + SLDC/DERC/Transco/IPGCL, Excise, Trade & Taxes,
Labour, Health/DGEHS/ORS, Education/DoE/SCERT + universities (DTU/NSUT/IPU/DSEU),
DDA/DUSIB, DPCC/Environment/Forest, Social Welfare/WCD/DCW/DCPCR, courts/CEO/Tihar/Fire,
IT/Open Data, and **all 11 District Magistrate sites**.

**Verification approach and its honest limit:** each URL is tagged in the JSON with a
`verification.method`:
- `search-confirmed` - the canonical URL appeared as a live official portal in current
  web-search results on 2026-07-07.
- `well-known` - long-established official government domain compiled from official
  directories/domain knowledge, not individually re-confirmed same-day.

The compilation environment's network policy **blocked direct HTTP requests to
`*.delhi.gov.in` / `*.nic.in`** (proxy returned 403 on CONNECT), so a same-day live HTTP
200 probe of every URL was **not possible from here**. This is mitigated three ways:
1. `scripts/verify-endpoints.js` (`npm run verify:endpoints`) probes all 85 URLs from any
   normal network and prints UP/DOWN/status/latency; `--update` stamps results into
   MongoDB.
2. The monitor re-verifies every endpoint every 5 minutes once running - stale URLs
   surface immediately.
3. `acceptableStatuses` per endpoint handles government sites that answer `403` to
   non-browser clients (a response means the server is alive).

**Notable findings during research:**
- Delhi runs many department sites on the **S3WaaS** platform under `*.delhi.gov.in`
  (newer) alongside legacy `*.delhigovt.nic.in` hosts - both patterns are included where
  relevant, and several services (e-District, DJB, PGMS) exist at *both*.
- **DORIS** property-registration workflows are migrating to **NGDRS**
  (`ngdrs.gov.in`); noted in the entry.
- **Excise ESCIMS** is transitioning to NIC's **e-Abkari**; noted.
- Some services are national portals that *serve* Delhi (Parivahan/SARATHI for RTOs,
  ORS for hospital appointments, NFSA for PDS) - included and labelled by owning body.

## 2. Open data & APIs

- **data.gov.in / delhi.data.gov.in** (Open Government Data Platform): free API keys via
  registration -> **My Account**. Base pattern
  `https://api.data.gov.in/resource/<id>?api-key=<KEY>&format=json`. No hard published
  rate limit for registered keys as of the research date; a throttled public sample key
  exists. Mapped to env var `DATA_GOV_IN_API_KEY`. Import path into the app documented
  (POST `/api/grievances/import`). Full steps in [API_KEYS.md](../API_KEYS.md).
- **CPGRAMS/DARPG** publishes monthly grievance statistics (PDF/report form) including
  Delhi - suitable for manual extraction/benchmarking, no open API.
- **PGMS Delhi** (`pgms.delhi.gov.in`): the GNCTD grievance system; no public API found.
  Its public description (single portal across all departments; petitions categorised as
  grievances/suggestions/requests/service-matters; 7-day response, 30-day resolution,
  2-3 day SOS) directly informed our taxonomy and SLA defaults.

## 3. Geographic boundary data

Downloaded and verified real Delhi boundaries (feature counts confirmed by parsing):
- **11 districts** - datta07/INDIAN-SHAPEFILES `DELHI_DISTRICTS.geojson` (MIT).
- **70 assembly constituencies** - datta07/INDIAN-SHAPEFILES `DELHI_ASSEMBLY.geojson`
  (MIT) - matches Delhi's actual 70 ACs.
- **290 ward/charge polygons** + **NCT boundary** - DataMeet Municipal_Spatial_Data
  (CC-BY-SA 2.5-IN).

**Ward caveat (documented in DATA_SOURCES.md):** the fetchable, licence-clear ward file
is the **pre-2022 (272-ward-era, 290 charge polygons)** map. Post-2022 MCD unification =
**250 wards**; the authoritative 2022 file is on OpenCity (manual download) and is a
drop-in replacement. District (11) and AC (70) layers are current. The task asked for
"250 MCD wards / 70 ACs" - ACs are exact; ward *geometry* uses the historical licensed
file with a clear upgrade path, rather than a fabricated 250-ward map.

## 4. Handling gaps - synthetic data

Real citizen grievance data requires departmental access, so the platform ships a
**clearly-labelled synthetic dataset** (`source: "synthetic"`, `SYN-` IDs) generated to
be statistically realistic: PGMS-style categories, weekly seasonality, per-department
resolution distributions, priority mix, and **points geolocated inside real ward
polygons** with district/AC resolved by point-in-polygon. A built-in check reports the
keyword classifier's agreement with the generator's own labels (**98.4%** on the seeded
run) as a sanity signal. Details in
[DATA_SOURCES.md](../DATA_SOURCES.md) §4.

## 5. API keys - registration, limits, env mapping

Fully documented in [API_KEYS.md](../API_KEYS.md): MongoDB Atlas M0 (`MONGODB_URI`),
Gmail App Password / Brevo SMTP (`SMTP_*`, free 300-500/day), data.gov.in
(`DATA_GOV_IN_API_KEY`), MapTiler (`MAPTILER_KEY`, 100k/mo) with OSM as the keyless
default, and the self-generated `ADMIN_API_KEY`. All free-tier; none hardcoded; every
one has an entry in `.env.example`.

## 6. Verification performed in this environment

Because government sites were unreachable from the sandbox, end-to-end verification used
**FerretDB 1.x (MongoDB-wire-compatible, SQLite backend)** as the database and
**`SIMULATE_CHECKS=true`** for probes. Confirmed working:
- Full demo seed: 85 endpoints, 7,650 daily rollups, ~12.5k synthetic grievances,
  3 seeded outage scenarios + 1 open outage.
- Correlation engine produced 4 real insights (e-District +146% certificates z=5.5;
  DJB +121% water-billing; DJB +50% water-supply; MCD +73% portal issues).
- Surge predictor produced live forecasts for the open NFS outage.
- All REST endpoints and all four UI pages rendered with **zero console errors**
  (screenshots in `docs/screenshots/`).

The same code runs unchanged against real MongoDB/Atlas and real endpoints - only
`MONGODB_URI` and `SIMULATE_CHECKS=false` differ.

## Sources consulted

- data.gov.in / delhi.data.gov.in (OGD Platform India)
- pgms.delhi.gov.in, pgc.delhi.gov.in (PGMS / Public Grievances Commission, Delhi)
- Official department portals across delhi.gov.in / *.delhigovt.nic.in / nic.in
- national portals serving Delhi: parivahan.gov.in, ors.gov.in, nfsa.gov.in
- github.com/datta07/INDIAN-SHAPEFILES; github.com/datameet/Municipal_Spatial_Data
- data.opencity.in (Delhi datasets, 2022 ward map)
