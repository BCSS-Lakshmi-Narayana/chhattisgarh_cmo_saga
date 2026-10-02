/**
 * test_brief_prose — assert what the report actually SAYS.
 *
 * `backend/scripts/test_brief_report.js` checks the payload contract against a
 * stand-in renderer, so it cannot see a sentence come out malformed. Both bugs
 * below passed that suite and the craco build:
 *
 *   · "Agriculture & Farmers (50 and 29%)"  — the and-joiner was a regex over
 *     the FINISHED string, so it rewrote the comma inside the last item.
 *   · "with 1 smaller themes"               — no singular form.
 *
 * This file loads the real module and reads the prose, which is the only way
 * either would have been caught.
 *
 *   node scripts/test_brief_prose.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src', 'lib', 'briefReport.js');

/**
 * Load the ESM module in CJS. The file imports nothing, so dropping the
 * `export` keyword is enough; `new Function` keeps it out of the module cache
 * and away from the browser globals it only touches inside the two openers.
 */
const load = () => {
    const src = fs.readFileSync(SRC, 'utf8').replace(/^export /gm, '');
    // eslint-disable-next-line no-new-func
    return new Function(`${src}\nreturn { buildBriefReportHtml, downloadBriefReport };`)();
};

let pass = 0;
let fail = 0;
const t = (name, cond, detail) => {
    if (cond) { pass += 1; console.log(`  ok     ${name}`); } else {
        fail += 1;
        console.log(`  FAIL   ${name}${detail ? `\n           ${detail}` : ''}`);
    }
};

/** Section body as plain text, so assertions read like the sentence does. */
const sectionText = (html, heading) => {
    const i = html.indexOf(heading);
    if (i < 0) return '';
    const j = html.indexOf('</section>', i);
    return html.slice(i, j < 0 ? undefined : j)
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
};

const payload = (over = {}) => ({
    window: { days: 8, from: '2026-09-24', to: '2026-10-02' },
    profile: { state: 'Maharashtra' },
    combined: { total: 64, analysed: 318, supportive: 24, opposing: 40 },
    by_source: { mentions: { total: 318 }, articles: { total: 0 }, alerts: { total: 89 } },
    threats: { total: 89, high_risk: 31, hostile: 17, legal_ready: 16, policy_ready: 16, untriaged: 89 },
    voice: { organic: 289, owned: 14, news: 0, opposition: 3 },
    issue_min: 6,
    issue_tracking: [
        { topic: 'Governance & Administration', total: 62, scored: 14, direction: 'worsening', series: [{ pro: 4, anti: 9, neutral: 1 }] },
        { topic: 'Elections & Politics', total: 53, scored: 11, series: [{ pro: 5, anti: 4, neutral: 2 }] },
        { topic: 'Agriculture & Farmers', total: 50, scored: 8, series: [{ pro: 6, anti: 1, neutral: 1 }] },
        { topic: 'Water Supply', total: 9, scored: 0, series: [{ pro: 0, anti: 0, neutral: 0 }] },
    ],
    leaders: [
        { name: 'Devendra Fadnavis', n: 104, pro: 7, anti: 2 },
        { name: 'Eknath Shinde', n: 97, pro: 3, anti: 14 },
        { name: 'Sunetra Pawar', n: 88, pro: 2, anti: 6 },
    ],
    districts: [{ district: 'Nanded', social: 14, news: 0, adverse_share: 0 }],
    available_handles: [
        { handle: 'Ambu750K', name: 'k ambu', count: 9, voice: 'organic', anti: 6, pro: 0 },
        { handle: 'DeepakK99547383', name: 'Deepak', count: 7, voice: 'organic', anti: 4, pro: 0 },
    ],
    recent_mentions: [], recent_news: [], decisions: [], narrative: { outlets: [] },
    ...over,
});

const { buildBriefReportHtml } = load();

console.log('\n── prose: section 4 ───────────────────────────────\n');

const html = buildBriefReportHtml(payload(), {});
const s4 = sectionText(html, '4.1 What the conversation was about');

t('three themes join as "a, b and c"',
    /Governance & Administration \(62, 36%\), Elections & Politics \(53, 30%\) and Agriculture & Farmers \(50, 29%\)/.test(s4),
    s4.slice(0, 260));

