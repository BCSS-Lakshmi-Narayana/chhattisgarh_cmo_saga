/**
 * test_hashtags_schemes.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Covers the two Stage 2 additions — compound-hashtag segmentation and
 * government-scheme entities — with the emphasis on what must NOT change.
 *
 * Both additions are meant to be purely additive: they may turn "no entity
 * found" into "entity found", and nothing else. Most of what follows checks that
 * promise rather than the new capability.
 *
 *   node scripts/test_hashtags_schemes.js
 */

const { buildPoliticalContext } = require('../src/services/politicalContextService');
const { segmentHashtags, findStanceHashtags, extractHashtags } = require('../src/config/hashtagSignals');
const { POLITICAL_ENTITIES } = require('../src/config/politicalEntities');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass += 1; console.log(`PASS  ${name}`); }
    else { fail += 1; console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};
const keys = (t, opts) => (buildPoliticalContext(t, opts || {}).mentioned_entities || []).map((e) => e.key);
const has = (t, k) => keys(t).includes(k);

console.log('\n── compound hashtags: the gap segmentation exists to close ──');
ok('#CGRejectsBJP now resolves BJP', has('#CGRejectsBJP', 'bjp'), `got ${keys('#CGRejectsBJP')}`);
ok('#VishnuDeoSai resolves the CM', has('#VishnuDeoSai', 'vishnu-deo-sai'), `got ${keys('#VishnuDeoSai')}`);
ok('#CongressChhattisgarh resolves INC', has('#CongressChhattisgarh', 'inc'), `got ${keys('#CongressChhattisgarh')}`);
ok('segmentation splits case boundaries', segmentHashtags('#CGRejectsBJP').includes('BJP'),
    `got "${segmentHashtags('#CGRejectsBJP')}"`);
ok('segmentation preserves case (lowercasing would make it a no-op)',
    /[A-Z]/.test(segmentHashtags('#CGRejectsBJP')));
ok('nothing to split returns empty', segmentHashtags('#bjp #aap') === '');

console.log('\n── segmentation must NOT invent entities ──');
ok('#ChhattisgarhPolitics resolves nothing', keys('#ChhattisgarhPolitics').length === 0, `got ${keys('#ChhattisgarhPolitics')}`);
ok('#BastarTourism resolves nothing', keys('#BastarTourism').length === 0, `got ${keys('#BastarTourism')}`);
ok('a non-political tag resolves nothing', keys('#GoodMorningFriends').length === 0);
ok('plain text with no hashtags is unaffected',
    keys('The weather in Margao is pleasant today').length === 0);
ok('"including" does not match the INC alias', !has('including everyone', 'inc'));
ok('#IncredibleIndia does not match INC', !has('#IncredibleIndia', 'inc'),
    `got ${keys('#IncredibleIndia')}`);
ok('"aapka" does not match AAP', !has('aapka swagat hai', 'aap'));

console.log('\n── body text still outranks hashtags ──');
{
    const t = 'Vishnu Deo Sai inaugurated the project today #CongressChhattisgarh';
    const ks = keys(t);
    ok('both resolve, body entity first', ks[0] === 'vishnu-deo-sai' && ks.includes('inc'), `got ${ks}`);
    const ctx = buildPoliticalContext(t, {});
    ok('primary_target comes from the body, not the hashtag',
        ctx.primary_target === 'vishnu-deo-sai', `got ${ctx.primary_target}`);
    const bodyOnly = buildPoliticalContext('Vishnu Deo Sai inaugurated the project today', {});
    ok('adding a hashtag does not change the body-derived primary_target',
        ctx.primary_target === bodyOnly.primary_target);
}

console.log('\n── hashtag stuffing is capped ──');
{
    const stuffed = Array.from({ length: 40 }, (_, i) => `#Tag${i}`).join(' ');
    ok('extraction stops at the cap', extractHashtags(stuffed).length <= 12,
        `got ${extractHashtags(stuffed).length}`);
    ok('duplicates counted once', extractHashtags('#BJP #bjp #Bjp').length === 1);
}

