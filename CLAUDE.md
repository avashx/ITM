# CLAUDE.md - Project Context for AI Agents

Context file for AI coding agents (Claude Code, etc.) working on this repository.
Read this before making changes. Human-facing docs live in README.md and friends;
this file is the fast path to *how the codebase actually works and why*.

## What this project is

**IT Monitor** - a civic-tech platform for the Government of NCT of Delhi (GNCTD),
built by Aman Vashishth (Intern, IT Department, GNCTD). One Node.js app, three modules:

1. **Uptime monitor** (`src/modules/monitor/`) - probes 85 researched GNCTD public
   service URLs every 5 min; tracks uptime/latency/HTTP errors/SSL expiry; opens
   incidents after 3 consecutive failures; emails alerts; public status page.
2. **Grievance analytics** (`src/modules/grievance/`) - keyword-NLP classification of
   citizen complaints into 15 departments / 39 PGMS-style categories; Leaflet
   heatmap/choropleth over real Delhi boundaries; SLA breach tracking (PGMS norms:
   respond 7d, resolve 30d, SOS 3d).
3. **Correlation engine** (`src/modules/correlation/`) - the differentiator. Links
   service outages to complaint spikes (trailing-28-day baseline, Poisson z-score;
   thresholds ratio >= 1.3, z >= 2.0) and *predicts* complaint surges from live
   outages, alerting departments proactively.

Stack: Node >= 18 CommonJS, Express 4, Mongoose 8, Socket.io 4, node-cron, Nodemailer,
vanilla-JS front-end with vendored Leaflet + Chart.js (served from node_modules via
`/vendor/*` mounts - **no CDN, works offline/air-gapped**).

## Commands

```bash
npm install
cp .env.example .env             # defaults work with local MongoDB
npm run seed                     # FULL demo: endpoints + 90d history + synthetic
                                 # grievances + outage scenarios + insights (destructive)
npm run seed:endpoints           # production path: catalogue only, idempotent upsert
npm run seed:grievances          # synthetic grievances only (--days --scale --seed --keep)
npm run verify:endpoints         # one-shot HTTP probe of all 85 URLs (needs internet, no DB)
npm run fetch:geodata            # refresh data/geo/*.geojson from origins
SIMULATE_CHECKS=true npm start   # demo mode - NO real HTTP to govt servers
npm start                        # real monitoring
npm run dev                      # --watch auto-restart
```

No test framework and no linter are configured. Verify changes with:
`node --check <files>`, then `npm run seed` against a scratch DB, then start in
simulate mode and click through all four pages (`/`, `/dashboard.html`,
`/grievances.html`, `/correlation.html`). Every page must load with zero console
errors.

## Architecture in 30 seconds

- `server.js` boots: Mongo connect -> Express app (`src/app.js`) -> Socket.io
  (`src/services/socket.js`) -> monitor scheduler -> correlation schedules.
- **Data flow (Module 1):** `scheduler.runCycle()` -> `checker.probe()` (or
  `simulator.simulateProbe()` when `SIMULATE_CHECKS=true`) -> writes `CheckResult`
  (raw, TTL 30d) + upserts `DailyUptime` (permanent per-day rollup) + updates
  `ServiceEndpoint.state` (live state machine) -> `incidents.js` opens/resolves
  `Incident` docs and raises `Alert`s (email via `mailer.js` + socket emit).
- **Module 3 depends on the mapping** `ServiceEndpoint.relatedGrievanceCategories`
  (set in `data/endpoints.json`): outage of service X is tested against those
  grievance categories. Category names MUST match `data/reference/departments.json`
  exactly.
- Socket events are fire-and-forget through `src/services/socket.js` whose `emit()`
  is a no-op until `init()` - this is why seed scripts can require modules that emit.
- All uptime/status reads come from `DailyUptime` rollups, never raw checks.

## Conventions that are deliberate (do not "fix")

1. **Day buckets are IST strings.** `dayBucket` fields hold `YYYY-MM-DD` computed in
   `Asia/Kolkata` at write time (`src/utils/dates.js`). All grouping/trends/correlation
   joins on these strings. Never group on raw Date fields.
2. **Analytics use lean queries + in-process JS reducers**
   (`src/modules/grievance/analytics.js`), NOT aggregation pipelines. This is for
   portability across MongoDB-wire engines (Atlas, DocumentDB, FerretDB) and is fast
   at the bounded volumes involved. Don't rewrite to exotic aggregation stages.
3. **Polite monitoring is non-negotiable.** 5-min cadence, honest User-Agent,
   10s timeout, concurrency 8, exponential backoff (`BACKOFF_MINUTES` ladder in
   `scheduler.js`) for failing endpoints. Anything increasing request volume to
   government servers needs strong justification.
