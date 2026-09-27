/**
 * CHHATTISGARH LOCATION DATABASE — geo detection layer.
 *
 * Built from data/state_geo.json (33 districts incl. the five created in
 * 2022, each with its common variant spellings and Hindi name; tehsils; towns
 * with Devanagari aliases; ~160 villages and localities) and
 * data/state_mlas.json (the 90 assembly constituencies).
 *
 * Everything state-specific is read from those two files, except the short
 * ANCHORS and AMBIGUOUS_NAMES lists below.
 */

const GEO = require('../data/state_geo.json');
const MLAS = require('../data/state_mlas.json');

const STATE_NAME = 'Chhattisgarh';

const lower = (s) => String(s || '').toLowerCase().trim();
const stripReserved = (s) => String(s || '').replace(/\s*\((?:sc|st)\)\s*/i, '').trim();

/**
 * Every spelling of every district → its canonical name. Posts and geo-tags
 * use "Kawardha" for Kabirdham, "GPM" for Gaurela-Pendra-Marwahi, "Dakshin
 * Bastar Dantewada", "<name> district", or the Hindi name.
 */
const DISTRICT_VARIANTS = (() => {
    const map = {};
    for (const d of GEO.districts) {
        const names = [d.name, d.hindi, ...(d.aliases || [])].filter(Boolean);
        for (const n of names) {
            map[lower(n)] = d.name;
            if (/[a-z]/i.test(n)) map[`${lower(n)} district`] = d.name;
            else map[`${lower(n)} जिला`] = d.name;
        }
    }
    return map;
})();

const DISTRICTS = Object.keys(DISTRICT_VARIANTS);

