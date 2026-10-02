#!/usr/bin/env node
/**
 * verify_brief_panels.js
 * ─────────────────────────────────────────────────────────────────────
 * Checks that every panel on the Intelligence Brief has something to show,
 * for each vertical.
 *
 * ── WHY IT APPLIES THE FRONTEND'S OWN THRESHOLDS ─────────────────────
 * Because "the API returned 6 issues" and "the user sees 6 issues" are
 * different claims, and the gap between them is where this kept failing.
 * The page filters `issue_tracking` to `total >= 10` before rendering, so an
 * API response with six issues of five mentions each renders as "No issue
 * yet carries enough mentions to track" — empty, with the API test passing.
 *
 * Every threshold the page applies is mirrored here. A panel is only "ok" if
 * it would actually be visible.
 *
 *   node backend/scripts/verify_brief_panels.js
 *   node backend/scripts/verify_brief_panels.js --vertical mh
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { runWithVerticals, VERTICAL_KEYS } = require('../src/config/verticals');

const argv = process.argv.slice(2);
const only = (() => { const i = argv.indexOf('--vertical'); return i >= 0 ? argv[i + 1] : null; })();

let pass = 0; let fail = 0;
const check = (label, visible, detail) => {
    if (visible) { pass += 1; console.log(`  ok     ${label.padEnd(24)} ${detail ?? ''}`); return; }
    fail += 1;
    console.log(`  EMPTY  ${label.padEnd(24)} ${detail ?? ''}`);
};

const brief = async (vertical, query = { days: '30' }) => {
    const { getCMBrief } = require('../src/controllers/cmDashboardController');
    const res = { _: null, status() { return this; }, json(d) { this._ = d; return this; } };
    await runWithVerticals([vertical], () => getCMBrief({ query }, res));
    return res._;
};

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);

    for (const v of (only ? [only] : VERTICAL_KEYS)) {
        console.log(`\n── ${v.toUpperCase()} ─────────────────────────────────────────────`);
        const d = await brief(v);
        if (!d) { console.log('  no payload'); fail += 1; continue; }

        console.log(`  state: ${d.profile?.state || '(host)'}   window: ${d.window?.days}d\n`);

        /* Band A — the four KPIs. */
        check('KPI · took a side', (d.combined?.total || 0) > 0, `${d.combined?.total || 0}`);
        check('KPI · alerts', (d.by_source?.alerts?.total || 0) > 0, `${d.by_source?.alerts?.total || 0}`);

        /* Band B — the three spotlights. */
        check('Spotlight · principal', (d.principal?.mentions || 0) > 0,
            `${d.principal?.name || '—'} · ${d.principal?.mentions || 0} mentions`);
        check('Spotlight · party', (d.party?.mentions || 0) > 0,
            `${d.party?.name || '—'} · ${d.party?.mentions || 0}`);
        check('Spotlight · stance mix', (d.by_source?.mentions?.decisive || 0) > 0,
            `${d.by_source?.mentions?.decisive || 0} decisive of ${d.by_source?.mentions?.total || 0}`);

        /* Issue Tracker — the page filters by issue_min BEFORE rendering. */
        const issueMin = d.issue_min ?? 10;
        const visibleIssues = (d.issue_tracking || []).filter((t) => t.total >= issueMin);
        check('Issue Tracker', visibleIssues.length > 0,
            `${visibleIssues.length} of ${(d.issue_tracking || []).length} clear the min of ${issueMin}`);

        /* Who Is Talking — meaningful only if more than one voice is non-zero. */
        const voices = Object.values(d.voice || {}).filter((x) => x > 0).length;
        check('Who Is Talking', voices > 1, JSON.stringify(d.voice || {}));

        /* Remaining panels. */
        check('Top Locations', (d.districts || []).length > 0,
            (d.districts || []).slice(0, 4).map((x) => x.district).join(', '));
        check('Leaders', (d.leaders || []).length > 0,
            (d.leaders || []).slice(0, 4).map((x) => `${x.name}:${x.n}`).join(', '));
        check('Sentiment Trend', Object.keys(d.timeline || {}).length > 0,
            `${Object.keys(d.timeline || {}).length} topics`);
        check('Needs Attention', (d.decisions || []).length > 0, `${(d.decisions || []).length}`);
        check('Recent Mentions', (d.recent_mentions || []).length > 0, `${(d.recent_mentions || []).length}`);
        check('Media Stance', (d.narrative?.outlets || []).length > 0,
            `${(d.narrative?.outlets || []).length} outlets`);
        check('Export · handles', (d.available_handles || []).length > 0,
            `${(d.available_handles || []).length}`);
        check('Export · leaders', (d.available_leaders || []).length > 0,
            `${(d.available_leaders || []).length}`);
    }

    console.log(`\n  ${pass} panels populated, ${fail} empty\n`);
    if (fail > 0) {
        console.log('  An empty panel is not always a bug — a vertical with little data');
        console.log('  legitimately has nothing to show. Compare the two verticals: a panel');
        console.log('  full for one and empty for the other is a mapping problem.\n');
    }
    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
