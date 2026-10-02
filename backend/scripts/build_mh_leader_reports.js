#!/usr/bin/env node
/**
 * build_mh_leader_reports.js
 * ─────────────────────────────────────────────────────────────────────
 * Writes ONE report file per Maharashtra leader, ready to send.
 *
 * The client asked for separate reports per profile rather than one
 * combined document. The export dialog in the app does this too, but it
 * needs a browser, a login and nine clicks; this produces the same nine
 * files from the command line in one go.
 *
 * Every leader gets a file, including any with no mentions in the window —
 * a nil return is a result, and "we sent you nothing for him" is not.
 *
 * ── HOW IT GETS THE DATA ─────────────────────────────────────────────
 * It calls the real brief controller with a leader filter, the same call
 * the page makes, and renders it with the same report module the browser
 * uses. There is no second implementation to drift.
 *
 *   node backend/scripts/build_mh_leader_reports.js
 *   node backend/scripts/build_mh_leader_reports.js --days 7
 *   node backend/scripts/build_mh_leader_reports.js --from 2026-09-24 --to 2026-10-01
 *   node backend/scripts/build_mh_leader_reports.js --out "C:/reports"
 *   node backend/scripts/build_mh_leader_reports.js --combined   also a 10th, all leaders
 *   node backend/scripts/build_mh_leader_reports.js --client     client build, full floors
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { runWithVerticals } = require('../src/config/verticals');
const MH = require('../src/data/mh_leaders.json');

const argv = process.argv.slice(2);
const flag = (name, dflt = null) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};
const DAYS = Number(flag('days', '7'));
const FROM = flag('from');
const TO = flag('to');
const COMBINED = argv.includes('--combined');
/** Client mode keeps the display floors; the default is the internal build. */
const CLIENT = argv.includes('--client');
const OUT = flag('out', path.resolve(__dirname, '../reports'));

const iso = (d) => d.toISOString().slice(0, 10);
const to = TO || iso(new Date());
const from = FROM || iso(new Date(Date.now() - (DAYS - 1) * 86400000));

/**
 * Load the browser's report module in Node.
 *
 * It is an ES module with no imports of its own, so dropping the `export`
 * keyword is enough. Deliberately the SAME file the app ships — rendering
 * these from a copy is how two reports of the same week start disagreeing.
 */
const loadReporter = () => {
    const p = path.resolve(__dirname, '../../frontend/src/lib/briefReport.js');
    if (!fs.existsSync(p)) throw new Error(`report module not found at ${p}`);
    const src = fs.readFileSync(p, 'utf8').replace(/^export /gm, '');
    // eslint-disable-next-line no-new-func
    return new Function(`${src}\nreturn { buildBriefReportHtml };`)().buildBriefReportHtml;
};

const safeName = (s) => String(s).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');

(async () => {
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`Database: ${mongoose.connection.name}`);
    console.log(`Window  : ${from} to ${to}`);
    console.log(`Output  : ${OUT}\n`);

    fs.mkdirSync(OUT, { recursive: true });
    const buildBriefReportHtml = loadReporter();
    const { getCMBrief } = require('../src/controllers/cmDashboardController');

    const brief = async (leader) => {
        const query = { from, to };
        if (leader) query.leader = leader;
        const res = { _: null, status() { return this; }, json(d) { this._ = d; return this; } };
        await runWithVerticals(['mh'], () => getCMBrief({ query }, res));
        return res._;
    };

    const jobs = MH.leaders.map((l) => ({ label: l.name, leader: l.name }));
    if (COMBINED) jobs.push({ label: 'All leaders (combined)', leader: null });

    const written = [];
    for (const job of jobs) {
        // eslint-disable-next-line no-await-in-loop
        const data = await brief(job.leader);
        if (!data) { console.log(`  !  ${job.label.padEnd(26)} brief returned nothing`); continue; }

        const html = buildBriefReportHtml(data, {
            appName: 'Maharashtra Political Report',
            stateName: 'Maharashtra',
            // These go to the team while collection is still filling out.
            // Internal mode drops the display floors so thin-but-real counts
            // are visible instead of being suppressed, and stamps the file so
            // it cannot be mistaken for the client version. Pass --client
            // once the data is good enough to send out.
            internal: !CLIENT,
        });
        const file = path.join(OUT, `MH-${safeName(job.label)}-${to}.html`);
        fs.writeFileSync(file, html, 'utf8');

        const mentions = data?.by_source?.mentions?.total || 0;
        const alerts = data?.by_source?.alerts?.total || 0;
        const scored = data?.combined?.total || 0;
        console.log(`  ✓  ${job.label.padEnd(26)}`
            + `${String(mentions).padStart(5)} mentions  `
            + `${String(scored).padStart(4)} scored  `
            + `${String(alerts).padStart(4)} alerts`
            + `${mentions === 0 ? '   (nil return — reported as such)' : ''}`);
        written.push(file);
    }

    console.log(`\n  ${written.length} reports written to ${OUT}`);
    console.log('  Open any one and use Print / Save as PDF to send it.\n');

    await mongoose.disconnect();
})().catch((err) => {
    console.error('FAILED:', err.message);
    process.exit(1);
});
