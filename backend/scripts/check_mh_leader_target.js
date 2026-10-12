#!/usr/bin/env node
/**
 * check_mh_leader_target.js — READ-ONLY.
 *
 * After the backend restarts, shows the newest Maharashtra posts that carry
 * the new `analysis.leader_target` record, so each can be eyeballed against
 * its text: who it was aimed at, the camp, own-post flag and leader sentiment.
 * Writes nothing.
 *
 *   node backend/scripts/check_mh_leader_target.js            # newest 15
 *   node backend/scripts/check_mh_leader_target.js --limit 40
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const argv = process.argv.slice(2);
const LIMIT = (() => { const i = argv.indexOf('--limit'); return i >= 0 ? Number(argv[i + 1]) : 15; })();

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, { dbName, serverSelectionTimeoutMS: 20000 });
    const col = mongoose.connection.db.collection('grievances');
    const base = { vertical: 'mh', 'analysis.leader_target.version': { $exists: true } };

    const total = await col.countDocuments(base);
    console.log(`\nMaharashtra posts carrying leader_target: ${total}`);
    if (!total) {
        console.log('None yet — restart the backend and let new posts be analysed.\n');
        process.exit(0);
    }

    const by = await col.aggregate([
        { $match: base },
        { $group: { _id: { s: '$analysis.leader_target.status', r: '$analysis.leader_target.reason' }, n: { $sum: 1 } } },
        { $sort: { n: -1 } },
    ]).toArray();
    console.log('\nBy status / reason');
    by.forEach((b) => console.log(`  ${String(b._id.s).padEnd(9)} ${String(b._id.r).padEnd(34)} ${b.n}`));

    const rows = await col.find(base, {
        projection: {
            post_date: 1, 'posted_by.handle': 1, 'content.text': 1,
            'analysis.political_stance': 1, 'analysis.target_entity': 1, 'analysis.leader_target': 1,
        },
    }).sort({ post_date: -1 }).limit(LIMIT).toArray();

    console.log(`\nNewest ${rows.length}\n`);
    for (const d of rows) {
        const lt = d.analysis.leader_target;
        console.log(`@${d.posted_by?.handle || '?'}  ${String(d.content?.text || '').replace(/\s+/g, ' ').slice(0, 110)}`);
        console.log(`   government stance : ${d.analysis.political_stance}   (engine target: ${d.analysis.target_entity})`);
        console.log(`   leader record     : ${lt.status}${lt.status === 'targeted' ? ` → ${lt.target_leader_name} [${lt.target_camp}]` : ` (${lt.reason})`}`
            + `   own=${lt.is_own_post}   leader_sentiment=${lt.leader_sentiment}\n`);
    }
    process.exit(0);
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
