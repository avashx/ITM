/* Assistant panel: injects the glass drawer on every page and talks to
 * /api/assistant. Answers are grounded in a live snapshot of the platform's
 * own data; the source (Claude vs the built-in rule-based responder) is
 * labelled on every reply so nobody mistakes one for the other. */
(function () {
  'use strict';
  const { api, esc } = window.ITM;

  const ICON_SPARK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3.2"/></svg>';
  const ICON_SEND =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';
  const ICON_X =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  let meta = { mode: 'rules', suggested: [] };
  let busy = false;

  function mount() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <button class="ai-fab" id="ai-fab">${ICON_SPARK}<span>Ask the data</span></button>
      <aside class="ai-panel" id="ai-panel" aria-label="Operations assistant">
        <div class="ai-head">
          <span class="mk">${ICON_SPARK}</span>
          <div class="ht">Operations Assistant<small id="ai-mode">grounded in live platform data</small></div>
          <button class="x" id="ai-close" title="Close">${ICON_X}</button>
        </div>
        <div class="ai-body" id="ai-body"></div>
        <div class="ai-sugg" id="ai-sugg"></div>
        <div class="ai-foot">
          <form class="ai-form" id="ai-form">
            <input id="ai-input" type="text" maxlength="500" placeholder="Ask about outages, SLAs, certificates…" autocomplete="off" />
            <button type="submit" id="ai-send" title="Send">${ICON_SEND}</button>
          </form>
          <div class="ai-note" id="ai-note"></div>
        </div>
      </aside>`;
    document.body.appendChild(wrap);

    document.getElementById('ai-fab').addEventListener('click', open);
    document.getElementById('ai-close').addEventListener('click', close);
    document.getElementById('ai-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const el = document.getElementById('ai-input');
      const q = el.value.trim();
      if (!q || busy) return;
      el.value = '';
      send(q);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  }

  function open() {
    document.body.classList.add('ai-open');
    document.getElementById('ai-input').focus();
  }
  function close() {
    document.body.classList.remove('ai-open');
  }

  function bubble(who, text, source) {
    const body = document.getElementById('ai-body');
    const el = document.createElement('div');
    el.className = `ai-msg ${who}`;
    const src =
      source
        ? `<div class="src ${source.mode}"><span class="d"></span>${
            source.mode === 'claude'
              ? `Claude · ${esc(source.model || '')} · grounded in live data`
              : 'Rule-based · live data'
          }</div>`
        : '';
    el.innerHTML = `<span class="av">${who === 'bot' ? 'AI' : 'IT'}</span>
      <div class="bub">${esc(text)}${src}</div>`;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }

  function typing() {
    const body = document.getElementById('ai-body');
    const el = document.createElement('div');
    el.className = 'ai-msg bot';
    el.innerHTML = `<span class="av">AI</span><div class="bub"><div class="ai-typing"><i></i><i></i><i></i></div></div>`;
    body.appendChild(el);
    body.scrollTop = body.scrollHeight;
    return el;
  }

  async function send(question) {
    busy = true;
    document.getElementById('ai-send').disabled = true;
    bubble('me', question);
    const t = typing();
    try {
      const res = await fetch('/api/assistant/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const d = await res.json();
      t.remove();
      if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`);
      bubble('bot', d.note ? `${d.answer}\n\n(${d.note})` : d.answer, {
        mode: d.mode,
        model: d.model,
      });
    } catch (err) {
      t.remove();
      bubble('bot', `Sorry — I couldn't answer that: ${err.message}`);
    } finally {
      busy = false;
      document.getElementById('ai-send').disabled = false;
    }
  }

  async function boot() {
    mount();
    try {
      meta = await api('/api/assistant/meta');
    } catch {
      /* panel still usable; the ask call will report any error */
    }
    document.getElementById('ai-mode').textContent =
      meta.mode === 'claude'
        ? `Claude ${meta.model} · answers grounded in live data`
        : 'Rule-based · answers from live data';
    document.getElementById('ai-note').textContent =
      meta.mode === 'claude'
        ? 'Answers are generated from this platform’s live data. Verify before acting.'
        : 'Deterministic answers from live data. Set ANTHROPIC_API_KEY for free-form AI.';

    const sugg = document.getElementById('ai-sugg');
    sugg.innerHTML = (meta.suggested || [])
      .map((s) => `<button type="button">${esc(s)}</button>`)
      .join('');
    sugg.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        if (!busy) send(b.textContent);
      });
    });

    bubble(
      'bot',
      'Ask me about the platform’s live data — what’s down, certificate expiry, SLA breaches by department, correlation patterns, or a status summary.'
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
