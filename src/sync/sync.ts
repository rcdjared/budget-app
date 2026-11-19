import type { SupabaseClient } from "@supabase/supabase-js";
import { db, applyRemoteChanges, withoutOutbox } from "@/db/schema";
import type { Attachment, OutboxEntry } from "@/domain/types";

const SYNC_TABLES = [
  "profiles",
  "accounts",
  "categories",
  "transactions",
  "budgets",
  "goals",
  "debts",
  "recurring",
  "holdings",
  "quickNotes",
  "splitGroups",
  "splitMembers",
  "streaks",
  "attachments",
  "settings",
] as const;

type CloudRecord = {
  table_name: string;
  record_id: string;
  payload: Record<string, unknown>;
  updated_at: string;
  deleted_at: string | null;
};

function toCloudRecord(table: string, record: Record<string, unknown>): CloudRecord {
  const { blob: _localBlob, ...payload } = record;
  const updatedAt =
    typeof record.updatedAt === "string" ? record.updatedAt : new Date().toISOString();
  return {
    table_name: table,
    record_id: String(record.id),
    payload,
    updated_at: updatedAt,
    deleted_at: typeof record.deletedAt === "string" ? record.deletedAt : null,
  };
}

async function uploadAttachment(
  supabase: SupabaseClient,
  userId: string,
  record: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const attachment = record as unknown as Attachment;
  if (!(attachment.blob instanceof Blob)) return record;
  const extension = attachment.blob.type.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";
  const path = `${userId}/${attachment.id}.${extension}`;
  const { error } = await supabase.storage
    .from("receipts")
    .upload(path, attachment.blob, { upsert: true, contentType: attachment.blob.type });
  if (error) throw new Error(`Receipt upload failed: ${error.message}`);
  const updated = { ...record, storagePath: path, updatedAt: new Date().toISOString() };
  await withoutOutbox(() => db.attachments.put(updated as Attachment));
  return updated;
}

async function pushRecord(
  supabase: SupabaseClient,
  userId: string,
  table: string,
  record: Record<string, unknown>
): Promise<void> {
  const uploadReady =
    table === "attachments" ? await uploadAttachment(supabase, userId, record) : record;
  const { data, error } = await supabase.rpc("apply_cloud_record", {
    p_table_name: table,
    p_record_id: String(uploadReady.id),
    p_payload: toCloudRecord(table, uploadReady).payload,
    p_updated_at: toCloudRecord(table, uploadReady).updated_at,
    p_deleted_at: toCloudRecord(table, uploadReady).deleted_at,
  });
  if (error) throw new Error(`Cloud sync failed for ${table}: ${error.message}`);
  if (data === false) return;
}

async function pushPending(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  const entries = await db.outbox
    .where("status")
    .anyOf("pending", "failed")
    .sortBy("createdAt");
  for (const entry of entries) {
    try {
      await db.outbox.update(entry.id, { status: "syncing", updatedAt: new Date().toISOString() });
      const payload = entry.table === "attachments"
        ? (await db.attachments.get(entry.recordId) as Record<string, unknown> | undefined) ||
          JSON.parse(entry.payload) as Record<string, unknown>
        : JSON.parse(entry.payload) as Record<string, unknown>;
      await pushRecord(supabase, userId, entry.table, payload);
      await db.outbox.update(entry.id, { status: "synced", updatedAt: new Date().toISOString() });
    } catch (error) {
      await db.outbox.update(entry.id, { status: "failed", updatedAt: new Date().toISOString() });
      throw error;
    }
  }
}

async function pushInitialLocalData(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  for (const tableName of SYNC_TABLES) {
    let records = await db.table(tableName).toArray() as Record<string, unknown>[];
    if (tableName === "settings") {
      records = records.filter(
        (record) => !/^(cloud-|dailyBackup)/.test(String(record.key || ""))
      );
    }
    for (const record of records) {
      await pushRecord(supabase, userId, tableName, record);
    }
  }
  await db.settings.put({
    id: `cloud-initialized:${userId}`,
    key: `cloud-initialized:${userId}`,
    value: "true",
  });
}

async function pullRecords(
  supabase: SupabaseClient,
  lastSyncedAt: string | null
): Promise<CloudRecord[]> {
  const rows: CloudRecord[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = supabase
      .from("cloud_records")
      .select("table_name,record_id,payload,updated_at,deleted_at")
      .order("updated_at", { ascending: true })
      .range(offset, offset + 999);
    if (lastSyncedAt) query = query.gte("updated_at", lastSyncedAt);
    const { data, error } = await query;
    if (error) throw new Error(`Cloud download failed: ${error.message}`);
    rows.push(...((data || []) as CloudRecord[]));
    if (!data || data.length < 1000) return rows;
  }
}

export async function syncLocalData(
  supabase: SupabaseClient,
  userId: string
): Promise<void> {
  if (!navigator.onLine) throw new Error("Connect to the internet before syncing.");
  const cursorId = `cloud-last-sync:${userId}`;
  const lastSyncedSetting = await db.settings.get(cursorId);
  const lastSyncedAt = lastSyncedSetting ? JSON.parse(lastSyncedSetting.value).iso as string : null;
  const initialSetting = await db.settings.get(`cloud-initialized:${userId}`);

  if (!initialSetting) await pushInitialLocalData(supabase, userId);
  await pushPending(supabase, userId);

  const rows = await pullRecords(supabase, lastSyncedAt);
  const changes = rows
    .filter((row) => SYNC_TABLES.includes(row.table_name as (typeof SYNC_TABLES)[number]))
    .map((row) => ({
      table: row.table_name,
      record: {
        ...row.payload,
        id: row.record_id,
        updatedAt: row.updated_at,
        deletedAt: row.deleted_at,
      },
    }));
  await applyRemoteChanges(changes);

  const latestCloudChange = rows.reduce<string | null>(
    (latest, row) => !latest || row.updated_at > latest ? row.updated_at : latest,
    lastSyncedAt
  );
  await db.settings.put({
    id: cursorId,
    key: cursorId,
    value: JSON.stringify({ iso: latestCloudChange || new Date().toISOString() }),
  });
}
