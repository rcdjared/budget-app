import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Camera,
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
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldCheck,
  Pause,
  Play,
} from "lucide-react";
import { db } from "@/db/schema";
import { initializeAppData, getAccountTemplates, seedDefaultCategories, EXPENSE_CATEGORIES, LEGACY_EXPENSE_CATEGORY_NAMES } from "@/db/seed";
import { createProfile } from "@/db/repositories/profiles";
import { createAccount, softDeleteAccount } from "@/db/repositories/accounts";
import { createTransaction, createTransfer, updateTransfer, softDeleteTransaction } from "@/db/repositories/transactions";
import { createRecurringRule, processDueRecurringTransactions } from "@/db/repositories/recurring";
import { computeAccountBalance, computeNetWorth } from "@/domain/balances";
import { formatMoney, parseMoney } from "@/domain/money";
import { formatRelativeDate, getCurrentMonthRange, toDateString } from "@/lib/format";
import { ensureDailySnapshot, exportJsonBackup, exportTransactionsCsv, importJsonBackup } from "@/lib/backup";
import { canAffordAmount, generateForecast, sumLiquidAccountBalance } from "@/domain/forecast";
import { normalizeLearningKey, parseMultipleTransactions } from "@/domain/parser";
import { answerLocalMoneyQuestion, explainLocalCapabilities } from "@/domain/localAssistant";
import { cloudSyncAvailable, supabase } from "@/lib/supabase";
import { syncLocalData } from "@/sync/sync";
import type { Session } from "@supabase/supabase-js";
import { recognize } from "tesseract.js";
import {
  calculateCentavos,
  centavosToEntry,
  percentCentavos,
  type CalculatorOperator,
} from "@/domain/calculator";
import type { Account, AccountType, Category, CategoryType, RecurringFrequency, Transaction, TransactionType } from "@/domain/types";
import { CategoryIcon } from "@/components/CategoryIcon";
import { AccountLogo } from "@/components/AccountLogo";
import { CategoryManagerSheet } from "@/components/CategoryManagerSheet";
import { FinsightsPage } from "@/components/FinsightsPage";
import { useSheetGestures } from "@/hooks/useSheetGestures";
import { useCollapsingNav } from "@/hooks/useCollapsingNav";

type Tab = "home" | "wallet" | "plan" | "history";
type ThemePreference = "system" | "light" | "dark" | "amoled";

const tabItems: { id: Tab | "add"; label: string; icon: typeof Home }[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "wallet", label: "Wallet", icon: WalletCards },
  { id: "plan", label: "Plan", icon: PiggyBank },
  { id: "history", label: "History", icon: ReceiptText },
  { id: "add", label: "Add", icon: Plus },
];

const EXPENSE_CATEGORY_ORDER = new Map(EXPENSE_CATEGORIES.map((category, index) => [category.name.toLowerCase(), index]));
const NAV_DROP_ORDER = ["home", "wallet", "plan", "history", "add"] as const;

