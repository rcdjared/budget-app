export type TokenKind = "word" | "number" | "currency" | "punctuation";

export interface KupiToken {
  value: string;
  kind: TokenKind;
  start: number;
  end: number;
}

export interface NormalizedInput {
  original: string;
  text: string;
  tokens: KupiToken[];
}

const TOKEN_PATTERN = /₱|php\b|pesos?\b|pisos?\b|p(?=\s*\d)|[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\s]/giu;
const CURRENCY_PATTERN = /₱|php\b|pesos?\b|pisos?\b|p(?=\s*\d)/giu;

function isCurrencyMarker(value: string, input: string, start: number): boolean {
  if (/^₱$/u.test(value)) return true;
  if (!/^(?:php|pesos?|pisos?|p)$/i.test(value)) return false;
  return start === 0 || !/[\p{L}\p{N}_]/u.test(input[start - 1]);
}

function normalizeCurrencyMarkers(input: string): string {
  return input.replace(CURRENCY_PATTERN, (marker, offset: number, source: string) => {
    if (offset > 0 && /[\p{L}\p{N}_]/u.test(source[offset - 1])) {
      return marker.toLowerCase();
    }
    return "₱";
  });
}

/** Lowercase, unify peso spellings, and collapse whitespace without losing source spans. */
export function normalizeKupiInput(input: string): NormalizedInput {
  const tokens: KupiToken[] = [];

  for (const match of input.matchAll(TOKEN_PATTERN)) {
    const raw = match[0];
    const start = match.index ?? 0;
    const value = isCurrencyMarker(raw, input, start) ? "₱" : raw.toLowerCase();
    const kind: TokenKind = value === "₱"
      ? "currency"
      : /^\p{N}+$/u.test(value)
        ? "number"
        : /^[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*$/u.test(value)
          ? "word"
          : "punctuation";
    tokens.push({ value, kind, start, end: start + raw.length });
  }

  return {
    original: input,
    text: normalizeCurrencyMarkers(input).toLowerCase().trim().replace(/\s+/g, " "),
    tokens,
  };
}
