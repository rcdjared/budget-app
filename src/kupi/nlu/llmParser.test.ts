import { describe, expect, it, vi } from "vitest";
import type { KupiDbSnapshot } from "../contracts";
import { validateModelResult } from "./llmParser";

vi.mock("./embedder", () => ({
  embedPassages: async (texts: string[]) => texts.map(() => [1, 0]),
  embedQueries: async () => [[1, 0]],
  unloadEmbeddingModel: vi.fn(),
}));

const snapshot: KupiDbSnapshot = {
  accounts: [{ name: "Cash" }, { name: "Maya" }],
  categories: [{ name: "Food" }, { name: "Salary" }],
  txns: [],
};

describe("validateModelResult", () => {
  it("accepts a fully resolved write only as a confirm-tier draft", () => {
    const result = validateModelResult({
      intent: "LOG_EXPENSE", confidence: 0.91, amountCentavos: 18000, category: "Food", account: "Cash",
    }, snapshot);
    expect(result?.tier).toBe("confirm");
    expect(result?.drafts[0]?.amount?.value).toBe(18000);
    expect(result?.drafts[0]?.category?.value).toBe("Food");
  });

  it("rejects unresolved names, unsafe amounts, and low-confidence output", () => {
    expect(validateModelResult({ intent: "LOG_EXPENSE", confidence: 0.9, amountCentavos: 100, category: "Unknown", account: "Cash" }, snapshot)).toBeUndefined();
    expect(validateModelResult({ intent: "LOG_EXPENSE", confidence: 0.9, amountCentavos: 1.5, category: "Food", account: "Cash" }, snapshot)).toBeUndefined();
    expect(validateModelResult({ intent: "LOG_EXPENSE", confidence: 0.4, amountCentavos: 100, category: "Food", account: "Cash" }, snapshot)).toBeUndefined();
  });

  it("does not accept a transfer with the same source and destination", () => {
    expect(validateModelResult({ intent: "TRANSFER", confidence: 0.9, amountCentavos: 100, account: "Cash", toAccount: "Cash" }, snapshot)).toBeUndefined();
  });

  it("returns stat query structure without computing any amounts", () => {
    const result = validateModelResult({ intent: "QUERY_STATS", confidence: 0.9, metric: "total", period: "last_month", typeFilter: "expense" }, snapshot);
    expect(result?.query).toEqual({ metric: "total", period: "last_month", filters: { type: "expense" } });
    expect(result?.drafts).toEqual([]);
  });

  it("times out a non-responsive local worker and fails closed", async () => {
    class SilentWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage() { /* Deliberately leave the request unresolved. */ }
      terminate() { /* Simulate stopping a stuck model worker. */ }
    }
    vi.stubGlobal("Worker", SilentWorker);
    const { parseWithLocalLlm } = await import("./llmParser");
    const context = { recentTemplateIds: [], personality: "classic" as const, rngSeed: 1 };
    await expect(parseWithLocalLlm("test", context, snapshot, "0.6B", { loadTimeoutMs: 5 })).resolves.toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("warms and then releases the local model worker for a settings download", async () => {
    let terminated = false;
    class ReadyWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(message: { id: number }) {
        queueMicrotask(() => {
          this.onmessage?.({ data: { id: message.id, ready: true } } as MessageEvent);
          this.onmessage?.({ data: { id: message.id, ok: true } } as MessageEvent);
        });
      }
      terminate() { terminated = true; }
    }
    vi.stubGlobal("Worker", ReadyWorker);
    const { warmLocalLlm } = await import("./llmParser");
    await warmLocalLlm("0.6B");
    expect(terminated).toBe(true);
    vi.unstubAllGlobals();
  });
});
