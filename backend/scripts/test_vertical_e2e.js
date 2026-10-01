#!/usr/bin/env node
/**
 * test_vertical_e2e.js
 * ─────────────────────────────────────────────────────────────────────
 * End-to-end proof that the two clients are separated, using real documents.
 *
 * `test_vertical_isolation.js` checks the MECHANISM — defaults, context
 * propagation, that no unwrapped driver call exists. This file checks the
 * BEHAVIOUR: it writes real Chhattisgarh and Maharashtra documents, reads them
 * back under each identity through every query shape the application actually
 * uses, and asserts that neither client can see the other.
 *
 * ── WHY FIXTURES AND NOT THE LIVE ROWS ───────────────────────────────
 * Asserting against whatever happens to be in the database proves nothing: if
 * no Maharashtra rows exist yet, "the CG user sees no MH data" passes while
 * the filter is completely broken. Known documents with known answers are the
 * only way for the arithmetic to be wrong loudly.
 *
 * ── SAFETY ───────────────────────────────────────────────────────────
 * This runs against the LIVE database. Every fixture is tagged
 * `__vtest__: true` and removed in a `finally`, including on failure or
 * Ctrl-C. Before and after, it counts the documents that are NOT fixtures and
 * asserts the number is unchanged — so the test proves it did not disturb the
 * live client's data either.
 *
 *   node backend/scripts/test_vertical_e2e.js          logic only, no DB
 *   node backend/scripts/test_vertical_e2e.js --db     full end-to-end
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const mongoose = require('mongoose');
const crypto = require('crypto');
const { runWithVerticals, currentVerticals } = require('../src/config/verticals');
const { hasStateSignal } = require('../src/utils/stateSignal');
const { scopedCollection } = require('../src/utils/verticalScope');
const { buildReport, alignToPerson, matchesLeader } = require('./mh_daily_report');
const MH = require('../src/data/mh_leaders.json');

const WITH_DB = process.argv.includes('--db');
const TAG = '__vtest__';

let pass = 0; let fail = 0;
const t = (name, actual, expected) => {
    const a = JSON.stringify(actual); const e = JSON.stringify(expected);
    if (a === e) { pass += 1; return; }
    fail += 1;
    console.log(`  ✖ ${name}\n      expected ${e}\n      got      ${a}`);
};
const ok = (name, cond) => t(name, !!cond, true);

/* ══════════════════════════════════════════════════════════════════════
   PART 1 — the data rules, no database needed
   ══════════════════════════════════════════════════════════════════ */
console.log('\n── 1. state gate: each vertical, both directions ──────────');

const GATE_CASES = [
    ['Fadnavis announced a new Mumbai metro line', 'mh', true, 'leader + city'],
    ['मनोज जरांगे पाटील यांचे उपोषण सुरू', 'mh', true, 'Devanagari leader name'],
    ['Maratha quota stir spreads across Beed', 'mh', true, 'district'],
    ['Protest in Chhatrapati Sambhajinagar', 'mh', true, 'renamed district'],
    ['Protest in Aurangabad', 'mh', true, 'OLD district name still in use'],
    ['Aaditya Thakre slams the government', 'mh', true, "manager's spelling of Thackeray"],
    ['Srikanth Shinde visits Kalyan', 'mh', true, "manager's spelling of Shrikant"],
    ['Random post about Bengaluru traffic', 'mh', false, 'unrelated state'],
    // The direction that protects the live client.
    ['Fadnavis announced a new Mumbai metro line', 'cg', false, 'MH post must NOT pass CG gate'],
    ['Protest in Aurangabad', 'cg', false, 'MH district must NOT pass CG gate'],
    ['मनोज जरांगे पाटील यांचे उपोषण सुरू', 'cg', false, 'Devanagari MH name must NOT pass CG gate'],
    ['Raipur mein bijli ki samasya, Vishnu Deo Sai ji', 'cg', true, 'CG post still passes CG gate'],
    ['Raipur mein bijli ki samasya, Vishnu Deo Sai ji', 'mh', false, 'CG post must NOT pass MH gate'],
];
for (const [text, vertical, want, why] of GATE_CASES) {
    t(`[${vertical}] ${why}`, hasStateSignal(text, [], vertical), want);
}

/* The default argument is what keeps every pre-existing call site unchanged. */
t('omitting the vertical behaves exactly as cg',
    hasStateSignal('Fadnavis in Mumbai', []), hasStateSignal('Fadnavis in Mumbai', [], 'cg'));

