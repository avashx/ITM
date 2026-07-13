/* Public status page: hero tiles, category groups with 90-day uptime bars,
 * active incidents, client-side search, live socket refresh. */
(function () {
  'use strict';
  const { api, fmt, esc, slink, demoBanner, navActive, connectSocket, sevIcon } = window.ITM;

  const OVERALL_TEXT = {
    operational: 'All systems operational',
    degraded: 'Some services are degraded',
    outage: 'Service outage in progress',
  };
  const STATUS_LABEL = {
    operational: 'Operational',
    degraded: 'Degraded',
    down: 'Down',
    maintenance: 'Maintenance',
    unknown: 'Pending first check',
  };
  const ARROW =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>';

  async function load() {
    const s = await api('/api/status/summary');

    const overall = document.getElementById('overall');
    overall.className = `overall ${s.overall}`;
    document.getElementById('overall-text').textContent = OVERALL_TEXT[s.overall] || s.overall;
    document.getElementById('overall-time').textContent =
      `updated ${fmt.dt(s.generatedAt)}${s.simulated ? ' · simulated' : ''}`;

    const okPct = s.totals.services
      ? Math.round((s.totals.operational / s.totals.services) * 100)
      : 0;
    document.getElementById('tiles').innerHTML = `
      <div class="tile hero">
        <a class="corner" href="/dashboard.html" title="Open ops dashboard">${ARROW}</a>
        <div class="l">Services monitored</div>
        <div class="v">${fmt.n(s.totals.services)}</div>
        <div class="delta"><span class="up">&#9650;</span> ${okPct}% currently operational</div>
        <div class="meter"><i style="width:${okPct}%"></i></div>
      </div>
      <div class="tile">
        <div class="l">Operational</div>
        <div class="v good">${fmt.n(s.totals.operational)}</div>
        <div class="delta">healthy responses</div>
      </div>
      <div class="tile">
        <div class="l">Degraded</div>
        <div class="v warn">${fmt.n(s.totals.degraded)}</div>
        <div class="delta">slow &gt; 4s latency</div>
      </div>
      <div class="tile">
        <div class="l">Down</div>
        <div class="v critical">${fmt.n(s.totals.down)}</div>
        <div class="delta">${s.activeIncidents.length ? `<span class="down">&#9650;</span> ${s.activeIncidents.length} open incident(s)` : 'no open incidents'}</div>
      </div>`;

    const incCard = document.getElementById('incidents-card');
    const incEl = document.getElementById('incidents');
    if (s.activeIncidents.length) {
      incCard.style.display = '';
      incEl.innerHTML = s.activeIncidents
        .map(
          (i) => `<div class="item critical">
            ${sevIcon('critical')}
            <div class="ib">
              <b>${slink(i.service ? i.service.name : 'Unknown service', i.service && i.service.url)} — DOWN</b>
              ${esc(i.lastError || '')}
              <div class="t">since ${fmt.dt(i.startedAt)} &middot; ${esc(i.service ? i.service.department : '')}</div>
            </div>
          </div>`
        )
        .join('');
    } else {
      incCard.style.display = 'none';
    }

    // ---- ops peek card (live numbers straight from this summary) ----
    const avgLat = (() => {
      const vals = s.categories.flatMap((c) =>
        c.services.map((x) => x.latencyMs).filter((v) => v != null)
      );
      return vals.length ? Math.round(vals.reduce((a, v) => a + v, 0) / vals.length) : null;
    })();
    setPeek('pk-ops-inc', fmt.n(s.activeIncidents.length), s.activeIncidents.length ? 'critical' : 'good');
    setPeek('pk-ops-down', fmt.n(s.totals.down), s.totals.down ? 'critical' : 'good');
    setPeek('pk-ops-lat', fmt.ms(avgLat));

    const catsEl = document.getElementById('categories');
    catsEl.innerHTML = s.categories
      .map(
        (c) => `<section class="svc-cat">
          <h3>${esc(c.category)} <span class="n">${c.services.length}</span></h3>
          <div class="svc-group">${c.services.map(renderService).join('')}</div>
        </section>`
      )
      .join('');
    document.getElementById('svc-count').textContent = `${s.totals.services} endpoints`;
    const sideCount = document.getElementById('side-count');
    if (sideCount) sideCount.textContent = s.totals.services;
    const sideWatch = document.getElementById('side-watch');
    if (sideWatch) sideWatch.textContent = s.totals.services;
    applySearch(); // keep an active query filtered across refreshes
  }

  function renderService(svc) {
    const bars = (svc.bars || [])
      .map((u) => {
        if (u === null) return `<i title="no data"></i>`;
        const cls = u >= 99 ? 'u100' : u >= 95 ? 'u95' : 'u0';
        return `<i class="${cls}" title="${u}% uptime"></i>`;
      })
      .join('');
    return `<div class="svc" data-id="${svc.id}" data-url="${esc(svc.url)}" data-q="${esc((svc.name + ' ' + svc.department).toLowerCase())}" title="Open ${esc(svc.name)} in a new tab">
      <div class="name">${esc(svc.name)}<small>${esc(svc.department)}</small></div>
      <div class="bars" title="last 90 days">${bars}</div>
      <div class="meta">${svc.uptime90 !== null ? svc.uptime90 + '%' : '—'} <small>90d</small></div>
      <div class="meta">${fmt.ms(svc.latencyMs)}</div>
      <span class="pill ${svc.status}">${STATUS_LABEL[svc.status] || svc.status}</span>
      <span class="go"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg></span>
    </div>`;
  }

  // Clicking a service row opens the monitored government portal in a new tab
  document.getElementById('categories').addEventListener('click', (e) => {
    const row = e.target.closest('.svc');
    if (row && row.dataset.url) window.open(row.dataset.url, '_blank', 'noopener');
  });

  function setPeek(id, text, cls) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.classList.remove('critical', 'good');
    if (cls) el.classList.add(cls);
  }

  /** Grievance + correlation briefing numbers (fetched once per page view;
   * light queries, no need to refresh on every check cycle). */
  async function loadPeeks() {
    try {
      const [g, preds, ins] = await Promise.all([
        api('/api/grievances/stats/summary?days=30'),
        api('/api/correlation/predictions'),
        api('/api/correlation/insights?limit=100'),
      ]);
      setPeek('pk-g-total', fmt.n(g.total));
      setPeek('pk-g-sla', fmt.pct(g.slaBreachRate), g.slaBreachRate > 10 ? 'critical' : 'good');
      setPeek('pk-g-res', fmt.n(g.byStatus.resolved || 0), 'good');
      setPeek('pk-c-preds', fmt.n(preds.length), preds.length ? 'critical' : undefined);
      setPeek('pk-c-ins', ins.length >= 100 ? '100+' : fmt.n(ins.length));
      if (preds.length) {
        document.getElementById('pk-c-hint').textContent = preds[0].message;
      } else if (ins.length) {
        document.getElementById('pk-c-hint').textContent = ins[0].narrative;
      }
    } catch {
      /* peeks are decorative - never block the status page on them */
    }
  }

  // Whole peek card navigates to its section (internal, same tab)
  document.querySelectorAll('.peek[data-href]').forEach((card) => {
    card.addEventListener('click', () => {
      window.location.href = card.dataset.href;
    });
    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') window.location.href = card.dataset.href;
    });
  });

  /* ---- client-side search over service rows ---- */
  function applySearch() {
    const q = (document.getElementById('svc-search')?.value || '').trim().toLowerCase();
    document.querySelectorAll('.svc').forEach((row) => {
      row.style.display = !q || row.dataset.q.includes(q) ? '' : 'none';
    });
    // hide category sections whose every row is filtered out
    document.querySelectorAll('.svc-cat').forEach((cat) => {
      const any = [...cat.querySelectorAll('.svc')].some((r) => r.style.display !== 'none');
      cat.style.display = any ? '' : 'none';
    });
  }

  navActive();
  demoBanner();
  load().catch((e) => {
    document.getElementById('overall-text').textContent = `Failed to load status: ${e.message}`;
  });
  loadPeeks();
  document.getElementById('svc-search')?.addEventListener('input', applySearch);

  const socket = connectSocket();
  if (socket) {
    // Full refresh on cycle completion & incident transitions (cheap: 1 call)
    let t = null;
    const refresh = () => {
      clearTimeout(t);
      t = setTimeout(() => load().catch(() => {}), 800);
    };
    socket.on('monitor:cycle', refresh);
    socket.on('incident:opened', refresh);
    socket.on('incident:closed', refresh);
    socket.on('service:status_change', refresh);
  }
  // Fallback refresh for tabs without websockets
  setInterval(() => load().catch(() => {}), 120000);
})();
