// Seed data: default categories and PH bank/e-wallet templates.
// Run once when a new profile is created.

import { db } from "./schema";
import type { Category } from "@/domain/types";
import { ensureDefaultProfile } from "./repositories/profiles";

/** Generate a UUID (works in all modern browsers and Node 19+) */
function uid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

export interface CategorySeed {
  name: string;
  icon: string;
  color: string;
  type: "expense" | "income";
  children?: Omit<CategorySeed, "type" | "children">[];
}

export const EXPENSE_CATEGORIES: CategorySeed[] = [
  { name: "Shopping", icon: "shopping-bag", color: "#EC4899", type: "expense" },
  { name: "Food", icon: "utensils", color: "#F97316", type: "expense" },
  { name: "Transport", icon: "car", color: "#3B82F6", type: "expense" },
  { name: "Phone", icon: "smartphone", color: "#8B5CF6", type: "expense" },
  { name: "Bills", icon: "receipt", color: "#EAB308", type: "expense" },
  { name: "Fun", icon: "gamepad-2", color: "#14B8A6", type: "expense" },
  { name: "Health", icon: "heart-pulse", color: "#EF4444", type: "expense" },
  { name: "Fees", icon: "credit-card", color: "#64748B", type: "expense" },
];

// Names from the older, detailed starter set. Keep those records for history,
// but don't offer them as choices in new expense forms.
export const LEGACY_EXPENSE_CATEGORY_NAMES = new Set([
  "Food & Dining", "Groceries", "Restaurants & Fastfood", "Coffee & Milk Tea", "Food Delivery",
  "Transportation", "Gas & Fuel", "Commute & Jeep/MRT", "Grab & Taxi", "Parking & Tolls",
  "Bills & Utilities", "Electricity (Meralco)", "Water (Maynilad/Manila Water)", "Internet & WiFi", "Mobile Load & Postpaid",
  "Housing & Rent", "House Rent", "Condo/HOA Dues", "Home Repairs",
  "Clothing & Shoes", "Gadgets & Tech", "Online Shopping (Shopee/Lazada)",
  "Health & Wellness", "Medicine & Pharmacy", "Doctor & Hospital", "Fitness & Gym",
  "Entertainment & Leisure", "Streaming (Netflix/Spotify)", "Games & Hobbies", "Movies & Outings",
  "Family & Padala", "Padala / Support", "Kids / School Allowance", "Pets & Vet",
  "Education & Learning", "Tuition & Courses", "Books & Materials",
  "Personal Care & Beauty", "Haircut & Salon", "Skincare & Toiletries", "Travel & Vacation",
  "Insurance & Financial", "Life/Health Insurance", "Bank & ATM Fees", "Gifts & Celebrations", "Others",
]);

const LEGACY_EXPENSE_CATEGORY_TARGETS: Record<string, string> = {
  "Food & Dining": "Food", Groceries: "Food", "Restaurants & Fastfood": "Food", "Coffee & Milk Tea": "Food", "Food Delivery": "Food",
  Transportation: "Transport", "Gas & Fuel": "Transport", "Commute & Jeep/MRT": "Transport", "Grab & Taxi": "Transport", "Parking & Tolls": "Transport",
  "Bills & Utilities": "Bills", "Electricity (Meralco)": "Bills", "Water (Maynilad/Manila Water)": "Bills", "Internet & WiFi": "Bills", "Mobile Load & Postpaid": "Phone",
  "Housing & Rent": "Bills", "House Rent": "Bills", "Condo/HOA Dues": "Bills", "Home Repairs": "Bills",
  "Clothing & Shoes": "Shopping", "Gadgets & Tech": "Shopping", "Online Shopping (Shopee/Lazada)": "Shopping",
  "Health & Wellness": "Health", "Medicine & Pharmacy": "Health", "Doctor & Hospital": "Health", "Fitness & Gym": "Health",
  "Entertainment & Leisure": "Fun", "Streaming (Netflix/Spotify)": "Fun", "Games & Hobbies": "Fun", "Movies & Outings": "Fun",
  "Family & Padala": "Bills", "Padala / Support": "Bills", "Kids / School Allowance": "Bills", "Pets & Vet": "Health",
  "Education & Learning": "Bills", "Tuition & Courses": "Bills", "Books & Materials": "Shopping",
  "Personal Care & Beauty": "Shopping", "Haircut & Salon": "Shopping", "Skincare & Toiletries": "Shopping", "Travel & Vacation": "Fun",
  "Insurance & Financial": "Fees", "Life/Health Insurance": "Health", "Bank & ATM Fees": "Fees", "Gifts & Celebrations": "Fun", Others: "Shopping",
};

