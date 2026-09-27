/**
 * politicalEntities.js
 * ─────────────────────────────────────────────────────────────────────
 * Chhattisgarh political entity graph — a DERIVED VIEW over `politicalData.js`, which
 * remains the single source of truth for who exists in the political universe.
 *
 * What this layer adds:
 *   • alignment        — 'ally' | 'opposition' | 'neutral'
 *   • scope            — 'state' | 'national'
 *   • priority         — ranking hint only; NEVER a stance decision
 *   • aliases          — transliterations, nicknames, handles, symbol names,
 *                        and hand-curated NATIVE-SCRIPT spellings
 *   • ALIAS_INDEX      — alias → primary entity (longest alias first)
 *   • ALIAS_CANDIDATES — alias → ALL entities claiming it (ambiguity-aware)
 *
 * IMPORTANT:
 *   This module resolves ENTITY IDENTITY. It does NOT decide political stance.
 *   Stance is decided downstream by services/stanceEngine.js from
 *   (target, target_tone, author) — never from priority or mention order.
 *
 * ⚠ ALIGNMENT IS STATE-SPECIFIC: BJP is the client and INC/GGP/JCC(J)/AAP/BSP are the
 *   opposition. Other deployments of this codebase have had it the other way round.
 */

const {
    OUR_PARTY,
    ALLY_PARTIES,
    OPPOSITION_PARTIES,
    CABINET_MINISTERS,
    PRESIDING_OFFICERS,
    PARTY_ORG_LEADERS,
    NATIONAL_ALLY_LEADERS,
    NATIONAL_OPPOSITION_LEADERS,
    ALLY_MLAS,
    ALLY_MPS,
    OPPOSITION_LEADERS,
} = require('./politicalData');
const { STATE_NAME } = require('./deployment');

/* ─── priority ──────────────────────────────────────────────────────── */

/**
 * Priority is ONLY an entity-ranking hint, used to pick a `primary_target`
 * for display when several entities are mentioned.
 *
 * It must NEVER be used as:
 *   priority → target        (that is `sentiment_target`, extracted per-post)
 *   priority → stance        (that is stanceEngine)
 *   priority → client relevance
 */
const PRIORITY = {
    CHIEF_MINISTER: 100,
    DEPUTY_CM: 95,
    PARTY_CHIEF: 94,
    RULING_PARTY: 90,
    OPPOSITION_CHIEF: 88,
    OPPOSITION_PARTY: 86,
    CABINET_MINISTER: 80,
    ALLY_PARTY: 75,
    PRESIDING_OFFICER: 70,
    MP: 60,
    OPPOSITION_SENIOR: 58,
    MLA: 55,
    NATIONAL_LEADER: 50,
    NEUTRAL_INSTITUTION: 30,
};

/* ─── curated aliases ───────────────────────────────────────────────── */

/**
 * Hand-curated aliases keyed by the `id` used in politicalData.js.
 *
 * WHY THIS MATTERS MORE THAN ANYTHING ELSE IN THIS FILE:
 * The Stage 2 deterministic pre-scan reads the ORIGINAL post text.
 * Chhattisgarh posts often name a leader only in Devanagari (Hindi press) or by
 * a nickname ("TS Baba", "Bhupesh Kaka"). Without that alias here, Stage 2 cannot see the leader,
 * and Stage 4 has no camp to attach a stance to — the post silently drops to
 * `general_politics`.
 *
 * Devanagari spellings come from Hindi media (Dainik Bhaskar, Haribhoomi,
 * Patrika) and the Assembly's member list. Also included:
 *   • MACHINE-TRANSLATION spellings — the pipeline pre-translates to English
 *     before the LLM extracts actors, and translators vary the spelling.
 *   • Legacy pipeline keys ('bsk', 'bsk_son') so stored `target_entity` values
 *     keep resolving to the primary/secondary client leaders.
 *
 * Very common surnames ("sai", "sao", "baghel", "singh", "sharma") and
 * ordinary words used as nicknames ("kaka" = uncle, "baba") are deliberately
 * NOT aliases on their own: they would match unrelated people and text.
 */
