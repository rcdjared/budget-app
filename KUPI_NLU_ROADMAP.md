# Kupi NLU Roadmap: smarter, still offline, still free

Audience: a coding agent (Codex) working in the Kupit repo in VS Code.
Goal: make Kupi chat more context-aware and paraphrase-tolerant without breaking its safety model.

## 0. Ground rules (read first, apply to every phase)

Non-negotiable invariants. Any change that violates one is wrong, even if tests pass.

1. **Write path is unchanged.** Parse -> `proposeAction` -> `validateAction` -> review card -> user confirms -> `commitAction`. No model output may write data directly.
2. **Finance math stays in code.** `executeStatsQuery` computes every number. Models only translate text into typed structures.
3. **`parseKupiInput` stays pure and synchronous.** New async/model logic lives in a new wrapper, `src/kupi/nlu/`, called from `KupiChatSheet.processMessage`.
4. **Model output is untrusted.** Validate against the existing `ParseResult` / `StatsQuery` contracts in `src/kupi/contracts.ts`. Resolve names against the live profile snapshot. Reject anything that doesn't resolve.
5. **Models may only suggest or fill reads, never auto-confirm writes.** Model-derived write intents always show the review card.
6. **Profile isolation.** Nothing from one profile (aliases, focus state, embeddings of merchant names) leaks into another. Reset on `profileId` change, as `sessionRef` already does.
7. **Offline-first and free.** No cloud calls, no API keys, no telemetry of raw chat text. Models are optional downloads; the app must work fully without them.
8. **Money is integer centavos.** Don't introduce floats for amounts.
9. **Smallest change first.** Prefer a new rule or state field over a model. Prefer an embedding over an LLM.

Working agreement: one phase per branch/PR. Run the repo's existing test runner and typecheck before finishing each phase. Add tests next to the code you change.

## Phase 1. Frozen eval harness (do this before anything else)

Why: the current golden set is tuned data, so we can't tell if changes help.

Tasks
- Create `src/kupi/__tests__/eval/` with:
  - `dev.jsonl`: reviewed examples used while tuning.
  - `holdout.jsonl`: **frozen**. Never used to tune rules, prompts, thresholds, or templates. Add a header comment and a test that fails if the file hash changes without an explicit `HOLDOUT_VERSION` bump.
  - `runEval.ts`: runs `parseKupiInput` (and later the NLU wrapper) over a file and prints metrics.
- Holdout composition, target ~300 messages: English, Taglish, typos, compound transactions, edits/deletes, stats queries, ambiguous words ("baon", "deposit", "allowance", "padala"), and **multi-turn cases** (each case = list of turns plus the expected final structured result).
- Each case has an expected intent, slots (amount in centavos, category, account, date), and an expected behavior: `propose`, `ask`, or `abstain`.
- Metrics to print: intent accuracy, slot exact-match, **false-write proposal rate** (proposed a write when expected `ask`/`abstain`, or wrong slot values), abstention quality, follow-up completion rate, p50/p95 latency.
- Save a baseline report to `docs/kupi/eval-baseline.md`.

Done when: `runEval` runs in CI/test, the holdout is hash-locked, and baseline numbers are committed.

## Phase 2. Focus state for follow-up context (rules only, no model)

Why: today's context is only a pending slot/confirmation and a last transaction ID, so "what about last month?" fails.

Tasks
- Extend `SessionContext` in `src/kupi/contracts.ts` with an optional `focus`:
  - `lastQuery?: StatsQuery` (metric, period, filters)
  - `recent?: { category?, account?, period?, type? }`
- Set `focus` after a successful `QUERY_STATS`, and `recent` after a committed or proposed transaction.
- In `src/kupi/parser/parseKupiInput.ts`, add follow-up handling: fragments like "last month", "and for transport?", "how about income?", "same account" merge into `focus.lastQuery` or `recent`, producing a normal `QUERY_STATS` / slot fill. Fragments with no usable focus fall through unchanged.
- Expire `focus` after N turns or on profile change; never persist it.
- Keep the confirm/cancel/undo behavior exactly as is.

Tests: parser unit tests for each follow-up pattern, plus "no focus -> clarify" and "focus resets on profile change".

Done when: dev + holdout multi-turn follow-up accuracy improves, false-write rate does not increase.

## Phase 3. Embedding fallback (free, small, suggestions only)

Model: `multilingual-e5-small` (MIT, 384-d), quantized ONNX (`dtype: 'q8'`, ~118 MB) via `@huggingface/transformers`.
Do **not** use EN+FR vocabulary-pruned builds; they risk Tagalog/Taglish tokens.

Tasks
- Add `src/kupi/nlu/embedder.ts`:
  - Lazy-load only when needed (first fallback, or when the user enables it). Run in a Web Worker. Never block app startup.
  - E5 requires `query: ` / `passage: ` prefixes, mean pooling, L2 normalization.
  - Cache embeddings of reference sentences in IndexedDB, keyed by model version.
