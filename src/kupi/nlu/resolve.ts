import type { KupiDbSnapshot, ParseResult, SessionContext } from "../contracts";
import { parseKupiInput } from "../parser/parseKupiInput";
import { clearProfileEmbeddingIndex, suggestSemanticMatch, type SemanticSuggestion } from "./intentIndex";
import { parseWithLocalLlm } from "./llmParser";
import { detectSmartCapability } from "./capability";
import { isEmbeddingModelCached, unloadEmbeddingModel } from "./embedder";
import { isLocalLlmModelCached, unloadLocalLlm } from "./llmParser";

export interface ResolveOptions {
  smartAssist?: boolean;
  smartMode?: boolean;
  modelSize?: "0.6B" | "1.7B";
  onProgress?: (progress: number, status: string) => void;
}

export interface ResolveResult {
  result: ParseResult;
  suggestion?: SemanticSuggestion;
  source: "rules" | "embedding" | "llm";
}

export function releaseNluResources(): void {
  clearProfileEmbeddingIndex();
  unloadEmbeddingModel();
  unloadLocalLlm();
}

function isConfident(result: ParseResult): boolean {
  return result.tier !== "ask" && result.intent !== "UNKNOWN" && result.intent !== "CLARIFY";
}

export async function resolveWithFallback(
  text: string,
  context: SessionContext,
  snapshot: KupiDbSnapshot,
  now: Date,
  options: ResolveOptions = {},
): Promise<ResolveResult> {
  const result = parseKupiInput(text, context, snapshot, now);
  if ((!options.smartAssist && !options.smartMode) || isConfident(result)) return { result, source: "rules" };
  const transactionLike = ["LOG_EXPENSE", "LOG_INCOME", "TRANSFER", "EDIT_TXN", "DELETE_TXN"].includes(result.intent)
    || /\b(?:log|record|spent|spend|paid|bought|buy|expense|income|received|transfer|sent|earned|transaction)\b/iu.test(text);
  if (!transactionLike) return { result, source: "rules" };

  const fallback = async (): Promise<ResolveResult> => {
    const [embeddingCached, llmCached] = await Promise.all([
      options.smartAssist ? isEmbeddingModelCached() : Promise.resolve(false),
      options.smartMode ? isLocalLlmModelCached(options.modelSize ?? "0.6B") : Promise.resolve(false),
    ]);
    if (!embeddingCached && !llmCached) return { result, source: "rules" };
    let suggestion: SemanticSuggestion | undefined;
    if (options.smartAssist && embeddingCached) {
      try {
        suggestion = await suggestSemanticMatch(text, snapshot, options.onProgress);
      } catch {
        // Optional inference must fail closed to the deterministic parser.
      }
    }
    if (options.smartMode && llmCached && (await detectSmartCapability(options.modelSize ?? "0.6B")).supported) {
      const modelResult = await parseWithLocalLlm(text, context, snapshot, options.modelSize ?? "0.6B", { onProgress: options.onProgress });
      clearProfileEmbeddingIndex();
      if (modelResult) return { result: modelResult, suggestion, source: "llm" };
    }
    return { result, suggestion, source: suggestion ? "embedding" : "rules" };
  };

  // The rules parser always wins when optional on-device inference is slow.
  // Cached models can still take time to initialize on mobile, so cap the wait.
  return new Promise<ResolveResult>((resolve) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      releaseNluResources();
      resolve({ result, source: "rules" });
    }, 5_000);
    void fallback().then((resolved) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(resolved);
    }).catch(() => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      releaseNluResources();
      resolve({ result, source: "rules" });
    });
  });
}
