#!/usr/bin/env node
/**
 * seed_grievance_tracking.js
 * ─────────────────────────────────────────────────────────────────────
 * Seeds Mentions (grievance) tracking for the Chhattisgarh deployment:
 *
 *   1. Tracked accounts (Grievances → Sources) — posts that TAG or MENTION
 *      these are fetched. 5 per platform (the app's cap). Added the same way
 *      the UI adds them: X handles are looked up through BluGate for the user
 *      id / name / avatar; Facebook pages are resolved to their numeric page id.
 *   2. Tracking keywords (Grievances → Tracking Keywords, also listed on the
 *      Settings page — both read the same `keywords` collection). Same shape the
 *      UI writes: category 'other', weight 75, party-wide, active; language
 *      'hi' for Devanagari, 'en' for Latin text, 'all' for @handles/#hashtags;
 *      `kind` handle / hashtag / keyword.
 *
 * Idempotent: existing accounts and keywords are left as they are (an inactive
 * keyword is re-activated). Nothing is deleted.
 *
 *   node scripts/seed_grievance_tracking.js --dry-run   show the plan, write nothing
 *   node scripts/seed_grievance_tracking.js             seed accounts + keywords
 *   node scripts/seed_grievance_tracking.js --keywords-only
 *   node scripts/seed_grievance_tracking.js --sources-only
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

const Keyword = require('../src/models/Keyword');
const GrievanceSource = require('../src/models/GrievanceSource');

const DRY = process.argv.includes('--dry-run');
const ONLY_KW = process.argv.includes('--keywords-only');
const ONLY_SRC = process.argv.includes('--sources-only');
const MAX_SOURCES_PER_PLATFORM = 5; // mirrors grievanceController

/* ─── 1. Tracked accounts (verified: data/state_leader_handles.json) ── */
const SOURCES = [
    // X
    { platform: 'x', handle: 'vishnudsai', display_name: 'Vishnu Deo Sai (CM)', designation: 'Chief Minister' },
    { platform: 'x', handle: 'ChhattisgarhCMO', display_name: 'CMO Chhattisgarh', designation: "Chief Minister's Office" },
    { platform: 'x', handle: 'BJP4CGState', display_name: 'BJP Chhattisgarh', designation: 'Party' },
    { platform: 'x', handle: 'KiranDeoBJP', display_name: 'Kiran Singh Deo', designation: 'State President, BJP Chhattisgarh' },
    { platform: 'x', handle: 'vijaysharmacg', display_name: 'Vijay Sharma (Deputy CM)', designation: 'Deputy Chief Minister & Home Minister' },
    // Facebook
    { platform: 'facebook', handle: 'ChhattisgarhCMO', display_name: 'CMO Chhattisgarh', designation: "Chief Minister's Office" },
    // NOT facebook.com/vishnudeosai — that redirects to an unrelated personal profile.
    { platform: 'facebook', handle: 'vishnudeosai1', display_name: 'Vishnu Deo Sai (CM)', designation: 'Chief Minister' },
    { platform: 'facebook', handle: 'BJP4CGState', display_name: 'BJP Chhattisgarh', designation: 'Party' },
    { platform: 'facebook', handle: 'DPRChhattisgarh', display_name: 'DPR Chhattisgarh (Jansampark)', designation: 'Government Public Relations' },
    { platform: 'facebook', handle: 'KiranDeoBJP', display_name: 'Kiran Singh Deo', designation: 'State President, BJP Chhattisgarh' },
];

/* ─── 2. Tracking keywords ────────────────────────────────────────── */
const KEYWORDS = [
    // Leaders and government — English
    'Vishnu Deo Sai', 'CM Sai', 'Sai sarkar', 'Sai government', 'Chhattisgarh CM', 'BJP Chhattisgarh',
    'Arun Sao', 'Vijay Sharma', 'OP Choudhary', 'Kiran Singh Deo', 'Kedar Kashyap', 'Shyam Bihari Jaiswal',
    'Brijmohan Agrawal',
    // Leaders and government — Hindi
    'विष्णु देव साय', 'विष्णुदेव साय', 'मुख्यमंत्री साय', 'साय सरकार', 'भाजपा सरकार छत्तीसगढ़', 'छत्तीसगढ़ सरकार',
    'अरुण साव', 'विजय शर्मा', 'ओपी चौधरी', 'किरण सिंहदेव',
    // Other ministers' / government handles (posts that tag them)
    '@ArunSao3', '@OPChoudhary_Ind', '@drramansingh', '@KedarKashyapBJP', '@ShyamBihariBjp', '@ramvicharnetam',
    '@GajendraYdvBJP', '@brijmohan_ag', '@DPRChhattisgarh',
    // Attack lines in use — Hindi / Hinglish
    'कुशासन', 'साय सरकार फेल', 'सुशासन की पोल', 'विष्णु का सुशासन', 'धान खरीदी में धोखा', 'खाद संकट', 'बिजली बिल',
    'स्मार्ट मीटर', 'महतारी वंदन नाम कटे', 'सूखा नशा',
    // Issues — English
    'paddy procurement', 'fertilizer shortage', 'electricity bill hike', 'smart meter Chhattisgarh', 'Mahtari Vandan e-KYC',
    'Hasdeo', 'CGPSC', 'e-PoS scam',
    // Hashtags verified in use
    '#SaveHasdeo', '#VoteChor', '#MGNREGABachaoSangram', '#VishnuKaSushasan',
];

