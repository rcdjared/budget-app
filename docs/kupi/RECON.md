# Kupi roadmap and current state

**Last reviewed:** 2026-11-25
**Status:** Kupi Phases 0–7 remain implemented. The separate [Kupi NLU roadmap](../../KUPI_NLU_ROADMAP.md) has rules-only focus work implemented and optional embedding/Smart mode paths in code; release validation is incomplete and these model paths are not approved to ship yet.
**Scope:** Kupi assistant behavior, its UI, and release validation. Cloud sync and shared-profile work have a separate roadmap in [`docs/profiles-sync-roadmap.md`](../profiles-sync-roadmap.md).

## Executive summary

Kupit is an offline-first PWA. Kupi parses requests and computes insights from the active profile's local data; transaction changes require review and use the local action/repository path. Default chat needs no model or API key. Optional on-device models can be downloaded after profile-level opt-in; chat text is not sent to model hosts.

## NLU roadmap progress and release status

| NLU phase | State | Evidence / remaining gate |
|---|---|---|
| 1. Frozen eval harness | Implemented, limited | Holdout v1 is hash-locked at 45 cases / 49 turns, below the ~300-message target and not independently blind. |
| 2. Rules-only focus | Implemented | Last query/recent action focus expires after six turns and resets on profile change. Four development focus cases pass; holdout v1 has no query-focus follow-up. |
| 3. E5 embedding fallback | Code implemented, not release-validated | Lazy worker, opt-in, suggestion-only behavior, browser-cache eviction and mocked tests exist. No actual model/device evaluation yet. |
| 4. WebLLM Smart mode | Code implemented, not release-validated | WebGPU gate, opt-in Qwen worker, constrained JSON, profile-name validation, timeout fallback and confirmation review exist. No model/device evaluation yet. |
| 5. Hardening | Incomplete | Need installed-PWA airplane-mode tests, phone latency/memory checks, browser cache-eviction verification, and final profile/undo/idempotency regression. |

**Shipping verdict for the NLU roadmap: no-go.** This is an implementation candidate, not a shippable release. Frozen v1 does not demonstrate Phase 2 focus improvement; model gates have not run with real weights; no installed-PWA airplane-mode or mid-range phone tests have been performed. Keep both model modes disabled by default until these gates pass.

The current rules-only regression run is recorded in [`eval-baseline.md`](./eval-baseline.md). Its false-write proposal rate is 2.2%, but its small, non-blind corpus cannot validate model paths.

The implemented phases are:

| Phase | Scope | Status |
|---|---|---|
| 0 | Repository recon and baseline | Complete |
| 1 | Text, amount, and date foundation | Complete |
| 2 | Structured pure parser and evaluation | Complete |
| 3 | Validated action proposals, commit, and undo | Complete |
| 4 | Dialogue, statistics queries, response templates, and mood | Complete |
| 5 | Chat UI integration | Complete |
| 6 | Home nudges and proactive insights | Complete |
| 7 | Local learning and personalization | Complete |
| 8 | Contextual Q&A and conversation continuity | Partial: ephemeral query/action focus implemented; broader entity references and blind evaluation remain |
| 9 | Additional finance actions | Optional; not started |

