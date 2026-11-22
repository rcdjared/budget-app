# Profiles & Sync Phase 1 review

## Verdict

**Safe to ship: no.** The baseline build passes, but there is one confirmed recurrence defect and profile-scoped screens, repositories, and exports still read across profiles. The account-deletion function enforces a five-minute `auth_time` from the JWT passed to `auth.getUser`, but it has no automated runtime/type check in this repository.

## Baseline

- `pnpm build`: passed (`tsc --noEmit` and Vite production build). Vite reports the existing large-chunk warning.
- `pnpm test`: 36 passed, 1 failed across 7 files. `src/__tests__/forecast.test.ts:33-36` fails: expected `2026-11-20`, received `2026-12-1`.

## Findings

### R-01 — High — Profile isolation

- **Evidence:** `src/App.tsx:3135-3157` reads all debts and picks the default profile when creating a debt. `src/App.tsx:3308` reads all categories in the cloud settings component. `src/lib/backup.ts:34-36` exports all transactions, accounts, and categories without a profile filter. `src/db/repositories/transactions.ts:24-29,49-52,76` and `src/db/repositories/accounts.ts:30-31` expose unscoped ID reads and transaction searches.
- **Impact:** Profile-specific screens and backup can show or export another profile's financial data; callers of the repository helpers can read cross-profile records.
- **Minimal fix:** Thread the selected profile ID through these views and export paths, and use `profileRecords`/`getProfileRecord` for lookups.
- **Test to add:** Seed two profiles with distinguishable records and verify each screen, export, and repository helper only returns the requested profile's data.

### R-02 — High — Profile switching across tabs

- **Evidence:** `src/db/repositories/profiles.ts:104-113` stores one device-wide active profile in localStorage; `src/App.tsx:448-452` changes only the current React root's state. There is no `storage` event listener in `src/App.tsx`.
- **Impact:** A switch in one tab does not switch or invalidate the other tab's in-memory `profileId`; two tabs cannot maintain independent active profiles, and the second tab can continue showing stale profile data while the shared active ID points elsewhere.
- **Minimal fix:** Choose and implement a coherent per-tab or synchronized-tab active-profile policy, then reset profile-scoped state on changes.
- **Test to add:** Open two tabs, switch profiles in one, and verify the other tab follows the chosen policy without stale or cross-profile writes.

### R-03 — High — Recurrence advances using the start day

- **Evidence:** `src/domain/recurrence.ts:14-18` calculates monthly due days from `rule.startDate`; the original test fixture paired `startDate: "2026-11-01"` with `nextDueDate: "2026-09-20"` (`src/__tests__/forecast.test.ts`), an invalid schedule that correctly advanced to the anchor day. Separately, `src/domain/forecast.ts` compared raw `nextDueDate` strings, so non-padded input could sort incorrectly.
- **Impact:** The reported baseline failure was a test-fixture defect, not a defect in the monthly anchor rule. Non-padded date input did have a comparison defect.
- **Minimal fix:** Align the fixture's anchor with its intended due day, share one zero-padded date-key helper across recurrence/forecast/local date builders/notification keys, normalize due dates before comparison, and retain the existing injectable `afterDate` parameter for deterministic tests.
- **Test to add:** Added month-end 28th/29th/30th/31st, leap day, year rollover, and non-padded input coverage in `src/__tests__/forecast.test.ts`; ran recurrence and notification tests under both required TZ values.

### R-04 — Medium — Deleting the active profile is rejected

- **Evidence:** `src/db/repositories/profiles.ts:149-150` throws `profile-active` if the target is the default or stored active profile. `src/App.tsx:1091` only offers delete for non-current profiles.
- **Impact:** The profile deletion flow does not perform the requested safe switch when deleting the active profile; callers outside this UI get an error and no fallback selection.
- **Minimal fix:** In one transaction, choose and persist a remaining profile before deleting the active profile, or explicitly retain the current product rule and update the requirement/UI copy.
- **Test to add:** Delete the active profile when two profiles exist and assert the persisted active ID resolves to the survivor.

### R-05 — Medium — Profile-name uniqueness is locale-dependent

- **Evidence:** `src/db/repositories/profiles.ts:37-39` compares names with `toLocaleLowerCase()` and has no unique database index.
- **Impact:** Case-insensitive uniqueness can vary with device locale and concurrent tabs can both pass the read-before-write check.
- **Minimal fix:** Use locale-independent normalization and serialize name validation plus insertion/update through a database transaction (already transactional in the current create/rename paths; verify behavior under concurrent operations).
- **Test to add:** Names that differ only by case under multiple locales and concurrent create/rename attempts.

