import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Profile } from "@/domain/types";
import { db } from "@/db/schema";
import {
  ACTIVE_PROFILE_STORAGE_KEY,
  SESSION_ACTIVE_PROFILE_STORAGE_KEY,
  deleteProfile,
  validateProfileName,
} from "@/db/repositories/profiles";

const profiles: Profile[] = [{
  id: "profile-1",
  name: "Home",
  currency: "PHP",
  isDefault: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
}];

describe("profile name validation", () => {
  it("trims valid names and allows the current name while editing", () => {
    expect(validateProfileName("  Home  ", profiles, "profile-1")).toBeNull();
    expect(validateProfileName("Family", profiles)).toBeNull();
  });

  it("rejects empty, long, and duplicate names", () => {
    expect(validateProfileName("  ", profiles)).toBe("required");
    expect(validateProfileName("A".repeat(25), profiles)).toBe("tooLong");
    expect(validateProfileName("home", profiles)).toBe("duplicate");
  });
});

describe("profile deletion", () => {
  beforeEach(async () => {
    await db.delete();
    await db.open();
    sessionStorage.clear();
    localStorage.clear();
  });

  it("switches the active profile to a survivor before deleting the current profile", async () => {
    await db.profiles.bulkAdd([
      { ...profiles[0], name: "Home", isDefault: true },
      {
        id: "profile-2",
        name: "Family",
        currency: "PHP",
        isDefault: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    sessionStorage.setItem(SESSION_ACTIVE_PROFILE_STORAGE_KEY, "profile-1");
    localStorage.setItem(ACTIVE_PROFILE_STORAGE_KEY, "profile-1");

    const fallbackId = await deleteProfile("profile-1");

    expect(fallbackId).toBe("profile-2");
    expect(await db.profiles.get("profile-1")).toBeUndefined();
    expect((await db.profiles.get("profile-2"))?.isDefault).toBe(true);
    expect(sessionStorage.getItem(SESSION_ACTIVE_PROFILE_STORAGE_KEY)).toBe("profile-2");
    expect(localStorage.getItem(ACTIVE_PROFILE_STORAGE_KEY)).toBe("profile-2");
  });
});
