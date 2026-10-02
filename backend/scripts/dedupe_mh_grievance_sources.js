#!/usr/bin/env node
/**
 * dedupe_mh_grievance_sources.js
 * ─────────────────────────────────────────────────────────────────────
 * Removes the duplicate Maharashtra grievance sources created on
 * 2026-10-01, where the same leader exists twice — once as
 * "@Dev_Fadnavis" and once as "Dev_Fadnavis".
 *
 * ── HOW THEY GOT THERE ───────────────────────────────────────────────
 * `seed_mh_grievance_sources.js` wrote handles bare and checked for an
 * existing row with `^Dev_Fadnavis$`. Five rows already existed carrying
 * the '@', created by another path, so the check missed them and a second
 * row was written beside each. The seeder's check now allows an optional
 * '@'; this clears what the old one already created.
 *
 * ── WHY IT MATTERS ───────────────────────────────────────────────────
 * A duplicated source is fetched twice — double the API spend on five of
 * the nine leaders, while the other four were starved — and it appears
 * twice in the Mentions page "Official Handle" filter.
 *
 * ── WHICH COPY SURVIVES ──────────────────────────────────────────────
 * The BARE one, because that is the convention the seeder writes and the
 * form the four newly added leaders already use. If only the '@' copy
 * exists for some handle, it is renamed rather than deleted, so nothing
 * is ever removed without an equivalent left behind.
 *
 *   node backend/scripts/dedupe_mh_grievance_sources.js --dry-run
 *   node backend/scripts/dedupe_mh_grievance_sources.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { runWithVerticals } = require('../src/config/verticals');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const VERTICAL = 'mh';

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}`);
    console.log(`Vertical: ${VERTICAL}${DRY_RUN ? '   (DRY RUN)' : ''}\n`);

    const GrievanceSource = require('../src/models/GrievanceSource');

    await runWithVerticals([VERTICAL], async () => {
        const rows = await GrievanceSource.find({ vertical: VERTICAL }).lean();
        const bare = (h) => String(h || '').replace(/^@+/, '').toLowerCase();

        const groups = new Map();
        for (const r of rows) {
            const k = `${r.platform || 'x'}:${bare(r.handle)}`;
            if (!groups.has(k)) groups.set(k, []);
            groups.get(k).push(r);
        }

        let removed = 0; let renamed = 0; let untouched = 0;

        for (const [key, group] of groups) {
            if (group.length === 1) {
                const only = group[0];
                if (/^@/.test(String(only.handle || ''))) {
                    console.log(`  ~ ${String(only.handle).padEnd(22)} sole copy, stripping the '@'`);
                    if (!DRY_RUN) {
                        await GrievanceSource.updateOne(
                            { _id: only._id },
                            { $set: { handle: String(only.handle).replace(/^@+/, '') } },
                        );
                    }
                    renamed += 1;
                } else {
                    untouched += 1;
                }
                continue;
            }

            /* Keep the bare spelling; if somehow none is bare, keep the oldest. */
            const keep = group.find((r) => !/^@/.test(String(r.handle || ''))) || group[0];
            for (const r of group) {
                if (String(r._id) === String(keep._id)) continue;
                console.log(`  - ${String(r.handle).padEnd(22)} duplicate of `
                    + `"${keep.handle}" — removing`);
                if (!DRY_RUN) await GrievanceSource.deleteOne({ _id: r._id });
                removed += 1;
            }
            console.log(`  = ${String(keep.handle).padEnd(22)} kept  (${key})`);
        }

        console.log(`\n  ${removed} removed, ${renamed} renamed, ${untouched} already correct`);
        const after = await GrievanceSource.countDocuments({ vertical: VERTICAL });
        console.log(`  ${after} grievance sources remain for ${VERTICAL}\n`);
        console.log(DRY_RUN
            ? 'DRY RUN — nothing changed. Re-run without --dry-run to apply.'
            : 'Done.');
    });

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