export const INCOME_CATEGORIES: CategorySeed[] = [
  {
    name: "Salary",
    icon: "banknote",
    color: "#10B981",
    type: "income",
    children: [
      { name: "Monthly Cutoff", icon: "banknote", color: "#34D399" },
      { name: "13th Month & Bonus", icon: "sparkles", color: "#059669" },
    ],
  },
  {
    name: "Freelance & Side Gig",
    icon: "laptop",
    color: "#14B8A6",
    type: "income",
  },
  {
    name: "Business & Sales",
    icon: "briefcase",
    color: "#059669",
    type: "income",
  },
  {
    name: "Investments & Dividends",
    icon: "trending-up",
    color: "#0D9488",
    type: "income",
  },
  {
    name: "Rental Income",
    icon: "building",
    color: "#0284C7",
    type: "income",
  },
  {
    name: "Remittance & Padala Received",
    icon: "gift",
    color: "#6366F1",
    type: "income",
  },
  {
    name: "Gifts & Cashbacks",
    icon: "gift",
    color: "#8B5CF6",
    type: "income",
  },
  {
    name: "Other Income",
    icon: "more-horizontal",
    color: "#6B7280",
    type: "income",
  },
];

/**
 * Seed default categories for a profile.
 * Idempotent — checks if categories already exist.
 */
export async function seedDefaultCategories(profileId: string): Promise<void> {
  await db.transaction("rw", db.categories, db.settings, async () => {
    const seedVersionId = `category-seed-v2:${profileId}`;
    if ((await db.settings.get(seedVersionId))?.value === "done") return;

    const existingCategories = await db.categories.where({ profileId }).filter((category) => !category.deletedAt).toArray();
    const hasLegacyExpenseDefaults = existingCategories.some(
      (category) => category.type === "expense" && LEGACY_EXPENSE_CATEGORY_NAMES.has(category.name)
    );
    if (existingCategories.length > 0 && !hasLegacyExpenseDefaults) return;
    const isLegacyUpgrade = existingCategories.length > 0;

    const existingNames = new Set(existingCategories.map((category) => category.name.trim().toLowerCase()));

    const timestamp = now();
    const categories: Category[] = [];
    let sortOrder = 0;

    const seedGroups = isLegacyUpgrade ? [EXPENSE_CATEGORIES] : [EXPENSE_CATEGORIES, INCOME_CATEGORIES];
    for (const seeds of seedGroups) {
      for (const seed of seeds) {
        if (existingNames.has(seed.name.toLowerCase())) continue;
        const parentId = uid();
        categories.push({
          id: parentId,
          profileId,
          name: seed.name,
          parentId: null,
          type: seed.type,
          icon: seed.icon,
          color: seed.color,
          sortOrder: sortOrder++,
          createdAt: timestamp,
          updatedAt: timestamp,
        });

        if (seed.children) {
          for (const child of seed.children) {
            if (existingNames.has(child.name.toLowerCase())) continue;
            categories.push({
              id: uid(),
              profileId,
              name: child.name,
              parentId,
              type: seed.type,
              icon: child.icon,
              color: child.color,
              sortOrder: sortOrder++,
              createdAt: timestamp,
              updatedAt: timestamp,
            });
          }
        }
      }
    }

    if (categories.length) await db.categories.bulkAdd(categories);
    await db.settings.put({ id: seedVersionId, profileId, key: seedVersionId, value: "done" });
  });
  await migrateLegacyExpenseCategories(profileId);
}

