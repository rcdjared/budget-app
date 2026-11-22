import type { Transaction } from "./types";

export function sortTransactionsNewestFirst<T extends Pick<Transaction, "date" | "createdAt">>(
  transactions: readonly T[]
): T[] {
  return [...transactions].sort(
    (a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
  );
}
