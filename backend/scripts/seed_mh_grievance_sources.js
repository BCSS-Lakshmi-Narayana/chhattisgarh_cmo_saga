#!/usr/bin/env node
/**
 * seed_mh_grievance_sources.js
 * ─────────────────────────────────────────────────────────────────────
 * Adds the Maharashtra leaders' official handles to GrievanceSource — the
 * collection behind the Mentions page's "Official Handle" filter and its
 * grievance fetch.
 *
 * ── THIS IS A DIFFERENT COLLECTION FROM `Source` ─────────────────────
 * `Source` drives the Profiles / monitored-accounts view: what an account
 * POSTS. `GrievanceSource` drives Mentions: what people post AT an account,
 * i.e. the mentions and replies directed at it. Seeding one does not
 * populate the other, and the Mentions page stays empty with "Add source
 * accounts and fetch grievances to get started" no matter how many Sources
 * exist. Both are needed, for different questions.
 *
 * Everything carries `vertical: 'mh'`, so none of it reaches the live
 * Chhattisgarh client's Mentions page.
 *
 *   node backend/scripts/seed_mh_grievance_sources.js --dry-run
 *   node backend/scripts/seed_mh_grievance_sources.js
 *   node backend/scripts/seed_mh_grievance_sources.js --with-adversaries
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const GrievanceSource = require('../src/models/GrievanceSource');
const MH = require('../src/data/mh_leaders.json');
const ADV = require('../src/data/mh_adversary_handles.json');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const WITH_ADVERSARIES = argv.includes('--with-adversaries');

const VERTICAL = 'mh';
const SEED_ACTOR = 'seed_mh_grievance_sources';

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}${DRY_RUN ? '   (DRY-RUN: nothing is written)' : ''}`);
    console.log(`Vertical: ${VERTICAL}\n`);

    const rows = MH.leaders.map((l) => ({
        handle: l.handle,
        display_name: l.name,
        followers: l.followers,
        why: l.role,
    }));

    if (WITH_ADVERSARIES) {
        for (const a of ADV.accounts) {
            rows.push({
                handle: a.handle,
                display_name: a.name || a.handle,
                followers: a.followers,
                why: `attacks ${(a.targets || []).length} of the nine`,
            });
        }
    }

    let added = 0; let existing = 0;
    for (const r of rows.sort((a, b) => (b.followers || 0) - (a.followers || 0))) {
        // Handles are WRITTEN without '@', but rows created by other paths
        // store them WITH one. Matching only the bare form meant the five
        // leaders already present as "@Dev_Fadnavis" were not recognised, and
        // a second row "Dev_Fadnavis" was created beside each — so five of
        // the nine were fetched twice and listed twice in the Mentions
        // filter. The optional '@' makes the check see both spellings.
        const clean = String(r.handle).replace(/^@+/, '');
        const found = await GrievanceSource.findOne({
            platform: 'x',
            handle: new RegExp(`^@?${clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'),
        }).lean();

        if (found) {
            existing += 1;
            console.log(`  = @${clean.padEnd(20)} already present`);
            continue;
        }
        if (!DRY_RUN) {
            await GrievanceSource.create({
                handle: clean,
                platform: 'x',
                display_name: r.display_name,
                is_active: true,
                created_by: SEED_ACTOR,
                vertical: VERTICAL,
            });
        }
        added += 1;
        console.log(`  + @${clean.padEnd(20)}${String(r.followers || 0).padStart(10)}  ${r.display_name} — ${r.why}`);
    }

    console.log(`\n  ${added} added, ${existing} already present\n`);

    if (!WITH_ADVERSARIES) {
        console.log(`${ADV.accounts.length} adversary accounts NOT added as grievance sources.`);
        console.log('  Mentions AT an attack account are mostly its own supporters arguing with it,');
        console.log('  which is a different question from what people say about the nine leaders.');
        console.log('  Add with --with-adversaries only if you want that.\n');
    }

    console.log(DRY_RUN
        ? 'DRY-RUN complete. Re-run without --dry-run to apply.'
        : 'Done. The Mentions page "Official Handle" filter will now list these.\n'
          + 'Fetch with: npm run seed:keywords -- --fetch   (or wait for the scheduler)');

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
