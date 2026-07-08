/**
 * Keyword-based NLP classifier: assigns a department + category to a
 * grievance from its free-text description.
 *
 * Approach (deliberately simple, transparent and auditable - important for a
 * government workflow): each category carries a curated keyword list in
 * data/reference/departments.json. The description is normalised and scanned;
 * multi-word phrase hits score 3, single-word hits score 1 (word-boundary
 * matched to avoid "rat" matching "administration"). The best-scoring
 * category wins; confidence = winner share of total score.
 */
const fs = require('fs');
const path = require('path');

const taxonomy = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../../../data/reference/departments.json'), 'utf8')
);

// Pre-compile matchers once at load time.
const MATCHERS = [];
for (const dept of taxonomy.departments) {
  for (const cat of dept.categories) {
    for (const kw of cat.keywords) {
      const isPhrase = kw.includes(' ');
      MATCHERS.push({
        department: dept.name,
        category: cat.name,
        keyword: kw,
        weight: isPhrase ? 3 : 1,
        re: new RegExp(`\\b${escapeRe(kw)}\\b`, 'i'),
      });
    }
  }
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const FALLBACK = {
  department: 'Public Grievances Commission',
  category: 'General / Unclassified',
};

/**
 * Classify a description.
 * @returns {{department:string, category:string, confidence:number,
 *            matchedKeywords:string[]}}
 */
function classify(description) {
  const text = String(description || '').toLowerCase();
  if (!text.trim()) {
    return { ...FALLBACK, confidence: 0, matchedKeywords: [] };
  }

  const scores = new Map(); // "dept||cat" -> {score, keywords}
  let totalScore = 0;
  for (const m of MATCHERS) {
    if (m.re.test(text)) {
      const key = `${m.department}||${m.category}`;
      const entry = scores.get(key) || { score: 0, keywords: [] };
      entry.score += m.weight;
      entry.keywords.push(m.keyword);
      scores.set(key, entry);
      totalScore += m.weight;
    }
  }

  if (!scores.size) {
    return { ...FALLBACK, confidence: 0, matchedKeywords: [] };
  }

  let bestKey = null;
  let best = null;
  for (const [key, entry] of scores) {
    if (!best || entry.score > best.score) {
      best = entry;
      bestKey = key;
    }
  }
  const [department, category] = bestKey.split('||');
  return {
    department,
    category,
    confidence: Math.round((best.score / totalScore) * 100) / 100,
    matchedKeywords: [...new Set(best.keywords)].slice(0, 8),
  };
}

/** All departments (for filters/UI). */
function departments() {
  return taxonomy.departments.map((d) => ({
    name: d.name,
    code: d.code,
    categories: d.categories.map((c) => c.name),
  }));
}

module.exports = { classify, departments, FALLBACK };
