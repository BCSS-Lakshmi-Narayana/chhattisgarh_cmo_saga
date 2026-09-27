/**
 * politicalContextService.js
 * ─────────────────────────────────────────────────────────────────────
 * Stage 2 of the target-aware sentiment pipeline.
 *
 * Pure-JS, deterministic, NO LLM call. Given a piece of social-media text this
 * service produces a structured snapshot of which political entities are
 * mentioned, who the primary target is, who is POSTING, and how the content
 * relates to the client leadership (CM Vishnu Deo Sai / the BJP government of Chhattisgarh).
 *
 * The downstream `politicalSentimentService` injects this snapshot into its LLM
 * prompt so the model reasons about sentiment RELATIVE TO THE CLIENT rather
 * than performing generic positive/negative classification, and
 * `stanceEngine` consumes it to resolve the final stance deterministically.
 *
 *   buildPoliticalContext(text, { taggedKeyword, authorHandle, platform })
 *     → {
 *         mentioned_entities: [{ key, canonical, alignment, ... }],
 *         primary_target,             // entity key with highest priority
 *         primary_target_alignment,   // 'ally' | 'opposition' | 'neutral' | null
 *         target_relevance,           // 0..1 (deterministic heuristic)
 *         mode,                       // 'about_target' | 'about_opposition'
 *                                     // | 'general_politics' | 'civic_grievance'
 *                                     // | 'irrelevant'
 *         has_target_mention, has_opposition_mention, has_ally_mention,
 *         author_entity_key, author_entity_canonical, author_alignment,
 *         language_hints: { has_devanagari, has_hindi, has_chhattisgarhi, has_chhattisgarhi_roman, has_hinglish, ... },
 *         summary,                    // human-readable one-liner for the prompt
 *       }
 *
 * BACKWARD COMPATIBILITY: the legacy `bsk_*` field names are still emitted as
 * exact mirrors of their `target_*` replacements, because stored records and a
 * few older readers still use them. They are written from the SAME value in the
 * SAME statement, so they can never diverge — do not compute either separately.
 */

const {
    POLITICAL_ENTITIES,
    ALIAS_INDEX,
    TARGET_ALIASES,
    aliasOccursIn,
    resolveAliasCandidates,
    isAlly,
    isOpposition,
    isPrimaryTarget,
} = require('../config/politicalEntities');
const { tokenOccurs } = require('../utils/lexiconMatch');
// Compound-hashtag segmentation + the curated direction-bearing tags.
const { segmentHashtags, findStanceHashtags } = require('../config/hashtagSignals');

/* ─── language / script detection ──────────────────────────────────── */

const DEVANAGARI_RX = /[ऀ-ॿ]/;
const TAMIL_RX = /[஀-௿]/;
const KANNADA_RX = /[ಀ-೿]/;
const URDU_ARABIC_RX = /[؀-ۿ]/;

/**
 * Hindi and Chhattisgarhi both use Devanagari, so the script alone cannot tell
 * them apart. High-frequency function words can: the copula (है / हवय, हावय),
 * the negation (नहीं / नइ), the possessive (हमारा / हमर, मोर, तोर) and the
 * object marker (को / ला) differ. A language is reported only with ≥2
 * whole-token hits and more hits than the other; otherwise only
 * `has_devanagari` is set.
 */
const DEVANAGARI_MARKERS = {
    chhattisgarhi: new Set(['हवय', 'हावय', 'हावे', 'हवे', 'नइ', 'नई', 'नइहे', 'नइए', 'हमर', 'हमन', 'तुमन', 'तुंहर', 'मोर', 'तोर', 'ओकर', 'ओमन', 'काबर', 'कइसे', 'कहाँ', 'रिहिस', 'रहिस', 'जाथे', 'करथे', 'होथे', 'होही', 'अउ', 'फेर', 'बर', 'संग', 'सबले', 'बढ़िया', 'गोठ', 'गोठियाथे', 'छत्तीसगढ़िया', 'भइया', 'दाई']),
    hindi: new Set(['है', 'हैं', 'नहीं', 'मैं', 'आप', 'हम', 'और', 'लेकिन', 'क्या', 'क्यों', 'कब', 'चाहिए', 'था', 'थे', 'को', 'में', 'से', 'यह', 'वह', 'भी', 'कुछ', 'बहुत', 'गया', 'रहा', 'हमारा', 'हमारी', 'उनका', 'किया']),
};

