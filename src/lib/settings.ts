export type ThemePreference = "system" | "light" | "dark" | "amoled";
export type LanguagePreference = "en" | "fil";

export interface AppSettings {
  schemaVersion: 1;
  language: LanguagePreference;
  theme: ThemePreference;
  accentColor: string;
  accentName: string;
  currency: string;
  showDecimals: boolean;
  haptics: boolean;
  budgetCycleStartDay: number;
  netWorthAccountIds: string[];
  shakeToUndo: boolean;
  biometricUnlock: boolean;
  cloudBackup: boolean;
  homeSections: string[];
  quickActions: string[];
  includeFriendReceivables: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 1,
  language: "en",
  theme: "system",
  accentColor: "#019B51",
  accentName: "Kupit Green",
  currency: "PHP",
  showDecimals: true,
  haptics: true,
  budgetCycleStartDay: 1,
  netWorthAccountIds: [],
  shakeToUndo: false,
  biometricUnlock: false,
  cloudBackup: false,
  homeSections: ["net-worth", "budgets", "recent", "insights"],
  quickActions: ["expense", "income", "transfer", "scan"],
  includeFriendReceivables: true,
};

const STORAGE_KEY = "kupit-app-settings";

export function loadAppSettings(): AppSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<AppSettings>;
    if (parsed.schemaVersion === 1) {
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // Fall back to defaults when saved settings are malformed.
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveAppSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
