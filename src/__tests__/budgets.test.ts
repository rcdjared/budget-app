import { describe, expect, it } from "vitest";
import {
  getBudgetProgress,
  getRequiredMonthlyContribution,
  sumCategoryExpenses,
} from "@/domain/budgets";
import type { Transaction } from "@/domain/types";

describe("budget progress", () => {
  it("marks spending under 80 percent as under", () => {
    expect(getBudgetProgress(7900, 10000).state).toBe("under");
  });

  it("marks spending at 80 percent as warning", () => {
    expect(getBudgetProgress(8000, 10000).state).toBe("warning");
  });

  it("marks spending above 100 percent as over", () => {
    expect(getBudgetProgress(11000, 10000).state).toBe("over");
  });
});

describe("goal math", () => {
  it("divides the remaining target across remaining months", () => {
    expect(
      getRequiredMonthlyContribution(
        120000,
        20000,
        "2027-05-01",
        new Date(2026, 10, 19)
      )
    ).toBe(16667);
  });

  it("returns zero when the target is already reached", () => {
    expect(
      getRequiredMonthlyContribution(10000, 12000, "2027-01-01")
    ).toBe(0);
  });
});

describe("category spending", () => {
  it("only sums matching expense transactions in the date range", () => {
    const transactions = [
      { id: "1", type: "expense", categoryId: "food", amount: 500, date: "2026-11-10" },
      { id: "2", type: "expense", categoryId: "food", amount: 300, date: "2026-10-10" },
      { id: "3", type: "income", categoryId: "food", amount: 900, date: "2026-11-12" },
    ] as Transaction[];
    expect(sumCategoryExpenses(transactions, "food", "2026-11-01", "2026-11-30")).toBe(500);
  });
});
