/**
 * Political Data — single source of truth for the Chhattisgarh political universe.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Client: the BJP government of Chhattisgarh (CM Vishnu Deo Sai; BJP state
 * president Kiran Singh Deo). Roster verified as of 26 Sep 2026 — see
 * data/state_voter_profiles.json `data_sources`, data/state_leader_handles.json
 * and the research notes kept with the clone.
 *
 *   OURS / "ally" : BJP — governs alone (54 of 90 seats). There is no coalition
 *                   partner in Chhattisgarh, so ALLY_PARTIES is empty.
 *   OPPOSITION    : INC (35 seats; Leader of Opposition Dr. Charan Das Mahant,
 *                   PCC president Deepak Baij), Gondwana Gantantra Party (1 seat,
 *                   Pali-Tanakhar), JCC(J), AAP and BSP (no seats).
 *
 * ⚠ ALIGNMENT IS STATE-SPECIFIC. The same codebase has served deployments where
 *   BJP was the opposition, or a junior ally. Never copy an alignment table
 *   between deployments — re-derive it per state.
 *
 * Used by:
 *   - config/politicalEntities.js   (derives the alias/alignment entity graph)
 *   - config/deployment.js          (prompt phrasing of the two camps)
 *   - services/politicalContextService.js (Stage 2 deterministic entity scan)
 *   - services/politicalSentimentService.js (Stage 3 prompt context)
 *   - services/stanceEngine.js      (Stage 4 ally/opposition decision matrix)
 *
 * Adding or removing a leader here automatically flows through detection,
 * prompting, stance resolution and storage — no other file needs editing.
 * (Native-script aliases are the one exception: add those in
 * politicalEntities.js `CURATED_ALIASES`, keyed by the `id` used here.)
 */

const VOTER_PROFILES = require('../data/state_voter_profiles.json');

const normalizeHandle = (h) => String(h || '').trim().replace(/^@/, '').toLowerCase();

/**
 * Verified X / Instagram / Facebook accounts (data/state_leader_handles.json,
 * with status and evidence per handle). Merged into every leader and party
 * below, so a leader is recognised when a post tags them AND when they are the
 * post's author — which is what the stance engine's author-is-target
 * correction and cross-camp prior depend on.
 */
const HANDLE_REGISTRY = require('../data/state_leader_handles.json');
const registryHandles = (entries) => (entries || []).map((e) => `@${e.handle}`);
const mergeHandles = (...lists) => {
    const seen = new Set();
    const out = [];
    for (const h of lists.flat()) {
        const k = normalizeHandle(h);
        if (k && !seen.has(k)) { seen.add(k); out.push(h.startsWith('@') ? h : `@${h}`); }
    }
    return out;
};

/** Assembly-constituency key: strips any "(SC)"/"(ST)" reservation suffix and
 *  punctuation, so "PALI-TANAKHAR (ST)" === "Pali Tanakhar". */
const acKey = (s) => String(s || '')
    .toLowerCase()
    .replace(/\((?:sc|st)\)/g, '')
    .replace(/[^a-z0-9]/g, '');

const nameKey = (s) => String(s || '')
    .toLowerCase()
    .replace(/\b(?:dr|doctor|sri|smt|shri|capt|captain|adv|engr)\b\.?/g, '')
    .replace(/[^a-z0-9]/g, '');

/** Results data spells parties out in full; the roster uses short codes. */
const normalizeParty = (p) => {
    const v = String(p || '').trim();
    if (/^bharatiya\s*janata/i.test(v)) return 'BJP';
    if (/^indian\s*national\s*congress/i.test(v)) return 'INC';
    if (/^gondw?ana\s*gan?tantra/i.test(v)) return 'GGP';
    if (/^jan(?:a)?ta\s*congress\s*chhattisgarh/i.test(v) || /^jcc\s*\(?j\)?$/i.test(v)) return 'JCC(J)';
    if (/^aam\s*aadmi/i.test(v)) return 'AAP';
    if (/^bahujan\s*samaj/i.test(v)) return 'BSP';
    if (/^independent$/i.test(v)) return 'IND';
    return v.toUpperCase();
};

const ALLY_PARTY_CODES = ['BJP'];

/**
 * Independents have no party alignment of their own, so their side comes from
 * the roster's `alliance` field (NDA = supports the government). Chhattisgarh
 * has no Independent MLA in the current Assembly; the rule is kept for
 * by-elections.
 */
const sideForParty = (party, alliance) => {
    const code = normalizeParty(party);
    if (ALLY_PARTY_CODES.includes(code)) return 'ours';
    if (code === 'IND') return String(alliance || '').toUpperCase() === 'NDA' ? 'ours' : 'opposition';
    return 'opposition';
};

/** Current district of an AC, from the roster (33 districts since 2022). */
const DISTRICT_BY_AC = new Map(
    VOTER_PROFILES.map((row) => [acKey(row.constituency), row.district || '']),
);
const districtFor = (constituency, fallback = '') =>
    DISTRICT_BY_AC.get(acKey(constituency)) || fallback;

const tagLeaders = (leaders, party, side) =>
    leaders.map((l) => {
        const handles = mergeHandles(l.handles || [], registryHandles(HANDLE_REGISTRY.people[l.id]));
        const primary_handle = handles[0] || '';
        return {
            ...l,
            district: l.constituency ? districtFor(l.constituency, l.district || '') : (l.district || ''),
            party: l.party || party,
            side: l.side || side,
            handles,
            primary_handle,
            primary_handle_normalized: normalizeHandle(primary_handle),
            handles_normalized: handles.map(normalizeHandle).filter(Boolean),
        };
    });

