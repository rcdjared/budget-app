import type { FriendLedgerEntry } from "./types";

export function computeFriendBalance(entries: readonly FriendLedgerEntry[], friendId?: string): number {
  return entries.reduce((balance, entry) => {
    if (entry.deletedAt || (friendId && entry.friendId !== friendId)) return balance;
    return balance + (entry.direction === "owed_to_me" ? entry.amount : -entry.amount);
  }, 0);
}
