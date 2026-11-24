import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  Banknote,
  Bell,
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
import { profileRecords } from "@/db/profileScope";
import { updateProfile } from "@/db/repositories/profiles";
import { exportJsonBackup, exportTransactionsCsv, importJsonBackup, importTransactionsCsv } from "@/lib/backup";
import { supabase } from "@/lib/supabase";
import { loadAppSettings, saveAppSettings, type AppSettings, type ThemePreference } from "@/lib/settings";
import { t } from "@/lib/localization";
import { ACCENT_PRESETS, contrastingForeground } from "@/lib/themeContrast";
import { createRule } from "@/kupi/learning/learning";
import type { SmartCapability } from "@/kupi/nlu/capability";

interface KupitSettingsSheetProps {
  open: boolean;
  initialDetail?: "kupi" | null;
  onClose: () => void;
  profileId: string;
  themePreference: ThemePreference;
  onThemeChange: (theme: ThemePreference) => void;
  onOpenCategories: () => void;
  onOpenPlan: () => void;
  onOpenNotifications: () => void;
  onOpenProfiles: () => void;
}

const ACCENT_COLORS = ACCENT_PRESETS.map(([name, value]) => ({ name, value }));

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
  | "kupi"
  | null;

function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={`kupit-toggle ${checked ? "on" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function KupitSettingsSheet({
  open,
  initialDetail = null,
  onClose,
  profileId,
  themePreference,
  onThemeChange,
  onOpenCategories,
  onOpenPlan,
  onOpenNotifications,
  onOpenProfiles,
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
  const [smartCapability, setSmartCapability] = useState<SmartCapability | null>(null);
  const [modelProgress, setModelProgress] = useState<{ model: "embedding" | "smart" | "delete"; progress: number; status: string } | null>(null);
  const [modelAction, setModelAction] = useState<"embedding" | "smart" | "delete" | null>(null);
  const [modelAvailability, setModelAvailability] = useState<{ embedding: boolean | null; smart: boolean | null }>({ embedding: null, smart: null });
  const modelOperationRef = useRef(0);
  const modelActionRef = useRef<"embedding" | "smart" | "delete" | null>(null);
  const customColorRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && initialDetail) setDetail(initialDetail);
  }, [open, initialDetail]);

  useEffect(() => {
    if (!open || detail !== "kupi" || !initialDetail) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("kupi-offline-models")?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [open, detail, initialDetail]);

  const profile = useLiveQuery(() => db.profiles.get(profileId), [profileId]);
  const profileSetting = useLiveQuery(
    () => db.settings.where("profileId").equals(profileId).filter((setting) => setting.key === "kupit-app-settings").first(),
    [profileId]
  );
  const transactions = useLiveQuery(() => profileRecords(db.transactions, profileId).toArray(), [profileId], []);
  const netWorthAccounts = useLiveQuery(
    () => profileRecords(db.accounts, profileId).filter((account) => !account.deletedAt).toArray(),
    [profileId],
    []
  );
  const kupiRules = useLiveQuery(
    () => profileRecords(db.kupiMerchantRules, profileId).filter((rule) => !rule.deletedAt).toArray(),
    [profileId],
    []
  );

  useEffect(() => {
    if (profileSetting?.value) {
      try {
        const saved = JSON.parse(profileSetting.value) as Partial<AppSettings>;
        setSettings({ ...loadAppSettings(), ...saved });
        return;
      } catch {
        // Fall back to the profile-independent default for malformed saved settings.
      }
    }
    setSettings(loadAppSettings());
  }, [profileId, profileSetting?.value]);

  useEffect(() => {
    let active = true;
    void import("@/kupi/nlu/capability").then(({ detectSmartCapability }) => detectSmartCapability(settings.kupiSmartModelSize ?? "0.6B"))
      .then((capability) => { if (active) setSmartCapability(capability); });
    return () => { active = false; };
  }, [settings.kupiSmartModelSize]);

  useEffect(() => {
    let active = true;
    if (settings.kupiSmartAssist) {
      setModelAvailability((current) => ({ ...current, embedding: null }));
      void import("@/kupi/nlu/embedder").then(({ isEmbeddingModelCached }) => isEmbeddingModelCached())
        .then((available) => { if (active) setModelAvailability((current) => ({ ...current, embedding: available })); })
        .catch(() => {
          if (!active) return;
          setModelAvailability((current) => ({ ...current, embedding: false }));
          setModelProgress({ model: "embedding", progress: 0, status: "Couldn’t load model status. Reload Kupi and try again." });
        });
    }
    if (settings.kupiSmartMode) {
      setModelAvailability((current) => ({ ...current, smart: null }));
      void import("@/kupi/nlu/llmParser").then(({ isLocalLlmModelCached }) => isLocalLlmModelCached(settings.kupiSmartModelSize ?? "0.6B"))
        .then((available) => { if (active) setModelAvailability((current) => ({ ...current, smart: available })); })
        .catch(() => {
          if (!active) return;
          setModelAvailability((current) => ({ ...current, smart: false }));
          setModelProgress({ model: "smart", progress: 0, status: "Couldn’t load model status. Reload Kupi and try again." });
        });
    }
    return () => { active = false; };
  }, [settings.kupiSmartAssist, settings.kupiSmartMode, settings.kupiSmartModelSize]);

  const downloadEmbeddingModel = async () => {
    if (modelActionRef.current) return;
    const operationId = ++modelOperationRef.current;
    modelActionRef.current = "embedding";
    setModelAction("embedding");
    setModelProgress({ model: "embedding", progress: 0, status: "Starting model download" });
    try {
      const { isEmbeddingModelCached, loadEmbeddingModel } = await import("@/kupi/nlu/embedder");
      await loadEmbeddingModel((progress, status) => {
        if (modelOperationRef.current === operationId) setModelProgress({ model: "embedding", progress, status });
      });
      if (modelOperationRef.current === operationId) {
        const available = await isEmbeddingModelCached();
        if (modelOperationRef.current === operationId) {
          setModelAvailability((current) => ({ ...current, embedding: available }));
          setModelProgress({ model: "embedding", progress: 1, status: "Suggestion model is ready on this device" });
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Model could not be loaded";
      const status = /module script failed/i.test(detail) ? "Kupi couldn’t load the model files. Reload the app and try again." : detail;
      if (modelOperationRef.current === operationId) setModelProgress({ model: "embedding", progress: 0, status });
    } finally {
      if (modelOperationRef.current === operationId) {
        modelActionRef.current = null;
        setModelAction(null);
      }
    }
  };

  const downloadSmartModel = async () => {
    if (modelActionRef.current || !smartCapability?.supported) return;
    const operationId = ++modelOperationRef.current;
    const modelSize = settings.kupiSmartModelSize ?? "0.6B";
    modelActionRef.current = "smart";
    setModelAction("smart");
    setModelProgress({ model: "smart", progress: 0, status: "Preparing the local Smart mode model" });
    try {
      const { isLocalLlmModelCached, warmLocalLlm } = await import("@/kupi/nlu/llmParser");
      await warmLocalLlm(modelSize, (progress, status) => {
        if (modelOperationRef.current === operationId) setModelProgress({ model: "smart", progress, status });
      });
      if (modelOperationRef.current === operationId) {
        const available = await isLocalLlmModelCached(modelSize);
        if (modelOperationRef.current === operationId) {
          setModelAvailability((current) => ({ ...current, smart: available }));
          setModelProgress({ model: "smart", progress: 1, status: "Smart mode model is ready on this device" });
        }
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Smart mode model could not be loaded";
      const status = /module script failed/i.test(detail) ? "Kupi couldn’t load the model files. Reload the app and try again." : detail;
      if (modelOperationRef.current === operationId) setModelProgress({ model: "smart", progress: 0, status });
    } finally {
      if (modelOperationRef.current === operationId) {
        modelActionRef.current = null;
        setModelAction(null);
      }
    }
  };

  const cancelModelDownload = async () => {
    const model = modelActionRef.current;
    if (model !== "embedding" && model !== "smart") return;
    const operationId = ++modelOperationRef.current;
    modelActionRef.current = null;
    setModelAction(null);
    setModelProgress({ model, progress: 0, status: "Cancelling download…" });
    if (model === "embedding") {
      const { unloadEmbeddingModel } = await import("@/kupi/nlu/embedder");
      unloadEmbeddingModel();
    } else {
      const { unloadLocalLlm } = await import("@/kupi/nlu/llmParser");
      unloadLocalLlm();
    }
    if (modelOperationRef.current === operationId) setModelProgress({ model, progress: 0, status: "Download cancelled. Partial cached files may be reused next time." });
  };

  const removeKupiModels = async () => {
    if (modelActionRef.current) return;
    const operationId = ++modelOperationRef.current;
    modelActionRef.current = "delete";
    setModelAction("delete");
    setModelProgress({ model: "delete", progress: 0, status: "Removing downloaded models" });
    try {
      const [{ unloadLocalLlm }, { clearProfileEmbeddingIndex }, { deleteEmbeddingModel }] = await Promise.all([
        import("@/kupi/nlu/llmParser"),
        import("@/kupi/nlu/intentIndex"),
        import("@/kupi/nlu/embedder"),
      ]);
      unloadLocalLlm();
      clearProfileEmbeddingIndex();
      await deleteEmbeddingModel();
      const { deleteModelAllInfoInCache } = await import("@mlc-ai/web-llm");
      await Promise.all([
        deleteModelAllInfoInCache("Qwen3-0.6B-q4f16_1-MLC"),
        deleteModelAllInfoInCache("Qwen3-1.7B-q4f16_1-MLC"),
      ]);
      if (modelOperationRef.current === operationId) {
        setModelAvailability({ embedding: false, smart: false });
        setModelProgress({ model: "delete", progress: 1, status: "Downloaded models deleted" });
      }
    } catch (error) {
      if (modelOperationRef.current === operationId) setModelProgress({ model: "delete", progress: 0, status: error instanceof Error ? error.message : "Could not delete all model files" });
    } finally {
      if (modelOperationRef.current === operationId) {
        modelActionRef.current = null;
        setModelAction(null);
      }
    }
  };

  const updateSettings = (patch: Partial<AppSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch };
      // Model opt-ins belong to the active profile only, never the shared app-wide fallback.
      saveAppSettings({ ...next, kupiSmartAssist: false, kupiSmartMode: false, kupiSmartModelSize: "0.6B" });
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
    root.style.setProperty("--primary-foreground", contrastingForeground(settings.accentColor));
    root.style.setProperty("--ring", settings.accentColor);
  }, [settings.accentColor]);

  useEffect(() => {
    if (!supabase || !open) return;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) setSession(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [open]);

  const chooseAccent = (value: string, name: string) => updateSettings({ accentColor: value, accentName: name });

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setSession(null);
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
    className,
  }: {
    icon: React.ReactNode;
    title: string;
    description: string;
    onClick?: () => void;
    trailing?: React.ReactNode;
    disabled?: boolean;
    className?: string;
  }) => {
    if (!matches(title, description)) return null;
    return (
      <button
        type="button"
        className={`kupit-settings-row ${className ?? ""}`}
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
    "profile account signed in local Google language English Filipino choose how app talks home sections reorder preferences net worth decimal budget cycle haptics quick actions security biometric Face ID fingerprint notifications alerts reminders inbox appearance system light dark AMOLED app color currency PHP Peso quick OS shortcuts wallet tap to pay shake undo help use guide statement PDF income expenses net income backup cloud import CSV export restore local backup about Kupit version updates what's new feedback community privacy third-party trademarks reset all data";
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
                title="Profiles & Sync"
                description={session?.user.email ? `Signed in · ${session.user.email}` : `${profile?.name || "Kupit user"} · Local profile`}
                onClick={onOpenProfiles}
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

          {hasVisibleSection(["kupi", "personality", "learned", "merchant", "alias"]) && (
            <Section label="Kupi">
              <Row
                icon={<UserRound size={19} />}
                title="Kupi personality and learning"
                description="Choose Chill, Classic, or Dramatic and manage learned rules"
                onClick={() => setDetail("kupi")}
              />
            </Section>
          )}

          {hasVisibleSection(["home", "sections", "reorder"]) && (
            <Section label="Home">
              <Row icon={<Home size={19} />} title="Home sections" description="Choose which sections appear on Home" onClick={() => setDetail("home")} />
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
                description="App lock with Face ID or fingerprint"
                disabled
                trailing={<span className="kupit-coming">Coming soon</span>}
              />
            </Section>
          )}

          {hasVisibleSection(["notifications", "alerts", "reminders", "inbox"]) && (
            <Section label={t("notifications")}>
              <Row
                icon={<Bell size={19} />}
                title={t("notifications")}
                description={t("manageNotifications")}
                onClick={onOpenNotifications}
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
              <Row icon={<CircleDollarSign size={19} />} title="Currency" description={`${profile?.currency || settings.currency} - ${CURRENCIES.find(([code]) => code === (profile?.currency || settings.currency))?.[1] || "Profile currency"}`} onClick={() => setDetail("currency")} />
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
                disabled
                trailing={<span className="kupit-coming">Coming soon</span>}
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
                description="Sync is off for now. Cloud backup is coming soon."
                disabled
                trailing={<span className="kupit-coming">Coming soon</span>}
              />
              <div className="kupit-statement">
                <label className="kupit-settings-row kupit-accordion-trigger">
                  <span className="kupit-settings-squircle"><Upload size={19} /></span>
                  <span className="kupit-settings-row-copy"><b>Import from a Kupit CSV</b><small>Import exported transactions into this profile</small></span>
                  <ChevronRight size={18} className="kupit-settings-chevron" />
                  <input type="file" accept=".csv,text/csv" onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    try {
                      const imported = await importTransactionsCsv(file, profileId);
                      window.alert(`${imported} transactions imported.`);
                    } catch (error) {
                      window.alert(error instanceof Error ? error.message : "Could not import the CSV.");
                    } finally {
                      event.target.value = "";
                    }
                  }} />
                </label>
              </div>
              <div className="kupit-statement">
                <button type="button" className="kupit-settings-row kupit-accordion-trigger" onClick={() => setBackupOpen((value) => !value)}>
                  <span className="kupit-settings-squircle"><FileJson size={19} /></span>
                  <span className="kupit-settings-row-copy"><b>Manage your local backup</b><small>Export or restore a JSON or CSV backup</small></span>
                  <ChevronRight size={18} className={`kupit-settings-chevron ${backupOpen ? "open" : ""}`} />
                </button>
                {backupOpen && (
                  <div className="kupit-backup-actions">
                    <button type="button" onClick={() => void exportJsonBackup(profileId)}><Download size={16} /> Export JSON</button>
                    <button type="button" onClick={() => void exportTransactionsCsv(profileId)}><FileSpreadsheet size={16} /> Export CSV</button>
                    <label><Upload size={16} /> Restore from file
                      <input type="file" accept=".json,application/json" onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        if (!window.confirm("Restore this backup? Existing matching records may be overwritten.")) return;
                        try {
                          await importJsonBackup(file, profileId);
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
              <Row icon={<RefreshCw size={19} />} title="Check for updates" description="Automatic update checks" disabled trailing={<span className="kupit-coming">Coming soon</span>} />
              <Row icon={<BadgeCheck size={19} />} title="What's new" description="Release notes and recent improvements" onClick={() => setDetail("whats-new")} />
              <Row icon={<HelpCircle size={19} />} title="Send feedback" description="Share an idea or report a problem" disabled trailing={<span className="kupit-coming">Coming soon</span>} />
              <Row icon={<Globe2 size={19} />} title="Community" description="Visit the Kupit community" trailing={<span className="kupit-coming">Coming soon</span>} disabled />
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
              <b>{detail === "currency" ? "Currency" : detail === "preferences" ? "Preferences" : detail === "kupi" ? "Kupi personality and learning" : detail === "account" ? "Account" : detail === "home" ? "Home sections" : detail === "statement" ? "Import" : detail === "privacy" ? "Privacy notice" : detail === "whats-new" ? "What's new" : "Help guide"}</b>
              <span />
            </header>
            <div className="kupit-detail-content">
              {detail === "account" && (
                <>
                  <div className="kupit-detail-profile"><span>{(profile?.name || "Kupit")[0]?.toUpperCase()}</span><div><b>{profile?.name || "Kupit User"}</b><small>{session?.user.email || "Local profile"}</small></div></div>
                  {session ? <button type="button" className="kupit-primary-button" onClick={signOut}>Sign out</button> : <small className="kupit-muted">This profile is stored locally on this device.</small>}
                  <button type="button" className="kupit-primary-button" onClick={onOpenProfiles}>Manage profiles and sync</button>
                </>
              )}
              {detail === "kupi" && (
                <div className="kupi-detail-stack">
                  <p className="eyebrow">Personality</p>
                  <div className="kupit-settings-segment">
                    {(["chill", "classic", "dramatic"] as const).map((personality) => (
                      <button
                        type="button"
                        key={personality}
                        className={settings.kupiPersonality === personality ? "selected" : ""}
                        onClick={() => updateSettings({ kupiPersonality: personality })}
                      >
                        {personality[0].toUpperCase() + personality.slice(1)}
                      </button>
                    ))}
                  </div>
                  <small className="kupit-muted">Personality changes Kupi's flavor, never the numbers or write decisions.</small>
                  <p className="eyebrow" id="kupi-offline-models">Unlock smarter Kupi</p>
                  <Row
                    className="kupi-model-row"
                    icon={<Download size={18} />}
                    title="Smart assist"
                    description="Better suggestions for short or mixed-language messages."
                    trailing={<Toggle checked={Boolean(settings.kupiSmartAssist)} disabled={modelAction !== null} onChange={(checked) => updateSettings({ kupiSmartAssist: checked })} label="Enable offline Smart assist" />}
                  />
                  {settings.kupiSmartAssist && (
                    <div className="kupi-model-controls">
                      <small className="kupit-muted" role="status">{modelAvailability.embedding === null ? "Checking model…" : modelAvailability.embedding ? "Ready on this device" : "Not downloaded"}</small>
                      <button type="button" className="kupit-primary-button" disabled={modelAction !== null} onClick={() => void downloadEmbeddingModel()}>{modelAvailability.embedding ? "Load model" : "Download model"}</button>
                      {modelProgress?.model === "embedding" && <small role="status" className="kupit-muted">{modelProgress.status}{modelProgress.progress > 0 && modelProgress.progress < 1 ? ` (${Math.round(modelProgress.progress * 100)}%)` : ""}</small>}
                      {modelAction === "embedding" && <button type="button" className="chat-clear-learning" onClick={() => void cancelModelDownload()}>Cancel download</button>}
                    </div>
                  )}
                  <Row
                    className="kupi-model-row"
                    icon={<Smartphone size={18} />}
                    title="Smart mode"
                    description={smartCapability?.supported === false ? "Smart mode isn’t available in this browser or on this device." : "Understand more ways of asking, on this device."}
                    trailing={<Toggle checked={Boolean(settings.kupiSmartMode)} disabled={modelAction !== null || (smartCapability !== null && !smartCapability.supported && !settings.kupiSmartMode)} onChange={(checked) => updateSettings({ kupiSmartMode: checked, kupiSmartAssist: checked || settings.kupiSmartAssist })} label="Enable local Smart mode" />}
                  />
                  {settings.kupiSmartMode && (
                    <div className="kupi-model-controls">
                      <label className="kupit-muted">Model size
                        <select value={settings.kupiSmartModelSize ?? "0.6B"} onChange={(event) => updateSettings({ kupiSmartModelSize: event.target.value as "0.6B" | "1.7B" })}>
                          <option value="0.6B">Small · about 350 MB</option>
                          <option value="1.7B">Large · about 1 GB</option>
                        </select>
                      </label>
                      <small className="kupit-muted">Works offline after download. You review every change before saving.</small>
                      <small className="kupit-muted" role="status">{modelAvailability.smart === null ? "Checking model…" : modelAvailability.smart ? "Ready on this device" : "Not downloaded"}</small>
                      <button type="button" className="kupit-primary-button" disabled={!smartCapability?.supported || modelAction !== null} onClick={() => void downloadSmartModel()}>{modelAvailability.smart ? "Load model" : "Download model"}</button>
                      {modelProgress?.model === "smart" && <small role="status" className="kupit-muted">{modelProgress.status}{modelProgress.progress > 0 && modelProgress.progress < 1 ? ` (${Math.round(modelProgress.progress * 100)}%)` : ""}</small>}
                      {modelAction === "smart" && <button type="button" className="chat-clear-learning" onClick={() => void cancelModelDownload()}>Cancel download</button>}
                    </div>
                  )}
                  {modelProgress?.model === "delete" && <small role="status" className="kupit-muted">{modelProgress.status}</small>}
                  <button type="button" className="kupit-reset-button" disabled={modelAction !== null} onClick={() => {
                    void removeKupiModels();
                    updateSettings({ kupiSmartAssist: false, kupiSmartMode: false });
                  }}><Trash2 size={16} /> Delete downloaded Kupi models</button>
                  <p className="eyebrow">Learned rules</p>
                  <button
                    type="button"
                    className="kupit-primary-button"
                    onClick={async () => {
                      const alias = window.prompt("What nickname should Kupi learn?");
                      if (!alias?.trim()) return;
                      const accountName = window.prompt("Which account is it for? Enter the exact account name.");
                      if (!accountName?.trim()) return;
                      const account = (netWorthAccounts || []).find(({ name }) => name.toLowerCase() === accountName.trim().toLowerCase());
                      if (!account) {
                        window.alert("That account was not found in this profile.");
                        return;
                      }
                      await db.kupiMerchantRules.put(createRule(profileId, "account_alias", alias, account.id, account.name));
                    }}
                  >
                    Add account alias
                  </button>
                  {(kupiRules || []).length === 0 && <small className="kupit-muted">No learned rules in this profile yet.</small>}
                  {(kupiRules || []).map((rule) => (
                    <Row
                      key={rule.id}
                      icon={<UserRound size={18} />}
                      title={rule.source}
                      description={`${rule.kind === "merchant_category" ? "Category" : rule.kind === "account_alias" ? "Account alias" : "Account"} → ${rule.targetName}`}
                      trailing={
                        <button
                          type="button"
                          className="chat-clear-learning"
                          onClick={() => void db.kupiMerchantRules.delete(rule.id)}
                          aria-label={`Delete rule ${rule.source}`}
                        >
                          Delete
                        </button>
                      }
                    />
                  ))}
                  {(kupiRules || []).length > 0 && (
                    <button
                      type="button"
                      className="kupit-reset-button"
                      onClick={() => void db.kupiMerchantRules.where("profileId").equals(profileId).delete()}
                    >
                      Clear all learned rules
                    </button>
                  )}
                </div>
              )}
              {detail === "currency" && (
                <>
                  <label className="kupit-currency-search"><Search size={16} /><input value={currencySearch} onChange={(event) => setCurrencySearch(event.target.value)} placeholder="Search currency" /></label>
                  <div className="kupit-currency-list">
                    {CURRENCIES.filter(([code, name]) => `${code} ${name}`.toLowerCase().includes(currencySearch.trim().toLowerCase())).map(([code, name, symbol]) => (
                      <button type="button" key={code} className={(profile?.currency || settings.currency) === code ? "selected" : ""} onClick={async () => {
                        try {
                          await updateProfile(profileId, { currency: code });
                          updateSettings({ currency: code });
                          setDetail(null);
                        } catch (error) {
                          window.alert(error instanceof Error ? error.message : "Could not update the profile currency.");
                        }
                      }}>
                        <span>{symbol}</span><div><b>{code}</b><small>{name}</small></div>{(profile?.currency || settings.currency) === code && <BadgeCheck size={18} />}
                      </button>
                    ))}
                  </div>
                </>
              )}
              {detail === "preferences" && (
                <div className="kupit-preference-list">
                  <div className="kupit-simple-options">
                    <p className="eyebrow">Net worth accounts</p>
                    {(netWorthAccounts || []).map((account) => {
                      const selected = settings.netWorthAccountIds.length === 0 || settings.netWorthAccountIds.includes(account.id);
                      return (
                        <Row
                          key={account.id}
                          icon={<WalletCards size={18} />}
                          title={account.name}
                          description={account.type.replace("_", " ")}
                          trailing={<Toggle checked={selected} onChange={(checked) => {
                            const current = settings.netWorthAccountIds.length ? settings.netWorthAccountIds : (netWorthAccounts || []).map((item) => item.id);
                            const next = checked ? [...current.filter((id) => id !== account.id), account.id] : current.filter((id) => id !== account.id);
                            updateSettings({ netWorthAccountIds: next });
                          }} label={`Include ${account.name} in net worth`} />}
                        />
                      );
                    })}
                  </div>
                  <Row icon={<CircleDollarSign size={18} />} title="Decimal display" description="Show cents on money values" trailing={<Toggle checked={settings.showDecimals} onChange={(checked) => updateSettings({ showDecimals: checked })} label="Show decimals" />} />
                  <label className="kupit-budget-cycle">Budget cycle starts on <input type="number" min={1} max={31} value={settings.budgetCycleStartDay} onChange={(event) => updateSettings({ budgetCycleStartDay: Math.max(1, Math.min(31, Number(event.target.value))) })} /></label>
                  <label className="kupit-budget-cycle">Week starts on
                    <select value={settings.weekStartsOn} onChange={(event) => updateSettings({ weekStartsOn: Number(event.target.value) })}>
                      {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map((day, index) => (
                        <option value={index} key={day}>{day}</option>
                      ))}
                    </select>
                  </label>
                  <Row icon={<Smartphone size={18} />} title="Haptics" description="Use device vibration for supported actions" trailing={<Toggle checked={settings.haptics} onChange={(checked) => {
                    updateSettings({ haptics: checked });
                    if (checked && navigator.vibrate) navigator.vibrate(20);
                  }} label="Haptics" />} />
                  <Row icon={<Smartphone size={18} />} title="Reduce Motion & Effects" description="Turn off widget animations and transitions" trailing={<Toggle checked={settings.reduceMotion} onChange={(checked) => updateSettings({ reduceMotion: checked })} label="Reduce Motion & Effects" />} />
                  <label className="kupit-budget-cycle">Spending Pulse tone
                    <select value={settings.spendingPulseTone} onChange={(event) => {
                      const tone = event.target.value;
                      if (tone === "gentle" || tone === "playful" || tone === "roast") {
                        updateSettings({ spendingPulseTone: tone });
                      }
                    }}>
                      <option value="gentle">Gentle</option>
                      <option value="playful">Playful</option>
                      <option value="roast">Roast me</option>
                    </select>
                  </label>
                  <Row icon={<CircleDollarSign size={18} />} title="Include money friends owe me" description="Add local friend receivables to net worth" trailing={<Toggle checked={settings.includeFriendReceivables} onChange={(checked) => updateSettings({ includeFriendReceivables: checked })} label="Include friend receivables" />} />
                </div>
              )}
              {detail === "home" && (
                <div className="kupit-simple-options">
                  {[
                    ["categories", "Categories"],
                    ["budgets", "Budgets"],
                    ["upcoming", "Upcoming & balances"],
                    ["recent", "Recent"],
                  ].map(([id, label]) => (
                    <Row key={id} icon={<LayoutGrid size={18} />} title={label} description={settings.homeSections.includes(id) ? "Visible on Home" : "Hidden from Home"} trailing={<Toggle checked={settings.homeSections.includes(id)} onChange={(checked) => updateSettings({ homeSections: checked ? [...settings.homeSections, id] : settings.homeSections.filter((item) => item !== id) })} label={label} />} />
                  ))}
                  <p className="eyebrow">Section order</p>
                  {settings.homeSectionOrder.filter((sectionId) => !["netBalance", "totals", "trend", "categories", "insight"].includes(sectionId)).map((sectionId, index, visibleOrder) => {
                    const label = sectionId.replace(/([A-Z])/g, " $1").replace(/^./, (value) => value.toUpperCase());
                    return (
                      <div className="kupit-section-order-row" key={sectionId}>
                        <b>{label}</b>
                        <span>
                          <button type="button" disabled={index === 0} onClick={() => {
                            const next = [...visibleOrder];
                            [next[index - 1], next[index]] = [next[index], next[index - 1]];
                            updateSettings({ homeSectionOrder: next });
                          }} aria-label={`Move ${label} up`}>Up</button>
                          <button type="button" disabled={index === visibleOrder.length - 1} onClick={() => {
                            const next = [...visibleOrder];
                            [next[index], next[index + 1]] = [next[index + 1], next[index]];
                            updateSettings({ homeSectionOrder: next });
                          }} aria-label={`Move ${label} down`}>Down</button>
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
              {detail === "help" && <p>Kupit keeps your accounts, transactions, budgets, and reports in one place. Use the + button to log income or an expense, open Wallet to manage accounts, and open Plan to set spending limits.</p>}
              {detail === "statement" && <p>The other-app CSV import is not available yet. You can export transactions to CSV or restore a Kupit JSON backup from the Backup section.</p>}
              {detail === "privacy" && <p>Kupit stores your budget data in IndexedDB on this device. Google sign-in is optional and does not turn on data sync; cloud sync is currently off. Local backup files are created only when you export them. Kupit does not sell your personal budget data.</p>}
              {detail === "whats-new" && <p><b>Version 0.0.1</b><br />The Settings page now includes theme, app color, language, currency, privacy, local backups, and data reset controls.</p>}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