// ─────────────────────────────────────────────────────────
// PARTIES
// ─────────────────────────────────────────────────────────

const OUR_PARTY = {
    id: 'bjp',
    name: 'BJP',
    full_name: 'Bharatiya Janata Party',
    aliases: ['BJP', 'BJP Chhattisgarh', 'Chhattisgarh BJP', 'CG BJP', 'Bharatiya Janata Party', 'Bharatiya Janta Party', 'Lotus party', 'Saffron party'],
    alliance: 'NDA',
    role: 'ruling',
    state: 'Chhattisgarh',
    chief: 'Vishnu Deo Sai',
    state_president: 'Kiran Singh Deo',
    symbol: 'Lotus',
    handles: ['@BJP4CGState'],
};

/**
 * Coalition partners. BJP governs Chhattisgarh alone, so there are none; the
 * list is kept (empty) because the rest of the pipeline iterates it.
 */
const ALLY_PARTIES = [];

// ─────────────────────────────────────────────────────────
// COUNCIL OF MINISTERS — Vishnu Deo Sai ministry (CM + 2 Deputy CMs + 11
// ministers). Sworn in 13 Dec 2023; expanded 20 Aug 2025 (Gajendra Yadav,
// Rajesh Agrawal, Guru Khushwant Saheb). Brijmohan Agrawal left the cabinet
// on becoming Raipur MP (Jun 2024); his portfolios were redistributed.
//
// Handles: only those independently verified (profile bio names the person
// and office, or an official site links it). The rest are left EMPTY rather
// than guessed — a wrong handle silently mis-attributes every post from it.
// ─────────────────────────────────────────────────────────
const _CABINET_RAW = [
    { id: 'vishnu-deo-sai', name: 'Vishnu Deo Sai', shortName: 'Vishnu Deo Sai', aliases: ['Vishnudeo Sai', 'Vishnu Dev Sai', 'Vishnudev Sai', 'CM Sai', 'CM Vishnu Deo Sai', 'Chhattisgarh CM', 'Chief Minister Sai', 'Sai sarkar', 'Sai government', 'Vishnu ka Sushasan', 'Bagiya ke Vishnu'], role: 'Chief Minister', portfolios: ['General Administration', 'Mineral Resources', 'Energy', 'Public Relations', 'Aviation', 'Electronics & IT', 'Good Governance & Convergence', 'Public Grievance Redressal', 'Water Resources', 'All unallocated departments'], constituency: 'Kunkuri', party: 'BJP', handles: ['@vishnudsai', '@ChhattisgarhCMO'] },
    { id: 'arun-sao', name: 'Arun Sao', shortName: 'Arun Sao', aliases: ['Deputy CM Sao', 'Dy CM Arun Sao', 'Up-Mukhyamantri Arun Sao'], role: 'Deputy Chief Minister', portfolios: ['Public Works', 'Public Health Engineering', 'Urban Administration & Development', 'Sports & Youth Welfare'], constituency: 'Lormi', party: 'BJP', handles: ['@ArunSao3'] },
    { id: 'vijay-sharma', name: 'Vijay Sharma', shortName: 'Vijay Sharma', aliases: ['Deputy CM Vijay Sharma', 'Home Minister Vijay Sharma', 'Dy CM Sharma'], role: 'Deputy Chief Minister', portfolios: ['Home', 'Jails', 'Panchayat & Rural Development', 'Science & Technology'], constituency: 'Kawardha', party: 'BJP', handles: ['@vijaysharmacg'] },
    { id: 'ramvichar-netam', name: 'Ramvichar Netam', shortName: 'Ramvichar Netam', aliases: ['Ram Vichar Netam', 'Agriculture Minister Netam'], role: 'Cabinet Minister', portfolios: ['Scheduled Tribes & Primitive Tribes Development', 'Agriculture Development & Farmer Welfare', 'Biotechnology', 'Animal Husbandry', 'Fisheries'], constituency: 'Ramanujganj', party: 'BJP', handles: ['@ramvicharnetam'] },
    { id: 'dayaldas-baghel', name: 'Dayaldas Baghel', shortName: 'Dayaldas Baghel', aliases: ['Dayal Das Baghel', 'Food Minister Baghel'], role: 'Cabinet Minister', portfolios: ['Food, Civil Supplies & Consumer Protection'], constituency: 'Nawagarh', party: 'BJP', handles: ['@DayalDasBaghel'] },
    { id: 'kedar-kashyap', name: 'Kedar Nath Kashyap', shortName: 'Kedar Kashyap', aliases: ['Kedar Kashyap', 'Forest Minister Kashyap'], role: 'Cabinet Minister', portfolios: ['Forest & Climate Change', 'Transport', 'Cooperation', 'Parliamentary Affairs'], constituency: 'Narayanpur', party: 'BJP', handles: ['@KedarKashyapBJP'] },
    { id: 'lakhan-lal-dewangan', name: 'Lakhan Lal Dewangan', shortName: 'Lakhan Lal Dewangan', aliases: ['Lakhanlal Dewangan', 'Lakhanlal Devangan', 'Lakhan Dewangan'], role: 'Cabinet Minister', portfolios: ['Commerce & Industry', 'Public Enterprises', 'Commercial Tax (Excise)', 'Labour'], constituency: 'Korba', party: 'BJP', handles: ['@LakhanLalDewan1'] },
    { id: 'shyam-bihari-jaiswal', name: 'Shyam Bihari Jaiswal', shortName: 'Shyam Bihari Jaiswal', aliases: ['Health Minister Jaiswal', 'Shyambihari Jaiswal'], role: 'Cabinet Minister', portfolios: ['Public Health & Family Welfare', 'Medical Education', 'Backward Classes & Minority Development', '20-Point Programme Implementation'], constituency: 'Manendragarh', party: 'BJP', handles: ['@ShyamBihariBjp'] },
    { id: 'op-choudhary', name: 'O. P. Choudhary', shortName: 'OP Choudhary', aliases: ['OP Choudhary', 'O.P. Choudhary', 'OP Chaudhary', 'Om Prakash Choudhary', 'Finance Minister Choudhary'], role: 'Cabinet Minister', portfolios: ['Finance', 'Commercial Tax (excluding Excise)', 'Housing & Environment', 'Planning, Economics & Statistics'], constituency: 'Raigarh', party: 'BJP', handles: ['@OPChoudhary_Ind'] },
    { id: 'laxmi-rajwade', name: 'Laxmi Rajwade', shortName: 'Laxmi Rajwade', aliases: ['Lakshmi Rajwade', 'Laxmi Rajwaday'], role: 'Cabinet Minister', portfolios: ['Women & Child Development', 'Social Welfare'], constituency: 'Bhatgaon', party: 'BJP', handles: ['@LaxmiRajwade21'] },
    { id: 'tank-ram-verma', name: 'Tank Ram Verma', shortName: 'Tank Ram Verma', aliases: ['Tankram Verma', 'Revenue Minister Verma'], role: 'Cabinet Minister', portfolios: ['Revenue & Disaster Management', 'Rehabilitation', 'Higher Education'], constituency: 'Baloda Bazar', party: 'BJP', handles: ['@tankramvermabjp'] },
    { id: 'gajendra-yadav', name: 'Gajendra Yadav', shortName: 'Gajendra Yadav', aliases: ['Education Minister Gajendra Yadav', 'Gajendra Yadav Durg'], role: 'Cabinet Minister (inducted 20 Aug 2025)', portfolios: ['School Education', 'Village Industries (Gramodyog)', 'Law & Legislative Affairs'], constituency: 'Durg City', party: 'BJP', handles: ['@GajendraYdvBJP'] },
    { id: 'rajesh-agrawal', name: 'Rajesh Agrawal', shortName: 'Rajesh Agrawal', aliases: ['Rajesh Agarwal', 'Tourism Minister Rajesh Agrawal'], role: 'Cabinet Minister (inducted 20 Aug 2025)', portfolios: ['Tourism', 'Culture', 'Religious Trusts & Endowments (Dharmasva)'], constituency: 'Ambikapur', party: 'BJP', handles: ['@RajeshAgBJP'] },
    { id: 'guru-khushwant-saheb', name: 'Guru Khushwant Saheb', shortName: 'Guru Khushwant Saheb', aliases: ['Khushwant Saheb', 'Guru Khushwant', 'Guru Khushwant Singh Saheb'], role: 'Cabinet Minister (inducted 20 Aug 2025)', portfolios: ['Skill Development', 'Technical Education & Employment', 'Scheduled Caste Development'], constituency: 'Arang', party: 'BJP', handles: ['@Khushwantguru'] },
];

