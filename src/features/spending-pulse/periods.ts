import type { Budget, Category, Transaction } from "@/domain/types";
import type { SpendingPulseBar, SpendingPulsePeriod, SpendingPulseStats } from "./types";

export const SPENDING_TIME_ZONE = "Asia/Manila";

export interface SpendingPulseOptions {
  budgetCycleStartDay: number;
  weekStartsOn: number;
}

export interface SpendingPulseRange {
  start: string;
  end: string;
  previousStart: string;
  previousEnd: string;
  elapsedDays: number;
}

function normalizedCycleStartDay(cycleStartDay: number): number {
  return Number.isFinite(cycleStartDay)
    ? Math.max(1, Math.min(31, Math.floor(cycleStartDay)))
    : 1;
}

function dateKeyInManila(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SPENDING_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateParts(dateKey: string): [number, number, number] {
  const [year, month, day] = dateKey.split("-").map(Number);
  return [year, month, day];
}

function keyFromUtcDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function addDateDays(dateKey: string, days: number): string {
  const [year, month, day] = dateParts(dateKey);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return keyFromUtcDate(date);
}

export function daysBetweenDateKeys(start: string, end: string): number {
  const [startYear, startMonth, startDay] = dateParts(start);
  const [endYear, endMonth, endDay] = dateParts(end);
  return Math.round(
    (Date.UTC(endYear, endMonth - 1, endDay) - Date.UTC(startYear, startMonth - 1, startDay))
      / 86_400_000
  );
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function cycleStartForDate(dateKey: string, cycleStartDay: number): string {
  const [year, month, day] = dateParts(dateKey);
  const startDay = normalizedCycleStartDay(cycleStartDay);
  const effectiveStartDay = Math.min(startDay, daysInMonth(year, month));
  const monthIndex = day >= effectiveStartDay ? month - 1 : month - 2;
  const startYear = year + Math.floor(monthIndex / 12);
  const normalizedMonth = ((monthIndex % 12) + 12) % 12;
  const startMonth = normalizedMonth + 1;
  return `${startYear}-${String(startMonth).padStart(2, "0")}-${String(Math.min(startDay, daysInMonth(startYear, startMonth))).padStart(2, "0")}`;
}

function previousCycleStart(start: string, cycleStartDay: number): string {
  const [year, month] = dateParts(start);
  const monthIndex = month - 2;
  const previousYear = year + Math.floor(monthIndex / 12);
  const normalizedMonth = ((monthIndex % 12) + 12) % 12;
  const previousMonth = normalizedMonth + 1;
  const day = normalizedCycleStartDay(cycleStartDay);
  return `${previousYear}-${String(previousMonth).padStart(2, "0")}-${String(Math.min(day, daysInMonth(previousYear, previousMonth))).padStart(2, "0")}`;
}

function weekStart(dateKey: string, weekStartsOn: number): string {
  const [year, month, day] = dateParts(dateKey);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  const normalizedStart = ((Math.floor(weekStartsOn) % 7) + 7) % 7;
  return addDateDays(dateKey, -((weekday - normalizedStart + 7) % 7));
}

export function getSpendingPulseRange(
  period: SpendingPulsePeriod,
  now: Date,
  options: SpendingPulseOptions
): SpendingPulseRange {
  const today = dateKeyInManila(now);
  let start: string;
  let end: string;
  let previousStart: string;
  let previousEnd: string;

  if (period === "day") {
    start = end = today;
    previousStart = previousEnd = addDateDays(today, -1);
  } else if (period === "week") {
    start = weekStart(today, options.weekStartsOn);
    end = addDateDays(start, 6);
    const elapsedDays = daysBetweenDateKeys(start, today) + 1;
    previousStart = addDateDays(start, -7);
    previousEnd = addDateDays(previousStart, elapsedDays - 1);
  } else if (period === "month") {
    start = cycleStartForDate(today, options.budgetCycleStartDay);
    const previousCycle = previousCycleStart(start, options.budgetCycleStartDay);
    const [, cycleStartMonth] = dateParts(start);
    const [cycleStartYear] = dateParts(start);
    const nextMonthIndex = cycleStartMonth;
    const nextYear = cycleStartYear + Math.floor(nextMonthIndex / 12);
    const nextMonth = (nextMonthIndex % 12) + 1;
    const cycleStartDay = normalizedCycleStartDay(options.budgetCycleStartDay);
    const nextCycleStart = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(Math.min(cycleStartDay, daysInMonth(nextYear, nextMonth))).padStart(2, "0")}`;
    end = addDateDays(nextCycleStart, -1);
    previousStart = previousCycle;
    const previousNextMonthIndex = dateParts(previousCycle)[1];
    const previousNextYear = dateParts(previousCycle)[0] + Math.floor(previousNextMonthIndex / 12);
    const previousNextMonth = (previousNextMonthIndex % 12) + 1;
    const previousNextCycleStart = `${previousNextYear}-${String(previousNextMonth).padStart(2, "0")}-${String(Math.min(cycleStartDay, daysInMonth(previousNextYear, previousNextMonth))).padStart(2, "0")}`;
    const previousCycleEnd = addDateDays(previousNextCycleStart, -1);
    const elapsedDays = daysBetweenDateKeys(start, today) + 1;
    previousEnd = today === end
      ? previousCycleEnd
      : addDateDays(previousStart, Math.min(elapsedDays, daysBetweenDateKeys(previousStart, previousCycleEnd) + 1) - 1);
  } else {
    start = addDateDays(today, -6);
    end = today;
    previousStart = addDateDays(start, -7);
    previousEnd = addDateDays(today, -7);
  }

  return {
    start,
    end,
    previousStart,
    previousEnd,
    elapsedDays: daysBetweenDateKeys(start, today) + 1,
  };
}

function sumExpenses(transactions: Transaction[], start: string, end: string): number {
  return transactions.reduce((sum, transaction) => {
    if (transaction.type !== "expense" || transaction.deletedAt || transaction.cancelledAt) return sum;
    const date = transaction.date.slice(0, 10);
    if (date < start || date > end) return sum;
    return sum + (transaction.personalShareAmount ?? transaction.amount);
  }, 0);
}

function sumDate(transactions: Transaction[], date: string): number {
  return sumExpenses(transactions, date, date);
}

function chartBars(
  period: SpendingPulsePeriod,
  transactions: Transaction[],
  today: string,
  options: SpendingPulseOptions
): SpendingPulseBar[] {
  let dates: string[];
  if (period === "day" || period === "sevenDays") {
    dates = Array.from({ length: 7 }, (_, index) => addDateDays(today, index - 6));
  } else if (period === "week") {
    const start = weekStart(today, options.weekStartsOn);
    dates = Array.from({ length: 7 }, (_, index) => addDateDays(start, index));
  } else {
    const start = cycleStartForDate(today, options.budgetCycleStartDay);
    const end = getSpendingPulseRange("month", new Date(`${today}T12:00:00Z`), options).end;
    dates = [];
    for (let cursor = start; cursor <= end; cursor = addDateDays(cursor, 7)) dates.push(cursor);
    return dates.map((date, index) => {
      const lastDay = index === dates.length - 1 ? end : addDateDays(date, 6);
      const future = date > today;
      return {
        date,
        label: `W${index + 1}`,
        amount: future ? 0 : sumExpenses(transactions, date, lastDay < today ? lastDay : today),
        highlighted: !future,
        future,
      };
    });
  }

  return dates.map((date) => {
    const future = date > today;
    return {
      date,
      label: new Intl.DateTimeFormat("en-PH", {
        weekday: "narrow",
        timeZone: "UTC",
      }).format(new Date(`${date}T12:00:00Z`)),
      amount: future ? 0 : sumDate(transactions, date),
      highlighted: period === "sevenDays" || (period === "day" && date === today) || (period === "week" && !future),
      future,
    };
  });
}

export function getSpendingPulseStats(
  period: SpendingPulsePeriod,
  transactions: Transaction[],
  now: Date,
  options: SpendingPulseOptions,
  budgets: Budget[] = [],
  categories: Category[] = []
): SpendingPulseStats {
  const today = dateKeyInManila(now);
  const range = getSpendingPulseRange(period, now, options);
  const total = sumExpenses(transactions, range.start, today < range.end ? today : range.end);
  const previousTotal = sumExpenses(transactions, range.previousStart, range.previousEnd);
  const change = total === previousTotal ? "same" : previousTotal === 0 ? "new" : total > previousTotal ? "more" : "less";
  const changePercent = previousTotal === 0 ? null : Math.round(Math.abs((total - previousTotal) / previousTotal) * 100);
  const previousSevenDays = Array.from({ length: 7 }, (_, index) => sumDate(transactions, addDateDays(today, index - 7)));
  const budgetCycleStart = cycleStartForDate(today, options.budgetCycleStartDay);
  const budgetedCategoryIds = new Set(
    categories.filter((category) => category.type === "expense").map((category) => category.id)
  );
  const monthlyBudgets = budgets.filter((budget) =>
    budget.period === "monthly" && budgetedCategoryIds.has(budget.categoryId)
  );
  const budgetCycleCategoryIds = new Set(monthlyBudgets.map((budget) => budget.categoryId));
  const budgetCycleSpent = transactions.reduce((sum, transaction) => {
    if (
      transaction.type !== "expense"
      || transaction.deletedAt
      || transaction.cancelledAt
      || !transaction.categoryId
      || !budgetCycleCategoryIds.has(transaction.categoryId)
      || transaction.date.slice(0, 10) < budgetCycleStart
      || transaction.date.slice(0, 10) > today
    ) return sum;
    return sum + (transaction.personalShareAmount ?? transaction.amount);
  }, 0);
  const hasExpenseHistory = transactions.some((transaction) =>
    transaction.type === "expense"
    && !transaction.deletedAt
    && !transaction.cancelledAt
    && transaction.date.slice(0, 10) <= today
  );

  return {
    total,
    previousTotal,
    changePercent,
    change,
    todayTotal: sumDate(transactions, today),
    averagePreviousSevenDays: previousSevenDays.reduce((sum, amount) => sum + amount, 0) / 7,
    budgetCycleSpent,
    budgetCycleLimit: monthlyBudgets.reduce((sum, budget) => sum + budget.amount, 0),
    hasExpenseHistory,
    elapsedDays: range.elapsedDays,
    bars: chartBars(period, transactions, today, options),
  };
}

export function formatSpendingDate(dateKey: string, options: Intl.DateTimeFormatOptions = {}): string {
  const [year, month, day] = dateParts(dateKey);
  return new Intl.DateTimeFormat("en-PH", { timeZone: "UTC", ...options })
    .format(new Date(Date.UTC(year, month - 1, day, 12)));
}
