/**
 * monitoringReport — the public discussion monitoring report, one per leader.
 *
 * Renders the payload of GET /api/cm-dashboard/leader-report (see
 * backend/src/controllers/leaderReportController.js) in the client's reference
 * layout: title block, period strip, headline tiles, executive summary, key
 * intelligence, what requires attention, platform / tone / keyword / day charts,
 * location trends, then numbered sections 01–12 and a closing summary.
 *
 * ── NOTHING IS SPLIT ACROSS A PAGE ───────────────────────────────────
 * Every card, tile row, chart and table row is unbreakable. A heading is held
 * in one unbreakable block with the start of what it introduces; a long table
 * is drawn as that opening block plus a continuation table with the same
 * columns, so it can only ever continue on the next page BETWEEN two rows.
 * Two-column card layouts are built as rows of two, so a pair moves together.
 * The PDF renderer runs with JavaScript off, so charts are inline SVG / CSS.
 *
 * ── LOADED TWO WAYS ──────────────────────────────────────────────────
 * The browser imports it; scripts/build_mh_leader_reports.js evaluates its
 * source. So it must stay free of imports.
 */

const asArray = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v) => Number(v) || 0;

const decode = (s) => String(s ?? '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ');
const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, max = 240) => {
    const t = decode(s).replace(/\s+/g, ' ').trim();
    if (t.length <= max) return t;
    const cut = t.slice(0, max);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30))}…`;
};

const n = (v) => num(v).toLocaleString('en-IN');
/** 1.11 crore / 42.7 lakh, as the reference prints large engagement figures. */
const big = (v) => {
    const x = num(v);
    if (x >= 1e7) return `${(Math.round((x / 1e7) * 100) / 100).toLocaleString('en-IN')} crore`;
    if (x >= 1e5) return `${(Math.round((x / 1e5) * 10) / 10).toLocaleString('en-IN')} lakh`;
    return n(x);
};
const pctOf = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dayLong = (k) => { const [y, m, d] = String(k || '').slice(0, 10).split('-').map(Number); return y ? `${d} ${MONTHS[m - 1]} ${y}` : ''; };
const IST = 5.5 * 3600 * 1000;
const when = (iso) => {
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return '';
    const s = new Date(t.getTime() + IST).toISOString();
    return `${dayLong(s.slice(0, 10))}, ${s.slice(11, 16)}`;
};

const NAVY = '#14213d';
const BLUE = '#4f46e5';
const LINK = '#2563eb';
const GREEN = '#16a34a';
const GREY = '#94a3b8';
const RED = '#dc2626';

/* ── building blocks ──────────────────────────────────────────────────── */

const h2 = (title, note) => `<h2>${esc(title)}</h2>${note ? `<p class="note">${note}</p>` : ''}`;
/** A heading and the first thing under it, as one unbreakable block. */
const keep = (inner) => `<div class="keep">${inner}</div>`;
const block = (title, body, note) => (String(body || '').trim() ? `<section class="sec">${keep(h2(title, note) + body)}</section>` : '');

const tiles = (items) => {
    const list = items.filter(Boolean);
    if (!list.length) return '';
    return `<div class="tiles c${Math.min(5, list.length)}">${list.map(([v, l]) => `<div class="tile"><div class="tv${String(v).replace(/<[^>]+>/g, '').length > 11 ? ' long' : ''}">${v}</div><div class="tl">${l}</div></div>`).join('')}</div>`;
};

const hbars = (rows, { color = BLUE, labelW = 30 } = {}) => {
    const list = rows.filter((r) => r && num(r.value) > 0);
    if (!list.length) return '';
    const max = Math.max(...list.map((r) => num(r.value)));
    return `<div class="bars">${list.map((r) => `<div class="brow"><div class="bl" style="width:${labelW}%">${esc(r.label)}</div>
      <div class="bt"><i style="width:${Math.max(1, (num(r.value) / max) * 100)}%;background:${r.color || color}"></i></div>
      <div class="bv">${r.text ? esc(r.text) : n(r.value)}</div></div>`).join('')}</div>`;
};

/** Stacked tone bar per row (positive / neutral / negative). */
const toneRows = (rows, labelW = 26) => {
    const list = rows.filter((r) => r && num(r.total) > 0);
    if (!list.length) return '';
    const max = Math.max(...list.map((r) => num(r.total)));
    return `<div class="bars">${list.map((r) => {
        const w = (v) => (num(v) / num(r.total)) * 100;
        return `<div class="brow"><div class="bl" style="width:${labelW}%">${esc(r.label)}</div>
        <div class="bt"><div class="stk" style="width:${Math.max(2, (num(r.total) / max) * 100)}%"><i style="width:${w(r.positive)}%;background:${GREEN}"></i><i style="width:${w(r.neutral)}%;background:${GREY}"></i><i style="width:${w(r.negative)}%;background:${RED}"></i></div></div>
        <div class="bv wide">${esc(r.text || '')}</div></div>`;
    }).join('')}</div>`;
};

/**
 * A table that can only ever continue on a new page between two rows. The
 * heading, the column header and the first rows are one unbreakable block; the
 * rest follow in a second table with the same fixed columns.
 */
const table = (title, note, cols, rows, { lead = 3, cls = '' } = {}) => {
    if (!rows.length) return '';
    const colgroup = `<colgroup>${cols.map((c) => `<col style="width:${c.w}%">`).join('')}</colgroup>`;
    const head = `<thead><tr>${cols.map((c) => `<th${c.r ? ' class="r"' : ''}>${esc(c.label)}</th>`).join('')}</tr></thead>`;
    const tr = (r) => `<tr>${r.map((cell, i) => `<td${cols[i]?.r ? ' class="r"' : ''}>${cell}</td>`).join('')}</tr>`;
    const first = rows.slice(0, lead).map(tr).join('');
    const rest = rows.slice(lead).map(tr).join('');
    const top = `${title ? h2(title, note) : ''}<table class="tbl ${cls}">${colgroup}${head}<tbody>${first}</tbody></table>`;
    return `${keep(top)}${rest ? `<table class="tbl cont ${cls}">${colgroup}<tbody>${rest}</tbody></table>` : ''}`;
};

/** Cards two to a row; a row is unbreakable, so a pair always moves together. */
const pairs = (cards) => {
    const out = [];
    for (let i = 0; i < cards.length; i += 2) out.push(`<div class="pair">${cards[i]}${cards[i + 1] || '<div></div>'}</div>`);
    return out;
};

/** "open" goes to the post; "▶ video" / "image" go to the media itself (the post when no media URL is stored). */
const link = (p) => {
    if (!p) return '';
    const a = (href, cls, label) => (href ? ` <a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener">${label}</a>` : '');
    const mediaHref = p.media_url || p.url;
    return `${a(p.url, 'op', 'open')}${p.media === 'video' ? a(mediaHref, 'vid', '▶ video') : p.media === 'image' ? a(mediaHref, 'img', 'image') : ''}`;
};
const acct = (name) => (name && name !== 'Private account' ? `<span class="acc">${esc(name)}</span>` : 'Private account');

