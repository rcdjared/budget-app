import { describe, expect, it } from "vitest";
import {
  canAffordAmount,
  generateForecast,
  getLowestProjectedBalance,
  getNextRecurrenceDate,
} from "@/domain/forecast";
import type { Recurring } from "@/domain/types";
import { getNextOccurrenceDate } from "@/domain/recurrence";
import { dateKeyFromParts } from "@/lib/format";

const recurring = (overrides: Partial<Recurring>): Recurring => ({
  id: "recurring-1",
  profileId: "profile-1",
  amount: 1000,
  accountId: "account-1",
  transactionType: "expense",
  frequency: "monthly",
  startDate: "2026-11-20",
  nextDueDate: "2026-11-20",
  remindDaysBefore: 3,
  kind: "bill",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...overrides,
});

describe("recurrence", () => {
  it("returns the next monthly date", () => {
    const next = getNextRecurrenceDate(recurring({}), new Date("2026-11-19T12:00:00"));
    expect([next.getFullYear(), next.getMonth() + 1, next.getDate()].join("-"))
      .toBe("2026-11-20");
  });

  it("advances an overdue monthly item", () => {
    const next = getNextRecurrenceDate(recurring({ startDate: "2026-09-20", nextDueDate: "2026-09-20" }), new Date("2026-11-19T12:00:00"));
    expect(dateKeyFromParts(next.getFullYear(), next.getMonth() + 1, next.getDate()))
      .toBe("2026-11-20");
  });

  it("clamps monthly dates to the target month's last day and restores the anchor", () => {
    const jan31 = recurring({ startDate: "2026-01-31", nextDueDate: "2026-01-31" });
    expect(getNextOccurrenceDate(jan31, "2026-01-31")).toBe("2026-02-28");
    expect(getNextOccurrenceDate(jan31, "2026-02-28")).toBe("2026-03-31");
    expect(getNextOccurrenceDate(recurring({ startDate: "2024-01-31" }), "2024-01-31")).toBe("2024-02-29");
    expect(getNextOccurrenceDate(recurring({ startDate: "2026-01-30" }), "2026-01-30")).toBe("2026-02-28");
    expect(getNextOccurrenceDate(recurring({ startDate: "2026-01-30" }), "2026-02-28")).toBe("2026-03-30");
  });

  it("pads date-only inputs and handles annual year rollover", () => {
    const annual = recurring({ frequency: "yearly", startDate: "2024-02-29", nextDueDate: "2024-02-29" });
    expect(getNextOccurrenceDate(annual, "2024-2-29")).toBe("2025-02-28");
    expect(getNextOccurrenceDate(annual, "2027-02-28")).toBe("2028-02-29");
    const next = getNextRecurrenceDate(
      recurring({ nextDueDate: "2026-9-20" }),
      new Date("2026-11-19T12:00:00")
    );
    expect(dateKeyFromParts(next.getFullYear(), next.getMonth() + 1, next.getDate())).toBe("2026-11-20");
  });
});

describe("forecast", () => {
  it("subtracts expenses and adds income", () => {
    const forecast = generateForecast(
      10000,
      [
        recurring({ nextDueDate: "2026-11-20", amount: 1000 }),
        recurring({ id: "income", nextDueDate: "2026-11-21", amount: 2500, transactionType: "income" }),
      ],
      3,
      new Date("2026-11-19T12:00:00")
    );
    expect(forecast.map((day) => day.projectedBalance)).toEqual([10000, 9000, 11500]);
  });

  it("finds the lowest projected balance", () => {
    expect(getLowestProjectedBalance([
      { date: "2026-11-19", projectedBalance: 10000 },
      { date: "2026-11-20", projectedBalance: 7000 },
    ])).toBe(7000);
  });

  it("checks whether a purchase leaves enough projected cash", () => {
    expect(canAffordAmount([{ date: "2026-11-20", projectedBalance: 5000 }], 4500).affordable).toBe(true);
    expect(canAffordAmount([{ date: "2026-11-20", projectedBalance: 4000 }], 4500).affordable).toBe(false);
  });
});
