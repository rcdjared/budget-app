import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatEval, readEvalCases, runEval } from "./runEval";

export const HOLDOUT_VERSION = 1;
// Update only with an intentional HOLDOUT_VERSION bump and a newly reviewed holdout.
export const HOLDOUT_SHA256 = "130e2b95d731971ced0cf8b226e5ec6906e99b33c7fc4aa1c0c00d00fbe0a743";
const HOLDOUT_FILE = "src/kupi/__tests__/eval/holdout.jsonl";

describe("Kupi NLU frozen evaluation", () => {
  it("keeps the versioned holdout byte-for-byte frozen", () => {
    const bytes = readFileSync(resolve(process.cwd(), HOLDOUT_FILE));
    const hash = createHash("sha256").update(bytes).digest("hex");
    expect(hash, `Bump HOLDOUT_VERSION (${HOLDOUT_VERSION}) only when deliberately replacing this set`).toBe(HOLDOUT_SHA256);
  });

  it("has unique, labeled cases and reports the frozen baseline", () => {
    const cases = readEvalCases(HOLDOUT_FILE);
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(cases.map(({ id }) => id)).size).toBe(cases.length);
    for (const testCase of cases) {
      expect(testCase.turns.length, testCase.id).toBeGreaterThan(0);
      expect(testCase.tags.length, testCase.id).toBeGreaterThan(0);
      expect(["propose", "ask", "abstain", "answer"]).toContain(testCase.expect.behavior);
    }
    const metrics = runEval(HOLDOUT_FILE);
    console.info(`\n${formatEval(metrics)}`);
    expect(metrics.cases).toBe(cases.length);
  });

  it("also runs the development set used during tuning", () => {
    const metrics = runEval("src/kupi/__tests__/eval/dev.jsonl");
    console.info(`\n${formatEval(metrics)}`);
    expect(metrics.cases).toBeGreaterThan(0);
  });
});
