# Kupi chat: current behavior and architecture

**Reviewed:** 2026-11-25  
**Scope:** The in-app Kupi chat in Kupit, an offline-first React/TypeScript PWA. This is a code-oriented research brief, not a claim that the parser understands unrestricted natural language.

## At a glance

Kupi's default path is deterministic and local. Optional multilingual embeddings and an optional WebGPU local LLM are available behind per-profile settings. Model files download only after opt-in/use; chat text is processed locally and is not sent to a model host. Kupi recognizes supported requests using normalization, number/date parsing, phrase dictionaries, fuzzy matching and explicit dialogue state. It resolves records against the active profile, computes supported answers in code, and uses reviewed templates for responses.

For writes, the rule is: **parse a request → build a typed proposal → validate → show the user a review card → commit only after confirmation**. Chat text alone cannot directly write a transaction. Commits use the local repository path and keep receipts for idempotency and undo.

## User-visible capabilities

| Area | Current behavior |
|---|---|
| Expense and income | Parses supported amounts, category/merchant language, accounts and dates. Supports compound transaction messages where the parser can split each item. Missing required information leads to a question. |
| Transfers | Parses source, destination, amount and supported fee language. Ambiguous source/destination details are requested rather than invented. |
| Edits and deletes | Supports selected ordinary transaction fields and soft-delete flow. Resolves explicit references or offers candidates when supported. Writes require a review card. |
| Confirmation and undo | Confirm/cancel resolves pending review. Recent committed Kupi actions can be undone through compensating repository actions; stale or unavailable reversals are rejected. |
| Money questions | Parses a finite set of statistics queries and computes totals, category breakdowns/rankings, biggest expense, counts, daily average, budget remaining, safe-to-spend, period comparison and net worth from local profile data. |
| Conversation follow-ups | Carries pending confirmation or missing-slot state, last transaction ID, last statistics query, and recent category/account/type for up to six turns. Follow-up answers can fill missing slots and update a query with fragments such as “last month” or “and for transport?”. Focus is memory-only and resets on profile change. |
| Optional Smart assist | E5 multilingual embeddings run in a worker only after opt-in and when rules ask or abstain. They return a similarity hint; a hint cannot create a write proposal. |
| Optional Smart mode | WebLLM Qwen3 0.6B or 1.7B runs in a worker after opt-in and after rules/embedding fallback. WebGPU and storage support are checked. Constrained output is validated against the live profile; model-derived writes still require review and confirmation. |
| Personalization | Local profile-scoped merchant-to-category rules and account aliases; most-used account suggestion; Kupi personality setting. Category corrections can offer to remember a merchant rule. |
| Chat interface | Starter examples, guide, keyboard/safe-area handling, typing state, mascot mood, review cards, undo toast and browser speech-recognition input where supported. |

### What “context” means today

Kupi does **not** feed the whole conversation transcript to the parser. `KupiChatSheet` sends the current text plus `SessionContext` and a snapshot of the active profile to `resolveWithFallback`. `parseKupiInput` remains pure and synchronous; the resolver calls it first. Compact focus includes the previous `StatsQuery` and recent action details with a six-turn expiry.

Rules can merge supported follow-up fragments into the last query. When uncertain, Smart assist can display a suggestion only. Smart mode may fill a supported typed query or transaction draft after strict validation, but it still cannot resolve arbitrary historical references or execute a write without the review/confirm flow. The UI transcript is display state, not model memory.

## Message processing flow

```text
Chat input / speech transcript
        │
        ▼
KupiChatSheet.processMessage
  - checks profile data is loaded
  - handles account/budget setup prompts
  - supplies active-profile snapshot + SessionContext + current time
        │
        ▼
resolveWithFallback (async wrapper; setting-gated)
  parseKupiInput (pure, synchronous core)
  normalize → unsupported/pending reply → query → commands/context edit
  → compound or transaction parse → intent fallback
  if uncertain and enabled: E5 worker → suggestion only
  if still uncertain and Smart mode enabled: WebLLM worker → schema + live-name validation
        │
        ├── query ──► executeStatsQuery ──► computed answer / response template
        ├── missing/ambiguous ──► reducer state + follow-up or candidate UI
        └── write intent ──► proposeAction → validateAction → review card
                                             │ user confirms
                                             ▼
                                      commitAction
                                      local repositories + receipt
                                             │
                          response template / undo affordance
```

