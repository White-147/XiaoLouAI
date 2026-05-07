import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PermissionContext } from "../../api";
import { assertSyntheticFixtureBoundary } from "./synthetic-fixtures";
import {
  applyCurrentOrganizationSelection,
  clearCurrentOrganizationSelection,
  getSelectableOrganizations,
  getStoredCurrentOrganizationOwnerScope,
  readCurrentOrganizationSelection,
  setCurrentOrganizationSelection,
} from "../../current-organization-context";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  const storage = {
    get length() {
      return store.size;
    },
    clear: vi.fn(() => {
      store.clear();
    }),
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
  } satisfies Storage;

  vi.stubGlobal("localStorage", storage);
}

function createContext(
  overrides: Partial<PermissionContext> = {},
): PermissionContext {
  assertSyntheticFixtureBoundary("current-organization-context-test");
  return {
    actor: {
      id: "synthetic-user",
      displayName: "Synthetic User",
      email: "synthetic-user@example.test",
      phone: null,
      platformRole: "customer",
      status: "active",
      defaultOrganizationId: "org-alpha",
      avatar: null,
    },
    platformRole: "customer",
    permissions: {
      canCreateProject: true,
      canRecharge: true,
      canUseEnterprise: true,
      canManageOrganization: true,
      canManageOps: false,
      canManageSystem: false,
    },
    organizations: [
      {
        id: "org-alpha",
        name: "Org Alpha",
        role: "enterprise_admin",
        membershipRole: "admin",
        status: "active",
        assetLibraryStatus: "ready",
      },
      {
        id: "org-beta",
        name: "Org Beta",
        role: "enterprise_member",
        membershipRole: "member",
        status: "active",
        assetLibraryStatus: "ready",
      },
    ],
    currentOrganizationId: "org-alpha",
    currentOrganizationRole: "enterprise_admin",
    ...overrides,
  };
}

describe("current organization context selector", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  afterEach(() => {
    clearCurrentOrganizationSelection("synthetic-user");
    vi.unstubAllGlobals();
  });

  it("stores an explicit organization selection and exposes a resolver owner scope", () => {
    const context = createContext();

    const selected = setCurrentOrganizationSelection(context, "org-beta");

    expect(selected.currentOrganizationId).toBe("org-beta");
    expect(selected.currentOrganizationRole).toBe("enterprise_member");
    expect(readCurrentOrganizationSelection("synthetic-user")).toEqual({
      actorId: "synthetic-user",
      organizationId: "org-beta",
      organizationRole: "enterprise_member",
      organizationName: "Org Beta",
    });
    expect(getStoredCurrentOrganizationOwnerScope("synthetic-user")).toEqual({
      accountOwnerType: "organization",
      accountOwnerId: "org-beta",
      organizationId: "org-beta",
      organizationRole: "enterprise_member",
      source: "current-organization",
    });

    const reapplied = applyCurrentOrganizationSelection(context);
    expect(reapplied.currentOrganizationId).toBe("org-beta");
    expect(reapplied.currentOrganizationRole).toBe("enterprise_member");
  });

  it("falls back to a valid organization and replaces stale stored selections", () => {
    const context = createContext();
    setCurrentOrganizationSelection(context, "org-beta");

    const nextContext = createContext({
      organizations: [context.organizations[0]],
      currentOrganizationId: null,
      currentOrganizationRole: null,
    });

    const selected = applyCurrentOrganizationSelection(nextContext, {
      persistEffectiveSelection: true,
    });

    expect(selected.currentOrganizationId).toBe("org-alpha");
    expect(selected.currentOrganizationRole).toBe("enterprise_admin");
    expect(readCurrentOrganizationSelection("synthetic-user")).toEqual({
      actorId: "synthetic-user",
      organizationId: "org-alpha",
      organizationRole: "enterprise_admin",
      organizationName: "Org Alpha",
    });
  });

  it("clears stale stored selections when the latest context no longer grants that organization", () => {
    const context = createContext();
    setCurrentOrganizationSelection(context, "org-beta");

    const nextContext = createContext({
      organizations: [context.organizations[0]],
      currentOrganizationId: "org-alpha",
      currentOrganizationRole: "enterprise_admin",
    });

    const selected = applyCurrentOrganizationSelection(nextContext);

    expect(selected.currentOrganizationId).toBe("org-alpha");
    expect(selected.currentOrganizationRole).toBe("enterprise_admin");
    expect(readCurrentOrganizationSelection("synthetic-user")).toBeNull();
    expect(getStoredCurrentOrganizationOwnerScope("synthetic-user")).toBeNull();
  });

  it("uses the latest context role for a stored organization owner scope", () => {
    const context = createContext();
    setCurrentOrganizationSelection(context, "org-beta");

    applyCurrentOrganizationSelection(
      createContext({
        organizations: [
          context.organizations[0],
          {
            ...context.organizations[1],
            role: "enterprise_admin",
          },
        ],
        currentOrganizationId: "org-beta",
        currentOrganizationRole: "enterprise_admin",
      }),
    );

    expect(getStoredCurrentOrganizationOwnerScope("synthetic-user")).toEqual({
      accountOwnerType: "organization",
      accountOwnerId: "org-beta",
      organizationId: "org-beta",
      organizationRole: "enterprise_admin",
      source: "current-organization",
    });
  });

  it("keeps personal accounts on personal scope without a stored organization owner", () => {
    const context = createContext({
      actor: {
        ...createContext().actor,
        defaultOrganizationId: null,
      },
      organizations: [],
      currentOrganizationId: null,
      currentOrganizationRole: null,
    });

    const selected = applyCurrentOrganizationSelection(context, {
      persistEffectiveSelection: true,
    });

    expect(getSelectableOrganizations(context)).toEqual([]);
    expect(selected.currentOrganizationId).toBeNull();
    expect(selected.currentOrganizationRole).toBeNull();
    expect(readCurrentOrganizationSelection("synthetic-user")).toBeNull();
    expect(getStoredCurrentOrganizationOwnerScope("synthetic-user")).toBeNull();
  });
});