const CURATED_ALIASES = {
    "vishnu-deo-sai": ["vishnu deo sai", "vishnudeo sai", "vishnu dev sai", "vishnudev sai", "vishnudev sai sarkar", "vishnudev sai government", "cm sai", "cm vishnu deo sai", "chhattisgarh cm", "cg cm", "chief minister sai", "sai sarkar", "sai government", "sai govt", "@vishnudsai", "@chhattisgarhcmo", "#vishnudeosai", "#cmsai", "bsk", "विष्णु देव साय", "विष्णुदेव साय", "विष्णु देव साई", "मुख्यमंत्री साय", "मुख्यमंत्री विष्णु देव साय", "मुख्यमंत्री विष्णुदेव साय", "सीएम साय", "सीएम विष्णुदेव साय", "साय सरकार", "विष्णु का सुशासन", "बगिया के विष्णु"],
    "kiran-singh-deo": ["kiran singh deo", "kiran deo", "kiran singhdeo", "bjp chhattisgarh president", "cg bjp president", "bjp state president kiran", "@kirandeobjp", "bsk_son", "किरण सिंहदेव", "किरण सिंह देव", "किरण देव", "किरणदेव", "भाजपा प्रदेश अध्यक्ष किरण देव"],
    "bhupesh-baghel": ["bhupesh baghel", "bhupesh kaka", "kaka bhupesh", "former cm baghel", "@bhupeshbaghel", "भूपेश बघेल", "पूर्व मुख्यमंत्री भूपेश बघेल", "पूर्व सीएम भूपेश बघेल", "भूपेश कका"],
    "ts-singh-deo": ["ts singh deo", "ts singhdeo", "t s singh deo", "ts baba", "@ts_singhdeo", "टीएस सिंहदेव", "टी.एस. सिंहदेव", "टी एस सिंहदेव", "टीएस बाबा", "बाबा सिंहदेव"],
    "charan-das-mahant": ["charan das mahant", "charandas mahant", "lop mahant", "@drcharandas", "चरणदास महंत", "चरण दास महंत", "डॉ. चरणदास महंत", "नेता प्रतिपक्ष महंत", "नेता प्रतिपक्ष चरणदास महंत"],
    "raman-singh": ["raman singh", "dr raman singh", "speaker raman singh", "chawal wale baba", "chaur wale baba", "रमन सिंह", "डॉ. रमन सिंह", "डॉ रमन सिंह", "विधानसभा अध्यक्ष रमन सिंह", "स्पीकर रमन सिंह", "चाउर वाले बाबा"],
    "arun-sao": ["अरुण साव", "उपमुख्यमंत्री अरुण साव", "डिप्टी सीएम अरुण साव", "डिप्टी सीएम साव"],
    "vijay-sharma": ["विजय शर्मा", "उपमुख्यमंत्री विजय शर्मा", "डिप्टी सीएम विजय शर्मा", "गृहमंत्री विजय शर्मा"],
    "ramvichar-netam": ["रामविचार नेताम", "राम विचार नेताम", "कृषि मंत्री नेताम"],
    "dayaldas-baghel": ["दयालदास बघेल", "दयाल दास बघेल", "खाद्य मंत्री दयालदास बघेल"],
    "kedar-kashyap": ["केदार कश्यप", "केदारनाथ कश्यप", "वन मंत्री केदार कश्यप"],
    "lakhan-lal-dewangan": ["लखन लाल देवांगन", "लखनलाल देवांगन", "उद्योग मंत्री देवांगन"],
    "shyam-bihari-jaiswal": ["श्याम बिहारी जायसवाल", "स्वास्थ्य मंत्री जायसवाल", "स्वास्थ्य मंत्री श्याम बिहारी जायसवाल"],
    "op-choudhary": ["ओपी चौधरी", "ओ.पी. चौधरी", "ओमप्रकाश चौधरी", "वित्त मंत्री ओपी चौधरी"],
    "laxmi-rajwade": ["लक्ष्मी राजवाड़े", "लक्ष्मी राजवाडे", "मंत्री लक्ष्मी राजवाड़े"],
    "tank-ram-verma": ["टंकराम वर्मा", "टंक राम वर्मा", "राजस्व मंत्री टंकराम वर्मा"],
    "gajendra-yadav": ["गजेंद्र यादव", "गजेन्द्र यादव", "शिक्षा मंत्री गजेंद्र यादव"],
    "rajesh-agrawal": ["राजेश अग्रवाल", "पर्यटन मंत्री राजेश अग्रवाल"],
    "guru-khushwant-saheb": ["गुरु खुशवंत साहेब", "खुशवंत साहेब", "गुरु खुशवंत"],
    "karmveer-singh": ["कर्मवीर सिंह"],
    "yashwant-jain": ["यशवंत जैन"],
    "akhilesh-soni": ["अखिलेश सोनी"],
    "navin-markandey": ["नवीन मारकंडे", "नवीन मार्कण्डेय"],
    "smriti-irani": ["स्मृति ईरानी", "स्मृति इरानी"],
    "siddharth-shambhu": ["सिद्धार्थ शंभू", "सिद्धार्थ शम्भू"],
    "deepak-baij": ["दीपक बैज", "पीसीसी चीफ दीपक बैज", "प्रदेश कांग्रेस अध्यक्ष दीपक बैज"],
    "lakheshwar-baghel": ["लखेश्वर बघेल"],
    "umesh-patel": ["उमेश पटेल"],
    "devendra-yadav": ["देवेंद्र यादव", "देवेन्द्र यादव"],
    "kawasi-lakhma": ["कवासी लखमा", "लखमा"],
    "tuleshwar-markam": ["तुलेश्वर हीरा सिंह मरकाम", "तुलेश्वर मरकाम", "तुलेश्वर सिंह मरकाम"],
    "amit-jogi": ["अमित जोगी"],
    "renu-jogi": ["रेणु जोगी", "डॉ. रेणु जोगी"],
    "narendra-modi": ["नरेंद्र मोदी", "मोदी", "मोदी जी", "प्रधानमंत्री मोदी"],
    "amit-shah": ["अमित शाह", "गृहमंत्री अमित शाह"],
    "nitin-nabin": ["नितिन नबीन", "नितिन नवीन"],
    "mla-47-dharsiwa": ["@anujsharmacg", "anujsharmacg", "अनुज शर्मा"],
    "mla-71-pandariya": ["@bhawnabohrabjp", "bhawnabohrabjp", "भावना बोहरा"],
    "rahul-gandhi": ["राहुल गांधी"],
    "mallikarjun-kharge": ["मल्लिकार्जुन खड़गे", "खड़गे", "खरगे"],
    "sukhdeo-bhagat": ["सुखदेव भगत", "प्रभारी सुखदेव भगत"],
    "arvind-kejriwal": ["अरविंद केजरीवाल", "केजरीवाल"],
    "mayawati": ["मायावती", "बहनजी"],
    "mp-surguja": ["चिंतामणि महाराज"],
    "mp-raigarh": ["राधेश्याम राठिया"],
    "mp-janjgir-champa": ["कमलेश जांगड़े", "कमलेश जांगडे"],
    "mp-korba": ["ज्योत्सना महंत", "ज्योत्सना चरणदास महंत"],
    "mp-bilaspur": ["तोखन साहू", "केंद्रीय मंत्री तोखन साहू"],
    "mp-rajnandgaon": ["संतोष पांडेय", "संतोष पाण्डेय"],
    "mp-durg": ["विजय बघेल"],
    "mp-raipur": ["बृजमोहन अग्रवाल", "बृजमोहन", "सांसद बृजमोहन अग्रवाल"],
    "mp-mahasamund": ["रूपकुमारी चौधरी", "रूप कुमारी चौधरी"],
    "mp-bastar": ["महेश कश्यप"],
    "mp-kanker": ["भोजराज नाग"],
    "mp-rs-laxmi-verma": ["लक्ष्मी वर्मा"],
    "mp-rs-devendra-pratap-singh": ["देवेंद्र प्रताप सिंह", "राजा देवेंद्र प्रताप सिंह"],
    "mp-rs-phulo-devi-netam": ["फूलोदेवी नेताम", "फूलो देवी नेताम"],
    "mp-rs-rajeev-shukla": ["राजीव शुक्ला"],
    "mp-rs-ranjeet-ranjan": ["रंजीत रंजन"],
};

