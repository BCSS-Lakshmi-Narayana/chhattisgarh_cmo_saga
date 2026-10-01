#!/usr/bin/env node
/**
 * test_vertical_http.js
 * ─────────────────────────────────────────────────────────────────────
 * Logs in over HTTP as each client and compares what the API actually
 * returns. Read-only: a login POST, then GETs.
 *
 * ── WHY THIS EXISTS SEPARATELY FROM THE OTHER TWO SUITES ─────────────
 * test_vertical_isolation and test_vertical_e2e call `runWithVerticals()`
 * directly. That proves the filter works when the context is set correctly —
 * it does NOT prove the running server sets it. Between a JWT and a Mongoose
 * hook sit Express middleware ordering, `protect()`, and AsyncLocalStorage
 * propagation across the whole request. None of that is exercised by a script
 * that opens the context itself.
 *
 * This is the only test that answers "is the deployed application actually
 * separating the two clients", which is a different question from "is the
 * code correct".
 *
 *   node backend/scripts/test_vertical_http.js \
 *     --url https://chattisgarh.blurasaga.com \
 *     --mh sreenumh@gmail.com:123456 \
 *     --cg someone@cg.com:password
 *
 * --cg is optional; without it only the Maharashtra side is checked.
 */
const arg = (flag, dflt = null) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : dflt;
};

const BASE = String(arg('--url', 'http://localhost:8001')).replace(/\/+$/, '');
const split = (v) => {
    if (!v) return null;
    const i = v.lastIndexOf(':');
    return i < 0 ? null : { email: v.slice(0, i), password: v.slice(i + 1) };
};
const MH = split(arg('--mh'));
const CG = split(arg('--cg'));

let pass = 0; let fail = 0;
const t = (name, actual, expected) => {
    const a = JSON.stringify(actual); const e = JSON.stringify(expected);
    if (a === e) { pass += 1; return; }
    fail += 1;
    console.log(`  ✖ ${name}\n      expected ${e}\n      got      ${a}`);
};
const ok = (name, cond, detail = '') => {
    if (cond) { pass += 1; return; }
    fail += 1;
    console.log(`  ✖ ${name}${detail ? `\n      ${detail}` : ''}`);
};

const login = async (creds) => {
    const res = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: creds.email, password: creds.password }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, token: body.token || body.access_token || null, body };
};

const get = async (path, token) => {
    const res = await fetch(`${BASE}${path}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    return { status: res.status, body };
};

/** Endpoints the dashboard actually calls — the ones that 403'd on screen. */
const ENDPOINTS = [
    '/api/grievances/dashboard-stats',
    '/api/alerts/dashboard-stats',
    '/api/alerts/unread',
    '/api/reports/stats',
    '/api/sources',
    '/api/keywords',
];

/** Pull every number out of a response, however it is nested. */
const numbersIn = (value, out = []) => {
    if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
    else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
    else if (value && typeof value === 'object') Object.values(value).forEach((v) => numbersIn(v, out));
    return out;
};
const countOf = (body) => {
    if (Array.isArray(body)) return body.length;
    if (body && Array.isArray(body.data)) return body.data.length;
    const n = numbersIn(body);
    return n.length ? Math.max(...n) : 0;
};

(async () => {
    console.log(`\n── HTTP isolation against ${BASE} ─────────────────────\n`);
    if (!MH) {
        console.log('  --mh <email>:<password> is required.\n');
        process.exit(2);
    }

    const mh = await login(MH);
    t(`login as ${MH.email}`, mh.status, 200);
    ok('a token came back', !!mh.token, JSON.stringify(mh.body).slice(0, 160));
    if (!mh.token) { report(); return; }

    console.log('  Maharashtra user:');
    const mhResults = {};
    for (const path of ENDPOINTS) {
        const r = await get(path, mh.token);
        mhResults[path] = r;
        const n = countOf(r.body);
        console.log(`    ${String(r.status).padEnd(4)} ${path.padEnd(38)} ${r.status === 200 ? n : ''}`);
        // 403 here means RBAC, not the vertical filter — the account has no
        // PagePermission row. Re-run seed_mh_vertical.js, which grants them.
        ok(`${path} is reachable (403 ⇒ missing PagePermission, not isolation)`, r.status !== 403);
    }

    /* The Maharashtra side was seeded today. Chhattisgarh-sized totals
     * appearing here would mean the filter is not running on the server. */
    const srcCount = countOf(mhResults['/api/sources'].body);
    ok(`sources looks like the 9 seeded leaders, not Chhattisgarh's (saw ${srcCount})`,
        srcCount <= 30, 'a number in the hundreds means CG sources are visible');

    const grievances = countOf(mhResults['/api/grievances/dashboard-stats'].body);
    ok(`grievance totals are Maharashtra-sized (saw ${grievances})`,
        grievances < 500, 'Chhattisgarh has ~4,300 — anything near that is a leak');

    const alerts = countOf(mhResults['/api/alerts/dashboard-stats'].body);
    ok(`alert totals are Maharashtra-sized (saw ${alerts})`,
        alerts < 100, 'Chhattisgarh has ~390 — anything near that is a leak');

    if (CG) {
        console.log('\n  Chhattisgarh user:');
        const cg = await login(CG);
        t(`login as ${CG.email}`, cg.status, 200);
        if (cg.token) {
            for (const path of ENDPOINTS) {
                const r = await get(path, cg.token);
                const n = countOf(r.body);
                console.log(`    ${String(r.status).padEnd(4)} ${path.padEnd(38)} ${r.status === 200 ? n : ''}`);
                if (r.status === 200 && mhResults[path].status === 200) {
                    const mhN = countOf(mhResults[path].body);
                    ok(`${path}: the two clients see different data (cg ${n} vs mh ${mhN})`,
                        n !== mhN || n === 0,
                        'identical non-zero totals mean both are reading the same rows');
                }
            }
        }
    } else {
        console.log('\n  (pass --cg <email>:<password> to compare both sides)');
    }

    report();
})().catch((err) => {
    console.error('\nFAILED:', err.message);
    process.exit(1);
});

function report() {
    console.log(`\n  ${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
}
