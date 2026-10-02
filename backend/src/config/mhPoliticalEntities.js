/**
 * mhPoliticalEntities — the Maharashtra roster, in the same shape as the
 * host deployment's politicalEntities.js.
 *
 * ── WHY THIS HAD TO EXIST ────────────────────────────────────────────
 * Entity resolution ran against the Chhattisgarh roster for every request on
 * the process. A Maharashtra post reading "मा. @Dev_Fadnavis जी व @MSEDCL…"
 * resolved to `[]`, and politicalSentimentService then forced the stance to
 * `unrelated`. Measured on live data: 162 grievances and 73 alerts, every one
 * with `mentioned_entities: []` — stance coverage sat at 8% against
 * Chhattisgarh's 53%.
 *
 * ── ALIGNMENT IS BJP-RELATIVE, AS THE PIPELINE REQUIRES ──────────────
 * Every verdict this system stores is client-relative, and the host client
 * is the BJP. Maharashtra makes that workable: the BJP leads the governing
 * Mahayuti, so ally/opposition maps onto government/opposition.
 *
 * ⚠ `ally` is a statement about which camp a post helps, NEVER about party
 * membership. Only Fadnavis is BJP — Eknath Shinde and Shrikant Shinde are
 * Shiv Sena, Sunetra Pawar and Ajit Pawar are NCP. They are allies by
 * coalition. Someone reading the party column alone would "correct" three of
 * them to opposition and invert every figure under their names.
 *
 * ── TWO SPLIT PARTIES, FOUR CLAIMANTS TO TWO NAMES ───────────────────
 * Shiv Sena split (ECI gave Shinde the name and bow-and-arrow, Feb 2023) and
 * NCP split (ECI gave Ajit Pawar the name and clock). So bare "Shiv Sena"
 * and bare "NCP" now mean the GOVERNMENT factions, while the opposition
 * halves need their suffixes. Getting this backwards files an attack on the
 * government as an attack by it.
 *
 * ── SURNAMES ARE NOT ALIASES ─────────────────────────────────────────
 * "Shinde" is Eknath and Shrikant. "Pawar" is Sharad, Ajit, Sunetra, Rohit
 * and Supriya — across both camps. "Thackeray" is Uddhav, Aaditya and Raj.
 * A surname alias would attribute a post to the wrong person and, because
 * their alignments differ, flip its sign. Full names and handles only.
 */

const MH = require('../data/mh_leaders.json');

/* Same ladder as the host roster, so priorities mean the same thing. */
const PRIORITY = {
    CHIEF_MINISTER: 100,
    DEPUTY_CM: 94,
    PARTY_STATE: 90,
    OPPOSITION_LEADER: 88,
    MINISTER: 80,
    MP: 72,
    MLA: 68,
    PARTY_NATIONAL: 60,
    SCHEME: 55,
    INSTITUTION: 50,
    NATIONAL_FIGURE: 45,
};

const ent = (canonical, o) => ({
    canonical,
    type: o.type || 'person',
    party: o.party || null,
    role: o.role || null,
    constituency: o.constituency || null,
    district: o.district || null,
    scope: o.scope || 'state',
    alignment: o.alignment,
    priority: o.priority,
    derived: false,
    aliases: [...new Set(o.aliases.filter(Boolean))],
});

const MH_ENTITIES = {};

/* ── 1 · the nine under watch, from the verified roster ─────────────── */
const ROLE_PRIORITY = (l) => {
    if (/chief minister/i.test(l.role || '') && !/deputy/i.test(l.role || '')) return PRIORITY.CHIEF_MINISTER;
    if (/deputy chief minister/i.test(l.role || '')) return PRIORITY.DEPUTY_CM;
    if (/president/i.test(l.role || '')) return PRIORITY.OPPOSITION_LEADER;
    if (/member of parliament|\bMP\b/i.test(l.role || '')) return PRIORITY.MP;
    if (/\bMLA\b/i.test(l.role || '')) return PRIORITY.MLA;
    return PRIORITY.MINISTER;
};

