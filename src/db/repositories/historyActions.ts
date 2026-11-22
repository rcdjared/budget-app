import { db } from "@/db/schema";
import { softDeleteTransaction, cancelTransaction } from "@/db/repositories/transactions";

export async function cancelRecurringOccurrence(
  transactionId: string,
  reason?: string
): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const transaction = await db.transactions.get(transactionId);
    if (!transaction) throw new Error("Transaction not found.");
    if (transaction.recurringId && transaction.occurrenceKey) {
      const [, occurrenceDate] = transaction.occurrenceKey.split(/:(.+)/);
      await db.recurringSkips.add({
        id: crypto.randomUUID(),
        profileId: transaction.profileId,
        recurringId: transaction.recurringId,
        occurrenceDate: occurrenceDate || transaction.date,
        occurrenceKey: transaction.occurrenceKey,
        reason: reason?.trim() || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  });
  await cancelTransaction(transactionId, reason);
}

export async function deleteRecurringOccurrence(transactionId: string): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const transaction = await db.transactions.get(transactionId);
    if (!transaction) throw new Error("Transaction not found.");
    if (transaction.recurringId && transaction.occurrenceKey) {
      const [, occurrenceDate] = transaction.occurrenceKey.split(/:(.+)/);
      await db.recurringSkips.add({
        id: crypto.randomUUID(),
        profileId: transaction.profileId,
        recurringId: transaction.recurringId,
        occurrenceDate: occurrenceDate || transaction.date,
        occurrenceKey: transaction.occurrenceKey,
        reason: "Occurrence deleted",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
  });
  await softDeleteTransaction(transactionId);
}
