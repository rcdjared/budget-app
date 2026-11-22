import React, { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Calendar,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Landmark,
  ReceiptText,
  Repeat2,
  TrendingDown,
  TrendingUp,
  UserRound,
  Wallet,
} from "lucide-react";
import { db } from "@/db/schema";
import { profileRecords } from "@/db/profileScope";
import { formatMoney } from "@/domain/money";
import { computeInsights } from "@/domain/homeInsights";
import { getHomePeriodRange, type HomePeriod } from "@/domain/homePeriod";
import { getBudgetSpendSnapshot } from "@/lib/notificationEngine";
import { loadAppSettings } from "@/lib/settings";
import { tForLanguage } from "@/lib/localization";
import { toDateString } from "@/lib/format";
import type {
  Account,
  Budget,
  Category,
  Debt,
  FriendLedgerEntry,
  Recurring,
  Transaction,
} from "@/domain/types";
import { CategoryIcon } from "@/components/CategoryIcon";

interface FinsightsPageProps {
  profileId: string;
  onOpenHelp?: () => void;
  showNetWorth?: boolean;
  onAddTransaction: (type: "expense" | "income") => void;
  onHistory: (filters?: { accountId?: string; categoryId?: string; startDate?: string; endDate?: string }) => void;
  onPlan: () => void;
  onOpenTransaction: (transactionId: string) => void;
  onOpenDebt: () => void;
  onOpenRecurring: () => void;
  onOpenFriends: () => void;
  onOpenBudget: () => void;
}

type SectionId = "netBalance" | "totals" | "insight" | "trend" | "categories" | "budgets" | "upcoming" | "recent";