**Release gate:** finish real-device iOS/PWA checks in [Release readiness](#release-readiness) before calling the experience production-validated. Final local verification: `pnpm test` (30 files, 191 tests passed) and `pnpm build` (passed; large optional worker/runtime chunks trigger Vite size warnings). The main entry is 1,054.03 kB (307.27 kB gzip); the ~6.1 MB model runtime workers and 26.9 MB ONNX WASM are separate, dynamically loaded assets excluded from the default PWA precache. The generated precache remains 50 entries. These checks do not replace model-on-device or airplane-mode validation.

## Current product behavior

- **Setup and navigation:** first-run guidance points to Wallet, the Wallet Plus button, then Add. When the Add menu opens for the first transaction, Kupi points to both Expense and Income. The duplicate empty-Wallet account CTA is hidden during the Plus tutorial.
- **Chat:** the mounted chat uses profile-scoped accounts, categories, transactions, and budgets. Kupi can parse supported expense/income/transfer requests, ask follow-up questions, answer supported statistics questions, and stage supported transaction changes for review. Optional offline E5 hints and local Qwen Smart mode are opt-in and not yet release-validated.
- **Safety:** transaction changes are validated against the active profile and require explicit review. Undo uses repository-backed compensating actions. Ambiguous or unsupported writes should not be guessed.
- **Home:** one Kupi mascot and dialogue bubble carries the current nudge/insight. Nudges include budget overruns and pacing, daily and combined category-budget pacing, micro-spending, safe-to-spend, no-spend streaks, and no activity. The duplicate category-insight card below Categories was removed.
- **Learning:** merchant-to-category rules, account aliases, most-used-account suggestions, and personality settings are local and profile-scoped.
- **Motion and notifications:** the Reduce Motion & Effects preference and OS reduced-motion preference are supported by the relevant tutorial and Home animations. Notification permission is requested through an explicit user action; the exact iOS installed-PWA behavior still needs device verification.

## Completed phase details

### Phase 0 — Recon and baseline

- Mapped the app's local persistence, transaction write paths, profiles, assistant entry points, and supplied parser/template data.
- Established Vitest and build checks. The current baseline is not a clean pre-Kupi baseline; use present-day runs for regression checks rather than comparing to early counts.

### Phase 1 — Text foundation

- Added normalization, money extraction, bounded fuzzy matching, and date parsing in `src/kupi/text/`.
- Money is handled as integer centavos. Ambiguous quantities, future dates, and uncertain relative dates are represented explicitly instead of silently guessed.
- Kupi date parsing uses Asia/Manila and includes the configured `kanina` cutoff behavior.

### Phase 2 — Structured parser

- `src/kupi/parser/parseKupiInput.ts` produces structured intents, transaction drafts, alternatives, missing slots, and flags without performing writes.
- It supports common expense/income/transfer requests, compounds, edits/deletes, questions, confirmations, cancellations, and follow-up answers.
- `fixtures/golden.jsonl` contains the parser evaluation corpus. The strict gate can also run deterministic fuzz inputs.

### Phase 3 — Safe action layer

- Typed proposals cover supported create, transfer, edit, and soft-delete flows.
- `proposeAction` validates the active profile's current records; `commitAction` revalidates before repository-backed writes and requires confirmation.
- Idempotency receipts and undo protect against duplicate writes and stale reversals. Specialized finance records remain outside the supported Kupi write surface; see Phase 9.

### Phase 4 — Dialogue, queries, responses, and mood

- A dialogue reducer handles missing slots, confirmation, disambiguation, cancellation, and interrupted requests.
- The structured query engine computes supported totals, categories, largest expenses, counts, averages, budget remaining, safe-to-spend, comparisons, and net worth from a caller-scoped snapshot.
- Mood and response templates use explicit facts, configured thresholds, deterministic seeds, and an anti-repeat window. They do not invent facts when a required value is unavailable.

### Phase 5 — Chat UI

- `src/components/kupi/KupiChatSheet.tsx` is the mounted chat UI. It integrates the parser, action service, query engine, reducer, response generator, and local profile data.
- Create/transfer, edit, and delete flows show review or confirmation UI. The UI includes undo, clarification prompts, starter chips, accessible announcements, keyboard/safe-area handling, and mascot states.
- Account and budget setup remain explicit review flows; they are not silently committed as transaction actions.

### Phase 6 — Home nudges

- `src/kupi/nudges/computeKupiNudge.ts` computes profile-scoped, time-aware nudges for budget overruns and pacing, micro-spending, daily safe-to-spend, no-spend streaks, and no activity.
- Daily and combined same-period category budgets can surface a worried pacing nudge; Home shows the nudge in Kupi's bubble and opens chat with that message.
- Nudges use the shared mood engine and Asia/Manila date keys. Rule tests cover priority, cooldown metadata, dates, and deleted/cancelled records.

### Phase 7 — Learning and personalization

- Dexie schema version 8 adds the profile-scoped, local-only `kupiMerchantRules` table.
- Learning helpers support merchant/category rules, account aliases, and most-used-account suggestions. Category edits ask before remembering a merchant rule.
- Settings exposes Kupi personality and learned-rule management; profile deletion removes that profile's rules.

## Roadmap: remaining Kupi work

### Release readiness — required before production validation

1. **iPhone installation:** install from Safari with Add to Home Screen and test the installed PWA, not only the browser tab.
2. **Layout and input:** check safe areas, keyboard/`visualViewport` resizing, and portrait/landscape behavior on a real device.
3. **Accessibility and motion:** verify VoiceOver announcements, focus, touch targets, and both app-level and OS-level Reduce Motion behavior.
4. **Offline behavior:** enable airplane mode, relaunch, ask a supported local question, stage and confirm a transaction, then test undo. Verify unsynced changes remain local.
5. **Notifications:** test permission, denial, unsupported states, and delivery from an installed iOS PWA. Browser permission prompts require a user gesture.
6. **Kupi budget scenario:** use synthetic data to verify a high daily/combined budget ratio produces the worried Kupi nudge, the matching amount/remaining balance, and a useful chat opening message.
7. **Production check:** run `pnpm test` and `pnpm build`; record the known bundle warning separately from functional failures.

### Phase 8 — Contextual Q&A and conversation continuity (partially implemented)

**Goal:** make Kupi reliably understand follow-up questions and references to the user's own records without guessing.

- Preserve the active topic and relevant account/category/transaction candidates across turns; expire or replace context safely when the user changes topics or profiles.
- A first slice is implemented: last stats query and recent action focus live in memory for six turns, parser follow-ups merge supported time/category/type/account fragments, and profile changes reset focus. See the [chat architecture](./CHAT_ARCHITECTURE.md).
- Distinguish account-management questions from transaction edits (for example, “change my account” versus “change my last transaction”). Route account details to Wallet and ask a clarifying question when the target is unclear.
- Expand supported questions using `StatsQuery` and computed local facts: clarify the time range, account, category, budget, or comparison when more than one interpretation is plausible.
- Add reviewed English, Filipino, and Taglish examples for ambiguous terms such as `baon`, `padala`, `deposit`, and `allowance`. Do not silently interpret an uncertain amount or target.
- Keep all answers profile-scoped and local. Continue to require review for any write action.
- Add cross-turn parser/reducer/component tests for topic changes, missing slots, profile switches, uncertain references, and unsupported questions.

**Evaluation setup:** the existing 211-case corpus is regression coverage, not an unbiased measure. The new 45-case holdout v1 is hash-locked but is below the ~300-message target, was not created blind, and contains no query-focus follow-up. Use `KUPI_NLU_ROADMAP.md` and [`eval-baseline.md`](./eval-baseline.md) for phase-specific gates; create a separate human-reviewed blind holdout before making accuracy claims.

### Phase 9 — Additional finance actions (optional, gated)

Only start this phase if users need Kupi to modify more than ordinary transactions.

- Consider friend payments, split/shared-bill changes, and recurring occurrences as separate action types with entity-specific before/after snapshots.
- Reuse repository operations and domain-specific history actions; do not write directly to Dexie tables from chat.
- Specify confirmation, profile ownership, atomicity, undo/restore, and sync-tombstone behavior for each action before enabling it.
- Add failure, stale-data, duplicate-request, undo, and profile-isolation tests. Keep unsupported actions as explicit refusals until their full safety path exists.

## Known constraints and decisions

- **Date consistency:** Kupi's parser/nudges use Asia/Manila, while some general app date helpers use browser-local date parts. Make a single date policy and verify it across browser time zones before expanding date-sensitive queries.
- **Training quality:** the supplied examples are useful regression data, not proof of generalization. Review the corpus for coverage and keep any new holdout separate from tuning.
- **Response variety:** the historical template audit found multiple mood/intensity/language combinations below the three-variant target. This is a copy-quality improvement, not a blocker for deterministic correctness.
- **Supported writes:** Kupi does not currently edit every finance entity. Friend-payment, split/shared-bill, and recurring-occurrence actions need dedicated action flows rather than falling through to ordinary transaction editing.
- **No hosted model requirement:** Phase 8 is designed around the local parser, reducer, query engine, and reviewed response templates. Any future hosted model would require a separate privacy, consent, security, cost, and offline-behavior decision.
- **Cloud sync:** do not infer that this Kupi roadmap completes profile sync or sharing. Follow [`docs/profiles-sync-roadmap.md`](../profiles-sync-roadmap.md) for sync, shared profiles, and portability; the cloud backup setting is not equivalent to a fully validated sync service.

## Development and release setup

### Local development

```powershell
pnpm install
pnpm dev
pnpm test
pnpm build
```

For the strict parser evaluation in PowerShell:

```powershell
$env:KUPI_GATES = "1"
pnpm test
```

The strict gate covers the configured parser corpus and deterministic fuzz inputs. No Supabase credentials or external AI API key are needed for local Kupi development and tests.

### Optional production services

- **PWA hosting:** serve the Vite build over HTTPS; the service worker and install flow require a secure origin.
- **Supabase auth/sync:** follow the environment, migration, and redirect URL steps in [`README.md`](../../README.md). Use only the frontend publishable/anon key in `VITE_SUPABASE_ANON_KEY`; never put a service-role key in the app.
- **Cloud account deletion:** deploy `supabase/functions/delete-account` separately and configure its service-role secret in the Edge Function environment. Test it in a disposable Supabase project before relying on it.
- **Sync validation:** before enabling broader sync, test row-level security, supported-table coverage, conflicts, profile switching, and receipt access on two devices. Shared profiles and multi-user roles remain out of scope until the separate sync roadmap is completed.