/** Presiding officers — BJP members, so they sit on our side of the matrix.
 *  The Deputy Speaker post is vacant. */
const _PRESIDING_OFFICERS_RAW = [
    { id: 'raman-singh', name: 'Dr. Raman Singh', shortName: 'Raman Singh', aliases: ['Raman Singh', 'Dr Raman Singh', 'Speaker Raman Singh', 'Chawal wale baba', 'Former CM Raman Singh'], role: 'Speaker, Chhattisgarh Legislative Assembly; former Chief Minister (2003-2018)', constituency: 'Rajnandgaon', party: 'BJP', handles: ['@drramansingh'] },
];

/** BJP Chhattisgarh organisation — not all are MLAs, so the roster cannot supply them. */
const _PARTY_ORG_RAW = [
    { id: 'kiran-singh-deo', name: 'Kiran Singh Deo', shortName: 'Kiran Singh Deo', aliases: ['Kiran Deo', 'Kiran Dev', 'Kiran Singh Dev', 'Kiran Singhdeo', 'BJP state president', 'CG BJP president'], role: 'State President, BJP Chhattisgarh (since Dec 2023; re-elected 17 Jan 2025); MLA', constituency: 'Jagdalpur', party: 'BJP', handles: ['@KiranDeoBJP'] },
    { id: 'karmveer-singh', name: 'Karmveer Singh', shortName: 'Karmveer', aliases: ['Karmaveer Singh'], role: 'State General Secretary (Organisation), BJP Chhattisgarh (appointed 24 Sep 2026; replaced Pawan Sai)', constituency: '', party: 'BJP', handles: [] },
    { id: 'yashwant-jain', name: 'Yashwant Jain', shortName: 'Yashwant Jain', role: 'State General Secretary, BJP Chhattisgarh', constituency: '', party: 'BJP', handles: [] },
    { id: 'akhilesh-soni', name: 'Akhilesh Soni', shortName: 'Akhilesh Soni', role: 'State General Secretary, BJP Chhattisgarh', constituency: '', party: 'BJP', handles: ['@AkhileshSoniBJP'] },
    { id: 'navin-markandey', name: 'Navin Markandey', shortName: 'Navin Markandey', aliases: ['Naveen Markandey', 'Navin Markande'], role: 'State General Secretary, BJP Chhattisgarh', constituency: '', party: 'BJP', handles: [] },
    { id: 'smriti-irani', name: 'Smriti Irani', shortName: 'Smriti Irani', aliases: ['Smriti Z Irani', 'Smriti Zubin Irani'], role: 'State In-charge (Prabhari), BJP Chhattisgarh (appointed 23 Sep 2026); BJP National General Secretary', constituency: '', party: 'BJP', handles: ['@smritiirani'] },
    { id: 'pawan-sai', name: 'Pawan Sai', shortName: 'Pawan Sai', aliases: ['पवन साय'], role: 'Former State General Secretary (Organisation), BJP Chhattisgarh (till 24 Sep 2026)', constituency: '', party: 'BJP', handles: ['@PawanSaiBJP'] },
    { id: 'ajay-jamwal', name: 'Ajay Jamwal', shortName: 'Ajay Jamwal', aliases: ['अजय जामवाल'], role: 'BJP Regional General Secretary (Organisation), Chhattisgarh & Madhya Pradesh', constituency: '', party: 'BJP', handles: ['@ajayjamwalbjp'] },
    { id: 'siddharth-shambhu', name: 'Siddharth Shambhu', shortName: 'Siddharth Shambhu', role: 'State Co-in-charge (Sah-Prabhari), BJP Chhattisgarh (appointed 23 Sep 2026); BJP National Secretary', constituency: '', party: 'BJP', handles: [] },
];

