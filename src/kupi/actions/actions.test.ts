import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { applyRemoteChanges, db, withoutOutbox } from "@/db/schema";
import type { Account, Category, Transaction } from "@/domain/types";
import { createTransaction } from "@/db/repositories/transactions";
import { commitAction, undoAction } from "./commit";
import { proposeAction } from "./propose";
import { validateAction } from "./validate";

const now = "2026-11-24T04:00:00.000Z";
const account: Account = {
  id: "account-1",
  profileId: "profile-1",
  name: "Cash",
  type: "cash",
  openingBalance: 0,
  currency: "PHP",
  color: "#000000",
  icon: "wallet",
  isArchived: false,
  createdAt: now,
  updatedAt: now,
};
const secondAccount: Account = { ...account, id: "account-2", name: "GCash" };
const otherProfileAccount: Account = { ...account, id: "account-other", profileId: "profile-2" };
const expenseCategory: Category = {
  id: "category-1",
  profileId: "profile-1",
  name: "Food",
  type: "expense",
  icon: "utensils",
  color: "#000000",
  sortOrder: 0,
  createdAt: now,
  updatedAt: now,
};

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "txn-1",
    profileId: "profile-1",
    type: "expense",
    amount: 1000,
    accountId: account.id,
    categoryId: expenseCategory.id,
    date: "2026-11-24",
    note: "Lunch",
    createdAt: now,
    updatedAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

async function resetDatabase() {
  await db.delete();
  await db.open();
  await withoutOutbox(async () => {
    await db.accounts.bulkAdd([account, secondAccount, otherProfileAccount]);
    await db.categories.add(expenseCategory);
  });
  await db.outbox.clear();
}

