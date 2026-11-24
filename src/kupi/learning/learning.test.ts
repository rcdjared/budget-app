import { describe, expect, it } from "vitest";
import type { Account, KupiMerchantRule, Transaction } from "@/domain/types";
import {
  createRule,
  findAccountAliasRule,
  findMerchantCategoryRule,
  mostUsedAccount,
  normalizeLearningSource,
} from "./learning";

const baseAccount = (id: string, name: string): Account => ({
  id,
  profileId: "profile-a",
  name,
  type: "ewallet",
  openingBalance: 0,
  currency: "PHP",
  color: "#000",
  icon: "wallet",
  isArchived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const baseTransaction = (id: string, accountId: string): Transaction => ({
  id,
  profileId: "profile-a",
  type: "expense",
  amount: 100,
  accountId,
  date: "2026-11-24",
  createdAt: "2026-11-24T00:00:00.000Z",
  updatedAt: "2026-11-24T00:00:00.000Z",
});

describe("Kupi learning", () => {
  it("normalizes and matches merchant category rules within profile data", () => {
    const rule = createRule("profile-a", "merchant_category", " Jollibee!", "food", "Food");
    expect(normalizeLearningSource(rule.source)).toBe("jollibee");
    expect(findMerchantCategoryRule([rule], "Lunch at Jollibee branch")?.targetId).toBe("food");
  });

  it("matches account aliases exactly and ignores disabled or deleted rules", () => {
    const rule: KupiMerchantRule = {
      ...createRule("profile-a", "account_alias", "my gcash", "gcash", "GCash"),
      enabled: false,
    };
    expect(findAccountAliasRule([rule], "my gcash")).toBeUndefined();
  });

  it("chooses the most-used account and falls back deterministically", () => {
    const gcash = baseAccount("gcash", "GCash");
    const cash = baseAccount("cash", "Cash");
    const transactions = [
      baseTransaction("1", "cash"),
      baseTransaction("2", "gcash"),
      baseTransaction("3", "gcash"),
    ];
    expect(mostUsedAccount([cash, gcash], transactions)?.id).toBe("gcash");
  });
});
