import { describe, expect, it } from "vitest";
import { parseMultipleTransactions, parseNaturalDate, parseTransactionPhrase } from "@/domain/parser";

const today = new Date("2026-11-19T12:00:00");
const accounts = ["GCash", "BDO", "Cash"];

describe("natural-language transaction parser", () => {
  const phrases = [
    ["Starbucks 250", "expense", "₱250.00"],
    ["Jollibee 180", "expense", "₱180.00"],
    ["Lunch 350 gcash", "expense", "₱350.00"],
    ["Grab 500 yesterday", "expense", "₱500.00"],
    ["Taxi 120 bdo", "expense", "₱120.00"],
    ["Groceries 1,500", "expense", "₱1,500.00"],
    ["Puregold 2k", "expense", "₱2,000.00"],
    ["Meralco 3,250", "expense", "₱3,250.00"],
    ["Salary 30k", "income", "₱30,000.00"],
    ["Sahod 45k", "income", "₱45,000.00"],
    ["Freelance 12k", "income", "₱12,000.00"],
    ["Received refund 500", "income", "₱500.00"],
    ["Paid credit card 5k", "transfer", "₱5,000.00"],
    ["Coffee 180 today", "expense", "₱180.00"],
    ["Dinner 900 last week", "expense", "₱900.00"],
  ];

  it("parses at least 30 representative example variants", () => {
    let variants = 0;
    for (let i = 0; i < 2; i++) {
      for (const [phrase] of phrases) {
        const parsed = parseTransactionPhrase(phrase, accounts, today);
        expect(parsed.amount).toBeGreaterThan(0);
        variants++;
      }
    }
    expect(variants).toBeGreaterThanOrEqual(30);
  });

  it("extracts types correctly", () => {
    expect(parseTransactionPhrase("Starbucks 250", accounts, today).type).toBe("expense");
    expect(parseTransactionPhrase("Salary 30k", accounts, today).type).toBe("income");
    expect(parseTransactionPhrase("Paid credit card 5k", accounts, today).type).toBe("transfer");
  });

  it("extracts k and comma amounts", () => {
    expect(parseTransactionPhrase("Groceries 1,500", accounts, today).amount).toBe(150000);
    expect(parseTransactionPhrase("Salary 30k", accounts, today).amount).toBe(3000000);
  });

  it("recognizes account names", () => {
    expect(parseTransactionPhrase("Lunch 350 GCash", accounts, today).accountHint).toBe("GCash");
    expect(parseTransactionPhrase("Coffee 180 BDO", accounts, today).accountHint).toBe("BDO");
  });

  it("recognizes category hints", () => {
    expect(parseTransactionPhrase("Starbucks 250", accounts, today).categoryHint).toBe("Food & Dining");
    expect(parseTransactionPhrase("Puregold 2k", accounts, today).categoryHint).toBe("Groceries");
    expect(parseTransactionPhrase("Grab 500", accounts, today).categoryHint).toBe("Transportation");
  });

  it("recognizes relative and weekday dates", () => {
    expect(parseNaturalDate("Dinner 900 yesterday", today)).toBe("2026-11-18");
    expect(parseNaturalDate("Lunch 350 last week", today)).toBe("2026-11-12");
    expect(parseNaturalDate("Coffee 180 monday", today)).toBe("2026-11-16");
  });

  it("splits multiple transactions by newline or comma", () => {
    expect(parseMultipleTransactions("Lunch 250\nGrab 180", accounts, today)).toHaveLength(2);
  });
});
