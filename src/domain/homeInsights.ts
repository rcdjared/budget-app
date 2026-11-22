import type { Budget, Category, Transaction } from "@/domain/types";
import { HOME_INSIGHT_THRESHOLDS } from "@/lib/homeConfig";

export type InsightCandidate = {
  priority: number;
  text: string;
  kind: "budget" | "category" | "topCategory" | "largestExpense";
  targetId?: string;
  categoryId?: string;
};

export function computeInsights({
  transactions,
  budgets,
  categories,
  period,
  previousTransactions,
  now,
  locale,
}: {
  transactions: Transaction[];
  budgets: Budget[];
  categories: Category[];
  period: "day" | "week" | "month" | "year" | "sevenDays";
  previousTransactions: Transaction[];
  now: Date;
  locale: "en" | "fil";
}): InsightCandidate[] {
  const inPeriod = transactions.filter((tx) => !tx.deletedAt && !tx.cancelledAt);
  if (inPeriod.length < HOME_INSIGHT_THRESHOLDS.minimumTransactions) return [];

  const candidates: InsightCandidate[] = [];
  const comparisonPeriod = period === "sevenDays"
    ? locale === "fil" ? "nakaraang 7 araw" : "the previous 7 days"
    : period === "month"
      ? locale === "fil" ? "nakaraang siklo ng badyet" : "the previous budget cycle"
      : locale === "fil" ? `nakaraang ${period}` : `last ${period}`;
  const budgetText = (name: string, percent: number) =>
    locale === "fil"
      ? `Naabot ng ${name} ang ${percent}% ng budget.`
      : `${name} has reached ${percent}% of its budget.`;

  for (const budget of budgets.filter((item) => !item.deletedAt)) {
    if (budget.amount <= 0) continue;
    const spent = inPeriod
      .filter((tx) => tx.type === "expense" && tx.categoryId === budget.categoryId)
      .reduce((sum, tx) => sum + (tx.personalShareAmount ?? tx.amount), 0);
    const percent = Math.floor((spent / budget.amount) * 100);
    if (percent >= HOME_INSIGHT_THRESHOLDS.budgetWarningPercent) {
      const category = categories.find((item) => item.id === budget.categoryId);
      candidates.push({
        priority: 1,
        text: budgetText(category?.name || (locale === "fil" ? "Ang budget" : "A budget"), percent),
        kind: "budget",
        targetId: budget.id,
      });
    }
  }

  const categoryMap = new Map<string, { current: number; previous: number; currentCount: number; previousCount: number }>();
  for (const tx of inPeriod) {
    if (tx.type !== "expense" || !tx.categoryId) continue;
    const entry = categoryMap.get(tx.categoryId) || { current: 0, previous: 0, currentCount: 0, previousCount: 0 };
    entry.current += tx.personalShareAmount ?? tx.amount;
    entry.currentCount += 1;
    categoryMap.set(tx.categoryId, entry);
  }
  for (const tx of previousTransactions.filter((item) => !item.deletedAt && !item.cancelledAt)) {
    if (tx.type !== "expense" || !tx.categoryId) continue;
    const entry = categoryMap.get(tx.categoryId) || { current: 0, previous: 0, currentCount: 0, previousCount: 0 };
    entry.previous += tx.personalShareAmount ?? tx.amount;
    entry.previousCount += 1;
    categoryMap.set(tx.categoryId, entry);
  }

  for (const [categoryId, values] of categoryMap) {
    if (values.currentCount + values.previousCount < HOME_INSIGHT_THRESHOLDS.minimumCategoryTransactions) continue;
    if (Math.max(values.current, values.previous) < HOME_INSIGHT_THRESHOLDS.categoryMinimumCentavos) continue;
    if (values.previous <= 0) continue;
    const change = ((values.current - values.previous) / values.previous) * 100;
    if (Math.abs(change) >= HOME_INSIGHT_THRESHOLDS.categoryChangePercent) {
      const category = categories.find((item) => item.id === categoryId);
      const name = category?.name || (locale === "fil" ? "Kategorya" : "Category");
      const percent = Math.round(Math.abs(change));
      const direction = change < 0
        ? (locale === "fil" ? "mas mababa" : "less")
        : (locale === "fil" ? "mas mataas" : "more");
      candidates.push({
        priority: 2,
        text: locale === "fil"
          ? `${percent}% ${direction} ang gastos sa ${name} kaysa sa ${comparisonPeriod}.`
          : `You've spent ${percent}% ${direction} on ${name} than ${comparisonPeriod}.`,
        kind: "category",
        categoryId,
      });
    }
  }

  const totals = new Map<string, number>();
  for (const tx of inPeriod) {
    if (tx.type !== "expense") continue;
    totals.set(tx.categoryId || "__uncategorized", (totals.get(tx.categoryId || "__uncategorized") || 0) + (tx.personalShareAmount ?? tx.amount));
  }
  const top = [...totals.entries()].sort((a, b) => b[1] - a[1])[0];
  if (top) {
    const total = [...totals.values()].reduce((sum, value) => sum + value, 0);
    const share = total ? Math.round((top[1] / total) * 100) : 0;
    const category = categories.find((item) => item.id === top[0]);
    candidates.push({
      priority: 3,
      text: locale === "fil"
        ? `${category?.name || "Kategorya"} ang pinakamalaking kategorya, ${share}% ng gastos.`
        : `${category?.name || "A category"} is the top category at ${share}% of spending.`,
      kind: "topCategory",
      categoryId: top[0] === "__uncategorized" ? undefined : top[0],
    });
  }

  const largest = inPeriod
    .filter((tx) => tx.type === "expense")
    .sort((a, b) => (b.personalShareAmount ?? b.amount) - (a.personalShareAmount ?? a.amount))[0];
  if (largest) {
    const category = categories.find((item) => item.id === largest.categoryId);
    candidates.push({
      priority: 4,
      text: locale === "fil"
        ? `Ang pinakamalaking gastos ay para sa ${category?.name || "wala sa kategorya"}.`
        : `The largest expense was for ${category?.name || "uncategorized"}.`,
      kind: "largestExpense",
      categoryId: largest.categoryId || undefined,
    });
  }

  return candidates.sort((a, b) => a.priority - b.priority);
}
