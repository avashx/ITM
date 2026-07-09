# GNCTD Service Endpoint Catalogue

The 85 public service endpoints monitored by IT Monitor. The machine-readable source of
truth is [`data/endpoints.json`](data/endpoints.json) (this table is generated from it);
seed it into MongoDB with `npm run seed:endpoints`.

## Verification status

The catalogue was compiled by research on **2026-07-07** and then **live HTTP-verified
on 2026-07-08** from a normal internet connection using
`npm run verify:endpoints` (same polite User-Agent and 10s timeout the monitor uses).

Result: **69 of 85 endpoints answered UP** on the verification run; 3 dead URL guesses
were corrected (`dccentral`, `tte`, `higheredn` replaced `dmcentral`, `dtte`, `dhe`) and
one API-gateway root 404 was whitelisted, bringing the catalogue to **73/85 entries
HTTP-verified**. The remaining 12 carry dated failure notes and are *deliberately kept
enabled* because their failures are real, citizen-facing findings the monitor should
keep reporting:

- **TLS misconfigurations (5):** `dsiidc.org` (certificate expired),
  `labourcis.nic.in` / `www.dpcc.delhigovt.nic.in` / `nsut.ac.in` (incomplete
  certificate chain - strict clients fail), `opgms.delhigovt.nic.in` (hostname/cert
  mismatch).
- **Timeouts >10s (5):** `nfs.delhigovt.nic.in`, `delhiexcise.gov.in`, `dvat.gov.in`,
  `jobs.delhi.gov.in`, `tiharprisons.nic.in` - slow or filtering non-browser clients.
- **Broken DNS (1):** `dmshahdara.delhi.gov.in` - not resolving on public resolvers as
  of 2026-07-08 despite being the indexed canonical URL.
- **Intermittent (1):** `sarathi.parivahan.gov.in` - connection reset on one run, OK on
  another.

Re-verify anytime:

```bash
npm run verify:endpoints                    # prints UP/DOWN, status, latency per URL
node scripts/verify-endpoints.js --update   # also stamps results into MongoDB
```

The monitor itself re-verifies every endpoint every 5 minutes once running. Some
government sites answer `403` to non-browser clients: a 403 means the server is alive -
add it to that endpoint's `acceptableStatuses` in `data/endpoints.json` if you want it
treated as UP.

Categories group services on the public status page. `relatedGrievanceCategories` (in
the JSON) link each service to the PGMS-style complaint categories its outages affect -
that mapping powers the Module 3 correlation engine.

## The catalogue