const kindOf = (kw) => (kw.startsWith('@') ? 'handle' : kw.startsWith('#') ? 'hashtag' : 'keyword');
const languageOf = (kw) => {
    if (kw.startsWith('@') || kw.startsWith('#')) return 'all';
    return /[ऀ-ॿ]/.test(kw) ? 'hi' : 'en';
};

const escapeRx = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function seedKeywords() {
    const out = { added: 0, reactivated: 0, kept: 0 };
    const seen = new Set();
    for (const raw of KEYWORDS) {
        const keyword = String(raw).trim();
        const kind = kindOf(keyword);
        const dedupe = `${kind}:${keyword.toLowerCase()}`;
        if (!keyword || seen.has(dedupe)) continue;
        seen.add(dedupe);

        const existing = await Keyword.findOne({
            keyword: { $regex: new RegExp(`^${escapeRx(keyword)}$`, 'i') },
            kind,
            constituency: null,
        });
        if (existing) {
            if (!existing.is_active) {
                out.reactivated += 1;
                if (!DRY) { existing.is_active = true; await existing.save(); }
                console.log(`  REACTIVATE ${kind.padEnd(8)} ${keyword}`);
            } else {
                out.kept += 1;
            }
            continue;
        }
        out.added += 1;
        console.log(`  ADD        ${kind.padEnd(8)} ${languageOf(keyword).padEnd(3)} ${keyword}`);
        if (!DRY) {
            await Keyword.create({
                keyword,
                kind,
                category: 'other',
                language: languageOf(keyword),
                weight: 75,
                is_party_wide: true,
                constituency: null,
                is_active: true,
                owner_user_id: 'system_seed',
            });
        }
    }
    return out;
}

async function seedSources() {
    // Loaded lazily: they reach BluGate, which the keyword-only path never needs.
    const grievanceService = require('../src/services/grievanceService');
    const rapidApiFacebookService = require('../src/services/rapidApiFacebookService');
    const out = { added: 0, kept: 0, skipped_cap: 0, lookup_failed: 0 };

    for (const s of SOURCES) {
        const clean = s.handle.replace(/^@/, '').trim();
        const existing = await GrievanceSource.findOne({
            platform: s.platform,
            $or: [
                { handle: { $regex: new RegExp(`^@?${escapeRx(clean)}$`, 'i') } },
                { display_name: s.display_name },
            ],
        });
        if (existing) { out.kept += 1; console.log(`  KEEP   ${s.platform.padEnd(8)} ${s.handle}`); continue; }

        const count = await GrievanceSource.countDocuments({ platform: s.platform });
        if (count >= MAX_SOURCES_PER_PLATFORM) {
            out.skipped_cap += 1;
            console.log(`  SKIP   ${s.platform.padEnd(8)} ${s.handle} — ${MAX_SOURCES_PER_PLATFORM} ${s.platform} accounts already tracked`);
            continue;
        }

        let profile = null;
        let finalHandle = s.platform === 'x' ? `@${clean}` : clean;
        if (!DRY) {
            try {
                if (s.platform === 'x') {
                    profile = await grievanceService.fetchUserProfile(clean);
                } else {
                    profile = await rapidApiFacebookService.fetchPageDetails(clean);
                    if (profile?.id) finalHandle = String(profile.id);
                }
            } catch (err) {
                console.warn(`    lookup failed for ${s.handle}: ${err.message}`);
            }
            if (!profile) out.lookup_failed += 1;
        }

        out.added += 1;
        console.log(`  ADD    ${s.platform.padEnd(8)} ${s.handle}${finalHandle !== s.handle && finalHandle !== `@${clean}` ? ` → ${finalHandle}` : ''}${DRY ? '' : profile ? ' (profile found)' : ' (profile lookup failed — saved with the name below)'}`);
        if (!DRY) {
            await GrievanceSource.create({
                handle: finalHandle,
                display_name: s.display_name || profile?.name || clean,
                profile_image_url: profile?.profileImageUrl || profile?.image,
                x_user_id: s.platform === 'x' ? profile?.id : undefined,
                is_verified: profile?.isVerified || profile?.is_verified || false,
                department: 'Government',
                designation: s.designation,
                platform: s.platform,
                created_by: 'system_seed',
            });
        }
    }
    return out;
}

(async () => {
    if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI missing in backend/.env');
    await mongoose.connect(process.env.MONGODB_URI, { dbName: process.env.DB_NAME });
    console.log(`${DRY ? '[DRY RUN] ' : ''}Seeding Mentions tracking into db "${process.env.DB_NAME}"\n`);

    if (!ONLY_KW) {
        console.log('Tracked accounts:');
        const s = await seedSources();
        console.log(`  → added ${s.added}, already there ${s.kept}, skipped (cap) ${s.skipped_cap}${DRY ? '' : `, profile lookups failed ${s.lookup_failed}`}\n`);
    }
    if (!ONLY_SRC) {
        console.log('Tracking keywords:');
        const k = await seedKeywords();
        console.log(`  → added ${k.added}, re-activated ${k.reactivated}, already there ${k.kept}\n`);
    }
    console.log(DRY ? 'Dry run — nothing written.' : 'Done. The Mentions auto-fetch picks these up on its next run (every 10–30 min).');
    await mongoose.disconnect();
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
