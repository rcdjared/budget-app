import { describe, expect, it } from "vitest";
import { parseKupiInput } from "./parseKupiInput";
import type { KupiDbSnapshot, SessionContext } from "../contracts";
import { extractMoneyCandidates } from "../text/numbers";

const now = new Date("2026-11-24T12:00:00+08:00");
const context: SessionContext = {
  recentTemplateIds: [],
  personality: "classic",
  rngSeed: 1,
};
const db: KupiDbSnapshot = {
  accounts: ["Cash / Wallet", "GCash", "Maya", "BDO", "GoTyme Bank", "Custom Savings"].map((name) => ({ name })),
  categories: [
    "Food", "Transport", "Bills", "Shopping", "Phone", "Fun", "Health", "Fees",
    "Salary", "Freelance & Side Gig", "Gifts & Cashbacks", "Other Income",
    "Rental Income", "Business & Sales", "Investments & Dividends", "Remittance & Padala Received",
  ].map((name) => ({ name })),
  txns: [],
};

describe("parseKupiInput", () => {
  it("asks for a category when given only a valid amount", () => {
    expect(extractMoneyCandidates("180").candidates).toHaveLength(1);
    expect(parseKupiInput("180", context, db, now)).toMatchObject({
      intent: "LOG_EXPENSE",
      tier: "ask",
      drafts: [{ amount: { value: 18000 } }],
      missing: ["category"],
    });
  });

  it("parses dropped spaces conservatively when an entity is recognizable", () => {
    expect(parseKupiInput("Coffee180", context, db, now)).toMatchObject({
      intent: "LOG_EXPENSE",
      tier: "confirm",
      drafts: [{ amount: { value: 18000 }, category: { value: "Food" } }],
    });
    expect(parseKupiInput("coffee180gcash", context, db, now)).toMatchObject({
      intent: "LOG_EXPENSE",
      tier: "confirm",
      drafts: [{ amount: { value: 18000 }, account: { value: "GCash" } }],
    });
  });

  it("keeps a transfer's principal separate from its fee", () => {
    expect(extractMoneyCandidates("lipat 500 gcash to gotyme fee 15").candidates.map(({ amountCentavos }) => amountCentavos))
      .toEqual([50000, 1500]);
    expect(parseKupiInput("lipat 500 gcash to gotyme fee 15", context, db, now)).toMatchObject({
      intent: "TRANSFER",
      tier: "auto",
      drafts: [{
        amount: { value: 50000 },
        account: { value: "GCash" },
        toAccount: { value: "GoTyme Bank" },
        fee: { value: 1500 },
      }],
    });
  });

  it("preserves an income draft when a missing amount arrives as a follow-up", () => {
    const pendingContext: SessionContext = {
      ...context,
      pending: {
        kind: "slot",
        slot: "amount",
        intent: "LOG_INCOME",
        draft: {
          type: "income",
          category: { value: "Salary", source: "text", confidence: 1 },
        },
      },
    };

    expect(parseKupiInput("30k", pendingContext, db, now)).toMatchObject({
      intent: "LOG_INCOME",
      missing: [],
      drafts: [{
        type: "income",
        amount: { value: 3_000_000 },
        category: { value: "Salary" },
      }],
    });
  });

  it("understands short transaction fragments with category and account shorthand", () => {
    expect(parseKupiInput("shop 200 gcash", context, db, now)).toMatchObject({
      intent: "LOG_EXPENSE",
      drafts: [{
        amount: { value: 20_000 },
        category: { value: "Shopping" },
        account: { value: "GCash" },
      }],
      missing: [],
    });
  });

  it("merges all details from a fragment reply into the requested slot draft", () => {
    const pendingContext: SessionContext = {
      ...context,
      pending: {
        kind: "slot",
        slot: "category",
        intent: "LOG_EXPENSE",
        draft: {
          type: "expense",
          note: "lunch",
        },
      },
    };

    expect(parseKupiInput("200 food gcash", pendingContext, db, now)).toMatchObject({
      intent: "LOG_EXPENSE",
      missing: [],
      drafts: [{
        type: "expense",
        amount: { value: 20_000 },
        category: { value: "Food" },
        account: { value: "GCash" },
        note: "lunch",
      }],
    });
  });

  it("reuses the last query focus for short period, category, type, and account follow-ups", () => {
    const focused: SessionContext = {
      ...context,
      focus: {
        lastQuery: { metric: "total", period: "this_month" },
        recent: { account: "GCash", category: "Food", type: "expense" },
        turnsRemaining: 4,
      },
    };
    expect(parseKupiInput("last month", focused, db, now)).toMatchObject({
      intent: "QUERY_STATS", query: { metric: "total", period: "last_month" },
    });
    expect(parseKupiInput("and for transport?", focused, db, now)).toMatchObject({
      intent: "QUERY_STATS", query: { filters: { category: "Transport" } },
    });
    expect(parseKupiInput("how about income?", focused, db, now)).toMatchObject({
      intent: "QUERY_STATS", query: { filters: { type: "income" } },
    });
    expect(parseKupiInput("same account", focused, db, now)).toMatchObject({
      intent: "QUERY_STATS", query: { filters: { account: "GCash" } },
    });
  });

  it("asks for clarification when a focus fragment has no session context", () => {
    expect(parseKupiInput("last month", context, db, now)).toMatchObject({
      intent: "CLARIFY", tier: "ask",
    });
  });

  it("fills a missing transfer destination without losing its source or amount", () => {
    const pendingContext: SessionContext = {
      ...context,
      pending: {
        kind: "slot",
        slot: "toAccount",
        intent: "TRANSFER",
        draft: {
          type: "transfer",
          amount: { value: 50_000, source: "text", confidence: 1 },
          account: { value: "GCash", source: "text", confidence: 1 },
        },
      },
    };

    expect(parseKupiInput("gotyme", pendingContext, db, now)).toMatchObject({
      intent: "TRANSFER",
      missing: [],
      drafts: [{
        type: "transfer",
        amount: { value: 50_000 },
        account: { value: "GCash" },
        toAccount: { value: "GoTyme Bank" },
      }],
    });
  });

  it("confirms uncategorized merchants instead of silently assigning them", () => {
    expect(parseKupiInput("unlisted merchant 50", context, db, now)).toMatchObject({
      intent: "LOG_EXPENSE",
      tier: "confirm",
      drafts: [{ amount: { value: 5000 }, category: { value: null } }],
    });
  });

  it("does not interpret foreign-currency amounts as PHP", () => {
    expect(parseKupiInput("$20", context, db, now)).toMatchObject({
      intent: "UNKNOWN",
      tier: "fallback",
      unsupported: "multi_currency",
    });
  });

  it("routes top-spending questions to category queries instead of transaction logging", () => {
    for (const phrase of ["top spend", "top spending", "what did I spend the most on?"]) {
      expect(parseKupiInput(phrase, context, db, now)).toMatchObject({
        intent: "QUERY_STATS",
        query: { metric: "top_category" },
      });
    }
  });

  it("filters income questions as income rather than expense totals", () => {
    expect(parseKupiInput("How much income did I receive this month?", context, db, now)).toMatchObject({
      intent: "QUERY_STATS",
      query: {
        metric: "total",
        period: "this_month",
        filters: { type: "income" },
      },
    });
  });
});