// The original bug, stated as the thing that must never appear: a number,
// a space, "and", a space, a number-percent inside one pair of parentheses.
t('no "and" inside an item\'s own parentheses', !/\(\d[\d,]* and \d/.test(s4), s4.slice(0, 260));

t('4th theme is "1 smaller theme", singular', /with 1 smaller theme behind them/.test(s4), s4.slice(0, 400));
t('singular theme line is not pluralised', !/1 smaller themes/.test(s4));

/* Two extra themes ⇒ the plural must come back. */
const many = payload({
    issue_tracking: [
        ...payload().issue_tracking,
        { topic: 'Roads', total: 8, scored: 0, series: [{ pro: 0, anti: 0, neutral: 0 }] },
        { topic: 'Health', total: 7, scored: 0, series: [{ pro: 0, anti: 0, neutral: 0 }] },
    ],
});
const s4many = sectionText(buildBriefReportHtml(many, {}), '4.1 What the conversation was about');
t('3 extra themes is "3 smaller themes", plural', /with 3 smaller themes behind them/.test(s4many), s4many.slice(0, 400));

/* Exactly three themes ⇒ no trailing "smaller" clause at all. */
const three = payload({ issue_tracking: payload().issue_tracking.slice(0, 3) });
const s4three = sectionText(buildBriefReportHtml(three, {}), '4.1 What the conversation was about');
t('exactly 3 themes drops the trailing clause', !/smaller theme/.test(s4three), s4three.slice(0, 400));

/* One theme ⇒ no joiner artefacts: no leading/trailing "and", no stray comma. */
const one = payload({ issue_tracking: payload().issue_tracking.slice(0, 1) });
const s4one = sectionText(buildBriefReportHtml(one, {}), '4.1 What the conversation was about');
t('single theme reads without a joiner',
    /ran mainly on Governance & Administration \(62, 100%\)\./.test(s4one), s4one.slice(0, 300));

console.log('\n── prose: section 4.2 ────────────────────────────\n');

const s42 = sectionText(html, '4.2 Where the negativity sits');

/* The brief reports the balance, not our collection rate. A small base is
 * noted in passing ("on the N items that took a side"), never as a lead. */
t('leads with the balance of opinion, not coverage statistics',
    /Opinion is (running against us|running in our favour|evenly split)/.test(s42), s42.slice(0, 300));
t('never reports our stance-coverage percentage to the client',
    !/carry a stance/.test(s42), s42.slice(0, 300));
t('names the most adverse leader', /Eknath Shinde draws the most adverse coverage/.test(s42), s42.slice(0, 400));
t('lists critical handles with a real joiner',
    /@Ambu750K \(6\) and @DeepakK99547383 \(4\)\./.test(s42), s42.slice(0, 500));

/* A thick stance base must switch to the percentage split. */
const thick = payload({ combined: { total: 200, analysed: 318, supportive: 60, opposing: 140 } });
const s42thick = sectionText(buildBriefReportHtml(thick, {}), '4.2 Where the negativity sits');
t('a healthy base quotes the split against the item count',
    /30% supportive against 70% opposing of 200 items that took a side/.test(s42thick),
    s42thick.slice(0, 300));
t('a healthy base names the direction',
    /running against us/.test(s42thick), s42thick.slice(0, 200));

console.log('\n── prose: section 1 ──────────────────────────────\n');

const s1 = sectionText(html, '1. Executive summary');
t('exec summary joins three leaders correctly',
    /Devendra Fadnavis \(104 mentions\), Eknath Shinde \(97 mentions\) and Sunetra Pawar \(88 mentions\)/.test(s1),
    s1.slice(0, 400));
t('exec summary has no "and" inside parentheses', !/\(\d[\d,]* and /.test(s1), s1.slice(0, 400));
t('exec summary joins the alert kinds correctly',
    /17 are hostile, 16 are ready to file legally and 16 breach a platform policy/.test(s1), s1.slice(0, 400));

console.log('\n── section 2: key issues ─────────────────────────\n');

/**
 * Mirrors the Issue Tracker panel exactly, so the report's figures can be
 * checked against what the screen shows. Water Supply is the only net-adverse
 * theme; Sharad Pawar carries a single opposing mention and must NOT be
 * promoted to "the widest adverse gap of anyone named".
 */
const tracker = payload({
    threats: { total: 90, high_risk: 38, hostile: 17, legal_ready: 19, policy_ready: 16, untriaged: 90 },
    issue_tracking: [
        { topic: 'Elections & Politics', total: 64, scored: 14, net: 28, direction: 'stable', series: [{ pro: 9, anti: 5, neutral: 2 }] },
        { topic: 'Governance & Administration', total: 55, scored: 16, net: 87, direction: 'worsening', series: [{ pro: 15, anti: 1, neutral: 1 }] },
        { topic: 'Agriculture & Farmers', total: 50, scored: 8, net: 100, direction: 'improving', series: [{ pro: 8, anti: 0, neutral: 1 }] },
        { topic: 'Water Supply', total: 8, scored: 8, net: -100, direction: 'worsening', series: [{ pro: 0, anti: 8, neutral: 0 }] },
        { topic: 'Health Services', total: 8, scored: 6, net: 100, direction: 'stable', series: [{ pro: 6, anti: 0, neutral: 0 }] },
    ],
    leaders: [
        { name: 'Devendra Fadnavis', n: 104, pro: 7, anti: 2 },
        { name: 'Sharad Pawar', n: 6, pro: 0, anti: 1 },
    ],
});
const trackerHtml = buildBriefReportHtml(tracker, {});
const s21 = sectionText(trackerHtml, '2.1 Issues drawing the most criticism');

t('names the most criticised issue',
    /Water Supply draws the most criticism — 8 opposing of 8 scored, a net of -100, across 8 mentions/.test(s21),
    s21.slice(0, 300));
t('counts the net-adverse issues, singular',
    /1 issue is net adverse: Water Supply \(-100\)/.test(s21), s21.slice(0, 400));
t('lists the worsening issues', /Governance & Administration and Water Supply/.test(s21), s21.slice(0, 500));
t('most criticised issue leads the table, not the biggest',
    s21.indexOf('Water Supply') < s21.indexOf('Elections & Politics'), s21.slice(0, 600));
t('issues with no criticism are left out of 2.1',
    !/Agriculture & Farmers/.test(s21) && !/Health Services/.test(s21), s21.slice(0, 600));
t('net figures match the Issue Tracker panel',
    /\+28/.test(s21) && /\+87/.test(s21) && /-100/.test(s21), s21.slice(0, 600));

/* The row the user flagged: one opposing mention is not an adverse finding. */
t('a leader under the reading floor is not called the widest adverse gap',
    !/Adverse coverage of Sharad Pawar/.test(trackerHtml),
    sectionText(trackerHtml, '2.2 Operational issues').slice(0, 400));

/* Above the floor it must still appear. */
const realGap = payload({
    leaders: [{ name: 'Eknath Shinde', n: 97, pro: 3, anti: 14 }, { name: 'Devendra Fadnavis', n: 104, pro: 7, anti: 2 }],
});
t('a leader above the reading floor IS reported',
    /Adverse coverage of Eknath Shinde/.test(buildBriefReportHtml(realGap, {})));

/* No issue net adverse ⇒ say so rather than printing an empty lead. */
const allPositive = payload({
    issue_tracking: [
        { topic: 'Agriculture & Farmers', total: 50, scored: 9, net: 100, direction: 'improving', series: [{ pro: 9, anti: 0, neutral: 0 }] },
        { topic: 'Health Services', total: 8, scored: 6, net: 60, direction: 'stable', series: [{ pro: 5, anti: 1, neutral: 0 }] },
    ],
});
const s21pos = sectionText(buildBriefReportHtml(allPositive, {}), '2.1 Issues drawing the most criticism');
t('no net-adverse issue says so explicitly', /No issue is net adverse/.test(s21pos), s21pos.slice(0, 400));

/* Worsening topics must not be duplicated across 2.1 and 2.2. */
const s22 = sectionText(trackerHtml, '2.2 Operational issues');
t('worsening topics are not repeated in 2.2', !/Sentiment worsening on/.test(s22), s22.slice(0, 400));

console.log('\n── readings never contradict the Net column ──────\n');

/**
 * The bug: a row printed "-33" in Net and "Insufficient data" in Reading.
 * The net was real; only the base was thin. A reading must now state the
 * direction and name the base, never refuse while a net sits beside it.
 */
const thin = payload({
    issue_tracking: [
        { topic: 'Water Supply', total: 9, scored: 3, net: -33, direction: 'worsening', series: [{ pro: 1, anti: 2, neutral: 0 }] },
        { topic: 'Elections & Politics', total: 64, scored: 24, net: 33, direction: 'stable', series: [{ pro: 16, anti: 8, neutral: 2 }] },
    ],
    leaders: [{ name: 'Sharad Pawar', n: 6, pro: 1, anti: 2 }],
});
const thinHtml = buildBriefReportHtml(thin, {});

t('"Insufficient data" never appears anywhere', !/Insufficient data/.test(thinHtml));
t('a thin adverse base reads "Adverse (3 scored)"', /Adverse \(3 scored\)/.test(thinHtml),
    sectionText(thinHtml, '2.1 Issues drawing the most criticism').slice(0, 400));
t('a healthy base keeps the plain reading',
    /Favourable(?!\s*\()/.test(sectionText(thinHtml, '2.1 Issues drawing the most criticism')),
    sectionText(thinHtml, '2.1 Issues drawing the most criticism').slice(0, 400));

/* Every row carrying a net must carry a direction word next to it. */
const noScore = payload({
    issue_tracking: [{ topic: 'Water Supply', total: 9, scored: 0, net: null, direction: 'stable', series: [{ pro: 0, anti: 0, neutral: 3 }] }],
    leaders: [{ name: 'Sharad Pawar', n: 6, pro: 0, anti: 0 }],
});
/* "Not yet scored" described our queue. A dash says "nothing to report". */
t('a zero base reports nothing rather than naming our queue state',
    !/Not yet scored/.test(buildBriefReportHtml(noScore, {})));
t('no "Unscored" anywhere in a client report',
    !/Unscored/.test(buildBriefReportHtml(noScore, {}))
    && !/Unscored/.test(html), 'client reports must not show pipeline states');

console.log('\n── a leader with nothing still gets a report ─────\n');

/**
 * The client asked for one report per profile per day. A leader with a quiet
 * window used to produce a header over white space, because every section
 * hides itself when empty — which reads as a broken export, not a quiet week.
 */
const nil = {
    window: { days: 1, from: '2026-10-01', to: '2026-10-01' },
    profile: { state: 'Maharashtra' },
    leader: 'Manoj Jarange Patil',
    combined: { total: 0, analysed: 0, supportive: 0, opposing: 0 },
    by_source: { mentions: { total: 0 }, articles: { total: 0 }, alerts: { total: 0 } },
    threats: {}, voice: {}, issue_tracking: [], leaders: [], districts: [],
    available_handles: [], recent_mentions: [], recent_news: [], decisions: [],
    narrative: { outlets: [] },
};
const nilHtml = buildBriefReportHtml(nil, {});
const nilText = nilHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

t('names the leader it found nothing for',
    /No mentions of Manoj Jarange Patil were captured today/.test(nilText), nilText.slice(0, 300));
t('says a nil return is normal, not a collection gap',
    /A silent window is a normal result, not a gap in collection/.test(nilText));
t('states the limits of a nil return', /it is not evidence that nothing happened offline/.test(nilText));
t('documents what was monitored', /What was monitored/.test(nilText));
t('prints the zeros as stats', /Mentions captured/.test(nilText) && /Items needing a response/.test(nilText));
/* The header used to carry our stance-coverage rate. A reader wants the
 * finding, not our hit rate, so no percentage-of-items line appears at all. */
t('no stance-coverage percentage in a nil report',
    !/carry a stance/.test(nilText) && !/Confidence/.test(nilText), nilText.slice(0, 400));
t('no "0 of 0" stance arithmetic anywhere', !/0 of 0/.test(nilText), nilText.slice(0, 600));
t('empty sections 4 and 10 are omitted, not printed blank',
    !/Where the negativity sits/.test(nilText) && !/Outlook for tomorrow/.test(nilText));
t('the nil report is still substantial', nilText.length > 1200, `length ${nilText.length}`);

/* The nil path must not leak into a report that HAS data. */
t('a report with data keeps its normal sections',
    /Where the negativity sits/.test(html) && !/What was monitored/.test(html));

console.log('\n── no placeholder leaks ──────────────────────────\n');

/* An all-placeholder column must be dropped, never printed as "[?]". */
t('no bare [?] in the rendered report', !/\[\?\]/.test(html));
t('report is titled for the client state, not the host',
    html.includes('Maharashtra') && !/Chhattisgarh Political/.test(html));

console.log('\n── download filenames ────────────────────────────\n');

/**
 * Nine reports land in one folder together, so the leader has to lead the
 * name. It used to trail the state, the cadence and both dates.
 */
{
    const { downloadBriefReport } = load();
    const realBlob = global.Blob; const realURL = global.URL; const realDoc = global.document;
    let captured = null;
    global.Blob = function Blob() {};
    global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
    global.document = {
        createElement: () => ({ set download(v) { captured = v; }, set href(v) {}, click() {}, remove() {} }),
        body: { appendChild() {} },
    };
    const nameFor = (leader) => { downloadBriefReport({ ...nil, leader }, {}); return captured; };

    t('leader name leads the filename',
        nameFor('Devendra Fadnavis').startsWith('Devendra-Fadnavis_Report'), nameFor('Devendra Fadnavis'));
    t('spaces become hyphens',
        nameFor('Manoj Jarange Patil').startsWith('Manoj-Jarange-Patil_Report'), nameFor('Manoj Jarange Patil'));
    t('a dotted title does not produce a hidden file',
        nameFor('Dr. Shrikant Shinde').startsWith('Dr-Shrikant-Shinde'), nameFor('Dr. Shrikant Shinde'));
    t('combined export is named, not blank',
        nameFor(null).includes('All-Leaders'), nameFor(null));
    t('no filesystem-hostile characters survive',
        !/[\/:*?"<>|@]/.test(nameFor('A/B:C*D?E"F<G>H|I@J')), nameFor('A/B:C*D?E"F<G>H|I@J'));
    t('each leader gets a distinct filename',
        new Set(['Devendra Fadnavis', 'Eknath Shinde', 'Sharad Pawar', 'Rohit Pawar'].map(nameFor)).size === 4);
    t('the name ends in .html', nameFor('Raj Thackeray').endsWith('.html'), nameFor('Raj Thackeray'));

    global.Blob = realBlob; global.URL = realURL; global.document = realDoc;
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
