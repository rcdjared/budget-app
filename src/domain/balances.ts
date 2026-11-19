// Derived balance computations.
// The golden rule: balances are NEVER stored — they're always
// recomputed from the opening balance + transaction ledger.

import type { Account, Transaction } from "./types";

/**
 * Compute the current balance of a single account from its transactions.
 *
 * Balance = openingBalance
 *   + SUM(income TO this account)
 *   - SUM(expenses FROM this account)
 *   + SUM(transfers IN to this account)
 *   - SUM(transfers OUT from this account)
 *
 * For credit cards, the openingBalance represents the initial amount owed.
 * A positive balance on a credit card means you owe money.
 */
export function computeAccountBalance(
  accountId: string,
  openingBalance: number,
  transactions: Transaction[]
): number {
  let balance = openingBalance;

  for (const tx of transactions) {
    // Skip soft-deleted transactions
    if (tx.deletedAt) continue;

    switch (tx.type) {
      case "income":
        if (tx.accountId === accountId) {
          balance += tx.amount;
        }
        break;

      case "expense":
        if (tx.accountId === accountId) {
          balance -= tx.amount;
        }
        break;

      case "transfer":
        // Money leaves the source account
        if (tx.accountId === accountId) {
          balance -= tx.amount;
        }
        // Money arrives at the destination account
        if (tx.toAccountId === accountId) {
          balance += tx.amount;
        }
        break;
    }
  }

  return balance;
}

/**
 * Compute net worth from all accounts and their balances.
 *
 * Assets: cash, bank, e-wallet, investment (positive balances)
 * Liabilities: credit_card and loan balances (shown as positive = you owe)
 *
 * For credit cards: a negative computed balance means you owe that amount,
 * so we flip the sign for the liabilities total.
 */
export function computeNetWorth(
  accounts: Account[],
  balances: Map<string, number>
): { assets: number; liabilities: number; netWorth: number } {
  let assets = 0;
  let liabilities = 0;

  for (const account of accounts) {
    if (account.isArchived || account.deletedAt) continue;

    const balance = balances.get(account.id) ?? account.openingBalance;

    if (account.type === "credit_card" || account.type === "loan") {
      // For credit cards/loans, a negative balance = you owe money
      // We show liabilities as a positive number
      liabilities += Math.abs(Math.min(0, balance));
      // If you've overpaid (positive balance), it's an asset
      if (balance > 0) assets += balance;
    } else {
      // Cash, bank, e-wallet, investment — positive = asset
      if (balance > 0) assets += balance;
      // Negative bank balance (overdraft) is a liability
      if (balance < 0) liabilities += Math.abs(balance);
    }
  }

  return {
    assets,
    liabilities,
    netWorth: assets - liabilities,
  };
}

/**
 * Available credit on a credit card.
 * creditLimit and balance are both in centavos.
 * balance is the computed balance (negative = you owe).
 */
export function getCreditCardAvailable(
  creditLimit: number,
  balance: number
): number {
  // balance is negative when you owe money
  // available = limit - amount_owed = limit + balance (since balance is negative)
  return creditLimit + balance;
}

/**
 * Compute monthly income and expense totals for a profile in a date range.
 */
export function computeMonthlyTotals(
  transactions: Transaction[],
  startDate: string,
  endDate: string
): { income: number; expenses: number } {
  let income = 0;
  let expenses = 0;

  for (const tx of transactions) {
    if (tx.deletedAt) continue;
    if (tx.date < startDate || tx.date > endDate) continue;

    // Transfers don't count as income or expense
    if (tx.type === "income") income += tx.amount;
    if (tx.type === "expense") expenses += tx.amount;
  }

  return { income, expenses };
}

