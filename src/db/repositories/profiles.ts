// Profile repository — manage data silos (Personal, Family, Business)

import { db } from "../schema";
import type { Profile } from "@/domain/types";

function now(): string {
  return new Date().toISOString();
}

export async function getAllProfiles(): Promise<Profile[]> {
  return db.profiles.filter((p) => !p.deletedAt).toArray();
}

export async function getDefaultProfile(): Promise<Profile | undefined> {
  const profiles = await getAllProfiles();
  return profiles.find((profile) => profile.isDefault);
}

export async function getProfileById(
  id: string
): Promise<Profile | undefined> {
  return db.profiles.get(id);
}

export async function createProfile(
  data: Omit<Profile, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  const id = crypto.randomUUID();
  const timestamp = now();
  await db.profiles.add({
    ...data,
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return id;
}

export async function updateProfile(
  id: string,
  data: Partial<Profile>
): Promise<void> {
  await db.profiles.update(id, { ...data, updatedAt: now() });
}

/** Ensure a default profile exists; create one if not */
export async function ensureDefaultProfile(): Promise<Profile> {
  const existing = await getAllProfiles();
  const defaultProfile = existing.find((p) => p.isDefault);
  if (defaultProfile) return defaultProfile;

  const id = crypto.randomUUID();
  const timestamp = now();
  const profile: Profile = {
    id,
    name: "Personal",
    currency: "PHP",
    isDefault: true,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.profiles.add(profile);
  return profile;
}
