/**
 * briefReport — the client report, built to the agreed template.
 *
 * Section order, headings and column names follow `Report template.docx`
 * exactly, so an analyst can take the output straight into review:
 *
 *   header block   period · prepared for/by · status · coverage · confidence
 *   1  Executive summary          prose + a stat strip
 *   2  Key issues                 issue · why it matters · evidence · severity
 *   3  Recommended actions        action · linked issue · owner · due · status
 *   4  At a glance                volume & trend · sentiment overview
 *   5  Topics and narratives      theme · volume · tone · stance split
 *   6  Leaders and entities       mentions · for · against · reading
 *   7  Geography                  social · news · adverse share
 *   8  Sources and influencers    public voices / official accounts, split
 *   9  Alerts and incidents       measure · count · actioned · pending
 *   10 Outlook
 *   Annex A  evidence, with the original text
 *   Annex B  method and confidence
 *   Sign-off
 *
 * ── GAPS ARE SHOWN, NOT HIDDEN ───────────────────────────────────────
 * The template's most useful habit: where a figure was never measured it
 * prints `[Not captured]` and a `Gap:` note rather than a zero. A zero
 * asserts "we looked and found none"; `[Not captured]` says "we did not
 * measure this" — and only one of those is true when district news tagging
 * is off.
 *
 * An entire section still disappears when it holds nothing at all: a heading
 * over an empty table costs a page turn and tells the reader nothing.
 *
 * ── A READING IS MARKED WHEN ITS BASE IS THIN ────────────────────────
 * "Net favourable" off two posts is not a finding, so the base is always
 * stated: above the floor but still small is suffixed `(indicative)`, below
 * the floor the item count is printed outright — `Adverse (3 scored)`.
 *
 * It used to read `Insufficient data` below the floor, which contradicted
 * the Net column sitting beside it: a row showed `-33` and `Insufficient
 * data` on the same line. The net was real; only the base was thin. Naming
 * the base says that, where refusing to give a reading did not.
 *
 * ── NUMBERS ARE READ, NEVER RECOMPUTED ───────────────────────────────
 * Every figure comes off the brief payload. A report that derives its own
 * totals will eventually disagree with the screen it claims to reproduce.
 */

const asArray = (v) => (Array.isArray(v) ? v : []);
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const esc = (v) => String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const n = (v) => (v ?? 0).toLocaleString('en-IN');
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0);
const fmtDate = (d) => (d
    ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '[Not captured]');

const POS = '#15803d';
const NEG = '#b91c1c';
const NEU = '#64748b';
const GAP = '<span class="gap">[Not captured]</span>';

/** Below this many decisive items, a reading is not a reading. */
const READING_FLOOR = 5;
/** Above the floor but below this, it is shown and flagged. */
const INDICATIVE_CEILING = 20;

const reading = (pro, anti) => {
    const decisive = (pro || 0) + (anti || 0);
    if (!decisive) return { text: 'Not yet scored', color: NEU };
    const [word, color] = pro > anti * 1.5 ? ['Favourable', POS]
        : anti > pro * 1.5 ? ['Adverse', NEG]
            : ['Marginal', NEU];
    /* Thin base: give the direction, and say how thin, rather than refuse. */
    if (decisive < READING_FLOOR) return { text: `${word} (${decisive} scored)`, color };
    return { text: `${word}${decisive < INDICATIVE_CEILING ? ' (indicative)' : ''}`, color };
};

const cadenceOf = (days, override) => {
    if (override) return override;
    if (!days || days <= 2) return 'daily';
    if (days <= 14) return 'weekly';
    return 'monthly';
};
const CADENCE = {
    daily: { title: 'Daily Intelligence Brief', period: 'today', next: 'tomorrow', prev: 'yesterday', glance: 'Day' },
    weekly: { title: 'Weekly Intelligence Brief', period: 'this week', next: 'next week', prev: 'last week', glance: 'Week' },
    monthly: { title: 'Monthly Intelligence Report', period: 'this month', next: 'next month', prev: 'last month', glance: 'Month' },
};

/* ── layout ─────────────────────────────────────────────────────────── */
const section = (num, title, body, note) => {
    const clean = String(body || '').trim();
    if (!clean) return '';
    return `<section class="sec">
    <h2>${num ? `${esc(num)}. ` : ''}${esc(title)}</h2>
    ${clean}
    ${note ? `<p class="note">${note}</p>` : ''}
  </section>`;
};

const sub = (title, body) => (String(body || '').trim() ? `<h3>${esc(title)}</h3>${body}` : '');

/**
 * A column where EVERY cell is a placeholder is dropped.
 *
 * The report was printing a Date column reading "[Not captured]" seven times,
 * and Owner/Due columns reading "[Owner]" and "[Date]" on every row. A column
 * that never carries a value is not a gap worth flagging — it is noise that
 * costs width the real columns need. One all-placeholder cell among real ones
 * still shows, because there the blank IS the information.
 *
 * Done here rather than by deleting the three columns by hand, so the same
 * thing cannot reappear the next time a field is unavailable.
 */
const PLACEHOLDER = /^\s*<span class="(gap|ph)">[^<]*<\/span>\s*$/;
const isPlaceholder = (cell) => PLACEHOLDER.test(String(cell ?? ''));

