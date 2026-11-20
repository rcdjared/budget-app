import type { Recurring } from "@/domain/types";

function dateFromParts(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function getNextOccurrenceDate(rule: Pick<Recurring, "frequency" | "startDate" | "customIntervalDays">, currentDate: string): string {
  const [year, month, day] = currentDate.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day));

  if (rule.frequency === "daily") next.setUTCDate(next.getUTCDate() + 1);
  else if (rule.frequency === "weekly") next.setUTCDate(next.getUTCDate() + 7);
  else if (rule.frequency === "biweekly") next.setUTCDate(next.getUTCDate() + 14);
  else if (rule.frequency === "custom") next.setUTCDate(next.getUTCDate() + (rule.customIntervalDays || 1));
  else {
    const [startYear, startMonth, startDay] = rule.startDate.split("-").map(Number);
    if (rule.frequency === "monthly") {
      const target = new Date(Date.UTC(year, month, 1));
      const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      return dateFromParts(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(startDay, lastDay));
    }
    const targetYear = year + 1;
    const lastDay = new Date(Date.UTC(targetYear, startMonth, 0)).getUTCDate();
    return dateFromParts(targetYear, startMonth, Math.min(startDay, lastDay));
  }

  return dateFromParts(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}
