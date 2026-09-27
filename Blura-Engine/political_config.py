"""
Political Saga configuration for Chhattisgarh — Blura Engine.
RSS feeds, keywords, category rules — covering Indian national politics,
Chhattisgarh state politics (BJP government of CM Vishnu Deo Sai; INC, GGP,
JCC(J), AAP and BSP in opposition), and district/town-level news.

Chhattisgarh's press is Hindi first, with some English. Every feed below
returned XML with items on 2026-09-26. No Chhattisgarhi RSS feed
exists, and Google News has no Chhattisgarhi edition (hl=hne redirects to
Hindi), so Devanagari coverage comes from the Hindi press and Hindi-edition
Google News queries; Chhattisgarhi mostly reaches the app through YouTube,
Facebook and X instead.
"""

from urllib.parse import quote_plus

_GN_EN = "https://news.google.com/rss/search?q={q}&hl=en-IN&gl=IN&ceid=IN:en"
_GN_HI = "https://news.google.com/rss/search?q={q}&hl=hi&gl=IN&ceid=IN:hi"


def _gn(template, query, source_name, language):
    return {
        "url": template.format(q=quote_plus(query)),
        "source_name": source_name,
        "language": language,
        "follow_redirect": True,
    }


# ── RSS Feeds ──────────────────────────────────────────────────────────────────
# "state_only": True marks outlets whose feed carries only Chhattisgarh news.
# Their items skip the keyword relevance gate (a local story rarely names a
# party or leader).
RSS_FEEDS = [

    # ── Chhattisgarh state sections (Hindi / English press) ──────────
    {"url": "https://www.ibc24.in/chhattisgarh/feed", "source_name": "IBC24 – Chhattisgarh", "language": "hi", "state_only": True},
    {"url": "https://www.haribhoomi.com/state-local/chhattishgarh/feed", "source_name": "Haribhoomi – Chhattisgarh", "language": "hi", "state_only": True},
    {"url": "https://www.bhaskar.com/rss-v1--category-1741.xml", "source_name": "Dainik Bhaskar – Chhattisgarh", "language": "hi", "state_only": True},
    {"url": "https://cms.patrika.com/googlefeed/blog/location/chhattisgarh-news", "source_name": "Patrika – Chhattisgarh", "language": "hi", "state_only": True},
    {"url": "https://cms.patrika.com/googlefeed/blog/location/raipur-news", "source_name": "Patrika – Raipur", "language": "hi", "state_only": True},
    {"url": "https://lalluram.com/chhattisgarh-news/feed/", "source_name": "Lalluram – Chhattisgarh", "language": "hi", "state_only": True},
    {"url": "https://grandnews.in/category/chhattisgarh/feed/", "source_name": "Grand News – Chhattisgarh", "language": "hi", "state_only": True},
    {"url": "https://npg.news/chhattisgarh/feed", "source_name": "NPG News – Chhattisgarh", "language": "hi", "state_only": True},
    {"url": "https://hindi.news18.com/rss/khabar/chhattisgarh/chhattisgarh.xml", "source_name": "News18 Hindi – Chhattisgarh", "language": "hi", "state_only": True},
    {"url": "https://www.amarujala.com/rss/chhattisgarh.xml", "source_name": "Amar Ujala – Chhattisgarh", "language": "hi", "state_only": True},
    {"url": "https://www.thehindu.com/news/national/chhattisgarh/feeder/default.rss", "source_name": "The Hindu – Chhattisgarh", "language": "en", "state_only": True},

    # ── Site-wide and national feeds (Chhattisgarh stories are kept by the relevance filter) ──
    {"url": "https://npg.news/feed", "source_name": "NPG News", "language": "hi"},
    {"url": "https://bansalnews.com/category/chhattisgarh/feed/", "source_name": "Bansal News – Chhattisgarh", "language": "hi"},
    {"url": "https://www.ibc24.in/feed", "source_name": "IBC24", "language": "hi"},
    {"url": "https://lalluram.com/feed/", "source_name": "Lalluram", "language": "hi"},
    {"url": "https://www.deshbandhu.co.in/feed", "source_name": "Deshbandhu", "language": "hi"},
    {"url": "https://cgwall.com/feed/", "source_name": "CGWALL", "language": "hi"},
    {"url": "https://feeds.feedburner.com/ndtvnews-india-news", "source_name": "NDTV India", "language": "en"},
    {"url": "https://timesofindia.indiatimes.com/rssfeedstopstories.cms", "source_name": "Times of India Top Stories", "language": "en"},
    {"url": "https://www.thehindu.com/news/national/feeder/default.rss", "source_name": "The Hindu National", "language": "en"},
    {"url": "https://www.hindustantimes.com/feeds/rss/india-news/rssfeed.xml", "source_name": "Hindustan Times India", "language": "en"},

    # ── Google News — English ──────────────────────────────────────
    {"url": "https://news.google.com/rss/search?q=Chhattisgarh+politics&hl=en-IN&gl=IN&ceid=IN:en", "source_name": "Google News – Chhattisgarh Politics", "language": "en", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=Vishnu+Deo+Sai&hl=en-IN&gl=IN&ceid=IN:en", "source_name": "Google News – Vishnu Deo Sai", "language": "en", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=BJP+Chhattisgarh&hl=en-IN&gl=IN&ceid=IN:en", "source_name": "Google News – BJP Chhattisgarh", "language": "en", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=Chhattisgarh+Congress&hl=en-IN&gl=IN&ceid=IN:en", "source_name": "Google News – Chhattisgarh Congress", "language": "en", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=Bhupesh+Baghel&hl=en-IN&gl=IN&ceid=IN:en", "source_name": "Google News – Bhupesh Baghel", "language": "en", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=Deepak+Baij&hl=en-IN&gl=IN&ceid=IN:en", "source_name": "Google News – Deepak Baij", "language": "en", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=Chhattisgarh+assembly&hl=en-IN&gl=IN&ceid=IN:en", "source_name": "Google News – Chhattisgarh Assembly", "language": "en", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=Chhattisgarh+government&hl=en-IN&gl=IN&ceid=IN:en", "source_name": "Google News – Chhattisgarh Government", "language": "en", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=Bastar+Naxal&hl=en-IN&gl=IN&ceid=IN:en", "source_name": "Google News – Bastar Naxal", "language": "en", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=Chhattisgarh+paddy+procurement&hl=en-IN&gl=IN&ceid=IN:en", "source_name": "Google News – Paddy Procurement", "language": "en", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=Hasdeo&hl=en-IN&gl=IN&ceid=IN:en", "source_name": "Google News – Hasdeo", "language": "en", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=Chhattisgarh+liquor+scam+OR+coal+levy+scam+OR+Mahadev+app&hl=en-IN&gl=IN&ceid=IN:en", "source_name": "Google News – CG Scams (ED/EOW)", "language": "en", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=Raipur+Chhattisgarh&hl=en-IN&gl=IN&ceid=IN:en", "source_name": "Google News – Raipur", "language": "en", "follow_redirect": True},

    # ── Google News — Hindi ────────────────────────────────────────
    {"url": "https://news.google.com/rss/search?q=%E0%A4%9B%E0%A4%A4%E0%A5%8D%E0%A4%A4%E0%A5%80%E0%A4%B8%E0%A4%97%E0%A4%A2%E0%A4%BC+%E0%A4%B0%E0%A4%BE%E0%A4%9C%E0%A4%A8%E0%A5%80%E0%A4%A4%E0%A4%BF&hl=hi&gl=IN&ceid=IN:hi", "source_name": "Google News (hi) – Chhattisgarh Politics", "language": "hi", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=%E0%A4%B5%E0%A4%BF%E0%A4%B7%E0%A5%8D%E0%A4%A3%E0%A5%81+%E0%A4%A6%E0%A5%87%E0%A4%B5+%E0%A4%B8%E0%A4%BE%E0%A4%AF&hl=hi&gl=IN&ceid=IN:hi", "source_name": "Google News (hi) – Vishnu Deo Sai", "language": "hi", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=%E0%A4%B8%E0%A4%BE%E0%A4%AF+%E0%A4%B8%E0%A4%B0%E0%A4%95%E0%A4%BE%E0%A4%B0&hl=hi&gl=IN&ceid=IN:hi", "source_name": "Google News (hi) – Sai Sarkar", "language": "hi", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=%E0%A4%9B%E0%A4%A4%E0%A5%8D%E0%A4%A4%E0%A5%80%E0%A4%B8%E0%A4%97%E0%A4%A2%E0%A4%BC+%E0%A4%AD%E0%A4%BE%E0%A4%9C%E0%A4%AA%E0%A4%BE&hl=hi&gl=IN&ceid=IN:hi", "source_name": "Google News (hi) – BJP Chhattisgarh", "language": "hi", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=%E0%A4%9B%E0%A4%A4%E0%A5%8D%E0%A4%A4%E0%A5%80%E0%A4%B8%E0%A4%97%E0%A4%A2%E0%A4%BC+%E0%A4%95%E0%A4%BE%E0%A4%82%E0%A4%97%E0%A5%8D%E0%A4%B0%E0%A5%87%E0%A4%B8&hl=hi&gl=IN&ceid=IN:hi", "source_name": "Google News (hi) – Chhattisgarh Congress", "language": "hi", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=%E0%A4%AD%E0%A5%82%E0%A4%AA%E0%A5%87%E0%A4%B6+%E0%A4%AC%E0%A4%98%E0%A5%87%E0%A4%B2&hl=hi&gl=IN&ceid=IN:hi", "source_name": "Google News (hi) – Bhupesh Baghel", "language": "hi", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=%E0%A4%A6%E0%A5%80%E0%A4%AA%E0%A4%95+%E0%A4%AC%E0%A5%88%E0%A4%9C&hl=hi&gl=IN&ceid=IN:hi", "source_name": "Google News (hi) – Deepak Baij", "language": "hi", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=%E0%A4%9A%E0%A4%B0%E0%A4%A3%E0%A4%A6%E0%A4%BE%E0%A4%B8+%E0%A4%AE%E0%A4%B9%E0%A4%82%E0%A4%A4&hl=hi&gl=IN&ceid=IN:hi", "source_name": "Google News (hi) – Charan Das Mahant", "language": "hi", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=%E0%A4%9B%E0%A4%A4%E0%A5%8D%E0%A4%A4%E0%A5%80%E0%A4%B8%E0%A4%97%E0%A4%A2%E0%A4%BC+%E0%A4%B5%E0%A4%BF%E0%A4%A7%E0%A4%BE%E0%A4%A8%E0%A4%B8%E0%A4%AD%E0%A4%BE&hl=hi&gl=IN&ceid=IN:hi", "source_name": "Google News (hi) – CG Vidhan Sabha", "language": "hi", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=%E0%A4%AE%E0%A4%B9%E0%A4%A4%E0%A4%BE%E0%A4%B0%E0%A5%80+%E0%A4%B5%E0%A4%82%E0%A4%A6%E0%A4%A8+%E0%A4%AF%E0%A5%8B%E0%A4%9C%E0%A4%A8%E0%A4%BE&hl=hi&gl=IN&ceid=IN:hi", "source_name": "Google News (hi) – Mahtari Vandan", "language": "hi", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=%E0%A4%A7%E0%A4%BE%E0%A4%A8+%E0%A4%96%E0%A4%B0%E0%A5%80%E0%A4%A6%E0%A5%80+%E0%A4%9B%E0%A4%A4%E0%A5%8D%E0%A4%A4%E0%A5%80%E0%A4%B8%E0%A4%97%E0%A4%A2%E0%A4%BC&hl=hi&gl=IN&ceid=IN:hi", "source_name": "Google News (hi) – Dhan Kharidi", "language": "hi", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=%E0%A4%AC%E0%A4%B8%E0%A5%8D%E0%A4%A4%E0%A4%B0+%E0%A4%A8%E0%A4%95%E0%A5%8D%E0%A4%B8%E0%A4%B2&hl=hi&gl=IN&ceid=IN:hi", "source_name": "Google News (hi) – Bastar Naxal", "language": "hi", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=%E0%A4%B9%E0%A4%B8%E0%A4%A6%E0%A5%87%E0%A4%B5+%E0%A4%85%E0%A4%B0%E0%A4%A3%E0%A5%8D%E0%A4%AF&hl=hi&gl=IN&ceid=IN:hi", "source_name": "Google News (hi) – Hasdeo", "language": "hi", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=%E0%A4%B6%E0%A4%B0%E0%A4%BE%E0%A4%AC+%E0%A4%98%E0%A5%8B%E0%A4%9F%E0%A4%BE%E0%A4%B2%E0%A4%BE+%E0%A4%9B%E0%A4%A4%E0%A5%8D%E0%A4%A4%E0%A5%80%E0%A4%B8%E0%A4%97%E0%A4%A2%E0%A4%BC&hl=hi&gl=IN&ceid=IN:hi", "source_name": "Google News (hi) – Liquor Scam", "language": "hi", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=%E0%A4%B5%E0%A4%BF%E0%A4%9C%E0%A4%AF+%E0%A4%B6%E0%A4%B0%E0%A5%8D%E0%A4%AE%E0%A4%BE+%E0%A4%97%E0%A5%83%E0%A4%B9%E0%A4%AE%E0%A4%82%E0%A4%A4%E0%A5%8D%E0%A4%B0%E0%A5%80&hl=hi&gl=IN&ceid=IN:hi", "source_name": "Google News (hi) – Vijay Sharma", "language": "hi", "follow_redirect": True},
    {"url": "https://news.google.com/rss/search?q=%E0%A4%85%E0%A4%B0%E0%A5%81%E0%A4%A3+%E0%A4%B8%E0%A4%BE%E0%A4%B5&hl=hi&gl=IN&ceid=IN:hi", "source_name": "Google News (hi) – Arun Sao", "language": "hi", "follow_redirect": True},
]

