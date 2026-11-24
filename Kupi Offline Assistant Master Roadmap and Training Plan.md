# Kupi Offline Assistant: Master Roadmap and Training Plan

Compiled for Kupit · November 24, 2026 · merges the analysis chat, the Mr. Krabs-inspired persona plan, the starter pack (templates, seed data, mood engine) and your agent roadmap.

## 1. The big picture

**Goal.** Kupi should feel like an LLM (understands Taglish, remembers what you just said, asks sharp follow-ups, never repeats itself) but behave like a ledger (never writes wrong data, never breaks sync, every change can be undone).

**The one rule behind everything:** the conversation can be fuzzy, but the writes cannot. Language understanding produces a typed, validated action. Code does the math and talks to the database. No number in any reply comes from anywhere except computed facts.

`text → normalize → parse → resolve against DB snapshot → propose action → preview/confirm → commit via repository → undo stack → response (template + mood)`

**What "training" means here.** Kupi is a Vite + React + TypeScript PWA that must work fully offline, including on iOS Safari. So "training" is mostly four things, in this order of payoff:

1. A strong deterministic parser with Taglish lexicons (rules, not a neural net).
2. A growing labeled test set that tells you whether each change helps or hurts.
3. A learning loop from real user corrections (merchant rules, alias memory).
4. Optionally, tiny trained classifiers exported as JSON weights, only where the test set proves rules are failing.

## 2. Decisions that reconcile the documents

The earlier chat and your agent roadmap disagree in a few places. Resolved here:

| Topic | Earlier chat | Agent roadmap | **Decision** |
| --- | --- | --- | --- |
| On-device LLM | Optional Phase 5 (0.5B–1.5B model) | Out of scope (iOS PWA memory/storage) | **Out of scope for v1.** Revisit only if you ship a native app. |
| Small ML models | Phase 4: classifier, tagger | Not mentioned | **Optional, after Phase 7**, as tiny JSON-weight models inside the pure TS core (Section 6). No NER/BERT. |
| Fallback for hard messages | On-device LLM | Online LLM (Phase 8), opt-in | **Online fallback is optional and last.** Decide from real unparsed-message data. |
| Intent routing | Scored, not fixed precedence | Weighted cues, calibrated confidence | **Scored with calibrated confidence.** |
| Mood engine | Own phase | Not in roadmap | **Folded into Phase 4 (response generator).** |
| Personality setting | Phase 3 | Not in roadmap | **Phase 7**, next to learned preferences. |

## 3. Architecture and write policy

Pure core in `src/kupi/` (no React, no Dexie, inject `now`, inject RNG), UI in `src/components/kupi/`:

- `text/` normalize, numbers, dates, fuzzy
- `lexicon/` typed data files for intents, categories, merchants, Taglish
- `parser/` parseKupiInput, intent scoring, slots, follow-ups, compound splitting
- `actions/` propose, validate, commit, undo (writes only through the existing repository layer)
- `queries/` plan and execute stats queries
- `dialogue/` pure reducer and slot questions
- `responses/` templates, generator, anti-repeat, **mood engine**
- `nudges/` Home bubble rules
- `learning/` merchant rules and alias memory

**Confidence and write policy** (thresholds in one config file, tuned in Phase 9):

| Situation | What Kupi does |
| --- | --- |
| Log expense, confidence ≥ 0.85, all slots resolved | One-tap confirm card (optional Quick Log setting later: auto-save with 8-second Undo) |
| A slot is missing | One short question with tappable chips; max 2 questions, then offer a best guess |
| Confidence 0.50–0.85 | "Did you mean…?" with best guess plus up to 2 alternatives |
| Confidence below 0.50 or UNKNOWN | Say what wasn't understood, show starter chips, save to local unparsed list |
| Edit, delete, transfer, income | Always Before → After card; never auto-commit |
| Several matches for an edit/delete target | List up to 3 candidates; never guess |

**Intents:** LOG\_EXPENSE, LOG\_INCOME, TRANSFER, EDIT\_TXN, DELETE\_TXN, QUERY\_STATS, CONFIRM, CANCEL, UNDO, SMALLTALK, HELP, CLARIFY, UNKNOWN.

## 4. Kupi's personality

Personality is a layer on top of the pipeline. It never touches parsing or numbers.

**Mood comes from real budget state, never randomness:**

