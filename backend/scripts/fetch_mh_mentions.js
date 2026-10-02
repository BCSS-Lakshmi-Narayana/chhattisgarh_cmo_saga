#!/usr/bin/env node
/**
 * fetch_mh_mentions.js
 * ─────────────────────────────────────────────────────────────────────
 * Pull the mentions and replies aimed AT the nine leaders' handles —
 * the other half of collection, and the one the Mentions page shows.
 *
 * ── WHY THIS IS NOT THE SAME AS THE KEYWORD FETCH ────────────────────
 * `fetch_mh_deep` searches for a leader's NAME, so it finds posts that
 * talk about him. This reads his @handle's replies, which is where people
 * talk TO him — and that is where most criticism actually sits. A reply
 * saying "गद्दार" under his post usually never names him at all, so no
 * name search will ever return it.
 *
 * Both are needed. They overlap very little.
 *
 * ── DUPLICATE SOURCES ────────────────────────────────────────────────
 * Rows are matched on handle, and the earlier seeder wrote five leaders
 * twice — once as "@Dev_Fadnavis" and once as "Dev_Fadnavis". Fetching
 * both costs double the API budget for the same replies, so this refuses
 * to run until `dedupe:mh-mentions` has cleaned them up.
 *
 *   node backend/scripts/fetch_mh_mentions.js --count      show the plan
 *   node backend/scripts/fetch_mh_mentions.js --days 30
 *   node backend/scripts/fetch_mh_mentions.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { runWithVerticals } = require('../src/config/verticals');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const val = (f, d = null) => {
    const i = argv.indexOf(`--${f}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const COUNT_ONLY = has('count');
const DAYS = Number(val('days', '30'));

const iso = (d) => d.toISOString().slice(0, 10);

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}`);

    const GrievanceSource = require('../src/models/GrievanceSource');
    const Grievance = require('../src/models/Grievance');

    await runWithVerticals(['mh'], async () => {
        const sources = await GrievanceSource.find({ is_active: true }).lean();

        /* Refuse to spend the budget twice on the same handle. */
        const byBare = new Map();
        for (const s of sources) {
            const k = String(s.handle || '').replace(/^@+/, '').toLowerCase();
            byBare.set(k, (byBare.get(k) || 0) + 1);
        }
        const dupes = [...byBare.entries()].filter(([, n]) => n > 1);
        if (dupes.length) {
            console.log(`\n  ${dupes.length} handle(s) are stored twice: `
                + `${dupes.map(([h]) => h).join(', ')}`);
            console.log('  Each would be fetched twice for the same replies.');
            console.log('  Run this first:  npm run dedupe:mh-mentions\n');
            process.exitCode = 1;
            return;
        }

        const to = new Date();
        const from = new Date(Date.now() - (DAYS - 1) * 86400000);

        console.log(`Window  : ${iso(from)} to ${iso(to)}`);
        console.log(`Sources : ${sources.length} active Maharashtra handles\n`);

        /* What each handle already has, so growth is visible afterwards. */
        const before = new Map();
        for (const s of sources) {
            const h = String(s.handle || '').replace(/^@+/, '');
            // eslint-disable-next-line no-await-in-loop
            const n = await Grievance.countDocuments({
                vertical: 'mh',
                tagged_account: new RegExp(`^@?${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            });
            before.set(h, n);
            console.log(`  @${h.padEnd(22)}${String(n).padStart(5)} already stored`);
        }

        if (COUNT_ONLY) {
            console.log('\n--count given, nothing fetched.');
            return;
        }

        const { fetchAllGrievances } = require('../src/services/grievanceService');
        console.log('\nStarting. Replies are analysed as they arrive, so this is not quick.\n');
        const res = await fetchAllGrievances(from, to);
        console.log(`\nDone. ${res.newGrievances} new mentions.\n`);

        console.log('  handle                  before   after   new');
        for (const s of sources) {
            const h = String(s.handle || '').replace(/^@+/, '');
            // eslint-disable-next-line no-await-in-loop
            const n = await Grievance.countDocuments({
                vertical: 'mh',
                tagged_account: new RegExp(`^@?${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
            });
            const was = before.get(h) || 0;
            console.log(`  @${h.padEnd(22)}${String(was).padStart(6)}${String(n).padStart(8)}`
                + `${String(n - was).padStart(6)}`);
        }
    });

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