for (const l of MH.leaders) {
    MH_ENTITIES[l.key] = ent(l.name, {
        party: l.party,
        role: l.role,
        alignment: l.alignment,
        priority: ROLE_PRIORITY(l),
        aliases: [l.name, ...(l.aliases || []), `@${l.handle}`, l.handle],
    });
}

/* ── 2 · the other principals the conversation turns on ─────────────── */
const OTHERS = [
    ['uddhav-thackeray', 'Uddhav Thackeray', {
        party: 'shivsena-ubt', role: 'President, Shiv Sena (UBT); former Chief Minister',
        alignment: 'opposition', priority: PRIORITY.OPPOSITION_LEADER,
        aliases: ['Uddhav Thackeray', 'Uddhav Balasaheb Thackeray', 'उद्धव ठाकरे', 'Uddhavji',
            '@OfficeofUT', 'OfficeofUT', 'Matoshree'],
    }],
    ['ajit-pawar', 'Ajit Pawar', {
        party: 'ncp', role: 'Leader, Nationalist Congress Party',
        alignment: 'ally', priority: PRIORITY.MINISTER,
        aliases: ['Ajit Pawar', 'Ajit Dada', 'Ajitdada', 'अजित पवार', 'दादा',
            '@AjitPawarSpeaks', 'AjitPawarSpeaks'],
    }],
    ['supriya-sule', 'Supriya Sule', {
        party: 'ncp-sp', role: 'Working President, NCP (SP); MP, Baramati',
        alignment: 'opposition', priority: PRIORITY.MP,
        aliases: ['Supriya Sule', 'सुप्रिया सुळे', '@supriya_sule', 'supriya_sule'],
    }],
    ['sanjay-raut', 'Sanjay Raut', {
        party: 'shivsena-ubt', role: 'MP, Rajya Sabha; Executive Editor, Saamana',
        alignment: 'opposition', priority: PRIORITY.MP,
        aliases: ['Sanjay Raut', 'संजय राऊत', '@rautsanjay61', 'rautsanjay61', 'Saamana', 'सामना'],
    }],
    ['chandrashekhar-bawankule', 'Chandrashekhar Bawankule', {
        party: 'bjp', role: 'State President, BJP Maharashtra',
        alignment: 'ally', priority: PRIORITY.PARTY_STATE,
        aliases: ['Chandrashekhar Bawankule', 'Bawankule', 'चंद्रशेखर बावनकुळे', 'बावनकुळे'],
    }],
    ['nana-patole', 'Nana Patole', {
        party: 'inc', role: 'Congress leader, Maharashtra',
        alignment: 'opposition', priority: PRIORITY.OPPOSITION_LEADER,
        aliases: ['Nana Patole', 'नाना पटोले'],
    }],
    ['vijay-wadettiwar', 'Vijay Wadettiwar', {
        party: 'inc', role: 'Congress leader; Leader of Opposition',
        alignment: 'opposition', priority: PRIORITY.OPPOSITION_LEADER,
        aliases: ['Vijay Wadettiwar', 'Wadettiwar', 'विजय वडेट्टीवार'],
    }],
    ['narendra-modi', 'Narendra Modi', {
        party: 'bjp', role: 'Prime Minister', scope: 'national',
        alignment: 'ally', priority: PRIORITY.NATIONAL_FIGURE,
        aliases: ['Narendra Modi', 'PM Modi', 'नरेंद्र मोदी', 'मोदी', '@narendramodi', 'narendramodi'],
    }],
    ['rahul-gandhi', 'Rahul Gandhi', {
        party: 'inc', role: 'Congress leader', scope: 'national',
        alignment: 'opposition', priority: PRIORITY.NATIONAL_FIGURE,
        aliases: ['Rahul Gandhi', 'राहुल गांधी', '@RahulGandhi', 'RahulGandhi'],
    }],
];
for (const [key, canonical, o] of OTHERS) MH_ENTITIES[key] = ent(canonical, o);

/* ── 3 · parties ────────────────────────────────────────────────────
 *
 * ⚠ Bare "Shiv Sena" and bare "NCP" belong to the GOVERNMENT factions now:
 * the ECI awarded both names to the Shinde and Ajit Pawar camps. The
 * opposition halves carry their suffixes and must never claim the bare form.
 */
