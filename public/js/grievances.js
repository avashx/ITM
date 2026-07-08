/* Grievance analytics: Leaflet heat/cluster/choropleth layers over real Delhi
 * boundaries, trend + category charts, department SLA scorecard. */
/* global L, Chart */
(function () {
  'use strict';
  const { api, fmt, esc, demoBanner, navActive, connectSocket, chartDefaults } = window.ITM;
  const tk = chartDefaults(Chart);

  // Sequential blue ramp (reference palette) for choropleth magnitude
  const SEQ = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];

  let map;
  let activeLayer = null;
  let legendCtl = null;
  let boundaryLayer = null;
  let trendChart = null;
  let catChart = null;
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

  async function initMap() {
    map = L.map('map', { zoomSnap: 0.5 }).setView([28.61, 77.12], 10.5);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(map);
    // Delhi outline for context (renders even if tiles are unreachable)
    const boundary = await geo('boundary');
    boundaryLayer = L.geoJSON(boundary, {
      style: { color: tk.muted, weight: 1.5, fill: false, dashArray: '4 3' },
    }).addTo(map);
    map.fitBounds(boundaryLayer.getBounds());
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
          fillColor: g.priority === 'sos' ? tk.critical : tk.series[0], fillOpacity: 0.85,
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
            fillColor: v ? scale(v) : tk.grid, fillOpacity: 0.75,
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

  async function loadTiles() {
    const s = await api(`/api/grievances/stats/summary?${params()}`);
    const open = (s.byStatus.registered || 0) + (s.byStatus.in_progress || 0);
    document.getElementById('tiles').innerHTML = `
      <div class="tile"><div class="v">${fmt.n(s.total)}</div><div class="l">Grievances (window)</div></div>
      <div class="tile"><div class="v" style="color:var(--series-1)">${fmt.n(open)}</div><div class="l">Open</div></div>
      <div class="tile"><div class="v good">${fmt.n(s.byStatus.resolved || 0)}</div><div class="l">Resolved</div></div>
      <div class="tile"><div class="v critical">${fmt.pct(s.slaBreachRate)}</div><div class="l">Resolution SLA breach</div></div>
      <div class="tile"><div class="v">${s.avgResolutionHours !== null ? (s.avgResolutionHours / 24).toFixed(1) + 'd' : '-'}</div><div class="l">Avg resolution time</div></div>
      <div class="tile"><div class="v" style="color:var(--critical)">${fmt.n(s.byPriority.sos || 0)}</div><div class="l">SOS priority</div></div>`;
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
            backgroundColor: tk.series[0],
            borderRadius: 4,
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
          <td class="num" style="font-weight:650;color:${d.slaBreachPct > 20 ? 'var(--critical)' : d.slaBreachPct > 10 ? '#8a6200' : 'var(--good)'}">${fmt.pct(d.slaBreachPct)}</td>
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