# ── Per-district coverage (all 33 districts) ─────────────────────────────────
# One English and one Hindi Google News query per district. The canonical
# district MUST match constituencymasters.district exactly, so the backend can
# map it to constituencies. Ambiguous names (Bilaspur, Bijapur, Balrampur,
# Raigarh) are pinned to Chhattisgarh in the query, and the negative terms drop
# car-price, air-quality and weather pages.
# (canonical district, English query, Hindi query)
DISTRICTS = [
    ("Raipur", "Raipur Chhattisgarh", "रायपुर छत्तीसगढ़"),
    ("Bilaspur", "Bilaspur Chhattisgarh", "बिलासपुर छत्तीसगढ़"),
    ("Durg", "Durg OR Bhilai Chhattisgarh", "दुर्ग OR भिलाई"),
    ("Rajnandgaon", "Rajnandgaon", "राजनांदगांव"),
    ("Korba", "Korba", "कोरबा"),
    ("Raigarh", "Raigarh Chhattisgarh", "रायगढ़ छत्तीसगढ़"),
    ("Janjgir-Champa", "Janjgir OR \"Janjgir-Champa\"", "जांजगीर"),
    ("Bastar", "Bastar OR Jagdalpur", "बस्तर OR जगदलपुर"),
    ("Dantewada", "Dantewada", "दंतेवाड़ा"),
    ("Sukma", "Sukma", "सुकमा"),
    ("Bijapur", "Bijapur Chhattisgarh", "बीजापुर छत्तीसगढ़"),
    ("Narayanpur", "Narayanpur Chhattisgarh OR Abujhmarh", "नारायणपुर OR अबूझमाड़"),
    ("Kondagaon", "Kondagaon", "कोंडागांव"),
    ("Kanker", "Kanker Chhattisgarh", "कांकेर"),
    ("Dhamtari", "Dhamtari", "धमतरी"),
    ("Mahasamund", "Mahasamund", "महासमुंद"),
    ("Gariaband", "Gariaband", "गरियाबंद"),
    ("Baloda Bazar-Bhatapara", "Balodabazar OR \"Baloda Bazar\" OR Bhatapara", "बलौदाबाजार OR भाटापारा"),
    ("Balod", "Balod Chhattisgarh", "बालोद"),
    ("Bemetara", "Bemetara", "बेमेतरा"),
    ("Kabirdham", "Kawardha OR Kabirdham", "कवर्धा OR कबीरधाम"),
    ("Mungeli", "Mungeli", "मुंगेली"),
    ("Surguja", "Surguja OR Ambikapur", "सरगुजा OR अंबिकापुर"),
    ("Surajpur", "Surajpur Chhattisgarh", "सूरजपुर छत्तीसगढ़"),
    ("Balrampur-Ramanujganj", "Balrampur Chhattisgarh OR Ramanujganj", "बलरामपुर छत्तीसगढ़ OR रामानुजगंज"),
    ("Jashpur", "Jashpur", "जशपुर"),
    ("Koriya", "Koriya Chhattisgarh OR Baikunthpur Chhattisgarh", "कोरिया छत्तीसगढ़ OR बैकुंठपुर"),
    ("Manendragarh-Chirmiri-Bharatpur", "Manendragarh OR Chirmiri", "मनेंद्रगढ़ OR चिरमिरी"),
    ("Gaurela-Pendra-Marwahi", "Gaurela OR Pendra OR Marwahi", "गौरेला OR पेंड्रा OR मरवाही"),
    ("Sakti", "\"Sakti district\" OR \"Sakti Chhattisgarh\"", "सक्ती जिला OR सक्ती छत्तीसगढ़"),
    ("Sarangarh-Bilaigarh", "Sarangarh OR Bilaigarh", "सारंगढ़ OR बिलाईगढ़"),
    ("Khairagarh-Chhuikhadan-Gandai", "Khairagarh OR Chhuikhadan", "खैरागढ़ OR छुईखदान"),
    ("Mohla-Manpur-Ambagarh Chowki", "Mohla OR Manpur Chhattisgarh OR \"Ambagarh Chowki\"", "मोहला OR मानपुर OR अंबागढ़ चौकी"),
]

