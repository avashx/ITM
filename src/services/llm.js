/**
 * Provider-agnostic LLM access for the assistant.
 *
 * Two capabilities, deliberately separated:
 *
 *  - `embed()`  - only OpenAI serves embeddings here, so the vector-retrieval
 *                 lane is available exactly when OPENAI_API_KEY is set.
 *  - `chat()`   - OpenAI (native fetch, no SDK dependency) or Anthropic (the
 *                 SDK already in package.json). Both stream token deltas
 *                 through the same callback so callers never branch.
 *
 * OpenAI is called over plain `fetch` on purpose: Node >= 18 has it built in,
 * so the whole feature adds zero runtime dependencies (CLAUDE.md rule 5).
 *
 * Nothing here knows about grievances or monitoring - it is a transport.
 */
const config = require('../config');
const log = require('../utils/logger')('llm');

const OPENAI_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

/** Reasoning-family models reject `temperature` and want `max_completion_tokens`. */
const isReasoningModel = (model) => /^(gpt-5|o[134])/i.test(String(model));

/**
 * Which provider will actually serve a chat request, honouring the
 * ASSISTANT_PROVIDER override. Returns null when no key is configured, which
 * is the signal for callers to fall back to the deterministic responder.
 */
function chatProvider() {
  const { provider, openaiKey, anthropicKey } = config.assistant;
  if (provider === 'rules') return null;
  if (provider === 'openai') return openaiKey ? 'openai' : null;
  if (provider === 'anthropic') return anthropicKey ? 'anthropic' : null;
  if (openaiKey) return 'openai';
  if (anthropicKey) return 'anthropic';
  return null;
}

/** Embeddings exist only with an OpenAI key - the vector lane depends on this. */
const embeddingsAvailable = () =>
  Boolean(config.assistant.openaiKey) && config.assistant.provider !== 'rules';

/** Model id that would serve the next chat call (for honest UI labelling). */
function chatModel() {
  const p = chatProvider();
  if (p === 'openai') return config.assistant.openaiModel;
  if (p === 'anthropic') return config.assistant.anthropicModel;
  return null;
}

/* -------------------------------------------------------------------------- */
/* HTTP helper                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * POST JSON to OpenAI with a timeout and bounded retries. Retries only on
 * 429/5xx and network faults - never on a 4xx we caused, which would just
 * burn quota repeating the same bad request.
 */
async function openaiFetch(path, body, { stream = false, retries = 2 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), config.assistant.requestTimeoutMs);
    try {
      const res = await fetch(`${OPENAI_BASE}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.assistant.openaiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        const err = new Error(`OpenAI ${path} -> HTTP ${res.status} ${detail.slice(0, 300)}`);
        err.status = res.status;
        if (res.status === 429 || res.status >= 500) throw err;
        clearTimeout(timer);
        throw Object.assign(err, { fatal: true });
      }
      if (stream) {
        // The caller consumes the body; it must clear the timeout itself once
        // the stream ends, so hand it over rather than clearing here.
        return { res, done: () => clearTimeout(timer) };
      }
      clearTimeout(timer);
      return res.json();
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (err.fatal || attempt === retries) break;
      const backoff = 400 * 2 ** attempt;
      log.warn(`${path} failed (${err.message.slice(0, 120)}) - retry in ${backoff}ms`);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}

/* -------------------------------------------------------------------------- */
/* Embeddings                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Embed a batch of strings. Returns an array of Float32Array in input order.
 * Vectors come back L2-normalised so downstream similarity is a plain dot
 * product (OpenAI normalises already; we re-normalise after truncation).
 */
async function embed(texts) {
  if (!embeddingsAvailable()) throw new Error('embeddings require OPENAI_API_KEY');
  const input = texts.map((t) => String(t || '').slice(0, 8000) || ' ');
  const body = {
    model: config.rag.embedModel,
    input,
    dimensions: config.rag.embedDims,
  };
  const data = await openaiFetch('/embeddings', body);
  return data.data
    .sort((a, b) => a.index - b.index)
    .map((d) => normalise(Float32Array.from(d.embedding)));
}

/** In-place L2 normalisation so cosine similarity reduces to a dot product. */
function normalise(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i += 1) sum += vec[i] * vec[i];
  const mag = Math.sqrt(sum) || 1;
  for (let i = 0; i < vec.length; i += 1) vec[i] /= mag;
  return vec;
}

/* -------------------------------------------------------------------------- */
/* Chat                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Stream a chat completion.
 *
 * @param {object}   opts
 * @param {string}   opts.system     system prompt
 * @param {Array}    opts.messages   [{ role: 'user'|'assistant', content }]
 * @param {Function} [opts.onDelta]  called with each text fragment as it lands
 * @returns {Promise<{ text, provider, model }>}
 */
async function chat({ system, messages, onDelta }) {
  const provider = chatProvider();
  if (!provider) throw new Error('no LLM provider configured');
  return provider === 'openai'
    ? openaiChat({ system, messages, onDelta })
    : anthropicChat({ system, messages, onDelta });
}

async function openaiChat({ system, messages, onDelta }) {
  const model = config.assistant.openaiModel;
  const body = {
    model,
    stream: true,
    messages: [{ role: 'system', content: system }, ...messages],
  };
  if (isReasoningModel(model)) {
    body.max_completion_tokens = config.assistant.maxTokens;
    body.reasoning_effort = config.assistant.reasoningEffort;
  } else {
    body.max_tokens = config.assistant.maxTokens;
    body.temperature = config.assistant.temperature;
  }

  const { res, done } = await openaiFetch('/chat/completions', body, { stream: true });
  let text = '';
  try {
    for await (const evt of sseEvents(res.body)) {
      if (evt === '[DONE]') break;
      let parsed;
      try {
        parsed = JSON.parse(evt);
      } catch {
        continue; // keep-alive or partial frame we already buffered past
      }
      const delta = parsed.choices && parsed.choices[0] && parsed.choices[0].delta;
      if (delta && delta.content) {
        text += delta.content;
        if (onDelta) onDelta(delta.content);
      }
    }
  } finally {
    done();
  }
  return { text: text.trim(), provider: 'openai', model };
}

async function anthropicChat({ system, messages, onDelta }) {
  const Anthropic = require('@anthropic-ai/sdk');
  const model = config.assistant.anthropicModel;
  const client = new Anthropic({ apiKey: config.assistant.anthropicKey });
  const stream = await client.messages.stream({
    model,
    max_tokens: config.assistant.maxTokens,
    temperature: config.assistant.temperature,
    system,
    messages,
  });
  let text = '';
  stream.on('text', (t) => {
    text += t;
    if (onDelta) onDelta(t);
  });
  await stream.finalMessage();
  return { text: text.trim(), provider: 'anthropic', model };
}

/**
 * Async-iterate `data:` payloads out of an SSE byte stream.
 *
 * Frames are split across chunk boundaries constantly, so the trailing partial
 * line is held back in `buffer` until the rest arrives - decoding each chunk
 * independently silently drops tokens.
 */
async function* sseEvents(stream) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith('data:')) yield line.slice(5).trim();
    }
  }
  const tail = buffer.trim();
  if (tail.startsWith('data:')) yield tail.slice(5).trim();
}

module.exports = {
  chat,
  embed,
  chatProvider,
  chatModel,
  embeddingsAvailable,
  normalise,
};
