import React, { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  CircleDollarSign,
  ChevronDown,
  Clock3,
  Landmark,
  MessageCircle,
  Repeat2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import { db } from "@/db/schema";
import { profileRecords } from "@/db/profileScope";
import { formatMoney } from "@/domain/money";
import { sortTransactionsNewestFirst } from "@/domain/history";
import { computeInsights } from "@/domain/homeInsights";
import { computeFriendBalance } from "@/domain/friendLedger";
import { addDateDays, getSpendingPulseRange } from "@/features/spending-pulse/periods";
import type { SpendingPulsePeriod } from "@/features/spending-pulse/types";
import { getBudgetSpendSnapshot } from "@/lib/notificationEngine";
import { loadAppSettings } from "@/lib/settings";
import { tForLanguage } from "@/lib/localization";
import { toDateString } from "@/lib/format";
import type {
  Account,
  Budget,
  Category,
  Debt,
  Friend,
  FriendLedgerEntry,
  Recurring,
  Transaction,
} from "@/domain/types";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Kupi } from "@/features/spending-pulse/Kupi";
import { SpendingPulse } from "@/features/spending-pulse/SpendingPulse";
import { computeKupiNudge, type KupiNudge } from "@/kupi/nudges/computeKupiNudge";
import type { Mood } from "@/kupi/contracts";

interface FinsightsPageProps {
  profileId: string;
  onOpenHelp?: () => void;
  showNetWorth?: boolean;
  onAddAccount: () => void;
  onAddTransaction: (type: "expense" | "income") => void;
  onHistory: (filters?: { accountId?: string; categoryId?: string; startDate?: string; endDate?: string }) => void;
  onPlan: () => void;
  onOpenTransaction: (transactionId: string) => void;
  onOpenDebt: () => void;
  onOpenRecurring: () => void;
  onOpenFriends: () => void;
  onOpenBudget: () => void;
  onOpenKupi: (message: string, mood: Mood) => void;
}

type SectionId = "netBalance" | "totals" | "insight" | "trend" | "categories" | "budgets" | "upcoming" | "recent";

const DEFAULT_SECTION_ORDER: SectionId[] = [
  "insight",
  "categories",
  "budgets",
  "upcoming",
  "recent",
];

interface DismissedKupiNudge {
  id: string;
  dismissedAt: number;
}

function readDismissedKupiNudges(profileId: string): DismissedKupiNudge[] {
  try {
    const saved = localStorage.getItem(`kupit-kupi-nudges-${profileId}`);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is DismissedKupiNudge =>
      typeof item === "object"
      && item !== null
      && "id" in item
      && typeof item.id === "string"
      && "dismissedAt" in item
      && typeof item.dismissedAt === "number"
      && Number.isFinite(item.dismissedAt)
    );
  } catch (error) {
    console.error("Could not load dismissed Kupi nudges.", error);
    return [];
  }
}

function messageForNudge(
  nudge: KupiNudge,
  categoryName: string | undefined,
  formatProfileMoney: (amount: number) => string,
  language: "en" | "fil",
): string {
  const category = categoryName || (language === "fil" ? "Kategorya" : "A category");
  if (nudge.id.startsWith("budget-exceeded:")) {
    return language === "fil"
      ? `${category} ay lampas na sa budget sa ${nudge.facts.percent}%. Gusto mo bang suriin ang gastos?`
      : `${category} is over budget at ${nudge.facts.percent}%. Want to review your spending?`;
  }
  if (nudge.id.startsWith("budget-pacing:")) {
    return language === "fil"
      ? `${category} ay gumamit na ng ${nudge.facts.percent}% ng budget kahit ${nudge.facts.daysLeft} araw pa ang natitira. Suriin natin?`
      : `${category} has used ${nudge.facts.percent}% of its budget with ${nudge.facts.daysLeft} days left. Want to check the pace?`;
  }
  if (nudge.id.startsWith("micro-spend:")) {
    return language === "fil"
      ? `Nakapagtala ka ng ${nudge.facts.microSpendCount} maliliit na gastos na wala pang ${formatProfileMoney(5_000)} ngayong araw. Silipin natin?`
      : `You logged ${nudge.facts.microSpendCount} small expenses under ${formatProfileMoney(5_000)} today. Want a quick spending check?`;
  }
  if (nudge.id.startsWith("daily-safe-to-spend:")) {
    return language === "fil"
      ? `May humigit-kumulang ${formatProfileMoney(Number(nudge.facts.dailySafeToSpendCentavos))} kada araw na natitira sa mga aktibong budget. Gusto mo bang tingnan?`
      : `About ${formatProfileMoney(Number(nudge.facts.dailySafeToSpendCentavos))} per day remains across your active budgets. Want to review the details?`;
  }
  if (nudge.id.startsWith("zero-spend-streak:")) {
    return language === "fil"
      ? `${nudge.facts.streakDays}-araw nang walang gastos. Aprubado ni Kupi—ituloy natin?`
      : `A ${nudge.facts.streakDays}-day no-spend streak. Kupi approves—want to keep it going?`;
  }
  return language === "fil"
    ? "Wala pang naitatala ngayong araw. May gusto ka bang idagdag o itanong?"
    : "Nothing logged today yet. Want to track an expense or ask me something?";
}

