# Who posts against the nine Maharashtra leaders

Companion to `backend/src/data/mh_adversary_handles.json`.

## The thing to understand before reading the roster

For the BRS deployment there was one client, so "adversary" meant one set of accounts. **There is no client here.**

The nine span the governing Mahayuti (Fadnavis, Eknath Shinde, Sunetra Pawar, Shrikant Shinde), the opposition (Sharad Pawar, Rohit Pawar, Aaditya Thackeray, Raj Thackeray) and one non-party agitator (Jarange Patil). An account attacking Fadnavis is pro-opposition. An account attacking Sharad Pawar is pro-government.

**The same handle is hostile to some of the nine and friendly to others.** `@BJP4Maharashtra` is Fadnavis's main amplifier *and* the main source of attacks on Sharad Pawar. `@NCPspeaks` is the mirror image.

So the roster records, for every account, **which of the nine it targets**. A flat "12 adversary accounts" number would be meaningless, and would let a report imply the nine share an enemy.

## The dominant dynamic is not government vs opposition

It's two parties that each split in half and now fight over the same name, symbol and legacy:

- **Shiv Sena** — Eknath Shinde vs Uddhav Thackeray. The ECI gave Shinde the name and the bow-and-arrow in February 2023.
- **NCP** — Ajit Pawar vs Sharad Pawar.

The fiercest targeting is between the mirror pairs, not across the normal aisle, and it's personal.

**The single sharpest relationship in the dataset:** `@supriya_sule` is Sharad Pawar's daughter, Ajit Pawar's cousin, and Sunetra Pawar's sister-in-law — and she **beat Sunetra Pawar in Baramati in 2024 by 158,333 votes**, the first direct electoral contest between two members of the Pawar family.

Note the asymmetry there: **Supriya Sule 1.74M followers, Sunetra Pawar 34K.** A 50× gap. Any share-of-voice comparison that ignores it will read as Sunetra Pawar being ignored, when she is simply out-amplified.

## What is verified, and what is not

Every handle was fetched live from `api.fxtwitter.com` and its bio read. That establishes **identity**. It does not establish **behaviour** — a profile can't show what an account posted last week. The roster records *why* an account is expected to attack a given target, never that a post was observed.

**One bio in the roster is already stale and would mislead:** `@AjitPawarSpeaks` still reads "Deputy Chief Minister", an office he left on 28 January 2026. A bio is evidence of identity, never of current role.

## What could not be established

**The Shiv Sena (Shinde faction) official party handle.** Eight variants probed — `ShivSena`, `ShivsenaOfficial`, `Shivsena_Office`, `BalasahebanchiSS`, `ShivSenaOfficial_`, `ShivSena_Shinde`, `OfficialShivSena`, `ShivsenaOnline` — every one missing or a low-follower namesake (one is "Shivsena Rajasthan", another has 70 followers). The party obviously has one. It is deliberately absent rather than guessed: a wrong party handle mis-attributes an entire party's output.

**The ~429 handles Maharashtra Cyber flagged** in July 2026 as AI-generated and deepfake content around the CJP protests, roughly 100 operating from outside India. Documented as a network, but no handles were published, so nothing can be recorded.

**Anonymous, meme and troll accounts** — the real gap, and what the prompts below are for.

---

## Grok prompt 1 — find the accounts actually attacking each leader

Run on Grok, which has live X access. Self-contained; paste as-is.

