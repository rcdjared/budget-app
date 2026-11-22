// Money utilities — the #1 rule: store as integer centavos, format only at the edge.
//
// WHY integers? Floats cause rounding errors:
//   0.1 + 0.2 === 0.30000000000000004  (wrong)
//   10 + 20 === 30                      (correct)
//
// So ₱1,234.56 is stored as 123456 centavos.

/** Convert a human amount (e.g. 1234.56) to integer centavos */
export function toCentavos(amount: number): number {
  // Math.round handles floating-point edge cases like 19.99 * 100 = 1998.9999...
  return Math.round(amount * 100);
}

/** Convert centavos back to a decimal number (for display math only) */
export function fromCentavos(centavos: number): number {
  return centavos / 100;
}

/** Format centavos as a currency string: 123456 → "₱1,234.56" */
export function formatMoney(
  centavos: number,
  currency: string = "PHP"
): string {
  let showDecimals = true;
  try {
    showDecimals = JSON.parse(localStorage.getItem("kupit-app-settings") || "{}").showDecimals !== false;
  } catch {
    showDecimals = true;
  }
  const fractionDigits = showDecimals ? 2 : 0;
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(fromCentavos(centavos));
}

/** Format centavos as a compact string without currency symbol: 123456 → "1,234.56" */
export function formatAmount(centavos: number): string {
  return new Intl.NumberFormat("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(fromCentavos(centavos));
}

/**
 * Parse a user-typed money string to centavos.
 * Handles: "1234.56", "1,234.56", "1234", "1.5k", "30k", "₱500"
 */
export function parseMoney(input: string): number {
  let cleaned = input.trim();

  // Strip currency symbols
  cleaned = cleaned.replace(/[₱$,\s]/g, "");

  // Handle "k" suffix (e.g., "30k" = 30,000, "1.5k" = 1,500)
  if (/k$/i.test(cleaned)) {
    const num = parseFloat(cleaned.slice(0, -1));
    if (isNaN(num)) return 0;
    return toCentavos(num * 1000);
  }

  // Handle "m" suffix (e.g., "1.5m" = 1,500,000)
  if (/m$/i.test(cleaned)) {
    const num = parseFloat(cleaned.slice(0, -1));
    if (isNaN(num)) return 0;
    return toCentavos(num * 1_000_000);
  }

  const num = parseFloat(cleaned);
  if (isNaN(num)) return 0;
  return toCentavos(num);
}

/** Sum any number of centavo amounts */
export function addMoney(...amounts: number[]): number {
  return amounts.reduce((sum, a) => sum + a, 0);
}

/** Subtract b from a (both in centavos) */
export function subtractMoney(a: number, b: number): number {
  return a - b;
}

/** Absolute value of centavos */
export function absMoney(centavos: number): number {
  return Math.abs(centavos);
}

/** Check if an amount is negative */
export function isNegative(centavos: number): boolean {
  return centavos < 0;
}

