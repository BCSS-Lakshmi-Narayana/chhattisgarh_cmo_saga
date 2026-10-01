/**
 * verticalScope — the Mongoose plugin that keeps two clients' data apart.
 *
 * Applied to a schema, it:
 *   1. adds an indexed `vertical` field defaulting to `cg`;
 *   2. filters every READ to the verticals of the logged-in user;
 *   3. filters every targeted WRITE the same way, so a user cannot update or
 *      delete a row they are not allowed to see.
 *
 * ── WHY A PLUGIN AND NOT 887 EDITS ───────────────────────────────────
 * There are ~887 read call sites in this codebase. Patching each one would
 * mean 887 chances to forget, and a forgotten filter fails SILENTLY — the
 * Chhattisgarh client's number simply grows. Hooking the schema puts the rule
 * in one place that cannot be bypassed by forgetting.
 *
 * This is the same technique `utils/textEncoding.js` already uses here to
 * repair text on every write path, so the pattern is proven in this codebase.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT COVER ────────────────────────────
 * `estimatedDocumentCount()` ignores query filters entirely — it reads
 * collection metadata — so it CANNOT be scoped. Any caller that needs a
 * tenant-correct total must use `countDocuments()`. `assertNoEstimatedCounts`
 * below is the check that keeps that true.
 *
 * Raw `collection.*` driver calls and `aggregate()` pipelines built elsewhere
 * and executed through `db.collection(...)` also bypass Mongoose middleware.
 * There are none in this codebase today; the safety test is what proves it
 * stays that way.
 */
const { DEFAULT_VERTICAL, currentVerticals } = require('../config/verticals');

/**
 * Reads. `findById` is `findOne` underneath, so it is covered.
 * `count` is deprecated but still hooked in case anything old uses it.
 */
const READ_HOOKS = ['find', 'findOne', 'count', 'countDocuments', 'distinct'];

/**
 * Targeted writes. Scoped so that a request cannot modify another vertical's
 * rows even by guessing an id. Background jobs are unaffected: they run
 * without a request context, so no filter is applied to them.
 */
const WRITE_HOOKS = [
    'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
    'updateOne', 'updateMany', 'replaceOne', 'deleteOne', 'deleteMany',
];

/**
 * Which vertical a NEW document written during this request belongs to.
 *
 * Everything the logged-in user creates from the UI — an event, a keyword, a
 * monitored profile, a grievance source — must land in THEIR vertical. Without
 * this the schema default applied, so the Maharashtra user's own keyword was
 * stamped `cg`: it vanished from their screen the moment they saved it, and
 * turned up in the live Chhattisgarh client's keyword list instead. Both
 * halves of that are bad, and neither throws.
 *
 * A user with several verticals writes to the first one listed; there is no
 * way to infer which they meant, and picking deterministically at least makes
 * it predictable. Outside a request there is no user, so the host client's
 * default applies and background collection is unchanged.
 */
const writeVertical = () => {
    const verticals = currentVerticals();
    return (verticals && verticals[0]) || DEFAULT_VERTICAL;
};