_DISTRICT_NEG_EN = " -price -\"on road\" -AQI -\"air quality\" -weather"
_DISTRICT_NEG_HI = " -कीमत -प्राइस"


def _district_feeds(canonical, query_en, query_hi):
    return [
        {**_gn(_GN_EN, query_en + _DISTRICT_NEG_EN, f"CG District – {canonical}", "en"), "district": canonical},
        {**_gn(_GN_HI, query_hi + _DISTRICT_NEG_HI, f"CG District (hi) – {canonical}", "hi"), "district": canonical},
    ]


for _canonical, _en, _hi in DISTRICTS:
    RSS_FEEDS += _district_feeds(_canonical, _en, _hi)

# Fetch regional-language (Hindi) and district feeds FIRST each cycle. A single
# run can be slow, so front-loading them guarantees that coverage is collected
# even if a run doesn't get through every English national feed. Python's sort
# is stable, so order within each group is preserved.
PRIORITY_LANGUAGES = ("hi", "hne")
RSS_FEEDS.sort(key=lambda f: 0 if (f.get('language') in PRIORITY_LANGUAGES or f.get('district')) else 1)

# ── Relevance filter keywords (any 1 match = relevant) ───────────────────────
# Used only when the rsskeywords collection in MongoDB is empty — the backend
# seeds and manages that collection. Full names only: bare surnames such as
# "Sai", "Sao" or "Baghel" are shared by millions.
POLITICAL_RELEVANCE_KEYWORDS = [
    "vishnu deo sai", "vishnudeo sai", "vishnu dev sai", "cm sai", "cm vishnu", "chhattisgarh cm", "arun sao",
    "vijay sharma", "op choudhary", "o p choudhary", "o.p. choudhary", "ramvichar netam", "kedar kashyap",
    "dayaldas baghel", "lakhan lal dewangan", "shyam bihari jaiswal", "laxmi rajwade", "tank ram verma",
    "gajendra yadav", "rajesh agrawal", "guru khushwant", "raman singh", "kiran singh deo", "kiran deo",
    "brijmohan agrawal", "saroj pandey", "ramen deka", "bhupesh baghel", "deepak baij", "charan das mahant",
    "charandas mahant", "ts singh deo", "t s singh deo", "ts singhdeo", "kawasi lakhma", "chaitanya baghel",
    "sukhdev bhagat", "devendra yadav", "amarjeet bhagat", "lakheshwar baghel", "विष्णु देव साय",
    "विष्णुदेव साय", "मुख्यमंत्री साय", "सीएम साय", "अरुण साव", "विजय शर्मा", "ओपी चौधरी", "रामविचार नेताम",
    "केदार कश्यप", "लक्ष्मी राजवाड़े", "रमन सिंह", "किरण सिंहदेव", "किरण देव", "बृजमोहन अग्रवाल",
    "भूपेश बघेल", "दीपक बैज", "चरणदास महंत", "चरण दास महंत", "टीएस सिंहदेव", "कवासी लखमा", "चैतन्य बघेल",
    "bjp chhattisgarh", "chhattisgarh bjp", "chhattisgarh congress", "cg congress", "cgpcc",
    "janta congress chhattisgarh", "sai sarkar", "sai government", "vishnu ka sushasan",
    "chhattisgarh government", "chhattisgarh govt", "cg govt", "chhattisgarh assembly",
    "chhattisgarh vidhan sabha", "chhattisgarh cabinet", "chhattisgarh high court", "mantralaya",
    "mahanadi bhawan", "nava raipur", "cgpsc", "eow chhattisgarh", "acb chhattisgarh", "chhattisgarh",
    "chattisgarh", "chhatisgarh", "cg news", "साय सरकार", "विष्णु का सुशासन", "छत्तीसगढ़ सरकार",
    "छत्तीसगढ़ भाजपा", "छत्तीसगढ़ कांग्रेस", "प्रदेश कांग्रेस", "छत्तीसगढ़ विधानसभा", "मंत्रालय",
    "महानदी भवन", "नवा रायपुर", "छत्तीसगढ़", "छत्तीसगढ़िया", "सीजी", "mahtari vandan", "dhan kharidi",
    "paddy procurement", "naxal", "maoist", "bastar", "hasdeo", "liquor scam", "mahadev app", "coal levy",
    "dmf scam", "psc scam", "niyad nellanar", "bastar olympics", "sushasan tihar", "महतारी वंदन", "धान खरीदी",
    "नक्सल", "माओवादी", "बस्तर", "हसदेव", "शराब घोटाला", "महादेव सट्टा", "कोयला घोटाला", "डीएमएफ घोटाला",
    "पीएससी घोटाला", "नियद नेल्लानार", "बस्तर ओलंपिक", "सुशासन तिहार",
]

