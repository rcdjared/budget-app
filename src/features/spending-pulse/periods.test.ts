import { describe, expect, it } from "vitest";
import type { Transaction } from "@/domain/types";
import { getSpendingPulseRange, getSpendingPulseStats } from "./periods";

function transaction(
  id: string,
  date: string,
  type: Transaction["type"],
  amount: number,
  overrides: Partial<Transaction> = {}
): Transaction {
  return {
    id,
    profileId: "profile-1",
    type,
    amount,
    accountId: "account-1",
    date,
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`,
    ...overrides,
  };
}

describe("Spending Pulse periods", () => {
  it("uses Manila dates when the UTC date is still the previous day", () => {
    const now = new Date("2026-11-22T16:30:00.000Z");
    const stats = getSpendingPulseStats("day", [
      transaction("expense", "2026-11-23", "expense", 1200),
      transaction("yesterday", "2026-11-22", "expense", 900),
    ], now, { budgetCycleStartDay: 1, weekStartsOn: 0 });

    expect(stats.total).toBe(1200);
    expect(stats.previousTotal).toBe(900);
    expect(stats.bars.at(-1)?.date).toBe("2026-11-23");
    expect(stats.bars.at(-1)?.highlighted).toBe(true);
  });

  it("includes expenses only, uses the personal share, and ignores cancelled records", () => {
    const stats = getSpendingPulseStats("day", [
      transaction("expense", "2026-11-23", "expense", 2500, { personalShareAmount: 800 }),
      transaction("income", "2026-11-23", "income", 9000),
      transaction("transfer", "2026-11-23", "transfer", 1000),
      transaction("cancelled", "2026-11-23", "expense", 3000, { cancelledAt: "2026-11-23T00:00:00.000Z" }),
      transaction("deleted", "2026-11-23", "expense", 4000, { deletedAt: "2026-11-23T00:00:00.000Z" }),
    ], new Date("2026-11-23T04:00:00.000Z"), { budgetCycleStartDay: 1, weekStartsOn: 0 });

    expect(stats.total).toBe(800);
  });

  it("supports configurable week boundaries and marks future days as stubs", () => {
    const now = new Date("2026-11-23T04:00:00.000Z");
    const sunday = getSpendingPulseStats("week", [], now, { budgetCycleStartDay: 1, weekStartsOn: 0 });
    const monday = getSpendingPulseStats("week", [], now, { budgetCycleStartDay: 1, weekStartsOn: 1 });

    expect(sunday.bars[0].date).toBe("2026-11-22");
    expect(sunday.bars[0].future).toBe(false);
    expect(sunday.bars[1].future).toBe(false);
    expect(sunday.bars[2].future).toBe(true);
    expect(monday.bars[0].date).toBe("2026-11-23");
    expect(monday.bars[0].highlighted).toBe(true);
  });

  it("uses the configured budget cycle and compares the same elapsed days", () => {
    const range = getSpendingPulseRange(
      "month",
      new Date("2026-11-23T04:00:00.000Z"),
      { budgetCycleStartDay: 20, weekStartsOn: 0 }
    );

    expect(range.start).toBe("2026-11-20");
    expect(range.end).toBe("2026-12-19");
    expect(range.previousStart).toBe("2026-10-20");
    expect(range.previousEnd).toBe("2026-10-23");
    expect(range.elapsedDays).toBe(4);
  });

  it("handles a cycle beginning on day one and month-end clamping", () => {
    const firstDayCycle = getSpendingPulseRange(
      "month",
      new Date("2026-11-23T04:00:00.000Z"),
      { budgetCycleStartDay: 1, weekStartsOn: 0 }
    );
    const clampedCycle = getSpendingPulseRange(
      "month",
      new Date("2026-02-28T04:00:00.000Z"),
      { budgetCycleStartDay: 31, weekStartsOn: 0 }
    );

    expect(firstDayCycle.start).toBe("2026-11-01");
    expect(firstDayCycle.end).toBe("2026-11-30");
    expect(clampedCycle.start).toBe("2026-02-28");
    expect(clampedCycle.end).toBe("2026-03-30");
  });

  it("highlights all bars in the rolling seven-day view", () => {
    const stats = getSpendingPulseStats(
      "sevenDays",
      [],
      new Date("2026-11-23T04:00:00.000Z"),
      { budgetCycleStartDay: 1, weekStartsOn: 0 }
    );

    expect(stats.bars).toHaveLength(7);
    expect(stats.bars.every((bar) => bar.highlighted && !bar.future)).toBe(true);
  });
});