const verticalScopePlugin = (schema) => {
    if (schema.path('vertical')) return; // already applied
    /**
     * No `default:` on purpose. Mongoose applies a default at construction,
     * which would make "the user did not set one" indistinguishable from
     * "the user set it to cg" by the time the save hook runs — and the hook
     * is what needs to tell those apart. The default is applied below instead.
     */
    schema.add({
        vertical: {
            type: String,
            index: true,
        },
    });

    function applyQueryFilter(next) {
        const verticals = currentVerticals();
        // No request context ⇒ collection jobs and scripts ⇒ see everything.
        if (!verticals) return next();
        /**
         * `.and()`, not `.where()`.
         *
         * `where({ vertical: … })` merges by key, so it REPLACES a `vertical`
         * condition the caller already set rather than narrowing it. A query
         * for `{ vertical: 'mh' }` run by a Chhattisgarh user came back with
         * Chhattisgarh rows — the user's own condition silently discarded.
         * Not a leak (the result stays inside the caller's verticals) but the
         * wrong answer, which is its own kind of dangerous in a report.
         *
         * `$and` keeps both conditions, so an impossible combination
         * correctly returns nothing.
         */
        this.and([{ vertical: { $in: verticals } }]);
        return next();
    }

    schema.pre(READ_HOOKS, applyQueryFilter);
    schema.pre(WRITE_HOOKS, applyQueryFilter);

    /* ── write side: stamp new documents ───────────────────────────── */

    // `new Model()` + `.save()`, and `Model.create()`.
    schema.pre('save', function stampOnSave(next) {
        if (!this.vertical) this.vertical = writeVertical();
        next();
    });

    // Bulk inserts never run `save`.
    schema.pre('insertMany', function stampOnInsertMany(next, docs) {
        const v = writeVertical();
        if (Array.isArray(docs)) for (const d of docs) { if (d && !d.vertical) d.vertical = v; }
        next();
    });

    /**
     * Upserts create documents through the UPDATE path, so neither hook above
     * sees them. And the read filter has already rewritten the query to
     * `vertical: { $in: [...] }`, which Mongoose cannot turn into a field on
     * the new document the way it does a plain equality — so without this an
     * upserted row would be created with no vertical at all, and be invisible
     * to everyone including the person who just created it.
     */
    schema.pre(['updateOne', 'updateMany', 'findOneAndUpdate', 'replaceOne'], function stampOnUpsert(next) {
        if (this.getOptions && this.getOptions().upsert) {
            const update = this.getUpdate() || {};
            const explicit = update.vertical || (update.$set && update.$set.vertical);
            if (!explicit) this.setUpdate({ ...update, $setOnInsert: { ...(update.$setOnInsert || {}), vertical: writeVertical() } });
        }
        next();
    });

    /**
     * Aggregations need the match FIRST, before any $group or $lookup has had
     * a chance to fold other verticals' rows into a total. Appending it would
     * be useless; `unshift` is the whole point.
     */
    schema.pre('aggregate', function aggregateFilter(next) {
        const verticals = currentVerticals();
        if (verticals) this.pipeline().unshift({ $match: { vertical: { $in: verticals } } });
        next();
    });
};

/**
 * Raw driver access, scoped.
 *
 * ⚠ THE PLUGIN ABOVE DOES NOT PROTECT THESE. `db.collection('grievances')`
 * goes straight to the MongoDB driver and never passes through Mongoose
 * middleware, so a schema hook cannot see it. This codebase has 22 such calls
 * serving HTTP requests, in newsController, cmDashboardController and
 * displayGate — every one of them a hole the plugin would have missed.
 *
 * Use this instead of `db.collection(name)` anywhere a request might be
 * running. Outside a request it returns the plain collection unchanged, so
 * background jobs and scripts keep seeing everything.
 */
const scopedCollection = (db, name) => {
    const col = db.collection(name);
    const verticals = currentVerticals();
    if (!verticals) return col;

    // $and for the same reason as the query hook: spreading `vertical` over
    // the caller's filter would discard a `vertical` condition they set
    // themselves, and answer a different question than the one asked.
    const withVertical = (filter) => ({
        $and: [filter && Object.keys(filter).length ? filter : {}, { vertical: { $in: verticals } }],
    });

    return {
        find: (filter, options) => col.find(withVertical(filter), options),
        findOne: (filter, options) => col.findOne(withVertical(filter), options),
        countDocuments: (filter, options) => col.countDocuments(withVertical(filter), options),
        distinct: (key, filter, options) => col.distinct(key, withVertical(filter), options),
        // Same reasoning as the aggregate hook: the match has to come first,
        // before any $group folds the other vertical into a total.
        aggregate: (pipeline, options) => col.aggregate(
            [{ $match: { vertical: { $in: verticals } } }, ...(pipeline || [])],
            options,
        ),
    };
};

/**
 * Guard for the safety test: `estimatedDocumentCount` cannot be filtered, so
 * if one appears on a scoped collection it would report BOTH clients' totals
 * to whoever asked. Returns the offending call sites, or [].
 */
const assertNoEstimatedCounts = (rootDir) => {
    const fs = require('fs');
    const path = require('path');
    const hits = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === 'node_modules' || entry.name === '.git') continue;
                walk(full);
            } else if (entry.name.endsWith('.js')) {
                // This file names the method in order to look for it; scanning
                // itself would make the check permanently fail.
                if (full.includes('verticalScope')) continue;
                const src = fs.readFileSync(full, 'utf8');
                src.split('\n').forEach((line, i) => {
                    if (line.includes('estimatedDocumentCount')) hits.push(`${full}:${i + 1}`);
                });
            }
        }
    };
    walk(rootDir);
    return hits;
};

module.exports = {
    verticalScopePlugin, scopedCollection, assertNoEstimatedCounts, READ_HOOKS, WRITE_HOOKS,
};
