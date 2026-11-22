// Transaction repository — the core ledger of all money movements.

import { db } from "../schema";
import { getProfileRecord, profileRecords } from "../profileScope";
import type { Transaction } from "@/domain/types";

function now(): string {
  return new Date().toISOString();
}

export async function getTransactionsByProfile(
  profileId: string
): Promise<Transaction[]> {
  return profileRecords(db.transactions, profileId)
    .filter((t) => !t.deletedAt)
    .reverse()
    .sortBy("date");
}

export async function getTransactionsByAccount(
  accountId: string,
  profileId: string
): Promise<Transaction[]> {
  // Get all transactions where this account is involved (source or destination)
  const asSource = await profileRecords(db.transactions, profileId)
    .filter((t) => t.accountId === accountId && !t.deletedAt)
    .toArray();

  const asDestination = await profileRecords(db.transactions, profileId)
    .filter((t) => t.toAccountId === accountId && !t.deletedAt)
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
  profileId: string,
  startDate?: string,
  endDate?: string
): Promise<Transaction[]> {
  return profileRecords(db.transactions, profileId)
    .filter((t) => t.categoryId === categoryId && !t.deletedAt
      && (!startDate || t.date >= startDate) && (!endDate || t.date <= endDate))
    .toArray();
}

export async function getTransactionById(
  id: string,
  profileId: string
): Promise<Transaction | undefined> {
  return getProfileRecord(db.transactions, id, profileId);
}

