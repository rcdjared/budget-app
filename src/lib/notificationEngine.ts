import type {
  Budget,
  Debt,
  Goal,
  InboxNotification,
  NotificationCategory,
  Recurring,
  SharedBillMember,
  Transaction,
  FriendLedgerEntry,
} from "@/domain/types";
import type { NotificationPreferences } from "@/lib/settings";
import { NOTIFICATION_THRESHOLDS } from "@/lib/notificationsConfig";
import { tForLanguage } from "@/lib/localization";
import { dateKeyFromParts } from "@/lib/format";

export interface BudgetCrossing {
  budgetId: string;
  cycleKey: string;
  percentage: 80 | 100;
}

export interface BudgetSpendSnapshot {
  budgetId: string;
  cycleKey: string;
  spent: number;
  limit: number;
}

export interface NotificationData {
  transactions: Transaction[];
  recurring: Recurring[];
  budgets: Budget[];
  debts: Debt[];
  goals: Goal[];
  friendLedger: FriendLedgerEntry[];
  sharedBillMembers: SharedBillMember[];
  budgetCrossings?: BudgetCrossing[];
}

export interface DueNotification {
  category: NotificationCategory;
  title: string;
  body: string;
  route: string;
  dedupe_key: string;
}

const categoryEnabled = (settings: NotificationPreferences, category: NotificationCategory) =>
  settings.enabled && settings.categories[category];

function localDateTime(date: Date, timezone: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || "";
  return {
    date: dateKeyFromParts(Number(get("year")), Number(get("month")), Number(get("day"))),
    time: `${get("hour")}:${get("minute")}`,
  };
}

function daysBetween(from: string, to: string): number {
  const fromMs = Date.parse(`${from}T00:00:00Z`);
  const toMs = Date.parse(`${to}T00:00:00Z`);
  return Math.round((toMs - fromMs) / 86_400_000);
}

function isReminderTime(settings: NotificationPreferences, local: { date: string; time: string }): boolean {
  return local.time >= settings.reminderTime;
}

export function getBudgetSpendSnapshot(
  budgets: Budget[],
  transactions: Transaction[],
  date: string
): BudgetSpendSnapshot[] {
  return budgets.filter((budget) => !budget.deletedAt).map((budget) => {
    const cycleKey = budgetCycleKey(date, budget.period);
    const cycleStart = budget.period === "daily" ? date
      : budget.period === "weekly" ? cycleKey
      : budget.period === "biweekly" ? cycleKey
      : budget.period === "annual" ? `${cycleKey}-01-01`
      : `${cycleKey}-01`;
    const spent = transactions
      .filter((transaction) =>
        !transaction.deletedAt &&
        !transaction.cancelledAt &&
        transaction.type === "expense" &&
        transaction.categoryId === budget.categoryId &&
        transaction.date >= cycleStart &&
        transaction.date <= date
      )
      .reduce((sum, transaction) => sum + (transaction.personalShareAmount ?? transaction.amount), 0);
    return { budgetId: budget.id, cycleKey, spent, limit: budget.amount };
  });
}

export function detectBudgetCrossings(
  previous: BudgetSpendSnapshot[],
  current: BudgetSpendSnapshot[]
): BudgetCrossing[] {
  const previousByKey = new Map(previous.map((snapshot) => [`${snapshot.budgetId}:${snapshot.cycleKey}`, snapshot]));
  const crossings: BudgetCrossing[] = [];
  for (const snapshot of current) {
    if (snapshot.limit <= 0) continue;
    const before = previousByKey.get(`${snapshot.budgetId}:${snapshot.cycleKey}`);
    if (!before) continue;
    for (const percentage of NOTIFICATION_THRESHOLDS.budgetPercentages) {
      if (before.spent * 100 < before.limit * percentage
        && snapshot.spent * 100 >= snapshot.limit * percentage) {
        crossings.push({
          budgetId: snapshot.budgetId,
          cycleKey: snapshot.cycleKey,
          percentage,
        });
      }
    }
  }
  return crossings;
}

