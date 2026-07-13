# Next Project Research — What to Build at the Office of the Joint Director (IT), GNCTD

Research log + recommendation for the next real-world project, matched to the
position (intern, IT Department GNCTD, Office of the Joint Director IT), the
existing track record (ITM platform, DTC-TC, DMRC analytics, Drone Didi), and
what is actually implementable in an internship with zero budget.
Researched: 13 July 2026.

---

## 1. What the JD(IT) office actually owns (from public sources)

From the IT Department's own site and circulars (it.delhi.gov.in):

- **The IT cadre**: 110+ officers (Joint Director IT, Sr. System Analysts,
  System Analysts, DPAs, DEOs) **posted inside other GNCTD departments** to run
  their computerisation. The JD(IT) office is their hub. Anything that saves
  this cadre routine work has an immediate, nameable user base.
- **eOffice mandate**: compulsory across GNCTD from **1 July 2025**. As of
  June 2026: ~91% of 132 departments use it regularly, but only **65.5%** of
  55 PSUs/boards/bodies and **43.8%** of 48 educational institutions - a long
  tail someone in this office has to chase and report on.
- **Unified Citizen Data Platform**: an active RFP (vendor-scale; not intern
  scope, but shows the office's direction).
- **Information-security practice guidelines** circulars to all departments -
  the office is the conduit for CERT-In/MeitY security direction.

## 2. The burning problem (current, national, and directly in this lane)

- **June 2026**: cybersecurity researchers (FalconFeeds, reported by Medianama)
  found **100+ Indian government websites** (.gov.in/.nic.in/.ac.in) hijacked
  to serve **illegal gambling/betting SEO content** - invisible on the page,
  ranking on Google. Earlier waves compromised 68+ state portals including
  police and property-tax sites (Maharashtra, Haryana, Bihar, Kerala, ...).
- A parliamentary panel counted **373 government websites hacked in 2018-23**.
- The common thread: **nobody inside government noticed - outsiders did.**
  Detection came from journalists and private researchers, not from any
  departmental monitoring.
- GIGW 3.0 mandates HTTPS, security headers and CERT-In-empanelled audits, but
  a formal audit is **paid, slow, annual at best**; there is no continuous
  internal first-pass check between audits. Only STQC can certify (CQW), and
  certification coverage across India's thousands of portals is thin.

## 3. Evidence we already generated ourselves (this repo, live monitoring)

Running ITM's polite monitor against 85 real GNCTD endpoints for a few days
surfaced, with zero special access:

- `dsiidc.org` - **TLS certificate expired** (browsers block the site)
- `dmshahdara.delhi.gov.in` - **DNS not resolving** on public resolvers
- `nsut.ac.in`, `labourcis.nic.in`, `dpcc.delhigovt.nic.in` - **broken TLS
  chains** (strict clients fail; a misconfiguration on a citizen-facing site)
- Repeated **midnight timeout windows** on multiple NIC-hosted portals

Nobody was watching any of this. That is the pitch in one sentence.

## 4. Recommendation — "Delhi Web Sentinel"

**A GNCTD Website Integrity & Compliance Observatory** - one system, three
layers, built directly on the ITM stack (Node/Express/Mongo/cron already
proven against these same 85 endpoints). Evolution of the Module 4 roadmap
(docs/COMPLIANCE_ROADMAP.md) with a sharper, news-current lead feature.

### Layer 1 — Content-integrity & hijack detection (the differentiator, build first)
Passive, homepage-only checks per site, per day:
- **Injected-spam detection**: scan rendered HTML for gambling/betting/satta
  keyword clusters, hidden links, cloaked `<meta>`/title changes - exactly the
  June 2026 attack pattern, detected in hours instead of by journalists.
- **Baseline diffing**: store a normalised content fingerprint per site; alert
  on anomalous deltas (new external script domains, new outbound link hosts).
- **Defacement heuristics**: title/keyword blacklist, unexpected language.
This is the layer no vendor is selling to GNCTD and no annual audit can do -
continuous, cheap, and it answers a problem that made national news last month.

### Layer 2 — GIGW 3.0 first-pass compliance (per existing roadmap)
`pa11y-ci` accessibility sweep (WCAG 2.1 AA), HTTPS/HSTS/CSP/X-Frame-Options,
cert expiry, broken links, Hindi toggle, policy pages, staleness. Framed
honestly: automated tools catch ~30-57% of WCAG issues; this is a screening
layer between STQC audits, never a certificate.

### Layer 3 — The register + auto-drafted monthly certificate
Authoritative inventory of GNCTD web properties (site, owner department, IT
cadre contact, host, cert, domain) + a plain-language auto-drafted compliance
certificate per department per month - the artefact the cadre already has to
produce by hand. This converts the tool from "watches departments" into
"saves the cadre an afternoon every month."

### Problems it solves (the list to put in front of the Joint Director)
1. Hijacked/SEO-spammed GNCTD pages currently go unnoticed until outsiders
   find them (June 2026: 100+ gov sites).
2. Certificate/DNS/TLS rot on citizen-facing sites goes unnoticed (we already
   found four live cases in days).
3. No continuous GIGW self-check exists between paid annual STQC audits.
4. No single register maps site → owning department → cadre contact → cert →
   host; incident response starts with "whose site is this?"
5. Monthly compliance reporting is manual for 110+ cadre officers.

### Why this project (vs. the alternatives below)
- **Zero permissions to start**: everything is passive reads of public pages -
  same politeness rules ITM already enforces (still get supervisor sign-off
  before scanning at scale, per COMPLIANCE_ROADMAP.md).
- **Builds on proven work**: catalogue, scheduler, alerting, dashboard - all
  exist; Layers 1-3 are new checkers + one new page + one PDF/HTML generator.
- **Current-events urgency**: the June 2026 hijack wave is the demo opener.
- **Nameable users**: JD(IT) office + the IT cadre in every department.
- **Internship-sized**: Layer 1 in ~1 week, Layer 2 in ~2 (already planned),
  Layer 3 in ~1; demo-ready incrementally.

## 5. Alternatives considered (ranked, with why not first)

| Candidate | Why it's real | Why not first |
|---|---|---|
| **eOffice adoption telemetry** — dashboard of the 91%/65%/44% long tail, per-body drill-down, weekly nudge digests | The office literally reports these numbers; mandate is live | Needs internal NIC/eOffice data access - approval before any code; good **second** project once trusted |
| **PGMS real-data integration** (ITM Modules 2-3 on real complaints) | ITM is built for it; correlation engine proven on synthetic | Needs departmental data access; keep as the ITM upgrade path, not a new pitch |
| **Unified Citizen Data Platform** contributions | Active RFP | Vendor-scale procurement; an intern can at best write requirement notes |
| **Doorstep-delivery / 1076 service analytics** | Citizen-visible | Owned by AR department + concessionaire, not JD(IT); data access unlikely |
| **Hospital/college site inventory cleanup** | Directory is messy (80 entries under "D" alone) | It's a sub-task of Web Sentinel's register, not a project |

## 6. First-week plan (if approved)

1. Day 1-2: directory scrape → curated register (per COMPLIANCE_ROADMAP.md
   Day-1 task) + **supervisor sign-off on the list and the scanning**.
2. Day 3-4: Layer 1 checker (keyword/hidden-link/fingerprint) on the ITM
   scheduler at 1 scan/site/day; alerts through the existing `raiseAlert()`.
3. Day 5: "Integrity" page in the ITM UI (reuse scorecard components) + first
   findings memo to the Joint Director - with the June 2026 news as context
   and our own four live findings as proof the problem is local, not abstract.

## Sources

- IT Department, GNCTD - structure, cadre, circulars: https://it.delhi.gov.in/
- eOffice adoption numbers (June 2026): https://thepatriot.in/delhi-ncr/75-of-delhi-govt-work-now-on-e-office-177-depts-15700-employees-onboard-87092
- 100+ government sites hijacked for gambling SEO (June 2026): https://www.medianama.com/2026/06/223-indian-government-websites-hacked-gambling/
- 373 sites hacked 2018-23 (parliamentary panel): https://www.wionews.com/india-news/india-373-govt-websites-hacked-in-5-years-house-panel-calls-for-strengthening-digital-infrastructure-689014
- GIGW 3.0 pillars + STQC CQW certification: https://guidelines.india.gov.in/ , https://www.stqc.gov.in/en/website-quality-certification-0
- CERT-In Digital Threat Report 2024: https://www.cert-in.org.in/PDF/Digital_Threat_Report_2024.pdf
- Own live findings: this repository's monitoring data (ENDPOINTS.md, incident history)
