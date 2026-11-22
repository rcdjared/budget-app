import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db/schema";
import {
  cancelTransaction,
  restoreTransaction,
} from "@/db/repositories/transactions";
import {
  convertExpenseToLocalSplit,
  createFriend,
  createSharedBill,
  markSharedBillMemberPaid,
  recordFriendPayment,
  reconfigureLocalSplit,
  removeSharedBill,
  removeLocalSplit,
  updateSharedBillAmount,
} from "@/db/repositories/localFinance";
import { computeAccountBalance, computeMonthlyTotals } from "@/domain/balances";
import { computeFriendBalance } from "@/domain/friendLedger";
import type { Account, Profile, Transaction } from "@/domain/types";

const profile: Profile = {
  id: "profile",
  name: "Home",
  currency: "PHP",
  isDefault: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const account: Account = {
  id: "account",
  profileId: profile.id,
  name: "Cash",
  type: "cash",
  openingBalance: 100_000,
  currency: "PHP",
  color: "#000000",
  icon: "wallet",
  isArchived: false,
  createdAt: profile.createdAt,
  updatedAt: profile.updatedAt,
};

const expense: Transaction = {
  id: "expense",
  profileId: profile.id,
  type: "expense",
  amount: 10_001,
  accountId: account.id,
  categoryId: "food",
  date: "2026-06-01",
  createdAt: profile.createdAt,
  updatedAt: profile.updatedAt,
};

async function addFriend(name: string): Promise<string> {
  return createFriend(profile.id, {
    name,
    phone: null,
    note: null,
    avatarColor: "#019B51",
  });
}

describe("friend, split, and shared-bill bookkeeping", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    await db.profiles.add(profile);
    await db.accounts.add(account);
    await db.transactions.add(expense);
  });

  it("reconciles all friend balances when a split is edited or removed", async () => {
    const firstFriend = await addFriend("Ari");
    const secondFriend = await addFriend("Bea");
    const splitId = await convertExpenseToLocalSplit({
      profileId: profile.id,
      transactionId: expense.id,
      friendIds: [firstFriend],
      mode: "equal",
    });

    await reconfigureLocalSplit(profile.id, expense.id, [secondFriend], "equal", [], [], undefined, 12_000);
    let entries = await db.friendLedger.toArray();
    expect(computeFriendBalance(entries, firstFriend)).toBe(0);
    expect(computeFriendBalance(entries, secondFriend)).toBe(6_000);
    expect((await db.transactions.get(expense.id))?.amount).toBe(12_000);
    expect((await db.transactions.get(expense.id))?.personalShareAmount).toBe(6_000);

    await removeLocalSplit(profile.id, expense.id);
    entries = await db.friendLedger.toArray();
    expect(computeFriendBalance(entries, secondFriend)).toBe(0);
    expect((await db.transactions.get(expense.id))?.splitId).toBeNull();
    expect((await db.localSplits.get(splitId))?.status).toBe("cancelled");
  });

  it("uses the user's shared-bill share and tracks partial repayments", async () => {
    const friendId = await addFriend("Cory");
    const billId = await createSharedBill(
      profile.id,
      expense.id,
      "Dinner",
      ["", friendId],
      "equal"
    );
    const members = await db.sharedBillMembers.where("sharedBillId").equals(billId).toArray();
    const me = members.find((member) => member.isMe);
    const friend = members.find((member) => member.friendId === friendId);
    expect(me?.paidAmount).toBe(me?.amount);
    expect((await db.transactions.get(expense.id))?.personalShareAmount).toBe(5_001);
    expect(computeFriendBalance(await db.friendLedger.toArray(), friendId)).toBe(5_000);

    await markSharedBillMemberPaid(profile.id, billId, friend!.id, 2_000);
    const updated = await db.sharedBillMembers.get(friend!.id);
    expect(updated?.paidAmount).toBe(2_000);
    expect(updated?.status).toBe("partial");
    expect(computeFriendBalance(await db.friendLedger.toArray(), friendId)).toBe(3_000);
    await recordFriendPayment(
      profile.id,
      friendId,
      1_000,
      expense.date,
      "Remainder",
      undefined,
      "received",
      friend!.id
    );
    const settledMember = await db.sharedBillMembers.get(friend!.id);
    expect(settledMember?.paidAmount).toBe(3_000);
    expect(computeFriendBalance(await db.friendLedger.toArray(), friendId)).toBe(2_000);
    await expect(markSharedBillMemberPaid(profile.id, billId, friend!.id, 2_001)).rejects.toThrow();
  });

  it("credits received payments, debits sent payments, and leaves reports untouched", async () => {
    const friendId = await addFriend("Dani");
    await db.friendLedger.add({
      id: "receivable",
      profileId: profile.id,
      friendId,
      transactionId: expense.id,
      type: "expense_share",
      direction: "owed_to_me",
      amount: 3_000,
      date: expense.date,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    });
    const received = await recordFriendPayment(
      profile.id,
      friendId,
      3_000,
      expense.date,
      "Repayment",
      account.id,
      "received"
    );
    const receivedEntry = await db.friendLedger.get(received);
    expect(receivedEntry?.direction).toBe("you_owe");
    expect(computeFriendBalance(await db.friendLedger.toArray(), friendId)).toBe(0);

    await db.friendLedger.add({
      id: "payable",
      profileId: profile.id,
      friendId,
      type: "expense_share",
      direction: "you_owe",
      amount: 1_500,
      date: expense.date,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    });
    const sent = await recordFriendPayment(
      profile.id,
      friendId,
      1_500,
      expense.date,
      "Paid back",
      account.id,
      "sent"
    );
    const sentEntry = await db.friendLedger.get(sent);
    const paymentTransactions = await db.transactions.where("type").equals("friend_payment").toArray();
    expect(sentEntry?.direction).toBe("owed_to_me");
    expect(paymentTransactions.map((transaction) => transaction.friendPaymentDirection).sort()).toEqual(["received", "sent"]);
    expect(computeAccountBalance(account.id, account.openingBalance, paymentTransactions)).toBe(101_500);
    expect(computeMonthlyTotals(paymentTransactions, expense.date, expense.date)).toEqual({ income: 0, expenses: 0 });
  });

  it("reverses and restores shared-bill balances when the expense is cancelled", async () => {
    const friendId = await addFriend("Eli");
    await createSharedBill(profile.id, expense.id, "Meal", ["", friendId], "equal");
    expect(computeFriendBalance(await db.friendLedger.toArray(), friendId)).toBe(5_000);

    await cancelTransaction(expense.id, profile.id);
    expect(computeFriendBalance(await db.friendLedger.toArray(), friendId)).toBe(0);
    expect((await db.sharedBills.toArray())[0]?.status).toBe("cancelled");

    await restoreTransaction(expense.id, profile.id);
    expect(computeFriendBalance(await db.friendLedger.toArray(), friendId)).toBe(5_000);
    expect((await db.sharedBills.toArray())[0]?.status).toBe("active");
  });

  it("keeps recorded repayments as credits when a shared bill is cancelled", async () => {
    const friendId = await addFriend("Evan");
    const billId = await createSharedBill(profile.id, expense.id, "Meal", ["", friendId], "equal");
    const member = (await db.sharedBillMembers.where("sharedBillId").equals(billId).toArray())
      .find((item) => item.friendId === friendId)!;
    await markSharedBillMemberPaid(profile.id, billId, member.id, 2_000);

    await cancelTransaction(expense.id, profile.id);
    expect(computeFriendBalance(await db.friendLedger.toArray(), friendId)).toBe(-2_000);

    await restoreTransaction(expense.id, profile.id);
    expect(computeFriendBalance(await db.friendLedger.toArray(), friendId)).toBe(3_000);
  });

  it("preserves shared-bill repayments when switching to a local split", async () => {
    const friendId = await addFriend("Gia");
    const billId = await createSharedBill(profile.id, expense.id, "Meal", ["", friendId], "equal");
    const member = (await db.sharedBillMembers.where("sharedBillId").equals(billId).toArray())
      .find((item) => item.friendId === friendId)!;
    await markSharedBillMemberPaid(profile.id, billId, member.id, 2_000);

    await removeSharedBill(profile.id, expense.id);
    await convertExpenseToLocalSplit({
      profileId: profile.id,
      transactionId: expense.id,
      friendIds: [friendId],
      mode: "equal",
    });
    expect(computeFriendBalance(await db.friendLedger.toArray(), friendId)).toBe(3_000);
  });

  it("redistributes a shared-bill edit without discarding repayments", async () => {
    const friendId = await addFriend("Faye");
    const billId = await createSharedBill(profile.id, expense.id, "Meal", ["", friendId], "equal");
    const member = (await db.sharedBillMembers.where("sharedBillId").equals(billId).toArray())
      .find((item) => item.friendId === friendId)!;
    await markSharedBillMemberPaid(profile.id, billId, member.id, 2_000);

    await updateSharedBillAmount(profile.id, expense.id, 12_000);
    const updatedMembers = await db.sharedBillMembers.where("sharedBillId").equals(billId).toArray();
    const updatedMe = updatedMembers.find((item) => item.isMe)!;
    const updatedFriend = updatedMembers.find((item) => item.friendId === friendId)!;
    expect(updatedMe.amount).toBe(6_001);
    expect(updatedFriend.amount).toBe(5_999);
    expect(updatedFriend.paidAmount).toBe(2_000);
    expect(computeFriendBalance(await db.friendLedger.toArray(), friendId)).toBe(3_999);
    expect((await db.transactions.get(expense.id))?.personalShareAmount).toBe(6_001);
  });
});