console.log('\n── curated stance hashtags ──');
{
    const s = findStanceHashtags('हसदेव बचाओ #SaveHasdeo #VoteChor');
    ok('both attack tags found', s.length === 2 && s.every((x) => x.direction === 'attack'));
    const dev = findStanceHashtags('विकास जारी #संवर_रहा_छत्तीसगढ़');
    ok('Devanagari campaign tag found as support', dev.length === 1 && dev[0].direction === 'support' && dev[0].target === 'vishnu-deo-sai', JSON.stringify(dev));
    ok('targets resolve to real roster keys',
        s.every((x) => !!POLITICAL_ENTITIES[x.target]), JSON.stringify(s));
    ok('an uncurated tag yields no direction', findStanceHashtags('#RandomTag').length === 0);
    ok('lookup is case-insensitive', findStanceHashtags('#VIKSITCHHATTISGARH').length === 1);
    const all = require('../src/config/hashtagSignals').STANCE_HASHTAGS;
    const bad = Object.entries(all).filter(([, v]) => !POLITICAL_ENTITIES[v.target]);
    ok('every curated target exists in the roster', bad.length === 0,
        bad.map(([k, v]) => `${k}→${v.target}`).join(', '));
    ok('every curated direction is attack|support',
        Object.values(all).every((v) => ['attack', 'support'].includes(v.direction)));
}

console.log('\n── government schemes ──');
ok('English scheme name resolves', has('Mahtari Vandan money not credited for three months', 'scheme-mahtari-vandan'));
ok('paddy input-subsidy scheme resolves', has('Krishak Unnati payment delayed again', 'scheme-krishak-unnati'));
ok('Devanagari scheme name resolves', has('महतारी वंदन के पैसे नहीं मिले', 'scheme-mahtari-vandan'));
ok('Bastar programme resolves', has('Niyad Nellanar camps reached 30 villages', 'scheme-niyad-nellanar'));
ok('scheme post is no longer "irrelevant"',
    buildPoliticalContext('Charan Paduka distribution stuck for months', {}).mode !== 'irrelevant');

console.log('\n── a scheme must never outrank a named leader ──');
{
    const ctx = buildPoliticalContext('Vishnu Deo Sai defended the Mahtari Vandan scheme today', {});
    ok('primary_target is the person, not the scheme',
        ctx.primary_target === 'vishnu-deo-sai', `got ${ctx.primary_target}`);
    const sch = POLITICAL_ENTITIES['scheme-mahtari-vandan'];
    const cm = POLITICAL_ENTITIES['vishnu-deo-sai'];
    ok('scheme priority sits below every person/party', sch.priority < cm.priority);
    ok('schemes are aligned to us', sch.alignment === 'ally');
    ok('schemes are typed distinctly', sch.type === 'scheme');
}

console.log('\n── no alias collisions introduced ──');
{
    const schemeKeys = Object.keys(POLITICAL_ENTITIES).filter((k) => POLITICAL_ENTITIES[k].type === 'scheme');
    ok(`${schemeKeys.length} scheme entities registered`, schemeKeys.length >= 8);
    const nonScheme = Object.entries(POLITICAL_ENTITIES).filter(([, e]) => e.type !== 'scheme');
    const clashes = [];
    for (const k of schemeKeys) {
        for (const a of POLITICAL_ENTITIES[k].aliases) {
            for (const [ok2, e] of nonScheme) {
                if ((e.aliases || []).some((x) => String(x).toLowerCase() === a)) clashes.push(`${a}: ${k} vs ${ok2}`);
            }
        }
    }
    ok('no scheme alias collides with a person or party', clashes.length === 0, clashes.join(' | '));
    ok('no scheme alias is dangerously short',
        schemeKeys.every((k) => POLITICAL_ENTITIES[k].aliases.every((a) => a.length >= 4)));
}

console.log(`\n================  ${pass} passed, ${fail} failed  ================\n`);
process.exit(fail ? 1 : 0);
