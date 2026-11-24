import { beforeEach, describe, expect, it, vi } from "vitest";

const mockVectors = vi.hoisted(() => ({
  queries: vi.fn<(...args: unknown[]) => Promise<number[][]>>(),
  passages: vi.fn<(...args: unknown[]) => Promise<number[][]>>(),
}));

vi.mock("./embedder", () => ({
  embedQueries: mockVectors.queries,
  embedPassages: mockVectors.passages,
}));

import { clearProfileEmbeddingIndex, EMBEDDING_SUGGESTION_THRESHOLD, suggestSemanticMatch } from "./intentIndex";

const snapshot = (category: string, account: string) => ({
  categories: [{ name: category }], accounts: [{ name: account, aliases: [account.toLowerCase()] }], txns: [],
});

describe("semantic Kupi suggestion index", () => {
  beforeEach(() => {
    clearProfileEmbeddingIndex();
    vi.clearAllMocks();
    mockVectors.queries.mockResolvedValue([[1, 0]]);
    mockVectors.passages.mockImplementation(async (texts) => (texts as string[]).map(() => [1, 0]));
  });

  it("returns a high-similarity suggestion above the configured threshold", async () => {
    const suggestion = await suggestSemanticMatch("some paraphrase", snapshot("Food", "Cash"));
    expect(suggestion).toBeDefined();
    expect(suggestion?.score).toBeGreaterThanOrEqual(EMBEDDING_SUGGESTION_THRESHOLD);
  });

  it("abstains below threshold", async () => {
    mockVectors.queries.mockResolvedValue([[0, 1]]);
    const suggestion = await suggestSemanticMatch("unrelated text", snapshot("Food", "Cash"));
    expect(suggestion).toBeUndefined();
  });

  it("rebuilds user entity vectors when the active profile changes", async () => {
    await suggestSemanticMatch("query", snapshot("Food", "Cash"));
    await suggestSemanticMatch("query", snapshot("Health", "Maya"));
    const indexedTexts = mockVectors.passages.mock.calls.map(([texts]) => texts as string[]);
    expect(indexedTexts.some((items) => items.includes("category: Health") && items.includes("account: Maya"))).toBe(true);
    expect(indexedTexts.some((items) => items.includes("category: Food") && items.includes("account: Cash"))).toBe(true);
  });
});