console.log('\n── 2. roster data ─────────────────────────────────────────');

t('nine leaders', MH.leaders.length, 9);
ok('every leader has a verified handle', MH.leaders.every((l) => l.handle && l.handle.length > 2));
ok('every leader has a verified_on date',
    MH.leaders.every((l) => /^\d{4}-\d{2}-\d{2}$/.test(l.verified_on)));
ok('every leader has an alignment the report can use',
    MH.leaders.every((l) => ['ally', 'opposition'].includes(l.alignment)));
ok('handles are unique', new Set(MH.leaders.map((l) => l.handle.toLowerCase())).size === 9);

/* The spellings in the manager's message must all resolve, or most of the
 * corpus is invisible. This is the check that would have caught it. */
const MANAGER_SPELLINGS = [
    ['Aditya Thakre', 'mh-aaditya-thackeray'],
    ['Raj Thakre', 'mh-raj-thackeray'],
    ['Manoj Jayrange Patil', 'mh-jarange-patil'],
    ['Dr. Srikanth Shinde', 'mh-shrikant-shinde'],
    ['Sunetra Pawar', 'mh-sunetra-pawar'],
];
for (const [spelling, key] of MANAGER_SPELLINGS) {
    const leader = MH.leaders.find((l) => l.key === key);
    ok(`"${spelling}" resolves to ${leader.name}`, matchesLeader(spelling, leader));
}

/* Surnames are shared across both camps here — matching on one would put an
 * attack on Sharad Pawar under Sunetra Pawar's name, and flip its sign. */
const sharad = MH.leaders.find((l) => l.key === 'mh-sharad-pawar');
const sunetra = MH.leaders.find((l) => l.key === 'mh-sunetra-pawar');
ok('"Sharad Pawar" does not match Sunetra Pawar', !matchesLeader('Sharad Pawar', sunetra));
ok('"Sunetra Pawar" does not match Sharad Pawar', !matchesLeader('Sunetra Pawar', sharad));
const eknath = MH.leaders.find((l) => l.key === 'mh-eknath-shinde');
ok('"Shrikant Shinde" does not match Eknath Shinde', !matchesLeader('Shrikant Shinde', eknath));

console.log('\n── 3. sentiment is person-relative ────────────────────────');

t('attack on an opposition leader reads negative FOR THEM',
    alignToPerson('positive', 'opposition'), 'negative');
t('praise of an opposition leader reads positive for them',
    alignToPerson('negative', 'opposition'), 'positive');
t('an ally is already person-relative', alignToPerson('positive', 'ally'), 'positive');
t('neutral is unaffected either way', alignToPerson('neutral', 'opposition'), 'neutral');

/* The arithmetic, over fixtures with a known answer. */
const now = new Date();
const docs = [
    { text: 'Sharad Pawar criticised over party split', analysis: { target_sentiment: 'positive' }, platform: 'x' },
    { text: 'Sharad Pawar praised for farm stand', analysis: { target_sentiment: 'negative' }, platform: 'x' },
    { text: 'Devendra Fadnavis launches Mumbai project', analysis: { target_sentiment: 'positive' }, platform: 'x' },
];
const rep = buildReport(docs, { from: now, to: now });
const sp = rep.leaders.find((l) => l.name === 'Sharad Pawar');
const df = rep.leaders.find((l) => l.name === 'Devendra Fadnavis');
t('Sharad Pawar: 1 mention scored negative for him', sp.sentiment.negative, 1);
t('Sharad Pawar: 1 mention scored positive for him', sp.sentiment.positive, 1);
t('Fadnavis (ally): client-positive stays positive', df.sentiment.positive, 1);
t('report counts every document', rep.collected_total, 3);

/* ── the cache is a second, separate way to leak ─────────────────────
 * Database isolation is worth nothing if a cached response crosses over.
 * These entries never touch Mongo, so no query filter can catch them. */