export async function createTransaction(
  data: Omit<Transaction, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  if (!Number.isFinite(data.amount) || data.amount === 0) {
    throw new Error("Transaction amount must be a positive value in centavos.");
  }
  const id = crypto.randomUUID();
  const timestamp = now();
  await db.transactions.add({
    ...data,
    // Income and expense direction comes from `type`; ledger amounts stay positive.
    amount: Math.abs(Math.round(data.amount)),
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return id;
}

export interface TransferData {
  profileId: string;
  amount: number;
  accountId: string;
  toAccountId?: string | null;
  sourceType: "my" | "external";
  destinationType: "my" | "external";
  externalFromName?: string | null;
  externalToName?: string | null;
  transferFee: number;
  feeCategoryId?: string | null;
  date: string;
  time: string;
  note?: string | null;
}

export async function createTransfer(data: TransferData): Promise<string> {
  const amount = Math.abs(Math.round(data.amount));
  const transferFee = Math.max(0, Math.round(data.transferFee));
  if (!amount) throw new Error("Transfer amount must be greater than zero.");
  if (data.sourceType === "external" && data.destinationType === "external") throw new Error("At least one side must be one of your accounts.");
  if (data.sourceType === "my" && data.destinationType === "my" && (!data.toAccountId || data.accountId === data.toAccountId)) throw new Error("Choose two different accounts.");
  if (data.sourceType === "external" && transferFee) throw new Error("External transfers cannot include a transfer fee.");
  if (transferFee && !data.feeCategoryId) throw new Error("A fee category is required for this transfer.");

  const id = crypto.randomUUID();
  const feeTransactionId = data.sourceType === "my" && transferFee ? crypto.randomUUID() : null;
  const timestamp = now();
  await db.transaction("rw", db.tables, async () => {
    await db.transactions.add({
      id,
      profileId: data.profileId,
      type: "transfer",
      amount,
      accountId: data.accountId,
      toAccountId: data.toAccountId || null,
      categoryId: null,
      date: data.date,
      transferTime: data.time,
      note: data.note?.trim() || null,
      sourceType: data.sourceType,
      destinationType: data.destinationType,
      externalFromName: data.sourceType === "external" ? data.externalFromName?.trim() || "External" : null,
      externalToName: data.destinationType === "external" ? data.externalToName?.trim() || "External" : null,
      transferFee,
      feeTransactionId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    if (feeTransactionId && data.feeCategoryId) {
      await db.transactions.add({
        id: feeTransactionId,
        profileId: data.profileId,
        type: "expense",
        amount: transferFee,
        accountId: data.accountId,
        toAccountId: null,
        categoryId: data.feeCategoryId,
        date: data.date,
        note: data.note?.trim() ? `Transfer fee · ${data.note.trim()}` : "Transfer fee",
        transferId: id,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    }
  });
  return id;
}

export async function updateTransfer(id: string, data: TransferData): Promise<void> {
  const amount = Math.abs(Math.round(data.amount));
  const transferFee = Math.max(0, Math.round(data.transferFee));
  if (!amount) throw new Error("Transfer amount must be greater than zero.");
  if (data.sourceType === "external" && data.destinationType === "external") throw new Error("At least one side must be one of your accounts.");
  if (data.sourceType === "my" && data.destinationType === "my" && (!data.toAccountId || data.accountId === data.toAccountId)) throw new Error("Choose two different accounts.");
  if (data.sourceType === "external" && transferFee) throw new Error("External transfers cannot include a transfer fee.");
  if (transferFee && !data.feeCategoryId) throw new Error("A fee category is required for this transfer.");

  await db.transaction("rw", db.tables, async () => {
    const existing = await getProfileRecord(db.transactions, id, data.profileId);
    if (!existing || existing.type !== "transfer") throw new Error("Transfer not found.");
    const timestamp = now();
    const existingFee = existing.feeTransactionId
      ? await getProfileRecord(db.transactions, existing.feeTransactionId, data.profileId)
      : undefined;
    await db.transactions.update(id, {
      amount,
      accountId: data.accountId,
      toAccountId: data.toAccountId || null,
      date: data.date,
      transferTime: data.time,
      note: data.note?.trim() || null,
      sourceType: data.sourceType,
      destinationType: data.destinationType,
      externalFromName: data.sourceType === "external" ? data.externalFromName?.trim() || "External" : null,
      externalToName: data.destinationType === "external" ? data.externalToName?.trim() || "External" : null,
      transferFee,
      updatedAt: timestamp,
    });
    if (data.sourceType === "my" && transferFee && data.feeCategoryId) {
      if (existingFee) {
        await db.transactions.update(existingFee.id, {
          amount: transferFee,
          accountId: data.accountId,
          categoryId: data.feeCategoryId,
          date: data.date,
          note: data.note?.trim() ? `Transfer fee · ${data.note.trim()}` : "Transfer fee",
          deletedAt: null,
          updatedAt: timestamp,
        });
      } else {
        const feeId = crypto.randomUUID();
        await db.transactions.add({
          id: feeId,
          profileId: data.profileId,
          type: "expense",
          amount: transferFee,
          accountId: data.accountId,
          categoryId: data.feeCategoryId,
          date: data.date,
          note: "Transfer fee",
          transferId: id,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
        await db.transactions.update(id, { feeTransactionId: feeId });
      }
    } else if (existingFee) {
      await db.transactions.update(existingFee.id, { deletedAt: timestamp, updatedAt: timestamp });
    }
  });
}

export async function updateTransaction(
  id: string,
  profileId: string,
  data: Partial<Transaction>
): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const existing = await getProfileRecord(db.transactions, id, profileId);
    if (!existing) throw new Error("Transaction not found.");
    if (data.profileId && data.profileId !== profileId) throw new Error("Transaction profile cannot be changed.");
    if (existing.cancelledAt) throw new Error("Restore this transaction before editing it.");
    await db.transactions.update(id, { ...data, profileId, editedAt: now(), updatedAt: now() });
  });
}

export async function cancelTransaction(
  id: string,
  profileId: string,
  reason?: string
): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const transaction = await getProfileRecord(db.transactions, id, profileId);
    if (!transaction) throw new Error("Transaction not found.");
    if (transaction.cancelledAt) return;
    const timestamp = now();
    await db.transactions.update(id, {
      cancelledAt: timestamp,
      cancellationReason: reason?.trim() || null,
      updatedAt: timestamp,
    });

    if (transaction.type === "transfer") {
      const linkedFees = await profileRecords(db.transactions, profileId)
        .filter((item) => item.transferId === id && !item.deletedAt).toArray();
      for (const fee of linkedFees) {
        await db.transactions.update(fee.id, { cancelledAt: timestamp, updatedAt: timestamp });
      }
    }

    if (transaction.splitId) {
      const entries = await db.friendLedger.where("transactionId").equals(id).toArray();
      for (const entry of entries) {
        if (entry.type === "expense_share" && !entry.deletedAt) {
          await db.friendLedger.add({
            id: crypto.randomUUID(),
            profileId: entry.profileId,
            friendId: entry.friendId,
            transactionId: id,
            type: "adjustment",
            direction: "you_owe",
            amount: entry.amount,
            note: "Split cancelled",
            date: timestamp.slice(0, 10),
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      }
    }
    if (transaction.sharedBillId) {
      await db.sharedBills.update(transaction.sharedBillId, { status: "cancelled", updatedAt: timestamp });
    }
  });
}

export async function restoreTransaction(id: string, profileId: string): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const transaction = await getProfileRecord(db.transactions, id, profileId);
    if (!transaction) throw new Error("Transaction not found.");
    const account = await getProfileRecord(db.accounts, transaction.accountId, transaction.profileId);
    if (!account || account.deletedAt) throw new Error("The source account no longer exists.");
    if (transaction.toAccountId) {
      const destination = await getProfileRecord(db.accounts, transaction.toAccountId, transaction.profileId);
      if (!destination || destination.deletedAt) throw new Error("The destination account no longer exists.");
    }
    const timestamp = now();
    await db.transactions.update(id, {
      cancelledAt: null,
      cancellationReason: null,
      deletedAt: null,
      updatedAt: timestamp,
    });
    if (transaction.type === "transfer") {
      const linkedFees = await profileRecords(db.transactions, transaction.profileId)
        .filter((item) => item.transferId === id).toArray();
      for (const fee of linkedFees) {
        await db.transactions.update(fee.id, { cancelledAt: null, deletedAt: null, updatedAt: timestamp });
      }
    }
    if (transaction.splitId) {
      const entries = await db.friendLedger.where("transactionId").equals(id).toArray();
      for (const entry of entries) {
        if (entry.type === "expense_share" && !entry.deletedAt) {
          await db.friendLedger.add({
            id: crypto.randomUUID(),
            profileId: entry.profileId,
            friendId: entry.friendId,
            transactionId: id,
            type: "adjustment",
            direction: "owed_to_me",
            amount: entry.amount,
            note: "Split restored",
            date: timestamp.slice(0, 10),
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      }
    }
    if (transaction.sharedBillId) {
      await db.sharedBills.update(transaction.sharedBillId, { status: "active", updatedAt: timestamp });
    }
  });
}

export async function softDeleteTransaction(id: string, profileId: string): Promise<void> {
  const transaction = await getProfileRecord(db.transactions, id, profileId);
  const timestamp = now();
  await db.transaction("rw", db.tables, async () => {
    const current = await getProfileRecord(db.transactions, id, profileId);
    if (!current) return;
    if (current.splitId) {
      const entries = await db.friendLedger.where("transactionId").equals(id).toArray();
      for (const entry of entries) {
        if (entry.type === "expense_share" && !entry.deletedAt) {
          await db.friendLedger.add({
            id: crypto.randomUUID(),
            profileId: entry.profileId,
            friendId: entry.friendId,
            transactionId: id,
            type: "adjustment",
            direction: "you_owe",
            amount: entry.amount,
            note: "Split expense deleted",
            date: timestamp.slice(0, 10),
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      }
      if (current.splitId) await db.localSplits.update(current.splitId, { status: "cancelled", updatedAt: timestamp });
    }
    if (current.sharedBillId) {
      await db.sharedBills.update(current.sharedBillId, { status: "cancelled", updatedAt: timestamp });
    }
  });
  if (transaction?.type !== "transfer") {
    await db.transactions.update(id, { deletedAt: timestamp, updatedAt: timestamp });
    return;
  }
  await db.transaction("rw", db.tables, async () => {
    await db.transactions.update(id, { deletedAt: timestamp, updatedAt: timestamp });
    const linkedFees = await profileRecords(db.transactions, profileId)
      .filter((item) => item.transferId === id && !item.deletedAt).toArray();
    for (const fee of linkedFees) await db.transactions.update(fee.id, { deletedAt: timestamp, updatedAt: timestamp });
  });
}

/** Get the most recent transaction to remember last-used account/category */
export async function getLastTransaction(
  profileId: string
): Promise<Transaction | undefined> {
  const results = await profileRecords(db.transactions, profileId)
    .filter((t) => !t.deletedAt && t.type !== "transfer")
    .reverse()
    .sortBy("date");
  return results[0];
}