function App() {
  const [profileId, setProfileId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const scrollRef = useRef<HTMLDivElement>(null);
  const [navCollapsed, setNavCollapsed] = useCollapsingNav(scrollRef, tab, Boolean(profileId));
  const [navEntering, setNavEntering] = useState(true);
  const [navDragging, setNavDragging] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const navDragRef = useRef<{ pointerId: number; startX: number; startY: number; pointerToBubble: number; didDrag: boolean } | null>(null);
  const suppressNavClickRef = useRef(false);
  const [addOpen, setAddOpen] = useState(false);
  const [receiptFlowOpen, setReceiptFlowOpen] = useState(false);
  const [editingTransferId, setEditingTransferId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [addMenuClosing, setAddMenuClosing] = useState(false);
  const addMenuCloseTimer = useRef<number | null>(null);
  const quickActionHistoryEntry = useRef(false);
  const [formInitialType, setFormInitialType] = useState<TransactionType>("expense");
  const [accountOpen, setAccountOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [profilesOpen, setProfilesOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [authCallbackNotice, setAuthCallbackNotice] = useState("");
  const handledAuthCallback = useRef(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [categoryPickMode, setCategoryPickMode] = useState(false);
  const [categoryManagerType, setCategoryManagerType] = useState<CategoryType>("expense");
  const categoryPicker = useRef<((categoryId: string) => void) | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [recurringShortcutId, setRecurringShortcutId] = useState<string | null>(null);

  const closeAddMenu = (afterClose?: () => void) => {
    if (!addMenuOpen) {
      afterClose?.();
      return;
    }
    if (addMenuCloseTimer.current !== null) return;
    setAddMenuClosing(true);
    const closeDuration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 1 : 200;
    if (quickActionHistoryEntry.current) {
      quickActionHistoryEntry.current = false;
      window.history.back();
    }
    addMenuCloseTimer.current = window.setTimeout(() => {
      addMenuCloseTimer.current = null;
      setAddMenuOpen(false);
      setAddMenuClosing(false);
      afterClose?.();
    }, closeDuration);
  };

  const navigateToTab = (nextTab: Tab) => {
    if (addMenuOpen) closeAddMenu();
    setNavCollapsed(false);
    if (nextTab === tab) return;
    setTab(nextTab);
    scrollRef.current?.scrollTo({ top: 0, behavior: "instant" });
  };

  const handleNavPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const activeButton = target.closest<HTMLButtonElement>(".nav-item.active");
    if (!activeButton) return;
    const buttonRect = activeButton.getBoundingClientRect();
    navDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      pointerToBubble: buttonRect.left + buttonRect.width / 2 - event.clientX,
      didDrag: false,
    };
    try { activeButton.setPointerCapture(event.pointerId); } catch { /* Pointer capture may be unavailable in older browsers. */ }
  };

  const handleNavPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = navDragRef.current;
    const nav = navRef.current;
    if (!drag || !nav || drag.pointerId !== event.pointerId) return;
    const delta = event.clientX - drag.startX;
    const verticalDelta = event.clientY - drag.startY;
    if (!drag.didDrag && (Math.abs(delta) < 6 || Math.abs(delta) < Math.abs(verticalDelta) * 1.15)) return;
    if (!drag.didDrag) {
      drag.didDrag = true;
      setNavDragging(true);
      if (navCollapsed) setNavCollapsed(false);
    }
    event.preventDefault();
    const navRect = nav.getBoundingClientRect();
    const bubbleCenter = event.clientX + drag.pointerToBubble;
    nav.style.setProperty("--active-offset", `${bubbleCenter - (navRect.left + navRect.width / 2)}px`);
  };

  const handleNavPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = navDragRef.current;
    const nav = navRef.current;
    if (!drag || !nav || drag.pointerId !== event.pointerId) return;
    navDragRef.current = null;
    if (!drag.didDrag) {
      if (Math.abs(event.clientX - drag.startX) > 8 || Math.abs(event.clientY - drag.startY) > 8) {
        suppressNavClickRef.current = true;
        window.setTimeout(() => { suppressNavClickRef.current = false; }, 500);
      }
      return;
    }
    event.preventDefault();
    suppressNavClickRef.current = true;
    setNavDragging(false);
    setNavCollapsed(false);

    const navRect = nav.getBoundingClientRect();
    const bubbleCenter = event.clientX + drag.pointerToBubble;
    const relativePosition = Math.max(0, Math.min(1, (bubbleCenter - navRect.left) / navRect.width));
    const targetIndex = Math.max(0, Math.min(NAV_DROP_ORDER.length - 1, Math.round(relativePosition * NAV_DROP_ORDER.length - 0.5)));
    const target = NAV_DROP_ORDER[targetIndex];
    const targetOffset = navRect.width * ((targetIndex + 0.5) / NAV_DROP_ORDER.length - 0.5);
    nav.style.setProperty("--active-offset", `${targetOffset}px`);

    if (target === "add") setAddMenuOpen(true);
    else navigateToTab(target);
    requestAnimationFrame(() => navRef.current?.style.removeProperty("--active-offset"));
    window.setTimeout(() => { suppressNavClickRef.current = false; }, 500);
  };

  const handleNavPointerCancel = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = navDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    navDragRef.current = null;
    navRef.current?.style.removeProperty("--active-offset");
    setNavDragging(false);
  };

  const handleNavClickCapture = (event: ReactMouseEvent<HTMLElement>) => {
    if (!suppressNavClickRef.current) return;
    suppressNavClickRef.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  useEffect(() => {
    if (!addMenuOpen) return;
    setAddMenuClosing(false);
    quickActionHistoryEntry.current = true;
    window.history.pushState({ ...(window.history.state || {}), quickActionsOpen: true }, "", window.location.href);
    const closeForBack = () => {
      quickActionHistoryEntry.current = false;
      closeAddMenu();
    };
    const closeOnBackground = () => {
      if (document.visibilityState === "hidden") closeAddMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAddMenu();
    };
    window.addEventListener("popstate", closeForBack);
    document.addEventListener("visibilitychange", closeOnBackground);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("popstate", closeForBack);
      document.removeEventListener("visibilitychange", closeOnBackground);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [addMenuOpen]);

  useEffect(() => {
    const timer = window.setTimeout(() => setNavEntering(false), 520);
    return () => window.clearTimeout(timer);
  }, []);

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
  useSheetGestures();

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
    if (!profileId) return;
    const processDue = () => {
      if (document.visibilityState === "visible") {
        void processDueRecurringTransactions(profileId, toDateString(new Date())).catch(console.error);
      }
    };
    processDue();
    document.addEventListener("visibilitychange", processDue);
    window.addEventListener("online", processDue);
    return () => {
      document.removeEventListener("visibilitychange", processDue);
      window.removeEventListener("online", processDue);
    };
  }, [profileId]);

  useEffect(() => {
    const openRule = (event: Event) => {
      const custom = event as CustomEvent<string>;
      setRecurringShortcutId(custom.detail || "");
    };
    window.addEventListener("kupit:recurring-rule", openRule);
    return () => window.removeEventListener("kupit:recurring-rule", openRule);
  }, []);

  useEffect(() => {
    const editTransfer = (event: Event) => {
      const custom = event as CustomEvent<string>;
      setEditingTransferId(custom.detail);
      setReceiptFlowOpen(false);
      setFormInitialType("transfer");
      setAddOpen(true);
    };
    window.addEventListener("kupit:edit-transfer", editTransfer);
    return () => window.removeEventListener("kupit:edit-transfer", editTransfer);
  }, []);

  useEffect(() => {
    if (!supabase || handledAuthCallback.current) return;
    const callbackUrl = new URL(window.location.href);
    const hasAuthError = callbackUrl.searchParams.has("error") || callbackUrl.searchParams.has("error_description");
    const hasAuthCode = callbackUrl.searchParams.has("code") || /access_token=|refresh_token=|type=(signup|magiclink)/i.test(callbackUrl.hash);
    if (!hasAuthError && !hasAuthCode) return;
    handledAuthCallback.current = true;
    setSettingsOpen(true);
    if (hasAuthError) {
      setAuthCallbackNotice(callbackUrl.searchParams.get("error_description") || "The sign-in link could not be verified. Request a new link from Kupit.");
      window.history.replaceState({}, document.title, callbackUrl.pathname);
      return;
    }
    void supabase.auth.getSession().then(({ data, error }) => {
      if (error) setAuthCallbackNotice(`We could not complete sign-in: ${error.message}`);
      else if (data.session) setAuthCallbackNotice("Sign-up complete. Your account is connected. You can return to Kupit and sync this device when ready.");
      else setAuthCallbackNotice("The verification link was opened. If you are not signed in, request a new link from Kupit.");
      window.history.replaceState({}, document.title, callbackUrl.pathname);
    });
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
        <div key={tab} className="tab-page-slide">
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
      <nav
        ref={navRef}
        className={`bottom-nav ${navCollapsed ? "collapsed" : ""} ${navEntering ? "nav-entering" : ""} ${navDragging ? "dragging" : ""}`}
        data-active-tab={addMenuOpen ? "add" : tab}
        aria-label="Primary navigation"
        onPointerDown={handleNavPointerDown}
        onPointerMove={handleNavPointerMove}
        onPointerUp={handleNavPointerUp}
        onPointerCancel={handleNavPointerCancel}
        onClickCapture={handleNavClickCapture}
      >
        {tabItems.map((item) => (
          <TabButton
            key={item.id}
            item={item}
            active={tab === item.id || (item.id === "add" && addMenuOpen)}
            collapsed={navCollapsed}
            addMenuOpen={addMenuOpen}
            onClick={() => navCollapsed
              ? setNavCollapsed(false)
              : item.id === "add"
              ? addMenuOpen ? closeAddMenu() : setAddMenuOpen(true)
              : navigateToTab(item.id)}
          />
        ))}
      </nav>

      {addMenuOpen && (
        <AddActionsMenu
          closing={addMenuClosing}
          onClose={() => closeAddMenu()}
          onAction={(action) => closeAddMenu(() => {
            if (action === "chat") {
              setChatOpen(true);
              return;
            }
            if (action === "scan") {
              setFormInitialType("expense");
              setReceiptFlowOpen(true);
              setAddOpen(true);
              return;
            }
            setReceiptFlowOpen(false);
            setFormInitialType(action === "transfer" ? "transfer" : action === "income" ? "income" : "expense");
            setAddOpen(true);
          })}
        />
      )}

      {/* Sheets and Overlays */}
      <AddTransactionSheet
        open={addOpen}
        onClose={() => { setAddOpen(false); setReceiptFlowOpen(false); setEditingTransferId(null); }}
        profileId={profileId}
        initialType={formInitialType}
        receiptFlow={receiptFlowOpen}
        editTransactionId={editingTransferId || undefined}
        onOpenCategoryManager={(categoryType, onSelect) => {
          categoryPicker.current = (categoryId) => {
            onSelect(categoryId);
            document.querySelector<HTMLElement>(".add-sheet")?.setAttribute("data-sheet-dirty", "true");
          };
          setCategoryManagerType(categoryType);
          setCategoryPickMode(true);
          setCategoryManagerOpen(true);
        }}
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
        onOpenCategories={() => {
          setCategoryManagerType("expense");
          setCategoryPickMode(false);
          setCategoryManagerOpen(true);
        }}
        onOpenPlan={() => {
          setSettingsOpen(false);
          navigateToTab("plan");
        }}
        authCallbackNotice={authCallbackNotice}
      />

      <CategoryManagerSheet
        open={categoryManagerOpen}
        onClose={() => {
          setCategoryManagerOpen(false);
          setCategoryPickMode(false);
          categoryPicker.current = null;
        }}
        profileId={profileId}
        defaultType={categoryManagerType}
        onSelectCategory={categoryPickMode ? (id) => categoryPicker.current?.(id) : undefined}
      />

      {recurringShortcutId !== null && (
        <RecurringSheet onClose={() => setRecurringShortcutId(null)} focusRuleId={recurringShortcutId || undefined} />
      )}

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
      aria-label="About Money Insights"
    >
      <section className="account-sheet" style={{ padding: "16px 20px 24px" }}>
        <header className="sheet-header" style={{ marginBottom: "12px" }}>
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
          <b>About Money Insights</b>
          <span />
        </header>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "14px", lineHeight: "1.5" }}>
          <p>
            <b>Money Insights</b> gives you clear visibility into your spending trends and income patterns across all your accounts or per specific bank/e-wallet.
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
  closing,
}: {
  onClose: () => void;
  onAction: (action: AddAction) => void;
  closing: boolean;
}) {
  const actions: { id: AddAction; label: string; hint: string; icon: typeof Home }[] = [
    { id: "chat", label: "Chat", hint: "Log naturally with your assistant", icon: MessageCircle },
    { id: "transfer", label: "Transfer", hint: "Move money between accounts", icon: ArrowLeftRight },
    { id: "scan", label: "Scan receipt", hint: "Add a receipt photo", icon: ScanLine },
    { id: "income", label: "Income", hint: "Record money received", icon: ArrowDownLeft },
    { id: "expense", label: "Expense", hint: "Record money spent", icon: ArrowUpRight },
  ];

  return (
    <div className={`add-menu-overlay ${closing ? "is-closing" : ""}`} onClick={onClose}>
      <section
        className={`add-menu ${closing ? "is-closing" : ""}`}
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
  collapsed,
  addMenuOpen = false,
  onClick,
}: {
  item: (typeof tabItems)[number];
  active: boolean;
  collapsed: boolean;
  addMenuOpen?: boolean;
  onClick: () => void;
}) {
  const Icon = item.id === "add" && addMenuOpen ? X : item.icon;
  return (
    <button className={`nav-item ${active ? "active" : ""} ${item.id === "add" ? "add-action" : ""}`} onClick={onClick} aria-label={item.id === "home" && collapsed ? "Expand navigation" : item.label} aria-expanded={item.id === "home" ? !collapsed : undefined}>
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
          transfer && tx.externalFromName
            ? `${tx.externalFromName} → ${account?.name || "Account"}`
            : transfer && tx.externalToName
            ? `${account?.name || "Account"} → ${tx.externalToName}`
            : transfer && toAccount
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
                {tx.recurringId && (
                  <button
                    type="button"
                    className="recurring-transaction-badge"
                    onClick={() => window.dispatchEvent(new CustomEvent("kupit:recurring-rule", { detail: tx.recurringId }))}
                    aria-label="Open recurring rule"
                  >
                    <CalendarClock size={12} /> Recurring
                  </button>
                )}
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
            {transfer && <div className="transaction-action-buttons">
              <button type="button" className="transaction-edit-button" aria-label="Edit transfer" onClick={() => window.dispatchEvent(new CustomEvent("kupit:edit-transfer", { detail: tx.id }))}><Edit2 size={15} /></button>
              <button type="button" className="transaction-edit-button" aria-label="Delete transfer" onClick={() => { if (window.confirm("Delete this transfer? Its linked fee will also be removed.")) void softDeleteTransaction(tx.id); }}><Trash2 size={15} /></button>
            </div>}
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
                  {account.type === "credit_card" ? (
                    <span className="account-icon"><WalletCards size={20} /></span>
                  ) : (
                    <AccountLogo name={account.name} color={account.color} type={account.type} size={48} />
                  )}
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

function RecurringSheet({ onClose, focusRuleId }: { onClose: () => void; focusRuleId?: string }) {
  const profile = useLiveQuery(
    () => db.profiles.filter((item) => item.isDefault && !item.deletedAt).first(),
    [],
    undefined
  );
  const accounts = useLiveQuery(
    () => profile ? db.accounts.where({ profileId: profile.id }).filter((item) => !item.deletedAt).toArray() : [],
    [profile?.id],
    []
  );
  const recurring = useLiveQuery(
    () => profile ? db.recurring.where({ profileId: profile.id }).filter((item) => !item.deletedAt).toArray() : [],
    [profile?.id],
    []
  );
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [nextDate, setNextDate] = useState(toDateString(new Date()));
  const [frequency, setFrequency] = useState<RecurringFrequency>("monthly");
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    if (!focusRuleId || !recurring.length) return;
    window.setTimeout(() => document.getElementById(`recurring-rule-${focusRuleId}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
  }, [focusRuleId, recurring]);

  useEffect(() => {
    if (!accountId && accounts.length) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  const save = async () => {
    if (!profile || !accountId || !parseMoney(amount)) return;
    const timestamp = new Date().toISOString();
    if (editingId) {
      await db.recurring.update(editingId, { amount: parseMoney(amount), accountId, note: name.trim() || null, frequency, nextDueDate: nextDate, updatedAt: timestamp });
      await processDueRecurringTransactions(profile.id, toDateString(new Date()));
      setEditingId(null);
    } else {
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
        occurrencesCreated: 0,
        isPaused: false,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      await processDueRecurringTransactions(profile.id, toDateString(new Date()));
    }
    document.querySelector<HTMLElement>(".recurring-sheet")?.removeAttribute("data-sheet-dirty");
    setName("");
    setAmount("");
  };

  const editRule = (item: typeof recurring[number]) => {
    setEditingId(item.id);
    setName(item.note || "");
    setAmount((item.amount / 100).toFixed(2));
    setAccountId(item.accountId);
    setNextDate(item.nextDueDate);
    setFrequency(item.frequency);
  };

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Recurring payments"
    >
      <section className="account-sheet recurring-sheet">
        <header className="sheet-header">
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
          <b>Recurring payments</b>
          <span />
        </header>
        <div className="recurring-list">
          {recurring.map((item) => (
            <article id={`recurring-rule-${item.id}`} key={item.id} className={item.isPaused ? "paused" : ""}>
              <span>
                <b>{item.note || item.kind}</b>
                <small>
                  {item.isPaused ? "Paused · " : ""}{item.frequency} · Next {item.nextDueDate}
                </small>
              </span>
              <strong>{formatMoney(item.amount)}</strong>
              <div className="recurring-row-actions">
                <button type="button" aria-label={item.isPaused ? "Resume recurring rule" : "Pause recurring rule"} onClick={() => void db.recurring.update(item.id, { isPaused: !item.isPaused, updatedAt: new Date().toISOString() })}>
                  {item.isPaused ? <Play size={16} /> : <Pause size={16} />}
                </button>
                <button type="button" aria-label="Edit recurring rule" onClick={() => editRule(item)}><Edit2 size={16} /></button>
                <button type="button" aria-label="Delete recurring rule" onClick={() => { if (window.confirm("Delete this recurring rule? Past transactions will stay.")) void db.recurring.update(item.id, { deletedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }); }}><Trash2 size={16} /></button>
              </div>
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
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
          </div>
          <button className="save-button" onClick={save}>
            {editingId ? "Save changes" : "Add recurring rule"}
          </button>
          {editingId && <button type="button" className="cat-cancel-btn" onClick={() => { setEditingId(null); setName(""); setAmount(""); }}>Cancel edit</button>}
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
  const transactions = useLiveQuery(
    () => db.transactions.where({ profileId }).filter((transaction) => !transaction.deletedAt).toArray(),
    [profileId],
    []
  );
  const [message, setMessage] = useState("");
  const [conversation, setConversation] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [drafts, setDrafts] = useState<ReturnType<typeof parseMultipleTransactions>>([]);
  const [setupDraft, setSetupDraft] = useState<
    | { kind: "account"; name: string; type: AccountType; amount: number }
    | { kind: "budget"; category: Category; amount: number }
    | null
  >(null);
  const [clarification, setClarification] = useState<
    | { kind: "account"; original: string; missingName: boolean; missingAmount: boolean }
    | { kind: "budget"; original: string }
    | null
  >(null);
  const [rememberCategories, setRememberCategories] = useState(false);
  const [learnedCategories, setLearnedCategories] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(`kupit-assistant-learning-${profileId}`) || "{}");
    } catch {
      return {};
    }
  });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = messagesRef.current;
    if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
  }, [conversation, drafts, setupDraft]);
  useEffect(() => {
    const node = messagesRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const scrollBottom = () => node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
    const observer = new ResizeObserver(scrollBottom);
    observer.observe(node);
    const mutations = new MutationObserver(scrollBottom);
    mutations.observe(node, { childList: true, subtree: true, characterData: true });
    return () => { observer.disconnect(); mutations.disconnect(); };
  }, [open]);

  useEffect(() => {
    try {
      setLearnedCategories(JSON.parse(localStorage.getItem(`kupit-assistant-learning-${profileId}`) || "{}"));
    } catch {
      setLearnedCategories({});
    }
  }, [profileId]);

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => textareaRef.current?.focus(), 120);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  const parseMessage = () => {
    const userText = message.trim();
    let text = userText;
    if (!text) return;
    if (clarification?.kind === "budget") {
      text = `${clarification.original} ${text}`;
      setClarification(null);
    } else if (clarification?.kind === "account") {
      const followUp = text;
      const answerAmount = followUp.match(/(?:₱|php|\$)?\s*(\d[\d,]*(?:\.\d{1,2})?\s*[km]?)/i)?.[1];
      if (clarification.missingName && clarification.missingAmount) {
        const name = answerAmount ? followUp.replace(answerAmount, "").replace(/\b(?:php|pesos?|balance|opening|is|and|with)\b/gi, "").replace(/[₱$,]/g, "").trim() : followUp.trim();
        text = `${clarification.original} account named ${name} with opening balance ${answerAmount || ""}`;
      } else if (clarification.missingName) {
        text = `${clarification.original} account named ${followUp}`;
      } else {
        text = `${clarification.original} with opening balance ${followUp}`;
      }
      setClarification(null);
    }
    if (setupDraft && /^(yes|y|yes save|confirm|save it|looks good|correct)[.! ]*$/i.test(text)) {
      setConversation((current) => [...current, { role: "user", text }]);
      setMessage("");
      void saveSetupDraft();
      return;
    }
    if (setupDraft && /^(no|n|change|edit|not quite)[.! ]*$/i.test(text)) {
      setConversation((current) => [...current, { role: "user", text }, { role: "assistant", text: "No problem. Tell me the corrected category, account name, or amount, and I’ll prepare it again." }]);
      setSetupDraft(null);
      setMessage("");
      return;
    }
    const amountText = text.match(/(?:₱|php|\$)?\s*(\d[\d,]*(?:\.\d{1,2})?\s*[km]?)/i)?.[1];
    const parsedAmount = amountText ? parseMoney(amountText) : null;
    const accountIntent = /\b(create|add|set up|make)\b.*\b(account|wallet|bank)\b/i.test(text);
    const budgetIntent = /\b(create|add|set|make|keep|cap)\b.*\b(budget|spending limit|spending|spend)\b/i.test(text) || /\b(monthly|weekly|daily)\s+budget\b/i.test(text);
    if (accountIntent) {
      const name = text.match(/\b(?:account|wallet|bank)\s+(?:named|called)\s+["']?(.+?)["']?(?=\s+(?:with|and)\s+(?:an?\s+)?(?:opening\s+)?balance|[,;.]|$)/i)?.[1]?.trim();
      if (name && parsedAmount !== null) {
        const type: AccountType = /\bcash\b/i.test(text) ? "cash"
          : /\b(wallet|e-?wallet|gcash|maya|paymaya)\b/i.test(text) ? "ewallet"
          : /\bcredit\s*card\b/i.test(text) ? "credit_card"
          : /\binvestment\b/i.test(text) ? "investment"
          : /\bloan\b/i.test(text) ? "loan" : "bank";
        setDrafts([]);
        setSetupDraft({ kind: "account", name, type, amount: parsedAmount });
        setConversation((current) => [...current, { role: "user", text: userText }, { role: "assistant", text: `I have ${name} as a ${type === "bank" ? "bank" : type.replace("_", " ")} account with ${formatMoney(parsedAmount)} to start. Is that right?` }]);
      } else {
        const missingName = !/\b(?:account|wallet|bank)\s+(?:named|called)\b/i.test(text);
        const missingAmount = parsedAmount === null;
        const followUp = missingName && missingAmount
          ? "Sure. What should I call the account, and what’s its opening balance? For example: Payroll, 42.33."
          : missingName
          ? "What should I call the account? For example: Payroll."
          : "What’s the opening balance? You can enter a plain number, like 42.33.";
        setClarification({ kind: "account", original: text, missingName, missingAmount });
        setConversation((current) => [...current, { role: "user", text: userText }, { role: "assistant", text: followUp }]);
      }
      setMessage("");
      return;
    }
    if (budgetIntent) {
      const normalizedText = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const expenseCategories = categories.filter((item) => item.type === "expense");
      const aliases: Record<string, string[]> = {
        "Food & Dining": ["food", "dining", "meal", "meals", "restaurant"],
        "Transportation": ["transport", "transportation", "commute", "commuting", "travel"],
        "Bills & Utilities": ["bills", "utilities", "utility"],
        "Housing & Rent": ["housing", "rent"],
        "Health & Wellness": ["health", "wellness", "medical"],
        "Entertainment & Leisure": ["entertainment", "leisure"],
        "Personal Care & Beauty": ["personal care", "beauty"],
      };
      const category = expenseCategories
        .sort((a, b) => b.name.length - a.name.length)
        .find((item) => {
          const categoryName = item.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
          return normalizedText.includes(categoryName) || (aliases[item.name] || []).some((alias) => new RegExp(`\\b${alias}\\b`, "i").test(normalizedText));
        });
      if (category && parsedAmount !== null) {
        setDrafts([]);
        setSetupDraft({ kind: "budget", category, amount: parsedAmount });
        const matchedAlias = (aliases[category.name] || []).find((alias) => new RegExp(`\\b${alias}\\b`, "i").test(normalizedText));
        const categoryPhrase = matchedAlias ? `I matched “${matchedAlias}” to ${category.name}.` : `I matched ${category.name}.`;
        setConversation((current) => [...current, { role: "user", text: userText }, { role: "assistant", text: `${categoryPhrase} Is ${formatMoney(parsedAmount)} your monthly limit?` }]);
      } else {
        const hasAmount = parsedAmount !== null;
        const hasCategory = expenseCategories.some((item) => normalizedText.includes(item.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()) || (aliases[item.name] || []).some((alias) => new RegExp(`\\b${alias}\\b`, "i").test(normalizedText)));
        const followUp = !hasCategory && !hasAmount
          ? "Which category should I use, and what monthly limit do you want? For example: Food, 360."
          : !hasCategory
          ? "Which spending category should I use? For example: food, transportation, or bills."
          : "What monthly limit should I set? A plain number is fine, like 360.";
        setClarification({ kind: "budget", original: text });
        setConversation((current) => [...current, { role: "user", text: userText }, { role: "assistant", text: followUp }]);
      }
      setMessage("");
      return;
    }
    const localAnswer = answerLocalMoneyQuestion(text, { accounts, transactions, categories });
    if (localAnswer) {
      setDrafts([]);
      setConversation((current) => [...current, { role: "user", text }, { role: "assistant", text: localAnswer }]);
      setMessage("");
      return;
    }
    const parsed = parseMultipleTransactions(text, accounts.map((account) => account.name), new Date(), learnedCategories);
    if (!parsed.length && /\?|^(what|how|can|could|did|do|does|am|is|are|show|tell|where|which)\b/i.test(text)) {
      setConversation((current) => [...current, { role: "user", text }, { role: "assistant", text: explainLocalCapabilities() }]);
      setMessage("");
      return;
    }
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
    setRememberCategories(false);
    setMessage("");
  };

  const saveSetupDraft = async () => {
    if (!setupDraft) return;
    if (setupDraft.kind === "account") {
      const duplicate = accounts.some((account) => account.name.toLowerCase() === setupDraft.name.toLowerCase());
      if (duplicate) {
        setConversation((current) => [...current, { role: "assistant", text: `An account named ${setupDraft.name} already exists in this profile.` }]);
        setSetupDraft(null);
        return;
      }
      await createAccount({
        profileId, name: setupDraft.name, type: setupDraft.type,
        openingBalance: setupDraft.amount, currency: "PHP",
        color: setupDraft.type === "cash" ? "#22C55E" : "#019B51",
        icon: setupDraft.type === "cash" ? "banknote" : setupDraft.type === "ewallet" ? "wallet" : "landmark",
        isArchived: false,
      });
      setConversation((current) => [...current, { role: "assistant", text: `Saved ${setupDraft.name} with an opening balance of ${formatMoney(setupDraft.amount)}.` }]);
    } else {
      const existing = await db.budgets.where("profileId").equals(profileId).filter((budget) => !budget.deletedAt && budget.categoryId === setupDraft.category.id && budget.period === "monthly").first();
      const timestamp = new Date().toISOString();
      await db.budgets.put({
        id: existing?.id || crypto.randomUUID(), profileId,
        categoryId: setupDraft.category.id, period: "monthly", amount: setupDraft.amount,
        rolloverEnabled: existing?.rolloverEnabled ?? false,
        createdAt: existing?.createdAt || timestamp, updatedAt: timestamp,
      });
      setConversation((current) => [...current, { role: "assistant", text: `Saved a monthly ${setupDraft.category.name} budget of ${formatMoney(setupDraft.amount)}.` }]);
    }
    setSetupDraft(null);
  };

  const updateDraft = (index: number, changes: Partial<(typeof drafts)[number]>) => {
    setDrafts((current) => current.map((draft, draftIndex) => draftIndex === index ? { ...draft, ...changes } : draft));
  };

  const saveDrafts = async () => {
    const learned = { ...learnedCategories };
    for (const draft of drafts) {
      if (!draft.amount) continue;
      const account =
        accounts.find((item) => item.name.toLowerCase() === draft.accountHint?.toLowerCase()) ||
        accounts[0];
      if (!account) continue;
      const toAccount = draft.toAccountHint
        ? accounts.find((item) => item.name.toLowerCase() === draft.toAccountHint?.toLowerCase())
        : accounts.find((item) => item.id !== account.id);
      if (draft.type === "transfer" && (!toAccount || toAccount.id === account.id)) continue;
      const category =
        categories.find((item) => item.name === draft.categoryHint && item.type === draft.type) ||
        categories.find((item) => item.type === draft.type && !item.parentId);
      if (rememberCategories && draft.note.trim() && draft.categoryHint && draft.type !== "transfer") {
        learned[normalizeLearningKey(draft.note)] = draft.categoryHint;
      }
      await createTransaction({
        profileId,
        type: draft.type,
        amount: draft.amount,
        accountId: account.id,
        toAccountId:
          draft.type === "transfer"
            ? toAccount?.id || null
            : null,
        categoryId: draft.type === "transfer" ? null : category?.id || null,
        date: draft.date,
        note: draft.note || null,
      });
    }
    if (rememberCategories) {
      localStorage.setItem(`kupit-assistant-learning-${profileId}`, JSON.stringify(learned));
      setLearnedCategories(learned);
    }
    setDrafts([]);
    setMessage("");
    setRememberCategories(false);
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
            <small>Offline money assistant · data stays on this device</small>
          </div>
          <button className="chat-form-shortcut" onClick={onOpenForm} aria-label="Open transaction form" title="Use transaction form">
            <Plus size={19} />
          </button>
        </header>
        <div className="chat-messages" ref={messagesRef}>
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
                <p className="chat-local-note">Or ask about your saved money:</p>
                <div className="chat-examples">
                  <button onClick={() => { setMessage("How much did I spend this month?"); textareaRef.current?.focus(); }}>Spending this month</button>
                  <button onClick={() => { setMessage("What was my top expense category this month?"); textareaRef.current?.focus(); }}>Top category</button>
                  <button onClick={() => { setMessage("What is my net worth?"); textareaRef.current?.focus(); }}>Net worth</button>
                </div>
                <p className="chat-local-note">Correct a category and opt in to remember it for that merchant.</p>
              </div>
            </div>
          )}
          {conversation.map((entry, index) => (
            <div key={`${entry.role}-${index}`} className={`chat-message ${entry.role}`}>
              {entry.text}
            </div>
          ))}
          {Object.keys(learnedCategories).length > 0 && (
            <button className="chat-clear-learning" onClick={() => {
              localStorage.removeItem(`kupit-assistant-learning-${profileId}`);
              setLearnedCategories({});
            }}>Forget {Object.keys(learnedCategories).length} learned merchant categories</button>
          )}
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
                <div className="chat-draft-fields">
                  <label className="chat-draft-note">Description
                    <input value={draft.note} onChange={(event) => updateDraft(index, { note: event.target.value })} placeholder="Merchant or note" />
                  </label>
                  <label>Type
                    <select value={draft.type} onChange={(event) => updateDraft(index, { type: event.target.value as TransactionType, categoryHint: null })}>
                      <option value="expense">Expense</option><option value="income">Income</option><option value="transfer">Transfer</option>
                    </select>
                  </label>
                  <label>Account
                    <select value={draft.accountHint || accounts[0]?.name || ""} onChange={(event) => updateDraft(index, { accountHint: event.target.value || null, toAccountHint: event.target.value === draft.toAccountHint ? null : draft.toAccountHint })}>
                      {accounts.map((account) => <option key={account.id} value={account.name}>{account.name}</option>)}
                    </select>
                  </label>
                  {draft.type === "transfer" ? (
                    <label>To account
                      <select value={draft.toAccountHint || accounts.find((account) => account.name !== draft.accountHint)?.name || ""} onChange={(event) => updateDraft(index, { toAccountHint: event.target.value || null })}>
                        {accounts.filter((account) => account.name !== (draft.accountHint || accounts[0]?.name)).map((account) => <option key={account.id} value={account.name}>{account.name}</option>)}
                      </select>
                    </label>
                  ) : (
                    <label>Category
                      <select value={draft.categoryHint || ""} onChange={(event) => updateDraft(index, { categoryHint: event.target.value || null })}>
                        <option value="">Choose category</option>
                        {categories.filter((category) => category.type === draft.type).map((category) => <option key={category.id} value={category.name}>{category.name}</option>)}
                      </select>
                    </label>
                  )}
                  <label className="chat-draft-date">Date
                    <input type="date" value={draft.date} onChange={(event) => updateDraft(index, { date: event.target.value })} />
                  </label>
                </div>
              </article>
            ))}
            <label className="chat-learn-choice">
              <input type="checkbox" checked={rememberCategories} onChange={(event) => setRememberCategories(event.target.checked)} />
              <span>Remember these merchant categories on this device</span>
            </label>
            <button className="save-button" onClick={saveDrafts}>
              Confirm and save
            </button>
          </div>
          )}
          {setupDraft && (
            <div className="chat-drafts">
              <article>
                <span><small>{setupDraft.kind === "account" ? `${setupDraft.type} account` : "monthly budget"}</small>
                  <b>{setupDraft.kind === "account" ? setupDraft.name : setupDraft.category.name}</b></span>
                <strong>{formatMoney(setupDraft.amount)}</strong>
                {setupDraft.kind === "account" && <small>Opening balance · saved to this profile on this device</small>}
              </article>
              <button className="save-button" onClick={saveSetupDraft}>Yes, save</button>
              <button className="chat-clear-learning" onClick={() => {
                setSetupDraft(null);
                setConversation((current) => [...current, { role: "assistant", text: "No problem. Send the corrected details and I’ll prepare a new draft." }]);
              }}>Change details</button>
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
            placeholder="Log, create an account or budget, or ask about your money"
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
  authCallbackNotice,
}: {
  open: boolean;
  onClose: () => void;
  themePreference: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onOpenCategories: () => void;
  onOpenPlan: () => void;
  authCallbackNotice: string;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [authChecking, setAuthChecking] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [cloudBusy, setCloudBusy] = useState(false);
  const [cloudMessage, setCloudMessage] = useState("");
  const [cloudError, setCloudError] = useState("");
  const [backupMessage, setBackupMessage] = useState("");
  const [backupError, setBackupError] = useState("");
  const configuredAuthRedirect = import.meta.env.VITE_AUTH_REDIRECT_URL?.trim();
  const configuredRedirectUrl = configuredAuthRedirect ? new URL(configuredAuthRedirect, window.location.origin) : null;
  const isCurrentHostLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  const isConfiguredHostLocal = configuredRedirectUrl ? ["localhost", "127.0.0.1"].includes(configuredRedirectUrl.hostname) : false;
  const authRedirectUrl = configuredRedirectUrl && (isCurrentHostLocal || !isConfiguredHostLocal)
    ? configuredRedirectUrl.toString().replace(/\/$/, "")
    : window.location.origin;

  const categories = useLiveQuery(() => db.categories.filter((c) => !c.deletedAt).toArray(), [], []);

  useEffect(() => {
    if (authCallbackNotice) setCloudMessage(authCallbackNotice);
  }, [authCallbackNotice]);

  useEffect(() => {
    if (!supabase || !open) return;
    let active = true;
    setAuthChecking(true);
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return;
      if (error) setCloudError(error.message);
      setSession(data.session);
      setAuthChecking(false);
    }).catch((error) => {
      if (!active) return;
      setCloudError(error instanceof Error ? error.message : "Could not check sign-in status.");
      setAuthChecking(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        setAuthChecking(false);
        setCloudError("");
      }
    );
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [open]);

  useEffect(() => {
    if (!session) {
      setLastSyncedAt(null);
      return;
    }
    let active = true;
    db.settings.get(`cloud-last-sync:${session.user.id}`).then((setting) => {
      if (!active || !setting) return;
      try { setLastSyncedAt(JSON.parse(setting.value).iso || null); } catch { setLastSyncedAt(null); }
    });
    return () => { active = false; };
  }, [session?.user.id]);

  const sendMagicLink = async () => {
    if (!supabase) return;
    setCloudBusy(true);
    setCloudError("");
    setCloudMessage("");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: authRedirectUrl },
      });
      if (error) setCloudError(error.message);
      else setCloudMessage(`Sign-in link sent to ${email.trim()}. Check your inbox.`);
    } catch (error) {
      setCloudError(error instanceof Error ? error.message : "Could not send the sign-in link.");
    } finally {
      setCloudBusy(false);
    }
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
      const lastSyncSetting = await db.settings.get(`cloud-last-sync:${session.user.id}`);
      if (lastSyncSetting) {
        try { setLastSyncedAt(JSON.parse(lastSyncSetting.value).iso || new Date().toISOString()); }
        catch { setLastSyncedAt(new Date().toISOString()); }
      }
      setCloudMessage("Your budget is up to date.");
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
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("kupit-assistant-learning-")) localStorage.removeItem(key);
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
          <p className="settings-brand-tagline">Budgeting made simple</p>
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

              <button className="ios-row-btn appearance-row" onClick={() => setAppearanceOpen(true)}>
                <div className="ios-row-left">
                  <span className="ios-squircle squircle-blue">
                    {themePreference === "dark" || themePreference === "amoled" ? <Moon size={18} /> : <Sun size={18} />}
                  </span>
                  <div className="ios-row-text">
                    <span className="ios-row-label">Appearance</span>
                    <small className="ios-row-sub">Choose how Kupit looks</small>
                  </div>
                </div>
                <span className="appearance-value" aria-hidden="true">
                  <span className="appearance-current-value">{themePreference === "amoled" ? "AMOLED" : themePreference[0].toUpperCase() + themePreference.slice(1)}</span>
                  <ChevronRight size={16} className="ios-chevron" />
                </span>
              </button>
            </div>
          </div>

          {/* Group 2: Cloud Sync */}
          <div className="ios-grouped-section">
            <div className="ios-group-title">Cloud & Sync</div>
            <div className="ios-group-card cloud-ios-card">
              <div className="cloud-panel-title">
                <div>
                  <b>Cloud Sync</b>
                    <small>Sync your budget across devices</small>
                </div>
                <span
                  className={`cloud-status ${authChecking ? "checking" : !cloudSyncAvailable ? "setup-needed" : session ? "connected" : "sign-in-needed"}`}
                >
                  {authChecking ? "Checking" : !cloudSyncAvailable ? "Unavailable" : session ? (cloudBusy ? "Syncing" : "Connected") : "Sign in"}
                </span>
              </div>
              {!cloudSyncAvailable ? (
                <p className="cloud-help">
                  Cloud sync is unavailable right now. Please try again later.
                </p>
              ) : authChecking ? (
                <div className="cloud-auth-checking"><span className="cloud-auth-spinner" /> Checking your secure account session...</div>
              ) : session ? (
                <div className="cloud-actions">
                  <div className="cloud-account-card">
                    <span className="cloud-account-icon"><ShieldCheck size={19} /></span>
                    <span className="cloud-account-copy"><b>Signed in</b><small>{session.user.email}</small></span>
                    <CheckCircle2 size={19} className="cloud-account-check" />
                  </div>
                  <div className="cloud-sync-history">
                    <span><Clock3 size={15} /> Last synced</span>
                    <b>{lastSyncedAt ? new Date(lastSyncedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "Not synced yet"}</b>
                  </div>
                  <button className="cloud-sync-button" onClick={syncCloud} disabled={cloudBusy}>
                    <RefreshCw size={16} className={cloudBusy ? "sync-icon-active" : ""} />
                    {cloudBusy ? "Syncing…" : "Sync now"}
                  </button>
                  <button className="cloud-signout-button" onClick={signOut} disabled={cloudBusy}>Sign out</button>
                </div>
              ) : (
                <div className="cloud-actions">
                  <p className="cloud-help">
                    We’ll email you a link to sign in and sync your budget.
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
                    className="cloud-sync-button"
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
                    setBackupMessage("");
                    setBackupError("");
                    if (file) {
                      try {
                        await importJsonBackup(file);
                        setBackupMessage(session
                          ? `Backup imported. Sync now to upload it to your account.`
                          : `Backup imported. Sign in and sync to upload it to your account.`);
                      } catch (error) {
                        setBackupError(error instanceof Error ? error.message : "Could not import this backup.");
                      } finally {
                        event.target.value = "";
                      }
                    }
                  }}
                />
              </label>
              {backupMessage && <p className="backup-import-message" role="status">{backupMessage}</p>}
              {backupError && <p className="cloud-error" role="alert">{backupError}</p>}
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
        {appearanceOpen && (
          <div className="sheet-backdrop appearance-picker-backdrop" role="dialog" aria-modal="true" aria-label="Choose appearance" onClick={() => setAppearanceOpen(false)}>
            <section className="appearance-picker-sheet" onClick={(event) => event.stopPropagation()}>
              <div className="sheet-grabber" />
              <header className="sheet-header">
                <button type="button" className="sheet-close-btn" onClick={() => setAppearanceOpen(false)} aria-label="Close appearance picker"><X size={18} /></button>
                <b>Choose appearance</b>
                <span />
              </header>
              <div className="appearance-options">
                {([
                  { mode: "system", label: "System", hint: "Match your device setting", icon: Sun },
                  { mode: "light", label: "Light", hint: "Bright and clear", icon: Sun },
                  { mode: "dark", label: "Dark", hint: "Soft contrast for low light", icon: Moon },
                  { mode: "amoled", label: "AMOLED", hint: "Deep black backgrounds", icon: Moon },
                ] as { mode: ThemePreference; label: string; hint: string; icon: typeof Sun }[]).map(({ mode, label, hint, icon: Icon }) => (
                  <button key={mode} className={`appearance-option ${themePreference === mode ? "selected" : ""}`} onClick={() => { onThemeChange(mode); setAppearanceOpen(false); }}>
                    <span className="appearance-option-icon"><Icon size={18} /></span>
                    <span className="appearance-option-copy"><b>{label}</b><small>{hint}</small></span>
                    {themePreference === mode && <CheckCircle2 size={19} className="appearance-option-check" />}
                  </button>
                ))}
              </div>
            </section>
          </div>
        )}
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
  receiptFlow,
  editTransactionId,
}: {
  open: boolean;
  onClose: () => void;
  profileId: string;
  initialType: TransactionType;
  onOpenCategoryManager: (categoryType: CategoryType, onSelect: (categoryId: string) => void) => void;
  receiptFlow: boolean;
  editTransactionId?: string;
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
  const profile = useLiveQuery(() => db.profiles.get(profileId), [profileId], undefined);
  const categories = useLiveQuery(
    () => db.categories.where({ profileId }).filter((c) => !c.deletedAt).toArray(),
    [profileId],
    []
  );
  const ledgerTransactions = useLiveQuery(
    () => db.transactions.where({ profileId }).filter((transaction) => !transaction.deletedAt).toArray(),
    [profileId],
    []
  );

  const [type, setType] = useState<TransactionType>("expense");
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [sourceType, setSourceType] = useState<"my" | "external">("my");
  const [destinationType, setDestinationType] = useState<"my" | "external">("my");
  const [externalFromName, setExternalFromName] = useState("");
  const [externalToName, setExternalToName] = useState("");
  const [transferFee, setTransferFee] = useState("");
  const [transferTime, setTransferTime] = useState(() => new Date().toTimeString().slice(0, 5));
  const [categoryId, setCategoryId] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(toDateString(new Date()));
  const [repeatEnabled, setRepeatEnabled] = useState(false);
  const [repeatFrequency, setRepeatFrequency] = useState<RecurringFrequency>("monthly");
  const [repeatStartDate, setRepeatStartDate] = useState(toDateString(new Date()));
  const [repeatEndMode, setRepeatEndMode] = useState<"never" | "date" | "after">("never");
  const [repeatEndDate, setRepeatEndDate] = useState("");
  const [repeatCount, setRepeatCount] = useState("12");
  const [receipt, setReceipt] = useState<File | null>(null);
  const [receiptStep, setReceiptStep] = useState<"choose" | "details">("details");
  const [receiptScanning, setReceiptScanning] = useState(false);
  const [receiptMessage, setReceiptMessage] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const receiptFileRef = useRef<HTMLInputElement>(null);
  const cameraVideoRef = useRef<HTMLVideoElement>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const sheetBackdropRef = useRef<HTMLDivElement>(null);
  const [undoId, setUndoId] = useState<string | null>(null);
  const [storedAmount, setStoredAmount] = useState<number | null>(null);
  const [pendingOperator, setPendingOperator] = useState<CalculatorOperator | null>(null);
  const [awaitingOperand, setAwaitingOperand] = useState(false);
  const [expression, setExpression] = useState("");
  const [calculatorError, setCalculatorError] = useState("");
  const [amountKeyboardVisible, setAmountKeyboardVisible] = useState(true);

  useEffect(() => {
    if (!open) return;
    setType(initialType);
    setReceiptStep(receiptFlow ? "choose" : "details");
    setRepeatEnabled(false);
    setRepeatStartDate(toDateString(new Date()));
    setRepeatEndMode("never");
    setRepeatEndDate("");
    setRepeatCount("12");
    if (!editTransactionId) {
      setAmount("");
      setDate(toDateString(new Date()));
      setNote("");
      setCategoryId("");
      setAccountId("");
      setToAccountId("");
      setUndoId(null);
    }
    setSourceType("my");
    setDestinationType("my");
    setExternalFromName("");
    setExternalToName("");
    setTransferFee("");
    setTransferTime(new Date().toTimeString().slice(0, 5));
    if (receiptFlow) {
      setReceipt(null);
      setReceiptMessage("");
      setReceiptScanning(false);
      setAmount("");
      setNote("");
      setDate(toDateString(new Date()));
    }
  }, [open, initialType, receiptFlow, editTransactionId]);

  useEffect(() => {
    if (!open || !editTransactionId) return;
    void db.transactions.get(editTransactionId).then((transaction) => {
      if (!transaction || transaction.type !== "transfer") return;
      setType("transfer");
      setAmount((transaction.amount / 100).toFixed(2));
      setAccountId(transaction.accountId);
      setToAccountId(transaction.toAccountId || "");
      setSourceType(transaction.sourceType || "my");
      setDestinationType(transaction.destinationType || "my");
      setExternalFromName(transaction.externalFromName || "");
      setExternalToName(transaction.externalToName || "");
      setTransferFee(((transaction.transferFee || 0) / 100).toFixed(2));
      setTransferTime(transaction.transferTime || "12:00");
      setDate(transaction.date);
      setNote(transaction.note || "");
    });
  }, [open, editTransactionId]);

  useEffect(() => {
    if (!open || receiptStep !== "details") return;
    const focusFrame = window.requestAnimationFrame(() => {
      setAmountKeyboardVisible(true);
      amountInputRef.current?.focus({ preventScroll: true });
    });
    const viewport = window.visualViewport;
    const updateViewport = () => {
      const backdrop = sheetBackdropRef.current;
      if (!backdrop) return;
      backdrop.style.setProperty("--sheet-visible-height", `${viewport?.height || window.innerHeight}px`);
      backdrop.style.setProperty("--sheet-visible-top", `${viewport?.offsetTop || 0}px`);
    };
    updateViewport();
    viewport?.addEventListener("resize", updateViewport);
    viewport?.addEventListener("scroll", updateViewport);
    window.addEventListener("resize", updateViewport);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      viewport?.removeEventListener("resize", updateViewport);
      viewport?.removeEventListener("scroll", updateViewport);
      window.removeEventListener("resize", updateViewport);
    };
  }, [open, receiptStep]);

  useEffect(() => {
    if (!accountId && accounts.length) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  useEffect(() => {
    const expectedType = type === "income" ? "income" : "expense";
    if (!categoryId || !categories.some((category) => category.id === categoryId && category.type === expectedType)) {
      const first = categories.find(
        (c) => c.type === expectedType && !c.parentId
      );
      setCategoryId(first?.id || "");
    }
  }, [categories, type, categoryId]);

  useEffect(() => {
    const video = cameraVideoRef.current;
    if (!cameraStream || !video) return;
    video.srcObject = cameraStream;
    void video.play().catch(() => {});
    return () => cameraStream.getTracks().forEach((track) => track.stop());
  }, [cameraStream, cameraOpen]);

  const scanReceipt = async (file: File) => {
    setReceipt(file);
    setReceiptMessage("Preparing receipt scanner...");
    setReceiptScanning(true);
    try {
      const { data } = await recognize(file, "eng", {
        logger: (progress) => {
          if (progress.status === "recognizing text" && typeof progress.progress === "number") {
            setReceiptMessage(`Reading receipt... ${Math.round(progress.progress * 100)}%`);
          } else if (progress.status) {
            setReceiptMessage("Preparing receipt scanner...");
          }
        },
      });
      const lines = data.text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const amountsByLine = lines.flatMap((line) => {
        const hasTotalLabel = /\b(grand\s+total|total\s+due|amount\s+due|total|balance\s+due)\b/i.test(line);
        const matches = [...line.matchAll(/(?:PHP|\bP\b)\s*([\d,]+(?:\.\d{1,2})?)|([\d,]+\.\d{2})/gi)];
        const captures = matches.map((match) => match[1] || match[2]);
        if (hasTotalLabel && !captures.length) {
          const plainTotal = line.match(/(?:grand\s+total|total\s+due|amount\s+due|total|balance\s+due)\D*([\d,]+(?:\.\d{1,2})?)/i)?.[1];
          if (plainTotal) captures.push(plainTotal);
        }
        return captures.map(parseMoney).filter((value) => value > 0).map((amount) => ({ amount, hasTotalLabel }));
      });
      const totalCandidates = amountsByLine.filter((candidate) => candidate.hasTotalLabel);
      const selectedAmount = totalCandidates.at(-1)?.amount ?? Math.max(0, ...amountsByLine.map((candidate) => candidate.amount));
      if (selectedAmount) setAmount((selectedAmount / 100).toFixed(2));
      const dateMatch = data.text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/) || data.text.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/);
      if (dateMatch) setDate(dateMatch[1].length === 4
        ? `${dateMatch[1]}-${dateMatch[2].padStart(2,"0")}-${dateMatch[3].padStart(2,"0")}`
        : `${dateMatch[3]}-${dateMatch[1].padStart(2,"0")}-${dateMatch[2].padStart(2,"0")}`);
      const merchant = lines.find((line) => /[a-z]{3}/i.test(line) && !/receipt|invoice|cashier|terminal|thank you/i.test(line));
      if (merchant) setNote(merchant.slice(0, 80));
      const matchedCategory = categories.find((category) => category.type === "expense" && lines.some((line) => line.toLowerCase().includes(category.name.toLowerCase())));
      if (matchedCategory) setCategoryId(matchedCategory.id);
      setType("expense");
      setReceiptStep("details");
      setReceiptMessage(selectedAmount
        ? "Receipt scanned. Review the merchant, amount, date, and category before saving."
        : "Receipt text was read, but no total was found. Enter the amount and review the other details.");
    } catch (error) {
      setReceiptMessage(error instanceof Error ? `Could not scan receipt: ${error.message}` : "Could not scan receipt. Enter details manually.");
    } finally {
      setReceiptScanning(false);
    }
  };

  const requestCameraAccess = async () => {
    setReceiptMessage("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setReceiptMessage("Camera access requires a supported browser and a secure HTTPS connection. You can upload a photo instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      setCameraStream(stream);
      setCameraOpen(true);
    } catch (error) {
      const cameraError = error as DOMException;
      setReceiptMessage(cameraError.name === "NotAllowedError"
        ? "Camera permission was denied. Allow camera access in your browser settings or upload a photo instead."
        : cameraError.name === "NotFoundError"
        ? "No camera was found. You can upload a photo instead."
        : `Could not open the camera: ${cameraError.message || "please check browser permissions"}.`);
    }
  };

  const closeCamera = () => {
    cameraStream?.getTracks().forEach((track) => track.stop());
    setCameraStream(null);
    setCameraOpen(false);
  };

  const captureCameraPhoto = () => {
    const video = cameraVideoRef.current;
    if (!video?.videoWidth || !video.videoHeight) {
      setReceiptMessage("The camera is still starting. Please try again in a moment.");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setReceiptMessage("Could not capture the photo. Please upload an image instead.");
      closeCamera();
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (blob) void scanReceipt(new File([blob], `receipt-${Date.now()}.jpg`, { type: "image/jpeg" }));
      else setReceiptMessage("Could not capture the photo. Please try again.");
      closeCamera();
    }, "image/jpeg", 0.92);
  };

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
    let transactionId: string | null = null;
    if (type === "transfer") {
      if ((sourceType === "external" && destinationType === "external") ||
        (sourceType === "my" && destinationType === "my" && (!toAccountId || toAccountId === accountId)) ||
        (sourceType === "external" && !externalFromName.trim()) ||
        (destinationType === "external" && !externalToName.trim())) return;
      const feeCents = sourceType === "my" ? parseMoney(transferFee || "0") : 0;
      let feeCategoryId: string | undefined;
      if (feeCents > 0) {
        feeCategoryId = categories.find((category) => category.type === "expense" && category.name.trim().toLocaleLowerCase() === "fees")?.id;
        if (!feeCategoryId) {
          const timestamp = new Date().toISOString();
          feeCategoryId = crypto.randomUUID();
          await db.categories.add({
            id: feeCategoryId,
            profileId,
            name: "Fees",
            type: "expense",
            icon: "credit-card",
            color: "#64748B",
            sortOrder: categories.length,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        }
      }
      const transferData = {
        profileId,
        amount: cents,
        accountId,
        toAccountId: sourceType === "my" && destinationType === "my" ? toAccountId : null,
        sourceType,
        destinationType,
        externalFromName: sourceType === "external" ? externalFromName : null,
        externalToName: destinationType === "external" ? externalToName : null,
        transferFee: feeCents,
        feeCategoryId,
        date,
        time: transferTime,
        note: note.trim() || null,
      };
      if (editTransactionId) {
        await updateTransfer(editTransactionId, transferData);
        onClose();
        return;
      }
      transactionId = await createTransfer(transferData);
      sheetBackdropRef.current?.querySelector(".add-sheet")?.removeAttribute("data-sheet-dirty");
      setAmount("");
      setTransferFee("");
      setNote("");
      setUndoId(transactionId);
      return;
    }
    if (type === "expense" && repeatEnabled) {
      if (!categoryId || !repeatStartDate || (repeatEndMode === "date" && !repeatEndDate) || (repeatEndMode === "after" && (!Number(repeatCount) || Number(repeatCount) < 1))) return;
      const ruleId = await createRecurringRule({
        profileId,
        amount: cents,
        categoryId,
        accountId,
        note: note.trim() || null,
        transactionType: "expense",
        frequency: repeatFrequency,
        startDate: repeatStartDate,
        endDate: repeatEndMode === "date" ? repeatEndDate : null,
        endsAfter: repeatEndMode === "after" ? Number(repeatCount) : null,
        occurrencesCreated: 0,
        isPaused: false,
        nextDueDate: repeatStartDate,
        remindDaysBefore: null,
        kind: "bill",
      });
      await processDueRecurringTransactions(profileId, toDateString(new Date()));
      transactionId = await db.transactions
        .where("occurrenceKey")
        .startsWith(`${ruleId}:`)
        .first()
        .then((item) => item?.id || null);
    } else {
      transactionId = await createTransaction({
        profileId,
        type,
        amount: cents,
        accountId,
        toAccountId: null,
        categoryId: categoryId || null,
        date,
        note: note.trim() || null,
      });
    }
    if (receipt && transactionId) {
      await db.attachments.add({
        id: crypto.randomUUID(),
        transactionId,
        blob: receipt,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    setUndoId(transactionId);
    sheetBackdropRef.current?.querySelector(".add-sheet")?.removeAttribute("data-sheet-dirty");
    setAmount("");
    setStoredAmount(null);
    setPendingOperator(null);
    setAwaitingOperand(false);
    setExpression("");
    setCalculatorError("");
    setNote("");
    setCategoryId("");
    setReceipt(null);
    setRepeatEnabled(false);
  };

  if (!open) return null;
  const sortedCategories = categories.filter(
    (c) => c.type === (type === "income" ? "income" : "expense") &&
      (type === "income" || !LEGACY_EXPENSE_CATEGORY_NAMES.has(c.name))
  ).sort((a, b) => {
    if (type === "income") return a.sortOrder - b.sortOrder;
    const aOrder = EXPENSE_CATEGORY_ORDER.get(a.name.trim().toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = EXPENSE_CATEGORY_ORDER.get(b.name.trim().toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    return aOrder - bOrder || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);
  });
  const uniqueCategories = new Map<string, Category>();
  for (const category of sortedCategories) {
    const key = `${category.type}:${category.name.trim().toLowerCase()}`;
    const current = uniqueCategories.get(key);
    if (!current || category.id === categoryId) uniqueCategories.set(key, category);
  }
  const filteredCategories = [...uniqueCategories.values()];
  const amountCurrencySymbol = new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: profile?.currency || "PHP",
  }).formatToParts(0).find((part) => part.type === "currency")?.value || "₱";
  const transferAmountCents = parseMoney(amount);
  const transferFeeCents = sourceType === "my" ? parseMoney(transferFee || "0") : 0;
  const totalTransferDeduction = transferAmountCents + transferFeeCents;
  const sourceAccount = accounts.find((account) => account.id === accountId);
  const sourceBalance = sourceAccount ? computeAccountBalance(sourceAccount.id, sourceAccount.openingBalance, ledgerTransactions) : 0;
  const sourceAvailable = sourceAccount?.type === "credit_card" ? (sourceAccount.creditLimit || 0) + sourceBalance : sourceBalance;
  const sourceCanGoNegative = sourceAccount?.type === "credit_card" || sourceAccount?.type === "loan";
  const balanceWarning = type === "transfer" && sourceType === "my" && Boolean(sourceAccount) && totalTransferDeduction > sourceAvailable;

  return (
    <div
      ref={sheetBackdropRef}
      className="sheet-backdrop transaction-sheet-backdrop"
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
          {receiptFlow ? <b>{receiptStep === "choose" ? "Scan receipt" : "Review receipt"}</b> : (
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
          )}
          <div className="sheet-header-spacer" />
        </header>

        <input
          ref={receiptFileRef}
          className="receipt-file-input"
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void scanReceipt(file);
            event.currentTarget.value = "";
          }}
        />

        {receiptFlow && receiptStep === "choose" ? (
          <div className="receipt-entry-panel">
            <div className="receipt-entry-mark"><ScanLine size={24} /></div>
            <h2>Add a receipt</h2>
            <p>Take a new photo or choose an existing image. We’ll fill in the transaction details for you to review.</p>
            <button type="button" className="receipt-primary-action" onClick={() => void requestCameraAccess()}>
              <Camera size={18} /> Scan receipt
            </button>
            <button type="button" className="receipt-secondary-action" onClick={() => receiptFileRef.current?.click()}>
              <Upload size={18} /> Select from photos
            </button>
            {receiptMessage && <small className="receipt-scan-message" role="status">{receiptMessage}</small>}
          </div>
        ) : receiptFlow && receiptScanning ? (
          <div className="receipt-entry-panel receipt-processing-panel" role="status">
            <div className="receipt-scan-loader" />
            <h2>Reading your receipt</h2>
            <p>{receiptMessage || "Preparing receipt scanner..."}</p>
          </div>
        ) : <>
        <div
          className="sheet-fields"
          onFocusCapture={(event) => {
            if (event.target !== amountInputRef.current) setAmountKeyboardVisible(false);
          }}
          onScroll={(event) => {
            if (event.currentTarget.scrollTop > 8) setAmountKeyboardVisible(false);
          }}
        >
          <label className="transaction-amount-field transaction-amount-top">
            <span>{type === "transfer" ? (sourceType === "external" ? "Amount to receive" : "Transfer amount") : "Amount"}</span>
            <span className="transaction-amount-input-wrap">
              <span aria-hidden="true">{amountCurrencySymbol}</span>
              <input
                ref={amountInputRef}
                autoFocus
                aria-label="Transaction amount"
                inputMode="none"
                type="text"
                value={amount}
                onFocus={() => setAmountKeyboardVisible(true)}
                onPointerDown={() => setAmountKeyboardVisible(true)}
                onChange={(event) => {
                  const normalized = event.target.value.replace(/,/g, ".").replace(/[^0-9.]/g, "");
                  const [whole, ...decimals] = normalized.split(".");
                  setAmount(decimals.length ? `${whole || "0"}.${decimals.join("").slice(0, 2)}` : whole);
                }}
                placeholder="0.00"
                autoComplete="off"
              />
            </span>
          </label>
          {type === "transfer" ? (
            <>
              <div className="transfer-type-field">
                <span className="transaction-section-label">Source type</span>
                <div className="transfer-segment" role="group" aria-label="Source type">
                  {(["my", "external"] as const).map((value) => <button type="button" key={value} className={sourceType === value ? "active" : ""} aria-pressed={sourceType === value} onClick={() => setSourceType(value)}>{value === "my" ? "My account" : "External"}</button>)}
                </div>
              </div>
              <div className="transfer-type-field">
                <span className="transaction-section-label">Destination type</span>
                <div className="transfer-segment" role="group" aria-label="Destination type">
                  {(["my", "external"] as const).map((value) => <button type="button" key={value} className={destinationType === value ? "active" : ""} aria-pressed={destinationType === value} onClick={() => setDestinationType(value)}>{value === "my" ? "My account" : "External"}</button>)}
                </div>
              </div>
              {sourceType === "my" ? (
                <label>From
                  <select value={accountId} onChange={(event) => setAccountId(event.target.value)}>
                    {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                </label>
              ) : (
                <label>From
                  <input value={externalFromName} maxLength={60} onChange={(event) => setExternalFromName(event.target.value)} placeholder="Name or source" />
                </label>
              )}
              {destinationType === "my" ? (
                <label>To
                  <select value={sourceType === "external" ? accountId : toAccountId} onChange={(event) => sourceType === "external" ? setAccountId(event.target.value) : setToAccountId(event.target.value)}>
                    <option value="">Select account</option>
                    {accounts.filter((account) => sourceType === "external" || account.id !== accountId).map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                  </select>
                </label>
              ) : (
                <label>To
                  <input value={externalToName} maxLength={60} onChange={(event) => setExternalToName(event.target.value)} placeholder="Name or destination" />
                </label>
              )}
              {sourceType === "external" && destinationType === "external" && <p className="transfer-inline-error" role="alert">Choose at least one of your accounts.</p>}
              {sourceType === "my" && (
                <label>Transfer fee (optional)
                  <input inputMode="decimal" value={transferFee} onChange={(event) => {
                    const normalized = event.target.value.replace(/,/g, ".").replace(/[^0-9.]/g, "");
                    const [whole, ...decimals] = normalized.split(".");
                    setTransferFee(decimals.length ? `${whole || "0"}.${decimals.join("").slice(0, 2)}` : whole);
                  }} placeholder="0.00" />
                </label>
              )}
              {balanceWarning && <p className={sourceCanGoNegative ? "transfer-balance-warning" : "transfer-inline-error"} role="status">This transfer is more than the available balance{sourceCanGoNegative ? ". You can continue." : ". Choose another account or lower the amount."}</p>}
            </>
          ) : (
            <>
              <div className="transaction-category-section">
                <span className="transaction-section-label">Category</span>
                <div className="transaction-category-grid" role="group" aria-label="Choose category">
                  {filteredCategories.map((category) => (
                    <button
                      key={category.id}
                      type="button"
                      className={`transaction-category-tile ${categoryId === category.id ? "selected" : ""}`}
                      aria-pressed={categoryId === category.id}
                      onClick={() => setCategoryId(category.id)}
                    >
                      <CategoryIcon icon={category.icon} color={category.color} size={20} />
                      <span>{category.name}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="transaction-category-tile add-category-tile"
                    onClick={() => onOpenCategoryManager(type === "income" ? "income" : "expense", setCategoryId)}
                  >
                    <span className="add-category-icon"><Plus size={20} /></span>
                    <span>Add category</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {type === "transfer" ? (
            <>
              <div className="field-row">
                <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
                <label>Time<input type="time" value={transferTime} onChange={(event) => setTransferTime(event.target.value)} /></label>
              </div>
              <label>Note (optional)<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add a note" /></label>
            </>
          ) : (
            <div className="field-row">
              <label>Date<input type="date" value={date} onChange={(event) => {
                const nextDate = event.target.value;
                setDate(nextDate);
                setRepeatStartDate((current) => current === date ? nextDate : current);
              }} /></label>
              <label>Note<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional (e.g. Starbucks)" /></label>
            </div>
          )}

          {type === "expense" && !receiptFlow && (
            <div className="repeat-control">
              <button
                type="button"
                className="repeat-toggle-row"
                aria-pressed={repeatEnabled}
                onClick={() => setRepeatEnabled((enabled) => !enabled)}
              >
                <span><CalendarClock size={17} /> Repeat</span>
                <span className={`switch-track ${repeatEnabled ? "on" : ""}`} aria-hidden="true"><i /></span>
              </button>
              {repeatEnabled && (
                <div className="repeat-fields">
                  <label>Frequency
                    <select value={repeatFrequency} onChange={(event) => setRepeatFrequency(event.target.value as RecurringFrequency)}>
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="biweekly">Every 2 weeks</option>
                      <option value="monthly">Monthly</option>
                      <option value="yearly">Yearly</option>
                    </select>
                  </label>
                  <label>Starts
                    <input type="date" value={repeatStartDate} onChange={(event) => setRepeatStartDate(event.target.value)} />
                  </label>
                  <label>Ends
                    <select value={repeatEndMode} onChange={(event) => setRepeatEndMode(event.target.value as typeof repeatEndMode)}>
                      <option value="never">Never</option>
                      <option value="date">On date</option>
                      <option value="after">After a number of times</option>
                    </select>
                  </label>
                  {repeatEndMode === "date" && <label>End date
                    <input type="date" value={repeatEndDate} min={repeatStartDate} onChange={(event) => setRepeatEndDate(event.target.value)} />
                  </label>}
                  {repeatEndMode === "after" && <label>Number of times
                    <input type="number" inputMode="numeric" min="1" step="1" value={repeatCount} onChange={(event) => setRepeatCount(event.target.value)} />
                  </label>}
                </div>
              )}
            </div>
          )}

          {receiptFlow ? (
            <div className="receipt-review-photo">
              <span><ReceiptText size={16} /> {receipt?.name || "Receipt image attached"}</span>
              <button type="button" onClick={() => { setReceipt(null); setReceiptStep("choose"); setReceiptMessage(""); setAmount(""); setNote(""); setDate(toDateString(new Date())); }}>
                Retake photo
              </button>
              <button type="button" onClick={() => receiptFileRef.current?.click()}>
                Reupload photo
              </button>
            </div>
          ) : (
            <div className="receipt-picker">
              <div className="receipt-picker-heading"><b>Receipt photo</b><small>{receipt?.name || "Add a photo to fill transaction details"}</small></div>
              <div className="receipt-picker-actions">
                <button type="button" onClick={() => void requestCameraAccess()} disabled={receiptScanning}><Camera size={16} /> Take photo</button>
                <button type="button" onClick={() => receiptFileRef.current?.click()} disabled={receiptScanning}><Upload size={16} /> Upload photo</button>
              </div>
              {receiptMessage && <small className="receipt-scan-message" role="status">{receiptMessage}</small>}
            </div>
          )}
        </div>

        <div className="transaction-sticky-footer">
          {amountKeyboardVisible && receiptStep === "details" && (
            <div className="calculator-popup" role="group" aria-label="Amount calculator">
              <div className="calculator-popup-heading">
                <span className="calculator-expression" aria-live="polite">{expression}</span>
                <button
                  type="button"
                  className="calculator-hide-button"
                  aria-label="Hide calculator keyboard"
                  onClick={() => {
                    setAmountKeyboardVisible(false);
                    amountInputRef.current?.blur();
                  }}
                >
                  Hide
                </button>
              </div>
              {calculatorError && <p className="calculator-popup-error" role="alert">{calculatorError}</p>}
              <div className="calculator-keypad">
                {[
                  { key: "AC", label: "AC", className: "utility" },
                  { key: "back", label: "⌫", className: "utility" },
                  { key: "%", label: "%", className: "utility" },
                  { key: "÷", label: "÷", className: "operator" },
                  { key: "7", label: "7" }, { key: "8", label: "8" }, { key: "9", label: "9" },
                  { key: "×", label: "×", className: "operator" },
                  { key: "4", label: "4" }, { key: "5", label: "5" }, { key: "6", label: "6" },
                  { key: "−", label: "−", className: "operator" },
                  { key: "1", label: "1" }, { key: "2", label: "2" }, { key: "3", label: "3" },
                  { key: "+", label: "+", className: "operator" },
                  { key: "0", label: "0", className: "wide" }, { key: ".", label: "." },
                  { key: "=", label: "=", className: "equals" },
                ].map(({ key, label, className = "" }) => (
                  <button
                    key={key}
                    type="button"
                    className={`calculator-key ${className}`}
                    aria-label={key === "back" ? "Delete last digit" : label}
                    onClick={() => keypadPress(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {type === "transfer" && (
            <div className="transfer-total-summary" aria-live="polite">
              <div><span>Amount to receive</span><b>{formatMoney(transferAmountCents, profile?.currency || "PHP")}</b></div>
              {sourceType === "my" && <>
                <div><span>Transfer fee</span><b>{formatMoney(transferFeeCents, profile?.currency || "PHP")}</b></div>
                <div className="transfer-total-line"><span>Total deduction</span><b>{formatMoney(totalTransferDeduction, profile?.currency || "PHP")}</b></div>
              </>}
            </div>
          )}
          <div className={`transaction-sticky-actions ${type === "transfer" ? "transfer-actions" : "entry-actions"}`}>
            {type !== "transfer" && (
              <label className="transaction-account-field">
                <span>Account</span>
                <select
                  value={accountId}
                  onFocus={() => setAmountKeyboardVisible(false)}
                  onChange={(event) => setAccountId(event.target.value)}
                >
                  <option value="">Select account</option>
                  {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>
            )}
            <button
              className="save-button"
              onClick={save}
              disabled={parseMoney(amount) <= 0 || !accountId || (type !== "transfer" && !categoryId) || (repeatEnabled && (!repeatStartDate || (repeatEndMode === "date" && (!repeatEndDate || repeatEndDate < repeatStartDate)) || (repeatEndMode === "after" && (!Number(repeatCount) || Number(repeatCount) < 1)))) || (type === "transfer" && ((sourceType === "external" && destinationType === "external") || (sourceType === "my" && destinationType === "my" && (!toAccountId || toAccountId === accountId)) || (sourceType === "external" && !externalFromName.trim()) || (destinationType === "external" && !externalToName.trim()) || (balanceWarning && !sourceCanGoNegative)))}
            >
              {type === "transfer" ? "Confirm transfer" : "Save transaction"}
            </button>
          </div>
        </div>
        </>}

        {cameraOpen && (
          <div className="camera-capture-overlay" role="dialog" aria-modal="true" aria-label="Capture receipt">
            <div className="camera-capture-panel">
              <div className="camera-capture-heading">
                <div><b>Take a receipt photo</b><small>Allow camera access to capture your receipt.</small></div>
                <button type="button" onClick={closeCamera} aria-label="Close camera"><X size={20} /></button>
              </div>
              <video ref={cameraVideoRef} autoPlay muted playsInline />
              <div className="camera-capture-actions">
                <button type="button" className="camera-cancel-button" onClick={closeCamera}>Cancel</button>
                <button type="button" className="camera-capture-button" onClick={captureCameraPhoto}><Camera size={17} /> Capture photo</button>
              </div>
            </div>
          </div>
        )}

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
  const selectedTemplate = templates.find((item) => item.name === template);

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
            {selectedTemplate && (
              <div className="account-template-preview">
                <AccountLogo name={selectedTemplate.name} filename={selectedTemplate.logo} color={selectedTemplate.color} type={selectedTemplate.type} size={48} />
                <span><b>{selectedTemplate.name}</b><small>{selectedTemplate.type === "ewallet" ? "E-wallet or payment account" : selectedTemplate.type === "cash" ? "Cash account" : "Bank account"}</small></span>
              </div>
            )}
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
