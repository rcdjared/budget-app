import { computeAccountBalance, computeNetWorth } from "./balances";
import { formatMoney, parseMoney } from "./money";
import { sumLiquidAccountBalance } from "./forecast";
import type { Account, Category, Transaction } from "./types";

interface LocalAssistantContext {
  accounts: Account[];
  transactions: Transaction[];
  categories: Category[];
  today?: Date;
}

function dateKey(date: Date): string {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function getDateRange(question: string, today: Date): { start: string; end: string; label: string } {
  const date = new Date(today);
  date.setHours(12, 0, 0, 0);
  const end = dateKey(date);
  if (/\byesterday\b/.test(question)) {
    date.setDate(date.getDate() - 1);
    const key = dateKey(date);
    return { start: key, end: key, label: "yesterday" };
  }
  if (/\btoday\b/.test(question)) return { start: end, end, label: "today" };
  if (/\blast 7 days\b|\bthis week\b/.test(question)) {
    date.setDate(date.getDate() - (/last 7 days/.test(question) ? 6 : (date.getDay() + 6) % 7));
    return { start: dateKey(date), end, label: /last 7 days/.test(question) ? "the last 7 days" : "this week" };
  }
  if (/\blast week\b/.test(question)) {
    const mondayOffset = (date.getDay() + 6) % 7;
    date.setDate(date.getDate() - mondayOffset - 7);
    const start = dateKey(date);
    date.setDate(date.getDate() + 6);
    return { start, end: dateKey(date), label: "last week" };
  }
  if (/\blast month\b/.test(question)) {
    const firstThisMonth = new Date(date.getFullYear(), date.getMonth(), 1, 12);
    const lastPreviousMonth = new Date(firstThisMonth);
    lastPreviousMonth.setDate(0);
    return {
      start: dateKey(new Date(lastPreviousMonth.getFullYear(), lastPreviousMonth.getMonth(), 1, 12)),
      end: dateKey(lastPreviousMonth),
      label: lastPreviousMonth.toLocaleDateString("en-PH", { month: "long" }),
    };
  }
  if (/\bthis month\b|\bmonth\b/.test(question)) {
    return {
      start: dateKey(new Date(date.getFullYear(), date.getMonth(), 1, 12)),
      end,
      label: "this month",
    };
  }
  return { start: end, end, label: "today" };
}

/** Answer common money questions from the current local profile only. */
export function answerLocalMoneyQuestion(
  rawQuestion: string,
  { accounts, transactions, categories, today = new Date() }: LocalAssistantContext
): string | null {
  const question = rawQuestion.toLocaleLowerCase().trim();
  const isQuestion = /\?|^(what|how|can|could|did|do|does|am|is|are|show|tell|where|which)\b/.test(question);
  if (!isQuestion) return null;

  const liveTransactions = transactions.filter((transaction) => !transaction.deletedAt);
  if (/\b(can i afford|could i afford|afford this)\b/.test(question)) {
    const amountMatch = question.match(/(?:₱|php|â‚±|\$)?\s*(\d+(?:,\d{3})*(?:\.\d{1,2})?)\s*(k|m)?\b/i);
    if (!amountMatch) return "Tell me the amount too, for example: “Can I afford 2,500?”";
    const amount = parseMoney(`${amountMatch[1]}${amountMatch[2] || ""}`);
    const liquidBalance = sumLiquidAccountBalance(accounts, liveTransactions);
    const remainder = liquidBalance - amount;
    return `Your cash, bank and e-wallet accounts show ${formatMoney(liquidBalance)}. After ${formatMoney(amount)}, about ${formatMoney(remainder)} would remain before upcoming bills. This is a balance check, not a forecast.`;
  }

  const accountName = accounts
    .filter((account) => !account.deletedAt && !account.isArchived)
    .sort((a, b) => b.name.length - a.name.length)
    .find((account) => question.includes(account.name.toLocaleLowerCase()));
  const asksIncome = /\b(income|earn|earned|earnings|received|salary)\b/.test(question);
  const asksMerchant = /\b(?:at|from|on)\s+[a-z0-9]/i.test(question);
  const asksExpense = /\b(spend|spending|spent|expense|expenses|cost|purchase|bought)\b/.test(question) || (asksMerchant && !asksIncome);

  if (/\b(net worth|overall balance|total balance|balance|how much money|how much do i have|how much (?:money )?(?:is in|in))\b/.test(question) && !asksIncome && !asksExpense) {
    if (accountName && /\bbalance\b/.test(question)) {
      const balance = computeAccountBalance(accountName.id, accountName.openingBalance, liveTransactions);
      return `${accountName.name} has ${formatMoney(balance)} recorded locally.`;
    }
    const balances = new Map(accounts.map((account) => [
      account.id,
      computeAccountBalance(account.id, account.openingBalance, liveTransactions),
    ]));
    const net = computeNetWorth(accounts, balances);
    return `Your current net worth is ${formatMoney(net.netWorth)} based on the accounts and transactions in this profile.`;
  }

  const asksCategory = /\b(most|biggest|largest|top|category|categories|where)\b/.test(question);
  if (!asksIncome && !asksExpense && !asksCategory && !asksMerchant) return null;

  const range = getDateRange(question, today);
  let matched = liveTransactions.filter((transaction) => transaction.date >= range.start && transaction.date <= range.end);
  if (asksIncome && !asksExpense) matched = matched.filter((transaction) => transaction.type === "income");
  else if (asksExpense || asksCategory) matched = matched.filter((transaction) => transaction.type === "expense");
  else matched = matched.filter((transaction) => transaction.type === "income");

  if (accountName) matched = matched.filter((transaction) => transaction.accountId === accountName.id);
  const requestedCategory = categories.find((category) => question.includes(category.name.toLocaleLowerCase())) ||
    categories.find((category) => {
      const name = category.name.toLocaleLowerCase();
      if (/coffee|milk tea/.test(name)) return /\b(coffee|cafe|café|milk tea)\b/.test(question);
      if (/food|dining/.test(name)) return /\b(food|dining|restaurant|lunch|dinner|breakfast)\b/.test(question);
      if (/transport/.test(name)) return /\b(transport|grab|taxi|jeep|bus|commute)\b/.test(question);
      return false;
    });
  if (requestedCategory) matched = matched.filter((transaction) => transaction.categoryId === requestedCategory.id);
  const merchant = question.match(/\b(?:at|from|on)\s+([a-z0-9][a-z0-9 '&-]*)/i)?.[1]?.trim();
  if (merchant && !requestedCategory) {
    const merchantName = merchant.replace(/\b(this|last|today|yesterday|week|month|year)\b.*$/i, "").trim();
    if (merchantName) matched = matched.filter((transaction) => transaction.note?.toLocaleLowerCase().includes(merchantName));
  }

  if (asksCategory && !requestedCategory) {
    const totals = new Map<string, number>();
    for (const transaction of matched) {
      const key = transaction.categoryId || "uncategorized";
      totals.set(key, (totals.get(key) || 0) + transaction.amount);
    }
    const [topId, topAmount] = [...totals.entries()].sort((a, b) => b[1] - a[1])[0] || [];
    if (!topId || !topAmount) return `There are no ${asksIncome ? "income" : "expense"} entries for ${range.label} in this profile.`;
    const topName = categories.find((category) => category.id === topId)?.name || "Uncategorized";
    return `Your largest ${asksIncome ? "income" : "expense"} category for ${range.label} is ${topName} at ${formatMoney(topAmount)}.`;
  }

  const total = matched.reduce((sum, transaction) => sum + transaction.amount, 0);
  const label = asksIncome && !asksExpense ? "income" : "expenses";
  const scope = requestedCategory ? `${requestedCategory.name} ${label}` : label;
  return `${range.label[0].toUpperCase()}${range.label.slice(1)} ${scope}: ${formatMoney(total)}${accountName ? ` in ${accountName.name}` : " across this profile"}, based on your local logs.`;
}

export function explainLocalCapabilities(): string {
  return "I work offline from this profile’s saved transactions. I can log income, expenses and transfers, or summarize spending, income, balances and top categories. I don’t send your financial data to an AI service.";
}
