// Category repository

import { db } from "../schema";
import { profileRecords } from "../profileScope";
import type { Category } from "@/domain/types";

function now(): string {
  return new Date().toISOString();
}

export async function getCategoriesByProfile(
  profileId: string
): Promise<Category[]> {
  return profileRecords(db.categories, profileId)
    .filter((c) => !c.deletedAt)
    .sortBy("sortOrder");
}

export async function getExpenseCategories(
  profileId: string
): Promise<Category[]> {
  return profileRecords(db.categories, profileId)
    .filter((c) => !c.deletedAt && c.type === "expense")
    .sortBy("sortOrder");
}

export async function getIncomeCategories(
  profileId: string
): Promise<Category[]> {
  return profileRecords(db.categories, profileId)
    .filter((c) => !c.deletedAt && c.type === "income")
    .sortBy("sortOrder");
}

/** Get parent categories only (no parentId) */
export async function getParentCategories(
  profileId: string,
  type?: "expense" | "income"
): Promise<Category[]> {
  return profileRecords(db.categories, profileId)
    .filter((c) => {
      if (c.deletedAt) return false;
      if (c.parentId) return false;
      if (type && c.type !== type) return false;
      return true;
    })
    .sortBy("sortOrder");
}

/** Get children of a parent category */
export async function getChildCategories(
  parentId: string
): Promise<Category[]> {
  return db.categories
    .where({ parentId })
    .filter((c) => !c.deletedAt)
    .sortBy("sortOrder");
}

export async function getCategoryById(
  id: string
): Promise<Category | undefined> {
  return db.categories.get(id);
}

export async function createCategory(
  data: Omit<Category, "id" | "createdAt" | "updatedAt">
): Promise<string> {
  const id = crypto.randomUUID();
  const timestamp = now();
  await db.categories.add({
    ...data,
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return id;
}

export async function updateCategory(
  id: string,
  data: Partial<Category>
): Promise<void> {
  await db.categories.update(id, { ...data, updatedAt: now() });
}

export async function softDeleteCategory(id: string): Promise<void> {
  await db.categories.update(id, { deletedAt: now(), updatedAt: now() });
}

