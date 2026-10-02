/**
 * briefPdfController — turn a built brief into a PDF.
 *
 * ── WHY SERVER-SIDE, AND WHY PUPPETEER ───────────────────────────────
 * The report is a document: tables, page-break rules, a print stylesheet.
 * The client-side options rasterise it — html2canvas screenshots the DOM,
 * so the text stops being text. It cannot be selected, searched or copied,
 * tables blur at print resolution, and the file is several times larger.
 * For something a client reads and quotes from, that is the wrong trade.
 *
 * Puppeteer drives the same Chrome print engine the "Print / Save as PDF"
 * button uses, so the output is identical to what the user would get by
 * hand — real text, real page breaks, the `@media print` rules already in
 * the report honoured — without nine manual print dialogs.
 *
 * ── WHY IT ACCEPTS HTML RATHER THAN REBUILDING IT ────────────────────
 * The report builder lives in the frontend and is already the single
 * source of truth for what a brief looks like. Rebuilding it here would
 * create a second implementation to drift. The client sends the exact
 * document it would otherwise have downloaded.
 *
 * ── THE RISK THAT CREATES, AND WHAT IS DONE ABOUT IT ─────────────────
 * Rendering caller-supplied HTML in a real browser is how SSRF happens:
 * a crafted page can ask the server to fetch anything the server can
 * reach, including cloud metadata endpoints. So:
 *
 *   · the route sits behind `protect`, as the rest of the dashboard does;
 *   · request interception blocks every network request except the font
 *     stylesheet the report's own `@import` needs;
 *   · JavaScript is disabled in the page — the report is static markup
 *     and has no need of it;
 *   · the page gets a hard timeout and the browser is always closed.
 */
const puppeteer = require('puppeteer');

/** Only what the report's own stylesheet needs. Everything else is refused. */
const ALLOWED_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

const MAX_HTML_BYTES = 8 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 45000;

/**
 * @route POST /api/cm-dashboard/brief/pdf
 * @body  { html: string, filename?: string, landscape?: boolean }
 */
const renderBriefPdf = async (req, res) => {
    const { html, filename } = req.body || {};

    if (typeof html !== 'string' || !html.trim()) {
        return res.status(400).json({ message: 'html is required' });
    }
    if (Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES) {
        return res.status(413).json({ message: 'Report too large to render' });
    }

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });
        const page = await browser.newPage();

        // The report is static markup; scripts would only be someone else's.
        await page.setJavaScriptEnabled(false);

        await page.setRequestInterception(true);
        page.on('request', (r) => {
            if (r.url().startsWith('data:')) return r.continue();
            let host;
            try { host = new URL(r.url()).hostname; } catch { return r.abort(); }
            return ALLOWED_HOSTS.has(host) ? r.continue() : r.abort();
        });

        await page.setContent(html, { waitUntil: 'networkidle0', timeout: RENDER_TIMEOUT_MS });

        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,          // the report's colour coding carries meaning
            preferCSSPageSize: false,
            margin: { top: '14mm', right: '12mm', bottom: '16mm', left: '12mm' },
            displayHeaderFooter: true,
            headerTemplate: '<div></div>',
            // A page number, because these get printed and passed around.
            footerTemplate: '<div style="width:100%;font-size:8px;color:#9ca3af;'
                + 'padding:0 12mm;text-align:right;font-family:Arial,sans-serif;">'
                + '<span class="pageNumber"></span> / <span class="totalPages"></span></div>',
            timeout: RENDER_TIMEOUT_MS,
        });

        /**
         * Puppeteer v23+ resolves a Uint8Array, not a Buffer.
         *
         * `res.end()` and `Content-Length` happen to tolerate both, so this
         * would have shipped and only shown up as a subtly wrong byte count
         * or a corrupt download on some Express/Node combinations. Convert
         * once, explicitly, rather than rely on that.
         */
        const body = Buffer.isBuffer(pdf) ? pdf : Buffer.from(pdf);
        if (!body.length || body.subarray(0, 4).toString() !== '%PDF') {
            throw new Error('renderer produced something that is not a PDF');
        }

        const safe = String(filename || 'brief').replace(/[^A-Za-z0-9._-]+/g, '-');
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${safe}.pdf"`);
        res.setHeader('Content-Length', body.length);
        return res.end(body);
    } catch (err) {
        console.error(`[BriefPdf] render failed: ${err.message}`);
        return res.status(500).json({ message: `PDF render failed: ${err.message}` });
    } finally {
        // Always, including on the timeout path — a leaked Chrome holds
        // hundreds of megabytes and this box runs several other apps.
        if (browser) await browser.close().catch(() => {});
    }
};

module.exports = { renderBriefPdf };
