#!/usr/bin/env node
/**
 * seed_mh_anti_govt_sources.js
 * ─────────────────────────────────────────────────────────────────────
 * Adds the eight accounts posting against the Maharashtra GOVERNMENT side
 * of the watch list (Fadnavis, Eknath Shinde, Sunetra Pawar, Shrikant
 * Shinde) to the monitored Source list, and creates a linked POI for each.
 *
 * Every field the Source and POI schemas offer is filled from verified data
 * rather than left blank: follower counts and display names come from the
 * live api.fxtwitter.com fetch recorded in mh_adversary_handles.json, and
 * each POI's briefSummary states which of the nine the account targets.
 *
 * ── THE LINK IS socialMedia[].sourceId ───────────────────────────────
 * A POI is linked to its monitored account by storing the Source's `id` in
 * `socialMedia[].sourceId`. Created in that order — Source first, then POI
 * with the id — so the link is never dangling. A POI with a null sourceId
 * still displays, but nothing ties it to collected content, which is the
 * failure that makes the Profile page look populated and empty at once.
 *
 * Everything carries `vertical: 'mh'`.
 *
 *   node backend/scripts/seed_mh_anti_govt_sources.js --dry-run
 *   node backend/scripts/seed_mh_anti_govt_sources.js
 *   node backend/scripts/seed_mh_anti_govt_sources.js --no-poi
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const crypto = require('crypto');

const Source = require('../src/models/Source');
const POI = require('../src/models/POI');
const ADV = require('../src/data/mh_adversary_handles.json');
const MH = require('../src/data/mh_leaders.json');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const NO_POI = argv.includes('--no-poi');

const VERTICAL = 'mh';
const SEED_ACTOR = 'seed_mh_anti_govt_sources';

/** The government side of the nine — who these accounts attack. */
const GOVT_KEYS = MH.leaders.filter((l) => l.alignment === 'ally').map((l) => l.key);
const nameOf = (key) => (MH.leaders.find((l) => l.key === key) || {}).name || key;

/** Reach decides priority: a post nobody sees does not move sentiment. */
const priorityFor = (followers) => {
    if (followers >= 1000000) return 'high';
    if (followers >= 250000) return 'medium';
    return 'low';
};

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}${DRY_RUN ? '   (DRY-RUN: nothing is written)' : ''}`);
    console.log(`Vertical: ${VERTICAL}\n`);

    // Accounts that attack at least one government-side leader.
    const rows = ADV.accounts
        .filter((a) => (a.targets || []).some((k) => GOVT_KEYS.includes(k)))
        .sort((a, b) => (b.followers || 0) - (a.followers || 0));

    console.log(`${rows.length} accounts attacking the government side `
        + `(${GOVT_KEYS.map(nameOf).join(', ')})\n`);

    let srcAdded = 0; let srcExisting = 0; let poiAdded = 0; let poiExisting = 0; let linked = 0;

    for (const a of rows) {
        const identifier = `@${a.handle}`;
        const rx = new RegExp(`^${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
        const attacks = (a.targets || []).filter((k) => GOVT_KEYS.includes(k)).map(nameOf);

        /* ── 1. Source ─────────────────────────────────────────────── */
        let source = await Source.findOne({ platform: 'x', identifier: rx }).lean();
        if (source) {
            srcExisting += 1;
        } else {
            const doc = {
                id: crypto.randomUUID(),
                platform: 'x',
                identifier,
                display_name: a.name || a.handle,
                category: 'political',
                priority: priorityFor(a.followers || 0),
                is_active: true,
                is_verified: true, // every handle here was resolved live via fxtwitter
                created_by: SEED_ACTOR,
                follower_count: a.followers || 0,
                risk_level: 'low', // adversarial ≠ dangerous; reserve risk for threat content
                is_party_wide: true,
                vertical: VERTICAL,
            };
            if (!DRY_RUN) await Source.create(doc);
            source = doc;
            srcAdded += 1;
        }

        console.log(`  ${identifier.padEnd(20)}${String(a.followers || 0).padStart(10)}  `
            + `[${priorityFor(a.followers || 0)}]  attacks: ${attacks.join(', ')}`);

        if (NO_POI) continue;

        /* ── 2. POI, linked to that Source by id ───────────────────── */
        const existingPoi = await POI.findOne({ 'socialMedia.handle': a.handle }).lean();
        if (existingPoi) { poiExisting += 1; continue; }

        const summary = `${a.name || a.handle} (${a.camp}${a.party ? `, ${a.party}` : ''}). `
            + `Posts against: ${attacks.join(', ')}. `
            + `${(a.followers || 0).toLocaleString()} followers, ${(a.posts || 0).toLocaleString()} posts `
            + `as at ${a.verified_on}. ${a.note ? a.note.replace(/^⚠\s*/, '') : ''}`.trim();

        if (!DRY_RUN) {
            await POI.create({
                name: a.name || a.handle,
                realName: a.name || null,
                aliasNames: [a.handle],
                briefSummary: summary,
                status: 'active',
                is_party_wide: true,
                createdBy: SEED_ACTOR,
                vertical: VERTICAL,
                socialMedia: [{
                    platform: 'x',
                    sourceId: source.id, // ← the link
                    handle: a.handle,
                    displayName: a.name || a.handle,
                }],
            });
        }
        poiAdded += 1;
        linked += 1;
    }

    console.log(`\n  sources: ${srcAdded} added, ${srcExisting} already present`);
    if (!NO_POI) console.log(`  POIs   : ${poiAdded} added, ${poiExisting} already present  (${linked} linked to a source)`);

    console.log(`\n  ≈ ${rows.length} extra profile polls per monitoring cycle.`);
    console.log(DRY_RUN
        ? '\nDRY-RUN complete. Re-run without --dry-run to apply.'
        : '\nDone. Verify: npm run test:vertical:db');

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