- Add `src/kupi/nlu/intentIndex.ts`: embed the golden examples (as `passage:`) once, plus the active profile's category and account names and merchant rules. Nearest-neighbor by cosine similarity, with a calibrated threshold from the dev set.
- Add `src/kupi/nlu/resolve.ts`: `resolveWithFallback(text, context, snapshot, now)`:
  1. Call `parseKupiInput` first. If it returns a confident result, return it untouched.
  2. If tier is `ask`, or intent is `UNKNOWN`/`CLARIFY`, run the embedder.
  3. If the top match is above threshold, return **suggestions** (existing `alternatives` / `pendingIntentChoice` chips, or a category/account "Did you mean?"), never a silent write.
- Wire into `KupiChatSheet.processMessage` behind a `kupiSmartAssist` setting. Add graceful degrade: if the model fails to load, behave exactly like today.
- Settings UI and first-run prompts: implement via the shared "Model download and install UX" section below (build that section together with this phase).

Tests: mock the embedder; test threshold behavior, degrade-on-failure, profile isolation of the index, and that no write proposal is created from embedding output alone.

Gate: ship only if dev + holdout show better intent/slot accuracy on paraphrase and Taglish cases and the false-write rate is unchanged or lower.

## Phase 4. Opt-in "Smart mode" (small local LLM as constrained parser)

Runtime: WebLLM (Apache-2.0, OpenAI-style API, WebGPU).
Models, in order to evaluate: Qwen3-0.6B (default), then Qwen3-1.7B for stronger devices. Use stock Qwen3 builds from WebLLM's official model list. Both Apache-2.0. Avoid "abliterated" or other modified community builds. Gemma models are intentionally excluded (custom license).

Tasks
- Add `src/kupi/nlu/capability.ts`: detect WebGPU, available memory hints, and storage quota. Offer Smart mode only when supported; otherwise stay on Phase 3.
- Add `src/kupi/nlu/llmParser.ts`:
  - Run the engine in a Web Worker; load only after explicit user opt-in.
  - Prompt contains: a short instruction, the intent/slot schema, the profile's live category and account names, the compact `SessionContext` focus, and 5-10 few-shot examples selected by embedding similarity from the dev set.
  - Use WebLLM's JSON-schema / grammar-constrained output if the installed version supports it (verify in its docs); keep the schema flat and small. Constrained decoding costs some accuracy on small models, so measure it.
  - Output is parsed and validated against `ParseResult` / `StatsQuery`. Any invalid, unresolved, or low-confidence output is dropped and the app falls back to Phase 3 / rules.
- `resolveWithFallback` order: rules -> (if unsure) embeddings -> (if still unsure and Smart mode on) LLM. A model-derived write intent always goes to the review card with a "Kupi interpreted this" note, and ambiguity still triggers a question.
- Add a hard timeout (e.g. 4-5 s) with graceful fallback, and a single in-flight request.
- Settings UI: reuse the shared download manager below. Smart mode is always a separate, explicit opt-in (never auto-downloaded), with a model size picker (0.6B / 1.7B).

Tests: mock the engine; test schema rejection, timeout fallback, unresolved-name rejection, that confirm is always required, and that disabling Smart mode restores Phase 3 behavior exactly.

Gate: ship only if, on the **holdout**, Smart mode beats Phase 3 on slot accuracy and has a false-write rate no worse than baseline, and p95 latency is acceptable on a mid-range phone. If 0.6B fails, evaluate 1.7B before abandoning. A LoRA fine-tune on the dev set is a possible follow-up, but fine-tuned weights need their own MLC compile for WebLLM, so treat it as separate scope.

## Model download and install UX (shared by Phases 3 and 4)

Principle: **installing the PWA and downloading models are two separate steps.** "Add to Home Screen" installs only the app shell (a few MB). Models are never part of the install and are never precached in the service worker app shell.

### Install flow

1. User installs the PWA from Safari ("Add to Home Screen"). Kupi works immediately in rules-only mode. No model, no prompt.
2. **Run model downloads from inside the installed app, not from the Safari tab.** On iOS an installed Home Screen app generally has its own storage, separate from Safari, so a model fetched in the browser tab may not carry over. Verify on a real iPhone. If the app is opened in a plain browser tab, skip model prompts and show a small "Install Kupi to enable smart assist" hint instead.
3. The small helper model (multilingual-e5-small, ~120 MB) is prepared through the **helper download policy** below.
4. Smart mode (Qwen3, ~340 MB to ~940 MB) is offered only in Settings (and in one gentle "Make Kupi smarter" card after the helper is ready), only on devices that pass `capability.ts`, and always needs an explicit tap.

### Helper download policy ("middle option")

Goal: most users get the helper without fuss, nobody is surprised by a big download on mobile data.

