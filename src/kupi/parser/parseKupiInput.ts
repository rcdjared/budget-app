import {
  KUPI_CONFIG,
  type DraftTxn,
  type KupiDbSnapshot,
  type KupiIntent,
  type KupiTxnSnapshot,
  type ParseResult,
  type SessionContext,
  type Slot,
  type SlotSource,
  type StatsQuery,
  type TargetRef,
  type Tier,
} from "../contracts";
import {
  DEFAULT_ACCOUNT_ALIASES,
  INCOME_CATEGORY_ALIASES,
  MERCHANT_CATEGORY_ALIASES,
} from "../lexicon/defaults";
import { parseKupiDates, type ParsedDateMention } from "../text/dates";
import { rankFuzzyMatches, type FuzzyCandidate } from "../text/fuzzy";
import { extractMoneyCandidates, type MoneyCandidate } from "../text/numbers";
import { normalizeKupiInput } from "../text/normalize";

interface NameMention {
  name: string;
  alias: string;
  index: number;
  length: number;
}

interface CategoryMatch {
  value: string;
  source: SlotSource;
  confidence: number;
  explicitNull?: boolean;
}

interface TransactionParse {
  result: ParseResult;
  category?: CategoryMatch;
  accountMentions: NameMention[];
}

const EMPTY_RESULT: Omit<ParseResult, "intent" | "confidence" | "tier"> = {
  alternatives: [],
  drafts: [],
  missing: [],
  flags: [],
};

const STOP_WORDS = new Set([
  "a", "ako", "ang", "at", "ba", "can", "for", "from", "i", "in", "ko", "mo", "my",
  "na", "ng", "ni", "on", "pa", "pala", "please", "sa", "the", "to", "with", "yung",
  "spent", "spend", "bought", "buy", "paid", "log", "add", "expense", "income", "received",
  "today", "ngayon", "yesterday", "kahapon", "kanina", "kagabi", "last", "next", "week",
  "month", "mali", "wrong", "that", "it", "make", "put", "change", "palitan", "pala",
  "p", "php", "peso", "pesos", "piso", "pisos", "fee", "using", "every", "month",
]);

const INCOME_CUES = [
  "income", "received", "remittance", "salary", "sahod", "sweldo", "freelance", "refund",
  "cashback", "aguinaldo", "dividend", "rental income", "naibenta", "bonus", "gift",
  "deposit", "allowance", "padala", "bigay",
];

const QUERY_CUES = [
  "how much", "magkano", "budget left", "budget remaining", "spending", "nagastos",
  "natitira", "top spending", "biggest expense", "how many transactions", "daily average",
  "safe to spend", "compare to", "net worth", "total income",
];

