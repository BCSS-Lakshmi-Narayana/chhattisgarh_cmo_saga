#!/usr/bin/env node
/**
 * add_vertical_indexes.js
 * ─────────────────────────────────────────────────────────────────────
 * Index the query every page in this app actually runs: one tenant, one
 * date range.
 *
 * ── THE PROBLEM ──────────────────────────────────────────────────────
 * `vertical_1` exists, so the planner uses it and then walks EVERY row
 * belonging to that tenant, discarding by date in memory. Measured:
 *
 *   grievances/cg    examined 5644 → returned 4182
 *   contents/cg      examined 2900 → returned 1921
 *   newsarticles/cg  examined 1571 → returned    0
 *
 * That last one is the shape of the problem: a full tenant scan to
 * produce nothing. It is survivable at today's volume and gets linearly
 * worse as either client grows, because the cost is the tenant's SIZE,
 * not the size of the window being asked for.
 *
 * A compound {vertical, date} index lets the planner seek straight to the
 * window, so the cost follows the answer rather than the archive.
 *
 * ── SAFE TO RUN ON A LIVE DATABASE ───────────────────────────────────
 * Index builds here are background and non-unique, so they neither block
 * writes nor reject existing rows. Re-running is a no-op: an index that
 * already exists with the same spec is left alone.
 *
 *   node backend/scripts/add_vertical_indexes.js --dry-run
 *   node backend/scripts/add_vertical_indexes.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const DRY_RUN = process.argv.slice(2).includes('--dry-run');

/* Each entry is the exact shape the controllers filter on. */
const PLAN = [
    { coll: 'grievances', key: { vertical: 1, is_active: 1, post_date: -1 }, name: 'vertical_active_postdate' },
    { coll: 'alerts', key: { vertical: 1, created_at: -1 }, name: 'vertical_created' },
    { coll: 'contents', key: { vertical: 1, published_at: -1 }, name: 'vertical_published' },
    { coll: 'newsarticles', key: { vertical: 1, published_at: -1 }, name: 'vertical_published' },
    /* The leader/handle pickers and the Mentions page group by these. */
    { coll: 'grievances', key: { vertical: 1, tagged_account: 1 }, name: 'vertical_tagged' },
    { coll: 'grievances', key: { vertical: 1, analysis_status: 1 }, name: 'vertical_analysis_status' },
];

const measure = async (db, coll, query) => {
    try {
        const e = await db.collection(coll).find(query).explain('executionStats');
        const st = e.executionStats;
        const plan = e.queryPlanner.winningPlan;
        const idx = plan.inputStage?.indexName
            || plan.inputStage?.inputStage?.indexName || 'COLLSCAN';
        return { idx, examined: st.totalDocsExamined, returned: st.nReturned, ms: st.executionTimeMillis };
    } catch { return null; }
};

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}${DRY_RUN ? '   (DRY RUN)' : ''}\n`);
    const db = mongoose.connection.db;

    const since = new Date(Date.now() - 30 * 86400000);
    const PROBE = {
        grievances: { vertical: { $in: ['cg'] }, is_active: { $ne: false }, post_date: { $gte: since } },
        alerts: { vertical: { $in: ['cg'] }, created_at: { $gte: since } },
        contents: { vertical: { $in: ['cg'] }, published_at: { $gte: since } },
        newsarticles: { vertical: { $in: ['cg'] }, published_at: { $gte: since } },
    };

    console.log('── before ─────────────────────────────────────────');
    const before = {};
    for (const coll of Object.keys(PROBE)) {
        const m = await measure(db, coll, PROBE[coll]);
        before[coll] = m;
        if (m) {
            console.log(`  ${coll.padEnd(14)}${String(m.idx).padEnd(26)}`
                + `examined ${String(m.examined).padStart(6)} → returned ${String(m.returned).padStart(6)}  ${m.ms}ms`);
        }
    }

    console.log('\n── indexes ────────────────────────────────────────');
    for (const spec of PLAN) {
        const existing = await db.collection(spec.coll).indexes();
        const same = existing.find((i) => JSON.stringify(i.key) === JSON.stringify(spec.key));
        if (same) { console.log(`  = ${spec.coll}.${same.name} already present`); continue; }
        if (DRY_RUN) { console.log(`  + ${spec.coll}.${spec.name} ${JSON.stringify(spec.key)} (would create)`); continue; }
        await db.collection(spec.coll).createIndex(spec.key, { name: spec.name, background: true });
        console.log(`  + ${spec.coll}.${spec.name} ${JSON.stringify(spec.key)} created`);
    }

    if (DRY_RUN) { console.log('\n  DRY RUN — nothing created.\n'); await mongoose.disconnect(); return; }

    console.log('\n── after ──────────────────────────────────────────');
    for (const coll of Object.keys(PROBE)) {
        const m = await measure(db, coll, PROBE[coll]);
        if (!m) continue;
        const b = before[coll];
        const saved = b ? b.examined - m.examined : 0;
        console.log(`  ${coll.padEnd(14)}${String(m.idx).padEnd(26)}`
            + `examined ${String(m.examined).padStart(6)} → returned ${String(m.returned).padStart(6)}  ${m.ms}ms`
            + `${saved > 0 ? `   ${saved} fewer docs touched` : ''}`);
    }
    console.log('');

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
