/** test_mh_topics — the topic lexicon must be right, or silent. */
const { topicFor, TOPICS } = require('../src/utils/mhTopicLexicon');

let pass = 0; let fail = 0;
const t = (name, cond, detail) => {
    if (cond) { pass += 1; console.log(`  ok     ${name}`); } else {
        fail += 1; console.log(`  FAIL   ${name}${detail ? ` — ${detail}` : ''}`);
    }
};
const got = (s) => { const r = topicFor(s); return r ? r.topic : null; };

console.log('\n── real posts map to the right topic ───────────────\n');
const CASES = [
    ['सरसकट कर्जमाफी करा अशी मागणी शेतकऱ्यांनी केली', 'Agriculture & Farmers'],
    ['दुष्काळाच्या संकटात शेतकऱ्यांना दिलासा', 'Agriculture & Farmers'],
    ['शेतकरी आत्महत्या वाढल्या आहेत', 'Agriculture & Farmers'],
    ['बोगस मतदान झाल्याचा आरोप', 'Elections & Politics'],
    ['निवडणूक आयोगाने शाई वापरली नाही', 'Elections & Politics'],
    ['50 खोके एकदम ओके', 'Corruption'],
    ['भ्रष्टाचाराचा आरोप झाला', 'Corruption'],
    ['मराठा आरक्षण आंदोलन सुरू', 'Law & Order'],
    ['कुणबी प्रमाणपत्र मिळावे अशी मागणी', 'Law & Order'],
    ['महावितरणने वीज बिल वाढवले', 'Electricity'],
    ['नागपूर बेरोजगारी वाढली', 'Employment & Jobs'],
    ['MPSC विद्यार्थ्यांचे आंदोलन', 'Employment & Jobs'],
    ['पाणीटंचाई गंभीर आहे', 'Water Supply'],
    ['रुग्णालयात औषध नाही', 'Health Services'],
    ['शिक्षक भरती रखडली', 'Education'],
    ['रस्त्यांची दुरवस्था झाली आहे', 'Roads & Transport'],
    ['लाडकी बहीण योजनेचा निधी', 'Pensions & Welfare'],
    ['महापालिका प्रशासनाचा निर्णय', 'Governance & Administration'],
    ['भूसंपादन प्रक्रिया सुरू', 'Housing & Land'],
    ['कचरा उचलला जात नाही', 'Sanitation & Waste'],
    ['प्रदूषण वाढले आहे', 'Environment'],
];
for (const [text, want] of CASES) {
    const g = got(text);
    t(`${want.padEnd(28)} ← ${text.slice(0, 30)}`, g === want, `got ${g || 'null'}`);
}

console.log('\n── longest term wins ───────────────────────────────\n');
t('"शेतकरी आत्महत्या" not split by "शेतकरी"',
    topicFor('शेतकरी आत्महत्या').term === 'शेतकरी आत्महत्या',
    topicFor('शेतकरी आत्महत्या').term);
t('"मराठा आरक्षण" beats bare "आरक्षण"',
    topicFor('मराठा आरक्षण मोर्चा').term === 'मराठा आरक्षण',
    topicFor('मराठा आरक्षण मोर्चा').term);

console.log('\n── silent when it should be ────────────────────────\n');
t('plain political chatter gets no topic', got('एकनाथ शिंदे यांची सभा झाली') === null);
t('a greeting gets no topic', got('वाढदिवसाच्या हार्दिक शुभेच्छा') === null);
t('empty text', got('') === null);
t('null-safe', got(null) === null);

console.log('\n── taxonomy integrity ──────────────────────────────\n');
const EXPECTED = ['Agriculture & Farmers', 'Corruption', 'Education', 'Elections & Politics',
    'Electricity', 'Employment & Jobs', 'Environment', 'Governance & Administration',
    'Health Services', 'Housing & Land', 'Law & Order', 'Pensions & Welfare',
    'Roads & Transport', 'Sanitation & Waste', 'Water Supply'];
t('every lexicon topic is one the tracker uses',
    TOPICS.every((x) => EXPECTED.includes(x)),
    TOPICS.filter((x) => !EXPECTED.includes(x)).join(', '));
t('all 15 topics are covered', TOPICS.length === 15, `${TOPICS.length} covered`);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
