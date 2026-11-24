import { KUPI_CONFIG, type KupiAction } from "../contracts";
import type { Account, Category, Transaction } from "@/domain/types";

export interface KupiActionSnapshot {
  accounts: readonly Account[];
  categories: readonly Category[];
  txns: readonly Transaction[];
  now: Date;
}

export interface KupiActionValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function manilaDate(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Kupi action validation requires a valid date.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function addAmountWarning(
  amount: number,
  categoryId: string | null | undefined,
  type: "expense" | "income",
  profileId: string,
  txns: readonly Transaction[],
  excludeId?: string
): string[] {
  if (!categoryId) return [];
  const typicalAmounts = txns
    .filter((transaction) =>
      transaction.profileId === profileId
      && transaction.id !== excludeId
      && transaction.type === type
      && transaction.categoryId === categoryId
      && !transaction.deletedAt
      && !transaction.cancelledAt
      && Number.isSafeInteger(transaction.amount)
      && transaction.amount > 0
    )
    .map(({ amount: previousAmount }) => previousAmount);
  if (
    typicalAmounts.length >= 3
    && amount > median(typicalAmounts) * KUPI_CONFIG.actions.largeAmountMultiplier
  ) {
    return ["Amount is much higher than this category's recent transactions."];
  }
  return [];
}

function validateAccount(
  accountId: string | null | undefined,
  profileId: string,
  accounts: readonly Account[],
  label = "Account"
): string[] {
  if (!accountId) return [`${label} is required.`];
  const account = accounts.find(({ id }) => id === accountId);
  if (!account || account.profileId !== profileId || account.deletedAt || account.isArchived) {
    return [`${label} is not available in this profile.`];
  }
  return [];
}

function validateCategory(
  categoryId: string | null | undefined,
  type: "expense" | "income",
  profileId: string,
  categories: readonly Category[],
  label = "Category"
): string[] {
  if (!categoryId) return [];
  const category = categories.find(({ id }) => id === categoryId);
  if (!category || category.profileId !== profileId || category.deletedAt || category.type !== type) {
    return [`${label} is not available for this transaction type in this profile.`];
  }
  return [];
}

function validateMoneyAndDate(
  amount: number,
  date: string,
  now: Date
): string[] {
  const errors: string[] = [];
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    errors.push("Amount must be a positive whole number of centavos.");
  }
  if (!validDate(date)) {
    errors.push("Transaction date must be a valid YYYY-MM-DD date.");
  } else {
    const latestDate = new Date(`${manilaDate(now)}T00:00:00.000Z`);
    latestDate.setUTCDate(latestDate.getUTCDate() + KUPI_CONFIG.dialogue.futureDateMaxDays);
    if (date > latestDate.toISOString().slice(0, 10)) errors.push("Transaction date cannot be in the future.");
  }
  return errors;
}

function validateCreate(
  action: Extract<KupiAction, { kind: "create" }>,
  snapshot: KupiActionSnapshot
): KupiActionValidation {
  const transaction = action.after;
  const errors = [...validateMoneyAndDate(transaction.amount, transaction.date, snapshot.now)];
  if (transaction.type !== "expense" && transaction.type !== "income") {
    errors.push("Kupi can only create expense or income transactions through this action.");
  } else {
    errors.push(...validateAccount(transaction.accountId, action.profileId, snapshot.accounts));
    errors.push(...validateCategory(transaction.categoryId, transaction.type, action.profileId, snapshot.categories));
  }
  if (transaction.profileId !== action.profileId) errors.push("Transaction profile does not match the action profile.");
  const warnings = transaction.type === "expense" || transaction.type === "income"
    ? addAmountWarning(transaction.amount, transaction.categoryId, transaction.type, action.profileId, snapshot.txns)
    : [];
  return { valid: errors.length === 0, errors, warnings: [...action.warnings, ...warnings] };
}

