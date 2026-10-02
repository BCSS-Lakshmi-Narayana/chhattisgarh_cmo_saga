#!/usr/bin/env node
/**
 * rescore_mh.js
 * ─────────────────────────────────────────────────────────────────────
 * Re-runs the Maharashtra grievances through the analysis pipeline.
 *
 * ── WHY THEY NEED IT ─────────────────────────────────────────────────
 * Every Maharashtra row collected before 2026-10-01 was analysed with no
 * vertical, so `buildPoliticalContext` applied CHHATTISGARH state rules,
 * found no state signal, and `politicalSentimentService` forced the stance
 * to `unrelated`. Measured: 176 of 195 scored `unrelated`, so only 8% of the
 * corpus carried any stance and the brief had almost nothing to count.
 *
 * The collector now passes the vertical, so new rows score correctly. The
 * rows already in the database do not fix themselves.
 *
 * ── SCOPED, UNLIKE rerun_analysis.js ─────────────────────────────────
 * That script takes "the last 100 of everything" with no vertical context,
 * which on this deployment means re-running the live Chhattisgarh client's
 * rows too — LLM cost and write traffic against a client who has no problem.
 * Everything here runs inside runWithVerticals(['mh']).
 *
 *   node backend/scripts/rescore_mh.js --dry-run
 *   node backend/scripts/rescore_mh.js --limit 50
 *   node backend/scripts/rescore_mh.js --save
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { runWithVerticals } = require('../src/config/verticals');

const argv = process.argv.slice(2);
const SAVE = argv.includes('--save');
const LIMIT = (() => { const i = argv.indexOf('--limit'); return i >= 0 ? Number(argv[i + 1]) : 0; })();

const VERTICAL = 'mh';

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}`);
    console.log(`Vertical: ${VERTICAL}${SAVE ? '' : '   (DRY-RUN: nothing is written — pass --save)'}\n`);

    const Grievance = require('../src/models/Grievance');
    const grievanceService = require('../src/services/grievanceService');

    const rows = await runWithVerticals([VERTICAL], async () => {
        const q = Grievance.find({}).sort({ post_date: -1 });
        if (LIMIT) q.limit(LIMIT);
        return q.lean();
    });

    const before = rows.filter((d) => d.analysis?.political_stance
        && d.analysis.political_stance !== 'unrelated').length;
    console.log(`${rows.length} Maharashtra grievances — ${before} currently carry a stance `
        + `(${Math.round((before / Math.max(1, rows.length)) * 100)}%)\n`);

    if (!SAVE) {
        console.log('DRY-RUN: re-run with --save to rescore. Expect this to take a while and');
        console.log('to cost LLM calls — one per row.');
        await mongoose.disconnect();
        return;
    }

    let done = 0; let failed = 0;
    for (const d of rows) {
        try {
            // Inside the context so the analyser sees `mh` state rules AND the
            // rewrite lands on the right vertical.
            // eslint-disable-next-line no-await-in-loop
            await runWithVerticals([VERTICAL], () => grievanceService.analyzeGrievanceContent(
                d.id, d.content?.text || '', d.platform || 'x',
            ));
            done += 1;
        } catch (e) {
            failed += 1;
            if (failed <= 5) console.warn(`  ! ${d.id}: ${e.message}`);
        }
        if ((done + failed) % 25 === 0) console.log(`  ${done + failed} / ${rows.length}`);
    }

    const after = await runWithVerticals([VERTICAL], async () => {
        const all = await Grievance.find({}).lean();
        return all.filter((x) => x.analysis?.political_stance
            && x.analysis.political_stance !== 'unrelated').length;
    });

    console.log(`\n  rescored ${done}, failed ${failed}`);
    console.log(`  carrying a stance: ${before} → ${after}`);
    console.log('\n  Check the brief: it should no longer read "Nobody has taken a side".');

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