const PARTIES = [
    ['bjp', 'Bharatiya Janata Party', 'ally', ['BJP', 'Bharatiya Janata Party', 'BJP Maharashtra',
        'Maharashtra BJP', 'भाजप', 'भाजपा', 'भारतीय जनता पार्टी', '@BJP4Maharashtra', 'BJP4Maharashtra']],
    ['shivsena', 'Shiv Sena', 'ally', ['Shiv Sena', 'Shivsena', 'शिवसेना', 'Shinde Sena',
        'Shinde group', 'शिंदे गट', 'Balasahebanchi Shiv Sena']],
    /**
     * `राष्ट्रवादी` on its own is deliberate.
     *
     * "राष्ट्रवादी युवक काँग्रेस" (the NCP youth wing) has युवक sitting
     * between the two words, so the two-word alias never matched and the
     * bare `काँग्रेस` claimed it for Congress instead — wrong party, and
     * wrong CAMP, since NCP is ally and Congress is opposition.
     *
     * Bare `राष्ट्रवादी` goes to the faction holding the name, the same rule
     * the ECI applied and the same one bare "NCP" already follows.
     */
    ['ncp', 'Nationalist Congress Party', 'ally', ['NCP', 'Nationalist Congress Party',
        'राष्ट्रवादी काँग्रेस', 'राष्ट्रवादी',
        // The wing names, in full. Matching 'राष्ट्रवादी' alone leaves
        // 'काँग्रेस' free to be claimed by Congress off the same phrase, so
        // one post ended up naming an ally AND an opponent — which leaves
        // the stance engine with no target at all.
        'राष्ट्रवादी युवक काँग्रेस', 'राष्ट्रवादी महिला काँग्रेस',
        'Nationalist Youth Congress', 'NCP Yuvak',
        'Ajit Pawar group', 'अजित पवार गट']],
    ['mahayuti', 'Mahayuti', 'ally', ['Mahayuti', 'महायुती', 'Maha Yuti']],
    ['shivsena-ubt', 'Shiv Sena (UBT)', 'opposition', ['Shiv Sena UBT', 'Shiv Sena (UBT)',
        'ShivSena UBT', 'Uddhav Balasaheb Thackeray', 'शिवसेना उद्धव बाळासाहेब ठाकरे',
        'ठाकरे गट', 'Thackeray group', '@ShivSenaUBT_', 'ShivSenaUBT_']],
    ['ncp-sp', 'Nationalist Congress Party (Sharadchandra Pawar)', 'opposition',
        ['NCP SP', 'NCP (SP)', 'Nationalist Congress Party Sharadchandra Pawar',
            'राष्ट्रवादी काँग्रेस शरदचंद्र पवार', 'राष्ट्रवादी शरदचंद्र पवार',
            'शरदचंद्र पवार', 'शरद पवार गट', '@NCPspeaks', 'NCPspeaks']],
    ['inc', 'Indian National Congress', 'opposition', ['Congress', 'INC',
        'Indian National Congress', 'काँग्रेस', 'Maharashtra Congress',
        '@INCMaharashtra', 'INCMaharashtra']],
    ['mva', 'Maha Vikas Aghadi', 'opposition', ['Maha Vikas Aghadi', 'MVA', 'महाविकास आघाडी']],
    ['mns', 'Maharashtra Navnirman Sena', 'opposition', ['MNS', 'Maharashtra Navnirman Sena',
        'मनसे', 'महाराष्ट्र नवनिर्माण सेना', '@mnsadhikrut', 'mnsadhikrut']],
];
for (const [key, canonical, alignment, aliases] of PARTIES) {
    MH_ENTITIES[key] = ent(canonical, {
        type: 'party', party: key, alignment, priority: PRIORITY.PARTY_STATE, aliases,
    });
}

/* ── 4 · schemes and programmes ──────────────────────────────────────
 *
 * `alignment` follows WHO BUILT IT, not who runs it. Criticism of a scheme
 * is criticism of whoever is credited with it, and the two can differ after
 * a change of government — the same rule the host roster uses for
 * `built_by`.
 */
