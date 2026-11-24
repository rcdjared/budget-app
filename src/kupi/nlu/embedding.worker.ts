import { env, pipeline } from "@huggingface/transformers";

const MODEL = "Xenova/multilingual-e5-small";
const CACHE_KEY = "kupit-kupi-e5-v1";
type FeatureExtractor = (texts: string[], options: { pooling: "mean"; normalize: true }) => Promise<{ tolist: () => number[][] }>;
let extractor: FeatureExtractor | undefined;

type Request = { id: number; type: "load" | "embed" | "unload"; texts?: string[] };

self.onmessage = async (event: MessageEvent<Request>) => {
  const { id, type, texts = [] } = event.data;
  try {
    if (type === "unload") {
      extractor = undefined;
      self.postMessage({ id, ok: true });
      return;
    }
    env.cacheKey = CACHE_KEY;
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    if (!extractor) {
      extractor = await pipeline("feature-extraction", MODEL, {
        dtype: "q8",
        progress_callback: (progress: { status?: string; progress?: number; file?: string }) => {
          self.postMessage({ id, progress: progress.progress ?? 0, status: progress.status ?? "Loading model", file: progress.file });
        },
      }) as unknown as FeatureExtractor;
    }
    if (type === "load") {
      self.postMessage({ id, ok: true });
      return;
    }
    const output = await extractor(texts, { pooling: "mean", normalize: true });
    self.postMessage({ id, ok: true, vectors: output.tolist() });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : "Embedding model failed." });
  }
};
