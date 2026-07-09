# Module 4 Roadmap — GIGW 3.0 Compliance Scanner

Planning document for the next major capability: an automated first-pass
**GIGW 3.0 compliance screen** across GNCTD department websites, layered on the
existing IT Monitor stack (Node/Express/Mongo/cron — no new platform needed).
Status: **planned, not yet built**. Nothing below runs until scope sign-off
(see "Before anything runs").

## Honest framing (put this on the dashboard too)

Automated tools catch only a portion of real WCAG issues (published estimates
run ~30–57% depending on tool), and only **STQC** can certify GIGW compliance.
This module is a **first-pass screening layer** that finds the mechanical
failures cheaply and continuously — it must never claim to be a certificate.

## Scope correction (from the real directory data)

delhi.gov.in's department directory holds ~230+ alphabetical entries, but many
are individual hospitals and colleges (a lot under "D" alone), often with only
a contact-profile page on delhi.gov.in rather than a standalone site — and the
directory page doesn't expose each entry's real `href` in its visible text.

**v1 scope: secretariat-level departments + major boards/corporations only —
realistically 50–80 sites.** Defensible, honest, and doable. The existing
85-endpoint catalogue in `data/endpoints.json` already covers most of this set;
the directory scrape mainly *validates and extends* it.

### Day-1 task
1. Scrape the directory with `cheerio`, extracting each entry's real `href`
   from the page source (not the visible text).
2. Hand-filter: "actual department/board" vs "hospital/college listing".
3. Merge with `data/endpoints.json` (upsert by URL, keep verification notes).
4. **Get the final list signed off by the supervisor** before any scanning.

## The checklist — GIGW 3.0 pillars → automatable checks

| Pillar | Checks | How |
|---|---|---|
| Accessibility | Alt text, contrast, ARIA, form labels, heading structure | `pa11y-ci` (WCAG2AA default; axe-core via Puppeteer, so JS-heavy sites render properly) |
| Security | HTTPS enforced, cert validity/expiry, HSTS / CSP / X-Frame-Options present | Node `https` + `crypto.X509Certificate` (zero new deps) + plain header check |
| Quality | Broken internal links, mobile viewport meta, Hindi-language toggle present | `cheerio` on fetched HTML; `broken-link-checker` (verify maintenance before adopting) |
| Lifecycle | Last-updated staleness, required policy pages (privacy, RTI/grievance, contact), reachability | HTTP headers + `cheerio` (reachability already exists in Module 1) |

**Tooling call: `pa11y-ci` over Lighthouse** for batch scanning — CLI-first,
JSON URL list in, WCAG2AA by default, far lighter per page than Lighthouse
across 60+ sites. Lighthouse stays useful for one-off spot checks only.

```json
{
  "defaults": { "timeout": 30000, "standard": "WCAG2AA" },
  "urls": ["https://it.delhi.gov.in", "https://transport.delhi.gov.in"]
}
```

## Data model (extends the existing Mongo schemas)

```
departments: { name, category, url, address, lat, lng, cadreContact }
scans:       { departmentId, timestamp, reachable, sslDaysLeft,
               securityHeaders{}, a11yViolations{critical,serious,moderate},
               brokenLinks, hasHindiToggle, hasPrivacyPage, lastModified, score }
```

`scans` is timestamped **from v1** — that is what makes the trend line, the
month-over-month view, and a compliance map essentially free later. Reuse:
`departments` largely maps onto `ServiceEndpoint`; `scans` becomes a sibling of
`CheckResult` with a weekly (not 5-minute) cadence.

## Before anything runs — non-negotiable

1. **Supervisor sign-off** for scanning the site list. Every check is passive
   (headers, cert, rendering a page for a11y) — nothing resembling pentesting —
   but automated traffic across many government domains in a short window can
   look unusual. This must be a known, sanctioned internal audit. Use the
   existing pattern: a descriptive `User-Agent` with a contact address
   (`MONITOR_USER_AGENT` already does this for Module 1).
2. **Politeness** (same discipline as Module 1): 5–10 concurrent max, 10–15s
   timeouts, one retry before "unreachable", check `robots.txt` before touching
   anything beyond the homepage + a couple of key inner pages. A compliance
   signal does not need a full-site crawl.

## Build order

| Phase | Deliverable | Notes |
|---|---|---|
| 1 | Directory scraper + curated `departments` list + sign-off | Day 1–2 |
| 2 | Security/lifecycle/quality checks (no new heavy deps) + `scans` collection | The 80% that's cheap |
| 3 | `pa11y-ci` accessibility sweep (weekly cron, staggered) | Heaviest runtime; run overnight |
| 4 | Compliance page in the UI: per-department scorecard + trend | Reuses card/table/scorecard components |
| 5 | **Auto-drafted plain-language "certificate draft"** per department, formatted like the monthly compliance certificate departments already submit | Highest payoff per effort: turns the tool from "watches them" into "saves someone's afternoon" |
| 6 | Weekly `node-cron` + `nodemailer` digest to nodal officers (new regressions only); month-over-month most-improved / most-regressed view | Nearly free once scan history exists; great demo |

**Explicitly deferred / not default:**
- **Public leaderboard** — ranking government websites publicly is a
  supervisor-level decision. Internal-only unless asked from above.
- **PDF accessibility spot-checks** on circulars — GIGW does call it out, but
  the engineering-to-payoff ratio says stretch goal only.

## Fit with existing modules

Module 1 already answers "is it up"; Module 4 answers "is it compliant".
Shared: endpoint catalogue, polite-probe infrastructure, alerting (a new
`compliance_regression` Alert type slots into the existing enum + `raiseAlert()`
path), scorecard UI patterns, and the same honest-labelling rules.
