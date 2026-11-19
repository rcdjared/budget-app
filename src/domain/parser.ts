import { parseMoney } from "./money";

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
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
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

  if (/\byesterday\b/.test(lower)) date.setDate(date.getDate() - 1);
  else if (/\blast week\b/.test(lower)) date.setDate(date.getDate() - 7);
  else if (/\blast month\b/.test(lower)) {
    const day = date.getDate();
    date.setDate(1);
    date.setMonth(date.getMonth() - 1);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    date.setDate(Math.min(day, lastDay));
  }
  else {
    const weekdays: Record<string, number> = {
      sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
      thursday: 4, friday: 5, saturday: 6,
    };
    const weekdayMatch = lower.match(/\b(last\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (weekdayMatch) {
      const weekday = weekdays[weekdayMatch[2]];
      const distance = (date.getDay() - weekday + 7) % 7 || 7;
      date.setDate(date.getDate() - distance - (weekdayMatch[1] ? 7 : 0));
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
  const amountMatches = [...lower.matchAll(/(?:₱|php|â‚±|\$)?\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(k|m)?\b/gi)]
    .filter((match) => !/\s*(?:days?|weeks?)\s+ago\b/i.test(lower.slice((match.index || 0) + match[0].length)));
  const amountMatch = amountMatches[amountMatches.length - 1] || null;
  const amount = amountMatch ? parseMoney(`${amountMatch[1]}${amountMatch[2] || ""}`) : 0;

  let type: ParsedTransaction["type"] = "expense";
  if (/\b(transfer|move money|paid (?:my )?credit card|credit card payment|palit|padala)\b/i.test(lower)) {
    type = "transfer";
  } else if (/\b(salary|sahod|income|received|earnings?|freelance|bonus|refund|cashback|deposit|sold)\b/i.test(lower)) {
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
  if (!categoryHint) {
    if (/\b(jollibee|mcdonald'?s?|starbucks|restaurant|coffee|dining|lunch|dinner|breakfast|snack|food)\b/i.test(lower)) categoryHint = "Food & Dining";
    else if (/\b(grocery|groceries|supermarket|sm market|puregold|waltermart)\b/i.test(lower)) categoryHint = "Groceries";
    else if (/\b(grab|taxi|jeep|bus|lrt|mrt|transport|gas|fuel|commute|parking)\b/i.test(lower)) categoryHint = "Transportation";
    else if (/\b(meralco|electric|water|maynilad|internet|globe|smart|pldt|bill|utility|utilities)\b/i.test(lower)) categoryHint = "Bills & Utilities";
    else if (/\b(salary|sahod|bonus|freelance|paycheck)\b/i.test(lower)) categoryHint = "Salary";
  }

  let note = text;
  if (amountMatch) {
    const start = amountMatch.index || 0;
    note = `${note.slice(0, start)} ${note.slice(start + amountMatch[0].length)}`;
  }
  note = note
    .replace(/\b(?:today|yesterday|last week|last month|\d+ days? ago|\d+ weeks? ago)\b/gi, " ")
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
    .split(/[\n;]+|\s+(?:and then|then|and)\s+|,(?!\d{3}\b)/i)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseTransactionPhrase(line, accountNames, today, learnedCategories))
    .filter((draft) => draft.amount > 0);
}
