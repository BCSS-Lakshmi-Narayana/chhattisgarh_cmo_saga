/**
 * Deployment profile — the state-specific facts every LLM prompt and log line
 * needs, in one place. Who is in which camp lives in politicalData.js; this file
 * only phrases it. Re-deploying for another state means editing politicalData.js,
 * the location/data files, and the constants at the top of this file.
 */

const { OUR_PARTY, ALLY_PARTIES, OPPOSITION_PARTIES, CABINET_MINISTERS } = require('./politicalData');

const APP_NAME = 'Chhattisgarh Political Watch';
const STATE_NAME = 'Chhattisgarh';
const COUNTRY = 'India';
/** The state's name in Devanagari, as local posts write it. */
const STATE_NAME_NATIVE = 'छत्तीसगढ़';

/** How posts in this state are written — fed to prompts that read raw text. */
const LANGUAGES_DESCRIPTION =
    'Hindi (Devanagari), often mixed with Chhattisgarhi (also Devanagari, e.g. "हमर", "तुमन", "होही", "छत्तीसगढ़िया सबले बढ़िया"), ' +
    'romanised Hindi/Hinglish (e.g. "Sai sarkar", "dhan kharidi"), English from officials and national media, and in Bastar ' +
    'occasional Halbi and Gondi words inside Hindi posts';

const CHIEF_MINISTER = CABINET_MINISTERS.find((l) => /chief minister/i.test(l.role || '') && !/deputy/i.test(l.role || ''));

const CLIENT_DESCRIPTION =
    `the ${OUR_PARTY.name} government of ${STATE_NAME}` +
    (CHIEF_MINISTER ? ` led by Chief Minister ${CHIEF_MINISTER.name}` : '');

const partyLabel = (p) => {
    const aka = (p.aliases || []).filter((a) => a !== p.name && a !== p.full_name).slice(0, 2).join('/');
    return `${p.name}${aka ? ` (${aka})` : ''}`;
};

const namedLeaders = (leaders, n) => (leaders || [])
    .filter((l) => !l.derived)
    .map((l) => l.shortName || l.name)
    .slice(0, n);

/** "BJP (Lotus party)" plus any allies — the governing camp in one line. */
const OUR_CAMP_SUMMARY = [
    partyLabel(OUR_PARTY),
    ...ALLY_PARTIES.map(partyLabel),
].join(', ');

/** Leaders of the governing camp most often named in posts. */
const OUR_CAMP_LEADERS = namedLeaders(CABINET_MINISTERS, 6);

/** "INC (Congress) — Charan Das Mahant, ...; GGP — ..." */
const OPPOSITION_SUMMARY = OPPOSITION_PARTIES
    .map((p) => {
        const leaders = namedLeaders(p.leaders, 3).join(', ');
        return `${partyLabel(p)}${leaders ? ` — ${leaders}` : ''}`;
    })
    .join('; ');

module.exports = {
    APP_NAME,
    STATE_NAME,
    STATE_NAME_NATIVE,
    COUNTRY,
    LANGUAGES_DESCRIPTION,
    CHIEF_MINISTER,
    CLIENT_DESCRIPTION,
    OUR_CAMP_SUMMARY,
    OUR_CAMP_LEADERS,
    OPPOSITION_SUMMARY,
};
