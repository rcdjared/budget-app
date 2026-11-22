// Dexie database schema — the local source of truth.
//
// Dexie wraps IndexedDB with a cleaner API. Each table gets an index list:
// the first item is the primary key, the rest are indexed columns for queries.
// "++" means auto-increment, "&" means unique. We use client-generated UUIDs.

import Dexie, { type EntityTable, type Transaction as DexieTransaction } from "dexie";
import type {
  Profile,
  Account,
  Category,
  Transaction,
  Budget,
  Goal,
  Debt,
  Recurring,
  Holding,
  PriceCache,
  QuickNote,
  SplitGroup,
  SplitMember,
  Streak,
  Attachment,
  OutboxEntry,
  Settings,
  Friend,
  FriendLedgerEntry,
  LocalSplit,
  RecurringSkip,
  SharedBill,
  SharedBillMember,
} from "@/domain/types";

export class PesoPulseDB extends Dexie {
  profiles!: EntityTable<Profile, "id">;
  accounts!: EntityTable<Account, "id">;
  categories!: EntityTable<Category, "id">;
  transactions!: EntityTable<Transaction, "id">;
  budgets!: EntityTable<Budget, "id">;
  goals!: EntityTable<Goal, "id">;
  debts!: EntityTable<Debt, "id">;
  recurring!: EntityTable<Recurring, "id">;
  holdings!: EntityTable<Holding, "id">;
  priceCache!: EntityTable<PriceCache, "symbol">;
  quickNotes!: EntityTable<QuickNote, "id">;
  splitGroups!: EntityTable<SplitGroup, "id">;
  splitMembers!: EntityTable<SplitMember, "id">;
  streaks!: EntityTable<Streak, "id">;
  attachments!: EntityTable<Attachment, "id">;
  outbox!: EntityTable<OutboxEntry, "id">;
  settings!: EntityTable<Settings, "id">;
  friends!: EntityTable<Friend, "id">;
  friendLedger!: EntityTable<FriendLedgerEntry, "id">;
  localSplits!: EntityTable<LocalSplit, "id">;
  recurringSkips!: EntityTable<RecurringSkip, "id">;
  sharedBills!: EntityTable<SharedBill, "id">;
  sharedBillMembers!: EntityTable<SharedBillMember, "id">;

  constructor() {
    super("PesoPulseDB");

    // Schema version 1: all tables for the full app.
    // We define everything upfront so we don't need a migration later.
    // Tables not in use yet just stay empty.
    this.version(1).stores({
      // Primary key, then indexed fields for queries
      profiles: "id, isDefault",
      accounts: "id, profileId, type, isArchived",
      categories: "id, profileId, type, parentId, sortOrder",
      transactions:
        "id, profileId, accountId, toAccountId, categoryId, date, type, [profileId+date], [accountId+date], [categoryId+date]",
      budgets: "id, profileId, categoryId",
      goals: "id, profileId",
      debts: "id, profileId, direction",
      recurring: "id, profileId, nextDueDate, kind",
      holdings: "id, accountId, symbol",
      priceCache: "symbol",
      quickNotes: "id, profileId",
      splitGroups: "id, profileId",
      splitMembers: "id, splitGroupId",
      streaks: "id, profileId",
      attachments: "id, transactionId",
      outbox: "id, table, recordId, status",
      settings: "id, profileId, key",
    });

    this.version(2).stores({
      profiles: "id, isDefault",
      accounts: "id, profileId, type, isArchived",
      categories: "id, profileId, type, parentId, sortOrder",
      transactions: "id, profileId, accountId, toAccountId, categoryId, recurringId, transferId, date, type, &occurrenceKey, [profileId+date], [accountId+date], [categoryId+date]",
      budgets: "id, profileId, categoryId",
      goals: "id, profileId",
      debts: "id, profileId, direction",
      recurring: "id, profileId, nextDueDate, kind",
      holdings: "id, accountId, symbol",
      priceCache: "symbol",
      quickNotes: "id, profileId",
      splitGroups: "id, profileId",
      splitMembers: "id, splitGroupId",
      streaks: "id, profileId",
      attachments: "id, transactionId",
      outbox: "id, table, recordId, status",
      settings: "id, profileId, key",
    }).upgrade(async (transaction) => {
      await transaction.table("transactions").toCollection().modify((record) => {
        if (!record.occurrenceKey) delete record.occurrenceKey;
      });
    });

    this.version(3).stores({
      profiles: "id, isDefault",
      accounts: "id, profileId, type, isArchived",
      categories: "id, profileId, type, parentId, sortOrder",
      transactions: "id, profileId, accountId, toAccountId, categoryId, recurringId, transferId, splitId, sharedBillId, date, type, &occurrenceKey, [profileId+date], [accountId+date], [categoryId+date]",
      budgets: "id, profileId, categoryId",
      goals: "id, profileId",
      debts: "id, profileId, direction",
      recurring: "id, profileId, nextDueDate, kind",
      holdings: "id, accountId, symbol",
      priceCache: "symbol",
      quickNotes: "id, profileId",
      splitGroups: "id, profileId",
      splitMembers: "id, splitGroupId",
      streaks: "id, profileId",
      attachments: "id, transactionId",
      outbox: "id, table, recordId, status",
      settings: "id, profileId, key",
      friends: "id, profileId, linkedUserId, archivedAt",
      friendLedger: "id, profileId, friendId, transactionId, sharedBillId, date, type",
      localSplits: "id, profileId, transactionId, status",
      recurringSkips: "id, profileId, recurringId, occurrenceDate, &occurrenceKey",
      sharedBills: "id, profileId, transactionId, status",
      sharedBillMembers: "id, sharedBillId, friendId, status",
    }).upgrade(async (transaction) => {
      await transaction.table("transactions").toCollection().modify((record) => {
        if (record.cancelledAt === undefined) record.cancelledAt = null;
        if (record.editedAt === undefined) record.editedAt = null;
      });
    });
  }
}

