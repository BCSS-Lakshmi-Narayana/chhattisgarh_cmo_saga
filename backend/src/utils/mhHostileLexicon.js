/**
 * mhHostileLexicon — deterministic floor under the LLM's stance call.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * This reply to @mieknathshinde was scored `unrelated`:
 *
 *   "अरे गद्दारा , लंडनला जाऊन सांगीतला कां की मालकाचा पक्ष पळवलाय ?
 *    रिक्षावाला स्वतःला हुशार समजतोय ?"
 *   ("Hey traitor, did you go to London and say you stole your master's
 *    party? The rickshaw driver thinks he's clever?")
 *
 * Every earlier stage was right: entity resolution found Eknath Shinde,
 * `mode=about_target`, `target_relevance=1.0`, `primary_alignment=ally`.
 * The LLM then returned `target_tone=neutral` and the post fell out of the
 * brief entirely — a hostile item counted as noise.
 *
 * `mh_criticism_keywords.json` already holds the vocabulary that would have
 * caught it (गद्दार, 50 खोके, मिंधे …), tiered and weighted, but nothing in
 * the stance pipeline ever consulted it — it was wired only as search terms.
 *
 * ── WHAT IT WILL AND WILL NOT OVERRIDE ───────────────────────────────
 * Deliberately narrow. It only fires when ALL of these hold:
 *
 *   · the LLM returned no usable verdict — `unrelated` or `neutral`
 *   · a primary target was resolved, with real relevance
 *   · that target is an ALLY, i.e. our own side
 *   · the text carries a TIER-1 term from the lexicon
 *
 * It never overturns a confident `pro_*` or `anti_*`: the LLM reading the
 * language beats a word list, and the point here is to catch the cases it
 * declined to judge, not to second-guess it.
 *
 * The alignment condition matters. This vocabulary is anti-Mahayuti — it is
 * aimed at the ruling side. The identical word in a post about an
 * OPPOSITION figure is usually that figure attacking an ally, not criticism
 * of them, so firing there would invert the sign. When the target is not an
 * ally, this stays out of the way.
 */
const LEX = require('../data/mh_criticism_keywords.json');

/** Tier 1 only: the durable, unambiguous attack vocabulary. */
const TIER1 = (LEX.keywords || [])
    .filter((k) => k.tier === 1 && k.term)
    .map((k) => ({ term: String(k.term).toLowerCase(), weight: k.weight || 0, about: k.about || '' }))
    .sort((a, b) => b.term.length - a.term.length);

/** @returns {{term,weight,about}|null} the first tier-1 term present. */
const hostileTermIn = (text) => {
    const lower = String(text || '').toLowerCase();
    if (!lower) return null;
    return TIER1.find((k) => lower.includes(k.term)) || null;
};

/**
 * Should the undecided stance be forced to anti?
 *
 * @param {object} args
 * @param {string} args.text      the post, original script
 * @param {string} args.stance    what the LLM returned
 * @param {object} args.context   buildPoliticalContext output
 * @returns {{stance,reason,term}|null} null when nothing should change
 */
const hostileOverride = ({ text, stance, context }) => {
    const s = String(stance || '').toLowerCase();
    // Only step in where the LLM declined to take a position.
    if (s && s !== 'unrelated' && s !== 'neutral') return null;

    if (!context) return null;
    if (context.primary_target_alignment !== 'ally') return null;
    if (!context.primary_target) return null;
    // A passing name-drop is not a target. 0.5 is the same bar
    // decideMode uses before it will call a post `about_target`.
    if ((context.target_relevance || 0) < 0.5) return null;

    const hit = hostileTermIn(text);
    if (!hit) return null;

    return {
        stance: 'anti_target',
        term: hit.term,
        reason: `tier-1 criticism term "${hit.term}" against ally `
            + `${context.primary_target_canonical || context.primary_target} `
            + `(${hit.about})`,
    };
};

module.exports = { hostileOverride, hostileTermIn, TIER1 };
