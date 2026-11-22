import { describe, expect, it } from "vitest";
import type { Profile } from "@/domain/types";
import { validateProfileName } from "@/db/repositories/profiles";

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
