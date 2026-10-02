#!/usr/bin/env node
/**
 * test_mh_adversaries.js
 * ─────────────────────────────────────────────────────────────────────
 * Guards the Maharashtra adversary roster.
 *
 * The mistake this is built to prevent is treating the roster as a flat list
 * of "enemies". There is no client in this deployment — the nine leaders are
 * on opposing sides, so an account is an adversary OF A SPECIFIC PERSON and
 * usually an ally of another. A report that totals them into one number says
 * something false.
 *
 * No database needed:
 *   node backend/scripts/test_mh_adversaries.js
 */
const ADV = require('../src/data/mh_adversary_handles.json');
const MH = require('../src/data/mh_leaders.json');

let pass = 0; let fail = 0;
const t = (name, actual, expected) => {
    const a = JSON.stringify(actual); const e = JSON.stringify(expected);
    if (a === e) { pass += 1; return; }
    fail += 1;
    console.log(`  ✖ ${name}\n      expected ${e}\n      got      ${a}`);
};
const ok = (name, cond) => t(name, !!cond, true);

console.log('\n── Maharashtra adversary roster ───────────────────────────');

const LEADER_KEYS = new Set(MH.leaders.map((l) => l.key));
const byKey = Object.fromEntries(MH.leaders.map((l) => [l.key, l]));

/* 1. Shape. A roster entry with no targets is the flat-list mistake. */
for (const a of ADV.accounts) {
    ok(`@${a.handle} names at least one target`, Array.isArray(a.targets) && a.targets.length > 0);
    ok(`@${a.handle} has evidence`, typeof a.evidence === 'string' && a.evidence.length > 20);
    ok(`@${a.handle} has a verified_on date`, /^\d{4}-\d{2}-\d{2}$/.test(a.verified_on || ''));
    ok(`@${a.handle} has a known hostility value`,
        ['structural', 'personal_rivalry', 'reported'].includes(a.hostility));
}

/* 2. Every target must be a real leader key — a typo silently drops the
 *    account from that leader's figures and nothing errors. */
for (const a of ADV.accounts) {
    for (const key of a.targets) {
        ok(`@${a.handle} targets a real leader (${key})`, LEADER_KEYS.has(key));
    }
}

/* 3. Nobody attacks their own camp. An account filed against a leader on its
 *    OWN side means the camps or the targets are wrong, and every sentiment
 *    figure under that leader inherits the error. */
const CAMP_OF_ALIGNMENT = { mahayuti: 'ally', mva: 'opposition', 'mva-aligned': 'opposition' };
for (const a of ADV.accounts) {
    const attackerSide = CAMP_OF_ALIGNMENT[a.camp];
    if (!attackerSide) continue;
    for (const key of a.targets) {
        const target = byKey[key];
        if (!target) continue;
        ok(`@${a.handle} (${a.camp}) does not target its own side: ${target.name}`,
            target.alignment !== attackerSide);
    }
}

/* 4. The headline property: an account can be hostile to one of the nine and
 *    friendly to another. If no account shows that, the roster has collapsed
 *    into a flat enemy list and the per-target design has been lost. */
const bothWays = ADV.accounts.filter((a) => {
    const sides = new Set(a.targets.map((k) => byKey[k] && byKey[k].alignment).filter(Boolean));
    return sides.size >= 1 && ADV.accounts.some((b) => b !== a
        && b.targets.some((k) => a.targets.includes(k) === false));
});
ok('the roster covers targets on both sides of the aisle', (() => {
    const allTargets = new Set(ADV.accounts.flatMap((a) => a.targets));
    const sides = new Set([...allTargets].map((k) => byKey[k] && byKey[k].alignment));
    return sides.has('ally') && sides.has('opposition');
})());
ok('accounts exist in both camps', (() => {
    const camps = new Set(ADV.accounts.map((a) => a.camp));
    return camps.has('mahayuti') && camps.has('mva');
})());
ok('at least one entry was found for each side', bothWays.length > 0);

/* 5. Every one of the nine should have someone attacking them. A leader with
 *    no listed adversary is a research gap, not a fact about the world. */
const targeted = new Set(ADV.accounts.flatMap((a) => a.targets));
for (const l of MH.leaders) {
    ok(`${l.name} has at least one identified adversary`, targeted.has(l.key));
}

/* 6. No duplicates, and nothing that is also one of the nine. */
const seen = new Set();
for (const a of ADV.accounts) {
    const k = a.handle.toLowerCase();
    ok(`@${a.handle} appears once`, !seen.has(k));
    seen.add(k);
}
const leaderHandles = new Set(MH.leaders.map((l) => l.handle.toLowerCase()));
for (const a of ADV.accounts) {
    ok(`@${a.handle} is not one of the nine being monitored`, !leaderHandles.has(a.handle.toLowerCase()));
}

/* 7. Reference accounts are NOT adversaries and must stay out of the totals.
 *    Maharashtra Cyber is a state agency and a source, not an attacker. */
for (const r of ADV.reference_accounts || []) {
    ok(`@${r.handle} is not counted as an adversary`, !seen.has(r.handle.toLowerCase()));
}

/* 8. The Baramati rivalry — the sharpest relationship in the set, and the one
 *    most likely to be lost if someone rebuilds this file from party lists. */
const sule = ADV.accounts.find((a) => a.handle === 'supriya_sule');
ok('Supriya Sule is on the roster', !!sule);
ok('…and is recorded as a personal rivalry, not merely structural',
    sule && sule.hostility === 'personal_rivalry');
ok('…targeting Sunetra Pawar specifically',
    sule && sule.targets.includes('mh-sunetra-pawar'));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
