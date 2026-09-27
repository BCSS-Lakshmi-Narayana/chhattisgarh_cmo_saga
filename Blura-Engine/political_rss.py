"""
Political Saga RSS Scraper — Blura Engine, Chhattisgarh political monitoring.
Fetches RSS feeds → filters for Chhattisgarh political relevance → detects language + category
→ optionally generates English title/summary via Cohere → writes to MongoDB.
"""

import os
import re
import json
import time
import socket
import logging
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse
from typing import Optional, Tuple, List, Dict

import feedparser
import requests
from bs4 import BeautifulSoup

from political_config import (
    RSS_FEEDS,
    POLITICAL_RELEVANCE_KEYWORDS,
    CATEGORY_KEYWORDS,
    LOCATION_KEYWORDS,
    LOCATION_META,
    STATE_NAME,
    STATE_LAT,
    STATE_LNG,
    ALIAS_BLOCKED_CONTINUATIONS,
)
from DB.mongo_connect import get_db
from DB.mongo_insert import upsert_article
# NOTE: DB.mongo_similarity (check_duplicate) is deliberately NOT imported here.
# It was imported but never called, and the import alone cost ~694MB resident —
# sentence_transformers pulls in torch, and the torch in this venv is the CUDA
# build (2.13.0+cu130) on a box with no GPU, so cuBLAS/cuDNN/libtorch_cuda get
# mapped in at import time. Dedup is unaffected; see that module's docstring.

# ── Load user-managed keywords from MongoDB ───────────────────────────────────

_keyword_cache: Optional[List[str]] = None


def reset_keyword_cache() -> None:
    """Called at the start of each run so keyword edits made in the UI apply
    to the next run without a query per article."""
    global _keyword_cache
    _keyword_cache = None


def load_relevance_keywords() -> List[str]:
    """Load user-managed keywords from DB (cached per run). Respect disabled
    ones. Fall back to config if empty or error."""
    global _keyword_cache
    if _keyword_cache is None:
        _keyword_cache = _load_relevance_keywords_uncached()
    return _keyword_cache


def _load_relevance_keywords_uncached() -> List[str]:
    try:
        col = get_db()['rsskeywords']
        docs = list(col.find({}, {'keyword': 1, 'is_active': 1, '_id': 0}))
        if docs:
            user_active = {d['keyword'] for d in docs if d.get('is_active', True)}
            return list(user_active)
    except Exception as e:
        print(f"[WARN] Could not load keywords from DB: {e}. Using config defaults.")
    return list(POLITICAL_RELEVANCE_KEYWORDS)

# Optional Cohere — only used when COHERE_API_KEY is set in .env or .env.political
_cohere_client = None
_COHERE_KEY = os.getenv('COHERE_API_KEY', '')
if _COHERE_KEY:
    try:
        import cohere
        _cohere_client = cohere.ClientV2(_COHERE_KEY)
    except Exception as e:
        print(f"[WARN] Cohere init failed: {e}. English generation disabled.")

logging.basicConfig(
    filename='political_rss.log',
    level=logging.WARNING,
    format='%(asctime)s %(levelname)s %(message)s',
)

# Safety net: without this, any blocking call that lacks its own explicit
# timeout (e.g. a stalled connection during DNS/SSL) can hang the engine
# forever, since it runs a single sequential loop with no per-feed watchdog.
socket.setdefaulttimeout(20)

HEADERS = {
    'User-Agent': (
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        'AppleWebKit/537.36 (KHTML, like Gecko) '
        'Chrome/120.0.0.0 Safari/537.36'
    ),
    'Accept-Language': 'en-US,en;q=0.9,mr;q=0.8,kok;q=0.8,hi;q=0.7',
}

_SKIP_PATTERNS = re.compile(
    r'/(tag|tags|category|categories|section|topic|author|page|feed|rss|'
    r'search|trending|videos|gallery|live|breaking|sitemap)(/|$)',
    re.IGNORECASE,
)

SKIP_DOMAINS = {'indianexpress.com', 'news.google.com'}
# Older items are skipped: Google News searches reach back months.
MAX_ARTICLE_AGE_DAYS = 30
DEFAULT_IMAGE_URL = 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/41/Flag_of_India.svg/320px-Flag_of_India.svg.png'


# ── Language detection ─────────────────────────────────────────────────────────

