// Date and currency formatting utilities

import { format, isToday, isYesterday } from "date-fns";

/**
 * Format a date for display.
 * Uses the user's local timezone (which we assume is Asia/Manila).
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "MMM d, yyyy");
}

/** Format as "Today", "Yesterday", or "Nov 15" */
export function formatRelativeDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "MMM d");
}

/** Format a full date with time */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "MMM d, yyyy h:mm a");
}

/** Format date as ISO date string (YYYY-MM-DD) for storage */
export function toDateString(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** Get the first and last day of a month */
export function getMonthRange(year: number, month: number): {
  start: string;
  end: string;
} {
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0); // Last day of month
  return {
    start: toDateString(start),
    end: toDateString(end),
  };
}

/** Get current month range */
export function getCurrentMonthRange(): { start: string; end: string } {
  const now = new Date();
  return getMonthRange(now.getFullYear(), now.getMonth());
}

/** Re-export formatMoney from domain/money */
export { formatMoney, formatAmount } from "@/domain/money";