/* ── the report ───────────────────────────────────────────────────────── */

export const buildMonitoringReportHtml = (data, opts = {}) => {
    const d = isObj(data) ? data : {};
    const m = d.meta || {};
    const t = d.tiles || {};
    const tone = d.tone || {};
    const stance = d.stance || {};
    const bands = d.bands || {};
    const N = num(m.relevant);
    const subject = m.subject_label || m.name || 'the subject';
    const platforms = asArray(m.platforms);
    // The report is about a state's leaders, so it carries that state's name —
    // not the host app's ("Chhattisgarh Political Watch" on a Maharashtra report).
    const appName = m.state ? `${m.state} Political Watch` : (opts.appName || 'Blura SAGA');

    /* ── title, period strip, tiles ───────────────────────────────── */
    const header = `<header class="hero">
      <div class="eyebrow">Public discussion monitoring report</div>
      <h1>${esc(m.name || 'All monitored leaders')}</h1>
      ${m.role ? `<div class="role">${esc(m.role)}</div>` : ''}
      <p class="sub">${esc([m.party, m.base, m.state].filter(Boolean).join(' · '))}${platforms.length ? `<br>Public discussion on ${esc(platforms.map((p) => p.name).join(', '))}` : ''}</p>
    </header>
    <table class="meta"><thead><tr><th>Report period</th><th>Generated</th><th>Posts analysed</th><th>Platforms</th></tr></thead>
      <tbody><tr><td>${esc(m.period || '')}</td><td>${esc(m.generated || '')}</td><td>${n(N)}</td><td>${esc(platforms.map((p) => p.name).join(', ') || '—')}</td></tr></tbody></table>`;

    const lead = t.lead ? `${esc(t.lead.name)}<span class="tsub">(${pctOf(t.lead.n, N)}%)</span>` : '—';
    const tiles1 = tiles([
        [n(t.relevant), 'Relevant posts'], [lead, 'Lead platform'], [n(t.places), 'Places named'],
        [n(t.negative), 'Negative posts'], [big(t.engagement), 'Engagement'],
    ]);
    const tiles2 = tiles([
        [`${t.positive_pct ?? 0}%`, 'Positive'], [`${t.neutral_pct ?? 0}%`, 'Neutral'], [`${t.negative_pct ?? 0}%`, 'Negative share'],
        [n(t.high_critical), 'High / critical risk'],
        [t.top_tag ? esc(t.top_tag.tag) : '—', `Top hashtag${t.top_tag ? ` (${n(t.top_tag.n)})` : ''}`],
    ]);
    const platNote = `<p class="foot">Platforms: ${esc(platforms.map((p) => `${p.name} ${n(p.n)}`).join(' · ') || 'none')}. ${n(m.collected)} posts collected, ${n(m.excluded)} judged unrelated and excluded.${num(d.instagram_unscored) ? ` ${n(d.instagram_unscored)} Instagram posts are not yet scored and are not counted.` : ''}</p>`;

    /* ── executive summary ────────────────────────────────────────── */
    const sumRows = asArray(d.summary).map((r) => `<div class="krow"><div class="kk">${esc(r.label)}</div><div class="kv">${esc(decode(r.text))}</div></div>`);
    const execSummary = sumRows.length
        ? `<section class="sec">${keep(h2('Executive summary') + sumRows[0])}${sumRows.slice(1).join('')}</section>` : '';

    /* ── key intelligence (2 columns) ─────────────────────────────── */
    const intelCards = asArray(d.intel).map((c) => `<div class="icard"><div class="it">${esc(c.title)}</div><p>${esc(decode(c.body))}</p>${c.note ? `<p class="in">${esc(c.note)}</p>` : ''}</div>`);
    const intelRows = pairs(intelCards);
    const intel = intelRows.length ? `<section class="sec">${keep(h2('Key intelligence') + intelRows[0])}${intelRows.slice(1).join('')}</section>` : '';

    /* ── what requires attention ──────────────────────────────────── */
    const SEV = { high: ['HIGH', RED, '#fef2f2'], medium: ['MEDIUM', '#ca8a04', '#fefce8'], low: ['LOW', '#64748b', '#f8fafc'] };
    const attn = asArray(d.attention).map((a) => {
        const [lab, col, bg] = SEV[a.severity] || SEV.low;
        return `<div class="acard" style="border-left-color:${col};background:${bg}"><div class="ah"><b>${esc(a.title)}</b><span style="color:${col}">${lab}</span></div><p>${esc(decode(a.body))}</p></div>`;
    });
    const attention = attn.length ? `<section class="sec">${keep(h2('What requires attention') + attn[0])}${attn.slice(1).join('')}</section>` : '';

    /* ── platforms, tone, keywords ────────────────────────────────── */
    const platformSec = block('Posts by platform', hbars(platforms.map((p) => ({ label: p.name, value: p.n })), { labelW: 14 }));
    const toneTotal = num(tone.positive) + num(tone.neutral) + num(tone.negative);
    const seg = (v, c, label) => (v ? `<span style="width:${(v / toneTotal) * 100}%;background:${c}">${(v / toneTotal) * 100 >= 12 ? label : ''}</span>` : '');
    const toneSec = toneTotal ? block('Tone split', `<div class="tone">${seg(num(tone.positive), GREEN, `${pctOf(tone.positive, toneTotal)}%`)}${seg(num(tone.neutral), GREY, `Neutral ${n(tone.neutral)} (${pctOf(tone.neutral, toneTotal)}%)`)}${seg(num(tone.negative), RED, `Negative ${n(tone.negative)} (${pctOf(tone.negative, toneTotal)}%)`)}</div>`) : '';
    const kwSec = block('Share of voice by keyword', hbars(asArray(d.keywords).map((k) => ({ label: k.term, value: k.n }))),
        'Relevant posts mentioning each tracked term. A post can mention several.');

    /* ── posts and negativity by day: column chart + table ────────── */
    const days = asArray(d.days);
    const daysWithPosts = days.filter((x) => num(x.posts) > 0);
    const chartDays = days.slice(0, 31);
    const maxDay = Math.max(1, ...chartDays.map((x) => num(x.posts)));
    const W = 680; const H = 210; const top = 34; const left = 40; const bottom = 34;
    const colW = (W - left - 6) / Math.max(1, chartDays.length);
    const bw = Math.max(6, Math.min(34, colW * 0.62));
    const yScale = (v) => ((H - top - bottom) * v) / maxDay;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxDay * f));
    let svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" xmlns="http://www.w3.org/2000/svg" font-family="Inter, Arial, sans-serif">`;
    ticks.forEach((v) => { const y = H - bottom - yScale(v); svg += `<line x1="${left}" x2="${W}" y1="${y}" y2="${y}" stroke="#e5e7eb"/><text x="${left - 6}" y="${y + 3}" font-size="9" text-anchor="end" fill="#64748b">${n(v)}</text>`; });
    let lastMonth = '';
    chartDays.forEach((x, i) => {
        const cx = left + colW * i + (colW - bw) / 2;
        let y = H - bottom;
        [[x.negative, RED], [x.neutral, GREY], [x.positive, GREEN]].forEach(([v, c]) => {
            const h = yScale(num(v));
            if (h > 0) { y -= h; svg += `<rect x="${cx}" y="${y}" width="${bw}" height="${h}" fill="${c}"/>`; }
        });
        if (num(x.posts)) {
            svg += `<text x="${cx + bw / 2}" y="${y - 13}" font-size="8.5" font-weight="700" text-anchor="middle" fill="${NAVY}">${n(x.posts)}</text>`;
            svg += `<text x="${cx + bw / 2}" y="${y - 4}" font-size="7.5" text-anchor="middle" fill="#64748b">${x.neg_pct}% neg</text>`;
        }
        if (num(x.high_risk)) svg += `<circle cx="${cx + bw / 2}" cy="${H - bottom + 6}" r="2.6" fill="${RED}"/>`;
        const [, mo, dd] = String(x.day).split('-').map(Number);
        svg += `<text x="${cx + bw / 2}" y="${H - bottom + 17}" font-size="9" text-anchor="middle" fill="#334155">${dd}</text>`;
        if (MONTHS[mo - 1] !== lastMonth) { svg += `<text x="${cx}" y="${H - 4}" font-size="9" fill="#64748b">${MONTHS[mo - 1]}</text>`; lastMonth = MONTHS[mo - 1]; }
    });
    svg += '</svg>';
    const peak = d.peak;
    const dayNote = `Relevant posts per day by publication date (Indian Standard Time), newest date first, split by tone: <b style="color:${RED}">negative</b>, <b style="color:#64748b">neutral</b>, <b style="color:${GREEN}">positive</b>. The figure above each bar is that day's share of negative posts; a red dot marks days with critical or high-risk posts.${peak ? ` Peak: ${n(peak.posts)} posts on ${dayLong(peak.day)}.` : ''}`;
    const daySec = daysWithPosts.length ? `<section class="sec">${keep(h2('Posts and negativity by day', dayNote) + `<div class="chart">${svg}</div>`)}
      ${table('', '', [
        { label: 'Day', w: 15 }, { label: 'Posts', w: 8, r: true }, { label: '% negative', w: 10, r: true },
        { label: `Critical of ${subject}`, w: 13, r: true }, { label: 'High-risk', w: 9, r: true },
        { label: 'Leading narrative', w: 30 }, { label: 'Most-named place', w: 15 }],
        days.map((x) => [`<b>${esc(dayLong(x.day))}</b>`, n(x.posts), `${x.neg_pct}%`, n(x.critical_of), n(x.high_risk), esc(x.leading || '—'), esc(x.place || '—')]),
        { lead: 4, cls: 'navy' })}</section>` : '';

    /* ── location trends (heat table) ─────────────────────────────── */
    const pt = d.place_trend || {};
    const ptDays = asArray(pt.days).slice(0, 14);
    const ptRows = asArray(pt.rows);
    const maxCell = Math.max(1, ...ptRows.flatMap((r) => ptDays.map((k) => num(r.by_day?.[k]))));
    const heatCols = [{ label: 'Place', w: 16 }, ...ptDays.map((k) => ({ label: String(Number(String(k).slice(8, 10))), w: 60 / Math.max(1, ptDays.length), r: true })),
        { label: 'Total', w: 10, r: true }, { label: '% negative', w: 14, r: true }];
    const heat = (v) => {
        if (!v) return '';
        const a = 0.12 + 0.78 * (v / maxCell);
        return `<span class="heat" style="background:rgba(30,58,138,${a.toFixed(2)});color:${a > 0.5 ? '#fff' : NAVY}">${n(v)}</span>`;
    };
    const locSec = ptRows.length ? `<section class="sec">${table('Location trends',
        'Daily posts naming each of the most-mentioned places, newest date first (darker = more posts), with each place\'s share of negative posts. A place counts only when a post names it.',
        heatCols, ptRows.map((r) => [`<b>${esc(r.place)}</b>`, ...ptDays.map((k) => heat(num(r.by_day?.[k]))), n(r.total), `${r.neg_pct}%`]),
        { lead: 4, cls: 'heatt' })}</section>` : '';

    /* ── 01. activity ─────────────────────────────────────────────── */
    const act = d.activity || {};
    const actItems = asArray(act.items);
    const actList = actItems.map((a) => `<li><b>${esc(a.type)}:</b> ${n(a.n)} posts (${n(a.critical)} critical of ${esc(subject)}).${a.example ? ` Most engaged: ${acct(a.example.account)} — “${esc(clip(a.example.text, 150))}”${link(a.example)}` : ''}</li>`);
    const actSec = actItems.length ? `<section class="sec">${keep(h2('01. Activity analysis') + tiles([[n(act.total), 'Activity posts'], [n(act.in_window), 'Posts in window'], [act.lead ? esc(act.lead.name) : '—', 'Lead platform'], [big(act.engagement), 'Engagement']])
        + '<p class="note">Praise, criticism, complaints and other actions the posts carry, as classified by the analysis.</p>' + `<ul class="list">${actList[0]}</ul>`)}
        ${actList.length > 1 ? `<ul class="list">${actList.slice(1).join('')}</ul>` : ''}
        ${table('', '', [{ label: 'Activity', w: 17 }, { label: 'Posts dated', w: 25 }, { label: 'Place', w: 13 }, { label: 'What posts report', w: 45 }],
            actItems.map((a) => [`<b>${esc(a.type)}</b>`, a.first ? `${esc(dayLong(a.last))} back to ${esc(dayLong(a.first))}; busiest ${esc(dayLong(a.busiest))}` : '—',
                esc(a.place || '—'), a.example ? `${esc(clip(a.example.text, 170))}${link(a.example)}` : '—']), { lead: 2, cls: 'navy' })}</section>` : '';

    /* ── 02. places ───────────────────────────────────────────────── */
    const places = asArray(d.places);
    const placeSec = places.length ? `<section class="sec">${keep(h2('02. Where the discussion is located')
        + tiles([[n(t.places), 'Places named'], [esc(places[0].place), 'Most named place'], [n(places[0].posts), 'Posts at top place']])
        + '<p class="note">Posts by place named in the text. Places are counted only when a post names them; nothing here tracks individuals.</p>'
        + hbars(places.map((p) => ({ label: p.place, value: p.posts })), { color: NAVY, labelW: 22 }))}
        ${table('', '', [{ label: 'Place', w: 20 }, { label: 'Posts', w: 10, r: true }, { label: 'Negative', w: 11, r: true }, { label: 'Context', w: 59 }],
            places.map((p) => [`<b>${esc(p.place)}</b>`, n(p.posts), n(p.negative), esc(p.context || '')]), { lead: 3, cls: 'navy' })}</section>` : '';

    /* ── 03. sentiment and stance ─────────────────────────────────── */
    const stanceTotal = num(stance.supportive) + num(stance.critical) + num(stance.neutral) + num(stance.unclear);
    const stanceBars = [['supportive', GREEN], ['critical', RED], ['neutral', GREY], ['unclear', '#cbd5e1']]
        .map(([k, c]) => ({ label: k, value: num(stance[k]), color: c, text: `${n(stance[k])} (${pctOf(stance[k], stanceTotal)}%)` }));
    const bandBars = [['critical', '#b91c1c'], ['high', '#ea580c'], ['medium', '#ca8a04'], ['low', '#94a3b8']]
        .map(([k, c]) => ({ label: k, value: num(bands[k]), color: c, text: `${n(bands[k])} (${pctOf(bands[k], N)}%)` }));
    const sentSec = N ? block('03. Sentiment and stance', tiles([
        [n(tone.positive), `Positive (${pctOf(tone.positive, N)}%)`], [n(tone.neutral), `Neutral (${pctOf(tone.neutral, N)}%)`],
        [n(tone.negative), `Negative (${pctOf(tone.negative, N)}%)`], [n(N), 'Analysed']])
        + '<p class="note">Tone and stance are measured separately. Negative tone is the criticism load, not a threat by itself.</p>'
        + `<div class="pair"><div><div class="mini">Stance toward ${esc(subject)}</div>${hbars(stanceBars, { labelW: 24 })}</div><div><div class="mini">Risk band of the same posts</div>${hbars(bandBars, { labelW: 24 })}</div></div>`) : '';
    const sbp = asArray(d.stance_by_platform);
    const sbpSec = sbp.length ? table(`Stance toward ${subject} by platform`, 'Counts of posts on each platform by their position on the subject, and by tone.',
        [{ label: 'Platform', w: 16 }, { label: 'Posts', w: 10, r: true }, { label: 'Supportive', w: 12, r: true }, { label: 'Critical', w: 12, r: true },
            { label: 'Neutral', w: 12, r: true }, { label: 'Unclear', w: 12, r: true }, { label: 'Positive tone', w: 13, r: true }, { label: 'Negative tone', w: 13, r: true }],
        sbp.map((r) => [`<b>${esc(r.platform)}</b>`, n(r.posts), `<b style="color:${GREEN}">${n(r.supportive)}</b>`, `<b style="color:${RED}">${n(r.critical)}</b>`,
            n(r.neutral), n(r.unclear), n(r.positive), n(r.negative)]), { lead: 10, cls: 'navy' }) : '';
    const sa = d.stance_accounts || {};
    const whoTable = (key, label, col) => {
        const w = sa[key] || {};
        const rows = asArray(w.named).map((r) => [acct(r.name), `<span class="nw">${esc(r.platform)}</span>`, esc(r.type), `<b style="color:${col}">${n(r.posts)}</b>`]);
        if (num(w.private_posts)) rows.push([`<i>Private individuals (${n(w.private_accounts)} accounts)</i>`, '—', 'Not named', `<b style="color:${col}">${n(w.private_posts)}</b>`]);
        if (!rows.length) return `<div><div class="mini" style="color:${col}">${label}</div><p class="note">None in this period.</p></div>`;
        return `<div><div class="mini" style="color:${col}">${label}</div><table class="tbl navy"><colgroup><col style="width:38%"><col style="width:21%"><col style="width:27%"><col style="width:14%"></colgroup>
          <thead><tr><th>Account</th><th>Platform</th><th>Type</th><th class="r">Posts</th></tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${i === 3 ? ' class="r"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    };
    const whoSec = (asArray(sa.supportive?.named).length || num(sa.supportive?.private_posts) || asArray(sa.critical?.named).length || num(sa.critical?.private_posts))
        ? keep(`<div class="mini" style="margin-top:12px">Who is supportive and who is critical of ${esc(subject)}</div><p class="note">Public accounts (verified, own, party, news and YouTube channels) are named; private individuals are counted, not named.</p><div class="pair">${whoTable('supportive', 'Supportive', GREEN)}${whoTable('critical', 'Critical', RED)}</div>`) : '';

    /* ── 04. positive / negative / neutral ────────────────────────── */
    const tb = d.tone_blocks || {};
    const toneCol = (key, label, col) => {
        const b = tb[key] || {};
        const list = (arr) => asArray(arr).map((x) => `${esc(x.k)} ${n(x.v)}`).join(' · ');
        return `<div class="tcol"><div class="th" style="color:${col}">${label} <span>${n(b.n)} · ${b.pct ?? 0}%</span></div>
          <p><b>Platforms:</b> ${list(b.platforms) || '—'}</p>
          <p><b>Toward ${esc(subject)}:</b> ${list(b.stance) || '—'}</p>
          <p><b>Narratives:</b> ${asArray(b.narratives).map((x) => `${esc(x.k)} (${n(x.v)})`).join('; ') || '—'}</p>
          <p><b>Hashtags:</b> ${asArray(b.hashtags).map(esc).join(' ') || '—'}</p>
          <p><b>Engagement:</b> ${n(b.engagement)}</p></div>`;
    };
    const tri = `<div class="tri">${toneCol('positive', 'Positive', GREEN)}${toneCol('negative', 'Negative', RED)}${toneCol('neutral', 'Neutral', '#64748b')}</div>`;
    const negTop = asArray(d.top_negative);
    const toneSec4 = N ? `<section class="sec">${keep(h2('04. Positive, negative and neutral posts',
        `Each post's overall tone, separated. Tone is not the same as stance: a negative post can be negative about someone other than ${esc(subject)} — the stance line under each tone shows which.`) + tri)}
        ${table('Negative posts — highest engagement', '', [{ label: 'When', w: 15 }, { label: 'Platform', w: 10 }, { label: 'Account', w: 17 }, { label: 'What it says', w: 45 }, { label: 'Engagement', w: 13, r: true }],
            negTop.map((p) => [esc(when(p.when)), esc(p.platform), acct(p.account), `${esc(clip(p.text, 220))}${link(p)}`, n(p.engagement)]), { lead: 3, cls: 'navy' })}</section>` : '';

    /* ── 05. risk bands ───────────────────────────────────────────── */
    const BAND = { critical: ['CRITICAL', '#b91c1c'], high: ['HIGH', '#ea580c'] };
    const riskRows = asArray(d.risk?.rows);
    const riskSec = N ? `<section class="sec">${keep(h2('05. Risk-band tracking') + tiles([
        [n(bands.critical), `Critical (${pctOf(bands.critical, N)}%)`], [n(bands.high), `High (${pctOf(bands.high, N)}%)`],
        [n(bands.medium), `Medium (${pctOf(bands.medium, N)}%)`], [n(bands.low), `Low (${pctOf(bands.low, N)}%)`]])
        + '<p class="note">Read critical and high rows first. Criticism of a public official, satire and calls for resignation are lawful political speech and are tracked as sentiment only. Critical is reserved for threats, incitement and violence; high for hate, communal or abusive content and misinformation. Private accounts are not named.</p>')}
        ${table('', '', [{ label: 'Band', w: 10 }, { label: 'When', w: 14 }, { label: 'Platform', w: 9 }, { label: 'Account', w: 14 }, { label: 'What it says', w: 30 }, { label: 'Why flagged', w: 23 }],
            riskRows.map((r) => { const [lab, col] = BAND[r.band] || ['', '#64748b']; return [`<span class="chip" style="background:${col}">${lab}</span>`, esc(when(r.when)), esc(r.platform), acct(r.account), `${esc(clip(r.text, 170))}${link(r)}`, esc(clip(r.why, 150))]; }),
            { lead: 3, cls: 'navy' })}
        ${asArray(d.risk?.medium_rows).length ? table('Medium band — highest engagement', 'Strongly worded posts the risk model rated high, without threats or abuse. Tracked, not escalated.',
            [{ label: 'When', w: 15 }, { label: 'Platform', w: 9 }, { label: 'Account', w: 15 }, { label: 'What it says', w: 36 }, { label: 'Why', w: 25 }],
            asArray(d.risk.medium_rows).map((r) => [esc(when(r.when)), esc(r.platform), acct(r.account), `${esc(clip(r.text, 170))}${link(r)}`, esc(clip(r.why, 140))]),
            { lead: 3, cls: 'navy' }) : ''}</section>` : '';

    /* ── 06. entities ─────────────────────────────────────────────── */
    const ents = asArray(d.entities);
    const entSec = ents.length ? `<section class="sec">${keep(h2('06. Who and what is being discussed')
        + toneRows(ents.map((e) => ({ label: e.name, total: e.n, positive: e.positive, neutral: e.neutral, negative: e.negative, text: `${Math.round(e.neg_pct)}% neg · ${n(e.n)} posts` }))))}
        ${table('', '', [{ label: 'Person / organisation', w: 40 }, { label: 'Posts', w: 15, r: true }, { label: 'Positive', w: 15, r: true }, { label: 'Neutral', w: 15, r: true }, { label: 'Negative', w: 15, r: true }],
            ents.map((e) => [`<b>${esc(e.name)}</b>`, n(e.n), n(e.positive), n(e.neutral), n(e.negative)]), { lead: 3, cls: 'navy' })}
        ${asArray(d.attack_targets).length ? keep(`<p class="foot">Most often the target of criticism: ${asArray(d.attack_targets).map((a) => `${esc(a.k)} (${n(a.v)})`).join(', ')}.</p>`) : ''}</section>` : '';

    /* ── 07. influencers ──────────────────────────────────────────── */
    const inf = d.influencers || {};
    const infRows = asArray(inf.rows);
    const infSec = infRows.length ? `<section class="sec">${keep(h2('07. Influencer ecosystem') + tiles([
        [n(inf.public_accounts), 'Public accounts'], [esc(inf.top_platform || '—'), 'Top platform'], [big(inf.top_score), 'Top engagement score'], [big(inf.likes), 'Likes']])
        + `<p class="note">Engagement score = likes + 2×comments + 3×shares + views/10. ${n(inf.shares)} shares · ${n(inf.comments)} comments. Only verified accounts, the leaders' own accounts, opposition and news accounts are listed. Ranking reflects measurable reach, not intent.</p>`
        + hbars(infRows.slice(0, 8).map((r) => ({ label: r.name, value: r.score })), { color: NAVY, labelW: 26 }))}
        ${table('', '', [{ label: 'Account', w: 27 }, { label: 'Type', w: 15 }, { label: 'Platform', w: 11 }, { label: 'Posts', w: 8, r: true }, { label: 'Score', w: 12, r: true }, { label: 'Mostly', w: 27 }],
            infRows.map((r) => [acct(r.name), esc(r.type), esc(r.platform), n(r.posts), n(r.score), esc(r.mostly)]), { lead: 3, cls: 'navy' })}</section>` : '';

    /* ── 08. narratives ───────────────────────────────────────────── */
    const narr = asArray(d.narratives).map((x) => `<div class="ncard"><div class="nt">${esc(x.topic)}</div>
      <div class="nm">${n(x.n)} posts · ${x.pct}% · ${esc(x.trend)}${x.platforms ? ` · ${esc(x.platforms)}` : ''}</div>
      <p>${esc(x.description)}</p>
      ${asArray(x.examples).map((e) => `<div class="ne">— ${acct(e.account)}: ${esc(clip(e.text, 170))}${link(e)}</div>`).join('')}</div>`);
    const narrSec = narr.length ? `<section class="sec">${keep(h2('08. Key narratives') + narr[0])}${narr.slice(1).join('')}</section>` : '';

    /* ── 09. claims ───────────────────────────────────────────────── */
    const claims = asArray(d.claims);
    const claimSec = claims.length ? `<section class="sec">${table('09. Claims in posts (unverified)',
        'Posts the analysis classified as possible misinformation. They are allegations stated in posts, not checked facts.',
        [{ label: 'When', w: 15 }, { label: 'Account', w: 16 }, { label: 'What it says', w: 41 }, { label: 'Why flagged', w: 28 }],
        claims.map((c) => [esc(when(c.when)), acct(c.account), `${esc(clip(c.text, 180))}${link(c)}`, esc(clip(c.why, 160))]), { lead: 3, cls: 'navy' })}</section>` : '';

    /* ── 10. evidence, 11. footage ────────────────────────────────── */
    const ev = asArray(d.evidence);
    const evSec = ev.length ? `<section class="sec">${table('10. Evidence register (media sample)', 'Posts with images or video from public accounts, highest engagement first.',
        [{ label: 'When', w: 16 }, { label: 'Platform', w: 11 }, { label: 'Outlet / account', w: 18 }, { label: 'Summary', w: 43 }, { label: 'Engagement', w: 12, r: true }],
        ev.map((p) => [esc(when(p.when)), esc(p.platform), acct(p.account), `${esc(clip(p.text, 200))}${link(p)}`, n(p.engagement)]), { lead: 3, cls: 'navy' })}</section>` : '';
    const ft = asArray(d.footage);
    const ftSec = ft.length ? `<section class="sec">${table('11. Footage', `${n(ft.length)} video posts, most viewed first.`,
        [{ label: 'When', w: 16 }, { label: 'Platform', w: 11 }, { label: 'Account', w: 18 }, { label: 'What it shows', w: 41 }, { label: 'Views', w: 14, r: true }],
        ft.map((p) => [esc(when(p.when)), esc(p.platform), acct(p.account), `${esc(clip(p.text, 190))}${link(p)}`, n(p.views || p.engagement)]), { lead: 3, cls: 'navy' })}</section>` : '';

    /* ── summary ──────────────────────────────────────────────────── */
    const summaryItems = [
        `Prepared for: ${m.name || 'All monitored leaders'}${m.role ? `, ${m.role}` : ''}.`,
        `Period: ${m.period || ''}.`,
        `Platforms: ${platforms.map((p) => `${p.name} ${n(p.n)}`).join(' · ')}.`,
        `Posts: ${n(m.collected)} collected, ${n(N)} relevant, ${n(m.excluded)} excluded as unrelated.`,
        `Tone (positive / neutral / negative): ${n(tone.positive)} / ${n(tone.neutral)} / ${n(tone.negative)}.`,
        `Risk bands (critical / high / medium / low): ${n(bands.critical)} / ${n(bands.high)} / ${n(bands.medium)} / ${n(bands.low)}.`,
    ];
    const closing = `<section class="sec">${keep(h2('Summary') + (d.closing ? `<p class="close">${esc(decode(d.closing))}</p>` : '')
        + `<ul class="list">${summaryItems.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`
        + (num(d.review_coverage?.shown) ? `<p class="close"><b>Review.</b> ${num(d.review_coverage.reviewed) === num(d.review_coverage.shown)
            ? `All ${n(d.review_coverage.shown)} posts quoted in this report's tables were individually reviewed for relevance to ${esc(subject)}, tone, stance, risk band and claims; the reviewed reading replaces the automatic one.`
            : `${n(d.review_coverage.reviewed)} of the ${n(d.review_coverage.shown)} posts quoted in this report's tables were individually reviewed; the rest carry the automatic reading.`}</p>` : '')
        + `<p class="ref">${esc(appName)} · public discussion monitoring · ${esc(m.name || '')} · ${esc(m.period || '')}. Automatic classification can misread sarcasm, quotes and replies; treat individual counts as indicative.</p>`)}</section>`;

    const css = `
    @page { size: A4; margin: 14mm 12mm 16mm 12mm; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: 'Inter', 'Noto Sans Devanagari', -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; color: #1f2937; font-size: 10.8px; line-height: 1.55; }
    a { color: ${LINK}; text-decoration: none; }
    .page { max-width: 186mm; margin: 0 auto; }
    .hero .eyebrow { font-size: 9.5px; letter-spacing: .14em; text-transform: uppercase; color: #64748b; font-weight: 600; }
    .hero h1 { font-size: 31px; line-height: 1.1; margin: 5px 0 2px; color: ${NAVY}; font-weight: 800; letter-spacing: -.02em; }
    .hero .role { font-size: 15px; font-weight: 700; color: #1e3a8a; }
    .hero .sub { margin: 6px 0 12px; color: #475569; font-size: 12px; line-height: 1.5; }
    table { border-collapse: collapse; width: 100%; }
    tr, .tile, .tiles, .krow, .icard, .pair, .acard, .ncard, .cbox, .brow, .tone, .chart, .tri, .list li, .keep, .close, .ref, .foot { break-inside: avoid; page-break-inside: avoid; }
    .meta { margin-bottom: 14px; }
    .meta th { background: ${NAVY}; color: #fff; font-size: 9px; letter-spacing: .08em; text-transform: uppercase; text-align: left; padding: 7px 10px; font-weight: 600; }
    .meta td { padding: 8px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; }
    .tiles { display: grid; gap: 8px; margin: 0 0 8px; }
    .tiles.c5 { grid-template-columns: repeat(5, 1fr); } .tiles.c4 { grid-template-columns: repeat(4, 1fr); } .tiles.c3 { grid-template-columns: repeat(3, 1fr); }
    .tile { border: 1px solid #e0e7ff; border-top: 3px solid #818cf8; background: #f8faff; border-radius: 3px; padding: 10px 11px 9px; min-height: 66px; }
    .tv { font-size: 20px; font-weight: 800; color: ${NAVY}; letter-spacing: -.02em; line-height: 1.15; overflow-wrap: anywhere; }
    .tv.long { font-size: 14px; } .tsub { font-size: 9px; font-weight: 600; color: #64748b; margin-left: 3px; letter-spacing: 0; }
    .tl { font-size: 8.5px; letter-spacing: .06em; text-transform: uppercase; color: #64748b; font-weight: 600; margin-top: 4px; }
    .foot { color: #64748b; font-style: italic; font-size: 10px; margin: 4px 0 0; }
    .sec { margin: 20px 0 0; }
    h2 { font-size: 16px; color: ${NAVY}; margin: 0 0 8px; padding-bottom: 5px; border-bottom: 2px solid ${NAVY}; font-weight: 800; }
    .note { color: #64748b; font-size: 10px; font-style: italic; margin: 0 0 8px; }
    .krow { display: grid; grid-template-columns: 21% 1fr; gap: 0 12px; padding: 9px 0; border-top: 1px solid #e2e8f0; }
    .kk { color: ${NAVY}; font-weight: 700; } .kv { line-height: 1.65; overflow-wrap: anywhere; }
    .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
    .icard { border-left: 3px solid ${BLUE}; background: #f8faff; padding: 10px 12px; }
    .it { font-weight: 700; color: ${NAVY}; font-size: 11.5px; margin-bottom: 3px; } .icard p { margin: 3px 0 0; } .icard .in { font-size: 9.5px; color: #64748b; font-style: italic; }
    .acard { border-left: 4px solid; padding: 9px 12px; margin: 0 0 8px; }
    .ah { display: flex; justify-content: space-between; gap: 10px; color: ${NAVY}; } .ah span { font-size: 9px; font-weight: 700; letter-spacing: .08em; }
    .acard p { margin: 4px 0 0; }
    .bars { margin: 4px 0; } .brow { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
    .bl { text-align: right; font-size: 10.5px; color: #334155; overflow-wrap: anywhere; flex: none; }
    .bt { flex: 1; } .bt i { display: block; height: 13px; border-radius: 0 3px 3px 0; }
    .stk { display: flex; height: 13px; } .stk i { display: block; height: 100%; border-radius: 0; }
    .bv { width: 82px; font-size: 10.5px; color: #334155; font-variant-numeric: tabular-nums; flex: none; } .bv.wide { width: 120px; font-size: 9.5px; color: #64748b; }
    .tone { display: flex; height: 26px; border-radius: 2px; overflow: hidden; }
    .tone span { color: #fff; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; white-space: nowrap; overflow: hidden; }
    .chart { margin: 4px 0 10px; }
    .tbl { table-layout: fixed; }
    .tbl th { text-align: left; font-size: 8.5px; letter-spacing: .06em; text-transform: uppercase; padding: 7px 6px; font-weight: 700; }
    .tbl.navy th { background: ${NAVY}; color: #fff; }
    .tbl td { padding: 7px 6px; border-bottom: 1px solid #e2e8f0; font-size: 10px; vertical-align: top; overflow-wrap: anywhere; }
    .tbl .r { text-align: right; font-variant-numeric: tabular-nums; }
    .tbl.cont { margin-top: 0; }
    .heatt td { padding: 4px 2px; text-align: center; } .heatt td:first-child { text-align: left; padding-left: 6px; }
    .heatt th { padding: 6px 2px; text-align: center; } .heatt th:first-child { text-align: left; padding-left: 6px; }
    .heat { display: block; border-radius: 2px; padding: 3px 0; font-size: 9px; font-weight: 600; }
    .list { margin: 4px 0; padding-left: 16px; } .list li { margin: 4px 0; }
    .mini { font-size: 10.5px; font-weight: 700; color: ${NAVY}; margin: 4px 0 2px; }
    .tri { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 14px; }
    .tcol { border: 1px solid #e2e8f0; padding: 9px 11px; } .tcol p { margin: 4px 0 0; font-size: 10px; }
    .th { font-weight: 800; font-size: 12px; } .th span { font-weight: 600; color: #64748b; font-size: 10px; }
    .chip { color: #fff; font-size: 8.5px; font-weight: 700; padding: 2px 6px; border-radius: 3px; letter-spacing: .04em; }
    .acc { color: ${LINK}; font-weight: 600; }
    .nw { white-space: nowrap; }
    .op { color: ${LINK}; text-decoration: underline; } .vid, .img { color: ${RED}; font-size: 9px; font-weight: 600; text-decoration: underline; } .img { color: #0369a1; }
    .ncard { border-left: 3px solid ${NAVY}; background: #f8fafc; padding: 10px 12px; margin: 0 0 10px; }
    .nt { font-weight: 800; color: ${NAVY}; font-size: 12px; } .nm { color: #64748b; font-size: 9.8px; margin: 2px 0 4px; }
    .ncard p { margin: 0 0 4px; } .ne { font-size: 10px; color: #334155; margin: 3px 0 0; overflow-wrap: anywhere; }
    .cbox { border-top: 2px solid ${NAVY}; padding-top: 6px; } .ct { font-weight: 700; color: ${NAVY}; margin-bottom: 3px; }
    .cbox ul { margin: 0; padding-left: 16px; } .cbox li { margin: 3px 0; }
    .close { font-size: 11.5px; line-height: 1.7; margin: 0 0 6px; }
    .ref { margin-top: 12px; padding-top: 8px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 9px; text-align: center; }
    `;
    const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+Devanagari:wght@400;600;700&display=swap" rel="stylesheet">`;

    const title = `${String(m.name || 'All leaders').replace(/\s+/g, '_')}_${String(d.window?.from || '').slice(0, 10)}_to_${String(d.window?.to || '').slice(0, 10)}`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>${fonts}<style>${css}</style></head>
    <body><div class="page">
      ${keep(header + tiles1 + tiles2 + platNote)}
      ${execSummary}${intel}${attention}
      ${platformSec}${toneSec}${kwSec}${daySec}${locSec}
      ${actSec}${placeSec}${sentSec}${sbpSec ? `<section class="sec">${sbpSec}${whoSec}</section>` : ''}${toneSec4}${riskSec}${entSec}${infSec}${narrSec}${claimSec}${evSec}${ftSec}
      ${closing}
    </div></body></html>`;
};