# Hindi and Chhattisgarhi share Devanagari, so the script alone cannot tell
# them apart; high-frequency function words can (copula है / हवय, negation
# नहीं / नइ, possessive हमारा / हमर, object marker को / ला). Mirrors
# backend/src/services/politicalContextService.js.
_DEVANAGARI_MARKERS = {
    'hne': {'हवय', 'हावय', 'हावे', 'हवे', 'नइ', 'नइहे', 'नइए', 'हमर', 'हमन', 'तुमन', 'तुंहर', 'मोर', 'तोर',
            'ओकर', 'ओमन', 'काबर', 'कइसे', 'रिहिस', 'रहिस', 'जाथे', 'करथे', 'होथे', 'होही', 'अउ', 'फेर', 'बर',
            'संग', 'सबले', 'बढ़िया', 'गोठ', 'गोठियाथे', 'छत्तीसगढ़िया', 'भइया', 'दाई', 'किसान मन', 'मन'},
    'hi':  {'है', 'हैं', 'नहीं', 'मैं', 'आप', 'हम', 'और', 'लेकिन', 'क्या', 'क्यों', 'कब', 'चाहिए', 'था', 'थे',
            'को', 'में', 'से', 'यह', 'वह', 'भी', 'कुछ', 'बहुत', 'गया', 'रहा',
            'ने', 'के', 'नई', 'लिए', 'गई', 'किया', 'किए', 'पर', 'छत्तीसगढ़ में'},
}

# Chhattisgarhi in Roman script. Distinctive function words and spellings;
# two hits are required so an English sentence with "bar" or "sang" stays 'en'.
_ROMAN_CG_MARKERS = {
    'hawe', 'hawaye', 'havay', 'hamar', 'hamman', 'tuman', 'tumhar', 'okar', 'kabar', 'rihis', 'rahis',
    'jathe', 'karthe', 'hothe', 'hohi', 'sable', 'badhiya', 'goth', 'chhattisgarhiya', 'bhaiya', 'nai',
}


def detect_language(text: str, devanagari_default: str = 'hi') -> str:
    """Heuristic: Devanagari vs Latin by character count, then Hindi vs
    Chhattisgarhi by marker words. Devanagari that no marker set clearly
    wins falls back to `devanagari_default` (Chhattisgarh's Devanagari press
    is Hindi)."""
    if not text:
        return 'en'
    devanagari = len(re.findall(r'[ऀ-ॿ]', text))
    latin      = len(re.findall(r'[a-zA-Z]', text))
    total = devanagari + latin or 1
    if devanagari / total <= 0.1:
        words = re.findall(r"[a-z]+", text.lower())
        if len({w for w in words if w in _ROMAN_CG_MARKERS}) >= 2:
            return 'hne'
        return 'en'
    tokens = re.findall(r'[ऀ-ॿ]+', text)
    scores = sorted(
        ((sum(1 for t in tokens if t in markers), lang) for lang, markers in _DEVANAGARI_MARKERS.items()),
        reverse=True,
    )
    (best, best_lang), (second, _) = scores[0], scores[1]
    if best >= 1 and best > second:
        return best_lang
    return devanagari_default


# ── Political relevance ────────────────────────────────────────────────────────

def get_relevance_score(text: str) -> Tuple[int, List[str]]:
    """Count how many political keywords appear. Returns (score, matched_keywords)."""
    keywords = load_relevance_keywords()
    lower = text.lower()
    matched = []
    for kw in keywords:
        if kw not in matched and _alias_position(lower, kw) != -1:
            matched.append(kw)
    return len(matched), matched


# ── Category detection ────────────────────────────────────────────────────────

# Tie-break priority when two categories score equally — e.g. "BJP minister
# arrested in corruption case" hits 'crime' (arrested, corruption) and
# 'politics' (bjp, minister) equally. This is a political-monitoring platform,
# so politics should win that tie, not whichever key happens to be declared
# first in CATEGORY_KEYWORDS (previously 'crime', by dict order — silently).
_CATEGORY_TIE_PRIORITY = ['politics', 'development', 'law_order', 'communal', 'crime']


def detect_category(text: str) -> str:
    lower = text.lower()
    scores = {}
    for cat, keywords in CATEGORY_KEYWORDS.items():
        score = sum(1 for kw in keywords if _alias_position(lower, kw) != -1)
        if score:
            scores[cat] = score
    if not scores:
        return 'general'
    top_score = max(scores.values())
    tied = [cat for cat, s in scores.items() if s == top_score]
    if len(tied) == 1:
        return tied[0]
    for cat in _CATEGORY_TIE_PRIORITY:
        if cat in tied:
            return cat
    return tied[0]


# ── District detection ────────────────────────────────────────────────────────

def _alias_position(lower: str, alias: str) -> int:
    """First index of `alias` in `lower`, or -1. Latin aliases must match as
    whole words — short place names hide inside English words ("durg" in
    "durga", "balod" in "baloda"). Devanagari aliases match as substrings,
    since case suffixes attach directly (रायपुर में / रायपुर से), except for the
    continuations listed in ALIAS_BLOCKED_CONTINUATIONS."""
    alias = alias.lower()
    if re.search(r'[a-z]', alias):
        m = re.search(r'(?<![a-z0-9])' + re.escape(alias) + r'(?![a-z0-9])', lower)
        return m.start() if m else -1
    blocked = ALIAS_BLOCKED_CONTINUATIONS.get(alias, ())
    start = 0
    while True:
        pos = lower.find(alias, start)
        if pos == -1:
            return -1
        rest = lower[pos + len(alias):]
        if not any(rest.startswith(b) for b in blocked):
            return pos
        start = pos + 1


