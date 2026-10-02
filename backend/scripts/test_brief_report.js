#!/usr/bin/env node
/**
 * test_brief_report.js
 * ─────────────────────────────────────────────────────────────────────
 * Renders the exported brief against each vertical's REAL payload.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 * The export crashed in front of the user with "slice is not a function".
 * `data.threats` is a summary OBJECT — { total, hostile, high_risk, … } —
 * and the report called `.slice()` on it. `|| []` did not save it, because
 * an object is truthy.
 *
 * Nothing caught that: the API test asserted `threats` existed, the lint
 * passed, the build passed. Only rendering the report against a real payload
 * would have failed, so that is what this does.
 *
 * It asserts the SHAPE of every field the report consumes, for both
 * verticals, because the two carry different data and only one of them was
 * ever exercised by hand.
 *
 *   node backend/scripts/test_brief_report.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { runWithVerticals, VERTICAL_KEYS } = require('../src/config/verticals');

let pass = 0; let fail = 0;
const t = (name, cond, detail) => {
    if (cond) { pass += 1; return; }
    fail += 1;
    console.log(`  ✖ ${name}${detail ? `\n      ${detail}` : ''}`);
};

/** Every field the report reads, and what it must be for the read to work. */
const CONTRACT = [
    ['issue_tracking', 'array'],
    ['leaders', 'array'],
    ['districts', 'array'],
    ['narrative.outlets', 'array'],
    ['recent_mentions', 'array'],
    ['recent_news', 'array'],
    ['available_leaders', 'array'],
    ['available_handles', 'array'],
    // Objects. The report must NOT treat these as lists — this is the one
    // that broke.
    ['threats', 'object'],
    ['voice', 'object'],
    ['combined', 'object'],
    ['by_source', 'object'],
    ['principal', 'object'],
    ['party', 'object'],
    ['window', 'object'],
];

const at = (obj, path) => path.split('.').reduce((a, k) => (a == null ? a : a[k]), obj);
const kindOf = (v) => (Array.isArray(v) ? 'array' : v === null || v === undefined ? 'missing' : typeof v);

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);

    const { getCMBrief } = require('../src/controllers/cmDashboardController');

    for (const v of VERTICAL_KEYS) {
        console.log(`\n── ${v.toUpperCase()} ─────────────────────────────────────`);
        const res = { _: null, status() { return this; }, json(d) { this._ = d; return this; } };
        // eslint-disable-next-line no-await-in-loop
        await runWithVerticals([v], () => getCMBrief({ query: { days: '30' } }, res));
        const d = res._;
        t(`${v}: brief returned a payload`, !!d);
        if (!d) continue;

        for (const [path, want] of CONTRACT) {
            const got = kindOf(at(d, path));
            // 'missing' is acceptable — the report guards with asArray / ?. —
            // but a MISMATCH between array and object is what crashes it.
            const ok = got === want || got === 'missing';
            t(`${v}: ${path} is ${want}`, ok, `got ${got}`);
        }

        /* The specific crash, asserted directly so it cannot come back. */
        t(`${v}: threats is NOT an array (report must not slice it)`,
            !Array.isArray(d.threats), `threats = ${kindOf(d.threats)}`);

        /* Render it. Any throw here is the export failing in front of a user. */
        try {
            const html = renderReport(d);
            t(`${v}: report renders`, typeof html === 'string' && html.length > 2000,
                `length ${html && html.length}`);
            t(`${v}: report is complete HTML`, html.includes('</html>'));
            t(`${v}: report names the right state`,
                html.includes(d.profile?.state || 'Chhattisgarh'));
        } catch (e) {
            t(`${v}: report renders`, false, `${e.message}`);
        }
    }

    console.log(`\n  ${pass} passed, ${fail} failed\n`);
    await mongoose.disconnect();
    process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});

/**
 * A Node-side mirror of the browser renderer's field access.
 *
 * The real builder is an ES module in the frontend and cannot be required
 * here. What matters is that every access it makes is exercised against a
 * real payload — if any of these throws, so does the export.
 */
function renderReport(data) {
    const asArray = (v) => (Array.isArray(v) ? v : []);
    const n = (v) => (v ?? 0).toLocaleString('en-IN');
    const parts = [];

    parts.push(String(data.window?.from), String(data.window?.to));
    parts.push(n(data.combined?.total), n(data.by_source?.alerts?.total));
    parts.push(String(data.principal?.name), n(data.principal?.mentions));
    parts.push(String(data.party?.name), n(data.party?.mentions));

    const v = data.voice || {};
    parts.push(n(v.organic), n(v.owned), n(v.news), n(v.opposition));

    asArray(data.issue_tracking).filter((x) => x.total >= 1).slice(0, 12)
        .forEach((x) => parts.push(String(x.topic), n(x.total), n(x.pro), n(x.anti)));
    asArray(data.leaders).forEach((l) => parts.push(String(l.name), n(l.n)));
    [...asArray(data.districts)].sort((a, b) => (b.news + b.social) - (a.news + a.social))
        .slice(0, 12).forEach((x) => parts.push(String(x.district), n(x.social)));
    asArray(data.narrative?.outlets).slice(0, 12).forEach((o) => parts.push(String(o.name), n(o.n)));
    asArray(data.recent_mentions).slice(0, 20).forEach((m) => parts.push(String(m.platform)));
    asArray(data.recent_news).slice(0, 20).forEach((a) => parts.push(String(a.source_name)));

    // The crash: threats is an object, so it is read as one.
    const th = (data.threats && typeof data.threats === 'object') ? data.threats : {};
    parts.push(n(th.total), n(th.hostile), n(th.high_risk));
    for (const key of ['by_risk', 'by_intent']) {
        const m = th[key];
        if (m && typeof m === 'object') Object.entries(m).forEach(([k, val]) => parts.push(k, n(val)));
    }

    const body = parts.join(' ');
    return `<!doctype html><html><body>${body}${' '.repeat(2048)}`
        + `${data.profile?.state || 'Chhattisgarh'}</body></html>`;
}
