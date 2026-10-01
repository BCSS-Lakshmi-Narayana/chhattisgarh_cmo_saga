#!/usr/bin/env node
/**
 * seed_mh_vertical.js
 * ─────────────────────────────────────────────────────────────────────
 * Seeds the Maharashtra vertical into the SAME database as the live
 * Chhattisgarh client: the 9 leaders' accounts as sources, their names as
 * keywords, and the one login allowed to see any of it.
 *
 * Everything written here carries `vertical: 'mh'`, so the Chhattisgarh
 * client's views never show it — see utils/verticalScope.js.
 *
 * ⚠ RUN backfill_vertical_cg.js FIRST. If existing rows are still untagged
 * when the filter goes live, the Chhattisgarh client's dashboards go blank.
 *
 * ── API QUOTA: READ THIS BEFORE USING --extended ─────────────────────
 * grievanceService.generateKeywordVariants turns ONE keyword into three
 * queries (`@term`, `#term`, `term`) across up to FOUR platforms — up to 12
 * API calls per keyword per run. 9 core keywords is ~108 calls per cycle;
 * the full alias list is roughly three times that. Start with --core, look at
 * what comes back, then widen.
 *
 *   node backend/scripts/seed_mh_vertical.js --dry-run
 *   node backend/scripts/seed_mh_vertical.js --core
 *   node backend/scripts/seed_mh_vertical.js --extended
 *   node backend/scripts/seed_mh_vertical.js --user <email> --password <pw>
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const Source = require('../src/models/Source');
const Keyword = require('../src/models/Keyword');
const User = require('../src/models/User');
const PagePermission = require('../src/models/PagePermission');
const { ALL_PAGES, PAGE_FEATURES } = require('../src/config/rbacConfig');
const MH = require('../src/data/mh_leaders.json');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const EXTENDED = argv.includes('--extended');
const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const USER_EMAIL = arg('--user');
const USER_PASSWORD = arg('--password');

const VERTICAL = 'mh';
/** Recorded as the creator of every seeded row, for the audit trail. */
const SEED_ACTOR = 'seed_mh_vertical';

/**
 * CORE keywords — one canonical name per leader, plus Devanagari where the
 * leader is discussed mainly in Marathi.
 *
 * Jarange Patil is the reason the Devanagari forms are core rather than
 * extended: his own account has 13 posts, so he is only visible in what other
 * people write, and most of that is in Marathi.
 */
const coreKeywords = () => MH.leaders.flatMap((l) => {
    const devanagari = l.aliases.filter((a) => /[ऀ-ॿ]/.test(a));
    return [l.name, ...(devanagari.length ? [devanagari[0]] : [])];
});

/** EXTENDED adds every spelling variant, including the manager's own. */
const extendedKeywords = () => MH.leaders.flatMap((l) => l.aliases);

/* ─── page permissions ───────────────────────────────────────────────
 * Creating the User row is not enough. RBAC denies every page to a login
 * with no PagePermission document, so the account logs in successfully and
 * then sees "Access Denied" on all of them — the vertical filter never even
 * gets a chance to run. seed_mla_mp_accounts.js already grants these for the
 * MLA/MP logins; the same mechanism is reused here rather than reinvented.
 *
 * Everything EXCEPT /access-management: that is the super-admin console for
 * managing other people's logins, and this account has no business there.
 */
const ADMIN_ONLY = new Set(['/access-management']);

const buildPermissions = () => {
    const permissions = {};
    for (const page of ALL_PAGES) {
        if (ADMIN_ONLY.has(page.path)) continue;
        permissions[page.path] = {
            enabled: true,
            features: (PAGE_FEATURES[page.path] || []).map((f) => f.id),
        };
    }
    return permissions;
};

