import type { ControlOwnerScope } from "./control-owner-scope";
import type { EnterpriseRole, OrganizationSummary, PermissionContext } from "./api";

const CURRENT_ORGANIZATION_SELECTION_PREFIX =
  "xiaolou.currentOrganizationSelection.v1";

export type CurrentOrganizationSelection = {
  actorId: string;
  organizationId: string;
  organizationRole: EnterpriseRole;
  organizationName: string;
};

export type ApplyCurrentOrganizationSelectionOptions = {
  persistEffectiveSelection?: boolean;
};

const latestPermissionContextsByActorId = new Map<string, PermissionContext>();

function isEnterpriseRole(value: unknown): value is EnterpriseRole {
  return value === "enterprise_admin" || value === "enterprise_member";
}

function getLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function selectionStorageKey(actorId: string) {
  return `${CURRENT_ORGANIZATION_SELECTION_PREFIX}:${actorId}`;
}

function parseSelection(
  actorId: string,
  rawValue: string | null,
): CurrentOrganizationSelection | null {
  if (!rawValue) return null;
  try {
    const parsed = JSON.parse(rawValue) as Partial<CurrentOrganizationSelection>;
    if (
      parsed.actorId !== actorId ||
      typeof parsed.organizationId !== "string" ||
      !parsed.organizationId ||
      !isEnterpriseRole(parsed.organizationRole)
    ) {
      return null;
    }

    return {
      actorId,
      organizationId: parsed.organizationId,
      organizationRole: parsed.organizationRole,
      organizationName:
        typeof parsed.organizationName === "string" ? parsed.organizationName : "",
    };
  } catch {
    return null;
  }
}

function toSelection(
  actorId: string,
  organization: OrganizationSummary,
): CurrentOrganizationSelection {
  return {
    actorId,
    organizationId: organization.id,
    organizationRole: organization.role,
    organizationName: organization.name,
  };
}

function writeCurrentOrganizationSelection(
  selection: CurrentOrganizationSelection,
) {
  const storage = getLocalStorage();
  if (!storage) return;
  storage.setItem(selectionStorageKey(selection.actorId), JSON.stringify(selection));
}

function findSelectableOrganization(
  context: PermissionContext,
  organizationId: string,
) {
  return getSelectableOrganizations(context).find(
    (organization) => organization.id === organizationId,
  ) ?? null;
}

function rememberLatestPermissionContext(context: PermissionContext) {
  if (!context.actor.id) return;
  latestPermissionContextsByActorId.set(context.actor.id, context);
}

function validateSelectionAgainstLatestContext(
  selection: CurrentOrganizationSelection,
): CurrentOrganizationSelection | null {
  const latestContext = latestPermissionContextsByActorId.get(selection.actorId);
  if (!latestContext) return selection;

  const organization = findSelectableOrganization(
    latestContext,
    selection.organizationId,
  );
  if (!organization) {
    clearCurrentOrganizationSelection(selection.actorId);
    return null;
  }

  return toSelection(latestContext.actor.id, organization);
}

export function readCurrentOrganizationSelection(
  actorId: string,
): CurrentOrganizationSelection | null {
  if (!actorId) return null;
  const storage = getLocalStorage();
  if (!storage) return null;
  const key = selectionStorageKey(actorId);
  const rawSelection = storage.getItem(key);
  const selection = parseSelection(actorId, rawSelection);
  if (!selection) {
    if (rawSelection) storage.removeItem(key);
    return null;
  }

  return validateSelectionAgainstLatestContext(selection);
}

export function clearCurrentOrganizationSelection(actorId: string) {
  if (!actorId) return;
  const storage = getLocalStorage();
  if (!storage) return;
  storage.removeItem(selectionStorageKey(actorId));
}

export function getSelectableOrganizations(
  context: PermissionContext | null | undefined,
): OrganizationSummary[] {
  if (!context || context.platformRole !== "customer") return [];
  return context.organizations.filter((organization) =>
    isEnterpriseRole(organization.role),
  );
}

function chooseEffectiveOrganization(
  context: PermissionContext,
): OrganizationSummary | null {
  const organizations = getSelectableOrganizations(context);
  if (!organizations.length) return null;

  const storedSelection = readCurrentOrganizationSelection(context.actor.id);
  const storedOrganization = storedSelection
    ? organizations.find((organization) => organization.id === storedSelection.organizationId)
    : null;
  if (storedOrganization) return storedOrganization;

  const currentOrganization = context.currentOrganizationId
    ? organizations.find((organization) => organization.id === context.currentOrganizationId)
    : null;
  if (currentOrganization) return currentOrganization;

  const defaultOrganization = context.actor.defaultOrganizationId
    ? organizations.find((organization) => organization.id === context.actor.defaultOrganizationId)
    : null;
  if (defaultOrganization) return defaultOrganization;

  const roleMatchedOrganization = context.currentOrganizationRole
    ? organizations.find((organization) => organization.role === context.currentOrganizationRole)
    : null;
  return roleMatchedOrganization ?? organizations[0] ?? null;
}

export function applyCurrentOrganizationSelection(
  context: PermissionContext,
  options: ApplyCurrentOrganizationSelectionOptions = {},
): PermissionContext {
  rememberLatestPermissionContext(context);
  const effectiveOrganization = chooseEffectiveOrganization(context);
  const nextContext: PermissionContext = effectiveOrganization
    ? {
        ...context,
        currentOrganizationId: effectiveOrganization.id,
        currentOrganizationRole: effectiveOrganization.role,
      }
    : {
        ...context,
        currentOrganizationId: null,
        currentOrganizationRole: null,
      };

  if (options.persistEffectiveSelection) {
    if (effectiveOrganization) {
      writeCurrentOrganizationSelection(
        toSelection(context.actor.id, effectiveOrganization),
      );
    } else {
      clearCurrentOrganizationSelection(context.actor.id);
    }
  }

  return nextContext;
}

export function setCurrentOrganizationSelection(
  context: PermissionContext,
  organizationId: string,
): PermissionContext {
  rememberLatestPermissionContext(context);
  const selectedOrganization =
    getSelectableOrganizations(context).find((organization) => organization.id === organizationId) ??
    null;
  if (!selectedOrganization) {
    clearCurrentOrganizationSelection(context.actor.id);
    return applyCurrentOrganizationSelection(
      { ...context, currentOrganizationId: null, currentOrganizationRole: null },
      { persistEffectiveSelection: true },
    );
  }

  writeCurrentOrganizationSelection(
    toSelection(context.actor.id, selectedOrganization),
  );
  return {
    ...context,
    currentOrganizationId: selectedOrganization.id,
    currentOrganizationRole: selectedOrganization.role,
  };
}

export function getStoredCurrentOrganizationOwnerScope(
  actorId: string,
): ControlOwnerScope | null {
  const selection = readCurrentOrganizationSelection(actorId);
  if (!selection) return null;
  return {
    accountOwnerType: "organization",
    accountOwnerId: selection.organizationId,
    organizationId: selection.organizationId,
    organizationRole: selection.organizationRole,
    source: "current-organization",
  };
}