/** Chhattisgarhi written in Roman script — English-looking text that is not English. */
const CHHATTISGARHI_ROMAN_MARKERS = new Set(['hawe', 'hawaye', 'havay', 'hamar', 'hamman', 'tuman', 'tumhar', 'mor', 'tor', 'okar', 'kabar', 'kaise', 'rihis', 'rahis', 'jathe', 'karthe', 'hothe', 'hohi', 'au', 'bar', 'sang', 'sable', 'badhiya', 'goth', 'chhattisgarhiya', 'bhaiya', 'dai', 'nai']);

/** Hindi written in Roman script (Hinglish). */
const HINGLISH_MARKERS = new Set(['hai', 'hain', 'nahi', 'nahin', 'kya', 'kyun', 'kyon', 'aur', 'lekin', 'bhi', 'yeh', 'ye', 'woh', 'wo', 'hum', 'humara', 'hamara', 'aap', 'sarkar', 'kaha', 'kab', 'kuch', 'bahut', 'gaya', 'raha', 'karo', 'karna', 'chahiye', 'jai', 'bhaiyon', 'behno']);

const countMarkers = (tokens, markers) => tokens.reduce((n, t) => n + (markers.has(t) ? 1 : 0), 0);

const detectDevanagariLanguage = (text) => {
    const tokens = String(text).split(/[^\p{L}\p{M}]+/u).filter(Boolean);
    const scores = Object.entries(DEVANAGARI_MARKERS)
        .map(([lang, markers]) => [lang, countMarkers(tokens, markers)])
        .sort((a, b) => b[1] - a[1]);
    const [best, second] = scores;
    if (best[1] >= 2 && best[1] > second[1]) return best[0];
    return null;
};

const detectLanguageHints = (text) => {
    const hasDevanagari = DEVANAGARI_RX.test(text);
    const deva = hasDevanagari ? detectDevanagariLanguage(text) : null;
    const latinTokens = String(text).toLowerCase().split(/[^a-z]+/).filter(Boolean);
    const cgRoman = countMarkers(latinTokens, CHHATTISGARHI_ROMAN_MARKERS);
    const hinglish = countMarkers(latinTokens, HINGLISH_MARKERS);
    return {
        has_devanagari: hasDevanagari,
        has_chhattisgarhi: deva === 'chhattisgarhi',
        has_hindi: deva === 'hindi',
        has_chhattisgarhi_roman: cgRoman >= 2 && cgRoman >= hinglish,
        has_hinglish: hinglish >= 2 && hinglish > cgRoman,
        has_tamil: TAMIL_RX.test(text),
        has_kannada: KANNADA_RX.test(text),
        has_urdu: URDU_ARABIC_RX.test(text),
        has_latin: /[a-z]/i.test(text),
    };
};

/* ─── civic-grievance lexicon (multilingual, Chhattisgarh-tuned) ───── */

/**
 * A civic-grievance signal is what lets a service-failure complaint with NO
 * named politician still be scored against the ruling government. Coverage of
 * the local languages and of CURRENT scheme names is what makes that work —
 * a complaint about "Mahtari Vandan" that this list does not recognise silently
 * drops to `irrelevant`.
 *
 * Matching is by SUBSTRING, so every token here must be long or specific
 * enough not to hide inside unrelated words (bare "ration" would match
 * "administration"; bare "road" would match "abroad").
 */