const DEFAULT_SECTION_ORDER: SectionId[] = [
  "netBalance",
  "totals",
  "insight",
  "trend",
  "categories",
  "budgets",
  "upcoming",
  "recent",
];

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
  onAddTransaction,
  onHistory,
  onPlan,
  onOpenTransaction,
  onOpenDebt,
  onOpenRecurring,
  onOpenFriends,
  onOpenBudget,
}: FinsightsPageProps) {
  const language = loadAppSettings().language;
  const [selectedAccountId, setSelectedAccountId] = useState("all");
  const [period, setPeriod] = useState<HomePeriod>(() =>
    (localStorage.getItem(`kupit-home-period-${profileId}`) as HomePeriod) || "month"
  );
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [activeTab, setActiveTab] = useState<"expense" | "income">("expense");
  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [periodDropdownOpen, setPeriodDropdownOpen] = useState(false);

  useEffect(() => {
    setSelectedAccountId("all");
    setPeriod((localStorage.getItem(`kupit-home-period-${profileId}`) as HomePeriod) || "month");
    setCurrentDate(new Date());
  }, [profileId]);

  const accounts = useLiveQuery(
    () => profileRecords(db.accounts, profileId).filter((account) => !account.deletedAt && !account.isArchived).toArray(),
    [profileId],
    []
  );
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
  const sectionOrder = (sectionSettings.homeSectionOrder || DEFAULT_SECTION_ORDER) as SectionId[];

  const now = new Date();
  const range = useMemo(
    () => getHomePeriodRange(period, currentDate, language === "fil" ? "fil-PH" : "en-US", now),
    [period, currentDate, language]
  );

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
    () => hiddenSections.has("budgets")
      ? profileRecords(db.budgets, profileId).filter((budget) => !budget.deletedAt).toArray()
      : Promise.resolve([] as Budget[]),
    [profileId, hiddenSections.has("budgets")],
    [] as Budget[]
  );
  const budgetTransactions = useLiveQuery(
    () => hiddenSections.has("budgets")
      ? profileRecords(db.transactions, profileId).filter((transaction) => !transaction.deletedAt && !transaction.cancelledAt).toArray()
      : Promise.resolve([] as Transaction[]),
    [profileId, hiddenSections.has("budgets")],
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
    () => hiddenSections.has("upcoming")
      ? profileRecords(db.friendLedger, profileId).filter((item) => !item.deletedAt && item.direction === "owed_to_me").toArray()
      : Promise.resolve([] as FriendLedgerEntry[]),
    [profileId, hiddenSections.has("upcoming")],
    [] as FriendLedgerEntry[]
  );
  const recentTransactions = useLiveQuery(
    () => hiddenSections.has("recent")
      ? profileRecords(db.transactions, profileId)
        .filter((transaction) => !transaction.deletedAt && !transaction.cancelledAt && matchesAccount(transaction, selectedAccountId))
        .reverse()
        .sortBy("date")
      : Promise.resolve([] as Transaction[]),
    [profileId, selectedAccountId, hiddenSections.has("recent")],
    [] as Transaction[]
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
        ? tForLanguage("vsLastMonth", language)
        : tForLanguage("vsLastYear", language);

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
    if (period === "week") {
      const start = new Date(`${range.start}T00:00:00`);
      return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, index) => {
        const date = new Date(start);
        date.setDate(start.getDate() + index);
        const key = toDateString(date);
        return {
          label,
          amount: filteredTxs.filter((tx) => tx.type === activeTab && tx.date === key)
            .reduce((sum, tx) => sum + (activeTab === "expense" ? (tx.personalShareAmount ?? tx.amount) : tx.amount), 0),
        };
      });
    }
    if (period === "month") {
      const lastDay = Number(range.end.slice(-2));
      return [
        ["W1", 1, 7],
        ["W2", 8, 14],
        ["W3", 15, 21],
        ["W4", 22, lastDay],
      ].map(([label, startDay, endDay]) => ({
        label: String(label),
        amount: filteredTxs.filter((tx) => tx.type === activeTab)
          .filter((tx) => {
            const day = Number(tx.date.slice(-2));
            return day >= Number(startDay) && day <= Number(endDay);
          })
          .reduce((sum, tx) => sum + (activeTab === "expense" ? (tx.personalShareAmount ?? tx.amount) : tx.amount), 0),
      }));
    }
    const year = currentDate.getFullYear();
    return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((label, index) => {
      const prefix = `${year}-${String(index + 1).padStart(2, "0")}`;
      return {
        label,
        amount: filteredTxs.filter((tx) => tx.type === activeTab && tx.date.startsWith(prefix))
          .reduce((sum, tx) => sum + (activeTab === "expense" ? (tx.personalShareAmount ?? tx.amount) : tx.amount), 0),
      };
    });
  }, [period, range.start, range.end, filteredTxs, activeTab, currentDate]);

  const maxTrendAmount = Math.max(...trendBars.map((bar) => bar.amount), 10000);

  const insightCandidates = useMemo(() => computeInsights({
    transactions: filteredTxs,
    previousTransactions: previousTxs,
    budgets,
    categories,
    period,
    now,
    locale: language,
  }), [filteredTxs, previousTxs, budgets, categories, period, language]);

  const budgetSnapshots = useMemo(
    () => getBudgetSpendSnapshot(budgets, budgetTransactions, toDateString(now))
      .sort((a, b) => (b.spent / b.limit) - (a.spent / a.limit))
      .slice(0, 3),
    [budgets, budgetTransactions]
  );

  const upcomingItems = useMemo(() => {
    if (!hiddenSections.has("upcoming")) return [];
    const today = toDateString(now);
    const end = toDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
    const items: {
      id: string;
      date: string;
      title: string;
      amount: number;
      kind: "recurring" | "debt" | "friend";
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
    for (const item of debts as Debt[]) {
      if (item.dueDate && item.dueDate >= today && item.dueDate <= end) {
        items.push({
          id: item.id,
          date: item.dueDate,
          title: item.counterparty,
          amount: item.direction === "owed_to_me" ? item.principal : -item.principal,
          kind: "debt",
        });
      }
    }
    for (const item of friendLedger as FriendLedgerEntry[]) {
      if (item.expectedBy && item.expectedBy >= today && item.expectedBy <= end
        && (selectedAccountId === "all" || !item.accountId || item.accountId === selectedAccountId)) {
        items.push({
          id: item.id,
          date: item.expectedBy,
          title: item.note || tForLanguage("owedToMe", language),
          amount: item.amount,
          kind: "friend",
          accountId: item.accountId,
        });
      }
    }
    return items.sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  }, [recurring, debts, friendLedger, selectedAccountId, hiddenSections, now, language]);

  const navigatePeriod = (direction: -1 | 1) => {
    setCurrentDate((date) => {
      const next = new Date(date);
      if (period === "day") next.setDate(next.getDate() + direction);
      else if (period === "week") next.setDate(next.getDate() + 7 * direction);
      else if (period === "month") next.setMonth(next.getMonth() + direction);
      else next.setFullYear(next.getFullYear() + direction);
      return next;
    });
  };

  const setHomePeriod = (next: HomePeriod) => {
    setPeriod(next);
    localStorage.setItem(`kupit-home-period-${profileId}`, next);
  };

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

  const periodLabels: Record<HomePeriod, string> = {
    day: tForLanguage("day", language),
    week: tForLanguage("week", language),
    month: tForLanguage("month", language),
    year: tForLanguage("year", language),
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
        <section className="home-section-card" key={sectionId}>
          <div className="home-section-heading">
            <h2>{tForLanguage("categories", language)}</h2>
            <button type="button" onClick={() => openHistory()}>{tForLanguage("seeAll", language)}</button>
          </div>
          <div className="home-category-list">
            {categoryBreakdown.map((row) => (
              <button
                type="button"
                className="home-category-row"
                key={row.categoryId}
                onClick={() => row.categoryId !== "__other" ? openHistory(row.categoryId === "__uncategorized" ? undefined : row.categoryId) : openHistory()}
              >
                <CategoryIcon
                  icon={row.category?.icon}
                  color={row.category?.color}
                  size={18}
                />
                <span className="home-category-copy">
                  <b>{row.categoryId === "__other" ? tForLanguage("other", language) : row.category?.name || tForLanguage("other", language)}</b>
                  <span className="home-category-bar"><i style={{ width: `${Math.min(100, row.percentage)}%` }} /></span>
                </span>
                <span className="home-category-value">
                  <b>{formatProfileMoney(row.amount)}</b>
                  <small>{Math.round(row.percentage)}%</small>
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
      if (!upcomingItems.length) return null;
      return (
        <section className="home-section-card" key={sectionId}>
          <div className="home-section-heading">
            <h2>{tForLanguage("upcoming", language)}</h2>
          </div>
          <div className="home-upcoming-list">
            {upcomingItems.map((item) => {
              const distance = daysBetween(toDateString(now), item.date);
              const relative = distance === 0 ? tForLanguage("today", language) : distance === 1 ? tForLanguage("tomorrow", language) : item.date;
              const open = item.kind === "recurring" ? onOpenRecurring : item.kind === "debt" ? onOpenDebt : onOpenFriends;
              const Icon = item.kind === "recurring" ? Repeat2 : item.kind === "debt" ? Landmark : UserRound;
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
        </section>
      );
    }
    if (sectionId === "recent") {
      const rows = (recentTransactions as Transaction[]).slice(0, 5);
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
                  : tx.date;
                const signedAmount = tx.type === "income" ? tx.amount : tx.type === "expense" ? -(tx.personalShareAmount ?? tx.amount) : 0;
                return (
                  <button type="button" className="home-recent-row" key={tx.id} onClick={() => onOpenTransaction(tx.id)}>
                    <CategoryIcon icon={category?.icon} color={category?.color} size={18} />
                    <span><b>{tx.note || category?.name || tForLanguage("other", language)}</b><small>{account?.name || tForLanguage("account", language)} · {relativeTime}</small></span>
                    {tx.type !== "transfer" && (
                      <strong className={signedAmount >= 0 ? "income" : "expense"}>
                        {signedAmount >= 0 ? "+" : "-"}{formatProfileMoney(Math.abs(signedAmount))}
                      </strong>
                    )}
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

  return (
    <div className="home-dashboard">
      <div className="finsights-filter-row" aria-label="Home filters">
        <div className="filter-pill-wrapper">
          <button type="button" className="filter-pill-btn" onClick={() => { setAccountDropdownOpen((open) => !open); setPeriodDropdownOpen(false); }} aria-label={`${tForLanguage("account", language)}: ${selectedAccountName}`}>
            <span className="filter-pill-icon"><Wallet size={16} /></span>
            <span className="filter-pill-text"><small>{tForLanguage("account", language)}</small><b>{selectedAccountName}</b></span>
            <ChevronDown size={16} />
          </button>
          {accountDropdownOpen && (
            <div className="filter-dropdown-menu">
              <button type="button" className={selectedAccountId === "all" ? "active" : ""} onClick={() => { setSelectedAccountId("all"); setAccountDropdownOpen(false); }}>{tForLanguage("allAccounts", language)}</button>
              {accounts.map((account) => (
                <button type="button" key={account.id} className={selectedAccountId === account.id ? "active" : ""} onClick={() => { setSelectedAccountId(account.id); setAccountDropdownOpen(false); }}>{account.name}</button>
              ))}
            </div>
          )}
        </div>
        <div className="filter-pill-wrapper">
          <button type="button" className="filter-pill-btn" onClick={() => { setPeriodDropdownOpen((open) => !open); setAccountDropdownOpen(false); }} aria-label={`${tForLanguage("period", language)}: ${periodLabels[period]}`}>
            <span className="filter-pill-icon"><Calendar size={16} /></span>
            <span className="filter-pill-text"><small>{tForLanguage("period", language)}</small><b>{periodLabels[period]}</b></span>
            <ChevronDown size={16} />
          </button>
          {periodDropdownOpen && (
            <div className="filter-dropdown-menu">
              {(["day", "week", "month", "year"] as HomePeriod[]).map((option) => (
                <button type="button" key={option} className={period === option ? "active" : ""} onClick={() => { setHomePeriod(option); setPeriodDropdownOpen(false); }}>{periodLabels[option]}</button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="home-period-nav">
        <button type="button" onClick={() => navigatePeriod(-1)} aria-label="Previous period">‹</button>
        <b>{range.label}</b>
        <button type="button" onClick={() => navigatePeriod(1)} aria-label="Next period">›</button>
      </div>
      <div className="home-section-list">
        {sectionOrder.map(renderSection)}
      </div>
    </div>
  );
}
