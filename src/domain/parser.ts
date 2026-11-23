import { parseMoney } from "./money";
import { dateKeyFromParts } from "@/lib/format";

export interface ParsedTransaction {
  amount: number;
  type: "expense" | "income" | "transfer";
  date: string;
  accountHint: string | null;
  toAccountHint: string | null;
  categoryHint: string | null;
  note: string;
}

function dateKey(date: Date): string {
  return dateKeyFromParts(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function normalizeLearningKey(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function parseNaturalDate(text: string, today: Date = new Date()): string {
  const lower = text.toLowerCase();
  const date = new Date(today);
  date.setHours(12, 0, 0, 0);

  const daysAgo = lower.match(/\b(\d+)\s+days?\s+ago\b/);
  if (daysAgo) {
    date.setDate(date.getDate() - Number(daysAgo[1]));
    return dateKey(date);
  }

  const weeksAgo = lower.match(/\b(\d+)\s+weeks?\s+ago\b/);
  if (weeksAgo) {
    date.setDate(date.getDate() - Number(weeksAgo[1]) * 7);
    return dateKey(date);
  }

  if (/\b(yesterday|kahapon|kagabi|last night)\b/.test(lower)) date.setDate(date.getDate() - 1);
  else if (/\blast week\b/.test(lower)) date.setDate(date.getDate() - 7);
  else if (/\blast month\b/.test(lower)) {
    const day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() - 1);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, lastDay));
  }
  else if (!/\b(today|ngayon|kanina|this morning|tonight)\b/.test(lower)) {
    const weekdays: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    };
    const weekdayMatch = lower.match(/\b(?:last\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (weekdayMatch) {
      const weekday = weekdays[weekdayMatch[1]];
      const distance = (date.getDay() - weekday + 7) % 7 || 7;
      date.setDate(date.getDate() - distance);
    }
  }

  return dateKey(date);
}

export function parseTransactionPhrase(
  input: string,
  accountNames: string[] = [],
  today: Date = new Date(),
  learnedCategories: Record<string, string> = {}
): ParsedTransaction {
  const text = input.trim();
  const lower = text.toLocaleLowerCase();
  const amountMatches = [...lower.matchAll(/(?:₱|php|p(?=\s*\d)|pesos?|pisos?|â‚±|\$)?\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(k|m)?\b/gi)]
    .filter((match) => !/^\s*(?:days?|weeks?)\s+ago\b/i.test(lower.slice((match.index || 0) + match[0].length)));
  const amountMatch = amountMatches[amountMatches.length - 1] || null;
  const amount = amountMatch ? parseMoney(`${amountMatch[1]}${amountMatch[2] || ""}`) : 0;

  let type: ParsedTransaction["type"] = "expense";
  if (/\b(transfer|move money|paid (?:my )?credit card|credit card payment|palit|padala)\b/i.test(lower)) {
    type = "transfer";
  } else if (/\b(salary|sahod|income|received|earnings?|freelance|bonus|refund|cashback|deposit|sold|business|sales|dividend|investment|rental income|remittance)\b/i.test(lower)) {
    type = "income";
  }

  const normalizedInput = normalizeLearningKey(text);
  const learnedMatch = Object.entries(learnedCategories)
    .map(([merchant, category]) => ({ merchant: normalizeLearningKey(merchant), category }))
    .filter(({ merchant }) => merchant && normalizedInput.includes(merchant))
    .sort((a, b) => b.merchant.length - a.merchant.length)[0];

  const orderedAccounts = [...accountNames].sort((a, b) => b.length - a.length);
  const transferMatch = lower.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?:\s+(?:for|of)\b|$)/i);
  const accountHint = type === "transfer" && transferMatch
    ? orderedAccounts.find((name) => normalizeLearningKey(transferMatch[1]).includes(normalizeLearningKey(name))) || null
    : orderedAccounts.find((name) => new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(text)) || null;
  const toAccountHint = type === "transfer"
    ? orderedAccounts.find((name) => new RegExp(`\\bto\\s+${escapeRegExp(name)}\\b`, "i").test(text)) || null
    : null;

  let categoryHint: string | null = learnedMatch?.category || null;
  if (!categoryHint && type === "income") {
    if (/\b(salary|sahod|bonus|paycheck|13th month)\b/i.test(lower)) categoryHint = "Salary";
    else if (/\bfreelance|side gig\b/i.test(lower)) categoryHint = "Freelance & Side Gig";
    else if (/\b(business|sales|sold)\b/i.test(lower)) categoryHint = "Business & Sales";
    else if (/\b(investment|dividend|interest earned)\b/i.test(lower)) categoryHint = "Investments & Dividends";
    else if (/\brental income\b/i.test(lower)) categoryHint = "Rental Income";
    else if (/\b(remittance|padala received)\b/i.test(lower)) categoryHint = "Remittance & Padala Received";
    else if (/\b(gift|cashback|refund)\b/i.test(lower)) categoryHint = "Gifts & Cashbacks";
    else categoryHint = "Other Income";
  } else if (!categoryHint) {
    if (/\b(jollibee|mcdonald'?s?|mcdo|kfc|mang inasal|chowking|starbucks|restaurant|coffee|dining|lunch|dinner|breakfast|snack|food|ulam|baon|7[- ]?eleven)\b/i.test(lower)) categoryHint = "Food";
    else if (/\b(grocery|groceries|supermarket|sm market|puregold|waltermart|palengke|landers|robinsons supermarket)\b/i.test(lower)) categoryHint = "Food";
    else if (/\b(shopping|shopee|lazada|uniqlo|zalora)\b/i.test(lower)) categoryHint = "Shopping";
    else if (/\b(grab|angkas|joyride|taxi|jeep|trike|bus|lrt|mrt|transport|pamasahe|pasahe|gas|fuel|commute|parking|toll)\b/i.test(lower)) categoryHint = "Transport";
    else if (/\b(meralco|electric|water|maynilad|internet|globe|smart|pldt|converge|bill|utility|utilities|rent)\b/i.test(lower)) categoryHint = "Bills";
    else if (/\b(load|mobile load|phone bill)\b/i.test(lower)) categoryHint = "Phone";
    else if (/\b(netflix|spotify|steam|sine|cinema|movie|entertainment|game|hobby)\b/i.test(lower)) categoryHint = "Fun";
    else if (/\b(mercury drug|watsons|gamot|medicine|pharmacy|clinic|doctor|hospital|health)\b/i.test(lower)) categoryHint = "Health";
    else if (/\b(atm fee|bank fee|service fee|fee|interest charged)\b/i.test(lower)) categoryHint = "Fees";
  }

  let note = text;
  if (amountMatch) {
    const start = amountMatch.index || 0;
    note = `${note.slice(0, start)} ${note.slice(start + amountMatch[0].length)}`;
  }
  note = note
    .replace(/\b(?:today|ngayon|kanina|this morning|tonight|yesterday|kahapon|kagabi|last night|last week|last month|\d+ days? ago|\d+ weeks? ago)\b/gi, " ")
    .replace(/\b(?:last\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/gi, " ")
    .replace(/\b(?:i|had|salary|sahod|income|received|earnings?|freelance|bonus|refund|cashback|deposit|sold|expense|spent|spend|paid|bought|buy|purchase|transfer|moved|move|from|to|for|on|at|using|via|my|a|an|the)\b/gi, " ");
  for (const name of orderedAccounts) {
    note = note.replace(new RegExp(escapeRegExp(name), "gi"), " ");
  }
  note = note.replace(/\b(?:gcash|maya|bdo|bpi|cash|bank)\b/gi, " ")
    .replace(/[|,:;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    amount,
    type,
    date: parseNaturalDate(text, today),
    accountHint,
    toAccountHint,
    categoryHint,
    note,
  };
}

export function parseMultipleTransactions(
  input: string,
  accountNames: string[] = [],
  today: Date = new Date(),
  learnedCategories: Record<string, string> = {}
) {
  return input
    .split(/[\n;]+|\s+(?:and then|then|and|tapos)\s+|,(?!\d{3}\b)/i)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseTransactionPhrase(line, accountNames, today, learnedCategories))
    .filter((draft) => draft.amount > 0);
}
