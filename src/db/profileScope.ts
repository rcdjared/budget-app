import type { EntityTable, IDType } from "dexie";

/** Access profile-owned records through one shared scope boundary. */
export function profileRecords<T extends { id: string; profileId: string }, Key>(
  table: EntityTable<T, "id">,
  profileId: string
) {
  return table.where("profileId").equals(profileId);
}

export async function getProfileRecord<T extends { id: string; profileId: string }>(
  table: EntityTable<T, "id">,
  id: IDType<T, "id">,
  profileId: string
): Promise<T | undefined> {
  const record = await table.get(id);
  return record?.profileId === profileId ? record : undefined;
}