def detect_district(text: str) -> dict:
    """Tag the town whose alias appears EARLIEST in the article text — a
    multi-town article (e.g. an event in Jagdalpur, opposition reaction quoted
    from Raipur) should map to whichever place the story is actually about,
    not whichever happens to be declared first in LOCATION_KEYWORDS. The town's
    district and coordinates come from LOCATION_META."""
    lower = text.lower()
    best_town = None
    best_pos = None
    for town, aliases in LOCATION_KEYWORDS.items():
        for alias in aliases:
            pos = _alias_position(lower, alias)
            if pos != -1 and (best_pos is None or pos < best_pos):
                best_pos = pos
                best_town = town
    if best_town:
        district, lat, lng = LOCATION_META.get(best_town, ('', None, None))
        return {
            'location_found': True,
            'district': district,
            'city': best_town,
            'state': STATE_NAME,
            'lat': lat if lat is not None else STATE_LAT,
            'lng': lng if lng is not None else STATE_LNG,
        }
    return {'location_found': False, 'district': '', 'city': '', 'state': 'India', 'lat': None, 'lng': None}


# ── Image extraction ──────────────────────────────────────────────────────────

def extract_image(entry) -> Optional[str]:
    """Try every known RSS/Atom image field in priority order."""
    def _valid(url):
        return bool(url and isinstance(url, str) and url.startswith('http')
                    and not url.endswith('.gif'))

    for thumb in getattr(entry, 'media_thumbnail', []):
        if _valid(thumb.get('url', '')):
            return thumb['url']

    for mc in getattr(entry, 'media_content', []):
        url    = mc.get('url', '')
        medium = mc.get('medium', '')
        mtype  = mc.get('type', '')
        if _valid(url) and ('image' in medium or 'image' in mtype or medium == ''):
            return url

    for enc in getattr(entry, 'enclosures', []):
        if enc.get('type', '').startswith('image/') and _valid(enc.get('href', '')):
            return enc['href']

    for link in getattr(entry, 'links', []):
        lt = link.get('type', '')
        if lt.startswith('image/') and _valid(link.get('href', '')):
            return link['href']

    for html_src in [
        (entry.content[0].get('value', '') if getattr(entry, 'content', None) else ''),
        getattr(entry, 'summary_detail', {}).get('value', ''),
        getattr(entry, 'summary', '') or '',
    ]:
        if not html_src:
            continue
        m = re.search(r'<img[^>]+src=["\']?([^"\'>\s]+)["\']?', html_src, re.IGNORECASE)
        if m and _valid(m.group(1)):
            return m.group(1)

    return None


# ── Summary extraction ────────────────────────────────────────────────────────

def extract_summary(entry) -> str:
    """Prefer content:encoded (full HTML) over description (snippet)."""
    content_encoded = ''
    if hasattr(entry, 'content') and entry.content:
        content_encoded = entry.content[0].get('value', '')

    description = getattr(entry, 'summary', '') or ''
    raw_html = content_encoded if len(content_encoded) > len(description) else description

    if raw_html:
        soup = BeautifulSoup(raw_html, 'html.parser')
        text = soup.get_text(separator=' ', strip=True)
        return re.sub(r'\s+', ' ', text).strip()

    return ''


# ── Article page fetcher ──────────────────────────────────────────────────────

_CONTENT_SELECTORS = [
    'div[itemprop="articleBody"] p',
    'article p',
    'div[class*="article-body"] p',
    'div[class*="articleBody"] p',
    'div[class*="story-content"] p',
    'div[class*="storyContent"] p',
    'div[class*="story_content"] p',
    'div[class*="content-area"] p',
    'div[class*="article-content"] p',
    'div[class*="article_content"] p',
    'div[class*="post-content"] p',
    'div.artText p',
    'div.storytxt p',
    'div.storyDetails p',
    'section[class*="article"] p',
    '.story-body p',
    '.article p',
    'main article p',
    'main p',
]

_NOISE_KEYWORDS = [
    'subscribe', 'follow us', 'advertisement', 'also read',
    'read more', 'click here', 'download app', 'all rights reserved',
    'copyright', 'share this', 'whatsapp', 'facebook', 'twitter',
]