const CIVIC_GRIEVANCE_TOKENS = [
    // English — services
    'pothole', 'power cut', 'power outage', 'no current', 'electricity', 'water supply',
    'water tanker', 'water shortage', 'no water', 'road repair', 'bad road',
    'street light', 'sanitation', 'garbage', 'drainage', 'sewage',
    'ration card', 'ration shop', 'pension', 'school fee', 'hospital', 'ambulance',
    'farmer', 'crop loss', 'unemployment', 'salary not paid',
    'drinking water', 'irrigation', 'flood', 'stray cattle', 'stray dog',
    'noise pollution', 'drugs', 'narcotic', 'fertiliser shortage', 'fertilizer shortage',
    'paddy procurement', 'paddy not purchased', 'token not issued', 'msp not paid',
    'electricity bill', 'smart meter', 'teacher shortage', 'no teacher',
    // Law and order — the JUDGEMENT phrases only, never bare 'crime' or
    // 'murder': a routine crime report is news, not a complaint about the
    // government. These phrases are how the failure is actually voiced.
    'law and order', 'law & order', 'lawlessness', 'no fear of law', 'crime capital',
    // English / Hinglish — Chhattisgarh government scheme names
    'mahtari vandan', 'mahatari vandan', 'krishak unnati', 'dhan kharidi', 'pm awas', 'pradhan mantri awas',
    'ayushman card', 'shaheed veer narayan singh ayushman', 'ration card', 'tendu patta', 'charan paduka',
    'deendayal upadhyay bhumihin', 'bhoomiheen krishi majdoor', 'ramlala darshan', 'niyad nellanar',
    'jal jeevan mission', 'nal jal', 'mgnrega', 'manrega',
    // Hinglish (romanised Hindi / Chhattisgarhi)
    'bijli nahi', 'paani nahi', 'pani nahi', 'sadak kharab', 'road kharab', 'gaddha',
    'rashan nahi', 'pension nahi', 'khaad nahi', 'dhan nahi bika',
    // Hindi / Chhattisgarhi (Devanagari)
    'बिजली', 'पानी', 'पेयजल', 'खराब सड़क', 'सड़क खराब', 'जर्जर सड़क', 'सड़क की हालत', 'बदहाल सड़क', 'सड़क निर्माण', 'गड्ढा', 'गड्ढे', 'राशन', 'पेंशन', 'किसान', 'अस्पताल',
    'एम्बुलेंस', 'स्कूल फीस', 'शिक्षक', 'नाली', 'सीवर', 'कचरा', 'बेरोजगारी', 'बाढ़', 'सिंचाई',
    'खाद', 'यूरिया', 'धान खरीदी', 'टोकन', 'समर्थन मूल्य', 'तेंदूपत्ता', 'महतारी वंदन',
    'प्रधानमंत्री आवास', 'पीएम आवास', 'आयुष्मान', 'नल जल', 'मनरेगा', 'बिजली बिल', 'स्मार्ट मीटर',
    'मवेशी', 'आवारा', 'नशा', 'गांजा',
    'कानून व्यवस्था', 'कानून-व्यवस्था', 'लचर कानून', 'कानून का डर', 'अपराध का गढ़', 'अपराधगढ़',
];

/**
 * A road / rail accident report mentions roads and hospitals, but it is news,
 * not a service-failure complaint against the government — unless the post
 * blames the administration (negligence, potholes, compensation not paid).
 */
const ACCIDENT_RX = /accident|mishap|collision|\bcrash|हादसा|हादसे|दुर्घटना|अपघात|टक्कर/i;
const ADMIN_BLAME_RX = /negligen|administration|government|govt|sarkar|pothole|compensation|लापरवाही|प्रशासन|सरकार|गड्ढ|खड्ड|जर्जर|बदहाल|मुआवज/i;

const { hasStateSignal } = require('../utils/stateSignal');

const CEREMONIAL_RX = /(श्रद्धांजलि|श्रद्धा सुमन|जयंती|पुण्यतिथि|पुण्य तिथि|बलिदान दिवस|शहादत दिवस|शोक संवेदना|निधन|tribute|condolence|birth anniversary|death anniversary|jayanti|punyatithi|homage|rest in peace|\brip\b)/i;

const containsCivicSignal = (lowerText) => {
    if (ACCIDENT_RX.test(lowerText) && !ADMIN_BLAME_RX.test(lowerText)) return false;
    return CIVIC_GRIEVANCE_TOKENS.some((token) => tokenOccurs(lowerText, token));
};

/* ─── entity scan ──────────────────────────────────────────────────── */

/**
 * Walk the sorted alias index once and collect every match. Multiple
 * occurrences of the same entity count once. Returns entity keys in order of
 * first appearance plus a per-entity match metadata bag.
 */
/** The roster entity whose handle is exactly `handle`, or null. */
const resolveAuthorEntity = (handle) => {
    const bare = String(handle || '').trim().replace(/^@+/, '').toLowerCase();
    if (!bare) return null;
    const keys = [...new Set(
        [...resolveAliasCandidates(`@${bare}`), ...resolveAliasCandidates(bare)].map((c) => c.entityKey),
    )];
    if (keys.length !== 1) return null;
    const ent = POLITICAL_ENTITIES[keys[0]];
    if (!ent) return null;
    return {
        key: keys[0],
        canonical: ent.canonical,
        alignment: ent.alignment,
        party: ent.party,
        type: ent.type,
        role: ent.role || null,
        priority: ent.priority,
        matched_alias: `@${bare}`,
    };
};

