# GNCTD Service Endpoint Catalogue

The 85 public service endpoints monitored by IT Monitor, researched and compiled on
**2026-07-07**. The machine-readable source of truth is
[`data/endpoints.json`](data/endpoints.json) (this table is generated from it); seed it
into MongoDB with `npm run seed:endpoints`.

## Verification status - read this first

Two verification levels appear below:

- **Search-confirmed (2026-07-07)** - the canonical URL was confirmed live in current
  web-search results (official portal appearing with recent content) on the compile date.
- **Well-known official domain** - long-established government domain compiled from
  official directories and domain knowledge; not individually re-confirmed on the
  compile date.

> **Note on live HTTP verification:** this catalogue was compiled in a sandboxed
> environment whose network policy blocks direct requests to government sites, so a
> same-day HTTP probe of each URL was not possible from here. Before relying on the
> list, run the included one-shot verifier from any normal network:
>
> ```bash
> npm run verify:endpoints            # prints UP/DOWN, status, latency per URL
> node scripts/verify-endpoints.js --update   # also stamps results into MongoDB
> ```
>
> The monitor itself re-verifies every endpoint every 5 minutes once running, so stale
> entries surface immediately on the dashboard. Some government sites answer `403` to
> non-browser clients: a 403 means the server is alive - add it to that endpoint's
> `acceptableStatuses` in `data/endpoints.json` if you want it treated as UP.

Categories group services on the public status page. `relatedGrievanceCategories` (in
the JSON) link each service to the PGMS-style complaint categories its outages affect -
that mapping powers the Module 3 correlation engine.

## The catalogue