def fetch_article_page(url: str) -> dict:
    """Fetch article page and return image, og:description, and full body content."""
    if not url or 'news.google.com' in url:
        return {'image': None, 'description': None, 'content': ''}

    headers = {
        **HEADERS,
        'Referer': 'https://www.google.com/',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IN,en;q=0.9,mr;q=0.8,kok;q=0.8,hi;q=0.7',
    }
    try:
        resp = requests.get(url, headers=headers, timeout=8, allow_redirects=True)
        if resp.status_code != 200:
            return {'image': None, 'description': None, 'content': ''}

        # Parse from raw bytes (not resp.text) so BeautifulSoup's own
        # UnicodeDammit sniffs the page's declared <meta charset>/BOM first —
        # that's what real HTML pages actually carry. requests' apparent_encoding
        # (chardet byte-frequency guessing) has no visibility into that
        # declaration and can misdetect non-Latin text as an unrelated legacy
        # codepage (e.g. Indic UTF-8 guessed as Mac OS Roman), corrupting
        # summary/content while leaving the RSS-sourced title untouched.
        soup = BeautifulSoup(resp.content, 'html.parser')

        for tag in soup.select(
            'script, style, nav, header, footer, aside, '
            '[class*="related"], [class*="social"], [class*="share"], '
            '[class*="ad"], [class*="newsletter"], [class*="subscribe"]'
        ):
            tag.decompose()

        def meta(prop, name=None):
            tag = soup.find('meta', property=prop) or (
                soup.find('meta', attrs={'name': name}) if name else None
            )
            return tag['content'].strip() if tag and tag.get('content') else None

        image = (
            meta('og:image') or meta('og:image:secure_url')
            or meta('twitter:image', 'twitter:image')
            or meta('twitter:image:src', 'twitter:image:src')
        )
        if not image:
            for img in soup.find_all('img', src=True):
                src = img['src']
                if src.startswith('http') and not src.endswith('.gif'):
                    try:
                        if int(str(img.get('width', '0')).replace('px', '') or 0) >= 200:
                            image = src
                            break
                    except ValueError:
                        pass

        desc = meta('og:description') or meta('description', 'description')

        content = ''
        for selector in _CONTENT_SELECTORS:
            tags = soup.select(selector)
            if not tags:
                continue
            paragraphs = []
            for t in tags:
                text = t.get_text(separator=' ', strip=True)
                text = re.sub(r'\s+', ' ', text).strip()
                if len(text) < 40:
                    continue
                if any(kw in text.lower() for kw in _NOISE_KEYWORDS):
                    continue
                paragraphs.append(text)
            if paragraphs:
                content = '\n\n'.join(paragraphs)
                if len(content) > 200:
                    break

        return {
            'image': image if image and image.startswith('http') else None,
            'description': desc if desc else None,
            'content': content,
        }
    except Exception:
        return {'image': None, 'description': None, 'content': ''}


# ── Cohere: generate English title + summary ──────────────────────────────────

def generate_english(title: str, summary: str, language: str) -> Tuple[str, str]:
    """Returns (english_title, english_summary). Falls back to originals on error."""
    if not _cohere_client:
        return title, summary

    lang_label = {'hi': 'Hindi', 'hne': 'Chhattisgarhi'}.get(language, 'English')
    prompt = (
        f"The following is a news article in {lang_label} about Indian politics.\n\n"
        f"Title: {title}\n"
        f"Summary: {summary}\n\n"
        "Please:\n"
        "1. Translate and rewrite the title in clear English (max 15 words).\n"
        "2. Write a 2-3 sentence English summary of the article.\n\n"
        "Output format (exactly):\n"
        "Title: <english title>\n"
        "Summary: <english summary>"
    )
    try:
        resp = _cohere_client.chat(
            messages=[{'role': 'user', 'content': prompt}],
            model='command-r-plus-08-2024',
        )
        if resp and resp.finish_reason == 'COMPLETE':
            text = resp.message.content[0].text.strip()
            match = re.search(r'(?i)Title:\s*(.*?)\nSummary:\s*(.*)', text, re.DOTALL)
            if match:
                return match.group(1).strip(), match.group(2).strip()
    except Exception as e:
        print(f"[WARN] Cohere error: {e}")

    return title, summary


# ── Sentiment detection ─────────────────────────────────────────────────────────
# Same three-bucket scheme the Mentions/Alerts pipeline uses: positive /
# negative / moderate. Cohere classifies when available; a keyword heuristic is
# the offline fallback so every article still gets a label.
_POSITIVE_HINTS = [
    'welfare', 'launch', 'inaugurat', 'development', 'growth', 'wins', ' win ', 'success',
    'boost', 'approve', 'sanction', 'grant', 'relief', 'benefit', 'praise', 'achievement',
    'progress', 'investment', 'jobs', 'scheme',
    'विकास', 'कल्याण', 'उद्घाटन', 'लोकार्पण', 'शिलान्यास', 'विजय', 'सराहना', 'योजना', 'सौगात',
]
_NEGATIVE_HINTS = [
    'scam', 'corruption', 'protest', 'arrest', 'attack', 'murder', 'death', 'crime', 'fraud',
    'crisis', 'fail', 'slam', 'blast', 'oppose', 'clash', 'violence', 'controversy',
    'allegation', ' row ', 'loss', 'accident', 'assault', 'illegal', 'scandal',
    'भ्रष्टाचार', 'विरोध', 'हत्या', 'हमला', 'घोटाला', 'आरोप', 'विवाद', 'प्रदर्शन', 'गिरफ्तार',
]


