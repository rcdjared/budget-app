import { describe, expect, it } from "vitest";
import { sortTransactionsNewestFirst } from "@/domain/history";
import type { Transaction } from "@/domain/types";

function transaction(id: string, date: string, createdAt: string): Transaction {
  return {
    id,
    profileId: "profile-1",
    type: "expense",
    amount: 100,
    accountId: "account-1",
    date,
    createdAt,
    updatedAt: createdAt,
  };
}

describe("sortTransactionsNewestFirst", () => {
  it("orders by transaction date, then creation time, without mutating its input", () => {
    const transactions = [
      transaction("older", "2026-03-08", "2026-03-08T12:00:00.000Z"),
      transaction("same-day-earlier", "2026-03-09", "2026-03-09T08:00:00.000Z"),
      transaction("newest", "2026-03-10", "2026-03-10T12:00:00.000Z"),
      transaction("same-day-later", "2026-03-09", "2026-03-09T16:00:00.000Z"),
    ];

    const sorted = sortTransactionsNewestFirst(transactions);

    expect(sorted.map(({ id }) => id)).toEqual([
      "newest",
      "same-day-later",
      "same-day-earlier",
      "older",
    ]);
    expect(transactions[0].id).toBe("older");
  });
});
