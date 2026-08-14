# API_KEYS.md - External Credentials Guide

Every external credential the platform can use, where to obtain it, its free-tier
limits, and the exact environment variable it maps to. **All are optional** - the
platform runs fully without any of them (email alerts disabled, OSM tiles used, open
data pulls skipped). **Never hardcode keys**: everything goes in `.env` (git-ignored);
`.env.example` documents every variable.

## Summary

| Purpose | Provider | Env variable | Free tier | Required? |
|---|---|---|---|---|
| Database | MongoDB Atlas | `MONGODB_URI` | M0 cluster, 512 MB, shared | Yes (or local MongoDB) |
| Email alerts | Gmail App Password | `SMTP_*` | ~500 recipients/day | Optional |
| Email alerts | Brevo (Sendinblue) | `SMTP_*` | 300 emails/day | Optional |
| Open Government Data | data.gov.in | `DATA_GOV_IN_API_KEY` | Free with registration | Optional |
| Map tiles | OpenStreetMap | *(none)* | Fair-use policy | Default |
| Map tiles | MapTiler | `MAPTILER_KEY` | 100k tile requests/mo | Optional |
| Admin API guard | (self-generated) | `ADMIN_API_KEY` | n/a | Recommended in prod |

---

## 1. MongoDB Atlas (`MONGODB_URI`)

1. Register: <https://www.mongodb.com/cloud/atlas/register> (no card needed for M0).
2. Create an **M0 Free** cluster -> region `ap-south-1` (Mumbai).
3. *Database Access*: add a database user (username + strong password).
4. *Network Access*: add your server's IP.
5. *Connect -> Drivers*: copy the string into `.env`:
   ```ini
   MONGODB_URI=mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/itmonitor
   ```
**Free-tier limits:** 512 MB storage, shared vCPU, 500 max connections - ample for this
workload (rollups keep storage small; raw checks are TTL-pruned after 30 days).

## 2. Email alerts via SMTP (`SMTP_HOST/PORT/SECURE/USER/PASS`, `ALERT_EMAIL_FROM/TO`)

Any SMTP relay works (including NIC's own relay for government mail - ask your NIC
coordinator). Two free public options:

### Option A - Gmail App Password
1. Enable 2-Step Verification on the Google account.
2. Google Account -> Security -> **App passwords** -> create one for "Mail".
3. `.env`:
   ```ini
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   SMTP_SECURE=true
   SMTP_USER=yourname@gmail.com
   SMTP_PASS=<16-char app password>
   ALERT_EMAIL_FROM="IT Monitor <yourname@gmail.com>"
   ALERT_EMAIL_TO=you@example.com,noc@example.com
   ```
**Limits:** roughly 500 recipients/day for regular Gmail. Fine for alerting (the
platform de-duplicates: one email per incident open/close, SSL warnings max once/day
per service, surge alerts max once/12h per incident).

### Option B - Brevo (formerly Sendinblue)
1. Register free: <https://www.brevo.com> -> SMTP & API -> SMTP tab -> generate key.
2. `.env`:
   ```ini
   SMTP_HOST=smtp-relay.brevo.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=<your brevo login email>
   SMTP_PASS=<smtp key>
   ```
**Limits:** 300 emails/day free, no card required.

*Leave `SMTP_HOST` empty to disable email entirely - alerts still persist to MongoDB
and stream to the dashboard via Socket.io.*

## 3. data.gov.in / Delhi Open Data (`DATA_GOV_IN_API_KEY`)

