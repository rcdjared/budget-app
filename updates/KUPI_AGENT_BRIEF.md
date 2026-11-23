# Kupi Assistant: Agent Brief

Read this first, then work on **one phase at a time**. Source of truth for the plan is `Kupi_Offline_Assistant_Master_Roadmap_and_Training_Plan.md`; this brief tells you how to work and what the data pack guarantees.

## 1. The one rule

The conversation can be fuzzy; the writes cannot. Language understanding produces a typed, validated action. Code does the math and touches the database. No number in any reply comes from anywhere except computed facts.

`text → normalize → parse → resolve against DB snapshot → propose action → preview/confirm → commit via repository → undo stack → response (template + mood)`

## 2. Global rules (paste on top of every phase)

1. Pure core in `src/kupi/`: no React, no Dexie, no network, no `Date.now()`/`Math.random()`. Inject `now` and a seeded RNG.
2. Money is integer centavos (`Centavos`). Never floats. Dates are `YYYY-MM-DD` in Asia/Manila (UTC+8).
3. All thresholds come from `KUPI_CONFIG` in `contracts.ts`. Never inline a number like 0.85 or 60.
4. `contracts.ts` is types and constants only. Change it deliberately, in its own commit.
5. Writes go through the existing repository layer only. Every undo writes a new, higher `updatedAt`.
6. Accounts and categories are **user-defined at runtime**. Seed names are defaults; always match against the live snapshot.
7. Never guess a destructive target. Ambiguous edit/delete returns up to 3 candidates.
8. Each phase ends with: `pnpm test && pnpm build`, a commit, a files-changed list, assumptions, and a **stop**. Do not start the next phase.

## 3. Files in this pack and where they go

| File | Destination | Purpose |
| --- | --- | --- |
| `contracts.ts` | `src/kupi/contracts.ts` | Shared types and `KUPI_CONFIG` |
| `golden.jsonl` | `fixtures/golden.jsonl` | 211 labeled utterances (this pack extends the original 171) |
| `kupi_templates.json` | `src/kupi/responses/templates/kupi_templates.json` | 148 response templates, persona-linted |
| `kupiTraining.test.ts` | `src/kupi/__tests__/kupiTraining.test.ts` | Data lint, persona lint, parser scoreboard |

Paths are hard-coded relative to `process.cwd()` in the test; adjust the three constants at the top if the repo layout differs.

## 4. Golden set contract

Each line: `{ id, text, now?, context?, expect, tags[], source, legacy? }`. `now` defaults to `2026-11-24T12:00:00+08:00` (a Tuesday).

`expect` keys the scorer understands: `intent`, `tier`, `amountCentavos`, `category`, `account`, `toAccount`, `date`, `feeCentavos`, `flags[]`, `missing[]`, `alternatives{}`, `items[]` (compound), `target`, `edit`, `candidates[]`, `query`, `unsupported`, `mustNotIntent[]`.

- `tier` is the confidence zone: `auto` ≥ 0.85, `confirm` 0.50–0.85, `ask` = missing or ambiguous slot, `fallback` < 0.50. Tier is about parser confidence, **not** write policy: edits, deletes, transfers and income still always show a Before → After card.
- `legacy: "gap"` marks cases the old `src/domain/parser.ts` fails (34 of the original 171). Informational scoreboard only. The 40 new `x*` cases have **not** been run against the legacy parser, so none carry that flag.
- Hold-out: `isHoldout(id)` (FNV-1a of the id, `% 5 === 0`) is frozen at roughly 20%. **Never tune on hold-out cases.** Never change the hash. The test pins ten ids.
- Report hand-written and synthetic accuracy separately. When you add cases, add them to the tune set conceptually (new ids), and fix the lexicon or rule, not the expectation.

## 5. Decisions already made (do not re-litigate)

