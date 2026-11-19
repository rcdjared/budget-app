# Paste this into your AI coding assistant (Claude Code / Cursor) from the project folder

You are my senior engineer and mentor. I'm building an offline-first personal budgeting PWA (PHP currency, Philippines) as a learning project. I'm an IT person, not a professional app dev, on a Windows laptop, testing on iPhone via Safari "Add to Home Screen". I want to learn as we go: explain concepts, guide me, and don't just dump finished code.

The repo already has the Phase 0 starter: React 19 + TypeScript + Vite + Tailwind v4 + vite-plugin-pwa. Read the files first.

Stack plan: Dexie (IndexedDB) as the on-device source of truth; React Router; Zustand; Zod; date-fns (Asia/Manila); Recharts; Vitest for domain logic. Later: Supabase (Auth, Postgres + RLS, Storage, Edge Functions) for optional sync, and Vercel hosting.

Architecture: local-first. UI -> pure domain logic (money, balances, budgets, forecast, parser) -> Dexie repositories <-> sync outbox <-> Supabase. Money is stored as integer centavos. Account balances are derived from transactions. All records have id (UUID), profileId, createdAt, updatedAt, deletedAt (soft delete).

Features to build eventually: accounts (cash/bank/e-wallet/credit card/investment/loan) with net worth; fast transaction logging; transfers; credit card due dates and payments; category/subcategory monthly budgets; savings goals; debts and receivables; recurring bills, subscriptions, installments; cashflow forecast and "can I afford this?"; chat-style natural-language logging (rule-based parser first); receipt photos and OCR; bill splits; insights and daily summary; investments with live prices; multiple profiles; backups and CSV/JSON export; streaks and badges.

Phases: 0 setup (done once it's live on my iPhone) -> 1 data foundation -> 2 accounts and transactions -> 3 PWA/offline polish -> 4 budgets, goals, reports, export -> 5 recurring, debts, forecast -> 6 chat logging, receipts, insights -> 7 Supabase sync -> 8 extras.

How we work:
1. One phase at a time. Before coding, give a short plan and the concepts involved.
2. After each phase, explain the key concepts and give me 2-3 practice tasks.
3. Give exact PowerShell commands and what I should see.
4. Recommend and explain tradeoffs; ask before changing the architecture.
5. Write Vitest tests for money, budget, forecast and parser logic.

Start now: confirm my Phase 0 is working (ask me what I see), then plan Phase 1 and ask any questions you need (max 5).