4. **Synthetic data stays labelled**: `source: "synthetic"`, IDs prefixed `SYN-`.
   Real ingested data must never be silently mixed with it. Seeds only ever delete
   `{source: 'synthetic'}` grievances.
5. **No new runtime dependencies without need.** Current set is minimal on purpose
   (government deployment). Front-end stays vanilla JS, libraries only via the
   `/vendor/*` static mounts defined in `src/app.js`.
6. **Status colors** (`--good/--warning/--critical` in `public/css/style.css`) are
   reserved for state and always paired with text labels - never color alone.
   Series colors come from the `--series-N` custom properties.
7. Every file opens with a block comment stating what it does and why. Logging goes
   through `src/utils/logger.js` scoped loggers - no bare `console.log` in `src/`
   (scripts printing reports are the exception).

## Data files (the researched deliverables)

- `data/endpoints.json` - **source of truth** for the 85-service catalogue.
  `verification.method` is `search-confirmed` (2026-07-07) or `well-known`.
  ENDPOINTS.md's table is *generated from this file* - regenerate it if you edit
  (the header/footer are hand-written; rows come from the JSON).
- `data/reference/departments.json` - taxonomy + classifier keywords. The classifier
  (`src/modules/grievance/classifier.js`) compiles regexes from it at load; phrases
  score 3, single words 1, word-boundary matched.
- `data/geo/*.geojson` - REAL boundaries: 11 districts (`dtname` prop),
  70 assembly constituencies (`AC_NAME`), 290 wards (`Ward_Name`/`Ward_No`),
  NCT boundary. Served via `GET /api/meta/geo/:layer`, cached in memory.

## Known caveats / gotchas

- **Ward map is pre-2022** (290 ward/charge polygons). Post-2022 MCD has 250 wards;
  the 2022 file (OpenCity, manual download) is a drop-in replacement if its props are
  mapped to `Ward_Name`/`Ward_No`. Documented in DATA_SOURCES.md §1. Don't fabricate
  a 250-ward geometry.
- **Endpoint URLs were compiled in a sandbox that blocked HTTP to govt sites** - they
  are search-verified, not same-day probed. `npm run verify:endpoints` re-verifies.
  Some govt sites 403 non-browser clients: add the code to that endpoint's
  `acceptableStatuses` rather than treating it as down.
- **Don't write `*/5` (or any `*/`) inside block comments** - it terminates the
  comment. This bit once already (scheduler.js cron docs).
- E2E verification in restricted sandboxes: real MongoDB may be uninstallable; the
  original build was verified against **FerretDB 1.x sqlite** (build from source
  needs `build/version/version.txt` stuffed with `v1.24.0` - see
  docs/RESEARCH_FINDINGS.md §6) + `SIMULATE_CHECKS=true`. Playwright chromium lives
  at `/opt/pw-browsers/chromium-*/chrome-linux/chrome` in Claude Code cloud sandboxes.
- `evaluateBreaches()` computes SLA breach flags at read time (so open grievances
  can breach as time passes); stored `sla.*Breached` flags are point-in-time
  conveniences written by seeds - don't trust them for live queries.
- The correlation engine is **idempotent** per incident+category (unique index on
  CorrelationInsight); re-running `POST /api/correlation/run` is safe.
- `ADMIN_API_KEY` empty (default dev) = mutations open; set = require `X-Admin-Key`
  header. Mutating routes: service CRUD, grievance import/status, correlation run.

## How to extend (common asks)

- **Add a monitored endpoint** -> append to `data/endpoints.json` (include
  `relatedGrievanceCategories` if its outages should feed Module 3), run
  `npm run seed:endpoints`, regenerate the ENDPOINTS.md table.
- **Add a grievance category** -> `data/reference/departments.json` (keywords) ->
  classifier + UI filters pick it up automatically; add templates in
  `scripts/lib/grievance-generator.js` if it should appear in demo data.
- **Add an alert type** -> extend `Alert` schema enum, call
  `incidents.raiseAlert()`, document in API.md.
- **Connect real grievance data** -> transform to the POST shape in API.md and bulk
  import via `/api/grievances/import` (max 5000/call); set `source: "import"`.

## Pointers

| Need | File |
|---|---|
| Env vars (all documented) | `.env.example`, config loader `src/config/index.js` |
| REST + socket contract | `API.md` |
| Deploy (EC2/PM2/Nginx) | `DEPLOYMENT.md` |
| Research provenance & verification honesty | `docs/RESEARCH_FINDINGS.md` |
| Non-technical pitch | `docs/EXECUTIVE_BRIEF.md` |
| Contributor rules (mirrors the conventions above) | `CONTRIBUTING.md` |

Branch for ongoing work: `claude/civic-grievance-system-jz8ddb` -> PR #1 on
`avashx/ITM`.
