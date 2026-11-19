import type { Transaction } from "./types";

export interface BudgetProgress {
  spent: number;
  budgeted: number;
  remaining: number;
  percent: number;
  state: "under" | "warning" | "over";
}

export function getBudgetProgress(
  spent: number,
  budgeted: number
): BudgetProgress {
  const percent = budgeted > 0 ? (spent / budgeted) * 100 : 0;
  return {
    spent,
    budgeted,
    remaining: budgeted - spent,
    percent,
    state: percent > 100 ? "over" : percent >= 80 ? "warning" : "under",
  };
}

export function getRequiredMonthlyContribution(
  targetAmount: number,
  savedAmount: number,
  targetDate: string,
  today: Date = new Date()
): number {
  const target = new Date(`${targetDate}T00:00:00`);
  const remainingMonths =
    (target.getFullYear() - today.getFullYear()) * 12 +
    target.getMonth() -
    today.getMonth();
  if (remainingMonths <= 0) return Math.max(0, targetAmount - savedAmount);
  return Math.max(0, Math.ceil((targetAmount - savedAmount) / remainingMonths));
}

export function sumCategoryExpenses(
  transactions: Transaction[],
  categoryId: string,
  startDate: string,
  endDate: string
): number {
  return transactions
    .filter((tx) =>
      !tx.deletedAt &&
      tx.type === "expense" &&
      tx.categoryId === categoryId &&
      tx.date >= startDate &&
      tx.date <= endDate
    )
    .reduce((sum, tx) => sum + tx.amount, 0);
}
