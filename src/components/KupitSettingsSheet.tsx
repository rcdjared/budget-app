import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  ChevronRight,
  CircleDollarSign,
  Cloud,
  Download,
  ExternalLink,
  Fingerprint,
  FileJson,
  FileSpreadsheet,
  Globe2,
  HelpCircle,
  Home,
  Languages,
  LayoutGrid,
  Moon,
  Palette,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Sun,
  Trash2,
  Upload,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Session } from "@supabase/supabase-js";
import { db } from "@/db/schema";
import { exportJsonBackup, exportTransactionsCsv, importJsonBackup } from "@/lib/backup";
import { syncLocalData } from "@/sync/sync";
import { cloudSyncAvailable, supabase } from "@/lib/supabase";
import { loadAppSettings, saveAppSettings, type AppSettings, type ThemePreference } from "@/lib/settings";

interface KupitSettingsSheetProps {
  open: boolean;
  onClose: () => void;
  profileId: string;
  themePreference: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onOpenCategories: () => void;
  onOpenPlan: () => void;
  authCallbackNotice: string;
}

const ACCENT_COLORS = [
  { name: "Kupit Green", value: "#019B51" },
  { name: "Emerald", value: "#10B981" },
  { name: "Blue", value: "#2563EB" },
  { name: "Indigo", value: "#6366F1" },
  { name: "Purple", value: "#9333EA" },
  { name: "Pink", value: "#DB2777" },
  { name: "Red", value: "#DC2626" },
  { name: "Orange", value: "#EA580C" },
  { name: "Amber", value: "#D97706" },
  { name: "Teal", value: "#0F766E" },
];

const CURRENCIES = [
  ["PHP", "Philippine Peso", "₱"],
  ["USD", "US Dollar", "$"],
  ["EUR", "Euro", "€"],
  ["JPY", "Japanese Yen", "¥"],
  ["GBP", "British Pound", "£"],
  ["SGD", "Singapore Dollar", "S$"],
  ["AUD", "Australian Dollar", "A$"],
  ["CAD", "Canadian Dollar", "C$"],
  ["KRW", "South Korean Won", "₩"],
  ["AED", "UAE Dirham", "د.إ"],
] as const;

