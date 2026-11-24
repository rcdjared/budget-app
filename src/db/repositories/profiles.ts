import { DEFAULT_NOTIFICATION_PREFERENCES, loadAppSettings } from "@/lib/settings";
import type { NotificationPreferences, Profile } from "@/domain/types";
import { db, withoutOutbox } from "../schema";

export const ACTIVE_PROFILE_STORAGE_KEY = "kupit-active-profile-id";
export const SESSION_ACTIVE_PROFILE_STORAGE_KEY = "kupit-session-active-profile-id";

const PROFILE_OWNED_TABLES = [
  "accounts",
  "categories",
  "transactions",
  "budgets",
  "goals",
  "debts",
  "recurring",
  "quickNotes",
  "splitGroups",
  "streaks",
  "friends",
  "friendLedger",
  "localSplits",
  "recurringSkips",
  "sharedBills",
  "inboxNotifications",
  "kupiMerchantRules",
  "settings",
] as const;

function now(): string {
  return new Date().toISOString();
}

export type ProfileNameError = "required" | "tooLong" | "duplicate" | null;

export function validateProfileName(
  value: string,
  profiles: Profile[],
  excludeProfileId?: string
): ProfileNameError {
  const name = value.trim();
  if (!name) return "required";
  if (name.length > 24) return "tooLong";
  if (profiles.some((profile) =>
    profile.id !== excludeProfileId && profile.name.trim().toLowerCase() === name.toLowerCase()
  )) return "duplicate";
  return null;
}

export async function getAllProfiles(): Promise<Profile[]> {
  return db.profiles.filter((profile) => !profile.deletedAt).toArray();
}

export async function getDefaultProfile(): Promise<Profile | undefined> {
  const profiles = await getAllProfiles();
  return profiles.find((profile) => profile.isDefault);
}

export async function getProfileById(id: string): Promise<Profile | undefined> {
  return db.profiles.get(id);
}

export async function getActiveProfileId(): Promise<string | null> {
  const storedId = sessionStorage.getItem(SESSION_ACTIVE_PROFILE_STORAGE_KEY)
    || localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY);
  const storedProfile = storedId ? await db.profiles.get(storedId) : undefined;
  if (storedProfile && !storedProfile.deletedAt) return storedProfile.id;
  const active = await getDefaultProfile();
  return active?.id || null;
}

export async function createProfile(
  data: Omit<Profile, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  const id = crypto.randomUUID();
  const timestamp = now();
  await withoutOutbox(() => db.transaction("rw", db.profiles, async () => {
    const profiles = await getAllProfiles();
    if (profiles.length >= 4) throw new Error("profile-limit");
    const nameError = validateProfileName(data.name, profiles);
    if (nameError) throw new Error(`profile-name-${nameError}`);
    await db.profiles.add({
      ...data,
      name: data.name.trim(),
      id,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }));
  return id;
}

export async function updateProfile(id: string, data: Partial<Profile>): Promise<void> {
  const updated = await withoutOutbox(() => db.profiles.update(id, { ...data, updatedAt: now() }));
  if (!updated) throw new Error("profile-not-found");
}

export async function renameProfile(id: string, name: string): Promise<void> {
  await withoutOutbox(() => db.transaction("rw", db.profiles, async () => {
    const profiles = await getAllProfiles();
    const nameError = validateProfileName(name, profiles, id);
    if (nameError) throw new Error(`profile-name-${nameError}`);
    const updated = await db.profiles.update(id, { name: name.trim(), updatedAt: now() });
    if (!updated) throw new Error("profile-not-found");
  }));
}

export async function setActiveProfile(id: string): Promise<void> {
  const target = await db.profiles.get(id);
  if (!target || target.deletedAt) throw new Error("profile-not-found");
  await withoutOutbox(() => db.transaction("rw", db.profiles, async () => {
    await db.profiles.toCollection().modify((profile) => {
      if (!profile.deletedAt) profile.isDefault = profile.id === id;
    });
  }));
  sessionStorage.setItem(SESSION_ACTIVE_PROFILE_STORAGE_KEY, id);
  localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, id);
}

export async function getProfileNotificationPreferences(id: string): Promise<NotificationPreferences> {
  const profile = await db.profiles.get(id);
  if (!profile || profile.deletedAt) throw new Error("profile-not-found");
  const stored = profile?.notificationPreferences;
  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...stored,
    categories: {
      ...DEFAULT_NOTIFICATION_PREFERENCES.categories,
      ...stored?.categories,
    },
  };
}

export async function updateProfileNotificationPreferences(
  id: string,
  patch: Partial<NotificationPreferences>
): Promise<NotificationPreferences> {
  const current = await getProfileNotificationPreferences(id);
  const next = {
    ...current,
    ...patch,
    categories: { ...current.categories, ...patch.categories },
  };
  await updateProfile(id, { notificationPreferences: next });
  return next;
}

