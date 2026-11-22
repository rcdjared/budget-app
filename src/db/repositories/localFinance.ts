import { db } from "@/db/schema";
import { getProfileRecord, profileRecords } from "@/db/profileScope";
import { computeFriendBalance } from "@/domain/friendLedger";
import type {
  Friend,
  FriendPaymentDirection,
  FriendLedgerEntry,
  LocalSplit,
  SharedBill,
  SharedBillMember,
  Transaction,
} from "@/domain/types";
import { distributeEqualSplit, distributePercentSplit, validateExactShares } from "@/domain/splits";

const now = () => new Date().toISOString();

function oppositeDirection(direction: FriendLedgerEntry["direction"]): FriendLedgerEntry["direction"] {
  return direction === "owed_to_me" ? "you_owe" : "owed_to_me";
}

async function validateFriendIds(profileId: string, friendIds: string[]): Promise<Friend[]> {
  if (!friendIds.length) throw new Error("Add at least one friend.");
  if (new Set(friendIds).size !== friendIds.length || friendIds.some((id) => !id)) {
    throw new Error("Choose each friend only once.");
  }
  const friends = await Promise.all(friendIds.map((id) => getProfileRecord(db.friends, id, profileId)));
  if (friends.some((friend) => !friend || friend.deletedAt || friend.archivedAt)) {
    throw new Error("A selected friend is no longer available.");
  }
  return friends as Friend[];
}

function calculateShares(
  total: number,
  participantCount: number,
  mode: "equal" | "exact" | "percent",
  exactShares: number[] = [],
  percentHundredths: number[] = []
): number[] {
  let shares: number[];
  if (mode === "equal") {
    shares = distributeEqualSplit(total, participantCount);
  } else if (mode === "exact") {
    if (exactShares.length !== participantCount || !validateExactShares(total, exactShares)) {
      throw new Error("Shares must add up exactly to the expense amount.");
    }
    shares = exactShares;
  } else {
    if (percentHundredths.length !== participantCount) {
      throw new Error("Choose a percentage for every participant.");
    }
    shares = distributePercentSplit(total, percentHundredths);
  }
  if (shares.reduce((sum, share) => sum + share, 0) !== total) {
    throw new Error("Shares must add up exactly to the expense amount.");
  }
  return shares;
}

function distributeWeightedShares(total: number, weights: number[]): number[] {
  if (!weights.length) throw new Error("At least one participant is required.");
  if (!Number.isSafeInteger(total) || total < 0
    || weights.some((weight) => !Number.isSafeInteger(weight) || weight < 0)) {
    throw new Error("Shares must be non-negative integer centavos.");
  }
  const usableWeights = weights.some((weight) => weight > 0) ? weights : weights.map(() => 1);
  const weightTotal = usableWeights.reduce((sum, weight) => sum + weight, 0);
  const totalBig = BigInt(total);
  const weightTotalBig = BigInt(weightTotal);
  const shares = usableWeights.map((weight) => Number((totalBig * BigInt(weight)) / weightTotalBig));
  const remainder = total - shares.reduce((sum, share) => sum + share, 0);
  const rankedIndexes = usableWeights
    .map((weight, index) => ({
      index,
      remainder: (totalBig * BigInt(weight)) % weightTotalBig,
    }))
    .sort((left, right) => left.remainder === right.remainder
      ? left.index - right.index
      : left.remainder > right.remainder ? -1 : 1);
  for (let index = 0; index < remainder; index++) {
    const targetIndex = rankedIndexes[index]?.index;
    if (targetIndex !== undefined) shares[targetIndex] += 1;
  }
  return shares;
}

