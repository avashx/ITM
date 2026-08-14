/* Assistant panel: a multi-turn chat drawer injected on every page.
 *
 * Answers stream token-by-token over Server-Sent Events from
 * POST /api/assistant/chat. Every reply carries its provenance - which model
 * answered, which retrieved passages it was given, what database filters the
 * exact aggregate used, and how long retrieval and generation each took - so
 * an officer can always see what an answer was grounded in rather than
 * trusting it blind. Rule-based fallback replies are labelled as such and
 * never presented as AI. */
(function () {
  'use strict';
  const { esc } = window.ITM;

  const ICON_SPARK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M3 12h3M18 12h3M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/><circle cx="12" cy="12" r="3.2"/></svg>';
  const ICON_SEND =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>';
  const ICON_X =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  const ICON_NEW =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';

  /** Full conversation, replayed to the server so follow-ups keep context. */
  let convo = [];
  let meta = { mode: 'rules', suggested: [] };
  let busy = false;

  const $ = (id) => document.getElementById(id);

  function mount() {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <button class="ai-fab" id="ai-fab">${ICON_SPARK}<span>Ask the data</span></button>
      <aside class="ai-panel" id="ai-panel" aria-label="Operations assistant">
        <div class="ai-head">
          <span class="mk">${ICON_SPARK}</span>
          <div class="ht">Operations Assistant<small id="ai-mode">grounded in live platform data</small></div>
          <button class="x" id="ai-new" title="New conversation">${ICON_NEW}</button>
          <button class="x" id="ai-close" title="Close">${ICON_X}</button>
        </div>
        <div class="ai-body" id="ai-body" aria-live="polite"></div>
        <div class="ai-sugg" id="ai-sugg"></div>
        <div class="ai-foot">
          <form class="ai-form" id="ai-form">
            <input id="ai-input" type="text" maxlength="500" placeholder="Ask about outages, SLAs, complaints…" autocomplete="off" />
            <button type="submit" id="ai-send" title="Send">${ICON_SEND}</button>
          </form>
          <div class="ai-note" id="ai-note"></div>
        </div>
      </aside>`;
    document.body.appendChild(wrap);

    $('ai-fab').addEventListener('click', open);
    $('ai-close').addEventListener('click', close);
    $('ai-new').addEventListener('click', reset);
    $('ai-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const el = $('ai-input');
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
    $('ai-input').focus();
  }
  function close() {
    document.body.classList.remove('ai-open');
  }
  function reset() {
    convo = [];
    $('ai-body').innerHTML = '';
    greet();
    $('ai-input').focus();
  }

  /* ---- rendering ------------------------------------------------------- */

  function scroll() {
    const b = $('ai-body');
    b.scrollTop = b.scrollHeight;
  }

  function bubble(who, text) {
    const el = document.createElement('div');
    el.className = `ai-msg ${who}`;
    el.innerHTML = `<span class="av">${who === 'bot' ? 'AI' : 'IT'}</span>
      <div class="bub"><span class="txt">${esc(text || '')}</span></div>`;
    $('ai-body').appendChild(el);
    scroll();
    return el;
  }

  function typing() {
    const el = document.createElement('div');
    el.className = 'ai-msg bot';
    el.innerHTML = `<span class="av">AI</span><div class="bub"><div class="ai-typing"><i></i><i></i><i></i></div></div>`;
    $('ai-body').appendChild(el);
    scroll();
    return el;
  }

  /** Human-readable label for where an answer came from. */
  function sourceLabel(d) {
    if (d.mode !== 'rag') return 'Rule-based · live data';
    const who = d.provider === 'openai' ? 'OpenAI' : d.provider === 'anthropic' ? 'Claude' : 'AI';
    return `${who} · ${d.model || ''} · retrieval-grounded`;
  }

  /**
   * Provenance block appended under a finished answer: the model, the timing
   * split, the database filters the exact aggregate applied, and the retrieved
   * passages behind the numbered citations in the text.
   */
  function provenance(d) {
    const m = d.metrics || {};
    const bits = [];
    if (m.totalMs) bits.push(`${(m.totalMs / 1000).toFixed(1)}s`);
    if (m.retrievalMs) bits.push(`retrieval ${m.retrievalMs}ms`);
    if (m.chunksSearched) bits.push(`${m.chunksSearched.toLocaleString()} chunks searched`);
    if (m.recordsAggregated != null) {
      bits.push(`${m.recordsAggregated.toLocaleString()} records aggregated`);
    }

    const filters =
      d.grounding && d.grounding.matched && d.grounding.matched.length
        ? `<div class="ai-filters">${d.grounding.matched
            .map((f) => `<span>${esc(f)}</span>`)
            .join('')}</div>`
        : '';

    const sources =
      d.sources && d.sources.length
        ? `<details class="ai-sources">
             <summary>${d.sources.length} retrieved source${d.sources.length > 1 ? 's' : ''}</summary>
             <ol>${d.sources
               .map(
                 (s) =>
                   `<li><b>${esc(s.kind)}</b> ${esc(s.citation)}<em>${
                     s.dataSource === 'synthetic' ? 'synthetic' : 'real'
                   } · ${s.score}</em></li>`
               )
               .join('')}</ol>
           </details>`
        : '';

    return `<div class="src ${d.mode === 'rag' ? 'ai' : 'rules'}"><span class="d"></span>${esc(
      sourceLabel(d)
    )}</div>
      ${bits.length ? `<div class="ai-metrics">${esc(bits.join(' · '))}</div>` : ''}
      ${filters}${sources}`;
  }

  /* ---- transport ------------------------------------------------------- */

  /**
   * Stream one answer. Falls back to the non-streaming /ask endpoint if the
   * browser or an intermediary cannot handle the event stream, so the panel
   * still works behind a buffering proxy.
   */
  async function send(question) {
    busy = true;
    $('ai-send').disabled = true;
    bubble('me', question);
    convo.push({ role: 'user', content: question });

    const pending = typing();
    let el = null;
    let txt = null;
    let answer = '';

    const startStreaming = () => {
      if (el) return;
      pending.remove();
      el = bubble('bot', '');
      txt = el.querySelector('.txt');
    };

    try {
      const res = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: convo }),
      });
      if (!res.ok || !res.body) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${res.status}`);
      }

      let done = null;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let event = 'message';

      // SSE frames split across network chunks constantly; hold the trailing
      // partial line back until the rest of it arrives.
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, nl).trimEnd();
          buffer = buffer.slice(nl + 1);
          if (line.startsWith('event:')) {
            event = line.slice(6).trim();
          } else if (line.startsWith('data:')) {
            let payload;
            try {
              payload = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            if (event === 'token') {
              startStreaming();
              answer += payload.text;
              txt.textContent = answer;
              scroll();
            } else if (event === 'done') {
              done = payload;
            } else if (event === 'error') {
              throw new Error(payload.error || 'stream failed');
            }
          }
        }
      }

      if (!done) throw new Error('the answer ended before it completed');
      startStreaming();
      // The rule-based lane produces no tokens, so take the text from `done`.
      txt.textContent = done.answer + (done.note ? `\n\n(${done.note})` : '');
      el.querySelector('.bub').insertAdjacentHTML('beforeend', provenance(done));
      convo.push({ role: 'assistant', content: done.answer });
      scroll();
    } catch (err) {
      pending.remove();
      if (el) el.remove();
      bubble('bot', `Sorry — I couldn't answer that: ${err.message}`);
      // Drop the unanswered turn so the next question isn't sent with a
      // dangling user message the model never replied to.
      convo.pop();
    } finally {
      busy = false;
      $('ai-send').disabled = false;
    }
  }

  /* ---- boot ------------------------------------------------------------ */

  function greet() {
    const el = bubble(
      'bot',
      'Ask me about the platform’s data — what’s down, certificate expiry, complaint volumes by department or district, SLA rules, correlation patterns, or a status summary. Follow-up questions keep their context.'
    );
    return el;
  }

  async function boot() {
    mount();
    try {
      const res = await fetch('/api/assistant/meta');
      if (res.ok) meta = await res.json();
    } catch {
      /* panel still usable; the first question will surface any real error */
    }

    const r = meta.retrieval || {};
    const idx = r.index || {};
    $('ai-mode').textContent =
      meta.mode === 'rag'
        ? `${meta.provider === 'openai' ? 'OpenAI' : 'Claude'} ${meta.model || ''} · ${
            r.vectorLane ? `RAG over ${(idx.chunks || 0).toLocaleString()} chunks` : 'grounded in live data'
          }`
        : 'Rule-based · answers from live data';
    $('ai-note').textContent =
      meta.mode === 'rag'
        ? r.vectorLane
          ? 'Answers are retrieved from this platform’s own data. Grievance figures are synthetic. Verify before acting.'
          : 'No vector index yet — run `npm run rag:index` to enable semantic search. Verify before acting.'
        : 'Deterministic answers from live data. Set OPENAI_API_KEY for AI answers over the same data.';

    const sugg = $('ai-sugg');
    sugg.innerHTML = (meta.suggested || [])
      .map((s) => `<button type="button">${esc(s)}</button>`)
      .join('');
    sugg.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        if (!busy) send(b.textContent);
      });
    });

    greet();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
