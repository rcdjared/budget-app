import { describe, expect, it } from "vitest";
import type { Budget, Transaction } from "@/domain/types";
import { computeKupiNudge } from "./computeKupiNudge";

const timestamp = "2026-11-24T04:00:00.000Z";
const now = new Date("2026-11-24T12:00:00.000+08:00");

function transaction(
  id: string,
  date: string,
  amount: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id,
    profileId: "profile",
    type: "expense",
    amount,
    accountId: "cash",
    categoryId: "food",
    date,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

function budget(overrides: Partial<Budget> = {}): Budget {
  return {
    id: "food-budget",
    profileId: "profile",
    categoryId: "food",
    period: "monthly",
    amount: 10_000,
    rolloverEnabled: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

describe("computeKupiNudge", () => {
  it("prioritizes an exceeded budget and includes computed budget facts and mood", () => {
    const nudges = computeKupiNudge(
      [transaction("food", "2026-11-24", 10_500)],
      [budget()],
      now,
    );

    expect(nudges[0]).toMatchObject({
      id: "budget-exceeded:food-budget",
      priority: 1,
      cooldownMs: 24 * 60 * 60 * 1_000,
      facts: { spentCentavos: 10_500, budgetCentavos: 10_000, percent: 105 },
      mood: "worried",
      tags: ["over_budget"],
    });
  });

  it("warns about critical pacing only when at least five cycle days remain", () => {
    const pacing = computeKupiNudge(
      [transaction("food", "2026-11-24", 8_000)],
      [budget()],
      now,
    );
    const nearCycleEnd = computeKupiNudge(
      [transaction("food", "2026-11-14", 8_000)],
      [budget({ period: "biweekly" })],
      new Date("2026-11-14T12:00:00.000+08:00"),
    );

    expect(pacing[0]).toMatchObject({
      id: "budget-pacing:food-budget",
      priority: 2,
      cooldownMs: 24 * 60 * 60 * 1_000,
    });
    expect(nearCycleEnd.some(({ id }) => id.startsWith("budget-pacing:"))).toBe(false);
  });

  it("warns when daily budget pacing reaches the critical threshold", () => {
    const nudges = computeKupiNudge(
      [transaction("food", "2026-11-24", 1_900_000)],
      [budget({ period: "daily", amount: 2_000_000 })],
      now,
    );

    expect(nudges[0]).toMatchObject({
      id: "budget-pacing:food-budget",
      priority: 2,
      facts: { spentCentavos: 1_900_000, budgetCentavos: 2_000_000, percent: 95, daysLeft: 1 },
      mood: "worried",
      tags: ["near_budget"],
    });
  });

  it("prioritizes combined category budget pacing for today's total spend", () => {
    const nudges = computeKupiNudge([
      transaction("food", "2026-11-24", 1_000_000),
      transaction("shopping", "2026-11-24", 800_000, { categoryId: "shopping" }),
      transaction("phone", "2026-11-24", 100_000, { categoryId: "phone" }),
    ], [
      budget({ id: "food-daily", period: "daily", amount: 1_050_000 }),
      budget({ id: "shopping-daily", categoryId: "shopping", period: "daily", amount: 850_000 }),
      budget({ id: "phone-daily", categoryId: "phone", period: "daily", amount: 100_000 }),
    ], now);

    expect(nudges[0]).toMatchObject({
      id: "budget-total-pacing:daily",
      priority: 1,
      facts: { spentCentavos: 1_900_000, budgetCentavos: 2_000_000, percent: 95 },
      mood: "worried",
      tags: ["near_budget"],
    });
  });

  it("counts only live sub-₱50 expenses for the micro-spend nudge", () => {
    const nudges = computeKupiNudge([
      transaction("a", "2026-11-24", 4_999),
      transaction("b", "2026-11-24", 3_000),
      transaction("c", "2026-11-24", 1_000),
      transaction("deleted", "2026-11-24", 100, { deletedAt: timestamp }),
      transaction("yesterday", "2026-11-23", 100),
    ], [], now);

    expect(nudges[0]).toMatchObject({
      id: "micro-spend:2026-11-24",
      priority: 3,
      cooldownMs: 24 * 60 * 60 * 1_000,
      facts: { microSpendCount: 3 },
      mood: "idle",
      intensity: 2,
      tags: ["micro_spend"],
    });
  });

  it("calculates safe-to-spend, a real no-spend streak, and no-activity fallback", () => {
    const budgetNudges = computeKupiNudge(
      [transaction("last-expense", "2026-11-20", 2_000)],
      [budget()],
      now,
    );
    const safeToSpend = budgetNudges.find(({ id }) => id.startsWith("daily-safe-to-spend:"));
    const streak = budgetNudges.find(({ id }) => id.startsWith("zero-spend-streak:"));
    expect(safeToSpend).toMatchObject({
      priority: 6,
      cooldownMs: 12 * 60 * 60 * 1_000,
    });
    expect(safeToSpend?.facts.dailySafeToSpendCentavos).toBeGreaterThan(0);
    expect(streak).toMatchObject({
      priority: 4,
      cooldownMs: 24 * 60 * 60 * 1_000,
      facts: { streakDays: 3 },
      mood: "happy",
      tags: ["streak"],
    });

    const noActivity = computeKupiNudge([], [], now);
    expect(noActivity).toHaveLength(1);
    expect(noActivity[0]).toMatchObject({
      id: "nothing-logged:2026-11-24",
      priority: 5,
      cooldownMs: 24 * 60 * 60 * 1_000,
    });
  });

  it("uses profile-visible transaction state and Manila calendar dates", () => {
    const nudges = computeKupiNudge([
      transaction("yesterday-manila", "2026-11-23", 100, { type: "income" }),
      transaction("cancelled-today", "2026-11-24", 100, { cancelledAt: timestamp }),
    ], [], new Date("2026-11-23T16:30:00.000Z"));

    expect(nudges.map(({ id }) => id)).toContain("nothing-logged:2026-11-24");
  });
});
