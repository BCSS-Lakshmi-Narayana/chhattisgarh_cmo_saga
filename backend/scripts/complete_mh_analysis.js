#!/usr/bin/env node
/**
 * complete_mh_analysis.js
 * ─────────────────────────────────────────────────────────────────────
 * Finish the analysis on everything Maharashtra has already collected.
 *
 * ── THE ROWS NOTHING WAS EVER GOING TO PICK UP ───────────────────────
 * Both retry jobs look for `analysis_status: 'pending'`:
 *
 *     Content.find({ analysis_status: 'pending', ... })      monitorService
 *     Grievance.find({ analysis_status: 'pending', ... })    grievanceService
 *
 * Measured on 2026-10-02, 89 of 210 Maharashtra Content rows had
 * `analysis_status: null` — never 'pending', never 'complete'. A row in
 * that state is invisible to the retry that exists to rescue it, so it
 * would have sat unanalysed forever: no sentiment, no risk level, no
 * threat intent, and no alert ever raised from it. Nothing errored, which
 * is why it went unnoticed.
 *
 * This promotes `null` to 'pending' so the existing retry can see them,
 * then drives that retry to exhaustion rather than the 25 rows a
 * scheduled tick handles.
 *
 * ── WHAT IT DOES NOT DO ──────────────────────────────────────────────
 * It does not re-analyse anything already complete. Re-running is safe
 * and cheap: a second pass picks up only what genuinely failed.
 *
 *   node backend/scripts/complete_mh_analysis.js --count     show the backlog
 *   node backend/scripts/complete_mh_analysis.js
 *   node backend/scripts/complete_mh_analysis.js --batch 50
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { runWithVerticals } = require('../src/config/verticals');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const val = (f, d) => {
    const i = argv.indexOf(`--${f}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const COUNT_ONLY = has('count');
const BATCH = Number(val('batch', '25')) || 25;
const VERTICAL = 'mh';

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}`);
    console.log(`Vertical: ${VERTICAL}\n`);

    const Content = require('../src/models/Content');
    const Grievance = require('../src/models/Grievance');

    await runWithVerticals([VERTICAL], async () => {
        /* ── what is actually outstanding ───────────────────────────── */
        const cTotal = await Content.countDocuments({});
        const cDone = await Content.countDocuments({ analysis_status: 'complete' });
        const cPending = await Content.countDocuments({ analysis_status: 'pending' });
        const cNull = await Content.countDocuments({
            $or: [{ analysis_status: null }, { analysis_status: { $exists: false } }],
        });

        const gTotal = await Grievance.countDocuments({});
        const gDone = await Grievance.countDocuments({ analysis_status: 'complete' });
        const gPending = await Grievance.countDocuments({ analysis_status: 'pending' });
        const gNull = await Grievance.countDocuments({
            $or: [{ analysis_status: null }, { analysis_status: { $exists: false } }],
        });

        console.log('                 total  complete  pending   null');
        console.log(`  content   ${String(cTotal).padStart(9)}${String(cDone).padStart(10)}`
            + `${String(cPending).padStart(9)}${String(cNull).padStart(7)}`);
        console.log(`  grievance ${String(gTotal).padStart(9)}${String(gDone).padStart(10)}`
            + `${String(gPending).padStart(9)}${String(gNull).padStart(7)}`);

        const backlog = cPending + cNull + gPending + gNull;
        console.log(`\n  ${backlog} rows outstanding`);
        if (cNull || gNull) {
            console.log(`  ${cNull + gNull} of them are 'null' — invisible to the scheduled retry,`);
            console.log('  which only looks for \'pending\'. They never would have been analysed.');
        }

        if (COUNT_ONLY) { console.log('\n--count given, nothing changed.'); return; }
        if (!backlog) { console.log('\n  Nothing to do.'); return; }

        /* ── make the stuck rows visible to the retry ───────────────── */
        if (cNull) {
            const r = await Content.updateMany(
                { $or: [{ analysis_status: null }, { analysis_status: { $exists: false } }] },
                { $set: { analysis_status: 'pending' } },
            );
            console.log(`\n  promoted ${r.modifiedCount} content rows null -> pending`);
        }
        if (gNull) {
            const r = await Grievance.updateMany(
                { $or: [{ analysis_status: null }, { analysis_status: { $exists: false } }] },
                { $set: { analysis_status: 'pending' } },
            );
            console.log(`  promoted ${r.modifiedCount} grievance rows null -> pending`);
        }

        /* ── drive both retries to exhaustion ───────────────────────── */
        const { retryPendingAnalyses } = require('../src/services/monitorService');
        const { retryPendingGrievanceAnalyses } = require('../src/services/grievanceService');

        for (const [label, fn, Model] of [
            ['content', retryPendingAnalyses, Content],
            ['grievance', retryPendingGrievanceAnalyses, Grievance],
        ]) {
            let left = await Model.countDocuments({ analysis_status: 'pending' });
            if (!left) continue;
            console.log(`\n── ${label}: ${left} to analyse ───────────────────`);
            let round = 0;
            while (left > 0) {
                round += 1;
                // eslint-disable-next-line no-await-in-loop
                const res = await fn({ limit: BATCH });
                // eslint-disable-next-line no-await-in-loop
                const now = await Model.countDocuments({ analysis_status: 'pending' });
                console.log(`  round ${String(round).padStart(2)}  picked ${res.picked}  `
                    + `completed ${res.completed}  remaining ${now}`);
                // No progress means every remaining row is failing; stop
                // rather than spin the LLM on rows that will not complete.
                if (now >= left || !res.picked) {
                    if (now) console.log(`  ${now} rows are not completing — stopping.`);
                    break;
                }
                left = now;
            }
        }

        /* ── final state ────────────────────────────────────────────── */
        const cDone2 = await Content.countDocuments({ analysis_status: 'complete' });
        const gDone2 = await Grievance.countDocuments({ analysis_status: 'complete' });
        console.log('\n── after ──────────────────────────────────────────');
        console.log(`  content   ${cDone2} of ${cTotal} complete `
            + `(was ${cDone}, +${cDone2 - cDone})`);
        console.log(`  grievance ${gDone2} of ${gTotal} complete `
            + `(was ${gDone}, +${gDone2 - gDone})\n`);
    });

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
