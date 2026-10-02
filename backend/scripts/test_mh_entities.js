#!/usr/bin/env node
/**
 * test_mh_entities.js
 * ─────────────────────────────────────────────────────────────────────
 * The Maharashtra roster and pipeline, held to the same standard as the
 * host deployment's.
 *
 * Entity resolution is the first step of everything: no entity means no
 * target, which means `unrelated`, which means no stance and an empty
 * brief. Maharashtra sat at 8% stance coverage against Chhattisgarh's 53%
 * purely because the host roster was being scanned against its text.
 *
 * Every assertion below encodes a mistake that was actually made or is a
 * step away from being made.
 *
 *   node backend/scripts/test_mh_entities.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const MH = require('../src/config/mhPoliticalEntities');
const MH_LEADERS = require('../src/data/mh_leaders.json');
const { hasStateSignal } = require('../src/utils/stateSignal');
const { buildPoliticalContext } = require('../src/services/politicalContextService');

let pass = 0; let fail = 0;
const t = (name, actual, expected) => {
    const a = JSON.stringify(actual); const e = JSON.stringify(expected);
    if (a === e) { pass += 1; return; }
    fail += 1;
    console.log(`  ✖ ${name}\n      expected ${e}, got ${a}`);
};
const ok = (name, cond, detail) => t(`${name}${detail ? ` — ${detail}` : ''}`, !!cond, true);

const names = (text) => MH.mhFindMentionedEntities(text).map((x) => x.canonical);
const keys = (text) => MH.mhFindMentionedEntities(text).map((x) => x.key);
const aligns = (text) => MH.mhFindMentionedEntities(text).map((x) => x.alignment);

console.log('\n── roster shape ───────────────────────────────────────────');

ok('all nine monitored leaders are in the roster',
    MH_LEADERS.leaders.every((l) => MH.MH_ENTITIES[l.key]));
ok('roster carries parties, schemes and institutions', ['party', 'scheme', 'institution']
    .every((ty) => Object.values(MH.MH_ENTITIES).some((e) => e.type === ty)));
ok('every entity has an alignment', Object.values(MH.MH_ENTITIES)
    .every((e) => ['ally', 'opposition', 'neutral'].includes(e.alignment)));
ok('every entity has at least one alias', Object.values(MH.MH_ENTITIES)
    .every((e) => e.aliases.length > 0));
t('the Chief Minister is the primary target', MH.MH_PRIMARY_TARGET_KEY, 'mh-fadnavis');

/* Alignment must follow the COALITION, not the party. Three of the four
 * government figures are not BJP, and reading the party column alone would
 * flip them to opposition and invert every figure under their names. */
for (const [key, want] of [
    ['mh-fadnavis', 'ally'], ['mh-eknath-shinde', 'ally'],
    ['mh-sunetra-pawar', 'ally'], ['mh-shrikant-shinde', 'ally'],
    ['mh-sharad-pawar', 'opposition'], ['mh-rohit-pawar', 'opposition'],
    ['mh-aaditya-thackeray', 'opposition'], ['mh-raj-thackeray', 'opposition'],
]) t(`${key} is ${want}`, MH.MH_ENTITIES[key].alignment, want);

ok('only one of the four government figures is BJP',
    ['mh-fadnavis', 'mh-eknath-shinde', 'mh-sunetra-pawar', 'mh-shrikant-shinde']
        .filter((k) => MH.MH_ENTITIES[k].party === 'bjp').length === 1);

console.log('── resolution ─────────────────────────────────────────────');

ok('resolves an English name', names('Devendra Fadnavis declared drought').includes('Devendra Fadnavis'));
ok('resolves a Devanagari name', names('मुख्यमंत्री देवेंद्र फडणवीस यांच्याकडे मागणी').includes('Devendra Fadnavis'));
ok('resolves an @handle', names('मा. @Dev_Fadnavis जी').includes('Devendra Fadnavis'));
ok('resolves a scheme', names('Ladki Bahin Yojana payments delayed').length > 0);
ok('resolves a Devanagari scheme', names('शेतकरी कर्जमाफी द्या').length > 0);
ok('resolves an institution', names('@MSEDCL बिल वाढले').includes('MSEDCL'));

/* The split-party trap. The ECI gave both bare names to the GOVERNMENT
 * factions, so a shorter alias matching inside a longer one puts an
 * opposition post in the government's column. */
const ubt = names('Uddhav Thackeray slams Shiv Sena UBT rivals');
ok('"Shiv Sena UBT" resolves to the UBT faction', ubt.includes('Shiv Sena (UBT)'));
ok('…and NOT also to the Shinde Shiv Sena', !ubt.includes('Shiv Sena'),
    `got ${JSON.stringify(ubt)}`);
ok('bare "Shiv Sena" still resolves to the Shinde faction',
    names('Eknath Shinde Shiv Sena wins Thane').includes('Shiv Sena'));

const bothNcp = names('NCP SP leader Sharad Pawar met NCP chief Ajit Pawar');
ok('both NCP factions resolve separately',
    bothNcp.includes('Nationalist Congress Party (Sharadchandra Pawar)')
    && bothNcp.includes('Nationalist Congress Party'));

