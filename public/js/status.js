/* Public status page: category groups, per-service rows with 90-day uptime
 * bars, active incidents, live socket refresh. */
(function () {
  'use strict';
  const { api, fmt, esc, demoBanner, navActive, connectSocket } = window.ITM;

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

  async function load() {
    const s = await api('/api/status/summary');

    const overall = document.getElementById('overall');
    overall.className = `overall ${s.overall}`;
    document.getElementById('overall-text').textContent = OVERALL_TEXT[s.overall] || s.overall;
    document.getElementById('overall-time').textContent =
      `updated ${fmt.dt(s.generatedAt)}${s.simulated ? ' · simulated' : ''}`;

    document.getElementById('tiles').innerHTML = `
      <div class="tile"><div class="v">${fmt.n(s.totals.services)}</div><div class="l">Services monitored</div></div>
      <div class="tile"><div class="v good">${fmt.n(s.totals.operational)}</div><div class="l">Operational</div></div>
      <div class="tile"><div class="v" style="color:var(--warning)">${fmt.n(s.totals.degraded)}</div><div class="l">Degraded</div></div>
      <div class="tile"><div class="v critical">${fmt.n(s.totals.down)}</div><div class="l">Down</div></div>`;

    const incCard = document.getElementById('incidents-card');
    const incEl = document.getElementById('incidents');
    if (s.activeIncidents.length) {
      incCard.style.display = '';
      incEl.innerHTML = s.activeIncidents
        .map(
          (i) => `<div class="item critical">
            <b>${esc(i.service ? i.service.name : 'Unknown service')} - DOWN</b>
            ${esc(i.lastError || '')}
            <div class="t">since ${fmt.dt(i.startedAt)} &middot; ${esc(i.service ? i.service.department : '')}</div>
          </div>`
        )
        .join('');
    } else {
      incCard.style.display = 'none';
    }

    const catsEl = document.getElementById('categories');
    catsEl.innerHTML = s.categories
      .map(
        (c) => `<section class="svc-cat">
          <h3>${esc(c.category)} <span class="muted small">(${c.services.length})</span></h3>
          ${c.services.map(renderService).join('')}
        </section>`
      )
      .join('');
    document.getElementById('svc-count').textContent = `${s.totals.services} endpoints`;
  }

  function renderService(svc) {
    const bars = (svc.bars || [])
      .map((u, i) => {
        if (u === null) return `<i title="no data"></i>`;
        const cls = u >= 99 ? 'u100' : u >= 95 ? 'u95' : 'u0';
        return `<i class="${cls}" title="${u}% uptime"></i>`;
      })
      .join('');
    return `<div class="svc" data-id="${svc.id}">
      <div class="name">${esc(svc.name)}<small>${esc(svc.department)}</small></div>
      <div class="bars" title="last 90 days">${bars}</div>
      <div class="meta">${svc.uptime90 !== null ? svc.uptime90 + '% / 90d' : 'no data'}</div>
      <div class="meta">${fmt.ms(svc.latencyMs)}</div>
      <span class="pill ${svc.status}">${STATUS_LABEL[svc.status] || svc.status}</span>
    </div>`;
  }

  navActive();
  demoBanner();
  load().catch((e) => {
    document.getElementById('overall-text').textContent = `Failed to load status: ${e.message}`;
  });

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
