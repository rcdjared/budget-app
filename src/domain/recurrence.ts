import type { Recurring } from "@/domain/types";
import { dateKeyFromParts } from "@/lib/format";

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
      return dateKeyFromParts(target.getUTCFullYear(), target.getUTCMonth() + 1, Math.min(startDay, lastDay));
    }
    const targetYear = year + 1;
    const lastDay = new Date(Date.UTC(targetYear, startMonth, 0)).getUTCDate();
    return dateKeyFromParts(targetYear, startMonth, Math.min(startDay, lastDay));
  }

  return dateKeyFromParts(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}
