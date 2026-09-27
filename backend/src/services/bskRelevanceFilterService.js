/**
 * bskRelevanceFilterService
 *
 * Fast single-pass relevance gate that decides whether a tweet is about the
 * client leadership — CM Vishnu Deo Sai, BJP Chhattisgarh president Kiran Singh
 * Deo, and the BJP government of Chhattisgarh around them. Heuristic first; ambiguous text falls
 * through to the configured LLM provider.
 *
 * NOTE: the output key `is_bsk` and the `target` enum values
 * ('bsk' | 'bsk_son' | 'bjp_telangana' | 'unrelated') are LEGACY identifiers
 * kept unchanged for backward compatibility with the Grievance model and
 * downstream services. Their meaning in this deployment:
 *   bsk           → primary client leader (the Chief Minister)
 *   bsk_son       → secondary client leader (the BJP state president)
 *   bjp_telangana → the ruling party / government machinery
 *
 * Input  : raw tweet text (string)
 * Output : {
 *            is_bsk:           boolean,
 *            confidence:       number 0..1,
 *            stance:           'positive' | 'negative' | 'neutral' | 'unknown',
 *            topic:            short string  (e.g. "paddy procurement", "welfare scheme"),
 *            reason:           one-line natural-language explanation,
 *            target:           'bsk' | 'bsk_son' | 'bjp_telangana' | 'unrelated',
 *          }
 *
 * Heuristic fast-path: any tweet text containing an unambiguous leader token
 * (full name, official handle) returns true without hitting the LLM.
 *
 * If the LLM is unreachable or returns garbage we fall back to the heuristic —
 * so the pipeline keeps producing data even if the LLM is down.
 */
const { chatJson } = require('./llmProvider');
const { POLITICAL_ENTITIES, PRIMARY_TARGET_KEY, SECONDARY_TARGET_KEY } = require('../config/politicalEntities');
const { STATE_NAME, CLIENT_DESCRIPTION, OUR_CAMP_SUMMARY, OPPOSITION_SUMMARY, LANGUAGES_DESCRIPTION } = require('../config/deployment');

const LLM_TIMEOUT = parseInt(process.env.BSK_FILTER_TIMEOUT_MS || '45000', 10);

const PRIMARY_NAME = POLITICAL_ENTITIES[PRIMARY_TARGET_KEY]?.canonical || 'the Chief Minister';
const SECONDARY_NAME = POLITICAL_ENTITIES[SECONDARY_TARGET_KEY]?.canonical || 'the party state president';

// ─── Heuristic tokens — case-insensitive substring match ───────────
// Full names and handles only. A bare surname ("sai", "deo", "singh") is shared
// by millions and would pull unrelated posts into the Mentions feed,
// which also filters on this list.
const PRIMARY_TOKENS = [
  'vishnu deo sai', 'vishnudeo sai', 'vishnu dev sai', 'cm sai', 'chhattisgarh cm', 'cg cm',
  'chief minister sai', '@vishnudsai', '@chhattisgarhcmo', '#vishnudeosai', '#cmsai',
  'विष्णु देव साय', 'विष्णुदेव साय', 'मुख्यमंत्री साय', 'सीएम साय',
];

const SECONDARY_TOKENS = [
  'kiran singh deo', 'kiran deo', 'kiran singhdeo', '@kirandeobjp', 'किरण सिंहदेव', 'किरण देव',
];

const HARD_BSK_TOKENS = [
  ...PRIMARY_TOKENS,
  ...SECONDARY_TOKENS,
  'bjp chhattisgarh', 'chhattisgarh bjp', 'cg bjp', '@bjp4cgstate', '#bjpchhattisgarh',
];

const SOFT_BSK_TOKENS = [
  // Ruling-party / government context that often appears with the leadership
  'bjp', 'भाजपा', 'बीजेपी', 'chhattisgarh government', 'chhattisgarh govt', 'cg government', 'cg govt',
  'sai sarkar', 'sai government', 'साय सरकार', 'vishnu ka sushasan', 'विष्णु का सुशासन', 'viksit chhattisgarh',
];

function heuristicMatch(text) {
  const lower = String(text || '').toLowerCase();
  for (const t of HARD_BSK_TOKENS) {
    if (lower.includes(t)) return { matched: true, strength: 'hard', token: t };
  }
  for (const t of SOFT_BSK_TOKENS) {
    if (lower.includes(t)) return { matched: true, strength: 'soft', token: t };
  }
  return { matched: false };
}

