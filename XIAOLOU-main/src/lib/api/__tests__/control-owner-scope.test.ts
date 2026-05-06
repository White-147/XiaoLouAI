import { describe, expect, it } from "vitest";
import type { EnterpriseRole, PermissionContext, PlatformRole } from "../../api";
import {
  type ControlOwnerScope,
  resolveCurrentOwnerScope,
} from "../../control-owner-scope";
import { assertSyntheticFixtureBoundary } from "./synthetic-fixtures";

type PermissionContextOverrides = Partial<Omit<PermissionContext, "actor" | "permissions">> & {
  actor?: Partial<PermissionContext["actor"]>;
  permissions?: Partial<PermissionContext["permissions"]>;
};

function createContext(overrides: PermissionContextOverrides = {}): PermissionContext {
  const base: PermissionContext = {
    actor: {
      id: "synthetic-user",
      displayName: "Synthetic User",
      email: "synthetic@example.test",
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

  return assertSyntheticFixtureBoundary({
    ...base,
    ...overrides,
    actor: {
      ...base.actor,
      ...overrides.actor,
    },
    permissions: {
      ...base.permissions,
      ...overrides.permissions,
    },
  });
}

function createOrganization(
  id: string,
  role: EnterpriseRole,
): PermissionContext["organizations"][number] {
  return {
    id,
    name: `Synthetic ${id}`,
    role,
    membershipRole: role === "enterprise_admin" ? "admin" : "member",
    status: "active",
  };
}

describe("control owner scope resolver", () => {
  it("preserves personal default compatibility for customer contexts", () => {
    const context = createContext();

    expect(resolveCurrentOwnerScope(context)).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-user",
      organizationId: null,
      organizationRole: null,
      source: "personal-default",
    });
  });

  it("resolves enterprise admin organization scope from the current account context", () => {
    const organization = createOrganization("synthetic-admin-org", "enterprise_admin");
    const context = createContext({
      organizations: [organization],
      currentOrganizationId: organization.id,
      currentOrganizationRole: "enterprise_admin",
      actor: {
        defaultOrganizationId: organization.id,
      },
      permissions: {
        canUseEnterprise: true,
        canManageOrganization: true,
      },
    });

    expect(resolveCurrentOwnerScope(context)).toEqual({
      accountOwnerType: "organization",
      accountOwnerId: organization.id,
      organizationId: organization.id,
      organizationRole: "enterprise_admin",
      source: "current-organization",
    });
  });

  it("resolves enterprise member organization scope from the current account context", () => {
    const organization = createOrganization("synthetic-member-org", "enterprise_member");
    const context = createContext({
      organizations: [organization],
      currentOrganizationId: organization.id,
      currentOrganizationRole: "enterprise_member",
      actor: {
        defaultOrganizationId: organization.id,
      },
      permissions: {
        canUseEnterprise: true,
      },
    });

    expect(resolveCurrentOwnerScope(context)).toEqual({
      accountOwnerType: "organization",
      accountOwnerId: organization.id,
      organizationId: organization.id,
      organizationRole: "enterprise_member",
      source: "current-organization",
    });
  });

  it("returns no owner scope for guest, ops, and super roles by default", () => {
    const platformRoles: PlatformRole[] = ["guest", "ops_admin", "super_admin"];

    for (const platformRole of platformRoles) {
      expect(
        resolveCurrentOwnerScope(
          createContext({
            platformRole,
            actor: {
              platformRole,
            },
          }),
        ),
      ).toEqual({
        accountOwnerType: null,
        accountOwnerId: null,
        organizationId: null,
        organizationRole: null,
        source: "none",
      });
    }
  });

  it("honors an explicit fallback for guest, ops, and super roles", () => {
    const fallback: ControlOwnerScope = {
      accountOwnerType: "system",
      accountOwnerId: "synthetic-platform",
      organizationId: null,
      organizationRole: null,
      source: "explicit-fallback",
    };
    const platformRoles: PlatformRole[] = ["guest", "ops_admin", "super_admin"];

    for (const platformRole of platformRoles) {
      expect(
        resolveCurrentOwnerScope(
          createContext({
            platformRole,
            actor: {
              platformRole,
            },
          }),
          { explicitFallback: fallback },
        ),
      ).toEqual(fallback);
    }
  });

  it("ignores stale defaultOrganizationId values and falls back to a valid membership", () => {
    const organization = createOrganization("synthetic-current-member-org", "enterprise_member");
    const context = createContext({
      organizations: [organization],
      currentOrganizationId: null,
      currentOrganizationRole: "enterprise_member",
      actor: {
        defaultOrganizationId: "stale-synthetic-org",
      },
      permissions: {
        canUseEnterprise: true,
      },
    });

    expect(resolveCurrentOwnerScope(context)).toEqual({
      accountOwnerType: "organization",
      accountOwnerId: organization.id,
      organizationId: organization.id,
      organizationRole: "enterprise_member",
      source: "first-enterprise-organization",
    });
  });

  it("keeps stale organization ids from overriding the personal compatibility fallback", () => {
    const context = createContext({
      currentOrganizationId: "stale-current-org",
      currentOrganizationRole: "enterprise_admin",
      actor: {
        defaultOrganizationId: "stale-default-org",
      },
    });

    expect(resolveCurrentOwnerScope(context)).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-user",
      organizationId: null,
      organizationRole: null,
      source: "personal-default",
    });
  });
});
