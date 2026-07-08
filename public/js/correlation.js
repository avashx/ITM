/* Correlation engine UI: complaint-volume timeline with shaded outage bands,
 * insight cards, and live surge predictions for open outages. */
/* global Chart */
(function () {
  'use strict';
  const { api, fmt, esc, demoBanner, navActive, connectSocket, chartDefaults, onThemeChange } =
    window.ITM;
  let tk = chartDefaults(Chart);

  let timelineChart = null;

  /** Chart.js inline plugin: draws translucent bands over outage windows. */
  const outageBands = {
    id: 'outageBands',
    beforeDatasetsDraw(chart) {
      const bands = chart.options.outageBands || [];
      if (!bands.length) return;
      const { ctx, chartArea, scales } = chart;
      ctx.save();
      for (const b of bands) {
        const x1 = scales.x.getPixelForValue(Math.max(0, b.fromIdx));
        const x2 = scales.x.getPixelForValue(Math.min(chart.data.labels.length - 1, b.toIdx));
        const w = Math.max(x2 - x1, 5);
        ctx.fillStyle = 'rgba(208, 59, 59, 0.14)';
        ctx.fillRect(x1, chartArea.top, w, chartArea.bottom - chartArea.top);
        ctx.strokeStyle = 'rgba(208, 59, 59, 0.5)';
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x1, chartArea.top, w, chartArea.bottom - chartArea.top);
      }
      ctx.restore();
    },
  };

  async function loadCategories() {
    const depts = await api('/api/grievances/meta/departments');
    const cats = depts.flatMap((d) => d.categories.map((c) => ({ dept: d.name, cat: c })));
    const sel = document.getElementById('f-cat');
    sel.innerHTML = cats
      .map((c) => `<option value="${esc(c.cat)}">${esc(c.cat)} (${esc(c.dept)})</option>`)
      .join('');
    // Default to the category most likely to show seeded patterns
    const preferred = 'Certificates (e-District)';
    if (cats.some((c) => c.cat === preferred)) sel.value = preferred;
  }

  async function drawTimeline() {
    const category = document.getElementById('f-cat').value;
    const days = document.getElementById('f-days').value;
    const t = await api(
      `/api/correlation/timeline?category=${encodeURIComponent(category)}&days=${days}`
    );
    const labels = t.days.map(fmt.day);

    // Convert outage windows to x-index bands (day-bucket resolution)
    const bands = t.outages
      .map((o) => {
        const from = t.days.indexOf(dayKey(o.startedAt));
        const to = t.days.indexOf(dayKey(o.resolvedAt || new Date().toISOString()));
        return from === -1 && to === -1
          ? null
          : { fromIdx: from === -1 ? 0 : from, toIdx: to === -1 ? t.days.length - 1 : to, o };
      })
      .filter(Boolean);

    if (timelineChart) timelineChart.destroy();
    timelineChart = new Chart(document.getElementById('timeline-chart'), {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: `"${category}" complaints/day`,
            data: t.counts,
            borderColor: tk.primary,
            backgroundColor: hexA(tk.primary, 0.09),
            fill: true,
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
        outageBands: bands,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          tooltip: {
            callbacks: {
              footer: (items) => {
                const idx = items[0].dataIndex;
                const hit = bands.filter((b) => idx >= b.fromIdx && idx <= b.toIdx);
                return hit.length
                  ? hit.map((b) => `OUTAGE: ${b.o.service} (${b.o.durationHours ?? '?'}h)`).join('\n')
                  : '';
              },
            },
          },
        },
        scales: {
          x: { ticks: { maxTicksLimit: 12 }, grid: { display: false } },
          y: { beginAtZero: true, title: { display: true, text: 'complaints/day' } },
        },
      },
      plugins: [outageBands],
    });
  }

  function dayKey(iso) {
    // IST day bucket to match the API's dayBucket strings
    return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  }

  async function loadInsights() {
    const rows = await api('/api/correlation/insights?limit=50');
    document.getElementById('insights').innerHTML =
      rows
        .map(
          (i) => `<div class="insight">
          <div class="head">
            <span class="spike">+${Math.round((i.spikeRatio - 1) * 100)}%</span>
            <b>${esc(i.category)}</b>
            <span class="muted small">after ${esc(i.serviceName)} outage (${i.outage.durationHours}h)</span>
            <span class="pill ${i.confidence}" style="margin-left:auto">confidence: ${i.confidence}</span>
          </div>
          <p>${esc(i.narrative)}</p>
          <p class="fig">observed ${i.observedTotal} vs ~${Math.round(i.expectedTotal)} expected
             &middot; baseline ${i.baselineDailyMean}/day &middot; z=${i.zScore}</p>
        </div>`
        )
        .join('') ||
      '<span class="muted">No patterns detected yet - the engine runs nightly (or trigger POST /api/correlation/run).</span>';
  }

  async function loadPredictions() {
    const rows = await api('/api/correlation/predictions');
    document.getElementById('predictions').innerHTML = rows.length
      ? rows
          .map(
            (p) => `<div class="insight">
          <div class="head">
            <span class="spike violet">+${fmt.n(p.predictedExtraPerDay)}/day</span>
            <b>${esc(p.category)}</b>
            <span class="muted small">${esc(p.department)}</span>
            <span class="pill open" style="margin-left:auto">${esc(p.serviceName)} DOWN ${p.outageOpenHours}h</span>
          </div>
          <p>${esc(p.message)}</p>
        </div>`
          )
          .join('')
      : '<span class="muted">No open outages - nothing to predict. When a service goes down, expected complaint surges appear here and are alerted to departments.</span>';
  }

  /** hex color + alpha -> rgba() (CSS vars hold plain hex). */
  function hexA(hex, a) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  onThemeChange(() => {
    tk = chartDefaults(Chart);
    drawTimeline();
  });

  navActive();
  demoBanner();
  loadCategories().then(drawTimeline);
  loadInsights();
  loadPredictions();
  document.getElementById('f-apply').addEventListener('click', drawTimeline);
  document.getElementById('f-cat').addEventListener('change', drawTimeline);

  const socket = connectSocket();
  if (socket) {
    socket.on('correlation:insight', loadInsights);
    socket.on('incident:opened', loadPredictions);
    socket.on('incident:closed', loadPredictions);
  }
})();
