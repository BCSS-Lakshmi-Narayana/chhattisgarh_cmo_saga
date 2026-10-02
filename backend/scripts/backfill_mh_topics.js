#!/usr/bin/env node
/**
 * backfill_mh_topics.js
 * ─────────────────────────────────────────────────────────────────────
 * Give an issue topic to the posts that have none.
 *
 * 561 of 1442 Maharashtra rows carried `analysis.topic = null` — the LLM
 * returned campaign_topic 'None' and it was stored as null. A post with no
 * topic is invisible to the Issue Tracker and to section 2 of every
 * report, even when the text plainly says "कर्जमाफी" or "वीज बिल".
 *
 * Only NULLs are filled. An LLM-assigned topic is never overwritten.
 *
 *   node backend/scripts/backfill_mh_topics.js --dry-run
 *   node backend/scripts/backfill_mh_topics.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { runWithVerticals } = require('../src/config/verticals');

const DRY_RUN = process.argv.slice(2).includes('--dry-run');
const VERTICAL = 'mh';

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}`);
    console.log(`Vertical: ${VERTICAL}${DRY_RUN ? '   (DRY RUN)' : ''}\n`);

    const Grievance = require('../src/models/Grievance');
    const { topicFor } = require('../src/utils/mhTopicLexicon');

    await runWithVerticals([VERTICAL], async () => {
        const total = await Grievance.countDocuments({});
        const rows = await Grievance.find({
            $or: [{ 'analysis.topic': null }, { 'analysis.topic': { $exists: false } }],
        }).select('id content.text analysis.topic').lean();

        console.log(`  ${rows.length} of ${total} rows have no topic\n`);

        const ops = [];
        const byTopic = new Map();
        for (const r of rows) {
            const hit = topicFor((r.content && r.content.text) || '');
            if (!hit) continue;
            byTopic.set(hit.topic, (byTopic.get(hit.topic) || 0) + 1);
            ops.push({
                updateOne: {
                    filter: { id: r.id },
                    update: {
                        $set: {
                            'analysis.topic': hit.topic,
                            'analysis.topic_source': 'lexicon',
                            'analysis.topic_term': hit.term,
                        },
                    },
                },
            });
        }

        console.log(`  ${ops.length} can be assigned deterministically `
            + `(${Math.round((ops.length / Math.max(1, rows.length)) * 100)}% of the nulls)\n`);
        for (const [k, v] of [...byTopic.entries()].sort((a, b) => b[1] - a[1])) {
            console.log(`   ${k.padEnd(30)}${String(v).padStart(5)}`);
        }
        console.log(`\n  ${rows.length - ops.length} stay null — the text names no issue.`);
        console.log('  That is the honest answer for general political chatter.');

        if (DRY_RUN) { console.log('\n  DRY RUN — nothing written.\n'); return; }
        if (!ops.length) { console.log('\n  Nothing to write.\n'); return; }

        const res = await Grievance.bulkWrite(ops, { ordered: false });
        console.log(`\n  ${res.modifiedCount} rows updated.`);

        const left = await Grievance.countDocuments({
            $or: [{ 'analysis.topic': null }, { 'analysis.topic': { $exists: false } }],
        });
        const pct = Math.round(((total - left) / total) * 100);
        console.log(`  topic coverage now ${total - left}/${total} (${pct}%)\n`);
    });

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
