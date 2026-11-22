// Account repository — CRUD for cash, bank, e-wallet, credit card, etc.

import { db } from "../schema";
import { getProfileRecord, profileRecords } from "../profileScope";
import type { Account } from "@/domain/types";

function now(): string {
  return new Date().toISOString();
}

export async function getAccountsByProfile(
  profileId: string
): Promise<Account[]> {
  return profileRecords(db.accounts, profileId)
    .filter((a) => !a.deletedAt)
    .toArray();
}

export async function getActiveAccounts(
  profileId: string
): Promise<Account[]> {
  return profileRecords(db.accounts, profileId)
    .filter((a) => !a.deletedAt && !a.isArchived)
    .toArray();
}

export async function getAccountById(
  id: string,
  profileId: string
): Promise<Account | undefined> {
  return getProfileRecord(db.accounts, id, profileId);
}

export async function createAccount(
  data: Omit<Account, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  const id = crypto.randomUUID();
  const timestamp = now();
  await db.accounts.add({
    ...data,
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return id;
}

export async function updateAccount(
  id: string,
  profileId: string,
  data: Partial<Account>
): Promise<void> {
  if (!await getProfileRecord(db.accounts, id, profileId)) throw new Error("Account not found.");
  if (data.profileId && data.profileId !== profileId) throw new Error("Account profile cannot be changed.");
  await db.accounts.update(id, { ...data, profileId, updatedAt: now() });
}

export async function archiveAccount(id: string, profileId: string): Promise<void> {
  if (!await getProfileRecord(db.accounts, id, profileId)) throw new Error("Account not found.");
  await db.accounts.update(id, { isArchived: true, updatedAt: now() });
}

export async function softDeleteAccount(id: string, profileId: string): Promise<void> {
  if (!await getProfileRecord(db.accounts, id, profileId)) throw new Error("Account not found.");
  await db.accounts.update(id, { deletedAt: now(), updatedAt: now() });
}

