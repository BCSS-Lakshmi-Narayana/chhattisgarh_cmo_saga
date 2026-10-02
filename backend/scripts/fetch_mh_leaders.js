#!/usr/bin/env node
/**
 * fetch_mh_leaders.js
 * ─────────────────────────────────────────────────────────────────────
 * Collect the NINE Maharashtra leaders first, before any issue keyword.
 *
 * ── THE PROBLEM THIS SOLVES ──────────────────────────────────────────
 * `fetch_mh_now.js` runs every active Maharashtra keyword in insertion
 * order. A keyword takes ~9 minutes, there are 61 of them, so a full pass
 * is about nine hours. Measured on 2026-10-01 the fetch had reached keyword
 * 8 and stopped, which left the data looking like this:
 *
 *     Devendra Fadnavis    139 mentions     Sharad Pawar          10
 *     Eknath Shinde        131              Rohit Pawar           12
 *     Sunetra Pawar         97              Aaditya Thackeray      5
 *     Dr Shrikant Shinde    20              Raj Thackeray          3
 *                                           Manoj Jarange Patil    0
 *
 * That is not a coverage gap in the sources. It is queue position: the
 * first four leaders are keywords 1–8, and the other five sit at 9–18
 * behind them, every run. The report then reads as though five of the nine
 * have nothing to say about them.
 *
 * This runs the 18 leader keywords (nine names, Latin and Devanagari) and
 * nothing else, so every leader has a base in roughly three hours rather
 * than nine — and in an order that rotates, so the same five are not last
 * every time.
 *
 *   node backend/scripts/fetch_mh_leaders.js --count      show the plan
 *   node backend/scripts/fetch_mh_leaders.js --platform x only X
 *   node backend/scripts/fetch_mh_leaders.js --thin-first starve-first order
 *   node backend/scripts/fetch_mh_leaders.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { runWithVerticals } = require('../src/config/verticals');
const MH = require('../src/data/mh_leaders.json');

const argv = process.argv.slice(2);
const COUNT_ONLY = argv.includes('--count');
const THIN_FIRST = argv.includes('--thin-first');
const PLATFORM = (() => { const i = argv.indexOf('--platform'); return i >= 0 ? argv[i + 1] : null; })();

/** Both scripts of each leader's name — these are what the keyword rows hold. */
const leaderTerms = (l) => {
    const out = [l.name];
    for (const a of l.aliases || []) {
        // The Devanagari alias is the one that earns most of the volume;
        // Latin aliases are already covered by the name itself.
        if (/[ऀ-ॿ]/.test(a)) out.push(a);
    }
    return out;
};

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}\n`);

    const Keyword = require('../src/models/Keyword');
    const Grievance = require('../src/models/Grievance');
    const mhMatch = require('../src/utils/mhLeaderMatch');

    await runWithVerticals(['mh'], async () => {
        const active = await Keyword.find({ is_active: true }).select('keyword').lean();
        const have = new Set(active.map((k) => String(k.keyword).trim().toLowerCase()));

        /* Current standing, so the thin leaders can be run first. */
        const docs = await Grievance.find({ vertical: 'mh' })
            .select('content.text text title posted_by.handle author_handle handle').limit(5000).lean();
        const counts = new Map(MH.leaders.map((l) => [l.key, 0]));
        for (const d of docs) {
            for (const l of mhMatch.leadersIn(d)) {
                if (counts.has(l.key)) counts.set(l.key, counts.get(l.key) + 1);
            }
        }

        const order = [...MH.leaders];
        if (THIN_FIRST) order.sort((a, b) => (counts.get(a.key) || 0) - (counts.get(b.key) || 0));

        const plan = [];
        console.log('leader                     mentions now   keywords');
        for (const l of order) {
            const terms = leaderTerms(l);
            const present = terms.filter((t) => have.has(t.trim().toLowerCase()));
            const missing = terms.filter((t) => !have.has(t.trim().toLowerCase()));
            console.log(`  ${l.name.padEnd(24)}${String(counts.get(l.key) || 0).padStart(8)}       `
                + `${present.join(', ')}${missing.length ? `   MISSING: ${missing.join(', ')}` : ''}`);
            plan.push(...present);
        }

        console.log(`\n${plan.length} leader keywords to run`
            + `${PLATFORM ? ` on ${PLATFORM}` : ' across all platforms'}.`);
        console.log(`At roughly 9 minutes each that is about ${Math.round((plan.length * 9) / 60)} hours.`);
        console.log(THIN_FIRST
            ? 'Order: fewest mentions first, so the starved leaders are collected before the covered ones.'
            : 'Order: roster order. Pass --thin-first to collect the starved leaders first.');

        if (COUNT_ONLY) {
            console.log('\n--count given, nothing fetched.');
            return;
        }

        const { fetchKeywordGrievances } = require('../src/services/grievanceService');
        console.log('\nStarting. Leave this running; progress is logged per keyword.\n');
        const res = await fetchKeywordGrievances(PLATFORM, { only: plan });
        console.log(`\nDone. ${res.newGrievances} new, ${res.keywordsSearched} keywords searched.`);
    });

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
