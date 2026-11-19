import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  Banknote,
  ChevronRight,
  CalendarClock,
  HandCoins,
  Home,
  MessageCircle,
  PiggyBank,
  Plus,
  ReceiptText,
  Search,
  Settings,
  Moon,
  Sun,
  Trash2,
  TrendingUp,
  WalletCards,
  X,
  Edit2,
  HelpCircle,
} from "lucide-react";
import { db } from "@/db/schema";
import { initializeAppData, getAccountTemplates } from "@/db/seed";
import { createAccount, softDeleteAccount } from "@/db/repositories/accounts";
import { createTransaction, softDeleteTransaction } from "@/db/repositories/transactions";
import { computeAccountBalance, computeMonthlyTotals, computeNetWorth } from "@/domain/balances";
import { formatMoney, parseMoney } from "@/domain/money";
import { formatRelativeDate, getCurrentMonthRange, toDateString } from "@/lib/format";
import { ensureDailySnapshot, exportJsonBackup, exportTransactionsCsv, importJsonBackup } from "@/lib/backup";
import { canAffordAmount, generateForecast, sumLiquidAccountBalance } from "@/domain/forecast";
import { parseMultipleTransactions } from "@/domain/parser";
import { cloudSyncAvailable, supabase } from "@/lib/supabase";
import { syncLocalData } from "@/sync/sync";
import type { Session } from "@supabase/supabase-js";
import {
  calculateCentavos,
  centavosToEntry,
  percentCentavos,
  type CalculatorOperator,
} from "@/domain/calculator";
import type { Account, AccountType, Category, Transaction, TransactionType } from "@/domain/types";
import { CategoryIcon } from "@/components/CategoryIcon";
import { CategoryManagerSheet } from "@/components/CategoryManagerSheet";
import { FinsightsPage } from "@/components/FinsightsPage";

type Tab = "home" | "wallet" | "finsights" | "history" | "plan";
type ThemePreference = "system" | "light" | "dark";

const tabItems: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "wallet", label: "Wallet", icon: WalletCards },
  { id: "finsights", label: "Finsights", icon: TrendingUp },
  { id: "history", label: "History", icon: ReceiptText },
];

function App() {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [addOpen, setAddOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    const saved = localStorage.getItem("kupit-theme");
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const [online, setOnline] = useState(navigator.onLine);
  const [storagePersisted, setStoragePersisted] = useState<boolean | null>(null);
  const [installHintOpen, setInstallHintOpen] = useState(false);
  useRegisterSW({ immediate: true });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const dark =
        themePreference === "dark" || (themePreference === "system" && media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", dark ? "#0D1916" : "#1F7A5A");
    };
    applyTheme();
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [themePreference]);

  useEffect(() => {
    localStorage.setItem("kupit-theme", themePreference);
  }, [themePreference]);

  useEffect(() => {
    initializeAppData()
      .then(async (id) => {
        await ensureDailySnapshot();
        setProfileId(id);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    navigator.storage
      ?.persist?.()
      .then(setStoragePersisted)
      .catch(() => setStoragePersisted(false));
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const dismissed = localStorage.getItem("pesopulse-install-hint-dismissed");
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!dismissed && !standalone) setInstallHintOpen(true);
  }, []);

  if (!profileId) {
    return (
      <main className="grid h-dvh place-items-center bg-background">
        <div className="pulse-loader" aria-label="Loading Kupit" />
      </main>
    );
  }

  return (
    <main className="app-shell">
      {!online && (
        <div className="offline-banner">Offline — changes remain saved on this device</div>
      )}

      <div className="page-scroll">
        {tab === "home" && (
          <HomePage
            profileId={profileId}
            onAdd={() => setAddOpen(true)}
            onAddAccount={() => setAccountOpen(true)}
            onChat={() => setChatOpen(true)}
            onSettings={() => setSettingsOpen(true)}
            onPlan={() => setTab("plan")}
            onWallet={() => setTab("wallet")}
            onHistory={() => setTab("history")}
            onFinsights={() => setTab("finsights")}
          />
        )}
        {tab === "wallet" && (
          <AccountsPage profileId={profileId} onAdd={() => setAccountOpen(true)} />
        )}
        {tab === "finsights" && (
          <FinsightsPage
            profileId={profileId}
            onOpenHelp={() => setHelpOpen(true)}
          />
        )}
        {tab === "plan" && (
          <BudgetsPage
            profileId={profileId}
            onOpenCategories={() => setCategoryManagerOpen(true)}
          />
        )}
        {tab === "history" && <TransactionsPage profileId={profileId} />}
      </div>

      <nav className="bottom-nav" aria-label="Primary navigation">
        {tabItems.slice(0, 2).map((item) => (
          <TabButton
            key={item.id}
            item={item}
            active={tab === item.id}
            onClick={() => setTab(item.id)}
          />
        ))}

        <button
          className="fab"
          onClick={() => setAddOpen(true)}
          aria-label="Add transaction"
        >
          <Plus size={26} strokeWidth={2.5} />
        </button>

        {tabItems.slice(2).map((item) => (
          <TabButton
            key={item.id}
            item={item}
            active={tab === item.id}
            onClick={() => setTab(item.id)}
          />
        ))}
      </nav>

      {/* Sheets and Overlays */}
      <AddTransactionSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        profileId={profileId}
        onOpenCategoryManager={() => setCategoryManagerOpen(true)}
      />

      <AccountSheet
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        profileId={profileId}
      />

      <ChatLogSheet
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        profileId={profileId}
      />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        themePreference={themePreference}
        onThemeChange={setThemePreference}
        onOpenCategories={() => setCategoryManagerOpen(true)}
        onOpenPlan={() => {
          setSettingsOpen(false);
          setTab("plan");
        }}
      />

      <CategoryManagerSheet
        open={categoryManagerOpen}
        onClose={() => setCategoryManagerOpen(false)}
        profileId={profileId}
      />

      {helpOpen && (
        <FinsightsHelpModal onClose={() => setHelpOpen(false)} />
      )}

      {installHintOpen && (
        <InstallHint
          persisted={storagePersisted}
          onClose={() => {
            localStorage.setItem("pesopulse-install-hint-dismissed", "true");
            setInstallHintOpen(false);
          }}
        />
      )}
    </main>
  );
}

function FinsightsHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="About Finsights"
    >
      <section className="account-sheet" style={{ padding: "16px 20px 24px" }}>
        <header className="sheet-header" style={{ marginBottom: "12px" }}>
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
          <b>About Finsights</b>
          <span />
        </header>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "14px", lineHeight: "1.5" }}>
          <p>
            <b>Finsights</b> gives you clear visibility into your spending trends and income patterns across all your accounts or per specific bank/e-wallet.
          </p>
          <ul style={{ paddingLeft: "18px", listStyleType: "disc", color: "var(--muted-foreground)" }}>
            <li><b>Account filter:</b> View your overall spending or track individual accounts like GCash, Maya, or BDO.</li>
            <li><b>Period tracked:</b> Switch between Day, Week, Month, and Year to spot spikes and trends.</li>
            <li><b>Net Balance:</b> Total income minus total expenses for that timeframe.</li>
            <li><b>Comparison:</b> Automatically compares your total expenses or income against the prior period.</li>
          </ul>
          <button className="save-button" style={{ marginTop: "14px" }} onClick={onClose}>
            Got it
          </button>
        </div>
      </section>
    </div>
  );
}

