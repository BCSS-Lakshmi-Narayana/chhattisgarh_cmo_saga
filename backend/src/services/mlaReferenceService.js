/**
 * mlaReferenceService
 * ─────────────────────────────────────────────────────────────────────
 * Read-only reference layer over the Chhattisgarh MLA dataset (90 assembly
 * constituencies; 2023 affidavits via ADR, current party as of Sep 2026;
 * vacant seats carry `mla: null` and `vacant: true`).
 *
 * This is the backend source of truth for MLA ↔ constituency mapping,
 * mirroring frontend/src/data/stateMLAs.js. It powers the Constituency
 * War Room intelligence endpoints (party-strategist view).
 *
 * Also exposes a lightweight, multilingual civic-issue classifier so we
 * can bucket grievance text into actionable categories (roads, water,
 * power, …) without an LLM call.
 */

const MLA_ROSTER = require('../data/state_mlas.json');
const { tokenOccurs } = require('../utils/lexiconMatch');

/* ─── constituency key normalisation (matches frontend) ───────────── */
const normalizeConstituencyKey = (name) =>
  String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // "Taleigão" → "taleigao", not "taleigo"
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]/g, '')
    .trim();

// Alternate spellings of AC names seen in GeoJSON, news and posts —
// Hindi (Devanagari) and press spellings mapped to the ECI spelling. One
// shared table: frontend/scripts/gen_state_data.js emits the same file.
const CONSTITUENCY_ALIASES = require('../data/state_constituency_aliases.json').aliases;

const MLA_BY_KEY = MLA_ROSTER.reduce((acc, m) => {
  acc[m.key || normalizeConstituencyKey(m.constituency)] = m;
  return acc;
}, {});

const getMlaByConstituency = (name) => {
  const k = normalizeConstituencyKey(name);
  return MLA_BY_KEY[k] || MLA_BY_KEY[CONSTITUENCY_ALIASES[k]] || null;
};

const getAllMlas = () => MLA_ROSTER;

/* ─── parse "Rs 14,27,05,249 ~ 14 Crore+" → numeric rupees ────────── */
const parseRupees = (raw) => {
  if (!raw) return 0;
  const m = String(raw).match(/Rs\s*([0-9,]+)/i);
  if (!m) return 0;
  return Number(m[1].replace(/,/g, '')) || 0;
};

/* ─── multilingual civic-issue lexicon ────────────────────────────── */
/* Tokens in English, Hindi and Chhattisgarhi (Devanagari + romanised), matched
 * by utils/lexiconMatch (whole words for Latin script, substrings for
 * Devanagari). Tokens must be specific enough not to hide inside unrelated words
 * (bare "ration" would match "administration"). */
const ISSUE_LEXICON = {
  roads: [
    'road', 'pothole', 'highway', 'flyover', 'bridge', 'national highway',
    'sadak', 'gaddha',
    'सड़क', 'सडक', 'गड्ढा', 'गड्ढे', 'पुल', 'पुलिया',
  ],
  water: [
    'water', 'drinking water', 'tap water', 'borewell', 'hand pump', 'pipeline', 'tanker', 'nal jal',
    'paani', 'pani',
    'पानी', 'पेयजल', 'हैंडपंप', 'नल जल',
  ],
  electricity: [
    'electricity', 'power supply', 'power cut', 'power outage', 'no current', 'transformer', 'voltage', 'smart meter',
    'bijli',
    'बिजली', 'करंट', 'ट्रांसफार्मर', 'बिजली बिल',
  ],
  drainage: [
    'drainage', 'sewage', 'sewer', 'gutter', 'manhole', 'flooding', 'waterlogging',
    'nali',
    'नाली', 'सीवर', 'जल निकासी', 'जलभराव',
  ],
  sanitation: [
    'garbage', 'sanitation', 'toilet', 'solid waste', 'waste management', 'garbage dump',
    'kachra',
    'कचरा', 'स्वच्छता', 'सफाई', 'शौचालय',
  ],
  health: [
    'hospital', 'phc', 'chc', 'ambulance', 'doctor', 'medicine', 'clinic', 'health', 'aiims', 'mekahara', 'ayushman',
    'aspatal',
    'अस्पताल', 'डॉक्टर', 'दवा', 'स्वास्थ्य', 'आयुष्मान', 'एम्बुलेंस',
  ],
  education: [
    'school', 'college', 'teacher', 'education', 'student', 'scholarship', 'fees', 'yukti yuktikaran',
    'shikshak',
    'स्कूल', 'कॉलेज', 'शिक्षा', 'शिक्षक', 'फीस', 'युक्तियुक्तकरण', 'छात्रवृत्ति',
  ],
  employment: [
    'job', 'jobs', 'employment', 'unemployment', 'salary', 'wages', 'vacancy', 'recruitment', 'cgpsc', 'vyapam',
    'naukri', 'berozgari', 'bharti',
    'नौकरी', 'रोजगार', 'बेरोजगारी', 'वेतन', 'भर्ती',
  ],
  agriculture: [
    'farmer', 'crop', 'fertilizer', 'fertiliser', 'irrigation', 'paddy', 'msp', 'dhan kharidi', 'paddy procurement',
    'tendu', 'khaad', 'kisan',
    'किसान', 'फसल', 'खाद', 'सिंचाई', 'धान', 'धान खरीदी', 'तेंदूपत्ता', 'समर्थन मूल्य',
  ],
  welfare: [
    'pension', 'ration card', 'ration shop', 'subsidy', 'scheme', 'beneficiary',
    'mahtari vandan', 'pm awas', 'krishak unnati', 'ujjwala', 'mgnrega',
    'yojana',
    'पेंशन', 'राशन', 'सब्सिडी', 'योजना', 'महतारी वंदन', 'आवास', 'मनरेगा',
  ],
  law_and_order: [
    'police', 'crime', 'theft', 'assault', 'safety', 'illegal', 'goonda', 'drugs', 'narcotic', 'ganja', 'naxal', 'maoist',
    'sand mafia', 'liquor',
    'पुलिस', 'अपराध', 'सुरक्षा', 'चोरी', 'नशा', 'गांजा', 'नक्सल', 'रेत माफिया', 'शराब',
  ],
};

const ISSUE_CATEGORIES = Object.keys(ISSUE_LEXICON);

/**
 * Classify a piece of grievance text into civic-issue categories.
 * Returns an array of matched category keys (may be empty).
 */
const classifyIssues = (text) => {
  const lower = String(text || '').toLowerCase();
  if (!lower) return [];
  const hits = [];
  for (const [category, tokens] of Object.entries(ISSUE_LEXICON)) {
    if (tokens.some((t) => tokenOccurs(lower, t))) hits.push(category);
  }
  return hits;
};

/** Roster key for any spelling of an AC name (alias-aware), or null. */
const resolveConstituencyKey = (name) => {
  const m = getMlaByConstituency(name);
  return m ? (m.key || normalizeConstituencyKey(m.constituency)) : null;
};

module.exports = {
  MLA_ROSTER,
  resolveConstituencyKey,
  ISSUE_CATEGORIES,
  normalizeConstituencyKey,
  getMlaByConstituency,
  getAllMlas,
  parseRupees,
  classifyIssues,
  ISSUE_LEXICON,
};