// ─────────────────────────────────────────────────────────
// OPPOSITION — hand-curated leaders (MLAs among them are skipped by the
// derived roster below, so nobody becomes two entities).
// ─────────────────────────────────────────────────────────
const _INC_LEADERS_RAW = [
    { id: 'charan-das-mahant', name: 'Dr. Charan Das Mahant', shortName: 'Charan Das Mahant', aliases: ['Charandas Mahant', 'Dr Charandas Mahant', 'LoP Mahant', 'Leader of Opposition Mahant'], role: 'Leader of Opposition, Chhattisgarh Legislative Assembly (since 16 Dec 2023)', constituency: 'Sakti', party: 'INC', handles: ['@DrCharandas'] },
    { id: 'deepak-baij', name: 'Deepak Baij', shortName: 'Deepak Baij', aliases: ['PCC chief Baij', 'PCC president Deepak Baij', 'Congress state president Baij'], role: 'President, Chhattisgarh Pradesh Congress Committee (since 12 Jul 2023)', constituency: '', party: 'INC', handles: ['@DeepakBaijINC'] },
    { id: 'bhupesh-baghel', name: 'Bhupesh Baghel', shortName: 'Bhupesh Baghel', aliases: ['Bhupesh', 'Bhupesh Kaka', 'Former CM Baghel', 'Ex-CM Bhupesh Baghel'], role: 'Former Chief Minister (2018-2023); MLA; AICC General Secretary in-charge of Assam (from 5 Sep 2026, earlier Punjab)', constituency: 'Patan', party: 'INC', handles: ['@bhupeshbaghel'] },
    { id: 'ts-singh-deo', name: 'T. S. Singh Deo', shortName: 'T S Singh Deo', aliases: ['TS Singh Deo', 'TS Singhdeo', 'T.S. Singhdeo', 'TS Baba', 'Tribhuvaneshwar Saran Singh Deo'], role: 'Former Deputy Chief Minister; senior Congress leader (lost Ambikapur in 2023; not an MLA)', constituency: '', party: 'INC', handles: ['@TS_SinghDeo'] },
    { id: 'lakheshwar-baghel', name: 'Lakheshwar Baghel', shortName: 'Lakheshwar Baghel', aliases: ['Lakheswar Baghel', 'Deputy LoP Baghel'], role: 'Deputy Leader of Opposition (since 20 Feb 2026); MLA', constituency: 'Bastar', party: 'INC', handles: [] },
    { id: 'umesh-patel', name: 'Umesh Nandkumar Patel', shortName: 'Umesh Patel', aliases: ['Umesh Patel'], role: 'MLA; former Higher Education Minister', constituency: 'Kharsia', party: 'INC', handles: ['@umeshpatelcgpyc'] },
    { id: 'devendra-yadav', name: 'Devendra Yadav', shortName: 'Devendra Yadav', aliases: ['Devendra Yadav Bhilai'], role: 'MLA; AICC Secretary (in-charge Gujarat); CG Congress spokesperson', constituency: 'Bhilai Nagar', party: 'INC', handles: ['@Devendra_1925'] },
    { id: 'kawasi-lakhma', name: 'Kawasi Lakhma', shortName: 'Kawasi Lakhma', aliases: ['Lakhma', 'Dada Lakhma'], role: 'MLA; former Excise Minister (liquor-scam accused; on SC interim bail since Feb 2026, barred from entering CG except for court)', constituency: 'Konta', party: 'INC', handles: ['@KawasiLakhma'] },
];

