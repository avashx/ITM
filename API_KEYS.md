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

## 5. Assistant panel — Anthropic API (`ANTHROPIC_API_KEY`, optional)

The in-app **Operations Assistant** answers questions about the platform's own
live data (what's down, certificate expiry, SLA breaches, correlation patterns).

**It works with no key at all.** Without `ANTHROPIC_API_KEY`, a deterministic
rule-based responder answers the same questions from the same live snapshot, and
the UI labels every reply "Rule-based · live data". That is the zero-budget
default and is genuinely useful — no stub.

With a key, the same questions are answered free-form by Claude, grounded in a
server-built snapshot of the current database (the model is never asked to recall
facts about Delhi from memory). Replies are labelled "Claude · <model>".

1. Get a key: <https://console.anthropic.com> → API Keys.
2. `.env`:
   ```ini
   ANTHROPIC_API_KEY=sk-ant-...
   ASSISTANT_MODEL=claude-opus-4-8   # optional; this is the default
   ```

**Cost:** this is the one component with no free tier — Anthropic bills per token.
Each question sends a small snapshot (a few KB) plus the question, so a query costs
a fraction of a paisa; a demo session is negligible. There is no monthly minimum,
and if the key is absent or the API call fails, the panel silently falls back to
the rule-based responder — the platform never breaks or blocks on it. Leave the key
unset to keep the project strictly zero-cost.

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