describe("Kupi action layer", () => {
  beforeEach(resetDatabase);

  it("requires confirmation and validates profile-scoped accounts before writing", async () => {
    const action = proposeAction([{
      kind: "create",
      profileId: "profile-1",
      after: {
        profileId: "profile-1",
        type: "expense",
        amount: 500,
        accountId: otherProfileAccount.id,
        categoryId: expenseCategory.id,
        date: "2026-11-24",
      },
    }], () => "action-invalid")[0];

    await expect(commitAction([action], false)).rejects.toThrow("explicitly confirmed");
    const validation = validateAction(action, {
      accounts: [account, otherProfileAccount],
      categories: [expenseCategory],
      txns: [],
      now: new Date(now),
    });
    expect(validation.errors).toContain("Account is not available in this profile.");
    await expect(commitAction([action], true)).rejects.toThrow("Account is not available");
    expect(await db.transactions.count()).toBe(0);
    expect(await db.kupiActions.count()).toBe(0);
  });

  it("rejects invalid amounts and future dates while warning on unusual category amounts", () => {
    const history = [1000, 1200, 1400].map((amount, index) =>
      transaction({ id: `history-${index}`, amount })
    );
    const snapshot = {
      accounts: [account, secondAccount],
      categories: [expenseCategory],
      txns: history,
      now: new Date(now),
    };
    const proposal = (amount: number, date: string) => proposeAction([{
      kind: "create" as const,
      profileId: "profile-1",
      after: {
        profileId: "profile-1",
        type: "expense" as const,
        amount,
        accountId: account.id,
        categoryId: expenseCategory.id,
        date,
      },
    }], () => `action-${amount}-${date}`)[0];

    const invalid = validateAction(proposal(0, "2026-11-25"), snapshot);
    expect(invalid.errors).toContain("Amount must be a positive whole number of centavos.");
    expect(invalid.errors).toContain("Transaction date cannot be in the future.");
    const unusual = validateAction(proposal(10000, "2026-11-24"), snapshot);
    expect(unusual.warnings).toContain("Amount is much higher than this category's recent transactions.");
    const sameAccountTransfer = proposeAction([{
      kind: "transfer" as const,
      profileId: "profile-1",
      after: {
        profileId: "profile-1",
        amount: 1000,
        accountId: account.id,
        toAccountId: account.id,
        sourceType: "my" as const,
        destinationType: "my" as const,
        transferFee: 0,
        date: "2026-11-24",
        time: "12:00",
      },
    }], () => "same-account-transfer")[0];
    expect(validateAction(sameAccountTransfer, snapshot).errors).toContain(
      "Choose two different accounts for an internal transfer."
    );
  });

  it("creates an expense once and keeps its receipt idempotent after undo", async () => {
    const action = proposeAction([{
      kind: "create",
      profileId: "profile-1",
      after: {
        profileId: "profile-1",
        type: "expense",
        amount: 18000,
        accountId: account.id,
        categoryId: expenseCategory.id,
        date: "2026-11-24",
        note: "Coffee",
      },
    }], () => "action-create")[0];

    const [committed] = await commitAction([action], true);
    const replay = await commitAction([action], true);
    expect(replay[0]).toMatchObject({ transactionId: committed.transactionId, replayed: true });
    expect(await db.transactions.count()).toBe(1);
    expect(await db.outbox.where("recordId").equals(committed.transactionId).count()).toBeGreaterThan(0);

    await undoAction("profile-1", action.id);
    expect((await db.transactions.get(committed.transactionId))?.deletedAt).toBeTruthy();
    expect((await commitAction([action], true))[0].replayed).toBe(true);
    expect(await db.transactions.count()).toBe(1);
  });

  it("queues direct repository creates in the sync outbox", async () => {
    const transactionId = await createTransaction({
      profileId: "profile-1",
      type: "expense",
      amount: 500,
      accountId: account.id,
      categoryId: expenseCategory.id,
      date: "2026-11-24",
    });

    const queued = await db.outbox.where("recordId").equals(transactionId).toArray();
    expect(queued.some((entry) => entry.table === "transactions" && entry.op === "create")).toBe(true);
  });

  it("commits an update once, then undoes it with a monotonic timestamp and sync tombstone-safe merge", async () => {
    const before = transaction();
    await withoutOutbox(() => db.transactions.add(before));
    expect((await db.transactions.get(before.id))?.updatedAt).toBe(before.updatedAt);
    await db.outbox.clear();
    const action = proposeAction([{
      kind: "update",
      profileId: before.profileId,
      before,
      changes: { amount: 2500 },
    }], () => "action-update")[0];

    const [committed] = await commitAction([action], true);
    const replay = await commitAction([action], true);
    expect(replay[0]).toMatchObject({ transactionId: before.id, replayed: true });
    expect(await db.transactions.count()).toBe(1);
    expect(Date.parse(committed.updatedAt)).toBeGreaterThan(Date.parse(before.updatedAt));

    const undone = await undoAction(before.profileId, action.id);
    const restored = await db.transactions.get(before.id);
    expect(restored?.amount).toBe(before.amount);
    expect(Date.parse(undone.updatedAt)).toBeGreaterThan(Date.parse(committed.updatedAt));
    expect((await undoAction(before.profileId, action.id)).replayed).toBe(true);

    const transactionOutbox = await db.outbox.where("recordId").equals(before.id).toArray();
    expect(transactionOutbox.length).toBeGreaterThan(0);
    const restoredUpdate = transactionOutbox.find((entry) =>
      entry.op === "update" && (JSON.parse(entry.payload) as Transaction).amount === before.amount
    );
    expect(restoredUpdate).toBeTruthy();

    await applyRemoteChanges([{
      table: "transactions",
      record: { ...before, amount: 9900 },
    }]);
    expect((await db.transactions.get(before.id))?.amount).toBe(before.amount);
  });

  it("soft-deletes a transfer and its fee, then restores both on undo", async () => {
    const action = proposeAction([{
      kind: "transfer",
      profileId: "profile-1",
      after: {
        profileId: "profile-1",
        amount: 10000,
        accountId: account.id,
        toAccountId: secondAccount.id,
        sourceType: "my",
        destinationType: "my",
        transferFee: 100,
        feeCategoryId: expenseCategory.id,
        date: "2026-11-24",
        time: "12:00",
        note: "Move to GCash",
      },
    }], () => "action-transfer")[0];

    const [committed] = await commitAction([action], true);
    const transfer = await db.transactions.get(committed.transactionId);
    expect(transfer?.feeTransactionId).toBeTruthy();
    const fee = await db.transactions.get(transfer!.feeTransactionId!);
    expect(fee?.transferId).toBe(transfer?.id);

    await commitAction([action], true);
    expect(await db.transactions.where("transferId").equals(transfer!.id).count()).toBe(1);
    await undoAction("profile-1", action.id);
    expect((await db.transactions.get(transfer!.id))?.deletedAt).toBeTruthy();
    expect((await db.transactions.get(fee!.id))?.deletedAt).toBeTruthy();
  });

  it("emits a newer restore update after a delete tombstone", async () => {
    const before = transaction();
    await withoutOutbox(() => db.transactions.add(before));
    await db.outbox.clear();
    const action = proposeAction([{
      kind: "delete",
      profileId: before.profileId,
      before,
    }], () => "action-delete")[0];

    const [deleted] = await commitAction([action], true);
    const tombstone = await db.transactions.get(before.id);
    expect(tombstone?.deletedAt).toBeTruthy();
    const deleteOutbox = await db.outbox.where("recordId").equals(before.id).toArray();
    expect(deleteOutbox.some((entry) => entry.op === "delete")).toBe(true);

    const undone = await undoAction(before.profileId, action.id);
    const restored = await db.transactions.get(before.id);
    expect(restored?.deletedAt).toBeNull();
    expect(Date.parse(undone.updatedAt)).toBeGreaterThan(Date.parse(deleted.updatedAt));
    const latestOutbox = await db.outbox.where("recordId").equals(before.id).toArray();
    expect(latestOutbox.some((entry) =>
      entry.op === "update" && !(JSON.parse(entry.payload) as Transaction).deletedAt
    )).toBe(true);

    await applyRemoteChanges([{
      table: "transactions",
      record: { ...tombstone, updatedAt: before.updatedAt },
    }]);
    expect((await db.transactions.get(before.id))?.deletedAt).toBeNull();
  });

  it("caps available undo history without discarding idempotency receipts", async () => {
    let nextId = 0;
    const actions = proposeAction(Array.from({ length: 21 }, (_, index) => ({
      kind: "create" as const,
      profileId: "profile-1",
      after: {
        profileId: "profile-1",
        type: "expense" as const,
        amount: 100 + index,
        accountId: account.id,
        categoryId: expenseCategory.id,
        date: "2026-11-24",
      },
    })), () => `action-${++nextId}`);
    await commitAction(actions, true);

    expect((await db.kupiActions.get("action-1"))?.undoAvailable).toBe(false);
    expect((await db.kupiActions.get("action-21"))?.undoAvailable).toBe(true);
    await expect(undoAction("profile-1", "action-1")).rejects.toThrow("undo history limit");
    expect((await commitAction([actions[0]], true))[0].replayed).toBe(true);
    expect(await db.transactions.count()).toBe(21);
  });
});
