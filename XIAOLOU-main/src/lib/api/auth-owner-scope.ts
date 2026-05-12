import {
  applyCurrentOrganizationSelection,
  getStoredCurrentOrganizationOwnerScope,
} from "../current-organization-context";
import {
  resolveCurrentOwnerScope,
  type ControlOwnerScope,
} from "../control-owner-scope";
import { isLocalLoopbackAccess, SUPER_ADMIN_DEMO_ACTOR_ID } from "../local-loopback";
import type { OrganizationSummary, PermissionContext } from "./auth-account-types";

export function buildFallbackPermissionContext(actorId: string): PermissionContext {
  if (actorId === SUPER_ADMIN_DEMO_ACTOR_ID && !isLocalLoopbackAccess()) {
    return buildFallbackPermissionContext("guest");
  }

  const organization: OrganizationSummary = {
    id: "org_demo_001",
    name: "\u5c0f\u697c\u5f71\u4e1a Demo",
    role: "enterprise_member",
    membershipRole: "member",
    status: "active",
  };

  if (actorId === "guest") {
    return {
      actor: {
        id: "guest",
        displayName: "\u6e38\u5ba2",
        email: null,
        platformRole: "guest",
        status: "active",
        defaultOrganizationId: null,
      },
      platformRole: "guest",
      organizations: [],
      currentOrganizationId: null,
      currentOrganizationRole: null,
      permissions: {
        canCreateProject: false,
        canRecharge: false,
        canUseEnterprise: false,
        canManageOrganization: false,
        canManageOps: false,
        canManageSystem: false,
      },
    };
  }

  if (actorId === "user_member_001") {
    return {
      actor: {
        id: actorId,
        displayName: "\u4f01\u4e1a\u6210\u5458",
        email: "member@xiaolou.local",
        platformRole: "customer",
        status: "active",
        defaultOrganizationId: organization.id,
      },
      platformRole: "customer",
      organizations: [organization],
      currentOrganizationId: organization.id,
      currentOrganizationRole: "enterprise_member",
      permissions: {
        canCreateProject: true,
        canRecharge: true,
        canUseEnterprise: true,
        canManageOrganization: false,
        canManageOps: false,
        canManageSystem: false,
      },
    };
  }

  if (actorId === "user_demo_001") {
    return {
      actor: {
        id: actorId,
        displayName: "\u4f01\u4e1a\u7ba1\u7406\u5458",
        email: "admin@xiaolou.local",
        platformRole: "customer",
        status: "active",
        defaultOrganizationId: organization.id,
      },
      platformRole: "customer",
      organizations: [
        { ...organization, role: "enterprise_admin", membershipRole: "admin" },
      ],
      currentOrganizationId: organization.id,
      currentOrganizationRole: "enterprise_admin",
      permissions: {
        canCreateProject: true,
        canRecharge: true,
        canUseEnterprise: true,
        canManageOrganization: true,
        canManageOps: false,
        canManageSystem: false,
      },
    };
  }

  if (actorId === "ops_demo_001") {
    return {
      actor: {
        id: actorId,
        displayName: "\u8fd0\u8425\u7ba1\u7406\u5458",
        email: "ops@xiaolou.local",
        platformRole: "ops_admin",
        status: "active",
        defaultOrganizationId: null,
      },
      platformRole: "ops_admin",
      organizations: [],
      currentOrganizationId: null,
      currentOrganizationRole: null,
      permissions: {
        canCreateProject: true,
        canRecharge: false,
        canUseEnterprise: false,
        canManageOrganization: false,
        canManageOps: true,
        canManageSystem: false,
      },
    };
  }

  if (actorId === SUPER_ADMIN_DEMO_ACTOR_ID) {
    return {
      actor: {
        id: actorId,
        displayName: "\u8d85\u7ea7\u7ba1\u7406\u5458",
        email: "root@xiaolou.local",
        platformRole: "super_admin",
        status: "active",
        defaultOrganizationId: null,
      },
      platformRole: "super_admin",
      organizations: [],
      currentOrganizationId: null,
      currentOrganizationRole: null,
      permissions: {
        canCreateProject: true,
        canRecharge: false,
        canUseEnterprise: false,
        canManageOrganization: false,
        canManageOps: true,
        canManageSystem: true,
      },
    };
  }

  return {
    actor: {
      id: actorId,
      displayName: "\u6ce8\u518c\u7528\u6237",
      email: "user@xiaolou.local",
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

function buildPersonalOwnerFallback(actorId: string): ControlOwnerScope {
  return {
    accountOwnerType: "user",
    accountOwnerId: actorId,
    organizationId: null,
    organizationRole: null,
    source: "explicit-fallback",
  };
}

export type CurrentControlOwnerScopeResolverDeps = {
  getCurrentActorId: () => string;
};

export function createCurrentControlOwnerScopeResolver({
  getCurrentActorId,
}: CurrentControlOwnerScopeResolverDeps) {
  return function resolveCurrentControlOwnerScope() {
    const actorId = getCurrentActorId();
    const selectedOrganizationScope = getStoredCurrentOrganizationOwnerScope(actorId);
    if (selectedOrganizationScope) return selectedOrganizationScope;
    return resolveCurrentOwnerScope(
      applyCurrentOrganizationSelection(buildFallbackPermissionContext(actorId)),
      {
        explicitFallback: buildPersonalOwnerFallback(actorId),
      },
    );
  };
}
