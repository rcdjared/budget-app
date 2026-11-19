// Zod validation schemas — validate at the boundary (forms, imports, API).

import { z } from "zod";

// Reusable refinements
const centavos = z.number().int().min(0, "Amount must be positive");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}/, "Invalid date format");
const isoDateTime = z.string().datetime();

export const profileSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  currency: z.string().length(3, "Must be a 3-letter currency code"),
  isDefault: z.boolean(),
});

export const accountSchema = z.object({
  profileId: z.string().uuid(),
  name: z.string().min(1, "Account name is required").max(50),
  type: z.enum(["cash", "bank", "ewallet", "credit_card", "investment", "loan"]),
  openingBalance: z.number().int(), // Can be negative for credit cards
  currency: z.string().length(3).default("PHP"),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color"),
  icon: z.string().min(1),
  isArchived: z.boolean().default(false),
  // Credit card fields (optional)
  creditLimit: centavos.optional(),
  statementDay: z.number().int().min(1).max(31).optional(),
  dueDay: z.number().int().min(1).max(31).optional(),
});

export const categorySchema = z.object({
  profileId: z.string().uuid(),
  name: z.string().min(1, "Category name is required").max(50),
  parentId: z.string().uuid().nullable().optional(),
  type: z.enum(["expense", "income"]),
  icon: z.string().min(1),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  sortOrder: z.number().int().min(0),
});

export const transactionSchema = z
  .object({
    profileId: z.string().uuid(),
    type: z.enum(["expense", "income", "transfer"]),
    amount: centavos.refine((v) => v > 0, "Amount must be greater than 0"),
    accountId: z.string().uuid(),
    toAccountId: z.string().uuid().nullable().optional(),
    categoryId: z.string().uuid().nullable().optional(),
    date: isoDate,
    note: z.string().max(500).nullable().optional(),
    tags: z.array(z.string()).optional(),
    attachmentIds: z.array(z.string()).optional(),
    recurringId: z.string().uuid().nullable().optional(),
    debtId: z.string().uuid().nullable().optional(),
    splitGroupId: z.string().uuid().nullable().optional(),
  })
  .refine(
    (data) => {
      // Transfers must have a destination account
      if (data.type === "transfer" && !data.toAccountId) return false;
      return true;
    },
    { message: "Transfers must specify a destination account" }
  )
  .refine(
    (data) => {
      // Income/expense should have a category
      if (data.type !== "transfer" && !data.categoryId) return false;
      return true;
    },
    { message: "Income and expenses must have a category" }
  );

export const budgetSchema = z.object({
  profileId: z.string().uuid(),
  categoryId: z.string().uuid(),
  period: z.enum(["daily", "weekly", "biweekly", "monthly", "annual"]),
  amount: centavos.refine((v) => v > 0, "Budget must be greater than 0"),
  rolloverEnabled: z.boolean().default(false),
});

export const goalSchema = z.object({
  profileId: z.string().uuid(),
  name: z.string().min(1, "Goal name is required").max(100),
  targetAmount: centavos.refine((v) => v > 0, "Target must be greater than 0"),
  targetDate: isoDate,
  linkedAccountId: z.string().uuid().nullable().optional(),
});

export const debtSchema = z.object({
  profileId: z.string().uuid(),
  direction: z.enum(["i_owe", "owed_to_me"]),
  counterparty: z.string().min(1, "Name is required").max(100),
  principal: centavos.refine((v) => v > 0, "Amount must be greater than 0"),
  interestRate: z.number().min(0).max(100).nullable().optional(),
  dueDate: isoDate.nullable().optional(),
});

// Form-specific schemas (for the UI — amounts as strings that get parsed)
export const transactionFormSchema = z.object({
  type: z.enum(["expense", "income", "transfer"]),
  amount: z.string().min(1, "Enter an amount"),
  accountId: z.string().min(1, "Select an account"),
  toAccountId: z.string().optional(),
  categoryId: z.string().optional(),
  date: z.string().min(1),
  note: z.string().optional(),
});
