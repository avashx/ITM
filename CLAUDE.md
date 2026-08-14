# CLAUDE.md - Project Context for AI Agents

Context file for Claude Code and other AI agents working on this repository.
Read this before making changes. Human-facing docs: [README.md](README.md).

## What this is

**IT Monitor** - a GNCTD (Govt. of NCT of Delhi) civic-tech platform, three modules in
one Node.js app:

1. **Uptime monitor** - cron probes 85 researched Delhi-government service URLs every
   5 min; uptime/latency/SSL tracking; incidents after 3 consecutive fails; email +
   Socket.io alerts; public status page.
2. **Grievance analytics** - keyword-NLP classification of citizen complaints into
   15 departments / 39 PGMS-style categories; Leaflet heatmap/choropleth over real
   Delhi boundaries; SLA breach tracking (PGMS norms: respond 7d, resolve 30d, SOS 3d).
3. **Correlation engine** (the differentiator) - links service outages to complaint
   spikes (trailing-28-day baseline, Poisson z-score); predicts surges from live
   outages and alerts departments proactively.
4. **Assistant (RAG chat)** - natural-language chat drawer on every page,
   answering only from this platform's own data via three retrieval lanes
   (live state / exact DB aggregate / vector search over an embedded corpus).

Owner: Aman Vashishth (intern, IT Dept, GNCTD). Solo project, zero budget - free
tiers and open source only. Stack: Node >= 18 CommonJS, Express, Mongoose, Socket.io,
node-cron, Nodemailer, vanilla-JS front-end with vendored Leaflet + Chart.js (no CDN).

## Run / seed / verify

```bash
npm install
cp .env.example .env          # every var documented inline; see API_KEYS.md
npm run seed                  # FULL DEMO: wipes monitor history + synthetic grievances
                              #   + 3 fabricated outage scenarios + insights
npm run seed:endpoints        # PRODUCTION: catalogue only, upsert by URL, keeps history
npm run seed:grievances       # synthetic grievances only (doesn't touch monitor data)
npm run rag:index             # build/refresh the assistant's vector index
                              #   (incremental; --dry to price it, --force to redo)
npm run verify:endpoints      # one-shot real HTTP probe of the 85-URL catalogue
SIMULATE_CHECKS=true npm start  # demo mode - NO real traffic to govt servers
npm start                     # real monitoring (default)
```

Pages: `/` status page · `/dashboard.html` ops · `/grievances.html` heatmap ·
`/correlation.html` insights. API reference: [API.md](API.md).

## Repository map

```
server.js                     boot: db -> http -> socket -> schedulers
src/config/                   env config (index.js) + mongoose connect (db.js)
src/models/                   7 schemas; barrel in index.js
src/modules/monitor/          checker (raw http/https probe), simulator, scheduler
                              (cron loop + backoff + rollups), incidents (alerting)
src/modules/grievance/        classifier (keyword NLP), sla, analytics
src/modules/correlation/      engine (spike detection), predictor (surge forecast)
src/routes/                   *.routes.js per module + meta (geo layers, config, health)
src/services/                 socket.js (emit-safe hub), mailer.js (nodemailer),
                              llm.js (provider layer), assistant.js (chat + prompt)
src/services/rag/             chunker (corpus), indexer (embed+upsert),
                              store (in-process vector search), retriever (3 lanes)
public/                       4 static pages + js/ per page + css/style.css
data/endpoints.json           THE endpoint catalogue (source of truth; ENDPOINTS.md
                              table is generated from it)
data/reference/departments.json  taxonomy + classifier keywords
data/geo/                     real boundaries: 11 districts, 70 ACs, 290 wards, outline
scripts/                      seeders (lib/grievance-generator.js, lib/rng.js),
                              verify-endpoints.js, fetch-geodata.js
docs/                         EXECUTIVE_BRIEF, RESEARCH_FINDINGS, screenshots/
```

## Hard rules (do not break)

1. **Polite monitoring is non-negotiable.** One lightweight GET per service per 5 min,
   honest `MONITOR_USER_AGENT`, 10s timeout, exponential backoff on failures
   (`BACKOFF_MINUTES` in scheduler.js), small concurrency batches. Never add retries,
   crawling, auth probing, or shorter intervals without explicit owner sign-off.
