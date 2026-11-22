import { db, withoutOutbox } from "@/db/schema";
import { profileRecords } from "@/db/profileScope";

const TABLE_NAMES = [
  "profiles",
  "accounts",
  "categories",
  "transactions",
  "budgets",
  "goals",
  "debts",
  "recurring",
  "quickNotes",
  "splitGroups",
  "friends",
  "friendLedger",
  "localSplits",
  "recurringSkips",
  "sharedBills",
  "streaks",
  "settings",
  "inboxNotifications",
] as const;

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function exportJsonBackup(profileId: string): Promise<void> {
  const data: Record<string, unknown[]> = { exportedAt: [] };
  data.exportedAt = [{ iso: new Date().toISOString(), app: "Kupit" }];
  for (const table of TABLE_NAMES) {
    if (table === "profiles") {
      const profile = await db.profiles.get(profileId);
      data[table] = profile ? [profile] : [];
    } else {
      data[table] = await db.table(table).where("profileId").equals(profileId).toArray();
    }
  }
  downloadBlob(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    `kupit-backup-${new Date().toISOString().slice(0, 10)}.json`
  );
}

export async function exportTransactionsCsv(profileId: string): Promise<void> {
  const transactions = await profileRecords(db.transactions, profileId).toArray();
  const accounts = await profileRecords(db.accounts, profileId).toArray();
  const categories = await profileRecords(db.categories, profileId).toArray();
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

export async function importJsonBackup(file: File, profileId: string): Promise<number> {
  const data = JSON.parse(await file.text()) as Record<string, unknown[]>;
  let imported = 0;
  const importedAt = new Date().toISOString();
  await withoutOutbox(() => db.transaction("rw", db.tables, async () => {
    for (const table of TABLE_NAMES) {
      const rows = data[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;
      for (const value of rows) {
        if (!value || typeof value !== "object" || typeof (value as { id?: unknown }).id !== "string") continue;
        const original = value as Record<string, unknown>;
        const record = table === "profiles"
          ? { ...original, id: profileId, updatedAt: importedAt }
          : { ...original, id: String(original.id), profileId, updatedAt: importedAt };
        const existing = await db.table(table).get(record.id);
        await db.table(table).put(record);
        await db.outbox.add({
          id: crypto.randomUUID(),
          table,
          recordId: record.id as string,
          op: existing ? "update" : "create",
          payload: JSON.stringify(record),
          status: "pending",
          createdAt: importedAt,
          updatedAt: importedAt,
        });
        imported++;
      }
    }
  }));
  return imported;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\"") {
      if (quoted && text[index + 1] === "\"") {
        field += "\"";
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export async function importTransactionsCsv(file: File, profileId: string): Promise<number> {
  const rows = parseCsv(await file.text());
  if (rows.length < 2) return 0;
  const header = rows[0].map((value) => value.trim().toLowerCase());
  const dateIndex = header.findIndex((value) => value === "date");
  const typeIndex = header.findIndex((value) => value === "type");
  const amountIndex = header.findIndex((value) => value.includes("amount"));
  const accountIndex = header.findIndex((value) => value === "account");
  const categoryIndex = header.findIndex((value) => value === "category");
  const noteIndex = header.findIndex((value) => value === "note");
  if (dateIndex < 0 || typeIndex < 0 || amountIndex < 0) {
    throw new Error("CSV must include Date, Type, and Amount columns.");
  }

  const timestamp = new Date().toISOString();
  let imported = 0;
  await withoutOutbox(() => db.transaction("rw", db.tables, async () => {
    const accounts = await profileRecords(db.accounts, profileId).toArray();
    const categories = await profileRecords(db.categories, profileId).toArray();

    for (const row of rows.slice(1)) {
      const date = row[dateIndex]?.trim();
      const typeValue = row[typeIndex]?.trim().toLowerCase();
      const type = typeValue === "income" ? "income" : typeValue === "expense" ? "expense" : null;
      const amountValue = row[amountIndex]?.trim().replace(/,/g, "");
      const amount = Math.round(Number(amountValue) * 100);
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !type || !Number.isFinite(amount) || amount <= 0) continue;

      let accountId = "";
      const accountName = accountIndex >= 0 ? row[accountIndex]?.trim() : "";
      if (accountName) {
        let account = accounts.find((item) => item.name.toLowerCase() === accountName.toLowerCase());
        if (!account) {
          accountId = crypto.randomUUID();
          account = {
            id: accountId,
            profileId,
            name: accountName,
            type: "cash",
            openingBalance: 0,
            currency: "PHP",
            color: "#019B51",
            icon: "wallet",
            isArchived: false,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          await db.accounts.add(account);
          accounts.push(account);
        } else {
          accountId = account.id;
        }
      } else {
        const defaultAccount = accounts[0];
        if (!defaultAccount) {
          accountId = crypto.randomUUID();
          accounts.push({
            id: accountId,
            profileId,
            name: "Imported account",
            type: "cash",
            openingBalance: 0,
            currency: "PHP",
            color: "#019B51",
            icon: "wallet",
            isArchived: false,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
          await db.accounts.add(accounts.at(-1)!);
        } else {
          accountId = defaultAccount.id;
        }
      }

      let categoryId: string | null = null;
      const categoryName = categoryIndex >= 0 ? row[categoryIndex]?.trim() : "";
      if (categoryName) {
        let category = categories.find((item) => item.name.toLowerCase() === categoryName.toLowerCase() && item.type === type);
        if (!category) {
          categoryId = crypto.randomUUID();
          category = {
            id: categoryId,
            profileId,
            name: categoryName,
            parentId: null,
            type,
            icon: type === "income" ? "coins" : "receipt",
            color: type === "income" ? "#059669" : "#DC2626",
            sortOrder: categories.length,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          await db.categories.add(category);
          categories.push(category);
        } else {
          categoryId = category.id;
        }
      }

      await db.transactions.add({
        id: crypto.randomUUID(),
        profileId,
        type,
        amount,
        accountId,
        categoryId,
        date,
        note: noteIndex >= 0 ? row[noteIndex]?.trim() || null : null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      imported += 1;
    }
  }));
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