| Budget state | Emote | Attitude |
| --- | --- | --- |
| Logged within budget (category under \~60%), income, no-spend streaks | happy | Pleased, smug about savings |
| Category at 80%+, over budget, or a big single expense | worried | Dramatic, protective of the stash |
| Greetings, queries, errors, deletes, nothing happening | idle | Calm, neutral, ready |

The 60–80% band stays idle (plain and calm). The avatar also has a **thinking** state, shown during the typing indicator. That is an activity state, not a mood.

**Intensity** (1 plain, 2 light flavor, 3 full crab drama) is chosen by the mood engine and capped by a user setting: **Chill / Classic Kupi / Dramatic**.

**Voice rules**

- Information first, flavor second. Example shape: "₱180 logged under Food. ₱320 left," plus a small flourish.
- Money-obsessed and frugal, theatrical but short. Max two short sentences plus a card.
- A few crab and shell puns. No heavy pirate slang, so anyone understands.
- Drama only when numbers justify it. Mirror the user's language (English, Tagalog, Taglish).
- **Original lines only.** No show catchphrases, name or likeness. Write Kupi's own recurring bits (a "claws up" for income, a recognizable worried line). If you ever monetize, have someone check the IP side; this isn't legal advice.
- **Never mock money stress.** The joke targets the crab's panic, never the user's spending. "Oh no, Food is at 110%!" is fine. "You spent too much again" is not.
- Sensitive intents (delete, undo, errors, unknown, low-balance questions) stay at intensity 1.

**Template metadata** (every line in the bank):

`{ id, intent, mood, intensity, tags?, language, text, vars[] }`

Target bank size: at least 3 variants per (intent × mood × intensity × language) that actually occurs, 5–6 for LOG\_EXPENSE, then grow from there.

**Emote expansion when art budget allows:** celebrate (goal hit, no-spend week), shocked (very large expense or big overspend), sleeping (long inactivity). Thinking is already planned.

## 5. The phased roadmap

Give your coding agent **one phase at a time**, with the Global Rules from your `Kupi_Assistant_Agent_Roadmap.md` pasted on top. Each phase ends with `pnpm test && pnpm build`, a commit, a files-changed list, assumptions, and a stop. Time estimates assume one person working with an agent; treat them as rough.

**Order:** 0 → 1 → 2 → 3 → 4 → 5 → 7 → 9. Phase 6 can run any time after Phase 0. Phase 8 is optional and last. The golden set starts in Phase 2 and grows every phase.

### Phase 0: Recon (2–3 days, no code changes)

Write `docs/kupi/RECON.md`: Dexie schema and migrations, Transaction/Account/Category/Budget types, money and date representation, every transaction write path and where `updatedAt`/`deletedAt` are set, how sync merges, how profiles scope data, existing assistant and Home files, test setup, baseline of `pnpm test` and `pnpm build`, main-bundle size.

**Persona addition:** decide where template JSON will live and add the template metadata schema to the contracts.

**Done when:** RECON.md exists, source untouched, baseline recorded, open questions listed.

### Phase 1: Text foundations (about 1 week)

Pure, heavily tested modules:

- **normalize:** lowercase, collapse whitespace, unify peso markers (₱, php, p, pesos, piso), tokenize with offsets.
- **numbers:** ₱1,250.50, 1.5k, 30k, p50, Tagalog words (singkwenta, sandaan, limang daan, isang libo). Return all candidates with spans. Exclude times (7pm, 5:30), dates (Nov 20, 11/20) and quantities (2 coffee), which flag ambiguity.
- **dates:** inject `now` (Asia/Manila, UTC+8). today/ngayon, kahapon, kanina, kagabi, weekdays (last Friday, nung Lunes), 3 days ago, Nov 20, 11/20. Flag future dates.
- **fuzzy:** hand-rolled Jaro-Winkler or Damerau-Levenshtein, no dependency. Alias matching against **runtime** account and category names, since users create their own.
- **lexicon/:** typed data files seeded from the starter pack.

**Gate:** table-driven tests for every function; property test that random strings never throw and never return NaN.

### Phase 2: Parser (about 2 weeks)

`parseKupiInput(text, sessionContext, dbSnapshot, now) → ParseResult`, deterministic, no network.