function redistributeShares(
  total: number,
  weights: number[],
  minimums: number[]
): number[] {
  if (weights.length !== minimums.length || !weights.length) {
    throw new Error("Participant shares are incomplete.");
  }
  if (minimums.reduce((sum, minimum) => sum + minimum, 0) > total) {
    throw new Error("The new total cannot be less than the repayments already recorded.");
  }
  const shares = Array.from({ length: weights.length }, () => 0);
  let remaining = total;
  let activeIndexes = weights.map((_, index) => index);
  while (activeIndexes.length) {
    const proposedShares = distributeWeightedShares(
      remaining,
      activeIndexes.map((index) => weights[index] || 0)
    );
    const constrainedIndexes = activeIndexes.filter((index, position) =>
      (proposedShares[position] || 0) < (minimums[index] || 0)
    );
    if (!constrainedIndexes.length) {
      activeIndexes.forEach((index, position) => {
        shares[index] = proposedShares[position] || 0;
      });
      break;
    }
    const constrainedSet = new Set(constrainedIndexes);
    for (const index of constrainedIndexes) {
      const minimum = minimums[index] || 0;
      shares[index] = minimum;
      remaining -= minimum;
    }
    activeIndexes = activeIndexes.filter((index) => !constrainedSet.has(index));
  }
  return shares;
}

async function localSplitEntries(transactionId: string): Promise<FriendLedgerEntry[]> {
  const entries = await db.friendLedger.where("transactionId").equals(transactionId).toArray();
  const reversedIds = new Set(
    entries.filter((entry) => entry.reversesEntryId && !entry.deletedAt).map((entry) => entry.reversesEntryId)
  );
  return entries.filter((entry) =>
    !entry.deletedAt
    && !entry.reversesEntryId
    && !reversedIds.has(entry.id)
    && (entry.type === "expense_share" || entry.type === "adjustment")
  );
}

async function activeSharedBillEntries(
  sharedBillId: string,
  types?: FriendLedgerEntry["type"][]
): Promise<FriendLedgerEntry[]> {
  const entries = await db.friendLedger.where("sharedBillId").equals(sharedBillId).toArray();
  const reversedIds = new Set(
    entries.filter((entry) => entry.reversesEntryId && !entry.deletedAt).map((entry) => entry.reversesEntryId)
  );
  return entries.filter((entry) =>
    !entry.deletedAt
    && !entry.reversesEntryId
    && !reversedIds.has(entry.id)
    && (!types || types.includes(entry.type))
  );
}

async function appendReversals(
  entries: FriendLedgerEntry[],
  note: string,
  timestamp: string,
  links: { transactionId?: string; sharedBillId?: string }
): Promise<void> {
  const reversals = entries.map((entry) => ({
    id: crypto.randomUUID(),
    profileId: entry.profileId,
    friendId: entry.friendId,
    ...links,
    type: "adjustment" as const,
    direction: oppositeDirection(entry.direction),
    amount: entry.amount,
    date: timestamp.slice(0, 10),
    note,
    reversesEntryId: entry.id,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  if (reversals.length) await db.friendLedger.bulkAdd(reversals);
}

async function removeLocalSplitWithinTransaction(transaction: Transaction, timestamp = now()): Promise<void> {
  if (!transaction.splitId) return;
  const split = await getProfileRecord(db.localSplits, transaction.splitId, transaction.profileId);
  if (split) await db.localSplits.update(split.id, { status: "cancelled", updatedAt: timestamp });
  await appendReversals(
    await localSplitEntries(transaction.id),
    "Local split removed",
    timestamp,
    { transactionId: transaction.id }
  );
  await db.transactions.update(transaction.id, {
    splitId: null,
    personalShareAmount: null,
    updatedAt: timestamp,
  });
}

export async function reverseLocalSplitBalances(transactionId: string, note: string): Promise<void> {
  await appendReversals(await localSplitEntries(transactionId), note, now(), { transactionId });
}

export async function restoreLocalSplitBalances(transactionId: string, note: string | string[]): Promise<void> {
  const notes = new Set(Array.isArray(note) ? note : [note]);
  const entries = await db.friendLedger.where("transactionId").equals(transactionId).toArray();
  const timestamp = now();
  for (const entry of entries) {
    if (entry.type === "adjustment" && entry.note && notes.has(entry.note) && entry.reversesEntryId && !entry.deletedAt) {
      await db.friendLedger.update(entry.id, { deletedAt: timestamp, updatedAt: timestamp });
    }
  }
}

export async function reverseSharedBillBalances(sharedBillId: string, note: string): Promise<void> {
  const entries = await activeSharedBillEntries(sharedBillId, ["shared_bill", "adjustment"]);
  const bill = await db.sharedBills.get(sharedBillId);
  if (!bill) throw new Error("Shared bill not found.");
  await appendReversals(entries, note, now(), {
    transactionId: bill.transactionId,
    sharedBillId,
  });
}

export async function removeSharedBill(profileId: string, transactionId: string): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const transaction = await getProfileRecord(db.transactions, transactionId, profileId);
    if (!transaction || !transaction.sharedBillId) throw new Error("Shared bill not found.");
    const bill = await getProfileRecord(db.sharedBills, transaction.sharedBillId, profileId);
    if (!bill) throw new Error("Shared bill not found.");
    const timestamp = now();
    await reverseSharedBillBalances(bill.id, "Shared bill removed");
    await db.sharedBills.update(bill.id, { status: "cancelled", updatedAt: timestamp });
    await db.transactions.update(transaction.id, {
      sharedBillId: null,
      personalShareAmount: null,
      updatedAt: timestamp,
    });
  });
}