| Service | URL | Department | Category | Verification |
|---|---|---|---|---|
| e-District Delhi (legacy portal) | `https://edistrict.delhigovt.nic.in/` | Revenue Department | Certificates & e-District | **HTTP-verified 2026-07-08** - HTTP 200 in 267ms |
| e-District Delhi (new portal) | `https://edistrict.delhi.gov.in/` | Revenue Department | Certificates & e-District | **HTTP-verified 2026-07-08** - HTTP 200 in 272ms |
| Delhi Government Portal | `https://delhi.gov.in/` | General Administration | GNCTD Portals | **HTTP-verified 2026-07-08** - HTTP 200 in 1138ms |
| PGMS (Public Grievance Monitoring System) | `https://pgms.delhi.gov.in/` | Chief Minister Office / AR | Grievance & RTI | **HTTP-verified 2026-07-08** - HTTP 200 in 270ms |
| PGMS Legacy (OPGMS) | `https://opgms.delhigovt.nic.in/` | Administrative Reforms | Grievance & RTI | Search-confirmed (2026-07-07) - probe 2026-07-08: TLS error: Hostname/IP does not match certificate's altnames: Host: opgms.delhigovt.nic.in. is not in the cert's altnames: DNS:*.de |
| Public Grievances Commission | `https://pgc.delhi.gov.in/` | Public Grievances Commission | Grievance & RTI | **HTTP-verified 2026-07-08** - HTTP 200 in 1160ms |
| DORIS (Property Registration) | `https://doris.delhigovt.nic.in/` | Revenue Department | Property & Land | **HTTP-verified 2026-07-08** - HTTP 200 in 370ms |
| eSearch (Registered Deed Search) | `https://esearch.delhigovt.nic.in/` | Revenue Department | Property & Land | **HTTP-verified 2026-07-08** - HTTP 200 in 3437ms |
| Delhi Land Records (Indraprastha Bhulekh) | `https://dlrc.delhi.gov.in/` | Revenue Department | Property & Land | **HTTP-verified 2026-07-08** - HTTP 200 in 253ms |
| Revenue Department | `https://revenue.delhi.gov.in/` | Revenue Department | District Administration | **HTTP-verified 2026-07-08** - HTTP 200 in 1586ms |
| Delhi Jal Board | `https://djb.gov.in/` | Delhi Jal Board | Water (DJB) | **HTTP-verified 2026-07-08** - HTTP 200 in 689ms |
| Delhi Jal Board (department site) | `https://delhijalboard.delhi.gov.in/` | Delhi Jal Board | Water (DJB) | **HTTP-verified 2026-07-08** - HTTP 200 in 2284ms |
| MCD Online Citizen Services | `https://mcdonline.nic.in/` | Municipal Corporation of Delhi | Municipal (MCD/NDMC) | **HTTP-verified 2026-07-08** - HTTP 200 in 312ms |
| MCD Birth & Death Registration | `https://rbd.mcdonline.nic.in/rbd/web/citizen/info` | Municipal Corporation of Delhi | Municipal (MCD/NDMC) | **HTTP-verified 2026-07-08** - HTTP 200 in 301ms |
| New Delhi Municipal Council | `https://www.ndmc.gov.in/` | NDMC | Municipal (MCD/NDMC) | **HTTP-verified 2026-07-08** - HTTP 200 in 278ms |
| Transport Department | `https://transport.delhi.gov.in/` | Transport Department | Transport & DTC | **HTTP-verified 2026-07-08** - HTTP 200 in 245ms |
| Delhi Transport Corporation | `https://dtc.delhi.gov.in/` | Delhi Transport Corporation | Transport & DTC | **HTTP-verified 2026-07-08** - HTTP 200 in 2098ms |
| DTC Online Bus Pass | `https://dtcpass.delhi.gov.in/` | Delhi Transport Corporation | Transport & DTC | **HTTP-verified 2026-07-08** - HTTP 200 in 319ms |
| Parivahan Sewa (VAHAN/SARATHI gateway) | `https://parivahan.gov.in/` | MoRTH (serves Delhi RTOs) | Transport & DTC | **HTTP-verified 2026-07-08** - HTTP 200 in 429ms |
| SARATHI (Driving Licence) | `https://sarathi.parivahan.gov.in/` | MoRTH (serves Delhi RTOs) | Transport & DTC | Search-confirmed (2026-07-07) - probe 2026-07-08: connection reset |
| NFS Delhi (Ration / Food Security) | `https://nfs.delhigovt.nic.in/` | Food & Civil Supplies | Food & Civil Supplies | Search-confirmed (2026-07-07) - probe 2026-07-08: timeout after 10000ms |
| Food Supplies & Consumer Affairs | `https://fsd.delhi.gov.in/` | Food & Civil Supplies | Food & Civil Supplies | **HTTP-verified 2026-07-08** - HTTP 200 in 1182ms |
| NFSA Delhi State Portal | `https://nfsa.gov.in/State/DL` | DFPD (serves Delhi PDS) | Food & Civil Supplies | **HTTP-verified 2026-07-08** - HTTP 200 in 989ms |
| Delhi Police | `https://delhipolice.gov.in/` | Delhi Police | Police & Safety | **HTTP-verified 2026-07-08** - HTTP 200 in 278ms |
| Delhi Police Lost & Found | `https://lostfound.delhipolice.gov.in/` | Delhi Police | Police & Safety | **HTTP-verified 2026-07-08** - HTTP 200 in 272ms |
| Delhi Traffic Police | `https://traffic.delhipolice.gov.in/` | Delhi Police | Police & Safety | **HTTP-verified 2026-07-08** - HTTP 200 in 264ms |
| BSES Delhi (BRPL/BYPL) | `https://www.bsesdelhi.com/` | Power (DISCOMs) | Power (DISCOMs & Utilities) | **HTTP-verified 2026-07-08** - HTTP 200 in 1379ms |
| Tata Power DDL | `https://www.tatapower-ddl.com/` | Power (DISCOMs) | Power (DISCOMs & Utilities) | **HTTP-verified 2026-07-08** - HTTP 200 in 701ms |
| Delhi SLDC | `https://www.delhisldc.org/` | State Load Despatch Centre | Power (DISCOMs & Utilities) | **HTTP-verified 2026-07-08** - HTTP 200 in 359ms |
| DERC | `https://derc.gov.in/` | Electricity Regulatory Commission | Power (DISCOMs & Utilities) | **HTTP-verified 2026-07-08** - HTTP 200 in 389ms |
| Delhi Transco Ltd | `https://dtl.gov.in/` | Delhi Transco | Power (DISCOMs & Utilities) | **HTTP-verified 2026-07-08** - HTTP 200 in 1143ms |
| IPGCL-PPCL | `https://ipgcl-ppcl.gov.in/` | Indraprastha Power Generation | Power (DISCOMs & Utilities) | **HTTP-verified 2026-07-08** - HTTP 200 in 275ms |
| Excise Department | `https://excise.delhi.gov.in/` | Excise, Entertainment & Luxury Tax | Tax & Revenue | **HTTP-verified 2026-07-08** - HTTP 200 in 286ms |
| ESCIMS (Excise Supply Chain) | `https://delhiexcise.gov.in/` | Excise, Entertainment & Luxury Tax | Tax & Revenue | Search-confirmed (2026-07-07) - e-Abkari transition in progress | probe 2026-07-08: timeout after 10000ms |
| Trade & Taxes (DVAT/GST) | `https://dvat.gov.in/` | Trade & Taxes | Tax & Revenue | Well-known official domain - probe 2026-07-08: timeout after 10000ms |
| Labour CIS (Shops & Establishments) | `https://labourcis.nic.in/` | Labour Department | Employment & Labour | Search-confirmed (2026-07-07) - probe 2026-07-08: TLS error: unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca |
| Labour Department | `https://labour.delhi.gov.in/` | Labour Department | Employment & Labour | **HTTP-verified 2026-07-08** - HTTP 200 in 1309ms |
| Rozgar Bazaar (Jobs Portal) | `https://jobs.delhi.gov.in/` | Employment Department | Employment & Labour | Well-known official domain - probe 2026-07-08: timeout after 10000ms |
| Health & Family Welfare | `https://health.delhi.gov.in/` | Health & Family Welfare | Health | **HTTP-verified 2026-07-08** - HTTP 200 in 1400ms |
| DGEHS (Directorate General of Health Services) | `https://dgehs.delhi.gov.in/` | Health & Family Welfare | Health | **HTTP-verified 2026-07-08** - HTTP 200 in 684ms |
| ORS Hospital Appointments | `https://ors.gov.in/` | MoHFW (serves Delhi govt hospitals) | Health | **HTTP-verified 2026-07-08** - HTTP 200 in 436ms |
| Directorate of Education | `https://www.edudel.nic.in/` | Education (DoE) | Education & Universities | **HTTP-verified 2026-07-08** - HTTP 200 in 221ms |
| SCERT Delhi | `https://scert.delhi.gov.in/` | Education (DoE) | Education & Universities | **HTTP-verified 2026-07-08** - HTTP 200 in 749ms |
| DSSSB (Recruitment Board) | `https://dsssb.delhi.gov.in/` | DSSSB | Employment & Labour | **HTTP-verified 2026-07-08** - HTTP 200 in 797ms |
| GGSIPU | `http://www.ipu.ac.in/` | Higher Education | Education & Universities | **HTTP-verified 2026-07-08** - HTTP 200 in 85ms |
| Delhi Technological University | `https://dtu.ac.in/` | Higher Education | Education & Universities | **HTTP-verified 2026-07-08** - HTTP 200 in 686ms |
| NSUT | `https://nsut.ac.in/` | Higher Education | Education & Universities | Well-known official domain - probe 2026-07-08: TLS error: unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca |
| DSEU | `https://dseu.ac.in/` | Higher Education | Education & Universities | **HTTP-verified 2026-07-08** - HTTP 200 in 92ms |
| IT Department | `https://it.delhi.gov.in/` | Information Technology | Open Data & IT | **HTTP-verified 2026-07-08** - HTTP 200 in 151ms |
| Delhi Open Data Portal | `https://delhi.data.gov.in/` | Information Technology | Open Data & IT | **HTTP-verified 2026-07-08** - HTTP 200 in 518ms |
| OGD India API Gateway | `https://api.data.gov.in/` | MeitY/NIC (serves Delhi datasets) | Open Data & IT | **HTTP-verified 2026-07-08** - API gateway: bare root returns 404 by design (server alive) - 404 whitelisted |
| DDA | `https://dda.gov.in/` | Delhi Development Authority | Property & Land | **HTTP-verified 2026-07-08** - HTTP 200 in 1803ms |
| DUSIB (Urban Shelter Board) | `https://delhishelterboard.in/` | DUSIB | Housing & Shelter | **HTTP-verified 2026-07-08** - HTTP 200 in 695ms |
| DSIIDC | `https://dsiidc.org/` | DSIIDC | Housing & Shelter | Well-known official domain - probe 2026-07-08: TLS certificate expired |
| DPCC (Pollution Control) | `https://www.dpcc.delhigovt.nic.in/` | Environment & DPCC | Environment | Well-known official domain - probe 2026-07-08: TLS error: unable to verify the first certificate; if the root CA is installed locally, try running Node.js with --use-system-ca |
| Environment Department | `https://environment.delhi.gov.in/` | Environment & DPCC | Environment | **HTTP-verified 2026-07-08** - HTTP 200 in 2051ms |
| Forest & Wildlife Department | `https://forest.delhi.gov.in/` | Forest & Wildlife | Environment | **HTTP-verified 2026-07-08** - HTTP 200 in 1009ms |
| CEO Delhi (Elections) | `https://www.ceodelhi.gov.in/` | Chief Electoral Officer | GNCTD Portals | **HTTP-verified 2026-07-08** - HTTP 200 in 342ms |
| Delhi District Courts | `https://delhicourts.nic.in/` | Judiciary (Delhi) | GNCTD Portals | **HTTP-verified 2026-07-08** - HTTP 200 in 229ms |
| Delhi High Court | `https://delhihighcourt.nic.in/` | Judiciary (Delhi) | GNCTD Portals | **HTTP-verified 2026-07-08** - HTTP 200 in 365ms |
| Tihar Prisons | `https://tiharprisons.nic.in/` | Prisons | Police & Safety | Well-known official domain - probe 2026-07-08: timeout after 10000ms |
| Delhi Fire Service | `https://dfs.delhi.gov.in/` | Delhi Fire Service | Police & Safety | **HTTP-verified 2026-07-08** - HTTP 200 in 1433ms |
| Delhi Tourism | `https://delhitourism.gov.in/` | Tourism (DTTDC) | GNCTD Portals | **HTTP-verified 2026-07-08** - HTTP 200 in 138ms |
| Women & Child Development | `https://wcd.delhi.gov.in/` | Women & Child Development | Social Welfare | **HTTP-verified 2026-07-08** - HTTP 200 in 1690ms |
| Social Welfare Department | `https://socialwelfare.delhi.gov.in/` | Social Welfare | Social Welfare | **HTTP-verified 2026-07-08** - HTTP 200 in 2279ms |
| Delhi Commission for Women | `https://dcw.delhi.gov.in/` | DCW | Social Welfare | **HTTP-verified 2026-07-08** - HTTP 200 in 1950ms |
| DCPCR (Child Rights) | `https://dcpcr.delhi.gov.in/` | DCPCR | Social Welfare | **HTTP-verified 2026-07-08** - HTTP 200 in 1382ms |
| Higher Education Directorate | `https://higheredn.delhi.gov.in/` | Higher Education | Education & Universities | **HTTP-verified 2026-07-08** - corrected URL (dhe.delhi.gov.in was DNS-dead); HTTP 200 verified |
| Training & Technical Education | `https://tte.delhi.gov.in/` | Training & Technical Education | Education & Universities | **HTTP-verified 2026-07-08** - corrected URL (dtte.delhi.gov.in was DNS-dead); HTTP 200 verified |
| Planning Department | `https://delhiplanning.delhi.gov.in/` | Planning | GNCTD Portals | **HTTP-verified 2026-07-08** - HTTP 200 in 1625ms |
| Finance Department | `https://finance.delhi.gov.in/` | Finance | GNCTD Portals | **HTTP-verified 2026-07-08** - HTTP 200 in 1542ms |
| PWD Delhi | `https://pwd.delhi.gov.in/` | Public Works Department | GNCTD Portals | **HTTP-verified 2026-07-08** - HTTP 200 in 613ms |
| Delhi Metro (DMRC) | `https://www.delhimetrorail.com/` | DMRC | Transport & DTC | **HTTP-verified 2026-07-08** - HTTP 200 in 608ms |
| DIMTS | `https://www.dimts.in/` | DIMTS | Transport & DTC | **HTTP-verified 2026-07-08** - HTTP 200 in 233ms |
| DM North | `https://dmnorth.delhi.gov.in/` | District Administration | District Administration | **HTTP-verified 2026-07-08** - HTTP 200 in 1662ms |
| DM North East | `https://dmnortheast.delhi.gov.in/` | District Administration | District Administration | **HTTP-verified 2026-07-08** - HTTP 200 in 225ms |
| DM North West | `https://dmnorthwest.delhi.gov.in/` | District Administration | District Administration | **HTTP-verified 2026-07-08** - HTTP 200 in 3286ms |
| DM South | `https://dmsouth.delhi.gov.in/` | District Administration | District Administration | **HTTP-verified 2026-07-08** - HTTP 200 in 240ms |
| DM South East | `https://dmsoutheast.delhi.gov.in/` | District Administration | District Administration | **HTTP-verified 2026-07-08** - HTTP 200 in 219ms |
| DM South West | `https://dmsouthwest.delhi.gov.in/` | District Administration | District Administration | **HTTP-verified 2026-07-08** - HTTP 200 in 3265ms |
| DM East | `https://dmeast.delhi.gov.in/` | District Administration | District Administration | **HTTP-verified 2026-07-08** - HTTP 200 in 215ms |
| DM West | `https://dmwest.delhi.gov.in/` | District Administration | District Administration | **HTTP-verified 2026-07-08** - HTTP 200 in 219ms |
| DM Central | `https://dccentral.delhi.gov.in/` | District Administration | District Administration | **HTTP-verified 2026-07-08** - corrected URL (dmcentral.delhi.gov.in was DNS-dead); HTTP 200 verified |
| DM New Delhi | `https://dmnewdelhi.delhi.gov.in/` | District Administration | District Administration | **HTTP-verified 2026-07-08** - HTTP 200 in 3272ms |
| DM Shahdara | `https://dmshahdara.delhi.gov.in/` | District Administration | District Administration | Well-known official domain - S3WaaS district site | probe 2026-07-08: DNS lookup failed |

## Adding / removing endpoints

Edit `data/endpoints.json` and re-run `npm run seed:endpoints` (upserts by URL, so
history is preserved), or use the admin API:

```bash
curl -X POST http://localhost:3000/api/services \
  -H 'Content-Type: application/json' -H "X-Admin-Key: $ADMIN_API_KEY" \
  -d '{"name":"New Portal","url":"https://example.delhi.gov.in/","department":"X","category":"GNCTD Portals"}'
```
