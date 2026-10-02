/**
 * test_mh_geography — localities must resolve to the right district, and
 * the longest name must win so a compound is never split.
 */
const mh = require('../src/utils/mhLeaderMatch');
const MH = require('../src/data/mh_leaders.json');

let pass = 0; let fail = 0;
const t = (name, cond, detail) => {
    if (cond) { pass += 1; console.log(`  ok     ${name}`); } else {
        fail += 1; console.log(`  FAIL   ${name}${detail ? ` — ${detail}` : ''}`);
    }
};
const hit = (text) => mh.districtIn({ text });

console.log('\n── localities resolve to their district ────────────\n');
const CASES = [
    ['वरळीत आदित्य ठाकरे यांचा दौरा', 'Mumbai City'],
    ['शिवाजी पार्क येथे मनसेची सभा', 'Mumbai City'],
    ['प्रभादेवी मध्ये पाणी प्रश्न', 'Mumbai City'],
    ['डोंबिवली रेल्वे स्थानकावर गर्दी', 'Thane'],
    ['उल्हासनगर मध्ये अतिक्रमण', 'Thane'],
    ['बदलापूर घटनेवर संताप', 'Thane'],
    ['मुंब्रा बायपास अपघात', 'Thane'],
    ['इंदापूर तालुक्यात दुष्काळ', 'Pune'],
    ['बारामती मध्ये सभा', 'Pune'],
    ['दौंड मध्ये शेतकरी आंदोलन', 'Pune'],
    ['जामखेड मध्ये रोहित पवार', 'Ahilyanagar'],
    ['श्रीगोंदा येथे कार्यक्रम', 'Ahilyanagar'],
    ['अंतरवाली सराटी येथे उपोषण', 'Jalna'],
    ['अंबड तालुक्यात मराठा आंदोलन', 'Jalna'],
    ['घनसावंगी मध्ये सभा', 'Jalna'],
    ['हिंगणा एमआयडीसी', 'Nagpur'],
    ['कामठी मध्ये निवडणूक', 'Nagpur'],
    ['Ulhasnagar civic issues', 'Thane'],
    ['Purandar airport project', 'Pune'],
    ['Ramtek constituency result', 'Nagpur'],
];
for (const [text, want] of CASES) {
    const got = hit(text);
    t(`${want.padEnd(12)} ← ${text.slice(0, 34)}`, got === want, `got ${got || 'null'}`);
}

console.log('\n── a district name still beats a locality ──────────\n');
t('explicit district wins', hit('नागपूर जिल्ह्यात पाऊस') === 'Nagpur');
t('Mumbai Suburban not swallowed by Mumbai',
    hit('Mumbai Suburban district report') === 'Mumbai Suburban',
    `got ${hit('Mumbai Suburban district report')}`);

console.log('\n── no false positives ─────────────────────────────\n');
t('unrelated text resolves to nothing', hit('हा एक सामान्य संदेश आहे') === null);
t('empty text', hit('') === null);

console.log('\n── every alias maps to a real district ─────────────\n');
const districts = new Set(MH.districts);
let bad = 0;
for (const l of MH.leaders) {
    if (!districts.has(l.base.district)) { bad += 1; console.log(`  FAIL   ${l.key} -> ${l.base.district}`); }
}
t('all 9 base districts exist in the roster list', bad === 0);
t('every leader has area aliases', MH.leaders.every((l) => (l.base.area_aliases || []).length >= 4));

console.log('\n── roster facts ───────────────────────────────────\n');
const sunetra = MH.leaders.find((l) => l.key === 'mh-sunetra-pawar');
t('Sunetra Pawar is not listed as Deputy CM', !/Deputy Chief Minister/i.test(sunetra.role), sunetra.role);
const dcm = MH.leaders.filter((l) => /Deputy Chief Minister/i.test(l.role)).map((l) => l.name);
t('only Eknath Shinde carries Deputy CM', dcm.length === 1 && dcm[0] === 'Eknath Shinde', dcm.join(', '));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