/**
 * Party-level aliases, keyed by the party id in politicalData.js.
 * Symbol names ("lotus party", "broom") are how ordinary posts often refer to a
 * party without naming it.
 */
const PARTY_ALIASES = {
    bjp: ["bjp", "bjp chhattisgarh", "chhattisgarh bjp", "cg bjp", "bjp cg", "bharatiya janata party", "bharatiya janta party", "lotus party", "saffron party", "bjp government", "bjp sarkar", "@bjp4cgstate", "@bjp4india", "#bjp", "#bjpchhattisgarh", "भाजपा", "भाजप", "बीजेपी", "भारतीय जनता पार्टी", "छत्तीसगढ़ भाजपा", "भाजपा छत्तीसगढ़", "साय सरकार", "भाजपा सरकार"],
    inc: ["congress", "indian national congress", "chhattisgarh congress", "cg congress", "inc chhattisgarh", "cgpcc", "chhattisgarh pradesh congress", "hand symbol party", "@incchhattisgarh", "@incindia", "#congress", "कांग्रेस", "काँग्रेस", "छत्तीसगढ़ कांग्रेस", "प्रदेश कांग्रेस", "भारतीय राष्ट्रीय कांग्रेस", "पीसीसी", "छत्तीसगढ़ प्रदेश कांग्रेस कमेटी"],
    ggp: ["ggp", "gondwana gantantra party", "gondwana ganatantra party", "gongpa", "गोंडवाना गणतंत्र पार्टी", "गोंगपा", "जीजीपी"],
    jccj: ["jcc(j)", "jccj", "janta congress chhattisgarh", "janata congress chhattisgarh", "jogi congress", "@officialjccj", "जनता कांग्रेस छत्तीसगढ़", "जोगी कांग्रेस", "जनता कांग्रेस छत्तीसगढ़ (जे)", "जकांछ"],
    aap: ["aap", "aap chhattisgarh", "aap party", "aam aadmi party", "broom party", "@aapchhattisgarh", "@aamaadmiparty", "#aap", "आम आदमी पार्टी", "आप पार्टी", "आम आदमी पार्टी छत्तीसगढ़"],
    bsp: ["bsp", "bahujan samaj party", "elephant party", "बहुजन समाज पार्टी", "बसपा"],
};