- Intent scoring with weighted cues (verbs, sentence shape, entities present), calibrated confidence, top 3 as `alternatives`. No fixed precedence: "delete" inside a merchant or note must not trigger deletion.
- Required-slots table per intent. Defaults (merchant rule, last-used account) must be visible on the confirm card.
- Follow-ups and coreference: "make that 45", "put it on gcash", "45 na lang", "kahapon pala", "mali, 35 pala". Bare replies (oo, sige, wag, cancel) bind to `pendingAction`.
- Target resolution: "last transport", "yung kanina", "the 180 coffee". Rank by amount, category, merchant, recency; ambiguous returns candidates.
- Compound messages: split on commas, newlines, "tapos", "and". A trailing date or account applies to items lacking one; if unclear, ask.
- Transfers with optional fee: "lipat 500 gcash to gotyme fee 15".
- QUERY\_STATS into a structured `StatsQuery { metric, groupBy, period, filters }`.

**Gate:** at least 150 golden cases (up from the 54 in the starter pack). Parser never throws.

### Phase 3: Action layer (about 1 week)

- `proposeAction` builds `KupiAction[]` with before/after snapshots.
- `validate`: amount > 0, account exists, no same-account transfer, date not far in the future, soft warning for amounts far above the user's norm for that category.
- `commitAction` goes through the repository layer only, one Dexie transaction for multi-row changes, action `id` as idempotency key.
- Undo stack (cap 20): create → soft-delete, update → restore, delete → clear `deletedAt`. **Every undo writes a new, higher `updatedAt`**, otherwise another device's last-write-wins merge reverts it.

**Gate:** fake-indexeddb tests proving monotonic `updatedAt`, tombstones respected, dirty flags set like existing mutations, and a simulated two-device merge (edit → undo) that converges.

### Phase 4: Dialogue, queries, responses and mood (1–2 weeks)

- Pure dialogue reducer: `idle`, `awaitingSlot`, `awaitingConfirm`, `awaitingDisambiguation`. Handle interruptions (user changes topic mid-confirmation).
- Query engine: total, by category, top category, biggest expense, count, daily average, remaining budget, safe-to-spend, vs last period.
- Small talk and help. Unsupported asks (utang, bill splitting) get an honest "not yet".
- **Response generator with the mood engine:** `computeMood(state) → {mood, intensity, tags}`, then `pickTemplate` and `render` from typed `facts` only. Anti-repeat: no template ID reused in the last 5 turns, using `recentTemplateIds` from session context and a **seeded RNG** (the starter JS uses `Math.random` and a module-level `lastUsed`; port it to TypeScript and remove both, per the pure-function rule).

**Gate:** 20 identical inputs give several distinct phrasings with no immediate repeats; no `{{`, `undefined` or `NaN` can leak; every number is traceable to `facts`; mood matches state; sensitive intents never exceed intensity 1.

### Phase 5: Chat UI (about 1 week)

Header "Kupi" with avatar states idle(\public\icons\idle.png), thinking\public\icons\thinking.png, happy(\public\icons\happy.png), worried(\public\icons\worried.png) (respect `prefers-reduced-motion`). 16px minimum input font, safe-area and `visualViewport` handling, starter chips including an edit chip, ConfirmCard, DiffCard, delete card, candidate chips, Undo toast after every commit, a 300–600 ms typing indicator, `aria-live`.

**Gate:** component tests for confirm, edit-diff, delete and undo flows; manual iOS Safari Add to Home Screen checklist including airplane mode.

### Phase 6: Home nudges (3–4 days, parallel track)

`computeKupiNudge(txns, budgets, now) → Nudge[]` with id, priority, cooldown, facts. Rules: critical pacing (category ≥ 80% with many days left), micro-spend velocity (3+ expenses under ₱50 today), daily safe-to-spend, zero-spend streak, budget exceeded, nothing logged today. One bubble at a time, dismissals stored locally. Mood and intensity come from the same mood engine. Tapping opens chat with the nudge as Kupi's first message.

**Gate:** pure tests with a fixed `now` for every rule, priority and cooldown.

### Phase 7: Learning and personalization (about 1 week)

- Profile-scoped `merchantRules` Dexie table with a proper version bump. Sync only if cheap.
- Learn from corrections: "Always file Jollibee under Food?" chip after a category change.
- Alias learning ("my gcash" → GCash) and most-used-account defaults, shown as a **suggestion**, never a silent assumption.
- Frequency defaults (jeep went to Cash 20 times) and time-of-day priors (12 pm "lunch" is Food).
- **Personality setting** (Chill / Classic / Dramatic), streak awareness, repeat-offender memory (Food over budget three months running gets a gentle mention).
- Settings screen to view, edit and delete learned rules, plus clear-all.

**Gate:** migration test from the previous schema; rules never cross profiles; deleting a rule removes its effect immediately.

### Phase 7.5: Tiny trained models (optional, 1–2 weeks)

