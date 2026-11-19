// All entity types for PesoPulse.
// Money fields are always in integer centavos (×100).
// Every record has soft-delete support via deletedAt.

/** Common fields shared by all database records */
export interface BaseRecord {
  id: string;
  createdAt: string; // ISO 8601
  updatedAt: string;
  deletedAt?: string | null;
}

/** A data silo — Personal, Family, Business, etc. */
export interface Profile extends BaseRecord {
  name: string;
  currency: string; // ISO 4217, default "PHP"
  isDefault: boolean;
}

/** Where money lives */
export type AccountType =
  | "cash"
  | "bank"
  | "ewallet"
  | "credit_card"
  | "investment"
  | "loan";

export interface Account extends BaseRecord {
  profileId: string;
  name: string;
  type: AccountType;
  openingBalance: number; // centavos
  currency: string;
  color: string; // hex
  icon: string; // lucide icon name
  isArchived: boolean;
  // Credit card specific
  creditLimit?: number; // centavos
  statementDay?: number; // 1–31
  dueDay?: number; // 1–31
}

/** Spending/earning category */
export type CategoryType = "expense" | "income";

export interface Category extends BaseRecord {
  profileId: string;
  name: string;
  parentId?: string | null;
  type: CategoryType;
  icon: string;
  color: string;
  sortOrder: number;
}

/** A single money event */
export type TransactionType = "expense" | "income" | "transfer";

export interface Transaction extends BaseRecord {
  profileId: string;
  type: TransactionType;
  amount: number; // centavos, always positive
  accountId: string;
  toAccountId?: string | null; // only for transfers
  categoryId?: string | null; // null for transfers
  date: string; // ISO 8601 date string
  note?: string | null;
  tags?: string[];
  attachmentIds?: string[];
  recurringId?: string | null;
  debtId?: string | null;
  splitGroupId?: string | null;
}

/** Monthly spending cap per category */
export interface Budget extends BaseRecord {
  profileId: string;
  categoryId: string;
  period: "daily" | "weekly" | "biweekly" | "monthly" | "annual";
  amount: number; // centavos
  rolloverEnabled: boolean;
}

/** Savings target */
export interface Goal extends BaseRecord {
  profileId: string;
  name: string;
  targetAmount: number; // centavos
  targetDate: string; // ISO 8601
  linkedAccountId?: string | null;
}

/** Money owed in either direction */
export type DebtDirection = "i_owe" | "owed_to_me";

export interface Debt extends BaseRecord {
  profileId: string;
  direction: DebtDirection;
  counterparty: string;
  principal: number; // centavos
  interestRate?: number | null; // annual %, e.g. 12.5
  dueDate?: string | null;
}

/** Repeating transaction template */
export type RecurringFrequency =
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "custom";

export type RecurringKind = "bill" | "subscription" | "installment";

export interface Recurring extends BaseRecord {
  profileId: string;
  // Template fields — copied to created transactions
  amount: number;
  categoryId?: string | null;
  accountId: string;
  note?: string | null;
  transactionType: TransactionType;
  // Recurrence rule
  frequency: RecurringFrequency;
  customIntervalDays?: number | null;
  startDate: string;
  endDate?: string | null;
  nextDueDate: string;
  remindDaysBefore?: number | null;
  kind: RecurringKind;
  installmentsTotal?: number | null;
  installmentsPaid?: number | null;
}

/** Investment holding */
export type AssetType = "us_stock" | "crypto";

export interface Holding extends BaseRecord {
  accountId: string;
  assetType: AssetType;
  symbol: string;
  quantity: number; // can be fractional
  costBasis: number; // centavos
}

/** Cached market price */
export interface PriceCache {
  symbol: string;
  price: number; // in source currency (USD for stocks, USD for crypto)
  currency: string;
  fetchedAt: string;
}

/** Quick note with optional reminder */
export interface QuickNote extends BaseRecord {
  profileId: string;
  text: string;
  reminderAt?: string | null;
}

/** Bill split group */
export interface SplitGroup extends BaseRecord {
  profileId: string;
  name: string;
  totalAmount: number; // centavos
  transactionId?: string | null;
}

/** Member of a split group */
export interface SplitMember extends BaseRecord {
  splitGroupId: string;
  name: string;
  amount: number; // centavos
  isPaid: boolean;
}

/** Gamification tracking */
export interface Streak extends BaseRecord {
  profileId: string;
  lastLogDate: string;
  currentStreak: number;
  longestStreak: number;
  unlockedBadges: string[];
}

/** Photo/file attached to a transaction */
export interface Attachment extends BaseRecord {
  transactionId: string;
  blob?: Blob | null; // local storage
  storagePath?: string | null; // remote (Supabase)
}

/** Sync outbox entry */
export type OutboxOp = "create" | "update" | "delete";
export type OutboxStatus = "pending" | "syncing" | "synced" | "failed";

export interface OutboxEntry extends BaseRecord {
  table: string;
  recordId: string;
  op: OutboxOp;
  payload: string; // JSON
  status: OutboxStatus;
}

/** App settings (per-device or per-profile) */
export interface Settings {
  id: string;
  profileId?: string | null;
  key: string;
  value: string; // JSON-serialized
}