/**
 * Institutions that must resolve to a NAME but must never be scored as a
 * political camp. Complaints about the police are civic grievances, not
 * attacks on the opposition.
 */
const NEUTRAL_ENTITIES = {
    cg_police: {
        canonical: 'Chhattisgarh Police',
        type: 'institution',
        alignment: 'neutral',
        scope: 'state',
        priority: PRIORITY.NEUTRAL_INSTITUTION,
        aliases: ['chhattisgarh police', 'cg police', '@cg_police', '@cgpolicedept', '@cgdial112', 'dial 112', 'छत्तीसगढ़ पुलिस', 'सीजी पुलिस'],
    },
    election_commission: {
        canonical: 'Election Commission',
        type: 'institution',
        alignment: 'neutral',
        scope: 'national',
        priority: PRIORITY.NEUTRAL_INSTITUTION,
        aliases: [
            'election commission', 'eci', 'ceo chhattisgarh', 'chief electoral officer chhattisgarh',
            'state election commission', 'निर्वाचन आयोग', 'चुनाव आयोग',
        ],
    },
    cg_high_court: {
        canonical: 'High Court of Chhattisgarh',
        type: 'institution',
        alignment: 'neutral',
        scope: 'state',
        priority: PRIORITY.NEUTRAL_INSTITUTION,
        aliases: [
            'chhattisgarh high court', 'high court of chhattisgarh', 'bilaspur high court', 'cg high court',
            'हाईकोर्ट', 'उच्च न्यायालय', 'बिलासपुर हाईकोर्ट',
        ],
    },
    cg_governor: {
        canonical: 'Governor of Chhattisgarh',
        type: 'institution',
        alignment: 'neutral',
        scope: 'state',
        priority: PRIORITY.NEUTRAL_INSTITUTION,
        // Ramen Deka, in office since 31 Jul 2024.
        aliases: ['governor of chhattisgarh', 'chhattisgarh governor', 'raj bhavan raipur', 'lok bhavan raipur', 'ramen deka', '@governorcg', 'राज्यपाल', 'रमेन डेका'],
    },
    // State recruitment bodies: complaints about exams are civic grievances,
    // not attacks by or on a political camp.
    cg_psc: {
        canonical: 'Chhattisgarh Public Service Commission',
        type: 'institution',
        alignment: 'neutral',
        scope: 'state',
        priority: PRIORITY.NEUTRAL_INSTITUTION,
        aliases: ['cgpsc', '@cgpsc', 'chhattisgarh public service commission', 'छत्तीसगढ़ लोक सेवा आयोग', 'लोक सेवा आयोग'],
    },
    cg_vyapam: {
        canonical: 'Chhattisgarh Vyapam',
        type: 'institution',
        alignment: 'neutral',
        scope: 'state',
        priority: PRIORITY.NEUTRAL_INSTITUTION,
        aliases: ['cg vyapam', 'chhattisgarh vyapam', 'vyapam', '@cgvyapam', 'व्यापम', 'छत्तीसगढ़ व्यापम'],
    },
    // Civil-society movement: named so a post is recognised as in-state, but it
    // is not a political camp — the stance comes from what is said of the
    // government.
    hasdeo_movement: {
        canonical: 'Hasdeo Bachao Andolan',
        type: 'movement',
        alignment: 'neutral',
        scope: 'state',
        priority: PRIORITY.NEUTRAL_INSTITUTION,
        aliases: ['hasdeo bachao', 'save hasdeo', '#savehasdeo', '@savehasdeo', 'hasdeo arand bachao sangharsh samiti', 'alok shukla', '@alokshuklacg', 'हसदेव बचाओ', 'हसदेव अरण्य बचाओ संघर्ष समिति', 'आलोक शुक्ला'],
    },
};

/**
 * The STATE GOVERNMENT as an entity — the client's government. Departments,
 * the public-relations directorate and the government's own slogan all mean
 * "the government" in a post; without this they matched nothing, so a post
 * crediting or blaming "the government" of a department had no target.
 * Party 'bjp' so the own-party rules treat it as the ruling camp.
 */