const _GGP_LEADERS_RAW = [
    { id: 'tuleshwar-markam', name: 'Tuleshwar Hira Singh Markam', shortName: 'Tuleshwar Markam', aliases: ['Tuleshwar Singh Markam', 'Tuleshwar Markam', 'GGP president'], role: 'National President, Gondwana Gantantra Party; MLA', constituency: 'Pali-Tanakhar', party: 'GGP', handles: ['@MarkamTuleGGP'] },
];

const _JCCJ_LEADERS_RAW = [
    { id: 'amit-jogi', name: 'Amit Jogi', shortName: 'Amit Jogi', aliases: ['Amit Ajit Jogi', 'JCC(J) president'], role: 'President, Janta Congress Chhattisgarh (J)', constituency: '', party: 'JCC(J)', handles: ['@amitjogi'] },
    { id: 'renu-jogi', name: 'Dr. Renu Jogi', shortName: 'Renu Jogi', aliases: ['Renu Jogi', 'Dr Renu Jogi'], role: 'JCC(J) leader; former MLA (Kota)', constituency: '', party: 'JCC(J)', handles: ['@renu_jogi'] },
];

/** AAP and BSP hold no seat; their state leadership is unsettled (AAP) or
 *  unconfirmed since 2023 (BSP), so no individual is listed. */
const _AAP_LEADERS_RAW = [];
const _BSP_LEADERS_RAW = [];

// ─────────────────────────────────────────────────────────
// NATIONAL figures frequently named in Chhattisgarh political chat.
// ─────────────────────────────────────────────────────────
const _NATIONAL_ALLY_RAW = [
    { id: 'narendra-modi', name: 'Narendra Modi', shortName: 'Modi', aliases: ['Modi', 'Modi ji', 'PM Modi', 'Prime Minister Modi'], role: 'Prime Minister of India', constituency: 'Varanasi', party: 'BJP', scope: 'national', handles: ['@narendramodi', '@PMOIndia'] },
    { id: 'amit-shah', name: 'Amit Shah', shortName: 'Amit Shah', aliases: ['HM Shah', 'Home Minister Amit Shah'], role: 'Union Home Minister', constituency: 'Gandhinagar', party: 'BJP', scope: 'national', handles: ['@AmitShah'] },
    { id: 'jp-nadda', name: 'J. P. Nadda', shortName: 'JP Nadda', aliases: ['JP Nadda', 'J.P. Nadda', 'Jagat Prakash Nadda', 'जेपी नड्डा', 'जे.पी. नड्डा'], role: 'Union Health Minister; former BJP National President', constituency: '', party: 'BJP', scope: 'national', handles: ['@JPNadda'] },
    { id: 'bl-santhosh', name: 'B. L. Santhosh', shortName: 'BL Santhosh', aliases: ['BL Santhosh', 'B.L. Santhosh', 'बीएल संतोष', 'बी.एल. संतोष'], role: 'BJP National General Secretary (Organisation)', constituency: '', party: 'BJP', scope: 'national', handles: ['@blsanthosh'] },
    { id: 'shiv-prakash', name: 'Shiv Prakash', shortName: 'Shiv Prakash', aliases: ['शिवप्रकाश', 'शिव प्रकाश'], role: 'BJP National Joint General Secretary (Organisation)', constituency: '', party: 'BJP', scope: 'national', handles: ['@shivprakashbjp'] },
    { id: 'yogi-adityanath', name: 'Yogi Adityanath', shortName: 'Yogi Adityanath', aliases: ['CM Yogi', 'योगी आदित्यनाथ'], role: 'Chief Minister of Uttar Pradesh', constituency: '', party: 'BJP', scope: 'national', handles: ['@myogiadityanath'] },
    { id: 'nitin-gadkari', name: 'Nitin Gadkari', shortName: 'Gadkari', aliases: ['नितिन गडकरी'], role: 'Union Minister of Road Transport & Highways', constituency: '', party: 'BJP', scope: 'national', handles: ['@nitin_gadkari'] },
    { id: 'nitin-nabin', name: 'Nitin Nabin', shortName: 'Nitin Nabin', aliases: ['Nitin Naveen', 'BJP national president'], role: 'BJP National President (since 20 Jan 2026); earlier BJP Chhattisgarh in-charge', constituency: '', party: 'BJP', scope: 'national', handles: ['@NitinNabin'] },
];

const _NATIONAL_OPPOSITION_RAW = [
    { id: 'rahul-gandhi', name: 'Rahul Gandhi', shortName: 'Rahul Gandhi', role: 'Leader of Opposition, Lok Sabha', constituency: 'Rae Bareli', party: 'INC', scope: 'national', handles: ['@RahulGandhi'] },
    { id: 'mallikarjun-kharge', name: 'Mallikarjun Kharge', shortName: 'Kharge', role: 'AICC President', constituency: '', party: 'INC', scope: 'national', handles: ['@kharge'] },
    { id: 'sukhdeo-bhagat', name: 'Sukhdeo Bhagat', shortName: 'Sukhdeo Bhagat', aliases: ['Sukhdev Bhagat', 'Congress prabhari Bhagat'], role: 'AICC in-charge of Chhattisgarh (appointed 5 Sep 2026, replacing Sachin Pilot); MP, Lohardaga (Jharkhand)', constituency: '', party: 'INC', scope: 'national', handles: ['@sukhdeobhagat'] },
    { id: 'priyanka-gandhi', name: 'Priyanka Gandhi Vadra', shortName: 'Priyanka Gandhi', aliases: ['Priyanka Gandhi', 'प्रियंका गांधी', 'प्रियंका गाँधी'], role: 'AICC General Secretary; MP, Wayanad', constituency: '', party: 'INC', scope: 'national', handles: ['@priyankagandhi'] },
    { id: 'arvind-kejriwal', name: 'Arvind Kejriwal', shortName: 'Kejriwal', role: 'AAP National Convenor', constituency: '', party: 'AAP', scope: 'national', handles: ['@ArvindKejriwal'] },
    { id: 'mayawati', name: 'Mayawati', shortName: 'Mayawati', aliases: ['Behenji', 'Bahenji'], role: 'BSP National President', constituency: '', party: 'BSP', scope: 'national', handles: ['@Mayawati'] },
];