# Parties and leaders: when a story is about one of them, keyword tone says
# nothing about WHO benefits ("Congress MLA arrested" is good news for the
# client), so the offline fallback stays 'neutral' rather than guess.
_POLITICAL_ACTOR_HINTS = (
    'bjp', 'congress', 'inc ', 'aap', 'bsp', 'gondwana', 'jcc', 'janta congress',
    'vishnu deo sai', 'cm sai', 'arun sao', 'vijay sharma', 'raman singh', 'kiran singh deo',
    'baghel', 'mahant', 'baij', 'singh deo', 'lakhma', 'jogi', 'minister', 'mla', ' mp ',
    'भाजपा', 'बीजेपी', 'कांग्रेस', 'काँग्रेस', 'मुख्यमंत्री', 'विधायक', 'मंत्री', 'सांसद',
)


def _heuristic_sentiment(text: str) -> str:
    low = f" {text.lower()} "
    if any(h in low for h in _POLITICAL_ACTOR_HINTS):
        return 'neutral'
    pos = sum(1 for w in _POSITIVE_HINTS if w in low)
    neg = sum(1 for w in _NEGATIVE_HINTS if w in low)
    if neg > pos:
        return 'negative'
    if pos > neg:
        return 'positive'
    return 'neutral'


# 'neutral' is canonical (no positive/negative substance -- no risk). The LLM
# prompt still asks for 'moderate' since that's the word most models answer
# reliably to for a middle option; it is normalized to 'neutral' below.
_ALLOWED_SENTIMENTS = ('positive', 'negative', 'neutral')
# Empirically tuned via Blura-Engine/test_sentiment_timing.py against 50 real
# articles: at a 20000-char cap, qwen2.5:7b (self-hosted Ollama) returned
# unparseable/hallucinated output for 38% of longer articles (it doesn't just
# truncate — it goes off-schema entirely, e.g. inventing unrelated content in
# a different language). At 2500 chars the failure rate dropped to 6% and it
# ran faster. Full result sets: Blura-Engine/timing_results/sentiment_timing_
# 20260804_{190018_cap20000,192054_cap2500}_n50.json.
#
# NOTE: this was tuned against Ollama specifically. detect_sentiment() below
# uses Cohere's command-r-plus when COHERE_API_KEY is configured — a larger,
# more capable model that was never tested against this failure mode and may
# tolerate much longer input fine. Worth re-testing (raising this cap) once
# Cohere is active rather than assuming this number transfers.
_CONTENT_SAFETY_CAP_CHARS = 2500

# Entity-aware, party-relative prompt: the model must decide WHO benefits
# politically, not just whether the wording sounds positive or negative.
# Mirrors backend/src/services/politicalSentimentService.js (the social-media
# pipeline's proven pattern) — same ally/opposition map, same "generic bad
# news with no political target stays moderate" guardrail, same JSON output
# instead of a bare word so parsing can't misread a hedged answer.
_SENTIMENT_PROMPT_TEMPLATE = """You are a political-intelligence analyst for the office of Chhattisgarh Chief Minister Vishnu Deo Sai and the BJP Chhattisgarh leadership (state president Kiran Singh Deo). The BJP state government, its ministers and its MLAs are treated as part of the same camp.

Political map:
  ALLY camp:       Vishnu Deo Sai, Deputy CMs Arun Sao and Vijay Sharma, BJP Chhattisgarh and its ministers/MLAs/MPs (e.g. OP Choudhary, Kedar Kashyap, Speaker Dr. Raman Singh, Brijmohan Agrawal), and the national BJP (Narendra Modi, Amit Shah)
  OPPOSITION camp: Congress (Leader of Opposition Dr. Charan Das Mahant, PCC president Deepak Baij, former CM Bhupesh Baghel, T. S. Singh Deo, Kawasi Lakhma, Korba MP Jyotsna Mahant), Gondwana Gantantra Party (Tuleshwar Markam), Janta Congress Chhattisgarh (J) (Amit Jogi), AAP, BSP, and other rival blocs
  NEUTRAL:         Police and security forces, courts (incl. the High Court of Chhattisgarh at Bilaspur), the Governor, ECI, central agencies acting on court orders, civic bodies -- not a political actor

The article may be in Hindi, English or Chhattisgarhi.

Read the ENTIRE article below, not just the headline.

Step 1 -- Identify every political actor the article actually covers.
Step 2 -- For each actor, is the article PRAISING, CRITICIZING, REPORTING A FACT ABOUT, or QUOTING them? Quotes, denials, and allegations attributed to a speaker are NOT the same as the journalist's own claim -- judge them separately.
Step 3 -- Determine who politically BENEFITS from this article overall. If several parties are mentioned, decide the DOMINANT beneficiary -- don't let one actor's tone leak onto another's.
Step 4 -- Distinguish "government" from "party": praise/criticism of the Chhattisgarh state government counts for BJP Chhattisgarh; Union (national) government coverage counts for the national BJP, not automatically for BJP Chhattisgarh, unless the article ties it to Chhattisgarh or the Sai government directly. Cases about the previous Congress government (2018-2023) -- the liquor, coal-levy, Mahadev-app, DMF or PSC scams -- damage the opposition, not the current government.
Step 5 -- Classify:
    positive -- benefits our party/leaders/government, OR credibly damages the opposition (corruption, failures, defections to us, poor survey/election results for them)
    negative -- benefits the opposition, OR damages our party/leaders/government (criticism, corruption allegations against us, protests against our government, defections from us, poor results for us)
    moderate -- ambiguous, balanced, only mildly favorable, routine administrative reporting, or no clear political beneficiary (e.g. a plain crime/accident story with no party angle)

Guardrail: generic bad news (crime, accidents, natural disasters) with NO political actor clearly responsible must be "neutral" (return "moderate" for this field), never "negative" -- do not let emotional language alone decide the label. A security-force operation against Naxals is not by itself bad news for the government.

Output strict JSON only, no prose around it:
{{"dominant_actor": "<party/leader most central to the article, or 'none'>", "actor_alignment": "ally | opposition | neutral | none", "reasoning": "<1-2 sentences: what happens in the article and why that helps or hurts which side>", "sentiment": "positive | negative | moderate"}}

Headline: {title}
Summary: {summary}
Full article: {content}"""


