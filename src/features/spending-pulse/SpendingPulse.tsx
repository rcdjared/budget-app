import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { formatSpendingDate } from "./periods";
import { useSpendingPulse } from "./useSpendingPulse";
import type { SpendingPulseLanguage, SpendingPulsePeriod, SpendingPulseTone } from "./types";
import "./spending-pulse.css";

const PERIODS: { id: SpendingPulsePeriod; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "sevenDays", label: "7 days" },
];

interface SeenInsight {
  text: string;
  seenAt: number;
}

const SEEN_INSIGHT_WINDOW = 7 * 24 * 60 * 60 * 1000;

function readSeenInsights(profileId: string): SeenInsight[] {
  try {
    const saved = localStorage.getItem(`kupit-spending-pulse-insights-${profileId}`);
    if (!saved) return [];
    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SeenInsight =>
      typeof item === "object"
      && item !== null
      && "text" in item
      && typeof item.text === "string"
      && "seenAt" in item
      && typeof item.seenAt === "number"
    );
  } catch (error) {
    console.error("Could not load recent Spending Pulse insights.", error);
    return [];
  }
}

function formatPeso(centavos: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(centavos / 100);
}

function periodCaption(period: SpendingPulsePeriod, today: string): string {
  if (period === "day") return `Spent today · ${formatSpendingDate(today, { month: "short", day: "numeric" })}`;
  if (period === "week") return "Spent this week";
  if (period === "month") return "Spent this budget cycle";
  return "Spent in the last 7 days";
}

export interface SpendingPulseProps {
  profileId: string;
  accountId: string;
  accountFilter: ReactNode;
  period: SpendingPulsePeriod;
  onPeriodChange: (period: SpendingPulsePeriod) => void;
  budgetCycleStartDay: number;
  weekStartsOn: number;
  tone: SpendingPulseTone;
  language: SpendingPulseLanguage;
  reduceMotion: boolean;
}

export function SpendingPulse({
  profileId,
  accountId,
  accountFilter,
  period,
  onPeriodChange,
  budgetCycleStartDay,
  weekStartsOn,
  tone,
  language,
  reduceMotion,
}: SpendingPulseProps) {
  const [seen, setSeen] = useState<SeenInsight[]>(() => readSeenInsights(profileId));
  const { stats, insights, now } = useSpendingPulse({
    profileId,
    accountId,
    period,
    budgetCycleStartDay,
    weekStartsOn,
    tone,
    language,
  });
  const today = useMemo(() => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now), [now]);
  const freshInsights = useMemo(
    () => insights.filter((insight) => !seen.some((item) => item.text === insight.text && now.getTime() - item.seenAt < SEEN_INSIGHT_WINDOW)),
    [insights, seen, now]
  );
  const insight = freshInsights[0] || insights[0];
  const comparisonPeriod = period === "day"
    ? "yesterday"
    : period === "week"
      ? "last week"
      : period === "month"
        ? "last budget cycle"
        : "the previous 7 days";
  const changeText = stats.change === "more"
    ? `${stats.changePercent ?? 0}% more vs ${comparisonPeriod}`
    : stats.change === "less"
      ? `${stats.changePercent ?? 0}% less vs ${comparisonPeriod}`
      : stats.change === "new"
        ? "New spend vs no spend"
        : stats.total === 0
          ? "No spend in either period"
          : `0% vs ${comparisonPeriod}`;

  useEffect(() => {
    setSeen(readSeenInsights(profileId));
  }, [profileId]);

  useEffect(() => {
    if (!insight || seen.some((item) => item.text === insight.text && now.getTime() - item.seenAt < SEEN_INSIGHT_WINDOW)) return;
    const nextSeen = [...seen, { text: insight.text, seenAt: now.getTime() }]
      .filter((item) => now.getTime() - item.seenAt < SEEN_INSIGHT_WINDOW)
      .slice(-100);
    try {
      localStorage.setItem(`kupit-spending-pulse-insights-${profileId}`, JSON.stringify(nextSeen));
    } catch (error) {
      console.error("Could not save recent Spending Pulse insights.", error);
    }
    setSeen(nextSeen);
  }, [insight, seen, now, profileId]);

  const selectPeriod = (nextPeriod: SpendingPulsePeriod) => {
    onPeriodChange(nextPeriod);
  };

  const maxAmount = Math.max(1, ...stats.bars.map((bar) => bar.amount));
  const reduceMotionActive = reduceMotion
    || (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  return (
    <section
      className="spending-pulse-widget"
      aria-label="Spending Pulse"
      data-reduce-motion={reduceMotionActive}
    >
      <div className="spending-pulse__insight-row">
        {accountFilter}
      </div>

      <div className="spending-pulse">
        <div className="spending-pulse__tabs-shell">
          <div className="spending-pulse__tabs" role="group" aria-label="Spending period">
            <span
              className="spending-pulse__thumb"
              style={{ transform: `translateX(${PERIODS.findIndex((item) => item.id === period) * 100}%)` }}
              aria-hidden="true"
            />
            {PERIODS.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={period === item.id}
                onClick={() => selectPeriod(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="spending-pulse__summary">
          <div className="spending-pulse__total">
            <span className="spending-pulse__eyebrow">{periodCaption(period, today)}</span>
            <strong>{formatPeso(stats.total)}</strong>
            <span className={`spending-pulse__comparison spending-pulse__comparison--${stats.change}`}>
              {stats.change === "more" ? "↑" : stats.change === "less" ? "↓" : "·"}
              <span>{changeText}</span>
            </span>
          </div>

          <div
            className="spending-pulse__chart"
            role="img"
            aria-label={`Spending chart for ${PERIODS.find((item) => item.id === period)?.label}`}
          >
            <div className="spending-pulse__bars">
              {stats.bars.map((bar) => (
                <span className="spending-pulse__bar-slot" key={bar.date}>
                  <span
                    className={[
                      "spending-pulse__bar",
                      bar.highlighted ? "is-highlighted" : "",
                      bar.future ? "is-future" : "",
                    ].filter(Boolean).join(" ")}
                    style={{ height: bar.future ? 5 : `${Math.max(5, (bar.amount / maxAmount) * 46)}px` }}
                  />
                </span>
              ))}
            </div>
            <div className="spending-pulse__labels" aria-hidden="true">
              {stats.bars.map((bar) => (
                <span key={bar.date}>{bar.label}</span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
