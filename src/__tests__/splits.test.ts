import { describe, expect, it } from "vitest";
import { distributeEqualSplit, distributePercentSplit, validateExactShares } from "@/domain/splits";
import { computeMonthlyTotals } from "@/domain/balances";
import { computeAccountBalance } from "@/domain/balances";
import type { Transaction } from "@/domain/types";

describe("local split centavo rounding", () => {
  it("puts equal-share remainder centavos on me", () => {
    expect(distributeEqualSplit(120000, 3)).toEqual([40000, 40000, 40000]);
    expect(distributeEqualSplit(10001, 3)).toEqual([3334, 3334, 3333]);
  });

  it("requires exact shares to equal the original amount", () => {
    expect(validateExactShares(150000, [50000, 50000, 50000])).toBe(true);
    expect(validateExactShares(150000, [50000, 50000, 40000])).toBe(false);
  });

  it("distributes percentage shares without floats", () => {
    expect(distributePercentSplit(300000, [3333, 3333, 3334])).toEqual([99990, 99990, 100020]);
  });

  it("counts only personal share in monthly expense reports", () => {
    const base = {
      id: "tx",
      profileId: "profile",
      accountId: "account",
      categoryId: "food",
      date: "2026-11-22",
      createdAt: "2026-11-22T00:00:00.000Z",
      updatedAt: "2026-11-22T00:00:00.000Z",
      amount: 120000,
      type: "expense",
      personalShareAmount: 40000,
    } satisfies Transaction;
    expect(computeMonthlyTotals([base], "2026-11-01", "2026-11-30").expenses).toBe(40000);
  });

  it("cancelling a dinner restores the account and removes it from reports", () => {
    const expense = {
      id: "dinner",
      profileId: "profile",
      accountId: "account",
      date: "2026-11-22",
      createdAt: "2026-11-22T00:00:00.000Z",
      updatedAt: "2026-11-22T00:00:00.000Z",
      amount: 120000,
      type: "expense",
      cancelledAt: "2026-11-22T00:00:00.000Z",
    } satisfies Transaction;
    expect(computeAccountBalance("account", 500000, [expense])).toBe(500000);
    expect(computeMonthlyTotals([expense], "2026-11-01", "2026-11-30").expenses).toBe(0);
  });

  it("friend payments credit accounts without counting as income", () => {
    const payment = {
      id: "payment",
      profileId: "profile",
      accountId: "account",
      date: "2026-11-22",
      createdAt: "2026-11-22T00:00:00.000Z",
      updatedAt: "2026-11-22T00:00:00.000Z",
      amount: 40000,
      type: "friend_payment",
    } satisfies Transaction;
    expect(computeAccountBalance("account", 100000, [payment])).toBe(140000);
    expect(computeMonthlyTotals([payment], "2026-11-01", "2026-11-30")).toEqual({ income: 0, expenses: 0 });
  });
});