def _extract_json(text: str) -> Optional[dict]:
    """Tolerant JSON extraction — the model is asked for strict JSON but may still wrap it in prose."""
    try:
        return json.loads(text)
    except Exception:
        pass
    m = re.search(r'\{[\s\S]*\}', text)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            return None
    return None


def detect_sentiment(title: str, summary: str, content: str = '') -> dict:
    """Return {'sentiment', 'dominant_actor', 'actor_alignment', 'reasoning'}
    for a news article, judged relative to BJP Chhattisgarh (ally) vs the opposition
    — not generic tone. Uses the article body (up to _CONTENT_SAFETY_CAP_CHARS)
    when available, not just the headline/summary — see that constant's
    comment for why it's capped rather than sending the truly full article.
    The extra fields were already being computed by the model (and paid for
    in output tokens) — we now keep them instead of discarding everything but
    the sentiment word."""
    text = f"{title}. {summary}".strip()
    empty = {'sentiment': 'neutral', 'dominant_actor': '', 'actor_alignment': '', 'reasoning': ''}
    if not text:
        return empty

    if _cohere_client:
        prompt = _SENTIMENT_PROMPT_TEMPLATE.format(
            title=title or '(no headline)',
            summary=summary or '(no summary)',
            content=(content or '(no article body available)')[:_CONTENT_SAFETY_CAP_CHARS],
        )
        try:
            resp = _cohere_client.chat(
                messages=[{'role': 'user', 'content': prompt}],
                model='command-r-plus-08-2024',
                temperature=0.1,   # low temperature: repeatable classification, not creative writing
                max_tokens=350,    # bounds output latency; our JSON schema fits comfortably under this
            )
            if resp and resp.finish_reason == 'COMPLETE':
                raw = resp.message.content[0].text.strip()
                parsed = _extract_json(raw) or {}
                sentiment = str(parsed.get('sentiment', '')).strip().lower()
                # 'moderate' is the word the prompt asks for; normalize to
                # canonical 'neutral' (matches the Node pipeline's sentiment
                # label -- see backend/src/services/analysisService.js).
                if sentiment == 'moderate':
                    sentiment = 'neutral'
                if sentiment in _ALLOWED_SENTIMENTS:
                    return {
                        'sentiment': sentiment,
                        'dominant_actor': str(parsed.get('dominant_actor') or ''),
                        'actor_alignment': str(parsed.get('actor_alignment') or ''),
                        'reasoning': str(parsed.get('reasoning') or ''),
                    }
                print(f"[WARN] Cohere sentiment: unparseable response, using heuristic fallback: {raw[:120]}")
        except Exception as e:
            print(f"[WARN] Cohere sentiment error: {e}")

    return {
        **empty,
        'sentiment': _heuristic_sentiment(text),
        'reasoning': 'heuristic fallback (LLM unavailable or response unusable)',
    }


# ── Google News URL resolver ──────────────────────────────────────────────────

