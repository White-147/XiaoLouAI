import { describe, expect, it } from "vitest";
import type { PermissionContext } from "../../api";
import { mergeProfileUpdateContext, resolveAvatarUploadUrl } from "../profile-avatar";

function createPermissionContext(): PermissionContext {
  return {
    actor: {
      id: "user_avatar_owner",
      displayName: "Before Name",
      email: "avatar@example.test",
      phone: null,
      avatar: "https://synthetic-storage.example/read/old-avatar",
      platformRole: "customer",
      status: "active",
      defaultOrganizationId: null,
    },
    platformRole: "customer",
    organizations: [],
    currentOrganizationId: null,
    currentOrganizationRole: null,
    permissions: {
      canCreateProject: true,
      canRecharge: true,
      canUseEnterprise: false,
      canManageOrganization: false,
      canManageOps: false,
      canManageSystem: false,
    },
  };
}

describe("profile avatar helpers", () => {
  it("uses the uploaded signed-read URL before compatibility URL fields", () => {
    expect(
      resolveAvatarUploadUrl({
        signedReadUrl: " https://synthetic-storage.example/read/avatar ",
        urlPath: "https://synthetic-storage.example/path/avatar",
        url: "https://synthetic-storage.example/url/avatar",
      }),
    ).toBe("https://synthetic-storage.example/read/avatar");
  });

  it("falls back through existing upload result URL fields", () => {
    expect(
      resolveAvatarUploadUrl({
        signedReadUrl: "",
        urlPath: "https://synthetic-storage.example/path/avatar",
        url: "https://synthetic-storage.example/url/avatar",
      }),
    ).toBe("https://synthetic-storage.example/path/avatar");

    expect(
      resolveAvatarUploadUrl({
        signedReadUrl: "",
        urlPath: "",
        url: "https://synthetic-storage.example/url/avatar",
      }),
    ).toBe("https://synthetic-storage.example/url/avatar");
  });

  it("rejects upload results that cannot render a profile avatar", () => {
    expect(() => resolveAvatarUploadUrl({ signedReadUrl: "", urlPath: "", url: "" })).toThrow(
      "Avatar upload did not return a usable URL",
    );
  });

  it("merges saved avatar and display name into the context used by Layout rendering", () => {
    const merged = mergeProfileUpdateContext(createPermissionContext(), {
      displayName: "After Name",
      avatar: "https://synthetic-storage.example/read/new-avatar",
      phone: "13800000000",
      defaultOrganizationId: "org_profile_001",
    });

    expect(merged.actor.displayName).toBe("After Name");
    expect(merged.actor.avatar).toBe("https://synthetic-storage.example/read/new-avatar");
    expect(merged.actor.phone).toBe("13800000000");
    expect(merged.actor.defaultOrganizationId).toBe("org_profile_001");
    expect(merged.permissions.canCreateProject).toBe(true);
  });
});
