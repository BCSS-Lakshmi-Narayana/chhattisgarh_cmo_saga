/**
 * mhLeaderMatch — which Maharashtra leaders does a document mention?
 *
 * ── WHY NOT `analysis.mentioned_entities` ────────────────────────────
 * Because it is EMPTY for every Maharashtra row, and always will be.
 *
 * Entity resolution runs against this deployment's own roster, which is
 * Chhattisgarh's. It has never heard of Devendra Fadnavis, so a post reading
 * "मा. @Dev_Fadnavis जी व @MSEDCL…" resolves to `[]` and is scored
 * `unrelated`. Checked against live data on 2026-10-01: 156 grievances, 126
 * content items, 73 alerts — `mentioned_entities: []` on all of them.
 *
 * So the brief reported "0 mentions naming him" while sitting on hundreds of
 * posts that named him in the text. Matching the text and the author handle
 * directly is the only thing that works until entity resolution itself is
 * made per-tenant.
 *
 * ── WHAT IT MATCHES ──────────────────────────────────────────────────
 *   · the leader's X handle, with or without the @  (@Dev_Fadnavis)
 *   · any alias from mh_leaders.json, Latin or Devanagari
 *   · the author's own handle, so a leader's own posts count as theirs
 *
 * ── WHAT IT WILL NOT MATCH ───────────────────────────────────────────
 * Bare surnames. "Shinde" is Eknath AND Shrikant; "Pawar" is Sharad, Sunetra
 * and Rohit, who sit in opposing camps. Counting a surname would put an
 * attack on one under another's name and, because their alignments differ,
 * flip its sign. Full names and handles only.
 */
const MH = require('../data/mh_leaders.json');