/** Move old starter-category links to the simple defaults without deleting ledger history. */
export async function migrateLegacyExpenseCategories(profileId: string): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const allCategories = await db.categories.where({ profileId }).toArray();
    const activeCategories = allCategories.filter((category) => !category.deletedAt);
    const currentByName = new Map<string, Category>();
    for (const category of activeCategories) {
      if (category.type !== "expense") continue;
      const name = category.name.trim().toLowerCase();
      if (!currentByName.has(name)) currentByName.set(name, category);
    }

    const categoryIdMap = new Map<string, string>();
    const legacyCategories = allCategories.filter(
      (category) => category.type === "expense" && LEGACY_EXPENSE_CATEGORY_NAMES.has(category.name)
    );
    for (const legacy of legacyCategories) {
      const targetName = LEGACY_EXPENSE_CATEGORY_TARGETS[legacy.name];
      const target = targetName ? currentByName.get(targetName.toLowerCase()) : undefined;
      if (target && target.id !== legacy.id) categoryIdMap.set(legacy.id, target.id);
    }
    if (!categoryIdMap.size) return;

    const timestamp = now();
    const transactions = await db.transactions.where({ profileId }).toArray();
    for (const transaction of transactions) {
      const targetId = transaction.categoryId ? categoryIdMap.get(transaction.categoryId) : undefined;
      if (targetId) await db.transactions.update(transaction.id, { categoryId: targetId, updatedAt: timestamp });
    }

    const recurringRules = await db.recurring.where({ profileId }).toArray();
    for (const rule of recurringRules) {
      const targetId = rule.categoryId ? categoryIdMap.get(rule.categoryId) : undefined;
      if (targetId) await db.recurring.update(rule.id, { categoryId: targetId, updatedAt: timestamp });
    }

    const activeBudgets = await db.budgets.where({ profileId }).filter((budget) => !budget.deletedAt).toArray();
    const budgetTargetsWithLegacyRules = new Set(
      activeBudgets.map((budget) => categoryIdMap.get(budget.categoryId)).filter((id): id is string => Boolean(id))
    );
    const budgetGroups = new Map<string, typeof activeBudgets>();
    for (const budget of activeBudgets) {
      const targetId = categoryIdMap.get(budget.categoryId) || budget.categoryId;
      if (!categoryIdMap.has(budget.categoryId) && !budgetTargetsWithLegacyRules.has(targetId)) continue;
      const key = `${targetId}:${budget.period}`;
      const group = budgetGroups.get(key) || [];
      group.push(budget);
      budgetGroups.set(key, group);
    }
    for (const [key, group] of budgetGroups) {
      const targetId = key.slice(0, key.lastIndexOf(":"));
      const keeper = group.find((budget) => budget.categoryId === targetId) || group[0];
      if (!keeper) continue;
      const amount = group.reduce((total, budget) => total + budget.amount, 0);
      const rolloverEnabled = group.some((budget) => budget.rolloverEnabled);
      await db.budgets.update(keeper.id, { categoryId: targetId, amount, rolloverEnabled, updatedAt: timestamp });
      for (const budget of group) {
        if (budget.id === keeper.id) continue;
        await db.budgets.update(budget.id, { deletedAt: timestamp, updatedAt: timestamp });
      }
    }

    const legacyIds = new Set(legacyCategories.map((category) => category.id));
    for (const category of activeCategories) {
      if (category.parentId && legacyIds.has(category.parentId) && !LEGACY_EXPENSE_CATEGORY_NAMES.has(category.name)) {
        await db.categories.update(category.id, { parentId: null, updatedAt: timestamp });
      }
    }
    for (const legacy of legacyCategories) {
      if (!legacy.deletedAt && categoryIdMap.has(legacy.id)) {
        await db.categories.update(legacy.id, { deletedAt: timestamp, updatedAt: timestamp });
      }
    }
  });
}

