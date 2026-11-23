import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/db/seed";
import { parseMultipleTransactions, parseTransactionPhrase, type ParsedTransaction } from "@/domain/parser";

interface ParserExample {
  msg: string;
  learnedCategories?: Record<string, string>;
  expect: {
    type?: ParsedTransaction["type"];
    amountCentavos?: number;
    categoryHint?: string | null;
    accountHint?: string | null;
    toAccountHint?: string | null;
    date?: string;
  };
}

interface CompoundExample {
  msg: string;
  expect: Array<Pick<ParsedTransaction, "categoryHint"> & { amountCentavos: number }>;
}

const trainingData = JSON.parse(
  readFileSync("kupi_seed_data.json", "utf8")
) as {
  example_account_names: string[];
  reference_default_categories: {
    expense: string[];
    income: string[];
  };
  parser_examples: ParserExample[];
  compound_examples: CompoundExample[];
};

const templateData = JSON.parse(
  readFileSync("kupi_templates.json", "utf8")
) as {
  moods: string[];
  templates: Array<{
    id: string;
    mood: string;
    intensity: number;
    language: string;
    vars: string[];
    text: string;
  }>;
};

const today = new Date("2026-11-24T12:00:00");

describe("Kupi's reviewed parser examples", () => {
  it("uses the current app's seeded category names", () => {
    expect(trainingData.reference_default_categories.expense).toEqual(EXPENSE_CATEGORIES.map(({ name }) => name));
    expect(trainingData.reference_default_categories.income).toEqual(INCOME_CATEGORIES.map(({ name }) => name));
  });

  it("matches the current parser and default category names", () => {
    expect(trainingData.parser_examples.length).toBeGreaterThanOrEqual(40);

    for (const example of trainingData.parser_examples) {
      const parsed = parseTransactionPhrase(
        example.msg,
        trainingData.example_account_names,
        today,
        example.learnedCategories
      );
      const expected = example.expect;

      if (expected.type !== undefined) expect(parsed.type, example.msg).toBe(expected.type);
      if (expected.amountCentavos !== undefined) expect(parsed.amount, example.msg).toBe(expected.amountCentavos);
      if ("categoryHint" in expected) expect(parsed.categoryHint, example.msg).toBe(expected.categoryHint);
      if ("accountHint" in expected) expect(parsed.accountHint, example.msg).toBe(expected.accountHint);
      if ("toAccountHint" in expected) expect(parsed.toAccountHint, example.msg).toBe(expected.toAccountHint);
      if (expected.date !== undefined) expect(parsed.date, example.msg).toBe(expected.date);
    }
  });

  it("splits reviewed English and Taglish compound messages correctly", () => {
    for (const example of trainingData.compound_examples) {
      const parsed = parseMultipleTransactions(example.msg, trainingData.example_account_names, today);
      expect(parsed).toHaveLength(example.expect.length);
      expect(parsed.map(({ amount, categoryHint }) => ({ amountCentavos: amount, categoryHint }))).toEqual(example.expect);
    }
  });

  it("keeps response templates fully described and free of unresolved variables", () => {
    const ids = new Set<string>();

    for (const template of templateData.templates) {
      expect(ids.has(template.id), template.id).toBe(false);
      ids.add(template.id);
      expect(templateData.moods, template.id).toContain(template.mood);
      expect([1, 2, 3], template.id).toContain(template.intensity);
      expect(["en", "tl", "en-tl"], template.id).toContain(template.language);

      const placeholders = [...new Set([...template.text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]))];
      expect(template.vars, template.id).toEqual(placeholders);

      const rendered = template.text.replace(/\{(\w+)\}/g, (_match, variable: string) => `sample_${variable}`);
      expect(rendered, template.id).not.toMatch(/\{\{|\{\w+\}|undefined|NaN/);
    }
  });
});
