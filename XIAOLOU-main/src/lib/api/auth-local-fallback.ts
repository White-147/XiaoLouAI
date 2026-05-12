import { getCurrentActorId } from "../actor-session";
import { buildFallbackPermissionContext } from "./auth-owner-scope";
import type {
  CreateOrganizationMemberInput,
  EnterpriseRole,
  LoginInput,
  LoginResult,
  OrganizationMember,
  PermissionContext,
  RegistrationResult,
} from "./auth-account-types";

const LOCAL_PROFILE_STORAGE_PREFIX = "xiaolou.windows-native.profile.v1";
const LOCAL_ORGANIZATION_MEMBERS_STORAGE_PREFIX =
  "xiaolou.windows-native.organization-members.v1";

export type LocalAuthMode = "personal" | "enterprise_admin" | "ops_admin";

export type LocalProfile = {
  displayName?: string;
  email?: string | null;
  avatar?: string | null;
};

function localStorageGetJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function localStorageSetJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function actorScopedStorageKey(prefix: string, actorId = getCurrentActorId()) {
  return `${prefix}:${actorId || "guest"}`;
}

function createLocalClientId(prefix: string) {
  const randomId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${randomId}`;
}

export function localAuthToken(actorId: string) {
  const raw = `${actorId}:${Date.now()}`;
  try {
    if (typeof window !== "undefined" && typeof window.btoa === "function") {
      return window.btoa(raw);
    }
  } catch {
    /* fall through */
  }
  return raw;
}

export function actorIdFromEmail(email: string, mode: LocalAuthMode = "personal") {
  const normalizedEmail = email.trim().toLowerCase();
  if (mode === "ops_admin" || normalizedEmail.includes("ops")) return "ops_demo_001";
  if (mode === "enterprise_admin" || normalizedEmail.includes("admin")) {
    return "user_demo_001";
  }
  if (normalizedEmail.includes("member")) return "user_member_001";
  const segment = normalizedEmail
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return segment ? `user_${segment}` : "user_demo_001";
}

export function readLocalProfile(actorId = getCurrentActorId()) {
  return localStorageGetJson<LocalProfile>(
    actorScopedStorageKey(LOCAL_PROFILE_STORAGE_PREFIX, actorId),
    {},
  );
}

export function writeLocalProfile(actorId: string, profile: LocalProfile) {
  localStorageSetJson(
    actorScopedStorageKey(LOCAL_PROFILE_STORAGE_PREFIX, actorId),
    profile,
  );
}

export function applyLocalProfile(
  context: PermissionContext,
  profile = readLocalProfile(context.actor.id),
): PermissionContext {
  if (
    !profile.displayName &&
    profile.email === undefined &&
    profile.avatar === undefined
  ) {
    return context;
  }
  return {
    ...context,
    actor: {
      ...context.actor,
      displayName: profile.displayName || context.actor.displayName,
      email: profile.email === undefined ? context.actor.email : profile.email,
      avatar: profile.avatar === undefined ? context.actor.avatar : profile.avatar,
    },
  };
}

export function buildLocalLoginResult(
  input: LoginInput,
  mode: LocalAuthMode = "personal",
): LoginResult {
  const actorId = actorIdFromEmail(input.email, mode);
  const profile: LocalProfile = {
    displayName:
      mode === "ops_admin"
        ? "Ops Admin"
        : mode === "enterprise_admin"
          ? "Enterprise Admin"
          : input.email.split("@")[0] || "Windows Native User",
    email: input.email.trim() || null,
  };
  writeLocalProfile(actorId, profile);
  const permissionContext = applyLocalProfile(
    buildFallbackPermissionContext(actorId),
    profile,
  );
  return {
    actorId,
    token: localAuthToken(actorId),
    controlApiClientAssertion: null,
    displayName: permissionContext.actor.displayName,
    email: permissionContext.actor.email || input.email,
    permissionContext,
  };
}

function organizationMembersStorageKey(
  organizationId: string,
  actorId = getCurrentActorId(),
) {
  return `${actorScopedStorageKey(
    LOCAL_ORGANIZATION_MEMBERS_STORAGE_PREFIX,
    actorId,
  )}:${organizationId}`;
}

export function readLocalOrganizationMembers(
  organizationId: string,
  actorId = getCurrentActorId(),
) {
  const items = localStorageGetJson<OrganizationMember[]>(
    organizationMembersStorageKey(organizationId, actorId),
    [],
  );
  return Array.isArray(items) ? items : [];
}

export function writeLocalOrganizationMembers(
  organizationId: string,
  items: OrganizationMember[],
  actorId = getCurrentActorId(),
) {
  localStorageSetJson(
    organizationMembersStorageKey(organizationId, actorId),
    items.slice(0, 200),
  );
}

export function createLocalOrganizationMember(
  organizationId: string,
  input: CreateOrganizationMemberInput,
): OrganizationMember {
  const now = new Date().toISOString();
  const membershipRole = input.membershipRole || "member";
  const role: EnterpriseRole =
    membershipRole === "admin" ? "enterprise_admin" : "enterprise_member";
  const actorId = createLocalClientId("user");
  return {
    id: createLocalClientId("org-member"),
    organizationId,
    userId: actorId,
    displayName: input.displayName || input.email || "Enterprise member",
    email: input.email || null,
    phone: input.phone,
    platformRole: "customer",
    role,
    membershipRole,
    department: input.department,
    canUseOrganizationWallet: input.canUseOrganizationWallet ?? true,
    status: "active",
    createdAt: now,
    updatedAt: now,
    usageSummary: {
      todayUsedCredits: 0,
      monthUsedCredits: 0,
      totalUsedCredits: 0,
      refundedCredits: 0,
      pendingFrozenCredits: 0,
      recentTaskCount: 0,
      lastActivityAt: null,
      series: [],
    },
  };
}

export function buildRegistrationResult(
  actorId: string,
  permissionContext: PermissionContext,
  mode: "personal" | "enterprise_admin" | "enterprise_member",
  member?: OrganizationMember,
): RegistrationResult {
  const organization = permissionContext.organizations[0] ?? null;
  return {
    actorId,
    token: localAuthToken(actorId),
    controlApiClientAssertion: null,
    permissionContext,
    wallets: [],
    wallet: null,
    organization: organization
      ? {
          id: organization.id,
          name: organization.name,
          status: organization.status,
          assetLibraryStatus: organization.assetLibraryStatus,
        }
      : null,
    member,
    onboarding: {
      mode,
      title: mode === "personal" ? "Personal account ready" : "Enterprise account ready",
      detail:
        "Created in the Windows-native local account draft while canonical identity endpoints are being cut over.",
      tempPassword: null,
      generatedPassword: false,
    },
  };
}
