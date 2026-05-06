import type { EnterpriseRole, PermissionContext } from "./api";

export type ControlAccountOwnerType = "user" | "organization" | "system";

export type ControlOwnerScopeSource =
  | "personal-default"
  | "current-organization"
  | "default-organization"
  | "first-enterprise-organization"
  | "explicit-fallback"
  | "none";

export type ControlOwnerScope = {
  accountOwnerType: ControlAccountOwnerType | null;
  accountOwnerId: string | null;
  organizationId: string | null;
  organizationRole: EnterpriseRole | null;
  source: ControlOwnerScopeSource;
};

export type ResolveCurrentOwnerScopeOptions = {
  explicitFallback?: ControlOwnerScope;
};

const noControlOwnerScope: ControlOwnerScope = {
  accountOwnerType: null,
  accountOwnerId: null,
  organizationId: null,
  organizationRole: null,
  source: "none",
};

function isEnterpriseRole(role: string | null | undefined): role is EnterpriseRole {
  return role === "enterprise_admin" || role === "enterprise_member";
}

function resolveOrganizationScope(
  context: PermissionContext,
): ControlOwnerScope | null {
  const enterpriseOrganizations = context.organizations.filter((organization) =>
    isEnterpriseRole(organization.role),
  );

  const currentOrganization = enterpriseOrganizations.find(
    (organization) => organization.id === context.currentOrganizationId,
  );
  if (currentOrganization) {
    return {
      accountOwnerType: "organization",
      accountOwnerId: currentOrganization.id,
      organizationId: currentOrganization.id,
      organizationRole: currentOrganization.role,
      source: "current-organization",
    };
  }

  const defaultOrganization = enterpriseOrganizations.find(
    (organization) => organization.id === context.actor.defaultOrganizationId,
  );
  if (defaultOrganization) {
    return {
      accountOwnerType: "organization",
      accountOwnerId: defaultOrganization.id,
      organizationId: defaultOrganization.id,
      organizationRole: defaultOrganization.role,
      source: "default-organization",
    };
  }

  const roleMatchedOrganization = enterpriseOrganizations.find(
    (organization) => organization.role === context.currentOrganizationRole,
  );
  const firstEnterpriseOrganization = roleMatchedOrganization ?? enterpriseOrganizations[0] ?? null;
  if (!firstEnterpriseOrganization) return null;

  return {
    accountOwnerType: "organization",
    accountOwnerId: firstEnterpriseOrganization.id,
    organizationId: firstEnterpriseOrganization.id,
    organizationRole: firstEnterpriseOrganization.role,
    source: "first-enterprise-organization",
  };
}

export function resolveCurrentOwnerScope(
  context: PermissionContext | null | undefined,
  options: ResolveCurrentOwnerScopeOptions = {},
): ControlOwnerScope {
  if (!context) return options.explicitFallback ?? noControlOwnerScope;

  if (context.platformRole !== "customer") {
    return options.explicitFallback ?? noControlOwnerScope;
  }

  const organizationScope = resolveOrganizationScope(context);
  if (organizationScope) return organizationScope;

  return {
    accountOwnerType: "user",
    accountOwnerId: context.actor.id,
    organizationId: null,
    organizationRole: null,
    source: "personal-default",
  };
}