const STATE_GOVERNMENT_ENTITY = {
    canonical: `Government of ${STATE_NAME}`,
    type: 'government',
    party: 'bjp',
    alignment: 'ally',
    scope: 'state',
    priority: PRIORITY.RULING_PARTY,
    aliases: [
        'government of chhattisgarh', 'chhattisgarh government', 'govt of chhattisgarh', 'chhattisgarh govt',
        'cg government', 'cg govt', 'chhattisgarh sarkar', 'sushasan sarkar', '#sushasansarkar', 'vishnudev sarkar',
        '@dprchhattisgarh', 'dpr chhattisgarh', '@cggovt', '@healthcggov', '@schooleducggov', '@pwdcggov',
        '@urbancgofficial', '@muncipalraipur',
        'छत्तीसगढ़ सरकार', 'छत्तीसगढ़ शासन', 'राज्य सरकार', 'प्रदेश सरकार', 'सुशासन सरकार', 'सुशासन',
        'विष्णुदेव सरकार', 'जनसंपर्क छत्तीसगढ़',
    ],
};

/* ─── helpers ───────────────────────────────────────────────────────── */

const clean = (v) => String(v || '').trim();

/** Aliases contributed automatically by a politicalData.js roster entry. */
const deriveRosterAliases = (leader) => {
    const out = [
        clean(leader.name),
        clean(leader.shortName),
        ...(leader.aliases || []).map(clean),
    ];

    for (const handle of leader.handles || []) {
        const bare = clean(handle).replace(/^@/, '');
        if (!bare) continue;
        out.push(`@${bare}`);
        out.push(bare.toLowerCase());
    }

    return out.filter(Boolean);
};

const buildLeaderEntity = (leader, { alignment, priority, scope = leader.scope || 'state' }) => ({
    canonical: leader.name,
    type: 'person',
    party: (leader.party || '').toLowerCase() || null,
    role: leader.role || null,
    constituency: leader.constituency || null,
    district: leader.district || null,
    scope,
    alignment,
    priority,
    derived: !!leader.derived,
    aliases: [
        ...new Set([
            ...deriveRosterAliases(leader),
            ...(CURATED_ALIASES[leader.id] || []),
        ]),
    ],
});

const ministerPriority = (leader) => {
    const role = (leader.role || '').toLowerCase();
    if (role.includes('chief minister') && !role.includes('deputy')) return PRIORITY.CHIEF_MINISTER;
    if (role.includes('deputy chief minister')) return PRIORITY.DEPUTY_CM;
    return PRIORITY.CABINET_MINISTER;
};

const oppositionPriority = (leader) => {
    const role = (leader.role || '').toLowerCase();
    if (role.includes('leader of opposition') || (role.includes('president') && !role.includes('working'))) {
        return PRIORITY.OPPOSITION_CHIEF;
    }
    if (role === 'mp' || role.startsWith('mp,')) return PRIORITY.MP;
    if (role === 'mla') return PRIORITY.MLA;
    return PRIORITY.OPPOSITION_SENIOR;
};

/* ─── build the entity graph ────────────────────────────────────────── */

const POLITICAL_ENTITIES = {};

const addLeaders = (leaders, opts) => {
    for (const leader of leaders) {
        if (POLITICAL_ENTITIES[leader.id]) continue;
        POLITICAL_ENTITIES[leader.id] = buildLeaderEntity(leader, {
            alignment: opts.alignment,
            priority: typeof opts.priority === 'function' ? opts.priority(leader) : opts.priority,
            ...(opts.scope ? { scope: opts.scope } : {}),
        });
    }
};

addLeaders(CABINET_MINISTERS, { alignment: 'ally', priority: ministerPriority });
addLeaders(PARTY_ORG_LEADERS, {
    alignment: 'ally',
    priority: (l) => (/state president, bjp/i.test(l.role || '') ? PRIORITY.PARTY_CHIEF : PRIORITY.OPPOSITION_SENIOR),
});
addLeaders(PRESIDING_OFFICERS, { alignment: 'ally', priority: PRIORITY.PRESIDING_OFFICER });
addLeaders(NATIONAL_ALLY_LEADERS, { alignment: 'ally', priority: PRIORITY.NATIONAL_LEADER, scope: 'national' });
addLeaders([...ALLY_MLAS, ...ALLY_MPS], {
    alignment: 'ally',
    priority: (l) => (/^mp/i.test(l.role || '') ? PRIORITY.MP : PRIORITY.MLA),
});
addLeaders(OPPOSITION_LEADERS.filter((l) => l.scope !== 'national'), { alignment: 'opposition', priority: oppositionPriority });
addLeaders(NATIONAL_OPPOSITION_LEADERS, { alignment: 'opposition', priority: PRIORITY.NATIONAL_LEADER, scope: 'national' });

/* ── parties ── */

