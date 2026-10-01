#!/usr/bin/env node
/**
 * test_vertical_isolation.js
 * ─────────────────────────────────────────────────────────────────────
 * Proves the two clients cannot see each other's data.
 *
 * ── WHY THIS TEST AND NOT A CODE REVIEW ──────────────────────────────
 * A missed vertical filter does not throw. Nothing goes red. The live
 * Chhattisgarh client's dashboard simply shows a number that quietly includes
 * Maharashtra rows, and nobody finds out. Reading 887 call sites and deciding
 * they look right is not evidence. Running the queries under each identity and
 * comparing the answers is.
 *
 * Part 1 needs no database — it checks the mechanism.
 * Part 2 needs the database and checks the real collections.
 *
 *   node backend/scripts/test_vertical_isolation.js            mechanism only
 *   node backend/scripts/test_vertical_isolation.js --db       also hit the DB
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const {
    runWithVerticals, currentVerticals, verticalsForUser, DEFAULT_VERTICAL,
} = require('../src/config/verticals');
const { assertNoEstimatedCounts } = require('../src/utils/verticalScope');

const WITH_DB = process.argv.includes('--db');

let pass = 0; let fail = 0;
const t = (name, actual, expected) => {
    const a = JSON.stringify(actual); const e = JSON.stringify(expected);
    if (a === e) { pass += 1; return; }
    fail += 1;
    console.log(`  ✖ ${name}\n      expected ${e}\n      got      ${a}`);
};
const ok = (name, cond) => t(name, !!cond, true);

console.log('\n── 1. the mechanism ───────────────────────────────────────');

/* Defaulting. Every account that predates this feature must stay Chhattisgarh. */
t('user with no verticals → cg', verticalsForUser({}), ['cg']);
t('user with null verticals → cg', verticalsForUser({ verticals: null }), ['cg']);
t('user with [] → cg', verticalsForUser({ verticals: [] }), ['cg']);
t('superadmin with no verticals → cg (NOT everything)',
    verticalsForUser({ role: 'superadmin' }), ['cg']);
t('mh user → mh only', verticalsForUser({ verticals: ['mh'] }), ['mh']);
t('unknown vertical is discarded, falls back to cg',
    verticalsForUser({ verticals: ['elbonia'] }), ['cg']);
t('case and whitespace normalised', verticalsForUser({ verticals: ['  MH '] }), ['mh']);
t('duplicates collapse', verticalsForUser({ verticals: ['mh', 'mh'] }), ['mh']);

/* Context. Outside a request there must be no filter, or collection breaks. */
t('no context ⇒ unscoped', currentVerticals(), null);
runWithVerticals(['cg'], () => t('inside cg context', currentVerticals(), ['cg']));
runWithVerticals(['mh'], () => t('inside mh context', currentVerticals(), ['mh']));
t('context does not leak out of run()', currentVerticals(), null);

/* Async propagation — the whole point of AsyncLocalStorage. A context that
 * does not survive an await would silently unscope every real controller. */
