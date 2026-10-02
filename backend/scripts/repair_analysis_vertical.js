#!/usr/bin/env node
/**
 * repair_analysis_vertical.js
 * ─────────────────────────────────────────────────────────────────────
 * Re-stamp Analysis rows whose `vertical` disagrees with the Content
 * they analyse.
 *
 * ── WHAT WENT WRONG ──────────────────────────────────────────────────
 * `analyses` has a UNIQUE index on `content_id` alone — it predates
 * multi-tenancy and is not compound with `vertical`. The Analysis model
 * is vertical-scoped, so inside a Maharashtra request:
 *
 *     Analysis.findOneAndUpdate({ content_id: X }, …, { upsert: true })
 *
 * becomes `{ content_id: X, vertical: { $in: ['mh'] } }`. When the stored
 * row is stamped 'cg' that query matches nothing, the upsert tries to
 * INSERT, and the unique index rejects it:
 *
 *     E11000 duplicate key … index: content_id_1 dup key: { content_id: … }
 *
 * The analysis then never completes and the Content row stays pending —
 * retried up to six times, failing identically every time. Measured on
 * 2026-10-02: 119 of 677 Analysis rows were stamped 'cg' while their
 * Content was 'mh'.
 *
 * They were written before the vertical context reached that path, so
 * `writeVertical()` fell back to DEFAULT_VERTICAL ('cg').
 *
 * ── WHY RE-STAMP RATHER THAN DELETE ──────────────────────────────────
 * The analysis itself is sound — only its label is wrong. Deleting would
 * throw away completed LLM work and pay for it again.
 *
 * ── THE INDEX ────────────────────────────────────────────────────────
 * Re-stamping fixes today's rows. The index stays non-compound, which is
 * correct here: a `content_id` identifies one post in one vertical, so
 * two verticals should never share one. --check-index reports it.
 *
 *   node backend/scripts/repair_analysis_vertical.js --dry-run
 *   node backend/scripts/repair_analysis_vertical.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}${DRY_RUN ? '   (DRY RUN)' : ''}\n`);

    const db = mongoose.connection.db;

    /* Raw driver on purpose: the point is to see EVERY row regardless of
     * vertical, which is exactly what the scoping plugin prevents. */
    const analyses = await db.collection('analyses')
        .find({}, { projection: { content_id: 1, vertical: 1 } }).toArray();
    const contents = await db.collection('contents')
        .find({}, { projection: { id: 1, vertical: 1 } }).toArray();

    const contentVertical = new Map(contents.map((c) => [c.id, c.vertical || null]));

    const fixes = [];
    let orphan = 0;
    for (const a of analyses) {
        if (!contentVertical.has(a.content_id)) { orphan += 1; continue; }
        const want = contentVertical.get(a.content_id);
        if (want && a.vertical !== want) fixes.push({ _id: a._id, from: a.vertical || null, to: want });
    }

    console.log(`  ${analyses.length} analyses, ${contents.length} content rows`);
    console.log(`  ${fixes.length} mislabelled, ${orphan} with no matching content\n`);

    if (!fixes.length) {
        console.log('  Nothing to repair.\n');
        await mongoose.disconnect();
        return;
    }

    const grouped = new Map();
    for (const f of fixes) {
        const k = `${f.from || 'null'} -> ${f.to}`;
        grouped.set(k, (grouped.get(k) || 0) + 1);
    }
    for (const [k, n] of grouped) console.log(`   ${k} : ${n}`);

    if (DRY_RUN) {
        console.log('\n  DRY RUN — nothing written. Re-run without --dry-run to apply.\n');
        await mongoose.disconnect();
        return;
    }

    const ops = fixes.map((f) => ({
        updateOne: { filter: { _id: f._id }, update: { $set: { vertical: f.to } } },
    }));
    const res = await db.collection('analyses').bulkWrite(ops, { ordered: false });
    console.log(`\n  ${res.modifiedCount} analyses re-stamped.`);

    /* Prove it, rather than assume the write did what it claims. */
    const after = await db.collection('analyses')
        .find({}, { projection: { content_id: 1, vertical: 1 } }).toArray();
    const left = after.filter((a) => {
        const want = contentVertical.get(a.content_id);
        return want && a.vertical !== want;
    }).length;
    console.log(`  ${left} still mismatched after the repair.`);
    console.log(left
        ? '\n  Some rows did not take — investigate before re-running analysis.\n'
        : '\n  Every analysis now carries its content\'s vertical.\n'
          + '  The upserts that were failing with E11000 will now find their row.\n'
          + '  Next:  npm run analyze:mh-complete\n');

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
