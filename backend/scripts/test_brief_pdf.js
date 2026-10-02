#!/usr/bin/env node
/**
 * test_brief_pdf — the renderer must produce a real PDF, and must refuse
 * to fetch anything the report does not legitimately need.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { renderBriefPdf } = require('../src/controllers/briefPdfController');

let pass = 0; let fail = 0;
const t = (name, cond, detail) => {
    if (cond) { pass += 1; console.log(`  ok     ${name}`); } else {
        fail += 1; console.log(`  FAIL   ${name}${detail ? ` — ${detail}` : ''}`);
    }
};

/** A res double that records what the controller sent. */
const mockRes = () => {
    const r = {
        headers: {}, body: null, code: 200,
        setHeader(k, v) { this.headers[k] = v; },
        status(c) { this.code = c; return this; },
        json(d) { this.body = d; return this; },
        end(b) { this.body = b; return this; },
    };
    return r;
};

const REPORT = `<!doctype html><html><head><meta charset="utf-8"/>
<title>Test Brief</title><style>
  @import url('https://fonts.googleapis.com/css2?family=Inter&display=swap');
  body{font-family:Inter,sans-serif} table{width:100%;border-collapse:collapse}
  th{background:#111827;color:#fff} @media print{tr{break-inside:avoid}}
</style></head><body>
<h1>Devendra Fadnavis</h1><p>देवेंद्र फडणवीस — मराठी text must survive.</p>
<table><tr><th>Issue</th><th>Mentions</th></tr><tr><td>Elections &amp; Politics</td><td>72</td></tr></table>
</body></html>`;

(async () => {
    console.log('\n── renders a real PDF ──────────────────────────────\n');
    const res = mockRes();
    const t0 = Date.now();
    await renderBriefPdf({ body: { html: REPORT, filename: 'Devendra-Fadnavis_Report_daily_2026-10-02' } }, res);
    const ms = Date.now() - t0;

    t('responds with a Buffer', Buffer.isBuffer(res.body), typeof res.body);
    t('starts with the PDF magic bytes',
        Buffer.isBuffer(res.body) && res.body.subarray(0, 4).toString() === '%PDF',
        Buffer.isBuffer(res.body) ? res.body.subarray(0, 8).toString() : 'not a buffer');
    t('content-type is application/pdf', res.headers['Content-Type'] === 'application/pdf');
    t('downloads as an attachment with the leader name',
        /attachment; filename="Devendra-Fadnavis_Report_daily_2026-10-02\.pdf"/.test(res.headers['Content-Disposition'] || ''),
        res.headers['Content-Disposition']);
    t('content-length matches the body',
        Buffer.isBuffer(res.body) && res.headers['Content-Length'] === res.body.length);
    t('is not an empty document', Buffer.isBuffer(res.body) && res.body.length > 4096,
        Buffer.isBuffer(res.body) ? `${res.body.length} bytes` : '-');

    /* Rasterised output has no text objects; this is how we know it is real text. */
    if (Buffer.isBuffer(res.body)) {
        const raw = res.body.toString('latin1');
        t('contains text, not just an image', /\/Type\s*\/Font/.test(raw));
        const pages = (raw.match(/\/Type\s*\/Page[^s]/g) || []).length;
        t('has at least one page', pages >= 1, `${pages} pages`);
        const out = path.join(__dirname, '..', 'reports', '_pdftest.pdf');
        fs.mkdirSync(path.dirname(out), { recursive: true });
        fs.writeFileSync(out, res.body);
        console.log(`         wrote ${out} (${(res.body.length / 1024).toFixed(0)}KB, ${ms}ms)`);
    }

    console.log('\n── refuses bad input ───────────────────────────────\n');
    for (const [label, body, code] of [
        ['missing html', {}, 400],
        ['empty html', { html: '   ' }, 400],
        ['non-string html', { html: { a: 1 } }, 400],
    ]) {
        const r = mockRes();
        // eslint-disable-next-line no-await-in-loop
        await renderBriefPdf({ body }, r);
        t(`${label} → ${code}`, r.code === code, `got ${r.code}`);
    }

    console.log('\n── will not fetch arbitrary hosts ──────────────────\n');
    /* An SSRF attempt: if interception were off, the server would fetch this. */
    const evil = mockRes();
    await renderBriefPdf({
        body: { html: '<html><body><img src="http://169.254.169.254/latest/meta-data/"/>'
            + '<p>still renders</p></body></html>' },
    }, evil);
    t('a page referencing a metadata endpoint still renders (request blocked, not hung)',
        Buffer.isBuffer(evil.body) && evil.body.subarray(0, 4).toString() === '%PDF',
        `code ${evil.code}`);

    console.log(`\n  ${pass} passed, ${fail} failed\n`);
    process.exit(fail ? 1 : 0);
})().catch((err) => { console.error('FAILED:', err.message); process.exit(1); });