type DetailName =
  | "account"
  | "home"
  | "preferences"
  | "currency"
  | "help"
  | "statement"
  | "privacy"
  | "whats-new"
  | null;

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`kupit-toggle ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function KupitSettingsSheet({
  open,
  onClose,
  profileId,
  themePreference,
  onThemeChange,
  onOpenCategories,
  onOpenPlan,
  authCallbackNotice,
}: KupitSettingsSheetProps) {
  const [settings, setSettings] = useState<AppSettings>(() => loadAppSettings());
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<DetailName>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [currencySearch, setCurrencySearch] = useState("");
  const [statementOpen, setStatementOpen] = useState(false);
  const [statementMonth, setStatementMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [session, setSession] = useState<Session | null>(null);
  const [authChecking, setAuthChecking] = useState(false);
  const [cloudMessage, setCloudMessage] = useState(authCallbackNotice);
  const [cloudBusy, setCloudBusy] = useState(false);
  const customColorRef = useRef<HTMLInputElement>(null);

  const profile = useLiveQuery(() => db.profiles.get(profileId), [profileId]);
  const transactions = useLiveQuery(() => db.transactions.toArray(), [], []);

  const updateSettings = (patch: Partial<AppSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      saveAppSettings(next);
      void db.settings.put({
        id: "kupit-app-settings",
        profileId,
        key: "kupit-app-settings",
        value: JSON.stringify(next),
      }).catch(console.error);
      return next;
    });
  };

  useEffect(() => {
    document.documentElement.lang = settings.language === "fil" ? "fil" : "en";
  }, [settings.language]);

  useEffect(() => {
    if (!open) return;
    setSearch("");
  }, [open]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--primary", settings.accentColor);
    root.style.setProperty("--ring", settings.accentColor);
  }, [settings.accentColor]);

  useEffect(() => {
    if (!supabase || !open) return;
    let active = true;
    setAuthChecking(true);
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
      setAuthChecking(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthChecking(false);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [open]);

  const chooseAccent = (value: string, name: string) => updateSettings({ accentColor: value, accentName: name });

  const enableBiometric = async () => {
    if (settings.biometricUnlock) {
      updateSettings({ biometricUnlock: false });
      return;
    }
    if (!window.isSecureContext || !navigator.credentials) {
      window.alert("Biometric unlock is unavailable in this browser. Kupit can enable it in an installed PWA build.");
      return;
    }
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "Kupit" },
          user: {
            id: crypto.getRandomValues(new Uint8Array(16)),
            name: profile?.name || "kupit-user",
            displayName: profile?.name || "Kupit User",
          },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required" },
          timeout: 60_000,
        },
      });
      updateSettings({ biometricUnlock: true });
    } catch {
      window.alert("Biometric verification was cancelled or could not be completed.");
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
  };

  const syncCloud = async () => {
    if (!supabase || !session) return;
    setCloudBusy(true);
    try {
      await syncLocalData(supabase, session.user.id);
      setCloudMessage("Your budget is up to date.");
    } catch (error) {
      setCloudMessage(error instanceof Error ? error.message : "Cloud backup failed.");
    } finally {
      setCloudBusy(false);
    }
  };

  const resetData = async () => {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    await db.delete();
    localStorage.clear();
    window.location.reload();
  };

  const statementSummary = useMemo(() => {
    const monthTransactions = (transactions || []).filter((tx) => tx.date.startsWith(statementMonth));
    const income = monthTransactions.filter((tx) => tx.type === "income").reduce((sum, tx) => sum + tx.amount, 0);
    const expense = monthTransactions.filter((tx) => tx.type === "expense").reduce((sum, tx) => sum + tx.amount, 0);
    return { income, expense, net: income - expense };
  }, [transactions, statementMonth]);

  if (!open) return null;

  const matches = (title: string, description = "") =>
    !search.trim() || `${title} ${description}`.toLowerCase().includes(search.trim().toLowerCase());

  const Row = ({
    icon,
    title,
    description,
    onClick,
    trailing,
    disabled,
  }: {
    icon: React.ReactNode;
    title: string;
    description: string;
    onClick?: () => void;
    trailing?: React.ReactNode;
    disabled?: boolean;
  }) => {
    if (!matches(title, description)) return null;
    return (
      <button
        type="button"
        className="kupit-settings-row"
        onClick={disabled ? undefined : onClick}
        disabled={disabled}
      >
        <span className="kupit-settings-squircle">{icon}</span>
        <span className="kupit-settings-row-copy">
          <b>{title}</b>
          <small>{description}</small>
        </span>
        {trailing || (!disabled && <ChevronRight size={18} className="kupit-settings-chevron" />)}
      </button>
    );
  };

  const Section = ({ label, children }: { label: string; children: React.ReactNode }) => {
    const visibleChildren = Array.isArray(children)
      ? children.filter((child) => child !== null && child !== false)
      : children;
    if (visibleChildren == null) return null;
    return (
      <section className="kupit-settings-section">
        {label && <h2>{label}</h2>}
        <div className="kupit-settings-card">{children}</div>
      </section>
    );
  };

  const hasVisibleSection = (titles: string[]) =>
    !search.trim() || titles.some((title) => title.toLowerCase().includes(search.trim().toLowerCase()));

  const searchableContent =
    "profile account signed in local Google language English Filipino choose how app talks home sections reorder preferences net worth decimal budget cycle haptics quick actions security biometric Face ID fingerprint appearance system light dark AMOLED app color currency PHP Peso quick OS shortcuts wallet tap to pay shake undo help use guide statement PDF income expenses net income backup cloud import CSV export restore local backup about Kupit version updates what's new feedback community privacy third-party trademarks reset all data";
  const showEmptyState = Boolean(search.trim()) && !searchableContent.toLowerCase().includes(search.trim().toLowerCase());

  return (
    <div className="kupit-settings-backdrop" role="dialog" aria-modal="true" aria-label="Settings">
      <section className="kupit-settings-page">
        <header className="kupit-settings-header">
          <button type="button" className="kupit-settings-back" onClick={onClose} aria-label="Back">
            <ArrowLeft size={20} />
          </button>
          <h1>Settings</h1>
          <span className="kupit-settings-header-spacer" />
        </header>

        <div className="kupit-settings-scroll">
          {hasVisibleSection(["profile", "account", "signed in", profile?.name || ""]) && (
            <Section label="Account">
              <Row
                icon={<UserRound size={19} />}
                title="Profile"
                description={session?.user.email ? `Signed in · ${session.user.email}` : `${profile?.name || "Kupit user"} · Local profile`}
                onClick={() => setDetail("account")}
              />
            </Section>
          )}

          {hasVisibleSection(["language", "English", "Filipino", "choose how"]) && (
            <Section label="Language">
              <div className="kupit-settings-language">
                <div className="kupit-settings-segment">
                  <button className={settings.language === "en" ? "selected" : ""} onClick={() => updateSettings({ language: "en" })}>English</button>
                  <button className={settings.language === "fil" ? "selected" : ""} onClick={() => updateSettings({ language: "fil" })}>Filipino</button>
                </div>
                <small>Choose how the app talks</small>
              </div>
            </Section>
          )}

          {hasVisibleSection(["home", "sections", "reorder"]) && (
            <Section label="Home">
              <Row icon={<Home size={19} />} title="Home sections" description="Show, hide, and reorder the sections on your Home screen" onClick={() => setDetail("home")} />
            </Section>
          )}

          {hasVisibleSection(["preferences", "net worth", "decimal", "budget cycle", "haptics", "quick actions"]) && (
            <Section label="Preferences">
              <Row icon={<LayoutGrid size={19} />} title="App preferences" description="Net worth rules, decimal display, budget cycle, haptics, and plus-button actions" onClick={() => setDetail("preferences")} />
            </Section>
          )}

          {hasVisibleSection(["security", "biometric", "face", "fingerprint"]) && (
            <Section label="Security">
              <Row
                icon={<Fingerprint size={19} />}
                title="Biometric unlock"
                description="Require Face ID or fingerprint when opening the app and whenever you come back"
                trailing={<Toggle checked={settings.biometricUnlock} onChange={enableBiometric} label="Biometric unlock" />}
              />
            </Section>
          )}

          {hasVisibleSection(["appearance", "theme", "system", "light", "dark", "amoled", "color"]) && (
            <Section label="Appearance">
              <div className="kupit-appearance">
                <div className="kupit-appearance-previews">
                  {([
                    ["system", "System", <Smartphone size={19} />],
                    ["light", "Light", <Sun size={19} />],
                    ["dark", "Dark", <Moon size={19} />],
                    ["amoled", "AMOLED", <Moon size={19} />],
                  ] as [ThemePreference, string, React.ReactNode][]).map(([mode, label, icon]) => (
                    <button
                      type="button"
                      key={mode}
                      className={`kupit-theme-preview ${themePreference === mode ? "selected" : ""}`}
                      onClick={() => onThemeChange(mode)}
                    >
                      <span className={`theme-screen theme-${mode}`}><span>{icon}</span></span>
                      <b>{label}</b>
                    </button>
                  ))}
                </div>
                <small className="kupit-appearance-helper">
                  {themePreference === "system" ? "Matches your device setting" : `${themePreference === "amoled" ? "AMOLED" : themePreference[0].toUpperCase() + themePreference.slice(1)} theme is selected`}
                </small>
                <div className="kupit-color-heading"><b>App color</b><span>{settings.accentName}</span></div>
                <div className="kupit-color-grid">
                  {ACCENT_COLORS.map((color) => (
                    <button
                      type="button"
                      key={color.value}
                      aria-label={color.name}
                      className={`kupit-color-swatch ${settings.accentColor.toLowerCase() === color.value.toLowerCase() ? "selected" : ""}`}
                      style={{ background: color.value }}
                      onClick={() => chooseAccent(color.value, color.name)}
                    />
                  ))}
                  <button type="button" className="kupit-custom-swatch" onClick={() => customColorRef.current?.click()} aria-label="Custom color">
                    +
                    <input ref={customColorRef} type="color" value={settings.accentColor} onChange={(event) => chooseAccent(event.target.value, "Custom")} />
                  </button>
                </div>
              </div>
            </Section>
          )}

          {hasVisibleSection(["currency", "PHP", "Peso", "currency"]) && (
            <Section label="Currency">
              <Row icon={<CircleDollarSign size={19} />} title="Currency" description={`${settings.currency} - ${CURRENCIES.find(([code]) => code === settings.currency)?.[2] || "symbol"}`} onClick={() => setDetail("currency")} />
            </Section>
          )}

          {hasVisibleSection(["quick actions", "shortcuts", "shake", "undo", "wallet", "tap to pay"]) && (
            <Section label="Quick actions">
              <Row icon={<Smartphone size={19} />} title="OS shortcuts" description="Set up quick entries from your device" disabled trailing={<span className="kupit-coming">Coming soon</span>} />
              <Row icon={<Banknote size={19} />} title="Wallet and tap to pay" description="Connect supported mobile wallet actions" disabled trailing={<span className="kupit-coming">Coming soon</span>} />
              <Row
                icon={<RefreshCw size={19} />}
                title="Shake to undo"
                description="Shake after adding an expense or income to undo it briefly"
                trailing={<Toggle checked={settings.shakeToUndo} onChange={(checked) => updateSettings({ shakeToUndo: checked })} label="Shake to undo" />}
              />
            </Section>
          )}

          {hasVisibleSection(["help", "use", "guide"]) && (
            <Section label="Help">
              <div className="kupit-help-card">
                <div className="kupit-help-copy">
                  <span className="kupit-settings-squircle"><HelpCircle size={19} /></span>
                  <div><b>How to use the app</b><small>Learn the basics for tracking, budgets, accounts, and transfers.</small></div>
                </div>
                <button type="button" onClick={() => setDetail("help")}>Open help guide</button>
              </div>
            </Section>
          )}

          {hasVisibleSection(["statement", "PDF", "income", "expense", "month"]) && (
            <Section label="Generate statement PDF">
              <div className="kupit-statement">
                <button type="button" className="kupit-settings-row kupit-accordion-trigger" onClick={() => setStatementOpen((value) => !value)}>
                  <span className="kupit-settings-squircle"><FileSpreadsheet size={19} /></span>
                  <span className="kupit-settings-row-copy"><b>Monthly summary</b><small>Generate a PDF of income, expenses, and net income</small></span>
                  <ChevronRight size={18} className={`kupit-settings-chevron ${statementOpen ? "open" : ""}`} />
                </button>
                {statementOpen && (
                  <div className="kupit-statement-content">
                    <label>Month<input type="month" value={statementMonth} onChange={(event) => setStatementMonth(event.target.value)} /></label>
                    <div className="kupit-statement-totals">
                      <span><small>Income</small><b>₱{(statementSummary.income / 100).toFixed(settings.showDecimals ? 2 : 0)}</b></span>
                      <span><small>Expenses</small><b>₱{(statementSummary.expense / 100).toFixed(settings.showDecimals ? 2 : 0)}</b></span>
                      <span><small>Net income</small><b>₱{(statementSummary.net / 100).toFixed(settings.showDecimals ? 2 : 0)}</b></span>
                    </div>
                    <button type="button" className="kupit-primary-button" onClick={() => window.print()}>Generate and print PDF</button>
                  </div>
                )}
              </div>
            </Section>
          )}

          {hasVisibleSection(["backup", "cloud", "import", "CSV", "export", "restore", "local"]) && (
            <Section label="Backup">
              <Row
                icon={<Cloud size={19} />}
                title="Cloud backup"
                description={!settings.cloudBackup ? "Backup is off" : authChecking ? "Checking backup status" : session ? "Connected · stored in your private account" : "Sign-in required"}
                trailing={<Toggle checked={settings.cloudBackup} onChange={(checked) => { updateSettings({ cloudBackup: checked }); if (checked) void syncCloud(); }} label="Cloud backup" />}
              />
              <Row icon={<Upload size={19} />} title="Import from other apps" description="Import transactions from a CSV file" onClick={() => setDetail("statement")} disabled />
              <div className="kupit-statement">
                <button type="button" className="kupit-settings-row kupit-accordion-trigger" onClick={() => setBackupOpen((value) => !value)}>
                  <span className="kupit-settings-squircle"><FileJson size={19} /></span>
                  <span className="kupit-settings-row-copy"><b>Manage your local backup</b><small>Export or restore a JSON or CSV backup</small></span>
                  <ChevronRight size={18} className={`kupit-settings-chevron ${backupOpen ? "open" : ""}`} />
                </button>
                {backupOpen && (
                  <div className="kupit-backup-actions">
                    <button type="button" onClick={exportJsonBackup}><Download size={16} /> Export JSON</button>
                    <button type="button" onClick={exportTransactionsCsv}><FileSpreadsheet size={16} /> Export CSV</button>
                    <label><Upload size={16} /> Restore from file
                      <input type="file" accept=".json,application/json" onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        if (!window.confirm("Restore this backup? Existing matching records may be overwritten.")) return;
                        try {
                          await importJsonBackup(file);
                          window.alert("Backup restored.");
                        } catch (error) {
                          window.alert(error instanceof Error ? error.message : "Could not restore the backup.");
                        }
                      }} />
                    </label>
                  </div>
                )}
              </div>
            </Section>
          )}

          {hasVisibleSection(["about", "Kupit", "version", "updates", "feedback", "community", "privacy"]) && (
            <Section label="About">
              <div className="kupit-about-card">
                <img src="/icons/kupit-logo.svg" alt="Kupit" />
                <div><b>Kupit</b><span>v0.0.1</span></div>
                <p>Simple, private budgeting for everyday decisions.</p>
                <small>Made by <b>Jared Dionela</b></small>
              </div>
              <Row icon={<RefreshCw size={19} />} title="Check for updates" description="You're using the latest available version" trailing={<RefreshCw size={16} />} />
              <Row icon={<BadgeCheck size={19} />} title="What's new" description="Release notes and recent improvements" onClick={() => setDetail("whats-new")} />
              <Row icon={<HelpCircle size={19} />} title="Send feedback" description="Share an idea or report a problem" onClick={() => setDetail("help")} />
              <Row icon={<Globe2 size={19} />} title="Community" description="Visit the Kupit community" trailing={<ArrowUpRight size={16} />} disabled />
              <Row icon={<ShieldCheck size={19} />} title="Privacy notice" description="How Kupit stores and handles data" onClick={() => setDetail("privacy")} />
              <Row icon={<ExternalLink size={19} />} title="Third-party trademarks" description="Names and trademarks belong to their respective owners" onClick={() => setDetail("privacy")} />
            </Section>
          )}

          {showEmptyState && (
            <div className="kupit-settings-empty">
              <Search size={22} />
              <b>No settings found</b>
              <small>Try a different title or description.</small>
            </div>
          )}

          {matches("Reset all data", "can't be undone") && !showEmptyState && (
            <button type="button" className={`kupit-reset-button ${confirmReset ? "confirm" : ""}`} onClick={resetData}>
              <Trash2 size={18} />
              {confirmReset ? "Tap again — this cannot be undone" : "Reset all data"}
            </button>
          )}
          <footer className="kupit-settings-footer">Made for clearer money decisions — Kupit</footer>
        </div>

        <label className="kupit-settings-search">
          <Search size={18} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search settings" aria-label="Search settings" />
          {search && <button type="button" onClick={() => setSearch("")} aria-label="Clear search"><X size={16} /></button>}
        </label>
      </section>

      {detail && (
        <div className="kupit-detail-backdrop" role="dialog" aria-modal="true" aria-label="Settings detail" onMouseDown={(event) => { if (event.target === event.currentTarget) setDetail(null); }}>
          <section className="kupit-detail-sheet">
            <header>
              <button type="button" onClick={() => setDetail(null)} aria-label="Back"><ArrowLeft size={18} /></button>
              <b>{detail === "currency" ? "Currency" : detail === "preferences" ? "Preferences" : detail === "account" ? "Account" : detail === "home" ? "Home sections" : detail === "statement" ? "Import" : detail === "privacy" ? "Privacy notice" : detail === "whats-new" ? "What's new" : "Help guide"}</b>
              <span />
            </header>
            <div className="kupit-detail-content">
              {detail === "account" && (
                <>
                  <div className="kupit-detail-profile"><span>{(profile?.name || "Kupit")[0]?.toUpperCase()}</span><div><b>{profile?.name || "Kupit User"}</b><small>{session?.user.email || "Local profile"}</small></div></div>
                  {session ? <button type="button" className="kupit-primary-button" onClick={signOut}>Sign out</button> : <small className="kupit-muted">This profile is stored locally on this device.</small>}
                  <button type="button" className="kupit-danger-link" onClick={() => setConfirmReset(true)}>Delete account data</button>
                </>
              )}
              {detail === "currency" && (
                <>
                  <label className="kupit-currency-search"><Search size={16} /><input value={currencySearch} onChange={(event) => setCurrencySearch(event.target.value)} placeholder="Search currency" /></label>
                  <div className="kupit-currency-list">
                    {CURRENCIES.filter(([code, name]) => `${code} ${name}`.toLowerCase().includes(currencySearch.trim().toLowerCase())).map(([code, name, symbol]) => (
                      <button type="button" key={code} className={settings.currency === code ? "selected" : ""} onClick={() => { updateSettings({ currency: code }); setDetail(null); }}>
                        <span>{symbol}</span><div><b>{code}</b><small>{name}</small></div>{settings.currency === code && <BadgeCheck size={18} />}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {detail === "preferences" && (
                <div className="kupit-preference-list">
                  <Row icon={<ShieldCheck size={18} />} title="Net worth accounts" description="Choose accounts included in net worth" onClick={() => setDetail(null)} disabled />
                  <Row icon={<CircleDollarSign size={18} />} title="Decimal display" description="Show cents on money values" trailing={<Toggle checked={settings.showDecimals} onChange={(checked) => updateSettings({ showDecimals: checked })} label="Show decimals" />} />
                  <label className="kupit-budget-cycle">Budget cycle starts on <input type="number" min={1} max={31} value={settings.budgetCycleStartDay} onChange={(event) => updateSettings({ budgetCycleStartDay: Math.max(1, Math.min(31, Number(event.target.value))) })} /></label>
                  <Row icon={<Smartphone size={18} />} title="Haptics" description="Use device vibration for supported actions" trailing={<Toggle checked={settings.haptics} onChange={(checked) => updateSettings({ haptics: checked })} label="Haptics" />} />
                </div>
              )}
              {detail === "home" && (
                <div className="kupit-simple-options">
                  {[
                    ["net-worth", "Net worth"],
                    ["budgets", "Budgets"],
                    ["recent", "Recent transactions"],
                    ["insights", "Insights"],
                  ].map(([id, label]) => (
                    <Row key={id} icon={<LayoutGrid size={18} />} title={label} description={settings.homeSections.includes(id) ? "Visible on Home" : "Hidden from Home"} trailing={<Toggle checked={settings.homeSections.includes(id)} onChange={(checked) => updateSettings({ homeSections: checked ? [...settings.homeSections, id] : settings.homeSections.filter((item) => item !== id) })} label={label} />} />
                  ))}
                </div>
              )}
              {detail === "help" && <p>Kupit keeps your accounts, transactions, budgets, and reports in one place. Use the + button to log income or an expense, open Wallet to manage accounts, and open Plan to set spending limits.</p>}
              {detail === "statement" && <p>The other-app CSV import is not available yet. You can export transactions to CSV or restore a Kupit JSON backup from the Backup section.</p>}
              {detail === "privacy" && <p>Kupit stores your budget data in IndexedDB on this device. If you choose cloud backup and sign in, your account data can be synced through Supabase. Local backups are created only when you export or restore them. Kupit does not sell your personal budget data.</p>}
              {detail === "whats-new" && <p><b>Version 0.0.1</b><br />The Settings page now includes theme, app color, language, currency, privacy, local backups, and data reset controls.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
