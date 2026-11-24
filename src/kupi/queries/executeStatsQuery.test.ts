import { describe, expect, it } from "vitest";
import type { Account, Budget, Category, Transaction } from "@/domain/types";
import type { StatsQuery } from "../contracts";
import { executeStatsQuery } from "./executeStatsQuery";

const now = new Date("2026-11-24T12:00:00+08:00");
const account = { id: "cash", profileId: "p1", name: "Cash", type: "cash", openingBalance: 100_000, currency: "PHP", color: "#000", icon: "wallet", isArchived: false, createdAt: "", updatedAt: "" } as Account;
const category = { id: "food", profileId: "p1", name: "Food", type: "expense", icon: "fork", color: "#000", sortOrder: 0, createdAt: "", updatedAt: "" } as Category;

function txn(id: string, amount: number, date: string, fields: Partial<Transaction> = {}): Transaction {
  return {
    id,
    profileId: "p1",
    type: "expense",
    amount,
    accountId: "cash",
    categoryId: "food",
    date,
    createdAt: "",
    updatedAt: "",
    ...fields,
  } as Transaction;
}

function run(metric: StatsQuery["metric"], overrides: Partial<StatsQuery> = {}, extra: {
  transactions?: Transaction[];
  budgets?: Budget[];
} = {}) {
  return executeStatsQuery({ metric, ...overrides }, {
    accounts: [account],
    budgets: extra.budgets ?? [],
    categories: [category],
    transactions: extra.transactions ?? [],
    now,
  });
}

describe("executeStatsQuery", () => {
  it("uses Manila dates, ignores deleted/cancelled rows, and uses a split's personal share", () => {
    const result = run("total", { period: "this_month" }, { transactions: [
      txn("live", 12_000, "2026-11-24", { personalShareAmount: 4_000 }),
      txn("old", 50_000, "2026-10-31"),
      txn("deleted", 40_000, "2026-11-20", { deletedAt: "deleted" }),
      txn("cancelled", 30_000, "2026-11-21", { cancelledAt: "cancelled" }),
    ] });
    expect(result).toMatchObject({ metric: "total", amountCentavos: 4_000, transactionCount: 1 });
    if (result.metric !== "total") throw new Error("Expected a total result.");
    expect(result.period).toMatchObject({ start: "2026-11-01", end: "2026-11-24", days: 24 });
  });

  it("groups, counts, and selects the largest expense from typed profile facts", () => {
    const txns = [
      txn("one", 4_000, "2026-11-23"),
      txn("two", 7_000, "2026-11-24"),
      txn("transfer", 100_000, "2026-11-24", { type: "transfer" }),
    ];
    expect(run("by_category", {}, { transactions: txns })).toMatchObject({
      metric: "by_category",
      amountCentavos: 11_000,
      groups: [{ name: "Food", transactionCount: 2 }],
    });
    expect(run("count", {}, { transactions: txns })).toMatchObject({ metric: "count", transactionCount: 2 });
    expect(run("top_category", {}, { transactions: txns })).toMatchObject({
      metric: "top_category",
      top: { key: "food", amountCentavos: 11_000 },
    });
    expect(run("biggest_expense", {}, { transactions: txns })).toMatchObject({
      metric: "biggest_expense",
      transaction: { id: "two", amountCentavos: 7_000 },
    });
  });

  it("calculates daily average in whole centavos over the selected elapsed days", () => {
    expect(run("daily_average", { period: "this_month" }, {
      transactions: [txn("one", 11_000, "2026-11-24")],
    })).toMatchObject({ metric: "daily_average", amountCentavos: 458, transactionCount: 1 });
  });

  it("computes budget remainder and a non-negative daily safe-to-spend", () => {
    const budget = {
      id: "b1", profileId: "p1", categoryId: "food", period: "monthly", amount: 30_000,
      rolloverEnabled: false, createdAt: "", updatedAt: "",
    } as Budget;
    expect(run("remaining_budget", {}, { budgets: [budget], transactions: [txn("spent", 8_000, "2026-11-10")] }))
      .toMatchObject({ metric: "remaining_budget", amountCentavos: 22_000, budgetsFound: true, budgetCount: 1 });
    expect(run("safe_to_spend", {}, { budgets: [budget], transactions: [txn("over", 40_000, "2026-11-10")] }))
      .toMatchObject({ metric: "safe_to_spend", dailyAmountCentavos: 0, budgetsFound: true });
    expect(run("safe_to_spend")).toMatchObject({ budgetsFound: false, budgetCount: 0 });
  });

  it("compares equal-length prior periods and derives net worth", () => {
    expect(run("vs_last_period", { period: "this_month" }, {
      transactions: [
        txn("current", 9_000, "2026-11-20"),
        txn("previous", 4_000, "2026-10-20"),
      ],
    })).toMatchObject({
      metric: "vs_last_period",
      currentAmountCentavos: 9_000,
      previousAmountCentavos: 4_000,
      changeCentavos: 5_000,
    });
    expect(run("net_worth")).toMatchObject({
      metric: "net_worth",
      assetsCentavos: 100_000,
      liabilitiesCentavos: 0,
      netWorthCentavos: 100_000,
    });
  });

  it("rejects malformed custom date ranges", () => {
    expect(() => run("total", { period: { from: "2026-02-30", to: "2026-03-01" } }))
      .toThrow("Custom query period");
  });
});