// ─────────────────────────────────────────────────────────
// MEMBERS OF PARLIAMENT — 11 Lok Sabha (10 BJP, 1 INC) and 5 Rajya Sabha.
// Mirrored in frontend/src/data/stateMPs.js (generated). Keep the two in sync.
// ─────────────────────────────────────────────────────────
const _MPS_RAW = [
    { id: 'mp-surguja', name: 'Chintamani Maharaj', shortName: 'Chintamani Maharaj', aliases: ['Chintamani Maharaj'], role: 'MP, Surguja (Lok Sabha)', constituency: 'Surguja', party: 'BJP', handles: ['@ChintamaniMhraj'] },
    { id: 'mp-raigarh', name: 'Radheshyam Rathiya', shortName: 'Radheshyam Rathiya', aliases: ['Radheshyam Rathia'], role: 'MP, Raigarh (Lok Sabha)', constituency: 'Raigarh', party: 'BJP', handles: ['@Radheshyam99891'] },
    { id: 'mp-janjgir-champa', name: 'Kamlesh Jangde', shortName: 'Kamlesh Jangde', aliases: ['Kamlesh Jangre'], role: 'MP, Janjgir-Champa (Lok Sabha)', constituency: 'Janjgir-Champa', party: 'BJP', handles: ['@kamleshjangde15'] },
    { id: 'mp-korba', name: 'Jyotsna Charan Das Mahant', shortName: 'Jyotsna Mahant', aliases: ['Jyotsna Mahant', 'Jyotsna Charandas Mahant'], role: 'MP, Korba (Lok Sabha); only Congress MP from Chhattisgarh', constituency: 'Korba', party: 'INC', handles: ['@jyotsnamahant'] },
    { id: 'mp-bilaspur', name: 'Tokhan Sahu', shortName: 'Tokhan Sahu', aliases: ['Union Minister Tokhan Sahu'], role: 'MP, Bilaspur (Lok Sabha); Union Minister of State for Housing & Urban Affairs', constituency: 'Bilaspur', party: 'BJP', handles: ['@tokhansahu_bjp'] },
    { id: 'mp-rajnandgaon', name: 'Santosh Pandey', shortName: 'Santosh Pandey', role: 'MP, Rajnandgaon (Lok Sabha)', constituency: 'Rajnandgaon', party: 'BJP', handles: ['@santoshpandey44'] },
    { id: 'mp-durg', name: 'Vijay Baghel', shortName: 'Vijay Baghel', role: 'MP, Durg (Lok Sabha)', constituency: 'Durg', party: 'BJP', handles: ['@VijayBaghelcg'] },
    { id: 'mp-raipur', name: 'Brijmohan Agrawal', shortName: 'Brijmohan Agrawal', aliases: ['Brijmohan', 'Brij Mohan Agrawal', 'Brijmohan Agarwal'], role: 'MP, Raipur (Lok Sabha); former Cabinet Minister (resigned 19 Jun 2024 after election to Lok Sabha)', constituency: 'Raipur', party: 'BJP', handles: ['@brijmohan_ag'] },
    { id: 'mp-mahasamund', name: 'Roopkumari Choudhary', shortName: 'Roopkumari Choudhary', aliases: ['Rupkumari Choudhary', 'Roop Kumari Chaudhary'], role: 'MP, Mahasamund (Lok Sabha); National President, BJP Mahila Morcha (from 17 Aug 2026)', constituency: 'Mahasamund', party: 'BJP', handles: ['@RoopkumariBJP'] },
    { id: 'mp-bastar', name: 'Mahesh Kashyap', shortName: 'Mahesh Kashyap', role: 'MP, Bastar (Lok Sabha)', constituency: 'Bastar', party: 'BJP', handles: ['@Mahesh_ji_bjp'] },
    { id: 'mp-kanker', name: 'Bhojraj Nag', shortName: 'Bhojraj Nag', role: 'MP, Kanker (Lok Sabha)', constituency: 'Kanker', party: 'BJP', handles: ['@BhojrajNag'] },
    { id: 'mp-rs-laxmi-verma', name: 'Laxmi Verma', shortName: 'Laxmi Verma', role: 'MP, Rajya Sabha (from 10 Apr 2026)', constituency: 'Chhattisgarh', party: 'BJP', handles: ['@LaxmiVermaBJP'] },
    { id: 'mp-rs-devendra-pratap-singh', name: 'Devendra Pratap Singh', shortName: 'Devendra Pratap Singh', aliases: ['Raja Devendra Pratap Singh'], role: 'MP, Rajya Sabha (from 3 Apr 2024)', constituency: 'Chhattisgarh', party: 'BJP', handles: [] },
    { id: 'mp-rs-phulo-devi-netam', name: 'Phulo Devi Netam', shortName: 'Phulo Devi Netam', aliases: ['Phulodevi Netam'], role: 'MP, Rajya Sabha (2nd term from 10 Apr 2026); President, Chhattisgarh Mahila Congress', constituency: 'Chhattisgarh', party: 'INC', handles: ['@NetamPhulodevi'] },
    { id: 'mp-rs-rajeev-shukla', name: 'Rajeev Shukla', shortName: 'Rajeev Shukla', aliases: ['Rajiv Shukla'], role: 'MP, Rajya Sabha (to 29 Jun 2028)', constituency: 'Chhattisgarh', party: 'INC', handles: ['@ShuklaRajiv'] },
    { id: 'mp-rs-ranjeet-ranjan', name: 'Ranjeet Ranjan', shortName: 'Ranjeet Ranjan', aliases: ['Ranjit Ranjan'], role: 'MP, Rajya Sabha (to 29 Jun 2028)', constituency: 'Chhattisgarh', party: 'INC', handles: ['@Ranjeet4India'] },
];