(async () => {
    await runWithVerticals(['mh'], async () => {
        await new Promise((r) => setTimeout(r, 1));
        t('context survives await', currentVerticals(), ['mh']);
        await Promise.all([
            (async () => { t('context survives Promise.all branch', currentVerticals(), ['mh']); })(),
        ]);
    });

    /* ── the lazy-thenable trap ──────────────────────────────────────
     * A Mongoose query runs nothing until it is awaited, and the filter hook
     * fires at execution time. So a callback that RETURNS a query rather than
     * awaiting it used to execute outside the store, with no filter at all —
     * which showed up as both clients reporting identical row counts while
     * every other check passed. runWithVerticals now awaits inside the store;
     * this asserts it stays that way. */
    const deferred = await runWithVerticals(['mh'], () => ({
        then: (resolve) => resolve(currentVerticals()),
    }));
    t('a thenable returned by the callback resolves INSIDE the context',
        deferred, ['mh']);
    t('a plain value still comes back untouched',
        await runWithVerticals(['cg'], () => 'ok'), 'ok');

    /* estimatedDocumentCount cannot be filtered — there must be none. */
    const estimated = assertNoEstimatedCounts(require('path').resolve(__dirname, '../src'));
    ok(`no estimatedDocumentCount on scoped data (found ${estimated.length})`, estimated.length === 0);
    if (estimated.length) estimated.forEach((e) => console.log(`      ${e}`));

    /* Raw driver access must all be wrapped. A bare db.collection() bypasses
     * Mongoose middleware entirely — this is the hole the plugin cannot see. */
    const fs = require('fs'); const path = require('path');
    const unwrapped = [];
    const walk = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { walk(full); continue; }
            if (!e.name.endsWith('.js')) continue;
            if (full.includes('verticalScope')) continue; // defines the wrapper
            fs.readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
                if (/(^|[^d\w])db\.collection\(/.test(line) && !line.includes('scopedCollection')) {
                    unwrapped.push(`${full}:${i + 1}`);
                }
            });
        }
    };
    walk(path.resolve(__dirname, '../src'));
    // Scripts under src/scripts run as CLI with no request context, so they are
    // unscoped by design and excluded.
    const serving = unwrapped.filter((u) => !u.includes(`${path.sep}scripts${path.sep}`));
    ok(`every request-path db.collection() is wrapped (found ${serving.length} bare)`, serving.length === 0);
    serving.forEach((u) => console.log(`      ${u}`));

    if (!WITH_DB) {
        report();
        return;
    }

    console.log('\n── 2. against the real database ───────────────────────────');
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`  database: ${mongoose.connection.name}\n`);

    const Content = require('../src/models/Content');
    const Grievance = require('../src/models/Grievance');
    const Alert = require('../src/models/Alert');
    const MODELS = { Content, Grievance, Alert };

    /* Untagged rows are invisible to EVERY user, so they must be zero before
     * this goes live.
     *
     * But it is a WARNING here, not a failure, and the distinction matters:
     * until the app is restarted on the new code it carries on writing rows
     * with no vertical, so this can never be zero pre-deploy. Failing on it
     * would make the whole suite permanently red for an expected reason and
     * hide a real isolation break behind a known one. The isolation
     * assertions below subtract untagged rows and stay strict. */
    let untaggedTotal = 0;
    for (const [name, Model] of Object.entries(MODELS)) {
        const untagged = await Model.collection.countDocuments({ vertical: { $exists: false } });
        untaggedTotal += untagged;
        if (untagged > 0) console.log(`  ⚠ ${name}: ${untagged} untagged rows`);
    }
    if (untaggedTotal > 0) {
        console.log(`  ⚠ ${untaggedTotal} rows carry no vertical and are invisible to every user.`);
        console.log('    Expected while the OLD code is still running and collecting.');
        console.log('    After the restart: npm run backfill:vertical && npm run backfill:vertical -- --verify\n');
    } else {
        pass += 1; // a clean database is worth an assertion of its own
        console.log('  ✓ every row carries a vertical\n');
    }

    /* The headline property: every row belongs to exactly one side.
     *
     * Untagged rows are counted separately rather than folded in. While the
     * old code is still running it keeps writing rows with no vertical, so a
     * bare `cg + mh === total` would fail for a reason that has nothing to do
     * with isolation and would mask a real leak behind a known one. */
    for (const [name, Model] of Object.entries(MODELS)) {
        const total = await Model.collection.countDocuments({});
        const untagged = await Model.collection.countDocuments({ vertical: { $exists: false } });
        const cg = await runWithVerticals(['cg'], () => Model.countDocuments({}));
        const mh = await runWithVerticals(['mh'], () => Model.countDocuments({}));
        t(`${name}: cg + mh + untagged === total (${cg} + ${mh} + ${untagged} === ${total})`,
            cg + mh + untagged, total);
        ok(`${name}: cg count (${cg}) excludes mh`, cg === total - mh - untagged);

        /* Aggregates are the easy thing to get wrong: a $match appended after
         * a $group has already counted the other client's rows. */
        const agg = await runWithVerticals(['cg'], () => Model.aggregate([
            { $group: { _id: null, n: { $sum: 1 } } },
        ]));
        t(`${name}: aggregate under cg matches cg count`, agg[0] ? agg[0].n : 0, cg);
    }

    /* And the direction that matters most: the Maharashtra login must never
     * see a single Chhattisgarh row. */
    const cgLeak = await runWithVerticals(['mh'], () => Content.countDocuments({ vertical: 'cg' }));
    t('mh user sees zero cg content', cgLeak, 0);
    const mhLeak = await runWithVerticals(['cg'], () => Content.countDocuments({ vertical: 'mh' }));
    t('cg user sees zero mh content', mhLeak, 0);

    await mongoose.disconnect();
    report();
})();

function report() {
    console.log(`\n  ${pass} passed, ${fail} failed`);
    if (!WITH_DB) console.log('  (run with --db to also check the live collections)\n');
    else console.log('');
    process.exit(fail === 0 ? 0 : 1);
}