export async function restoreSharedBillBalances(sharedBillId: string, note: string | string[]): Promise<void> {
  const notes = new Set(Array.isArray(note) ? note : [note]);
  const entries = await db.friendLedger.where("sharedBillId").equals(sharedBillId).toArray();
  const timestamp = now();
  for (const entry of entries) {
    if (entry.type === "adjustment" && entry.note && notes.has(entry.note) && entry.reversesEntryId && !entry.deletedAt) {
      await db.friendLedger.update(entry.id, { deletedAt: timestamp, updatedAt: timestamp });
    }
  }
}

export async function setFriendPaymentActive(transactionId: string, active: boolean): Promise<void> {
  const entries = await db.friendLedger.where("transactionId").equals(transactionId)
    .filter((entry) => entry.type === "payment")
    .toArray();
  const timestamp = now();
  for (const entry of entries) {
    if (active === !entry.deletedAt) continue;
    await db.friendLedger.update(entry.id, { deletedAt: active ? null : timestamp, updatedAt: timestamp });
    if (!entry.sharedBillMemberId) continue;
    const member = await db.sharedBillMembers.get(entry.sharedBillMemberId);
    if (!member) continue;
    const paidAmount = Math.max(0, Math.min(
      member.amount,
      member.paidAmount + (active ? entry.amount : -entry.amount)
    ));
    await db.sharedBillMembers.update(member.id, {
      paidAmount,
      status: paidAmount >= member.amount ? "paid" : paidAmount > 0 ? "partial" : "unpaid",
      updatedAt: timestamp,
    });
  }
}

