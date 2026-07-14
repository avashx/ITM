/* Grievance Command Center.
 *
 * Layout: the Delhi map is the full-bleed canvas; every panel is a glass card
 * floating over it. Cards are draggable and collapsible, and their positions
 * persist per browser (localStorage) — "Reset layout" restores the defaults
 * declared in the markup via data-x / data-y / data-w.
 *
 * Charts: a radar ("web") chart profiles the top complaint categories by
 * registered vs resolved volume; a semi-doughnut shows resolution progress.
 */
/* global L, Chart */
(function () {
  'use strict';
  const { api, fmt, esc, demoBanner, navActive, connectSocket, chartDefaults, onThemeChange } =
    window.ITM;
  let tk = chartDefaults(Chart);

  // Sequential violet ramp for choropleth magnitude (matches the dark canvas)
  const SEQ = ['#2b2450', '#3d2f77', '#51399f', '#6a4fc7', '#8b7cff', '#a99bff', '#c9c0ff'];

  let map, lightTiles, darkTiles;
  let activeLayer = null;
  let boundaryLayer = null;
  let radarChart = null;
  let gaugeChart = null;
  let lastSummary = null;
  const geoCache = {};
  const POS_KEY = 'itm-cc-layout';

  /* ---------------------------------------------------------------- filters */
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
  function layerMode() {
    return document.querySelector('#f-layer button.on').dataset.v;
  }
  const isDark = () => document.documentElement.getAttribute('data-theme') !== 'light';

  /* ------------------------------------------------------------------- map */
  async function initMap() {
    map = L.map('map', { zoomSnap: 0.5, zoomControl: false, attributionControl: true })
      .setView([28.61, 77.12], 10.5);
    const attr = '&copy; OpenStreetMap contributors &copy; CARTO';
    lightTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: attr });
    darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, attribution: attr });
    (isDark() ? darkTiles : lightTiles).addTo(map);

    const boundary = await geo('boundary');
    boundaryLayer = L.geoJSON(boundary, {
      style: { color: tk.primary, weight: 1.5, fill: false, dashArray: '5 4', opacity: 0.7 },
    }).addTo(map);
    // the container is fixed/full-bleed; recompute after layout settles or
    // Leaflet only paints the band it measured at construction time
    map.invalidateSize();
    map.fitBounds(boundaryLayer.getBounds(), { paddingTopLeft: [370, 120], paddingBottomRight: [350, 50] });
    window.addEventListener('resize', () => map.invalidateSize());
  }
  function swapBasemap(theme) {
    if (!map) return;
    if (theme === 'dark') { map.removeLayer(lightTiles); darkTiles.addTo(map); }
    else { map.removeLayer(darkTiles); lightTiles.addTo(map); }
  }
  async function geo(layer) {
    if (!geoCache[layer]) geoCache[layer] = await api(`/api/meta/geo/${layer}`);
    return geoCache[layer];
  }

  async function drawMapLayer() {
    if (activeLayer) { map.removeLayer(activeLayer); activeLayer = null; }
    const mode = layerMode();
    const q = params();
    const scaleWrap = document.getElementById('cc-scale-wrap');
    scaleWrap.style.display = 'none';

    if (mode === 'heat') {
      const pts = await api(`/api/grievances/stats/heatmap?${q}`);
      activeLayer = L.heatLayer(pts, { radius: 24, blur: 20, maxZoom: 13, minOpacity: 0.3 }).addTo(map);
    } else if (mode === 'cluster') {
      const rows = await api(`/api/grievances/stats/points?${q}&limit=3000`);
      const cluster = L.markerClusterGroup({ maxClusterRadius: 46 });
      for (const g of rows) {
        const m = L.circleMarker([g.location.lat, g.location.lng], {
          radius: 5, weight: 1.5, color: 'rgba(255,255,255,.7)',
          fillColor: g.priority === 'sos' ? tk.critical : tk.primary, fillOpacity: 0.9,
        });
        m.bindPopup(
          `<b>${esc(g.grievanceId)}</b> <span class="pill ${g.status}">${esc(g.status)}</span><br>` +
          `${esc(g.category)} &middot; ${esc(g.department)}<br><i>${esc(g.description)}</i><br>` +
          `<small>${esc(g.location.ward || '')}, ${esc(g.location.district || '')} &middot; ${fmt.dt(g.registeredAt)}</small>`
        );
        cluster.addLayer(m);
      }
      activeLayer = cluster.addTo(map);
    } else {
      const level = mode; // district | ward
      const [{ counts }, fc] = await Promise.all([
        api(`/api/grievances/stats/choropleth?level=${level}&${q}`),
        geo(level === 'district' ? 'districts' : 'wards'),
      ]);
      const nameOf = (f) =>
        level === 'district' ? f.properties.dtname : titleCase(f.properties.Ward_Name || '');
      const max = Math.max(1, ...Object.values(counts));
      const scale = (v) => SEQ[Math.min(SEQ.length - 1, Math.floor((v / max) * (SEQ.length - 1)))];
      activeLayer = L.geoJSON(fc, {
        style: (f) => {
          const v = counts[nameOf(f)] || 0;
          return {
            color: 'rgba(255,255,255,.25)', weight: 0.8,
            fillColor: v ? scale(v) : 'rgba(255,255,255,.04)', fillOpacity: 0.72,
          };
        },
        onEachFeature: (f, lyr) => {
          const name = nameOf(f);
          lyr.bindTooltip(`${esc(name)}: ${fmt.n(counts[name] || 0)}`, { sticky: true });
        },
      }).addTo(map);

      // scale + top-5 legend inside the layers card
      scaleWrap.style.display = '';
      document.getElementById('cc-scale').innerHTML = SEQ.map((c) => `<i style="background:${c}"></i>`).join('');
      document.getElementById('cc-scale-max').textContent = fmt.n(max);
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
      document.getElementById('cc-top-districts').innerHTML = top
        .map(([n, v]) => `<span class="li"><span class="sw" style="background:${scale(v)}"></span>${esc(n)}<span class="n">${fmt.n(v)}</span></span>`)
        .join('');
      return;
    }
    document.getElementById('cc-top-districts').innerHTML = '';
  }

  /* ------------------------------------------------------------------ KPIs */
  async function loadKpis() {
    const s = await api(`/api/grievances/stats/summary?${params()}`);
    lastSummary = s;
    const open = (s.byStatus.registered || 0) + (s.byStatus.in_progress || 0);
    document.getElementById('kpis').innerHTML = `
      <div class="cc-kpi"><div class="l">Grievances</div><div class="v">${fmt.n(s.total)}</div><div class="s">in window</div></div>
      <div class="cc-kpi"><div class="l">Open</div><div class="v warn">${fmt.n(open)}</div><div class="s">registered + in progress</div></div>
      <div class="cc-kpi"><div class="l">SLA breach</div><div class="v critical">${fmt.pct(s.slaBreachRate)}</div><div class="s">resolution &gt; 30 days</div></div>
      <div class="cc-kpi"><div class="l">Avg resolution</div><div class="v good">${s.avgResolutionHours !== null ? (s.avgResolutionHours / 24).toFixed(1) : '-'}<span style="font-size:11px;color:var(--muted)">d</span></div><div class="s">median ${s.medianResolutionHours !== null ? (s.medianResolutionHours / 24).toFixed(1) + 'd' : '-'}</div></div>`;
    drawGauge();
  }

  /* ------------------------------------------------- radar ("web") chart */
  async function drawRadar() {
    const rows = await api(`/api/grievances/stats/categories?${params()}&limit=8`);
    if (!rows.length) return;
    document.getElementById('radar-n').textContent = `TOP ${rows.length}`;

    // registered-vs-resolved split per category, from one filtered pass
    const [openRows, resolvedRows] = await Promise.all([
      api(`/api/grievances/stats/categories?${params()}&status=registered&limit=40`),
      api(`/api/grievances/stats/categories?${params()}&status=resolved&limit=40`),
    ]);
    const openBy = Object.fromEntries(openRows.map((r) => [r.category, r.count]));
    const resBy = Object.fromEntries(resolvedRows.map((r) => [r.category, r.count]));

    const labels = rows.map((r) => r.category);
    if (radarChart) radarChart.destroy();
    radarChart = new Chart(document.getElementById('radar-chart'), {
      type: 'radar',
      data: {
        labels,
        datasets: [
          {
            label: 'Registered',
            data: labels.map((c) => openBy[c] || 0),
            borderColor: tk.primary,
            backgroundColor: hexA(tk.primary, 0.18),
            pointBackgroundColor: tk.primary,
            pointRadius: 2.5,
            borderWidth: 2,
          },
          {
            label: 'Resolved',
            data: labels.map((c) => resBy[c] || 0),
            borderColor: tk.good,
            backgroundColor: hexA(tk.good, 0.14),
            pointBackgroundColor: tk.good,
            pointRadius: 2.5,
            borderWidth: 2,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          r: {
            angleLines: { color: tk.grid },
            grid: { color: tk.grid },
            pointLabels: { color: tk.ink2, font: { size: 8.5, weight: '600' } },
            ticks: { display: false, backdropColor: 'transparent' },
            beginAtZero: true,
          },
        },
      },
    });
  }

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
    document.getElementById('gauge-val').textContent =
      `${Math.round(((s.byStatus.resolved || 0) / total) * 100)}%`;
    document.getElementById('gauge-legend').innerHTML = parts
      .map((p) => `<span class="li"><span class="sw" style="background:${p.color}"></span>${p.label} <span class="mono muted">${fmt.n(p.v)}</span></span>`)
      .join('');

    if (gaugeChart) gaugeChart.destroy();
    gaugeChart = new Chart(document.getElementById('gauge-chart'), {
      type: 'doughnut',
      data: {
        labels: parts.map((p) => p.label),
        datasets: [{
          data: parts.map((p) => p.v),
          backgroundColor: parts.map((p) => p.color),
          borderColor: 'transparent', borderWidth: 2, borderRadius: 8,
        }],
      },
      options: {
        maintainAspectRatio: false, rotation: -90, circumference: 180, cutout: '72%',
        plugins: { legend: { display: false } },
      },
    });
  }

  async function loadDeptTable() {
    const rows = await api(`/api/grievances/stats/departments?${params()}`);
    document.querySelector('#dept-tbl tbody').innerHTML =
      rows.map((d) => `<tr>
          <td>${esc(d.department)}</td>
          <td class="num">${fmt.n(d.total)}</td>
          <td class="num" style="font-weight:750;color:${d.slaBreachPct > 20 ? 'var(--critical)' : d.slaBreachPct > 10 ? 'var(--warning)' : 'var(--good)'}">${fmt.pct(d.slaBreachPct)}</td>
        </tr>`).join('') ||
      '<tr><td colspan="3" class="muted">No grievances in this window</td></tr>';
  }

  async function loadDepartments() {
    const depts = await api('/api/grievances/meta/departments');
    document.getElementById('f-dept').innerHTML =
      '<option value="">All departments</option>' +
      depts.map((d) => `<option value="${esc(d.name)}">${esc(d.name)}</option>`).join('');
  }

  /* ------------------------------------------- draggable / collapsible cards */
  function layoutCards() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(POS_KEY) || '{}'); } catch {}
    const layer = document.getElementById('cc-layer');
    const W = layer.clientWidth;

    document.querySelectorAll('.cc-card').forEach((card) => {
      const s = saved[card.id];
      const dx = parseInt(card.dataset.x, 10);
      const dy = parseInt(card.dataset.y, 10);
      const w = parseInt(card.dataset.w, 10);
      // negative default x = anchored to the right edge
      const x = s ? s.x : dx < 0 ? W + dx : dx;
      const y = s ? s.y : dy;
      card.style.width = `${w}px`;
      card.style.left = `${x}px`;
      card.style.top = `${y}px`;
      if (s && s.collapsed) card.classList.add('collapsed');
    });
  }

  function savePositions() {
    const out = {};
    document.querySelectorAll('.cc-card').forEach((c) => {
      out[c.id] = {
        x: parseInt(c.style.left, 10),
        y: parseInt(c.style.top, 10),
        collapsed: c.classList.contains('collapsed'),
      };
    });
    try { localStorage.setItem(POS_KEY, JSON.stringify(out)); } catch {}
  }

  function enableDrag() {
    const layer = document.getElementById('cc-layer');
    document.querySelectorAll('.cc-card').forEach((card) => {
      const handle = card.querySelector('.cc-hd') || card;
      handle.style.cursor = 'grab';
      handle.addEventListener('pointerdown', (e) => {
        if (e.target.closest('button')) return; // collapse button, not a drag
        e.preventDefault();
        const startX = e.clientX;
        const startY = e.clientY;
        const ox = parseInt(card.style.left, 10) || 0;
        const oy = parseInt(card.style.top, 10) || 0;
        card.classList.add('dragging');
        card.style.zIndex = 20;
        handle.setPointerCapture(e.pointerId);

        const move = (ev) => {
          const maxX = layer.clientWidth - card.offsetWidth;
          const maxY = layer.clientHeight - 44;
          card.style.left = `${clamp(ox + ev.clientX - startX, 0, Math.max(0, maxX))}px`;
          card.style.top = `${clamp(oy + ev.clientY - startY, 0, Math.max(0, maxY))}px`;
        };
        const up = () => {
          card.classList.remove('dragging');
          card.style.zIndex = '';
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          savePositions();
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
      });
    });

    // collapse toggles
    document.querySelectorAll('[data-collapse]').forEach((b) => {
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        b.closest('.cc-card').classList.toggle('collapsed');
        savePositions();
      });
    });

    document.getElementById('cc-reset').addEventListener('click', () => {
      try { localStorage.removeItem(POS_KEY); } catch {}
      document.querySelectorAll('.cc-card').forEach((c) => c.classList.remove('collapsed'));
      layoutCards();
    });
  }

  /* --------------------------------------------------------------- helpers */
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const titleCase = (s) => String(s).toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  function hexA(hex, a) {
    const h = String(hex).replace('#', '');
    if (h.length < 3) return hex;
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  async function refresh() {
    await Promise.all([loadKpis(), drawRadar(), loadDeptTable(), drawMapLayer()]);
  }

  /* ------------------------------------------------------------------ boot */
  onThemeChange((theme) => {
    tk = chartDefaults(Chart);
    swapBasemap(theme);
    drawRadar().catch(() => {});
    drawGauge();
    if (boundaryLayer) boundaryLayer.setStyle({ color: tk.primary });
  });

  navActive();
  demoBanner();
  layoutCards();
  enableDrag();
  window.addEventListener('resize', () => {
    if (!localStorage.getItem(POS_KEY)) layoutCards();
  });

  loadDepartments().then(async () => {
    await initMap();
    await refresh();
  });

  document.querySelectorAll('#f-layer button').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('#f-layer button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      drawMapLayer().catch(() => {});
    });
  });
  ['f-dept', 'f-days', 'f-status'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => refresh().catch(() => {}));
  });

  const socket = connectSocket();
  if (socket) {
    let t = null;
    socket.on('grievance:new', () => {
      clearTimeout(t);
      t = setTimeout(() => loadKpis().catch(() => {}), 1500);
    });
  }
})();
