/* Shared front-end utilities: API fetch, socket wiring, formatting, tokens. */
/* global io */
(function () {
  'use strict';

  async function api(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
    return res.json();
  }

  /** Connect Socket.io once per page; returns the socket (or null offline). */
  function connectSocket() {
    if (typeof io === 'undefined') return null;
    return io({ transports: ['websocket', 'polling'] });
  }

  /** Read chart-friendly colors off CSS custom properties. */
  function tokens() {
    const s = getComputedStyle(document.documentElement);
    const t = (n) => s.getPropertyValue(n).trim();
    return {
      series: [1, 2, 3, 4, 5, 6, 7].map((i) => t(`--series-${i}`)),
      good: t('--good'),
      warning: t('--warning'),
      critical: t('--critical'),
      grid: t('--grid'),
      muted: t('--muted'),
      ink2: t('--ink-2'),
      surface: t('--surface'),
    };
  }

  /** Base Chart.js options: recessive grid/axes, muted ink, thin marks. */
  function chartDefaults(Chart) {
    const tk = tokens();
    Chart.defaults.font.family = "system-ui, -apple-system, 'Segoe UI', sans-serif";
    Chart.defaults.font.size = 11.5;
    Chart.defaults.color = tk.muted;
    Chart.defaults.borderColor = tk.grid;
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.boxHeight = 10;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyle = 'circle';
    Chart.defaults.elements.line.borderWidth = 2;
    Chart.defaults.elements.line.tension = 0.25;
    Chart.defaults.elements.point.radius = 0;
    Chart.defaults.elements.point.hoverRadius = 4;
    return tk;
  }

  const fmt = {
    dt(v) {
      if (!v) return '-';
      return new Date(v).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
      });
    },
    day(v) {
      return new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    },
    n(v) {
      return v === null || v === undefined ? '-' : Number(v).toLocaleString('en-IN');
    },
    pct(v) {
      return v === null || v === undefined ? '-' : `${v}%`;
    },
    ms(v) {
      return v === null || v === undefined ? '-' : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v}ms`;
    },
  };

  /** Show the demo banner when the server runs in simulate mode. */
  async function demoBanner() {
    try {
      const cfg = await api('/api/meta/config');
      if (cfg.simulate) {
        const el = document.getElementById('demo-banner');
        if (el) {
          el.classList.add('on');
          el.textContent =
            'DEMO MODE - health checks are SIMULATED (SIMULATE_CHECKS=true). No real traffic is sent to government servers.';
        }
      }
      return cfg;
    } catch {
      return {};
    }
  }

  /** Mark the current nav link active. */
  function navActive() {
    const here = location.pathname.replace(/\/$/, '') || '/index.html';
    document.querySelectorAll('.nav a').forEach((a) => {
      const target = a.getAttribute('href').replace(/\/$/, '');
      if (here === target || (here === '' && target === '/index.html') ||
          (here === '/index.html' && target === '/')) a.classList.add('active');
      if (here === '/' && target === '/') a.classList.add('active');
    });
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  window.ITM = { api, connectSocket, tokens, chartDefaults, fmt, demoBanner, navActive, esc };
})();
