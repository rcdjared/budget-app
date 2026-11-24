export const EMBEDDING_CACHE_NAME = "kupit-kupi-e5-v1";
export const EMBEDDING_MODEL_DOWNLOAD_LABEL = "About 118 MB, plus tokenizer and runtime files";

type WorkerResponse = { id: number; ok?: boolean; vectors?: number[][]; error?: string; progress?: number; status?: string; file?: string };
type Pending = { resolve: (value: WorkerResponse) => void; reject: (reason: Error) => void; onProgress?: (progress: number, status: string) => void; timer?: number };

let worker: Worker | undefined;
let requestId = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL("./embedding.worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const response = event.data;
    const task = pending.get(response.id);
    if (!task) return;
    if (response.progress !== undefined) {
      task.onProgress?.(response.progress, response.status ?? "Loading model");
      return;
    }
    pending.delete(response.id);
    if (task.timer !== undefined) window.clearTimeout(task.timer);
    if (!response.ok) task.reject(new Error(response.error ?? "Embedding model failed."));
    else task.resolve(response);
  };
  worker.onerror = () => {
    for (const task of pending.values()) {
      task.reject(new Error("Embedding worker failed."));
      if (task.timer !== undefined) window.clearTimeout(task.timer);
    }
    pending.clear();
    worker?.terminate();
    worker = undefined;
  };
  return worker;
}

function request(type: "load" | "embed", texts: string[] = [], onProgress?: (progress: number, status: string) => void): Promise<WorkerResponse> {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      const task = pending.get(id);
      if (!task) return;
      pending.delete(id);
      task.reject(new Error("Embedding model timed out."));
      worker?.terminate();
      worker = undefined;
    }, 300_000);
    pending.set(id, { resolve, reject, onProgress, timer });
    getWorker().postMessage({ id, type, texts });
  });
}

export async function loadEmbeddingModel(onProgress?: (progress: number, status: string) => void): Promise<void> {
  await request("load", [], onProgress);
}

export async function isEmbeddingModelCached(): Promise<boolean> {
  if (typeof caches === "undefined") return false;
  try {
    const cache = await caches.open(EMBEDDING_CACHE_NAME);
    const keys = await cache.keys();
    return keys.some(({ url }) => url.includes("Xenova/multilingual-e5-small") && /model_quantized\.onnx(?:$|\?)/u.test(url));
  } catch {
    return false;
  }
}

export async function embedQueries(texts: string[], onProgress?: (progress: number, status: string) => void): Promise<number[][]> {
  if (!texts.length) return [];
  const response = await request("embed", texts.map((text) => `query: ${text}`), onProgress);
  if (!response.vectors) throw new Error("Embedding model returned no vectors.");
  return response.vectors;
}

export async function embedPassages(texts: string[], onProgress?: (progress: number, status: string) => void): Promise<number[][]> {
  if (!texts.length) return [];
  const response = await request("embed", texts.map((text) => `passage: ${text}`), onProgress);
  if (!response.vectors) throw new Error("Embedding model returned no vectors.");
  return response.vectors;
}

export function unloadEmbeddingModel(): void {
  worker?.terminate();
  worker = undefined;
  for (const task of pending.values()) {
    task.reject(new Error("Embedding worker stopped."));
    if (task.timer !== undefined) window.clearTimeout(task.timer);
  }
  pending.clear();
}

export async function deleteEmbeddingModel(): Promise<void> {
  unloadEmbeddingModel();
  if (typeof caches !== "undefined") await caches.delete(EMBEDDING_CACHE_NAME);
  if (typeof indexedDB !== "undefined") {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase("kupit-kupi-embeddings");
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  }
}
