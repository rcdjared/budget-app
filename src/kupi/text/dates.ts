import { KUPI_CONFIG } from "../contracts";

export type DateParseFlag = "future_date" | "midnight_date";

export interface ParsedDateMention {
  date: string;
  alternatives: string[];
  start: number;
  end: number;
  raw: string;
  ambiguous: boolean;
  flags: DateParseFlag[];
}

interface ManilaNow {
  date: Date;
  hour: number;
}

interface DateMatch {
  start: number;
  end: number;
  raw: string;
  resolve: (now: ManilaNow) => { dates: string[]; ambiguous: boolean; flags: DateParseFlag[] };
}

const TIME_ZONE = "Asia/Manila";
const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const WEEKDAYS: Record<string, number> = {
  sunday: 0, linggo: 0,
  monday: 1, lunes: 1,
  tuesday: 2, martes: 2,
  wednesday: 3, miyerkules: 3,
  thursday: 4, huwebes: 4,
  friday: 5, biyernes: 5,
  saturday: 6, sabado: 6,
};

function getManilaNow(now: Date): ManilaNow {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Kupi date parsing requires a valid injected date.");
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  const hour = Number(values.hour);
  return { date: new Date(Date.UTC(year, month - 1, day)), hour };
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, count: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + count);
  return result;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function futureFlags(dates: string[], today: Date): DateParseFlag[] {
  return dates.some((date) => date > dateKey(today)) ? ["future_date"] : [];
}

function addPatternMatches(
  input: string,
  pattern: RegExp,
  resolve: (match: RegExpMatchArray, now: ManilaNow) => { dates: string[]; ambiguous?: boolean; flags?: DateParseFlag[] },
  matches: DateMatch[]
): void {
  pattern.lastIndex = 0;
  for (const match of input.matchAll(pattern)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    matches.push({
      start,
      end,
      raw: match[0],
      resolve: (now) => {
        const result = resolve(match, now);
        return { dates: result.dates, ambiguous: result.ambiguous ?? false, flags: result.flags ?? [] };
      },
    });
  }
}

