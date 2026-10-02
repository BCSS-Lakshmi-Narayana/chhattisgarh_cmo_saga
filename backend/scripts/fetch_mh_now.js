#!/usr/bin/env node
/**
 * fetch_mh_now.js
 * ─────────────────────────────────────────────────────────────────────
 * Pulls mentions for the MAHARASHTRA keywords only, right now.
 *
 * ── WHY NOT `seed:keywords -- --fetch` ───────────────────────────────
 * That is the Chhattisgarh seeder. Its `--fetch` calls
 * fetchKeywordGrievances() with no vertical context, which reads EVERY
 * active keyword in the database — the host client's ~54 plus Maharashtra's
 * ~61. Around 115 keywords, each expanding to three query variants across up
 * to four platforms. It works, but it is a very long run and most of it is
 * not Maharashtra.
 *
 * This wraps the same service call in `runWithVerticals(['mh'])`, so the
 * keyword lookup is filtered to Maharashtra and the host client's quota is
 * left alone.
 *
 *   node backend/scripts/fetch_mh_now.js              all platforms
 *   node backend/scripts/fetch_mh_now.js --platform x only X — start here
 *   node backend/scripts/fetch_mh_now.js --count      show what WOULD run
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { runWithVerticals } = require('../src/config/verticals');

const argv = process.argv.slice(2);
const COUNT_ONLY = argv.includes('--count');
const PLATFORM = (() => { const i = argv.indexOf('--platform'); return i >= 0 ? argv[i + 1] : null; })();

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}`);

    const Keyword = require('../src/models/Keyword');

    const { mine, everything } = await runWithVerticals(['mh'], async () => {
        const m = await Keyword.countDocuments({ is_active: true });
        const e = await Keyword.collection.countDocuments({ is_active: true });
        return { mine: m, everything: e };
    });

    console.log(`Maharashtra active keywords : ${mine}`);
    console.log(`All verticals (for contrast): ${everything}`);
    console.log(`Platforms                   : ${PLATFORM || 'all'}`);
    console.log(`≈ ${mine * (PLATFORM ? 3 : 12)} API calls this run\n`);

    if (COUNT_ONLY) {
        console.log('--count only, nothing fetched.');
        await mongoose.disconnect();
        return;
    }

    const grievanceService = require('../src/services/grievanceService');
    const t0 = Date.now();
    try {
        // The vertical context does two things here: scopes the keyword list
        // to Maharashtra, and stamps whatever is written with vertical 'mh'.
        const result = await runWithVerticals(['mh'],
            () => grievanceService.fetchKeywordGrievances(PLATFORM));
        console.log('result:', result, `  (${Math.round((Date.now() - t0) / 1000)}s)`);
    } catch (err) {
        console.error('fetch failed:', err.message);
    }

    await mongoose.disconnect();
    console.log('\nSee what arrived: npm run report:mh -- --days 1');
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
