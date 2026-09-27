/**
 * Chhattisgarh Political Watch — branding and media catalogue for the client:
 * the BJP government of Chhattisgarh (CM Vishnu Deo Sai; BJP Chhattisgarh
 * president Kiran Singh Deo).
 *
 * Remote images use Wikipedia's stable Special:FilePath redirect (always the
 * current version of a Commons file; every file name below was checked to
 * resolve). The leadership portraits are official GODL-India images. If one
 * fails to load, the image helper falls back to a copy shipped in /public, so
 * the UI never breaks.
 *
 * Re-branding for another client means editing this file, public/index.html,
 * and the data files in src/data — no page code needs to change.
 */

const wiki = (filename) =>
  `https://en.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}`;

/* ─── App / client identity ─────────────────────────────────────── */
export const BRAND = {
  appName: 'Chhattisgarh Political Watch',
  appShortName: 'CG WATCH',
  tagline: 'Social Media Intelligence for BJP Chhattisgarh',
  partyName: 'Bharatiya Janata Party',
  partyShort: 'BJP',
  partyUnit: 'BJP Chhattisgarh',
  stateName: 'Chhattisgarh',
  leaderName: 'Vishnu Deo Sai',
  leaderTitle: 'Chief Minister of Chhattisgarh',
  constituencyCount: 90,
  lokSabhaCount: 11,
};

/* ─── Portraits of the client leadership ─────────────────────────── */
// No freely licensed photo of state president Kiran Singh Deo exists on
// Commons, so the second portrait is Deputy Chief Minister Arun Sao.
export const PARTY_PORTRAITS = [
  {
    id: 'portrait-primary',
    src: wiki('Vishnu_Deo_Sai,_Chief_Minister_of_Chhattisgarh.jpg'),
    alt: 'Vishnu Deo Sai — Chief Minister of Chhattisgarh',
    caption: 'Chief Minister · Chhattisgarh',
  },
  {
    id: 'portrait-deputy-cm',
    src: wiki('Arun_Sao_BJP.jpg'),
    alt: 'Arun Sao — Deputy Chief Minister of Chhattisgarh',
    caption: 'Deputy Chief Minister · Chhattisgarh',
  },
];

/* The "hero" image used across the app (login, header, dashboard avatar). */
export const PARTY_HERO = PARTY_PORTRAITS[0];

/* ─── Chhattisgarh imagery ──────────────────────────────────────── */
export const STATE_GALLERY = [
  {
    id: 'cg-chitrakote',
    src: wiki('Chitrakot_waterfalls.JPG'),
    alt: 'Chitrakote Falls on the Indravati river',
    caption: 'Chitrakote Falls · Bastar',
  },
  {
    id: 'cg-bhoramdeo',
    src: wiki('Bhoramdeo_Temple,_Kawardha.jpg'),
    alt: 'Bhoramdeo Temple',
    caption: 'Bhoramdeo Temple · Kabirdham',
  },
  {
    id: 'cg-rajim',
    src: wiki('6th_to_7th_century_Rajivalochan_Vishnu_Temple,_Rajim,_Chhattisgarh_-_58.jpg'),
    alt: 'Rajivalochan Temple, Rajim',
    caption: 'Rajivalochan Temple · Rajim',
  },
  {
    id: 'cg-nava-raipur',
    src: wiki('Naya_Raipur,_Sector_19.png'),
    alt: 'Nava Raipur Atal Nagar, the state capital',
    caption: 'Nava Raipur Atal Nagar · Raipur',
  },
];

/* ─── Party visual marks ─────────────────────────────────────────── */
export const PARTY_MARK = {
  flag: wiki('Bharatiya_Janata_Party_Flag.jpg'),
  logo: wiki('Logo_of_the_Bharatiya_Janata_Party.svg'),
};

/* ─── Local fallback served from /public ─────────────────────────── */
export const LOCAL_FALLBACK = '/cm-portrait.jpg';
export const LOCAL_LOGO = '/party-logo.png';

/* ─── Key constituencies for the client ──────────────────────────── */
export const KEY_CONSTITUENCIES = [
  { name: 'Kunkuri',           district: 'Jashpur' },      // CM Vishnu Deo Sai
  { name: 'Lormi',             district: 'Mungeli' },      // Deputy CM Arun Sao
  { name: 'Kawardha',          district: 'Kabirdham' },    // Deputy CM Vijay Sharma
  { name: 'Rajnandgaon',       district: 'Rajnandgaon' },  // Speaker Dr. Raman Singh
  { name: 'Raipur City South', district: 'Raipur' },       // state capital
  { name: 'Jagdalpur',         district: 'Bastar' },       // BJP state president Kiran Singh Deo
  { name: 'Patan',             district: 'Durg' },         // former CM Bhupesh Baghel (INC)
];

/* ─── Talking points the government champions (AI summary / dashboard) */
export const FOCUS_TOPICS = [
  'Vishnu ka Sushasan (good governance)',
  'Mahtari Vandan Yojana',
  'Paddy procurement at Rs 3,100 (Krishak Unnati)',
  'Naxal-free Chhattisgarh & Bastar development',
  'Niyad Nellanar',
  'Bastar Olympics',
  'PM Awas & welfare delivery',
  'Chhattisgarh Anjor Vision 2047',
  'Industry, mining & investment',
  'Jobs & recruitment',
];
