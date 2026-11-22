import type { Budget, Category } from "@/domain/types";

export type SpendingPulsePeriod = "day" | "week" | "month" | "sevenDays";
export type SpendingPulseMood = "calm" | "smug" | "shook" | "proud" | "sleepy" | "side-eye";
export type SpendingPulseTone = "gentle" | "playful" | "roast";

export interface SpendingPulseBar {
  date: string;
  label: string;
  amount: number;
  highlighted: boolean;
  future: boolean;
}

export interface SpendingPulseStats {
  total: number;
  previousTotal: number;
  changePercent: number | null;
  change: "more" | "less" | "same" | "new";
  todayTotal: number;
  averagePreviousSevenDays: number;
  budgetCycleSpent: number;
  budgetCycleLimit: number;
  hasExpenseHistory: boolean;
  elapsedDays: number;
  bars: SpendingPulseBar[];
}

export interface SpendingPulseInsight {
  mood: SpendingPulseMood;
  text: string;
}

export interface GetInsightsInput {
  stats: SpendingPulseStats;
  categories: Category[];
  budgets: Budget[];
  now: Date;
  tone: SpendingPulseTone;
}