- `cancel`: bound to a `pendingAction` → `CANCEL`. Otherwise `CLARIFY` (ask), never a delete (f16, f17).
- `oo` / `sige` / `yes` / `wag` / `no` only mean CONFIRM/CANCEL with a pending action; otherwise `CLARIFY` (f18).
- `kagabi` / `last night` → yesterday. `kanina` → earlier today, **except** before `lateNightCutoffHour` (04:00), where it is ambiguous: tier `confirm` with both dates as alternatives (d15, d16).
- A weekday equal to today's weekday means last week and lands in `confirm` (d18). `last monday` is ambiguous (x11).
- Times are not amounts: `7pm dinner 450`, `taxi 3pm 450`. Quantities flag ambiguity: `2 coffee 180` → `confirm`, alternatives 36000, flag `quantity`.
- `baon`, `allowance`, `padala`, `deposit`, `bigay` are clarify-first: `confirm` tier with the other reading in `alternatives`.
- A trailing date/account on a compound message applies to the last item and asks unless the user says `pareho` (c04, c05, c08).
- Inline correction wins: `grab 250 mali, 280 pala` → 28000 (k01, k02).
- Words like `delete`, `change`, `undo` inside a merchant or note must not trigger the intent (x05–x07, z05).
- Unsupported asks (`utang`, `split_bill`, `bulk_delete`, `recurring`, `multi_currency`) return `UNKNOWN`, tier `fallback`, with `unsupported` set, and get an honest "not yet" template.
- `huge_amount` (e42) is allowed but must land in `confirm`.

## 6. Persona rules (enforced by tests)

- Facts are preformatted strings from app code. Money arrives **without** `₱`; templates add it.
- Every template's `vars` equals its unique `{placeholders}` in order of first appearance, and every var is in `FACT_KEYS` in the test. Add new fact keys there deliberately.
- Sensitive intents (`DELETE_TXN`, `UNDO`, `UNKNOWN`, `ERROR`, `UNSUPPORTED`) and the tags `remaining_low` / `remaining_over` stay at intensity 1.
- Mood comes from budget state only (`KUPI_CONFIG.mood`), never randomness. A category at 95% never gets the happy emote.
- Max two short sentences plus a card. Never mock money stress: the joke is the crab's panic, not the user's spending. Original wording only; the banned-phrase list in the test catches shaming and copied catchphrases.
- Anti-repeat: no template id in the last `antiRepeatWindow` (5) turns, via `recentTemplateIds` and the seeded RNG.
- Language field is `en` or `en-tl`. The user's personality setting (`chill | classic | dramatic`) caps intensity.

## 7. How to run

```
pnpm vitest run src/kupi/__tests__/kupiTraining.test.ts           # data + persona lint, parser scoreboard if present
KUPI_GATES=1 pnpm vitest run src/kupi/__tests__/kupiTraining.test.ts   # Phase 9 strict gates, 10,000-string fuzz
```

Until `src/kupi/parser/parseKupiInput.ts` exists, the parser block is skipped and the file is green. Once it exists, it prints overall, tune vs hold-out, per-intent, per-source accuracy and every failure with a reason. The parser must export `parseKupiInput(text, sessionContext, dbSnapshot, now) → ParseResult`; the test builds a snapshot from `context.txns` / `context.lastTxn` and a default account/category list, so adjust the `db` object in the test if your snapshot shape differs.

Always-on gates: the parser never throws and never returns a destructive intent on a `mustNotIntent` case. Strict gates (Phase 9): intent ≥ 95%, amount ≥ 99%, 10,000-string fuzz with no NaN, plus the calibration target (auto bucket ≥ 99% correct) which you should measure separately and tune in `KUPI_CONFIG`.

## 8. Current state and next step

- Done in this pack: contracts, 211 golden cases, 148 linted templates, test file.
- Not done: any parser code. Start with **Phase 0 (recon, no code changes)** per the roadmap, then Phase 1 (text foundations).
- Known gaps in the data: golden target is 300+ by Phase 9 (211 now); synthetic and `llm-paraphrase` sources are empty; 49 template combos have fewer than 3 variants (reported by the test, not failed); `x*` cases are hand-written by an AI from the roadmap and should be reviewed by a human who types like the real users.
- Ask the owner about the open decisions in roadmap Section 9 if they are not answered; defaults are in brackets there.
