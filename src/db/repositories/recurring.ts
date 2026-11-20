import { db } from "@/db/schema";
import { getNextOccurrenceDate } from "@/domain/recurrence";
import type { Recurring, Transaction } from "@/domain/types";

export async function processDueRecurringTransactions(profileId: string, today: string): Promise<string[]> {
  const rules = await db.recurring
    .where({ profileId })
    .filter((rule) => !rule.deletedAt && !rule.isPaused && rule.transactionType === "expense")
    .toArray();
  const createdIds: string[] = [];

  for (const candidate of rules) {
    await db.transaction("rw", db.tables, async () => {
      const rule = await db.recurring.get(candidate.id);
      if (!rule || rule.deletedAt || rule.isPaused || rule.transactionType !== "expense") return;

      let nextDueDate = rule.nextDueDate;
      let occurrencesCreated = rule.occurrencesCreated || 0;
      let paused = false;

      while (nextDueDate <= today) {
        if (rule.endDate && nextDueDate > rule.endDate) {
          paused = true;
          break;
        }
        if (rule.endsAfter && occurrencesCreated >= rule.endsAfter) {
          paused = true;
          break;
        }

        const occurrenceKey = `${rule.id}:${nextDueDate}`;
        const existing = await db.transactions.where("occurrenceKey").equals(occurrenceKey).first();
        if (!existing) {
          const timestamp = new Date().toISOString();
          const transaction: Transaction = {
            id: crypto.randomUUID(),
            profileId: rule.profileId,
            type: "expense",
            amount: Math.abs(Math.round(rule.amount)),
            accountId: rule.accountId,
            categoryId: rule.categoryId || null,
            date: nextDueDate,
            note: rule.note || null,
            recurringId: rule.id,
            occurrenceKey,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          await db.transactions.add(transaction);
          createdIds.push(transaction.id);
        }
        occurrencesCreated++;

        const followingDate = getNextOccurrenceDate(rule, nextDueDate);
        if (rule.endsAfter && occurrencesCreated >= rule.endsAfter) {
          nextDueDate = followingDate;
          paused = true;
          break;
        }
        if (rule.endDate && followingDate > rule.endDate) {
          nextDueDate = followingDate;
          paused = true;
          break;
        }
        nextDueDate = followingDate;
      }

      await db.recurring.update(rule.id, {
        nextDueDate,
        occurrencesCreated,
        isPaused: paused,
        updatedAt: new Date().toISOString(),
      });
    });
  }

  return createdIds;
}

export async function createRecurringRule(data: Omit<Recurring, "id" | "createdAt" | "updatedAt">): Promise<string> {
  const timestamp = new Date().toISOString();
  const id = crypto.randomUUID();
  await db.recurring.add({ ...data, id, createdAt: timestamp, updatedAt: timestamp });
  return id;
}
