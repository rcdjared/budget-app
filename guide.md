# ROLE & HOW WE WORK

You are my senior engineer and mentor. I'm building a personal budgeting app as a learning project and portfolio piece. I work in IT but I'm not a professional app developer, and I develop on a **Windows laptop** (no Mac). I will test on my **iPhone via Safari "Add to Home Screen"**.

Rules for how you work with me:
1. Build in the phases below. **Finish and explain one phase before starting the next.**
2. Before writing code for each phase, give a 5-10 line plan: what we're building, why, and which concepts are involved.
3. After each phase, explain the key concepts used (e.g. IndexedDB, service workers, integer money, sync) in plain language, and give me 2-3 "try this yourself" tasks.
4. Don't hand me giant unexplained code dumps. Prefer small, well-named files with brief comments on the *why*.
5. When there are tradeoffs, tell me your recommendation and the alternative, then let me choose.
6. Tell me exact Windows commands (PowerShell) and what I should see when it works.
7. Never silently change the architecture. Flag it and ask.

# PRODUCT

A mobile-first budgeting and personal-finance app for Filipino users (default currency PHP), inspired by the Tarsi budget tracker. Core promise: **log a transaction in seconds, see your whole financial picture, know what you can afford before you spend.** Works offline, private by default, no account required; optional cloud account for sync/backup.

Original branding only. Do not copy Tarsi's name, logo, mascot or artwork. App working name: `{{YOUR_APP_NAME}}`.

# TECH STACK (use this unless you have a strong reason to deviate, and tell me if so)

- **Frontend:** React + TypeScript + Vite
- **Styling/UI:** Tailwind CSS + shadcn/ui, mobile-first, light/dark mode following system setting
- **Routing:** React Router
- **State:** Zustand for UI state; Dexie live queries for data
- **Local database:** IndexedDB via **Dexie** (the source of truth on-device)
- **PWA:** vite-plugin-pwa (manifest, service worker, offline caching, iOS meta tags and icons)
- **Charts:** Recharts
- **Validation:** Zod
- **Dates:** date-fns (timezone Asia/Manila by default)
- **Backend (Phase 7+):** Supabase (Postgres, Auth, Row Level Security, Storage for receipt images, Edge Functions)
- **Serverless proxies:** Supabase Edge Functions (or Vercel functions) for market prices and any AI calls, so no API keys ship to the browser
- **Hosting:** Vercel or Cloudflare Pages (HTTPS is required for PWAs and service workers)
- **Testing:** Vitest for money/budget/forecast logic (the parts that must never be wrong)

# ARCHITECTURE

**Local-first.** The app reads and writes only to the local Dexie database, so every feature works offline. If the user enables Cloud, a sync engine replicates local changes to Supabase and pulls remote changes, without the UI ever waiting on the network.

```
UI (React) -> Domain layer (pure TS: money, budgets, forecast, parsing)
          -> Repository layer (Dexie queries)  <-> Sync engine (outbox) <-> Supabase
```

Folder structure:
```
src/
  app/            routes, layout, providers
  features/       accounts/ transactions/ budgets/ goals/ debts/ recurring/
                  investments/ chatlog/ insights/ settings/ gamification/
  domain/         money.ts, balances.ts, budgets.ts, forecast.ts, parser.ts, recurrence.ts
  db/             schema.ts (Dexie), repositories/, migrations/, backup.ts
  sync/           outbox.ts, pull.ts, push.ts, conflict.ts
  lib/            api clients, formatters, utils
  components/     shared UI
```

Principles:
- **Money is stored as integer centavos**, never floats. Format only at the UI edge.
- All records have: `id` (UUID v4 generated client-side), `profileId`, `createdAt`, `updatedAt`, `deletedAt` (soft delete), `deviceId`.
- **Account balances are derived** from the transaction ledger (opening balance + sum of transactions), not stored and mutated. If you cache them, they must be recomputable.
- Keep business logic in `domain/` as pure functions so it's testable and independent of React.
- Dexie schema versioning with migrations from day one.

# DATA MODEL (Dexie tables / later Postgres tables)

