/**
 * mhLeaderTarget — leader-relative sentiment for a Maharashtra post.
 *
 * ── WHY THIS IS A SEPARATE LAYER ─────────────────────────────────────
 * Every stored stance is relative to the GOVERNMENT (the BJP-led Mahayuti):
 * pro / anti / neutral. That stays exactly as it is. A report on ONE leader
 * needs a different question — "is the public warm or hostile toward THIS
 * person?" — and the answer depends on which camp he is in:
 *
 *     ally leader        positive = pro-government       negative = anti-government
 *     opposition leader  positive = anti-government     negative = pro-government
 *
 * "Sharad Pawar strongly criticised" is NEGATIVE for Pawar and PRO-government
 * in the same breath. Reading the stored stance straight onto an opposition
 * leader would report the opposite of what happened.
 *
 * ── ONLY WHEN HE IS THE TARGET ───────────────────────────────────────
 * The flip applies only if the selected leader is who the tone was aimed AT.
 * "Sharad Pawar says Fadnavis failed" names Pawar but targets Fadnavis; it
 * says nothing about the public's view of Pawar. Matching on a mention (what
 * the report did before) would count it against him.
 *
 * So a post is classified once, at analysis time, into one of:
 *   targeted  the target resolves, with confidence, to one of the nine
 *   unclear   a leader may be named but the target is missing, ambiguous, a
 *             party / government, or not one of the nine
 * and the report counts only `targeted`. Nothing is silently dropped:
 * `unclear` is reported as its own bucket.
 *
 * ── FORWARD-ONLY ─────────────────────────────────────────────────────
 * Written onto new Maharashtra posts as they are analysed. There is no
 * backfill: older rows carry no `leader_target`, and the report leaves them
 * out of the leader score rather than mixing two definitions.
 */
const MH = require('../data/mh_leaders.json');
const { norm } = require('./mhLeaderMatch');

const VERSION = 1;

/** Surnames alone are never a match — see mhLeaderMatch. */
const AMBIGUOUS = new Set(['shinde', 'pawar', 'thackeray', 'patil', 'rao', 'शिंदे', 'पवार', 'ठाकरे', 'पाटील']);

/* ── lookup: every spelling of a leader → the leader ─────────────────── */
const LEADERS = MH.leaders.map((l) => ({
    key: l.key,
    name: l.name,
    handle: norm(l.handle),
    camp: l.alignment === 'opposition' ? 'opposition' : 'ally',
}));
const BY_KEY = new Map(LEADERS.map((l) => [l.key, l]));

const BY_TERM = (() => {
    const m = new Map();
    for (const l of MH.leaders) {
        const terms = [l.key, l.name, l.handle, ...(l.aliases || [])].map(norm).filter(Boolean);
        for (const t of terms) {
            if (AMBIGUOUS.has(t)) continue;
            // A term claimed by two leaders is ambiguous — better unresolved than wrong.
            if (m.has(t) && m.get(t) !== l.key) m.set(t, null);
            else m.set(t, l.key);
        }
    }
    return m;
})();

/** A whole target string → one of the nine, by EXACT match. */
const leaderForTarget = (raw) => {
    const t = norm(String(raw || '').replace(/^@+/, ''));
    if (!t) return null;
    const key = BY_TERM.get(t);
    return key ? BY_KEY.get(key) : null;
};

/** Which of the nine posted this, from the author handle. */
const leaderForAuthor = (handle) => {
    const h = norm(String(handle || '').replace(/^@+/, ''));
    if (!h) return null;
    return LEADERS.find((l) => l.handle === h) || null;
};

/**
 * Rules in stanceEngine that mean the engine HAD a target and scored it, as
 * opposed to falling back to "the first ally/opposition name I could find".
 */
const TARGET_RULE_RX = /^(sentiment-target rule|author-is-target correction)/;

const sideOf = (stance) => {
    const s = String(stance || '');
    if (/^pro_target/.test(s)) return 'pro';
    if (/^anti_target/.test(s)) return 'anti';
    if (s === 'neutral') return 'neutral';
    return 'unrelated';
};

/**
 * The flip. Ally: leader sentiment IS the government stance. Opposition: it is
 * the inverse. Neutral stays neutral; `unrelated` carries no sentiment.
 */
const leaderSentimentFor = (side, camp) => {
    if (side === 'neutral') return 'neutral';
    if (side !== 'pro' && side !== 'anti') return null;
    const positiveForGovernment = side === 'pro';
    return (camp === 'ally' ? positiveForGovernment : !positiveForGovernment) ? 'positive' : 'negative';
};

/**
 * @param {object} a
 * @param {string} a.stance          the stored government stance
 * @param {string} a.targetEntity    `target_entity` — what the stance engine scored
 * @param {string} a.rationale       stanceEngine's rationale (`narrative_direction`)
 * @param {Array}  a.leadersNamed    leader keys the post text names (mhLeaderMatch)
 * @param {string} a.authorHandle
 * @returns {object} the `leader_target` record to persist
 */
const classifyLeaderTarget = ({
    stance, targetEntity, rationale = '', leadersNamed = [], authorHandle = '',
}) => {
    const side = sideOf(stance);
    const author = leaderForAuthor(authorHandle);
    const target = leaderForTarget(targetEntity);

    const base = {
        version: VERSION,
        status: 'unclear',
        reason: '',
        target_leader_key: null,
        target_leader_name: null,
        target_camp: null,
        author_leader_key: author ? author.key : null,
        is_own_post: false,
        government_stance_side: side === 'unrelated' ? null : side,
        leader_sentiment: null,
        analysed_at: new Date(),
    };

    if (side === 'unrelated') return { ...base, reason: 'no_stance' };
    if (!target) return { ...base, reason: targetEntity ? 'target_not_a_monitored_leader' : 'target_missing' };

    /**
     * Confidence in the target. When the engine scored an extracted target,
     * trust it. When it fell back to "first side it could find", trust it only
     * if the post names exactly ONE of the nine and it is the one scored —
     * otherwise a post naming two leaders could be attributed to either.
     */
    const viaTarget = TARGET_RULE_RX.test(String(rationale || ''));
    const named = [...new Set(leadersNamed)];
    const unambiguous = named.length === 1 && named[0] === target.key;
    if (!viaTarget && !unambiguous) return { ...base, reason: 'target_not_confident' };

    const own = !!author && author.key === target.key;
    return {
        ...base,
        status: 'targeted',
        reason: viaTarget ? 'extracted_target' : 'single_leader_named',
        target_leader_key: target.key,
        target_leader_name: target.name,
        target_camp: target.camp,
        is_own_post: own,
        // An own post is the leader's output, not the public's view of him.
        leader_sentiment: own ? null : leaderSentimentFor(side, target.camp),
    };
};

module.exports = {
    VERSION, classifyLeaderTarget, leaderSentimentFor, leaderForTarget, leaderForAuthor, sideOf,
};