const SCHEMES = [
    ['ladki-bahin', 'Mukhyamantri Majhi Ladki Bahin Yojana', 'ally',
        ['Ladki Bahin', 'Ladki Bahin Yojana', 'Majhi Ladki Bahin', 'लाडकी बहीण',
            'लाडकी बहिण योजना', '#LadkiBahin']],
    ['shetkari-karjmafi', 'Farm loan waiver', 'ally',
        ['karjmafi', 'कर्जमाफी', 'शेतकरी कर्जमाफी', 'loan waiver', 'farm loan waiver',
            'सरसकट कर्जमाफी', 'Ahilyadevi Holkar Shetkari Karjmukti']],
    ['jalyukt-shivar', 'Jalyukt Shivar', 'ally', ['Jalyukt Shivar', 'जलयुक्त शिवार']],
    ['maratha-reservation', 'Maratha reservation', 'neutral',
        ['Maratha reservation', 'मराठा आरक्षण', 'Maratha andolan', 'मराठा आंदोलन',
            'Kunbi certificate', 'कुणबी प्रमाणपत्र', 'मराठा क्रांती मोर्चा']],
    ['samruddhi', 'Samruddhi Mahamarg', 'ally',
        ['Samruddhi Mahamarg', 'समृद्धी महामार्ग', 'Samruddhi Expressway']],
];
for (const [key, canonical, alignment, aliases] of SCHEMES) {
    MH_ENTITIES[key] = ent(canonical, {
        type: 'scheme', party: alignment === 'ally' ? 'bjp' : null,
        alignment, priority: PRIORITY.SCHEME, aliases,
    });
}

/* ── 5 · institutions ─────────────────────────────────────────────────
 *
 * The administration is ALLY here, because the BJP-led Mahayuti governs.
 * That is the opposite of the BRS deployment, where the state government
 * belonged to the rival — the alignment of a government body is a property
 * of who holds office, never of the body itself.
 */
const INSTITUTIONS = [
    ['mh-government', 'Government of Maharashtra', 'ally',
        ['Government of Maharashtra', 'Maharashtra government', 'महाराष्ट्र सरकार',
            'राज्य सरकार', 'Mantralaya', 'मंत्रालय', '@CMOMaharashtra', 'CMOMaharashtra',
            '@MahaDGIPR', 'MahaDGIPR']],
    ['msedcl', 'MSEDCL', 'ally',
        ['MSEDCL', 'Mahavitaran', 'महावितरण', 'Maharashtra State Electricity Distribution']],
    ['bmc', 'Brihanmumbai Municipal Corporation', 'neutral',
        ['BMC', 'Brihanmumbai Municipal Corporation', 'महापालिका', 'मुंबई महापालिका']],
    ['mh-police', 'Maharashtra Police', 'neutral',
        ['Maharashtra Police', 'महाराष्ट्र पोलीस', '@MahaCyber1', 'MahaCyber1']],
    ['sec-maharashtra', 'State Election Commission', 'neutral',
        ['State Election Commission', 'SEC Maharashtra', 'राज्य निवडणूक आयोग']],
];
for (const [key, canonical, alignment, aliases] of INSTITUTIONS) {
    MH_ENTITIES[key] = ent(canonical, {
        type: 'institution', alignment, priority: PRIORITY.INSTITUTION, aliases,
    });
}

/* ── alias index, mirroring the host roster's ───────────────────────── */
const MIN_ALIAS_LEN = 3;

/**
 * Aliases that must not match as a bare substring.
 *
 * Short ASCII tokens inside longer words ("NCP" in "NCPspeaks" is fine, but
 * "MNS" inside "columns" is not), and Devanagari surnames shared across the
 * splits.
 */
const BLOCKED_BARE = new Set(['sena', 'pawar', 'shinde', 'thackeray', 'patil',
    'पवार', 'शिंदे', 'ठाकरे', 'पाटील', 'दादा']);

const MH_ALIAS_INDEX = (() => {
    const out = [];
    for (const [key, e] of Object.entries(MH_ENTITIES)) {
        for (const alias of e.aliases) {
            const a = String(alias || '').trim().toLowerCase();
            if (a.length < MIN_ALIAS_LEN) continue;
            if (BLOCKED_BARE.has(a)) continue;
            out.push({ alias: a, entityKey: key });
        }
    }
    // Longest first: "shiv sena ubt" must win over "shiv sena".
    return out.sort((x, y) => y.alias.length - x.alias.length);
})();