/** PH bank/e-wallet templates for quick account creation */
export interface AccountTemplate {
  name: string;
  type: "bank" | "ewallet" | "cash";
  color: string;
  icon: string;
  logo: string;
}

export const ACCOUNT_TEMPLATES: AccountTemplate[] = [
  // Major banks
  { name: "BDO", type: "bank", color: "#003B73", icon: "landmark", logo: "bdo.png" },
  { name: "BPI", type: "bank", color: "#C41E3A", icon: "landmark", logo: "bpi.png" },
  { name: "Metrobank", type: "bank", color: "#003366", icon: "landmark", logo: "metrobank.png" },
  { name: "UnionBank", type: "bank", color: "#F7941D", icon: "landmark", logo: "unionbank.png" },
  { name: "LandBank", type: "bank", color: "#006633", icon: "landmark", logo: "landbank.png" },
  { name: "RCBC", type: "bank", color: "#00529B", icon: "landmark", logo: "rcbc.png" },
  { name: "Security Bank", type: "bank", color: "#00A651", icon: "landmark", logo: "securitybank.png" },
  { name: "PNB", type: "bank", color: "#001489", icon: "landmark", logo: "pnb.png" },
  { name: "EastWest Bank", type: "bank", color: "#C41230", icon: "landmark", logo: "eastwest.png" },
  { name: "China Bank", type: "bank", color: "#00529B", icon: "landmark", logo: "chinabank.png" },
  { name: "China Bank Savings", type: "bank", color: "#0072BC", icon: "landmark", logo: "chinabanksavings.png" },
  { name: "Bank of Commerce", type: "bank", color: "#173A70", icon: "landmark", logo: "bankofcommerce.png" },
  { name: "DBP", type: "bank", color: "#006B3F", icon: "landmark", logo: "dbp.png" },
  { name: "PSBank", type: "bank", color: "#BE1E2D", icon: "landmark", logo: "psbank.png" },
  { name: "AUB", type: "bank", color: "#0054A6", icon: "landmark", logo: "aub.png" },
  { name: "Maybank", type: "bank", color: "#F7C600", icon: "landmark", logo: "maybank.png" },
  // Digital banks
  { name: "GoTyme Bank", type: "bank", color: "#FF5733", icon: "smartphone", logo: "gotyme.png" },
  { name: "MariBank", type: "bank", color: "#F15A24", icon: "smartphone", logo: "maribank.png" },
  { name: "Tonik", type: "bank", color: "#6C63FF", icon: "smartphone", logo: "tonik.png" },
  { name: "CIMB", type: "bank", color: "#ED1C24", icon: "smartphone", logo: "cimb.png" },
  { name: "Maya Bank", type: "bank", color: "#00C853", icon: "smartphone", logo: "mayabank.png" },
  // E-wallets and payment platforms
  { name: "GCash", type: "ewallet", color: "#007DFE", icon: "wallet", logo: "gcash.png" },
  { name: "Maya", type: "ewallet", color: "#00C853", icon: "wallet", logo: "maya.png" },
  { name: "PayPal", type: "ewallet", color: "#003087", icon: "wallet", logo: "paypal.png" },
  { name: "ShopeePay", type: "ewallet", color: "#EE4D2D", icon: "wallet", logo: "shopeepay.png" },
  { name: "GrabPay", type: "ewallet", color: "#00B14F", icon: "wallet", logo: "grabpay.png" },
  { name: "Coins.ph", type: "ewallet", color: "#2B55CC", icon: "wallet", logo: "coinsph.png" },
  // Cash
  { name: "Cash / Wallet", type: "cash", color: "#10B981", icon: "banknote", logo: "" },
];

export function getAccountTemplates(): AccountTemplate[] {
  return ACCOUNT_TEMPLATES;
}

export async function initializeAppData(): Promise<string> {
  const profile = await ensureDefaultProfile();
  await seedDefaultCategories(profile.id);
  return profile.id;
}