## Verified OK

- Account deletion accepts only `POST` (with `OPTIONS` preflight), requires a Bearer token, verifies that token with Supabase `auth.getUser`, derives the user ID from the verified user object, and checks `auth_time` is no more than five minutes old: `supabase/functions/delete-account/index.ts:57-86`.
- The service-role key is read server-side and used to delete only the caller's receipt folder, `cloud_records`, and auth user. The function does not accept an identity from the request body/query and returns generic failure text: `supabase/functions/delete-account/index.ts:62-68,87-103`.
- Retry after partial cleanup is plausibly idempotent: the function removes files and records before deleting the auth user; missing files/records are tolerated by delete calls. This is a code-path review only, not a runtime verification.
- Client invokes the function without an identity payload, signs out after success, and retains local profile data: `src/App.tsx:1052-1061`.
- Legacy migration updates existing profile-owned records and inserts the profile in one Dexie read/write transaction, and active profile restoration rejects a missing/deleted stored ID: `src/db/repositories/profiles.ts:209-265,56-64`.
- Profile creation enforces the four-profile limit and validates a nonempty, at-most-24-character name inside its transaction: `src/db/repositories/profiles.ts:31-44,70-88`.
- Google sign-in alone does not invoke `syncLocalData`; the code calls it only from the explicit “Sync this device” action: `src/App.tsx:3380-3392`. Sign-out leaves local records untouched (`src/App.tsx:3399-3407`).
- Notification preferences are profile scoped in the editor and runtime evaluator: `src/components/NotificationsSheet.tsx:85-115`, `src/App.tsx:226-243`; startup only reads the legacy setting to seed a profile that has no saved preferences (`src/db/repositories/profiles.ts:218-229`).

## Unverified

- The Edge Function was not type-checked or run: Deno is unavailable per supplied project context, and this review did not install tools or make network calls. No automated Edge Function test setup was found. In particular, storage listing/removal and account deletion behavior must be exercised in a disposable Supabase project.
- No shared-group ownership representation/check appears in the inspected deletion function or cloud schema. The app's “shared bills” are local data, so whether “shared group owner” applies to this phase is **Unverified**.
- Whether notification scheduling always loads the active profile's preference record requires a full runtime path trace; profile preference storage and migration were inspected, but the scheduler's startup wiring was not independently exercised.
- Date behavior across real browser timezones was not executed. Existing recurrence math uses UTC date parts, while forecast constructs the resulting date at local midnight (`src/domain/forecast.ts:20`); the requested timezone matrix remains to be run in Part 2.

## Part 2 — Fix status

- **R-01 — Fixed** — Commit `64a5da7`. Scoped debt/recurring views and backup exports to the active profile; profile repository lookups and mutations now require and enforce a profile ID. No dedicated IndexedDB isolation test was added because this suite has no repository-level IndexedDB setup. Final full suite passed.
- **R-02 — Fixed** — Commit `1553f78`. Active selection is stored per tab, with device storage retained as the new-tab default; stale rapid-switch requests are ignored. No automated multi-tab test setup exists. Manual verification remains on the checklist below.
- **R-03 — Fixed** — Commit `554ed06`. Corrected the invalid fixture (the expected Nov 20 recurrence was anchored to Nov 1) and normalized non-padded dates before comparison. Added month-end, leap-year, year-rollover, and non-padded-input tests. Forecast and notification tests passed under both `TZ=UTC` and `TZ=Asia/Manila`.
- **R-04 — Not fixed** — The current flow still blocks deleting the active profile. The safe automatic-switch behavior would exceed the allowed small, low-risk Medium fix scope; leave this as a follow-up decision.
- **R-05 — Fixed** — Commit `068c6ef`. Replaced locale-dependent lowercasing with deterministic `toLowerCase()`. Existing profile validation tests passed.

### Final verification

- `pnpm test`: 7 files passed, 39 tests passed. The only baseline failure was R-03; no failures remain.
- `pnpm build`: passed. Vite still reports the large-chunk warning.
- Account deletion was not executed, type-checked with Deno, or deployed; the runtime behavior remains unverified.

### Manual checklist

- Deploy the Edge Function and test typed account deletion after both an old and a fresh sign-in.
- Open two tabs with different active profiles and verify their records remain isolated.
- Switch profiles quickly and verify the last requested profile remains selected.
