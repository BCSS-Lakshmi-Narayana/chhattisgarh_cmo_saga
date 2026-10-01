#!/usr/bin/env node
/**
 * backfill_vertical_cg.js
 * ─────────────────────────────────────────────────────────────────────
 * Stamps `vertical: 'cg'` onto every document that does not already have one.
 *
 * ⚠ RUN THIS BEFORE THE VERTICAL FILTER GOES LIVE. NOT AFTER.
 *
 * Every row currently in this database belongs to the Chhattisgarh client and
 * has no `vertical` field. The read filter is `{ vertical: { $in: ['cg'] } }`.
 * A document with no `vertical` field DOES NOT MATCH that filter.
 *
 * So if the filter ships first, every dashboard, count and chart the live
 * Chhattisgarh client looks at goes to zero — not an error, not a crash, just
 * empty. This script is what prevents that, and the order is the whole point:
 *
 *      1. deploy this script and RUN it          ← you are here
 *      2. verify with --verify that nothing is left untagged
 *      3. only then enable the filter / restart the app
 *
 * It is idempotent: it only touches documents where the field is missing, so
 * re-running is safe and the second run reports zero.
 *
 *   node backend/scripts/backfill_vertical_cg.js --dry-run   show what would change
 *   node backend/scripts/backfill_vertical_cg.js             apply
 *   node backend/scripts/backfill_vertical_cg.js --verify    confirm none left
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { DEFAULT_VERTICAL } = require('../src/config/verticals');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const VERIFY = argv.includes('--verify');

/**
 * Collections that must NOT be stamped.
 *
 * `users` carries `verticals` (plural) — which datasets a LOGIN may see. That
 * is a different question from which dataset a ROW belongs to, and giving a
 * user row a singular `vertical` would invite someone to filter logins by it
 * later and lock the Maharashtra user out of their own account.
 */
const SKIP = new Set(['users', 'sessions', 'counters']);

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    const db = mongoose.connection.db;
    console.log(`Database: ${mongoose.connection.name}${DRY_RUN ? '   (DRY-RUN: nothing is written)' : ''}\n`);

    const collections = (await db.listCollections().toArray())
        .map((c) => c.name)
        .filter((n) => !n.startsWith('system.') && !SKIP.has(n))
        .sort();

    let totalMissing = 0; let totalStamped = 0; const leftovers = [];

    for (const name of collections) {
        const col = db.collection(name);
        const missing = await col.countDocuments({ vertical: { $exists: false } });
        if (missing === 0) continue;
        totalMissing += missing;

        if (VERIFY) {
            leftovers.push(`${name} (${missing})`);
            continue;
        }
        if (DRY_RUN) {
            console.log(`  ${name.padEnd(34)} ${String(missing).padStart(8)} would be stamped ${DEFAULT_VERTICAL}`);
            continue;
        }
        const res = await col.updateMany(
            { vertical: { $exists: false } },
            { $set: { vertical: DEFAULT_VERTICAL } },
        );
        totalStamped += res.modifiedCount;
        console.log(`  ${name.padEnd(34)} ${String(res.modifiedCount).padStart(8)} stamped ${DEFAULT_VERTICAL}`);
    }

    console.log('');
    if (VERIFY) {
        if (leftovers.length === 0) {
            console.log('  ✓ every document carries a vertical — safe to enable the filter');
        } else {
            console.log('  ✖ STILL UNTAGGED — do NOT enable the filter yet:');
            for (const l of leftovers) console.log(`      ${l}`);
        }
        await mongoose.disconnect();
        process.exit(leftovers.length === 0 ? 0 : 1);
    }

    console.log(DRY_RUN
        ? `  ${totalMissing} documents would be stamped. Re-run without --dry-run to apply.`
        : `  ${totalStamped} documents stamped. Now run with --verify before restarting the app.`);

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
