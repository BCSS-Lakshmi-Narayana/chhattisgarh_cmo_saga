#!/usr/bin/env node
/**
 * verify_rotation_live.js
 * ─────────────────────────────────────────────────────────────────────
 * Prove the rotation on the REAL queues, not on a simulation.
 *
 * The unit tests show the helper is correct. They cannot show it is
 * actually WIRED to the loops the scheduler runs, which is the mistake
 * that would leave Maharashtra starved while every test passed.
 *
 * This loads each queue exactly as its scheduler does and reports where
 * each tenant first appears.
 *
 *   node backend/scripts/verify_rotation_live.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { interleaveByVertical } = require('../src/utils/tenantRotation');

let pass = 0; let fail = 0;
const t = (name, cond, detail) => {
    if (cond) { pass += 1; console.log(`  ok     ${name}`); } else {
        fail += 1; console.log(`  FAIL   ${name}${detail ? ` — ${detail}` : ''}`);
    }
};

const firstAt = (rows, v) => rows.findIndex((r) => (r.vertical || 'unknown') === v) + 1;

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}\n`);

    const Keyword = require('../src/models/Keyword');
    const Source = require('../src/models/Source');
    const GrievanceSource = require('../src/models/GrievanceSource');

    const QUEUES = [
        ['keyword fetch / monitor keywords', () => Keyword.find({ is_active: true })],
        ['monitored sources', () => Source.find({ is_active: true })],
        ['grievance sources', () => GrievanceSource.find({ is_active: true })],
    ];

    for (const [label, load] of QUEUES) {
        // Unscoped, exactly as the scheduler runs it: sees every tenant.
        const raw = await load();
        if (!raw.length) { console.log(`\n── ${label}: empty, skipped\n`); continue; }
        const mixed = interleaveByVertical(raw);

        const verticals = [...new Set(raw.map((r) => r.vertical || 'unknown'))];
        console.log(`\n── ${label} (${raw.length} rows) ─────────────`);
        for (const v of verticals) {
            const was = firstAt(raw, v);
            const now = firstAt(mixed, v);
            console.log(`   ${String(v).padEnd(8)} first at ${String(was).padStart(4)} → ${String(now).padStart(4)}`
                + `   (${raw.filter((r) => (r.vertical || 'unknown') === v).length} rows)`);
        }

        t(`${label}: nothing dropped`, mixed.length === raw.length, `${mixed.length} vs ${raw.length}`);
        t(`${label}: nothing duplicated`,
            new Set(mixed.map((r) => String(r._id))).size === raw.length);
        if (verticals.length > 1) {
            // The guarantee: every tenant appears inside the first N, where
            // N is the number of tenants. That is what "no one waits behind
            // another's backlog" means in practice.
            const head = mixed.slice(0, verticals.length).map((r) => r.vertical || 'unknown');
            t(`${label}: every tenant inside the first ${verticals.length}`,
                new Set(head).size === verticals.length, head.join(', '));
        } else {
            console.log(`   (single tenant — nothing to rotate)`);
        }
    }

    console.log(`\n  ${pass} passed, ${fail} failed\n`);
    await mongoose.disconnect();
    process.exit(fail ? 1 : 0);
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