/* Surnames are shared across opposing camps — matching one would attribute
 * a post to the wrong person AND flip its sign. */
ok('bare "Shinde" resolves to nobody', names('Shinde said today').length === 0);
ok('bare "Pawar" resolves to nobody', names('Pawar said today').length === 0);
ok('bare "Thackeray" resolves to nobody', names('Thackeray said today').length === 0);
ok('bare "पवार" resolves to nobody', names('पवार म्हणाले').length === 0);

/* Opposing camps in one post must both appear, with distinct alignments. */
const clash = aligns('Devendra Fadnavis and Uddhav Thackeray clash');
ok('a two-camp post carries both alignments',
    clash.includes('ally') && clash.includes('opposition'), JSON.stringify(clash));

console.log('── gates, both directions ─────────────────────────────────');

const GATE = [
    ['Uddhav Thackeray slams the Mahayuti government', 'mh', true],
    ['Ladki Bahin Yojana payments delayed', 'mh', true],
    ['Maratha reservation stir spreads across Beed', 'mh', true],
    ['Protest in Aurangabad today', 'mh', true],
    ['Raipur mein bijli ki samasya Vishnu Deo Sai', 'mh', false],
    ['Raipur mein bijli ki samasya Vishnu Deo Sai', 'cg', true],
    ['Uddhav Thackeray slams the Mahayuti government', 'cg', false],
    ['Devendra Fadnavis in Mumbai', 'cg', false],
];
for (const [text, vertical, want] of GATE) {
    t(`[${vertical}] ${text.slice(0, 44)}`, hasStateSignal(text, [], vertical), want);
}

console.log('── pipeline ───────────────────────────────────────────────');

/* The whole point: a Maharashtra post must reach a scorable mode. An
 * `irrelevant` mode here means no stance, which is where this started. */
const PIPE = [
    ['मा. @Dev_Fadnavis जी व @MSEDCL सौर कृषी पंप योजनेत फसवणूक', 'mh-fadnavis'],
    ['Chief Minister Devendra Fadnavis declared drought in 265 talukas', 'mh-fadnavis'],
    ['शेतकरी कर्जमाफी द्या, मुख्यमंत्री फडणवीस यांच्याकडे मागणी', 'mh-fadnavis'],
];
for (const [text, wantTarget] of PIPE) {
    const ctx = buildPoliticalContext(text, { vertical: 'mh' });
    t(`target: ${text.slice(0, 34)}`, ctx.primary_target, wantTarget);
    ok(`has state context: ${text.slice(0, 34)}`, ctx.has_state_signal);
    ok(`reaches a scorable mode (${ctx.mode}): ${text.slice(0, 26)}`, ctx.mode !== 'irrelevant');
}

/* And the host client is untouched by all of it. */
const cg = buildPoliticalContext('Raipur mein bijli ki samasya, Vishnu Deo Sai ji dhyan dein', {});
t('CG still resolves its own principal', cg.primary_target, 'vishnu-deo-sai');
ok('CG still has state context', cg.has_state_signal);
ok('CG still reaches a scorable mode', cg.mode !== 'irrelevant');

console.log('── pipeline wiring ────────────────────────────────────────');

/**
 * Every path that analyses text must pass the vertical, and the query that
 * feeds it must actually select the field.
 *
 * The bug this catches was invisible. `analyzeGrievanceContent` loaded its
 * row with the projection `'content.media posted_by.handle tagged_account'`
 * — no `vertical` — so the value was always undefined and every post was
 * analysed under the host roster. The parameter was being passed; the value
 * arriving was not real, and an entire rescore run was spent before anyone
 * noticed. Three other paths (Content, News, Alerts) were never wired at all.
 */
{
    const fs = require('fs');
    const path = require('path');
    const root = path.resolve(__dirname, '../src');

    const files = [];
    (function walk(dir) {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) walk(full);
            else if (e.name.endsWith('.js')) files.push(full);
        }
    }(root));

    const missing = [];
    for (const f of files) {
        if (f.includes('analysisService')) continue; // where it is consumed
        // Strip comments first. Six of the seven "misses" on the first run
        // were doc-comment mentions of analyzeContent, and a check that
        // cries wolf is one people learn to ignore.
        const src = fs.readFileSync(f, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        for (const call of src.split('analyzeContent(').slice(1)) {
            const head = call.slice(0, 700);
            // Only option-object calls; a bare analyzeContent(text) has none.
            if (!head.includes('{')) continue;
            // `vertical:` or the ES6 shorthand `{ …, vertical }`.
            if (!/\bvertical\s*[:,}]/.test(head)) missing.push(path.relative(root, f));
        }
    }
    ok(`every analyzeContent call passes a vertical (${missing.length} missing)`,
        missing.length === 0, missing.join(', '));

    const gs = fs.readFileSync(path.join(root, 'services/grievanceService.js'), 'utf8');
    const proj = (gs.match(/Grievance\.findOne\([\s\S]{0,80}?'([^']*tagged_account[^']*)'/) || [])[1] || '';
    ok('the grievance projection selects `vertical`', /\bvertical\b/.test(proj),
        `projection is: "${proj}"`);
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