const buildPartyEntity = (party, alignment, priority) => ({
    canonical: party.full_name || party.name,
    type: 'party',
    party: party.id,
    role: null,
    constituency: null,
    district: null,
    scope: 'state',
    alignment,
    priority,
    derived: false,
    aliases: [
        ...new Set([
            clean(party.name),
            clean(party.full_name),
            ...(party.aliases || []).map(clean),
            ...(PARTY_ALIASES[party.id] || []),
            // The party's own accounts (politicalData merges the verified registry).
            ...(party.handles || []).flatMap((h) => {
                const bare = clean(h).replace(/^@/, '');
                return bare ? [`@${bare}`, bare] : [];
            }),
        ].filter(Boolean)),
    ],
});

POLITICAL_ENTITIES[OUR_PARTY.id] = buildPartyEntity(OUR_PARTY, 'ally', PRIORITY.RULING_PARTY);

for (const party of ALLY_PARTIES) {
    POLITICAL_ENTITIES[party.id] = buildPartyEntity(party, 'ally', PRIORITY.ALLY_PARTY);
}

for (const party of OPPOSITION_PARTIES) {
    POLITICAL_ENTITIES[party.id] = buildPartyEntity(
        party,
        'opposition',
        party.id === 'inc' ? PRIORITY.OPPOSITION_PARTY : PRIORITY.OPPOSITION_SENIOR,
    );
}

/* ── neutral institutions ── */

for (const [key, ent] of Object.entries(NEUTRAL_ENTITIES)) {
    POLITICAL_ENTITIES[key] = { ...ent, derived: false };
}

/* ── the state government ── */
POLITICAL_ENTITIES.state_government = { ...STATE_GOVERNMENT_ENTITY, role: null, constituency: null, district: null, derived: false };

/* ── government schemes and flagship projects ───────────────────────
 *
 * WHY THESE ARE ENTITIES
 * A post can be squarely about this government without naming a single person
 * ("Mahtari Vandan money still not credited for three months"). Without these
 * entries Stage 2 finds ZERO entities, the stance engine has no camp to attach
 * anything to, and the post scores `unrelated` — invisible to every dashboard.
 *
 * ALIGNMENT IS `ally` BUT PRIORITY IS DELIBERATELY LOW (55).
 * A scheme belongs to the government that runs it, so criticism of the scheme
 * is criticism of the client. But a scheme must never outrank a named leader
 * when deciding `primary_target`.
 *
 * ONLY SCHEMES THIS GOVERNMENT OWNS belong here. Contested ISSUES (Hasdeo,
 * coal blocks, paddy procurement, Naxal operations) are not schemes: filing them under
 * `ally` would score every protest about them as an attack on the protesters'
 * own side. They are handled by the civic/topic lexicons instead.
 */
const GOVERNMENT_SCHEMES = {
    'scheme-mahtari-vandan': {
        canonical: 'Mahtari Vandan Yojana',
        aliases: ['mahtari vandan', 'mahatari vandan', 'mahtari vandan yojana', '#mahtarivandanyojana', 'महतारी वंदन'],
    },
    'scheme-krishak-unnati': {
        canonical: 'Krishak Unnati Yojana',
        aliases: ['krishak unnati', 'krishak unnati yojana', 'कृषक उन्नति'],
    },
    'scheme-bhumihin-krishi-mazdoor': {
        canonical: 'Deendayal Upadhyay Bhumihin Krishi Mazdoor Kalyan Yojana',
        aliases: ['bhumihin krishi mazdoor', 'bhoomihin krishi majdoor', 'landless farm labourer scheme', 'भूमिहीन कृषि मजदूर'],
    },
    'scheme-niyad-nellanar': {
        canonical: 'Niyad Nellanar',
        aliases: ['niyad nellanar', 'niyad nella nar', 'नियद नेल्लानार'],
    },
    'scheme-bastar-olympics': {
        canonical: 'Bastar Olympics',
        aliases: ['bastar olympics', 'bastar olympic', '#bastarolympics', 'बस्तर ओलंपिक'],
    },
    'scheme-sushasan-tihar': {
        canonical: 'Sushasan Tihar',
        aliases: ['sushasan tihar', '#sushasantihar2025', 'सुशासन तिहार'],
    },
    'scheme-charan-paduka': {
        canonical: 'Charan Paduka Yojana',
        aliases: ['charan paduka', 'charan paduka yojana', 'चरण पादुका'],
    },
    'scheme-ramlala-darshan': {
        canonical: 'Shri Ramlala Darshan Yojana',
        aliases: ['ramlala darshan', 'ramlala darshan yojana', 'रामलला दर्शन'],
    },
    'scheme-anjor-vision-2047': {
        canonical: 'Chhattisgarh Anjor Vision 2047',
        aliases: ['anjor vision', 'anjor vision 2047', 'viksit chhattisgarh', 'viksit chhattisgarh 2047', '#viksitchhattisgarh', 'अंजोर विजन', 'विकसित छत्तीसगढ़'],
    },
};