(async () => {
    console.log('\n── 4. cache isolation ─────────────────────────────────────');
    const cache = require('../src/services/cacheService');
    const KEY = `${TAG}geo:districts`;

    await runWithVerticals(['cg'], () => cache.set(KEY, ['Raipur', 'Durg'], 60));
    t('cg reads back its own cached value',
        await runWithVerticals(['cg'], () => cache.get(KEY)), ['Raipur', 'Durg']);
    t('mh does NOT get cg\'s cached value',
        await runWithVerticals(['mh'], () => cache.get(KEY)), null);

    await runWithVerticals(['mh'], () => cache.set(KEY, ['Pune', 'Beed'], 60));
    t('both verticals keep their own value under the same key',
        [await runWithVerticals(['cg'], () => cache.get(KEY)),
            await runWithVerticals(['mh'], () => cache.get(KEY))],
        [['Raipur', 'Durg'], ['Pune', 'Beed']]);

    await runWithVerticals(['cg'], () => cache.del(KEY));
    t('deleting cg\'s entry leaves mh\'s intact',
        await runWithVerticals(['mh'], () => cache.get(KEY)), ['Pune', 'Beed']);
    await runWithVerticals(['mh'], () => cache.del(KEY));

    if (!WITH_DB) { report(); } else { await runDbTests(); }
})();

/* ══════════════════════════════════════════════════════════════════════
   PART 2 — against the real database, with fixtures
   ══════════════════════════════════════════════════════════════════ */
