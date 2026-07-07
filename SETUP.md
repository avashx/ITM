# SETUP.md - Local Development Setup

Step-by-step from a clean machine to a running IT Monitor. Total time: ~15 minutes.

## 1. Prerequisites

| Requirement | Version | Check |
|---|---|---|
| Node.js | >= 18 (LTS recommended, tested on 22) | `node --version` |
| npm | >= 9 (ships with Node) | `npm --version` |
| MongoDB | >= 5.0 (7.x recommended) **or** MongoDB Atlas M0 (free) | `mongod --version` |
| Git | any recent | `git --version` |

### Installing Node.js

- **Ubuntu/Debian:**
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
- **Windows/macOS:** download the LTS installer from <https://nodejs.org>.

### Installing MongoDB (pick ONE)

**Option A - MongoDB Atlas free tier (recommended, zero install):**
1. Create a free account at <https://www.mongodb.com/cloud/atlas/register>.
2. Create an **M0 (free)** cluster (choose the Mumbai `ap-south-1` region for Delhi
   latency).
3. Database Access -> add a user with password auth.
4. Network Access -> allow your IP (or `0.0.0.0/0` for testing only).
5. Copy the connection string and set it as `MONGODB_URI` in step 3, e.g.
   `mongodb+srv://user:pass@cluster0.xxxxx.mongodb.net/itmonitor`.

**Option B - Local MongoDB Community Server (Ubuntu 22.04/24.04):**
```bash
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | \
  sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] \
  https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | \
  sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list
sudo apt-get update && sudo apt-get install -y mongodb-org
sudo systemctl enable --now mongod
```
(Official docs: <https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/>)

> Any MongoDB-wire-compatible server works. Development of this project was verified
> end-to-end against **FerretDB 1.x (SQLite backend)** in an offline sandbox - useful if
> your environment cannot run licensed MongoDB. Production should use MongoDB/Atlas.

## 2. Clone & install

```bash
git clone <repo-url> ITM
cd ITM
npm install
```

`npm install` also provides the front-end libraries (Leaflet, Chart.js, marker-cluster,
heat layer) which the server serves from `node_modules` - **no CDN or internet access is
required by the UI**, only map tiles are external (and optional).

## 3. Configure environment

```bash
cp .env.example .env
```

Open `.env` and review - for a local demo you typically change nothing:

- `MONGODB_URI` - defaults to `mongodb://127.0.0.1:27017/itmonitor`; paste your Atlas
  string if using Atlas.
- `SIMULATE_CHECKS` - `true` = demo mode (no real HTTP to government servers),
  `false` = real monitoring. Start with `true` while exploring.
- SMTP settings - optional; without them alerts appear on the dashboard but no email is
  sent. See [API_KEYS.md](API_KEYS.md) for free SMTP options.

Every variable is documented inline in [.env.example](.env.example).

## 4. Seed data

Two paths, depending on what you want:

**Demo (recommended first run)** - endpoints + 90 days of uptime history + 12.5k
synthetic grievances + three outage->spike scenarios + correlation insights:
```bash
npm run seed
```

**Production-style (real monitoring, no fabricated history):**
```bash
npm run seed:endpoints          # just the 85-service catalogue
```

Other seed options:
```bash
npm run seed:grievances                                   # synthetic grievances only
node scripts/seed-grievances.js --days 30 --scale 1.0     # tune volume/history
npm run verify:endpoints                                  # probe all 85 URLs (needs internet)
npm run fetch:geodata                                     # refresh boundary GeoJSONs
```

## 5. Run

```bash
# demo mode (simulated probes - safe anywhere, works offline)
SIMULATE_CHECKS=true npm start

# real monitoring mode
npm start

# development with auto-restart on file change
npm run dev
```

Open <http://localhost:3000>:

| URL | Page |
|---|---|
| `/` | Public status page |
| `/dashboard.html` | Ops dashboard (latency, incidents, SSL, alerts) |
| `/grievances.html` | Grievance heatmap + analytics |
| `/correlation.html` | Correlation engine + surge predictions |
| `/api/health` | Liveness probe |

You should see in the logs:
```
INFO  [db] Connected to MongoDB (...)
INFO  [socket] Socket.io initialised
INFO  [monitor] scheduler started (cron="*/5 * * * *", simulate=...)
INFO  [correlation-cron] correlation schedules active ...
INFO  [server] IT Monitor listening on http://localhost:3000
```

The first check cycle fires ~2.5 seconds after boot, then every 5 minutes.

## 6. Smoke-test the API

```bash
curl localhost:3000/api/health
curl localhost:3000/api/status/summary | head -c 400
curl -X POST localhost:3000/api/grievances/classify \
  -H 'Content-Type: application/json' \
  -d '{"description":"No water supply in Rohini since two days"}'
# -> {"department":"Delhi Jal Board","category":"Water Supply",...}
```

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `MongoDB connect attempt failed` | Is `mongod` running / Atlas IP allow-listed? Check `MONGODB_URI`. |
| Status page empty | Run `npm run seed` (or wait for the first check cycle). |
| Map tiles grey | No internet access to OSM tile servers - boundaries and data layers still render; see API_KEYS.md for tile options. |
| No emails | SMTP not configured (intentional default) - see API_KEYS.md. |
| Many services DOWN in real mode | Some government sites block non-browser clients (403). Add `403` to that endpoint's `acceptableStatuses` in `data/endpoints.json`, reseed endpoints. |
| Port 3000 busy | Set `PORT=3001` in `.env`. |

## 8. Timezone note

All cron schedules and day-bucketing use `TZ` (default `Asia/Kolkata`) so daily stats
align with IST midnight regardless of server timezone.
