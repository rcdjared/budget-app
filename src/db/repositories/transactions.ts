// Transaction repository — the core ledger of all money movements.

import { db } from "../schema";
import type { Transaction } from "@/domain/types";

function now(): string {
  return new Date().toISOString();
}

export async function getTransactionsByProfile(
  profileId: string
): Promise<Transaction[]> {
  return db.transactions
    .where({ profileId })
    .filter((t) => !t.deletedAt)
    .reverse()
    .sortBy("date");
}

export async function getTransactionsByAccount(
  accountId: string
): Promise<Transaction[]> {
  // Get all transactions where this account is involved (source or destination)
  const asSource = await db.transactions
    .where({ accountId })
    .filter((t) => !t.deletedAt)
    .toArray();

  const asDestination = await db.transactions
    .where({ toAccountId: accountId })
    .filter((t) => !t.deletedAt)
    .toArray();

  // Merge, deduplicate, and sort by date descending
  const map = new Map<string, Transaction>();
  for (const tx of [...asSource, ...asDestination]) {
    map.set(tx.id, tx);
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export async function getTransactionsByDateRange(
  profileId: string,
  startDate: string,
  endDate: string
): Promise<Transaction[]> {
  return db.transactions
    .where("[profileId+date]")
    .between([profileId, startDate], [profileId, endDate], true, true)
    .filter((t) => !t.deletedAt)
    .toArray();
}

export async function getTransactionsByCategory(
  categoryId: string,
  startDate?: string,
  endDate?: string
): Promise<Transaction[]> {
  let query = db.transactions.where({ categoryId });

  return query
    .filter((t) => {
      if (t.deletedAt) return false;
      if (startDate && t.date < startDate) return false;
      if (endDate && t.date > endDate) return false;
      return true;
    })
    .toArray();
}

export async function getTransactionById(
  id: string
): Promise<Transaction | undefined> {
  return db.transactions.get(id);
}

export async function createTransaction(
  data: Omit<Transaction, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  const id = crypto.randomUUID();
  const timestamp = now();
  await db.transactions.add({
    ...data,
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return id;
}

export async function updateTransaction(
  id: string,
  data: Partial<Transaction>
): Promise<void> {
  await db.transactions.update(id, { ...data, updatedAt: now() });
}

export async function softDeleteTransaction(id: string): Promise<void> {
  await db.transactions.update(id, { deletedAt: now(), updatedAt: now() });
}

/** Get the most recent transaction to remember last-used account/category */
export async function getLastTransaction(
  profileId: string
): Promise<Transaction | undefined> {
  const results = await db.transactions
    .where({ profileId })
    .filter((t) => !t.deletedAt && t.type !== "transfer")
    .reverse()
    .sortBy("date");
  return results[0];
}