// ─────────────────────────────────────────────────────────
// AUTO-DERIVED MLA ROSTER — every sitting MLA not curated above.
//
// Source: data/state_voter_profiles.json. Vacant seats (mla null) are skipped.
// Party is the CURRENT one, and Independents take their side from `alliance`.
//
// LIMITATION: derived entries get English-script aliases only. Native-script
// aliases exist only for the entities in politicalEntities.js CURATED_ALIASES.
// ─────────────────────────────────────────────────────────

const ALL_CURATED_RAW = [
    ..._CABINET_RAW, ..._PRESIDING_OFFICERS_RAW, ..._PARTY_ORG_RAW,
    ..._INC_LEADERS_RAW, ..._GGP_LEADERS_RAW, ..._JCCJ_LEADERS_RAW, ..._AAP_LEADERS_RAW, ..._BSP_LEADERS_RAW,
];

const CURATED_AC_KEYS = new Set(ALL_CURATED_RAW.map((l) => acKey(l.constituency)).filter(Boolean));
const CURATED_NAME_KEYS = new Set(
    ALL_CURATED_RAW
        .flatMap((l) => [l.name, l.shortName, ...(l.aliases || [])])
        .map(nameKey)
        .filter(Boolean),
);

/** "Kiran Deo" → "Deo Kiran". Only for two-token names. */
const reversedName = (name) => {
    const parts = String(name || '').trim().split(/\s+/);
    if (parts.length !== 2) return null;
    return `${parts[1]} ${parts[0]}`;
};

/** Title-case names that arrive in ALL CAPS; leave mixed-case names untouched. */
const tidyName = (raw) => {
    const s = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!s || /[a-z]/.test(s)) return s;
    return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
};

const buildDerivedMlas = () => {
    const out = [];
    const seenNameKeys = new Set();

    for (const row of VOTER_PROFILES) {
        const mla = row && row.mla;
        if (!mla || !mla.name) continue;

        const ac = acKey(row.constituency);
        const nk = nameKey(mla.name);

        if (CURATED_AC_KEYS.has(ac) || CURATED_NAME_KEYS.has(nk)) continue;
        if (seenNameKeys.has(nk)) continue;
        seenNameKeys.add(nk);

        const party = normalizeParty(mla.party);
        const cleanName = tidyName(String(mla.name).replace(/^(?:Dr\.?|Doctor|Adv\.?|Capt\.?)\s*/i, '').trim());
        const rev = reversedName(cleanName);

        out.push({
            id: `mla-${row.ac_number || 'x'}-${ac}`,
            name: cleanName,
            shortName: cleanName,
            aliases: rev ? [rev] : [],
            role: 'MLA',
            constituency: String(row.constituency || '').replace(/\s*\((?:SC|ST)\)\s*/i, '').trim(),
            district: row.district || '',
            ac_number: row.ac_number || null,
            party,
            side: sideForParty(party, mla.alliance),
            derived: true,
            handles: registryHandles(HANDLE_REGISTRY.people[`ac:${ac}`]),
        });
    }

    return out;
};

const DERIVED_MLAS = buildDerivedMlas();

// ─────────────────────────────────────────────────────────
// TAGGED COLLECTIONS
// ─────────────────────────────────────────────────────────

const CABINET_MINISTERS = tagLeaders(_CABINET_RAW, 'BJP', 'ours');
const PRESIDING_OFFICERS = tagLeaders(_PRESIDING_OFFICERS_RAW, 'BJP', 'ours');
const PARTY_ORG_LEADERS = tagLeaders(_PARTY_ORG_RAW, 'BJP', 'ours');
const NATIONAL_ALLY_LEADERS = tagLeaders(_NATIONAL_ALLY_RAW, 'BJP', 'ours');
const NATIONAL_OPPOSITION_LEADERS = tagLeaders(_NATIONAL_OPPOSITION_RAW, 'INC', 'opposition');

const ALLY_MLAS = tagLeaders(DERIVED_MLAS.filter((m) => m.side === 'ours'), 'BJP', 'ours');
const OPPOSITION_MLAS = tagLeaders(DERIVED_MLAS.filter((m) => m.side === 'opposition'), 'IND', 'opposition');

const MPS = tagLeaders(
    _MPS_RAW.map((m) => ({ ...m, district: '', side: sideForParty(m.party) })),
    'BJP',
    'ours',
);
const ALLY_MPS = MPS.filter((m) => m.side === 'ours');
const OPPOSITION_MPS = MPS.filter((m) => m.side === 'opposition');

