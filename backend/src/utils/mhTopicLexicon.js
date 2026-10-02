/**
 * mhTopicLexicon — assign an issue topic where the LLM declined to.
 *
 * ── WHY ──────────────────────────────────────────────────────────────
 * 561 of 1442 Maharashtra posts (39%) carried `analysis.topic = null`,
 * because the model returned `campaign_topic: "None"` and that is stored
 * as null. A post with no topic is invisible to the Issue Tracker and to
 * section 2 of every report — so more than a third of the collected
 * volume contributed nothing to issue analysis, while plainly saying
 * "कर्जमाफी" or "वीज बिल" in the text.
 *
 * ── THE RULE IT FOLLOWS ──────────────────────────────────────────────
 * It only fills a NULL. An LLM-assigned topic is never overwritten: the
 * model reading a whole sentence beats a word list, and the job here is
 * to cover what it declined, not to argue with it.
 *
 * Longest term first, so "शेतकरी आत्महत्या" is never split by "शेतकरी"
 * into the wrong bucket — both are Agriculture here, but the same shape
 * matters where they differ ("मराठा आरक्षण" vs "आरक्षण").
 *
 * ── WHY SOME OBVIOUS WORDS ARE MISSING ───────────────────────────────
 * Devanagari matching has no word boundaries, so a short term matches
 * inside unrelated words. Anything ambiguous between two topics is left
 * out rather than guessed: a wrong topic is worse than no topic, because
 * it shows up as a confident bar in the Issue Tracker.
 */
const LEX = require('../data/mh_topic_lexicon.json');

/** Flattened, longest first, so a compound always beats its parts. */
const TERMS = [];
for (const [topic, list] of Object.entries(LEX.topics || {})) {
    for (const term of list) {
        const t = String(term || '').trim().toLowerCase();
        if (t.length >= 3) TERMS.push({ term: t, topic });
    }
}
TERMS.sort((a, b) => b.term.length - a.term.length);

/** Every topic this lexicon can produce — used by the tests. */
const TOPICS = [...new Set(TERMS.map((t) => t.topic))];

/**
 * @param {string} text
 * @returns {{topic,term}|null} the first (longest) term found, or null.
 */
const topicFor = (text) => {
    const lower = String(text || '').toLowerCase();
    if (!lower) return null;
    const hit = TERMS.find((t) => lower.includes(t.term));
    return hit ? { topic: hit.topic, term: hit.term } : null;
};

module.exports = { topicFor, TERMS, TOPICS };
