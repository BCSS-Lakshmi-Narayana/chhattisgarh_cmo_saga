/**
 * leaderReportController — the public-discussion monitoring report, per leader.
 *
 * GET /api/cm-dashboard/leader-report?from=YYYY-MM-DD&to=YYYY-MM-DD[&leader=Name][&handle=h]
 *
 * The brief (`getCMBrief`) answers "how is the government doing" in aggregate.
 * This answers the client's other question — for ONE leader, what is being said,
 * by whom, where, and how bad is it — and it does so from the individual posts,
 * because every section of the report (days, places, narratives, risk bands,
 * influencers, evidence) is a different cut of the same post list.
 *
 * ── SAME POSTS AS THE DASHBOARD ──────────────────────────────────────
 * Posts are selected exactly as the brief selects them: grievances by
 * publication date, then `mhLeaderMatch.namesLeader` for the leader focus. So
 * "1,282 mentions naming him" on the dashboard and the report's "posts
 * collected" are the same population.
 *
 * ── TONE AND STANCE ARE DIFFERENT THINGS ─────────────────────────────
 * Tone is the post's own mood (`analysis.generic_sentiment`). Stance is its
 * position on the LEADER, and is leader-relative: `analysis.leader_target`
 * where the post was classified that way; otherwise the post's tone toward
 * its target when that target is this leader; otherwise "unclear". It never
 * reads the government-relative stance for an opposition leader, which would
 * invert him.
 *
 * ── RISK BANDS ───────────────────────────────────────────────────────
 * From the analysis intent: critical = threats, incitement, violence; high =
 * hate, communal, abusive, harassment, misinformation; medium = the risk model
 * rated it high on otherwise ordinary speech; low = everything else.
 * Criticism and satire are sentiment, not risk.
 *
 * ── NOTHING INVENTED ─────────────────────────────────────────────────
 * Every sentence is assembled from these counts. Where the platform does not
 * have something the reference report had (web-verified facts, an event
 * calendar), the section is not printed and "Information gaps" says so.
 */
const mongoose = require('mongoose');
const { scopedCollection } = require('../utils/verticalScope');
const mhMatch = require('../utils/mhLeaderMatch');
const MH = require('../data/mh_leaders.json');

const IST_MS = 5.5 * 3600 * 1000;
const istDay = (d) => new Date(new Date(d).getTime() + IST_MS).toISOString().slice(0, 10);
const num = (v) => Number(v) || 0;
const textOf = (d) => String(d.content?.full_text || d.content?.text || '').replace(/\s+/g, ' ').trim();
const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/** Interactions, as the dashboard counts them. */
const engagementOf = (e) => num(e?.likes) + num(e?.retweets) + num(e?.replies) + num(e?.quotes);
/** Reach-weighted score used to rank accounts (likes + 2×comments + 3×shares + views/10). */
const scoreOf = (e) => Math.round(num(e?.likes) + 2 * num(e?.replies) + 3 * (num(e?.retweets) + num(e?.quotes)) + num(e?.views) / 10);

const PLATFORM = { x: 'X', twitter: 'X', facebook: 'Facebook', youtube: 'YouTube', instagram: 'Instagram', telegram: 'Telegram' };
const platformName = (p) => PLATFORM[String(p || '').toLowerCase()] || (p ? String(p) : 'Other');

const CRITICAL_INTENTS = new Set(['threat', 'threat_incitement', 'hate_speech_threat', 'hate_speech_threat_extremist',
    'communal_violence', 'sexual_violence', 'violence', 'incitement', 'doxxing', 'impersonation']);
const HIGH_INTENTS = new Set(['hate_speech', 'communal_content', 'abusive', 'harassment', 'misinformation', 'extremist']);
const bandOf = (d) => {
    const intent = String(d.analysis?.intent || d.analysis?.category || '').toLowerCase();
    if (CRITICAL_INTENTS.has(intent)) return 'critical';
    if (HIGH_INTENTS.has(intent)) return 'high';
    if (String(d.analysis?.risk_level || '').toLowerCase() === 'high') return 'medium';
    return 'low';
};
const INTENT_LABEL = {
    threat: 'Threat', threat_incitement: 'Incitement', hate_speech_threat: 'Hate speech with a threat',
    hate_speech_threat_extremist: 'Extremist threat', communal_violence: 'Communal violence',
    sexual_violence: 'Sexual violence', hate_speech: 'Hate speech', communal_content: 'Communal content',
    abusive: 'Abusive language', harassment: 'Harassment', misinformation: 'Misinformation',
};

/*
 * Maharashtra posts analysed before the resolver fix carry "Government of
 * Chhattisgarh" wherever the post said "the government", and some automatic
 * explanations invent a Chhattisgarh expansion (e.g. "CJP (Chhattisgarh Janata
 * Parishad Party)" — CJP is the Cockroach Janta Party). Shown only when the post
 * itself is about Chhattisgarh.
 */
const CG_RX = /chhattisgarh|छत्तीसगढ/i;
const mentionsCg = (d) => CG_RX.test(String(d.content?.full_text || d.content?.text || ''));
const fixGovt = (name, d) => (name && /^Government of Chhattisgarh$/i.test(name) && !mentionsCg(d) ? 'Government of Maharashtra' : name);
const autoExplanation = (d) => {
    const e = String(d.analysis?.explanation || '');
    return e && CG_RX.test(e) && !mentionsCg(d) ? '' : e;
};

const toneOf = (d) => {
    const t = String(d.analysis?.generic_sentiment || d.analysis?.sentiment || 'neutral').toLowerCase();
    return t === 'positive' || t === 'negative' ? t : 'neutral';
};

const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
const hashtagsOf = (d) => [...new Set((textOf(d).match(HASHTAG_RE) || []).map((h) => h.toLowerCase()))];

const top = (map, n = 5) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
const inc = (map, k, by = 1) => { if (k) map.set(k, (map.get(k) || 0) + by); };