async function runDbTests() {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`\n── 4. live database: ${mongoose.connection.name} ─────────────`);

    const Content = require('../src/models/Content');
    const Alert = require('../src/models/Alert');
    const db = mongoose.connection.db;
    /** Fixtures created through Mongoose, tracked by _id so nothing is left behind. */
    const strays = [];

    /**
     * Fixture rows written through Mongoose cannot be found by the `__vtest__`
     * marker — strict mode strips it. They are removed by their identifying
     * SCHEMA field instead. This list also clears anything an earlier failed
     * run left in the database.
     */
    const BY_FIELD = [
        ['Event', { name: `${TAG}Maratha quota stir` }],
        ['Keyword', { keyword: { $regex: `^${TAG}` } }],
        ['Source', { identifier: `@${TAG}handle` }],
        ['GrievanceSource', { handle: `@${TAG}gs` }],
        ['POI', { name: `${TAG}Person` }],
        ['MasterCalendarEvent', { occasion: `${TAG}Rally` }],
    ];

    const cleanup = async () => {
        // Raw-driver fixtures DO keep the marker — insertMany bypasses strict.
        await Content.collection.deleteMany({ [TAG]: true });
        await Alert.collection.deleteMany({ [TAG]: true });
        for (const [Model, id] of strays) {
            try { await Model.collection.deleteOne({ _id: id }); } catch { /* best effort */ }
        }
        strays.length = 0;
        for (const [modelName, filter] of BY_FIELD) {
            try {
                const Model = require(`../src/models/${modelName}`);
                await Model.collection.deleteMany(filter);
            } catch { /* model may not exist */ }
        }
    };
    process.on('SIGINT', async () => { await cleanup(); process.exit(130); });

    // Baseline: what is in there that is NOT ours.
    const realBefore = await Content.collection.countDocuments({ [TAG]: { $ne: true } });
    const realAlertsBefore = await Alert.collection.countDocuments({ [TAG]: { $ne: true } });

    try {
        await cleanup(); // in case a previous run died mid-way

        const mk = (vertical, n) => ({
            [TAG]: true,
            id: `${TAG}${crypto.randomUUID()}`,
            content_id: `${TAG}${vertical}${n}`,
            source_id: `${TAG}src`,
            platform: 'x',
            content_type: 'post',
            text: vertical === 'mh' ? 'Fadnavis in Mumbai' : 'Raipur news',
            vertical,
            created_at: new Date(),
        });
        await Content.collection.insertMany([mk('cg', 1), mk('cg', 2), mk('cg', 3), mk('mh', 1), mk('mh', 2)]);

        /* find */
        const cgFind = await runWithVerticals(['cg'], () => Content.find({ [TAG]: true }).lean());
        const mhFind = await runWithVerticals(['mh'], () => Content.find({ [TAG]: true }).lean());
        t('find: cg sees its 3', cgFind.length, 3);
        t('find: mh sees its 2', mhFind.length, 2);
        ok('find: cg rows are all cg', cgFind.every((d) => d.vertical === 'cg'));
        ok('find: mh rows are all mh', mhFind.every((d) => d.vertical === 'mh'));

        /* countDocuments */
        t('count: cg', await runWithVerticals(['cg'], () => Content.countDocuments({ [TAG]: true })), 3);
        t('count: mh', await runWithVerticals(['mh'], () => Content.countDocuments({ [TAG]: true })), 2);

        /* findOne — the one that leaks a single row if the hook misses it */
        const cgOne = await runWithVerticals(['cg'], () => Content.findOne({ content_id: `${TAG}mh1` }).lean());
        t('findOne: cg cannot fetch an mh row by id', cgOne, null);

        /* aggregate — wrong if the $match is appended instead of unshifted */
        const agg = await runWithVerticals(['cg'], () => Content.aggregate([
            { $match: { [TAG]: true } }, { $group: { _id: '$vertical', n: { $sum: 1 } } },
        ]));
        t('aggregate: cg sees only the cg group', agg.map((a) => a._id), ['cg']);
        t('aggregate: cg count is 3', agg[0].n, 3);

        /* distinct */
        const dist = await runWithVerticals(['mh'], () => Content.distinct('vertical', { [TAG]: true }));
        t('distinct: mh sees only mh', dist, ['mh']);

        /* raw driver, through the wrapper */
        const rawCg = await runWithVerticals(['cg'], () => scopedCollection(db, 'contents').countDocuments({ [TAG]: true }));
        t('raw driver (wrapped): cg sees 3', rawCg, 3);

        /* An explicit `vertical` in the caller's own filter must NARROW the
         * scope, never replace it. Merging by key quietly discarded the
         * caller's condition and answered a different question. */
        t('cg asking for mh rows gets none (conditions AND, not overwrite)',
            await runWithVerticals(['cg'], () => Content.countDocuments({ [TAG]: true, vertical: 'mh' })), 0);
        t('cg asking for cg rows still gets its 3',
            await runWithVerticals(['cg'], () => Content.countDocuments({ [TAG]: true, vertical: 'cg' })), 3);
        t('raw driver: same rule',
            await runWithVerticals(['cg'], () => scopedCollection(db, 'contents').countDocuments({ [TAG]: true, vertical: 'mh' })), 0);

        /* targeted writes must not cross either */
        await runWithVerticals(['cg'], () => Content.updateMany({ [TAG]: true }, { $set: { risk_level: 'low' } }));
        const touchedMh = await Content.collection.countDocuments({ [TAG]: true, vertical: 'mh', risk_level: 'low' });
        t('updateMany as cg did not touch mh rows', touchedMh, 0);

        /* delete is the most destructive crossing */
        await runWithVerticals(['mh'], () => Content.deleteMany({ [TAG]: true }));
        t('deleteMany as mh removed only mh rows',
            await Content.collection.countDocuments({ [TAG]: true }), 3);

        /* unscoped (background job) must still see what is left */
        t('no context: sees everything remaining',
            await Content.countDocuments({ [TAG]: true }), 3);
        t('no context means no filter', currentVerticals(), null);

        /* ── what the logged-in user CREATES ──────────────────────────
         * The Maharashtra user will build their own events, keywords,
         * monitored profiles and grievance sources from the UI. Each must
         * land in `mh` without anything in the controller saying so — the
         * controllers were written for one client and do not pass a vertical.
         * If this fails, the user's own keyword disappears from their screen
         * on save and surfaces in the live Chhattisgarh client's list. */
        /* Fixtures carry every REQUIRED field of their model. Getting this
         * wrong produced a false failure that turned out to be a real bug in
         * seed_mh_vertical.js: it created Keywords with no `category` and
         * Sources with no `created_by`, both required. --dry-run never calls
         * create(), so the dry run passed and the real run would have thrown. */
        const CREATES = [
            ['Event', { id: `${TAG}ev`, name: `${TAG}Maratha quota stir`, start_date: new Date(), end_date: new Date() }],
            ['Keyword', { keyword: `${TAG}Fadnavis`, category: 'other' }],
            ['Source', { id: `${TAG}src2`, platform: 'x', identifier: `@${TAG}handle`, display_name: `${TAG}Test`, created_by: TAG }],
            ['GrievanceSource', { id: `${TAG}gs`, platform: 'x', handle: `@${TAG}gs`, display_name: `${TAG}GS`, created_by: TAG }],
            ['POI', { id: `${TAG}poi`, name: `${TAG}Person` }],
            ['MasterCalendarEvent', { id: `${TAG}mce`, slNo: 99999, occasion: `${TAG}Rally`, date: new Date() }],
        ];
        /**
         * ⚠ IDENTIFY FIXTURES BY `_id`, NEVER BY A MARKER FIELD.
         *
         * Mongoose is strict by default, so `Model.create({ __vtest__: true })`
         * SILENTLY DROPS the marker — it is not in any schema. The row is
         * created correctly and stamped correctly, but a later
         * `countDocuments({ __vtest__: true })` finds nothing and
         * `deleteMany({ __vtest__: true })` cleans up nothing.
         *
         * That read as six product failures when the product was fine, and
         * left the fixtures behind in a live database. `_id` is always there,
         * always unique, and never stripped.
         */
        for (const [modelName, doc] of CREATES) {
            let Model;
            try { Model = require(`../src/models/${modelName}`); } catch { continue; }
            let created = null;
            try {
                created = await runWithVerticals(['mh'], () => Model.create(doc));
            } catch (e) {
                ok(`${modelName}: created by the mh user (${e.message.slice(0, 70)})`, false);
                continue;
            }
            strays.push([Model, created._id]);
            t(`${modelName}: created by the mh user is stamped mh`, created.vertical, 'mh');

            const seenByMh = await runWithVerticals(['mh'], () => Model.countDocuments({ _id: created._id }));
            const seenByCg = await runWithVerticals(['cg'], () => Model.countDocuments({ _id: created._id }));
            t(`${modelName}: the mh user can see what they just created`, seenByMh, 1);
            t(`${modelName}: the cg client cannot see it`, seenByCg, 0);

            await Model.collection.deleteOne({ _id: created._id });
            strays.pop();
        }

        /* And the mirror: a CG user's creation must stay cg. */
        const Keyword = require('../src/models/Keyword');
        const cgKw = await runWithVerticals(['cg'], () => Keyword.create({ keyword: `${TAG}Raipur`, category: 'other' }));
        strays.push([Keyword, cgKw._id]);
        t('a cg user\'s new keyword is stamped cg', cgKw.vertical, 'cg');
        t('the mh user cannot see it',
            await runWithVerticals(['mh'], () => Keyword.countDocuments({ _id: cgKw._id })), 0);
        await Keyword.collection.deleteOne({ _id: cgKw._id });
        strays.pop();

        /* Background jobs have no user and must still default to the host. */
        const bgKw = await Keyword.create({ keyword: `${TAG}bg`, category: 'other' });
        strays.push([Keyword, bgKw._id]);
        t('a write with no request context defaults to the host client', bgKw.vertical, 'cg');
        await Keyword.collection.deleteOne({ _id: bgKw._id });
        strays.pop();

        /* Upserts create through the UPDATE path, which neither save nor
         * insertMany sees — and the read filter has already rewritten the
         * query, so the new row would otherwise have no vertical at all. */
        await runWithVerticals(['mh'], () => Keyword.updateOne(
            { keyword: `${TAG}upsert` }, { $set: { is_active: true, category: 'other' } }, { upsert: true },
        ));
        const upserted = await Keyword.collection.findOne({ keyword: `${TAG}upsert` });
        t('an upsert by the mh user is stamped mh', upserted && upserted.vertical, 'mh');
        t('and the mh user can read back what they upserted',
            await runWithVerticals(['mh'], () => Keyword.countDocuments({ keyword: `${TAG}upsert` })), 1);
        t('while the cg client cannot see it',
            await runWithVerticals(['cg'], () => Keyword.countDocuments({ keyword: `${TAG}upsert` })), 0);
        await Keyword.collection.deleteMany({ keyword: { $regex: `^${TAG}` } });

        /* the untagged-row trap: a doc with no vertical is invisible to all */
        await Content.collection.insertOne({
            [TAG]: true, id: `${TAG}untagged`, content_id: `${TAG}untagged`,
            platform: 'x', content_type: 'post', text: 'no vertical field', created_at: new Date(),
        });
        const seenByCg = await runWithVerticals(['cg'], () => Content.countDocuments({ content_id: `${TAG}untagged` }));
        t('a row with NO vertical is invisible to cg — this is why the backfill must run first',
            seenByCg, 0);
    } finally {
        await cleanup();
    }

    /* Nothing of the live client's was disturbed. */
    const realAfter = await Content.collection.countDocuments({ [TAG]: { $ne: true } });
    const realAlertsAfter = await Alert.collection.countDocuments({ [TAG]: { $ne: true } });
    t('live content count unchanged by this test', realAfter, realBefore);
    t('live alert count unchanged by this test', realAlertsAfter, realAlertsBefore);
    t('no fixtures left behind', await Content.collection.countDocuments({ [TAG]: true }), 0);

    await mongoose.disconnect();
    report();
}

function report() {
    console.log(`\n  ${pass} passed, ${fail} failed`);
    if (!WITH_DB) console.log('  (run with --db for the live round-trip)\n'); else console.log('');
    process.exit(fail === 0 ? 0 : 1);
}
