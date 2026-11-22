import { describe, expect, it } from "vitest";
import type { Budget, FriendLedgerEntry, Recurring, Transaction } from "@/domain/types";
import { computeDueNotifications, detectBudgetCrossings, type NotificationData } from "@/lib/notificationEngine";
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/settings";

const emptyData: NotificationData = {
  transactions: [],
  recurring: [],
  budgets: [],
  debts: [],
  goals: [],
  friendLedger: [],
  sharedBillMembers: [],
};

function preferences() {
  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    enabled: true,
    categories: { ...DEFAULT_NOTIFICATION_PREFERENCES.categories, dailyCheckIn: false },
  };
}

describe("notification engine", () => {
  it("uses the saved timezone and reminder time for daily check-ins", () => {
    const settings = { ...preferences(), timezone: "America/Los_Angeles", reminderTime: "20:00" };
    const beforeTime = computeDueNotifications(new Date("2026-03-10T02:59:00Z"), emptyData, settings);
    const atTime = computeDueNotifications(new Date("2026-03-10T03:00:00Z"), emptyData, {
      ...settings,
      categories: { ...settings.categories, dailyCheckIn: true },
    });
    const laterReminderTime = computeDueNotifications(new Date("2026-03-10T03:30:00Z"), emptyData, {
      ...settings,
      reminderTime: "21:00",
      categories: { ...settings.categories, dailyCheckIn: true },
    });

    expect(beforeTime).toHaveLength(0);
    expect(atTime.map((item) => item.dedupe_key)).toContain("dailyCheckIn:2026-03-09");
    expect(laterReminderTime).toHaveLength(0);
  });

  it("returns a stable dedupe key for the same recurring occurrence", () => {
    const recurring: Recurring = {
      id: "rule-1",
      profileId: "profile",
      amount: 12000,
      accountId: "account",
      transactionType: "expense",
      frequency: "monthly",
      startDate: "2026-01-01",
      nextDueDate: "2026-03-10",
      kind: "bill",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const settings = { ...preferences(), timezone: "UTC", reminderTime: "20:00" };
    const now = new Date("2026-03-09T20:00:00Z");
    const data = { ...emptyData, recurring: [recurring] };
    const first = computeDueNotifications(now, data, settings);
    const reopened = computeDueNotifications(now, data, settings);

    expect(first).toHaveLength(1);
    expect(reopened[0].dedupe_key).toBe(first[0].dedupe_key);
    expect(first[0].dedupe_key).toBe("recurring:rule-1:2026-03-10:1");
  });

  it("detects the 80% and 100% threshold crossings once per budget cycle", () => {
    const budget = {
      id: "food",
      profileId: "profile",
      categoryId: "food",
      period: "monthly",
      amount: 1000,
      rolloverEnabled: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } satisfies Budget;
    const before = [{ budgetId: budget.id, cycleKey: "2026-03", spent: 799, limit: 1000 }];
    const atEighty = [{ budgetId: budget.id, cycleKey: "2026-03", spent: 800, limit: 1000 }];
    const atLimit = [{ budgetId: budget.id, cycleKey: "2026-03", spent: 1000, limit: 1000 }];

    expect(detectBudgetCrossings(before, atEighty).map((crossing) => crossing.percentage)).toEqual([80]);
    expect(detectBudgetCrossings(atEighty, atLimit).map((crossing) => crossing.percentage)).toEqual([100]);
    expect(detectBudgetCrossings(before, [{ ...atEighty[0], cycleKey: "2026-04" }])).toEqual([]);
  });

  it("does not create alerts while the master switch is off", () => {
    const transaction: Transaction = {
      id: "today",
      profileId: "profile",
      type: "expense",
      amount: 100,
      accountId: "account",
      date: "2026-03-09",
      createdAt: "2026-03-09T00:00:00.000Z",
      updatedAt: "2026-03-09T00:00:00.000Z",
    };
    const settings = { ...preferences(), enabled: false, timezone: "UTC", reminderTime: "20:00" };
    expect(computeDueNotifications(new Date("2026-03-09T21:00:00Z"), {
      ...emptyData,
      transactions: [transaction],
    }, settings)).toEqual([]);
  });

  it("only reminds about friend receivables that still have a positive balance", () => {
    const share: FriendLedgerEntry = {
      id: "share",
      profileId: "profile",
      friendId: "friend",
      transactionId: "expense",
      type: "expense_share",
      direction: "owed_to_me",
      amount: 10_000,
      date: "2026-03-01",
      expectedBy: "2026-03-11",
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
    };
    const payment: FriendLedgerEntry = {
      id: "payment",
      profileId: "profile",
      friendId: "friend",
      type: "payment",
      direction: "you_owe",
      amount: 10_000,
      date: "2026-03-05",
      createdAt: "2026-03-05T00:00:00.000Z",
      updatedAt: "2026-03-05T00:00:00.000Z",
    };
    const settings = { ...preferences(), timezone: "UTC", reminderTime: "20:00" };
    const now = new Date("2026-03-09T20:00:00Z");

    expect(computeDueNotifications(now, { ...emptyData, friendLedger: [share] }, settings)
      .map((item) => item.category)).toContain("receivables");
    expect(computeDueNotifications(now, { ...emptyData, friendLedger: [share, payment] }, settings))
      .toEqual([]);
  });
});