function budgetCycleKey(date: string, period: Budget["period"]): string {
  const [year, month, day] = date.split("-").map(Number);
  if (period === "daily") return dateKeyFromParts(year, month, day);
  if (period === "weekly") {
    const current = new Date(Date.UTC(year, month - 1, day));
    const weekday = (current.getUTCDay() + 6) % 7;
    current.setUTCDate(current.getUTCDate() - weekday);
    return dateKeyFromParts(current.getUTCFullYear(), current.getUTCMonth() + 1, current.getUTCDate());
  }
  if (period === "biweekly") return dateKeyFromParts(year, month, day <= 15 ? 1 : 16);
  if (period === "annual") return String(year);
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function computeDueNotifications(
  now: Date,
  data: NotificationData,
  settings: NotificationPreferences,
  language: "en" | "fil" = "en"
): DueNotification[] {
  if (!settings.enabled) return [];
  const local = localDateTime(now, settings.timezone);
  const due: DueNotification[] = [];

  if (categoryEnabled(settings, "dailyCheckIn")
    && isReminderTime(settings, local)
    && !data.transactions.some((transaction) => !transaction.deletedAt && !transaction.cancelledAt && transaction.date === local.date)) {
    due.push({
      category: "dailyCheckIn",
      title: tForLanguage("checkInNotificationTitle", language),
      body: tForLanguage("checkInNotificationBody", language),
      route: "home",
      dedupe_key: `dailyCheckIn:${local.date}`,
    });
  }

  if (categoryEnabled(settings, "budgetAlerts")) {
    for (const crossing of data.budgetCrossings || []) {
      due.push({
        category: "budgetAlerts",
        title: tForLanguage(crossing.percentage === 100 ? "budgetLimitNotificationTitle" : "budgetCloseNotificationTitle", language),
        body: tForLanguage(crossing.percentage === 100 ? "budgetLimitNotificationBody" : "budgetCloseNotificationBody", language),
        route: "plan",
        dedupe_key: `budget:${crossing.budgetId}:${crossing.cycleKey}:${crossing.percentage}`,
      });
    }
  }

  if (isReminderTime(settings, local) && categoryEnabled(settings, "recurring")) {
    for (const item of data.recurring) {
      if (item.deletedAt || item.isPaused || item.transactionType === "transfer") continue;
      const offset = daysBetween(local.date, item.nextDueDate);
      if (offset !== 0 && offset !== 1) continue;
      due.push({
        category: "recurring",
        title: tForLanguage(offset === 0 ? "recurringTodayNotificationTitle" : "recurringTomorrowNotificationTitle", language),
        body: tForLanguage("recurringNotificationBody", language),
        route: "plan",
        dedupe_key: `recurring:${item.id}:${item.nextDueDate}:${offset}`,
      });
    }
  }

  if (isReminderTime(settings, local) && categoryEnabled(settings, "debts")) {
    for (const debt of data.debts) {
      if (debt.deletedAt || debt.direction !== "i_owe" || !debt.dueDate) continue;
      const days = daysBetween(local.date, debt.dueDate);
      if (days < 0 || days > NOTIFICATION_THRESHOLDS.debtDaysAhead) continue;
      due.push({
        category: "debts",
        title: tForLanguage(days === 0 ? "debtTodayNotificationTitle" : "debtSoonNotificationTitle", language),
        body: tForLanguage("debtNotificationBody", language),
        route: "plan",
        dedupe_key: `debt:${debt.id}:${debt.dueDate}`,
      });
    }
  }

  if (isReminderTime(settings, local) && categoryEnabled(settings, "goals")) {
    for (const goal of data.goals) {
      if (goal.deletedAt) continue;
      const days = daysBetween(local.date, goal.targetDate);
      if (days < 0 || days > NOTIFICATION_THRESHOLDS.goalDaysAhead) continue;
      const saved = data.transactions
        .filter((transaction) =>
          !transaction.deletedAt &&
          !transaction.cancelledAt &&
          transaction.type === "income" &&
          transaction.date <= goal.targetDate
        )
        .reduce((sum, transaction) => sum + transaction.amount, 0);
      if (saved >= goal.targetAmount) continue;
      due.push({
        category: "goals",
        title: tForLanguage("goalNotificationTitle", language),
        body: tForLanguage("goalNotificationBody", language),
        route: "plan",
        dedupe_key: `goal:${goal.id}:${goal.targetDate}`,
      });
    }
  }

  if (isReminderTime(settings, local) && categoryEnabled(settings, "receivables")) {
    const friendBalances = new Map<string, number>();
    for (const entry of data.friendLedger) {
      if (entry.deletedAt || entry.type === "shared_bill") continue;
      friendBalances.set(
        entry.friendId,
        (friendBalances.get(entry.friendId) || 0) + (entry.direction === "owed_to_me" ? entry.amount : -entry.amount)
      );
    }
    for (const entry of data.friendLedger) {
      if (entry.deletedAt || entry.type === "shared_bill" || entry.direction !== "owed_to_me"
        || !entry.expectedBy || (friendBalances.get(entry.friendId) || 0) <= 0) continue;
      const days = daysBetween(local.date, entry.expectedBy);
      if (days < 0 || days > NOTIFICATION_THRESHOLDS.receivableDaysAhead) continue;
      due.push({
        category: "receivables",
        title: tForLanguage("receivableNotificationTitle", language),
        body: tForLanguage("receivableNotificationBody", language),
        route: "friends",
        dedupe_key: `receivable:friend:${entry.friendId}:${entry.expectedBy}`,
      });
    }
    for (const member of data.sharedBillMembers) {
      if (member.status === "paid" || member.amount <= member.paidAmount || !member.expectedBy || !member.friendId) continue;
      const days = daysBetween(local.date, member.expectedBy);
      if (days < 0 || days > NOTIFICATION_THRESHOLDS.receivableDaysAhead) continue;
      due.push({
        category: "receivables",
        title: tForLanguage("sharedBillNotificationTitle", language),
        body: tForLanguage("sharedBillNotificationBody", language),
        route: "friends",
        dedupe_key: `receivable:bill:${member.id}:${member.expectedBy}`,
      });
    }
  }
  return due;
}

export function toInboxNotification(
  item: DueNotification,
  profileId: string,
  createdAt = new Date().toISOString()
): InboxNotification {
  return {
    id: crypto.randomUUID(),
    profileId,
    category: item.category,
    title: item.title,
    body: item.body,
    created_at: createdAt,
    read_at: null,
    route: item.route,
    dedupe_key: item.dedupe_key,
  };
}