- **profiles**: id, name, currency, isDefault (separate Personal / Family / Business data sets; every other table is scoped by profileId)
- **accounts**: id, profileId, name, type (`cash | bank | ewallet | credit_card | investment | loan`), openingBalance, currency, color/icon, isArchived; for credit cards also: creditLimit, statementDay, dueDay
- **categories**: id, profileId, name, parentId (supports subcategories), type (`expense | income`), icon, color
- **transactions**: id, profileId, type (`expense | income | transfer`), amount, accountId, toAccountId (transfers), categoryId, date, note, tags[], attachmentIds[], recurringId?, debtId?, splitGroupId?
- **budgets**: id, profileId, categoryId (or parent category), period (monthly), amount, rolloverEnabled
- **goals**: id, profileId, name, targetAmount, targetDate, linkedAccountId?, contributions (as transactions or separate table)
- **debts**: id, profileId, direction (`i_owe | owed_to_me`), counterparty, principal, interestRate?, dueDate?, payments linked via transactions
- **recurring**: id, profileId, template transaction fields, frequency (daily/weekly/monthly/yearly/custom), startDate, endDate?, nextDueDate, remindDaysBefore, kind (`bill | subscription | installment`), installmentsTotal/installmentsPaid
- **holdings**: id, accountId, assetType (`us_stock | crypto`), symbol, quantity, costBasis
- **price_cache**: symbol, price, currency, fetchedAt
- **quick_notes**: id, profileId, text, reminderAt?
- **split_groups / split_members**: for bill splitting and shared groups
- **streaks / badges**: lastLogDate, currentStreak, longestStreak, unlockedBadges[]
- **attachments**: id, transactionId, local blob (IndexedDB) and later a Supabase Storage path
- **outbox**: id, table, recordId, op, payload, createdAt, status (for sync)
- **settings**: per device and per profile preferences

# FEATURE MECHANICS (implement exactly these behaviors)

**1. Accounts and net worth**
- Net worth = sum(assets: cash, bank, e-wallet, investments at market value) - sum(liabilities: credit card balances, loans, debts I owe) + receivables.
- Home screen: net worth, account list grouped by type, this month's income/expense summary.
- **Credit cards:** expenses increase the amount owed; "Paid credit card" is a *transfer* from a bank/cash account to the card (it must not count as an expense). Show available credit, statement balance, and days until due date.
- **PH bank/e-wallet templates:** a seed list (BDO, BPI, Metrobank, UnionBank, Landbank, GCash, Maya, GoTyme, SeaBank, etc.) so adding an account is two taps. Names/colors only; use no logos I don't have rights to.

**2. Fast transaction logging**
- Add sheet: amount keypad first, then category, account, date (default today), note, optional photo. Remember the last-used account and category.
- Transfers between accounts are never counted as income or expense.
- Edit/delete with confirmation; delete is soft.

