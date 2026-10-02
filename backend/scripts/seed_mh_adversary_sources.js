#!/usr/bin/env node
/**
 * seed_mh_adversary_sources.js
 * ─────────────────────────────────────────────────────────────────────
 * Adds the accounts that post AGAINST the nine Maharashtra leaders to the
 * monitored Sources list, so the pipeline actually collects their posts.
 *
 * Classifying an attack account is useless if its posts are never fetched:
 * the adversary column stays empty for the best of reasons and the worst of
 * outcomes. This is the step that turns the roster into data.
 *
 * Everything written here carries `vertical: 'mh'`, so it never appears in
 * the live Chhattisgarh client's views.
 *
 * ── TIERS, BECAUSE QUOTA IS REAL ─────────────────────────────────────
 * Every monitored source is polled on every cycle, so each one costs API
 * calls forever. The roster is deliberately tiered by REACH, not by volume:
 *
 *   default      the 13 party, leader and campaign accounts — the ones with
 *                an audience. @amitmalviya alone has 855K followers and
 *                176,925 posts.
 *   --low-reach  also the anonymous high-volume accounts. @LifeOfAndolan1
 *                has posted 48,830 times to 548 followers; @Ambu750K 8,902
 *                times to 20. They generate text that essentially nobody
 *                sees. Add them only if the question is coordinated spam.
 *
 * Reference accounts (@MahaCyber1, @TimesNow, @kunalkamra88) are NEVER
 * seeded as adversaries — a state agency, a newsroom and a comedian are not
 * attack accounts, and filing them as such would corrupt share-of-voice.
 *
 *   node backend/scripts/seed_mh_adversary_sources.js --dry-run
 *   node backend/scripts/seed_mh_adversary_sources.js
 *   node backend/scripts/seed_mh_adversary_sources.js --low-reach
 *   node backend/scripts/seed_mh_adversary_sources.js --target mh-fadnavis
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const crypto = require('crypto');

const Source = require('../src/models/Source');
const ADV = require('../src/data/mh_adversary_handles.json');
const MH = require('../src/data/mh_leaders.json');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const LOW_REACH = argv.includes('--low-reach');
const targetArg = (() => { const i = argv.indexOf('--target'); return i >= 0 ? argv[i + 1] : null; })();

const VERTICAL = 'mh';
const SEED_ACTOR = 'seed_mh_adversary_sources';

const leaderName = (key) => {
    const l = MH.leaders.find((x) => x.key === key);
    return l ? l.name : key;
};

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}${DRY_RUN ? '   (DRY-RUN: nothing is written)' : ''}`);
    console.log(`Vertical: ${VERTICAL}\n`);

    let rows = [...ADV.accounts];
    if (LOW_REACH) rows = rows.concat(ADV.low_reach_accounts || []);

    if (targetArg) {
        const valid = new Set(MH.leaders.map((l) => l.key));
        if (!valid.has(targetArg)) {
            console.error(`Unknown --target "${targetArg}". Valid keys:\n  ${[...valid].join('\n  ')}`);
            process.exit(2);
        }
        rows = rows.filter((a) => (a.targets || []).includes(targetArg));
        console.log(`Filtered to accounts attacking ${leaderName(targetArg)}: ${rows.length}\n`);
    }

    // Loudest first, so a truncated run still gets the ones that matter.
    rows.sort((a, b) => (b.followers || 0) - (a.followers || 0));

    let added = 0; let existing = 0;
    console.log('handle'.padEnd(20) + 'followers'.padStart(11) + '  attacks');
    console.log('-'.repeat(72));

    for (const a of rows) {
        const identifier = `@${a.handle}`;
        const found = await Source.findOne({
            platform: 'x',
            identifier: new RegExp(`^${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        }).lean();

        const attacks = (a.targets || []).map(leaderName).join(', ');
        if (found) {
            existing += 1;
            console.log(`= ${identifier.padEnd(18)}${String(a.followers || 0).padStart(11)}  (already present)`);
            continue;
        }
        if (!DRY_RUN) {
            await Source.create({
                id: crypto.randomUUID(),
                platform: 'x',
                identifier,
                display_name: a.name || a.handle,
                category: 'political',
                is_active: true,
                follower_count: a.followers || 0,
                created_by: SEED_ACTOR,
                vertical: VERTICAL,
            });
        }
        added += 1;
        console.log(`+ ${identifier.padEnd(18)}${String(a.followers || 0).padStart(11)}  ${attacks}`);
    }

    console.log('-'.repeat(72));
    console.log(`${added} added, ${existing} already present\n`);

    if (!LOW_REACH && (ADV.low_reach_accounts || []).length) {
        const lr = ADV.low_reach_accounts;
        const reach = lr.reduce((n, a) => n + (a.followers || 0), 0);
        console.log(`${lr.length} low-reach accounts NOT seeded (${reach} followers between them).`);
        console.log('  Each would cost the same quota per cycle as an account reaching millions.');
        console.log('  Add with --low-reach if you specifically want coordinated-spam coverage.\n');
    }

    console.log(DRY_RUN
        ? 'DRY-RUN complete. Re-run without --dry-run to apply.'
        : 'Done. Verify with: npm run test:vertical:db');

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
