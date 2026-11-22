// Account repository — CRUD for cash, bank, e-wallet, credit card, etc.

import { db } from "../schema";
import { profileRecords } from "../profileScope";
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
  id: string
): Promise<Account | undefined> {
  return db.accounts.get(id);
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
  data: Partial<Account>
): Promise<void> {
  await db.accounts.update(id, { ...data, updatedAt: now() });
}

export async function archiveAccount(id: string): Promise<void> {
  await db.accounts.update(id, { isArchived: true, updatedAt: now() });
}

export async function softDeleteAccount(id: string): Promise<void> {
  await db.accounts.update(id, { deletedAt: now(), updatedAt: now() });
}

