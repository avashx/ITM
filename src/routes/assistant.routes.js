/** Assistant API: grounded Q&A over the platform's own live data. */
const express = require('express');
const { asyncRoute } = require('../middleware/errorHandler');
const assistant = require('../services/assistant');
const config = require('../config');

const router = express.Router();

/** GET /api/assistant/meta - panel bootstrap: mode + suggested prompts. */
router.get('/meta', (req, res) => {
  res.json({
    mode: config.assistant.apiKey ? 'claude' : 'rules',
    model: config.assistant.apiKey ? config.assistant.model : null,
    suggested: assistant.SUGGESTED,
  });
});

/**
 * POST /api/assistant/ask  { question }
 * -> { answer, mode: 'claude'|'rules', model?, note?, contextAt }
 */
router.post(
  '/ask',
  asyncRoute(async (req, res) => {
    const question = (req.body && req.body.question ? String(req.body.question) : '').trim();
    if (!question) return res.status(400).json({ error: 'question is required' });
    if (question.length > 500) {
      return res.status(400).json({ error: 'question must be 500 characters or fewer' });
    }
    res.json(await assistant.ask(question));
  })
);

/** GET /api/assistant/context - the exact snapshot answers are grounded in. */
router.get(
  '/context',
  asyncRoute(async (req, res) => res.json(await assistant.buildContext()))
);

module.exports = router;
