import { db } from "@/db/schema";
import { profileRecords } from "@/db/profileScope";
import type {
  Friend,
  FriendLedgerEntry,
  LocalSplit,
  SharedBill,
  SharedBillMember,
  Transaction,
} from "@/domain/types";
import { distributeEqualSplit, distributePercentSplit, validateExactShares } from "@/domain/splits";

const now = () => new Date().toISOString();

export async function createFriend(
  profileId: string,
  data: Pick<Friend, "name" | "phone" | "note" | "avatarColor">
): Promise<string> {
  const timestamp = now();
  const id = crypto.randomUUID();
  await db.friends.add({
    id,
    profileId,
    name: data.name.trim(),
    phone: data.phone?.trim() || null,
    note: data.note?.trim() || null,
    avatarColor: data.avatarColor,
    linkedUserId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return id;
}

export async function updateFriend(id: string, data: Partial<Pick<Friend, "name" | "phone" | "note" | "avatarColor" | "archivedAt">>): Promise<void> {
  await db.friends.update(id, { ...data, updatedAt: now() });
}

export async function deleteFriendIfZero(profileId: string, friendId: string): Promise<boolean> {
  const entries = await profileRecords(db.friendLedger, profileId)
    .filter((entry) => entry.friendId === friendId)
    .filter((entry) => !entry.deletedAt)
    .toArray();
  const balance = entries.reduce((sum, entry) => {
    if (entry.type === "shared_bill") return sum;
    return sum + (entry.direction === "owed_to_me" ? entry.amount : -entry.amount);
  }, 0);
  if (balance !== 0) return false;
  await db.friends.update(friendId, { deletedAt: now(), updatedAt: now() });
  return true;
}

export interface CreateLocalSplitInput {
  profileId: string;
  transactionId: string;
  friendIds: string[];
  mode: "equal" | "exact" | "percent";
  exactShares?: number[];
  percentHundredths?: number[];
  expectedBy?: string;
}

export async function convertExpenseToLocalSplit(input: CreateLocalSplitInput): Promise<string> {
  if (!input.friendIds.length) throw new Error("Add at least one friend.");
  return db.transaction("rw", db.tables, async () => {
    const transaction = await db.transactions.get(input.transactionId);
    if (!transaction || transaction.type !== "expense" || transaction.deletedAt || transaction.cancelledAt) {
      throw new Error("Only an active expense can be split.");
    }
    if (transaction.sharedBillId) throw new Error("Remove the shared bill before creating a local split.");

    const participantCount = input.friendIds.length + 1;
    let friendShares: number[];
    let personalShare: number;

    if (input.mode === "equal") {
      const shares = distributeEqualSplit(transaction.amount, participantCount);
      personalShare = shares[0];
      friendShares = shares.slice(1);
    } else if (input.mode === "exact") {
      const shares = input.exactShares || [];
      if (shares.length !== participantCount || !validateExactShares(transaction.amount, shares)) {
        throw new Error("Shares must add up exactly to the expense amount.");
      }
      personalShare = shares[0];
      friendShares = shares.slice(1);
    } else {
      const percent = input.percentHundredths || [];
      if (percent.length !== participantCount) throw new Error("Choose a percentage for every participant.");
      const shares = distributePercentSplit(transaction.amount, percent);
      personalShare = shares[0];
      friendShares = shares.slice(1);
    }

    if (personalShare <= 0) throw new Error("My share must be greater than zero.");

    const timestamp = now();
    const splitId = crypto.randomUUID();
    await db.localSplits.add({
      id: splitId,
      profileId: input.profileId,
      transactionId: input.transactionId,
      mode: input.mode,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    await db.transactions.update(input.transactionId, {
      splitId,
      personalShareAmount: personalShare,
      sharedBillId: null,
      updatedAt: timestamp,
    });

    input.friendIds.forEach((friendId, index) => {
      void db.friendLedger.add({
        id: crypto.randomUUID(),
        profileId: input.profileId,
        friendId,
        transactionId: input.transactionId,
        type: "expense_share",
        direction: "owed_to_me",
        amount: friendShares[index],
        date: transaction.date,
        expectedBy: input.expectedBy || null,
        note: "Local split",
        createdAt: timestamp,
        updatedAt: timestamp,
      });
    });
    return splitId;
  }) as Promise<string>;
}

export async function recordFriendPayment(
  profileId: string,
  friendId: string,
  amount: number,
  date: string,
  note: string,
  accountId?: string
): Promise<string> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Payment amount must be positive centavos.");
  return db.transaction("rw", db.tables, async () => {
    const friend = await db.friends.get(friendId);
    if (!friend || friend.deletedAt) throw new Error("Friend not found.");
    if (accountId) {
      const account = await db.accounts.get(accountId);
      if (!account || account.deletedAt) throw new Error("Account not found.");
    }
    const timestamp = now();
    const entryId = crypto.randomUUID();
    await db.friendLedger.add({
      id: entryId,
      profileId,
      friendId,
      type: "payment",
      direction: "you_owe",
      amount,
      date,
      note: note.trim() || null,
      accountId: accountId || null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    if (accountId) {
      await db.transactions.add({
        id: crypto.randomUUID(),
        profileId,
        type: "friend_payment",
        amount,
        accountId,
        toAccountId: null,
        categoryId: null,
        date,
        note: `Payment from ${friend.name}${note.trim() ? ` · ${note.trim()}` : ""}`,
        createdAt: timestamp,
        updatedAt: timestamp,
        tags: ["friend-payment"],
      } satisfies Transaction);
    }
    return entryId;
  }) as Promise<string>;
}

export async function createSharedBill(
  profileId: string,
  transactionId: string,
  title: string,
  participantIds: string[],
  mode: "equal" | "exact" | "percent",
  exactShares: number[] = [],
  percentHundredths: number[] = [],
  expectedBy?: string
): Promise<string> {
  return db.transaction("rw", db.tables, async () => {
    const transaction = await db.transactions.get(transactionId);
    if (!transaction || transaction.type !== "expense" || transaction.deletedAt || transaction.cancelledAt) {
      throw new Error("Only an active expense can become a shared bill.");
    }
    if (transaction.splitId) throw new Error("Remove the local split before creating a shared bill.");
    const participantCount = participantIds.length;
    if (participantCount < 1) throw new Error("Add at least one participant.");

    let shares: number[];
    if (mode === "equal") shares = distributeEqualSplit(transaction.amount, participantCount);
    else if (mode === "exact") {
      if (!validateExactShares(transaction.amount, exactShares)) throw new Error("Shares must add up exactly.");
      shares = exactShares;
    } else shares = distributePercentSplit(transaction.amount, percentHundredths);

    const timestamp = now();
    const billId = crypto.randomUUID();
    await db.sharedBills.add({
      id: billId,
      profileId,
      transactionId,
      title: title.trim(),
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await db.transactions.update(transactionId, { sharedBillId: billId, splitId: null, personalShareAmount: null, updatedAt: timestamp });

    for (let index = 0; index < participantIds.length; index++) {
      const participantId = participantIds[index];
      const friend = participantId ? await db.friends.get(participantId) : undefined;
      await db.sharedBillMembers.add({
        id: crypto.randomUUID(),
        sharedBillId: billId,
        friendId: participantId || null,
        name: friend?.name || "Me",
        isMe: !participantId,
        amount: shares[index],
        paidAmount: 0,
        status: "unpaid",
        accountId: null,
        expectedBy: expectedBy || null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      if (participantId) {
        await db.friendLedger.add({
          id: crypto.randomUUID(),
          profileId,
          friendId: participantId,
          transactionId,
          sharedBillId: billId,
          type: "shared_bill",
          direction: "owed_to_me",
          amount: shares[index],
          date: transaction.date,
          note: title.trim(),
          expectedBy: expectedBy || null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    }
    return billId;
  }) as Promise<string>;
}

export async function reconfigureLocalSplit(
  transactionId: string,
  friendIds: string[],
  mode: "equal" | "exact" | "percent",
  exactShares: number[] = [],
  percentHundredths: number[] = [],
  expectedBy?: string
): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const transaction = await db.transactions.get(transactionId);
    if (!transaction || transaction.type !== "expense" || transaction.deletedAt || transaction.cancelledAt) {
      throw new Error("Only an active expense can be re-split.");
    }
    if (!transaction.splitId) throw new Error("This expense is not split.");

    const participantCount = friendIds.length + 1;
    let shares: number[];
    if (mode === "equal") shares = distributeEqualSplit(transaction.amount, participantCount);
    else if (mode === "exact") {
      if (!validateExactShares(transaction.amount, exactShares)) throw new Error("Shares must add up exactly.");
      shares = exactShares;
    } else shares = distributePercentSplit(transaction.amount, percentHundredths);

    const timestamp = now();
    const oldEntries = await db.friendLedger
      .where("transactionId")
      .equals(transactionId)
      .filter((entry) => entry.type === "expense_share" && !entry.deletedAt)
      .toArray();

    for (let index = 0; index < friendIds.length; index++) {
      const friendId = friendIds[index];
      const oldShare = oldEntries.find((entry) => entry.friendId === friendId)?.amount || 0;
      const newShare = shares[index + 1];
      const delta = newShare - oldShare;
      if (delta !== 0) {
        await db.friendLedger.add({
          id: crypto.randomUUID(),
          profileId: transaction.profileId,
          friendId,
          transactionId,
          type: "adjustment",
          direction: delta > 0 ? "owed_to_me" : "you_owe",
          amount: Math.abs(delta),
          date: transaction.date,
          note: "Split amount edited",
          expectedBy: expectedBy || null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    }
    await db.transactions.update(transactionId, {
      personalShareAmount: shares[0],
      updatedAt: timestamp,
      editedAt: timestamp,
    });
  });
}

export async function removeLocalSplit(transactionId: string): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const transaction = await db.transactions.get(transactionId);
    if (!transaction) return;
    const timestamp = now();
    if (transaction.splitId) {
      await db.localSplits.update(transaction.splitId, { status: "cancelled", updatedAt: timestamp });
      const entries = await db.friendLedger.where("transactionId").equals(transactionId).toArray();
      for (const entry of entries) {
        if (entry.type === "expense_share" && !entry.deletedAt) {
          await db.friendLedger.add({
            id: crypto.randomUUID(),
            profileId: entry.profileId,
            friendId: entry.friendId,
            transactionId,
            type: "adjustment",
            direction: "you_owe",
            amount: entry.amount,
            date: transaction.date,
            note: "Local split removed",
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      }
    }
    await db.transactions.update(transactionId, { splitId: null, personalShareAmount: null, updatedAt: timestamp });
  });
}

export async function markSharedBillMemberPaid(
  sharedBillId: string,
  memberId: string,
  paidAmount: number,
  accountId?: string,
  note?: string
): Promise<void> {
  if (!Number.isInteger(paidAmount) || paidAmount <= 0) throw new Error("Paid amount must be positive centavos.");
  await db.transaction("rw", db.tables, async () => {
    const member = await db.sharedBillMembers.get(memberId);
    if (!member || member.sharedBillId !== sharedBillId) throw new Error("Participant not found.");
    const nextPaidAmount = Math.min(member.amount, member.paidAmount + paidAmount);
    const status = nextPaidAmount >= member.amount ? "paid" : "partial";
    const timestamp = now();
    await db.sharedBillMembers.update(memberId, {
      paidAmount: nextPaidAmount,
      status,
      accountId: accountId || member.accountId || null,
      updatedAt: timestamp,
    });
    if (accountId && member.friendId) {
      await recordFriendPayment(
        (await db.sharedBills.get(sharedBillId))?.profileId || "",
        member.friendId,
        paidAmount,
        new Date().toISOString().slice(0, 10),
        note?.trim() || "Shared bill payment",
        accountId
      );
    }
  });
}