# ── Category classification keywords ─────────────────────────────────────────
CATEGORY_KEYWORDS = {
    "crime": [
        "crime", "murder", "theft", "robbery", "rape", "assault", "arrested", "gangster", "drug", "drugs",
        "narcotics", "ganja", "smuggling", "fraud", "scam", "kidnap", "extortion", "police", "fir",
        "case registered", "nabbed", "caught", "crime branch", "cyber fraud", "betting app", "corruption",
        "bribery", "embezzlement", "money laundering", "disproportionate assets", "ed raid", "eow", "acb",
        "अपराध", "हत्या", "चोरी", "लूट", "दुष्कर्म", "गिरफ्तार", "गिरफ्तारी", "पुलिस", "एफआईआर", "ठगी",
        "गांजा", "नशा", "भ्रष्टाचार", "घोटाला", "घोटाले", "रिश्वत", "सट्टा", "ईडी", "छापा", "छापेमारी",
        "ईओडब्ल्यू",
    ],
    "politics": [
        "politics", "political", "election", "vote", "bjp", "congress", "mla", "mp", "minister", "cabinet",
        "assembly", "parliament", "rally", "campaign", "government", "govt", "cm sai", "sai sarkar",
        "bhupesh baghel", "lok sabha", "vidhan sabha", "constituency", "party", "governance", "opposition",
        "ruling", "coalition", "alliance", "seat", "candidate", "panchayat election", "civic polls",
        "राजनीति", "सियासत", "सियासी", "चुनाव", "निर्वाचन", "मतदान", "विधानसभा", "मुख्यमंत्री", "मंत्री",
        "विधायक", "सांसद", "भाजपा", "कांग्रेस", "सरकार", "विपक्ष", "नेता प्रतिपक्ष", "प्रदेश अध्यक्ष",
        "पार्षद", "महापौर",
    ],
    "development": [
        "development", "infrastructure", "project", "scheme", "highway", "bridge", "railway line", "flyover",
        "smart city", "industrial", "investment", "tender", "mou", "construction", "inaugurate", "launch",
        "upgrade", "fund released", "bhoomi pujan", "mission", "welfare", "yojana", "viksit chhattisgarh",
        "anjor vision", "nava raipur", "mahtari vandan", "pm awas", "niyad nellanar", "paddy procurement",
        "msp", "bonus", "sewage", "drain", "drainage", "road repair", "streetlight", "water supply",
        "jal jeevan", "विकास", "परियोजना", "योजना", "निर्माण", "लोकार्पण", "शिलान्यास", "भूमिपूजन", "उद्घाटन",
        "निवेश", "महतारी वंदन", "प्रधानमंत्री आवास", "पीएम आवास", "धान खरीदी", "समर्थन मूल्य", "बोनस",
        "किस्त", "सड़क", "पुल",
    ],
    "communal": [
        "communal", "riot", "religious tension", "communal tension", "hate speech", "forced conversion",
        "religious conversion", "conversion", "anti-conversion", "ghar wapsi", "desecration",
        "vandalised idol", "vandalized idol", "church", "burial dispute", "सांप्रदायिक", "धर्मांतरण",
        "मतांतरण", "घर वापसी", "धार्मिक तनाव", "दंगा", "मूर्ति खंडित", "चर्च", "शव दफन",
    ],
    "law_order": [
        "law and order", "law & order", "curfew", "protest", "agitation", "strike", "bandh", "gherao",
        "chakka jam", "section 144", "section 163", "lathi charge", "riot", "unrest", "demonstration",
        "crackdown", "nia", "cbi", "police clash", "naxal", "naxalite", "maoist", "encounter", "ied",
        "surrender", "drg", "crpf", "cobra", "operation kagar", "कानून व्यवस्था", "कानून-व्यवस्था", "धरना",
        "प्रदर्शन", "आंदोलन", "घेराव", "चक्काजाम", "बंद का आह्वान", "छत्तीसगढ़ बंद", "लाठीचार्ज", "हड़ताल",
        "नक्सल", "नक्सली", "माओवादी", "मुठभेड़", "आईईडी", "आत्मसमर्पण", "सरेंडर", "जवान शहीद",
    ],
}

