import type { Account, KupiMerchantRule, Transaction } from "@/domain/types";

export function normalizeLearningSource(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/giu, " ").replace(/\s+/gu, " ");
}

export function findMerchantCategoryRule(
  rules: readonly KupiMerchantRule[],
  merchant: string
): KupiMerchantRule | undefined {
  const source = normalizeLearningSource(merchant);
  if (!source) return undefined;
  return rules.find((rule) =>
    rule.enabled
    && !rule.deletedAt
    && rule.kind === "merchant_category"
    && (source === normalizeLearningSource(rule.source) || source.includes(normalizeLearningSource(rule.source)))
  );
}

export function findAccountAliasRule(
  rules: readonly KupiMerchantRule[],
  alias: string
): KupiMerchantRule | undefined {
  const source = normalizeLearningSource(alias);
  return rules.find((rule) =>
    rule.enabled
    && !rule.deletedAt
    && rule.kind === "account_alias"
    && normalizeLearningSource(rule.source) === source
  );
}

export function mostUsedAccount(
  accounts: readonly Account[],
  transactions: readonly Transaction[]
): Account | undefined {
  if (!accounts.length) return undefined;
  const counts = new Map<string, number>();
  for (const transaction of transactions) {
    if (transaction.deletedAt || transaction.cancelledAt) continue;
    counts.set(transaction.accountId, (counts.get(transaction.accountId) ?? 0) + 1);
  }
  const ranked = [...accounts].sort((left, right) => {
    const countDiff = (counts.get(right.id) ?? 0) - (counts.get(left.id) ?? 0);
    return countDiff || left.createdAt.localeCompare(right.createdAt);
  });
  return ranked[0];
}

export function createRule(
  profileId: string,
  kind: KupiMerchantRule["kind"],
  source: string,
  targetId: string,
  targetName: string,
  now = new Date()
): KupiMerchantRule {
  const timestamp = now.toISOString();
  return {
    id: crypto.randomUUID(),
    profileId,
    kind,
    source: normalizeLearningSource(source),
    targetId,
    targetName,
    enabled: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}
