import { db } from "@/db/schema";
import { getProfileRecord } from "@/db/profileScope";
import { softDeleteTransaction, cancelTransaction } from "@/db/repositories/transactions";

export async function cancelRecurringOccurrence(
  transactionId: string,
  profileId: string,
  reason?: string
): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const transaction = await getProfileRecord(db.transactions, transactionId, profileId);
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
  await cancelTransaction(transactionId, profileId, reason);
}

export async function deleteRecurringOccurrence(transactionId: string, profileId: string): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const transaction = await getProfileRecord(db.transactions, transactionId, profileId);
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
  await softDeleteTransaction(transactionId, profileId);
}