Only if the Phase 7 logs and golden set show rule failures. See Section 6.

### Phase 8: Online LLM fallback (optional, last)

Supabase Edge Function `kupi-interpret`, key server-side only, signed-in users, rate limit, 6-second timeout. Called only when confidence < 0.5 or UNKNOWN, device is online **and** the user opted in. Send minimal context. Output is strict JSON validated with Zod; any amount must appear literally in the user's text; the LLM never writes, its output goes through the same propose → confirm → commit pipeline. Treat user text as untrusted (prompt injection). Log parser-vs-LLM disagreements locally as new lexicon entries and golden cases.

### Phase 9: Evals, hardening, release (about 1 week)

Golden set of 300+ utterances. Gates: intent accuracy ≥ 95%, amount exact-match ≥ 99%, zero wrong-field writes in confirm-flow tests, 10,000-string fuzz never throws, parser p95 under 20 ms. Offline and two-device sync tests, accessibility pass, `kupiAssistant` feature flag with staged rollout and no telemetry by default, opt-in export of the unparsed list. Docs: ARCHITECTURE.md and a guide for adding lexicon entries. **Persona lint tests** run here too (Section 7).

**Rough total:** 9–11 weeks to a release candidate for Phases 0–7 and 9; add 1–2 weeks each for 7.5 and 8 if you do them.

## 6. Training plan

### 6.1 Golden set format

One JSON line per case in `fixtures/golden.jsonl`:

`{ id, text, context?, now, expect: { intent, amount?, category?, account?, date?, target?, items?, tier }, tags[], source }`

- `tier` is the expected confidence zone: `auto`, `confirm`, `ask`, `fallback`. Ambiguous cases must land in `confirm` or `ask`, not auto.
- `source` is `hand`, `synthetic`, `llm-paraphrase` or `correction`, so you can report accuracy per source.
- `context` carries session state for follow-ups ("make that 45" needs a last transaction).

### 6.2 Where the data comes from

| Source | Size target | Notes |
| --- | --- | --- |
| Starter pack (`golden_tests`) | 54 | Already written. Convert to JSONL. |
| Hand-written real messages | 150 by Phase 2, 300+ by Phase 9 | Messages you and friends would actually type. Highest value. |
| Synthetic generator | Thousands | Templates × merchants × amounts × dates × accounts × Taglish variants. Add typos, dropped spaces, all caps, emoji, shorthand (kape, jeep, pamasahe). |
| Offline LLM paraphrases | A few hundred | Use a big LLM once, offline, to produce natural ways to say each intent in English and Taglish. **Review every line by hand.** No runtime dependency. |
| Real corrections | Grows over time | Store (message, wrong parse, right parse), local only. Your best long-term data. |

**Hold-out discipline.** Freeze 20% as a test set by hashing the case ID, so it never moves. Never tune on it. Report hand-written and synthetic accuracy separately; synthetic scores flatter you.

### 6.3 Coverage checklist (what the data must include)

- Amounts: ₱1,500, 1.5k, 30k, 5 pesos, php 200, p180, tatlong daan, singkwenta.
- Dates: today, kanina, kagabi, kahapon, last Friday, nung Lunes, Nov 20, 3 days ago.
- Ambiguity: "2 coffee 180" (quantity vs total), "7pm dinner 450" (time vs amount), "7-eleven 150", "gcash 500" (account vs merchant), "cash in / cash out" direction, "baon" (allowance vs spending), "padala", "libre" (may be ₱0).
- Compound: "jeep 15, trike 20, coffee 180", "coffee 100 tapos lunch 200".
- Corrections: "grab 250 mali, 280 pala" (correction wins).
- Follow-ups: make that 45, put it on gcash, kahapon pala, wag, oo, sige.
- Edits and deletes with ambiguous targets (two 180 coffees).
- Adversarial: "delete" or "change" inside a merchant or note, emoji, all caps, voice-style run-ons, gibberish, empty string.

### 6.4 Calibration

Confidence must mean something. After each parser change, bucket predictions by confidence and compare to actual accuracy. Tune the 0.85 and 0.50 thresholds so the auto-confirm bucket is correct at least 99% of the time. Wrong money is the worst bug.

### 6.5 The weekly improvement loop

1. Export the local unparsed list and the correction log.
2. Triage: lexicon gap, rule bug, genuine ambiguity, or out of scope.
3. Add each real miss to the golden set (outside the hold-out) and fix the lexicon or rule.
4. Run the suite; compare the per-intent confusion matrix against last week.
5. Merge only if no metric regresses.