const parseDay = (v, endOfDay = false) => {
    if (!v) return null;
    const d = new Date(`${String(v).slice(0, 10)}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
};

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDay = (k) => { const [y, m, d] = String(k).split('-').map(Number); return y ? `${d} ${MONTHS[m - 1]} ${y}` : ''; };
const fmt = (v) => num(v).toLocaleString('en-IN');

const PARTY = {
    bjp: 'Bharatiya Janata Party', shivsena: 'Shiv Sena', 'shivsena-ubt': 'Shiv Sena (Uddhav Balasaheb Thackeray)',
    ncp: 'Nationalist Congress Party', 'ncp-sp': 'Nationalist Congress Party (Sharadchandra Pawar)',
    mns: 'Maharashtra Navnirman Sena', inc: 'Indian National Congress', congress: 'Indian National Congress',
    none: 'Not a party politician',
};

/**
 * Build the report. `leader` null = every monitored leader together.
 * Exported so scripts/build_mh_leader_reports.js renders the same thing.
 */
const buildLeaderReport = async ({ db, leader = null, handle = null, from, to }) => {
    const who = leader ? MH.leaders.find((l) => l.name === leader || l.key === leader) || null : null;
    const subject = who ? who.name : (leader || null);
    const subjectLabel = subject || 'the government';
    /** The subject's OWN account on any platform: his X handle, his Instagram, or a page carrying his name. */
    const ownHandle = who ? mhMatch.norm(who.handle || '') : null;
    const ownName = subject ? mhMatch.norm(subject) : null;
    const isSubjectOwn = (d) => !!subject && ((d._ig && d._owner === subject)
        || (ownHandle && mhMatch.norm(d.posted_by?.handle || '') === ownHandle)
        || (ownName && mhMatch.norm(d.posted_by?.display_name || '') === ownName));

    const raw = await scopedCollection(db, 'grievances').find(
        { post_date: { $gte: from, $lte: to }, is_active: { $ne: false } },
        { projection: {
            post_date: 1, platform: 1, tweet_url: 1, engagement: 1, posted_by: 1, content: 1,
            'analysis.topic': 1, 'analysis.political_stance': 1, 'analysis.generic_sentiment': 1,
            'analysis.sentiment': 1, 'analysis.target_tone': 1, 'analysis.target_entity_canonical': 1,
            'analysis.mentioned_entities': 1, 'analysis.leader_target': 1, 'analysis.intent': 1,
            'analysis.category': 1, 'analysis.risk_level': 1, 'analysis.explanation': 1,
            'analysis.reasons': 1, 'analysis.grievance_type': 1, 'analysis.emotion': 1,
            'analysis.attack_target': 1, 'analysis.language_detected': 1, 'analysis.review': 1,
        } },
    ).toArray();

    let collected = raw;
    if (subject) collected = collected.filter((d) => mhMatch.namesLeader(d, subject));
    if (handle) {
        const want = mhMatch.norm(String(handle).replace(/^@+/, ''));
        collected = collected.filter((d) => mhMatch.norm(d.posted_by?.handle || '') === want);
    }
    const excluded = collected.filter((d) => d.analysis?.political_stance === 'unrelated');
    let posts = collected.filter((d) => d.analysis?.political_stance !== 'unrelated');

    /* ── Instagram ──────────────────────────────────────────────────────
     * Instagram is collected as the leaders' OWN account posts into `contents`
     * (the monitor), not as mentions, and its verdict lives in `analyses`. It is
     * read here and shaped like a mention so every section below counts it. Only
     * scored posts are counted; unscored ones are reported, never guessed. */
    const igSources = await scopedCollection(db, 'sources').find({ platform: 'instagram' }, { projection: { id: 1, display_name: 1 } }).toArray();
    const igOwner = new Map(igSources.map((x) => [x.id, x.display_name]));
    const igRaw = handle ? [] : await scopedCollection(db, 'contents').find(
        { platform: 'instagram', published_at: { $gte: from, $lte: to } },
        { projection: { id: 1, source_id: 1, author: 1, author_handle: 1, text: 1, content_url: 1, media: 1,
            engagement: 1, published_at: 1, sentiment: 1, analysis_status: 1, review: 1 } },
    ).toArray();
    const igAnalyses = igRaw.length ? await scopedCollection(db, 'analyses').find(
        { content_id: { $in: igRaw.map((c) => c.id) } },
        { projection: { content_id: 1, sentiment: 1, topic: 1, intent: 1, risk_level: 1, explanation: 1, 'llm_analysis.political_stance': 1,
            'llm_analysis.stance': 1, 'llm_analysis.generic_sentiment': 1, 'llm_analysis.topic': 1 } },
    ).toArray() : [];
    const igA = new Map(igAnalyses.map((a) => [a.content_id, a]));
    let igUnscored = 0;
    for (const c of igRaw) {
        const owner = igOwner.get(c.source_id) || null;
        const doc = {
            _ig: true, _rid: `ig:${c.id}`, _review: c.review || null, _owner: owner, post_date: c.published_at, platform: 'instagram', tweet_url: c.content_url || null,
            engagement: { likes: num(c.engagement?.likes), replies: num(c.engagement?.comments), retweets: 0, quotes: 0, views: num(c.engagement?.views) },
            posted_by: { handle: c.author_handle, display_name: owner || c.author || c.author_handle, is_verified: true },
            content: { text: c.text || '', media: (Array.isArray(c.media) ? c.media : []).map((x) => ({
                type: x?.type, s3_url: x?.s3_url || null, original_url: x?.original_url || x?.url || null,
                original_video_url: x?.type === 'video' ? (x?.original_video_url || x?.video_url || x?.url || null) : null })) },
        };
        if (subject && owner !== subject && !mhMatch.namesLeader(doc, subject)) continue;
        const a = igA.get(c.id);
        if (c.analysis_status !== 'complete' || !a) { igUnscored += 1; continue; }
        const st = String(a.llm_analysis?.political_stance || a.llm_analysis?.stance || '').toLowerCase();
        doc.analysis = {
            generic_sentiment: a.llm_analysis?.generic_sentiment || a.sentiment || c.sentiment || 'neutral',
            topic: a.llm_analysis?.topic || a.topic || null, intent: a.intent || null, risk_level: a.risk_level || null,
            explanation: a.explanation ? String(a.explanation).replace(/^\[Claude review\]\s*/, '') : null,
        };
        // A leader's own post: promotion or defence of himself is supportive, the rest neutral.
        // His own post is supportive (self-promotion, defence) or neutral — never critical of himself.
        doc._igStance = owner === subject || !subject ? (st.startsWith('pro') ? 'supportive' : 'neutral') : 'unclear';
        collected.push(doc);
        posts.push(doc);
    }

    /* ── per-post derived fields ─────────────────────────────────────── */
    const leaderKey = who?.key || null;
    const stanceOf = (d) => {
        if (d._ig) return d._igStance || 'unclear';
        // His own post is self-presentation, not public opinion of him.
        if (isSubjectOwn(d)) return toneOf(d) === 'positive' ? 'supportive' : 'neutral';
        if (!subject) {
            const s = d.analysis?.political_stance;
            if (s === 'pro_target' || s === 'pro_target_indirect') return 'supportive';
            if (s === 'anti_target' || s === 'anti_target_indirect') return 'critical';
            if (s === 'neutral') return 'neutral';
            return 'unclear';
        }
        const lt = d.analysis?.leader_target;
        if (lt && lt.status === 'targeted') {
            if (lt.target_leader_key !== leaderKey) return 'unclear';
            const v = lt.leader_sentiment;
            return v === 'positive' ? 'supportive' : v === 'negative' ? 'critical' : 'neutral';
        }
        if (d.analysis?.target_entity_canonical === subject) {
            const t = String(d.analysis?.target_tone || '').toLowerCase();
            return t === 'positive' ? 'supportive' : t === 'negative' ? 'critical' : 'neutral';
        }
        return 'unclear';
    };
    const voiceOf = (d) => (d._ig ? 'owned' : (mhMatch.voiceOf(d.posted_by?.handle) || 'organic'));
    // A YouTube channel is a public publisher by nature, so it is named like a verified account.
    const isPublicFigure = (d) => !!d.posted_by?.is_verified || d.platform === 'youtube'
        || ['owned', 'opposition', 'news', 'ally'].includes(voiceOf(d));
    const accountName = (d) => (isPublicFigure(d)
        ? (d.posted_by?.display_name || d.posted_by?.handle || 'Account') : 'Private account');

    for (const d of posts) {
        d._day = istDay(d.post_date);
        d._tone = toneOf(d);
        d._stance = stanceOf(d);
        d._band = bandOf(d);
        d._place = mhMatch.districtIn(d);
        d._tags = hashtagsOf(d);
        d._eng = engagementOf(d.engagement);
        d._score = scoreOf(d.engagement);
        d._platform = platformName(d.platform);
        d._topic = d.analysis?.topic || null;
        d._text = textOf(d);
        d._rid = d._rid || `g:${d._id}`;
        /*
         * A reviewed post: the reviewer's reading replaces the automatic one —
         * tone, risk band, claim flag, topic, and the stance toward THIS leader.
         * A post the reviewer found is not about this leader leaves his report.
         */
        const rv = d._review || d.analysis?.review || null;
        d._reviewed = !!rv;
        if (rv) {
            if (rv.tone) d._tone = rv.tone;
            if (rv.band) d._band = rv.band;
            if (typeof rv.misinformation === 'boolean') d._claim = rv.misinformation;
            if (rv.topic) d._topic = rv.topic;
            if (rv.explanation) d._why = rv.explanation;
            const lr = leaderKey && rv.leaders ? rv.leaders[leaderKey] : null;
            if (lr) {
                if (lr.related === false) d._drop = true;
                else if (lr.stance && !isSubjectOwn(d)) d._stance = lr.stance;
            }
        }
    }
    const dropped = posts.filter((d) => d._drop).length;
    posts = posts.filter((d) => !d._drop);

    const N = posts.length;
    const count = (pred) => posts.reduce((s, d) => s + (pred(d) ? 1 : 0), 0);
    const tone = { positive: count((d) => d._tone === 'positive'), neutral: count((d) => d._tone === 'neutral'), negative: count((d) => d._tone === 'negative') };
    const stance = { supportive: count((d) => d._stance === 'supportive'), critical: count((d) => d._stance === 'critical'),
        neutral: count((d) => d._stance === 'neutral'), unclear: count((d) => d._stance === 'unclear') };
    const bands = { critical: count((d) => d._band === 'critical'), high: count((d) => d._band === 'high'),
        medium: count((d) => d._band === 'medium'), low: count((d) => d._band === 'low') };
    const totalEng = posts.reduce((s, d) => s + d._eng, 0);
    const totalViews = posts.reduce((s, d) => s + num(d.engagement?.views), 0);

    const platformMap = new Map(); posts.forEach((d) => inc(platformMap, d._platform));
    const platforms = top(platformMap, 10).map(([name, n]) => ({ name, n }));
    const lead = platforms[0] || null;

    const placeMap = new Map(); posts.forEach((d) => inc(placeMap, d._place));
    const places = top(placeMap, 50);

    const tagMap = new Map(); posts.forEach((d) => d._tags.forEach((t) => inc(tagMap, t)));
    const topTag = top(tagMap, 1)[0] || null;

    const topicMap = new Map(); posts.forEach((d) => inc(topicMap, d._topic));
    const topics = top(topicMap, 30);

    /* ── days (IST, newest first) ────────────────────────────────────── */
    const postDays = [...new Set(posts.map((d) => d._day))].sort();
    const uniqDays = [];
    if (postDays.length) {
        for (let t = new Date(`${postDays[0]}T00:00:00Z`); t <= new Date(`${postDays[postDays.length - 1]}T00:00:00Z`); t = new Date(t.getTime() + 86400000)) {
            uniqDays.push(t.toISOString().slice(0, 10));
        }
        uniqDays.reverse();
    }
    const dayRows = uniqDays.map((k) => {
        const list = posts.filter((d) => d._day === k);
        const tMap = new Map(); list.forEach((d) => inc(tMap, d._topic));
        const pMap = new Map(); list.forEach((d) => inc(pMap, d._place));
        const neg = list.filter((d) => d._tone === 'negative').length;
        return {
            day: k, posts: list.length,
            positive: list.filter((d) => d._tone === 'positive').length,
            neutral: list.filter((d) => d._tone === 'neutral').length,
            negative: neg, neg_pct: pct(neg, list.length),
            critical_of: list.filter((d) => d._stance === 'critical').length,
            high_risk: list.filter((d) => d._band === 'critical' || d._band === 'high').length,
            leading: top(tMap, 1)[0]?.[0] || null,
            place: top(pMap, 1)[0]?.[0] || null,
        };
    });
    const active = dayRows.filter((r) => r.posts > 0);
    const peak = [...active].sort((a, b) => b.posts - a.posts)[0] || null;
    const sortedCounts = active.map((r) => r.posts).sort((a, b) => a - b);
    const median = sortedCounts.length ? sortedCounts[Math.floor((sortedCounts.length - 1) / 2)] : 0;

    /* ── location trends (place × day) ───────────────────────────────── */
    const placeTrend = places.slice(0, 10).map(([place, n]) => {
        const list = posts.filter((d) => d._place === place);
        const byDay = {}; list.forEach((d) => { byDay[d._day] = (byDay[d._day] || 0) + 1; });
        return { place, total: n, neg_pct: pct(list.filter((d) => d._tone === 'negative').length, n), by_day: byDay };
    });
    const placeRows = places.slice(0, 10).map(([place, n]) => {
        const list = posts.filter((d) => d._place === place);
        const tMap = new Map(); list.forEach((d) => inc(tMap, d._topic));
        const lt = top(tMap, 2).map(([t]) => t).filter(Boolean);
        return { place, posts: n, negative: list.filter((d) => d._tone === 'negative').length,
            context: lt.length ? `Mostly ${lt.join(' and ')}.` : '' };
    });

    /* ── tone blocks ─────────────────────────────────────────────────── */
    const toneBlock = (t) => {
        const list = posts.filter((d) => d._tone === t);
        const p = new Map(); list.forEach((d) => inc(p, d._platform));
        const s = new Map(); list.forEach((d) => inc(s, d._stance));
        const tp = new Map(); list.forEach((d) => inc(tp, d._topic));
        const tg = new Map(); list.forEach((d) => d._tags.forEach((x) => inc(tg, x)));
        return { n: list.length, pct: pct(list.length, N),
            platforms: top(p, 4).map(([k, v]) => ({ k, v })), stance: top(s, 4).map(([k, v]) => ({ k, v })),
            narratives: top(tp, 3).filter(([k]) => k).map(([k, v]) => ({ k, v })), hashtags: top(tg, 4).map(([k]) => k),
            engagement: list.reduce((a, d) => a + d._eng, 0) };
    };

    /**
     * Where "▶ video" / "image" should point so the link still works when the
     * report is opened. A stored copy (S3) first. A video only when it is a
     * plain .mp4 — a stream playlist (.m3u8) or a YouTube thumbnail does not
     * play in a browser, so those fall back to the post, which does. Facebook
     * and Instagram image URLs are signed and expire within days, so only
     * permanent hosts (X, YouTube) are linked directly; the rest open the post.
     * null = the renderer links the post itself.
     */
    const STABLE_IMG = /^https?:\/\/(pbs\.twimg\.com|i\.ytimg\.com|[^/]*amazonaws\.com)\//i;
    const mediaUrlOf = (d) => {
        if (d.platform === 'youtube') return null;
        const ms = Array.isArray(d.content?.media) ? d.content.media : [];
        const m = ms.find((x) => x?.type === 'video') || ms[0];
        if (!m) return null;
        if (m.s3_url) return m.s3_url;
        if (m.type === 'video') {
            const v = String(m.original_video_url || '');
            return /\.mp4(\?|$)/i.test(v) && /^https?:\/\/(video\.twimg\.com|[^/]*amazonaws\.com)\//i.test(v) ? v : null;
        }
        const img = m.original_url || m.preview_url || m.url || '';
        return STABLE_IMG.test(img) ? img : null;
    };
    const postRow = (d) => ({
        id: d._rid, reviewed: d._reviewed,
        media_url: mediaUrlOf(d),
        when: d.post_date, platform: d._platform, account: accountName(d), text: d._text.slice(0, 600),
        url: d.tweet_url || null, engagement: d._eng, views: num(d.engagement?.views),
        media: Array.isArray(d.content?.media) && d.content.media.length
            ? (d.content.media.some((m) => m?.type === 'video') || d.platform === 'youtube' ? 'video' : 'image') : null,
        stance: d._stance, tone: d._tone, topic: d._topic,
    });
    const byEng = (a, b) => b._eng - a._eng;

    const topNegative = posts.filter((d) => d._tone === 'negative').sort(byEng).slice(0, 12).map(postRow);

    /* ── risk ────────────────────────────────────────────────────────── */
    const riskRows = posts.filter((d) => d._band === 'critical' || d._band === 'high')
        .sort((a, b) => (a._band === b._band ? new Date(b.post_date) - new Date(a.post_date) : a._band === 'critical' ? -1 : 1))
        .slice(0, 30)
        .map((d) => {
            const intent = String(d.analysis?.intent || '').toLowerCase();
            const why = d._why || [INTENT_LABEL[intent] || null, autoExplanation(d) || null].filter(Boolean).join(': ');
            return { ...postRow(d), band: d._band, why: why.slice(0, 260) };
        });
    const topRisk = posts.filter((d) => d._band === 'critical' || d._band === 'high').sort(byEng)[0] || null;
    const mediumRows = posts.filter((d) => d._band === 'medium').sort(byEng).slice(0, 12)
        .map((d) => ({ ...postRow(d), band: 'medium', why: String(d._why || autoExplanation(d) || '').slice(0, 260) }));

    /* ── entities ────────────────────────────────────────────────────── */
    const ent = new Map();
    for (const d of posts) {
        const seen = new Set();
        for (const e of (Array.isArray(d.analysis?.mentioned_entities) ? d.analysis.mentioned_entities : [])) {
            const name = typeof e === 'string' ? e : (e?.canonical || e?.name);
            if (!name || seen.has(name)) continue;
            seen.add(name);
            const r = ent.get(name) || { name, type: e?.type || null, n: 0, positive: 0, neutral: 0, negative: 0 };
            r.n += 1; r[d._tone] += 1; ent.set(name, r);
        }
    }
    const entities = [...ent.values()].sort((a, b) => b.n - a.n).slice(0, 12)
        .map((r) => ({ ...r, neg_pct: pct(r.negative, r.n) }));

    const attack = new Map(); posts.forEach((d) => inc(attack, fixGovt(d.analysis?.attack_target, d) || null));

    /* ── influencers ─────────────────────────────────────────────────── */
    const acc = new Map();
    for (const d of posts) {
        const key = `${d._platform}:${mhMatch.norm(d.posted_by?.handle || d.posted_by?.display_name || '')}`;
        if (!key.endsWith(':')) {
            const r = acc.get(key) || { name: accountName(d), handle: d.posted_by?.handle, platform: d._platform,
                verified: !!d.posted_by?.is_verified, voice: voiceOf(d), public: isPublicFigure(d), type: null, _doc: d,
                posts: 0, score: 0, likes: 0, stance: new Map() };
            r.posts += 1; r.score += d._score; r.likes += num(d.engagement?.likes); inc(r.stance, d._stance);
            acc.set(key, r);
        }
    }
    const accounts = [...acc.values()];
    /* "Own account" means the SUBJECT's own handle. Other government accounts
     * (CMO, ministers) and other leaders are labelled for what they are, so
     * Sharad Pawar's account never reads "Own account" in a Fadnavis report. */
    const TYPE = { owned: 'Government / ally account', opposition: 'Opposition', news: 'News outlet', ally: 'Ally' };
    const typeOf = (d) => (isSubjectOwn(d) ? 'Own account'
        : (d._ig && !subject) ? 'Leader account'
            : TYPE[voiceOf(d)] || (d.platform === 'youtube' ? 'YouTube channel' : d.posted_by?.is_verified ? 'Verified account' : 'Public account'));
    const influencers = accounts.filter((a) => a.public).sort((a, b) => b.score - a.score).slice(0, 12).map((a) => {
        const s = top(a.stance, 1)[0]?.[0];
        return { name: a.name, type: typeOf(a._doc),
            platform: a.platform, posts: a.posts, score: a.score,
            mostly: s === 'critical' ? `critical of ${subjectLabel}` : s === 'supportive' ? `supportive of ${subjectLabel}` : s || 'unclear' };
    });
    const accPlat = new Map(); accounts.forEach((a) => inc(accPlat, a.platform));

    /* ── stance by platform, and who is supportive / critical ───────────── */
    const stanceByPlatform = platforms.map(({ name }) => {
        const list = posts.filter((d) => d._platform === name);
        const c = (f) => list.filter(f).length;
        return { platform: name, posts: list.length,
            supportive: c((d) => d._stance === 'supportive'), critical: c((d) => d._stance === 'critical'),
            neutral: c((d) => d._stance === 'neutral'), unclear: c((d) => d._stance === 'unclear'),
            positive: c((d) => d._tone === 'positive'), negative: c((d) => d._tone === 'negative') };
    });
    // Public accounts are named; private individuals are counted, never listed.
    const whoBy = (want) => {
        const named = new Map(); const priv = { accounts: new Set(), posts: 0 };
        for (const d of posts.filter((x) => x._stance === want)) {
            if (isPublicFigure(d)) {
                const k = `${d._platform}:${accountName(d)}`;
                const r = named.get(k) || { name: accountName(d), platform: d._platform, type: typeOf(d), posts: 0, engagement: 0 };
                r.posts += 1; r.engagement += d._eng; named.set(k, r);
            } else { priv.accounts.add(mhMatch.norm(d.posted_by?.handle || '')); priv.posts += 1; }
        }
        return { named: [...named.values()].sort((a, b) => b.posts - a.posts || b.engagement - a.engagement).slice(0, 12),
            private_accounts: priv.accounts.size, private_posts: priv.posts };
    };
    const stanceAccounts = { supportive: whoBy('supportive'), critical: whoBy('critical') };

    /* ── narratives (issues) ─────────────────────────────────────────── */
    const mid = new Date((from.getTime() + to.getTime()) / 2);
    const narratives = topics.filter(([t]) => t).slice(0, 10).map(([topic, n]) => {
        const list = posts.filter((d) => d._topic === topic);
        const early = list.filter((d) => new Date(d.post_date) < mid).length;
        const late = n - early;
        const trend = late > early * 1.25 ? 'growing' : early > late * 1.25 ? 'declining' : 'steady';
        const p = new Map(); list.forEach((d) => inc(p, d._platform));
        const crit = list.filter((d) => d._stance === 'critical').length;
        const sup = list.filter((d) => d._stance === 'supportive').length;
        const neg = list.filter((d) => d._tone === 'negative').length;
        const tg = new Map(); list.forEach((d) => d._tags.forEach((x) => inc(tg, x)));
        const tags = top(tg, 3).map(([k]) => k);
        const examples = [...list].sort((a, b) => (Number(isPublicFigure(b)) - Number(isPublicFigure(a))) || byEng(a, b))
            .slice(0, 3).map((d) => ({ id: d._rid, reviewed: d._reviewed, account: accountName(d), text: d._text.slice(0, 220), url: d.tweet_url || null,
                media: postRow(d).media, media_url: mediaUrlOf(d) }));
        const description = [
            `${fmt(neg)} of these posts (${pct(neg, n)}%) are negative in tone.`,
            subject ? `On ${subject}, ${fmt(crit)} are critical and ${fmt(sup)} supportive.` : `${fmt(crit)} are critical of the government and ${fmt(sup)} supportive.`,
            tags.length ? `Common hashtags: ${tags.join(' ')}.` : '',
        ].filter(Boolean).join(' ');
        return { topic, n, pct: pct(n, N), trend, platforms: top(p, 3).map(([k, v]) => `${k} ${fmt(v)}`).join(', '),
            description, examples, critical: crit, supportive: sup };
    });
    const growing = [...narratives].filter((x) => x.trend === 'growing' && x.n >= 5).sort((a, b) => b.n - a.n)[0] || null;

    /* ── activity: what the posts are doing ──────────────────────────── */
    const typeMap = new Map(); posts.forEach((d) => { const t = d.analysis?.grievance_type; if (t && t !== 'Normal') inc(typeMap, t); });
    const activity = top(typeMap, 8).map(([type, n]) => {
        const list = posts.filter((d) => d.analysis?.grievance_type === type);
        const dm = new Map(); list.forEach((d) => inc(dm, d._day));
        const pm = new Map(); list.forEach((d) => inc(pm, d._place));
        const days = [...dm.keys()].sort();
        const ex = [...list].sort(byEng)[0];
        return { type, n, critical: list.filter((d) => d._stance === 'critical').length,
            first: days[0] || null, last: days[days.length - 1] || null, busiest: top(dm, 1)[0]?.[0] || null,
            place: top(pm, 1)[0]?.[0] || null, example: ex ? { account: accountName(ex), text: ex._text.slice(0, 220), url: ex.tweet_url || null } : null };
    });
    const activityTotal = activity.reduce((s, a) => s + a.n, 0);

    /* ── claims (unverified) ─────────────────────────────────────────── */
    // Only posts the analysis CLASSIFIED as misinformation. The policy list in
    // `reasons` names Misinformation as a category to check, not a finding, so
    // matching on it pulled in posts whose own explanation says "no misinformation".
    const isClaim = (d) => (typeof d._claim === 'boolean' ? d._claim : String(d.analysis?.intent || '').toLowerCase() === 'misinformation');
    const claimList = posts.filter(isClaim);
    const claims = [...claimList].sort(byEng).slice(0, 12).map((d) => ({ ...postRow(d), why: String(d._why || autoExplanation(d) || '').slice(0, 240) }));

    /* ── evidence and footage ────────────────────────────────────────── */
    const withMedia = posts.filter((d) => Array.isArray(d.content?.media) && d.content.media.length);
    const evidence = withMedia.filter(isPublicFigure).sort(byEng).slice(0, 20).map(postRow);
    const footage = posts.filter((d) => d.platform === 'youtube' || (Array.isArray(d.content?.media) && d.content.media.some((m) => m?.type === 'video')))
        .sort((a, b) => num(b.engagement?.views) - num(a.engagement?.views) || byEng(a, b)).slice(0, 15).map(postRow);

    /* ── languages ───────────────────────────────────────────────────── */
    const scripts = { devanagari: 0, latin: 0 };
    posts.forEach((d) => { const l = String(d.analysis?.language_detected || ''); if (/devanagari|hindi|marathi/i.test(l)) scripts.devanagari += 1; if (/latin|english|hinglish/i.test(l)) scripts.latin += 1; });

    /* ── criticism drivers ───────────────────────────────────────────── */
    const critPosts = posts.filter((d) => d._stance === 'critical');
    const critTopic = new Map(); critPosts.forEach((d) => inc(critTopic, d._topic));
    const critTop = top(critTopic, 3).filter(([k]) => k);
    const critTopShare = critPosts.length ? pct(critTop.slice(0, 2).reduce((s, [, v]) => s + v, 0), critPosts.length) : 0;
    const negTopic = new Map(); posts.filter((d) => d._tone === 'negative').forEach((d) => inc(negTopic, d._topic));
    const negLead = top(negTopic, 1).filter(([k]) => k)[0] || null;

    const lastTwo = active.slice(0, 2);
    const peakTopPost = peak ? posts.filter((d) => d._day === peak.day).sort(byEng)[0] : null;
    const namedPeople = entities.filter((e) => e.name !== subject).slice(0, 8);
    const topAccounts = [...new Set(influencers.map((i) => i.name))].slice(0, 4);

    /* ── executive summary ───────────────────────────────────────────── */
    const period = `${longDay(from.toISOString().slice(0, 10))} to ${longDay(to.toISOString().slice(0, 10))}`;
    const platformList = platforms.map((p) => `${p.name} ${fmt(p.n)}`).join(', ');
    const narrList = narratives.slice(0, 3).map((x) => `${x.topic} (${x.pct}%)`).join(', ');
    const summary = [
        { label: 'In brief', text: [
            `Between ${period.replace(' to ', ' and ')}, ${fmt(N)} relevant public posts (${platformList}) discussed ${subjectLabel}, drawing about ${fmt(totalEng)} engagements${totalViews ? ` and ${fmt(totalViews)} views` : ''}.`,
            N ? `Tone was ${pct(tone.positive, N)}% positive, ${pct(tone.neutral, N)}% neutral and ${pct(tone.negative, N)}% negative.` : '',
            subject ? `Where posts take a position on ${subject}, ${fmt(stance.critical)} are critical and ${fmt(stance.supportive)} supportive.` : `Where posts take a position on the government, ${fmt(stance.critical)} are critical and ${fmt(stance.supportive)} supportive.`,
            narrList ? `The leading narratives are ${narrList}.` : '',
            bands.critical + bands.high ? `${fmt(bands.critical)} posts are in the critical risk band and ${fmt(bands.high)} in the high band${topRisk ? `; the most-engaged of them reached ${fmt(topRisk._eng)} engagements` : ''}.` : 'No posts were placed in the critical or high risk band.',
        ].filter(Boolean).join(' ') },
        peak ? { label: 'What happened', text: [
            `The busiest day was ${longDay(peak.day)} with ${fmt(peak.posts)} posts${median ? `, about ${Math.round((peak.posts / median) * 10) / 10}× the median day (${fmt(median)})` : ''}, ${peak.neg_pct}% of them negative in tone${peak.leading ? ` and led by ${peak.leading}` : ''}.`,
            peakTopPost ? `The most-engaged post that day, from ${accountName(peakTopPost) === 'Private account' ? 'a private account' : accountName(peakTopPost)} on ${peakTopPost._platform}: “${peakTopPost._text.slice(0, 200)}${peakTopPost._text.length > 200 ? '…' : ''}”` : '',
        ].filter(Boolean).join(' ') } : null,
        { label: 'When and where', text: [
            active.length ? `Posts are dated ${longDay(active[active.length - 1].day)} to ${longDay(active[0].day)}.` : '',
            places.length ? `The most-named places are ${places.slice(0, 4).map(([p, n]) => `${p} (${fmt(n)})`).join(', ')}.` : 'Few posts name a place.',
        ].filter(Boolean).join(' ') },
        (namedPeople.length || topAccounts.length) ? { label: 'Who is involved', text: [
            namedPeople.length ? `Most named alongside ${subjectLabel}: ${namedPeople.slice(0, 6).map((e) => `${e.name} (${fmt(e.n)})`).join(', ')}.` : '',
            topAccounts.length ? `Highest-reach public accounts: ${topAccounts.join(', ')}.` : '',
        ].filter(Boolean).join(' ') } : null,
        critTop.length ? { label: 'Why it matters', text: [
            `${critTopShare}% of the ${fmt(critPosts.length)} critical posts sit in ${critTop.slice(0, 2).map(([k]) => k).join(' and ')}.`,
            growing ? `${growing.topic} is growing through the period (${fmt(growing.n)} posts).` : '',
            claimList.length ? `${fmt(claimList.length)} posts carry claims the model flagged as possible misinformation.` : '',
        ].filter(Boolean).join(' ') } : null,
        { label: 'Online discussion', text: [
            `${fmt(N)} relevant posts (${platformList}) with about ${fmt(totalEng)} engagements.`,
            `On ${subjectLabel}, ${fmt(stance.critical)} posts are critical, ${fmt(stance.supportive)} supportive, ${fmt(stance.neutral)} neutral and ${fmt(stance.unclear)} do not take a clear position.`,
            narrList ? `Leading narratives: ${narrList}.` : '',
        ].filter(Boolean).join(' ') },
    ].filter(Boolean);

    /* ── key intelligence ────────────────────────────────────────────── */
    const intel = [];
    if (peak) intel.push({ title: `Public conversation peaked on ${longDay(peak.day)}`,
        body: `${fmt(peak.posts)} relevant posts on ${longDay(peak.day)}${median ? `, about ${Math.round((peak.posts / median) * 10) / 10}× the median day (${fmt(median)})` : ''}; ${peak.neg_pct}% negative in tone.`,
        note: 'Platform search returns the newest posts first, so the most recent days can be over-represented; read late peaks as directional.' });
    if (critTop.length) intel.push({ title: `Criticism of ${subjectLabel} is concentrated in ${critTop[0][0]}${critTop[1] ? ` and ${critTop[1][0]}` : ''}`,
        body: `${critTopShare}% of the ${fmt(critPosts.length)} posts critical of ${subjectLabel} carry these narratives. Most common: ${critTop.map(([k, v]) => `${k} (${pct(v, critPosts.length)}%)`).join(', ')}.` });
    if (N) intel.push({ title: `Conversation is broader than criticism of ${subjectLabel}`,
        body: `${pct(stance.critical, N)}% of relevant posts are critical of ${subjectLabel} and ${pct(stance.supportive, N)}% supportive; ${pct(stance.unclear, N)}% do not take a clear position on ${subjectLabel}. By what they discuss: ${narratives.slice(0, 4).map((x) => `${x.topic} ${x.pct}%`).join(', ')}.` });
    intel.push(bands.critical + bands.high
        ? { title: 'Explicit threats and abuse are limited in volume but need separate monitoring',
            body: `${fmt(bands.critical)} posts (${pct(bands.critical, N)}%) are in the critical band (threats, incitement, violence) and ${fmt(bands.high)} more are high-risk (hate, communal or abusive content, misinformation)${topRisk ? `; the most-engaged reached ${fmt(topRisk._eng)} engagements` : ''}.` }
        : { title: 'No threats or abuse detected', body: 'No post in this period was placed in the critical or high risk band.' });
    if (claimList.length) intel.push({ title: 'Unverified claims are a recurring information risk',
        body: `${fmt(claimList.length)} posts state allegations the model flagged as possible misinformation. Examples: ${claims.slice(0, 3).map((c) => c.why || c.text.slice(0, 90)).filter(Boolean).join('; ')}.` });
    if (growing) intel.push({ title: `Fastest-growing narrative: ${growing.topic}`,
        body: `${fmt(growing.n)} posts (${growing.pct}%), rising from the first half of the period to the second; ${fmt(growing.critical)} critical and ${fmt(growing.supportive)} supportive of ${subjectLabel}. Mostly on ${growing.platforms}.` });

    /* ── what requires attention ─────────────────────────────────────── */
    const attention = [];
    if (bands.critical + bands.high) attention.push({ severity: bands.critical ? 'high' : 'medium',
        title: `${fmt(bands.critical + bands.high)} posts in the critical or high risk band`,
        body: `${fmt(bands.critical)} critical (threats, incitement, violence) and ${fmt(bands.high)} high (hate, communal or abusive content, misinformation).${topRisk ? ` The most-engaged reached ${fmt(topRisk._eng)} engagements.` : ''} Details are in the risk-band section.` });
    if (narratives[0]) attention.push({ severity: 'medium', title: `Leading narrative: ${narratives[0].topic}`,
        body: `${fmt(narratives[0].n)} posts (${narratives[0].pct}%), trend ${narratives[0].trend}, mostly on ${narratives[0].platforms}.` });
    if (lastTwo.length === 2) attention.push({ severity: 'medium', title: `Posts on ${longDay(lastTwo[0].day)} compared with ${longDay(lastTwo[1].day)}`,
        body: `${fmt(lastTwo[0].posts)} posts on ${longDay(lastTwo[0].day)} against ${fmt(lastTwo[1].posts)} on ${longDay(lastTwo[1].day)}${peak ? `; the busiest day was ${longDay(peak.day)} (${fmt(peak.posts)} posts)` : ''}.` });
    if (claimList.length) attention.push({ severity: 'medium', title: `${fmt(claimList.length)} posts carry unverified claims`, body: 'Allegations stated as fact that the model flagged as possible misinformation. Listed under claims below.' });
    const negConc = negLead ? { severity: 'low', title: 'Where negativity is concentrated',
        body: `The largest number of negative posts is about ${negLead[0]} (${fmt(negLead[1])} of ${fmt(topicMap.get(negLead[0]) || 0)} posts on it).` } : null;
    if (negConc) attention.push(negConc);

    /* ── keywords (tracked terms) ────────────────────────────────────── */
    let keywordRows = [];
    try {
        const kws = await scopedCollection(db, 'keywords').find({ is_active: true }, { projection: { keyword: 1 } }).toArray();
        const seenTerm = new Set();
        const terms = kws.map((k) => String(k.keyword || '').trim().replace(/^@+/, '')).filter((k) => {
            const key = k.toLowerCase();
            if (k.length <= 2 || seenTerm.has(key)) return false;
            seenTerm.add(key); return true;
        });
        keywordRows = terms.map((term) => {
            const t = term.toLowerCase();
            return { term, n: posts.reduce((s, d) => s + (d._text.toLowerCase().includes(t) ? 1 : 0), 0) };
        }).filter((r) => r.n > 0).sort((a, b) => b.n - a.n).slice(0, 10);
    } catch (e) { keywordRows = []; }

    /* ── considerations ──────────────────────────────────────────────── */
    const complaintTypes = activity.filter((a) => /complaint|law/i.test(a.type));
    const considerations = {
        factcheck: claims.slice(0, 3).map((c) => c.why).filter(Boolean)
            .map((w) => `Check against official records: ${w}`),
        questions: [
            ...complaintTypes.slice(0, 2).map((a) => `What is the status of the ${a.type.toLowerCase()}s raised in ${fmt(a.n)} posts${a.place ? `, most often naming ${a.place}` : ''}?`),
            ...critTop.slice(0, 2).map(([k, v]) => `What has been done on ${k}, the subject of ${fmt(v)} critical posts?`),
        ],
        communication: [
            scripts.devanagari && scripts.latin ? `Publish factual material in Marathi/Hindi (Devanagari, ${pct(scripts.devanagari, N)}% of posts) and English or romanised text (${pct(scripts.latin, N)}%), the scripts this discussion uses.` : '',
            critTop.length ? `Answer the specific points raised on ${critTop.slice(0, 2).map(([k]) => k).join(' and ')} with sourced facts rather than responding to slogans or satire.` : '',
            narratives.find((x) => x.supportive > x.critical) ? `Build on ${narratives.find((x) => x.supportive > x.critical).topic}, where supportive posts outnumber critical ones.` : '',
        ].filter(Boolean),
        gaps: [
            'No Instagram, Reddit or Telegram mentions are in this data: those platforms are not collected for mentions yet.',
            'Platform search returns a sample; the counts describe the posts collected, not every post.',
            `Places are detected from the post text; ${pct(posts.filter((d) => d._place).length, N)}% of posts name one.`,
            'Facts and claims are not checked against outside sources in this report.',
        ],
        monitoring: [
            growing ? `${growing.topic}, which grew through the period.` : '',
            peak && peak.leading ? `Follow-ups to the ${longDay(peak.day)} peak on ${peak.leading}.` : '',
            influencers.find((i) => /critical/.test(i.mostly)) ? `Posts from ${influencers.filter((i) => /critical/.test(i.mostly)).slice(0, 3).map((i) => i.name).join(', ')}, the highest-reach critical accounts.` : '',
            claimList.length ? 'New unverified or misattributed claims about the leader or the government.' : '',
        ].filter(Boolean),
        safety: [
            bands.critical ? `Report the ${fmt(bands.critical)} critical-band posts (threats, incitement, violence) to the platforms and share them with the office's security staff.` : '',
            bands.high ? `Report the ${fmt(bands.high)} high-band posts (hate, communal or abusive content, misinformation) through platform reporting channels.` : '',
        ].filter(Boolean),
    };

    const closing = [
        `Between ${period.replace(' to ', ' and ')}, ${fmt(N)} relevant posts discussed ${subjectLabel}${lead ? `, ${pct(lead.n, N)}% of them on ${lead.name}` : ''}.`,
        N ? `The tone was ${pct(tone.negative, N)}% negative, ${pct(tone.neutral, N)}% neutral and ${pct(tone.positive, N)}% positive; ${fmt(stance.critical)} posts were critical of ${subjectLabel} and ${fmt(stance.supportive)} supportive.` : '',
        narratives[0] ? `${narratives[0].topic} led the conversation${narratives[1] ? `, followed by ${narratives[1].topic}` : ''}.` : '',
        peak ? `Activity peaked on ${longDay(peak.day)}.` : '',
        bands.critical + bands.high ? `${fmt(bands.critical + bands.high)} posts need attention for threats, abuse or misinformation.` : '',
    ].filter(Boolean).join(' ');

    // How many of the posts listed in the evidence tables were individually reviewed.
    const shownRows = new Map();
    [...topNegative, ...riskRows, ...mediumRows, ...claims, ...evidence, ...footage,
        ...narratives.flatMap((x) => x.examples)].forEach((r) => { if (r && r.id) shownRows.set(r.id, !!r.reviewed); });
    const reviewCoverage = { shown: shownRows.size, reviewed: [...shownRows.values()].filter(Boolean).length };

    return {
        kind: 'monitoring_report',
        // Read by the download file name for the combined report.
        profile: { state: 'Maharashtra' },
        review_coverage: reviewCoverage,
        leader: subject, handle: handle || null,
        window: { from: from.toISOString(), to: to.toISOString(), days: Math.max(1, Math.round((to - from) / 86400000)) },
        meta: { name: subject || 'All monitored leaders', role: who?.role || (subject ? '' : 'Maharashtra leadership monitoring'),
            party: who ? (PARTY[String(who.party || '').toLowerCase()] || who.party || '') : '', state: 'Maharashtra', subject_label: subjectLabel,
            base: who?.base ? [who.base.constituency, who.base.district].filter(Boolean).join(', ') : '',
            period, generated: longDay(istDay(new Date())), collected: collected.length, excluded: excluded.length + dropped,
            relevant: N, platforms },
        tiles: { relevant: N, lead, places: places.length, negative: tone.negative, engagement: totalEng,
            positive_pct: pct(tone.positive, N), neutral_pct: pct(tone.neutral, N), negative_pct: pct(tone.negative, N),
            high_critical: bands.critical + bands.high, top_tag: topTag ? { tag: topTag[0], n: topTag[1] } : null },
        tone, stance, bands, summary, intel, attention, platforms, keywords: keywordRows,
        stance_by_platform: stanceByPlatform, stance_accounts: stanceAccounts, instagram_unscored: igUnscored,
        days: dayRows, peak, place_trend: { days: uniqDays, rows: placeTrend }, places: placeRows,
        activity: { total: activityTotal, items: activity, in_window: N, lead, engagement: totalEng },
        tone_blocks: { positive: toneBlock('positive'), negative: toneBlock('negative'), neutral: toneBlock('neutral') },
        top_negative: topNegative,
        risk: { rows: riskRows, medium_rows: mediumRows },
        entities, attack_targets: top(attack, 6).filter(([k]) => k).map(([k, v]) => ({ k, v })),
        influencers: { public_accounts: accounts.length, top_platform: top(accPlat, 1)[0]?.[0] || null,
            top_score: influencers[0]?.score || 0, likes: posts.reduce((s, d) => s + num(d.engagement?.likes), 0),
            shares: posts.reduce((s, d) => s + num(d.engagement?.retweets) + num(d.engagement?.quotes), 0),
            comments: posts.reduce((s, d) => s + num(d.engagement?.replies), 0), rows: influencers },
        narratives, claims, considerations, evidence, footage, closing,
    };
};

const getLeaderReport = async (req, res) => {
    try {
        const qFrom = parseDay(req.query.from);
        const qTo = parseDay(req.query.to, true);
        const now = new Date();
        const to = qTo || now;
        const from = qFrom && qFrom < to ? qFrom : new Date(to.getTime() - 7 * 86400000);
        const leader = String(req.query.leader || '').trim() || null;
        const handle = String(req.query.handle || '').trim() || null;
        const report = await buildLeaderReport({ db: mongoose.connection.db, leader, handle, from, to });
        res.json(report);
    } catch (err) {
        console.error('[leaderReport] failed:', err);
        res.status(500).json({ message: 'Could not build the report', error: err.message });
    }
};

module.exports = { getLeaderReport, buildLeaderReport };
