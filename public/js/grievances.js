/* Grievance analytics: Leaflet heat/cluster/choropleth layers over real Delhi
 * boundaries (theme-aware Carto basemaps), trend chart, resolution gauge,
 * top categories, department SLA scorecard. */
/* global L, Chart */
(function () {
  'use strict';
  const { api, fmt, esc, demoBanner, navActive, connectSocket, chartDefaults, onThemeChange } =
    window.ITM;
  let tk = chartDefaults(Chart);

  // Sequential indigo ramp (brand accent) for choropleth magnitude: light -> deep
  const SEQ = ['#e4e6fc', '#c8ccf9', '#a7adf4', '#858eee', '#6570e4', '#4a53c8', '#343b9e'];

  const ARROW =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/></svg>';

  let map;
  let lightTiles = null;
  let darkTiles = null;
  let activeLayer = null;
  let legendCtl = null;
  let boundaryLayer = null;
  let trendChart = null;
  let catChart = null;
  let gaugeChart = null;
  const geoCache = {};

  function params() {
    const q = new URLSearchParams();
    const dept = document.getElementById('f-dept').value;
    const days = document.getElementById('f-days').value;
    const status = document.getElementById('f-status').value;
    if (dept) q.set('department', dept);
    if (days) q.set('days', days);
    if (status) q.set('status', status);
    return q.toString();
  }

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  async function initMap() {
    map = L.map('map', { zoomSnap: 0.5 }).setView([28.61, 77.12], 10.5);
    // Carto light/dark rasters (already whitelisted in the CSP); swapped on
    // theme change so the map matches the app chrome.
    lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    });
    darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    });
    (currentTheme() === 'dark' ? darkTiles : lightTiles).addTo(map);

    // Delhi outline for context (renders even if tiles are unreachable)
    const boundary = await geo('boundary');
    boundaryLayer = L.geoJSON(boundary, {
      style: { color: tk.muted, weight: 1.5, fill: false, dashArray: '4 3' },
    }).addTo(map);
    map.fitBounds(boundaryLayer.getBounds());
  }

  function swapBasemap(theme) {
    if (!map || !lightTiles || !darkTiles) return;
    if (theme === 'dark') {
      map.removeLayer(lightTiles);
      darkTiles.addTo(map);
    } else {
      map.removeLayer(darkTiles);
      lightTiles.addTo(map);
    }
  }

  async function geo(layer) {
    if (!geoCache[layer]) geoCache[layer] = await api(`/api/meta/geo/${layer}`);
    return geoCache[layer];
  }

  function clearLayer() {
    if (activeLayer) {
      map.removeLayer(activeLayer);
      activeLayer = null;
    }
    if (legendCtl) {
      map.removeControl(legendCtl);
      legendCtl = null;
    }
  }

  async function drawMapLayer() {
    clearLayer();
    const mode = document.getElementById('f-layer').value;
    const q = params();

    if (mode === 'heat') {
      const pts = await api(`/api/grievances/stats/heatmap?${q}`);
      activeLayer = L.heatLayer(pts, {
        radius: 22, blur: 18, maxZoom: 13, minOpacity: 0.25,
      }).addTo(map);
    } else if (mode === 'cluster') {
      const rows = await api(`/api/grievances/stats/points?${q}&limit=3000`);
      const cluster = L.markerClusterGroup({ maxClusterRadius: 46 });
      for (const g of rows) {
        const m = L.circleMarker([g.location.lat, g.location.lng], {
          radius: 5, weight: 1.5, color: '#fff',
          fillColor: g.priority === 'sos' ? tk.critical : tk.primary, fillOpacity: 0.85,
        });
        m.bindPopup(
          `<b>${esc(g.grievanceId)}</b> <span class="pill ${g.status}">${esc(g.status)}</span><br>` +
          `${esc(g.category)} &middot; ${esc(g.department)}<br>` +
          `<i>${esc(g.description)}</i><br>` +
          `<small>${esc(g.location.ward || '')}, ${esc(g.location.district || '')} &middot; ${fmt.dt(g.registeredAt)}</small>`
        );
        cluster.addLayer(m);
      }
      activeLayer = cluster.addTo(map);
    } else {
      // district / ward choropleth joined onto the real boundary files
      const level = mode;
      const [{ counts }, fc] = await Promise.all([
        api(`/api/grievances/stats/choropleth?level=${level}&${q}`),
        geo(level === 'district' ? 'districts' : 'wards'),
      ]);
      const nameOf = (f) =>
        level === 'district'
          ? f.properties.dtname
          : titleCase(f.properties.Ward_Name || '');
      const values = Object.values(counts);
      const max = Math.max(1, ...values);
      const scale = (v) => SEQ[Math.min(SEQ.length - 1, Math.floor((v / max) * (SEQ.length - 1)))];
      activeLayer = L.geoJSON(fc, {
        style: (f) => {
          const v = counts[nameOf(f)] || 0;
          return {
            color: tk.surface, weight: 1,
            fillColor: v ? scale(v) : tk.grid, fillOpacity: 0.78,
          };
        },
        onEachFeature: (f, lyr) => {
          const name = nameOf(f);
          const v = counts[name] || 0;
          lyr.bindTooltip(`${esc(name)}: ${fmt.n(v)} complaint(s)`, { sticky: true });
        },
      }).addTo(map);

      legendCtl = L.control({ position: 'bottomright' });
      legendCtl.onAdd = () => {
        const div = L.DomUtil.create('div', 'legend');
        const steps = 5;
        let html = `<b>Complaints / ${level}</b><br>`;
        for (let i = 0; i < steps; i++) {
          const lo = Math.round((i / steps) * max);
          const hi = Math.round(((i + 1) / steps) * max);
          html += `<i style="background:${SEQ[Math.floor((i / (steps - 1)) * (SEQ.length - 1))]}"></i>${lo}&ndash;${hi}<br>`;
        }
        div.innerHTML = html;
        return div;
      };
      legendCtl.addTo(map);
    }
  }

  let lastSummary = null;
  async function loadTiles() {
    const s = await api(`/api/grievances/stats/summary?${params()}`);
    lastSummary = s;
    const open = (s.byStatus.registered || 0) + (s.byStatus.in_progress || 0);
    document.getElementById('tiles').innerHTML = `
      <div class="tile hero">
        <a class="corner" href="/correlation.html" title="Open correlation engine">${ARROW}</a>
        <div class="l">Grievances in window</div>
        <div class="v">${fmt.n(s.total)}</div>
        <div class="delta"><span class="up">&#9650;</span> ${fmt.n(s.byStatus.resolved || 0)} resolved</div>
        <div class="meter"><i style="width:${s.total ? Math.round(((s.byStatus.resolved || 0) / s.total) * 100) : 0}%"></i></div>
      </div>
      <div class="tile"><span class="ti info"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></span><div class="l">Open</div><div class="v info">${fmt.n(open)}</div><div class="delta">registered + in progress</div></div>
      <div class="tile"><span class="ti critical"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></span><div class="l">SLA breach</div><div class="v critical">${fmt.pct(s.slaBreachRate)}</div><div class="delta">resolution &gt; 30 days</div></div>
      <div class="tile"><span class="ti neutral"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span><div class="l">Avg resolution</div><div class="v">${s.avgResolutionHours !== null ? (s.avgResolutionHours / 24).toFixed(1) : '-'}<span class="unit">days</span></div><div class="delta">median ${s.medianResolutionHours !== null ? (s.medianResolutionHours / 24).toFixed(1) + 'd' : '-'}</div></div>
      <div class="tile"><span class="ti warn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg></span><div class="l">SOS priority</div><div class="v warn">${fmt.n(s.byPriority.sos || 0)}</div><div class="delta">3-day clock</div></div>`;
    drawGauge();
  }

  /** Semi-doughnut: share of grievances resolved / in progress / registered /
   * rejected in the current window, resolved % in the centre. */
  function drawGauge() {
    if (!lastSummary) return;
    const s = lastSummary;
    const parts = [
      { label: 'Resolved', v: s.byStatus.resolved || 0, color: tk.primary },
      { label: 'In progress', v: s.byStatus.in_progress || 0, color: tk.warning },
      { label: 'Registered', v: s.byStatus.registered || 0, color: tk.info },
      { label: 'Rejected', v: s.byStatus.rejected || 0, color: tk.lineStrong },
    ];
    const total = parts.reduce((a, p) => a + p.v, 0) || 1;
    const resolvedPct = Math.round(((s.byStatus.resolved || 0) / total) * 100);

    document.getElementById('gauge-val').textContent = `${resolvedPct}%`;
    document.getElementById('gauge-legend').innerHTML = parts
      .map(
        (p) =>
          `<span class="li"><span class="sw" style="background:${p.color}"></span>${p.label} <span class="mono muted">${fmt.n(p.v)}</span></span>`
      )
      .join('');

    if (gaugeChart) gaugeChart.destroy();
    gaugeChart = new Chart(document.getElementById('gauge-chart'), {
      type: 'doughnut',
      data: {
        labels: parts.map((p) => p.label),
        datasets: [
          {
            data: parts.map((p) => p.v),
            backgroundColor: parts.map((p) => p.color),
            borderColor: tk.surface,
            borderWidth: 3,
            borderRadius: 8,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        rotation: -90,
        circumference: 180,
        cutout: '72%',
        plugins: { legend: { display: false } },
      },
    });
  }

  async function loadTrend() {
    const t = await api(`/api/grievances/stats/trends?${params()}`);
    const labels = t.days.map(fmt.day);
    const datasets = [
      {
        label: 'All departments',
        data: t.total,
        borderColor: tk.ink2,
        borderWidth: 2.5,
        backgroundColor: 'transparent',
      },
      ...t.departments.map((d, i) => ({
        label: d.department,
        data: d.counts,
        borderColor: tk.series[i % tk.series.length],
        backgroundColor: 'transparent',
      })),
    ];
    if (trendChart) trendChart.destroy();
    trendChart = new Chart(document.getElementById('trend-chart'), {
      type: 'line',
      data: { labels, datasets },
      options: {
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { ticks: { maxTicksLimit: 10 }, grid: { display: false } },
          y: { beginAtZero: true },
        },
      },
    });
  }

  async function loadCategories() {
    const rows = await api(`/api/grievances/stats/categories?${params()}&limit=10`);
    if (catChart) catChart.destroy();
    catChart = new Chart(document.getElementById('cat-chart'), {
      type: 'bar',
      data: {
        labels: rows.map((r) => r.category),
        datasets: [
          {
            label: 'Complaints',
            data: rows.map((r) => r.count),
            backgroundColor: tk.primary,
            borderRadius: 6,
            barThickness: 14,
          },
        ],
      },
      options: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true },
          y: { grid: { display: false }, ticks: { autoSkip: false, font: { size: 10.5 } } },
        },
      },
    });
  }

  async function loadDeptTable() {
    const rows = await api(`/api/grievances/stats/departments?${params()}`);
    document.querySelector('#dept-tbl tbody').innerHTML =
      rows
        .map(
          (d) => `<tr>
          <td>${esc(d.department)}</td>
          <td class="num">${fmt.n(d.total)}</td>
          <td class="num">${fmt.n(d.open)}</td>
          <td class="num">${fmt.n(d.resolved)}</td>
          <td class="num" style="font-weight:750;color:${d.slaBreachPct > 20 ? 'var(--critical)' : d.slaBreachPct > 10 ? 'var(--warning)' : 'var(--good)'}">${fmt.pct(d.slaBreachPct)}</td>
          <td class="num">${d.avgResolutionDays ?? '-'}</td>
        </tr>`
        )
        .join('') || '<tr><td colspan="6" class="muted">No grievances in this window</td></tr>';
  }

  async function loadDepartments() {
    const depts = await api('/api/grievances/meta/departments');
    document.getElementById('f-dept').innerHTML =
      '<option value="">All departments</option>' +
      depts.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('');
  }

  function titleCase(s) {
    return String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }

  async function refresh() {
    await Promise.all([loadTiles(), loadTrend(), loadCategories(), loadDeptTable(), drawMapLayer()]);
  }

  onThemeChange((theme) => {
    tk = chartDefaults(Chart);
    swapBasemap(theme);
    loadTrend().catch(() => {});
    loadCategories().catch(() => {});
    drawGauge();
  });

  navActive();
  demoBanner();
  loadDepartments().then(async () => {
    await initMap();
    await refresh();
  });
  document.getElementById('f-apply').addEventListener('click', refresh);
  document.getElementById('f-layer').addEventListener('change', drawMapLayer);

  const socket = connectSocket();
  if (socket) {
    let t = null;
    socket.on('grievance:new', () => {
      clearTimeout(t);
      t = setTimeout(() => loadTiles().catch(() => {}), 1500);
    });
  }
})();
