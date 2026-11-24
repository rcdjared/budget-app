import { describe, expect, it } from "vitest";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/db/seed";
import { DEFAULT_EXPENSE_CATEGORIES, DEFAULT_INCOME_CATEGORIES } from "../lexicon/defaults";
import { parseKupiDates } from "./dates";
import { rankFuzzyMatches } from "./fuzzy";
import { extractMoneyCandidates } from "./numbers";
import { normalizeKupiInput } from "./normalize";

describe("Kupi text foundations", () => {
  it("normalizes peso spellings while preserving original token offsets", () => {
    const result = normalizeKupiInput("PHP 1,200.50 pesos P50 p50 myphp 80");

    expect(result.text).toBe("₱ 1,200.50 ₱ ₱50 ₱50 myphp 80");
    const currencyTokens = result.tokens.filter(({ kind }) => kind === "currency");
    expect(currencyTokens.map(({ value }) => value)).toEqual(["₱", "₱", "₱", "₱"]);
    for (const token of result.tokens) {
      expect(result.original.slice(token.start, token.end)).not.toBe("");
    }
  });

  it("extracts numeric and Tagalog amounts as integer centavos", () => {
    const input = "spent ₱1,234.50, p50, PHP 1.5k, limang daan, apat na daan";
    const result = extractMoneyCandidates(input);

    expect(result.candidates.map(({ amountCentavos, source }) => ({ amountCentavos, source }))).toEqual([
      { amountCentavos: 123450, source: "numeric" },
      { amountCentavos: 5000, source: "numeric" },
      { amountCentavos: 150000, source: "numeric" },
      { amountCentavos: 50000, source: "tagalog" },
      { amountCentavos: 40000, source: "tagalog" },
    ]);
    for (const candidate of result.candidates) {
      expect(input.slice(candidate.start, candidate.end)).toBe(candidate.raw);
      expect(Number.isSafeInteger(candidate.amountCentavos)).toBe(true);
    }
  });

  it("filters date, time, quantity, merchant digits, negatives, and unsafe magnitudes", () => {
    const result = extractMoneyCandidates(
      "2 jeep ₱50 at 7pm on 2026-11-24, 7-Eleven ₱30, -₱40, -   60, ₱90071992547409.92"
    );

    expect(result.candidates.map(({ amountCentavos }) => amountCentavos)).toEqual([5000, 3000]);
    expect(result.ambiguities.map(({ kind }) => kind)).toEqual([
      "quantity", "time", "date", "merchant_digit", "negative", "negative", "huge_amount",
    ]);
  });

  it("does not mistake explicit item counts for money", () => {
    const result = extractMoneyCandidates("bought 3 pcs and 2x shampoo");

    expect(result.candidates).toEqual([]);
    expect(result.ambiguities.map(({ kind }) => kind)).toEqual(["quantity", "quantity"]);
  });

  it("uses the Manila calendar for relative dates and flags ambiguity or future dates", () => {
    const now = new Date("2026-11-24T02:00:00+08:00");
    const parsed = parseKupiDates("last Monday, last Friday, tomorrow, kanina", now);

    expect(parsed.map(({ raw, date, alternatives, flags }) => ({ raw, date, alternatives, flags }))).toEqual([
      { raw: "last Monday", date: "2026-11-23", alternatives: ["2026-11-16"], flags: [] },
      { raw: "last Friday", date: "2026-11-20", alternatives: [], flags: [] },
      { raw: "tomorrow", date: "2026-11-25", alternatives: [], flags: ["future_date"] },
      { raw: "kanina", date: "2026-11-24", alternatives: ["2026-11-23"], flags: ["midnight_date"] },
    ]);
  });

  it("uses the injected Manila hour at the late-night boundary", () => {
    const beforeCutoff = parseKupiDates("kanina", new Date("2026-11-23T19:59:00Z"))[0];
    const atCutoff = parseKupiDates("kanina", new Date("2026-11-23T20:00:00Z"))[0];

    expect(beforeCutoff).toMatchObject({
      date: "2026-11-24",
      alternatives: ["2026-11-23"],
      ambiguous: true,
    });
    expect(atCutoff).toMatchObject({ date: "2026-11-24", alternatives: [], ambiguous: false });
  });

  it("parses Tagalog relative dates and skips invalid calendar dates", () => {
    const now = new Date("2026-11-24T12:00:00+08:00");

    expect(parseKupiDates("bukas", now)[0]).toMatchObject({
      date: "2026-11-25",
      flags: ["future_date"],
    });
    expect(parseKupiDates("2026-02-31", now)).toEqual([]);
    expect(parseKupiDates("in 2 days and next Friday", now).map(({ date, flags }) => ({ date, flags }))).toEqual([
      { date: "2026-11-26", flags: ["future_date"] },
      { date: "2026-11-27", flags: ["future_date"] },
    ]);
  });

  it("ranks bounded fuzzy matches against supplied live candidates", () => {
    const candidates = [
      { id: "cash", name: "Cash / Wallet", aliases: ["cash", "wallet"] },
      { id: "gcash", name: "GCash", aliases: ["g cash"] },
      { id: "food", name: "Food" },
      { id: "shopee", name: "Shopee" },
    ];

    expect(rankFuzzyMatches("gcas", candidates).map(({ candidate, matchedAlias }) => ({
      id: candidate.id,
      matchedAlias,
    }))).toEqual([{ id: "gcash", matchedAlias: "GCash" }]);
    expect(rankFuzzyMatches("shpoee", candidates)[0]).toMatchObject({
      candidate: { id: "shopee" },
      distance: 1,
    });
    expect(rankFuzzyMatches("x".repeat(129), candidates)).toEqual([]);
  });

  it("keeps typed defaults aligned with the app's seeded categories", () => {
    expect(DEFAULT_EXPENSE_CATEGORIES).toEqual(EXPENSE_CATEGORIES.map(({ name }) => name));
    expect(DEFAULT_INCOME_CATEGORIES).toEqual(INCOME_CATEGORIES.map(({ name }) => name));
  });

  it("keeps fixed malformed inputs from producing invalid money values or spans", () => {
    for (const input of ["", "₱", "-₱0.01", "12,34", "100.999", "999999999999999999999999", "2026-02-31 at 10am"]) {
      const { candidates } = extractMoneyCandidates(input);
      for (const candidate of candidates) {
        expect(Number.isSafeInteger(candidate.amountCentavos)).toBe(true);
        expect(candidate.start).toBeGreaterThanOrEqual(0);
        expect(candidate.end).toBeLessThanOrEqual(input.length);
        expect(input.slice(candidate.start, candidate.end)).toBe(candidate.raw);
      }
    }
  });
});