/* ─── LLM call (RapidAPI ChatGPT-42) ──────────────────────────── */
async function askLLM(tweetText) {
  const prompt = `You are filtering tweets for a political media-monitoring system serving ${CLIENT_DESCRIPTION}.
The primary subject is ${PRIMARY_NAME}, Chief Minister of ${STATE_NAME}. The secondary subject is
${SECONDARY_NAME}, state president of the ruling party. Governing camp: ${OUR_CAMP_SUMMARY}.
Opposition: ${OPPOSITION_SUMMARY}.

TWEET (verbatim, may be ${LANGUAGES_DESCRIPTION}):
"""
${String(tweetText || '').slice(0, 800)}
"""

Decide whether this tweet is meaningfully about ${PRIMARY_NAME}, ${SECONDARY_NAME}, or the immediate
ruling-party / ${STATE_NAME} government machinery around them. A tweet that merely mentions
${STATE_NAME} politics generically is NOT relevant. A tweet that targets, defends, mocks, praises,
or reports on this leadership or government IS relevant.

The JSON keys below are fixed identifiers — map: "bsk" = ${PRIMARY_NAME}, "bsk_son" = ${SECONDARY_NAME},
"bjp_telangana" = the ruling party / ${STATE_NAME} government machinery.

Reply with EXACTLY one JSON object on a single line, no prose, no markdown:
{"is_bsk": true|false, "confidence": 0.0-1.0, "stance": "positive"|"negative"|"neutral"|"unknown", "target": "bsk"|"bsk_son"|"bjp_telangana"|"unrelated", "topic": "short label", "reason": "one short sentence"}`;

  try {
    return await chatJson({
      prompt,
      temperature: 0.1,
      maxTokens: 400,
      timeoutMs: LLM_TIMEOUT,
    });
  } catch (err) {
    return { __error: err.message || 'rapidapi call failed' };
  }
}

/* ─── public API ─────────────────────────────────────────────── */
async function checkRelevance(tweetText, { allowLLM = true } = {}) {
  const text = String(tweetText || '').trim();
  if (!text) {
    return { is_bsk: false, confidence: 0, stance: 'unknown', target: 'unrelated', topic: '', reason: 'empty text' };
  }

  // 1. Heuristic fast-path
  const heur = heuristicMatch(text);
  if (heur.matched && heur.strength === 'hard') {
    return {
      is_bsk: true,
      confidence: 0.95,
      stance: 'unknown',
      target: PRIMARY_TOKENS.includes(heur.token) ? 'bsk'
        : SECONDARY_TOKENS.includes(heur.token) ? 'bsk_son'
        : 'bjp_telangana',
      topic: 'name match',
      reason: `Matched token "${heur.token}"`,
      heuristic: true,
    };
  }

  // 2. LLM gate (skip on demand for speed-only runs)
  if (!allowLLM) {
    return heur.matched
      ? { is_bsk: true, confidence: 0.55, stance: 'unknown', target: 'bjp_telangana', topic: 'soft match', reason: `Soft token "${heur.token}"`, heuristic: true }
      : { is_bsk: false, confidence: 0.05, stance: 'unknown', target: 'unrelated', topic: '', reason: 'no token, llm skipped', heuristic: true };
  }

  const llm = await askLLM(text);
  if (!llm || llm.__error) {
    // Fall back to heuristic if RapidAPI broken
    return heur.matched
      ? { is_bsk: true, confidence: 0.5, stance: 'unknown', target: 'bjp_telangana', topic: 'soft match (llm down)', reason: `RapidAPI unreachable; soft heuristic on "${heur.token}"`, heuristic: true, llm_error: llm?.__error }
      : { is_bsk: false, confidence: 0.1, stance: 'unknown', target: 'unrelated', topic: '', reason: 'no match + llm unreachable', heuristic: true, llm_error: llm?.__error };
  }

  // Sanitise LLM output
  return {
    is_bsk:     !!llm.is_bsk,
    confidence: Math.max(0, Math.min(1, Number(llm.confidence) || 0)),
    stance:     ['positive', 'negative', 'neutral', 'unknown'].includes(llm.stance) ? llm.stance : 'unknown',
    target:     ['bsk', 'bsk_son', 'bjp_telangana', 'unrelated'].includes(llm.target) ? llm.target : 'unrelated',
    topic:      String(llm.topic || '').slice(0, 80),
    reason:     String(llm.reason || '').slice(0, 200),
    heuristic:  false,
  };
}

module.exports = {
  checkRelevance,
  heuristicMatch,
  HARD_BSK_TOKENS,
  SOFT_BSK_TOKENS,
};