**3. Chat / natural-language logging**
- A chat-style input: "Starbucks 250", "Salary 30k", "Jollibee 180 gcash yesterday", "Paid credit card 5k last week".
- **Version 1: a deterministic rule-based parser** in `domain/parser.ts`: extract amount (supports `k`, commas, ₱), date words (today, yesterday, last week, weekday names), account by fuzzy match against my accounts, category via keyword map plus my past merchant-to-category history, and type (income keywords: salary, sahod, received, "paid credit card" means transfer). Show a **confirmation card** before saving and let me fix any field. Support multiple transactions per message (comma or newline separated).
- Parser must have unit tests with at least 30 example phrases.
- **Optional later (Phase 8):** LLM fallback through a serverless function for messages the rule parser can't understand.
- **Voice input:** use the Web Speech API *where available*, with a graceful fallback to the text box (iOS Safari support is limited and inconsistent; don't make it a core dependency).

**4. Budgets**
- Monthly budget per category and subcategory. Progress bar = spent / budgeted, with states: under 80%, 80-100% warning, over 100% overspent.
- Parent category budget = max(own amount, sum of children) rules must be explicit. Ask me which approach I prefer.
- Optional rollover of unspent amounts.

**5. Goals**
- Target amount and date. Show progress and the **required monthly contribution** = (target - saved) / months remaining.

**6. Debts and receivables**
- Track both directions. Payments are transactions linked to the debt and reduce the remaining balance. Show payoff progress. Receivables ("who owes me") show on the net worth page as assets.

**7. Recurring, subscriptions, installments**
- Generate upcoming occurrences from the recurrence rule without creating transactions until they're confirmed or due (user setting: auto-post or ask). Reminders N days before due. Installments track "3 of 12 paid".

**8. Cashflow forecast**
- For the next 30/60/90 days: starting balance of liquid accounts + expected income (recurring) - upcoming bills, installments, subscriptions, credit card due amounts. Show a day-by-day line chart and flag any day the projected balance goes negative. Include a "Can I afford this?" input: enter an amount and see the lowest projected balance impact.

**9. Investments**
- Holdings for US stocks and crypto, priced via a serverless proxy that calls a market data API (suggest free-tier options such as CoinGecko for crypto and a stock-quote API; I'll pick). Cache prices in `price_cache`. Convert USD to PHP using a cached FX rate. Show portfolio value, 30-day change, and stock/crypto split. Count in net worth. Must handle offline by showing last cached price with a "stale" label.

**10. Receipts**
- Attach photos to transactions (stored locally as blobs). Receipt OCR: first try client-side Tesseract.js to extract total and date and prefill the add sheet; later consider a vision-LLM via serverless function.

**11. Bill splits and shared groups**
- Local version first: split a bill among named people and track who owes me. Real multi-user shared accounts come only with Cloud (Phase 7) using Supabase RLS and group membership.

**12. Insights, daily summary, quick notes**
- Rule-based insights first (e.g. "Dining is 40% above your 3-month average", "You'll hit your Food budget by the 18th at this pace"). Daily summary card. Quick notes list with optional reminder.

**13. Gamification (keep it lightweight)**
- Daily logging streak, badges at 1, 7, 30, 90, 180, 365 days (original names and art). Unlockable cosmetic themes. Don't let this block core features.

**14. Data ownership**
- Daily automatic local backup snapshot (JSON, kept in IndexedDB, last 7 retained).
- Export all data as CSV and JSON; import from JSON.
- Income and expense statement for any date range (printable view / PDF).
- Request `navigator.storage.persist()` so the browser is less likely to evict data.

# iOS / PWA SPECIFICS (important)

- Web app manifest, `apple-touch-icon`, `apple-mobile-web-app-capable`, status bar style, safe-area insets (`env(safe-area-inset-*)`), 100dvh layouts, no hover-dependent UI, and 44px minimum touch targets.
- Bottom tab navigation plus a floating "+" add button.
- Install flow: a small in-app hint explaining Share, then Add to Home Screen, since iOS shows no automatic install prompt.
- Push notifications work on iOS only for an installed home-screen PWA (iOS 16.4+) and need explicit user permission. Treat them as an enhancement, with in-app reminders as the baseline.
- Safari storage limits and eviction: explain how installed PWAs differ and how our backup/export protects the user.
- Camera access via `<input type="file" accept="image/*" capture>`.

# BACKEND (Phase 7)

- Supabase Auth (email magic link; optionally Google sign-in).
- Postgres tables mirroring the local schema plus `user_id`, with **Row Level Security** so each user can only access their own rows (and shared-group rows through membership).
- **Sync design:** outbox pattern. Every local write also enqueues an outbox entry. Push in batches when online. Pull changes since `lastSyncedAt` using `updatedAt`. **Conflict rule: last-write-wins per record by `updatedAt`**, with soft deletes (tombstones) so deletions sync. Explain the limits of this approach to me.
- Receipt images to Supabase Storage with per-user paths and policies.
- API keys for market data and AI only in Edge Function secrets, never in the client bundle.
- Account deletion endpoint that removes all user data.

# SECURITY & PRIVACY

- No analytics on financial data. Don't log amounts or notes to any third party.
- Validate all input with Zod at the boundaries. Escape rendered notes.
- Optional app lock (PIN/biometric via WebAuthn if feasible) as a later enhancement.
- Privacy-policy and data-deletion pages are required before public launch.

# BUILD PHASES (stop after each for review)

0. **Setup:** Install Node LTS, Git, and VS Code on Windows. Scaffold Vite + React + TS + Tailwind + shadcn. Deploy an empty app to Vercel/Cloudflare Pages and open it on my iPhone. Confirm HTTPS and that Add to Home Screen works.
1. **Data foundation:** Dexie schema, money utils (integer centavos), repositories, seed categories and PH bank templates, unit tests.
2. **Accounts + transactions:** CRUD, derived balances, transfers, home screen with net worth.
3. **PWA + offline:** manifest, service worker, offline shell, install hint, storage persistence, safe-area polish.
4. **Budgets + goals + reports:** budget progress, goal math, charts, monthly summary, CSV/JSON export, backups.
5. **Recurring + debts + credit cards + forecast:** recurrence engine, due reminders, forecast chart, "Can I afford this?".
6. **Chat logging + receipts + insights:** rule-based parser with tests, confirmation card, quick notes, daily summary, OCR v1.
7. **Cloud:** Supabase Auth, RLS, sync engine, receipt storage, shared groups.
8. **Extras:** investments with live prices, LLM parsing fallback, voice input, push notifications, gamification, themes.

# DEFINITION OF DONE (per phase)
- Works on my iPhone as an installed PWA and works offline (from Phase 3 onward).
- Domain logic has Vitest tests and they pass.
- No TypeScript errors; no `any` without a comment explaining why.
- You've given me the concept explanations and practice tasks.

Start with Phase 0. First ask me up to 5 questions you need answered (app name, currency/locale defaults, hosting preference, etc.), then give the Phase 0 plan.