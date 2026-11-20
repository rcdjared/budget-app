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
  {
    name: "Food & Dining",
    icon: "utensils",
    color: "#F97316",
    type: "expense",
    children: [
      { name: "Groceries", icon: "shopping-cart", color: "#FB923C" },
      { name: "Restaurants & Fastfood", icon: "utensils", color: "#FDBA74" },
      { name: "Coffee & Milk Tea", icon: "coffee", color: "#C2410C" },
      { name: "Food Delivery", icon: "shopping-bag", color: "#EA580C" },
    ],
  },
  {
    name: "Transportation",
    icon: "car",
    color: "#3B82F6",
    type: "expense",
    children: [
      { name: "Gas & Fuel", icon: "fuel", color: "#60A5FA" },
      { name: "Commute & Jeep/MRT", icon: "bus", color: "#2563EB" },
      { name: "Grab & Taxi", icon: "car", color: "#1D4ED8" },
      { name: "Parking & Tolls", icon: "receipt", color: "#93C5FD" },
    ],
  },
  {
    name: "Bills & Utilities",
    icon: "zap",
    color: "#EAB308",
    type: "expense",
    children: [
      { name: "Electricity (Meralco)", icon: "zap", color: "#FACC15" },
      { name: "Water (Maynilad/Manila Water)", icon: "droplets", color: "#06B6D4" },
      { name: "Internet & WiFi", icon: "wifi", color: "#8B5CF6" },
      { name: "Mobile Load & Postpaid", icon: "smartphone", color: "#A855F7" },
    ],
  },
  {
    name: "Housing & Rent",
    icon: "home",
    color: "#78716C",
    type: "expense",
    children: [
      { name: "House Rent", icon: "building", color: "#A8A29E" },
      { name: "Condo/HOA Dues", icon: "receipt", color: "#78716C" },
      { name: "Home Repairs", icon: "wrench", color: "#57534E" },
    ],
  },
  {
    name: "Shopping",
    icon: "shopping-bag",
    color: "#EC4899",
    type: "expense",
    children: [
      { name: "Clothing & Shoes", icon: "shirt", color: "#F472B6" },
      { name: "Gadgets & Tech", icon: "laptop", color: "#DB2777" },
      { name: "Online Shopping (Shopee/Lazada)", icon: "shopping-bag", color: "#BE185D" },
    ],
  },
  {
    name: "Health & Wellness",
    icon: "heart-pulse",
    color: "#EF4444",
    type: "expense",
    children: [
      { name: "Medicine & Pharmacy", icon: "pill", color: "#F87171" },
      { name: "Doctor & Hospital", icon: "heart-pulse", color: "#DC2626" },
      { name: "Fitness & Gym", icon: "dumbbell", color: "#B91C1C" },
    ],
  },
  {
    name: "Entertainment & Leisure",
    icon: "gamepad-2",
    color: "#8B5CF6",
    type: "expense",
    children: [
      { name: "Streaming (Netflix/Spotify)", icon: "tv", color: "#A78BFA" },
      { name: "Games & Hobbies", icon: "gamepad-2", color: "#7C3AED" },
      { name: "Movies & Outings", icon: "film", color: "#6D28D9" },
    ],
  },
  {
    name: "Family & Padala",
    icon: "gift",
    color: "#14B8A6",
    type: "expense",
    children: [
      { name: "Padala / Support", icon: "banknote", color: "#2DD4BF" },
      { name: "Kids / School Allowance", icon: "baby", color: "#0D9488" },
      { name: "Pets & Vet", icon: "dog", color: "#0F766E" },
    ],
  },
  {
    name: "Education & Learning",
    icon: "graduation-cap",
    color: "#0EA5E9",
    type: "expense",
    children: [
      { name: "Tuition & Courses", icon: "graduation-cap", color: "#38BDF8" },
      { name: "Books & Materials", icon: "receipt", color: "#0284C7" },
    ],
  },
  {
    name: "Personal Care & Beauty",
    icon: "sparkles",
    color: "#F43F5E",
    type: "expense",
    children: [
      { name: "Haircut & Salon", icon: "scissors", color: "#FB7185" },
      { name: "Skincare & Toiletries", icon: "sparkles", color: "#E11D48" },
    ],
  },
  {
    name: "Travel & Vacation",
    icon: "plane",
    color: "#06B6D4",
    type: "expense",
  },
  {
    name: "Insurance & Financial",
    icon: "shield",
    color: "#475569",
    type: "expense",
    children: [
      { name: "Life/Health Insurance", icon: "shield", color: "#64748B" },
      { name: "Bank & ATM Fees", icon: "credit-card", color: "#334155" },
    ],
  },
  {
    name: "Gifts & Celebrations",
    icon: "gift",
    color: "#D946EF",
    type: "expense",
  },
  {
    name: "Others",
    icon: "more-horizontal",
    color: "#6B7280",
    type: "expense",
  },
];

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
