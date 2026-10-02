#!/usr/bin/env node
/**
 * repair_mh_data.js
 * ─────────────────────────────────────────────────────────────────────
 * Bring every stored Maharashtra record up to what the pipeline would
 * produce today, so the reports rest on correct data rather than on
 * whatever the pipeline happened to be doing when each row arrived.
 *
 * ── WHY STORED ROWS ARE BEHIND ───────────────────────────────────────
 * Rows were analysed under three successive faults, each fixed later:
 *
 *   1. PolicyMapping was tenant-scoped, so Maharashtra analysed against
 *      ZERO categories. Everything collected before that fix carries no
 *      usable category.
 *   2. Entity resolution ran against the host roster, which has never
 *      heard of these leaders, so `mentioned_entities` came back empty
 *      and the stance engine had no target.
 *   3. The LLM returned no verdict on hostile Marathi, so posts calling
 *      a leader गद्दार were stored `unrelated` and dropped out of the brief.
 *
 * ── WHAT THIS FIXES WITHOUT AN LLM ───────────────────────────────────
 * Two of the three are deterministic and repaired in place, free:
 *
 *   entities  re-resolved from the text against the Maharashtra roster
 *   stance    the tier-1 hostile override applied to undecided rows
 *
 * ── WHAT IT CANNOT FIX ───────────────────────────────────────────────
 * Category is the LLM's judgement; it cannot be recovered from stored
 * text without asking again. Rows needing that are COUNTED and named, so
 * the LLM spend is a decision rather than a surprise. `npm run rescore:mh
 * -- --save` is the pass that does it.
 *
 *   node backend/scripts/repair_mh_data.js --dry-run
 *   node backend/scripts/repair_mh_data.js
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

    const Grievance = require('../src/models/Grievance');
    const { buildPoliticalContext, findMentionedEntities } = require('../src/services/politicalContextService');
    const { hostileOverride } = require('../src/utils/mhHostileLexicon');

    await runWithVerticals([VERTICAL], async () => {
        const rows = await Grievance.find({ vertical: VERTICAL })
            .select('id content.text tagged_account analysis').lean();
        console.log(`  ${rows.length} grievances to inspect\n`);

        const entityOps = [];
        const stanceOps = [];
        const needLlm = [];
        let alreadyFine = 0;

        for (const r of rows) {
            const text = (r.content && r.content.text) || '';
            const a = r.analysis || {};
            let touched = false;

            /* ── 1. entities, deterministic from the roster ─────────── */
            const stored = Array.isArray(a.mentioned_entities) ? a.mentioned_entities : [];
            if (text && stored.length === 0) {
                const found = findMentionedEntities(text, VERTICAL) || [];
                if (found.length) {
                    entityOps.push({
                        updateOne: {
                            filter: { id: r.id },
                            update: { $set: { 'analysis.mentioned_entities': found } },
                        },
                    });
                    touched = true;
                }
            }

            /* ── 2. stance, where the LLM declined and the text is hostile ── */
            const stance = String(a.political_stance || '');
            if (!stance || stance === 'unrelated' || stance === 'neutral') {
                const ctx = buildPoliticalContext(text, {
                    vertical: VERTICAL,
                    taggedKeyword: r.tagged_account || '',
                });
                const forced = hostileOverride({ text, stance, context: ctx });
                if (forced) {
                    stanceOps.push({
                        updateOne: {
                            filter: { id: r.id },
                            update: {
                                $set: {
                                    'analysis.political_stance': forced.stance,
                                    'analysis.target_sentiment': 'negative',
                                    'analysis.stance_provider': 'lexicon-repair',
                                    'analysis.stance_reason': forced.reason,
                                },
                            },
                        },
                    });
                    touched = true;
                }
            }

            /* ── 3. category, which only the LLM can supply ─────────── */
            if (!a.category || a.category === '') needLlm.push(r.id);

            if (!touched) alreadyFine += 1;
        }

        console.log('── deterministic repairs ──────────────────────────');
        console.log(`  entities re-resolved   : ${entityOps.length}`);
        console.log(`  stance corrected       : ${stanceOps.length}`);
        console.log(`  already correct        : ${alreadyFine}`);
        console.log('\n── needs an LLM pass ──────────────────────────────');
        console.log(`  missing category       : ${needLlm.length}`);
        if (needLlm.length) {
            console.log('  Category is the model\'s judgement and cannot be recovered');
            console.log('  from stored text. Run:  npm run rescore:mh -- --save');
        }

        if (DRY_RUN) {
            console.log('\n  DRY RUN — nothing written.\n');
            return;
        }
        if (!entityOps.length && !stanceOps.length) {
            console.log('\n  Nothing to write.\n');
            return;
        }

        if (entityOps.length) {
            const res = await Grievance.bulkWrite(entityOps, { ordered: false });
            console.log(`\n  entities: ${res.modifiedCount} rows updated`);
        }
        if (stanceOps.length) {
            const res = await Grievance.bulkWrite(stanceOps, { ordered: false });
            console.log(`  stance  : ${res.modifiedCount} rows updated`);
        }

        /* Prove it, rather than trust the write count. */
        const after = await Grievance.find({ vertical: VERTICAL })
            .select('content.text analysis.mentioned_entities analysis.political_stance').lean();
        const noEnt = after.filter((r) => !(r.analysis?.mentioned_entities || []).length
            && (findMentionedEntities((r.content && r.content.text) || '', VERTICAL) || []).length).length;
        console.log(`\n  rows still missing resolvable entities: ${noEnt}`);
        console.log(noEnt ? '  Some did not take — investigate.\n' : '  Every resolvable entity is now stored.\n');
    });

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