const grantPages = async (userId) => {
    const permissions = buildPermissions();
    await PagePermission.updateOne(
        { user_id: userId },
        {
            $set: {
                allowed_pages: Object.keys(permissions),
                permissions,
                updated_by: SEED_ACTOR,
                updated_at: new Date(),
            },
            $setOnInsert: { user_id: userId },
        },
        { upsert: true },
    );
    return Object.keys(permissions);
};

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}${DRY_RUN ? '   (DRY-RUN: nothing is written)' : ''}`);
    console.log(`Vertical: ${VERTICAL}\n`);

    /* ── 1. sources: the leaders' own accounts ───────────────────────── */
    console.log('Sources (X accounts):');
    let added = 0; let existing = 0;
    for (const l of MH.leaders) {
        const identifier = `@${l.handle}`;
        const found = await Source.findOne({ platform: 'x', identifier: new RegExp(`^${identifier}$`, 'i') }).lean();
        if (found) { existing += 1; console.log(`  = ${identifier.padEnd(20)} already present`); continue; }
        if (DRY_RUN) { added += 1; console.log(`  + ${identifier.padEnd(20)} ${l.name}`); continue; }
        await Source.create({
            id: crypto.randomUUID(),
            platform: 'x',
            identifier,
            display_name: l.name,
            category: 'political',
            is_active: true,
            follower_count: l.followers,
            // Required by the Source schema. Without it create() throws a
            // validation error that --dry-run cannot surface, because a dry
            // run never calls create().
            created_by: SEED_ACTOR,
            vertical: VERTICAL,
        });
        added += 1;
        console.log(`  + ${identifier.padEnd(20)} ${l.name}`);
    }
    console.log(`  ${added} added, ${existing} already present\n`);

    /* ── 2. keywords ─────────────────────────────────────────────────── */
    const words = [...new Set(EXTENDED ? extendedKeywords() : coreKeywords())];
    console.log(`Keywords (${EXTENDED ? 'extended' : 'core'}): ${words.length}`);
    console.log(`  ≈ ${words.length * 12} API calls per fetch cycle at worst — see the quota note in this file's header`);
    let kAdded = 0; let kExisting = 0;
    for (const w of words) {
        const found = await Keyword.findOne({ keyword: w, vertical: VERTICAL }).lean();
        if (found) { kExisting += 1; continue; }
        if (!DRY_RUN) {
            // `category` is a required enum on Keyword — 'other' is the
            // neutral value; these are leader-name trackers, not threat terms.
            await Keyword.create({ keyword: w, category: 'other', is_active: true, vertical: VERTICAL });
        }
        kAdded += 1;
    }
    console.log(`  ${kAdded} added, ${kExisting} already present\n`);

    /* ── 3. the one login that may see any of this ───────────────────── */
    if (USER_EMAIL) {
        const password = USER_PASSWORD || crypto.randomBytes(9).toString('base64url');
        const found = await User.findOne({ email: USER_EMAIL });
        let userId = found ? found.id : null;
        if (found) {
            console.log(`User: ${USER_EMAIL} exists — setting verticals to ['${VERTICAL}']`);
            if (!DRY_RUN) { found.verticals = [VERTICAL]; await found.save(); }
        } else {
            console.log(`User: creating ${USER_EMAIL} with verticals ['${VERTICAL}']`);
            userId = crypto.randomUUID();
            if (!DRY_RUN) {
                await User.create({
                    id: userId,
                    email: USER_EMAIL,
                    full_name: 'Maharashtra Report',
                    password: await bcrypt.hash(password, 10),
                    role: 'analyst',
                    is_active: true,
                    verticals: [VERTICAL],
                });
            }
            if (!USER_PASSWORD) console.log(`  password (shown once): ${password}`);
        }

        // Without this the login succeeds and every page answers 403.
        if (!DRY_RUN && userId) {
            const granted = await grantPages(userId);
            console.log(`  granted ${granted.length} pages (all except ${[...ADMIN_ONLY].join(', ')})`);
        } else if (DRY_RUN) {
            console.log(`  would grant ${Object.keys(buildPermissions()).length} pages`);
        }
        console.log('');
    } else {
        console.log('User: skipped — pass --user <email> to create the Maharashtra login\n');
    }

    console.log(DRY_RUN
        ? 'DRY-RUN complete. Re-run without --dry-run to apply.'
        : 'Done. Now run: node backend/scripts/test_vertical_isolation.js --db');

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
