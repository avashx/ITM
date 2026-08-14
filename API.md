# API.md - REST + Socket.io Reference

Base URL: `http://localhost:3000` (adjust for deployment). All responses are JSON.
Mutating endpoints require header `X-Admin-Key: <ADMIN_API_KEY>` **only if**
`ADMIN_API_KEY` is set in `.env`.

## Conventions

- Dates are ISO-8601 UTC; day buckets are `YYYY-MM-DD` strings in IST (`Asia/Kolkata`).
- Common query filters: `days=<n>` (trailing window), or `from`/`to` (day buckets),
  `department`, `category`, `status`, `priority`, `district`, `ward`.
- Errors: `{"error": "<message>"}` with appropriate HTTP status (400/401/404/500).

---

## Meta

### `GET /api/health`
Liveness/readiness. `200` when MongoDB is connected, else `503`.
```json
{ "status": "ok", "db": "connected", "uptimeSec": 1234, "timestamp": "..." }
```

### `GET /api/meta/config`
Non-secret config for the UI: `{ simulate, checkCron, failThreshold,
degradedLatencyMs, timezone, maptilerKey, mailEnabled }`.

### `GET /api/meta/geo/:layer`
Vendored GeoJSON. `:layer` ∈ `districts` (11) | `wards` (290) | `assembly` (70) |
`boundary` (1). Cached 24h.

---

## Module 1 - Services & status

### `GET /api/services`
All services with live state + uptime windows. Filters: `category`, `department`,
`status`.
```json
[{ "_id": "...", "name": "e-District Delhi (legacy portal)", "url": "https://...",
   "department": "Revenue Department", "category": "Certificates & e-District",
   "relatedGrievanceCategories": ["Certificates (e-District)", "Portal & e-Service Issues"],
   "state": { "status": "operational", "lastCheckAt": "...", "lastLatencyMs": 412,
              "consecutiveFails": 0, "ssl": { "validTo": "...", "daysRemaining": 44 } },
   "uptime": { "d1": 100, "d7": 99.9, "d30": 99.1, "d90": 99.7 } }]
```

### `GET /api/services/:id`
One service + `checks` (raw, `?hours=24`, max 7 days), `incidents` (last 20),
`daily` (90-day rollups), `uptime`.

### `GET /api/services/:id/checks?hours=24`
Raw check results: `[{ checkedAt, ok, httpStatus, latencyMs, error, mode }]`
(`mode`: `live` | `simulated` | `seeded`).

### `POST /api/services` *(admin)*
Register an endpoint. Required: `name`, `url`, `department`, `category`.
Optional: `description`, `relatedGrievanceCategories[]`, `acceptableStatuses[]`
(HTTP codes treated as UP besides 200-399), `checkSsl`. Returns `201` + document.

### `PUT /api/services/:id` *(admin)* / `DELETE /api/services/:id` *(admin)*
Update allowed fields / delete a service (cascades its checks & rollups).

### `GET /api/status/summary`
Everything the public status page needs in one call:
```json
{ "overall": "operational|degraded|outage", "simulated": false,
  "totals": { "services": 85, "operational": 82, "degraded": 3, "down": 0 },
  "days": ["2026-04-09", "..."],
  "categories": [{ "category": "Water (DJB)", "services": [
     { "id": "...", "name": "...", "status": "operational", "latencyMs": 380,
       "uptime90": 99.7, "bars": [100, 100, null, 97, "..."] }]}],
  "activeIncidents": [ ... ] }
```
`bars` = 90 daily uptime percentages (null = no data that day).

### `GET /api/status/incidents?active=true&days=30`
Incidents, newest first, populated with service name/department.

### `GET /api/status/alerts?limit=50&type=outage`
Alert audit trail. `type` ∈ `outage|recovery|ssl_expiry|surge_prediction|info`.

### `GET /api/status/ssl`
Certificate board sorted by soonest expiry:
`[{ name, url, department, validTo, issuer, daysRemaining, checkedAt }]`.

---

## Module 2 - Grievances

### `GET /api/grievances`
Paginated list. Filters above plus `q` (regex text search), `page`, `limit` (<= 200).
Returns `{ page, limit, total, pages, items }`.

