import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseKupiInput } from "../../parser/parseKupiInput";
import type { KupiDbSnapshot, ParseResult, SessionContext } from "../../contracts";

export type ExpectedBehavior = "propose" | "ask" | "abstain" | "answer";

export interface EvalCase {
  id: string;
  turns: string[];
  now?: string;
  context?: {
    lastTxn?: KupiDbSnapshot["txns"][number];
    focus?: SessionContext["focus"];
  };
  expect: {
    intent: string;
    behavior: ExpectedBehavior;
    amountCentavos?: number;
    category?: string | null;
    account?: string;
    toAccount?: string;
    date?: string;
    edit?: { field: string; value: string | number };
    query?: Record<string, unknown>;
  };
  tags: string[];
}

export interface EvalMetrics {
  file: string;
  cases: number;
  messages: number;
  intentAccuracy: number;
  slotExactMatch: number | null;
  falseWriteProposalRate: number;
  abstentionQuality: number | null;
  followUpCompletionRate: number | null;
  latencyMs: { p50: number; p95: number };
  failures: Array<{ id: string; expected: unknown; actual: unknown; issue: string[] }>;
}

const DEFAULT_NOW = "2026-11-24T12:00:00+08:00";
const SNAPSHOT: KupiDbSnapshot = {
  accounts: ["Cash / Wallet", "GCash", "Maya", "BDO", "GoTyme Bank", "Custom Savings"].map((name) => ({ name })),
  categories: [
    "Food", "Transport", "Bills", "Shopping", "Phone", "Fun", "Health", "Fees", "Salary",
    "Freelance & Side Gig", "Gifts & Cashbacks", "Other Income", "Rental Income",
    "Business & Sales", "Investments & Dividends", "Remittance & Padala Received",
  ].map((name) => ({ name })),
  txns: [],
};

function initialContext(): SessionContext {
  return { recentTemplateIds: [], personality: "classic", rngSeed: 1 };
}

function expectedSlotValues(result: ParseResult, expected: EvalCase["expect"]): boolean {
  const draft = result.drafts[0];
  if (expected.amountCentavos !== undefined && draft?.amount?.value !== expected.amountCentavos) return false;
  if (expected.category !== undefined && draft?.category?.value !== expected.category) return false;
  if (expected.account !== undefined && draft?.account?.value !== expected.account) return false;
  if (expected.toAccount !== undefined && draft?.toAccount?.value !== expected.toAccount) return false;
  if (expected.date !== undefined && draft?.date?.value !== expected.date) return false;
  if (expected.edit && (result.edit?.field !== expected.edit.field || result.edit.value !== expected.edit.value)) return false;
  if (expected.query && Object.entries(expected.query).some(([key, value]) =>
    JSON.stringify(result.query?.[key as keyof typeof result.query]) !== JSON.stringify(value)
  )) return false;
  return true;
}

function isWriteIntent(result: ParseResult): boolean {
  return ["LOG_EXPENSE", "LOG_INCOME", "TRANSFER", "EDIT_TXN", "DELETE_TXN"].includes(result.intent);
}

function wouldProposeWrite(result: ParseResult): boolean {
  // Match KupiChatSheet's gates: alternatives and target candidates render
  // clarification UI before proposeForResult is called.
  return isWriteIntent(result)
    && result.missing.length === 0
    && !result.alternatives.length
    && !result.targetCandidates?.length
    && !["ask", "fallback"].includes(result.tier);
}

function behaviorForResult(result: ParseResult): ExpectedBehavior {
  if (wouldProposeWrite(result)) return "propose";
  if (isWriteIntent(result)) return "ask";
  if (["QUERY_STATS", "CONFIRM", "CANCEL", "UNDO", "SMALLTALK", "HELP"].includes(result.intent)) return "answer";
  return "abstain";
}

function parseCase(testCase: EvalCase): { result: ParseResult; times: number[] } {
  if (!testCase.turns.length) throw new Error(`${testCase.id} has no turns`);
  const context = initialContext();
  context.focus = testCase.context?.focus;
  const snapshot: KupiDbSnapshot = {
    ...SNAPSHOT,
    txns: testCase.context?.lastTxn ? [testCase.context.lastTxn] : [],
  };
  if (testCase.context?.lastTxn) context.lastTxnId = testCase.context.lastTxn.id;
  const times: number[] = [];
  let result: ParseResult | undefined;

  for (const text of testCase.turns) {
    const start = performance.now();
    result = parseKupiInput(text, context, snapshot, new Date(testCase.now ?? DEFAULT_NOW));
    times.push(performance.now() - start);
    if (result.missing.length) {
      context.pending = {
        kind: "slot",
        slot: result.missing[0],
        intent: result.intent,
        draft: result.drafts[0],
      };
    } else if (wouldProposeWrite(result)) {
      context.pending = { kind: "confirmAction", intent: result.intent };
    } else {
      context.pending = undefined;
    }
    if (result.intent === "QUERY_STATS" && result.query) {
      context.focus = { ...context.focus, lastQuery: result.query, turnsRemaining: 6 };
    }
  }

  if (!result) throw new Error(`${testCase.id} did not produce a parse result`);
  return { result, times };
}

