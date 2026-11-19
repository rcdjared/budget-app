import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ScanLine,
  UserRound,
  BarChart3,
  Banknote,
  ChevronRight,
  CalendarClock,
  HandCoins,
  Home,
  MessageCircle,
  Send,
  PiggyBank,
  Plus,
  ReceiptText,
  Search,
  Settings2,
  Moon,
  Sun,
  Trash2,
  WalletCards,
  X,
  Edit2,
  HelpCircle,
  Tags,
  Download,
  Upload,
  FileSpreadsheet,
} from "lucide-react";
import { db } from "@/db/schema";
import { initializeAppData, getAccountTemplates, seedDefaultCategories } from "@/db/seed";
import { createProfile } from "@/db/repositories/profiles";
import { createAccount, softDeleteAccount } from "@/db/repositories/accounts";
import { createTransaction, softDeleteTransaction } from "@/db/repositories/transactions";
import { computeAccountBalance, computeNetWorth } from "@/domain/balances";
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

type Tab = "home" | "wallet" | "plan" | "history";
type ThemePreference = "system" | "light" | "dark" | "amoled";

const tabItems: { id: Tab | "add"; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "wallet", label: "Wallet", icon: WalletCards },
  { id: "plan", label: "Plan", icon: PiggyBank },
  { id: "history", label: "History", icon: ReceiptText },
  { id: "add", label: "Add", icon: Plus },
];

const TAB_ORDER: Tab[] = ["home", "wallet", "plan", "history"];

