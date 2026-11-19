import { db } from "@/db/schema";

const TABLE_NAMES = [
  "profiles",
  "accounts",
  "categories",
  "transactions",
  "budgets",
  "goals",
] as const;

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportJsonBackup(): Promise<void> {
  const data: Record<string, unknown[]> = { exportedAt: [] };
  data.exportedAt = [{ iso: new Date().toISOString(), app: "Kupit" }];
  for (const table of TABLE_NAMES) {
    data[table] = await db.table(table).toArray();
  }
  downloadBlob(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    `kupit-backup-${new Date().toISOString().slice(0, 10)}.json`
  );
}

export async function exportTransactionsCsv(): Promise<void> {
  const transactions = await db.transactions.toArray();
  const accounts = await db.accounts.toArray();
  const categories = await db.categories.toArray();
  const rows = [
    ["Date", "Type", "Amount (PHP)", "Account", "Category", "Note"],
    ...transactions.map((tx) => [
      tx.date,
      tx.type,
      (tx.amount / 100).toFixed(2),
      accounts.find((a) => a.id === tx.accountId)?.name || "",
      categories.find((c) => c.id === tx.categoryId)?.name || "",
      tx.note || "",
    ]),
  ];
  const csv = rows
    .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))
    .join("\n");
  downloadBlob(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    `kupit-transactions-${new Date().toISOString().slice(0, 10)}.csv`
  );
}

export async function importJsonBackup(file: File): Promise<number> {
  const data = JSON.parse(await file.text()) as Record<string, unknown[]>;
  let imported = 0;
  for (const table of TABLE_NAMES) {
    const rows = data[table];
    if (!Array.isArray(rows) || rows.length === 0) continue;
    await db.table(table).bulkPut(rows);
    imported += rows.length;
  }
  return imported;
}

export async function ensureDailySnapshot(): Promise<void> {
  const existing = await db.settings
    .filter((setting) => setting.key.startsWith("dailyBackup:"))
    .sortBy("key");
  const latest = existing.at(-1);
  const last = latest ? JSON.parse(latest.value).iso as string : null;
  if (last && Date.now() - new Date(last).getTime() < 24 * 60 * 60 * 1000) return;

  const snapshot: Record<string, unknown[]> = {};
  for (const table of TABLE_NAMES) snapshot[table] = await db.table(table).toArray();
  await db.settings.add({
    id: crypto.randomUUID(),
    key: `dailyBackup:${new Date().toISOString()}`,
    value: JSON.stringify({ iso: new Date().toISOString(), snapshot }),
  });
  if (existing.length >= 7) {
    await db.settings.bulkDelete(existing.slice(0, existing.length - 6).map((item) => item.id));
  }
}