for (const [key, scheme] of Object.entries(GOVERNMENT_SCHEMES)) {
    POLITICAL_ENTITIES[key] = {
        canonical: scheme.canonical,
        type: 'scheme',
        party: OUR_PARTY.id,
        role: null,
        constituency: null,
        district: null,
        scope: 'state',
        alignment: 'ally',
        priority: 55,
        derived: false,
        aliases: [...new Set(scheme.aliases.map((a) => String(a).toLowerCase().trim()).filter(Boolean))],
    };
}

/* ─── alias indexes ─────────────────────────────────────────────────── */

/**
 * Minimum alias length. Anything shorter is dropped entirely — a 1-2 character
 * alias matches inside half the words in the language and would poison every
 * downstream resolution.
 */
const MIN_ALIAS_LEN = 3;

/**
 * Build alias → [entityKey, ...]. Unlike a first-writer-wins map this keeps
 * EVERY entity claiming an alias, so the resolver can tell a unique match from
 * an ambiguous one (surnames like "naik" are shared by many entities) and lower
 * its confidence accordingly.
 */
const buildAliasCandidates = () => {
    const candidates = {};

    for (const [key, ent] of Object.entries(POLITICAL_ENTITIES)) {
        for (const alias of ent.aliases || []) {
            const normalized = String(alias).toLowerCase().trim();
            if (normalized.length < MIN_ALIAS_LEN) continue;
            if (!candidates[normalized]) candidates[normalized] = [];
            if (!candidates[normalized].includes(key)) candidates[normalized].push(key);
        }
    }

    // Higher-priority entities first, so ALIAS_INDEX's "primary" answer for an
    // ambiguous alias is the most salient claimant.
    for (const keys of Object.values(candidates)) {
        keys.sort((a, b) => (POLITICAL_ENTITIES[b]?.priority || 0) - (POLITICAL_ENTITIES[a]?.priority || 0));
    }

    return candidates;
};

const ALIAS_CANDIDATES = buildAliasCandidates();

/**
 * Backward-compatible primary alias index: `[{ alias, entityKey, candidates,
 * ambiguous }]`, sorted longest-alias-first so multi-word matches win over
 * shorter substrings.
 */
const buildAliasIndex = () => {
    const entries = [];

    for (const [alias, entityKeys] of Object.entries(ALIAS_CANDIDATES)) {
        const primaryEntity = entityKeys[0];
        if (!primaryEntity) continue;
        entries.push({
            alias,
            entityKey: primaryEntity,
            candidates: [...entityKeys],
            ambiguous: entityKeys.length > 1,
        });
    }

    entries.sort((a, b) => b.alias.length - a.alias.length);
    return entries;
};

const ALIAS_INDEX = buildAliasIndex();

const resolveAliasCandidates = (alias) => {
    const normalized = String(alias || '').toLowerCase().trim();
    if (!normalized) return [];
    return (ALIAS_CANDIDATES[normalized] || []).map((key) => ({
        entityKey: key,
        entity: POLITICAL_ENTITIES[key] || null,
    }));
};

/**
 * Short ASCII aliases need a word boundary, otherwise 'bjp' matches inside
 * 'bjpsupporter' and — worse — 'inc' matches inside 'incident', 'increase',
 * 'including', and 'aap' inside 'aapka'. Non-ASCII aliases (Devanagari) are
 * exempt: those scripts do not use ASCII word characters.
 */
const SHORT_ALIAS_MAX_LEN = 4;
const isShortAsciiAlias = (alias) => alias.length <= SHORT_ALIAS_MAX_LEN && /^[a-z0-9]+$/.test(alias);

/**
 * Phrases in which an alias is NOT the politician/party. They are blanked out
 * before the alias is looked for, so the alias can still match elsewhere in
 * the same text.
 *   inc   — the company suffix ("Apple Inc.")
 *   aap   — Hindi "aap" = "you" (aap ka, aap log …)
 *   modi  — other well-known Modis
 *   raman singh — namesakes are common; kept, but only as the full name
 */
const ALIAS_BLOCKED_CONTEXTS = {
    // "Apple Inc.", "Acme, Inc", "Foo Inc Ltd": the company suffix, not the party.
    inc: /\binc\.|, ?inc\b|\binc\.? ?(ltd|limited|corp|corporation)\b/g,
    aap: /\baap (ka|ki|ke|kaise|kaisa|log|logon|bhi|se|ko|hi|sab|sabhi|kya|jaise|jaisa|apne|par|toh|to|bolo|batao|dekho|suno|sahi)\b/g,
    modi: /\b(lalit|nirav|mehul|sushil|sameer|nilesh) modi\b/g,
    'मोदी': /(ललित|नीरव|मेहुल) मोदी/g,
};

