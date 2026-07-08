/* Shared front-end utilities: API fetch, socket wiring + live chip, theming,
 * IST clock, Chart.js defaults, formatting. */
/* global io */
(function () {
  'use strict';

  async function api(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
    return res.json();
  }

  /* ---- theme -----------------------------------------------------------
   * html[data-theme] is set by the inline boot script in each page <head>
   * (avoids a flash); this module owns toggling + persistence and lets
   * pages register chart-redraw callbacks for theme changes. */
  const themeCallbacks = [];
  function onThemeChange(fn) {
    themeCallbacks.push(fn);
  }
  function toggleTheme() {
    const next =
      document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('itm-theme', next);
    } catch {}
    themeCallbacks.forEach((fn) => {
      try {
        fn(next);
      } catch {}
    });
  }

  /** Connect Socket.io once per page; drives the header LIVE chip too. */
  function connectSocket() {
    if (typeof io === 'undefined') return null;
    const socket = io({ transports: ['websocket', 'polling'] });
    const chip = document.getElementById('live-chip');
    if (chip) {
      const set = (on) => {
        chip.classList.toggle('live', on);
        chip.classList.toggle('off', !on);
        const txt = chip.querySelector('.txt');
        if (txt) txt.textContent = on ? 'LIVE' : 'OFFLINE';
      };
      socket.on('connect', () => set(true));
      socket.on('disconnect', () => set(false));
    }
    return socket;
  }

  /** Header IST clock (mono), updates every second if #ist-clock exists. */
  function startClock() {
    const el = document.getElementById('ist-clock');
    if (!el) return;
    const tick = () => {
      el.textContent = new Date().toLocaleTimeString('en-IN', {
        hour12: false,
        timeZone: 'Asia/Kolkata',
      });
    };
    tick();
    setInterval(tick, 1000);
  }

  /** Read chart-friendly colors off CSS custom properties (theme-aware). */
  function tokens() {
    const s = getComputedStyle(document.documentElement);
    const t = (n) => s.getPropertyValue(n).trim();
    return {
      primary: t('--primary'),
      primaryDeep: t('--primary-deep'),
      mint: t('--mint'),
      good: t('--good'),
      warning: t('--warning'),
      critical: t('--critical'),
      info: t('--info'),
      violet: t('--violet'),
      grid: t('--line'),
      lineStrong: t('--line-strong'),
      muted: t('--muted'),
      ink2: t('--ink-2'),
      surface: t('--surface'),
      // categorical order for multi-series charts
      series: [t('--primary'), t('--info'), t('--warning'), t('--violet'), t('--critical'), t('--ink-2')],
    };
  }

  /** Base Chart.js options: recessive grid/axes, muted ink, thin marks.
   * Call again after a theme change (reads live CSS vars). */
  function chartDefaults(Chart) {
    const tk = tokens();
    Chart.defaults.font.family = "'Inter', system-ui, -apple-system, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.font.weight = 600;
    Chart.defaults.color = tk.muted;
    Chart.defaults.borderColor = tk.grid;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.plugins.legend.labels.boxHeight = 8;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.pointStyle = 'circle';
    Chart.defaults.plugins.tooltip.backgroundColor = tk.surface;
    Chart.defaults.plugins.tooltip.titleColor = tk.ink2;
    Chart.defaults.plugins.tooltip.bodyColor = tk.ink2;
    Chart.defaults.plugins.tooltip.borderColor = tk.lineStrong;
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.cornerRadius = 10;
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.elements.line.borderWidth = 2;
    Chart.defaults.elements.line.tension = 0.35;
    Chart.defaults.elements.point.radius = 0;
    Chart.defaults.elements.point.hoverRadius = 4;
    Chart.defaults.elements.bar.borderRadius = 5;
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

  /** Mark the current sidebar link active. */
  function navActive() {
    const here = location.pathname.replace(/\/$/, '') || '/index.html';
    document.querySelectorAll('.side-nav a').forEach((a) => {
      const target = a.getAttribute('href').replace(/\/$/, '');
      const isHome =
        (here === '' || here === '/index.html') && (target === '' || target === '/index.html');
      if (here === target || isHome) a.classList.add('active');
    });
    startClock();
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  window.ITM = {
    api, connectSocket, tokens, chartDefaults, fmt,
    demoBanner, navActive, esc, toggleTheme, onThemeChange,
  };
})();
