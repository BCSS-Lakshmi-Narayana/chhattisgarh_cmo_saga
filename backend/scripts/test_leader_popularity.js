/**
 * test_leader_popularity.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure-function tests for leaderPopularityController's entity resolution and
 * alignment flip — no DB connection needed. The failure modes these pin were
 * found by running the aggregation against a live database: one leader's
 * numbers split across two rows over an unindexed alias or a punctuation
 * variant, and placeholder strings ranking as "leaders".
 *
 *   node scripts/test_leader_popularity.js
 */

const {
    resolveEntity,
    alignToPerson,
    rawAliasesForKey,
} = require('../src/controllers/leaderPopularityController');
const { POLITICAL_ENTITIES } = require('../src/config/politicalEntities');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
    if (cond) { pass += 1; console.log(`PASS  ${name}`); }
    else { fail += 1; console.log(`FAIL  ${name}${detail ? `\n        ${detail}` : ''}`); }
};

console.log('\n── THE CRITICAL STEP: align client-relative sentiment to the person ──');
ok('opposition + client-positive → negative for them',
    alignToPerson('positive', 'opposition') === 'negative');
ok('opposition + client-negative → positive for them',
    alignToPerson('negative', 'opposition') === 'positive');
ok('ally + client-positive stays positive',
    alignToPerson('positive', 'ally') === 'positive');
ok('ally + client-negative stays negative',
    alignToPerson('negative', 'ally') === 'negative');
ok('neutral entity is never flipped',
    alignToPerson('positive', 'neutral') === 'positive');
ok('unknown (off-roster) entity is never flipped',
    alignToPerson('negative', 'unknown') === 'negative');
ok('neutral passes through regardless of alignment',
    alignToPerson('neutral', 'opposition') === 'neutral');
ok('empty sentiment passes through unchanged',
    alignToPerson('', 'opposition') === '');

console.log('\n── placeholder / junk guard ──');
for (const v of ['none', 'None', 'N/A', 'n/a', 'unknown', 'null', '', '   ', '123', '---']) {
    ok(`${JSON.stringify(v)} resolves to null`, resolveEntity(v) === null, `got ${JSON.stringify(resolveEntity(v))}`);
}
ok('a Devanagari-only name is NOT rejected as "no letters"',
    resolveEntity('प्रमोद सावंत') !== null, 'Devanagari must not trip the digit/symbol-only guard');
ok('the Devanagari name resolves to the CM',
    resolveEntity('विष्णु देव साय')?.key === 'vishnu-deo-sai');

console.log('\n── legacy roster keys resolve to their current entity ──');
ok('"bsk" → vishnu-deo-sai, ally', (() => {
    const r = resolveEntity('bsk');
    return r && r.key === 'vishnu-deo-sai' && r.alignment === 'ally';
})());
ok('"bsk_son" → kiran-singh-deo, ally', (() => {
    const r = resolveEntity('bsk_son');
    return r && r.key === 'kiran-singh-deo' && r.alignment === 'ally';
})());
ok('"bjp_telangana" → bjp (legacy "party machinery" key)', resolveEntity('bjp_telangana')?.key === 'bjp');

console.log('\n── alias / punctuation variants merge onto ONE roster key ──');
const sameKey = (a, b) => {
    const ra = resolveEntity(a), rb = resolveEntity(b);
    return ra && rb && ra.key === rb.key;
};
ok('"Dr. Raman Singh" and "Dr Raman Singh" are the same leader',
    sameKey('Dr. Raman Singh', 'Dr Raman Singh'));
ok('"CM Sai" and "Vishnu Deo Sai" are the same leader', sameKey('CM Sai', 'Vishnu Deo Sai'));
ok('"TS Baba" and "T. S. Singh Deo" are the same leader', sameKey('TS Baba', 'T. S. Singh Deo'));
ok('the Leader of Opposition is opposition-aligned', resolveEntity('Charan Das Mahant')?.alignment === 'opposition');
ok('canonical party name resolves to itself', resolveEntity('Indian National Congress')?.key === 'inc');

console.log('\n── off-roster free text is KEPT (shown), never merged into an unrelated entity ──');
const randoA = resolveEntity('Some Local Sarpanch');
const randoB = resolveEntity('A Totally Different Person');
ok('unresolved text still returns a display entry', randoA !== null && randoA.key === null && randoA.alignment === 'unknown');
ok('two different unresolved names do not collide', randoA.name !== randoB.name);
ok('unresolved priority is 0 — can never outrank a recognised leader', randoA.priority === 0);

console.log('\n── rawAliasesForKey drives the drill-down query ──');
const cmAliases = rawAliasesForKey('vishnu-deo-sai');
ok('includes the roster key itself', cmAliases.includes('vishnu-deo-sai'));
ok('includes the canonical name', cmAliases.includes(POLITICAL_ENTITIES['vishnu-deo-sai'].canonical));
ok('includes the legacy key that maps here ("bsk")', cmAliases.includes('bsk'));
ok('includes a free-text alias variant ("CM Sai")', cmAliases.includes('CM Sai'));

console.log(`\n================  ${pass} passed, ${fail} failed  ================\n`);
process.exit(fail ? 1 : 0);