- Auto-prepare only when **all** are true: installed-app mode, user has not opted out, browser reports a connection that is clearly not cellular and not data-saver (use `navigator.connection` where available: `type` wifi/ethernet, `saveData` false), enough free storage (`navigator.storage.estimate()` with margin), and the app is open and idle. Never start during an active chat turn.
- **Important limitation:** Safari on iOS does not expose the connection API, so Wi-Fi cannot be detected there. On iOS, and whenever connection info is unavailable, do **not** auto-download. Show the one-time consent card instead (below).
- Downloads only run while the app is open. There is no reliable background fetch on iOS Safari, so don't promise "downloads in the background."
- Even when auto-preparing, show a small non-blocking notice: "Kupi is getting its language helper (~120 MB). [Cancel]". Not silent.
- Resume support: store progress so an interrupted download continues rather than restarting (Transformers.js caches completed files; handle partial files and retry with backoff).

### One-time consent card (default on iOS)

Shown once, after the user's first completed transaction or the first time Kupi fails to understand a message (whichever comes first), never during onboarding.

- Copy: "Make Kupi understand more ways of saying things. One-time download, about 120 MB. Works offline afterward. Wi-Fi recommended."
- Buttons: **Download now** / **Later** / **Don't ask again**. "Later" re-asks at most twice, at least 7 days apart.
- Show live progress (bytes and percent), a cancel button, and a clear success state ("Smart assist is ready, works offline").

### Download manager (`src/kupi/nlu/modelManager.ts`)

- One module owns all model state: `notInstalled | downloading(progress) | ready | failed | updateAvailable`, per model id and version.
- Exposes `install(modelId)`, `cancel()`, `remove(modelId)`, `status(modelId)`, `estimateSize(modelId)`.
- Before download: check storage estimate and refuse with a friendly message if space is too low. Check `navigator.onLine`.
- After a successful download: call `navigator.storage.persist()` where supported to reduce the chance of the browser evicting the model. Treat it as a best effort, never a guarantee.
- On startup: verify the cached model is actually present and loadable. If the browser cleared it, set status back to `notInstalled`, fall back to rules, and offer a one-line "Re-download" prompt (don't nag).
- Version key per model; changing the model id/version invalidates old caches and offers an update (never auto-replace a larger model).
- Weights come from the official hosting (Hugging Face CDN) by default. Optionally self-host under your own static hosting to avoid third-party outages, and document the choice.

### Settings screen

Section "Smart assist" with two rows:
- **Language helper** (~120 MB): status, Download / Cancel / Remove, last updated.
- **Smart mode (beta)** (0.6B ~340 MB / 1.7B ~940 MB): shown only if supported; status, size picker, Download / Cancel / Remove; warning that it uses more battery and memory.
- Storage summary: "Smart assist is using X MB of this device."
- Toggle: "Use smart assist" (off = rules only without deleting files).
- Toggle: "Auto-download helper on Wi-Fi" (hidden where Wi-Fi can't be detected).

### Failure and edge cases to handle

- Download fails or is cancelled: app stays in rules-only mode, no error loops.
- Browser evicts storage: detect on next start, recover gracefully.
- Low storage or low memory: hide or disable the option, explain briefly.
- Offline when the user taps Download: say it needs internet once.
- App updated while a model is mid-download: resume or cleanly restart.
- Multiple tabs/windows: single download at a time (use a lock).

### Tests

- Unit-test `modelManager` state transitions with a mocked fetch/cache (success, cancel, failure, resume, eviction detected, low storage).
- Test the auto-prepare decision as a pure function of (install mode, connection info, saveData, storage, opt-out), including the iOS "no connection info" case, which must not auto-download.
- Test that rules-only mode behaves identically whenever status is anything other than `ready`.
- Manual device checklist (record results in the PR): install on iPhone, verify helper downloads from inside the installed app, kill the app mid-download and resume, airplane-mode use after download, clear website data and confirm recovery.

## Phase 5. Hardening and release

- Offline test: install the PWA, load models once, go airplane mode, verify chat still works in every mode.
- Don't precache model weights in the app shell. Use runtime/IndexedDB caching with a version key, and a way to evict.
- Re-run the regression checks: profile isolation, stale-action rejection, undo, idempotency receipts.
- Measure bundle and storage cost; confirm base app size is unchanged when Smart mode is off.
- Memory safety on low-RAM devices: unload the engine when the chat sheet closes (or after idle), and handle load failures without crashing.
- Copy fixes: the chat footer says "AI can make mistakes", which is misleading while the default path is deterministic; reword per mode. Add a short privacy note: chat text never leaves the device in text mode; browser voice input may use platform services.
- Update `RECON.md` and the Kupi chat architecture doc with the new flow and the frozen-holdout rule.

## Suggested order and rough effort

| Phase | Effort | Ships to |
|---|---|---|
| 1 Eval harness | small | internal |
| 2 Focus state | small | everyone |
| 3 Embedding fallback + download UX | medium | everyone (helper via Wi-Fi auto-prepare or one-time consent) |
| 4 Smart mode | large | opt-in, capable devices |
| 5 Hardening | small-medium | release gate |

## Definition of done for the whole effort

- Holdout metrics reported before and after each phase, committed in `docs/kupi/`.
- False-write proposal rate never above the Phase 1 baseline.
- App fully functional with all models absent or disabled.
- No new network dependencies at runtime other than optional one-time model downloads.