function normalizedPhrase(value: string): string {
  return normalizeKupiInput(value)
    .text
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phrasePattern(phrase: string): RegExp | null {
  const words = normalizedPhrase(phrase).split(" ").filter(Boolean);
  if (!words.length) return null;
  const body = words.map(escapeRegex).join("[^\\p{L}\\p{N}]+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, "giu");
}

function phrasePositions(text: string, phrase: string): number[] {
  const normalized = normalizeKupiInput(text).text;
  const phraseText = normalizedPhrase(phrase);
  const pattern = phrasePattern(phraseText);
  if (!pattern) return [];
  const positions: number[] = [];
  for (const match of normalized.matchAll(pattern)) positions.push(match.index ?? 0);

  if (phraseText.length >= 4) {
    if (normalized.startsWith(phraseText) && /^\d/u.test(normalized.slice(phraseText.length))) positions.push(0);
    if (normalized.endsWith(phraseText) && /\d$/u.test(normalized.slice(0, -phraseText.length))) {
      positions.push(normalized.length - phraseText.length);
    }
  }
  return [...new Set(positions)];
}

function containsPhrase(text: string, phrase: string): boolean {
  return phrasePositions(text, phrase).length > 0;
}

function containsAny(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => containsPhrase(text, phrase));
}

function findNameMentions(
  text: string,
  names: readonly { name: string }[],
  aliasesByName: Readonly<Record<string, readonly string[]>>
): NameMention[] {
  const mentions: NameMention[] = [];
  for (const { name } of names) {
    const aliases = [name, ...(aliasesByName[name] ?? [])];
    for (const alias of aliases) {
      for (const index of phrasePositions(text, alias)) {
        mentions.push({ name, alias, index, length: normalizedPhrase(alias).length });
      }
    }
  }

  const unique = new Map<string, NameMention>();
  for (const mention of mentions) {
    const key = `${mention.name}:${mention.index}`;
    const existing = unique.get(key);
    if (!existing || mention.length > existing.length) unique.set(key, mention);
  }
  return [...unique.values()].sort((a, b) => a.index - b.index || b.length - a.length);
}

function liveCategoryNames(db: KupiDbSnapshot): string[] {
  return (db.categories ?? []).map(({ name }) => name);
}

function resolveCategory(text: string, db: KupiDbSnapshot, income: boolean): CategoryMatch | undefined {
  const liveNames = liveCategoryNames(db);
  const exactNames = liveNames
    .filter((name) => containsPhrase(text, name))
    .sort((a, b) => normalizedPhrase(b).length - normalizedPhrase(a).length);
  if (exactNames.length) {
    return { value: exactNames[0], source: "text", confidence: KUPI_CONFIG.parser.explicitCueConfidence };
  }
  if (income && containsAny(text, ["gift", "refund", "cashback", "aguinaldo", "bigay"])) {
    const gifts = liveNames.find((name) => name.toLowerCase() === "gifts & cashbacks");
    if (gifts) return { value: gifts, source: "text", confidence: KUPI_CONFIG.parser.explicitCueConfidence };
  }

  const aliases = income
    ? INCOME_CATEGORY_ALIASES
    : MERCHANT_CATEGORY_ALIASES;
  const aliasMatches = aliases
    .filter(({ category }) => liveNames.some((name) => name.toLowerCase() === category.toLowerCase()))
    .flatMap(({ category, aliases: categoryAliases }) =>
      categoryAliases
        .flatMap((alias) => phrasePositions(text, alias).map((index) => ({
          value: liveNames.find((name) => name.toLowerCase() === category.toLowerCase())!,
          alias,
          index,
        })))
    )
    .sort((a, b) => normalizedPhrase(b.alias).length - normalizedPhrase(a.alias).length || a.index - b.index);
  if (aliasMatches.length) {
    return { value: aliasMatches[0].value, source: "text", confidence: KUPI_CONFIG.parser.explicitCueConfidence };
  }

  if (!income) {
    const fuzzyCandidates: FuzzyCandidate[] = [];
    for (const { category, aliases: categoryAliases } of MERCHANT_CATEGORY_ALIASES) {
      const liveCategory = liveNames.find((name) => name.toLowerCase() === category.toLowerCase());
      if (!liveCategory) continue;
      for (const alias of categoryAliases) {
        fuzzyCandidates.push({ id: `${liveCategory}:${alias}`, name: alias });
      }
    }
    const words = normalizedPhrase(text).split(" ").filter((word) => word && !STOP_WORDS.has(word) && !/^\d+$/u.test(word));
    const fuzzyMatches = words.flatMap((word) => rankFuzzyMatches(word, fuzzyCandidates));
    const best = fuzzyMatches.sort((a, b) => b.score - a.score)[0];
    if (best) {
      const categoryName = best.candidate.id.split(":")[0];
      return { value: categoryName, source: "fuzzy", confidence: KUPI_CONFIG.parser.ambiguousCueConfidence };
    }
  }

  if (!income && containsPhrase(text, "donation")) {
    return { value: "", source: "text", confidence: KUPI_CONFIG.parser.ambiguousCueConfidence, explicitNull: true };
  }
  return undefined;
}

function accountMentions(text: string, db: KupiDbSnapshot): NameMention[] {
  const mentions = findNameMentions(text, db.accounts ?? [], DEFAULT_ACCOUNT_ALIASES);
  const normalized = normalizeKupiInput(text).text;
  if (/^cash\s+(?:in|out)\b/u.test(normalized)) {
    return mentions.filter((mention) => !(mention.index === 0 && normalizedPhrase(mention.alias) === "cash"));
  }
  return mentions;
}

function makeSlot<T>(
  value: T,
  source: SlotSource,
  confidence: number,
  span?: [number, number],
  alternatives?: T[]
): Slot<T> {
  return {
    value,
    source,
    confidence,
    ...(span ? { span } : {}),
    ...(alternatives?.length ? { alternatives } : {}),
  };
}

function emptyResult(intent: KupiIntent, confidence: number, tier: Tier): ParseResult {
  return {
    ...EMPTY_RESULT,
    alternatives: [],
    drafts: [],
    missing: [],
    flags: [],
    intent,
    confidence,
    tier,
  };
}

function resultWithAlternative(result: ParseResult, intent: KupiIntent, confidence: number): ParseResult {
  if (result.alternatives.some((item) => item.intent === intent)) return result;
  return {
    ...result,
    alternatives: [...result.alternatives, { intent, confidence }]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3),
  };
}

function todayDate(now: Date): string {
  return parseKupiDates("today", now)[0].date;
}

function periodFromText(text: string): StatsQuery["period"] {
  if (containsAny(text, ["yesterday", "kahapon"])) return "yesterday";
  if (containsPhrase(text, "last week")) return "last_week";
  if (containsPhrase(text, "this week")) return "this_week";
  if (containsPhrase(text, "last month")) return "last_month";
  if (containsPhrase(text, "this month")) return "this_month";
  if (containsAny(text, ["today", "ngayon"])) return "today";
  return undefined;
}

