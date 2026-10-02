#!/usr/bin/env node
/**
 * audit_mh_report_readiness.js
 * ─────────────────────────────────────────────────────────────────────
 * For every leader, every metric a daily report needs — and whether the
 * window actually has enough to fill it.
 *
 * ── WHY A SEPARATE AUDIT ─────────────────────────────────────────────
 * `verify_mh_leader_panels` proves the plumbing: the filter engages, the
 * payload is shaped right, nothing is cross-contaminated. It does not say
 * whether the report will be worth sending. A leader can pass every
 * structural check and still produce a page with one scored item on it.
 *
 * This answers the other question: for THIS window, does each leader have
 * sentiment on both sides, issues with volume behind them, alerts,
 * districts and sources — and where it does not, which of those is the
 * gap.
 *
 * ── THE WINDOW MATTERS MORE THAN ANYTHING ────────────────────────────
 * The client gets a DAILY report. A 30-day window flatters every figure;
 * run `--days 1` to see what tomorrow morning actually looks like.
 *
 *   node backend/scripts/audit_mh_report_readiness.js --days 1
 *   node backend/scripts/audit_mh_report_readiness.js --days 7
 *   node backend/scripts/audit_mh_report_readiness.js --days 30
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { runWithVerticals } = require('../src/config/verticals');
const MH = require('../src/data/mh_leaders.json');

const argv = process.argv.slice(2);
const DAYS = (() => { const i = argv.indexOf('--days'); return i >= 0 ? argv[i + 1] : '1'; })();

/* The floors the report itself applies, so this agrees with what prints. */
const READING_FLOOR = 5;       // below this, no stance verdict is offered
const ISSUE_FLOOR = 1;         // internal build shows every issue

const brief = async (query) => {
    const { getCMBrief } = require('../src/controllers/cmDashboardController');
    const res = { _: null, status() { return this; }, json(d) { this._ = d; return this; } };
    await runWithVerticals(['mh'], () => getCMBrief({ query }, res));
    return res._;
};

const bar = (pro, anti, neu) => {
    const t = pro + anti + neu;
    if (!t) return '·'.repeat(20);
    const p = Math.round((pro / t) * 20);
    const a = Math.round((anti / t) * 20);
    return '+'.repeat(p) + '-'.repeat(a) + '·'.repeat(Math.max(0, 20 - p - a));
};

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}`);
    console.log(`Window  : last ${DAYS} day(s)\n`);

    const rows = [];
    for (const l of MH.leaders) {
        // eslint-disable-next-line no-await-in-loop
        const d = await brief({ days: DAYS, leader: l.name });
        if (!d) continue;

        const c = d.combined || {};
        const s = d.by_source || {};
        const th = d.threats || {};
        const issues = (d.issue_tracking || []).filter((t) => t.total >= ISSUE_FLOOR);

        const pro = c.supportive || 0;
        const anti = c.opposing || 0;
        const neu = c.neutral || 0;
        const analysed = c.analysed || 0;
        const scored = c.total || 0;

        rows.push({
            name: l.name,
            mentions: s.mentions?.total || 0,
            alerts: s.alerts?.total || 0,
            analysed,
            scored,
            pro,
            anti,
            neu,
            issues: issues.length,
            issueVol: issues.reduce((a, t) => a + t.total, 0),
            topIssue: issues[0] ? `${issues[0].topic} (${issues[0].total})` : null,
            adverseIssues: issues.filter((t) => (t.net ?? 0) < 0).length,
            districts: (d.districts || []).length,
            handles: (d.available_handles || []).length,
            hostile: th.hostile || 0,
            highRisk: th.high_risk || 0,
            profile: !!d.leader_profile,
        });
    }

    /* ── sentiment, the thing a report is actually about ───────────── */
    console.log('── sentiment per leader ───────────────────────────────────────────────');
    console.log('leader                    items  scored   for  against  neutral  balance');
    for (const r of rows) {
        console.log(`  ${r.name.padEnd(22)}${String(r.mentions + r.alerts).padStart(6)}`
            + `${String(r.scored).padStart(8)}${String(r.pro).padStart(6)}`
            + `${String(r.anti).padStart(9)}${String(r.neu).padStart(9)}  ${bar(r.pro, r.anti, r.neu)}`);
    }
    console.log('  legend: + supportive   - opposing   · neutral');

    /* ── issues ─────────────────────────────────────────────────────── */
    console.log('\n── issues per leader ──────────────────────────────────────────────────');
    console.log('leader                  issues  volume  adverse  leading issue');
    for (const r of rows) {
        console.log(`  ${r.name.padEnd(22)}${String(r.issues).padStart(6)}`
            + `${String(r.issueVol).padStart(8)}${String(r.adverseIssues).padStart(9)}  `
            + `${r.topIssue || '—'}`);
    }

    /* ── everything else the report prints ──────────────────────────── */
    console.log('\n── other report sections ──────────────────────────────────────────────');
    console.log('leader                  alerts  hostile  high-risk  districts  sources  profile');
    for (const r of rows) {
        console.log(`  ${r.name.padEnd(22)}${String(r.alerts).padStart(6)}${String(r.hostile).padStart(9)}`
            + `${String(r.highRisk).padStart(11)}${String(r.districts).padStart(11)}`
            + `${String(r.handles).padStart(9)}${(r.profile ? '  yes' : '   NO').padStart(9)}`);
    }

    /* ── the verdict: is each report worth sending ──────────────────── */
    console.log('\n── daily report readiness ─────────────────────────────────────────────');
    let ready = 0; let thin = 0; let nil = 0;
    for (const r of rows) {
        const gaps = [];
        if (!r.mentions && !r.alerts) gaps.push('no items at all');
        else {
            if (r.scored < READING_FLOOR) gaps.push(`only ${r.scored} scored`);
            if (!r.anti && !r.pro) gaps.push('no stance either way');
            if (!r.issues) gaps.push('no issues');
            if (!r.districts) gaps.push('no districts');
        }
        const state = !r.mentions && !r.alerts ? 'NIL'
            : gaps.length ? 'THIN' : 'READY';
        if (state === 'READY') ready += 1; else if (state === 'THIN') thin += 1; else nil += 1;
        console.log(`  ${state.padEnd(6)} ${r.name.padEnd(22)}${gaps.length ? gaps.join('; ') : 'all sections populated'}`);
    }

    console.log(`\n  ${ready} ready, ${thin} thin, ${nil} nil — over ${DAYS} day(s)`);
    console.log('  THIN still produces a report; every figure carries its base,');
    console.log('  so a small number is labelled rather than hidden.');
    console.log('  NIL produces the nil-return report, which is also a result.\n');

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