/** Short ASCII aliases need word boundaries; Devanagari has no case folding. */
const SHORT_ASCII_MAX = 4;
const mhAliasOccursIn = (haystackLower, alias) => {
    if (!alias) return false;
    if (alias.length <= SHORT_ASCII_MAX && /^[a-z0-9]+$/.test(alias)) {
        return new RegExp(`(^|[^a-z0-9])${alias}([^a-z0-9]|$)`, 'i').test(haystackLower);
    }
    return haystackLower.includes(alias);
};

/**
 * Find every alias occurrence, masking what has already been claimed.
 *
 * ⚠ WITHOUT MASKING, A SHORTER ALIAS MATCHES INSIDE A LONGER ONE.
 * "Shiv Sena UBT" matched both `Shiv Sena (UBT)` (opposition) and
 * `Shiv Sena` (ally, the Shinde faction) off the same four words, so a post
 * about Uddhav's party was recorded as naming the government's party too —
 * and with both alignments present the stance engine has no target. The same
 * trap waits on "NCP (SP)" inside "NCP".
 *
 * Aliases are tried longest-first and each match blanks out the span it
 * consumed, so the specific name wins and the generic one cannot re-claim it.
 */
/**
 * Honorifics fused INTO a name defeat a contiguous alias.
 *
 * Marathi and Hindi attach them directly, and often between the two halves
 * of a name: "एकनाथजी शिंदे". The alias "एकनाथ शिंदे" then never matches, so
 * a post plainly addressed to the Deputy Chief Minister resolves to nothing
 * and is scored `unrelated`. A TRAILING honorific ("फडणवीसजी") already works
 * — substring matching covers it — but an INFIXED one does not.
 *
 * Stripped from the scanning copy only; the stored text is untouched.
 */
const HONORIFICS = /(जी|साहेब|सहेब|ताई|दादा|भाऊ|अण्णा|माननीय)/g;
const stripHonorifics = (s) => String(s || '').replace(HONORIFICS, ' ').replace(/\s+/g, ' ');

const mhFindMentionedEntities = (text) => {
    const original = ` ${stripHonorifics(String(text || '').toLowerCase())} `;
    let lower = original;
    const seen = new Map();
    for (const { alias, entityKey } of MH_ALIAS_INDEX) {
        if (seen.has(entityKey)) continue;
        if (!mhAliasOccursIn(lower, alias)) continue;
        const e = MH_ENTITIES[entityKey];
        if (!e) continue;
        // Blank the consumed span so nothing shorter can match inside it.
        lower = lower.split(alias).join(' '.repeat(alias.length));
        seen.set(entityKey, {
            key: entityKey,
            canonical: e.canonical,
            alignment: e.alignment,
            party: e.party,
            type: e.type,
            role: e.role || null,
            priority: e.priority,
            matched_alias: alias,
        });
    }
    return [...seen.values()];
};

const mhResolveAuthorEntity = (handle) => {
    const bare = String(handle || '').trim().replace(/^@+/, '').toLowerCase();
    if (!bare) return null;
    const hit = MH_ALIAS_INDEX.find((x) => x.alias === bare || x.alias === `@${bare}`);
    if (!hit) return null;
    const e = MH_ENTITIES[hit.entityKey];
    return e ? {
        key: hit.entityKey,
        canonical: e.canonical,
        alignment: e.alignment,
        party: e.party,
        type: e.type,
        role: e.role || null,
        priority: e.priority,
        matched_alias: `@${bare}`,
    } : null;
};

/** The Chief Minister — the brief's primary target, same role as the host's. */
const MH_PRIMARY_TARGET_KEY = (MH.leaders.find(
    (l) => /chief minister/i.test(l.role || '') && !/deputy/i.test(l.role || ''),
) || {}).key || 'mh-fadnavis';

module.exports = {
    MH_ENTITIES,
    MH_ALIAS_INDEX,
    MH_PRIMARY_TARGET_KEY,
    mhFindMentionedEntities,
    mhResolveAuthorEntity,
    mhAliasOccursIn,
    PRIORITY,
};
