/**
 * verticalProfiles — who "we" are, per client dataset.
 *
 * ── THE PROBLEM THIS SOLVES ──────────────────────────────────────────
 * The vertical filter separates ROWS. It does nothing about CONFIG.
 * `politicalData.js` is a module-level singleton read once at startup, so
 * `OUR_PARTY.chief` is Vishnu Deo Sai for every request on this process —
 * including requests from the Maharashtra user.
 *
 * The visible result: the Maharashtra login opened the Intelligence Brief
 * and saw correctly-filtered Maharashtra counts under a Chhattisgarh frame.
 * "Chief Minister: Vishnu Deo Sai — 0 mentions naming him." The data was
 * right and the question was wrong, which is worse than an error, because
 * the page looks like it is working.
 *
 * A full fix means making the whole political config per-tenant, which is
 * weeks of work across 20 files. This covers the part the brief actually
 * displays: who the principal is, which party is "ours", and which state
 * the page is about.
 *
 * ── WHAT THIS DOES NOT FIX ───────────────────────────────────────────
 * Voice classification, entity resolution and the stance engine still read
 * the host deployment's roster at module scope. For Maharashtra that means
 * an account is scored against the Chhattisgarh roster unless it is in
 * mh_leaders.json. Narrowing that is the next piece of work, not this one.
 */
const { OUR_PARTY } = require('./politicalData');
const { DEFAULT_VERTICAL, currentVerticals } = require('./verticals');

const MH = require('../data/mh_leaders.json');

/** The Maharashtra principal: the sitting Chief Minister among the nine. */
const mhChief = MH.leaders.find((l) => /chief minister/i.test(l.role || '') && !/deputy/i.test(l.role || ''));

const PROFILES = {
    // The host deployment. Null means "use politicalData as-is", so nothing
    // about the live Chhattisgarh client changes.
    cg: null,

    mh: {
        id: 'bjp',
        name: 'BJP',
        full_name: 'Bharatiya Janata Party',
        chief: mhChief ? mhChief.name : 'Devendra Fadnavis',
        state: 'Maharashtra',
        /**
         * ⚠ "Our party" is a simplification here and the report should say so.
         * The nine monitored leaders span five parties across government and
         * opposition. The BJP leads the governing Mahayuti and supplies the
         * Chief Minister, so it is the defensible frame for a CM brief — but
         * a reader who assumes the whole watch list is BJP will misread every
         * opposition figure on it. The per-leader sections are where the
         * cross-party picture lives.
         */
        caveat: 'Nine leaders across five parties are monitored; this brief is framed around the Chief Minister.',
    },
};

/** The profile for an explicit vertical, or for the current request. */
const profileFor = (vertical) => {
    const v = vertical || (currentVerticals() || [])[0] || DEFAULT_VERTICAL;
    return PROFILES[v] || null;
};

/**
 * `OUR_PARTY`, resolved for this request. Falls back to the deployment's own
 * config, so any vertical without a profile behaves exactly as before.
 */
const ourPartyFor = (vertical) => {
    const p = profileFor(vertical);
    if (!p) return OUR_PARTY;
    return { ...OUR_PARTY, ...p };
};

module.exports = { PROFILES, profileFor, ourPartyFor };