# ── Chhattisgarh location mapping (towns and districts with their Hindi and
# press spellings) ─────────────────────────────────────────────────────────────
LOCATION_KEYWORDS = {
    "Raipur": ["raipur", "रायपुर"],
    "Nava Raipur": ["nava raipur", "naya raipur", "atal nagar", "नवा रायपुर", "नया रायपुर"],
    "Bilaspur": ["bilaspur", "बिलासपुर"],
    "Durg": ["durg", "दुर्ग"],
    "Bhilai": ["bhilai", "भिलाई"],
    "Rajnandgaon": ["rajnandgaon", "राजनांदगांव", "राजनांदगाँव"],
    "Korba": ["korba", "कोरबा"],
    "Raigarh": ["raigarh", "रायगढ़"],
    "Janjgir": ["janjgir", "janjgir-champa", "जांजगीर", "जांजगीर-चांपा"],
    "Champa": ["champa", "चांपा"],
    "Jagdalpur": ["jagdalpur", "जगदलपुर"],
    "Bastar": ["bastar", "बस्तर"],
    "Dantewada": ["dantewada", "dantewara", "दंतेवाड़ा", "दंतेवाडा"],
    "Sukma": ["sukma", "सुकमा"],
    "Bijapur": ["bijapur", "बीजापुर"],
    "Narayanpur": ["narayanpur", "नारायणपुर"],
    "Kondagaon": ["kondagaon", "कोंडागांव", "कोण्डागांव"],
    "Kanker": ["kanker", "uttar bastar kanker", "कांकेर"],
    "Dhamtari": ["dhamtari", "धमतरी"],
    "Mahasamund": ["mahasamund", "महासमुंद"],
    "Gariaband": ["gariaband", "gariyaband", "गरियाबंद"],
    "Baloda Bazar": ["baloda bazar", "balodabazar", "बलौदाबाजार", "बलौदा बाजार"],
    "Bhatapara": ["bhatapara", "भाटापारा"],
    "Balod": ["balod", "बालोद"],
    "Bemetara": ["bemetara", "बेमेतरा"],
    "Kawardha": ["kawardha", "kabirdham", "कवर्धा", "कबीरधाम"],
    "Mungeli": ["mungeli", "मुंगेली"],
    "Ambikapur": ["ambikapur", "अंबिकापुर", "अम्बिकापुर"],
    "Surguja": ["surguja", "sarguja", "सरगुजा"],
    "Surajpur": ["surajpur", "सूरजपुर"],
    "Balrampur": ["balrampur", "ramanujganj", "बलरामपुर", "रामानुजगंज"],
    "Jashpur": ["jashpur", "jashpurnagar", "जशपुर"],
    "Baikunthpur": ["baikunthpur", "koriya", "बैकुंठपुर", "कोरिया जिला", "कोरिया जिले"],
    "Manendragarh": ["manendragarh", "मनेंद्रगढ़"],
    "Chirmiri": ["chirmiri", "चिरमिरी"],
    "Gaurela-Pendra-Marwahi": ["gaurela", "pendra", "marwahi", "गौरेला", "पेंड्रा", "मरवाही"],
    "Sakti": ["sakti", "सक्ती"],
    "Sarangarh": ["sarangarh", "bilaigarh", "सारंगढ़", "बिलाईगढ़"],
    "Khairagarh": ["khairagarh", "chhuikhadan", "gandai", "खैरागढ़", "छुईखदान", "गंडई"],
    "Mohla-Manpur": ["mohla", "ambagarh chowki", "ambagarh chouki", "मोहला", "अंबागढ़ चौकी"],
    "Dongargarh": ["dongargarh", "डोंगरगढ़"],
    "Tilda-Neora": ["tilda", "तिल्दा"],
    "Arang": ["arang", "आरंग"],
    "Abhanpur": ["abhanpur", "अभनपुर"],
    "Rajim": ["rajim", "राजिम"],
    "Kurud": ["kurud", "कुरुद"],
    "Kharsia": ["kharsia", "खरसिया"],
    "Tamnar": ["tamnar", "तमनार"],
    "Dharamjaigarh": ["dharamjaigarh", "धरमजयगढ़"],
    "Katghora": ["katghora", "कटघोरा"],
    "Akaltara": ["akaltara", "अकलतरा"],
    "Takhatpur": ["takhatpur", "तखतपुर"],
    "Ratanpur": ["ratanpur", "रतनपुर"],
    "Lormi": ["lormi", "लोरमी"],
    "Saraipali": ["saraipali", "सरायपाली"],
    "Pithora": ["pithora", "पिथौरा"],
    "Dalli Rajhara": ["dalli rajhara", "dalli-rajhara", "दल्लीराजहरा", "दल्ली राजहरा"],
    "Kirandul": ["kirandul", "किरंदुल"],
    "Bacheli": ["bacheli", "बचेली"],
    "Bhanupratappur": ["bhanupratappur", "भानुप्रतापपुर"],
    "Keshkal": ["keshkal", "केशकाल"],
    "Konta": ["konta", "कोंटा"],
    "Abujhmarh": ["abujhmarh", "abujhmad", "अबूझमाड़"],
    "Pathalgaon": ["pathalgaon", "पत्थलगांव"],
    "Kunkuri": ["kunkuri", "कुनकुरी"],
    "Hasdeo Arand": ["hasdeo", "hasdeo arand", "hasdeo aranya", "हसदेव", "हसदेव अरण्य"],
    "Deobhog": ["deobhog", "देवभोग"],
}

