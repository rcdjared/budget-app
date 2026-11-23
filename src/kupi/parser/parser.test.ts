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
});