const findMentionedEntities = (text) => {
    const raw = String(text || '');
    const lower = ` ${raw.toLowerCase()} `; // pad for boundary detection
    const seen = new Map();

    for (const { alias, entityKey } of ALIAS_INDEX) {
        if (seen.has(entityKey)) continue;
        // Shared with entityResolver: word boundaries for short ASCII aliases
        // ('bjp' not inside 'bjpsupporter') and blocked contexts ("aap ka",
        // "Lalit Modi", "Rajdeep Sardesai").
        if (!aliasOccursIn(lower, alias, raw)) continue;

        const ent = POLITICAL_ENTITIES[entityKey];
        if (!ent) continue;

        seen.set(entityKey, {
            key: entityKey,
            canonical: ent.canonical,
            alignment: ent.alignment,
            party: ent.party,
            type: ent.type,
            role: ent.role || null,
            priority: ent.priority,
            matched_alias: alias,
        });
    }

    return [...seen.values()];
};

/* ─── relevance score & mode ───────────────────────────────────────── */

const computeTargetRelevance = (mentions, taggedKeyword) => {
    const tagged = String(taggedKeyword || '').toLowerCase();

    const hasTarget = mentions.some((m) => isPrimaryTarget(m.key));
    const hasAlly = mentions.some((m) => isAlly(m.key));
    const hasOpposition = mentions.some((m) => isOpposition(m.key));

    // Direct mention of the CM / party state president → maximum relevance.
    if (hasTarget) return 1.0;

    // Tagged-keyword bootstrap: the fetcher saved the keyword that pulled this
    // post; if the keyword itself was a target alias, treat as high.
    if (tagged && TARGET_ALIASES.some((a) => tagged.includes(a))) return 0.9;

    if (hasOpposition && hasAlly) return 0.8;
    if (hasOpposition) return 0.55; // opposition-only — often relevant indirectly
    if (hasAlly) return 0.5;
    return 0.1;
};

const decideMode = ({ mentions, targetRelevance, hasCivic }) => {
    const hasTarget = mentions.some((m) => isPrimaryTarget(m.key));
    const hasAlly = mentions.some((m) => isAlly(m.key));
    const hasOpposition = mentions.some((m) => isOpposition(m.key));

    if (hasTarget && hasCivic) return 'civic_grievance';
    if (hasTarget) return 'about_target';
    if (hasOpposition && hasAlly) return 'about_target';   // comparative
    if (hasOpposition) return 'about_opposition';
    if (hasAlly) return 'about_target';                    // an ally reflects on this government
    if (hasCivic) return 'civic_grievance';
    if (targetRelevance < 0.2) return 'irrelevant';
    return 'general_politics';
};

/* ─── primary target selection ─────────────────────────────────────── */

const pickPrimaryTarget = (mentions) => {
    if (mentions.length === 0) return null;

    // 1. The CM / party state president always wins if present.
    const targetHit = mentions.find((m) => isPrimaryTarget(m.key));
    if (targetHit) return targetHit;

    // 2. Otherwise pick the highest-priority entity.
    return mentions.slice().sort((a, b) => b.priority - a.priority)[0];
};

/* ─── public API ───────────────────────────────────────────────────── */

