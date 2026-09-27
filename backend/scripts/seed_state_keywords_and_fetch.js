/**
 * seed_state_keywords_and_fetch.js
 * ─────────────────────────────────────────────────────────────────────
 * One-shot bootstrap of the Keyword collection for the Chhattisgarh deployment:
 * leaders, parties, verified handles, campaign hashtags and the issues
 * Chhattisgarh political posts revolve around — for both camps, so attacks on the
 * government are caught too. Idempotent — re-running is safe.
 *
 * Monitored ACCOUNTS are seeded separately: `npm run seed:sources`.
 *
 * With --fetch, runs grievanceService.fetchKeywordGrievances for an
 * immediate pull instead of waiting for the scheduler.
 *
 *   node backend/scripts/seed_state_keywords_and_fetch.js
 *   node backend/scripts/seed_state_keywords_and_fetch.js --fetch
 *   node backend/scripts/seed_state_keywords_and_fetch.js --fetch --platform x
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const Keyword = require('../src/models/Keyword');

const RUN_FETCH = process.argv.includes('--fetch');
const platformArgIdx = process.argv.indexOf('--platform');
const PLATFORM = platformArgIdx >= 0 ? process.argv[platformArgIdx + 1] : null;

const KEYWORDS = [
    // Client leadership and cabinet (full names only — bare surnames such as
    // "Sai", "Sao" or "Baghel" are shared by millions)
    'Vishnu Deo Sai', 'CM Sai', 'CM Vishnu Deo Sai', 'Chhattisgarh CM', 'Sai sarkar', 'Arun Sao',
    'Vijay Sharma', 'OP Choudhary', 'Ramvichar Netam', 'Kedar Kashyap', 'Dayaldas Baghel',
    'Lakhan Lal Dewangan', 'Shyam Bihari Jaiswal', 'Laxmi Rajwade', 'Tank Ram Verma', 'Gajendra Yadav',
    'Rajesh Agrawal', 'Guru Khushwant Saheb', 'Raman Singh', 'Kiran Singh Deo', 'Brijmohan Agrawal',

    // Parties
    'BJP Chhattisgarh', 'Chhattisgarh BJP', 'Chhattisgarh Congress', 'CG Congress',
    'Janta Congress Chhattisgarh',

    // Opposition leaders (so attacks on the government are caught)
    'Bhupesh Baghel', 'Deepak Baij', 'Charan Das Mahant', 'TS Singh Deo', 'Kawasi Lakhma', 'Chaitanya Baghel',
    'Sukhdev Bhagat', 'Devendra Yadav', 'Lakheshwar Baghel', 'Amarjeet Bhagat',

    // Verified handles
    '@vishnudsai', '@ChhattisgarhCMO', '@DPRChhattisgarh', '@BJP4CGState', '@KiranDeoBJP', '@ArunSao3',
    '@vijaysharmacg', '@OPChoudhary_Ind', '@INCChhattisgarh', '@bhupeshbaghel', '@DeepakBaijINC',
    '@DrCharandas', '@TS_SinghDeo', '@IYCChhattisgarh', '@CG_Police',

    // Campaign hashtags with evidence of real use
    '#VishnuKaSushasan', '#संवर_रहा_छत्तीसगढ़', '#SushasanTihar2025', '#ViksitChhattisgarh',
    '#MahtariVandanYojana', '#SaveHasdeo', '#nyayyatra', '#माओवादी_कांग्रेस',

    // Issues english
    'Mahtari Vandan', 'Mahtari Vandan e-KYC', 'paddy procurement', 'dhan kharidi', 'MSP 3100',
    'Krishak Unnati Yojana', 'custom milling', 'paddy lifting', 'fertilizer shortage', 'khad sankat',
    'Agristack', 'Naxal free Chhattisgarh', 'Naxal deadline', 'March 2026 deadline', 'Naxal surrender',
    'rehabilitation policy', 'Operation Kagar', 'Abujhmarh', 'Basavaraju', 'Hidma', 'Niyad Nellanar',
    'Bastar Olympics', 'Bastar Pandum', 'Hasdeo Arand', 'Hasdeo', 'Parsa coal block', 'Kente extension',
    'Adani Chhattisgarh', 'tree felling', 'Chhattisgarh liquor scam', 'Mahadev betting app', 'Mahadev app',
    'coal levy scam', 'CGPSC scam', 'PSC scam', 'DMF scam', 'rice scam', 'ED raid Chhattisgarh',
    'EOW Chhattisgarh', 'PM Awas', 'PMAY Chhattisgarh', 'Sushasan Tihar', 'Rajat Mahotsav',
    'Anjor Vision 2047', 'Viksit Chhattisgarh', 'Charan Paduka Yojana', 'tendupatta',
    'Ramlala Darshan Yojana', 'smart meter Chhattisgarh', 'electricity tariff hike', 'bijli bill half',
    'anti-conversion law Chhattisgarh', 'religious conversion Bastar', 'Jhiram Ghati',
    'MGNREGA Bachao Sangram', 'vote chor gaddi chhod', 'Chhattisgarh assembly', 'Chhattisgarh government',
    'Chhattisgarh High Court', 'Nava Raipur',

    // Issues devanagari
    'विष्णु देव साय', 'विष्णुदेव साय', 'मुख्यमंत्री साय', 'साय सरकार', 'विष्णु का सुशासन', 'भाजपा',
    'कांग्रेस', 'भूपेश बघेल', 'दीपक बैज', 'चरणदास महंत', 'अरुण साव', 'विजय शर्मा', 'ओपी चौधरी',
    'किरण सिंहदेव', 'महतारी वंदन', 'महतारी वंदन योजना', 'धान खरीदी', 'धान उठाव', 'समर्थन मूल्य',
    '3100 रुपए क्विंटल', 'कृषक उन्नति योजना', 'खाद संकट', 'यूरिया', 'डीएपी', 'नक्सल', 'नक्सलवाद',
    'नक्सलमुक्त', 'नक्सलमुक्त छत्तीसगढ़', 'माओवादी', 'आत्मसमर्पण', 'पुनर्वास नीति', 'अबूझमाड़',
    'नियद नेल्लानार', 'बस्तर ओलंपिक', 'बस्तर पंडुम', 'हसदेव', 'हसदेव अरण्य', 'पेड़ कटाई', 'शराब घोटाला',
    'महादेव सट्टा ऐप', 'कोयला घोटाला', 'कोल लेवी', 'पीएससी घोटाला', 'सीजीपीएससी', 'डीएमएफ घोटाला',
    'प्रधानमंत्री आवास', 'पीएम आवास', 'सुशासन तिहार', 'रजत महोत्सव', 'अंजोर विजन', 'विकसित छत्तीसगढ़',
    'चरण पादुका योजना', 'तेंदूपत्ता', 'स्मार्ट मीटर', 'बिजली बिल', 'बिजली बिल हाफ', 'धर्मांतरण', 'मतांतरण',
    'झीरम घाटी', 'मनरेगा बचाओ संग्राम', 'वोट चोर गद्दी छोड़', 'छत्तीसगढ़ सरकार', 'छत्तीसगढ़ विधानसभा',
    'छत्तीसगढ़ महतारी',
];

async function upsertKeywords() {
    let added = 0, reactivated = 0, kept = 0;
    for (const raw of KEYWORDS) {
        const kw = String(raw).trim();
        if (!kw) continue;
        let kind = 'keyword';
        if (kw.startsWith('@')) kind = 'handle';
        else if (kw.startsWith('#')) kind = 'hashtag';

        const existing = await Keyword.findOne({ keyword: kw, kind });
        if (existing) {
            if (!existing.is_active) {
                existing.is_active = true;
                await existing.save();
                reactivated += 1;
            } else {
                kept += 1;
            }
            continue;
        }
        await Keyword.create({
            keyword: kw,
            kind,
            category: 'other',
            language: 'all',
            is_party_wide: true,
            is_active: true,
            owner_user_id: 'system_seed',
            weight: 5,
        });
        added += 1;
    }
    return { added, reactivated, kept };
}

async function main() {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing');
    const dbName = process.env.DB_NAME ? String(process.env.DB_NAME).trim() : undefined;
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : undefined);
    console.log(`[seed-cg] connected (db=${dbName || 'default'})`);

    const summary = await upsertKeywords();
    console.log('[seed-cg] keywords:', summary);

    if (RUN_FETCH) {
        const grievanceService = require('../src/services/grievanceService');
        console.log(`[seed-cg] running fetchKeywordGrievances(${PLATFORM ? `'${PLATFORM}'` : 'null /* ALL platforms */'})`);
        const t0 = Date.now();
        try {
            const result = await grievanceService.fetchKeywordGrievances(PLATFORM);
            console.log('[seed-cg] fetch result:', result, 'ms:', Date.now() - t0);
        } catch (err) {
            console.error('[seed-cg] fetch failed:', err.message);
        }
    } else {
        console.log('[seed-cg] (skip fetch — re-run with --fetch to pull content immediately)');
    }

    await mongoose.disconnect();
    console.log('[seed-cg] done');
}

main().catch((err) => { console.error('[seed-cg] failed:', err); process.exit(1); });
