# IT Monitor - Executive Brief

**For:** Office of the Joint Director (IT), Information Technology Department, GNCTD
**From:** Aman Vashishth (Intern, IT Department)
**Re:** A zero-cost platform to keep Delhi's e-services up and to see grievance surges coming
**Date:** July 2026

---

## The problem

The Government of NCT of Delhi runs 500+ citizen-facing online services - e-District,
Delhi Jal Board, MCD, Transport, NFS ration, Revenue/DORIS, DISCOM portals and more.
Today there is **no single place that shows whether these services are actually up**.
The government usually learns that a portal is down the way citizens do: after
complaints pile up - often a day later, through PGMS or social media. By then the damage
(missed deadlines, repeat visits, frustrated citizens) is done.

Separately, grievance data sits in dashboards that count complaints but never ask **why**
a spike happened. The link between "the portal was down" and "complaints jumped the next
day" is never drawn, so departments react instead of prevent.

## The solution

**IT Monitor** is one platform that does three things:

1. **Watches the services.** It checks key GNCTD service URLs every 5 minutes, tracks
   uptime, speed, errors and even SSL-certificate expiry, and shows it all on a public
   **status page** - like the ones private tech companies run. When a service fails 3
   checks in a row, it opens an incident and **emails the concerned team immediately**.

2. **Maps the grievances.** It plots citizen complaints on a **heatmap of Delhi** by
   district and ward, auto-sorts them to the right department, and tracks whether they're
   being resolved within the promised time (SLA). At a glance: which departments and
   which areas are under the most pressure.

3. **Connects the two (the key innovation).** It overlays outages on complaint trends and
   automatically surfaces findings like *"e-District was down 6 hours on Tuesday, and
   certificate complaints rose ~146% over the next two days."* Even better, **when a
   service is down right now, it predicts the coming complaint surge and warns the
   department in advance** - so they can staff the helpdesk and post a notice before the
   flood arrives.

## Impact

- **Faster response:** outages caught in minutes, not after a day of complaints.
- **Proactive government:** departments warned of complaint surges *before* they happen.
- **Accountability:** a public, honest status page builds citizen trust; SLA breach
  tracking shows where to focus.
- **Evidence for decisions:** hard data linking infrastructure reliability to citizen
  impact - useful for budgeting and vendor SLAs.

## Cost

**Zero.** Built entirely on open-source software (Node.js, MongoDB, Leaflet, Chart.js)
and free service tiers (MongoDB Atlas free cluster, free email relay, OpenStreetMap).
It runs on a single free-tier cloud instance or an existing departmental server. No
licences, no procurement.

## Status & what's ready today

- A **working platform** with all three modules built and tested end-to-end.
- A researched, seeded catalogue of **85 real Delhi/GNCTD service endpoints** ready to
  monitor.
- A **live demo** runnable in minutes (uses clearly-labelled synthetic grievance data,
  since real PGMS data needs departmental access).
- Complete documentation: setup, deployment, API, data sources.

## What I need to go live

1. **Permission to monitor** the public service URLs (Module 1 needs *no internal
   access* - it only checks the same public pages citizens visit).
2. **Access to real grievance data** (PGMS export or Delhi open-data feed) to replace the
   synthetic dataset in Modules 2 & 3.
3. A **small server or free-tier cloud instance** to host it, and a departmental email
   address for alerts.

## Recommended next step

A **15-minute demo** on the running platform, then a 2-week pilot monitoring a shortlist
of high-traffic services (e-District, DJB, NFS ration, MCD) with alerts routed to the
relevant teams. Module 1 can start **immediately** with zero internal dependencies;
Modules 2 and 3 switch on as soon as real grievance data is available.

---
*This platform continues the work of my earlier GNCTD systems (DTC-TC real-time bus
tracking & digital challans; DMRC demand-analytics; NFL Drone Didi dashboard). It is
built to the same standard: production-quality, respectful of government infrastructure,
and free to run.*
