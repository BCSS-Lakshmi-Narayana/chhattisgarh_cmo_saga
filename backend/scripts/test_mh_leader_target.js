/**
 * test_mh_leader_target — the leader-relative layer must flip the sign for
 * opposition leaders, only when they are the TARGET, and keep own posts and
 * unclear targets out of the score. No database, no LLM.
 *
 *   node backend/scripts/test_mh_leader_target.js
 */
const { classifyLeaderTarget, leaderSentimentFor } = require('../src/utils/mhLeaderTarget');

let pass = 0; let fail = 0;
const t = (name, cond, detail) => {
    if (cond) { pass += 1; console.log(`  ok     ${name}`); } else {
        fail += 1; console.log(`  FAIL   ${name}${detail ? `\n           ${detail}` : ''}`);
    }
};
const TARGET_RULE = 'sentiment-target rule (ally)';
const FALLBACK_RULE = 'ally-based rule';

console.log('\n── the sign convention ─────────────────────────────\n');
t('ally + pro  → positive', leaderSentimentFor('pro', 'ally') === 'positive');
t('ally + anti → negative', leaderSentimentFor('anti', 'ally') === 'negative');
t('opposition + pro  → NEGATIVE', leaderSentimentFor('pro', 'opposition') === 'negative');
t('opposition + anti → POSITIVE', leaderSentimentFor('anti', 'opposition') === 'positive');
t('neutral stays neutral', leaderSentimentFor('neutral', 'opposition') === 'neutral');
t('unrelated carries no sentiment', leaderSentimentFor('unrelated', 'ally') === null);

console.log('\n── the table from the brief ────────────────────────\n');
const run = (o) => classifyLeaderTarget({ rationale: TARGET_RULE, ...o });
let r = run({ stance: 'anti_target', targetEntity: 'Devendra Fadnavis' });
t('Fadnavis attacked → negative, anti-government', r.leader_sentiment === 'negative' && r.government_stance_side === 'anti');
r = run({ stance: 'pro_target', targetEntity: 'Devendra Fadnavis' });
t('Fadnavis praised → positive', r.leader_sentiment === 'positive');
// Attack on an opposition leader is scored pro_target_indirect.
r = run({ stance: 'pro_target_indirect', targetEntity: 'Sharad Pawar' });
t('Sharad Pawar attacked → NEGATIVE for him (pro-government stored)',
    r.leader_sentiment === 'negative' && r.government_stance_side === 'pro' && r.target_camp === 'opposition', JSON.stringify(r));
r = run({ stance: 'anti_target_indirect', targetEntity: 'Sharad Pawar' });
t('Sharad Pawar praised → POSITIVE for him', r.leader_sentiment === 'positive');
r = run({ stance: 'pro_target_indirect', targetEntity: 'Raj Thackeray' });
t('Raj Thackeray attacked → negative', r.leader_sentiment === 'negative');
r = run({ stance: 'anti_target_indirect', targetEntity: 'राज ठाकरे' });
t('Raj Thackeray praised (Devanagari) → positive', r.leader_sentiment === 'positive', JSON.stringify(r));

console.log('\n── only when he is the TARGET ──────────────────────\n');
// "Sharad Pawar says Fadnavis failed": names Pawar, targets Fadnavis.
r = run({ stance: 'anti_target', targetEntity: 'Devendra Fadnavis', leadersNamed: ['mh-fadnavis', 'mh-sharad-pawar'] });
t('target Fadnavis → keyed to Fadnavis, not Pawar',
    r.target_leader_key && r.target_leader_name === 'Devendra Fadnavis');

console.log('\n── unclear is kept apart, not scored ───────────────\n');
r = run({ stance: 'anti_target', targetEntity: '' });
t('missing target → unclear', r.status === 'unclear' && r.leader_sentiment === null && r.reason === 'target_missing', JSON.stringify(r));
r = run({ stance: 'anti_target', targetEntity: 'Government of Maharashtra' });
t('"Government of Maharashtra" is not a leader → unclear', r.status === 'unclear' && r.leader_sentiment === null, JSON.stringify(r));
r = run({ stance: 'anti_target', targetEntity: 'Shinde' });
t('bare surname never resolves', r.status === 'unclear', JSON.stringify(r));
r = run({ stance: 'anti_target', targetEntity: 'Pawar' });
t('bare "Pawar" never resolves', r.status === 'unclear', JSON.stringify(r));
r = run({ stance: 'unrelated', targetEntity: 'Devendra Fadnavis' });
t('unrelated stance → unclear, no sentiment', r.status === 'unclear' && r.leader_sentiment === null);

console.log('\n── fallback rule needs ONE named leader ────────────\n');
r = classifyLeaderTarget({ stance: 'anti_target', targetEntity: 'Eknath Shinde', rationale: FALLBACK_RULE, leadersNamed: [] });
t('fallback, nobody named in text → unclear', r.status === 'unclear', JSON.stringify(r));
r = classifyLeaderTarget({ stance: 'anti_target', targetEntity: 'Eknath Shinde', rationale: FALLBACK_RULE, leadersNamed: ['mh-eknath-shinde'] });
t('fallback, exactly that leader named → targeted', r.status === 'targeted' && r.leader_sentiment === 'negative', JSON.stringify(r));
r = classifyLeaderTarget({ stance: 'anti_target', targetEntity: 'Eknath Shinde', rationale: FALLBACK_RULE, leadersNamed: ['mh-eknath-shinde', 'mh-fadnavis'] });
t('fallback, two leaders named → unclear (could be either)', r.status === 'unclear', JSON.stringify(r));
r = classifyLeaderTarget({ stance: 'pro_target', targetEntity: 'mh-eknath-shinde', rationale: FALLBACK_RULE, leadersNamed: ['mh-eknath-shinde'] });
t('a roster KEY as target resolves (hostile-lexicon path)', r.status === 'targeted', JSON.stringify(r));

console.log('\n── own posts ───────────────────────────────────────\n');
r = run({ stance: 'pro_target_indirect', targetEntity: 'Sharad Pawar', authorHandle: '@PawarSpeaks' });
t('Pawar posting about himself is flagged own and not scored', r.is_own_post === true && r.leader_sentiment === null, JSON.stringify(r));
r = run({ stance: 'pro_target', targetEntity: 'Devendra Fadnavis', authorHandle: 'Dev_Fadnavis' });
t('Fadnavis own post → own, not scored', r.is_own_post === true && r.leader_sentiment === null);
r = run({ stance: 'pro_target', targetEntity: 'Devendra Fadnavis', authorHandle: 'mieknathshinde' });
t('another leader posting about Fadnavis is NOT his own post', r.is_own_post === false && r.leader_sentiment === 'positive' && r.author_leader_key === 'mh-eknath-shinde', JSON.stringify(r));

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