/**
 * Aliases that are also everyday words and only mean the party when written
 * in capitals: "aap" is Hindi/Hinglish for "you" ("aap doobe rahiye"), while
 * the party is written "AAP". Checked against the ORIGINAL-case text.
 */
const CASE_SENSITIVE_ALIASES = {
    aap: /(^|[^A-Za-z0-9_])AAP([^A-Za-z0-9_]|$)/,
};

const aliasOccursIn = (haystackLower, alias, rawText = null) => {
    if (!haystackLower.includes(alias)) return false;
    if (CASE_SENSITIVE_ALIASES[alias] && rawText != null) return CASE_SENSITIVE_ALIASES[alias].test(rawText);
    const blocker = ALIAS_BLOCKED_CONTEXTS[alias];
    if (blocker) {
        haystackLower = haystackLower.replace(blocker, ' ');
        if (!haystackLower.includes(alias)) return false;
    }
    if (!isShortAsciiAlias(alias)) return true;
    return new RegExp(`(?:^|[^a-z0-9_])${alias}(?:[^a-z0-9_]|$)`, 'i').test(haystackLower);
};

/**
 * Find every roster alias occurring in `text`, longest first.
 *
 * Used as a candidate generator by entityResolver — notably to resolve the
 * LLM's own (already translated) actor/target text against the FULL roster.
 *
 * This function does NOT decide the final actor or stance.
 */
const findAliasMatches = (text) => {
    const source = String(text || '').toLowerCase();
    if (!source) return [];

    const matches = [];
    for (const [alias, entityKeys] of Object.entries(ALIAS_CANDIDATES)) {
        if (!aliasOccursIn(source, alias, String(text || ''))) continue;
        matches.push({
            alias,
            entityKeys: [...entityKeys],
            ambiguous: entityKeys.length > 1,
            length: alias.length,
        });
    }

    matches.sort((a, b) => b.length - a.length);
    return matches;
};

/* ─── target universe ───────────────────────────────────────────────── */

/**
 * The "target" is the client leadership the whole sentiment pipeline is
 * measured against: the Chief Minister, and the BJP Chhattisgarh state president who
 * leads the party organisation. Every ally is still scored on the same side of
 * the matrix; these are the primary client entities for relevance and display.
 */
const PRIMARY_TARGET_KEY = 'vishnu-deo-sai';
const SECONDARY_TARGET_KEY = 'kiran-singh-deo';

const TARGET_KEYS = new Set([
    PRIMARY_TARGET_KEY,
    SECONDARY_TARGET_KEY,
]);

const isAlly = (key) => POLITICAL_ENTITIES[key]?.alignment === 'ally';
const isOpposition = (key) => POLITICAL_ENTITIES[key]?.alignment === 'opposition';
const isNeutral = (key) => POLITICAL_ENTITIES[key]?.alignment === 'neutral';
const isPrimaryTarget = (key) => TARGET_KEYS.has(key);

const TARGET_ALIASES = [...TARGET_KEYS]
    .flatMap((key) => POLITICAL_ENTITIES[key]?.aliases || [])
    .map((alias) => alias.toLowerCase());

const isNational = (key) => POLITICAL_ENTITIES[key]?.scope === 'national';
const isState = (key) => POLITICAL_ENTITIES[key]?.scope === 'state';
const getEntity = (key) => (key ? POLITICAL_ENTITIES[key] || null : null);

/**
 * Legacy entity keys used by records and UI filters written before the roster
 * used entity ids. Map them forward instead of losing the row.
 */
const LEGACY_ENTITY_KEYS = {
    bsk: PRIMARY_TARGET_KEY,
    bsk_son: SECONDARY_TARGET_KEY,
    bjp_telangana: OUR_PARTY.id, // "the client party's machinery"
    modi: 'narendra-modi',
    bjp_national: 'bjp',
};

/** Map a possibly-legacy entity key onto its current key. */
const resolveEntityKey = (key) => {
    const k = String(key || '').trim();
    if (!k) return null;
    if (POLITICAL_ENTITIES[k]) return k;
    return LEGACY_ENTITY_KEYS[k] || null;
};

module.exports = {
    POLITICAL_ENTITIES,

    // Alias lookup
    ALIAS_INDEX,
    ALIAS_CANDIDATES,
    resolveAliasCandidates,
    findAliasMatches,
    aliasOccursIn,

    PRIORITY,

    PRIMARY_TARGET_KEY,
    SECONDARY_TARGET_KEY,
    TARGET_KEYS,
    TARGET_ALIASES,

    isAlly,
    isOpposition,
    isNeutral,
    isPrimaryTarget,

    isNational,
    isState,
    getEntity,

    LEGACY_ENTITY_KEYS,
    resolveEntityKey,

    /** Legacy name for the same test, kept so older imports keep working. */
    isBskTarget: isPrimaryTarget,
};