For pulling open datasets (grievance statistics, demographics) programmatically from
the Open Government Data platform (<https://www.data.gov.in>, Delhi instance at
<https://delhi.data.gov.in>).

**Registration (free):**
1. Sign up at <https://www.data.gov.in> (email verification).
2. Log in -> **My Account** -> your personal API key is displayed there.
3. `.env`: `DATA_GOV_IN_API_KEY=<your key>`

**Usage pattern** (resource IDs come from each dataset's page):
```
https://api.data.gov.in/resource/<RESOURCE_ID>?api-key=<KEY>&format=json&offset=0&limit=100
```

**Limits:** the OGD platform does not publish a hard rate limit for registered keys
(as of July 2026); a public *sample* key exists for trials but is heavily throttled -
register for your own. Be conservative (the platform's design never needs more than a
few requests/hour).

**Import path:** convert any pulled dataset to the JSON array shape documented in
[API.md](API.md) and POST it to `/api/grievances/import`.

## 4. Map tiles

**Default - OpenStreetMap** (no key): the UI uses `tile.openstreetmap.org` with proper
attribution. OSM's tile usage policy permits light application use; an internal
government dashboard with a handful of concurrent users is well within it. Heavy public
deployments should switch to a provider:

**MapTiler (optional, `MAPTILER_KEY`):**
1. Register free: <https://www.maptiler.com/cloud/> -> Account -> Keys.
2. `.env`: `MAPTILER_KEY=<key>`; the key is exposed to the UI via `/api/meta/config`
   (swap the tile URL in `public/js/grievances.js` to the MapTiler style of your choice).
**Limits:** 100,000 tile requests/month free.

*(Carto basemaps are another free option for non-commercial use - attribution required.)*

## 5. Assistant chat + RAG — OpenAI API (`OPENAI_API_KEY`, optional)

The in-app **Operations Assistant** is a chat drawer on every page. It answers
free-form questions about this platform's own data — what's down, certificate
expiry, complaint volumes by department or district, what counts as an SLA
breach, correlation patterns — and it retrieves before it answers.

**It works with no key at all.** With no key, a deterministic rule-based
responder answers the same questions from the same live data and the UI labels
every reply "Rule-based · live data". That is the zero-budget default and is
genuinely useful — no stub.

**Degradation is layered, so the panel is never dead:**

| Configured | Mode | What you get |
|---|---|---|
| `OPENAI_API_KEY` | full RAG | semantic search over the indexed corpus + exact DB aggregate + live state |
| `ANTHROPIC_API_KEY` only | RAG minus vectors | exact DB aggregate + live state (no embeddings provider) |
| neither | rule-based | deterministic answers from the same data, labelled as such |

1. Get a key: <https://platform.openai.com/api-keys>.
2. `.env`:
   ```ini
   OPENAI_API_KEY=sk-...
   OPENAI_MODEL=gpt-4.1-mini   # optional; this is the default
   ```
3. Build the retrieval index once:
   ```bash
   npm run rag:index          # incremental; safe to re-run
   npm run rag:index -- --dry # show the corpus and cost, spend nothing
   ```
   On a fresh deploy the server builds it automatically on first boot
   (`RAG_AUTO_BUILD=true`), so Render needs nothing but the key.

**Cost.** This is the one component with no free tier, and it is still close to
free at this scale:

| What | Model | Cost |
|---|---|---|
| Full index build (~13,200 chunks / ~1.2M tokens) | `text-embedding-3-small` | **~$0.024, one-time** |
| Incremental rebuild after a seed | same | fractions of a cent — unchanged chunks are never re-embedded |
| One question (~6–10k context tokens) | `gpt-4.1-mini` | **~$0.002** |
| A 20-question demo session | | **under 5 cents** |

There is no monthly minimum. If the key is absent, out of credit, or the API
call fails, the panel falls back to the rule-based responder with a note
explaining why — the platform never breaks or blocks on it. Leave the key unset
to keep the project strictly zero-cost.

**Index size:** ~13,200 vectors at 256 dimensions ≈ **14 MB** in MongoDB, well
inside an Atlas M0's 512 MB. Set `RAG_INDEX_RECORDS=false` for a ~650-chunk
index (themes and policy only, no per-record retrieval) if space is tight.

**Never commit the key.** `.env` is git-ignored; on Render paste it into the
dashboard (`sync: false` in `render.yaml`). If a key is ever pasted into a
chat, a ticket, or a screenshot, rotate it — treat exposure as compromise.

### Anthropic fallback (`ANTHROPIC_API_KEY`, optional)

Used only when `OPENAI_API_KEY` is empty, so the demo survives one provider
running out of credit. Get a key at <https://console.anthropic.com>; set
`ANTHROPIC_MODEL` to override the default. Anthropic serves no embeddings
endpoint here, so this path answers from the structured and live lanes only —
semantic search stays off until an OpenAI key is present.

## 6. Admin API guard (`ADMIN_API_KEY`)

Not an external service - a shared secret you generate yourself:

```bash
openssl rand -hex 24
```

When set, mutating endpoints (create/update/delete service, bulk import, trigger
correlation run, grievance status changes) require header `X-Admin-Key: <value>`.
Leave empty in local development for convenience.

## Security rules

1. `.env` is git-ignored - **never commit it**. Rotate any key that leaks.
2. Use different keys for dev and production.
3. The server only ever exposes `MAPTILER_KEY` to browsers (tiles are client-fetched);
   all other secrets stay server-side.
4. For government production, prefer NIC-provided SMTP and departmental MongoDB over
   external SaaS - the platform is agnostic.
