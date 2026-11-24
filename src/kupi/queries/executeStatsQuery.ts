import { computeAccountBalance, computeNetWorth } from "@/domain/balances";
import type { Account, Budget, Category, Transaction } from "@/domain/types";
import type { StatsQuery } from "../contracts";

export interface StatsQuerySnapshot {
  accounts: readonly Account[];
  budgets: readonly Budget[];
  categories: readonly Category[];
  transactions: readonly Transaction[];
  now?: Date;
}

export interface QueryPeriod {
  start: string;
  end: string;
  label: string;
  days: number;
}

export interface QueryGroup {
  key: string;
  name: string;
  amountCentavos: number;
  transactionCount: number;
}

interface BudgetTotals {
  amountCentavos: number;
  budgetsFound: boolean;
  budgetCount: number;
}

export type StatsQueryResult =
  | {
      metric: "total" | "daily_average";
      period: QueryPeriod;
      amountCentavos: number;
      transactionCount: number;
      groups?: QueryGroup[];
    }
  | {
      metric: "by_category";
      period: QueryPeriod;
      amountCentavos: number;
      groups: QueryGroup[];
    }
  | {
      metric: "top_category";
      period: QueryPeriod;
      amountCentavos: number;
      top: QueryGroup | null;
    }
  | {
      metric: "biggest_expense";
      period: QueryPeriod;
      transaction: {
        id: string;
        amountCentavos: number;
        category: string;
        account: string;
        date: string;
        note: string;
      } | null;
    }
  | { metric: "count"; period: QueryPeriod; transactionCount: number }
  | ({ metric: "remaining_budget" } & BudgetTotals)
  | ({ metric: "safe_to_spend"; dailyAmountCentavos: number } & Omit<BudgetTotals, "amountCentavos">)
  | {
      metric: "vs_last_period";
      period: QueryPeriod;
      previousPeriod: QueryPeriod;
      currentAmountCentavos: number;
      previousAmountCentavos: number;
      changeCentavos: number;
      changePercent: number | null;
    }
  | {
      metric: "net_worth";
      assetsCentavos: number;
      liabilitiesCentavos: number;
      netWorthCentavos: number;
    };

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function datePartsInManila(now: Date): DateParts {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Stats query requires a valid date.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

function keyFromParts({ year, month, day }: DateParts): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(key: string, days: number): string {
  const date = new Date(`${key}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function daysBetween(start: string, end: string): number {
  return Math.floor((Date.parse(`${end}T00:00:00.000Z`) - Date.parse(`${start}T00:00:00.000Z`)) / 86_400_000) + 1;
}

function validDateKey(key: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(key)) return false;
  const date = new Date(`${key}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === key;
}

function monthStart(key: string): string {
  return `${key.slice(0, 7)}-01`;
}

function monthEnd(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function periodFor(period: StatsQuery["period"], today: string): QueryPeriod {
  if (period && typeof period === "object") {
    if (!validDateKey(period.from) || !validDateKey(period.to) || period.from > period.to) {
      throw new RangeError("Custom query period must contain valid ordered YYYY-MM-DD dates.");
    }
    return { start: period.from, end: period.to, label: `${period.from} to ${period.to}`, days: daysBetween(period.from, period.to) };
  }

  const day = new Date(`${today}T00:00:00.000Z`);
  const weekdayFromMonday = (day.getUTCDay() + 6) % 7;
  const currentMonthStart = monthStart(today);
  switch (period ?? "this_month") {
    case "today":
      return { start: today, end: today, label: "today", days: 1 };
    case "yesterday": {
      const yesterday = addDays(today, -1);
      return { start: yesterday, end: yesterday, label: "yesterday", days: 1 };
    }
    case "this_week": {
      const start = addDays(today, -weekdayFromMonday);
      return { start, end: today, label: "this week", days: daysBetween(start, today) };
    }
    case "last_week": {
      const end = addDays(today, -weekdayFromMonday - 1);
      const start = addDays(end, -6);
      return { start, end, label: "last week", days: 7 };
    }
    case "last_month": {
      const end = addDays(currentMonthStart, -1);
      const start = monthStart(end);
      return { start, end, label: "last month", days: daysBetween(start, end) };
    }
    case "this_month":
    default:
      return { start: currentMonthStart, end: today, label: "this month", days: daysBetween(currentMonthStart, today) };
  }
}

function previousPeriod(
  period: QueryPeriod,
  periodSpec: StatsQuery["period"],
  today: string
): QueryPeriod {
  if (periodSpec === "today" || periodSpec === "yesterday") {
    const end = addDays(period.end, -1);
    return { start: end, end, label: "previous day", days: 1 };
  }
  if (periodSpec === "this_week" || periodSpec === "last_week") {
    const start = addDays(period.start, -7);
    const end = addDays(period.end, -7);
    return { start, end, label: "previous week", days: period.days };
  }
  if (periodSpec === "this_month" || periodSpec === undefined) {
    const currentStart = monthStart(today);
    const previousStart = monthStart(addDays(currentStart, -1));
    const end = addDays(previousStart, Math.min(period.days, daysBetween(previousStart, monthEnd(previousStart))) - 1);
    return { start: previousStart, end, label: "previous month to date", days: daysBetween(previousStart, end) };
  }
  if (periodSpec === "last_month") {
    const end = addDays(period.start, -1);
    const start = monthStart(end);
    return { start, end, label: "previous month", days: daysBetween(start, end) };
  }
  const end = addDays(period.start, -1);
  const start = addDays(end, -period.days + 1);
  return { start, end, label: "previous period", days: period.days };
}

function liveTransactions(snapshot: StatsQuerySnapshot): Transaction[] {
  return snapshot.transactions.filter((transaction) => !transaction.deletedAt && !transaction.cancelledAt);
}

function categoryName(id: string | null | undefined, categories: readonly Category[]): string {
  if (!id) return "Uncategorized";
  return categories.find((category) => category.id === id)?.name ?? "Uncategorized";
}

function accountName(id: string, accounts: readonly Account[]): string {
  return accounts.find((account) => account.id === id)?.name ?? "Unknown account";
}

function amountOf(transaction: Transaction): number {
  return transaction.type === "expense"
    ? transaction.personalShareAmount ?? transaction.amount
    : transaction.amount;
}

function matchesName(filter: string, id: string | null | undefined, name: string): boolean {
  return filter.toLocaleLowerCase() === id?.toLocaleLowerCase()
    || filter.toLocaleLowerCase() === name.toLocaleLowerCase();
}

function filterTransactions(
  transactions: readonly Transaction[],
  query: StatsQuery,
  snapshot: StatsQuerySnapshot,
  period: QueryPeriod,
  defaultType?: "expense" | "income"
): Transaction[] {
  const type = query.filters?.type ?? defaultType;
  return transactions.filter((transaction) => {
    if (transaction.type !== "expense" && transaction.type !== "income") return false;
    if (transaction.date < period.start || transaction.date > period.end) return false;
    if (type && transaction.type !== type) return false;
    if (query.filters?.category && !matchesName(
      query.filters.category,
      transaction.categoryId,
      categoryName(transaction.categoryId, snapshot.categories)
    )) return false;
    if (query.filters?.account && !matchesName(
      query.filters.account,
      transaction.accountId,
      accountName(transaction.accountId, snapshot.accounts)
    )) return false;
    if (query.filters?.text && !transaction.note?.toLocaleLowerCase().includes(query.filters.text.toLocaleLowerCase())) return false;
    return true;
  });
}

function total(transactions: readonly Transaction[]): number {
  return transactions.reduce((sum, transaction) => sum + amountOf(transaction), 0);
}

function grouped(
  transactions: readonly Transaction[],
  groupBy: NonNullable<StatsQuery["groupBy"]>,
  snapshot: StatsQuerySnapshot
): QueryGroup[] {
  const groups = new Map<string, QueryGroup>();
  for (const transaction of transactions) {
    const key = groupBy === "category"
      ? transaction.categoryId ?? "uncategorized"
      : groupBy === "account"
        ? transaction.accountId
        : transaction.date;
    const name = groupBy === "category"
      ? categoryName(transaction.categoryId, snapshot.categories)
      : groupBy === "account"
        ? accountName(transaction.accountId, snapshot.accounts)
        : transaction.date;
    const current = groups.get(key) ?? { key, name, amountCentavos: 0, transactionCount: 0 };
    current.amountCentavos += amountOf(transaction);
    current.transactionCount += 1;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.amountCentavos - a.amountCentavos || a.name.localeCompare(b.name));
}

function budgetCycle(period: Budget["period"], today: string): { start: string; end: string; daysLeft: number } {
  const [year, month, day] = today.split("-").map(Number);
  let start: string;
  let end: string;
  switch (period) {
    case "daily":
      start = end = today;
      break;
    case "weekly": {
      const weekday = (new Date(`${today}T00:00:00.000Z`).getUTCDay() + 6) % 7;
      start = addDays(today, -weekday);
      end = addDays(start, 6);
      break;
    }
    case "biweekly":
      start = `${today.slice(0, 7)}-${day <= 15 ? "01" : "16"}`;
      end = day <= 15 ? `${today.slice(0, 7)}-15` : monthEnd(today);
      break;
    case "annual":
      start = `${year}-01-01`;
      end = `${year}-12-31`;
      break;
    case "monthly":
    default:
      start = monthStart(today);
      end = monthEnd(today);
      break;
  }
  return { start, end, daysLeft: daysBetween(today, end) };
}

function budgetsFor(
  query: StatsQuery,
  snapshot: StatsQuerySnapshot,
  today: string
): Array<{ budget: Budget; start: string; end: string; daysLeft: number }> {
  return snapshot.budgets
    .filter((budget) => !budget.deletedAt)
    .filter((budget) => {
      if (!query.filters?.category) return true;
      const category = snapshot.categories.find(({ id }) => id === budget.categoryId);
      return matchesName(query.filters.category, budget.categoryId, category?.name ?? "Uncategorized");
    })
    .map((budget) => {
      const cycle = budgetCycle(budget.period, today);
      return {
        budget,
        ...cycle,
      };
    });
}

function spentInRange(
  transactions: readonly Transaction[],
  categoryId: string,
  start: string,
  end: string
): number {
  return transactions
    .filter((transaction) =>
      transaction.type === "expense"
      && transaction.categoryId === categoryId
      && transaction.date >= start
      && transaction.date <= end
    )
    .reduce((sum, transaction) => sum + amountOf(transaction), 0);
}

function budgetTotals(
  query: StatsQuery,
  snapshot: StatsQuerySnapshot,
  transactions: readonly Transaction[],
  today: string
): Array<{ remaining: number; daily: number }> {
  return budgetsFor(query, snapshot, today).map(({ budget, start, end, daysLeft }) => {
    const remaining = budget.amount - spentInRange(transactions, budget.categoryId, start, today < end ? today : end);
    return { remaining, daily: Math.floor(Math.max(0, remaining) / Math.max(1, daysLeft)) };
  });
}

function periodTransactions(
  query: StatsQuery,
  snapshot: StatsQuerySnapshot,
  period: QueryPeriod,
  defaultType: "expense" | "income" = "expense"
): Transaction[] {
  return filterTransactions(liveTransactions(snapshot), query, snapshot, period, defaultType);
}

/** Executes a structured Kupi query against an already profile-scoped local snapshot. */
export function executeStatsQuery(query: StatsQuery, snapshot: StatsQuerySnapshot): StatsQueryResult {
  const today = keyFromParts(datePartsInManila(snapshot.now ?? new Date()));
  const period = periodFor(query.period, today);
  const transactions = liveTransactions(snapshot);

  switch (query.metric) {
    case "total": {
      const matching = periodTransactions(query, snapshot, period);
      const groups = query.groupBy ? grouped(matching, query.groupBy, snapshot) : undefined;
      return { metric: "total", period, amountCentavos: total(matching), transactionCount: matching.length, ...(groups ? { groups } : {}) };
    }
    case "by_category": {
      const matching = periodTransactions(query, snapshot, period);
      const groups = grouped(matching, "category", snapshot);
      return { metric: "by_category", period, amountCentavos: total(matching), groups };
    }
    case "top_category": {
      const groups = grouped(periodTransactions(query, snapshot, period), "category", snapshot);
      return { metric: "top_category", period, amountCentavos: groups[0]?.amountCentavos ?? 0, top: groups[0] ?? null };
    }
    case "biggest_expense": {
      const biggest = periodTransactions(query, snapshot, period)
        .sort((a, b) => amountOf(b) - amountOf(a) || a.date.localeCompare(b.date))[0];
      return {
        metric: "biggest_expense",
        period,
        transaction: biggest ? {
          id: biggest.id,
          amountCentavos: amountOf(biggest),
          category: categoryName(biggest.categoryId, snapshot.categories),
          account: accountName(biggest.accountId, snapshot.accounts),
          date: biggest.date,
          note: biggest.note ?? "",
        } : null,
      };
    }
    case "count": {
      const matching = filterTransactions(transactions, query, snapshot, period);
      return { metric: "count", period, transactionCount: matching.length };
    }
    case "daily_average": {
      const matching = periodTransactions(query, snapshot, period);
      return {
        metric: "daily_average",
        period,
        amountCentavos: Math.floor(total(matching) / period.days),
        transactionCount: matching.length,
      };
    }
    case "remaining_budget": {
      const totals = budgetTotals(query, snapshot, transactions, today);
      return {
        metric: "remaining_budget",
        amountCentavos: totals.reduce((sum, item) => sum + item.remaining, 0),
        budgetsFound: totals.length > 0,
        budgetCount: totals.length,
      };
    }
    case "safe_to_spend": {
      const totals = budgetTotals(query, snapshot, transactions, today);
      return {
        metric: "safe_to_spend",
        dailyAmountCentavos: totals.reduce((sum, item) => sum + item.daily, 0),
        budgetsFound: totals.length > 0,
        budgetCount: totals.length,
      };
    }
    case "vs_last_period": {
      const previous = previousPeriod(period, query.period, today);
      const currentAmountCentavos = total(periodTransactions(query, snapshot, period));
      const previousAmountCentavos = total(periodTransactions(query, snapshot, previous));
      const changeCentavos = currentAmountCentavos - previousAmountCentavos;
      return {
        metric: "vs_last_period",
        period,
        previousPeriod: previous,
        currentAmountCentavos,
        previousAmountCentavos,
        changeCentavos,
        changePercent: previousAmountCentavos === 0 ? null : (changeCentavos / previousAmountCentavos) * 100,
      };
    }
    case "net_worth": {
      const accounts = snapshot.accounts.filter((account) => !account.deletedAt && !account.isArchived);
      const balances = new Map(accounts.map((account) => [
        account.id,
        computeAccountBalance(account.id, account.openingBalance, transactions),
      ]));
      const netWorth = computeNetWorth(accounts, balances);
      return {
        metric: "net_worth",
        assetsCentavos: netWorth.assets,
        liabilitiesCentavos: netWorth.liabilities,
        netWorthCentavos: netWorth.netWorth,
      };
    }
  }
}
