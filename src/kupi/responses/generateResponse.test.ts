import { describe, expect, it } from "vitest";
import type { Template } from "../contracts";
import { computeMood, generateResponse, renderTemplate, type ResponseFacts } from "./generateResponse";
import { RESPONSE_TEMPLATES } from "./responseTemplates";

describe("Kupi response generation", () => {
  const allFacts = Object.fromEntries(
    [...new Set(RESPONSE_TEMPLATES.flatMap((template) => template.vars))].map((key) => [key, key])
  ) as ResponseFacts;

  it("uses mood thresholds, personality caps, and a quiet sensitive-intent ceiling", () => {
    expect(computeMood({ intent: "LOG_EXPENSE", catPercent: 79 }, "dramatic"))
      .toMatchObject({ mood: "idle", intensity: 1 });
    expect(computeMood({ intent: "LOG_EXPENSE", catPercent: 80 }, "dramatic"))
      .toMatchObject({ mood: "worried", intensity: 2, tags: ["near_budget"] });
    expect(computeMood({ intent: "LOG_EXPENSE", catPercent: 101 }, "chill"))
      .toMatchObject({ mood: "worried", intensity: 1, tags: ["over_budget"] });
    expect(computeMood({ intent: "LOG_INCOME" }, "chill"))
      .toMatchObject({ mood: "happy", intensity: 1 });
    expect(computeMood({ intent: "DELETE_TXN", catPercent: 110 }, "dramatic"))
      .toMatchObject({ mood: "idle", intensity: 1 });
    expect(computeMood({ intent: "QUERY_STATS", catPercent: 20 }))
      .toMatchObject({ mood: "idle", intensity: 1 });
    expect(computeMood({ intent: "PROACTIVE", todayExpenseAmounts: [4_999, 3_000, 1_000] }, "classic"))
      .toMatchObject({ mood: "idle", intensity: 2, tags: ["micro_spend"] });
    expect(computeMood({ intent: "PROACTIVE", todayExpenseAmounts: [5_000, 4_999] }, "classic").tags)
      .not.toContain("micro_spend");
  });

  it("produces varied deterministic responses without reusing any of the last five IDs", () => {
    let recentTemplateIds: string[] = [];
    let rngSeed = 42;
    const ids: string[] = [];
    for (let turn = 0; turn < 20; turn += 1) {
      const result = generateResponse({
        state: { intent: "LOG_EXPENSE" },
        language: "en",
        personality: "classic",
        facts: allFacts,
        recentTemplateIds,
        rngSeed,
      });
      expect(result).not.toBeNull();
      if (!result) throw new Error("Expected an eligible Kupi response template.");
      expect(recentTemplateIds.slice(-5)).not.toContain(result.templateId);
      expect(result.text).not.toMatch(/\{\{|\{[A-Za-z_]\w*\}|\b(?:undefined|NaN)\b/u);
      ids.push(result.templateId);
      recentTemplateIds = result.recentTemplateIds;
      rngSeed = result.rngSeed;
    }
    expect(new Set(ids).size).toBeGreaterThan(1);
  });

  it("rejects missing and non-finite facts instead of leaking placeholders", () => {
    const template: Template = {
      id: "test",
      intent: "LOG_EXPENSE",
      mood: "idle",
      intensity: 1,
      language: "en",
      vars: ["amount"],
      text: "₱{amount}",
    };
    expect(() => renderTemplate(template, {})).toThrow('missing fact "amount"');
    expect(() => renderTemplate(template, { amount: Number.NaN })).toThrow("must be finite");
  });

  it("never reuses a template when the entire eligible pool is in the repeat window", () => {
    const onlyTemplate: Template = {
      id: "help-only",
      intent: "HELP",
      mood: "idle",
      intensity: 1,
      language: "en",
      vars: [],
      text: "Help.",
    };
    const result = generateResponse({
      state: { intent: "HELP" },
      language: "en",
      personality: "classic",
      facts: {},
      recentTemplateIds: ["help-only"],
      rngSeed: 5,
      templates: [onlyTemplate],
    });
    expect(result).toBeNull();
  });
});