function InstallHint({
  persisted,
  onClose,
}: {
  persisted: boolean | null;
  onClose: () => void;
}) {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
  return (
    <aside className="install-hint" role="status">
      <div className="install-hint-icon">
        <WalletCards size={22} />
      </div>
      <div className="install-hint-copy">
        <b>Keep Kupit close</b>
        <span>
          {ios
            ? "Tap Share, then Add to Home Screen."
            : "Install from your browser menu for the full app experience."}
        </span>
        {persisted === false && (
          <small>Use Export in Settings to keep a backup of your data.</small>
        )}
      </div>
      <button onClick={onClose} aria-label="Dismiss install hint">
        <X size={18} />
      </button>
    </aside>
  );
}

function TabButton({
  item,
  active,
  onClick,
}: {
  item: (typeof tabItems)[number];
  active: boolean;
  onClick: () => void;
}) {
  const Icon = item.icon;
  return (
    <button className={`nav-item ${active ? "active" : ""}`} onClick={onClick}>
      <Icon size={21} />
      <span>{item.label}</span>
    </button>
  );
}

function HomePage({
  profileId,
  onAdd,
  onAddAccount,
  onChat,
  onSettings,
  onPlan,
  onWallet,
  onHistory,
  onFinsights,
}: {
  profileId: string;
  onAdd: () => void;
  onAddAccount: () => void;
  onChat: () => void;
  onSettings: () => void;
  onPlan: () => void;
  onWallet: () => void;
  onHistory: () => void;
  onFinsights: () => void;
}) {
  const accounts = useLiveQuery(
    () =>
      db.accounts
        .where({ profileId })
        .filter((a) => !a.deletedAt && !a.isArchived)
        .toArray(),
    [profileId],
    []
  );
  const transactions = useLiveQuery(
    () =>
      db.transactions
        .where({ profileId })
        .filter((t) => !t.deletedAt)
        .reverse()
        .sortBy("date"),
    [profileId],
    []
  );
  const budgets = useLiveQuery(
    () => db.budgets.where({ profileId }).filter((b) => !b.deletedAt).toArray(),
    [profileId],
    []
  );
  const balances = useMemo(
    () =>
      new Map(
        accounts.map((a) => [
          a.id,
          computeAccountBalance(a.id, a.openingBalance, transactions),
        ])
      ),
    [accounts, transactions]
  );
  const net = computeNetWorth(accounts, balances);
  const { start, end } = getCurrentMonthRange();
  const monthly = computeMonthlyTotals(transactions, start, end);

  return (
    <div className="content">
      <header className="page-header">
        <div>
          <p className="eyebrow">
            {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </p>
          <h1>Good day</h1>
        </div>
        <div className="header-buttons">
          <button className="header-chat" onClick={onChat} aria-label="Quick log">
            <MessageCircle size={20} />
          </button>
          <button className="avatar" aria-label="Profile and settings" onClick={onSettings}>
            P
          </button>
        </div>
      </header>

      <section className="net-card">
        <div className="net-card-top">
          <span>Net worth</span>
          <button aria-label="View net worth details" onClick={onWallet}>
            <ChevronRight size={18} />
          </button>
        </div>
        <strong className="net-value">{formatMoney(net.netWorth)}</strong>
        <div className="net-change">
          <ArrowUpRight size={14} /> Total financial position
        </div>
        <div className="month-totals">
          <div>
            <span className="total-icon income">
              <ArrowDownLeft size={16} />
            </span>
            <p>
              <small>Income</small>
              <b>{formatMoney(monthly.income)}</b>
            </p>
          </div>
          <div>
            <span className="total-icon expense">
              <ArrowUpRight size={16} />
            </span>
            <p>
              <small>Expenses</small>
              <b>{formatMoney(monthly.expenses)}</b>
            </p>
          </div>
        </div>
      </section>

      <section className="week-summary" onClick={onFinsights} style={{ cursor: "pointer" }}>
        <div className="week-summary-head">
          <div>
            <b>Last 7 days</b>
            <small>Daily spending · Tap for Finsights</small>
          </div>
          <strong>
            {formatMoney(
              transactions
                .filter((tx) => tx.type === "expense")
                .filter((tx) => tx.date >= toDateString(new Date(Date.now() - 6 * 86400000)))
                .reduce((sum, tx) => sum + tx.amount, 0)
            )}
          </strong>
        </div>
        <div className="week-bars">
          {Array.from({ length: 7 }, (_, index) => {
            const date = new Date(Date.now() - (6 - index) * 86400000);
            const dateKey = toDateString(date);
            const amount = transactions
              .filter((tx) => tx.type === "expense" && tx.date === dateKey)
              .reduce((sum, tx) => sum + tx.amount, 0);
            const max = Math.max(
              1,
              ...Array.from({ length: 7 }, (_, i) => {
                const key = toDateString(new Date(Date.now() - (6 - i) * 86400000));
                return transactions
                  .filter((tx) => tx.type === "expense" && tx.date === key)
                  .reduce((sum, tx) => sum + tx.amount, 0);
              })
            );
            return (
              <span key={dateKey}>
                <i
                  style={{
                    height: `${amount ? Math.max(18, (amount / max) * 100) : 6}%`,
                  }}
                />
                <small>{date.toLocaleDateString("en-PH", { weekday: "narrow" })}</small>
              </span>
            );
          })}
        </div>
      </section>

      {!budgets.length && (
        <button className="budget-prompt" onClick={onPlan}>
          <span>
            <PiggyBank size={19} />
          </span>
          <div>
            <b>Set up a budget</b>
            <small>Give every category a monthly limit.</small>
          </div>
          <ChevronRight size={18} />
        </button>
      )}

      <section className="section">
        <div className="section-heading">
          <h2>My accounts</h2>
          <button onClick={onWallet}>See all</button>
        </div>
        {accounts.length ? (
          <div className="account-grid">
            {accounts.map((account) => (
              <article className="account-card" key={account.id}>
                <span
                  className="account-icon"
                  style={{
                    background: `${account.color}18`,
                    color: account.color,
                  }}
                >
                  {account.type === "bank" ? (
                    <Banknote size={19} />
                  ) : (
                    <WalletCards size={19} />
                  )}
                </span>
                <div>
                  <p>{account.name}</p>
                  <strong>
                    {formatMoney(balances.get(account.id) ?? account.openingBalance)}
                  </strong>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-card">
            <WalletCards size={28} />
            <p>No accounts yet</p>
            <small>Add a cash, bank, or e-wallet account to get started.</small>
            <button className="empty-action" onClick={onAddAccount}>
              Add your first account
            </button>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>Recent transactions</h2>
          <button onClick={onHistory}>See all</button>
        </div>
        <TransactionList
          transactions={transactions.slice(0, 5)}
          accounts={accounts}
          profileId={profileId}
        />
      </section>
    </div>
  );
}

function TransactionList({
  transactions,
  accounts,
  profileId,
}: {
  transactions: Transaction[];
  accounts: Account[];
  profileId: string;
}) {
  const categories = useLiveQuery(
    () => db.categories.where({ profileId }).toArray(),
    [profileId],
    []
  );

  if (!transactions.length) {
    return (
      <div className="empty-card">
        <ReceiptText size={28} />
        <p>No transactions yet</p>
        <small>Add your first one with the + button.</small>
      </div>
    );
  }

  return (
    <div className="transaction-list">
      {transactions.map((tx) => {
        const account = accounts.find((a) => a.id === tx.accountId);
        const toAccount = tx.toAccountId
          ? accounts.find((a) => a.id === tx.toAccountId)
          : null;
        const category = categories.find((c) => c.id === tx.categoryId);
        const positive = tx.type === "income";
        const transfer = tx.type === "transfer";

        // Consistent primary label: Category name or Transfer
        const primaryTitle = transfer
          ? `Transfer`
          : category?.name || (positive ? "Income" : "Expense");

        // Subtitle: Note (if present), account label, relative date
        const accountLabel =
          transfer && toAccount
            ? `${account?.name || "Account"} → ${toAccount.name}`
            : account?.name || "Account";

        return (
          <article className="transaction-row" key={tx.id}>
            {transfer ? (
              <span className="transaction-icon transfer">
                <ArrowLeftRight size={18} />
              </span>
            ) : (
              <CategoryIcon
                icon={category?.icon}
                color={category?.color}
                size={18}
              />
            )}
            <div className="transaction-main">
              <div className="transaction-title-row">
                <b>{primaryTitle}</b>
              </div>
              <div className="transaction-sub-row">
                {tx.note && <span>"{tx.note}" · </span>}
                <span>{accountLabel}</span> · <span>{formatRelativeDate(tx.date)}</span>
              </div>
            </div>
            <strong className={positive ? "positive" : transfer ? "" : "negative"}>
              {positive ? "+" : transfer ? "" : "−"}
              {formatMoney(tx.amount)}
            </strong>
          </article>
        );
      })}
    </div>
  );
}

function TransactionsPage({ profileId }: { profileId: string }) {
  const transactions = useLiveQuery(
    () =>
      db.transactions
        .where({ profileId })
        .filter((t) => !t.deletedAt)
        .reverse()
        .sortBy("date"),
    [profileId],
    []
  );
  const accounts = useLiveQuery(
    () => db.accounts.where({ profileId }).toArray(),
    [profileId],
    []
  );
  const categories = useLiveQuery(
    () => db.categories.where({ profileId }).filter((c) => !c.deletedAt).toArray(),
    [profileId],
    []
  );

  const [search, setSearch] = useState("");
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [timeFilter, setTimeFilter] = useState<"all" | "this_month" | "last_month" | "custom">("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const { filterStart, filterEnd } = useMemo(() => {
    if (timeFilter === "this_month") {
      const now = new Date();
      const s = new Date(now.getFullYear(), now.getMonth(), 1);
      const e = new Date(now.getFullYear(), now.getMonth() + 1, 0);
      return { filterStart: toDateString(s), filterEnd: toDateString(e) };
    } else if (timeFilter === "last_month") {
      const now = new Date();
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const e = new Date(now.getFullYear(), now.getMonth(), 0);
      return { filterStart: toDateString(s), filterEnd: toDateString(e) };
    } else if (timeFilter === "custom") {
      return { filterStart: startDate, filterEnd: endDate };
    }
    return { filterStart: "", filterEnd: "" };
  }, [timeFilter, startDate, endDate]);

  const filtered = transactions.filter((tx) => {
    const account = accounts.find((item) => item.id === tx.accountId);
    const category = categories.find((item) => item.id === tx.categoryId);
    const haystack = `${tx.note || ""} ${account?.name || ""} ${category?.name || ""}`.toLowerCase();
    if (search && !haystack.includes(search.toLowerCase())) return false;
    if (accountId && tx.accountId !== accountId) return false;
    if (categoryId && tx.categoryId !== categoryId) return false;
    if (filterStart && tx.date < filterStart) return false;
    if (filterEnd && tx.date > filterEnd) return false;
    return true;
  });

  const isFiltered = Boolean(search || accountId || categoryId || timeFilter !== "all");

  const clearAllFilters = () => {
    setSearch("");
    setAccountId("");
    setCategoryId("");
    setTimeFilter("all");
    setStartDate("");
    setEndDate("");
  };

  const grouped = filtered.reduce<Record<string, Transaction[]>>((groups, tx) => {
    (groups[tx.date] ||= []).push(tx);
    return groups;
  }, {});

  return (
    <div className="content">
      <header className="page-header">
        <div>
          <p className="eyebrow">All activity</p>
          <h1>History</h1>
        </div>
        {isFiltered && (
          <button className="clear-filters-pill" onClick={clearAllFilters}>
            Clear filters
          </button>
        )}
      </header>

      {/* Dynamic Search Bar */}
      <div className="history-search-bar">
        <Search size={18} className="search-icon" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search note, category, or account..."
          aria-label="Search transactions"
        />
        {search && (
          <button
            className="clear-search-btn"
            onClick={() => setSearch("")}
            aria-label="Clear search"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Dynamic Filters with NO blank gaps */}
      <div className="history-filter-chips">
        <select
          className="history-filter-select"
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
          aria-label="Filter by account"
        >
          <option value="">All accounts</option>
          {accounts
            .filter((account) => !account.deletedAt)
            .map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
        </select>

        <select
          className="history-filter-select"
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>

        <select
          className="history-filter-select"
          value={timeFilter}
          onChange={(event) => setTimeFilter(event.target.value as typeof timeFilter)}
          aria-label="Filter by period"
        >
          <option value="all">All time</option>
          <option value="this_month">This month</option>
          <option value="last_month">Last month</option>
          <option value="custom">Custom date range...</option>
        </select>
      </div>

      {timeFilter === "custom" && (
        <div className="history-custom-dates">
          <label>
            From
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </label>
        </div>
      )}

      {Object.keys(grouped).length ? (
        Object.entries(grouped).map(([date, items]) => {
          const net = items.reduce(
            (sum, tx) =>
              sum +
              (tx.type === "income" ? tx.amount : tx.type === "expense" ? -tx.amount : 0),
            0
          );
          return (
            <section className="history-group" key={date}>
              <div className="history-date">
                <span>{formatRelativeDate(date)}</span>
                <strong className={net >= 0 ? "positive" : "negative"}>
                  {net >= 0 ? "+" : "−"}
                  {formatMoney(Math.abs(net))}
                </strong>
              </div>
              <TransactionList
                transactions={items}
                accounts={accounts}
                profileId={profileId}
              />
            </section>
          );
        })
      ) : (
        <div className="empty-card">
          <ReceiptText size={28} />
          <p>No matching transactions</p>
          <small>
            {isFiltered
              ? "Try adjusting or clearing your filters."
              : "Your transaction history is empty."}
          </small>
          {isFiltered && (
            <button className="empty-action" onClick={clearAllFilters}>
              Reset all filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function AccountsPage({
  profileId,
  onAdd,
}: {
  profileId: string;
  onAdd: () => void;
}) {
  const accounts = useLiveQuery(
    () => db.accounts.where({ profileId }).filter((a) => !a.deletedAt).toArray(),
    [profileId],
    []
  );
  const transactions = useLiveQuery(
    () => db.transactions.where({ profileId }).filter((t) => !t.deletedAt).toArray(),
    [profileId],
    []
  );
  const balances = useMemo(
    () =>
      new Map(
        accounts.map((account) => [
          account.id,
          computeAccountBalance(account.id, account.openingBalance, transactions),
        ])
      ),
    [accounts, transactions]
  );
  const net = computeNetWorth(accounts, balances);
  const groups: { label: string; types: Account["type"][] }[] = [
    { label: "Cash & banks", types: ["cash", "bank", "ewallet"] },
    { label: "Investments", types: ["investment"] },
    { label: "Credit cards & loans", types: ["credit_card", "loan"] },
  ];

  return (
    <div className="content">
      <header className="page-header">
        <div>
          <p className="eyebrow">My money</p>
          <h1>Wallet</h1>
        </div>
        <button className="header-action" onClick={onAdd} aria-label="Add account">
          <Plus size={20} />
        </button>
      </header>

      <section className="wallet-net">
        <small>Net worth</small>
        <strong>{formatMoney(net.netWorth)}</strong>
        <div className="wallet-net-breakdown">
          <span>
            Assets <b>{formatMoney(net.assets)}</b>
          </span>
          <span>
            Liabilities <b>{formatMoney(net.liabilities)}</b>
          </span>
        </div>
      </section>

      {!accounts.length && (
        <div className="empty-card">
          <WalletCards size={28} />
          <p>Your wallet is empty</p>
          <small>Add an account to start tracking your money.</small>
          <button className="empty-action" onClick={onAdd}>
            Add your first account
          </button>
        </div>
      )}

      {groups.map((group) => {
        const items = accounts.filter((account) => group.types.includes(account.type));
        if (!items.length) return null;
        return (
          <section className="wallet-group" key={group.label}>
            <h2>{group.label}</h2>
            <div className="accounts-page-list">
              {items.map((account) => (
                <article className="account-row" key={account.id}>
                  <span
                    className="account-icon"
                    style={{
                      background: `${account.color}18`,
                      color: account.color,
                    }}
                  >
                    {account.type === "credit_card" ? (
                      <WalletCards size={20} />
                    ) : (
                      <Banknote size={20} />
                    )}
                  </span>
                  <div>
                    <p>{account.name}</p>
                    <small>{account.type.replace("_", " ")}</small>
                  </div>
                  <strong>
                    {formatMoney(balances.get(account.id) ?? account.openingBalance)}
                  </strong>
                  <button
                    className="account-delete"
                    aria-label={`Delete ${account.name}`}
                    title={`Delete ${account.name}`}
                    onClick={async () => {
                      const confirmed = window.confirm(
                        `Delete ${account.name}? Its transactions will remain in history, but this account will no longer count toward your wallet or net worth.`
                      );
                      if (!confirmed) return;
                      try {
                        await softDeleteAccount(account.id);
                      } catch (error) {
                        console.error("Could not delete account:", error);
                        window.alert(
                          "The account could not be deleted. Please try again."
                        );
                      }
                    }}
                  >
                    <Trash2 size={17} />
                  </button>
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function BudgetsPage({
  profileId,
  onOpenCategories,
}: {
  profileId: string;
  onOpenCategories: () => void;
}) {
  const budgets = useLiveQuery(
    () => db.budgets.where({ profileId }).filter((b) => !b.deletedAt).toArray(),
    [profileId],
    []
  );
  const categories = useLiveQuery(
    () => db.categories.where({ profileId }).filter((c) => !c.deletedAt).toArray(),
    [profileId],
    []
  );
  const goals = useLiveQuery(
    () => db.goals.where({ profileId }).filter((g) => !g.deletedAt).toArray(),
    [profileId],
    []
  );
  const transactions = useLiveQuery(
    () => db.transactions.where({ profileId }).filter((t) => !t.deletedAt).toArray(),
    [profileId],
    []
  );

  const [budgetOpen, setBudgetOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const [debtsOpen, setDebtsOpen] = useState(false);
  const { start, end } = getCurrentMonthRange();

  return (
    <div className="content">
      <header className="page-header">
        <div>
          <p className="eyebrow">Plan your money</p>
          <h1>Plan</h1>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            className="manage-cat-inline-btn"
            onClick={onOpenCategories}
            title="Manage categories"
          >
            <Edit2 size={14} /> Categories
          </button>
          <button
            className="header-action"
            onClick={() => setBudgetOpen(true)}
            aria-label="Add budget"
          >
            <Plus size={20} />
          </button>
        </div>
      </header>

      <section className="section budget-section">
        <div className="section-heading">
          <h2>This month</h2>
          <span>
            {budgets.length} {budgets.length === 1 ? "budget" : "budgets"}
          </span>
        </div>
        {budgets.length ? (
          <div className="budget-list">
            {budgets.map((budget) => {
              const category = categories.find((c) => c.id === budget.categoryId);
              const spent = transactions
                .filter(
                  (tx) => tx.type === "expense" && tx.date >= start && tx.date <= end
                )
                .filter((tx) => tx.categoryId === budget.categoryId)
                .reduce((sum, tx) => sum + tx.amount, 0);
              const percent =
                budget.amount > 0
                  ? Math.min(100, Math.round((spent / budget.amount) * 100))
                  : 0;
              return (
                <article className="budget-row" key={budget.id}>
                  <div className="budget-row-head">
                    <span>
                      <CategoryIcon
                        icon={category?.icon}
                        color={category?.color}
                        size={16}
                      />
                      {category?.name || "Category"}
                    </span>
                    <b>
                      {formatMoney(spent)} / {formatMoney(budget.amount)}
                    </b>
                  </div>
                  <div
                    className={`budget-track ${
                      percent >= 100 ? "danger" : percent >= 80 ? "warning" : ""
                    }`}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-card">
            <PiggyBank size={28} />
            <p>No budgets yet</p>
            <small>Set a monthly limit for a category.</small>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-heading">
          <h2>Savings goals</h2>
          <button onClick={() => setGoalOpen(true)}>Add goal</button>
        </div>
        {goals.length ? (
          <div className="goal-list">
            {goals.map((goal) => {
              const saved = transactions
                .filter((tx) => tx.type === "income" && tx.date <= goal.targetDate)
                .reduce((sum, tx) => sum + tx.amount, 0);
              const progress =
                goal.targetAmount > 0
                  ? Math.min(100, Math.round((saved / goal.targetAmount) * 100))
                  : 0;
              const remainingMonths = Math.max(
                1,
                (new Date(goal.targetDate).getFullYear() - new Date().getFullYear()) * 12 +
                  new Date(goal.targetDate).getMonth() -
                  new Date().getMonth()
              );
              const monthly = Math.max(0, goal.targetAmount - saved) / remainingMonths;
              return (
                <article className="goal-row" key={goal.id}>
                  <div>
                    <b>{goal.name}</b>
                    <small>{formatMoney(saved)} saved</small>
                  </div>
                  <strong>{progress}%</strong>
                  <div className="budget-track">
                    <span style={{ width: `${progress}%` }} />
                  </div>
                  <small>{formatMoney(Math.ceil(monthly))}/month needed</small>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="empty-card">
            <PiggyBank size={28} />
            <p>No savings goals yet</p>
            <small>Break a bigger target into monthly savings.</small>
          </div>
        )}
      </section>

      <section className="plan-tools">
        <button onClick={() => setRecurringOpen(true)}>
          <span>
            <CalendarClock size={18} />
          </span>
          <div>
            <b>Recurring</b>
            <small>Bills and scheduled payments</small>
          </div>
          <ChevronRight size={18} />
        </button>
        <button onClick={() => setDebtsOpen(true)}>
          <span>
            <HandCoins size={18} />
          </span>
          <div>
            <b>Debts & receivables</b>
            <small>Track money owed</small>
          </div>
          <ChevronRight size={18} />
        </button>
      </section>

      {budgetOpen && (
        <BudgetForm
          profileId={profileId}
          categories={categories}
          onClose={() => setBudgetOpen(false)}
        />
      )}
      {goalOpen && <GoalForm profileId={profileId} onClose={() => setGoalOpen(false)} />}
      {recurringOpen && <RecurringSheet onClose={() => setRecurringOpen(false)} />}
      {debtsOpen && <DebtsSheet onClose={() => setDebtsOpen(false)} />}
    </div>
  );
}

function BudgetForm({
  profileId,
  categories,
  onClose,
}: {
  profileId: string;
  categories: Category[];
  onClose: () => void;
}) {
  const expenseCategories = categories.filter((c) => c.type === "expense");
  const [categoryId, setCategoryId] = useState(expenseCategories[0]?.id || "");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState<
    "daily" | "weekly" | "biweekly" | "monthly" | "annual"
  >("monthly");

  const save = async () => {
    if (!categoryId || !parseMoney(amount)) return;
    const timestamp = new Date().toISOString();
    await db.budgets.put({
      id: crypto.randomUUID(),
      profileId,
      categoryId,
      period,
      amount: parseMoney(amount),
      rolloverEnabled: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    onClose();
  };

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Add budget"
    >
      <section className="account-sheet">
        <header className="sheet-header">
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
          <b>Add budget</b>
          <span />
        </header>
        <div className="account-form">
          <label>
            Category
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
            >
              {expenseCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Budget cycle
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value as typeof period)}
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly</option>
              <option value="monthly">Monthly</option>
              <option value="annual">Annual</option>
            </select>
          </label>
          <label>
            Limit amount
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <button
            className="save-button"
            onClick={save}
            disabled={!parseMoney(amount)}
          >
            Save budget
          </button>
        </div>
      </section>
    </div>
  );
}

function GoalForm({
  profileId,
  onClose,
}: {
  profileId: string;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [targetDate, setTargetDate] = useState("");

  const save = async () => {
    if (!name.trim() || !parseMoney(amount) || !targetDate) return;
    const timestamp = new Date().toISOString();
    await db.goals.put({
      id: crypto.randomUUID(),
      profileId,
      name: name.trim(),
      targetAmount: parseMoney(amount),
      targetDate,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    onClose();
  };

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Add goal"
    >
      <section className="account-sheet">
        <header className="sheet-header">
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
          <b>Add savings goal</b>
          <span />
        </header>
        <div className="account-form">
          <label>
            Goal name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Emergency fund"
            />
          </label>
          <label>
            Target amount
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
            />
          </label>
          <label>
            Target date
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </label>
          <button className="save-button" onClick={save}>
            Save goal
          </button>
        </div>
      </section>
    </div>
  );
}

function RecurringSheet({ onClose }: { onClose: () => void }) {
  const profile = useLiveQuery(
    () => db.profiles.filter((item) => item.isDefault && !item.deletedAt).first(),
    [],
    undefined
  );
  const accounts = useLiveQuery(
    () => db.accounts.filter((item) => !item.deletedAt).toArray(),
    [],
    []
  );
  const recurring = useLiveQuery(
    () => db.recurring.filter((item) => !item.deletedAt).toArray(),
    [],
    []
  );
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [nextDate, setNextDate] = useState(toDateString(new Date()));
  const [frequency, setFrequency] = useState<
    "daily" | "weekly" | "monthly" | "yearly"
  >("monthly");

  useEffect(() => {
    if (!accountId && accounts.length) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const save = async () => {
    if (!profile || !accountId || !parseMoney(amount)) return;
    const timestamp = new Date().toISOString();
    await db.recurring.add({
      id: crypto.randomUUID(),
      profileId: profile.id,
      amount: parseMoney(amount),
      accountId,
      note: name.trim() || null,
      transactionType: "expense",
      frequency,
      startDate: nextDate,
      nextDueDate: nextDate,
      remindDaysBefore: 3,
      kind: "bill",
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    setName("");
    setAmount("");
  };

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Recurring payments"
    >
      <section className="account-sheet">
        <header className="sheet-header">
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
          <b>Recurring payments</b>
          <span />
        </header>
        <div className="recurring-list">
          {recurring.map((item) => (
            <article key={item.id}>
              <span>
                <b>{item.note || item.kind}</b>
                <small>
                  {item.frequency} · {item.nextDueDate}
                </small>
              </span>
              <strong>{formatMoney(item.amount)}</strong>
            </article>
          ))}
          {!recurring.length && <p className="muted">No recurring items yet.</p>}
        </div>
        <div className="account-form">
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Internet bill"
            />
          </label>
          <label>
            Amount
            <input
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
            />
          </label>
          <label>
            Account
            <select
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
            >
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>
          <div className="field-row">
            <label>
              Next due
              <input
                type="date"
                value={nextDate}
                onChange={(event) => setNextDate(event.target.value)}
              />
            </label>
            <label>
              Frequency
              <select
                value={frequency}
                onChange={(event) =>
                  setFrequency(event.target.value as typeof frequency)
                }
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
          </div>
          <button className="save-button" onClick={save}>
            Save recurring item
          </button>
          <p className="form-note">
            Due items wait for your confirmation before creating a transaction.
          </p>
        </div>
      </section>
    </div>
  );
}

function ChatLogSheet({
  open,
  onClose,
  profileId,
}: {
  open: boolean;
  onClose: () => void;
  profileId: string;
}) {
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
    () => db.categories.where({ profileId }).filter((c) => !c.deletedAt).toArray(),
    [profileId],
    []
  );
  const [message, setMessage] = useState("");
  const [drafts, setDrafts] = useState<ReturnType<typeof parseMultipleTransactions>>([]);

  const parseMessage = () => {
    setDrafts(parseMultipleTransactions(message, accounts.map((account) => account.name)));
  };

  const saveDrafts = async () => {
    for (const draft of drafts) {
      if (!draft.amount) continue;
      const account =
        accounts.find((item) => item.name.toLowerCase() === draft.accountHint?.toLowerCase()) ||
        accounts[0];
      if (!account) continue;
      const category =
        categories.find((item) => item.name === draft.categoryHint && item.type === draft.type) ||
        categories.find((item) => item.type === draft.type && !item.parentId);
      await createTransaction({
        profileId,
        type: draft.type,
        amount: draft.amount,
        accountId: account.id,
        toAccountId:
          draft.type === "transfer"
            ? accounts.find((item) => item.id !== account.id)?.id || null
            : null,
        categoryId: draft.type === "transfer" ? null : category?.id || null,
        date: draft.date,
        note: draft.note || null,
      });
    }
    setDrafts([]);
    setMessage("");
    onClose();
  };

  if (!open) return null;
  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Quick log"
    >
      <section className="account-sheet chat-sheet">
        <header className="sheet-header">
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
          <b>Quick log</b>
          <span />
        </header>
        <div className="chat-input">
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Starbucks 250 gcash yesterday"
          />
          <button onClick={parseMessage} disabled={!message.trim()}>
            <MessageCircle size={18} />
          </button>
        </div>
        {drafts.length > 0 && (
          <div className="chat-drafts">
            {drafts.map((draft, index) => (
              <article key={`${draft.note}-${index}`}>
                <span>
                  <small>{draft.type}</small>
                  <b>{draft.note || draft.categoryHint || "Transaction"}</b>
                </span>
                <strong>{formatMoney(draft.amount)}</strong>
                <small>
                  {draft.date} · {draft.accountHint || accounts[0]?.name || "Account"} ·{" "}
                  {draft.categoryHint || "Category"}
                </small>
              </article>
            ))}
            <button className="save-button" onClick={saveDrafts}>
              Confirm and save
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function DebtsSheet({ onClose }: { onClose: () => void }) {
  const debts = useLiveQuery(
    () => db.debts.filter((item) => !item.deletedAt).toArray(),
    [],
    []
  );
  const [direction, setDirection] = useState<"i_owe" | "owed_to_me">("i_owe");
  const [counterparty, setCounterparty] = useState("");
  const [principal, setPrincipal] = useState("");
  const profile = useLiveQuery(
    () => db.profiles.filter((item) => item.isDefault && !item.deletedAt).first(),
    [],
    undefined
  );

  const save = async () => {
    if (!profile || !counterparty.trim() || !parseMoney(principal)) return;
    const timestamp = new Date().toISOString();
    await db.debts.add({
      id: crypto.randomUUID(),
      profileId: profile.id,
      direction,
      counterparty: counterparty.trim(),
      principal: parseMoney(principal),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    setCounterparty("");
    setPrincipal("");
  };

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Debts and receivables"
    >
      <section className="account-sheet">
        <header className="sheet-header">
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
          <b>Debts & receivables</b>
          <span />
        </header>
        <div className="debts-list">
          {debts.map((debt) => (
            <article key={debt.id}>
              <span>
                <b>{debt.counterparty}</b>
                <small>{debt.direction === "i_owe" ? "I owe" : "Owed to me"}</small>
              </span>
              <strong>{formatMoney(debt.principal)}</strong>
            </article>
          ))}
          {!debts.length && <p className="muted">No debts or receivables yet.</p>}
        </div>
        <div className="account-form">
          <label>
            Direction
            <select
              value={direction}
              onChange={(event) =>
                setDirection(event.target.value as typeof direction)
              }
            >
              <option value="i_owe">I owe someone</option>
              <option value="owed_to_me">Someone owes me</option>
            </select>
          </label>
          <label>
            Name
            <input
              value={counterparty}
              onChange={(event) => setCounterparty(event.target.value)}
              placeholder="Counterparty"
            />
          </label>
          <label>
            Principal
            <input
              inputMode="decimal"
              value={principal}
              onChange={(event) => setPrincipal(event.target.value)}
              placeholder="0.00"
            />
          </label>
          <button className="save-button" onClick={save}>
            Save record
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingsSheet({
  open,
  onClose,
  themePreference,
  onThemeChange,
  onOpenCategories,
  onOpenPlan,
}: {
  open: boolean;
  onClose: () => void;
  themePreference: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onOpenCategories: () => void;
  onOpenPlan: () => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [email, setEmail] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudMessage, setCloudMessage] = useState("");
  const [cloudError, setCloudError] = useState("");

  const categories = useLiveQuery(() => db.categories.filter((c) => !c.deletedAt).toArray(), [], []);

  useEffect(() => {
    if (!supabase || !open) return;
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setCloudError(error.message);
      setSession(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        setCloudError("");
      }
    );
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [open]);

  const sendMagicLink = async () => {
    if (!supabase) return;
    setCloudBusy(true);
    setCloudError("");
    setCloudMessage("");
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setCloudBusy(false);
    if (error) setCloudError(error.message);
    else setCloudMessage("Check your email for the secure sign-in link.");
  };

  const syncCloud = async () => {
    if (!supabase || !session) return;
    if (
      !window.confirm(
        "Sync will upload this device's budget data to your private cloud account and merge it with your other devices. Continue?"
      )
    )
      return;
    setCloudBusy(true);
    setCloudError("");
    setCloudMessage("");
    try {
      await syncLocalData(supabase, session.user.id);
      setCloudMessage("Sync complete. Your local data remains available offline.");
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : "Cloud sync failed.");
    } finally {
      setCloudBusy(false);
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setCloudError(error.message);
    else {
      setSession(null);
      setCloudMessage("Signed out. This device's local data is unchanged.");
    }
  };

  const resetData = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    await db.delete();
    window.location.reload();
  };

  if (!open) return null;
  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
    >
      <section className="account-sheet settings-sheet">
        <header className="sheet-header">
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
          <b>Settings</b>
          <span />
        </header>

        <section className="cloud-panel">
          <div className="cloud-panel-title">
            <div>
              <b>Private cloud sync</b>
              <small>Optional · Dexie still works offline</small>
            </div>
            <span
              className={session ? "cloud-status connected" : "cloud-status"}
            >
              {session ? "Connected" : "Local only"}
            </span>
          </div>
          {!cloudSyncAvailable ? (
            <p className="cloud-help">
              Add your Supabase URL and publishable key to the local <code>.env</code> file to enable sign-in.
            </p>
          ) : session ? (
            <>
              <p className="cloud-help">
                Signed in as {session.user.email}. Cloud data is protected by account-level row security.
              </p>
              <button
                className="save-button"
                onClick={syncCloud}
                disabled={cloudBusy}
              >
                {cloudBusy ? "Syncing…" : "Sync this device"}
              </button>
              <button
                className="text-button"
                onClick={signOut}
                disabled={cloudBusy}
              >
                Sign out
              </button>
            </>
          ) : (
            <>
              <p className="cloud-help">
                Sign in with an email link to sync your data between devices. Your local-only data is not uploaded until you choose Sync.
              </p>
              <label className="cloud-email">
                Email address
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                />
              </label>
              <button
                className="save-button"
                onClick={sendMagicLink}
                disabled={cloudBusy || !email.includes("@")}
              >
                {cloudBusy ? "Sending…" : "Email me a sign-in link"}
              </button>
            </>
          )}
          {cloudMessage && <p className="cloud-message">{cloudMessage}</p>}
          {cloudError && (
            <p className="cloud-error" role="alert">
              {cloudError}
            </p>
          )}
        </section>

        <div className="settings-list">
          {/* Categories Management Button */}
          <button
            onClick={() => {
              onClose();
              onOpenCategories();
            }}
          >
            <span>Manage categories</span>
            <small>{categories.length} categories</small>
          </button>

          {/* Budget & Plan Page */}
          <button onClick={onOpenPlan}>
            <span>Budgets & Goals</span>
            <small>Set spending limits</small>
          </button>

          <label className="theme-setting">
            <span>
              <span className="theme-setting-icon">
                <Moon size={16} />
                <Sun size={16} />
              </span>
              Appearance
            </span>
            <select
              aria-label="Color theme"
              value={themePreference}
              onChange={(event) =>
                onThemeChange(event.target.value as ThemePreference)
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>

          <button onClick={exportTransactionsCsv}>
            <span>Export transactions</span>
            <small>CSV</small>
          </button>
          <button onClick={exportJsonBackup}>
            <span>Export backup</span>
            <small>JSON</small>
          </button>

          <label>
            <span>Import backup</span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (file) await importJsonBackup(file);
              }}
            />
          </label>

          <button className="danger-setting" onClick={resetData}>
            <span>
              {confirmReset ? "Tap again to reset everything" : "Reset all data"}
            </span>
            <small>{confirmReset ? "Confirm" : ""}</small>
          </button>
        </div>
      </section>
    </div>
  );
}

function AddTransactionSheet({
  open,
  onClose,
  profileId,
  onOpenCategoryManager,
}: {
  open: boolean;
  onClose: () => void;
  profileId: string;
  onOpenCategoryManager: () => void;
}) {
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
    () => db.categories.where({ profileId }).filter((c) => !c.deletedAt).toArray(),
    [profileId],
    []
  );

  const [type, setType] = useState<TransactionType>("expense");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(toDateString(new Date()));
  const [receipt, setReceipt] = useState<File | null>(null);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [storedAmount, setStoredAmount] = useState<number | null>(null);
  const [pendingOperator, setPendingOperator] = useState<CalculatorOperator | null>(null);
  const [awaitingOperand, setAwaitingOperand] = useState(false);
  const [expression, setExpression] = useState("");
  const [calculatorError, setCalculatorError] = useState("");

  useEffect(() => {
    if (!accountId && accounts.length) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  useEffect(() => {
    if (!categoryId) {
      const first = categories.find(
        (c) => c.type === (type === "income" ? "income" : "expense") && !c.parentId
      );
      if (first) setCategoryId(first.id);
    }
  }, [categories, type, categoryId]);

  const keypadPress = (key: string) => {
    setCalculatorError("");
    if (key === "AC") {
      setAmount("");
      setStoredAmount(null);
      setPendingOperator(null);
      setAwaitingOperand(false);
      setExpression("");
      return;
    }

    if (key === "back") {
      if (awaitingOperand) return;
      setAmount((value) => (value.length <= 1 ? "" : value.slice(0, -1)));
      return;
    }

    if (key === "%") {
      const current = parseMoney(amount || "0");
      const result = percentCentavos(current, storedAmount, pendingOperator);
      setAmount(centavosToEntry(result));
      setExpression((value) => `${value} ${centavosToEntry(current)}%`.trim());
      setAwaitingOperand(false);
      return;
    }

    if (["+", "−", "×", "÷"].includes(key)) {
      const operator = key as CalculatorOperator;
      const current = parseMoney(amount || "0");
      let nextStored = current;
      if (storedAmount !== null && pendingOperator && !awaitingOperand) {
        try {
          nextStored = calculateCentavos(storedAmount, current, pendingOperator);
        } catch (error) {
          setCalculatorError(
            error instanceof Error ? error.message : "Calculation failed"
          );
          return;
        }
      } else if (storedAmount !== null && awaitingOperand) {
        nextStored = storedAmount;
      }
      setStoredAmount(nextStored);
      setPendingOperator(operator);
      setExpression(`${centavosToEntry(nextStored)} ${operator}`);
      setAmount(centavosToEntry(nextStored));
      setAwaitingOperand(true);
      return;
    }

    if (key === "=") {
      if (storedAmount === null || !pendingOperator || awaitingOperand) return;
      const current = parseMoney(amount || "0");
      try {
        const result = calculateCentavos(storedAmount, current, pendingOperator);
        setExpression(
          `${centavosToEntry(storedAmount)} ${pendingOperator} ${centavosToEntry(current)} =`
        );
        setAmount(centavosToEntry(result));
        setStoredAmount(null);
        setPendingOperator(null);
        setAwaitingOperand(true);
      } catch (error) {
        setCalculatorError(
          error instanceof Error ? error.message : "Calculation failed"
        );
      }
      return;
    }

    if (key === "." && !awaitingOperand && amount.includes(".")) return;
    if (awaitingOperand) {
      setAmount(key === "." ? "0." : key);
      setAwaitingOperand(false);
      return;
    }
    if (amount.replace(".", "").length >= 10) return;
    if (key === ".") {
      setAmount((value) => (value ? `${value}.` : "0."));
    } else {
      setAmount((value) => (value === "0" ? key : `${value}${key}`));
    }
  };

  const save = async () => {
    const cents = parseMoney(amount);
    if (!cents || !accountId) return;
    if (type === "transfer" && (!toAccountId || toAccountId === accountId)) return;
    const transactionId = await createTransaction({
      profileId,
      type,
      amount: cents,
      accountId,
      toAccountId: type === "transfer" ? toAccountId : null,
      categoryId: type === "transfer" ? null : categoryId || null,
      date,
      note: note.trim() || null,
    });
    if (receipt) {
      await db.attachments.add({
        id: crypto.randomUUID(),
        transactionId,
        blob: receipt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    setUndoId(transactionId);
    setAmount("");
    setStoredAmount(null);
    setPendingOperator(null);
    setAwaitingOperand(false);
    setExpression("");
    setCalculatorError("");
    setNote("");
    setCategoryId("");
    setReceipt(null);
  };

  if (!open) return null;
  const filteredCategories = categories.filter(
    (c) => c.type === (type === "income" ? "income" : "expense")
  );

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Add transaction"
    >
      <section className="add-sheet">
        <header className="sheet-header">
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
          <div className="type-tabs">
            {(["expense", "income", "transfer"] as TransactionType[]).map((value) => (
              <button
                key={value}
                type="button"
                className={type === value ? "active" : ""}
                aria-pressed={type === value}
                onClick={() => setType(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <span />
        </header>

        <div className="calculator-display">
          <div className="calculator-expression" aria-live="polite">
            {expression || "Amount"}
          </div>
          <div className="amount-display">
            <small>₱</small>
            {amount && Number.isFinite(parseMoney(amount))
              ? formatMoney(parseMoney(amount)).replace("₱", "")
              : "0.00"}
          </div>
          {calculatorError && (
            <p className="calculator-error" role="alert">
              {calculatorError}
            </p>
          )}
        </div>

        <div className="sheet-fields">
          {type === "transfer" ? (
            <>
              <label>
                From
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                To
                <select
                  value={toAccountId}
                  onChange={(e) => setToAccountId(e.target.value)}
                >
                  <option value="">Select destination account</option>
                  {accounts
                    .filter((a) => a.id !== accountId)
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
              </label>
            </>
          ) : (
            <>
              <label>
                Account
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="category-select-row">
                <label>
                  Category
                  <select
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                  >
                    {filteredCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="manage-cat-inline-btn"
                  onClick={onOpenCategoryManager}
                  title="Add or edit categories and icons"
                >
                  <Edit2 size={13} /> Categories
                </button>
              </div>
            </>
          )}

          <div className="field-row">
            <label>
              Date
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              Note
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional (e.g. Starbucks)"
              />
            </label>
          </div>

          <label className="receipt-field">
            Receipt{" "}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(event) => setReceipt(event.target.files?.[0] || null)}
            />
            <span>{receipt ? receipt.name : "Add photo"}</span>
          </label>
        </div>

        <div className="keypad calculator-keypad">
          {[
            { key: "AC", label: "AC", kind: "utility" },
            { key: "%", label: "%", kind: "utility" },
            { key: "back", label: "⌫", kind: "utility", aria: "Delete last digit" },
            { key: "÷", label: "÷", kind: "operator", aria: "Divide" },
            { key: "7", label: "7", kind: "number" },
            { key: "8", label: "8", kind: "number" },
            { key: "9", label: "9", kind: "number" },
            { key: "×", label: "×", kind: "operator", aria: "Multiply" },
            { key: "4", label: "4", kind: "number" },
            { key: "5", label: "5", kind: "number" },
            { key: "6", label: "6", kind: "number" },
            { key: "−", label: "−", kind: "operator", aria: "Subtract" },
            { key: "1", label: "1", kind: "number" },
            { key: "2", label: "2", kind: "number" },
            { key: "3", label: "3", kind: "number" },
            { key: "+", label: "+", kind: "operator", aria: "Add" },
            { key: "00", label: "00", kind: "number" },
            { key: "0", label: "0", kind: "number" },
            { key: ".", label: ".", kind: "number" },
            { key: "=", label: "=", kind: "equals", aria: "Calculate" },
          ].map(({ key, label, kind, aria }) => (
            <button
              key={key}
              type="button"
              className={`calculator-key ${kind}`}
              aria-label={aria || label}
              onClick={() => keypadPress(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          className="save-button"
          onClick={save}
          disabled={parseMoney(amount) <= 0 || !accountId}
        >
          Save transaction
        </button>

        {undoId && (
          <button
            className="undo-toast"
            onClick={async () => {
              await softDeleteTransaction(undoId);
              setUndoId(null);
              onClose();
            }}
          >
            Saved · Undo
          </button>
        )}
      </section>
    </div>
  );
}

function AccountSheet({
  open,
  onClose,
  profileId,
}: {
  open: boolean;
  onClose: () => void;
  profileId: string;
}) {
  const [template, setTemplate] = useState(getAccountTemplates()[0].name);
  const [type, setType] = useState<AccountType>("bank");
  const [opening, setOpening] = useState("0");
  const templates = getAccountTemplates();

  useEffect(() => {
    const match = templates.find((item) => item.name === template);
    if (match) setType(match.type);
  }, [template]);

  const save = async () => {
    const match = templates.find((item) => item.name === template);
    await createAccount({
      profileId,
      name: template,
      type,
      openingBalance: parseMoney(opening),
      currency: "PHP",
      color: match?.color || "#10B981",
      icon: match?.icon || "banknote",
      isArchived: false,
    });
    setOpening("0");
    onClose();
  };

  if (!open) return null;
  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Add account"
    >
      <section className="account-sheet">
        <header className="sheet-header">
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
          <b>Add account</b>
          <span />
        </header>
        <div className="account-form">
          <label>
            Bank or e-wallet
            <select
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
            >
              {templates.map((item) => (
                <option key={item.name}>{item.name}</option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select
              value={type}
              onChange={(e) => setType(e.target.value as AccountType)}
            >
              <option value="bank">Bank</option>
              <option value="ewallet">E-wallet</option>
              <option value="cash">Cash</option>
              <option value="credit_card">Credit card</option>
              <option value="investment">Investment</option>
              <option value="loan">Loan</option>
            </select>
          </label>
          <label>
            Opening balance
            <input
              inputMode="decimal"
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
            />
          </label>
          <button className="save-button" onClick={save}>
            Add account
          </button>
        </div>
      </section>
    </div>
  );
}

export default App;
