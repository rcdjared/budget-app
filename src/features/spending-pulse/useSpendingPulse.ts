import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/db/schema";
import { profileRecords } from "@/db/profileScope";
import type { Budget, Category, Transaction } from "@/domain/types";
import { getSpendingPulseStats, type SpendingPulseOptions } from "./periods";
import type { SpendingPulsePeriod, SpendingPulseStats, SpendingPulseTone } from "./types";
import { getInsights } from "./insights";

export interface UseSpendingPulseOptions extends SpendingPulseOptions {
  profileId: string;
  accountId: string;
  period: SpendingPulsePeriod;
  tone: SpendingPulseTone;
}

export interface UseSpendingPulseResult {
  stats: SpendingPulseStats;
  categories: Category[];
  insights: ReturnType<typeof getInsights>;
  now: Date;
}

export function useSpendingPulse({
  profileId,
  accountId,
  period,
  budgetCycleStartDay,
  weekStartsOn,
  tone,
}: UseSpendingPulseOptions): UseSpendingPulseResult {
  const [now, setNow] = useState(() => new Date());
  const transactions = useLiveQuery(
    () => profileRecords(db.transactions, profileId)
      .filter((transaction) => accountId === "all" || transaction.accountId === accountId)
      .toArray(),
    [profileId, accountId],
    [] as Transaction[]
  );
  const categories = useLiveQuery(
    () => profileRecords(db.categories, profileId).filter((category) => !category.deletedAt).toArray(),
    [profileId],
    [] as Category[]
  );
  const budgets = useLiveQuery(
    () => profileRecords(db.budgets, profileId).filter((budget) => !budget.deletedAt).toArray(),
    [profileId],
    [] as Budget[]
  );
  const options = useMemo(() => ({ budgetCycleStartDay, weekStartsOn }), [budgetCycleStartDay, weekStartsOn]);
  const stats = useMemo(
    () => getSpendingPulseStats(period, transactions, now, options, budgets, categories),
    [period, transactions, now, options, budgets, categories]
  );
  const insights = useMemo(
    () => getInsights({ stats, categories, budgets: accountId === "all" ? budgets : [], now, tone }),
    [stats, categories, budgets, now, tone, accountId]
  );

  useEffect(() => {
    const refresh = () => setNow(new Date());
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  return { stats, categories, insights, now };
}