function resolveQuery(text: string, db: KupiDbSnapshot): StatsQuery | undefined {
  if (!containsAny(text, QUERY_CUES)) return undefined;
  const normalized = normalizeKupiInput(text).text;
  let metric: StatsQuery["metric"] = "total";
  if (containsPhrase(text, "net worth")) metric = "net_worth";
  else if (containsPhrase(text, "safe to spend")) metric = "safe_to_spend";
  else if (containsPhrase(text, "daily average")) metric = "daily_average";
  else if (containsPhrase(text, "how many transactions")) metric = "count";
  else if (containsPhrase(text, "biggest expense")) metric = "biggest_expense";
  else if (containsPhrase(text, "top spending") || containsPhrase(text, "top category")) metric = "top_category";
  else if (containsPhrase(text, "compare to")) metric = "vs_last_period";
  else if (containsPhrase(text, "budget left") || containsPhrase(text, "budget remaining") || containsPhrase(text, "natitira")) {
    metric = "remaining_budget";
  }

  const query: StatsQuery = { metric };
  const period = periodFromText(text);
  if (period) query.period = metric === "vs_last_period" && period === "last_month" ? "this_month" : period;
  if (containsPhrase(text, "income")) query.filters = { type: "income" };

  const explicitCategory = (db.categories ?? [])
    .map(({ name }) => name)
    .filter((name) => containsPhrase(text, name))
    .sort((a, b) => normalizedPhrase(b).length - normalizedPhrase(a).length)[0];
  if (explicitCategory && (metric === "remaining_budget" || /spending|spent|gastos|gastos ko|sa /u.test(normalized))) {
    query.filters = { ...query.filters, category: explicitCategory };
  } else {
    const filterMatch = normalized.match(/(?:\bon\s+|\bsa\s+)([a-z][\p{L}\p{N}' -]*?)(?:\s+(?:today|yesterday|kahapon|this|last)\b|$)/u);
    if (filterMatch && metric === "total") {
      const filterText = filterMatch[1].trim().split(/\s+/u).slice(-2).join(" ");
      if (filterText && !STOP_WORDS.has(filterText)) {
        query.filters = { ...query.filters, text: filterText };
      }
    }
  }
  return query;
}

function intentScores(
  text: string,
  hasMoney: boolean,
  category: CategoryMatch | undefined,
  accounts: NameMention[],
  pending: SessionContext["pending"]
): Array<{ intent: KupiIntent; score: number }> {
  const scores = new Map<KupiIntent, number>();
  const add = (intent: KupiIntent, score: number) => scores.set(intent, (scores.get(intent) ?? 0) + score);
  const bare = normalizedPhrase(text);

  if (containsAny(text, QUERY_CUES)) add("QUERY_STATS", 6);
  if (isTransferText(text)) add("TRANSFER", 6);
  if (containsAny(text, [...INCOME_CUES, "13th month"])) add("LOG_INCOME", 4);
  if (category) add("LOG_EXPENSE", 2);
  if (hasMoney) add("LOG_EXPENSE", 1);
  if (/\b(?:spent|bought|paid for|expense|log|add)\b/u.test(normalizeKupiInput(text).text)) add("LOG_EXPENSE", 2);
  if (accounts.length && hasMoney && !category && !containsAny(text, INCOME_CUES)) add("CLARIFY", 5);
  if (/^(?:delete|remove)\b/u.test(bare)) add("DELETE_TXN", 5);
  if (/^(?:make that|change that|put it on|palitan mo|mali|mali yan)\b/u.test(bare)) add("EDIT_TXN", 5);
  if (/^(?:undo|i undo)(?:\s+(?:that|mo|it))?$/u.test(bare)) add("UNDO", 6);
  if (/^(?:cancel|no|nope|wag(?: na)?|oo|sige|yes)$/u.test(bare)) {
    if (pending?.kind === "confirmAction") add(["cancel", "no", "nope", "wag", "wag na"].includes(bare) ? "CANCEL" : "CONFIRM", 7);
    else add("CLARIFY", 4);
  }
  if (/^(?:hi|hello|hello kupi|good (?:morning|afternoon|evening)|kumusta|sino ka|thanks|thank you|salamat|help|what can you do|ano kaya mo gawin)$/u.test(bare)) {
    add(["help", "what can you do", "ano kaya mo gawin"].includes(bare) ? "HELP" : "SMALLTALK", 4);
  }
  return [...scores].map(([intent, score]) => ({ intent, score })).sort((a, b) => b.score - a.score);
}

function tierFor(confidence: number, missing: string[], forceConfirm = false, forceAsk = false): Tier {
  if (forceAsk || missing.length) return "ask";
  if (forceConfirm || confidence < KUPI_CONFIG.confidence.auto) return "confirm";
  return "auto";
}

function parseNumericSlot(candidate: MoneyCandidate | undefined, confidence: number): Slot<number> | undefined {
  if (!candidate || candidate.amountCentavos <= 0) return undefined;
  return makeSlot(candidate.amountCentavos, "text", confidence, [candidate.start, candidate.end]);
}

function parseDateSlot(date: ParsedDateMention | undefined, now: Date): Slot<string> {
  if (!date) return makeSlot(todayDate(now), "default", KUPI_CONFIG.parser.explicitCueConfidence);
  return makeSlot(
    date.date,
    "text",
    date.ambiguous ? KUPI_CONFIG.parser.ambiguousCueConfidence : KUPI_CONFIG.parser.explicitCueConfidence,
    [date.start, date.end],
    date.alternatives
  );
}

function matchingTransactions(
  text: string,
  transactions: readonly KupiTxnSnapshot[],
  category: CategoryMatch | undefined,
  amountCandidate: MoneyCandidate | undefined
): KupiTxnSnapshot[] {
  let matches = [...transactions];
  if (category?.value) {
    matches = matches.filter((txn) => txn.category?.toLowerCase() === category.value.toLowerCase());
  }
  if (amountCandidate && /\b(?:the|number)\s+[\d,]+/iu.test(text)) {
    matches = matches.filter((txn) => txn.amountCentavos === amountCandidate.amountCentavos);
  }
  const normalized = normalizedPhrase(text);
  const noteQuery = normalized
    .replace(/\b(?:delete|remove|change|edit|last|the|that|transaction|txn|to|amount|of|number)\b/gu, " ")
    .replace(/\b\d+\b/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const noteWords = noteQuery.split(" ").filter((word) => word && !STOP_WORDS.has(word));
  if (noteWords.length) {
    const query = noteWords.join(" ");
    const textHasLast = /\blast\b/u.test(normalized);
    if (!textHasLast) {
      const withNote = matches.filter((txn) => txn.note && normalizedPhrase(txn.note).includes(query));
      if (withNote.length) matches = withNote;
    }
  }
  return matches;
}

function resolveTarget(
  text: string,
  db: KupiDbSnapshot,
  category: CategoryMatch | undefined,
  amountCandidate: MoneyCandidate | undefined,
  context: SessionContext
): { target?: TargetRef; candidates?: string[]; ambiguous: boolean } {
  const normalized = normalizeKupiInput(text).text;
  const mentionsLast = /\b(?:last|that|it)\b/u.test(normalized);
  if (mentionsLast && !category && context.lastTxnId) return { target: { kind: "last" }, ambiguous: false };

  const matches = matchingTransactions(text, db.txns ?? [], category, amountCandidate);
  if (matches.length === 1) return { target: { kind: "id", id: matches[0].id }, ambiguous: false };
  if (matches.length > 1) return { candidates: matches.slice(0, 3).map(({ id }) => id), ambiguous: true };
  if (mentionsLast && context.lastTxnId) return { target: { kind: "last" }, ambiguous: false };
  return { ambiguous: false };
}

function resolveDateForTarget(text: string, now: Date): ParsedDateMention | undefined {
  return parseKupiDates(text, now)[0];
}

function splitCompound(text: string): string[] {
  return text
    .split(/,(?!\d)|\n|\btapos\b|\band\b/giu)
    .map((part) => part.trim())
    .filter(Boolean);
}

function defaultCategorySlot(match: CategoryMatch | undefined, confidence: number): Slot<string | null> | undefined {
  if (!match) return undefined;
  return makeSlot(match.explicitNull ? null : match.value, match.source, confidence);
}

function describeText(text: string, accounts: NameMention[]): boolean {
  const words = normalizedPhrase(text).split(" ").filter(Boolean);
  const accountNames = new Set(accounts.flatMap(({ name, alias }) => [normalizedPhrase(name), normalizedPhrase(alias)]));
  return words.some((word) =>
    !STOP_WORDS.has(word)
    && !accountNames.has(word)
    && !/^\d+$/u.test(word)
    && !/^(?:a|p|k|m)$/u.test(word)
  );
}

function incomeCategoryMatch(text: string, db: KupiDbSnapshot): CategoryMatch | undefined {
  return resolveCategory(text, db, true);
}

function isIncomeText(text: string): boolean {
  return containsAny(text, [...INCOME_CUES, "13th month"]);
}

function isTransferText(text: string): boolean {
  const normalized = normalizeKupiInput(text).text;
  return (
    /\b(?:move money|lipat|inilipat|cash in|cash out|withdraw)\b/u.test(normalized)
    || /\btransfer\b/u.test(normalized) && !/\btransfer fee\b/u.test(normalized)
  )
    || containsPhrase(text, "paid credit card");
}

function isUnsupported(text: string): ParseResult | undefined {
  const normalized = normalizeKupiInput(text).text;
  if (/\bignore previous instructions\b/u.test(normalized)) {
    return emptyResult("UNKNOWN", KUPI_CONFIG.parser.fallbackConfidence, "fallback");
  }
  let unsupported: ParseResult["unsupported"];
  if (/\b(?:usd|eur|gbp|multi currency)\b|[$€£]/u.test(normalized)) unsupported = "multi_currency";
  else if (/\b(?:recurring|every (?:day|week|month)|(?:daily|weekly|monthly)\s+(?:expense|payment|bill|transaction))\b/u.test(normalized)) unsupported = "recurring";
  else if (/\b(?:hatiin|split bill|split the bill)\b/u.test(normalized)) unsupported = "split_bill";
  else if (/\butang\b/u.test(normalized)) unsupported = "utang";
  else if (/\bdelete all\b|\bremove all\b/u.test(normalized)) unsupported = "bulk_delete";
  if (!unsupported) return undefined;
  const result = emptyResult("UNKNOWN", KUPI_CONFIG.parser.fallbackConfidence, "fallback");
  result.unsupported = unsupported;
  return result;
}

function parsePendingReply(
  text: string,
  context: SessionContext,
  db: KupiDbSnapshot,
  now: Date
): ParseResult | undefined {
  const pending = context?.pending;
  if (!pending) return undefined;
  const normalized = normalizedPhrase(text);
  if (containsAny(text, QUERY_CUES)) return undefined;

  if (pending.kind === "confirmAction") {
    if (/^(?:oo|sige|yes|y|confirm)$/u.test(normalized)) {
      return emptyResult("CONFIRM", KUPI_CONFIG.parser.explicitCueConfidence, "auto");
    }
    if (/^(?:no|nope|wag|wag na|cancel)$/u.test(normalized)) {
      return emptyResult("CANCEL", KUPI_CONFIG.parser.explicitCueConfidence, "auto");
    }
  }

  if (pending.kind !== "slot" || !pending.slot) return undefined;
  const draft = (pending.draft ?? {}) as Record<string, unknown>;
  const currentAmount = typeof draft.amount === "number"
    ? draft.amount
    : typeof draft.amountCentavos === "number"
      ? draft.amountCentavos
      : undefined;
  const currentCategory = typeof draft.category === "string" ? draft.category : undefined;
  const currentAccount = typeof draft.account === "string" ? draft.account : undefined;
  const confidence = KUPI_CONFIG.parser.explicitCueConfidence;
  const result = emptyResult("LOG_EXPENSE", confidence, "auto");
  const txn: DraftTxn = { type: "expense" };

  if (pending.slot === "amount") {
    const amount = extractMoneyCandidates(text).candidates.at(-1);
    const value = amount?.amountCentavos ?? (Number.isFinite(Number(text)) ? Math.round(Number(text) * 100) : undefined);
    if (!value || value <= 0 || !Number.isSafeInteger(value)) return undefined;
    txn.amount = makeSlot(value, "text", confidence, amount ? [amount.start, amount.end] : undefined);
  } else if (pending.slot === "account") {
    const account = accountMentions(text, db)[0];
    if (!account) return undefined;
    txn.account = makeSlot(account.name, "text", confidence);
    if (currentAmount !== undefined) txn.amount = makeSlot(currentAmount, "context", confidence);
    if (currentCategory) txn.category = makeSlot(currentCategory, "context", confidence);
  } else if (pending.slot === "category") {
    const category = resolveCategory(text, db, false);
    if (!category) return undefined;
    txn.category = makeSlot(category.value, category.source, category.confidence);
    if (currentAmount !== undefined) txn.amount = makeSlot(currentAmount, "context", confidence);
    if (currentAccount) txn.account = makeSlot(currentAccount, "context", confidence);
  } else if (pending.slot === "date") {
    const date = resolveDateForTarget(text, now);
    if (!date) return undefined;
    txn.date = parseDateSlot(date, now);
  } else {
    return undefined;
  }

  if (currentAmount !== undefined && !txn.amount) txn.amount = makeSlot(currentAmount, "context", confidence);
  if (currentCategory && !txn.category) txn.category = makeSlot(currentCategory, "context", confidence);
  result.drafts = [txn];
  return result;
}

function parseTransaction(
  text: string,
  db: KupiDbSnapshot,
  context: SessionContext,
  now: Date,
  options: { isCompoundChild?: boolean } = {}
): TransactionParse {
  const normalized = normalizeKupiInput(text).text;
  const dates = parseKupiDates(text, now);
  const accountMatches = accountMentions(text, db);
  const ambiguousPadalaTo = containsPhrase(text, "padala") && /\bkay\s+\w+/u.test(normalized);
  const income = isIncomeText(text) && !ambiguousPadalaTo;
  const transfer = isTransferText(text);
  const category = income ? incomeCategoryMatch(text, db) : resolveCategory(text, db, false);
  const hasConcatenatedAccountSuffix = accountMatches.some(({ index }) => /\d/u.test(normalized.slice(0, index)));
  const allowConcatenatedWords = Boolean(
    category && (/\d$/u.test(normalized) || hasConcatenatedAccountSuffix)
  );
  const money = extractMoneyCandidates(text, { allowConcatenatedWords });
  const scores = intentScores(text, money.candidates.length > 0, category, accountMatches, context?.pending);
  const classifier = scores[0]?.intent ?? "UNKNOWN";

  if (transfer || classifier === "TRANSFER") {
    const result = emptyResult("TRANSFER", KUPI_CONFIG.parser.explicitCueConfidence, "auto");
    const txn: DraftTxn = { type: "transfer" };
    const operation = normalized.match(/\b(cash in|cash out|withdraw)\b/u)?.[1];
    const fromIndex = normalized.indexOf("from ");
    const toIndex = normalized.indexOf("to ");
    let from: NameMention | undefined;
    let to: NameMention | undefined;

    if (operation === "cash in") {
      to = accountMatches.find(({ index }) => index > 0);
    } else if (operation === "cash out" || operation === "withdraw") {
      from = accountMatches[0];
      const defaultDestination = db.accounts.find(({ name }) => name.toLowerCase() === "cash / wallet");
      if (defaultDestination) {
        txn.toAccount = makeSlot(defaultDestination.name, "default", KUPI_CONFIG.parser.inferredCueConfidence);
      }
    } else if (fromIndex >= 0) {
      from = accountMatches.find(({ index }) => index > fromIndex);
      if (toIndex >= 0) to = accountMatches.find(({ index }) => index > toIndex);
    } else if (toIndex >= 0) {
      to = accountMatches.find(({ index }) => index > toIndex);
      from = accountMatches.find(({ index }) => to && index < to.index);
    } else if (accountMatches.length >= 2) {
      from = accountMatches[0];
      to = accountMatches[1];
    } else {
      from = accountMatches[0];
    }

    const feeCandidate = money.candidates.find((candidate) =>
      /\bfee\s*$/iu.test(text.slice(Math.max(0, candidate.start - 20), candidate.start))
    );
    const amountCandidate = money.candidates.find((candidate) => candidate !== feeCandidate);
    const amount = parseNumericSlot(amountCandidate, KUPI_CONFIG.parser.explicitCueConfidence);
    if (amount) txn.amount = amount;
    if (feeCandidate && feeCandidate.amountCentavos > 0) {
      txn.fee = makeSlot(feeCandidate.amountCentavos, "text", KUPI_CONFIG.parser.explicitCueConfidence, [feeCandidate.start, feeCandidate.end]);
    }
    if (from) txn.account = makeSlot(from.name, "text", KUPI_CONFIG.parser.explicitCueConfidence);
    else result.missing.push("fromAccount");
    if (to && "name" in to) txn.toAccount = makeSlot(to.name, "text", KUPI_CONFIG.parser.explicitCueConfidence);
    else if (!txn.toAccount) result.missing.push("toAccount");

    if (!txn.amount) result.missing.unshift("amount");
    if (txn.account && txn.toAccount && txn.account.value.toLowerCase() === txn.toAccount.value.toLowerCase()) {
      result.flags.push("same_account");
      result.missing = [];
    }
    result.drafts = [txn];
    const ambiguousOperation = operation === "cash out" || operation === "withdraw";
    result.confidence = ambiguousOperation ? KUPI_CONFIG.parser.ambiguousCueConfidence : KUPI_CONFIG.parser.explicitCueConfidence;
    result.tier = tierFor(
      result.confidence,
      result.missing,
      ambiguousOperation,
      result.flags.includes("same_account")
    );
    return { result, category, accountMentions: accountMatches };
  }

  const amountMarker = money.candidates.at(-1);
  const explicitAction = /\b(?:spent|bought|paid for|expense|log|add)\b/u.test(normalized);
  const cashInOut = income && containsPhrase(text, "cash in");
  const ambiguousBaon = containsPhrase(text, "baon");
  const ambiguousAllowance = containsPhrase(text, "allowance");
  const ambiguousDeposit = containsPhrase(text, "deposit");
  const ambiguousGift = containsPhrase(text, "bigay");
  const ambiguousReceived = containsPhrase(text, "received")
    && !containsPhrase(text, "remittance")
    && accountMatches.length > 0;
  const ambiguousPadala = containsPhrase(text, "padala") && !containsPhrase(text, "remittance")
    && !/\bni\s+\w+/u.test(normalized);
  const correction = /\b(?:mali|wrong)\b/u.test(normalized) && amountMarker !== undefined;
  const chosenCandidate = correction ? money.candidates.at(-1) : amountMarker;
  const descriptors = describeText(text, accountMatches);
  const accountOnly = accountMatches.length > 0 && !category && !income && !explicitAction && !transfer;
  const unrecognizedDescriptor = !category && !income && descriptors;

  if (accountOnly && money.candidates.length) {
    const result = emptyResult("CLARIFY", KUPI_CONFIG.parser.ambiguousCueConfidence, "ask");
    const candidate = money.candidates.at(-1);
    const amount = parseNumericSlot(candidate, KUPI_CONFIG.parser.ambiguousCueConfidence);
    if (amount) result.drafts = [{ type: "expense", amount }];
    return { result, category, accountMentions: accountMatches };
  }

  if (!money.candidates.length && !category && !income && !explicitAction && !containsPhrase(text, "libre")) {
    return { result: emptyResult("UNKNOWN", KUPI_CONFIG.parser.fallbackConfidence, "fallback"), category, accountMentions: accountMatches };
  }

  const type: DraftTxn["type"] = income || cashInOut ? "income" : "expense";
  const intent: KupiIntent = type === "income" ? "LOG_INCOME" : "LOG_EXPENSE";
  let result = emptyResult(intent, KUPI_CONFIG.parser.explicitCueConfidence, "auto");
  const txn: DraftTxn = { type };
  const amount = parseNumericSlot(chosenCandidate, KUPI_CONFIG.parser.explicitCueConfidence);
  if (amount) txn.amount = amount;
  const concatenatedAmount = Boolean(
    chosenCandidate
    && (/[\p{L}\p{N}_]/u.test(text[chosenCandidate.start - 1] ?? "")
      || /[\p{L}\p{N}_]/u.test(text[chosenCandidate.end] ?? ""))
  );

  if (category) txn.category = defaultCategorySlot(category, category.confidence);
  else if (income) {
    const otherIncome = liveCategoryNames(db).find((name) => name.toLowerCase() === "other income");
    if (otherIncome) txn.category = makeSlot(otherIncome, "default", KUPI_CONFIG.parser.inferredCueConfidence);
  } else if (containsPhrase(text, "baon")) {
    txn.category = makeSlot(null, "text", KUPI_CONFIG.parser.ambiguousCueConfidence);
  } else if (containsPhrase(text, "donation")) {
    txn.category = makeSlot(null, "text", KUPI_CONFIG.parser.ambiguousCueConfidence);
  } else if (descriptors) {
    txn.category = makeSlot(null, "text", KUPI_CONFIG.parser.ambiguousCueConfidence);
  }

  if (!txn.category && !category && !descriptors) result.missing.push("category");
  if (!txn.amount) result.missing.unshift("amount");

  const account = accountMatches.at(-1);
  if (account) txn.account = makeSlot(account.name, "text", KUPI_CONFIG.parser.explicitCueConfidence);
  if (dates.length) {
    const date = dates[0];
    txn.date = parseDateSlot(date, now);
    result.flags.push(...date.flags);
  } else {
    txn.date = makeSlot(todayDate(now), "default", KUPI_CONFIG.parser.explicitCueConfidence);
  }

  if (money.ambiguities.some(({ kind }) => kind === "quantity") && !correction) {
    result.flags.push("quantity");
    const quantity = money.ambiguities.find(({ kind }) => kind === "quantity");
    const count = quantity ? Number(quantity.raw.match(/\d+/u)?.[0]) : 0;
    if (txn.amount && Number.isSafeInteger(count) && count > 1) {
      const alternative = txn.amount.value * count;
      if (Number.isSafeInteger(alternative)) txn.amount.alternatives = [alternative];
    }
  }
  if (txn.amount && txn.amount.value > KUPI_CONFIG.parser.hugeAmountCentavos) result.flags.push("huge_amount");
  if (containsPhrase(text, "libre")) result.flags.push("libre");

  const fuzzyCategory = category?.source === "fuzzy";
  const ambiguousDate = dates[0]?.ambiguous || dates[0]?.raw.toLowerCase() === "last week";
  const ambiguousLanguage = ambiguousBaon || ambiguousAllowance || ambiguousDeposit || ambiguousPadala || ambiguousGift || ambiguousReceived;
  const correctionConfidence = correction ? KUPI_CONFIG.parser.explicitCueConfidence : undefined;
  if (ambiguousBaon) result = resultWithAlternative(result, "LOG_INCOME", KUPI_CONFIG.parser.ambiguousCueConfidence);
  if (ambiguousAllowance) result = resultWithAlternative(result, "LOG_EXPENSE", KUPI_CONFIG.parser.ambiguousCueConfidence);
  if (ambiguousDeposit || ambiguousPadala) result = resultWithAlternative(result, "TRANSFER", KUPI_CONFIG.parser.ambiguousCueConfidence);
  if (txn.amount?.alternatives?.length || result.flags.includes("huge_amount") || result.flags.includes("libre")) {
    result.confidence = KUPI_CONFIG.parser.ambiguousCueConfidence;
  }
  if (fuzzyCategory || category?.explicitNull || concatenatedAmount || unrecognizedDescriptor) {
    result.confidence = KUPI_CONFIG.parser.ambiguousCueConfidence;
  }
  if (ambiguousLanguage) result.confidence = KUPI_CONFIG.parser.ambiguousCueConfidence;
  if (correctionConfidence) result.confidence = correctionConfidence;
  if (containsPhrase(text, "deposit") || ambiguousPadala || ambiguousBaon || ambiguousAllowance || ambiguousGift || ambiguousReceived) {
    result.confidence = KUPI_CONFIG.parser.ambiguousCueConfidence;
  }

  const negativeOnly = money.ambiguities.some(({ kind }) => kind === "negative") && !money.candidates.length;
  if (negativeOnly) {
    result.missing = ["amount", ...(result.missing.includes("category") ? ["category" as const] : [])];
  }
  if (result.flags.includes("future_date")) result.tier = "ask";
  else {
    const forcedConfirm = result.flags.some((flag) =>
      ["quantity", "huge_amount", "midnight_date", "ambiguous_baon", "ambiguous_padala"].includes(flag)
    ) || ambiguousLanguage || ambiguousDate || fuzzyCategory || category?.explicitNull
      || concatenatedAmount || unrecognizedDescriptor
      || (correction === false && /\b(?:deleted|undo)\b/u.test(normalized));
    result.tier = tierFor(result.confidence, result.missing, forcedConfirm);
  }
  if (!options.isCompoundChild && classifier === "UNKNOWN" && !money.candidates.length && !category && !descriptors) {
    return { result: emptyResult("UNKNOWN", KUPI_CONFIG.parser.fallbackConfidence, "fallback"), category, accountMentions: accountMatches };
  }
  result.drafts = [txn];
  return { result, category, accountMentions: accountMatches };
}

function parseIntentCommand(
  text: string,
  db: KupiDbSnapshot,
  context: SessionContext,
  now: Date
): ParseResult | undefined {
  const normalized = normalizedPhrase(text);
  if (/^(?:undo|i undo|undo that|undo it|i undo mo)$/u.test(normalized)) {
    return emptyResult("UNDO", KUPI_CONFIG.parser.explicitCueConfidence, "auto");
  }
  if (/^(?:cancel|no|nope|wag|wag na|oo|sige|yes|y|confirm)$/u.test(normalized)) {
    if (context?.pending?.kind === "confirmAction") {
      return emptyResult(["cancel", "no", "nope", "wag", "wag na"].includes(normalized) ? "CANCEL" : "CONFIRM", KUPI_CONFIG.parser.explicitCueConfidence, "auto");
    }
    return emptyResult("CLARIFY", KUPI_CONFIG.parser.ambiguousCueConfidence, "ask");
  }

  if (/^(?:delete|remove)\b(?:\s+(?:that|it|last|the|my|a|an|this|everything|all))?/u.test(normalized)) {
    const category = resolveCategory(text, db, false);
    const money = extractMoneyCandidates(text);
    const target = resolveTarget(text, db, category, money.candidates[0], context);
    const result = emptyResult("DELETE_TXN", KUPI_CONFIG.parser.explicitCueConfidence, "auto");
    if (target.target) result.deleteTarget = target.target;
    if (target.candidates) result.targetCandidates = target.candidates;
    if (!target.target && !target.candidates) {
      result.flags.push("target_not_found");
      result.missing.push("target");
      result.tier = "ask";
    } else if (target.ambiguous) {
      result.tier = "ask";
    } else if (target.target?.kind === "last") {
      result.tier = "confirm";
    }
    return result;
  }

  const editPhrase = /^(?:make that|change that|put it on|change last|change the|palitan mo|mali|mali yan|wrong)\b/u.test(normalized);
  if (editPhrase) {
    const category = resolveCategory(text, db, false);
    let target = resolveTarget(text, db, category, undefined, context);
    if (!category && context.lastTxnId && /^(?:mali|mali yan|wrong)\b/u.test(normalized)) {
      target = { target: { kind: "last" }, ambiguous: false };
    }
    const result = emptyResult("EDIT_TXN", KUPI_CONFIG.parser.explicitCueConfidence, "auto");
    if (target.target) {
      result.edit = { target: target.target, field: "amount", value: 0 };
    } else if (target.candidates) {
      result.targetCandidates = target.candidates;
      result.tier = "ask";
    } else {
      result.flags.push("target_not_found");
      result.missing.push("target");
      result.tier = "ask";
      return result;
    }
    if (!target.target) return result;

    const date = resolveDateForTarget(text, now);
    const amount = extractMoneyCandidates(text).candidates.at(-1);
    const account = accountMentions(text, db).at(-1);
    if (account && /(?:put it on|change that to|account|gcash|maya|cash|gotyme)/iu.test(normalized)) {
      result.edit = { target: target.target!, field: "account", value: account.name };
    } else if (amount) {
      result.edit = { target: target.target!, field: "amount", value: amount.amountCentavos };
    } else if (date && /kahapon|kanina|kagabi|yesterday|last night/iu.test(normalized)) {
      result.edit = { target: target.target!, field: "date", value: date.date };
    }
    if (!result.edit || result.edit.value === 0) {
      return emptyResult("CLARIFY", KUPI_CONFIG.parser.ambiguousCueConfidence, "ask");
    }
    return result;
  }
  return undefined;
}

function parseContextEdit(
  text: string,
  db: KupiDbSnapshot,
  context: SessionContext,
  now: Date
): ParseResult | undefined {
  if (!context?.lastTxnId) return undefined;
  const normalized = normalizeKupiInput(text).text;
  const target: TargetRef = { kind: "last" };
  const result = emptyResult("EDIT_TXN", KUPI_CONFIG.parser.explicitCueConfidence, "auto");
  const amount = extractMoneyCandidates(text).candidates.at(-1);
  const account = accountMentions(text, db).at(-1);
  const date = resolveDateForTarget(text, now);

  if (account && /(?:change that to|put it on|account)/iu.test(normalized)) {
    result.edit = { target, field: "account", value: account.name };
  } else if (amount && /(?:na lang|pala|mali|wrong)/iu.test(normalized)) {
    result.edit = { target, field: "amount", value: amount.amountCentavos };
  } else if (date && /(?:pala|kahapon|kanina|kagabi|yesterday|last night)/iu.test(normalized)) {
    result.edit = { target, field: "date", value: date.date };
  } else {
    return undefined;
  }
  return result;
}

function parseQuery(text: string, db: KupiDbSnapshot, context: SessionContext): ParseResult | undefined {
  const query = resolveQuery(text, db);
  if (!query) return undefined;
  const result = emptyResult("QUERY_STATS", KUPI_CONFIG.parser.explicitCueConfidence, "auto");
  result.query = query;
  if (context?.pending) result.flags.push("interrupts_pending");
  if (query.filters?.text) {
    result.confidence = KUPI_CONFIG.parser.ambiguousCueConfidence;
    result.tier = "confirm";
  }
  return result;
}

function parseCompound(
  text: string,
  db: KupiDbSnapshot,
  context: SessionContext,
  now: Date
): ParseResult | undefined {
  const parts = splitCompound(text);
  if (parts.length < 2) return undefined;
  const parsed = parts.map((part) => parseTransaction(part, db, context, now, { isCompoundChild: true }).result);
  if (parsed.some((result) => !["LOG_EXPENSE", "LOG_INCOME"].includes(result.intent) || !result.drafts.length)) return undefined;
  const result = emptyResult(parsed.every(({ intent }) => intent === "LOG_EXPENSE") ? "LOG_EXPENSE" : "LOG_INCOME", KUPI_CONFIG.parser.explicitCueConfidence, "auto");
  result.drafts = parsed.flatMap(({ drafts }) => drafts);
  result.flags = [...new Set(parsed.flatMap(({ flags }) => flags))];
  const normalized = normalizeKupiInput(text).text;
  const hasPareho = containsPhrase(text, "pareho");
  const last = result.drafts[result.drafts.length - 1];
  const earlier = result.drafts.slice(0, -1);
  const accountScope = Boolean(last.account && earlier.some((draft) => !draft.account));
  const dateScope = Boolean(last.date?.source === "text" && earlier.some((draft) => draft.date?.source !== "text"));

  if (hasPareho) {
    for (const draft of earlier) {
      if (dateScope && last.date) draft.date = makeSlot(last.date.value, "context", last.date.confidence, undefined, last.date.alternatives);
      if (accountScope && last.account) draft.account = makeSlot(last.account.value, "context", last.account.confidence);
    }
  } else {
    if (accountScope) result.flags.push("trailing_account_scope");
    if (dateScope) result.flags.push("trailing_date_scope");
  }

  result.confidence = parsed.some(({ confidence }) => confidence < KUPI_CONFIG.confidence.auto)
    ? KUPI_CONFIG.parser.ambiguousCueConfidence
    : KUPI_CONFIG.parser.explicitCueConfidence;
  const suspicious = /\bang mahal\b/u.test(normalized);
  const future = result.flags.includes("future_date");
  result.tier = future ? "ask" : tierFor(result.confidence, [], accountScope || dateScope ? !hasPareho : suspicious);
  if (result.flags.includes("trailing_account_scope") || result.flags.includes("trailing_date_scope")) result.tier = "ask";
  return result;
}

/**
 * Deterministic parser for the offline Kupi core. All account/category lookups are
 * constrained to the active profile snapshot supplied by the caller.
 */
export function parseKupiInput(
  text: string,
  sessionContext: SessionContext,
  dbSnapshot: KupiDbSnapshot,
  now: Date
): ParseResult {
  const normalized = normalizedPhrase(text);
  const unsupported = isUnsupported(text);
  if (unsupported) return unsupported;

  const pendingReply = parsePendingReply(text, sessionContext, dbSnapshot, now);
  if (pendingReply) return pendingReply;

  const query = parseQuery(text, dbSnapshot, sessionContext);
  if (query) return query;

  const command = parseIntentCommand(text, dbSnapshot, sessionContext, now);
  if (command) return command;

  const contextEdit = parseContextEdit(text, dbSnapshot, sessionContext, now);
  if (contextEdit) return contextEdit;

  const correctionAmounts = extractMoneyCandidates(text);
  if (/\b(?:mali|wrong)\b/u.test(normalized) && correctionAmounts.candidates.length >= 2) {
    return parseTransaction(text, dbSnapshot, sessionContext, now).result;
  }

  const compound = parseCompound(text, dbSnapshot, sessionContext, now);
  if (compound) return compound;

  const single = parseTransaction(text, dbSnapshot, sessionContext, now).result;
  if (single.intent === "LOG_EXPENSE" && /^(?:hi|hello|hello kupi|good morning|kumusta|thanks|thank you|salamat|sino ka)$/u.test(normalized)) {
    return emptyResult("SMALLTALK", KUPI_CONFIG.parser.explicitCueConfidence, "auto");
  }
  if (single.intent === "LOG_EXPENSE" && !single.drafts.length) return single;
  if (single.intent === "LOG_EXPENSE" && !single.drafts[0]?.amount && !single.drafts[0]?.category && !single.missing.length) {
    return emptyResult("UNKNOWN", KUPI_CONFIG.parser.fallbackConfidence, "fallback");
  }

  const ranked = intentScores(
    text,
    extractMoneyCandidates(text).candidates.length > 0,
    resolveCategory(text, dbSnapshot, isIncomeText(text)),
    accountMentions(text, dbSnapshot),
    sessionContext?.pending
  );
  if (!normalized || /^[?!.,:;]+$/u.test(normalized)) {
    return emptyResult("UNKNOWN", KUPI_CONFIG.parser.fallbackConfidence, "fallback");
  }
  if (ranked[0]?.intent === "SMALLTALK" || ranked[0]?.intent === "HELP") {
    const confidence = KUPI_CONFIG.parser.explicitCueConfidence;
    const result = emptyResult(ranked[0].intent, confidence, "auto");
    return result;
  }
  return single;
}