function validateTransfer(
  action: Extract<KupiAction, { kind: "transfer" }>,
  snapshot: KupiActionSnapshot
): KupiActionValidation {
  const transfer = action.after;
  const errors = [...validateMoneyAndDate(transfer.amount, transfer.date, snapshot.now)];
  errors.push(...validateAccount(transfer.accountId, action.profileId, snapshot.accounts));
  if (transfer.toAccountId) {
    errors.push(...validateAccount(transfer.toAccountId, action.profileId, snapshot.accounts, "Destination account"));
    if (transfer.sourceType !== "my" || transfer.destinationType !== "my") {
      errors.push("An internal destination account is only valid for an account-to-account transfer.");
    }
  }
  if (transfer.sourceType === "external" && transfer.destinationType === "external") {
    errors.push("At least one side of a transfer must be one of your accounts.");
  }
  if (
    transfer.sourceType === "my"
    && transfer.destinationType === "my"
    && (!transfer.toAccountId || transfer.accountId === transfer.toAccountId)
  ) {
    errors.push("Choose two different accounts for an internal transfer.");
  }
  if (!Number.isSafeInteger(transfer.transferFee) || transfer.transferFee < 0) {
    errors.push("Transfer fee must be a non-negative whole number of centavos.");
  }
  if (transfer.sourceType === "external" && transfer.transferFee > 0) {
    errors.push("External transfers cannot include a transfer fee.");
  }
  if (transfer.transferFee > 0) {
    if (!transfer.feeCategoryId) errors.push("A category is required for the transfer fee.");
    else errors.push(...validateCategory(transfer.feeCategoryId, "expense", action.profileId, snapshot.categories, "Fee category"));
  }
  if (transfer.profileId !== action.profileId) errors.push("Transfer profile does not match the action profile.");
  return { valid: errors.length === 0, errors, warnings: [...action.warnings] };
}

function validateTarget(
  action: Extract<KupiAction, { kind: "update" | "delete" }>,
  snapshot: KupiActionSnapshot
): { current?: Transaction; errors: string[] } {
  const current = snapshot.txns.find(({ id }) => id === action.before.id);
  const errors: string[] = [];
  if (action.before.profileId !== action.profileId) {
    errors.push("Transaction profile does not match the action profile.");
  }
  if (!current || current.profileId !== action.profileId) {
    errors.push("Transaction is not available in this profile.");
    return { errors };
  }
  if (current.updatedAt !== action.before.updatedAt) errors.push("Transaction changed since this action was proposed.");
  if (current.deletedAt || current.cancelledAt) errors.push("Deleted or cancelled transactions cannot be changed by Kupi.");
  return { current, errors };
}

function validateUpdate(
  action: Extract<KupiAction, { kind: "update" }>,
  snapshot: KupiActionSnapshot
): KupiActionValidation {
  const { current, errors } = validateTarget(action, snapshot);
  const before = action.before;
  const after = action.after;
  const warnings: string[] = [...action.warnings];
  if (!current) return { valid: false, errors, warnings };
  if (before.type === "friend_payment" || before.splitId || before.sharedBillId) {
    errors.push("This linked transaction must be edited in its dedicated flow.");
  }
  if (after.id !== before.id || after.profileId !== action.profileId || after.type !== before.type) {
    errors.push("Kupi edits cannot change the transaction identity, profile, or type.");
  }
  if (after.type === "expense" || after.type === "income") {
    errors.push(...validateMoneyAndDate(after.amount, after.date, snapshot.now));
    errors.push(...validateAccount(after.accountId, action.profileId, snapshot.accounts));
    errors.push(...validateCategory(after.categoryId, after.type, action.profileId, snapshot.categories));
    warnings.push(...addAmountWarning(after.amount, after.categoryId, after.type, action.profileId, snapshot.txns, before.id));
  } else if (after.type === "transfer") {
    if (after.categoryId) errors.push("Transfer categories cannot be edited.");
    errors.push(...validateMoneyAndDate(after.amount, after.date, snapshot.now));
    errors.push(...validateAccount(after.accountId, action.profileId, snapshot.accounts));
    if (after.toAccountId) errors.push(...validateAccount(after.toAccountId, action.profileId, snapshot.accounts, "Destination account"));
    if (after.toAccountId === after.accountId) errors.push("Choose two different accounts for an internal transfer.");
  } else {
    errors.push("Kupi cannot edit this transaction type.");
  }
  return { valid: errors.length === 0, errors, warnings };
}

function validateDelete(
  action: Extract<KupiAction, { kind: "delete" }>,
  snapshot: KupiActionSnapshot
): KupiActionValidation {
  const { current, errors } = validateTarget(action, snapshot);
  if (current?.recurringId && current.occurrenceKey) {
    errors.push("Recurring occurrences must be deleted through their dedicated history action.");
  }
  return { valid: errors.length === 0, errors, warnings: [...action.warnings] };
}

export function validateAction(
  action: KupiAction,
  snapshot: KupiActionSnapshot
): KupiActionValidation {
  switch (action.kind) {
    case "create":
      return validateCreate(action, snapshot);
    case "transfer":
      return validateTransfer(action, snapshot);
    case "update":
      return validateUpdate(action, snapshot);
    case "delete":
      return validateDelete(action, snapshot);
  }
}
