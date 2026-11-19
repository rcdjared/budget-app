// Seed data: default categories and PH bank/e-wallet templates.
// Run once when a new profile is created.

import { db } from "./schema";
import type { Account, Category } from "@/domain/types";
import { ensureDefaultProfile } from "./repositories/profiles";

/** Generate a UUID (works in all modern browsers and Node 19+) */
function uid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

interface CategorySeed {
  name: string;
  icon: string;
  color: string;
  type: "expense" | "income";
  children?: Omit<CategorySeed, "type" | "children">[];
}

const EXPENSE_CATEGORIES: CategorySeed[] = [
  {
    name: "Food & Dining",
    icon: "utensils",
    color: "#F97316",
    type: "expense",
    children: [
      { name: "Groceries", icon: "shopping-cart", color: "#FB923C" },
      { name: "Restaurants", icon: "chef-hat", color: "#FDBA74" },
      { name: "Coffee", icon: "coffee", color: "#C2410C" },
    ],
  },
  {
    name: "Transportation",
    icon: "car",
    color: "#3B82F6",
    type: "expense",
    children: [
      { name: "Gas", icon: "fuel", color: "#60A5FA" },
      { name: "Parking", icon: "parking-meter", color: "#93C5FD" },
      { name: "Grab / Taxi", icon: "map-pin", color: "#2563EB" },
      { name: "Public Transit", icon: "bus", color: "#1D4ED8" },
    ],
  },
  {
    name: "Shopping",
    icon: "shopping-bag",
    color: "#EC4899",
    type: "expense",
  },
  {
    name: "Bills & Utilities",
    icon: "zap",
    color: "#EAB308",
    type: "expense",
    children: [
      { name: "Electricity", icon: "lightbulb", color: "#FACC15" },
      { name: "Water", icon: "droplets", color: "#06B6D4" },
      { name: "Internet", icon: "wifi", color: "#8B5CF6" },
      { name: "Phone / Mobile", icon: "smartphone", color: "#A855F7" },
    ],
  },
  { name: "Health", icon: "heart-pulse", color: "#EF4444", type: "expense" },
  { name: "Entertainment", icon: "gamepad-2", color: "#8B5CF6", type: "expense" },
  { name: "Education", icon: "graduation-cap", color: "#0EA5E9", type: "expense" },
  { name: "Personal Care", icon: "sparkles", color: "#F472B6", type: "expense" },
  { name: "Home", icon: "home", color: "#78716C", type: "expense" },
  {
    name: "Gifts & Donations",
    icon: "gift",
    color: "#D946EF",
    type: "expense",
  },
  { name: "Others", icon: "more-horizontal", color: "#6B7280", type: "expense" },
];

const INCOME_CATEGORIES: CategorySeed[] = [
  { name: "Salary", icon: "banknote", color: "#10B981", type: "income" },
  { name: "Freelance", icon: "laptop", color: "#14B8A6", type: "income" },
  { name: "Business", icon: "briefcase", color: "#059669", type: "income" },
  {
    name: "Investment Returns",
    icon: "trending-up",
    color: "#0D9488",
    type: "income",
  },
  { name: "Gifts Received", icon: "gift", color: "#6366F1", type: "income" },
  { name: "Others", icon: "more-horizontal", color: "#6B7280", type: "income" },
];

/**
 * Seed default categories for a new profile.
 * Idempotent — checks if categories already exist.
 */
export async function seedDefaultCategories(profileId: string): Promise<void> {
  const existing = await db.categories.where({ profileId }).count();
  if (existing > 0) return; // Already seeded

  const timestamp = now();
  const categories: Category[] = [];
  let sortOrder = 0;

  for (const seeds of [EXPENSE_CATEGORIES, INCOME_CATEGORIES]) {
    for (const seed of seeds) {
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

  await db.categories.bulkAdd(categories);
}

/** PH bank/e-wallet templates for quick account creation */
export interface AccountTemplate {
  name: string;
  type: "bank" | "ewallet" | "cash";
  color: string;
  icon: string;
}

export const ACCOUNT_TEMPLATES: AccountTemplate[] = [
  // Major banks
  { name: "BDO", type: "bank", color: "#003B73", icon: "landmark" },
  { name: "BPI", type: "bank", color: "#C41E3A", icon: "landmark" },
  { name: "Metrobank", type: "bank", color: "#003366", icon: "landmark" },
  { name: "UnionBank", type: "bank", color: "#F7941D", icon: "landmark" },
  { name: "Landbank", type: "bank", color: "#006633", icon: "landmark" },
  { name: "PNB", type: "bank", color: "#001489", icon: "landmark" },
  { name: "RCBC", type: "bank", color: "#00529B", icon: "landmark" },
  { name: "Security Bank", type: "bank", color: "#00A651", icon: "landmark" },
  // Digital banks
  { name: "GoTyme", type: "bank", color: "#FF5733", icon: "smartphone" },
  { name: "SeaBank", type: "bank", color: "#00BFA5", icon: "smartphone" },
  { name: "Tonik", type: "bank", color: "#6C63FF", icon: "smartphone" },
  { name: "CIMB", type: "bank", color: "#ED1C24", icon: "smartphone" },
  { name: "Maya Bank", type: "bank", color: "#00C853", icon: "smartphone" },
  // E-wallets
  { name: "GCash", type: "ewallet", color: "#007DFE", icon: "wallet" },
  { name: "Maya", type: "ewallet", color: "#00C853", icon: "wallet" },
  { name: "ShopeePay", type: "ewallet", color: "#EE4D2D", icon: "wallet" },
  { name: "GrabPay", type: "ewallet", color: "#00B14F", icon: "wallet" },
  // Cash
  { name: "Cash / Wallet", type: "cash", color: "#10B981", icon: "banknote" },
];

export function getAccountTemplates(): AccountTemplate[] {
  return ACCOUNT_TEMPLATES;
}

/** Initialize first-run data. Safe to call repeatedly. */
export async function initializeAppData(): Promise<string> {
  const profile = await ensureDefaultProfile();
  await seedDefaultCategories(profile.id);

  const accountCount = await db.accounts.where({ profileId: profile.id }).count();
  if (accountCount === 0) {
    const timestamp = now();
    const starterAccounts: Account[] = [
      {
        id: uid(),
        profileId: profile.id,
        name: "Cash",
        type: "cash",
        openingBalance: 500000,
        currency: "PHP",
        color: "#10B981",
        icon: "banknote",
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: uid(),
        profileId: profile.id,
        name: "GCash",
        type: "ewallet",
        openingBalance: 850000,
        currency: "PHP",
        color: "#007DFE",
        icon: "wallet",
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      {
        id: uid(),
        profileId: profile.id,
        name: "BDO",
        type: "bank",
        openingBalance: 2500000,
        currency: "PHP",
        color: "#003B73",
        icon: "landmark",
        isArchived: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
    await db.accounts.bulkAdd(starterAccounts);
  }

  return profile.id;
}
