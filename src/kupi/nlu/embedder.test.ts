import { afterEach, describe, expect, it, vi } from "vitest";
import { EMBEDDING_CACHE_NAME, isEmbeddingModelCached } from "./embedder";

afterEach(() => vi.unstubAllGlobals());

describe("embedding model install status", () => {
  it("recognizes the quantized multilingual E5 weights in its versioned cache", async () => {
    const keys = vi.fn().mockResolvedValue([
      { url: "https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/onnx/model_quantized.onnx" },
      { url: "https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/tokenizer.json" },
    ]);
    vi.stubGlobal("caches", { open: vi.fn().mockResolvedValue({ keys }) });
    await expect(isEmbeddingModelCached()).resolves.toBe(true);
    expect(caches.open).toHaveBeenCalledWith(EMBEDDING_CACHE_NAME);
  });

  it("does not report a model installed when only tokenizer files are cached", async () => {
    vi.stubGlobal("caches", {
      open: vi.fn().mockResolvedValue({ keys: async () => [{ url: "https://huggingface.co/Xenova/multilingual-e5-small/resolve/main/tokenizer.json" }] }),
    });
    await expect(isEmbeddingModelCached()).resolves.toBe(false);
  });
});