### Main implementation map

| File or directory | Responsibility |
|---|---|
| `src/components/kupi/KupiChatSheet.tsx` | Mounted UI and orchestration: profile-scoped live data, session refs, input handling, proposal/review, confirmation, query answers, learning prompt and response wiring. |
| `src/kupi/contracts.ts` | Intent union, parse result, slots and sources, session context, query schema, action types, parser thresholds/config. Money is integer centavos. |
| `src/kupi/text/` | Input normalization, money extraction, date parsing and bounded fuzzy matching. |
| `src/kupi/lexicon/defaults.ts` | Built-in category and account aliases. The parser checks aliases against live profile entities before resolving them. |
| `src/kupi/parser/parseKupiInput.ts` | Deterministic intent and slot parsing; queries, commands, pending replies, edits, compounds, category/account resolution and ambiguity flags. |
| `src/kupi/dialogue/focus.ts` | Six-turn ephemeral focus expiry. |
| `src/kupi/nlu/resolve.ts` | Rules-first async fallback orchestration. |
| `src/kupi/nlu/intentIndex.ts`, `embedder.ts`, `embedding.worker.ts` | E5 semantic hints and browser-cached reference vectors. Profile entity vectors live only in memory and are cleared on profile changes. |
| `src/kupi/nlu/llmParser.ts`, `llm.worker.ts`, `capability.ts` | WebGPU capability check, constrained local Qwen parsing, strict output/name validation, timeout and worker lifecycle. |
| `src/lib/settings.ts`, `src/components/KupitSettingsSheet.tsx` | Per-profile model opt-ins, model selection, loading and deletion controls. |
| `src/kupi/dialogue/reducer.ts` | Pure dialogue state transitions for idle, missing slot, awaiting confirmation and target disambiguation. |
| `src/kupi/actions/propose.ts`, `validate.ts`, `commit.ts` | Typed action creation, profile/data validation, confirmed writes, idempotency receipts and undo. |
| `src/kupi/queries/executeStatsQuery.ts` | Local deterministic query computation over supplied account, budget, category and transaction snapshots. |
| `src/kupi/responses/` | Typed response templates, fact validation, deterministic template selection, anti-repeat state and mood/intensity generation. |
| `src/kupi/learning/learning.ts` | Local merchant/category and account alias rule helpers plus most-used-account selection. |
| `src/kupi/nudges/computeKupiNudge.ts` | Home-screen proactive insights; related to Kupi but separate from chat parsing. |
| `src/components/kupi/KupiChatSheet.test.tsx` | Chat UI/action flow coverage. |
| `src/kupi/parser/parser.test.ts` | Parser unit coverage, including fragment/category behavior. |
| `src/kupi/__tests__/kupiTraining.test.ts`, `fixtures/golden.jsonl`, `kupi_seed_data.json` | Reviewed examples and regression/evaluation tooling. Seed/golden examples are not neural training data. |

## State model and safety boundaries

There are two related state holders:

1. **`DialogueState`** (pure reducer): `idle`, `awaitingSlot`, `awaitingConfirm`, `awaitingDisambiguation`. Missing-slot follow-up count is limited by `KUPI_CONFIG.dialogue.maxQuestions` (currently 2); after that the UI may offer an uncategorized review when safe to do so.
2. **`SessionContext`** (chat component ref, passed to the resolver): pending `confirmAction` or slot draft, last committed transaction ID, ephemeral focus (`lastQuery`, recent category/account/type and a six-turn TTL), response anti-repeat IDs, personality and RNG seed. It resets on profile change and is not persisted as a transcript.

The parser returns a `ParseResult`; it does not mutate the ledger. Model output is untrusted. For a write, the component resolves names to real active-profile records, creates a typed proposal, validates it, and renders a review card. `commitAction` requires `confirmed: true`, re-reads a profile snapshot inside a Dexie transaction, validates again, applies repository operations and records an idempotency receipt. Query numbers are computed by `executeStatsQuery`, never by a model. Undo checks the action receipt and current record before restoring.

The profile snapshot contains the active profile’s accounts, categories, merchant rules and transactions. Queries and transaction actions are therefore constrained to that profile. Response numbers come from computed facts passed into templates; templates do not calculate totals or invent account values.

## Supported language and current limitations

