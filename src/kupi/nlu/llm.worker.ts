import { CreateMLCEngine, type MLCEngine } from "@mlc-ai/web-llm";

let engine: MLCEngine | undefined;
let modelId = "";
const MODEL_IDS: Record<string, string> = {
  "0.6B": "Qwen3-0.6B-q4f16_1-MLC",
  "1.7B": "Qwen3-1.7B-q4f16_1-MLC",
};

self.onmessage = async (event: MessageEvent<{ id: number; type: "parse" | "load" | "unload"; modelSize?: "0.6B" | "1.7B"; prompt?: string }>) => {
  const { id, type } = event.data;
  try {
    if (type === "unload") {
      await engine?.unload();
      engine = undefined;
      modelId = "";
      self.postMessage({ id, ok: true });
      return;
    }
    const selectedId = MODEL_IDS[event.data.modelSize ?? "0.6B"];
    if (engine && modelId !== selectedId) {
      await engine.unload();
      engine = undefined;
    }
    if (!engine) {
      modelId = selectedId;
      engine = await CreateMLCEngine(selectedId, {
        initProgressCallback: (progress) => self.postMessage({ id, progress: progress.progress, status: progress.text }),
      });
    }
    self.postMessage({ id, ready: true });
    if (type === "load") {
      self.postMessage({ id, ok: true });
      return;
    }
    const response = await engine.chat.completions.create({
      messages: [{ role: "user", content: event.data.prompt ?? "{}" }],
      model: selectedId,
      temperature: 0,
      max_tokens: 384,
      response_format: { type: "json_object", schema: JSON.stringify({
        type: "object",
        additionalProperties: false,
        required: ["intent", "confidence"],
        properties: {
          intent: { type: "string", enum: ["LOG_EXPENSE", "LOG_INCOME", "TRANSFER", "QUERY_STATS", "CLARIFY"] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          amountCentavos: { type: "integer", minimum: 1 },
          category: { type: "string" },
          account: { type: "string" },
          toAccount: { type: "string" },
          date: { type: "string" },
          metric: { type: "string", enum: ["total", "by_category", "top_category", "biggest_expense", "count", "daily_average", "remaining_budget", "safe_to_spend", "vs_last_period", "net_worth"] },
          period: { type: "string", enum: ["today", "yesterday", "this_week", "last_week", "this_month", "last_month"] },
          typeFilter: { type: "string", enum: ["expense", "income"] },
        },
      }) },
    });
    self.postMessage({ id, ok: true, content: response.choices[0]?.message.content ?? "" });
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : "Smart mode failed." });
  }
};
