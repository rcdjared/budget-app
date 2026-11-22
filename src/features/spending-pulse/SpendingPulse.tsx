import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { formatSpendingDate } from "./periods";
import { Kupi } from "./Kupi";
import { useSpendingPulse } from "./useSpendingPulse";
import type { SpendingPulsePeriod, SpendingPulseTone } from "./types";
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
  reduceMotion,
}: SpendingPulseProps) {
  const [seen, setSeen] = useState<SeenInsight[]>(() => readSeenInsights(profileId));
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [hop, setHop] = useState(0);
  const { stats, insights, now } = useSpendingPulse({
    profileId,
    accountId,
    period,
    budgetCycleStartDay,
    weekStartsOn,
    tone,
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
  const insight = insights.find((item) => item.text === selectedText)
    || freshInsights[0];
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
    setSelectedText(null);
  }, [profileId]);

  useEffect(() => {
    if (!selectedText || !insights.some((item) => item.text === selectedText)) {
      setSelectedText(freshInsights[0]?.text || null);
    }
  }, [selectedText, freshInsights, insights]);

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
    setSelectedText(null);
  };

  const showNextInsight = () => {
    if (!insights.length) return;
    const seenTexts = new Set(seen
      .filter((item) => now.getTime() - item.seenAt < SEEN_INSIGHT_WINDOW)
      .map((item) => item.text));
    if (insight) seenTexts.add(insight.text);
    const nextInsight = insights.find((item) => !seenTexts.has(item.text));
    if (!nextInsight) return;
    setSelectedText(nextInsight.text);
    setHop((count) => count + 1);
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
        <button
          type="button"
          className="spending-pulse__insight"
          aria-label="Show another insight from Kupi"
          disabled={freshInsights.length === 0}
          onClick={showNextInsight}
        >
          <span className={`spending-pulse__mascot-wrap ${hop ? "is-hopping" : ""}`} key={hop}>
            <Kupi mood={insight?.mood ?? "calm"} size={48} />
          </span>
          <span className="spending-pulse__bubble">
            <span className="spending-pulse__speaker">Kupi</span>
            <span className="spending-pulse__message" aria-live="polite">
              {insight?.text || "You've heard all my takes for now. Check back later."}
            </span>
            <span className="spending-pulse__bubble-footer">
              <span className="spending-pulse__dots" aria-hidden="true">
                {Array.from({ length: Math.min(3, Math.max(1, insights.length)) }, (_, index) => (
                  <i className={index === (selectedText ? insights.findIndex((item) => item.text === selectedText) : 0) % 3 ? "" : "active"} key={index} />
                ))}
              </span>
              <span>Tap for another take</span>
            </span>
          </span>
          <span className="spending-pulse__hop" key={hop} aria-hidden="true" />
        </button>
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
