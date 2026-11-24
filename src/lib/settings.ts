import { NOTIFICATION_THRESHOLDS } from "@/lib/notificationsConfig";
import type { NotificationPreferences } from "@/domain/types";

export type { NotificationPreferences } from "@/domain/types";

export type ThemePreference = "system" | "light" | "dark" | "amoled";
export type LanguagePreference = "en" | "fil";
export type SpendingPulseTone = "gentle" | "playful" | "roast";

export interface AppSettings {
  schemaVersion: 3;
  language: LanguagePreference;
  theme: ThemePreference;
  accentColor: string;
  accentName: string;
  currency: string;
  showDecimals: boolean;
  haptics: boolean;
  budgetCycleStartDay: number;
  weekStartsOn: number;
  reduceMotion: boolean;
  spendingPulseTone: SpendingPulseTone;
  netWorthAccountIds: string[];
  shakeToUndo: boolean;
  biometricUnlock: boolean;
  cloudBackup: boolean;
  homeSections: string[];
  homeSectionOrder: string[];
  quickActions: string[];
  includeFriendReceivables: boolean;
  notifications: NotificationPreferences;
  kupiPersonality: "chill" | "classic" | "dramatic";
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  enabled: false,
  reminderTime: NOTIFICATION_THRESHOLDS.dailyCheckIn,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  categories: {
    dailyCheckIn: true,
    budgetAlerts: true,
    recurring: true,
    debts: true,
    goals: true,
    receivables: true,
  },
};

export const DEFAULT_SETTINGS: AppSettings = {
  schemaVersion: 3,
  language: "en",
  theme: "system",
  accentColor: "#019B51",
  accentName: "Kupit Green",
  currency: "PHP",
  showDecimals: true,
  haptics: true,
  budgetCycleStartDay: 1,
  weekStartsOn: 0,
  reduceMotion: false,
  spendingPulseTone: "playful",
  netWorthAccountIds: [],
  shakeToUndo: false,
  biometricUnlock: false,
  cloudBackup: false,
  homeSections: ["categories", "budgets", "upcoming", "recent"],
  homeSectionOrder: ["categories", "budgets", "upcoming", "recent"],
  quickActions: ["expense", "income", "transfer", "scan"],
  includeFriendReceivables: true,
  notifications: DEFAULT_NOTIFICATION_PREFERENCES,
  kupiPersonality: "classic",
};

const STORAGE_KEY = "kupit-app-settings";

export function loadAppSettings(): AppSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as {
      schemaVersion?: number;
    } & Partial<Omit<AppSettings, "schemaVersion">>;
    if (parsed.schemaVersion === 1 || parsed.schemaVersion === 2 || parsed.schemaVersion === 3) {
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        schemaVersion: 3,
        notifications: {
          ...DEFAULT_NOTIFICATION_PREFERENCES,
          ...parsed.notifications,
          categories: {
            ...DEFAULT_NOTIFICATION_PREFERENCES.categories,
            ...parsed.notifications?.categories,
          },
        },
      };
    }
  } catch {
    // Fall back to defaults when saved settings are malformed.
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveAppSettings(settings: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...settings, schemaVersion: 3 }));
}