export async function createFriend(
  profileId: string,
  data: Pick<Friend, "name" | "phone" | "note" | "avatarColor">
): Promise<string> {
  const name = data.name.trim();
  if (!name) throw new Error("Friend name is required.");
  const profile = await db.profiles.get(profileId);
  if (!profile || profile.deletedAt) throw new Error("Profile not found.");
  const timestamp = now();
  const id = crypto.randomUUID();
  await db.transaction("rw", db.tables, async () => {
    await db.friends.add({
      id,
      profileId,
      name,
      phone: data.phone?.trim() || null,
      note: data.note?.trim() || null,
      avatarColor: data.avatarColor,
      linkedUserId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  });
  return id;
}

export async function updateFriend(profileId: string, id: string, data: Partial<Pick<Friend, "name" | "phone" | "note" | "avatarColor" | "archivedAt">>): Promise<void> {
  if (data.name !== undefined && !data.name.trim()) throw new Error("Friend name is required.");
  await db.transaction("rw", db.tables, async () => {
    const friend = await getProfileRecord(db.friends, id, profileId);
    if (!friend || friend.deletedAt) throw new Error("Friend not found.");
    await db.friends.update(id, {
      ...data,
      ...(data.name !== undefined ? { name: data.name.trim() } : {}),
      updatedAt: now(),
    });
  });
}

export async function deleteFriendIfZero(profileId: string, friendId: string): Promise<boolean> {
  return db.transaction("rw", db.tables, async () => {
    const friend = await getProfileRecord(db.friends, friendId, profileId);
    if (!friend || friend.deletedAt) throw new Error("Friend not found.");
    const entries = await profileRecords(db.friendLedger, profileId)
      .filter((entry) => entry.friendId === friendId && !entry.deletedAt)
      .toArray();
    if (computeFriendBalance(entries) !== 0) return false;
    const timestamp = now();
    await db.friends.update(friendId, { deletedAt: timestamp, updatedAt: timestamp });
    return true;
  });
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
  return db.transaction("rw", db.tables, async () => {
    const transaction = await getProfileRecord(db.transactions, input.transactionId, input.profileId);
    if (!transaction || transaction.type !== "expense" || transaction.deletedAt || transaction.cancelledAt) {
      throw new Error("Only an active expense can be split.");
    }
    if (transaction.splitId) throw new Error("This expense is already split.");
    if (transaction.sharedBillId) throw new Error("Remove the shared bill before creating a local split.");
    await validateFriendIds(input.profileId, input.friendIds);
    const participantCount = input.friendIds.length + 1;
    const shares = calculateShares(
      transaction.amount,
      participantCount,
      input.mode,
      input.exactShares,
      input.percentHundredths
    );
    const personalShare = shares[0];
    const friendShares = shares.slice(1);
    if (personalShare <= 0) throw new Error("My share must be greater than zero.");

    const timestamp = now();
    const splitId = crypto.randomUUID();
    await db.localSplits.add({
      id: splitId,
      profileId: input.profileId,
      transactionId: input.transactionId,
      mode: input.mode,
      friendIds: input.friendIds,
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

    const entries: FriendLedgerEntry[] = input.friendIds.flatMap((friendId, index) =>
      friendShares[index] > 0 ? [{
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
      }] : []
    );
    if (entries.length) await db.friendLedger.bulkAdd(entries);
    return splitId;
  }) as Promise<string>;
}

export async function recordFriendPayment(
  profileId: string,
  friendId: string,
  amount: number,
  date: string,
  note: string,
  accountId?: string,
  direction: FriendPaymentDirection = "received",
  sharedBillMemberId?: string
): Promise<string> {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Payment amount must be positive centavos.");
  return db.transaction("rw", db.tables, async () => {
    const friend = await getProfileRecord(db.friends, friendId, profileId);
    if (!friend || friend.deletedAt) throw new Error("Friend not found.");
    if (accountId) {
      const account = await getProfileRecord(db.accounts, accountId, profileId);
      if (!account || account.deletedAt) throw new Error("Account not found.");
    }
    const balanceEntries = await profileRecords(db.friendLedger, profileId)
      .filter((entry) => entry.friendId === friendId && !entry.deletedAt)
      .toArray();
    const balance = computeFriendBalance(balanceEntries);
    const outstanding = direction === "received" ? balance : -balance;
    if (outstanding <= 0) {
      throw new Error(direction === "received" ? "This friend does not owe you." : "You do not owe this friend.");
    }
    if (amount > outstanding) throw new Error("Payment cannot exceed the outstanding balance.");

    let member: SharedBillMember | undefined;
    let bill: SharedBill | undefined;
    if (sharedBillMemberId) {
      member = await db.sharedBillMembers.get(sharedBillMemberId);
      if (member) bill = await db.sharedBills.get(member.sharedBillId);
      if (!member || !bill || bill.profileId !== profileId || member.sharedBillId !== bill.id
        || member.friendId !== friendId || bill.status !== "active") {
        throw new Error("Shared bill participant not found.");
      }
      if (direction !== "received") throw new Error("Shared bill repayments must be received.");
      const remaining = member.amount - member.paidAmount;
      if (amount > remaining) throw new Error("Payment cannot exceed the participant's outstanding share.");
    }
    const timestamp = now();
    const entryId = crypto.randomUUID();
    const paymentTransactionId = accountId ? crypto.randomUUID() : undefined;
    await db.friendLedger.add({
      id: entryId,
      profileId,
      friendId,
      transactionId: paymentTransactionId,
      sharedBillId: bill?.id,
      sharedBillMemberId: member?.id,
      type: "payment",
      direction: direction === "received" ? "you_owe" : "owed_to_me",
      amount,
      date,
      note: note.trim() || null,
      accountId: accountId || null,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    if (accountId && paymentTransactionId) {
      await db.transactions.add({
        id: paymentTransactionId,
        profileId,
        type: "friend_payment",
        amount,
        accountId,
        toAccountId: null,
        categoryId: null,
        date,
        note: `${direction === "received" ? "Payment from" : "Payment to"} ${friend.name}${note.trim() ? ` · ${note.trim()}` : ""}`,
        friendPaymentDirection: direction,
        createdAt: timestamp,
        updatedAt: timestamp,
        tags: ["friend-payment"],
      } satisfies Transaction);
    }
    if (member) {
      const paidAmount = member.paidAmount + amount;
      await db.sharedBillMembers.update(member.id, {
        paidAmount,
        status: paidAmount >= member.amount ? "paid" : "partial",
        accountId: accountId || member.accountId || null,
        updatedAt: timestamp,
      });
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
    const transaction = await getProfileRecord(db.transactions, transactionId, profileId);
    if (!transaction || transaction.type !== "expense" || transaction.deletedAt || transaction.cancelledAt) {
      throw new Error("Only an active expense can become a shared bill.");
    }
    if (transaction.splitId || transaction.sharedBillId) throw new Error("Remove the existing split or shared bill first.");
    const participantCount = participantIds.length;
    if (participantCount < 1) throw new Error("Add at least one participant.");
    if (participantIds.filter((id) => !id).length !== 1) {
      throw new Error("A shared bill must include your share exactly once.");
    }
    const friendIds = participantIds.filter((id): id is string => Boolean(id));
    await validateFriendIds(profileId, friendIds);
    const shares = calculateShares(transaction.amount, participantCount, mode, exactShares, percentHundredths);
    const meIndex = participantIds.findIndex((id) => !id);
    const titleText = title.trim();
    if (!titleText) throw new Error("Shared bill title is required.");

    const timestamp = now();
    const billId = crypto.randomUUID();
    await db.sharedBills.add({
      id: billId,
      profileId,
      transactionId,
      title: titleText,
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    await db.transactions.update(transactionId, {
      sharedBillId: billId,
      splitId: null,
      personalShareAmount: shares[meIndex],
      updatedAt: timestamp,
    });

    for (let index = 0; index < participantIds.length; index++) {
      const participantId = participantIds[index];
      const friend = participantId
        ? await getProfileRecord(db.friends, participantId, profileId)
        : undefined;
      await db.sharedBillMembers.add({
        id: crypto.randomUUID(),
        sharedBillId: billId,
        friendId: participantId || null,
        name: friend?.name || "Me",
        isMe: !participantId,
        amount: shares[index],
        paidAmount: !participantId ? shares[index] : 0,
        status: !participantId ? "paid" : "unpaid",
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
          note: titleText,
          expectedBy: expectedBy || null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    }
    return billId;
  }) as Promise<string>;
}

export async function updateSharedBillAmount(
  profileId: string,
  transactionId: string,
  totalAmount: number
): Promise<void> {
  if (!Number.isSafeInteger(totalAmount) || totalAmount <= 0) {
    throw new Error("Shared bill amount must be positive centavos.");
  }
  await db.transaction("rw", db.tables, async () => {
    const transaction = await getProfileRecord(db.transactions, transactionId, profileId);
    if (!transaction || transaction.type !== "expense" || transaction.deletedAt || transaction.cancelledAt) {
      throw new Error("Only an active expense can update a shared bill.");
    }
    if (!transaction.sharedBillId) throw new Error("This expense is not a shared bill.");
    const bill = await getProfileRecord(db.sharedBills, transaction.sharedBillId, profileId);
    if (!bill || bill.status !== "active") throw new Error("Shared bill not found.");
    const members = await db.sharedBillMembers.where("sharedBillId").equals(bill.id).toArray();
    if (members.filter((member) => member.isMe).length !== 1) {
      throw new Error("Shared bill must have exactly one personal share.");
    }
    const allocations = redistributeShares(
      totalAmount,
      members.map((member) => member.amount),
      members.map((member) => member.isMe ? 0 : member.paidAmount)
    );
    const timestamp = now();
    const oldReceivables = await activeSharedBillEntries(bill.id, ["shared_bill"]);
    await appendReversals(oldReceivables, "Shared bill amount edited", timestamp, {
      transactionId,
      sharedBillId: bill.id,
    });

    const me = members.find((member) => member.isMe)!;
    for (let index = 0; index < members.length; index++) {
      const member = members[index];
      if (!member) continue;
      const amount = allocations[index] || 0;
      await db.sharedBillMembers.update(member.id, {
        amount,
        paidAmount: member.isMe ? amount : member.paidAmount,
        status: member.isMe || member.paidAmount >= amount
          ? "paid"
          : member.paidAmount > 0 ? "partial" : "unpaid",
        updatedAt: timestamp,
      });
      if (member.friendId && amount > 0) {
        await db.friendLedger.add({
          id: crypto.randomUUID(),
          profileId,
          friendId: member.friendId,
          transactionId,
          sharedBillId: bill.id,
          type: "shared_bill",
          direction: "owed_to_me",
          amount,
          date: transaction.date,
          note: bill.title,
          expectedBy: member.expectedBy || null,
          createdAt: timestamp,
          updatedAt: timestamp,
        });
      }
    }
    await db.transactions.update(transaction.id, {
      amount: totalAmount,
      personalShareAmount: allocations[members.indexOf(me)],
      updatedAt: timestamp,
      editedAt: timestamp,
    });
  });
}

export async function reconfigureLocalSplit(
  profileId: string,
  transactionId: string,
  friendIds: string[],
  mode: "equal" | "exact" | "percent",
  exactShares: number[] = [],
  percentHundredths: number[] = [],
  expectedBy?: string,
  totalAmount?: number
): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const transaction = await getProfileRecord(db.transactions, transactionId, profileId);
    if (!transaction || transaction.type !== "expense" || transaction.deletedAt || transaction.cancelledAt) {
      throw new Error("Only an active expense can be re-split.");
    }
    if (!transaction.splitId) throw new Error("This expense is not split.");
    const split = await getProfileRecord(db.localSplits, transaction.splitId, profileId);
    if (!split || split.status !== "active") throw new Error("This split is no longer active.");
    await validateFriendIds(profileId, friendIds);
    const updatedAmount = totalAmount ?? transaction.amount;
    if (!Number.isInteger(updatedAmount) || updatedAmount <= 0) {
      throw new Error("Split amount must be positive centavos.");
    }
    const participantCount = friendIds.length + 1;
    const shares = calculateShares(updatedAmount, participantCount, mode, exactShares, percentHundredths);
    if (shares[0] <= 0) throw new Error("My share must be greater than zero.");
    const timestamp = now();
    await appendReversals(await localSplitEntries(transactionId), "Split amount edited", timestamp, { transactionId });
    const entries: FriendLedgerEntry[] = friendIds.flatMap((friendId, index) =>
      shares[index + 1] > 0 ? [{
        id: crypto.randomUUID(),
        profileId: transaction.profileId,
        friendId,
        transactionId,
        type: "expense_share" as const,
        direction: "owed_to_me" as const,
        amount: shares[index + 1],
        date: transaction.date,
        expectedBy: expectedBy || null,
        note: "Local split",
        createdAt: timestamp,
        updatedAt: timestamp,
      }] : []
    );
    if (entries.length) await db.friendLedger.bulkAdd(entries);
    await db.localSplits.update(split.id, { mode, friendIds, updatedAt: timestamp });
    await db.transactions.update(transactionId, {
      amount: updatedAmount,
      personalShareAmount: shares[0],
      updatedAt: timestamp,
      editedAt: timestamp,
    });
  });
}

export async function removeLocalSplit(profileId: string, transactionId: string): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const transaction = await getProfileRecord(db.transactions, transactionId, profileId);
    if (!transaction) throw new Error("Transaction not found.");
    const timestamp = now();
    await removeLocalSplitWithinTransaction(transaction, timestamp);
  });
}

export async function markSharedBillMemberPaid(
  profileId: string,
  sharedBillId: string,
  memberId: string,
  paidAmount: number,
  accountId?: string,
  note?: string
): Promise<void> {
  if (!Number.isInteger(paidAmount) || paidAmount <= 0) throw new Error("Paid amount must be positive centavos.");
  await db.transaction("rw", db.tables, async () => {
    const member = await db.sharedBillMembers.get(memberId);
    const bill = await getProfileRecord(db.sharedBills, sharedBillId, profileId);
    if (!member || !bill || member.sharedBillId !== sharedBillId || bill.status !== "active") {
      throw new Error("Participant not found.");
    }
    if (member.isMe || !member.friendId) throw new Error("Your own share cannot be marked as a repayment.");
    const remaining = member.amount - member.paidAmount;
    if (paidAmount > remaining) throw new Error("Payment cannot exceed the participant's outstanding share.");
    const friend = await getProfileRecord(db.friends, member.friendId, bill.profileId);
    if (!friend || friend.deletedAt) throw new Error("Participant friend not found.");
    const balanceEntries = await profileRecords(db.friendLedger, bill.profileId)
      .filter((entry) => entry.friendId === friend.id && !entry.deletedAt)
      .toArray();
    if (paidAmount > computeFriendBalance(balanceEntries)) {
      throw new Error("Payment cannot exceed this friend's outstanding balance.");
    }
    const nextPaidAmount = member.paidAmount + paidAmount;
    const status = nextPaidAmount >= member.amount ? "paid" : "partial";
    const timestamp = now();
    await db.sharedBillMembers.update(memberId, {
      paidAmount: nextPaidAmount,
      status,
      accountId: accountId || member.accountId || null,
      updatedAt: timestamp,
    });
    if (accountId) {
      const account = await getProfileRecord(db.accounts, accountId, bill.profileId);
      if (!account || account.deletedAt) throw new Error("Account not found.");
    }
    const paymentTransactionId = accountId ? crypto.randomUUID() : undefined;
    await db.friendLedger.add({
      id: crypto.randomUUID(),
      profileId: bill.profileId,
      friendId: friend.id,
      transactionId: paymentTransactionId,
      sharedBillId,
      sharedBillMemberId: member.id,
      type: "payment",
      direction: "you_owe",
      amount: paidAmount,
      date: timestamp.slice(0, 10),
      accountId: accountId || null,
      note: note?.trim() || "Shared bill payment",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    if (accountId && paymentTransactionId) {
      await db.transactions.add({
        id: paymentTransactionId,
        profileId: bill.profileId,
        type: "friend_payment",
        amount: paidAmount,
        accountId,
        toAccountId: null,
        categoryId: null,
        date: timestamp.slice(0, 10),
        note: `Payment from ${friend.name}`,
        friendPaymentDirection: "received",
        createdAt: timestamp,
        updatedAt: timestamp,
        tags: ["friend-payment"],
      } satisfies Transaction);
    }
  });
}
