/**
 * stateSignal — is a post about THIS state at all?
 *
 * True when the text names the state, a district / town (districtLocator), an
 * assembly seat, or any in-state roster entity (leader, party, department,
 * institution). National figures alone (Modi, Rahul Gandhi) do not count.
 *
 * Used twice:
 *   • ingestion — a post fetched by a generic grievance keyword ("fertilizer
 *     shortage", "electricity bill") must be about this state to be kept;
 *   • stance — a post with no state context is `unrelated`, never supportive
 *     or opposing (a Ghana or Uttar Pradesh post is not about the client).
 */

const { STATE_NAME, STATE_NAME_NATIVE } = require('../config/deployment');
const { locateDistrict } = require('../services/districtLocator');
const { DEFAULT_VERTICAL } = require('../config/verticals');

// Common spellings / abbreviations of the state name in posts.
const EXTRA_SPELLINGS = {
    Chhattisgarh: ['chattisgarh', 'chhatisgarh', 'chhattisgadh', 'cg'],
    Goa: ['goan', 'goem'],
}[STATE_NAME] || [];

const STATE_WORD_RX = new RegExp(
    `(^|[^a-z0-9])#?(${[STATE_NAME.toLowerCase(), ...EXTRA_SPELLINGS].join('|')})([^a-z0-9]|$)`,
    'i',
);
// Devanagari spellings vary in the nukta (छत्तीसगढ़ / छत्तीसगढ), so compare without it.
const stripNukta = (s) => String(s || '').normalize('NFD').replace(/़/g, '');
const NATIVE_STEM = stripNukta(STATE_NAME_NATIVE || '');

let _seatLookup = null;
const namesSeat = (text) => {
    // Lazy: locationClassifierService pulls in the constituency master.
    if (!_seatLookup) _seatLookup = require('../services/locationClassifierService').heuristicLookup;
    return !!_seatLookup(text);
};

let _entities = null;
const isInStateEntity = (key) => {
    if (!_entities) _entities = require('../config/politicalEntities').POLITICAL_ENTITIES;
    const e = _entities[key];
    return !!e && e.scope !== 'national';
};

/* ── the second vertical ──────────────────────────────────────────────
 *
 * A second client's leaders are collected in the same database under
 * `vertical: 'mh'`. They are NOT in the Chhattisgarh roster, do not appear in
 * the Chhattisgarh constituency master, and their districts are not in
 * districtLocator — so every check above correctly returns false for them,
 * and without this block a Maharashtra post would be scored `unrelated` and
 * carry no sentiment at all.
 *
 * ⚠ THE TWO SETS MUST NEVER BE OR-ED TOGETHER. Matching Maharashtra terms
 * while scoring a Chhattisgarh post would let out-of-state content through
 * the live client's ingestion gate — the exact thing that gate exists to
 * prevent. The vertical selects ONE matcher; it never widens the other.
 */
const MH = require('../data/mh_leaders.json');

const MH_WORD_RX = new RegExp(
    `(^|[^a-z0-9])#?(${[...new Set(MH.state_aliases)].join('|')})([^a-z0-9]|$)`,
    'i',
);
const MH_NATIVE_STEM = stripNukta(MH.state_native || '');
const MH_DISTRICT_RX = new RegExp(
    `(^|[^a-z0-9])(${MH.districts.map((d) => d.toLowerCase().replace(/[^a-z0-9]+/g, '[^a-z0-9]+')).join('|')})([^a-z0-9]|$)`,
    'i',
);
const MH_LEADER_KEYS = new Set(MH.leaders.map((l) => l.key));
/** Every alias of every listed leader, Latin and Devanagari alike. */
const MH_NAME_RX = new RegExp(
    MH.leaders.flatMap((l) => l.aliases).map((a) => a.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '[^\\p{L}\\p{N}]+')).join('|'),
    'iu',
);

const hasMhSignal = (text, entities = []) => {
    const t = String(text || '');
    if ((entities || []).some((e) => e && MH_LEADER_KEYS.has(e.key))) return true;
    if (MH_WORD_RX.test(t)) return true;
    if (MH_NATIVE_STEM && stripNukta(t).includes(MH_NATIVE_STEM)) return true;
    if (MH_NAME_RX.test(t)) return true;
    return MH_DISTRICT_RX.test(t);
};

/**
 * @param {string} text        post text (plus anything else worth scanning)
 * @param {Array}  entities    roster entities already found in the text
 *                             ({ key }), e.g. ctx.mentioned_entities
 * @param {string} vertical    which client's rules to apply. Defaults to the
 *                             host client, so every existing call site keeps
 *                             its exact present behaviour.
 */
const hasStateSignal = (text, entities = [], vertical = DEFAULT_VERTICAL) => {
    const t = String(text || '');
    if (!t.trim() && !entities.length) return false;
    if (vertical === 'mh') return hasMhSignal(t, entities);
    if ((entities || []).some((e) => e && isInStateEntity(e.key))) return true;
    if (STATE_WORD_RX.test(t)) return true;
    if (NATIVE_STEM && stripNukta(t).includes(NATIVE_STEM)) return true;
    if (locateDistrict(t)) return true;
    return namesSeat(t);
};

module.exports = { hasStateSignal, hasMhSignal };
