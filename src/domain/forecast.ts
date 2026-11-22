import type { Recurring, Transaction } from "./types";
import { getNextOccurrenceDate } from "@/domain/recurrence";
import { dateKeyFromParts } from "@/lib/format";

export interface ForecastDay {
  date: string;
  projectedBalance: number;
}

export function getNextRecurrenceDate(
  recurring: Recurring,
  afterDate: Date = new Date()
): Date {
  const [dueYear, dueMonth, dueDay] = recurring.nextDueDate.split("-").map(Number);
  let nextKey = dateKeyFromParts(dueYear, dueMonth, dueDay);
  const afterKey = dateKeyFromParts(afterDate.getFullYear(), afterDate.getMonth() + 1, afterDate.getDate());
  while (nextKey < afterKey) nextKey = getNextOccurrenceDate(recurring, nextKey);
  return new Date(`${nextKey}T00:00:00`);
}

export function generateForecast(
  startingBalance: number,
  recurringItems: Recurring[],
  days: number,
  today: Date = new Date()
): ForecastDay[] {
  const result: ForecastDay[] = [];
  let balance = startingBalance;

  for (let offset = 0; offset < days; offset++) {
    const date = new Date(today);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + offset);
    const dateKey = dateKeyFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate());

    for (const recurring of recurringItems) {
      if (recurring.deletedAt || recurring.isPaused || (recurring.endsAfter && (recurring.occurrencesCreated || 0) >= recurring.endsAfter)) continue;
      if (recurring.endDate && dateKey > recurring.endDate) continue;
      const next = getNextRecurrenceDate(recurring, date);
      const nextKey = dateKeyFromParts(next.getFullYear(), next.getMonth() + 1, next.getDate());
      if (nextKey !== dateKey) continue;
      if (recurring.transactionType === "income") balance += recurring.amount;
      else if (recurring.transactionType === "expense") balance -= recurring.amount;
    }

    result.push({ date: dateKey, projectedBalance: balance });
  }
  return result;
}

export function getLowestProjectedBalance(forecast: ForecastDay[]): number {
  return forecast.length ? Math.min(...forecast.map((day) => day.projectedBalance)) : 0;
}

export function canAffordAmount(
  forecast: ForecastDay[],
  amount: number
): { affordable: boolean; lowestBalanceAfterPurchase: number } {
  const lowestAfterPurchase = getLowestProjectedBalance(forecast) - amount;
  return {
    affordable: lowestAfterPurchase >= 0,
    lowestBalanceAfterPurchase: lowestAfterPurchase,
  };
}

export function sumLiquidAccountBalance(
  accounts: { id: string; type: string; openingBalance: number }[],
  transactions: Transaction[]
): number {
  const liquidIds = new Set(
    accounts
      .filter((account) => ["cash", "bank", "ewallet"].includes(account.type))
      .map((account) => account.id)
  );
  let total = accounts
    .filter((account) => ["cash", "bank", "ewallet"].includes(account.type))
    .reduce((sum, account) => sum + account.openingBalance, 0);

  for (const tx of transactions) {
    if (tx.deletedAt) continue;
    if (tx.type === "income" && liquidIds.has(tx.accountId)) total += tx.amount;
    if (tx.type === "expense" && liquidIds.has(tx.accountId)) total -= tx.amount;
    if (tx.type === "transfer") {
      if (tx.externalFromName) {
        if (liquidIds.has(tx.accountId)) total += tx.amount;
        continue;
      }
      if (liquidIds.has(tx.accountId)) total -= tx.amount;
      if (tx.toAccountId && liquidIds.has(tx.toAccountId)) total += tx.amount;
    }
  }
  return total;
}