export function readEvalCases(file: string): EvalCase[] {
  const path = resolve(process.cwd(), file);
  return readFileSync(path, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim() && !line.trimStart().startsWith("#"))
    .map((line, index) => {
      try {
        return JSON.parse(line) as EvalCase;
      } catch (error) {
        throw new Error(`${file} line ${index + 1}: ${(error as Error).message}`);
      }
    });
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)].toFixed(3));
}

export function runEval(file: string): EvalMetrics {
  const cases = readEvalCases(file);
  const failures: EvalMetrics["failures"] = [];
  const latencies: number[] = [];
  let intentCorrect = 0;
  let slotCases = 0;
  let slotCorrect = 0;
  let falseWrites = 0;
  let expectedWriteCases = 0;
  let abstentionCases = 0;
  let abstentionCorrect = 0;
  let followUpCases = 0;
  let followUpCorrect = 0;
  let messages = 0;

  for (const testCase of cases) {
    const { result, times } = parseCase(testCase);
    latencies.push(...times);
    messages += testCase.turns.length;
    const sameIntent = result.intent === testCase.expect.intent;
    const sameSlots = expectedSlotValues(result, testCase.expect);
    const proposed = wouldProposeWrite(result);
    const expectedWrite = testCase.expect.behavior === "propose";
    const abstentionExpected = ["ask", "abstain"].includes(testCase.expect.behavior);
    const abstained = !proposed;
    const issue: string[] = [];

    if (sameIntent) intentCorrect++;
    if (Object.keys(testCase.expect).some((key) => key.endsWith("Centavos") || ["category", "account", "toAccount", "date", "edit", "query"].includes(key))) {
      slotCases++;
      if (sameSlots) slotCorrect++;
    }
    expectedWriteCases++;
    if (proposed && (!expectedWrite || !sameIntent || !sameSlots)) falseWrites++;
    if (abstentionExpected) {
      abstentionCases++;
      if (abstained && sameIntent) abstentionCorrect++;
    }
    if (testCase.turns.length > 1) {
      followUpCases++;
      if (sameIntent && sameSlots && behaviorForResult(result) === testCase.expect.behavior) followUpCorrect++;
    }

    if (!sameIntent) issue.push(`intent ${result.intent} != ${testCase.expect.intent}`);
    if (!sameSlots) issue.push("one or more expected slots differ");
    if (proposed !== expectedWrite && expectedWrite) issue.push("expected a write proposal but parser did not produce one");
    if (proposed && abstentionExpected) issue.push("unexpected write proposal for expected ask/abstain");
    if (issue.length) failures.push({ id: testCase.id, expected: testCase.expect, actual: result, issue });
  }

  return {
    file,
    cases: cases.length,
    messages,
    intentAccuracy: cases.length ? intentCorrect / cases.length : 0,
    slotExactMatch: slotCases ? slotCorrect / slotCases : null,
    falseWriteProposalRate: expectedWriteCases ? falseWrites / expectedWriteCases : 0,
    abstentionQuality: abstentionCases ? abstentionCorrect / abstentionCases : null,
    followUpCompletionRate: followUpCases ? followUpCorrect / followUpCases : null,
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95) },
    failures,
  };
}

export function formatEval(metrics: EvalMetrics): string {
  const pct = (value: number | null) => value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
  return [
    `[Kupi eval] ${metrics.file}: ${metrics.cases} cases, ${metrics.messages} turns`,
    `intent accuracy: ${pct(metrics.intentAccuracy)}`,
    `slot exact-match: ${pct(metrics.slotExactMatch)}`,
    `false-write proposal rate: ${pct(metrics.falseWriteProposalRate)}`,
    `abstention quality: ${pct(metrics.abstentionQuality)}`,
    `follow-up completion: ${pct(metrics.followUpCompletionRate)}`,
    `parser latency: p50 ${metrics.latencyMs.p50} ms / p95 ${metrics.latencyMs.p95} ms`,
    `failures: ${metrics.failures.map(({ id, issue }) => `${id}: ${issue.join(", ")}`).join("; ") || "none"}`,
  ].join("\n" );
}
