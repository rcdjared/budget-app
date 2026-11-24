import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KupiDbSnapshot, ParseResult, SessionContext } from "../contracts";

const mocks = vi.hoisted(() => ({
  parse: vi.fn<(...args: unknown[]) => ParseResult>(),
  suggest: vi.fn<(...args: unknown[]) => Promise<{ kind: "intent"; label: string; score: number } | undefined>>(),
  llm: vi.fn<(...args: unknown[]) => Promise<ParseResult | undefined>>(),
}));

vi.mock("../parser/parseKupiInput", () => ({ parseKupiInput: mocks.parse }));
vi.mock("./intentIndex", () => ({ suggestSemanticMatch: mocks.suggest, clearProfileEmbeddingIndex: vi.fn() }));
vi.mock("./llmParser", () => ({ parseWithLocalLlm: mocks.llm }));
vi.mock("./capability", () => ({ detectSmartCapability: async () => ({ webgpu: true, adapterAvailable: true, supported: true }) }));

import { resolveWithFallback } from "./resolve";

const result = (intent: ParseResult["intent"], tier: ParseResult["tier"]): ParseResult => ({
  intent, confidence: tier === "auto" ? 0.95 : 0.2, tier, alternatives: [], drafts: [], missing: [], flags: [],
});
const context: SessionContext = { recentTemplateIds: [], personality: "classic", rngSeed: 1 };
const snapshot: KupiDbSnapshot = { accounts: [{ name: "Cash" }], categories: [{ name: "Food" }], txns: [] };

describe("resolveWithFallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parse.mockReturnValue(result("CLARIFY", "fallback"));
    mocks.suggest.mockResolvedValue(undefined);
    mocks.llm.mockResolvedValue(undefined);
  });

  it("does not load models when assist is disabled or rules are confident", async () => {
    await resolveWithFallback("coffee", context, snapshot, new Date(), {});
    expect(mocks.suggest).not.toHaveBeenCalled();
    mocks.parse.mockReturnValue(result("LOG_EXPENSE", "confirm"));
    await resolveWithFallback("coffee", context, snapshot, new Date(), { smartAssist: true });
    expect(mocks.suggest).not.toHaveBeenCalled();
  });

  it("returns an embedding match as a hint without replacing the safe parser result", async () => {
    mocks.suggest.mockResolvedValue({ kind: "intent", label: "query stats", score: 0.9 });
    const resolved = await resolveWithFallback("what was it again", context, snapshot, new Date(), { smartAssist: true });
    expect(resolved.source).toBe("embedding");
    expect(resolved.suggestion?.label).toBe("query stats");
    expect(resolved.result.intent).toBe("CLARIFY");
    expect(resolved.result.drafts).toEqual([]);
  });

  it("uses local LLM only after embeddings and keeps model writes in confirm tier", async () => {
    const modelResult = { ...result("LOG_EXPENSE", "confirm"), drafts: [{ type: "expense" as const, amount: { value: 100, source: "text" as const, confidence: 0.9 }, category: { value: "Food", source: "text" as const, confidence: 0.9 }, account: { value: "Cash", source: "text" as const, confidence: 0.9 } }] };
    mocks.llm.mockResolvedValue(modelResult);
    const resolved = await resolveWithFallback("food hundred cash", context, snapshot, new Date(), { smartMode: true });
    expect(mocks.suggest).toHaveBeenCalledOnce();
    expect(resolved.source).toBe("llm");
    expect(resolved.result.tier).toBe("confirm");
  });

  it("falls back to deterministic parser when optional inference fails", async () => {
    mocks.suggest.mockRejectedValue(new Error("offline"));
    const resolved = await resolveWithFallback("unrecognized", context, snapshot, new Date(), { smartAssist: true, smartMode: true });
    expect(resolved.source).toBe("rules");
    expect(resolved.result.intent).toBe("CLARIFY");
  });
});
