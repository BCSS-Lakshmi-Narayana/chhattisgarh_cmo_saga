#!/usr/bin/env node
/**
 * mh_daily_report.js
 * ─────────────────────────────────────────────────────────────────────
 * The daily Maharashtra campaign report: per-leader volume, person-relative
 * sentiment, platform split and top posts, for a given day or range.
 *
 * ── IT RUNS INSIDE THE mh VERTICAL, DELIBERATELY ─────────────────────
 * This is a CLI script, so there is no logged-in user and therefore no
 * automatic filter — a plain query here would read BOTH clients' data and put
 * Chhattisgarh rows in a Maharashtra report. Every query below is wrapped in
 * `runWithVerticals(['mh'], …)`, which is the same mechanism the HTTP layer
 * uses, just declared explicitly instead of inferred from a JWT.
 *
 * ── SENTIMENT IS FLIPPED ONTO THE PERSON ─────────────────────────────
 * Every verdict this pipeline stores is CLIENT-relative: `positive` means
 * good for the host client (the BJP), not "flattering to whoever is named".
 * Printed raw under a leader's name, every opposition row would read backwards
 * — an attack on Sharad Pawar would appear as positive sentiment FOR him.
 * `alignToPerson` below flips the sign for anyone marked `opposition` in
 * mh_leaders.json. This is the same correction leaderPopularityController
 * already makes for the Chhattisgarh dashboard.
 *
 *   node backend/scripts/mh_daily_report.js                 yesterday → now
 *   node backend/scripts/mh_daily_report.js --days 7        last 7 days
 *   node backend/scripts/mh_daily_report.js --from 2026-10-01 --to 2026-10-02
 *   node backend/scripts/mh_daily_report.js --json          machine-readable
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const { runWithVerticals } = require('../src/config/verticals');
const MH = require('../src/data/mh_leaders.json');

const argv = process.argv.slice(2);
const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const AS_JSON = argv.includes('--json');
const DAYS = Number(arg('--days') || 1);
const FROM = arg('--from');
const TO = arg('--to');

const windowRange = () => {
    if (FROM) return { from: new Date(`${FROM}T00:00:00Z`), to: new Date(TO ? `${TO}T23:59:59Z` : Date.now()) };
    const to = new Date();
    const from = new Date(to.getTime() - DAYS * 24 * 60 * 60 * 1000);
    return { from, to };
};

/** Client-relative → person-relative. See the header. */
const alignToPerson = (sentiment, alignment) => {
    if (alignment !== 'opposition') return sentiment;
    if (sentiment === 'positive') return 'negative';
    if (sentiment === 'negative') return 'positive';
    return sentiment;
};

const sentimentOf = (doc) => String(
    doc?.analysis?.target_sentiment
    || doc?.llm_analysis?.target_sentiment
    || doc?.analysis?.sentiment
    || 'unknown',
).toLowerCase();

const matchesLeader = (text, leader) => {
    const t = String(text || '').toLowerCase();
    return leader.aliases.some((a) => t.includes(a.toLowerCase()));
};

/**
 * Shape a set of documents into the report.
 *
 * Split out from the I/O so the test suite can run it over fixtures with
 * known answers. A report whose arithmetic is only ever exercised against
 * live data has no way to be wrong loudly.
 */
const buildReport = (all, { from, to }) => {
    const perLeader = MH.leaders.map((l) => {
            const own = all.filter((d) => String(d.author_handle || '').toLowerCase() === l.handle.toLowerCase());
            const mentions = all.filter((d) => matchesLeader(
                `${d.text || ''} ${d.content || ''} ${d.title || ''}`, l,
            ));
            const tally = { positive: 0, negative: 0, neutral: 0, unknown: 0, unrelated: 0 };
            for (const m of mentions) {
                const s = alignToPerson(sentimentOf(m), l.alignment);
                if (tally[s] === undefined) tally.unknown += 1; else tally[s] += 1;
            }
            const platforms = {};
            for (const m of mentions) {
                const p = m.platform || 'unknown';
                platforms[p] = (platforms[p] || 0) + 1;
            }
            return {
                name: l.name,
                role: l.role,
                handle: l.handle,
                alignment: l.alignment,
                own_posts: own.length,
                mentions: mentions.length,
                sentiment: tally,
                platforms,
            };
        });

    return {
        window: { from: from.toISOString(), to: to.toISOString() },
        collected_total: all.length,
        leaders: perLeader,
        // A report whose scores are nearly all `unrelated` means the state
        // gate is rejecting Maharashtra context — config problem, not a
        // quiet week. Surfaced rather than left for someone to notice.
        unscored: all.filter((d) => ['unrelated', 'unknown'].includes(sentimentOf(d))).length,
    };
};

const main = async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);

    const Content = require('../src/models/Content');
    const Grievance = require('../src/models/Grievance');
    const { from, to } = windowRange();

    const report = await runWithVerticals(['mh'], async () => {
        const dateFilter = { $gte: from, $lte: to };
        const [content, grievances] = await Promise.all([
            Content.find({ $or: [{ published_at: dateFilter }, { created_at: dateFilter }] }).lean(),
            Grievance.find({ $or: [{ post_date: dateFilter }, { created_at: dateFilter }] }).lean(),
        ]);
        return buildReport([...content, ...grievances], { from, to });
    });

    await mongoose.disconnect();

    if (AS_JSON) { console.log(JSON.stringify(report, null, 2)); return; }

    console.log(`\n═══ MAHARASHTRA DAILY REPORT ═══`);
    console.log(`Window : ${report.window.from.slice(0, 16)} → ${report.window.to.slice(0, 16)}`);
    console.log(`Items  : ${report.collected_total}\n`);

    console.log('Leader                     Own   Mentions    Pos    Neg   Neut');
    console.log('─'.repeat(66));
    for (const l of report.leaders) {
        console.log(
            l.name.padEnd(26)
            + String(l.own_posts).padStart(4)
            + String(l.mentions).padStart(11)
            + String(l.sentiment.positive).padStart(7)
            + String(l.sentiment.negative).padStart(7)
            + String(l.sentiment.neutral).padStart(7),
        );
    }
    console.log('─'.repeat(66));
    console.log('Sentiment is PERSON-relative: positive = good for that leader.\n');

    if (report.collected_total === 0) {
        console.log('⚠ NOTHING COLLECTED. Check: sources seeded with vertical mh, monitor running,');
        console.log('  and that the window covers a period after collection started.\n');
    } else if (report.unscored / report.collected_total > 0.8) {
        console.log(`⚠ ${report.unscored}/${report.collected_total} items are unscored or "unrelated".`);
        console.log('  That usually means the Maharashtra state gate is not matching — a config');
        console.log('  problem, not a quiet news day. Check utils/stateSignal.js.\n');
    }
};

// Runnable as a script, requirable by the test suite. The test imports the
// real helpers rather than keeping its own copies, so the two cannot drift.
if (require.main === module) {
    main().catch((err) => {
        console.error('FAILED:', err.message);
        process.exit(1);
    });
}

module.exports = { buildReport, alignToPerson, sentimentOf, matchesLeader, windowRange };
