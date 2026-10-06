/**
 * mhPromptProfile — the Maharashtra facts the Stage 3 extraction prompt needs.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * politicalSentimentService.buildPrompt phrased the whole task in
 * Chhattisgarh terms: the state, the languages, the "political map" of who is
 * governing and who is opposing, and the worked examples ("the Sai
 * government", "Baghel"). For a Maharashtra post that told the model it was
 * reading Chhattisgarh politics, named the wrong government, and listed
 * parties that do not govern here — which degrades exactly the two fields the
 * leader report depends on: `sentiment_target` and `target_tone`.
 *
 * Everything here is read from the Maharashtra roster, not typed in a second
 * time, so the prompt cannot drift from the entities the pipeline resolves.
 * The host deployment's prompt is not built here and does not change.
 */
const MH = require('../data/mh_leaders.json');
const roster = require('./mhPoliticalEntities');

const E = roster.MH_ENTITIES;
const people = Object.values(E).filter((e) => e.type === 'person');

/** Names under a party label, e.g. "Shiv Sena (UBT) — Uddhav Thackeray, Aaditya Thackeray". */
const byParty = (alignment) => {
    const groups = new Map();
    for (const p of people) {
        if (p.alignment !== alignment || p.scope === 'national') continue;
        const label = (p.party && E[p.party] && E[p.party].canonical) || 'independent';
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(p.canonical);
    }
    return [...groups.entries()].map(([label, names]) => `${label} — ${names.join(', ')}`).join('; ');
};

const partiesOf = (alignment) => Object.values(E)
    .filter((e) => e.type === 'party' && e.alignment === alignment)
    .map((e) => e.canonical);

const chief = E[roster.MH_PRIMARY_TARGET_KEY];
const deputies = MH.leaders
    .filter((l) => /deputy chief minister/i.test(l.role || ''))
    .map((l) => l.name);

const map = [
    `  Governing alliance (Mahayuti) : ${partiesOf('ally').filter((p) => p !== 'Mahayuti').join('; ')}`,
    `  Leadership               : ${chief ? chief.canonical : 'the Chief Minister'} (Chief Minister)`
        + `${deputies.length ? `, ${deputies.join(', ')} (Deputy Chief Minister)` : ''}`,
    `  Governing-side people    : ${byParty('ally')}`,
    `  Opposition (Maha Vikas Aghadi and allies): ${partiesOf('opposition').filter((p) => p !== 'Maha Vikas Aghadi').join('; ')}`,
    `  Opposition people        : ${byParty('opposition')}`,
    '  Note: bare "Shiv Sena" and bare "NCP" mean the factions now in government; the opposition halves are "Shiv Sena (UBT)" and "NCP (SP)".',
].join('\n');

const CM = chief ? chief.canonical : 'the Chief Minister';

module.exports = {
    state: 'Maharashtra',
    country: 'India',
    languages: 'Marathi (Devanagari), Hindi (Devanagari), romanised Marathi/Hinglish '
        + '(e.g. "Fadnavis sarkar", "ladki bahin", "karjmafi"), and English from officials and national media',
    map,
    targetExamples: `  • "Congress demands the ${CM} government keep its promises" → sentiment_target is the ${CM} government (the one being demanded of), NOT Congress (the speaker).
  • "A Shinde Sena worker thanked ${CM} for the decision" → sentiment_target is ${CM} (the one thanked), NOT the worker.
  • "Congress misled the farmers of Maharashtra, says a citizen" → sentiment_target is Congress (the one accused).`,
    pairExample: `      → "Aaditya Thackeray gave a brilliant speech and exposed the government" ⇒ EITHER sentiment_target = Aaditya Thackeray with target_tone "positive", OR sentiment_target = the government with target_tone "negative". NOT Aaditya Thackeray with "negative".`,
};