# Town -> (district, lat, lng), from backend/src/data/state_geo.json. Where the
# geography research has no point for a place, the district centroid is used
# (marked); None falls back to the state centroid.
LOCATION_META = {
    "Raipur": ("Raipur", 21.24444, 81.63056),
    "Nava Raipur": ("Raipur", 21.28569, 81.82007),  # district centroid
    "Bilaspur": ("Bilaspur", 22.09, 82.15),
    "Durg": ("Durg", 21.19, 81.28),
    "Bhilai": ("Durg", 21.21, 81.38),
    "Rajnandgaon": ("Rajnandgaon", 21.1, 81.03),
    "Korba": ("Korba", 22.35, 82.68),
    "Raigarh": ("Raigarh", 21.89739, 83.395),
    "Janjgir": ("Janjgir-Champa", 22.017, 82.567),
    "Champa": ("Janjgir-Champa", 22.05, 82.65),
    "Jagdalpur": ("Bastar", 19.18, 81.92),
    "Bastar": ("Bastar", 19.20929, 81.93264),
    "Dantewada": ("Dantewada", 18.9, 81.339),
    "Sukma": ("Sukma", 18.4, 81.66667),
    "Bijapur": ("Bijapur", 18.79167, 80.81667),
    "Narayanpur": ("Narayanpur", 19.7167, 81.25),
    "Kondagaon": ("Kondagaon", 19.6, 81.67),
    "Kanker": ("Kanker", 20.27, 81.49),
    "Dhamtari": ("Dhamtari", 20.71, 81.55),
    "Mahasamund": ("Mahasamund", 21.11, 82.1),
    "Gariaband": ("Gariaband", 20.63, 82.05),
    "Baloda Bazar": ("Baloda Bazar-Bhatapara", 21.67, 82.17),
    "Bhatapara": ("Baloda Bazar-Bhatapara", 21.73, 81.93),
    "Balod": ("Balod", 20.73, 81.2),
    "Bemetara": ("Bemetara", 21.7, 81.53),
    "Kawardha": ("Kabirdham", 22.02, 81.25),
    "Mungeli": ("Mungeli", 22.07, 81.68),
    "Ambikapur": ("Surguja", 23.12, 83.2),
    "Surguja": ("Surguja", 22.9286, 83.22691),  # district centroid
    "Surajpur": ("Surajpur", 23.22, 82.85),
    "Balrampur": ("Balrampur-Ramanujganj", 23.605, 83.617),
    "Jashpur": ("Jashpur", 22.80088, 83.8625),  # district centroid
    "Baikunthpur": ("Koriya", 23.25, 82.55),
    "Manendragarh": ("Manendragarh-Chirmiri-Bharatpur", 23.1922, 82.2003),
    "Chirmiri": ("Manendragarh-Chirmiri-Bharatpur", 23.19167, 82.35417),
    "Gaurela-Pendra-Marwahi": ("Gaurela-Pendra-Marwahi", 22.80487, 81.99881),  # district centroid
    "Sakti": ("Sakti", 22.03, 82.97),
    "Sarangarh": ("Sarangarh-Bilaigarh", 21.6, 83.08),
    "Khairagarh": ("Khairagarh-Chhuikhadan-Gandai", 21.42, 80.97),
    "Mohla-Manpur": ("Mohla-Manpur-Ambagarh Chowki", 20.5111, 80.71085),  # district centroid
    "Dongargarh": ("Rajnandgaon", 21.18871, 80.75907),
    "Tilda-Neora": ("Raipur", 21.28569, 81.82007),  # district centroid
    "Arang": ("Raipur", 21.19863, 81.96599),
    "Abhanpur": ("Raipur", 21.05278, 81.74556),
    "Rajim": ("Gariaband", 20.965, 81.88167),
    "Kurud": ("Dhamtari", 20.83, 81.72),
    "Kharsia": ("Raigarh", 21.97, 83.12),
    "Tamnar": ("Raigarh", 22.08, 83.44),
    "Dharamjaigarh": ("Raigarh", 22.47, 83.22),
    "Katghora": ("Korba", 22.5, 82.55),
    "Akaltara": ("Janjgir-Champa", 22.02, 82.43),
    "Takhatpur": ("Bilaspur", 22.12915, 81.86959),
    "Ratanpur": ("Bilaspur", 22.288, 82.166),
    "Lormi": ("Mungeli", 22.28, 81.73),
    "Saraipali": ("Mahasamund", 21.33, 83),
    "Pithora": ("Mahasamund", 21.27, 82.52),
    "Dalli Rajhara": ("Balod", 20.58, 81.08),
    "Kirandul": ("Dantewada", 18.6325, 81.25944),
    "Bacheli": ("Dantewada", 18.70528, 81.25194),
    "Bhanupratappur": ("Kanker", 20.31008, 81.07193),
    "Keshkal": ("Kondagaon", 20.08472, 81.58667),
    "Konta": ("Sukma", 17.8, 81.38333),
    "Abujhmarh": ("Narayanpur", 19.54, 80.806),
    "Pathalgaon": ("Jashpur", 22.57, 83.47),
    "Kunkuri": ("Jashpur", 22.75, 83.95),
    "Hasdeo Arand": ("Surguja", 22.6, 82.8),
    "Deobhog": ("Gariaband", 19.89645, 82.65931),
}

# Devanagari aliases match as substrings (case suffixes attach directly), and
# Latin aliases as whole words, so a few need false continuations blocked:
# दुर्ग inside दुर्गा (the goddess), "durga", "baloda", "champaran".
ALIAS_BLOCKED_CONTINUATIONS = {
    "durg": ("a", "ah"),
    "दुर्ग": ("ा", "ि", "े"),
    "balod": ("a", "abazar"),
    "बालोद": (),
    "champa": ("ran", "k"),
    "sakti": ("man",),
    "सक्ती": (),
    "mohla": (),
    "pendra": (),
    "konta": ("ct",),
    "रायगढ़": (),
    "बस्तर": (),
}

STATE_NAME = 'Chhattisgarh'

# ── Chhattisgarh centroid (fallback coordinates for towns without their own) ──
STATE_LAT = 21.25302
STATE_LNG = 82.02811
