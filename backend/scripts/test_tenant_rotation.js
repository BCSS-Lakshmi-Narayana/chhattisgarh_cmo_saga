/** test_tenant_rotation — fairness, with nothing dropped or duplicated. */
const { interleaveByVertical } = require('../src/utils/tenantRotation');

let pass = 0; let fail = 0;
const t = (name, cond, detail) => {
    if (cond) { pass += 1; console.log(`  ok     ${name}`); } else {
        fail += 1; console.log(`  FAIL   ${name}${detail ? ` — ${detail}` : ''}`);
    }
};
const rows = (v, n, from = 0) => Array.from({ length: n }, (_, i) => ({ vertical: v, id: `${v}${i + from}` }));

console.log('\n── the real queue shape ────────────────────────────\n');
/* 54 cg keywords then 92 mh, which is what the live queue looked like. */
const live = [...rows('cg', 54), ...rows('mh', 92)];
const mixed = interleaveByVertical(live);
t('first mh moves from position 55 to 2',
    live.findIndex((r) => r.vertical === 'mh') === 54
    && mixed.findIndex((r) => r.vertical === 'mh') === 1,
    `now ${mixed.findIndex((r) => r.vertical === 'mh') + 1}`);
t('nothing is dropped', mixed.length === live.length, `${mixed.length} vs ${live.length}`);
t('nothing is duplicated', new Set(mixed.map((r) => r.id)).size === live.length);
t('every original row survives',
    live.every((r) => mixed.some((m) => m.id === r.id)));

console.log('\n── order within a tenant is preserved ──────────────\n');
const cgOrder = mixed.filter((r) => r.vertical === 'cg').map((r) => r.id);
const mhOrder = mixed.filter((r) => r.vertical === 'mh').map((r) => r.id);
t('cg keeps its own order', cgOrder.join() === rows('cg', 54).map((r) => r.id).join());
t('mh keeps its own order', mhOrder.join() === rows('mh', 92).map((r) => r.id).join());

console.log('\n── a lopsided queue still alternates early ─────────\n');
/* The point of the fix: one tenant's backlog must not set another's wait. */
const lopsided = interleaveByVertical([...rows('cg', 5000), ...rows('mh', 3)]);
t('mh is reached within the first 6 regardless of cg size',
    lopsided.slice(0, 6).filter((r) => r.vertical === 'mh').length === 3,
    JSON.stringify(lopsided.slice(0, 6).map((r) => r.vertical)));

console.log('\n── a third tenant inherits fairness ────────────────\n');
const three = interleaveByVertical([...rows('cg', 10), ...rows('mh', 10), ...rows('br', 10)]);
t('each of three tenants appears in the first 3',
    new Set(three.slice(0, 3).map((r) => r.vertical)).size === 3,
    three.slice(0, 3).map((r) => r.vertical).join());
t('all 30 preserved', three.length === 30);

console.log('\n── degenerate input ────────────────────────────────\n');
t('single tenant is returned untouched',
    interleaveByVertical(rows('cg', 5)).map((r) => r.id).join() === rows('cg', 5).map((r) => r.id).join());
t('empty array', interleaveByVertical([]).length === 0);
t('single row', interleaveByVertical([{ vertical: 'cg' }]).length === 1);
t('non-array is safe', interleaveByVertical(null).length === 0);
t('rows with no vertical are kept',
    interleaveByVertical([{ id: 'a' }, { id: 'b' }, { vertical: 'mh', id: 'c' }]).length === 3);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
