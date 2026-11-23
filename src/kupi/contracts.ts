/** Integer centavos (₱1 = 100). Never use floats for money. */
export type Centavos = number;

export type KupiIntent =
  | "LOG_EXPENSE" | "LOG_INCOME" | "TRANSFER" | "EDIT_TXN" | "DELETE_TXN"
  | "QUERY_STATS" | "CONFIRM" | "CANCEL" | "UNDO" | "SMALLTALK" | "HELP"
  | "CLARIFY" | "UNKNOWN";

/** Intents that only exist on the response side (templates, nudges). */
export type ResponseIntent = KupiIntent | "SLOT_FILL" | "DISAMBIGUATE" | "ERROR" | "UNSUPPORTED" | "PROACTIVE";

/** Confidence zones. auto >= 0.85, confirm 0.50-0.85, ask = missing/ambiguous slot, fallback < 0.50. */
export type Tier = "auto" | "confirm" | "ask" | "fallback";

export type Mood = "happy" | "worried" | "idle";
export type Intensity = 1 | 2 | 3;
export type Language = "en" | "tl" | "en-tl";

/** All thresholds live here. Tune in Phase 9 from calibration data, never inline. */
export const KUPI_CONFIG = {
  confidence: { auto: 0.85, confirm: 0.5 },
  mood: {
    happyBelowBudgetPct: 60,
    worriedAtBudgetPct: 80,
    overBudgetPct: 100,
    bigExpensePctOfBudget: 40,
    microSpendMax: 5000 as Centavos,
    microSpendCount: 3,
  },
  dialogue: { maxQuestions: 2, antiRepeatWindow: 5, undoStackCap: 20, futureDateMaxDays: 0 },
  fuzzy: { minimumAliasScore: 0.78, maximumCandidateLength: 128 },
  parser: {
    explicitCueConfidence: 0.93,
    inferredCueConfidence: 0.87,
    ambiguousCueConfidence: 0.72,
    fallbackConfidence: 0.2,
    hugeAmountCentavos: 100_000_000 as Centavos,
    maximumQuantityCount: 10,
  },
  perf: { parserP95Ms: 20 },
  /** Before this local hour, "kanina" can refer to the previous calendar day. */
  lateNightCutoffHour: 4,
} as const;

/** Where a slot value came from. The confirm card must show non-"text" sources. */
export type SlotSource = "text" | "default" | "learned" | "context" | "fuzzy";

export interface Slot<T> {
  value: T;
  source: SlotSource;
  /** [start, end) offsets in the ORIGINAL input string. */
  span?: [number, number];
  confidence: number;
  alternatives?: T[];
}

export type ParseFlag =
  | "future_date" | "quantity" | "huge_amount" | "libre" | "same_account"
  | "target_not_found" | "interrupts_pending" | "trailing_account_scope"
  | "trailing_date_scope" | "ambiguous_baon" | "ambiguous_padala" | "midnight_date";

export interface DraftTxn {
  type: "expense" | "income" | "transfer";
  amount?: Slot<Centavos>;
  category?: Slot<string | null>;
  account?: Slot<string>;
  toAccount?: Slot<string>;
  date?: Slot<string>; // YYYY-MM-DD in Asia/Manila
  note?: string;
  fee?: Slot<Centavos>;
}

export interface StatsQuery {
  metric:
    | "total" | "by_category" | "top_category" | "biggest_expense" | "count"
    | "daily_average" | "remaining_budget" | "safe_to_spend" | "vs_last_period" | "net_worth";
  groupBy?: "category" | "account" | "day";
  period?: "today" | "yesterday" | "this_week" | "last_week" | "this_month" | "last_month" | { from: string; to: string };
  filters?: { category?: string; account?: string; type?: "expense" | "income"; text?: string };
}

export interface KupiTxnSnapshot {
  id: string;
  amountCentavos?: Centavos;
  category?: string | null;
  account?: string;
  date?: string;
  note?: string;
  createdAt?: string;
  type?: "expense" | "income" | "transfer";
}

export interface KupiDbSnapshot {
  accounts: readonly { id?: string; name: string }[];
  categories: readonly { id?: string; name: string }[];
  txns: readonly KupiTxnSnapshot[];
}

export type TargetRef =
  | { kind: "id"; id: string }
  | { kind: "last" }
  | { kind: "match"; category?: string; amount?: Centavos; note?: string; date?: string };

export interface ParseResult {
  intent: KupiIntent;
  confidence: number;
  tier: Tier;
  alternatives: Array<{ intent: KupiIntent; confidence: number }>;
  drafts: DraftTxn[]; // >1 for compound messages
  edit?: { target: TargetRef; field: "amount" | "account" | "category" | "date" | "note"; value: string | Centavos };
  deleteTarget?: TargetRef;
  query?: StatsQuery;
  targetCandidates?: string[];
  missing: Array<"amount" | "category" | "account" | "fromAccount" | "toAccount" | "date" | "target">;
  flags: ParseFlag[];
  unsupported?: "utang" | "split_bill" | "bulk_delete" | "recurring" | "multi_currency";
}

export interface SessionContext {
  lastTxnId?: string;
  pending?: { kind: "confirmAction" | "slot" | "disambiguation"; slot?: string; draft?: Partial<DraftTxn>; actionId?: string };
  recentTemplateIds: string[]; // last N rendered, for anti-repeat
  personality: "chill" | "classic" | "dramatic";
  rngSeed: number;
}

export interface KupiAction {
  id: string; // idempotency key
  kind: "create" | "update" | "delete" | "transfer";
  before: unknown | null;
  after: unknown | null;
  warnings: string[];
}

export interface Template {
  id: string;
  intent: ResponseIntent;
  mood: Mood;
  intensity: Intensity;
  language: Language;
  vars: string[];
  text: string;
  tags?: string[];
  stage?: "confirm" | "done" | "ambiguous" | "not_found" | "nothing";
  slot?: string;
}

export interface GoldenCase {
  id: string;
  text: string;
  /** Defaults to 2026-11-24T12:00:00+08:00. */
  now?: string;
  context?: Record<string, unknown>;
  expect: Record<string, unknown> & { intent: KupiIntent; tier: Tier };
  tags: string[];
  source: "hand" | "seed" | "synthetic" | "llm-paraphrase" | "correction";
  /** "gap" = known to fail on the legacy src/domain/parser.ts; informational scoreboard only. */
  legacy?: "gap";
}