const INC_LEADERS = tagLeaders(_INC_LEADERS_RAW, 'INC', 'opposition');
const GGP_LEADERS = tagLeaders(_GGP_LEADERS_RAW, 'GGP', 'opposition');
const JCCJ_LEADERS = tagLeaders(_JCCJ_LEADERS_RAW, 'JCC(J)', 'opposition');
const AAP_LEADERS = tagLeaders(_AAP_LEADERS_RAW, 'AAP', 'opposition');
const BSP_LEADERS = tagLeaders(_BSP_LEADERS_RAW, 'BSP', 'opposition');

const OUR_LEADERS = [
    ...CABINET_MINISTERS,
    ...PRESIDING_OFFICERS,
    ...PARTY_ORG_LEADERS,
    ...NATIONAL_ALLY_LEADERS,
    ...ALLY_MLAS,
    ...ALLY_MPS,
];

const byParty = (code) => (l) => normalizeParty(l.party) === code;

const OPPOSITION_PARTIES = [
    {
        id: 'inc',
        name: 'INC',
        full_name: 'Indian National Congress',
        aliases: ['Congress', 'INC', 'Chhattisgarh Congress', 'CG Congress', 'INC Chhattisgarh', 'CGPCC', 'Chhattisgarh Pradesh Congress Committee', 'Indian National Congress', 'Hand symbol party'],
        alliance: 'INDIA',
        handles: ['@INCChhattisgarh'],
        leaders: [...INC_LEADERS, ...OPPOSITION_MLAS.filter(byParty('INC')), ...OPPOSITION_MPS.filter(byParty('INC')),
            ...NATIONAL_OPPOSITION_LEADERS.filter(byParty('INC')),],
    },
    {
        id: 'ggp',
        name: 'GGP',
        full_name: 'Gondwana Gantantra Party',
        aliases: ['GGP', 'Gondwana Gantantra Party', 'Gondwana Ganatantra Party', 'Gondvana Gantantra Party', 'Gongpa'],
        alliance: 'None',
        handles: [],
        leaders: [...GGP_LEADERS, ...OPPOSITION_MLAS.filter(byParty('GGP')),],
    },
    {
        id: 'jccj',
        name: 'JCC(J)',
        full_name: 'Janta Congress Chhattisgarh (J)',
        aliases: ['JCC(J)', 'JCCJ', 'Janta Congress Chhattisgarh', 'Janata Congress Chhattisgarh', 'Jogi Congress', 'Jogi party'],
        alliance: 'None (merger with INC applied for Dec 2024, pending)',
        handles: ['@officialjccj'],
        leaders: [...JCCJ_LEADERS, ...OPPOSITION_MLAS.filter(byParty('JCC(J)')),],
    },
    {
        id: 'aap',
        name: 'AAP',
        full_name: 'Aam Aadmi Party',
        aliases: ['AAP', 'AAP Chhattisgarh', 'Aam Aadmi Party', 'Broom party'],
        alliance: 'None',
        handles: ['@AAPChhattisgarh'],
        leaders: [...AAP_LEADERS, ...OPPOSITION_MLAS.filter(byParty('AAP')),
            ...NATIONAL_OPPOSITION_LEADERS.filter(byParty('AAP')),],
    },
    {
        id: 'bsp',
        name: 'BSP',
        full_name: 'Bahujan Samaj Party',
        aliases: ['BSP', 'Bahujan Samaj Party', 'Elephant party'],
        alliance: 'None',
        handles: [],
        leaders: [...BSP_LEADERS, ...OPPOSITION_MLAS.filter(byParty('BSP')),
            ...NATIONAL_OPPOSITION_LEADERS.filter(byParty('BSP')),],
    },
];

/** Opposition-leaning Independents have no party entity; they still need a camp. */
const OTHER_OPPOSITION_LEADERS = OPPOSITION_MLAS.filter(byParty('IND'));

const OPPOSITION_LEADERS = [
    ...OPPOSITION_PARTIES.flatMap((p) => p.leaders),
    ...OTHER_OPPOSITION_LEADERS,
];

const ALL_LEADERS = [...OUR_LEADERS, ...OPPOSITION_LEADERS];

// Party accounts from the verified registry (parties without an entry keep theirs).
for (const party of [OUR_PARTY, ...ALLY_PARTIES, ...OPPOSITION_PARTIES]) {
    party.handles = mergeHandles(party.handles || [], registryHandles(HANDLE_REGISTRY.parties[party.id]));
}

module.exports = {
    // Meta
    OUR_PARTY,
    ALLY_PARTIES,
    OPPOSITION_PARTIES,
    // Tagged collections
    CABINET_MINISTERS,
    PRESIDING_OFFICERS,
    PARTY_ORG_LEADERS,
    NATIONAL_ALLY_LEADERS,
    NATIONAL_OPPOSITION_LEADERS,
    ALLY_MLAS,
    OPPOSITION_MLAS,
    ALLY_MPS,
    OPPOSITION_MPS,
    INC_LEADERS,
    GGP_LEADERS,
    JCCJ_LEADERS,
    AAP_LEADERS,
    BSP_LEADERS,
    OUR_LEADERS,
    OPPOSITION_LEADERS,
    ALL_LEADERS,
    // Helpers
    normalizeHandle,
    normalizeParty,
    sideForParty,
    acKey,
    nameKey,
};