function App() {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [slideDirection, setSlideDirection] = useState<"forward" | "backward">("forward");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [formInitialType, setFormInitialType] = useState<TransactionType>("expense");
  const [accountOpen, setAccountOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const navigateToTab = (nextTab: Tab) => {
    if (nextTab === tab) return;
    const currentIndex = TAB_ORDER.indexOf(tab);
    const nextIndex = TAB_ORDER.indexOf(nextTab);
    setSlideDirection(nextIndex >= currentIndex ? "forward" : "backward");
    setTab(nextTab);
    scrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
  };

  const switchProfile = async (nextProfileId: string) => {
    await db.transaction("rw", db.profiles, async () => {
      await db.profiles.toCollection().modify((profile) => {
        if (!profile.deletedAt) profile.isDefault = profile.id === nextProfileId;
      });
    });
    setProfileId(nextProfileId);
    setProfilesOpen(false);
  };

  const [themePreference, setThemePreference] = useState<ThemePreference>(() => {
    const saved = localStorage.getItem("kupit-theme");
    return saved === "light" || saved === "dark" || saved === "amoled" ? saved : "system";
  });
  const [online, setOnline] = useState(navigator.onLine);
  useRegisterSW({ immediate: true });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const dark =
        themePreference === "dark" ||
        themePreference === "amoled" ||
        (themePreference === "system" && media.matches);
      const light = themePreference === "light" || (themePreference === "system" && !media.matches);
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.classList.toggle("light", light);
      document.documentElement.classList.toggle("amoled", themePreference === "amoled");
      document.documentElement.style.colorScheme = dark ? "dark" : "light";
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", themePreference === "amoled" ? "#000000" : dark ? "#0A0E0D" : "#019B51");
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
    navigator.storage?.persist?.().catch(() => {});
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (!profileId) {
    return (
      <main className="grid h-dvh place-items-center bg-background">
        <div className="kupit-splash">
          <img src="/icons/kupit-logo.svg" alt="Kupit logo" className="splash-logo" />
          <h1 className="splash-title">Kupit</h1>
          <div className="pulse-loader" aria-label="Loading Kupit" />
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      {!online && (
        <div className="offline-banner">Offline — changes remain saved on this device</div>
      )}

      <div className="page-scroll" ref={scrollRef}>
        <div key={tab} className={`tab-page-slide slide-${slideDirection}`}>
          {tab === "home" && (
            <HomePage
              profileId={profileId}
              onProfiles={() => setProfilesOpen(true)}
              onSettings={() => setSettingsOpen(true)}
              onHistory={() => navigateToTab("history")}
              onOpenHelp={() => setHelpOpen(true)}
            />
          )}
          {tab === "wallet" && (
            <AccountsPage profileId={profileId} onAdd={() => setAccountOpen(true)} />
          )}
          {tab === "plan" && (
            <BudgetsPage
              profileId={profileId}
              onOpenCategories={() => setCategoryManagerOpen(true)}
            />
          )}
          {tab === "history" && <TransactionsPage profileId={profileId} />}
        </div>
      </div>

      {/* Primary 5-Tab Navigation Bar */}
      <nav className="bottom-nav" aria-label="Primary navigation">
        {tabItems.map((item) => (
          <TabButton
            key={item.id}
            item={item}
            active={tab === item.id || (item.id === "add" && addMenuOpen)}
            addMenuOpen={addMenuOpen}
            onClick={() => item.id === "add" ? setAddMenuOpen((open) => !open) : navigateToTab(item.id)}
          />
        ))}
      </nav>

      {addMenuOpen && (
        <AddActionsMenu
          onClose={() => setAddMenuOpen(false)}
          onAction={(action) => {
            setAddMenuOpen(false);
            if (action === "chat") {
              setChatOpen(true);
              return;
            }
            setFormInitialType(action === "transfer" ? "transfer" : action === "income" ? "income" : "expense");
            setAddOpen(true);
          }}
        />
      )}

      {/* Sheets and Overlays */}
      <AddTransactionSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        profileId={profileId}
        initialType={formInitialType}
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
        onOpenForm={() => { setFormInitialType("expense"); setChatOpen(false); setAddOpen(true); }}
        profileId={profileId}
      />

      <ProfilesSheet
        open={profilesOpen}
        onClose={() => setProfilesOpen(false)}
        profileId={profileId}
        onSwitchProfile={switchProfile}
      />

      <SettingsSheet
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        themePreference={themePreference}
        onThemeChange={setThemePreference}
        onOpenCategories={() => setCategoryManagerOpen(true)}
        onOpenPlan={() => {
          setSettingsOpen(false);
          navigateToTab("plan");
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

type AddAction = "chat" | "transfer" | "scan" | "income" | "expense";

function AddActionsMenu({
  onClose,
  onAction,
}: {
  onClose: () => void;
  onAction: (action: AddAction) => void;
}) {
  const actions: { id: AddAction; label: string; hint: string; icon: typeof Home }[] = [
    { id: "chat", label: "Chat", hint: "Log naturally with your assistant", icon: MessageCircle },
    { id: "transfer", label: "Transfer", hint: "Move money between accounts", icon: ArrowLeftRight },
    { id: "scan", label: "Scan receipt", hint: "Add a receipt photo", icon: ScanLine },
    { id: "income", label: "Income", hint: "Record money received", icon: ArrowDownLeft },
    { id: "expense", label: "Expense", hint: "Record money spent", icon: ArrowUpRight },
  ];

  return (
    <div className="add-menu-overlay" onClick={onClose}>
      <section
        className="add-menu"
        role="dialog"
        aria-modal="true"
        aria-label="Add to your budget"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="add-menu-heading">
          <b>Quick actions</b>
          <small>Choose how you want to add something</small>
        </div>
        {actions.map(({ id, label, hint, icon: Icon }) => (
          <button key={id} className="add-menu-item" onClick={() => onAction(id)}>
            <span className={`add-menu-icon ${id}`}><Icon size={19} /></span>
            <span className="add-menu-copy"><b>{label}</b><small>{hint}</small></span>
            <ChevronRight size={17} className="add-menu-chevron" />
          </button>
        ))}
      </section>
    </div>
  );
}

function ProfilesSheet({
  open,
  onClose,
  profileId,
  onSwitchProfile,
}: {
  open: boolean;
  onClose: () => void;
  profileId: string;
  onSwitchProfile: (id: string) => Promise<void>;
}) {
  const profiles = useLiveQuery(
    () => db.profiles.filter((profile) => !profile.deletedAt).toArray(),
    [],
    []
  );
  const [newName, setNewName] = useState("");

  const addProfile = async () => {
    const name = newName.trim();
    if (!name || profiles.length >= 4) return;
    const id = await createProfile({ name, currency: "PHP", isDefault: false });
    await seedDefaultCategories(id);
    setNewName("");
    await onSwitchProfile(id);
  };

  if (!open) return null;
  return (
    <div className="sheet-backdrop" role="dialog" aria-modal="true" aria-label="Profiles" onClick={onClose}>
      <section className="account-sheet profiles-sheet" onClick={(event) => event.stopPropagation()}>
        <div className="sheet-grabber" />
        <header className="sheet-header">
          <button className="sheet-close-btn" onClick={onClose} aria-label="Close profiles"><X size={18} /></button>
          <b>Profiles</b>
          <span />
        </header>
        <div className="profiles-content">
          <p className="eyebrow">Your spaces <span>{profiles.length}/4</span></p>
          <div className="profile-options">
            {profiles.map((profile) => (
              <button
                key={profile.id}
                className={`profile-option ${profile.id === profileId ? "selected" : ""}`}
                onClick={() => void onSwitchProfile(profile.id)}
              >
                <span className="profile-option-icon"><UserRound size={18} /></span>
                <span><b>{profile.name}</b><small>{profile.currency} · {profile.id === profileId ? "Current profile" : "Local profile"}</small></span>
                {profile.id === profileId && <span className="profile-current-mark">Current</span>}
              </button>
            ))}
          </div>
          {profiles.length < 4 && (
            <form className="profile-create" onSubmit={(event) => { event.preventDefault(); void addProfile(); }}>
              <label htmlFor="new-profile-name">Create a profile</label>
              <div>
                <input id="new-profile-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. Family" maxLength={32} />
                <button type="submit" disabled={!newName.trim()}>Add</button>
              </div>
            </form>
          )}
          <p className="profile-privacy-note">Each profile keeps its accounts and transactions separate on this device.</p>
        </div>
      </section>
    </div>
  );
}

function TabButton({
  item,
  active,
  addMenuOpen = false,
  onClick,
}: {
  item: (typeof tabItems)[number];
  active: boolean;
  addMenuOpen?: boolean;
  onClick: () => void;
}) {
  const Icon = item.id === "add" && addMenuOpen ? X : item.icon;
  return (
    <button className={`nav-item ${active ? "active" : ""} ${item.id === "add" ? "add-action" : ""}`} onClick={onClick} aria-label={item.label}>
      <Icon size={20} />
      <span>{item.label}</span>
    </button>
  );
}

function HomePage({
  profileId,
  onProfiles,
  onSettings,
  onHistory,
  onOpenHelp,
}: {
  profileId: string;
  onProfiles: () => void;
  onSettings: () => void;
  onHistory: () => void;
  onOpenHelp: () => void;
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

  return (
    <div className="content">
      {/* Brand Header with Official Kupit Logo */}
      <header className="page-header home-header">
        <div className="brand-header-left">
          <img
            src="/icons/kupit-logo.svg"
            alt="Kupit Logo"
            className="brand-header-logo"
          />
          <div>
            <span className="brand-header-title">Kupit</span>
            <p className="eyebrow">
              {new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </p>
          </div>
        </div>
        <div className="header-buttons">
          <button className="header-chat profile-icon-button" onClick={onProfiles} aria-label="Profiles" title="Profiles">
            <UserRound size={19} />
          </button>
          <button className="header-chat settings-icon-button" aria-label="Settings" onClick={onSettings}>
            <Settings2 size={20} />
          </button>
        </div>
      </header>

      <FinsightsPage profileId={profileId} onOpenHelp={onOpenHelp} />

      {/* Recent Transactions */}
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

        const primaryTitle = transfer
          ? `Transfer`
          : category?.name || (positive ? "Income" : "Expense");

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

      {/* Filter Chips */}
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
  const recentIncome = transactions
    .filter((transaction) => transaction.type === "income")
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, 5);

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

      <section className="section wallet-income-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Money in</p>
            <h2>Recent income</h2>
          </div>
        </div>
        <TransactionList
          transactions={recentIncome}
          accounts={accounts}
          profileId={profileId}
        />
      </section>
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
          <h2>This month's budgets</h2>
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
            <small>Set a monthly spending limit for a category.</small>
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
  onOpenForm,
  profileId,
}: {
  open: boolean;
  onClose: () => void;
  onOpenForm: () => void;
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
  const [conversation, setConversation] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [drafts, setDrafts] = useState<ReturnType<typeof parseMultipleTransactions>>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => textareaRef.current?.focus(), 120);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  const parseMessage = () => {
    const text = message.trim();
    if (!text) return;
    const parsed = parseMultipleTransactions(text, accounts.map((account) => account.name));
    const draftsToReview = accounts.length ? parsed : [];
    setConversation((current) => [
      ...current,
      { role: "user", text },
      {
        role: "assistant",
        text: draftsToReview.length
          ? "Here’s what I understood. Review the details before saving."
          : !accounts.length && parsed.length
          ? "I understood the transaction. Add an account with the plus button above, then I can save it."
          : "I couldn’t find an amount yet. Try something like “Coffee 180” or “Salary 30k”.",
      },
    ]);
    setDrafts(draftsToReview);
    setMessage("");
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
    setConversation([]);
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
      <section className="account-sheet chat-sheet chat-screen">
        <header className="sheet-header">
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
          <div className="chat-heading">
            <b>Money assistant</b>
            <small>Private, on-device logging</small>
          </div>
          <button className="chat-form-shortcut" onClick={onOpenForm} aria-label="Open transaction form" title="Use transaction form">
            <Plus size={19} />
          </button>
        </header>
        <div className="chat-messages">
          {!conversation.length && (
            <div className="assistant-message">
              <span className="assistant-mark"><MessageCircle size={17} /></span>
              <div>
                <b>Hi! What would you like to log?</b>
                <p>Tell me naturally. I’ll prepare the details for you to check.</p>
                <div className="chat-examples">
                  <button onClick={() => { setMessage("Coffee 180 today"); textareaRef.current?.focus(); }}>“Coffee 180 today”</button>
                  <button onClick={() => { setMessage("Salary 30k"); textareaRef.current?.focus(); }}>“Salary 30k”</button>
                </div>
              </div>
            </div>
          )}
          {conversation.map((entry, index) => (
            <div key={`${entry.role}-${index}`} className={`chat-message ${entry.role}`}>
              {entry.text}
            </div>
          ))}
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
        </div>
        <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); parseMessage(); }}>
          <textarea
            ref={textareaRef}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                parseMessage();
              }
            }}
            placeholder="Describe an income or expense"
            rows={1}
            aria-label="Message your money assistant"
          />
          <button type="submit" aria-label="Send message" disabled={!message.trim()}>
            <Send size={18} />
          </button>
          <small>Enter to send · Shift + Enter for a new line</small>
        </form>
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
        <div className="sheet-grabber" />
        <header className="sheet-header">
          <button className="sheet-close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
          <b>Settings</b>
          <div className="sheet-header-spacer" />
        </header>

        {/* Brand Showcase */}
        <div className="settings-brand-banner">
          <img
            src="/icons/k-logoname.png"
            alt="Kupit Logo"
            className="settings-brand-img"
          />
          <p className="settings-brand-tagline">Your money, in hand</p>
        </div>

        <div className="ios-settings-container">
          {/* Group 1: Preferences */}
          <div className="ios-grouped-section">
            <div className="ios-group-title">Preferences</div>
            <div className="ios-group-card">
              <button
                className="ios-row-btn"
                onClick={() => {
                  onClose();
                  onOpenCategories();
                }}
              >
                <div className="ios-row-left">
                  <span className="ios-squircle squircle-purple">
                    <Tags size={18} />
                  </span>
                  <div className="ios-row-text">
                    <span className="ios-row-label">Categories & Icons</span>
                    <small className="ios-row-sub">{categories.length} categories configured</small>
                  </div>
                </div>
                <div className="ios-row-right">
                  <ChevronRight size={18} className="ios-chevron" />
                </div>
              </button>

              <div className="ios-divider" />

              <button className="ios-row-btn" onClick={onOpenPlan}>
                <div className="ios-row-left">
                  <span className="ios-squircle squircle-amber">
                    <PiggyBank size={18} />
                  </span>
                  <div className="ios-row-text">
                    <span className="ios-row-label">Budgets & Goals</span>
                    <small className="ios-row-sub">Monthly spending limits</small>
                  </div>
                </div>
                <div className="ios-row-right">
                  <ChevronRight size={18} className="ios-chevron" />
                </div>
              </button>

              <div className="ios-divider" />

              <div className="ios-row-btn ios-row-non-clickable">
                <div className="ios-row-left">
                  <span className="ios-squircle squircle-blue">
                    {themePreference === "dark" || themePreference === "amoled" ? <Moon size={18} /> : <Sun size={18} />}
                  </span>
                  <div className="ios-row-text">
                    <span className="ios-row-label">Appearance</span>
                  </div>
                </div>
                <div className="ios-segmented-control" role="radiogroup" aria-label="Appearance">
                  {(["system", "light", "dark", "amoled"] as ThemePreference[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`ios-segmented-btn ${themePreference === mode ? "active" : ""}`}
                      onClick={() => onThemeChange(mode)}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Group 2: Cloud Sync */}
          <div className="ios-grouped-section">
            <div className="ios-group-title">Cloud & Sync</div>
            <div className="ios-group-card cloud-ios-card">
              <div className="cloud-panel-title">
                <div>
                  <b>Private Cloud Sync</b>
                  <small>Offline-first · Row-level security</small>
                </div>
                <span
                  className={session ? "cloud-status connected" : "cloud-status"}
                >
                  {session ? "Connected" : "Local only"}
                </span>
              </div>
              {!cloudSyncAvailable ? (
                <p className="cloud-help">
                  Add your Supabase URL and key to <code>.env</code> to activate multi-device cloud sync.
                </p>
              ) : session ? (
                <div className="cloud-actions">
                  <p className="cloud-help">
                    Signed in as {session.user.email}.
                  </p>
                  <button
                    className="save-button"
                    onClick={syncCloud}
                    disabled={cloudBusy}
                  >
                    {cloudBusy ? "Syncing…" : "Sync this device now"}
                  </button>
                  <button
                    className="text-button"
                    onClick={signOut}
                    disabled={cloudBusy}
                  >
                    Sign out
                  </button>
                </div>
              ) : (
                <div className="cloud-actions">
                  <p className="cloud-help">
                    Sign in with an email link to sync your budget data across all your devices.
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
                </div>
              )}
              {cloudMessage && <p className="cloud-message">{cloudMessage}</p>}
              {cloudError && (
                <p className="cloud-error" role="alert">
                  {cloudError}
                </p>
              )}
            </div>
          </div>

          {/* Group 3: Data & Backup */}
          <div className="ios-grouped-section">
            <div className="ios-group-title">Data & Backup</div>
            <div className="ios-group-card">
              <button className="ios-row-btn" onClick={exportTransactionsCsv}>
                <div className="ios-row-left">
                  <span className="ios-squircle squircle-green">
                    <FileSpreadsheet size={18} />
                  </span>
                  <span className="ios-row-label">Export Transactions</span>
                </div>
                <div className="ios-row-right">
                  <span className="ios-badge">CSV</span>
                  <ChevronRight size={18} className="ios-chevron" />
                </div>
              </button>

              <div className="ios-divider" />

              <button className="ios-row-btn" onClick={exportJsonBackup}>
                <div className="ios-row-left">
                  <span className="ios-squircle squircle-teal">
                    <Download size={18} />
                  </span>
                  <span className="ios-row-label">Export Full Backup</span>
                </div>
                <div className="ios-row-right">
                  <span className="ios-badge">JSON</span>
                  <ChevronRight size={18} className="ios-chevron" />
                </div>
              </button>

              <div className="ios-divider" />

              <label className="ios-row-btn" style={{ cursor: "pointer" }}>
                <div className="ios-row-left">
                  <span className="ios-squircle squircle-sky">
                    <Upload size={18} />
                  </span>
                  <span className="ios-row-label">Import Backup</span>
                </div>
                <div className="ios-row-right">
                  <span className="ios-badge">Select file</span>
                  <ChevronRight size={18} className="ios-chevron" />
                </div>
                <input
                  type="file"
                  accept=".json,application/json"
                  style={{ display: "none" }}
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (file) await importJsonBackup(file);
                  }}
                />
              </label>
            </div>
          </div>

          {/* Group 4: Danger Zone */}
          <div className="ios-grouped-section">
            <div className="ios-group-card">
              <button className="ios-row-btn danger-row" onClick={resetData}>
                <div className="ios-row-left">
                  <span className="ios-squircle squircle-rose">
                    <Trash2 size={18} />
                  </span>
                  <span className="ios-row-label">
                    {confirmReset ? "Tap again to confirm reset" : "Reset All Data"}
                  </span>
                </div>
                {confirmReset && <span className="ios-badge danger-badge">Confirm</span>}
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function AddTransactionSheet({
  open,
  onClose,
  profileId,
  initialType,
  onOpenCategoryManager,
}: {
  open: boolean;
  onClose: () => void;
  profileId: string;
  initialType: TransactionType;
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
    if (open) setType(initialType);
  }, [open, initialType]);

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
        <div className="sheet-grabber" />
        <header className="sheet-header">
          <button className="sheet-close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
          <div className="type-tabs" role="tablist">
            {(["expense", "income", "transfer"] as TransactionType[]).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                className={`type-tab-btn ${type === value ? "active" : ""}`}
                aria-selected={type === value}
                onClick={() => setType(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="sheet-header-spacer" />
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
      color: match?.color || "#019B51",
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