/** Devanagari and Latin both; collapse punctuation so "@Dev_Fadnavis" ≈ "dev fadnavis". */
const norm = (s) => String(s || '')
    .toLowerCase()
    .replace(/[_@#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** A surname alone is never a safe match — see the header. */
const AMBIGUOUS = new Set(['shinde', 'pawar', 'thackeray', 'patil', 'rao', 'शिंदे', 'पवार', 'ठाकरे', 'पाटील']);

const TERMS = MH.leaders.map((l) => {
    const terms = new Set();
    terms.add(norm(l.handle));
    for (const a of l.aliases || []) {
        const t = norm(a);
        if (!t) continue;
        if (AMBIGUOUS.has(t)) continue;
        terms.add(t);
    }
    terms.add(norm(l.name));
    return {
        key: l.key,
        name: l.name,
        handle: l.handle,
        alignment: l.alignment,
        role: l.role,
        terms: [...terms].filter(Boolean).sort((a, b) => b.length - a.length),
    };
});

/** Text of a doc, whatever collection it came from. */
const textOf = (d) => norm([
    d.content?.text, d.text, d.title, d.title_english,
    d.description, d.llm_analysis?.summary,
].filter(Boolean).join(' '));

/** The author handle, whatever the collection calls it. */
const authorOf = (d) => norm(d.posted_by?.handle || d.author_handle || d.handle || '');

/**
 * @returns {Array<{key,name,handle,alignment,via}>} leaders this doc names.
 *          `via` is 'author' when the leader POSTED it, 'text' when they were
 *          named in it — the brief needs to tell those apart, because a
 *          leader's own post is not public opinion about them.
 */
const leadersIn = (doc) => {
    const text = textOf(doc);
    const author = authorOf(doc);
    const out = [];
    for (const l of TERMS) {
        if (author && l.terms.includes(author)) { out.push({ ...l, via: 'author' }); continue; }
        if (text && l.terms.some((t) => t.length > 3 && text.includes(t))) out.push({ ...l, via: 'text' });
    }
    return out;
};

/** Does this doc name this specific leader (by key, name or handle)? */
const namesLeader = (doc, who) => {
    if (!who) return true;
    const want = norm(who);
    return leadersIn(doc).some((l) => l.key === who
        || norm(l.name) === want
        || norm(l.handle) === want);
};

/** Every distinct handle that has posted, for the handle picker. */
const authorHandles = (docs) => {
    const seen = new Map();
    for (const d of docs) {
        const h = d.posted_by?.handle || d.author_handle || d.handle;
        if (!h) continue;
        const k = String(h).replace(/^@+/, '');
        if (!seen.has(k)) {
            seen.set(k, {
                handle: k,
                name: d.posted_by?.display_name || k,
                count: 0,
                // The report lists public voices and official/leader accounts
                // SEPARATELY, because a minister's own output is publicity,
                // not public opinion — mixing them put four official accounts
                // in a "most active public voices" table.
                voice: voiceOf(k) || 'organic',
            });
        }
        const row = seen.get(k);
        row.count += 1;
        // Per-handle tone, so the table can say what a loud account is loud ABOUT.
        const stance = String(d.analysis?.political_stance || '');
        if (/anti/.test(stance)) row.anti = (row.anti || 0) + 1;
        else if (/pro/.test(stance)) row.pro = (row.pro || 0) + 1;
    }
    return [...seen.values()].sort((a, b) => b.count - a.count);
};

/* ── districts ────────────────────────────────────────────────────────
 *
 * `services/districtLocator` only knows the host state's districts, so
 * `detected_location.district` was null on 100% of Maharashtra rows and the
 * Top Locations panel sat empty regardless of volume.
 *
 * Longest first, so "Mumbai Suburban" wins over "Mumbai" and the renamed
 * pairs (Aurangabad / Chhatrapati Sambhajinagar) both resolve to the name
 * actually used in the post.
 */
const DISTRICTS = [...new Set(MH.districts)]
    .map((d) => ({ name: d, term: norm(d) }))
    .sort((a, b) => b.term.length - a.term.length);

const districtIn = (doc) => {
    const text = textOf(doc);
    if (!text) return null;
    const hit = DISTRICTS.find((d) => d.term.length > 3 && text.includes(d.term));
    return hit ? hit.name : null;
};

/* ── voice ────────────────────────────────────────────────────────────
 *
 * classifyVoice resolves against the host client's handle registry, so every
 * Maharashtra account fell through to `organic`. The effect on screen: "Who
 * Is Talking — Public 192, 100%", with the leaders' own posts and the
 * opposition parties' posts both counted as public opinion. The sentiment
 * figures deliberately use the public group only, so our own publicity was
 * being read as the public's view of us.
 */
let _adversaries = null;
const adversaryHandles = () => {
    if (_adversaries) return _adversaries;
    try {
        const ADV = require('../data/mh_adversary_handles.json');
        _adversaries = new Map(
            (ADV.accounts || []).map((a) => [norm(a.handle), a.camp === 'mahayuti' ? 'owned' : 'opposition']),
        );
    } catch { _adversaries = new Map(); }
    return _adversaries;
};

/** Handles of the nine themselves — a leader's own post is `owned`. */
const OWN_HANDLES = new Set(MH.leaders.map((l) => norm(l.handle)));

/**
 * Resolve a handle against the FULL entity roster, not just the nine.
 *
 * @CMOMaharashtra and @MahaDGIPR are the Chief Minister's office and the
 * state information department — institutional publicity, not public
 * opinion. Checking only the nine leaders left both sitting at the top of
 * "most active public voices", which is precisely the mistake the report
 * splits those two tables to avoid.
 */
let _roster = null;
const rosterVoice = (bare) => {
    if (!_roster) {
        try { _roster = require('../config/mhPoliticalEntities'); } catch { _roster = false; }
    }
    if (!_roster) return null;
    const hit = _roster.mhResolveAuthorEntity(bare);
    if (!hit) return null;
    if (hit.alignment === 'opposition') return 'opposition';
    if (hit.alignment === 'ally') return 'owned';
    // Neutral institutions (police, election commission) are not "ours" and
    // not the public either — the press bucket is the closest honest home.
    return 'news';
};

const voiceOf = (handle) => {
    const h = norm(String(handle || '').replace(/^@+/, ''));
    if (!h) return null;
    if (OWN_HANDLES.has(h)) return 'owned';
    const adv = adversaryHandles().get(h);
    if (adv) return adv;
    return rosterVoice(h); // null ⇒ caller falls back to 'organic'
};

module.exports = {
    leadersIn, namesLeader, authorHandles, districtIn, voiceOf, TERMS, norm, DISTRICTS,
};
