export type SplitMode = "equal" | "exact" | "percent";

export interface SplitShareInput {
  id: string;
  isMe: boolean;
  amount?: number;
  percentHundredths?: number;
}

export function distributeEqualSplit(totalCentavos: number, participantCount: number): number[] {
  if (!Number.isInteger(totalCentavos) || totalCentavos < 0) throw new Error("Total must be integer centavos.");
  if (!Number.isInteger(participantCount) || participantCount < 1) throw new Error("Participant count must be positive.");
  const base = Math.floor(totalCentavos / participantCount);
  let remainder = totalCentavos - base * participantCount;
  return Array.from({ length: participantCount }, (_, index) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return base + extra;
  });
}

export function distributePercentSplit(
  totalCentavos: number,
  percentHundredths: number[]
): number[] {
  if (!percentHundredths.length) return [];
  const totalPercent = percentHundredths.reduce((sum, value) => sum + value, 0);
  if (totalPercent !== 10_000) throw new Error("Percent shares must add up to 100%.");
  let allocated = 0;
  const shares = percentHundredths.map((percent, index) => {
    if (index === percentHundredths.length - 1) {
      return totalCentavos - allocated;
    }
    const share = Math.floor((totalCentavos * percent) / 10_000);
    allocated += share;
    return share;
  });
  return shares;
}

export function validateExactShares(totalCentavos: number, shares: number[]): boolean {
  return shares.every((share) => Number.isInteger(share) && share >= 0)
    && shares.reduce((sum, share) => sum + share, 0) === totalCentavos;
}
