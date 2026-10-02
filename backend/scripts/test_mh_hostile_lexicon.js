/**
 * test_mh_hostile_lexicon — the override must catch the real miss and
 * stay out of the way everywhere else.
 */
const { buildPoliticalContext } = require('../src/services/politicalContextService');
const { hostileOverride } = require('../src/utils/mhHostileLexicon');

let pass = 0; let fail = 0;
const t = (name, cond, detail) => {
    if (cond) { pass += 1; console.log(`  ok     ${name}`); } else {
        fail += 1; console.log(`  FAIL   ${name}${detail ? `\n           ${detail}` : ''}`);
    }
};
const ctx = (text, tagged) => buildPoliticalContext(text, { vertical: 'mh', taggedKeyword: tagged || '' });
const run = (text, stance, tagged) => hostileOverride({ text, stance, context: ctx(text, tagged) });

console.log('\n── the post that was scored unrelated ──────────────\n');
const REAL = '@_sanjhh123_ @mieknathshinde अरे गद्दारा , लंडनला जाऊन सांगीतला कां की '
    + 'मालकाचा पक्ष पळवलाय ? रिक्षावाला स्चताला हूशार समजतोय ?';
const r = run(REAL, 'unrelated', '@mieknathshinde');
t('fires on the Shinde "गद्दार" reply', !!r, 'no override produced');
t('forces anti_target', r && r.stance === 'anti_target', r && r.stance);
t('names the term it matched', r && r.term === 'गद्दार', r && r.term);

console.log('\n── it must not overturn a real verdict ─────────────\n');
t('leaves anti_target alone', run(REAL, 'anti_target', '@mieknathshinde') === null);
t('leaves pro_target alone', run(REAL, 'pro_target', '@mieknathshinde') === null);
t('leaves anti_target_indirect alone', run(REAL, 'anti_target_indirect', '@mieknathshinde') === null);

console.log('\n── it must not fire without cause ──────────────────\n');
t('no hostile term, no override',
    run('देवेंद्र फडणवीस यांनी आज नागपूरमध्ये बैठक घेतली', 'unrelated') === null);
t('hostile term but no target resolved',
    run('गद्दार लोकांचा देश आहे हा', 'unrelated') === null);
t('empty text', run('', 'unrelated') === null);

/* The sign would invert if it fired on an opposition target: this
 * vocabulary attacks the ruling side, so in a post about an opposition
 * figure it is usually them attacking an ally. */
const OPP = 'शरद पवार म्हणाले की हे सरकार गद्दार आहे';
const oppCtx = ctx(OPP);
t('opposition target is skipped (sign would invert)',
    oppCtx.primary_target_alignment !== 'ally' ? run(OPP, 'unrelated') === null : true,
    `alignment=${oppCtx.primary_target_alignment}`);

console.log('\n── other tier-1 vocabulary ─────────────────────────\n');
for (const [term, text] of [
    ['50 खोके', '@mieknathshinde 50 खोके एकदम ओके असं म्हणतात लोक'],
    ['मतचोरी', '@Dev_Fadnavis मतचोरी करून निवडणूक जिंकली'],
]) {
    const o = run(text, 'unrelated');
    t(`fires on "${term}"`, !!o && o.stance === 'anti_target', o ? o.term : 'no override');
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
