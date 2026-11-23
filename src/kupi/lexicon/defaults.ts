export const DEFAULT_EXPENSE_CATEGORIES = [
  "Shopping", "Food", "Transport", "Phone", "Bills", "Fun", "Health", "Fees",
] as const;

export const DEFAULT_INCOME_CATEGORIES = [
  "Salary", "Freelance & Side Gig", "Business & Sales", "Investments & Dividends",
  "Rental Income", "Remittance & Padala Received", "Gifts & Cashbacks", "Other Income",
] as const;

export type DefaultExpenseCategory = (typeof DEFAULT_EXPENSE_CATEGORIES)[number];
export type DefaultIncomeCategory = (typeof DEFAULT_INCOME_CATEGORIES)[number];
export type DefaultCategory = DefaultExpenseCategory | DefaultIncomeCategory;

export interface MerchantCategoryAliases {
  category: DefaultExpenseCategory;
  aliases: readonly string[];
}

export interface IncomeCategoryAliases {
  category: DefaultIncomeCategory;
  aliases: readonly string[];
}

/** Defaults only; the resolver must verify the category against the active profile. */
export const MERCHANT_CATEGORY_ALIASES = [
  {
    category: "Food",
    aliases: [
      "coffee", "cafe", "lunch", "dinner", "breakfast", "snack", "meal", "food",
      "bottled water", "rice", "bread", "burger", "pizza", "restaurant", "grab food",
      "jollibee", "mcdo", "mcdonalds", "kfc", "mang inasal", "chowking", "greenwich",
      "starbucks", "bo's coffee", "coffee bean", "samgyup", "milk tea", "milktea", "boba",
      "grabfood", "foodpanda", "7-eleven", "7 eleven", "ministop", "family mart", "ulam",
      "baon", "grocery", "groceries", "supermarket", "puregold", "sm supermarket", "palengke",
      "landers", "robinsons supermarket", "tinapay", "kape",
    ],
  },
  {
    category: "Transport",
    aliases: [
      "grab", "angkas", "joyride", "jeep", "jeepney", "trike", "tricycle", "mrt", "lrt",
      "bus", "taxi", "pamasahe", "pasahe", "gas", "petron", "shell", "easytrip", "toll", "parking",
    ],
  },
  {
    category: "Bills",
    aliases: [
      "meralco", "maynilad", "manila water", "globe", "smart", "pldt", "converge", "rent",
      "electricity", "water bill", "internet bill",
    ],
  },
  { category: "Phone", aliases: ["mobile load", "load", "phone bill", "postpaid", "globe load"] },
  { category: "Shopping", aliases: ["shopee", "lazada", "uniqlo", "zalora", "shopping"] },
  { category: "Fun", aliases: ["netflix", "spotify", "steam", "cinema", "movies", "games", "hobbies"] },
  { category: "Health", aliases: ["mercury drug", "watsons", "gamot", "medicine", "pharmacy", "clinic", "doctor"] },
  { category: "Fees", aliases: ["atm fee", "bank fee", "service fee", "transfer fee"] },
] as const satisfies readonly MerchantCategoryAliases[];

export const INCOME_CATEGORY_ALIASES = [
  { category: "Salary", aliases: ["salary", "sahod", "sweldo", "13th month", "bonus", "paycheck"] },
  { category: "Freelance & Side Gig", aliases: ["freelance", "side gig", "side hustle"] },
  { category: "Business & Sales", aliases: ["business", "sales", "naibenta", "benta", "sold"] },
  { category: "Investments & Dividends", aliases: ["investment", "dividend", "dividends", "interest income"] },
  { category: "Rental Income", aliases: ["rental income", "rent income"] },
  { category: "Remittance & Padala Received", aliases: ["remittance", "padala"] },
  { category: "Gifts & Cashbacks", aliases: ["gift", "refund", "cashback", "aguinaldo", "bigay"] },
  { category: "Other Income", aliases: ["other income", "income", "received", "deposit", "allowance"] },
] as const satisfies readonly IncomeCategoryAliases[];

/** Aliases resolve only to a matching live account, never to a fabricated account. */
export const DEFAULT_ACCOUNT_ALIASES = {
  "Cash / Wallet": ["cash", "wallet", "pera", "bulsa"],
  GCash: ["gcash", "g cash", "gc"],
  "GoTyme Bank": ["gotyme", "go tyme"],
  MariBank: ["maribank", "mari bank"],
  Maya: ["maya", "paymaya"],
} as const satisfies Readonly<Record<string, readonly string[]>>;

export const TAGALOG_NUMBER_WORDS = {
  isa: 1,
  isang: 1,
  dalawa: 2,
  dalawang: 2,
  tatlo: 3,
  tatlong: 3,
  apat: 4,
  "apat na": 4,
  lima: 5,
  limang: 5,
  anim: 6,
  "anim na": 6,
  pito: 7,
  pitong: 7,
  walo: 8,
  walong: 8,
  siyam: 9,
  "siyam na": 9,
  sampu: 10,
  bente: 20,
  beinte: 20,
  dalawampu: 20,
  tatlumpu: 30,
  trenta: 30,
  apatnapu: 40,
  singkwenta: 50,
  singkuwenta: 50,
  limampu: 50,
  animnapu: 60,
  pitumpu: 70,
  walumpu: 80,
  siyamnapu: 90,
  sandaan: 100,
  sangdaan: 100,
  daan: 100,
  libo: 1000,
} as const;

export const TAGALOG_UNIT_WORDS = {
  daan: 100,
  libo: 1000,
} as const;
