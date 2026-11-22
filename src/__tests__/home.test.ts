import { describe, expect, it } from "vitest";
import { computeInsights } from "@/domain/homeInsights";
import { getHomePeriodRange } from "@/domain/homePeriod";
import { ACCENT_PRESETS, contrastingForeground, contrastRatio } from "@/lib/themeContrast";
import type { Budget, Category, Transaction } from "@/domain/types";

function transaction(id: string, categoryId: string, amount: number, date: string, type: "expense" | "income" = "expense"): Transaction {
  return {
    id,
    profileId: "profile-1",
    type,
    amount,
    accountId: "account-1",
    categoryId,
    date,
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`,
  };
}

describe("Home insights", () => {
  it("ranks a budget warning before category and largest-expense insights", () => {
    const categories: Category[] = [{
      id: "food",
      profileId: "profile-1",
      name: "Food",
      parentId: null,
      type: "expense",
      icon: "utensils",
      color: "#DC2626",
      sortOrder: 0,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    }];
    const budgets: Budget[] = [{
      id: "budget-food",
      profileId: "profile-1",
      categoryId: "food",
      period: "monthly",
      amount: 10_000,
      rolloverEnabled: false,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    }];
    const transactions = [
      transaction("1", "food", 3_000, "2026-11-10"),
      transaction("2", "food", 3_000, "2026-11-11"),
      transaction("3", "food", 3_000, "2026-11-12"),
    ];
    const candidates = computeInsights({
      transactions,
      previousTransactions: [],
      budgets,
      categories,
      period: "month",
      now: new Date("2026-11-23T12:00:00+08:00"),
      locale: "en",
    });
    expect(candidates[0].kind).toBe("budget");
    expect(candidates[0].text).toContain("90%");
  });

  it("uses neutral and non-judgmental category wording for a 15% change", () => {
    const categories: Category[] = [{
      id: "food",
      profileId: "profile-1",
      name: "Food",
      parentId: null,
      type: "expense",
      icon: "utensils",
      color: "#DC2626",
      sortOrder: 0,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    }];
    const transactions = [
      transaction("1", "food", 3_000, "2026-11-10"),
      transaction("2", "food", 3_000, "2026-11-11"),
      transaction("3", "food", 1_000, "2026-11-12"),
    ];
    const previous = [
      transaction("4", "food", 4_500, "2026-10-10"),
      transaction("5", "food", 4_500, "2026-10-11"),
    ];
    const candidates = computeInsights({
      transactions,
      previousTransactions: previous,
      budgets: [],
      categories,
      period: "month",
      now: new Date("2026-11-23T12:00:00+08:00"),
      locale: "en",
    });
    expect(candidates[0].kind).toBe("category");
    expect(candidates[0].text).toContain("less");
  });

  it("hides candidates when fewer than three transactions exist", () => {
    expect(computeInsights({
      transactions: [transaction("1", "food", 1_000, "2026-11-10"), transaction("2", "food", 1_000, "2026-11-11")],
      previousTransactions: [],
      budgets: [],
      categories: [],
      period: "month",
      now: new Date("2026-11-23T12:00:00+08:00"),
      locale: "en",
    })).toEqual([]);
  });

  it("uses a clear rolling seven-day comparison in category insights", () => {
    const categories: Category[] = [{
      id: "food",
      profileId: "profile-1",
      name: "Food",
      parentId: null,
      type: "expense",
      icon: "utensils",
      color: "#DC2626",
      sortOrder: 0,
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-01T00:00:00.000Z",
    }];
    const candidates = computeInsights({
      transactions: [
        transaction("1", "food", 3_000, "2026-11-20"),
        transaction("2", "food", 3_000, "2026-11-21"),
        transaction("3", "food", 3_000, "2026-11-22"),
      ],
      previousTransactions: [
        transaction("4", "food", 6_000, "2026-11-13"),
        transaction("5", "food", 6_000, "2026-11-14"),
      ],
      budgets: [],
      categories,
      period: "sevenDays",
      now: new Date("2026-11-23T12:00:00+08:00"),
      locale: "en",
    });

    expect(candidates[0].text).toContain("the previous 7 days");
  });
});

describe("Home period ranges", () => {
  it("produces stable local date keys in Manila and UTC", () => {
    for (const timezone of ["Asia/Manila", "UTC"]) {
      const previousTimezone = process.env.TZ;
      process.env.TZ = timezone;
      const date = new Date("2026-11-23T12:00:00Z");
      const range = getHomePeriodRange("month", date, "en-US", date);
      expect(range.start).toBe("2026-11-01");
      expect(range.end).toBe("2026-11-30");
      if (previousTimezone === undefined) delete process.env.TZ;
      else process.env.TZ = previousTimezone;
    }
  });

  it("uses the elapsed month portion for an in-progress month", () => {
    const now = new Date(2026, 10, 23, 12);
    const range = getHomePeriodRange("month", now, "en-US", now);
    expect(range.start).toBe("2026-11-01");
    expect(range.end).toBe("2026-11-30");
    expect(range.comparableStart).toBe("2026-10-01");
    expect(range.comparableEnd).toBe("2026-10-23");
    expect(range.inProgress).toBe(true);
  });

  it("uses full periods for a finished month", () => {
    const selected = new Date(2026, 9, 15, 12);
    const now = new Date(2026, 10, 23, 12);
    const range = getHomePeriodRange("month", selected, "en-US", now);
    expect(range.start).toBe("2026-10-01");
    expect(range.end).toBe("2026-10-31");
    expect(range.comparableStart).toBe("2026-09-01");
    expect(range.comparableEnd).toBe("2026-09-30");
    expect(range.inProgress).toBe(false);
  });
});

describe("Theme accent contrast", () => {
  const themes = {
    light: { foreground: "#14532D", surface: "#FFFFFF" },
    dark: { foreground: "#F2F5F4", surface: "#151B19" },
    amoled: { foreground: "#F2F5F4", surface: "#0B0F0E" },
  };

  it("passes text and UI contrast for every preset and a custom accent", () => {
    for (const [, accent] of [...ACCENT_PRESETS, ["Custom", "#7C3AED"] as const]) {
      for (const theme of Object.values(themes)) {
        const foreground = contrastingForeground(accent);
        expect(contrastRatio(foreground, accent)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(accent, theme.surface)).toBeGreaterThanOrEqual(3);
        expect(contrastRatio(theme.foreground, theme.surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
