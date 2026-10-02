#!/usr/bin/env node
/**
 * verify_mh_leader_panels.js
 * ─────────────────────────────────────────────────────────────────────
 * Checks the dashboard end to end FOR EACH OF THE NINE, the way the page
 * and the export dialog actually call it.
 *
 * `verify_brief_panels.js` checks the unfiltered brief. That passed while
 * every per-leader report still carried the same 94 alerts and handle
 * shares above 100%, because nothing exercised the leader filter. This
 * runs the same request the UI makes when a leader is chosen, for all
 * nine, and checks the things that were actually wrong:
 *
 *   · the filter is applied at all (counts differ between leaders)
 *   · alerts are scoped, not the same block repeated
 *   · handle shares cannot exceed 100%
 *   · the leader is selectable in the first place (available_leaders)
 *   · the payload the report module needs is present and the right type
 *
 * A low count is NOT a failure — collection is still filling in. A count
 * that is identical across leaders IS, because that means no filtering.
 *
 *   node backend/scripts/verify_mh_leader_panels.js
 *   node backend/scripts/verify_mh_leader_panels.js --days 30
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { runWithVerticals } = require('../src/config/verticals');
const MH = require('../src/data/mh_leaders.json');

const argv = process.argv.slice(2);
const DAYS = (() => { const i = argv.indexOf('--days'); return i >= 0 ? argv[i + 1] : '30'; })();

let pass = 0; let fail = 0;
const t = (name, cond, detail) => {
    if (cond) { pass += 1; } else {
        fail += 1;
        console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
    }
};

const brief = async (query) => {
    const { getCMBrief } = require('../src/controllers/cmDashboardController');
    const res = { _: null, status() { return this; }, json(d) { this._ = d; return this; } };
    await runWithVerticals(['mh'], () => getCMBrief({ query }, res));
    return res._;
};

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}`);
    console.log(`Window  : last ${DAYS} days\n`);

    /* ── the picker the export dialog populates from ───────────────── */
    const all = await brief({ days: DAYS });
    const offered = (all?.available_leaders || []).map((l) => l.name);
    console.log('── export picker ──────────────────────────────────');
    t('available_leaders is present', Array.isArray(all?.available_leaders));
    for (const l of MH.leaders) {
        t(`picker offers ${l.name}`, offered.includes(l.name),
            `not in [${offered.slice(0, 12).join(', ')}]`);
    }
    console.log(`  ${offered.length} leaders selectable in the UI`);
    console.log(`  unfiltered baseline: ${all?.by_source?.alerts?.total || 0} alerts, `
        + `${all?.by_source?.mentions?.total || 0} mentions\n`);

    /* ── each leader, as the page requests it ──────────────────────── */
    console.log('── per leader ─────────────────────────────────────');
    console.log('leader                     mentions  scored  alerts  handles  issues  districts');
    const seen = [];
    for (const l of MH.leaders) {
        // eslint-disable-next-line no-await-in-loop
        const d = await brief({ days: DAYS, leader: l.name });
        if (!d) { t(`${l.name} returns a payload`, false, 'null'); continue; }

        const mentions = d.by_source?.mentions?.total || 0;
        const alerts = d.by_source?.alerts?.total || 0;
        const scored = d.combined?.total || 0;
        const handles = (d.available_handles || []).length;
        const issues = (d.issue_tracking || []).length;
        const districts = (d.districts || []).length;

        console.log(`  ${l.name.padEnd(24)}${String(mentions).padStart(7)}`
            + `${String(scored).padStart(8)}${String(alerts).padStart(8)}`
            + `${String(handles).padStart(9)}${String(issues).padStart(8)}`
            + `${String(districts).padStart(11)}`);

        /* Shape the report module depends on. */
        t(`${l.name}: combined is an object`, d.combined && typeof d.combined === 'object');
        t(`${l.name}: threats is an object`, d.threats && typeof d.threats === 'object');
        t(`${l.name}: issue_tracking is an array`, Array.isArray(d.issue_tracking));
        t(`${l.name}: leaders is an array`, Array.isArray(d.leaders));
        t(`${l.name}: echoes the leader back`, d.leader === l.name, `got ${d.leader}`);

        /* The bugs that shipped before. */
        t(`${l.name}: alerts are scoped, not the global block`,
            alerts <= (all?.by_source?.alerts?.total || 0),
            `${alerts} vs unfiltered ${all?.by_source?.alerts?.total}`);
        t(`${l.name}: scored never exceeds analysed`,
            scored <= (d.combined?.analysed || 0),
            `${scored} scored of ${d.combined?.analysed} analysed`);

        const topHandle = (d.available_handles || [])[0];
        if (topHandle && mentions) {
            const share = Math.round((topHandle.count / mentions) * 100);
            t(`${l.name}: top handle share <= 100%`, share <= 100,
                `@${topHandle.handle} ${topHandle.count} of ${mentions} = ${share}%`);
        }

        seen.push({ name: l.name, mentions, alerts, scored });
    }

    /* ── is the filter doing anything at all? ──────────────────────── */
    console.log('\n── the filter is real ─────────────────────────────');
    const mentionSet = new Set(seen.map((s) => s.mentions));
    const alertSet = new Set(seen.map((s) => s.alerts));
    t('mention counts differ between leaders', mentionSet.size > 1,
        `every leader reports ${[...mentionSet][0]} — filter not applied`);
    t('alert counts differ between leaders', alertSet.size > 1,
        `every leader reports ${[...alertSet][0]} alerts — the old bug is back`);
    t('no leader exceeds the unfiltered mention total',
        seen.every((s) => s.mentions <= (all?.by_source?.mentions?.total || 0)));

    const withData = seen.filter((s) => s.mentions > 0).length;
    console.log(`\n  ${withData} of ${seen.length} leaders have mentions in this window`);
    if (withData < seen.length) {
        console.log('  The rest render a nil-return report, which is a result, not a failure.');
    }

    console.log(`\n  ${pass} passed, ${fail} failed\n`);
    await mongoose.disconnect();
    process.exit(fail ? 1 : 0);
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