const buildPoliticalContext = (text, { taggedKeyword = '', authorHandle = '', platform = '' } = {}) => {
    const raw = String(text || '');
    const lower = raw.toLowerCase();

    /**
     * Entity scan over the post body, then a SECOND pass over compound hashtags
     * split on their case boundaries.
     *
     * The plain scan is a substring match, so most hashtags already resolve
     * (`#CongressChhattisgarh` contains "congress"). What it misses is a SHORT alias glued to
     * a preceding word: aliases of ≤4 characters require a non-word boundary, so
     * the "bjp" in `#CGRejectsBJP` is preceded by "s" and never matches. Segmenting
     * to "CG Rejects BJP" restores the boundary.
     *
     * ADDITIVE BY CONSTRUCTION — `seen` is keyed on entity key, so the second
     * pass can only introduce entities the first pass missed. It can never
     * change or displace what the body text already resolved, which is what
     * keeps hashtags weaker evidence than the sentence.
     */
    const mentions = findMentionedEntities(raw);
    const segmented = segmentHashtags(raw);
    if (segmented) {
        const known = new Set(mentions.map((m) => m.key));
        for (const extra of findMentionedEntities(segmented)) {
            if (known.has(extra.key)) continue;
            known.add(extra.key);
            mentions.push({ ...extra, from_hashtag: true });
        }
    }

    /**
     * Curated hashtags that carry a DIRECTION rather than just a name
     * (`#SaveHasdeo` is an attack on the government; the roster alone only knows
     * he is mentioned).
     *
     * ADVISORY ONLY. Recorded on the context and surfaced in the Stage 3 prompt,
     * never fed into the stance matrix — a hashtag must not overrule the
     * sentence. Treat it as a hint the model may use, and as a signal a reviewer
     * can see.
     */
    const stanceHashtags = findStanceHashtags(raw);

    /**
     * Who is POSTING, resolved against the same roster as the post body.
     *
     * This is a DIFFERENT question from "who is mentioned": it lets the stance
     * engine tell a speaker apart from the entity they are talking about. A
     * Congress handle posting a critical demand is criticising someone else, not
     * itself — without this signal the engine can mistake the loudest mentioned
     * party for the thing being criticised.
     *
     * Resolves only for accounts actually in the roster (party handles, leaders,
     * official accounts). Ordinary citizen and parody accounts return null,
     * which every consumer MUST treat as "unknown" — never as "neutral".
     */
    // Exact handle match only: a substring scan would make @babush_fan_club
    // Babush Monserrate and @sardesairajdeep Vijai Sardesai.
    const authorEntity = resolveAuthorEntity(authorHandle);

    const hasCivic = containsCivicSignal(lower);
    // Tributes, condolences, anniversaries: praise there is courtesy, not a
    // political position (see the ceremonial guard in politicalSentimentService).
    const ceremonial = CEREMONIAL_RX.test(raw);
    const hasStateContext = hasStateSignal(`${raw} ${taggedKeyword || ''}`, mentions);
    const targetRelevance = computeTargetRelevance(mentions, taggedKeyword);
    const primary = pickPrimaryTarget(mentions);
    const mode = decideMode({ mentions, targetRelevance, hasCivic });
    const languageHints = detectLanguageHints(raw);

    const hasTarget = mentions.some((m) => isPrimaryTarget(m.key));
    const hasAlly = mentions.some((m) => isAlly(m.key));
    const hasOpposition = mentions.some((m) => isOpposition(m.key));

    const summaryParts = [];
    if (hasTarget) summaryParts.push('mentions the CM / party state president directly');
    if (hasAlly && !hasTarget) summaryParts.push('mentions a ruling-camp leader, party or scheme');
    if (hasOpposition) summaryParts.push('mentions opposition');
    if (hasCivic) summaryParts.push('contains civic grievance signal');
    if (summaryParts.length === 0) summaryParts.push('no clear political target detected');

    return {
        mentioned_entities: mentions,
        primary_target: primary?.key || null,
        primary_target_canonical: primary?.canonical || null,
        primary_target_alignment: primary?.alignment || null,

        has_target_mention: hasTarget,
        has_ally_mention: hasAlly,
        has_opposition_mention: hasOpposition,
        has_civic_signal: hasCivic,
        ceremonial,
        // false ⇒ the post is not about this state at all (no state name,
        // place or in-state roster entity) and can only be `unrelated`.
        has_state_signal: hasStateContext
            // Writing in the state's own language is itself in-state.
            || !!(languageHints.has_chhattisgarhi || languageHints.has_chhattisgarhi_roman
                || languageHints.has_konkani || languageHints.has_konkani_romi),
        target_relevance: targetRelevance,

        // ── Legacy mirrors. Same value, same statement — never computed
        //    separately, so they cannot drift from the fields above.
        has_bsk_mention: hasTarget,
        bsk_relevance: targetRelevance,

        mode,
        language_hints: languageHints,
        tagged_keyword: taggedKeyword || null,

        author_handle: authorHandle || null,
        // null for any account not in the roster — consumers must treat that as
        // "unknown", never as "neutral".
        author_entity_key: authorEntity?.key || null,
        author_entity_canonical: authorEntity?.canonical || null,
        author_alignment: authorEntity?.alignment || null,
        author_party: authorEntity?.party ? String(authorEntity.party).toLowerCase() : null,

        platform: platform || null,
        /**
         * Curated direction-bearing hashtags found in the post, e.g.
         * `[{ tag: 'SaveHasdeo', target: 'bjp', direction: 'attack' }]`.
         *
         * Advisory. Consumers may use it as a hint; nothing may treat it as
         * outranking the body text, and the stance matrix does not read it.
         */
        stance_hashtags: stanceHashtags,
        summary: summaryParts.join('; '),
    };
};

module.exports = {
    buildPoliticalContext,
    findMentionedEntities,
    detectLanguageHints,
    containsCivicSignal,
    computeTargetRelevance,
    CIVIC_GRIEVANCE_TOKENS,
};
