import { parseMoney } from "./money";

export interface ParsedTransaction {
  amount: number;
  type: "expense" | "income" | "transfer";
  date: string;
  accountHint: string | null;
  categoryHint: string | null;
  note: string;
}

export function parseNaturalDate(text: string, today: Date = new Date()): string {
  const lower = text.toLowerCase();
  const date = new Date(today);
  date.setHours(12, 0, 0, 0);

  if (lower.includes("yesterday")) date.setDate(date.getDate() - 1);
  else if (lower.includes("last week")) date.setDate(date.getDate() - 7);
  else {
    const weekdays: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    for (const [name, weekday] of Object.entries(weekdays)) {
      if (lower.includes(name)) {
        const distance = (date.getDay() - weekday + 7) % 7 || 7;
        date.setDate(date.getDate() - distance);
        break;
      }
    }
  }

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function parseTransactionPhrase(
  input: string,
  accountNames: string[] = [],
  today: Date = new Date()
): ParsedTransaction {
  const text = input.trim();
  const lower = text.toLowerCase();
  const amountMatch = lower.match(/(?:₱|\$)?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(k|m)?/i);
  let amount = 0;
  if (amountMatch) {
    amount = parseMoney(amountMatch[0].replace(/[₱$]/g, ""));
  }

  let type: ParsedTransaction["type"] = "expense";
  if (/(salary|sahod|income|received|freelance|bonus|refund)/i.test(lower)) type = "income";
  if (/paid credit card|credit card payment|transfer|palit|padala/i.test(lower)) type = "transfer";

  const accountHint =
    accountNames.find((name) => lower.includes(name.toLowerCase())) || null;

  let categoryHint: string | null = null;
  if (/(jollibee|mcdonald|starbucks|restaurant|coffee|dining|lunch|dinner)/i.test(lower)) categoryHint = "Food & Dining";
  else if (/(grocery|supermarket|sm market|puregold|waltermart)/i.test(lower)) categoryHint = "Groceries";
  else if (/(grab|taxi|jeep|bus|lrt|mrt|transport|gas|fuel)/i.test(lower)) categoryHint = "Transportation";
  else if (/(meralco|electric|water|maynilad|internet|globe|smart|pldt|bill|utility)/i.test(lower)) categoryHint = "Bills & Utilities";
  else if (/(salary|sahod|bonus|freelance)/i.test(lower)) categoryHint = "Salary";

  const note = text
    .replace(amountMatch?.[0] || "", "")
    .replace(/\b(yesterday|today|last week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, "")
    .replace(/\b(gcash|maya|bdo|bpi|cash|bank)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return {
    amount,
    type,
    date: parseNaturalDate(text, today),
    accountHint,
    categoryHint,
    note,
  };
}

export function parseMultipleTransactions(input: string, accountNames: string[] = [], today: Date = new Date()) {
  return input
    .split(/[\n,]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseTransactionPhrase(line, accountNames, today));
}
