#!/usr/bin/env node
/**
 * fetch_mh_deep.js
 * ─────────────────────────────────────────────────────────────────────
 * Pull as much real content as possible for the nine Maharashtra leaders.
 *
 * ── WHY THE EARLIER RUNS CAME BACK THIN ──────────────────────────────
 * Each leader had exactly TWO keywords: the full English name and the full
 * Devanagari name. `passesKeywordGate` requires the keyword to appear in
 * the post text, so anything written the way people actually write gets
 * fetched from the API and then dropped. From the 2026-10-01 log:
 *
 *   Skipping tweet …: returned by API but text does not contain
 *   "Manoj Jarange Patil"
 *     text: "जरांगे पाटलांनावर टीका करणाऱ्यांनी एकदा हा व्हिडिओ बघा…"
 *
 * That post IS criticism of Jarange Patil. It was discarded because it says
 * "जरांगे पाटलांनावर", not "Manoj Jarange Patil". Searching the SHORT alias
 * keeps it, because the gate matches on substring.
 *
 * ── WHAT THIS WIDENS ─────────────────────────────────────────────────
 *   · every alias on the leader, Latin and Devanagari, short forms included
 *   · the handle, bare and with '@' — a search for "@AUThackeray" returns
 *     the replies AIMED at him, which is where criticism actually sits and
 *     which a name search never reaches
 *
 * Any term not already an active keyword is created (under `mh`), because
 * the fetch loop and the gate both read from the Keyword collection.
 *
 * Collection is deliberately WIDER than attribution: a short alias may pull
 * a post about a different person, and entity resolution decides who each
 * post is really about at analysis time. Over-collecting is recoverable;
 * never fetching the post at all is not.
 *
 *   node backend/scripts/fetch_mh_deep.js --count            show the plan
 *   node backend/scripts/fetch_mh_deep.js --seed --count     plan + create terms
 *   node backend/scripts/fetch_mh_deep.js --seed --platform x        run it
 *   node backend/scripts/fetch_mh_deep.js --seed --per-leader 4      cap the width
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { runWithVerticals } = require('../src/config/verticals');
const MH = require('../src/data/mh_leaders.json');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const val = (f, d = null) => {
    const i = argv.indexOf(`--${f}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const COUNT_ONLY = has('count');
const SEED = has('seed');
const NO_HANDLES = has('no-handles');
const PER_LEADER = Number(val('per-leader', '0')) || 0;
const PLATFORM = val('platform');
const MINUTES_PER_TERM = 9;

/** Roster aliases, richer than mh_leaders.json for some entries. */
const rosterAliases = (key) => {
    try {
        const { MH_ENTITIES } = require('../src/config/mhPoliticalEntities');
        const list = Array.isArray(MH_ENTITIES) ? MH_ENTITIES : Object.values(MH_ENTITIES || {});
        const hit = list.find((e) => e.key === key);
        return hit ? (hit.aliases || []) : [];
    } catch { return []; }
};

/**
 * Search terms for one leader, most productive first.
 *
 * Shortest alias first on purpose: "जरांगे" appears in far more posts than
 * "Manoj Jarange Patil" does, so if a run is cut short the high-yield terms
 * have already gone. The handle follows, then the long formal names.
 */
const termsFor = (l) => {
    const seen = new Set();
    const out = [];
    const add = (t) => {
        const v = String(t || '').trim();
        if (!v || v.length < 3) return;
        const k = v.toLowerCase();
        if (seen.has(k)) return;
        seen.add(k);
        out.push(v);
    };

    const aliases = [...new Set([...(l.aliases || []), ...rosterAliases(l.key)])]
        .sort((a, b) => a.length - b.length);
    for (const a of aliases) add(a);
    if (!NO_HANDLES && l.handle) {
        add(`@${String(l.handle).replace(/^@+/, '')}`);
        add(String(l.handle).replace(/^@+/, ''));
    }
    add(l.name);

    return PER_LEADER ? out.slice(0, PER_LEADER) : out;
};

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}\n`);

    const Keyword = require('../src/models/Keyword');
    const Grievance = require('../src/models/Grievance');
    const mhMatch = require('../src/utils/mhLeaderMatch');

    await runWithVerticals(['mh'], async () => {
        const active = await Keyword.find({ is_active: true }).select('keyword').lean();
        const have = new Set(active.map((k) => String(k.keyword).trim().toLowerCase()));

        /* Current standing, so the starved leaders run first. */
        const docs = await Grievance.find({ vertical: 'mh' })
            .select('content.text text title posted_by.handle author_handle handle')
            .limit(8000).lean();
        const counts = new Map(MH.leaders.map((l) => [l.key, 0]));
        for (const d of docs) {
            for (const l of mhMatch.leadersIn(d)) {
                if (counts.has(l.key)) counts.set(l.key, counts.get(l.key) + 1);
            }
        }

        const order = [...MH.leaders].sort((a, b) => (counts.get(a.key) || 0) - (counts.get(b.key) || 0));

        const plan = [];
        const toCreate = [];
        console.log('leader                      now   search terms');
        for (const l of order) {
            const terms = termsFor(l);
            const missing = terms.filter((t) => !have.has(t.toLowerCase()));
            toCreate.push(...missing.map((t) => ({ term: t, leader: l.name })));
            plan.push(...terms);
            console.log(`  ${l.name.padEnd(24)}${String(counts.get(l.key) || 0).padStart(5)}   `
                + `${terms.length} terms${missing.length ? `  (${missing.length} new)` : ''}`);
            console.log(`      ${terms.join(' · ')}`);
        }

        const newTerms = [...new Set(toCreate.map((t) => t.term.toLowerCase()))];
        console.log(`\n  ${plan.length} search terms across 9 leaders`);
        console.log(`  ${newTerms.length} are not yet keywords and must be created`);
        console.log(`  Estimated run: about ${Math.round((plan.length * MINUTES_PER_TERM) / 60)} hours`
            + `${PLATFORM ? ` on ${PLATFORM}` : ' across all platforms'}`);
        console.log('  Order: starved leaders first, shortest alias first within each.');

        if (newTerms.length && !SEED) {
            console.log('\n  Pass --seed to create the missing terms. Without it they are skipped,');
            console.log('  and the run is no wider than before.');
        }

        if (SEED && newTerms.length) {
            let made = 0;
            for (const t of toCreate) {
                const k = t.term.toLowerCase();
                if (have.has(k)) continue;
                have.add(k);
                if (!COUNT_ONLY) {
                    // eslint-disable-next-line no-await-in-loop
                    await Keyword.create({
                        keyword: t.term,
                        kind: 'keyword',
                        category: 'other',
                        language: /[ऀ-ॿ]/.test(t.term) ? 'mr' : 'en',
                        is_active: true,
                        weight: 50,
                        vertical: 'mh',
                    });
                }
                made += 1;
            }
            console.log(`\n  ${made} keywords ${COUNT_ONLY ? 'would be' : ''} created.`);
        }

        if (COUNT_ONLY) {
            console.log('\n--count given, nothing fetched.');
            return;
        }

        const { fetchKeywordGrievances } = require('../src/services/grievanceService');
        console.log('\nStarting. Leave this running; progress is logged per keyword.\n');
        const res = await fetchKeywordGrievances(PLATFORM, { only: plan });
        console.log(`\nDone. ${res.newGrievances} new, ${res.keywordsSearched} terms searched.`);
    });

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