/** Normalised key (lower-case alphanumerics, Devanagari kept) of a district spelling. */
const districtKey = (v) => String(v || '').toLowerCase().replace(/[\s.\-',/()]/g, '');

/** Variant key → canonical key, e.g. "kawardha" → "kabirdham", "gpm" → "gaurelapendramarwahi". */
const DISTRICT_KEY_ALIASES = Object.fromEntries(
    Object.entries(DISTRICT_VARIANTS)
        .map(([variant, canonical]) => [districtKey(variant), districtKey(canonical)])
        .filter(([from, to]) => from !== to),
);

/** Canonical key → display name. */
const DISTRICT_DISPLAY = Object.fromEntries(GEO.districts.map((d) => [districtKey(d.name), d.name]));

/** Any district spelling → its canonical display name ('' when unknown). */
const canonicalDistrict = (v) => DISTRICT_VARIANTS[lower(v)] || DISTRICT_DISPLAY[districtKey(v)] || '';

const TALUKAS = GEO.talukas.map((t) => lower(t.name));

const CONSTITUENCIES = MLAS.map((m) => lower(stripReserved(m.constituency)));

const CITIES_AND_VILLAGES = [
    ...GEO.towns.flatMap((t) => [t.name, ...(t.aliases || [])]).map(lower),
    ...GEO.villages_and_localities.flatMap((v) => [v.name, ...(v.aliases || [])]).map(lower),
    // State references
    'chhattisgarh', 'chattisgarh', 'chhatisgarh', 'state of chhattisgarh', 'govt of chhattisgarh',
    'government of chhattisgarh', 'chhattisgarh state', 'cg',
    'छत्तीसगढ़', 'छत्तीसगढ', 'छत्तीसगढ़ राज्य',
];

const ALL_LOCATIONS = new Set();

const addToSet = (arr) => {
    for (const item of arr) {
        const l = lower(item);
        if (l) ALL_LOCATIONS.add(l);
        const clean = l.replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
        if (clean) ALL_LOCATIONS.add(clean);
    }
};

addToSet(DISTRICTS);
addToSet(TALUKAS);
addToSet(CONSTITUENCIES);
addToSet(CITIES_AND_VILLAGES);

/** Words that identify a Chhattisgarh location even inside a longer label.
 * Latin anchors must be whole words, so "Durga" does not count as Durg. Only
 * names that are unambiguous across India are anchors (Bilaspur, Bijapur and
 * Balrampur are not: they are also in Himachal, Karnataka and UP). */
const ANCHORS = ['chhattisgarh', 'chattisgarh', 'chhatisgarh', 'raipur', 'bhilai', 'durg', 'korba', 'jagdalpur',
    'ambikapur', 'rajnandgaon', 'dantewada', 'sukma', 'bastar', 'surguja', 'kanker', 'kondagaon', 'narayanpur',
    'dhamtari', 'mahasamund', 'kawardha', 'kabirdham', 'janjgir', 'mungeli', 'bemetara', 'gariaband', 'jashpur',
    'abujhmarh', 'nava raipur', 'naya raipur',
    'छत्तीसगढ़', 'रायपुर', 'भिलाई', 'दुर्ग', 'कोरबा', 'जगदलपुर', 'अंबिकापुर', 'राजनांदगांव', 'दंतेवाड़ा',
    'सुकमा', 'बस्तर', 'सरगुजा', 'कांकेर'];
const ANCHOR_RX = new RegExp(
    `(?<![a-z])(${ANCHORS.filter((a) => /[a-z]/.test(a)).join('|')})(?![a-z])`,
);
const DEVANAGARI_ANCHORS = ANCHORS.filter((a) => !/[a-z]/.test(a));
// दुर्ग is a prefix of दुर्गा (the goddess), so it only counts when not followed by a vowel sign.
const DEVANAGARI_BLOCKED = { 'दुर्ग': /दुर्ग[ािीुूेैोौंः]/g };

/** Chhattisgarh place names shared with other states or with common words
 * (Bilaspur HP, Bijapur/Vijayapura, Balrampur UP, Chandrapur MH, Rampur UP,
 * Korea). They count only when the label also names Chhattisgarh. */
const AMBIGUOUS_NAMES = new Set(['bilaspur', 'bijapur', 'balrampur', 'chandrapur', 'rampur', 'korea', 'koriya',
    'raigarh', 'narayanpur', 'surajpur', 'manpur', 'pratappur', 'sitapur', 'kota', 'patan', 'masturi', 'lormi',
    'कोरिया', 'बिलासपुर', 'बीजापुर', 'बलरामपुर']);

const hasDevanagariAnchor = (l) => DEVANAGARI_ANCHORS.some((a) => {
    const blocked = DEVANAGARI_BLOCKED[a];
    const text = blocked ? l.replace(blocked, ' ') : l;
    return text.includes(a);
});

/**
 * True when a location name belongs to Chhattisgarh. Used to keep dashboards
 * and filters to in-state places when geo-tagging also picks up other states.
 */
const isStateLocation = (name) => {
    if (!name || typeof name !== 'string') return false;
    const l = lower(name);
    const clean = l.replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!AMBIGUOUS_NAMES.has(clean) && (ALL_LOCATIONS.has(l) || ALL_LOCATIONS.has(clean))) return true;
    return ANCHOR_RX.test(l) || hasDevanagariAnchor(l);
};

/**
 * isStateLocation, plus any exact canonical seat or district name. For values
 * the pipeline itself resolved (detected_location.constituency / district):
 * those are in-state by construction, so an ambiguous-but-real name such as
 * RAIGARH, BILASPUR or PATAN must still count. Free text (search queries, raw
 * geo-tags) keeps the strict isStateLocation.
 */
const CANONICAL_SEATS = new Set(CONSTITUENCIES);
const isKnownStateLocation = (name) => {
    if (!name || typeof name !== 'string') return false;
    return isStateLocation(name)
        || CANONICAL_SEATS.has(lower(stripReserved(name)))
        || Boolean(DISTRICT_DISPLAY[districtKey(name)]);
};

const STATE_CENTROID = { lat: GEO.centroid.lat, lng: GEO.centroid.lng };
const STATE_BBOX = GEO.bbox;

module.exports = {
    STATE_NAME,
    DISTRICTS,
    DISTRICT_VARIANTS,
    DISTRICT_KEY_ALIASES,
    DISTRICT_DISPLAY,
    districtKey,
    canonicalDistrict,
    TALUKAS,
    CONSTITUENCIES,
    CITIES_AND_VILLAGES,
    ALL_LOCATIONS,
    STATE_CENTROID,
    STATE_BBOX,
    isStateLocation,
    isKnownStateLocation,
};