```text
You are auditing social media accounts for a political monitoring platform
covering MAHARASHTRA, India.

These nine people are being monitored. They are NOT one team - they are on
opposing sides, and that is the point:

GOVERNING ALLIANCE (Mahayuti):
  Devendra Fadnavis - Chief Minister (BJP) - @Dev_Fadnavis
  Eknath Shinde - Deputy CM (Shiv Sena) - @mieknathshinde
  Sunetra Pawar - Deputy CM (NCP) - @SunetraA_Pawar
  Dr Shrikant Shinde - MP Kalyan (Shiv Sena), son of Eknath Shinde - @DrSEShinde

OPPOSITION:
  Sharad Pawar - President, NCP (Sharadchandra Pawar) - @PawarSpeaks
  Rohit Pawar - MLA Karjat-Jamkhed (NCP-SP) - @RRPSpeaks
  Aaditya Thackeray - Shiv Sena (UBT) - @AUThackeray
  Raj Thackeray - MNS, allied with Uddhav Thackeray since Dec 2025 - @RajThackeray

NEITHER:
  Manoj Jarange Patil - Maratha reservation agitation leader, no party

TASK. Using live X data, for EACH of the nine separately, identify accounts
that ACTIVELY AND REPEATEDLY POST CONTENT ATTACKING THAT PERSON, over the
LAST 90 DAYS.

⚠ ANSWER PER PERSON, NOT AS ONE LIST. An account hostile to Fadnavis is
probably friendly to Aaditya Thackeray. I need to know which way round each
account points, for each target. Do not merge them.

EVIDENCE RULES - these matter more than completeness:
- Report only accounts you can currently see on X. If you cannot open the
  profile, omit it and say so.
- "Actively attacking" means you can point to specific posts. For each
  account give at least 2 examples from the last 90 days: date plus post URL
  or a short verbatim quote.
- Do NOT guess or reconstruct handles from a person's name. If you know the
  person but not the handle, list them under "known_person_handle_unknown".
- Do NOT include an account merely because it belongs to a rival party. I
  already have the official party accounts. I want accounts that
  demonstrably post attack content.
- A short honest list beats a long speculative one. Say what you could not
  check.

PRIORITISE, in this order:
1. ANONYMOUS / PSEUDONYMOUS / MEME / "news page" accounts posting attack
   content. This is the gap I cannot fill from profile data - weight your
   effort here.
2. IMPERSONATION and PARODY accounts: handles containing a leader's name,
   "Shiv Sena", "NCP", "MNS" or a party symbol that actually post AGAINST
   that person, or invent quotes and party positions.
3. THE TWO SPLIT PARTIES. Shiv Sena split into Shinde and Uddhav factions;
   NCP split into Ajit Pawar and Sharad Pawar factions. Both halves claim the
   same name and legacy. Find the accounts on each side attacking the other -
   especially anything targeting Eknath Shinde as a traitor, or Sunetra Pawar
   over the Baramati contest against Supriya Sule.
4. MARATHA QUOTA accounts, in both directions: those attacking Manoj Jarange
   Patil, and those using his agitation to attack the government.
5. Accounts attacking Shrikant Shinde specifically - he is an MP and the
   CM-adjacent "dynasty" line is a likely angle.

LANGUAGE. MARATHI MATTERS AS MUCH AS ENGLISH, probably more. Include Marathi
script and romanised Marathi accounts. Note that Marathi and Hindi share the
Devanagari script, so do not assume a Devanagari account is Hindi. Give an
English gloss of one example post for each non-English account.

FOR EACH ACCOUNT, RETURN:
  handle                (without @)
  display_name
  followers             (current)
  total_posts           (current)
  account_created       (month and year if visible)
  anonymous             (true if no real identity is stated or discoverable)
  camp                  (mahayuti | mva | mns | maratha-quota | unaligned | unknown)
  attacks_which_of_the_nine   (list the names - this field is the point)
  supports_which_of_the_nine  (if any - an attacker of one is often a fan of another)
  themes                (e.g. Shiv Sena betrayal, Baramati, Maratha quota,
                         dynasty, corruption, Marathi asmita)
  cadence               (roughly how many attack posts per week)
  example_posts         (>= 2: date + URL or verbatim quote)
  coordination_signals  (identical wording across accounts, burst timing,
                         reply-brigading, near-simultaneous posting - say
                         "none observed" if you see none)

ALSO RETURN as separate sections:
  - known_person_handle_unknown
  - could_not_verify

Output as JSON. End with a plain-English note on your confidence and what you
could not check.
```

## Grok prompt 2 — confirm the roster I already have

```text
For each X handle below, using live X data, tell me:
  (a) is the account active - date of its most recent post;
  (b) over the last 90 days, which of these nine Maharashtra leaders does it
      ATTACK, and which does it SUPPORT:
      Devendra Fadnavis, Eknath Shinde, Sunetra Pawar, Shrikant Shinde,
      Sharad Pawar, Rohit Pawar, Aaditya Thackeray, Raj Thackeray,
      Manoj Jarange Patil;
  (c) roughly what share of its posts are attacks on any of them, with 2
      dated examples;
  (d) if it rarely mentions any of them, say so plainly.

amitmalviya, BJP4Maharashtra, AjitPawarSpeaks, MrsGandhi, BJP4India,
ShivSenaUBT_, OfficeofUT, NCPspeaks, supriya_sule, INCMaharashtra,
INCMumbai, mnsadhikrut

Do not guess. "Could not verify" is a useful answer. I am specifically
testing whether accounts I assumed are hostile actually post attacks, so
"this account rarely mentions them" is as valuable to me as a yes.
```

## Grok prompt 3 — the handles I could not find

```text
Give me the current official X handles, if they exist, for the following.
For each: the handle, follower count, and the exact bio text you used to
confirm it is genuinely them. If you cannot confirm an account is the real
one, say "not found" - do NOT return a namesake, a fan account or a regional
unit of the same name.

1. Shiv Sena (the Eknath Shinde faction, which the Election Commission
   recognised as the official Shiv Sena in February 2023 with the
   bow-and-arrow symbol). NOT Shiv Sena (UBT), whose handle @ShivSenaUBT_
   I already have. NOT Shiv Sena units in other states.
2. The Shiv Sena (Shinde) IT cell / social media cell.
3. The BJP Maharashtra IT cell or social media cell, as distinct from the
   main @BJP4Maharashtra account.
4. The NCP (Ajit Pawar faction) official party account, as distinct from
   @NCPspeaks which belongs to the Sharad Pawar faction.
5. Yuva Sena (the Shiv Sena UBT youth wing Aaditya Thackeray presides over).
6. Manoj Jarange Patil - is @m_jarange_96k (483 followers, 13 posts) really
   his, and does he have a larger or more active account anywhere?
```

## Folding answers back in

Grok's output is **a lead, not a fact**. Before anything enters the roster:

1. Confirm the handle resolves: `curl -s https://api.fxtwitter.com/<handle>` returns `"code":200`. This is the check that rejected `@NRamchanderRao` during the BRS work — 2 followers, bio "sining", not the politician.
2. Read the bio yourself and put what it says in `evidence`.
3. **Fill in `targets` honestly.** This is the field that makes the file useful. An account that attacks Fadnavis is not an "adversary" in general — it is an adversary of one specific person on the list and probably an ally of another.
4. Set `verified_on` to the date you checked.

Anonymous accounts need `anonymous: true` and should keep `camp: "unknown"` unless there is coordination evidence. Alleging an affiliation you cannot demonstrate is the one claim in this file that could rebound on whoever uses it.

## A caution for the report

Do not present a single "attack accounts" total. There is no such number here, because there is no single subject. Report it per leader, and say which camp the attacks come from — otherwise the figure implies the nine share an enemy, which is the opposite of the truth.
