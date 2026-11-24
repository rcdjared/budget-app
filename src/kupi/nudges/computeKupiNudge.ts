import type { Budget, Transaction } from "@/domain/types";
import { computeMood, type MoodResult } from "../responses/generateResponse";

const DAY_MS = 86_400_000;
const DAY_COOLDOWN_MS = 24 * 60 * 60 * 1_000;
const SAFE_TO_SPEND_COOLDOWN_MS = 12 * 60 * 60 * 1_000;
const CRITICAL_PACING_PERCENT = 80;
const URGENT_TOTAL_PACING_PERCENT = 90;
const CRITICAL_PACING_DAYS_LEFT = 5;
const MICRO_SPEND_MAX_CENTAVOS = 5_000;
const MICRO_SPEND_COUNT = 3;
const ZERO_SPEND_STREAK_DAYS = 3;
const STREAK_LOOKBACK_DAYS = 30;

export interface KupiNudge {
  id: string;
  priority: number;
  cooldownMs: number;
  facts: Readonly<Record<string, string | number>>;
  mood: MoodResult["mood"];
  intensity: MoodResult["intensity"];
  tags: string[];
}

interface BudgetCycle {
  start: string;
  end: string;
  daysLeft: number;
}

function dateKeyInManila(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Kupi nudges require a valid date.");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function addDays(dateKey: string, days: number): string {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetweenInclusive(start: string, end: string): number {
  return Math.floor((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / DAY_MS) + 1;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function budgetCycle(period: Budget["period"], today: string): BudgetCycle {
  const [year, month, day] = today.split("-").map(Number);
  let start: string;
  let end: string;
  switch (period) {
    case "daily":
      start = end = today;
      break;
    case "weekly": {
      const weekday = new Date(`${today}T00:00:00.000Z`).getUTCDay();
      start = addDays(today, -((weekday + 6) % 7));
      end = addDays(start, 6);
      break;
    }
    case "biweekly":
      start = `${today.slice(0, 7)}-${day <= 15 ? "01" : "16"}`;
      end = day <= 15 ? `${today.slice(0, 7)}-15` : `${today.slice(0, 7)}-${daysInMonth(year, month)}`;
      break;
    case "annual":
      start = `${year}-01-01`;
      end = `${year}-12-31`;
      break;
    case "monthly":
    default:
      start = `${today.slice(0, 7)}-01`;
      end = `${today.slice(0, 7)}-${daysInMonth(year, month)}`;
      break;
  }
  return { start, end, daysLeft: daysBetweenInclusive(today, end) };
}

function liveTransactions(transactions: readonly Transaction[]): Transaction[] {
  return transactions.filter((transaction) => !transaction.deletedAt && !transaction.cancelledAt);
}

function expenseAmount(transaction: Transaction): number {
  return transaction.personalShareAmount ?? transaction.amount;
}

function makeNudge(
  id: string,
  priority: number,
  cooldownMs: number,
  facts: KupiNudge["facts"],
  moodState: Omit<Parameters<typeof computeMood>[0], "intent">,
): KupiNudge {
  return {
    id,
    priority,
    cooldownMs,
    facts,
    ...computeMood({ ...moodState, intent: "PROACTIVE" }, "classic"),
  };
}

/** Returns eligible nudges in priority order for an already profile-scoped snapshot. */
export function computeKupiNudge(
  transactions: readonly Transaction[],
  budgets: readonly Budget[],
  now: Date,
): KupiNudge[] {
  const today = dateKeyInManila(now);
  const live = liveTransactions(transactions);
  const todayTransactions = live.filter((transaction) => transaction.date.slice(0, 10) === today);
  const todayExpenses = todayTransactions
    .filter((transaction) => transaction.type === "expense")
    .map(expenseAmount);
  const activeBudgets = budgets.filter((budget) => !budget.deletedAt && budget.amount > 0);
  const eligibleBudgets = activeBudgets.map((budget) => {
    const cycle = budgetCycle(budget.period, today);
    const spent = live
      .filter((transaction) =>
        transaction.type === "expense"
        && transaction.categoryId === budget.categoryId
        && transaction.date.slice(0, 10) >= cycle.start
        && transaction.date.slice(0, 10) <= today
      )
      .reduce((sum, transaction) => sum + expenseAmount(transaction), 0);
    return { budget, spent, ...cycle };
  });

  const nudges: KupiNudge[] = [];
  for (const { budget, spent, daysLeft } of eligibleBudgets) {
    const rawPercent = (spent / budget.amount) * 100;
    const percent = Math.floor(rawPercent);
    if (spent > budget.amount) {
      nudges.push(makeNudge(
        `budget-exceeded:${budget.id}`,
        1,
        DAY_COOLDOWN_MS,
        { budgetId: budget.id, categoryId: budget.categoryId, spentCentavos: spent, budgetCentavos: budget.amount, percent, daysLeft },
        { catPercent: rawPercent },
      ));
    } else if (
      percent >= CRITICAL_PACING_PERCENT
      && (budget.period === "daily" || daysLeft >= CRITICAL_PACING_DAYS_LEFT)
    ) {
      nudges.push(makeNudge(
        `budget-pacing:${budget.id}`,
        2,
        DAY_COOLDOWN_MS,
        { budgetId: budget.id, categoryId: budget.categoryId, spentCentavos: spent, budgetCentavos: budget.amount, percent, daysLeft },
        { catPercent: percent },
      ));
    }
  }

  const budgetsByPeriod = new Map<Budget["period"], {
    spent: number;
    limit: number;
    daysLeft: number;
    count: number;
  }>();
  for (const { budget, spent, daysLeft } of eligibleBudgets) {
    const total = budgetsByPeriod.get(budget.period) ?? { spent: 0, limit: 0, daysLeft, count: 0 };
    total.spent += spent;
    total.limit += budget.amount;
    total.count += 1;
    budgetsByPeriod.set(budget.period, total);
  }
  for (const [period, total] of budgetsByPeriod) {
    if (total.count < 2) continue;
    const rawPercent = (total.spent / total.limit) * 100;
    const percent = Math.floor(rawPercent);
    const facts = {
      period,
      spentCentavos: total.spent,
      budgetCentavos: total.limit,
      percent,
      daysLeft: total.daysLeft,
    };
    if (total.spent > total.limit) {
      nudges.push(makeNudge(
        `budget-total-exceeded:${period}`,
        1,
        DAY_COOLDOWN_MS,
        facts,
        { catPercent: rawPercent },
      ));
    } else if (
      percent >= CRITICAL_PACING_PERCENT
      && (period === "daily" || total.daysLeft >= CRITICAL_PACING_DAYS_LEFT)
    ) {
      nudges.push(makeNudge(
        `budget-total-pacing:${period}`,
        rawPercent >= URGENT_TOTAL_PACING_PERCENT ? 1 : 2,
        DAY_COOLDOWN_MS,
        facts,
        { catPercent: rawPercent },
      ));
    }
  }

  const microSpendCount = todayExpenses.filter((amount) =>
    Number.isSafeInteger(amount) && amount > 0 && amount < MICRO_SPEND_MAX_CENTAVOS
  ).length;
  if (microSpendCount >= MICRO_SPEND_COUNT) {
    nudges.push(makeNudge(
      `micro-spend:${today}`,
      3,
      DAY_COOLDOWN_MS,
      { today, microSpendCount },
      { todayExpenseAmounts: todayExpenses },
    ));
  }

  const dailySafeToSpend = eligibleBudgets.reduce((sum, { budget, spent, daysLeft }) =>
    sum + Math.floor(Math.max(0, budget.amount - spent) / Math.max(1, daysLeft)), 0);
  if (eligibleBudgets.length > 0 && dailySafeToSpend > 0) {
    nudges.push(makeNudge(
      `daily-safe-to-spend:${today}`,
      6,
      SAFE_TO_SPEND_COOLDOWN_MS,
      { dailySafeToSpendCentavos: dailySafeToSpend, budgetCount: eligibleBudgets.length },
      {},
    ));
  }

  const expenseDates = new Set(live
    .filter((transaction) => transaction.type === "expense" && transaction.date.slice(0, 10) <= today)
    .map((transaction) => transaction.date.slice(0, 10)));
  if (expenseDates.size > 0 && !expenseDates.has(today)) {
    let streakDays = 0;
    for (let offset = 1; offset <= STREAK_LOOKBACK_DAYS; offset += 1) {
      if (expenseDates.has(addDays(today, -offset))) break;
      streakDays += 1;
    }
    if (streakDays >= ZERO_SPEND_STREAK_DAYS) {
      nudges.push(makeNudge(
        `zero-spend-streak:${today}`,
        4,
        DAY_COOLDOWN_MS,
        { streakDays },
        { streakDays },
      ));
    }
  }

  if (todayTransactions.length === 0) {
    nudges.push(makeNudge(
      `nothing-logged:${today}`,
      5,
      DAY_COOLDOWN_MS,
      { today },
      {},
    ));
  }

  return nudges.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}