def resolve_google_news_url(url: str) -> str:
    """Decode a Google News RSS link to the real article URL.

    Modern Google News links (/rss/articles/CBMi...) are not plain HTTP
    redirects — the real URL is obtained via Google's batchexecute endpoint,
    using a signature + timestamp embedded in the article page. Returns '' if
    it can't be decoded (caller then keeps the Google News link, headline-only).
    """
    try:
        # Cheap path first: an old-style HTTP redirect, if any.
        resp = requests.get(url, headers=HEADERS, timeout=10, allow_redirects=True)
        # requests falls back to ISO-8859-1 for text/* responses that omit a
        # charset (RFC 2616), which turns UTF-8 pages into mojibake. Match what
        # fetch_article_page already does.
        resp.encoding = resp.apparent_encoding or 'utf-8'
        if 'news.google.com' not in resp.url:
            return resp.url

        gn_id = urlparse(url).path.rstrip('/').split('/')[-1].split('?')[0]
        if not gn_id:
            return ''

        soup = BeautifulSoup(resp.text, 'html.parser')
        div = soup.select_one('c-wiz > div')
        if not div:
            return ''
        sig = div.get('data-n-a-sg')
        ts = div.get('data-n-a-ts')
        if not (sig and ts):
            return ''

        inner = json.dumps([
            'garturlreq',
            [['X', 'X', ['X', 'X'], None, None, 1, 1, 'US:en', None, 1, None, None, None, None, None, 0, 1],
             'X', 'X', 1, [1, 1, 1], 1, 1, None, 0, 0, None, 0],
            gn_id, ts, sig,
        ])
        payload = [['Fbv4je', inner]]
        r2 = requests.post(
            'https://news.google.com/_/DotsSplashUi/data/batchexecute',
            headers={'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
            data={'f.req': json.dumps([payload])},
            timeout=12,
        )
        for m in re.finditer(r'(https?://[^\s"\\]+)', r2.text):
            u = m.group(1)
            if 'google.com' not in u and 'gstatic.com' not in u:
                return u
    except Exception as e:
        print(f"[WARN] gnews decode error: {e}")
    return ''


# ── URL validation ────────────────────────────────────────────────────────────

def is_article_url(url: str) -> bool:
    if not url:
        return False
    if 'news.google.com' in url:
        return False
    parsed = urlparse(url)
    if parsed.netloc.replace('www.', '') in SKIP_DOMAINS:
        return False
    path = parsed.path.rstrip('/')
    if _SKIP_PATTERNS.search(path):
        return False
    segments = [s for s in path.split('/') if s]
    if not segments:
        return False
    last = segments[-1]
    if len(segments) == 1:
        # A single segment is an article only when it looks like a headline slug.
        return len(last) >= 20 and last.count('-') >= 3
    if len(last) < 8 and not re.search(r'\d', last):
        return False
    return True


# ── Main per-feed processor ───────────────────────────────────────────────────

def process_feed(feed_cfg: dict) -> int:
    url             = feed_cfg['url']
    source_name     = feed_cfg['source_name']
    hint_lang       = feed_cfg.get('language', 'en')
    follow_redirect = feed_cfg.get('follow_redirect', False)

    print(f"\n[RSS] Fetching: {source_name} ({url})")

    try:
        resp = requests.get(url, headers=HEADERS, timeout=15)
        resp.raise_for_status()
        parsed = feedparser.parse(resp.content)
    except Exception as e:
        print(f"[ERR] feedparser failed for {url}: {e}")
        return 0

    if parsed.bozo and not parsed.entries:
        print(f"[SKIP] Bad feed ({parsed.bozo_exception}): {url}")
        return 0

    feed_domain = urlparse(url).netloc.replace('www.', '')
    inserted    = 0
    cutoff      = datetime.now(timezone.utc) - timedelta(days=MAX_ARTICLE_AGE_DAYS)
    state_only    = feed_cfg.get('state_only', False)

    entries = sorted(
        parsed.entries,
        key=lambda x: x.get('published_parsed') or x.get('updated_parsed') or time.gmtime(0),
        reverse=False,
    )

    for entry in entries:
        try:
            article_url = getattr(entry, 'link', '') or ''
            is_gnews = 'news.google.com' in article_url

            # Real (non-Google-News) URLs must look like article pages. Google
            # News links are resolved later — only for NEW, relevant articles —
            # since decoding costs two extra requests each.
            if not is_gnews and not is_article_url(article_url):
                continue

            pub_date = None
            if hasattr(entry, 'published_parsed') and entry.published_parsed:
                pub_date = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
            elif hasattr(entry, 'updated_parsed') and entry.updated_parsed:
                pub_date = datetime(*entry.updated_parsed[:6], tzinfo=timezone.utc)

            if pub_date and pub_date < cutoff:
                continue

            title   = (getattr(entry, 'title', '') or '').strip()
            summary = extract_summary(entry)

            if not title:
                continue

            # Google News titles end with " - Outlet". Pull the real outlet out
            # (so "coverage by outlet" shows Navhind Times / Herald / Tarun Bharat …) and clean
            # the headline. Falls back to the feed's own name.
            article_source_name = source_name
            if is_gnews and ' - ' in title:
                head, tail = title.rsplit(' - ', 1)
                if head and 0 < len(tail) <= 40:
                    article_source_name = tail.strip()
                    title = head.strip()

            full_text = f"{title} {summary}"

            # The feed's language is only a hint: Hindi-edition Google News
            # also surfaces Chhattisgarhi and English pieces. Detect from the
            # text, and let the hint break ties for ambiguous Devanagari.
            deva_hint = hint_lang if hint_lang in ('hi', 'hne') else 'hi'
            lang = detect_language(full_text, devanagari_default=deva_hint)
            if hint_lang != 'en' and lang == 'en' and len(title) <= 20:
                lang = hint_lang

            if len(title) > 160:
                continue

            relevance_score, keywords_matched = get_relevance_score(full_text)
            location = detect_district(full_text)
            # Chhattisgarh-only outlets and stories that name a Chhattisgarh town are relevant
            # even when no party or leader keyword appears.
            if relevance_score < 1 and not state_only and not location.get('location_found'):
                continue

            # Skip already-seen articles BEFORE the costly page fetch below — this
            # is the main speed-up, so a duplicate never costs an ~8s article
            # fetch (previously the dedup check ran only after fetching).
            col_news = get_db()['newsarticles']
            if col_news.find_one({'title': title}):
                continue

            # Now (only for a new, relevant article) decode the Google News
            # redirect to the real article URL, so we can scrape its content +
            # image below. If decoding fails we keep the Google News link.
            if follow_redirect and is_gnews:
                resolved = resolve_google_news_url(article_url)
                if resolved:
                    article_url = resolved
                    is_gnews = False

            # Google News sometimes surfaces social posts (Instagram/YouTube/X) —
            # skip those, they aren't news articles and have no scrapeable content.
            _SOCIAL = ('instagram.com', 'facebook.com', 'twitter.com', '://x.com',
                       'youtube.com', 'youtu.be', 'threads.net')
            if not is_gnews and any(s in article_url for s in _SOCIAL):
                continue

            image_url = extract_image(entry)

            if is_gnews:
                # Couldn't decode — keep RSS image/summary as-is. source_domain
                # left blank so the backend's news.google.com exclusion doesn't
                # hide the article.
                full_content = ''
                source_domain = ''
            else:
                page = fetch_article_page(article_url)
                if not image_url and page['image']:
                    image_url = page['image']
                if len(summary) < 80 and page['description']:
                    summary = page['description']
                full_content = page['content']
                source_domain = (
                    urlparse(article_url).netloc.replace('www.', '')
                    if follow_redirect else feed_domain
                )

            if not image_url:
                image_url = DEFAULT_IMAGE_URL

            category = detect_category(full_text)
            # District-specific feeds carry their own canonical district — use it
            # as a fallback when the article text alone didn't reveal a district,
            # so the piece still maps onto that district's constituencies.
            feed_district = feed_cfg.get('district')
            if feed_district and not location.get('location_found'):
                location = {
                    'location_found': True,
                    'district': feed_district,
                    'city': '',
                    'state': STATE_NAME,
                    'lat': None,
                    'lng': None,
                }
            elif state_only and not location.get('location_found'):
                location = {**location, 'state': STATE_NAME}

            title_english   = title
            summary_english = summary
            is_translated   = False

            if lang in ('hi', 'hne'):
                new_title, new_summary = generate_english(title, summary, lang)
                # generate_english() is a silent no-op when Cohere isn't
                # configured (returns the inputs unchanged) — only flag
                # is_translated when the text actually changed, so the field
                # reflects what really happened instead of always claiming
                # success.
                if new_title != title or new_summary != summary:
                    title_english, summary_english = new_title, new_summary
                    is_translated = True

            check_title = title_english if is_translated else title
            if check_title.lower().startswith(('here is a', 'sure,', 'error generating', 'no title')):
                print(f"[SKIP] Invalid AI title: {check_title[:60]}")
                continue

            # Sentiment on the English text, judged relative to our party using
            # the article body (capped — see _CONTENT_SAFETY_CAP_CHARS) — returns
            # sentiment plus who it's about, so that context isn't thrown away
            # after the model already paid to compute it.
            sentiment_result = detect_sentiment(title_english, summary_english, full_content)
            sentiment = sentiment_result['sentiment']

            doc = {
                'title':           title,
                'title_english':   title_english,
                'summary':         summary,
                'summary_english': summary_english,
                'content':         full_content,
                'source_url':      article_url,
                'source_name':     article_source_name,
                'source_domain':   source_domain,
                'image_url':       image_url,
                'published_date':  pub_date or datetime.utcnow(),
                'scraped_at':      datetime.utcnow(),
                'language':        lang,
                'category':        category,
                'sentiment':       sentiment,
                'sentiment_target':           sentiment_result['dominant_actor'],
                'sentiment_target_alignment': sentiment_result['actor_alignment'],
                'sentiment_reasoning':        sentiment_result['reasoning'],
                'source_type':     'rss',
                'relevance_score': relevance_score,
                'keywords_matched': keywords_matched[:20],
                'is_translated':   is_translated,
                'detected_location': location,
            }

            if upsert_article(doc):
                inserted += 1

        except Exception as e:
            logging.error(f"Error processing entry from {url}: {e}", exc_info=True)
            continue

    print(f"[RSS] {source_name}: {inserted} new articles inserted")
    return inserted


# ── Run all feeds ─────────────────────────────────────────────────────────────

def run_all_feeds() -> int:
    reset_keyword_cache()
    total = 0
    for feed_cfg in RSS_FEEDS:
        total += process_feed(feed_cfg)
        time.sleep(1)
    print(f"\n[DONE] Total inserted this run: {total}")
    return total


if __name__ == '__main__':
    run_all_feeds()