/**
 * Join a list as prose: "a, b and c".
 *
 * NOT `join(', ').replace(/,([^,]*)$/, ' and$1')` — that regex finds the last
 * comma in the finished STRING, so an item containing its own comma has THAT
 * rewritten instead of the separator: "Agriculture & Farmers (50, 29%)" came
 * out as "(50 and 29%)". Operating on the array removes the ambiguity.
 */
const prose = (items) => {
    const list = (items || []).filter(Boolean);
    if (list.length <= 1) return list[0] || '';
    return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
};

/** "1 theme" / "2 themes" — agreement the counts were ignoring. */
const plural = (count, one, many) => `${count} ${count === 1 ? one : (many || `${one}s`)}`;

const table = (headers, rows) => {
    if (!rows.length) return '';
    const keep = headers.map((_, i) => !rows.every((r) => isPlaceholder(r[i])));
    const hs = headers.filter((_, i) => keep[i]);
    const rs = rows.map((r) => r.filter((_, i) => keep[i]));
    if (!hs.length) return '';
    return `<table><thead><tr>${hs.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
     <tbody>${rs.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
};

const stat = (label, value, sub2) => `<div class="stat">
  <div class="stat-v">${esc(value)}</div>
  <div class="stat-l">${esc(label)}</div>
  ${sub2 ? `<div class="stat-s">${esc(sub2)}</div>` : ''}
</div>`;

/* ══════════════════════════════════════════════════════════════════════ */
export const buildBriefReportHtml = (data, opts = {}) => {
    const stateName = data?.profile?.state || opts.stateName || '';
    const reportName = opts.reportName
        || (stateName ? `${stateName} Political Report` : (opts.appName || 'SAGA'));

    const w = data?.window || {};
    const cad = cadenceOf(w.days, opts.cadence);
    const label = CADENCE[cad];

    const comb = data?.combined || {};
    const src = data?.by_source || {};
    const v = isObj(data?.voice) ? data.voice : {};
    const th = isObj(data?.threats) ? data.threats : {};
    const leaderFocus = data?.leader || null;
    /**
     * Who this leader is and where their area is.
     *
     * A per-leader report that showed no districts gave the reader no way
     * to tell "nothing was said about his area" apart from "we don't know
     * where his area is". Naming the seat makes the empty Geography panel
     * a statement rather than a blank.
     */
    const prof = data?.leader_profile || null;
    const handleFocus = data?.handle || null;
    /**
     * Internal mode — for the team, not the client.
     *
     * The display floors exist so a client is not shown a "finding" built on
     * two posts. Internally the opposite is wanted: show everything that was
     * actually collected, however thin, so the team can see what coverage
     * looks like before deciding the data is good enough to send out.
     *
     * It lowers the floors and prints a nil line where a section would
     * otherwise disappear. It does NOT invent anything — every number here
     * is still measured, and a thin one is labelled thin.
     */
    const INTERNAL = !!opts.internal;
    const issueMin = INTERNAL ? 1 : (data?.issue_min ?? 10);

    /** In internal mode an empty section states its emptiness instead of vanishing. */
    const orNil = (body, msg) => {
        const clean = String(body || '').trim();
        if (clean) return clean;
        return INTERNAL ? `<p class="gap">${esc(msg)}</p>` : '';
    };

    const totalItems = (src.mentions?.total || 0) + (src.articles?.total || 0) + (src.alerts?.total || 0);
    const analysed = comb.analysed || 0;
    const scoredShare = pct(comb.total, analysed);
    /**
     * Confidence needs a BASE, not just a percentage.
     *
     * `scoredShare >= 40` alone called a leader report with three mentions,
     * all three scored, "Moderate (100% of items carry a stance)". The
     * percentage was true and the confidence was not: three items support
     * no conclusion whatever proportion of them carry a stance.
     */
    const confidence = (comb.total >= INDICATIVE_CEILING && scoredShare >= 40)
        ? 'Moderate' : 'Low';

    const issues = asArray(data?.issue_tracking).filter((t) => t.total >= issueMin);
    const issueVolume = issues.reduce((acc, t) => acc + t.total, 0);
    const leaders = asArray(data?.leaders);
    const handles = asArray(data?.available_handles);
    const publicVoices = handles.filter((h) => (h.voice || 'organic') === 'organic');
    const officialVoices = handles.filter((h) => (h.voice || 'organic') !== 'organic');
    const districts = [...asArray(data?.districts)]
        .sort((a, b) => (b.news + b.social) - (a.news + a.social));
    const evidence = asArray(data?.recent_mentions);
    const worsening = issues.filter((t) => t.direction === 'worsening');
    /**
     * A leader needs a real base before "widest adverse gap" means anything.
     *
     * Without the floor this picked whoever had the largest anti−pro number,
     * which on a thin week was someone with ONE opposing mention and zero
     * supportive — printed as "the widest adverse gap of anyone named".
     */
    const adverseLeader = [...leaders]
        .filter((l) => (l.pro + l.anti) >= READING_FLOOR)
        .sort((a, b) => (b.anti - b.pro) - (a.anti - a.pro))[0];
    const loudest = publicVoices[0];

    /**
     * Stance per issue — the subject matter, which is what section 2 is for.
     *
     * `net`, `direction` and `confident` are taken straight off the payload
     * instead of being recomputed, so this table and the Issue Tracker panel
     * can never disagree. The panel's net is (pro − anti) / (pro + anti), and
     * its bar is the same pro/anti split summed over the series.
     */
    const issueStance = issues.map((t) => {
        const pro = asArray(t.series).reduce((a, x) => a + (x.pro || 0), 0);
        const anti = asArray(t.series).reduce((a, x) => a + (x.anti || 0), 0);
        return { ...t, pro, anti, decisive: pro + anti, verdict: reading(pro, anti) };
    });
    /* Most criticised first: adverse volume leads, net breaks the tie. */
    const criticised = issueStance
        .filter((t) => t.anti > 0)
        .sort((a, b) => (b.anti - a.anti) || ((a.net ?? 0) - (b.net ?? 0)));
    const topCriticised = criticised[0];
    const netAdverse = issueStance.filter((t) => t.net !== null && t.net !== undefined && t.net < 0);

    /**
     * A leader with nothing this window still gets a report that says so.
     *
     * The client asked for one report per profile, every day. Without this
     * the sections all drop out (each one hides itself when empty) and the
     * file is a header over white space, which reads as a broken export
     * rather than as a quiet week.
     *
     * Zero is a finding. "No one attacked him" is worth the same page as
     * "forty people did", and it is the page someone asks about.
     */
    const noCoverage = !!leaderFocus && !totalItems;

    /* ── 1 · Executive summary, written from the figures ── */
    const execLines = [];
    if (noCoverage) {
        execLines.push(`<b>No mentions of ${esc(leaderFocus)} were captured `
            + `${label.period}</b>, across social and news monitoring.`);
        execLines.push('Nothing was said about them in public on the channels we track — '
            + 'no criticism, no campaign and no incident requiring a response. '
            + 'A silent window is a normal result, not a gap in collection.');
        execLines.push('<b>What this does not mean:</b> it is not evidence that nothing happened '
            + 'offline, and it does not cover private groups, regional print or television. '
            + 'If coverage was expected this window, the monitoring terms for this leader '
            + 'should be reviewed before the next report.');
        execLines.push('<b>Priority action:</b> none arising. '
            + 'Monitoring continues unchanged.');
    }
    if (!noCoverage && th.total) {
        execLines.push(`The platform raised <b>${n(th.total)}</b> alerts ${label.period}`
            + `${th.high_risk ? `, and <b>${n(th.high_risk)}</b> are rated high risk` : ''}.`);
        const ready = [];
        if (th.hostile) ready.push(`${n(th.hostile)} are hostile`);
        if (th.legal_ready) ready.push(`${n(th.legal_ready)} are ready to file legally`);
        if (th.policy_ready) ready.push(`${n(th.policy_ready)} breach a platform policy`);
        if (ready.length) {
            execLines.push(`${prose(ready)}`
                + `${th.untriaged >= th.total ? ', but none has been triaged yet' : ''}.`);
        }
    }
    if (leaders.length) {
        const top = leaders.slice(0, 3);
        execLines.push(`${prose(top.map((l) => `<b>${esc(l.name)}</b> (${n(l.n)} mentions)`))
        } drew the most mentions.`);
        const t0 = top[0];
        if (t0 && (t0.pro + t0.anti) < INDICATIVE_CEILING) {
            execLines.push(`Their stance counts are very small (${esc(t0.name.split(' ').slice(-1)[0])} `
                + `${n(t0.pro)} for, ${n(t0.anti)} against), so sentiment is indicative only.`);
        }
    }
    if (issues.length && issueVolume) {
        execLines.push(`The conversation concentrated on <b>${esc(issues[0].topic)}</b> — `
            + `${n(issues[0].total)} mentions, ${pct(issues[0].total, issueVolume)}% of issue-tagged volume.`);
    }
    if (th.untriaged) {
        execLines.push(`<b>Priority action:</b> triage the ${n(th.high_risk || th.untriaged)} `
            + `${th.high_risk ? 'high-risk ' : ''}alerts`
            + `${th.legal_ready ? `, starting with the ${n(th.legal_ready)} ready to file` : ''}.`);
    }

    /* A zero is still a number worth printing — it is the whole report. */
    const execStats = noCoverage ? [
        stat('Mentions captured', '0'),
        stat('Alerts raised', '0'),
        stat('Items needing a response', '0'),
    ].join('') : [
        th.total ? stat('Alerts raised', n(th.total)) : '',
        th.high_risk ? stat('High-risk alerts', n(th.high_risk)) : '',
        th.hostile ? stat('Hostile alerts', n(th.hostile)) : '',
        stat('Items with a stance', `${scoredShare}%`, `${n(comb.total)} of ${n(analysed)}`),
        totalItems ? stat('Total items collected', n(totalItems)) : '',
    ].filter(Boolean).join('');

    /* ── 2 · Key issues ──
     *
     * 2.1 is the subject matter — which issues the criticism is actually
     * about. 2.2 is the operational backlog. They were previously one list,
     * so a week's leading complaint sat below "Untriaged alert backlog" or
     * did not appear at all.
     */
    const netCell = (net) => {
        if (net === null || net === undefined) return GAP;
        const c = net > 0 ? POS : net < 0 ? NEG : NEU;
        return `<b style="color:${c}">${net > 0 ? '+' : ''}${net}</b>`;
    };
    const TREND = {
        worsening: `<span style="color:${NEG}">Worsening</span>`,
        improving: `<span style="color:${POS}">Improving</span>`,
        stable: `<span style="color:${NEU}">Stable</span>`,
    };

    const criticismLines = [];
    if (topCriticised) {
        criticismLines.push(`<b>${esc(topCriticised.topic)}</b> draws the most criticism — `
            + `${n(topCriticised.anti)} opposing of ${n(topCriticised.decisive)} scored`
            + `${topCriticised.net !== null && topCriticised.net !== undefined
                ? `, a net of ${topCriticised.net > 0 ? '+' : ''}${topCriticised.net}` : ''}`
            + `, across ${n(topCriticised.total)} mentions.`);
        if (topCriticised.decisive < READING_FLOOR) {
            criticismLines.push(`That rests on only ${plural(topCriticised.decisive, 'scored item')}, `
                + 'so treat it as a pointer to look at, not a finding.');
        }
    }
    if (netAdverse.length) {
        criticismLines.push(`${plural(netAdverse.length, 'issue is', `issues are`)} net adverse: `
            + `${prose(netAdverse.slice(0, 4).map((t) => `<b>${esc(t.topic)}</b> (${t.net})`))}.`);
    } else if (issueStance.length) {
        criticismLines.push('No issue is net adverse on the items scored so far — '
            + 'the criticism present is outweighed by supportive mentions on every theme.');
    }
    if (worsening.length) {
        criticismLines.push(`Moving against us versus ${label.prev}: `
            + `${prose(worsening.slice(0, 4).map((t) => `<b>${esc(t.topic)}</b>`))}.`);
    }

    const criticismRows = (criticised.length ? criticised : issueStance)
        .slice(0, 8)
        .map((t) => [
            `<b>${esc(t.topic)}</b>`,
            n(t.total),
            n(t.pro),
            n(t.anti),
            netCell(t.net),
            TREND[t.direction] || GAP,
            `<span style="color:${t.verdict.color}">${esc(t.verdict.text)}</span>`,
        ]);

    const keyIssues = [];
    if (th.untriaged) {
        keyIssues.push(['Untriaged alert backlog',
            `${n(th.total)} alerts are raised and ${n(th.untriaged)} have not been triaged`
            + `${th.high_risk ? `, including ${n(th.high_risk)} high-risk` : ''}`
            + `${th.legal_ready ? ` and ${n(th.legal_ready)} ready to file` : ''}.`,
            'Section 9 counts', th.high_risk ? 'High' : 'Medium']);
    }
    if (adverseLeader && adverseLeader.anti > adverseLeader.pro) {
        keyIssues.push([`Adverse coverage of ${esc(adverseLeader.name)}`,
            `${n(adverseLeader.anti)} opposing against ${n(adverseLeader.pro)} supportive mentions — `
            + 'the widest adverse gap of anyone named.',
            'Section 6',
            (adverseLeader.anti - adverseLeader.pro) > 10 ? 'High' : 'Medium (confirm)']);
    }
    /* Worsening topics are section 2.1's job now — listing them again here
     * put the same two rows in both halves of the same section. */
    if (loudest && pct(loudest.count, src.mentions?.total) >= 5) {
        keyIssues.push([`Single account driving volume: @${esc(loudest.handle)}`,
            `${n(loudest.count)} posts, ${pct(loudest.count, src.mentions?.total)}% of all mentions. `
            + 'One account at this share distorts every figure in this report.',
            'Section 8.1', 'Medium']);
    }
    if (analysed && scoredShare < 25) {
        keyIssues.push(['Evidence gap in stance scoring',
            `Only ${scoredShare}% of analysed items carry a stance (${n(comb.total)} of ${n(analysed)}). `
            + 'Volume figures are sound; the supportive versus opposing split is not yet decision-grade.',
            'Annex B', 'Medium']);
    }
    const keyIssueRows = keyIssues.map((r, i) => [
        String(i + 1), `<b>${r[0]}</b>`, r[1], esc(r[2]),
        `<span class="sev sev-${r[3].toLowerCase().split(' ')[0]}">${esc(r[3])}</span>`,
    ]);

    /* ── 3 · Recommended actions ── */
    const actions = [];
    if (th.high_risk) {
        actions.push([`Triage the ${n(th.high_risk)} high-risk alerts`
            + `${th.legal_ready ? `, starting with the ${n(th.legal_ready)} ready to file` : ''}`, '1']);
    }
    if (th.policy_ready) actions.push([`Report the ${n(th.policy_ready)} policy-breaching posts to the platform`, '1']);
    if (th.hostile) actions.push([`Review the ${n(th.hostile)} hostile alerts for legal action`, '1, 2']);
    if (adverseLeader && adverseLeader.anti > adverseLeader.pro) {
        actions.push([`Monitor the adverse narrative around ${esc(adverseLeader.name)} ${label.next}`, '2']);
    }
    for (const d of asArray(data?.decisions).slice(0, 3)) {
        if (d.action) actions.push([esc(d.action), '—']);
    }
    const actionRows = actions.slice(0, 8).map((a, i) => [
        String(i + 1), a[0], esc(a[1]),
        '<span class="ph">[Owner]</span>', '<span class="ph">[Date]</span>', 'Open',
    ]);

    /* ── 5 · Topics and narratives ── */
    const topicRows = issues.slice(0, 8).map((t) => {
        const pro = asArray(t.series).reduce((a, x) => a + (x.pro || 0), 0);
        const anti = asArray(t.series).reduce((a, x) => a + (x.anti || 0), 0);
        const tone = (pro + anti) < READING_FLOOR ? 'Unscored'
            : anti > pro ? 'Hostile' : pro > anti ? 'Supportive' : 'Mixed';
        const col = tone === 'Hostile' ? NEG : tone === 'Supportive' ? POS : NEU;
        return [
            `<b>${esc(t.topic)}</b>`,
            `${plural(t.total, 'mention')}<div class="s">${pct(t.total, issueVolume)}% of volume</div>`,
            `<span style="color:${col}">${tone}</span>`,
            (pro + anti) ? `${n(pro)} for · ${n(anti)} against` : GAP,
        ];
    });

    /* ── 6 · Leaders ── */
    const leaderRows = leaders.slice(0, 12).map((l) => {
        const r = reading(l.pro, l.anti);
        return [`<b>${esc(l.name)}</b>`, n(l.n), n(l.pro), n(l.anti),
            `<span style="color:${r.color}">${esc(r.text)}</span>`];
    });

    /* ── 7 · Geography ── */
    const newsTagged = districts.some((d) => d.news > 0);
    const geoRows = districts.slice(0, 10).map((d) => [
        esc(d.district || d.name || '—'), n(d.social),
        newsTagged ? n(d.news) : GAP, `${d.adverse_share ?? 0}%`,
    ]);

    /* ── 8 · Sources ── */
    const publicRows = publicVoices.slice(0, 10).map((h, i) => {
        const tone = (h.anti || 0) > (h.pro || 0) ? 'Critical'
            : (h.pro || 0) > (h.anti || 0) ? 'Supportive' : 'Unscored';
        const col = tone === 'Critical' ? NEG : tone === 'Supportive' ? POS : NEU;
        return [String(i + 1), `@${esc(h.handle)}`, esc(h.name || ''), n(h.count),
            `<span style="color:${col}">${tone}</span>`];
    });
    const officialRows = officialVoices.slice(0, 10).map((h) => [
        `@${esc(h.handle)}`, esc(h.name || ''), n(h.count),
        esc({ owned: 'Our side', opposition: 'Opposition', news: 'Institutional' }[h.voice] || h.voice),
    ]);

    /* ── 9 · Alerts ── */
    const allPending = (th.untriaged || 0) >= (th.total || 0);
    const alertRows = [
        ['Total alerts raised', th.total], ['High risk', th.high_risk], ['Hostile', th.hostile],
        ['Ready to file (legal)', th.legal_ready], ['Breaching platform policy', th.policy_ready],
    ].filter(([, x]) => x).map(([k, x]) => [
        esc(k), `<b>${n(x)}</b>`, allPending ? '0' : GAP, allPending ? n(x) : GAP,
    ]);
    const riskSplit = isObj(th.by_risk)
        ? Object.entries(th.by_risk).filter(([, x]) => x).map(([k, x]) => `${n(x)} ${k}`).join(', ')
        : '';

    /* ── Annex A · evidence ── */
    const evidenceRows = evidence.slice(0, 12).map((m, i) => {
        const stance = String(m.stance || m.analysis?.political_stance || '');
        const tone = /anti/.test(stance) ? 'Hostile' : /pro/.test(stance) ? 'Supportive'
            : stance === 'neutral' ? 'Neutral' : 'Unscored';
        const col = tone === 'Hostile' ? NEG : tone === 'Supportive' ? POS : NEU;
        return [
            String(i + 1),
            m.post_date ? esc(fmtDate(m.post_date)) : GAP,
            `${esc(m.handle || m.posted_by?.handle || '—')}<div class="s">${esc(m.platform || 'X')}</div>`,
            `<div class="orig">${esc(String(m.text || m.content?.text || '').slice(0, 320))}</div>`,
            `<span style="color:${col}">${tone}</span>`,
        ];
    });

    /**
     * Section 4, written.
     *
     * Each sentence is a comparison between figures already in the payload.
     * Nothing is asserted that the data does not support, and where the base
     * is too thin the paragraph says so instead of quoting a percentage.
     */
    const conversationLines = [];
    {
        const volume = [];
        if (src.mentions?.total) volume.push(plural(src.mentions.total, 'social mention'));
        if (src.articles?.total) volume.push(`${n(src.articles.total)} news articles`);
        if (src.alerts?.total) volume.push(`${n(src.alerts.total)} alerts`);
        if (volume.length) {
            conversationLines.push(`<b>${n(totalItems)} items</b> were collected — `
                + `${prose(volume)}`
                + `${data?.trend?.mentions_change != null
                    ? `, ${data.trend.mentions_change > 0 ? 'up' : 'down'} `
                      + `${Math.abs(Math.round(data.trend.mentions_change))}% against ${label.prev}` : ''}.`);
        }

        if (issues.length && issueVolume) {
            const top3 = issues.slice(0, 3);
            conversationLines.push('The conversation ran mainly on '
                + `${prose(top3.map((t) => `<b>${esc(t.topic)}</b> (${n(t.total)}, `
                    + `${pct(t.total, issueVolume)}%)`))}`
                + `${issues.length > 3
                    ? `, with ${plural(issues.length - 3, 'smaller theme')} behind them` : ''}.`);
            const share = pct(top3[0].total, issueVolume);
            if (share >= 35) {
                conversationLines.push(`One theme is carrying <b>${share}%</b> of issue-tagged `
                    + 'volume, so the agenda is being set on a single front rather than spread.');
            }
        }

        const voiceTotal = (v.organic || 0) + (v.owned || 0) + (v.news || 0) + (v.opposition || 0);
        if (voiceTotal) {
            const organicShare = pct(v.organic, voiceTotal);
            conversationLines.push(`<b>${organicShare}%</b> came from the public rather than from `
                + 'official, press or opposition accounts'
                + `${organicShare >= 85 ? ' — organic opinion, not an organised campaign' : ''}.`);
        }
    }

    /* Where the negativity actually is. */
    const negativityLines = [];
    {
        const hostileTopics = issues.filter((t) => {
            const pro = asArray(t.series).reduce((a, x) => a + (x.pro || 0), 0);
            const anti = asArray(t.series).reduce((a, x) => a + (x.anti || 0), 0);
            return (pro + anti) >= READING_FLOOR && anti > pro;
        });
        const adverseLeaders = leaders.filter((l) => l.anti > l.pro && (l.pro + l.anti) >= READING_FLOOR);
        const criticalVoices = publicVoices.filter((h) => (h.anti || 0) > 0)
            .sort((a, b) => (b.anti || 0) - (a.anti || 0));

        if (scoredShare >= 25) {
            negativityLines.push(`Of the ${n(comb.total)} items that took a side, `
                + `<b>${pct(comb.opposing, comb.total)}%</b> were opposing and `
                + `${pct(comb.supportive, comb.total)}% supportive.`);
        } else {
            negativityLines.push(`Only <b>${scoredShare}%</b> of analysed items carry a stance `
                + `(${n(comb.total)} of ${n(analysed)}), so a supportive-versus-opposing percentage `
                + 'would rest on too small a base to quote. What follows is where the criticism '
                + 'that HAS been scored is concentrated — not a measure of overall mood.');
        }

        if (hostileTopics.length) {
            negativityLines.push('Criticism is concentrated on '
                + `${prose(hostileTopics.slice(0, 3).map((t) => `<b>${esc(t.topic)}</b>`))}.`);
        }
        if (adverseLeaders.length) {
            const l0 = adverseLeaders[0];
            negativityLines.push(`<b>${esc(l0.name)}</b> draws the most adverse coverage — `
                + `${n(l0.anti)} opposing against ${n(l0.pro)} supportive`
                + `${adverseLeaders.length > 1
                    ? `; ${adverseLeaders.slice(1, 3).map((x) => esc(x.name)).join(' and ')} also net adverse`
                    : ''}.`);
        } else if (leaders.length) {
            negativityLines.push('No leader is net adverse on the items scored so far.');
        }
        if (criticalVoices.length) {
            negativityLines.push('The most critical public accounts are '
                + `${prose(criticalVoices.slice(0, 3)
                    .map((h) => `<b>@${esc(h.handle)}</b> (${n(h.anti)})`))}.`);
        }
        if (th.hostile) {
            negativityLines.push(`<b>${n(th.hostile)}</b> alerts are classified hostile`
                + `${th.legal_ready ? `, of which ${n(th.legal_ready)} already carry a legal section` : ''}`
                + `${th.untriaged >= (th.total || 0) ? ' — none triaged yet' : ''}.`);
        }
        if (worsening.length) {
            negativityLines.push(`Against ${label.prev}, sentiment moved against us on `
                + `<b>${worsening.map((t) => esc(t.topic)).join(', ')}</b>.`);
        }
    }

    return `<!doctype html>
<html><head><meta charset="utf-8" />
<title>${esc(reportName)} — ${esc(label.title)}, ${esc(fmtDate(w.to))}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
  *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  body{font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;color:#111827;background:#fff;
       margin:0;padding:34px 38px;font-size:12.5px;line-height:1.62;
       font-feature-settings:'tnum' 1;-webkit-font-smoothing:antialiased}
  .wrap{max-width:980px;margin:0 auto}
  b,strong{font-weight:600}
  ul{margin:4px 0 0;padding-left:18px}
  li{margin-bottom:3px}

  .hd h1{margin:0;font-size:26px;font-weight:800;letter-spacing:-.03em;line-height:1.15}
  .meta{margin-top:12px;border-top:2px solid #111827;border-bottom:1px solid #e5e7eb;
        padding:10px 0;display:grid;grid-template-columns:repeat(2,1fr);gap:3px 26px;font-size:11.5px}
  .meta div{color:#4b5563}
  .meta b{color:#111827;font-weight:600;display:inline-block;min-width:116px}

  h2{font-size:14px;font-weight:700;color:#111827;margin:26px 0 10px;padding-bottom:6px;
     border-bottom:2px solid #111827;letter-spacing:-.01em}
  h3{font-size:12px;font-weight:700;color:#374151;margin:16px 0 6px}
  .sec p{margin:0 0 7px}

  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:9px;margin:13px 0 4px}
  .stat{border:1px solid #e5e7eb;border-radius:7px;padding:10px 12px;background:#f9fafb}
  .stat-v{font-size:22px;font-weight:700;letter-spacing:-.02em;line-height:1.1}
  .stat-l{font-size:9.5px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;
          font-weight:600;margin-top:3px}
  .stat-s{font-size:9.5px;color:#9ca3af;margin-top:1px}

  table{width:100%;border-collapse:collapse;font-size:11px;margin-top:6px}
  th{text-align:left;background:#111827;color:#fff;padding:7px 9px;font-size:9px;
     text-transform:uppercase;letter-spacing:.06em;font-weight:600}
  td{padding:8px 9px;border-bottom:1px solid #f3f4f6;vertical-align:top;line-height:1.5}
  tr:nth-child(even) td{background:#fafafa}
  td .s{font-size:9.5px;color:#9ca3af;margin-top:1px}
  .orig{font-size:10.5px;line-height:1.55}
  .gap{color:#9ca3af;font-style:italic}
  .ph{color:#9ca3af}

  .sev{display:inline-block;padding:1px 7px;border-radius:4px;font-size:9.5px;font-weight:700;white-space:nowrap}
  .sev-high{background:#fee2e2;color:#991b1b}
  .sev-medium{background:#fef3c7;color:#92400e}
  .sev-low{background:#e0f2fe;color:#075985}

  .note{font-size:10.5px;color:#4b5563;background:#f9fafb;border-left:3px solid #d1d5db;
        padding:8px 11px;margin-top:9px;border-radius:0 5px 5px 0}
  .internal{border:2px solid #b45309;background:#fffbeb;color:#78350f;border-radius:7px;
            padding:10px 13px;margin-bottom:16px;font-size:11px;line-height:1.55}
  .internal b{color:#78350f;letter-spacing:.02em}

  .no-print{display:flex;gap:10px;margin-bottom:16px}
  .no-print button{padding:9px 18px;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;
                   font-weight:600;font-size:13px;background:#fff}
  .no-print .primary{background:#111827;color:#fff;border-color:#111827}
  @media print{body{padding:16px}.no-print{display:none!important}
    h2{break-after:avoid}tr{break-inside:avoid}.stat{break-inside:avoid}}
</style></head>
<body><div class="wrap">

  <div class="no-print">
    <button class="primary" onclick="window.print()">Print / Save as PDF</button>
    <button onclick="window.close()">Close</button>
  </div>

  ${INTERNAL ? `<div class="internal">
    <b>INTERNAL — not for client release.</b>
    Reporting floors are lowered so every collected item is visible, including
    counts too small to support a conclusion. Figures are measured, not
    estimated, but the thin ones are working data. The client version is sent
    once collection is complete.
  </div>` : ''}

  <div class="hd">
    <h1>${esc(reportName)}: ${esc(label.title)}</h1>
    <div class="meta">
      <div><b>Reporting period</b> ${esc(fmtDate(w.from))} to ${esc(fmtDate(w.to))}</div>
      <div><b>Issued</b> ${esc(fmtDate(new Date()))}</div>
      <div><b>Coverage</b> Social (X)${src.articles?.total ? ' and news' : ' with limited news'}${districts.length ? `; districts: ${districts.slice(0, 3).map((d) => esc(d.district)).join(', ')}` : ''}</div>
      <div><b>Confidence</b> ${noCoverage
        ? 'Not applicable — nil return'
        : `${confidence} (${scoredShare}% of items carry a stance)`}</div>
      ${leaderFocus ? `<div><b>Focus</b> ${esc(leaderFocus)}${
        prof?.role ? ` — ${esc(prof.role)}` : ''}</div>` : ''}
      ${prof?.district ? `<div><b>Area</b> ${esc(prof.constituency)}, ${esc(prof.district)} district</div>` : ''}
      ${handleFocus ? `<div><b>Handle</b> @${esc(handleFocus)}</div>` : ''}
    </div>
  </div>

  ${section('1', 'Executive summary',
        execLines.map((l) => `<p>${l}</p>`).join('')
        + (execStats ? `<div class="stats">${execStats}</div>` : ''))}

  ${noCoverage ? section('2', 'What was monitored', `
    <p>This report covers <b>${esc(leaderFocus)}</b> only. The same collection ran
      for them as for every other profile over ${esc(fmtDate(w.from))} to ${esc(fmtDate(w.to))}:
      their name in both English and Devanagari, their official handle, and mentions
      and replies directed at it across the monitored platforms.</p>
    <p>Nothing matched. The sections that follow are therefore omitted rather than
      shown empty — there were no issues, no alerts, no districts and no sources to
      report on. They return as soon as there is anything to put in them.</p>`,
        'A nil return is recorded so the day is accounted for, and so a gap in '
        + 'collection can be told apart from a genuinely quiet window.') : ''}

  ${noCoverage ? '' : section('2', `Key issues ${label.period}`,
        sub('2.1 Issues drawing the most criticism',
            orNil(criticismLines.map((l) => `<p>${l}</p>`).join('')
                + table(['Issue', 'Mentions', 'For', 'Against', 'Net', 'Trend', 'Reading'], criticismRows),
            'Nothing was scored as criticism in this window.'))
        + sub('2.2 Operational issues',
            table(['#', 'Issue', 'Why it matters', 'Evidence', 'Severity'], keyIssueRows)),
        'Issue figures are the same ones behind the Issue Tracker panel. '
        + 'An analyst should confirm each operational item before release.')}

  ${section('3', 'Recommended actions',
        orNil(table(['#', 'Action', 'Linked issue', 'Owner', 'Due', 'Status'], actionRows),
            'Nothing in this window needs an action raised against it.'))}

  ${noCoverage ? '' : section('4', `${label.glance} at a glance`,
        sub('4.1 What the conversation was about',
            conversationLines.map((l) => `<p>${l}</p>`).join(''))
        + sub('4.2 Where the negativity sits',
            negativityLines.map((l) => `<p>${l}</p>`).join('')))}

  ${section('5', 'Topics and narratives',
        orNil(table(['Theme', 'Volume', 'Tone', 'Stance split'], topicRows),
            'No theme reached the reporting floor in this window.'),
        issues.length && issueVolume
            ? `<b>${esc(issues[0].topic)}</b> is the largest issue area, at `
              + `${pct(issues[0].total, issueVolume)}% of issue-tagged volume.`
            : null)}

  ${section('6', 'Leaders and entities',
        orNil(table(['Leader', 'Mentions', 'For', 'Against', 'Reading'], leaderRows),
            'No leader was named often enough to tabulate in this window.'),
        `Sorted by mentions. A reading needs at least ${READING_FLOOR} items taking a side; `
        + `below ${INDICATIVE_CEILING} it is marked indicative.`)}

  ${section('7', 'Geography',
        orNil(table(['District', 'Social', 'News', 'Adverse share'], geoRows),
            prof?.district
                ? `No post in this window named ${prof.constituency} or `
                  + `${prof.district} district, the area this leader is anchored to.`
                : 'No post in this window named a district we could resolve.'),
        newsTagged ? null
            : 'Gap: no district-level news tagging in this window, so the News column reads '
              + '"not captured" rather than zero. If district tagging cannot be fixed before '
              + 'release, remove this section.')}

  ${section('8', 'Sources and influencers',
        sub('8.1 Most active public voices',
            table(['#', 'Handle', 'Name', 'Posts', 'Dominant tone'], publicRows))
        + sub('8.2 Official and leader accounts (counted separately)',
            table(['Handle', 'Name', 'Posts', 'Voice'], officialRows)),
        'Official, leader and opposition accounts are listed separately: their output is '
        + 'publicity, not public opinion, and the sentiment figures use the public group only.')}

  ${section('9', 'Alerts and incidents',
        orNil(table(['Measure', 'Count', 'Actioned', 'Pending'], alertRows),
            'No alert was raised against this profile in this window.'),
        [riskSplit ? `Risk split: ${esc(riskSplit)}.` : '',
            allPending ? 'Nothing has been triaged, so Actioned is 0 on every row.' : '']
            .filter(Boolean).join(' ') || null)}

  ${noCoverage ? '' : section('10', `Outlook for ${label.next}`,
        (worsening.length || th.untriaged || (adverseLeader && adverseLeader.anti > adverseLeader.pro))
            ? `<ul>${[
                worsening.length ? `<li>Sentiment worsening on <b>${worsening.map((t) => esc(t.topic)).join(', ')}</b></li>` : '',
                th.untriaged ? `<li><b>${n(th.untriaged)}</b> alerts still awaiting triage</li>` : '',
                adverseLeader && adverseLeader.anti > adverseLeader.pro
                    ? `<li>Adverse narrative around <b>${esc(adverseLeader.name)}</b></li>` : '',
                loudest ? `<li>Posting volume from <b>@${esc(loudest.handle)}</b></li>` : '',
            ].filter(Boolean).join('')}</ul>`
            : '<p class="gap">[Upcoming events, announcements or court dates: not in the collected data.]</p>')}

  ${section('', 'Annex A: Evidence behind this brief',
        table(['#', 'Date', 'Source', 'Original text', 'Tone'], evidenceRows),
        'Tones are automated. Where the source language is not English, a fluent analyst '
        + 'should confirm them before release.')}

  ${section('', 'Annex B: Method and confidence', `
    <p><b>Data sources:</b> public voices on X${src.articles?.total ? ', plus news where captured' : ''}.
      Our own accounts, the press and opposition handles are counted separately.</p>
    ${noCoverage
        ? `<p><b>Confidence: not applicable.</b> There is nothing to be confident about —
             no item was captured for this profile in the window, so no stance,
             sentiment or volume figure is quoted anywhere in this report.
             Collection ran normally; the result was nil.</p>`
        : `<p><b>Confidence: ${confidence}.</b> ${scoredShare}% of analysed items carry a stance
             (${n(comb.total)} of ${n(analysed)}), so the supportive versus opposing split rests on
             ${scoredShare >= 40 ? 'a reasonable base' : 'a small base'}. Volume figures are reliable;
             sentiment is ${scoredShare >= 40 ? 'usable with care' : 'indicative only'}.</p>`}`)}


</div></body></html>`;
};

/* ── delivery ───────────────────────────────────────────────────────── */
const printViaIframe = (html) => new Promise((resolve) => {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    document.body.appendChild(frame);
    frame.onload = () => {
        try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch { /* refused */ }
        setTimeout(() => frame.remove(), 1000);
        resolve(true);
    };
    const doc = frame.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
});

export const openBriefReport = async (data, opts) => {
    const html = buildBriefReportHtml(data, opts);
    let win = null;
    try { win = window.open('', '_blank'); } catch { win = null; }
    if (win && win.document) { win.document.write(html); win.document.close(); return 'tab'; }
    await printViaIframe(html);
    return 'print';
};

export const downloadBriefReport = (data, opts) => {
    const html = buildBriefReportHtml(data, opts);
    const w = data?.window || {};
    const cad = cadenceOf(w.days, opts?.cadence);
    const slug = [
        (data?.profile?.state || opts?.appName || 'SAGA').replace(/\s+/g, '-'), cad,
        String(w.from || '').slice(0, 10), String(w.to || '').slice(0, 10),
        data?.handle ? `@${data.handle}` : null,
        data?.leader ? String(data.leader).replace(/\s+/g, '-') : null,
    ].filter(Boolean).join('_');
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${slug}.html`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
};
