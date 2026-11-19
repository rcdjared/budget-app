import React, { useState, useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Wallet,
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  HelpCircle,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { db } from "@/db/schema";
import { formatMoney } from "@/domain/money";
import { toDateString } from "@/lib/format";
import type { Account, Category, Transaction } from "@/domain/types";
import { CategoryIcon } from "@/components/CategoryIcon";

type PeriodType = "day" | "week" | "month" | "year";

interface FinsightsPageProps {
  profileId: string;
  onOpenHelp?: () => void;
}

export function FinsightsPage({ profileId, onOpenHelp }: FinsightsPageProps) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>("all");
  const [period, setPeriod] = useState<PeriodType>("day");
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());
  const [activeTab, setActiveTab] = useState<"expense" | "income">("expense");

  const [accountDropdownOpen, setAccountDropdownOpen] = useState(false);
  const [periodDropdownOpen, setPeriodDropdownOpen] = useState(false);

  // Queries
  const accounts = useLiveQuery(
    () =>
      db.accounts
        .where({ profileId })
        .filter((a) => !a.deletedAt && !a.isArchived)
        .toArray(),
    [profileId],
    []
  );

  const categories = useLiveQuery(
    () => db.categories.where({ profileId }).toArray(),
    [profileId],
    []
  );

  const transactions = useLiveQuery(
    () =>
      db.transactions
        .where({ profileId })
        .filter((t) => !t.deletedAt)
        .toArray(),
    [profileId],
    []
  );

  // Calculate Date Range based on period and currentDate
  const { startStr, endStr, prevStartStr, prevEndStr, displayLabel } = useMemo(() => {
    const d = new Date(currentDate);

    if (period === "day") {
      const start = toDateString(d);
      const prevD = new Date(d);
      prevD.setDate(prevD.getDate() - 1);
      const prevStart = toDateString(prevD);

      const label = d.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });

      return {
        startStr: start,
        endStr: start,
        prevStartStr: prevStart,
        prevEndStr: prevStart,
        displayLabel: label,
      };
    } else if (period === "week") {
      const day = d.getDay();
      // start week on Monday
      const diffToMonday = (day + 6) % 7;
      const monday = new Date(d);
      monday.setDate(d.getDate() - diffToMonday);

      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);

      const prevMonday = new Date(monday);
      prevMonday.setDate(monday.getDate() - 7);
      const prevSunday = new Date(sunday);
      prevSunday.setDate(sunday.getDate() - 7);

      const monLabel = monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const sunLabel = sunday.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

      return {
        startStr: toDateString(monday),
        endStr: toDateString(sunday),
        prevStartStr: toDateString(prevMonday),
        prevEndStr: toDateString(prevSunday),
        displayLabel: `${monLabel} – ${sunLabel}`,
      };
    } else if (period === "month") {
      const y = d.getFullYear();
      const m = d.getMonth();
      const firstDay = new Date(y, m, 1);
      const lastDay = new Date(y, m + 1, 0);

      const prevFirstDay = new Date(y, m - 1, 1);
      const prevLastDay = new Date(y, m, 0);

      const label = d.toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      });

      return {
        startStr: toDateString(firstDay),
        endStr: toDateString(lastDay),
        prevStartStr: toDateString(prevFirstDay),
        prevEndStr: toDateString(prevLastDay),
        displayLabel: label,
      };
    } else {
      // year
      const y = d.getFullYear();
      const firstDay = new Date(y, 0, 1);
      const lastDay = new Date(y, 11, 31);

      const prevFirstDay = new Date(y - 1, 0, 1);
      const prevLastDay = new Date(y - 1, 11, 31);

      return {
        startStr: toDateString(firstDay),
        endStr: toDateString(lastDay),
        prevStartStr: toDateString(prevFirstDay),
        prevEndStr: toDateString(prevLastDay),
        displayLabel: `${y}`,
      };
    }
  }, [period, currentDate]);

  // Navigate Date
  const handlePrev = () => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      if (period === "day") next.setDate(next.getDate() - 1);
      else if (period === "week") next.setDate(next.getDate() - 7);
      else if (period === "month") next.setMonth(next.getMonth() - 1);
      else if (period === "year") next.setFullYear(next.getFullYear() - 1);
      return next;
    });
  };

  const handleNext = () => {
    setCurrentDate((prev) => {
      const next = new Date(prev);
      if (period === "day") next.setDate(next.getDate() + 1);
      else if (period === "week") next.setDate(next.getDate() + 7);
      else if (period === "month") next.setMonth(next.getMonth() + 1);
      else if (period === "year") next.setFullYear(next.getFullYear() + 1);
      return next;
    });
  };

  // Filter transactions
  const filteredTxs = useMemo(() => {
    return transactions.filter((t) => {
      if (t.date < startStr || t.date > endStr) return false;
      if (selectedAccountId !== "all") {
        if (t.type === "transfer") {
          return t.accountId === selectedAccountId || t.toAccountId === selectedAccountId;
        }
        return t.accountId === selectedAccountId;
      }
      return true;
    });
  }, [transactions, startStr, endStr, selectedAccountId]);

  // Previous period transactions for comparison
  const prevPeriodTxs = useMemo(() => {
    return transactions.filter((t) => {
      if (t.date < prevStartStr || t.date > prevEndStr) return false;
      if (selectedAccountId !== "all") {
        if (t.type === "transfer") {
          return t.accountId === selectedAccountId || t.toAccountId === selectedAccountId;
        }
        return t.accountId === selectedAccountId;
      }
      return true;
    });
  }, [transactions, prevStartStr, prevEndStr, selectedAccountId]);

  // Net Balance = Total Income - Total Expense for selected period & account
  const { totalIncome, totalExpense, netBalance } = useMemo(() => {
    let inc = 0;
    let exp = 0;
    for (const t of filteredTxs) {
      if (t.type === "income") inc += t.amount;
      if (t.type === "expense") exp += t.amount;
    }
    return {
      totalIncome: inc,
      totalExpense: exp,
      netBalance: inc - exp,
    };
  }, [filteredTxs]);

  const prevTotal = useMemo(() => {
    return prevPeriodTxs
      .filter((t) => t.type === activeTab)
      .reduce((sum, t) => sum + t.amount, 0);
  }, [prevPeriodTxs, activeTab]);

  const currentTotal = activeTab === "expense" ? totalExpense : totalIncome;

  // Comparison %
  const comparison = useMemo(() => {
    if (prevTotal === 0 && currentTotal === 0) return { percent: 0, direction: "same" };
    if (prevTotal === 0) return { percent: 100, direction: "up" };
    if (currentTotal === 0) return { percent: 100, direction: "down" };

    const diff = currentTotal - prevTotal;
    const pct = Math.round((Math.abs(diff) / prevTotal) * 100);
    return {
      percent: pct,
      direction: diff > 0 ? "up" : diff < 0 ? "down" : "same",
    };
  }, [currentTotal, prevTotal]);

  const periodComparisonLabel =
    period === "day"
      ? "vs. last day"
      : period === "week"
      ? "vs. last week"
      : period === "month"
      ? "vs. last month"
      : "vs. last year";

  // Category breakdown for activeTab
  const categoryBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filteredTxs) {
      if (t.type === activeTab && t.categoryId) {
        map.set(t.categoryId, (map.get(t.categoryId) || 0) + t.amount);
      }
    }
    const list: { category: Category | undefined; amount: number; pct: number }[] = [];
    for (const [catId, amount] of map.entries()) {
      const cat = categories.find((c) => c.id === catId);
      const pct = currentTotal > 0 ? Math.round((amount / currentTotal) * 100) : 0;
      list.push({ category: cat, amount, pct });
    }
    return list.sort((a, b) => b.amount - a.amount);
  }, [filteredTxs, activeTab, categories, currentTotal]);

  // Trend bars data
  const trendBars = useMemo(() => {
    if (period === "day") {
      // 24 hours or 4 segments of day
      const segments = [
        { label: "Morning", startHour: 6, endHour: 12, amount: 0 },
        { label: "Afternoon", startHour: 12, endHour: 18, amount: 0 },
        { label: "Evening", startHour: 18, endHour: 24, amount: 0 },
        { label: "Night", startHour: 0, endHour: 6, amount: 0 },
      ];
      for (const t of filteredTxs) {
        if (t.type === activeTab) {
          const hour = new Date(t.createdAt || t.date).getHours();
          const seg = segments.find((s) => hour >= s.startHour && hour < s.endHour) || segments[0];
          seg.amount += t.amount;
        }
      }
      return segments.map((s) => ({ label: s.label, amount: s.amount }));
    } else if (period === "week") {
      // 7 days of the week (Mon -> Sun)
      const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const start = new Date(startStr);
      const data: { label: string; dateStr: string; amount: number }[] = [];
      for (let i = 0; i < 7; i++) {
        const cur = new Date(start);
        cur.setDate(start.getDate() + i);
        const ds = toDateString(cur);
        const amt = filteredTxs
          .filter((t) => t.type === activeTab && t.date === ds)
          .reduce((sum, t) => sum + t.amount, 0);
        data.push({ label: days[i], dateStr: ds, amount: amt });
      }
      return data;
    } else if (period === "month") {
      // 4 weeks of the month
      const start = new Date(startStr);
      const end = new Date(endStr);
      const totalDays = end.getDate();
      const weeks = [
        { label: "W1 (1-7)", startDay: 1, endDay: 7, amount: 0 },
        { label: "W2 (8-14)", startDay: 8, endDay: 14, amount: 0 },
        { label: "W3 (15-21)", startDay: 15, endDay: 21, amount: 0 },
        { label: `W4 (22-${totalDays})`, startDay: 22, endDay: totalDays, amount: 0 },
      ];
      for (const t of filteredTxs) {
        if (t.type === activeTab) {
          const dayNum = parseInt(t.date.split("-")[2], 10);
          const w = weeks.find((wk) => dayNum >= wk.startDay && dayNum <= wk.endDay) || weeks[3];
          w.amount += t.amount;
        }
      }
      return weeks;
    } else {
      // 12 months
      const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const y = new Date(startStr).getFullYear();
      return months.map((m, idx) => {
        const mStr = String(idx + 1).padStart(2, "0");
        const prefix = `${y}-${mStr}`;
        const amt = filteredTxs
          .filter((t) => t.type === activeTab && t.date.startsWith(prefix))
          .reduce((sum, t) => sum + t.amount, 0);
        return { label: m, amount: amt };
      });
    }
  }, [period, startStr, endStr, filteredTxs, activeTab]);

  const maxTrendAmount = useMemo(() => {
    const max = Math.max(...trendBars.map((b) => b.amount), 0);
    return max > 0 ? max : 200000; // ₱2,000 default scale
  }, [trendBars]);

  const selectedAccountName =
    selectedAccountId === "all"
      ? "All accounts"
      : accounts.find((a) => a.id === selectedAccountId)?.name || "Account";

  const periodLabels: Record<PeriodType, string> = {
    day: "Day",
    week: "Week",
    month: "Month",
    year: "Year",
  };

  return (
    <div className="content finsights-container">
      {/* Top Title Bar */}
      <header className="page-header finsights-header">
        <div>
          <h1 className="finsights-title">Money insights</h1>
        </div>
        <button
          className="help-circle-btn"
          onClick={onOpenHelp}
          aria-label="Insights info"
          title="Finsights guide"
        >
          <HelpCircle size={22} />
        </button>
      </header>

      {/* Top Filter Pills: Account and Period */}
      <div className="finsights-filter-row">
        {/* Account Selector Pill */}
        <div className="filter-pill-wrapper">
          <button
            type="button"
            className="filter-pill-btn"
            onClick={() => {
              setAccountDropdownOpen(!accountDropdownOpen);
              setPeriodDropdownOpen(false);
            }}
          >
            <div className="filter-pill-icon">
              <Wallet size={16} />
            </div>
            <div className="filter-pill-text">
              <span className="filter-pill-sub">Account</span>
              <strong className="filter-pill-val">{selectedAccountName}</strong>
            </div>
            <ChevronDown size={16} className="pill-arrow" />
          </button>

          {accountDropdownOpen && (
            <div className="filter-dropdown-menu">
              <button
                className={`filter-dropdown-item ${selectedAccountId === "all" ? "active" : ""}`}
                onClick={() => {
                  setSelectedAccountId("all");
                  setAccountDropdownOpen(false);
                }}
              >
                All accounts
              </button>
              {accounts.map((acc) => (
                <button
                  key={acc.id}
                  className={`filter-dropdown-item ${selectedAccountId === acc.id ? "active" : ""}`}
                  onClick={() => {
                    setSelectedAccountId(acc.id);
                    setAccountDropdownOpen(false);
                  }}
                >
                  <span
                    className="acc-color-dot"
                    style={{ backgroundColor: acc.color || "var(--primary)" }}
                  />
                  {acc.name}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Period Selector Pill */}
        <div className="filter-pill-wrapper">
          <button
            type="button"
            className="filter-pill-btn"
            onClick={() => {
              setPeriodDropdownOpen(!periodDropdownOpen);
              setAccountDropdownOpen(false);
            }}
          >
            <div className="filter-pill-icon">
              <Calendar size={16} />
            </div>
            <div className="filter-pill-text">
              <span className="filter-pill-sub">Period</span>
              <strong className="filter-pill-val">{periodLabels[period]}</strong>
            </div>
            <ChevronDown size={16} className="pill-arrow" />
          </button>

          {periodDropdownOpen && (
            <div className="filter-dropdown-menu">
              {(["day", "week", "month", "year"] as PeriodType[]).map((p) => (
                <button
                  key={p}
                  className={`filter-dropdown-item ${period === p ? "active" : ""}`}
                  onClick={() => {
                    setPeriod(p);
                    setPeriodDropdownOpen(false);
                  }}
                >
                  {periodLabels[p]}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Date Navigator & Net Balance Card */}
      <section className="finsights-date-card">
        <div className="date-nav-row">
          <button
            type="button"
            className="date-nav-btn"
            onClick={handlePrev}
            aria-label="Previous period"
          >
            <ChevronLeft size={20} />
          </button>
          <span className="date-nav-text">{displayLabel}</span>
          <button
            type="button"
            className="date-nav-btn"
            onClick={handleNext}
            aria-label="Next period"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="net-balance-content">
          <small className="net-balance-label">NET BALANCE</small>
          <strong
            className={`net-balance-value ${
              netBalance >= 0 ? "text-emerald" : "text-rose"
            }`}
          >
            {netBalance >= 0 ? "+" : "−"}
            {formatMoney(Math.abs(netBalance))}
          </strong>
        </div>
      </section>

      {/* Segmented Switch: Expense vs Income */}
      <div className="finsights-tab-switch">
        <button
          type="button"
          className={`tab-switch-pill ${activeTab === "expense" ? "active-expense" : ""}`}
          onClick={() => setActiveTab("expense")}
        >
          Expense
        </button>
        <button
          type="button"
          className={`tab-switch-pill ${activeTab === "income" ? "active-income" : ""}`}
          onClick={() => setActiveTab("income")}
        >
          Income
        </button>
      </div>

      {/* Total Metric Card with Comparison Badge */}
      <section
        className={`finsights-total-card ${
          activeTab === "expense" ? "expense-tint" : "income-tint"
        }`}
      >
        <div className="total-card-head">
          <div className="total-card-left">
            <span className="total-card-label">
              TOTAL {activeTab === "expense" ? "EXPENSES" : "INCOME"}
            </span>
            <strong className="total-card-value">
              {formatMoney(currentTotal)}
            </strong>
          </div>

          <div
            className={`comparison-badge ${
              comparison.direction === "down"
                ? "badge-down"
                : comparison.direction === "up"
                ? "badge-up"
                : "badge-neutral"
            }`}
          >
            {comparison.direction === "down" ? (
              <TrendingDown size={14} />
            ) : (
              <TrendingUp size={14} />
            )}
            <span>
              {comparison.direction === "down" ? "▼" : "▲"}{" "}
              {comparison.percent}%
            </span>
            <small className="comp-subtext">{periodComparisonLabel}</small>
          </div>
        </div>

        {/* Category Breakdown inside the card */}
        <div className="category-breakdown-area">
          {categoryBreakdown.length === 0 ? (
            <div className="no-record-msg">
              No {activeTab}s recorded
            </div>
          ) : (
            <div className="cat-breakdown-list">
              {categoryBreakdown.map(({ category, amount, pct }) => (
                <div key={category?.id || "other"} className="breakdown-row">
                  <div className="breakdown-cat-header">
                    <span className="breakdown-cat-title">
                      <CategoryIcon
                        icon={category?.icon}
                        color={category?.color}
                        size={16}
                      />
                      <span>{category?.name || "Uncategorized"}</span>
                    </span>
                    <strong className="breakdown-amount">
                      {formatMoney(amount)} <small>({pct}%)</small>
                    </strong>
                  </div>
                  <div className="breakdown-bar-track">
                    <div
                      className="breakdown-bar-fill"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: category?.color || (activeTab === "expense" ? "#E11D48" : "#059669"),
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Trend Chart Card */}
      <section className="finsights-chart-card">
        <div className="chart-card-header">
          <span className="chart-card-title">
            {activeTab.toUpperCase()} TREND
          </span>
        </div>

        <div className="trend-chart-container">
          {/* Y-Axis Labels matching reference: P0, P0.5K, P1K, P1.5K, P2K */}
          <div className="trend-y-axis">
            <span>₱{Math.round(maxTrendAmount / 100000)}k</span>
            <span>₱{Math.round((maxTrendAmount * 0.75) / 100000)}k</span>
            <span>₱{Math.round((maxTrendAmount * 0.5) / 100000)}k</span>
            <span>₱{Math.round((maxTrendAmount * 0.25) / 100000)}k</span>
            <span>₱0</span>
          </div>

          <div className="trend-bars-wrapper">
            {trendBars.map((bar, idx) => {
              const heightPercent =
                maxTrendAmount > 0 ? Math.min(100, Math.round((bar.amount / maxTrendAmount) * 100)) : 0;
              return (
                <div key={idx} className="trend-bar-column">
                  <div className="trend-bar-track">
                    <div
                      className={`trend-bar-pill ${
                        activeTab === "expense" ? "expense-bar" : "income-bar"
                      }`}
                      style={{
                        height: `${Math.max(bar.amount > 0 ? 8 : 2, heightPercent)}%`,
                      }}
                      title={`${bar.label}: ${formatMoney(bar.amount)}`}
                    />
                  </div>
                  <span className="trend-bar-label">{bar.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
