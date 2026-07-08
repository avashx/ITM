# CONTRIBUTING.md

Thanks for helping improve IT Monitor. This is a small, dependency-light codebase -
please keep it that way.

## Ground rules

1. **No secrets in git.** Keys live in `.env` (git-ignored); document any new variable
   in `.env.example` *and* [API_KEYS.md](API_KEYS.md).
2. **Respectful monitoring is non-negotiable.** Anything that increases request volume
   to government servers (shorter intervals, retries, new probe types) needs a strong
   justification and must keep backoff behaviour.
3. **Synthetic data stays labelled.** Generated records must carry
   `source: "synthetic"` and `SYN-` IDs. Never mix synthetic and real data silently.
4. **No new runtime dependencies without discussion.** The stack is Express, Mongoose,
   Socket.io, node-cron, Nodemailer, dotenv, helmet, compression, morgan + vendored
   front-end libs. Prefer the standard library.
5. **Engine portability.** Keep queries compatible with MongoDB-wire engines
   (avoid exotic aggregation stages; the JS-reducer analytics pattern in
   `src/modules/grievance/analytics.js` is deliberate).

## Workflow

1. Fork / branch from `main`: `feat/<short-name>` or `fix/<short-name>`.
2. Make the change with focused commits (imperative subject line <= 72 chars, body
   explains *why*).
3. Verify before pushing:
   ```bash
   node --check $(git ls-files '*.js' | grep -v node_modules)   # syntax
   npm run seed          # against a scratch database
   SIMULATE_CHECKS=true npm start   # click through all four pages
   ```
4. Open a PR describing the problem, the approach, and any config/doc changes.

## Code style

- Node >= 18 CommonJS (`require`), 2-space indent, semicolons, single quotes.
- Every file starts with a block comment saying what it does and why it exists.
- Comments explain constraints and intent, not what the next line does.
- Route handlers wrap async logic in `asyncRoute` and never swallow errors.
- Log through `src/utils/logger.js` with a scoped logger - no bare `console.log` in
  `src/`.
- Front-end: vanilla JS IIFEs, no frameworks, libraries only from `/vendor/*` mounts.

## Where things live

See the repository map in [README.md](README.md). Rules of thumb:

- New monitored endpoint -> `data/endpoints.json` (+ regenerate the ENDPOINTS.md table).
- New grievance category/keywords -> `data/reference/departments.json` (classifier and
  UI pick it up automatically; add generator templates in
  `scripts/lib/grievance-generator.js` if you want it in demo data).
- New alert type -> `src/models/Alert.js` enum + `raiseAlert()` call site + docs in API.md.

## Reporting issues

Include: what you did, what you expected, what happened, server logs
(`pm2 logs it-monitor` or console), Node/MongoDB versions, and whether
`SIMULATE_CHECKS` was on.
