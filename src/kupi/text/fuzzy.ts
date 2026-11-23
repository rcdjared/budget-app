import { KUPI_CONFIG } from "../contracts";

export interface FuzzyCandidate {
  id: string;
  name: string;
  aliases?: readonly string[];
}

export interface FuzzyMatch {
  candidate: FuzzyCandidate;
  matchedAlias: string;
  score: number;
  distance: number;
}

function normalize(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function damerauLevenshtein(left: string, right: string, maximumDistance: number): number {
  if (Math.abs(left.length - right.length) > maximumDistance) return maximumDistance + 1;

  const rows = left.length + 1;
  const columns = right.length + 1;
  const distance: number[][] = Array.from({ length: rows }, () => Array<number>(columns).fill(0));
  for (let row = 0; row < rows; row++) distance[row][0] = row;
  for (let column = 0; column < columns; column++) distance[0][column] = column;

  for (let row = 1; row < rows; row++) {
    let rowMinimum = maximumDistance + 1;
    for (let column = 1; column < columns; column++) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1;
      let value = Math.min(
        distance[row - 1][column] + 1,
        distance[row][column - 1] + 1,
        distance[row - 1][column - 1] + substitutionCost
      );

      if (
        row > 1
        && column > 1
        && left[row - 1] === right[column - 2]
        && left[row - 2] === right[column - 1]
      ) {
        value = Math.min(value, distance[row - 2][column - 2] + substitutionCost);
      }

      distance[row][column] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }

    if (rowMinimum > maximumDistance) return maximumDistance + 1;
  }

  return distance[left.length][right.length];
}

/** Rank close matches without inventing a value; candidates should be live profile records. */
export function rankFuzzyMatches(
  query: string,
  candidates: readonly FuzzyCandidate[]
): FuzzyMatch[] {
  const normalizedQuery = normalize(query);
  const maximumLength = KUPI_CONFIG.fuzzy.maximumCandidateLength;
  if (!normalizedQuery || normalizedQuery.length > maximumLength) return [];

  const ranked: FuzzyMatch[] = [];
  for (const candidate of candidates) {
    const terms = [candidate.name, ...(candidate.aliases ?? [])];
    let best: FuzzyMatch | undefined;

    for (const term of terms) {
      const normalizedTerm = normalize(term);
      if (!normalizedTerm || normalizedTerm.length > maximumLength) continue;

      const maxLength = Math.max(normalizedQuery.length, normalizedTerm.length);
      const maximumDistance = Math.floor((1 - KUPI_CONFIG.fuzzy.minimumAliasScore) * maxLength);
      const distance = damerauLevenshtein(normalizedQuery, normalizedTerm, maximumDistance);
      const score = 1 - distance / maxLength;
      if (score < KUPI_CONFIG.fuzzy.minimumAliasScore) continue;
      if (!best || score > best.score) {
        best = { candidate, matchedAlias: term, score, distance };
      }
    }

    if (best) ranked.push(best);
  }

  return ranked.sort((a, b) =>
    b.score - a.score
    || a.candidate.name.localeCompare(b.candidate.name)
    || a.candidate.id.localeCompare(b.candidate.id)
  );
}
