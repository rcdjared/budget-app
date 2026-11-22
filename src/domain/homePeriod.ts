import { toDateString } from "@/lib/format";

export type HomePeriod = "day" | "week" | "month" | "year";

export interface HomePeriodRange {
  start: string;
  end: string;
  comparableStart: string;
  comparableEnd: string;
  inProgress: boolean;
  label: string;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function monthRange(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return { start, end };
}

export function getHomePeriodRange(period: HomePeriod, date = new Date(), locale = "en-US", now = new Date()): HomePeriodRange {
  let start: Date;
  let end: Date;
  if (period === "day") {
    start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    end = new Date(start);
  } else if (period === "week") {
    start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end = addDays(start, 6);
  } else if (period === "month") {
    ({ start, end } = monthRange(date));
  } else {
    start = new Date(date.getFullYear(), 0, 1);
    end = new Date(date.getFullYear(), 11, 31);
  }

  const nowKey = toDateString(now);
  const inProgress = toDateString(start) <= nowKey
    && nowKey <= toDateString(end)
    && toDateString(end) >= toDateString(start);

  let comparableStart: Date;
  let comparableEnd: Date;
  if (period === "day") {
    comparableStart = addDays(start, -1);
    comparableEnd = comparableStart;
  } else if (period === "week") {
    comparableStart = addDays(start, -7);
    const elapsed = inProgress ? ((date.getDay() + 6) % 7) + 1 : 7;
    comparableEnd = addDays(comparableStart, elapsed - 1);
  } else if (period === "month") {
    comparableStart = new Date(date.getFullYear(), date.getMonth() - 1, 1);
    if (inProgress) {
      const elapsedDay = date.getDate();
      comparableEnd = new Date(comparableStart);
      comparableEnd.setDate(Math.min(elapsedDay, new Date(comparableStart.getFullYear(), comparableStart.getMonth() + 1, 0).getDate()));
    } else {
      comparableEnd = new Date(date.getFullYear(), date.getMonth(), 0);
    }
  } else {
    comparableStart = new Date(date.getFullYear() - 1, 0, 1);
    if (inProgress) {
      comparableEnd = new Date(date.getFullYear() - 1, date.getMonth(), date.getDate());
    } else {
      comparableEnd = new Date(date.getFullYear() - 1, 11, 31);
    }
  }

  const label = period === "day"
    ? date.toLocaleDateString(locale, { month: "long", day: "numeric", year: "numeric" })
    : period === "week"
      ? `${start.toLocaleDateString(locale, { month: "short", day: "numeric" })} - ${end.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric" })}`
      : period === "month"
        ? date.toLocaleDateString(locale, { month: "long", year: "numeric" })
        : String(date.getFullYear());

  return {
    start: toDateString(start),
    end: toDateString(end),
    comparableStart: toDateString(comparableStart),
    comparableEnd: toDateString(comparableEnd),
    inProgress,
    label,
  };
}