export async function deleteProfile(id: string): Promise<string | null> {
  let fallbackProfileId: string | null = null;
  const sessionProfileId = sessionStorage.getItem(SESSION_ACTIVE_PROFILE_STORAGE_KEY);
  const deviceProfileId = localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY);
  const profile = await db.profiles.get(id);
  if (!profile || profile.deletedAt) throw new Error("profile-not-found");
  const isActiveProfile = sessionProfileId === id
    || (!sessionProfileId && deviceProfileId === id)
    || (!sessionProfileId && !deviceProfileId && profile.isDefault);

  await withoutOutbox(() => db.transaction("rw", db.tables, async () => {
    const profiles = await getAllProfiles();
    if (profiles.length <= 1) throw new Error("profile-last");
    if (isActiveProfile) {
      fallbackProfileId = profiles.find((candidate) => candidate.id !== id)?.id || null;
      if (!fallbackProfileId) throw new Error("profile-last");
      await db.profiles.toCollection().modify((candidate) => {
        if (!candidate.deletedAt) candidate.isDefault = candidate.id === fallbackProfileId;
      });
    }

    const recordIds = new Set<string>([id]);
    const transactionIds = await db.transactions.where({ profileId: id }).primaryKeys();
    const accountIds = await db.accounts.where({ profileId: id }).primaryKeys();
    const splitGroupIds = await db.splitGroups.where({ profileId: id }).primaryKeys();
    const sharedBillIds = await db.sharedBills.where({ profileId: id }).primaryKeys();

    for (const tableName of PROFILE_OWNED_TABLES) {
      const table = db.table(tableName);
      const rows = await table.where("profileId").equals(id).toArray() as { id: string }[];
      rows.forEach((row) => recordIds.add(row.id));
      await table.bulkDelete(rows.map((row) => row.id));
    }

    if (transactionIds.length) {
      const attachmentRows = await db.attachments.where("transactionId").anyOf(transactionIds).toArray();
      attachmentRows.forEach((row) => recordIds.add(row.id));
      await db.attachments.bulkDelete(attachmentRows.map((row) => row.id));
    }
    if (accountIds.length) {
      const holdingRows = await db.holdings.where("accountId").anyOf(accountIds).toArray();
      holdingRows.forEach((row) => recordIds.add(row.id));
      await db.holdings.bulkDelete(holdingRows.map((row) => row.id));
    }
    if (splitGroupIds.length) {
      const memberRows = await db.splitMembers.where("splitGroupId").anyOf(splitGroupIds).toArray();
      memberRows.forEach((row) => recordIds.add(row.id));
      await db.splitMembers.bulkDelete(memberRows.map((row) => row.id));
    }
    if (sharedBillIds.length) {
      const memberRows = await db.sharedBillMembers.where("sharedBillId").anyOf(sharedBillIds).toArray();
      memberRows.forEach((row) => recordIds.add(row.id));
      await db.sharedBillMembers.bulkDelete(memberRows.map((row) => row.id));
    }

    await db.outbox.filter((entry) => {
      if (recordIds.has(entry.recordId)) return true;
      try {
        return JSON.parse(entry.payload).profileId === id;
      } catch {
        return false;
      }
    }).delete();
    await db.profiles.delete(id);
  }));
  if (fallbackProfileId) {
    sessionStorage.setItem(SESSION_ACTIVE_PROFILE_STORAGE_KEY, fallbackProfileId);
    localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, fallbackProfileId);
  }
  localStorage.removeItem(`kupit-assistant-learning-${id}`);
  return fallbackProfileId;
}

async function findLegacyProfileId(): Promise<string | undefined> {
  for (const tableName of PROFILE_OWNED_TABLES) {
    const record = await db.table(tableName).toCollection().first() as { profileId?: string } | undefined;
    if (record?.profileId) return record.profileId;
  }
  return undefined;
}

/** Create or migrate the first local profile and restore the active selection. */
export async function ensureDefaultProfile(): Promise<Profile> {
  const existing = await getAllProfiles();
  const storedId = sessionStorage.getItem(SESSION_ACTIVE_PROFILE_STORAGE_KEY)
    || localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY);
  const selected = existing.find((profile) => profile.id === storedId)
    || existing.find((profile) => profile.isDefault)
    || existing[0];

  if (selected) {
    const shouldRename = existing.length === 1 && selected.name.trim().toLocaleLowerCase() === "personal";
    const migratedPreferences = selected.notificationPreferences || loadAppSettings().notifications;
    await withoutOutbox(() => db.transaction("rw", db.profiles, async () => {
      await db.profiles.toCollection().modify((profile) => {
        if (!profile.deletedAt) profile.isDefault = profile.id === selected.id;
      });
      if (shouldRename || !selected.notificationPreferences) {
        await db.profiles.update(selected.id, {
          ...(shouldRename ? { name: "Profile 1" } : {}),
          notificationPreferences: migratedPreferences,
          updatedAt: now(),
        });
      }
    }));
    sessionStorage.setItem(SESSION_ACTIVE_PROFILE_STORAGE_KEY, selected.id);
    localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, selected.id);
    return {
      ...selected,
      name: shouldRename ? "Profile 1" : selected.name,
      notificationPreferences: migratedPreferences,
      isDefault: true,
    };
  }

  const id = await findLegacyProfileId() || crypto.randomUUID();
  const timestamp = now();
  const profile: Profile = {
    id,
    name: "Profile 1",
    currency: "PHP",
    isDefault: true,
    preferredName: null,
    notificationPreferences: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await withoutOutbox(() => db.transaction("rw", db.tables, async () => {
    for (const table of db.tables) {
      if (["profiles", "outbox", "priceCache", "holdings", "attachments", "splitMembers", "sharedBillMembers"].includes(table.name)) continue;
      if (!table.schema.indexes.some((index) => index.name === "profileId")) continue;
      await table.toCollection().modify((record: unknown) => {
        if (record && typeof record === "object" && "profileId" in record && (record as { profileId?: string }).profileId) {
          (record as { profileId: string }).profileId = id;
        }
      });
    }
    await db.profiles.add(profile);
  }));
  sessionStorage.setItem(SESSION_ACTIVE_PROFILE_STORAGE_KEY, id);
  localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, id);
  return profile;
}
