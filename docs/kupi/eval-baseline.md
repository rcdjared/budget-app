# Kupi NLU evaluation baseline

**Recorded:** 2026-11-25  
**Evaluator:** `src/kupi/__tests__/eval/runEval.ts`  
**Frozen file:** `src/kupi/__tests__/eval/holdout.jsonl`  
**Holdout version:** 1  
**SHA-256:** `130e2b95d731971ced0cf8b226e5ec6906e99b33c7fc4aa1c0c00d00fbe0a743`

## Initial results

| Metric | Frozen set | Development set |
|---|---:|---:|
| Cases / messages | 45 / 49 | 12 / 13 |
| Intent accuracy | 97.8% | 91.7% |
| Slot exact-match | 97.4% | 90.0% |
| False-write proposal rate | 2.2% | 8.3% |
| Abstention quality | 100.0% | 100.0% |
| Follow-up completion | 100.0% | 100.0% |
| Parser latency p50 / p95 | 2.963 / 7.743 ms | 3.395 / 4.998 ms |

## Rules-context phase run

**Recorded:** 2026-11-25, after adding short-lived focus state. The frozen file and its version/hash are unchanged.

| Metric | Frozen set v1 | Development set |
|---|---:|---:|
| Cases / messages | 45 / 49 | 17 / 22 |
| Intent accuracy | 97.8% | 94.1% |
| Slot exact-match | 97.4% | 92.9% |
| False-write proposal rate | 2.2% | 5.9% |
| Abstention quality | 100.0% | 100.0% |
| Follow-up completion | 100.0% | 100.0% |
| Parser latency p50 / p95 | 2.997 / 8.165 ms | 1.275 / 4.347 ms |

The four new focus-specific cases are in development data (`last month`, `and for transport?`, `how about income?`, and `same account`) and pass. The four multi-turn cases in frozen v1 cover existing transaction slot-fill flows, not query-focus carryover. This run does **not** demonstrate the Phase 2 holdout improvement gate. The development set has one existing edit-intent mismatch (`change coffee to 250`).

Embedding and Smart mode model behavior is not included in these results. Their unit tests mock inference; no model was downloaded or benchmarked on a phone. Do not interpret rules-only metrics as approval of model-derived actions.

The frozen run's only expected-result mismatch was `h33`: “change coffee to 250” produced an expense interpretation instead of `EDIT_TXN`. Four ambiguous-income/expense cases requested in the corpus were routed through clarification UI and did not count as write proposals. Latency is a local Vitest run and is not a mid-range phone measurement.

## Important limits

This is an **initial smoke baseline**, not evidence of general accuracy and not yet the roadmap's target of roughly 300 messages. The examples were authored during implementation with access to the current parser and then evaluated; two fixture labels were corrected for the documented date/follow-up semantics before the hash was locked. It is therefore not an independent blind holdout. Keep it frozen for regression checks, but do not use these numbers alone to approve an embedding or LLM gate. Build a separately human-reviewed, blind holdout before making comparative accuracy claims.

The false-write rate here is the count of write proposals that conflict with expected behavior, intent or expected slots, divided by all cases. The evaluator mirrors the chat's pre-proposal gates: missing slots, `ask`/`fallback` tiers, alternatives and target candidates are treated as clarification and not a proposal. It does not execute `proposeForResult` against every full persisted-record state, so action validation, profile isolation, stale writes, commit and undo remain covered by their own tests.

## Reproduction

```powershell
pnpm kupi:eval
pnpm test
pnpm build
```

The hash assertion is in `src/kupi/__tests__/eval/runEval.test.ts`. A deliberate holdout replacement requires reviewing the new examples, incrementing `HOLDOUT_VERSION`, updating `HOLDOUT_SHA256`, and recording a new baseline report. Do not adjust parser rules, confidence thresholds or response templates to improve this frozen set.