function kupiMascotMood(mood: Mood): "calm" | "smug" | "shook" {
  if (mood === "happy") return "smug";
  if (mood === "worried") return "shook";
  return "calm";
}

function matchesAccount(transaction: Transaction, accountId: string) {
  if (accountId === "all") return true;
  if (transaction.type === "transfer") {
    return transaction.accountId === accountId || transaction.toAccountId === accountId;
  }
  return transaction.accountId === accountId;
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function FinsightsPage({
  profileId,
  onAddAccount,
  onAddTransaction,
  onHistory,
  onPlan,
  onOpenTransaction,
  onOpenDebt,
  onOpenRecurring,
  onOpenFriends,
  onOpenBudget,
  onOpenKupi,
}: FinsightsPageProps) {
  const language = loadAppSettings().language;
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [period, setPeriod] = useState<SpendingPulsePeriod>("day");
  const [activeTab, setActiveTab] = useState<"expense" | "income">("expense");
  const [now, setNow] = useState(() => new Date());
  const [dismissedNudges, setDismissedNudges] = useState(() => readDismissedKupiNudges(profileId));

  useEffect(() => {
    setSelectedAccountId("all");
    setPeriod("day");
    setDismissedNudges(readDismissedKupiNudges(profileId));
  }, [profileId]);

  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  const accountResults = useLiveQuery(
    () => profileRecords(db.accounts, profileId).filter((account) => !account.deletedAt && !account.isArchived).toArray(),
    [profileId]
  );
  const accounts = accountResults ?? [];
  const profile = useLiveQuery(() => db.profiles.get(profileId), [profileId]);
  const formatProfileMoney = (amount: number) => formatMoney(amount, profile?.currency || "PHP");
  const categories = useLiveQuery(
    () => profileRecords(db.categories, profileId).filter((category) => !category.deletedAt).toArray(),
    [profileId],
    []
  );
  const homeSetting = useLiveQuery(
    () => db.settings.where("profileId").equals(profileId).filter((setting) => setting.key === "kupit-app-settings").first(),
    [profileId]
  );

  let sectionSettings = loadAppSettings();
  if (homeSetting?.value) {
    try {
      sectionSettings = { ...sectionSettings, ...JSON.parse(homeSetting.value) };
    } catch {
      // Keep defaults for malformed settings.
    }
  }
  const hiddenSections = new Set(sectionSettings.homeSections);
  const sectionOrder = ((sectionSettings.homeSectionOrder || DEFAULT_SECTION_ORDER) as string[])
    .filter((section): section is SectionId => DEFAULT_SECTION_ORDER.includes(section as SectionId));

  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now), [now]);
  const pulseRange = useMemo(
    () => getSpendingPulseRange(period, now, {
      budgetCycleStartDay: sectionSettings.budgetCycleStartDay,
      weekStartsOn: sectionSettings.weekStartsOn,
    }),
    [period, now, sectionSettings.budgetCycleStartDay, sectionSettings.weekStartsOn]
  );
  const range = useMemo(() => ({
    start: pulseRange.start,
    end: today < pulseRange.end ? today : pulseRange.end,
    comparableStart: pulseRange.previousStart,
    comparableEnd: pulseRange.previousEnd,
  }), [pulseRange, today]);

  const filteredTxs = useLiveQuery(
    () => {
      if (!["netBalance", "totals", "insight", "trend", "categories"].some((section) => hiddenSections.has(section as SectionId))) {
        return Promise.resolve([] as Transaction[]);
      }
      return db.transactions
        .where("[profileId+date]")
        .between([profileId, range.start], [profileId, range.end], true, true)
        .filter((transaction) => !transaction.deletedAt && !transaction.cancelledAt && matchesAccount(transaction, selectedAccountId))
        .toArray();
    },
    [profileId, range.start, range.end, selectedAccountId, sectionSettings.homeSections.join("|")],
    [] as Transaction[]
  );

  const previousTxs = useLiveQuery(
    () => {
      if (hiddenSections.has("totals") || hiddenSections.has("insight") || hiddenSections.has("categories")) {
        return db.transactions
          .where("[profileId+date]")
          .between([profileId, range.comparableStart], [profileId, range.comparableEnd], true, true)
          .filter((transaction) => !transaction.deletedAt && !transaction.cancelledAt && matchesAccount(transaction, selectedAccountId))
          .toArray();
      }
      return Promise.resolve([] as Transaction[]);
    },
    [profileId, range.comparableStart, range.comparableEnd, selectedAccountId, sectionSettings.homeSections.join("|")],
    [] as Transaction[]
  );

  const budgets = useLiveQuery(
    () => profileRecords(db.budgets, profileId).filter((budget) => !budget.deletedAt).toArray(),
    [profileId],
    [] as Budget[]
  );
  const budgetTransactions = useLiveQuery(
    () => profileRecords(db.transactions, profileId).filter((transaction) => !transaction.deletedAt && !transaction.cancelledAt).toArray(),
    [profileId],
    [] as Transaction[]
  );

  const recurring = useLiveQuery(
    () => hiddenSections.has("upcoming")
      ? profileRecords(db.recurring, profileId).filter((item) => !item.deletedAt && !item.isPaused).toArray()
      : Promise.resolve([] as Recurring[]),
    [profileId, hiddenSections.has("upcoming")],
    [] as Recurring[]
  );
  const debts = useLiveQuery(
    () => hiddenSections.has("upcoming")
      ? profileRecords(db.debts, profileId).filter((item) => !item.deletedAt).toArray()
      : Promise.resolve([] as Debt[]),
    [profileId, hiddenSections.has("upcoming")],
    [] as Debt[]
  );
  const friendLedger = useLiveQuery(
    () => profileRecords(db.friendLedger, profileId).filter((item) => !item.deletedAt).toArray(),
    [profileId],
    [] as FriendLedgerEntry[]
  );
  const friends = useLiveQuery(
    () => profileRecords(db.friends, profileId).filter((item) => !item.deletedAt).toArray(),
    [profileId],
    [] as Friend[]
  );
  const recentTransactions = useLiveQuery(
    () => hiddenSections.has("recent")
      ? profileRecords(db.transactions, profileId)
        .filter((transaction) => !transaction.deletedAt && !transaction.cancelledAt && matchesAccount(transaction, selectedAccountId))
        .toArray()
        .then((transactions) =>
          sortTransactionsNewestFirst(transactions)
        )
      : Promise.resolve([] as Transaction[]),
    [profileId, selectedAccountId, hiddenSections.has("recent")],
    [] as Transaction[]
  );

  const friendBalances = useMemo(() => {
    const entries = friendLedger as FriendLedgerEntry[];
    return (friends as Friend[])
      .map((friend) => ({ friend, balance: computeFriendBalance(entries, friend.id) }))
      .filter(({ balance }) => balance !== 0)
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance));
  }, [friendLedger, friends]);
  const debtBalances = useMemo(
    () => (debts as Debt[]).filter((debt) => debt.principal > 0),
    [debts]
  );
  const transactionCount = useLiveQuery(
    () => profileRecords(db.transactions, profileId)
      .filter((transaction) => !transaction.deletedAt && !transaction.cancelledAt)
      .count(),
    [profileId]
  );

  const income = filteredTxs.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + tx.amount, 0);
  const expense = filteredTxs.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + (tx.personalShareAmount ?? tx.amount), 0);
  const net = income - expense;
  const currentTotal = activeTab === "expense" ? expense : income;

  const previousCurrent = previousTxs
    .filter((tx) => tx.type === activeTab)
    .reduce((sum, tx) => sum + (activeTab === "expense" ? (tx.personalShareAmount ?? tx.amount) : tx.amount), 0);

  const comparison = useMemo(() => {
    if (currentTotal === 0 || previousCurrent === 0) return null;
    const rawChange = ((currentTotal - previousCurrent) / previousCurrent) * 100;
    const positive = activeTab === "expense" ? rawChange < 0 : rawChange > 0;
    return {
      percent: Math.round(Math.abs(rawChange)),
      direction: rawChange === 0 ? "neutral" : rawChange > 0 ? "up" : "down",
      positive,
    };
  }, [currentTotal, previousCurrent, activeTab]);

  const periodLabel = period === "day"
    ? tForLanguage("vsLastDay", language)
    : period === "week"
      ? tForLanguage("vsLastWeek", language)
      : period === "month"
        ? tForLanguage("vsLastBudgetCycle", language)
        : tForLanguage("vsLast7Days", language);

  const categoryBreakdown = useMemo(() => {
    const totals = new Map<string, number>();
    for (const tx of filteredTxs) {
      if (tx.type !== activeTab) continue;
      const key = tx.categoryId || "__uncategorized";
      totals.set(key, (totals.get(key) || 0) + (activeTab === "expense" ? (tx.personalShareAmount ?? tx.amount) : tx.amount));
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked.slice(0, 5);
    const other = ranked.slice(5).reduce((sum, [, amount]) => sum + amount, 0);
    if (other > 0) top.push(["__other", other]);
    return top.map(([categoryId, amount]) => {
      const category = categories.find((item) => item.id === categoryId);
      return {
        categoryId,
        category,
        amount,
        percentage: currentTotal ? (amount / currentTotal) * 100 : 0,
      };
    });
  }, [filteredTxs, activeTab, categories, currentTotal]);

  const trendBars = useMemo(() => {
    if (period === "day") {
      const segments = [
        { label: "Morning", start: 6, end: 12, amount: 0 },
        { label: "Afternoon", start: 12, end: 18, amount: 0 },
        { label: "Evening", start: 18, end: 24, amount: 0 },
        { label: "Night", start: 0, end: 6, amount: 0 },
      ];
      for (const tx of filteredTxs) {
        if (tx.type !== activeTab) continue;
        const hour = new Date(`${tx.date}T12:00:00`).getHours();
        const segment = segments.find((item) => hour >= item.start && hour < item.end) || segments[3];
        segment.amount += activeTab === "expense" ? (tx.personalShareAmount ?? tx.amount) : tx.amount;
      }
      return segments.map(({ label, amount }) => ({ label, amount }));
    }
    if (period === "week" || period === "sevenDays") {
      return Array.from({ length: 7 }, (_, index) => {
        const date = addDateDays(range.start, index);
        const label = new Intl.DateTimeFormat(language === "fil" ? "fil-PH" : "en-PH", {
          timeZone: "UTC",
          weekday: "short",
        }).format(new Date(`${date}T12:00:00Z`));
        return {
          label,
          amount: filteredTxs.filter((tx) => tx.type === activeTab && tx.date.slice(0, 10) === date)
            .reduce((sum, tx) => sum + (activeTab === "expense" ? (tx.personalShareAmount ?? tx.amount) : tx.amount), 0),
        };
      });
    }
    if (period === "month") {
      const bars: { label: string; amount: number }[] = [];
      for (let index = 0; ; index++) {
        const start = addDateDays(range.start, index * 7);
        if (start > range.end) break;
        const end = addDateDays(start, 6);
        const lastDate = end < range.end ? end : range.end;
        bars.push({
          label: `W${index + 1}`,
          amount: filteredTxs.filter((tx) => tx.type === activeTab)
            .filter((tx) => tx.date.slice(0, 10) >= start && tx.date.slice(0, 10) <= lastDate)
            .reduce((sum, tx) => sum + (activeTab === "expense" ? (tx.personalShareAmount ?? tx.amount) : tx.amount), 0),
        });
      }
      return bars;
    }
    return [];
  }, [period, range.start, range.end, filteredTxs, activeTab, language]);

  const maxTrendAmount = Math.max(...trendBars.map((bar) => bar.amount), 10000);

  const insightCandidates = useMemo(() => computeInsights({
    transactions: filteredTxs,
    previousTransactions: previousTxs,
    budgets: selectedAccountId === "all" ? budgets : [],
    categories,
    period,
    now,
    locale: language,
  }), [filteredTxs, previousTxs, budgets, categories, period, now, language, selectedAccountId]);

  const budgetSnapshots = useMemo(
    () => getBudgetSpendSnapshot(budgets, budgetTransactions, toDateString(now))
      .sort((a, b) => (b.spent / b.limit) - (a.spent / a.limit))
      .slice(0, 3),
    [budgets, budgetTransactions]
  );
  const kupiNudges = useMemo(
    () => computeKupiNudge(budgetTransactions, budgets, now),
    [budgetTransactions, budgets, now],
  );
  const kupiNudge = kupiNudges.find((nudge) => {
    const dismissed = dismissedNudges.find(({ id }) => id === nudge.id);
    return !dismissed || now.getTime() - dismissed.dismissedAt >= nudge.cooldownMs;
  });
  const dismissKupiNudge = (nudge: KupiNudge) => {
    const next = [
      ...dismissedNudges.filter(({ dismissedAt }) => now.getTime() - dismissedAt < 30 * 24 * 60 * 60 * 1_000),
      { id: nudge.id, dismissedAt: now.getTime() },
    ].slice(-100);
    setDismissedNudges(next);
    try {
      localStorage.setItem(`kupit-kupi-nudges-${profileId}`, JSON.stringify(next));
    } catch (error) {
      console.error("Could not save dismissed Kupi nudge.", error);
    }
  };
  const kupiNudgeCategory = kupiNudge?.facts.categoryId
    ? categories.find(({ id }) => id === kupiNudge.facts.categoryId)?.name
    : undefined;
  const kupiNudgeMessage = kupiNudge
    ? messageForNudge(kupiNudge, kupiNudgeCategory, formatProfileMoney, language)
    : "";

  const upcomingItems = useMemo(() => {
    if (!hiddenSections.has("upcoming")) return [];
    const today = toDateString(now);
    const end = toDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
    const items: {
      id: string;
      date: string;
      title: string;
      amount: number;
      kind: "recurring";
      accountId?: string | null;
    }[] = [];
    for (const item of recurring as Recurring[]) {
      if (item.nextDueDate >= today && item.nextDueDate <= end
        && (selectedAccountId === "all" || item.accountId === selectedAccountId)) {
        items.push({
          id: item.id,
          date: item.nextDueDate,
          title: item.note || tForLanguage("recurringNotifications", language),
          amount: item.transactionType === "income" ? item.amount : -item.amount,
          kind: "recurring",
          accountId: item.accountId,
        });
      }
    }
    return items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  }, [recurring, selectedAccountId, hiddenSections, now, language]);

  const openHistory = (categoryId?: string) => {
    const category = categoryId ? categories.find((item) => item.id === categoryId) : undefined;
    const categoryFilter = category ? `${category.type}:${category.name.trim().toLowerCase()}` : undefined;
    onHistory({
      accountId: selectedAccountId === "all" ? undefined : selectedAccountId,
      categoryId: categoryFilter,
      startDate: range.start,
      endDate: range.end,
    });
  };

  const netBalanceClass = net > 0 ? "positive" : net < 0 ? "negative" : "neutral";

  const renderSection = (sectionId: SectionId) => {
    if (!hiddenSections.has(sectionId)) return null;
    if (sectionId === "netBalance") {
      return (
        <section className="home-net-card" key={sectionId}>
          <span className="eyebrow">{tForLanguage("netBalance", language)}</span>
          <strong className={`home-net-amount ${netBalanceClass}`}>
            {net > 0 ? "+" : net < 0 ? "-" : ""}
            {formatProfileMoney(Math.abs(net))}
          </strong>
        </section>
      );
    }
    if (sectionId === "totals") {
      return (
        <section className="home-totals-card" key={sectionId}>
          <div className="finsights-tab-switch" role="tablist" aria-label="Transaction type">
            {(["expense", "income"] as const).map((type) => (
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === type}
                key={type}
                className={`tab-switch-pill ${activeTab === type ? `active-${type}` : ""}`}
                onClick={() => setActiveTab(type)}
              >
                {tForLanguage(type, language)}
              </button>
            ))}
          </div>
          {currentTotal === 0 ? (
            <div className="home-empty-total">
              <b>{activeTab === "expense" ? tForLanguage("noExpensesRecorded", language) : tForLanguage("noIncomeRecorded", language)}</b>
              <button type="button" className="kupit-primary-button" onClick={() => onAddTransaction(activeTab)}>
                {activeTab === "expense" ? tForLanguage("addExpense", language) : tForLanguage("addIncome", language)}
              </button>
            </div>
          ) : (
            <div className="home-total-heading">
              <div>
                <span className="eyebrow">{activeTab === "expense" ? tForLanguage("expense", language) : tForLanguage("income", language)}</span>
                <strong>{formatProfileMoney(currentTotal)}</strong>
              </div>
              {comparison && (
                <span className={`home-change-chip ${comparison.positive ? "positive" : comparison.direction === "neutral" ? "neutral" : "negative"}`}>
                  {comparison.direction === "down" ? <TrendingDown size={14} /> : comparison.direction === "up" ? <TrendingUp size={14} /> : null}
                  {comparison.direction === "up" ? "↑" : comparison.direction === "down" ? "↓" : ""}
                  {comparison.percent}% · {periodLabel}
                </span>
              )}
            </div>
          )}
        </section>
      );
    }
    if (sectionId === "insight") {
      if (filteredTxs.length < 3 || !insightCandidates.length) return null;
      const insight = insightCandidates[0];
      return (
        <button
          type="button"
          className="home-insight-card"
          key={sectionId}
          onClick={() => {
            if (insight.kind === "budget") onOpenBudget();
            else openHistory(insight.categoryId);
          }}
        >
          <CircleDollarSign size={18} />
          <span>{insight.text}</span>
        </button>
      );
    }
    if (sectionId === "trend") {
      const max = Math.ceil(Math.max(maxTrendAmount, 10000) / 10000) * 10000;
      return (
        <section className="home-trend-card" key={sectionId}>
          <span className="eyebrow">{tForLanguage(activeTab, language)} trend</span>
          <div className="home-trend-bars" aria-label={`${activeTab} trend`}>
            {trendBars.map((bar) => (
              <div className="home-trend-column" key={bar.label}>
                <div className="home-trend-track">
                  <span
                    className={activeTab === "expense" ? "expense" : "income"}
                    style={{ height: `${Math.max(bar.amount > 0 ? 8 : 2, Math.min(100, (bar.amount / max) * 100))}%` }}
                  />
                </div>
                <small>{bar.label}</small>
              </div>
            ))}
          </div>
        </section>
      );
    }
    if (sectionId === "categories") {
      if (!categoryBreakdown.length) return null;
      return (
        <section className="home-category-showcase" key={sectionId}>
          <div className="home-section-heading">
            <h2>{tForLanguage("categories", language)}</h2>
            <button type="button" onClick={() => openHistory()}>{tForLanguage("seeAll", language)}</button>
          </div>
          <div className="home-category-showcase-grid">
            {categoryBreakdown.map((row, index) => (
              <button
                type="button"
                className={`home-category-showcase-item ${index === 0 ? "featured" : ""}`}
                key={row.categoryId}
                onClick={() => row.categoryId !== "__other" ? openHistory(row.categoryId === "__uncategorized" ? undefined : row.categoryId) : openHistory()}
                style={{ "--category-color": row.category?.color || "var(--primary)" } as React.CSSProperties}
              >
                <span className="home-category-showcase-top">
                  <CategoryIcon
                    icon={row.category?.icon}
                    color={row.category?.color}
                    size={index === 0 ? 18 : 15}
                    className="home-category-showcase-icon"
                    style={{ backgroundColor: "transparent", borderRadius: "0", width: "24px", height: "24px" }}
                  />
                  <small>{index === 0 ? (language === "fil" ? "PINAKAMALAKI" : "TOP SPEND") : `${Math.round(row.percentage)}%`}</small>
                </span>
                <b className="home-category-showcase-name">{row.categoryId === "__other" ? tForLanguage("other", language) : row.category?.name || tForLanguage("other", language)}</b>
                <strong>{formatProfileMoney(row.amount)}</strong>
                <span className="home-category-showcase-bar">
                  <i style={{ width: `${Math.min(100, row.percentage)}%` }} />
                </span>
              </button>
            ))}
          </div>
        </section>
      );
    }
    if (sectionId === "budgets") {
      if (!budgets.length) return null;
      return (
        <section className="home-section-card" key={sectionId}>
          <div className="home-section-heading">
            <h2>{tForLanguage("budgets", language)}</h2>
            <button type="button" onClick={onPlan}>{tForLanguage("seeAll", language)}</button>
          </div>
          <div className="home-budget-list">
            {budgetSnapshots.map((snapshot) => {
              const budget = budgets.find((item) => item.id === snapshot.budgetId);
              const category = categories.find((item) => item.id === budget?.categoryId);
              const percent = snapshot.limit ? (snapshot.spent / snapshot.limit) * 100 : 0;
              const barClass = percent >= 100 ? "expense" : percent >= 80 ? "warning" : "normal";
              const remaining = Math.max(0, snapshot.limit - snapshot.spent);
              return (
                <button type="button" className="home-budget-row" key={snapshot.budgetId} onClick={onOpenBudget}>
                  <span><b>{category?.name || tForLanguage("budgets", language)}</b><small>{formatProfileMoney(snapshot.spent)} / {formatProfileMoney(snapshot.limit)}</small></span>
                  <span className="home-budget-bar"><i className={barClass} style={{ width: `${Math.min(100, percent)}%` }} /></span>
                  <small>{formatProfileMoney(remaining)} {tForLanguage("remaining", language)}</small>
                </button>
              );
            })}
          </div>
        </section>
      );
    }
    if (sectionId === "upcoming") {
      if (!upcomingItems.length && !friendBalances.length && !debtBalances.length) return null;
      return (
        <section className="home-section-card" key={sectionId}>
          <div className="home-section-heading">
            <h2>{tForLanguage("upcomingBalances", language)}</h2>
            <button type="button" onClick={friendBalances.length > 0 && !debtBalances.length && !upcomingItems.length ? onOpenFriends : onPlan}>{tForLanguage("seeAll", language)}</button>
          </div>
          {friendBalances.length > 0 && (
            <div className="home-balance-group">
              <h3>{tForLanguage("friendBalances", language)}</h3>
              <div className="home-friend-balance-list">
                {friendBalances.slice(0, 4).map(({ friend, balance }) => (
                  <button type="button" className="home-friend-balance-row" key={friend.id} onClick={onOpenFriends}>
                    <span className="home-friend-balance-avatar" style={{ background: friend.avatarColor }}>{friend.name[0]?.toUpperCase()}</span>
                    <span className="home-friend-balance-copy">
                      <b>{friend.name}</b>
                      <small>{balance > 0 ? tForLanguage("someoneOwesMe", language) : tForLanguage("iOweSomeone", language)}</small>
                    </span>
                    <strong className={balance > 0 ? "income" : "expense"}>{formatProfileMoney(Math.abs(balance))}</strong>
                  </button>
                ))}
              </div>
            </div>
          )}
          {debtBalances.length > 0 && (
            <div className="home-balance-group">
              <h3>{tForLanguage("debtsAndReceivables", language)}</h3>
              <div className="home-upcoming-list">
                {debtBalances.slice(0, 4).map((debt) => (
                  <button type="button" className="home-upcoming-row" key={debt.id} onClick={onOpenDebt}>
                    <span className="home-row-icon"><Landmark size={18} /></span>
                    <span>
                      <b>{debt.counterparty}</b>
                      <small>{debt.direction === "owed_to_me" ? tForLanguage("someoneOwesMe", language) : tForLanguage("iOweSomeone", language)}{debt.dueDate ? ` · ${debt.dueDate}` : ""}</small>
                    </span>
                    <strong className={debt.direction === "owed_to_me" ? "income" : "expense"}>{formatProfileMoney(debt.principal)}</strong>
                  </button>
                ))}
              </div>
            </div>
          )}
          {upcomingItems.length > 0 && (
            <div className="home-balance-group">
              {(friendBalances.length > 0 || debtBalances.length > 0) && <h3>{tForLanguage("dueSoon", language)}</h3>}
              <div className="home-upcoming-list">
                {upcomingItems.map((item) => {
                  const distance = daysBetween(toDateString(now), item.date);
                  const relative = distance === 0 ? tForLanguage("today", language) : distance === 1 ? tForLanguage("tomorrow", language) : item.date;
                  const open = onOpenRecurring;
                  const Icon = Repeat2;
                  return (
                    <button type="button" className="home-upcoming-row" key={`${item.kind}-${item.id}`} onClick={open}>
                      <span className="home-row-icon"><Icon size={18} /></span>
                      <span><b>{item.title}</b><small>{relative}</small></span>
                      <strong className={item.amount >= 0 ? "income" : "expense"}>
                        {item.amount >= 0 ? "+" : "-"}{formatProfileMoney(Math.abs(item.amount))}
                      </strong>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </section>
      );
    }
    if (sectionId === "recent") {
      const rows = (recentTransactions as Transaction[]).slice(0, 5);
      const recentDateFormatter = new Intl.DateTimeFormat(language === "fil" ? "fil-PH" : "en-PH", {
        timeZone: "Asia/Manila",
        month: "short",
        day: "numeric",
      });
      return (
        <section className="home-section-card" key={sectionId}>
          <div className="home-section-heading">
            <h2>{tForLanguage("recent", language)}</h2>
            <button type="button" onClick={() => openHistory()}>{tForLanguage("seeAll", language)}</button>
          </div>
          {!rows.length ? (
            <p className="home-inline-empty">{tForLanguage("noRecentTransactions", language)}</p>
          ) : (
            <div className="home-recent-list">
              {rows.map((tx) => {
                const category = categories.find((item) => item.id === tx.categoryId);
                const account = accounts.find((item) => item.id === tx.accountId);
                const relativeTime = tx.date === toDateString(now)
                  ? tForLanguage("today", language)
                  : recentDateFormatter.format(new Date(`${tx.date.slice(0, 10)}T12:00:00+08:00`));
                const signedAmount = tx.type === "income"
                  ? tx.amount
                  : tx.type === "expense"
                    ? -(tx.personalShareAmount ?? tx.amount)
                    : tx.type === "friend_payment"
                      ? tx.friendPaymentDirection === "sent" ? -tx.amount : tx.amount
                      : 0;
                const transactionType = tx.type === "transfer"
                  ? "Transfer"
                  : tx.type === "friend_payment"
                    ? tForLanguage(tx.friendPaymentDirection === "sent" ? "friendPaymentSent" : "friendPaymentReceived", language)
                    : tForLanguage(tx.type, language);
                const details = [
                  tx.note ? category?.name : undefined,
                  account?.name || tForLanguage("account", language),
                  relativeTime,
                ].filter(Boolean);
                return (
                  <button type="button" className="home-recent-row" key={tx.id} onClick={() => onOpenTransaction(tx.id)}>
                    <span className="home-recent-icon">
                      <CategoryIcon icon={category?.icon} color={category?.color} size={19} />
                    </span>
                    <span className="home-recent-copy">
                      <b>{tx.note || category?.name || transactionType}</b>
                      <small>{details.join(" · ")}</small>
                    </span>
                    <strong className={`home-recent-amount ${tx.type === "transfer" ? "transfer" : signedAmount >= 0 ? "income" : "expense"}`}>
                      {tx.type === "transfer"
                        ? formatProfileMoney(tx.amount)
                        : `${signedAmount >= 0 ? "+" : "-"}${formatProfileMoney(Math.abs(signedAmount))}`}
                    </strong>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      );
    }
    return null;
  };

  const selectedAccountName = selectedAccountId === "all"
    ? tForLanguage("allAccounts", language)
    : accounts.find((account) => account.id === selectedAccountId)?.name || tForLanguage("account", language);
  const accountFilter = (
    <label className="spending-pulse__account-filter">
      <Wallet size={15} aria-hidden="true" />
      <select
        value={selectedAccountId}
        onChange={(event) => setSelectedAccountId(event.target.value)}
        aria-label={tForLanguage("account", language)}
        title={selectedAccountName}
      >
        <option value="all">{tForLanguage("allAccounts", language)}</option>
        {accounts.map((account) => (
          <option value={account.id} key={account.id}>{account.name}</option>
        ))}
      </select>
      <ChevronDown size={14} aria-hidden="true" />
    </label>
  );
  const homeHasNoTransactions = transactionCount === 0;
  const homeIsLoaded = transactionCount !== undefined && accountResults !== undefined;

  return (
    <div className="home-dashboard" aria-busy={!homeIsLoaded}>
      {!homeIsLoaded ? null : accounts.length === 0 ? (
        <section
          className="home-account-onboarding"
          data-reduce-motion={sectionSettings.reduceMotion || (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches)}
        >
          <div className="home-account-onboarding__message">
            <span className="home-account-onboarding__mascot">
              <Kupi mood="calm" size={76} />
            </span>
            <span className="spending-pulse__bubble">
              <span className="spending-pulse__speaker">Kupi</span>
              <span className="spending-pulse__message">
                {language === "fil"
                  ? "Magsimula sa Step 1: magdagdag ng account. Pagkatapos, puwede ka nang magtala ng kita at gastos."
                  : "Start with Step 1: add an account. Then you can log income and expenses."}
              </span>
            </span>
          </div>
          <ol className="home-onboarding-steps" aria-label="Getting started">
            <li className="active"><span>1</span>{language === "fil" ? "Magdagdag ng account" : "Add an account"}</li>
            <li><span>2</span>{language === "fil" ? "Maglog ng kita o gastos" : "Log income or expense"}</li>
            <li><span>3</span>{language === "fil" ? "Tingnan ang iyong insights" : "Review your insights"}</li>
          </ol>
          <button type="button" className="kupit-primary-button" onClick={onAddAccount}>
            {tForLanguage("addAccount", language)}
          </button>
        </section>
      ) : homeHasNoTransactions ? (
        <section
          className="home-first-record"
          data-reduce-motion={sectionSettings.reduceMotion || (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches)}
        >
          <div className="home-first-record__guide">
            <span className="home-first-record__mascot"><Kupi mood="calm" size={64} /></span>
            <span className="home-first-record__bubble">
              <b>Kupi</b>
              <h2>{tForLanguage("homeFirstRecordTitle", language)}</h2>
              <p>{tForLanguage("homeFirstRecordBody", language)}</p>
            </span>
          </div>
          <div className="home-first-record-actions">
            <button type="button" className="kupit-primary-button" onClick={() => onAddTransaction("expense")}>
              {tForLanguage("addExpense", language)}
            </button>
            <button type="button" className="home-first-record-income" onClick={() => onAddTransaction("income")}>
              {tForLanguage("addIncome", language)}
            </button>
          </div>
        </section>
      ) : (
        <>
          {kupiNudge && (
            <section className="kupi-home-nudge" aria-label="Kupi suggestion">
              <span className="spending-pulse__mascot-wrap">
                <Kupi mood={kupiMascotMood(kupiNudge.mood)} size={48} />
              </span>
              <span className="spending-pulse__bubble">
                <span className="spending-pulse__speaker">Kupi</span>
                <span className="spending-pulse__message">{kupiNudgeMessage}</span>
              </span>
              <div className="kupi-home-nudge__actions">
                <button type="button" className="kupi-home-nudge__open" onClick={() => onOpenKupi(kupiNudgeMessage, kupiNudge.mood)}>
                  <MessageCircle size={15} aria-hidden="true" />
                  Ask Kupi
                </button>
                <button type="button" className="kupi-home-nudge__dismiss" onClick={() => dismissKupiNudge(kupiNudge)} aria-label="Dismiss Kupi suggestion" title="Dismiss">
                  <X size={17} aria-hidden="true" />
                </button>
              </div>
            </section>
          )}
          <SpendingPulse
            profileId={profileId}
            accountId={selectedAccountId}
            accountFilter={accountFilter}
            period={period}
            onPeriodChange={setPeriod}
            budgetCycleStartDay={sectionSettings.budgetCycleStartDay}
            weekStartsOn={sectionSettings.weekStartsOn}
            tone={sectionSettings.spendingPulseTone}
            language={language}
            reduceMotion={sectionSettings.reduceMotion}
          />
          {renderSection("categories")}
        </>
      )}
      <div className="home-section-list">
        {homeIsLoaded && accounts.length > 0 && sectionOrder.filter((sectionId) => !["categories", "upcoming", "recent"].includes(sectionId)).map((sectionId) => (
          homeHasNoTransactions && sectionId !== "budgets"
            ? null
            : renderSection(sectionId)
        ))}
        {homeIsLoaded && accounts.length > 0 && renderSection("upcoming")}
        {homeIsLoaded && accounts.length > 0 && renderSection("recent")}
      </div>
    </div>
  );
}
