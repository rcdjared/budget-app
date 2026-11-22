import { describe, expect, it } from "vitest";
import type { Budget, Category } from "@/domain/types";
import { getInsights } from "./insights";
import type { SpendingPulseStats } from "./types";

const category: Category = {
  id: "rent",
  profileId: "profile-1",
  name: "Rent",
  type: "expense",
  icon: "home",
  color: "#3b8ccb",
  sortOrder: 0,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

const budget: Budget = {
  id: "budget-rent",
  profileId: "profile-1",
  categoryId: "rent",
  period: "monthly",
  amount: 100_000,
  rolloverEnabled: false,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
};

function stats(overrides: Partial<SpendingPulseStats> = {}): SpendingPulseStats {
  return {
    total: 0,
    previousTotal: 0,
    changePercent: null,
    change: "same",
    todayTotal: 0,
    averagePreviousSevenDays: 0,
    budgetCycleSpent: 0,
    budgetCycleLimit: 0,
    hasExpenseHistory: false,
    elapsedDays: 1,
    bars: [],
    ...overrides,
  };
}

function insights(overrides: Partial<SpendingPulseStats>, now: Date, tone: "gentle" | "playful" | "roast" = "playful") {
  return getInsights({
    stats: stats(overrides),
    categories: [category],
    budgets: [budget],
    now,
    tone,
  });
}

describe("Spending Pulse insights", () => {
  it("returns multiple variants for triggered moods and respects Manila late-night hours", () => {
    const results = insights(
      { hasExpenseHistory: true },
      new Date("2026-11-22T19:00:00.000Z")
    );

    expect(results.filter((item) => item.mood === "sleepy")).toHaveLength(3);
    expect(results.filter((item) => item.mood === "proud")).toHaveLength(3);
  });

  it("detects spending spikes and a faster pace than the previous period", () => {
    const results = insights({
      todayTotal: 3000,
      averagePreviousSevenDays: 1000,
      total: 9000,
      previousTotal: 6000,
    }, new Date("2026-11-23T04:00:00.000Z"));

    expect(results[0].mood).toBe("shook");
    expect(results.some((item) => item.mood === "side-eye")).toBe(true);
  });

  it("uses budgets for the smug trigger without joking about essential categories", () => {
    const results = insights(
      { budgetCycleSpent: 2000 },
      new Date("2026-11-23T04:00:00.000Z")
    );
    const copy = results.map((item) => item.text).join(" ").toLowerCase();

    expect(results[0].mood).toBe("smug");
    expect(results.filter((item) => item.mood === "smug")).toHaveLength(3);
    expect(copy).not.toContain("rent");
  });

  it("changes the generated copy with the selected tone and is deterministic", () => {
    const now = new Date("2026-11-23T04:00:00.000Z");
    const input = {
      stats: stats(),
      categories: [category],
      budgets: [],
      now,
    };
    const gentle = getInsights({ ...input, tone: "gentle" });
    const roast = getInsights({ ...input, tone: "roast" });

    expect(gentle).toEqual(getInsights({ ...input, tone: "gentle" }));
    expect(gentle[0].text).not.toBe(roast[0].text);
    expect(gentle).toHaveLength(3);
  });
});