### 6.6 Optional tiny models (Phase 7.5)

Train offline in Python, export as JSON weights, run inside the pure TS core. No new runtime dependency, target under 200 KB total.

- **Intent second opinion:** char n-gram TF-IDF + logistic regression. Combines with rule scores; used when rule confidence is low.
- **Merchant → category:** character n-gram naive Bayes or logistic regression, for unseen merchants. Always shown as a suggestion on the card.
- **Not recommended for v1:** BERT-style taggers and on-device LLMs. Amounts, dates and accounts always come from the deterministic extractors, never a model.

**Ship gate:** beats rules-only on the hold-out by a meaningful margin, no drop in amount accuracy, p95 latency still under budget, bundle growth reported.

## 7. Quality targets and tests

| Metric | Target |
| --- | --- |
| Intent accuracy | ≥ 95% |
| Amount extraction | ≥ 99% (starting gate; aim higher) |
| Category accuracy, known merchants | ≥ 95% |
| Edit/undo success on first try | ≥ 90% |
| Silent wrong writes | 0 (everything previewed, everything undoable) |
| Parser p95 latency | < 20 ms |
| Fuzz: 10,000 random strings | never throws, never NaN |
| Auto-confirm bucket correctness | ≥ 99% |

**Persona lint tests**

- Every template has a valid mood, intensity and all declared variables.
- No unfilled `{vars}`, `undefined` or `NaN` in rendered output.
- No response repeats within the last 5 turns.
- Mood matches state (a category at 95% never gets the happy emote).
- Sensitive intents never exceed intensity 1; the user's personality cap is always respected.
- A banned-phrase list catches any shaming wording and any copied show catchphrases.

## 8. Starter pack: what you have and what to fix

- `kupi_templates.json`: the template bank with mood, intensity and variables. Move into `src/kupi/responses/templates/` and add a `language` field.
- `kupi_seed_data.json`: 68 merchants, account aliases, intent keywords, date words, Tagalog numbers, 6 tricky rules, 54 golden tests. Split into typed lexicon files and `golden.jsonl`.
- `kupi_mood_engine.js`: port to TypeScript (see Phase 4).

**Issues found when comparing the starter pack to your roadmap:**

1. The seed lists "cancel" under both DELETE\_TXN and CANCEL. Resolve by context: bound to a `pendingAction` it means CANCEL, otherwise it needs a target to mean delete.
2. "allowance" is both an income keyword and a seed category name, and "baon" is ambiguous. Treat both as clarify-first.
3. Seed categories are hardcoded. Real categories and accounts are **user-defined at runtime**, so use the seed only as defaults and match against the live snapshot.
4. The mood engine uses an intent called `PROACTIVE` that is not in `KupiIntent`. Add it or route nudges separately.
5. The seed's "kanina" is mapped to today only. That matches the roadmap (earlier today), but "kagabi" and "last night" map to yesterday, so test late-night messages around midnight Manila time.
6. The engine leaves some thresholds hardcoded (60%, 80%, 100%, 40% of budget). Move them to the same config file as the confidence thresholds.
7. Seed merchants and test messages are best guesses at Filipino spending habits. Replace anything that doesn't match how you and your users really type.

## 9. Decisions for you

Defaults in brackets; the agent should ask if you haven't answered.

1. **Quick Log** (auto-save with 8-second Undo)? \[Always confirm in v1; add Quick Log later.\]
2. **Online LLM fallback?** \[Ship Phases 0–7 first; decide from real unparsed-message data.\]
3. **Keep chat history between sessions?** \[Session-only.\]
4. **Sync merchantRules across devices?** \[Yes if cheap, else local.\]
5. **Languages:** \[English and Tagalog/Taglish only.\]
6. **Split bills, shared balances, recurring creation via chat?** \[Later.\]
7. **Tiny trained models (Phase 7.5)?** \[Skip until the golden set shows rule failures.\]

**Out of scope for v1:** voice input, receipt scanning, multi-currency, loans/utang, bill splitting in chat, recurring creation in chat, push notifications, on-device LLMs.

## 10. This week's checklist

1. Run Phase 0 (recon) with your agent and record the baseline.
2. Convert the 54 seed tests to `golden.jsonl` and write the scoring script that prints per-intent accuracy.
3. Move lexicons and merchants into typed data files.
4. Start the hand-written message collection toward 150.
5. Draft 3 more variants for every LOG\_EXPENSE mood and intensity, including Taglish, in Kupi's own words.