### `POST /api/grievances`
Register one grievance. Only `description` is required - department/category are
auto-classified via keyword NLP when omitted.
```json
{ "description": "No water supply in Rohini since two days",
  "priority": "normal|urgent|sos", "channel": "web|mobile_app|call_1076|janta_samvad|letter",
  "district": "North West", "ward": "Rohini-A", "lat": 28.74, "lng": 77.11,
  "registeredAt": "2026-07-01T09:00:00Z" }
```
Response `201` includes assigned `grievanceId`, classification metadata and computed
SLA deadlines (`sla.responseDueAt`, `sla.resolutionDueAt`).

### `POST /api/grievances/import` *(admin)*
Bulk import (max 5000/call): `{ "items": [ <same shape as POST> ], "source": "import" }`
-> `{ inserted, errors: [{index, error}] }`. Use for CSV/open-data loads.

### `POST /api/grievances/classify`
Dry-run the classifier: `{ "description": "..." }` ->
`{ department, category, confidence, matchedKeywords }`.

### `PATCH /api/grievances/:id/status` *(admin)*
Workflow transition: `{ "status": "registered|in_progress|resolved|rejected" }`.
Sets `firstResponseAt` / `resolvedAt` / `resolutionHours` automatically.

### `GET /api/grievances/meta/departments`
Taxonomy: `[{ name, code, categories: [...] }]` (15 departments, 39 categories).

### Analytics (all accept the common filters)

| Endpoint | Returns |
|---|---|
| `GET /api/grievances/stats/summary` | totals, byStatus, byPriority, SLA breach counts + rate, avg/median resolution hours |
| `GET /api/grievances/stats/departments` | per-department scorecard: total, open, resolved, slaBreachPct, avgResolutionDays |
| `GET /api/grievances/stats/trends?days=30` | `{ days[], total[], departments: [{department, counts[]}] }` (top 6) |
| `GET /api/grievances/stats/categories?limit=15` | top categories with counts |
| `GET /api/grievances/stats/heatmap` | `[[lat, lng, weight], ...]` for Leaflet.heat (weight by priority) |
| `GET /api/grievances/stats/choropleth?level=district\|ward` | `{ level, counts: {"North West": 445, ...} }` - join client-side onto the geo layers |
| `GET /api/grievances/stats/points?limit=2000` | recent geolocated grievances for the cluster layer |

---

## Module 3 - Correlation

### `GET /api/correlation/insights?department=&category=&minConfidence=low|medium|high`
Detected outage->spike patterns, newest first:
```json
[{ "serviceName": "e-District Delhi (legacy portal)",
   "department": "Revenue Department", "category": "Certificates (e-District)",
   "outage": { "startedAt": "...", "resolvedAt": "...", "durationHours": 6.2 },
   "window": { "from": "...", "to": "...", "days": ["2026-06-16", "2026-06-17", "2026-06-18"] },
   "baselineDailyMean": 4.75, "observedTotal": 35, "expectedTotal": 14.2,
   "spikeRatio": 2.46, "zScore": 5.5, "confidence": "high",
   "narrative": "e-District Delhi (legacy portal) was down 6.2h starting Tue, 16 Jun; ..." }]
```

### `GET /api/correlation/timeline?category=Water%20Billing&days=60`
(or `?department=...`) Daily complaint counts + outage windows of mapped services for
chart overlays: `{ days[], counts[], outages: [{service, startedAt, resolvedAt,
durationHours, status}] }`.

### `GET /api/correlation/predictions`
Live surge forecasts for currently-open outages:
`[{ serviceName, category, department, outageOpenHours, baselineDaily,
predictedRatio, predictedExtraPerDay, message }]`.

### `POST /api/correlation/run` *(admin)*
Trigger the engine scan now (`{ "lookbackDays": 90 }`) instead of waiting for the
nightly cron. Returns `{ created, insights }`. Idempotent per incident+category.

---

## Assistant (RAG chat over the platform's own data)

Every answer is assembled at request time from three retrieval lanes and the
model is instructed to use nothing else:

| Lane | Source | What it supplies |
|---|---|---|
| **live** | current DB state, never indexed | what's down now, open incidents, SSL expiry, active surge forecasts |
| **structured** | exact aggregate computed by MongoDB | counts, percentages, per-department/district breach rates — the numbers the model quotes verbatim instead of deriving |
| **vector** | embedded corpus (`ragchunks`) | SLA policy, department taxonomy, service catalogue, complaint themes, correlation findings, documentation |

The structured lane is what keeps numbers honest: a count is computed by the
database and handed over, so the model reads a figure rather than inventing one.

### `GET /api/assistant/meta`
Panel bootstrap:
```json
{ "mode": "rag"|"rules", "provider": "openai"|"anthropic"|null, "model": "gpt-4.1-mini",
  "retrieval": { "vectorLane": true, "structuredLane": true, "liveLane": true,
                 "index": { "chunks": 13161, "byKind": {...}, "builtAt": "...", "dims": 256 } },
  "suggested": ["What's down right now?", "..."] }
```

### `POST /api/assistant/chat` *(streaming)*
`{ "messages": [{ "role": "user", "content": "Which department has the worst SLA?" }] }`

Responds as **Server-Sent Events**:

| Event | Payload |
|---|---|
| `token` | `{ text }` — one fragment of the answer |
| `done` | the full result (below) |
| `error` | `{ error }` |

Send the whole conversation in `messages` (max 24, last one must be `user`,
question ≤ 500 chars) — follow-ups are resolved against the previous turn.

### `POST /api/assistant/ask`
Same answer, non-streaming. Accepts `{ question }` or `{ messages }`:
```json
{ "answer": "...", "mode": "rag", "provider": "openai", "model": "gpt-4.1-mini",
  "sources": [{ "n": 1, "kind": "cluster", "title": "...", "citation": "...",
                "dataSource": "synthetic", "score": 0.74 }],
  "metrics": { "retrievalMs": 380, "generationMs": 900, "totalMs": 1280,
               "chunksSearched": 13161, "recordsAggregated": 1344 },
  "grounding": { "filters": { "district": "North West" },
                 "matched": ["district = North West"] } }
```
If the LLM call fails, the response degrades to `mode: "rules"` with a `note`
explaining why — the panel never breaks on a dead or out-of-credit key.

### `GET /api/assistant/retrieve?q=...`
**Retrieval only, no generation.** Returns the exact passages, filters and
aggregate a question would be answered from, with per-lane timings. This is the
endpoint to reach for when an answer looks wrong — it shows whether the fault
was retrieval or generation.

### `GET /api/assistant/context`
The live snapshot on its own.

### `GET /api/assistant/index`
Vector index health: `{ chunks, byKind, builtAt, embedModel, dims, loaded }`.

### `POST /api/assistant/index/rebuild?force=true` *(admin)*
Re-embed the corpus. Admin-guarded because it spends money on the embeddings
API. Incremental unless `force=true`. The CLI equivalent is `npm run rag:index`.

## Socket.io events (server -> client)

Connect with the standard client (served at `/socket.io/socket.io.js`); no auth
required for read-only events.

| Event | Payload | When |
|---|---|---|
| `check:result` | `{ serviceId, name, ok, httpStatus, latencyMs, error, status, checkedAt, mode }` | every completed probe |
| `service:status_change` | `{ serviceId, name, from, to, at }` | status transition |
| `monitor:cycle` | `{ at, checked, up, down, tookMs, simulated }` | end of each 5-min cycle |
| `incident:opened` | `{ incidentId, serviceId, serviceName, startedAt, error }` | 3rd consecutive failure |
| `incident:closed` | `{ incidentId, serviceId, serviceName, durationHours }` | recovery |
| `alert:new` | `{ id, type, severity, title, message, createdAt }` | any alert raised |
| `grievance:new` | `{ id, grievanceId, department, category, district, priority, registeredAt }` | grievance registered via API |
| `correlation:insight` | `{ id, serviceName, category, spikePct, confidence, narrative }` | engine finds a pattern |

## Data model (collections)

`serviceendpoints`, `checkresults` (TTL 30d), `dailyuptimes` (permanent rollups),
`incidents`, `grievances`, `alerts`, `correlationinsights` - see `src/models/*.js`
for the authoritative schemas with inline documentation.
