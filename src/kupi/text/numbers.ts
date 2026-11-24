import { KUPI_CONFIG, type Centavos } from "../contracts";
import { TAGALOG_NUMBER_WORDS, TAGALOG_UNIT_WORDS } from "../lexicon/defaults";

export type NumberAmbiguityKind = "time" | "date" | "quantity" | "merchant_digit" | "negative" | "huge_amount";
export type MoneyCandidateSource = "numeric" | "tagalog";

export interface MoneyCandidate {
  amountCentavos: Centavos;
  start: number;
  end: number;
  raw: string;
  source: MoneyCandidateSource;
  hasCurrencyMarker: boolean;
}

export interface NumberAmbiguity {
  kind: NumberAmbiguityKind;
  start: number;
  end: number;
  raw: string;
}

export interface MoneyExtraction {
  candidates: MoneyCandidate[];
  ambiguities: NumberAmbiguity[];
}

export interface MoneyExtractionOptions {
  allowConcatenatedWords?: boolean;
}

interface Span {
  start: number;
  end: number;
  kind: NumberAmbiguityKind;
}

const GROUPED_NUMBER = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)`;
const MONEY_PATTERN = new RegExp(
  String.raw`(?:(?<currency>₱|php\b|(?<![\p{L}\p{N}_])p(?=\s*\d)|\$)\s*)?(?<number>${GROUPED_NUMBER}(?:\.\d{1,2})?)(?:\s*(?<scale>[km])\b)?(?:\s*(?<unit>pesos?|pisos?)\b)?`,
  "giu"
);
const TIME_PATTERN = /\b(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*(?:a\.?m\.?|p\.?m\.?))?|\b(?:1[0-2]|0?[1-9])\s*(?:a\.?m\.?|p\.?m\.?)\b/giu;
const QUANTITY_SUFFIX = /^\s*(?:x\b|pieces?\b|pcs?\b|items?\b|units?\b|packs?\b|bottles?\b|cans?\b|servings?\b|sets?\b|kg\b|g\b|grams?\b|ml\b|lit(?:er|re)s?\b)/iu;
const DATE_PATTERNS = [
  /\b20\d{2}-\d{1,2}-\d{1,2}\b/giu,
  /\b\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?\b/giu,
  /\b\d+\s+(?:days?|weeks?)\s+ago\b/giu,
  /\b(?:in\s+\d+\s+(?:days?|weeks?)|\d+\s+(?:days?|weeks?)\s+from\s+now)\b/giu,
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{4})?\b/giu,
];
const MERCHANT_DIGIT_PATTERN = /\b7[- ]?eleven\b/giu;
const WORD_BOUNDARY = String.raw`(?<![\p{L}\p{N}_])`;

function findSpans(text: string, pattern: RegExp, kind: NumberAmbiguityKind): Span[] {
  pattern.lastIndex = 0;
  return [...text.matchAll(pattern)].map((match) => ({
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
    kind,
  }));
}

function overlap(start: number, end: number, span: Span): boolean {
  return start < span.end && end > span.start;
}

function collectNonMoneySpans(text: string): Span[] {
  const spans = [
    ...findSpans(text, TIME_PATTERN, "time"),
    ...DATE_PATTERNS.flatMap((pattern) => findSpans(text, pattern, "date")),
    ...findSpans(text, MERCHANT_DIGIT_PATTERN, "merchant_digit"),
  ];

  return spans.sort((a, b) => a.start - b.start || b.end - a.end);
}

function toCentavos(rawNumber: string, scale: string | undefined): bigint {
  const [whole = "0", fraction = ""] = rawNumber.replace(/,/g, "").split(".");
  let amount = BigInt(whole) * 100n + BigInt((fraction + "00").slice(0, 2));
  if (scale?.toLowerCase() === "k") amount *= 1_000n;
  if (scale?.toLowerCase() === "m") amount *= 1_000_000n;
  return amount;
}

function wordPattern(value: string): RegExp {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`${WORD_BOUNDARY}${escaped}(?![\\p{L}\\p{N}_])`, "giu");
}

function collectTagalogCandidates(text: string): MoneyCandidate[] {
  const candidates: MoneyCandidate[] = [];
  const unitEntries = Object.entries(TAGALOG_UNIT_WORDS);
  const multiplierEntries = Object.entries(TAGALOG_NUMBER_WORDS)
    .filter(([word, value]) => value < 100 && !["daan", "libo"].includes(word))
    .sort(([a], [b]) => b.length - a.length);
  const usedSpans: Span[] = [];

  for (const [unit, unitValue] of unitEntries) {
    for (const [multiplierWord, multiplier] of multiplierEntries) {
      const pattern = wordPattern(`${multiplierWord} ${unit}`);
      for (const match of text.matchAll(pattern)) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        candidates.push({
          amountCentavos: multiplier * unitValue * 100,
          start,
          end,
          raw: match[0],
          source: "tagalog",
          hasCurrencyMarker: false,
        });
        usedSpans.push({ start, end, kind: "quantity" });
      }
    }
  }

  const directAmountWords = new Set([
    "sampu", "bente", "beinte", "dalawampu", "tatlumpu", "trenta", "apatnapu",
    "singkwenta", "singkuwenta", "limampu", "animnapu", "pitumpu", "walumpu",
    "siyamnapu", "sandaan", "sangdaan", "daan", "libo",
  ]);
  for (const word of directAmountWords) {
    const value = TAGALOG_NUMBER_WORDS[word as keyof typeof TAGALOG_NUMBER_WORDS];
    if (value === undefined) continue;
    for (const match of text.matchAll(wordPattern(word))) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (usedSpans.some((span) => overlap(start, end, span))) continue;
      candidates.push({
        amountCentavos: value * 100,
        start,
        end,
        raw: match[0],
        source: "tagalog",
        hasCurrencyMarker: false,
      });
    }
  }

  return candidates;
}

/** Extract every plausible money amount, preserving offsets into the original input. */
export function extractMoneyCandidates(input: string, options: MoneyExtractionOptions = {}): MoneyExtraction {
  const candidates: MoneyCandidate[] = [];
  const ambiguities: NumberAmbiguity[] = [];
  const excludedSpans = collectNonMoneySpans(input);
  const numericMatches: Array<MoneyCandidate & { scale?: string; explicitUnit?: boolean }> = [];

  MONEY_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MONEY_PATTERN.exec(input)) !== null) {
    const raw = match[0];
    const start = match.index ?? 0;
    const groups = match.groups;
    const number = groups?.number;
    if (!number) continue;
    const numberOffset = raw.indexOf(number);
    const numberStart = start + numberOffset;
    const numberEnd = numberStart + number.length;
    const end = start + raw.length;
    const hasCurrencyMarker = Boolean(groups?.currency || groups?.unit);
    const hasScale = Boolean(groups?.scale);
    const excluded = excludedSpans.find((span) => overlap(numberStart, numberEnd, span));
    if (excluded) {
      ambiguities.push({
        kind: excluded.kind,
        start: excluded.start,
        end: excluded.end,
        raw: input.slice(excluded.start, excluded.end),
      });
      continue;
    }

    if (!hasCurrencyMarker && QUANTITY_SUFFIX.test(input.slice(numberEnd))) {
      ambiguities.push({ kind: "quantity", start, end, raw: input.slice(start, end) });
      continue;
    }

    const boundaryPosition = groups?.currency ? start : numberStart;
    const previousCharacter = input[boundaryPosition - 1];
    const nextCharacter = input[numberEnd];
    if (previousCharacter && /[\p{L}\p{N}_]/u.test(previousCharacter) && !options.allowConcatenatedWords) continue;
    if (
      nextCharacter
      && /[\p{L}\p{N}_]/u.test(nextCharacter)
      && !hasScale
      && !groups?.unit
      && !options.allowConcatenatedWords
    ) {
      let continuationEnd = numberEnd;
      while (continuationEnd < input.length && /[\p{L}\p{N}_]/u.test(input[continuationEnd])) continuationEnd++;
      MONEY_PATTERN.lastIndex = Math.max(MONEY_PATTERN.lastIndex, continuationEnd);
      continue;
    }

    const signedPrefix = input.slice(Math.max(0, start - 16), start);
    const signedNumberPrefix = input.slice(Math.max(0, numberStart - 16), numberStart);
    if (/-\s*(?:₱|php|p|\$)?\s*$/iu.test(signedPrefix) || /-\s*$/u.test(signedNumberPrefix)) {
      ambiguities.push({ kind: "negative", start: start, end, raw: input.slice(start, end) });
      continue;
    }

    const amount = toCentavos(number, groups?.scale);
    if (amount > BigInt(Number.MAX_SAFE_INTEGER)) {
      ambiguities.push({ kind: "huge_amount", start, end, raw: input.slice(start, end) });
      continue;
    }

    numericMatches.push({
      amountCentavos: Number(amount),
      start,
      end,
      raw: input.slice(start, end),
      source: "numeric",
      hasCurrencyMarker,
      scale: groups?.scale,
      explicitUnit: Boolean(groups?.unit),
    });
  }

  const quantitySpans: Span[] = [];
  for (let index = 0; index < numericMatches.length - 1; index++) {
    const current = numericMatches[index];
    const next = numericMatches[index + 1];
    if (current.hasCurrencyMarker || current.scale || current.explicitUnit) continue;
    const quantityValue = current.amountCentavos / 100;
    if (!Number.isInteger(quantityValue) || quantityValue > KUPI_CONFIG.parser.maximumQuantityCount) continue;
    const between = input.slice(current.end, next.start);
    if (/^\s+[\p{L}][\p{L}\p{M}'’-]*(?:\s+[\p{L}][\p{L}\p{M}'’-]*)*\s+$/u.test(between)) {
      quantitySpans.push({ start: current.start, end: current.end, kind: "quantity" });
      ambiguities.push({ kind: "quantity", start: current.start, end: current.end, raw: current.raw });
    }
  }

  for (const candidate of numericMatches) {
    if (!quantitySpans.some((span) => overlap(candidate.start, candidate.end, span))) {
      candidates.push(candidate);
    }
  }

  candidates.push(...collectTagalogCandidates(input));
  for (const span of excludedSpans.filter(({ kind }) => kind === "merchant_digit")) {
    ambiguities.push({ kind: span.kind, start: span.start, end: span.end, raw: input.slice(span.start, span.end) });
  }

  const uniqueAmbiguities = new Map<string, NumberAmbiguity>();
  for (const ambiguity of ambiguities) {
    uniqueAmbiguities.set(`${ambiguity.kind}:${ambiguity.start}:${ambiguity.end}`, ambiguity);
  }

  return {
    candidates: candidates.sort((a, b) => a.start - b.start || a.end - b.end),
    ambiguities: [...uniqueAmbiguities.values()].sort((a, b) => a.start - b.start || a.end - b.end),
  };
}