/** Singleton database instance */
export const db = new PesoPulseDB();

const SYNCABLE_TABLES = new Set([
  "profiles",
  "accounts",
  "categories",
  "transactions",
  "budgets",
  "goals",
  "debts",
  "recurring",
  "holdings",
  "quickNotes",
  "splitGroups",
  "splitMembers",
  "friends",
  "friendLedger",
  "localSplits",
  "recurringSkips",
  "sharedBills",
  "sharedBillMembers",
  "streaks",
  "attachments",
  "settings",
]);

let remoteWriteDepth = 0;

function outboxPayload(record: Record<string, unknown>): string {
  const { blob: _localBlob, ...payload } = record;
  return JSON.stringify(payload);
}

function reportOutboxError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error("Could not queue local change for cloud sync:", error);
  window.dispatchEvent(new CustomEvent("pesopulse:sync-queue-error", { detail: message }));
}

function queueOutbox(
  tableName: string,
  recordId: string,
  op: "create" | "update" | "delete",
  record: Record<string, unknown>,
  transaction: DexieTransaction
): void {
  const timestamp = new Date().toISOString();
  void transaction.table("outbox").add({
    id: crypto.randomUUID(),
    table: tableName,
    recordId,
    op,
    payload: outboxPayload(record),
    status: "pending",
    createdAt: timestamp,
    updatedAt: timestamp,
  }).catch(reportOutboxError);
}

for (const table of db.tables) {
  if (!SYNCABLE_TABLES.has(table.name)) continue;

  table.hook("creating", function (primaryKey, record, transaction) {
    if (remoteWriteDepth) return;
    if (table.name === "settings" && /^(cloud-|dailyBackup)/.test(String(record.key || ""))) return;
    const id = String(record.id ?? primaryKey);
    this.onsuccess = () => {
      queueOutbox(
        table.name,
        id,
        "create",
        record as Record<string, unknown>,
        transaction
      );
    };
  });

  table.hook("updating", function (changes, primaryKey, record, transaction) {
    if (remoteWriteDepth) return;
    if (table.name === "settings" && /^(cloud-|dailyBackup)/.test(String(record.key || ""))) return;
    const timestamp = new Date().toISOString();
    const modifications = changes as Record<string, unknown>;
    modifications.updatedAt = timestamp;
    const updated = { ...record, ...modifications } as Record<string, unknown>;
    this.onsuccess = () => {
      queueOutbox(
        table.name,
        String(updated.id ?? primaryKey),
        updated.deletedAt ? "delete" : "update",
        updated,
        transaction
      );
    };
  });
}

export async function withoutOutbox<T>(work: () => Promise<T>): Promise<T> {
  remoteWriteDepth++;
  try {
    return await work();
  } finally {
    remoteWriteDepth--;
  }
}

export async function applyRemoteChanges(
  changes: { table: string; record: Record<string, unknown> }[]
): Promise<void> {
  await withoutOutbox(async () => {
    await db.transaction("rw", db.tables, async () => {
      for (const change of changes) {
        if (!SYNCABLE_TABLES.has(change.table)) continue;
        const table = db.table(change.table);
        const current = await table.get(change.record.id as string) as Record<string, unknown> | undefined;
        const incomingTime = String(change.record.updatedAt || "");
        const currentTime = String(current?.updatedAt || "");
        if (current && currentTime > incomingTime) continue;
        await table.put(change.record);
      }
    });
  });
}
