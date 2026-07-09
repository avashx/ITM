/* Ops dashboard: tiles, per-service latency chart, live check feed,
 * incidents, SSL expiry board, alert feed. */
/* global Chart */
(function () {
  'use strict';
  const { api, fmt, esc, slink, demoBanner, navActive, connectSocket, chartDefaults, onThemeChange, sevIcon } =
    window.ITM;
  let tk = chartDefaults(Chart);

  let latencyChart = null;
  let services = [];

  const ARROW =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>';

  async function loadTiles() {
    const s = await api('/api/status/summary');
    const avgLat = avg(
      s.categories.flatMap((c) => c.services.map((x) => x.latencyMs).filter((v) => v != null))
    );
    const nInc = s.activeIncidents.length;
    document.getElementById('tiles').innerHTML = `
      <div class="tile hero${nInc ? ' alert' : ''}">
        <a class="corner" href="/" title="Open public status page">${ARROW}</a>
        <div class="l">Open incidents</div>
        <div class="v">${fmt.n(nInc)}</div>
        <div class="delta">${nInc ? '<span class="up">&#9650;</span> teams alerted automatically' : 'all services responding'}</div>
      </div>
      <div class="tile"><div class="l">Services</div><div class="v">${fmt.n(s.totals.services)}</div><div class="delta">under 5-min watch</div></div>
      <div class="tile"><div class="l">Operational</div><div class="v good">${fmt.n(s.totals.operational)}</div><div class="delta">healthy responses</div></div>
      <div class="tile"><div class="l">Down</div><div class="v critical">${fmt.n(s.totals.down)}</div><div class="delta">3+ straight failures</div></div>
      <div class="tile"><div class="l">Avg latency</div><div class="v info">${fmt.ms(Math.round(avgLat || 0))}</div><div class="delta">last check cycle</div></div>`;
  }

  async function loadServices() {
    services = await api('/api/services');
    const sel = document.getElementById('latency-svc');
    sel.innerHTML = services
      .map((s) => `<option value="${s._id}">${esc(s.name)}</option>`)
      .join('');
    // Preselect the first down/degraded service for interest, else first
    const hot = services.find((s) => s.state.status !== 'operational');
    if (hot) sel.value = hot._id;
    await drawLatency();
  }

  async function drawLatency() {
    const sel = document.getElementById('latency-svc');
    const hours = document.getElementById('latency-hours').value;
    const id = sel.value;
    if (!id) return;
    const svc = services.find((s) => s._id === id);
    document.getElementById('latency-svc-name').textContent = svc ? svc.name : '';
    const checks = await api(`/api/services/${id}/checks?hours=${hours}`);

    const labels = checks.map((c) => fmt.dt(c.checkedAt));
    const data = checks.map((c) => (c.ok ? c.latencyMs : null));
    const fails = checks.map((c) => (c.ok ? null : 0));

    if (latencyChart) latencyChart.destroy();
    latencyChart = new Chart(document.getElementById('latency-chart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Latency (ms)',
            data,
            borderColor: tk.primary,
            backgroundColor: hexA(tk.primary, 0.08),
            fill: true,
            spanGaps: false,
          },
          {
            label: 'Failed check',
            data: fails,
            borderColor: tk.critical,
            backgroundColor: tk.critical,
            pointRadius: 3,
            pointHoverRadius: 5,
            showLine: false,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { maxTicksLimit: 8 }, grid: { display: false } },
          y: { beginAtZero: true, title: { display: true, text: 'ms' } },
        },
      },
    });
  }

  async function loadIncidents() {
    const rows = await api('/api/status/incidents?days=30');
    document.querySelector('#incident-tbl tbody').innerHTML =
      rows
        .slice(0, 12)
        .map(
          (i) => `<tr>
            <td>${slink(i.service ? i.service.name : '?', i.service && i.service.url)}<br><span class="muted small">${esc(i.lastError || '')}</span></td>
            <td>${fmt.dt(i.startedAt)}</td>
            <td class="num">${i.durationHours != null ? i.durationHours + ' h' : '-'}</td>
            <td><span class="pill ${i.status}">${i.status}</span></td>
          </tr>`
        )
        .join('') || '<tr><td colspan="4" class="muted">No incidents in the last 30 days</td></tr>';
  }

  async function loadSsl() {
    const rows = await api('/api/status/ssl');
    document.querySelector('#ssl-tbl tbody').innerHTML =
      rows
        .slice(0, 12)
        .map((r) => {
          const cls = r.daysRemaining <= 7 ? 'critical' : r.daysRemaining <= 30 ? '' : 'good';
          return `<tr>
            <td>${slink(r.name, r.url)}</td>
            <td class="muted">${esc(r.issuer || '-')}</td>
            <td class="num"><span class="${cls}" style="font-weight:650">${fmt.n(r.daysRemaining)}</span></td>
            <td>${r.validTo ? new Date(r.validTo).toLocaleDateString('en-IN') : '-'}</td>
          </tr>`;
        })
        .join('') || '<tr><td colspan="4" class="muted">No certificate data yet</td></tr>';
  }

  async function loadAlerts() {
    const rows = await api('/api/status/alerts?limit=30');
    document.getElementById('alert-feed').innerHTML =
      rows
        .map(
          (a) => `<div class="item ${a.severity}">
            ${sevIcon(a.severity)}
            <div class="ib">
              <b>${a.service && a.service.url
                ? `<a class="slink" href="${esc(a.service.url)}" target="_blank" rel="noopener" title="Open ${esc(a.service.name)} in a new tab">${esc(a.title)}</a>`
                : esc(a.title)}</b>${esc(a.message)}
              <div class="t">${fmt.dt(a.createdAt)} &middot; ${esc(a.type)}${a.email && a.email.sent ? ' &middot; emailed' : ''}</div>
            </div>
          </div>`
        )
        .join('') ||
      `<div class="item">${sevIcon('neutral')}<div class="ib"><b>No alerts yet</b></div></div>`;
  }

  function feedCheck(c) {
    const feed = document.getElementById('check-feed');
    const div = document.createElement('div');
    div.className = `item ${c.ok ? 'info' : 'critical'}`;
    const svc = services.find((s) => s._id === c.serviceId);
    div.innerHTML = `${sevIcon(c.ok ? 'info' : 'critical')}
      <div class="ib">
        <b>${slink(c.name, svc && svc.url)}</b> ${c.ok ? `OK — HTTP ${c.httpStatus} in ${fmt.ms(c.latencyMs)}` : `FAIL — ${esc(c.error)}`}
        <div class="t">${fmt.dt(c.checkedAt)}${c.mode !== 'live' ? ` &middot; ${c.mode}` : ''}</div>
      </div>`;
    feed.prepend(div);
    while (feed.children.length > 40) feed.removeChild(feed.lastChild);
  }

  function avg(a) {
    return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
  }

  /** hex color + alpha -> rgba() (CSS vars hold plain hex). */
  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  onThemeChange(() => {
    tk = chartDefaults(Chart);
    drawLatency();
  });

  navActive();
  demoBanner();
  loadTiles();
  loadServices();
  loadIncidents();
  loadSsl();
  loadAlerts();
  document.getElementById('latency-svc').addEventListener('change', drawLatency);
  document.getElementById('latency-hours').addEventListener('change', drawLatency);

  const socket = connectSocket();
  if (socket) {
    socket.on('check:result', feedCheck);
    socket.on('monitor:cycle', () => {
      loadTiles();
      loadSsl();
    });
    socket.on('alert:new', loadAlerts);
    socket.on('incident:opened', loadIncidents);
    socket.on('incident:closed', loadIncidents);
  }
})();