2. **Synthetic data stays labelled.** Generated records carry `source: "synthetic"`
   and `SYN-` grievance IDs. Never silently mix synthetic and real records. UI and
   docs must keep saying data is synthetic until real feeds are connected.
3. **No secrets in git.** `.env` is git-ignored and contains real Atlas credentials -
   never print, commit, or log its values. New vars go in `.env.example` + API_KEYS.md.
4. **Engine portability.** Queries must run on any MongoDB-wire engine (verified
   against FerretDB/SQLite). Analytics deliberately use lean queries + in-process
   reducers instead of exotic aggregation stages - keep that pattern.
5. **No new runtime deps without strong reason.** Front-end libs are served from
   `node_modules` via `/vendor/*` mounts in `src/app.js` - no CDN URLs anywhere.
6. **Timezone:** all cron + day-bucketing is IST (`TZ=Asia/Kolkata`). Day buckets are
   `YYYY-MM-DD` strings computed at write time (`src/utils/dates.js`) - group on them,
   don't re-derive dates in queries.
7. **The assistant never computes a statistic.** Every number in an answer must come
   from the structured lane (a MongoDB aggregate) or the live snapshot, and the
   system prompt says so. If you add a metric the assistant should be able to quote,
   add it to `computeAggregate()` in `src/services/rag/retriever.js` - do NOT relax
   the prompt and let the model do arithmetic over retrieved passages.
8. **The assistant degrades, never breaks.** OpenAI -> Anthropic -> deterministic
   responder, and the UI labels which one answered on every single reply. Never let
   a rule-based answer render as if it were AI, and never let a missing key 500.

## Gotchas learned the hard way

- **Never write `*/5` inside a JS block comment** - `*/` terminates the comment and
  breaks the file (bit us once in scheduler.js).
- Ward GeoJSON is the **pre-2022 map (290 ward/charge polygons)**, not the current 250
  wards - documented in DATA_SOURCES.md with the OpenCity 2022 drop-in upgrade path.
  Districts (11) and assembly constituencies (70) are current.
- Some govt sites answer **403 to non-browser clients**: that means alive-but-blocking.
  Fix per endpoint via `acceptableStatuses` in `data/endpoints.json`, then
  `npm run seed:endpoints` (upserts, keeps history).
- `seed-demo.js` **wipes** monitor history + synthetic grievances (not real ones).
  Don't run it against a production DB that has accumulated real checks.
- Socket hub (`src/services/socket.js`) is emit-safe before init - seed scripts can
  import modules that emit without a server running.
- The scheduler intentionally runs in **one process** - no PM2 cluster mode, or cron
  cycles and Socket.io both break (see DEPLOYMENT.md).
- Classifier confidence = winner share of total keyword score; generator reports
  classifier agreement (~98%) on every seed as a regression signal - if it drops after
  editing keywords/templates, you broke alignment between them.

## How to extend (common asks)

- **Add/remove monitored endpoint** -> edit `data/endpoints.json` (include
  `relatedGrievanceCategories` so Module 3 can correlate), run `npm run seed:endpoints`,
  regenerate the ENDPOINTS.md table (script snippet in git history / trivial from JSON).
- **New grievance category** -> `data/reference/departments.json` (classifier + UI pick
  it up); add templates in `scripts/lib/grievance-generator.js` for demo data.
- **New alert type** -> enum in `src/models/Alert.js` + `raiseAlert()` call + API.md row.
- **Real grievance feed** -> transform to the POST shape in API.md and bulk-import via
  `POST /api/grievances/import` (max 5000/call, `X-Admin-Key` if set).

## Verification expectations

Before committing nontrivial changes: `node --check` changed files, run the seed
against a scratch DB, boot with `SIMULATE_CHECKS=true`, and click through all four
pages (or headless-render them) checking the browser console for errors. All four
pages currently render clean; keep it that way.

## Current deployment state (July 2026)

- GitHub: `avashx/ITM`, default branch `main` (PR #1 merged the full platform).
- Database: MongoDB Atlas M0 (`itmonitor` db) - URI lives only in local `.env`.
- Target production topology: single small VM (AWS EC2 free tier) + PM2
  (`ecosystem.config.js`) + Nginx websocket proxy -> see DEPLOYMENT.md.
  `render.yaml` exists for one-click Render deploys (free tier sleeps after 15 min
  idle - acceptable for demos, wrong for real 24/7 monitoring).
