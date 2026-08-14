/** Assistant API: grounded RAG chat over the platform's own data. */
const express = require('express');
const { asyncRoute } = require('../middleware/errorHandler');
const assistant = require('../services/assistant');
const retriever = require('../services/rag/retriever');
const indexer = require('../services/rag/indexer');
const store = require('../services/rag/store');
const requireAdmin = require('../middleware/adminAuth');

const router = express.Router();

const MAX_QUESTION = 500;
const MAX_HISTORY = 24;

/**
 * Validate and normalise an inbound conversation.
 * Accepts either `{ messages: [...] }` or a bare `{ question }` for the
 * original single-shot shape.
 */
function readConversation(body) {
  if (body && Array.isArray(body.messages) && body.messages.length) {
    const messages = body.messages
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
      .slice(-MAX_HISTORY)
      .map((m) => ({ role: m.role, content: String(m.content || '').slice(0, 4000) }))
      .filter((m) => m.content.trim());
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'user') return { error: 'the last message must be from the user' };
    if (last.content.length > MAX_QUESTION) {
      return { error: `question must be ${MAX_QUESTION} characters or fewer` };
    }
    return { messages };
  }
  const question = (body && body.question ? String(body.question) : '').trim();
  if (!question) return { error: 'question or messages is required' };
  if (question.length > MAX_QUESTION) {
    return { error: `question must be ${MAX_QUESTION} characters or fewer` };
  }
  return { messages: [{ role: 'user', content: question }] };
}

/** GET /api/assistant/meta - panel bootstrap: mode, model, index health, prompts. */
router.get(
  '/meta',
  asyncRoute(async (req, res) => res.json(await assistant.meta()))
);

/**
 * POST /api/assistant/ask  { question } | { messages:[{role,content}] }
 * -> { answer, mode, provider, model, sources, metrics, grounding }
 * Non-streaming; the whole answer arrives at once.
 */
router.post(
  '/ask',
  asyncRoute(async (req, res) => {
    const parsed = readConversation(req.body);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    res.json(await assistant.chat({ messages: parsed.messages }));
  })
);

/**
 * POST /api/assistant/chat - the same answer, streamed as Server-Sent Events.
 *
 * Events: `token` (text fragment), `done` (full result incl. sources and
 * metrics), `error`. SSE rather than websockets because this is a plain
 * request/response with no client-to-server traffic mid-answer.
 */
router.post('/chat', async (req, res) => {
  const parsed = readConversation(req.body);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Compression buffers the stream and defeats the point of streaming.
    'X-Accel-Buffering': 'no',
  });
  // Disconnect must be detected on the RESPONSE. `req.on('close')` fires as
  // soon as the request body has been consumed - within a millisecond here -
  // so using it would suppress every token and the final res.end(), and the
  // client would hang until it timed out.
  let gone = false;
  res.on('close', () => {
    gone = true;
  });
  const alive = () => !gone && !res.writableEnded && !res.destroyed;

  const send = (event, data) => {
    if (!alive()) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };

  try {
    const result = await assistant.chat({
      messages: parsed.messages,
      onDelta: (text) => send('token', { text }),
    });
    send('done', result);
  } catch (err) {
    send('error', { error: err.message });
  } finally {
    if (alive()) res.end();
  }
});

/** GET /api/assistant/context - the live snapshot answers are grounded in. */
router.get(
  '/context',
  asyncRoute(async (req, res) => res.json(await retriever.liveSnapshot()))
);

/**
 * GET /api/assistant/retrieve?q=... - retrieval only, no generation.
 * Shows exactly which passages and aggregates a question would be answered
 * from. Useful for demos and for debugging a bad answer.
 */
router.get(
  '/retrieve',
  asyncRoute(async (req, res) => {
    const q = String(req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q is required' });
    const r = await retriever.retrieve(q.slice(0, MAX_QUESTION));
    res.json({
      query: q,
      extraction: r.extraction,
      structured: r.structured,
      corpusSize: r.corpusSize,
      timings: r.timings,
      passages: r.passages.map((p) => ({
        chunkId: p.chunkId,
        kind: p.kind,
        title: p.title,
        citation: p.citation,
        dataSource: p.dataSource,
        score: p.score,
        preview: p.text.slice(0, 400),
      })),
    });
  })
);

/** GET /api/assistant/index - vector index health. */
router.get(
  '/index',
  asyncRoute(async (req, res) => res.json(await store.stats()))
);

/**
 * POST /api/assistant/index/rebuild - re-embed the corpus. Admin-guarded
 * because it spends money on the embeddings API.
 */
router.post(
  '/index/rebuild',
  requireAdmin,
  asyncRoute(async (req, res) => {
    const force = String(req.query.force || '') === 'true';
    res.json(await indexer.buildIndex({ force }));
  })
);

module.exports = router;