| Service | URL | Department | Category | Verification |
|---|---|---|---|---|
| e-District Delhi (legacy portal) | `https://edistrict.delhigovt.nic.in/` | Revenue Department | Certificates & e-District | Search-confirmed (2026-07-07) |
| e-District Delhi (new portal) | `https://edistrict.delhi.gov.in/` | Revenue Department | Certificates & e-District | Search-confirmed (2026-07-07) |
| Delhi Government Portal | `https://delhi.gov.in/` | General Administration | GNCTD Portals | Well-known official domain |
| PGMS (Public Grievance Monitoring System) | `https://pgms.delhi.gov.in/` | Chief Minister Office / AR | Grievance & RTI | Search-confirmed (2026-07-07) |
| PGMS Legacy (OPGMS) | `https://opgms.delhigovt.nic.in/` | Administrative Reforms | Grievance & RTI | Search-confirmed (2026-07-07) |
| Public Grievances Commission | `https://pgc.delhi.gov.in/` | Public Grievances Commission | Grievance & RTI | Search-confirmed (2026-07-07) |
| DORIS (Property Registration) | `https://doris.delhigovt.nic.in/` | Revenue Department | Property & Land | Search-confirmed (2026-07-07) - SR offices migrating to NGDRS (ngdrs.gov.in) |
| eSearch (Registered Deed Search) | `https://esearch.delhigovt.nic.in/` | Revenue Department | Property & Land | Search-confirmed (2026-07-07) |
| Delhi Land Records (Indraprastha Bhulekh) | `https://dlrc.delhi.gov.in/` | Revenue Department | Property & Land | Search-confirmed (2026-07-07) |
| Revenue Department | `https://revenue.delhi.gov.in/` | Revenue Department | District Administration | Well-known official domain |
| Delhi Jal Board | `https://djb.gov.in/` | Delhi Jal Board | Water (DJB) | Search-confirmed (2026-07-07) |
| Delhi Jal Board (department site) | `https://delhijalboard.delhi.gov.in/` | Delhi Jal Board | Water (DJB) | Search-confirmed (2026-07-07) |
| MCD Online Citizen Services | `https://mcdonline.nic.in/` | Municipal Corporation of Delhi | Municipal (MCD/NDMC) | Search-confirmed (2026-07-07) |
| MCD Birth & Death Registration | `https://rbd.mcdonline.nic.in/rbd/web/citizen/info` | Municipal Corporation of Delhi | Municipal (MCD/NDMC) | Search-confirmed (2026-07-07) |
| New Delhi Municipal Council | `https://www.ndmc.gov.in/` | NDMC | Municipal (MCD/NDMC) | Well-known official domain |
| Transport Department | `https://transport.delhi.gov.in/` | Transport Department | Transport & DTC | Search-confirmed (2026-07-07) |
| Delhi Transport Corporation | `https://dtc.delhi.gov.in/` | Delhi Transport Corporation | Transport & DTC | Search-confirmed (2026-07-07) |
| DTC Online Bus Pass | `https://dtcpass.delhi.gov.in/` | Delhi Transport Corporation | Transport & DTC | Search-confirmed (2026-07-07) |
| Parivahan Sewa (VAHAN/SARATHI gateway) | `https://parivahan.gov.in/` | MoRTH (serves Delhi RTOs) | Transport & DTC | Search-confirmed (2026-07-07) |
| SARATHI (Driving Licence) | `https://sarathi.parivahan.gov.in/` | MoRTH (serves Delhi RTOs) | Transport & DTC | Search-confirmed (2026-07-07) |
| NFS Delhi (Ration / Food Security) | `https://nfs.delhigovt.nic.in/` | Food & Civil Supplies | Food & Civil Supplies | Search-confirmed (2026-07-07) |
| Food Supplies & Consumer Affairs | `https://fsd.delhi.gov.in/` | Food & Civil Supplies | Food & Civil Supplies | Search-confirmed (2026-07-07) |
| NFSA Delhi State Portal | `https://nfsa.gov.in/State/DL` | DFPD (serves Delhi PDS) | Food & Civil Supplies | Search-confirmed (2026-07-07) |
| Delhi Police | `https://delhipolice.gov.in/` | Delhi Police | Police & Safety | Search-confirmed (2026-07-07) |
| Delhi Police Lost & Found | `https://lostfound.delhipolice.gov.in/` | Delhi Police | Police & Safety | Search-confirmed (2026-07-07) |
| Delhi Traffic Police | `https://traffic.delhipolice.gov.in/` | Delhi Police | Police & Safety | Well-known official domain |
| BSES Delhi (BRPL/BYPL) | `https://www.bsesdelhi.com/` | Power (DISCOMs) | Power (DISCOMs & Utilities) | Search-confirmed (2026-07-07) |
| Tata Power DDL | `https://www.tatapower-ddl.com/` | Power (DISCOMs) | Power (DISCOMs & Utilities) | Search-confirmed (2026-07-07) |
| Delhi SLDC | `https://www.delhisldc.org/` | State Load Despatch Centre | Power (DISCOMs & Utilities) | Well-known official domain |
| DERC | `https://derc.gov.in/` | Electricity Regulatory Commission | Power (DISCOMs & Utilities) | Well-known official domain |
| Delhi Transco Ltd | `https://dtl.gov.in/` | Delhi Transco | Power (DISCOMs & Utilities) | Well-known official domain |
| IPGCL-PPCL | `https://ipgcl-ppcl.gov.in/` | Indraprastha Power Generation | Power (DISCOMs & Utilities) | Well-known official domain |
| Excise Department | `https://excise.delhi.gov.in/` | Excise, Entertainment & Luxury Tax | Tax & Revenue | Search-confirmed (2026-07-07) |
| ESCIMS (Excise Supply Chain) | `https://delhiexcise.gov.in/` | Excise, Entertainment & Luxury Tax | Tax & Revenue | Search-confirmed (2026-07-07) - e-Abkari transition in progress |
| Trade & Taxes (DVAT/GST) | `https://dvat.gov.in/` | Trade & Taxes | Tax & Revenue | Well-known official domain |
| Labour CIS (Shops & Establishments) | `https://labourcis.nic.in/` | Labour Department | Employment & Labour | Search-confirmed (2026-07-07) |
| Labour Department | `https://labour.delhi.gov.in/` | Labour Department | Employment & Labour | Search-confirmed (2026-07-07) |
| Rozgar Bazaar (Jobs Portal) | `https://jobs.delhi.gov.in/` | Employment Department | Employment & Labour | Well-known official domain |
| Health & Family Welfare | `https://health.delhi.gov.in/` | Health & Family Welfare | Health | Search-confirmed (2026-07-07) |
| DGEHS (Directorate General of Health Services) | `https://dgehs.delhi.gov.in/` | Health & Family Welfare | Health | Search-confirmed (2026-07-07) |
| ORS Hospital Appointments | `https://ors.gov.in/` | MoHFW (serves Delhi govt hospitals) | Health | Search-confirmed (2026-07-07) |
| Directorate of Education | `https://www.edudel.nic.in/` | Education (DoE) | Education & Universities | Well-known official domain |
| SCERT Delhi | `https://scert.delhi.gov.in/` | Education (DoE) | Education & Universities | Well-known official domain |
| DSSSB (Recruitment Board) | `https://dsssb.delhi.gov.in/` | DSSSB | Employment & Labour | Well-known official domain |
| GGSIPU | `http://www.ipu.ac.in/` | Higher Education | Education & Universities | Well-known official domain |
| Delhi Technological University | `https://dtu.ac.in/` | Higher Education | Education & Universities | Well-known official domain |
| NSUT | `https://nsut.ac.in/` | Higher Education | Education & Universities | Well-known official domain |
| DSEU | `https://dseu.ac.in/` | Higher Education | Education & Universities | Well-known official domain |
| IT Department | `https://it.delhi.gov.in/` | Information Technology | Open Data & IT | Well-known official domain |
| Delhi Open Data Portal | `https://delhi.data.gov.in/` | Information Technology | Open Data & IT | Search-confirmed (2026-07-07) |
| OGD India API Gateway | `https://api.data.gov.in/` | MeitY/NIC (serves Delhi datasets) | Open Data & IT | Well-known official domain |
| DDA | `https://dda.gov.in/` | Delhi Development Authority | Property & Land | Well-known official domain |
| DUSIB (Urban Shelter Board) | `https://delhishelterboard.in/` | DUSIB | Housing & Shelter | Well-known official domain |
| DSIIDC | `https://dsiidc.org/` | DSIIDC | Housing & Shelter | Well-known official domain |
| DPCC (Pollution Control) | `https://www.dpcc.delhigovt.nic.in/` | Environment & DPCC | Environment | Well-known official domain |
| Environment Department | `https://environment.delhi.gov.in/` | Environment & DPCC | Environment | Well-known official domain - S3WaaS pattern - re-verify |
| Forest & Wildlife Department | `https://forest.delhi.gov.in/` | Forest & Wildlife | Environment | Well-known official domain - S3WaaS pattern - re-verify |
| CEO Delhi (Elections) | `https://www.ceodelhi.gov.in/` | Chief Electoral Officer | GNCTD Portals | Well-known official domain |
| Delhi District Courts | `https://delhicourts.nic.in/` | Judiciary (Delhi) | GNCTD Portals | Well-known official domain |
| Delhi High Court | `https://delhihighcourt.nic.in/` | Judiciary (Delhi) | GNCTD Portals | Well-known official domain |
| Tihar Prisons | `https://tiharprisons.nic.in/` | Prisons | Police & Safety | Well-known official domain |
| Delhi Fire Service | `https://dfs.delhi.gov.in/` | Delhi Fire Service | Police & Safety | Well-known official domain - S3WaaS pattern - re-verify |
| Delhi Tourism | `https://delhitourism.gov.in/` | Tourism (DTTDC) | GNCTD Portals | Well-known official domain |
| Women & Child Development | `https://wcd.delhi.gov.in/` | Women & Child Development | Social Welfare | Well-known official domain - S3WaaS pattern - re-verify |
| Social Welfare Department | `https://socialwelfare.delhi.gov.in/` | Social Welfare | Social Welfare | Well-known official domain - S3WaaS pattern - re-verify |
| Delhi Commission for Women | `https://dcw.delhi.gov.in/` | DCW | Social Welfare | Well-known official domain - S3WaaS pattern - re-verify |
| DCPCR (Child Rights) | `https://dcpcr.delhi.gov.in/` | DCPCR | Social Welfare | Well-known official domain - S3WaaS pattern - re-verify |
| Higher Education Directorate | `https://dhe.delhi.gov.in/` | Higher Education | Education & Universities | Well-known official domain - S3WaaS pattern - re-verify |
| Training & Technical Education | `https://dtte.delhi.gov.in/` | Training & Technical Education | Education & Universities | Well-known official domain |
| Planning Department | `https://delhiplanning.delhi.gov.in/` | Planning | GNCTD Portals | Well-known official domain |
| Finance Department | `https://finance.delhi.gov.in/` | Finance | GNCTD Portals | Well-known official domain - S3WaaS pattern - re-verify |
| PWD Delhi | `https://pwd.delhi.gov.in/` | Public Works Department | GNCTD Portals | Well-known official domain - S3WaaS pattern - re-verify |
| Delhi Metro (DMRC) | `https://www.delhimetrorail.com/` | DMRC | Transport & DTC | Well-known official domain |
| DIMTS | `https://www.dimts.in/` | DIMTS | Transport & DTC | Well-known official domain |
| DM North | `https://dmnorth.delhi.gov.in/` | District Administration | District Administration | Well-known official domain - S3WaaS district site |
| DM North East | `https://dmnortheast.delhi.gov.in/` | District Administration | District Administration | Well-known official domain - S3WaaS district site |
| DM North West | `https://dmnorthwest.delhi.gov.in/` | District Administration | District Administration | Well-known official domain - S3WaaS district site |
| DM South | `https://dmsouth.delhi.gov.in/` | District Administration | District Administration | Well-known official domain - S3WaaS district site |
| DM South East | `https://dmsoutheast.delhi.gov.in/` | District Administration | District Administration | Search-confirmed (2026-07-07) |
| DM South West | `https://dmsouthwest.delhi.gov.in/` | District Administration | District Administration | Search-confirmed (2026-07-07) |
| DM East | `https://dmeast.delhi.gov.in/` | District Administration | District Administration | Well-known official domain - S3WaaS district site |
| DM West | `https://dmwest.delhi.gov.in/` | District Administration | District Administration | Well-known official domain - S3WaaS district site |
| DM Central | `https://dmcentral.delhi.gov.in/` | District Administration | District Administration | Well-known official domain - S3WaaS district site |
| DM New Delhi | `https://dmnewdelhi.delhi.gov.in/` | District Administration | District Administration | Well-known official domain - S3WaaS district site |
| DM Shahdara | `https://dmshahdara.delhi.gov.in/` | District Administration | District Administration | Well-known official domain - S3WaaS district site |
## Adding / removing endpoints

Edit `data/endpoints.json` and re-run `npm run seed:endpoints` (upserts by URL, so
history is preserved), or use the admin API:

```bash
curl -X POST http://localhost:3000/api/services \
  -H 'Content-Type: application/json' -H "X-Admin-Key: $ADMIN_API_KEY" \
  -d '{"name":"New Portal","url":"https://example.delhi.gov.in/","department":"X","category":"GNCTD Portals"}'
```