The language layer is a hand-maintained rules system: aliases, cues, token/phrase matching, amount/date parsers, fuzzy matching and confidence/tier decisions. It supports many ordinary English and Taglish forms, but only where the current rules and live profile data recognize them. Confidence does not come from a trained probability model; it is assigned from parser rules and thresholds.

Known boundaries to keep in mind while researching improvements:

- The optional semantic hint and local constrained parser are narrow fallbacks; no free-form generative response exists in the chat path.
- Conversation context is shallow and state-shaped. There is no general topic stack, transcript retrieval, entity coreference model, or durable per-conversation memory.
- A phrase can fail because the user’s live category/account labels differ from built-in aliases, even if the intent is obvious to a person. Learning rules help repeat merchants but do not make the entire language layer self-training.
- Ambiguous language such as “baon,” “deposit,” “allowance” or “padala” needs explicit disambiguation rules; financial writes should remain conservative.
- Supported query metrics and write entity types are finite. Specialized records such as recurring occurrences or split/shared-bill entities require their own action contracts and history behavior.
- Browser speech recognition depends on browser/platform support and may use platform services. Do not assume voice transcription has the same offline guarantee as the text parser.
- The current frozen corpus is only 45 cases, below the target of about 300, and was authored with access to the parser. It is not an independent blind estimate. A larger independently reviewed holdout is required before comparing or shipping model paths.

## Useful research directions

To find prior art relevant to an offline-first finance assistant, research these patterns separately rather than searching only for “offline chatbot”:

- **Task-oriented dialogue systems:** intent classification, slot filling, dialogue state tracking, clarification and confirmation policies.
- **Semantic parsing to typed actions:** natural language to a constrained schema/AST, with deterministic execution and validation.
- **Hybrid retrieval/rules:** fuzzy entity resolution against a user’s local categories, accounts and merchant history; confidence calibration and abstention.
- **Offline/on-device NLP:** compact intent classifiers, quantized models, WebAssembly/WebGPU inference, and tradeoffs for PWA storage, startup time, battery and iOS background limits.
- **Personalization and privacy:** local preference learning, correction capture, per-profile isolation, deletion/export and sync conflict handling.
- **Conversational evaluation:** multi-turn benchmarks, paraphrase/Taglish coverage, frozen train/dev/test splits, calibration metrics, failure taxonomy and human review.
- **Safe tool/action execution:** propose/preview/confirm, idempotency, stale-state checks, audit receipts, compensating undo and permission boundaries.

Example searches: “task oriented dialogue slot filling offline”, “semantic parsing typed actions local assistant”, “on-device intent classification webassembly”, “dialogue state tracking clarification financial assistant”, “confidence calibration abstain intent classifier”, and “multi-turn conversational benchmark slot filling”. Evaluate sources by whether they provide reproducible datasets, multi-turn evaluation, offline constraints and safe action handling—not just a convincing demo.

The first evaluator is in `src/kupi/__tests__/eval/`. Its initial 45-case frozen set is a smoke baseline below the roadmap target and is not an independent blind holdout. See [`eval-baseline.md`](./eval-baseline.md) before interpreting its numbers.

## Suggested improvement loop

1. Record anonymized failure categories locally or in a consented research process; avoid collecting raw financial messages by default.
2. Label the failure: normalization, intent, entity/category, amount/date, context, ambiguity policy, query planning, response, or UI.
3. Add reviewed examples to development coverage. Keep a separate frozen holdout that is never used to tune rules or templates.
4. Compare exact intent/slot accuracy, follow-up completion, false-write proposal rate, abstention quality, latency and bundle/storage cost.
5. Try the smallest intervention first: new lexicon/rule, improved dialogue state, fuzzy entity resolver, then a compact local classifier if the data shows a rules gap. Keep execution and finance arithmetic deterministic.
6. Re-run offline, profile-isolation, stale-action and undo checks before shipping any model or parser change.

## Related project documentation

- [`RECON.md`](./RECON.md) — current roadmap, completed phases, release readiness and known constraints.
- [`Kupi Offline Assistant Master Roadmap and Training Plan.md`](../../Kupi%20Offline%20Assistant%20Master%20Roadmap%20and%20Training%20Plan.md) — broader design decisions and optional future approaches.
- [`profiles-sync-roadmap.md`](../profiles-sync-roadmap.md) — cloud sync and profile scope, separate from chat language understanding.

