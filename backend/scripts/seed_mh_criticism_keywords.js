#!/usr/bin/env node
/**
 * seed_mh_criticism_keywords.js
 * ─────────────────────────────────────────────────────────────────────
 * Seeds the Keyword collection — what the Mentions page searches for — with
 * the terms criticism of the Maharashtra government, CM Devendra Fadnavis
 * and his constituency is actually being expressed in.
 *
 * Everything carries `vertical: 'mh'`, so none of it reaches the live
 * Chhattisgarh client's Mentions.
 *
 * ── TIERS, BECAUSE QUOTA IS NOT FREE ─────────────────────────────────
 * grievanceService.generateKeywordVariants turns ONE keyword into three
 * queries (@term, #term, term) across up to FOUR platforms — up to 12 API
 * calls per keyword per fetch cycle. All three tiers is ~43 terms, roughly
 * 500 calls a cycle, ON TOP OF the 9 leader sources, 18 leader keywords and
 * 13 adversary accounts already running.
 *
 *   tier 1   slogans in active use, found in reporting. Highest signal.
 *   tier 2   live issue terms (loan waiver, drought, ink row, Maratha quota).
 *   tier 3   constituency level — Nagpur South West. Low volume by design.
 *
 * ── WHAT THIS SCRIPT WILL NOT DO ─────────────────────────────────────
 * It will not seed a term the Keyword schema rejects, and it will not
 * silently coerce one. `language` must be in the model's enum and `category`
 * is required — both have already broken a seed here once, and a dry run
 * cannot catch it because a dry run never calls create().  This script
 * validates every row against the live schema BEFORE writing anything.
 *
 *   node backend/scripts/seed_mh_criticism_keywords.js --dry-run
 *   node backend/scripts/seed_mh_criticism_keywords.js --tier 1
 *   node backend/scripts/seed_mh_criticism_keywords.js --tier 1,2
 *   node backend/scripts/seed_mh_criticism_keywords.js --all
 *   node backend/scripts/seed_mh_criticism_keywords.js --tier 1 --no-hashtags
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const Keyword = require('../src/models/Keyword');
const DATA = require('../src/data/mh_criticism_keywords.json');

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const ALL = argv.includes('--all');
const NO_HASHTAGS = argv.includes('--no-hashtags');
const tierArg = (() => { const i = argv.indexOf('--tier'); return i >= 0 ? argv[i + 1] : null; })();

const VERTICAL = 'mh';
/**
 * The Keyword schema's `category` is a required enum of violence / threat /
 * hate / other. These are political criticism terms, not threat vocabulary —
 * 'other' is the honest value. Marking them 'hate' to make them look urgent
 * would poison any downstream filter that trusts the field.
 */
const CATEGORY = 'other';

const TIERS = ALL
    ? [1, 2, 3]
    : (tierArg ? tierArg.split(',').map((n) => Number(n.trim())).filter(Boolean) : [1]);

/* ── validate against the LIVE schema before touching the database ──── */
const schemaPath = (name) => Keyword.schema.path(name);
const enumOf = (name) => {
    const p = schemaPath(name);
    return (p && p.enumValues && p.enumValues.length) ? p.enumValues : null;
};

const validate = (rows) => {
    const problems = [];
    const langs = enumOf('language');
    const kinds = enumOf('kind');
    const cats = enumOf('category');

    if (cats && !cats.includes(CATEGORY)) {
        problems.push(`category "${CATEGORY}" is not in the schema enum [${cats.join(', ')}]`);
    }
    for (const r of rows) {
        if (!r.term || !String(r.term).trim()) problems.push('a row has an empty term');
        if (langs && !langs.includes(r.lang)) {
            problems.push(`"${r.term}": language "${r.lang}" is not in [${langs.join(', ')}] — add it to models/Keyword.js`);
        }
        if (kinds && !kinds.includes(r.kind)) {
            problems.push(`"${r.term}": kind "${r.kind}" is not in [${kinds.join(', ')}]`);
        }
    }
    return problems;
};

(async () => {
    let rows = DATA.keywords.filter((k) => TIERS.includes(k.tier));
    if (NO_HASHTAGS) rows = rows.filter((k) => k.kind !== 'hashtag');

    if (rows.length === 0) {
        console.error(`No keywords for tier(s) ${TIERS.join(',')}. Valid tiers: 1, 2, 3.`);
        process.exit(2);
    }

    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}${DRY_RUN ? '   (DRY-RUN: nothing is written)' : ''}`);
    console.log(`Vertical: ${VERTICAL}    Tier(s): ${TIERS.join(', ')}\n`);

    /* Fail before writing, not halfway through. */
    const problems = validate(rows);
    if (problems.length) {
        console.error('Schema validation failed — NOTHING was written:\n');
        for (const p of problems) console.error(`  ✖ ${p}`);
        await mongoose.disconnect();
        process.exit(1);
    }

    const byLang = {};
    for (const r of rows) byLang[r.lang] = (byLang[r.lang] || 0) + 1;
    const hashtags = rows.filter((r) => r.kind === 'hashtag').length;

    console.log(`${rows.length} terms — ${Object.entries(byLang).map(([l, n]) => `${l}:${n}`).join('  ')}`
        + `${hashtags ? `  (${hashtags} hashtags)` : ''}`);
    console.log(`≈ ${rows.length * 12} API calls per fetch cycle at worst\n`);

    let added = 0; let existing = 0;
    for (const r of rows.sort((a, b) => b.weight - a.weight)) {
        const found = await Keyword.findOne({ keyword: r.term, vertical: VERTICAL }).lean();
        if (found) {
            existing += 1;
            console.log(`  = ${r.term}`);
            continue;
        }
        if (!DRY_RUN) {
            await Keyword.create({
                keyword: r.term,
                kind: r.kind || 'keyword',
                category: CATEGORY,
                language: r.lang,
                weight: r.weight || 50,
                is_active: true,
                is_party_wide: true,
                vertical: VERTICAL,
            });
        }
        added += 1;
        console.log(`  + ${String(r.term).padEnd(32)} [${r.lang}/${r.kind}, w${r.weight}]${r.about ? `  ${r.about}` : ''}`);
    }

    console.log(`\n  ${added} added, ${existing} already present\n`);

    if (!ALL) {
        const remaining = DATA.keywords.filter((k) => !TIERS.includes(k.tier)).length;
        if (remaining) console.log(`${remaining} terms in other tiers not seeded. Widen with --tier 1,2 or --all.\n`);
    }

    console.log('⚠ gaddar, 50 khoke and vote chori target the Mahayuti broadly and land most');
    console.log('  often on Eknath Shinde, who is also one of the nine. A spike in them is not');
    console.log('  automatically criticism of the Chief Minister — check the target.\n');

    console.log(DRY_RUN
        ? 'DRY-RUN complete. Re-run without --dry-run to apply.'
        : 'Done. Check what arrives with: npm run report:mh -- --days 1');

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