function getDateMatches(input: string): DateMatch[] {
  const matches: DateMatch[] = [];

  addPatternMatches(input, /\b20\d{2}-\d{1,2}-\d{1,2}\b/giu, (match) => {
    const [year, month, day] = match[0].split("-").map(Number);
    const value = validDate(year, month, day);
    return { dates: value ? [value] : [] };
  }, matches);

  addPatternMatches(input, /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/giu, (match, now) => {
    const year = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : now.date.getUTCFullYear();
    const value = validDate(year, Number(match[1]), Number(match[2]));
    return { dates: value ? [value] : [] };
  }, matches);

  addPatternMatches(
    input,
    /\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,\s*(\d{4}))?\b/giu,
    (match, now) => {
      const month = MONTHS[match[1].toLowerCase()];
      const year = match[3] ? Number(match[3]) : now.date.getUTCFullYear();
      const value = validDate(year, month, Number(match[2]));
      return { dates: value ? [value] : [] };
    },
    matches
  );

  addPatternMatches(input, /\b(\d+)\s+(days?|weeks?)\s+ago\b/giu, (match, now) => {
    const days = Number(match[1]) * (/^week/i.test(match[2]) ? 7 : 1);
    if (!Number.isSafeInteger(days) || days > 100_000_000) return { dates: [] };
    const date = addDays(now.date, -days);
    return Number.isFinite(date.getTime()) ? { dates: [dateKey(date)] } : { dates: [] };
  }, matches);

  addPatternMatches(input, /\b(?:in\s+(\d+)\s+(days?|weeks?)|(\d+)\s+(days?|weeks?)\s+from\s+now)\b/giu, (match, now) => {
    const count = Number(match[1] ?? match[3]);
    const unit = match[2] ?? match[4];
    const days = count * (/^week/i.test(unit) ? 7 : 1);
    if (!Number.isSafeInteger(days) || days > 100_000_000) return { dates: [] };
    const date = addDays(now.date, days);
    return Number.isFinite(date.getTime()) ? { dates: [dateKey(date)] } : { dates: [] };
  }, matches);

  addPatternMatches(input, /\b(?:today|ngayon|this morning|tonight|kanina|yesterday|kahapon|last night|kagabi|tomorrow|bukas)\b/giu, (match, now) => {
    const phrase = match[0].toLowerCase();
    if (phrase === "kanina" && now.hour < KUPI_CONFIG.lateNightCutoffHour) {
      const dates = [dateKey(now.date), dateKey(addDays(now.date, -1))];
      return { dates, ambiguous: true, flags: ["midnight_date"] };
    }
    if (["yesterday", "kahapon", "last night", "kagabi"].includes(phrase)) {
      return { dates: [dateKey(addDays(now.date, -1))] };
    }
    if (phrase === "tomorrow" || phrase === "bukas") {
      const dates = [dateKey(addDays(now.date, 1))];
      return { dates, flags: ["future_date"] };
    }
    return { dates: [dateKey(now.date)] };
  }, matches);

  addPatternMatches(input, /\blast week\b/giu, (_match, now) => ({
    dates: [dateKey(addDays(now.date, -7))],
  }), matches);

  addPatternMatches(input, /\blast month\b/giu, (_match, now) => {
    const year = now.date.getUTCFullYear();
    const month = now.date.getUTCMonth() + 1;
    const previousMonth = month === 1 ? 12 : month - 1;
    const previousYear = month === 1 ? year - 1 : year;
    const day = Math.min(now.date.getUTCDate(), daysInMonth(previousYear, previousMonth));
    const date = validDate(previousYear, previousMonth, day);
    return { dates: date ? [date] : [] };
  }, matches);

  addPatternMatches(input, /\b(last|next|nung|noong)?\s*(sunday|monday|tuesday|wednesday|thursday|friday|saturday|linggo|lunes|martes|miyerkules|huwebes|biyernes|sabado)\b/giu, (match, now) => {
    const weekday = WEEKDAYS[match[2].toLowerCase()];
    const prefix = match[1]?.toLowerCase();
    if (prefix === "next") {
      const distance = (weekday - now.date.getUTCDay() + 7) % 7 || 7;
      return { dates: [dateKey(addDays(now.date, distance))] };
    }
    const distance = (now.date.getUTCDay() - weekday + 7) % 7;
    if (distance === 0) {
      return { dates: [dateKey(addDays(now.date, -7))], ambiguous: true };
    }
    const nearest = addDays(now.date, -distance);
    const isLast = prefix === "last";
    if (isLast && distance === 1) {
      const dates = [dateKey(nearest), dateKey(addDays(nearest, -7))];
      return { dates, ambiguous: true };
    }
    return { dates: [dateKey(nearest)] };
  }, matches);

  const sorted = matches.sort((a, b) => a.start - b.start || b.end - a.end);
  const nonOverlapping: DateMatch[] = [];
  for (const match of sorted) {
    if (!nonOverlapping.some((previous) => match.start < previous.end && match.end > previous.start)) {
      nonOverlapping.push(match);
    }
  }
  return nonOverlapping;
}

/** Parse all supported date mentions against an injected instant in Asia/Manila. */
export function parseKupiDates(input: string, now: Date): ParsedDateMention[] {
  const manilaNow = getManilaNow(now);
  return getDateMatches(input).flatMap((match) => {
    const result = match.resolve(manilaNow);
    if (!result.dates.length) return [];
    const flags = new Set<DateParseFlag>([...result.flags, ...futureFlags(result.dates, manilaNow.date)]);
    return [{
      date: result.dates[0],
      alternatives: result.dates.slice(1),
      start: match.start,
      end: match.end,
      raw: match.raw,
      ambiguous: result.ambiguous,
      flags: [...flags],
    }];
  });
}
