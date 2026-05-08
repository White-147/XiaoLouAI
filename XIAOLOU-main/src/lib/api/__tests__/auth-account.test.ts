import { describe, expect, it } from "vitest";
import type { PermissionContext } from "../../api";
import { resolveCurrentOwnerScope, type ControlOwnerScope } from "../../control-owner-scope";
import { createAuthAccountService } from "../auth-account";
import { parseJsonBody, SYNTHETIC_ACTOR_ID, SYNTHETIC_CREATED_AT, type RequestCall } from "./synthetic-fixtures";

type AuthAccountServiceDeps = Parameters<typeof createAuthAccountService>[0];
type Wallet = Awaited<ReturnType<AuthAccountServiceDeps["getWallet"]>>;
type WalletOwnerType = Parameters<AuthAccountServiceDeps["getWallet"]>[0];

function createSyntheticWallet(ownerType: WalletOwnerType, ownerId: string): Wallet {
  return {
    id: `synthetic-wallet-${ownerId}`,
    ownerType,
    walletOwnerType: ownerType,
    ownerId,
    creditsAvailable: 0,
    creditsFrozen: 0,
    currency: "CNY",
    updatedAt: SYNTHETIC_CREATED_AT,
  };
}

function createPersonalPermissionContext(actorId = SYNTHETIC_ACTOR_ID): PermissionContext {
  return {
    actor: {
      id: actorId,
      displayName: "Synthetic User",
      email: "synthetic.user@example.test",
      avatar: null,
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

function createOrganizationPermissionContext(organizationId = "synthetic-organization"): PermissionContext {
  const context = createPersonalPermissionContext();
  return {
    ...context,
    actor: {
      ...context.actor,
      defaultOrganizationId: organizationId,
    },
    organizations: [
      {
        id: organizationId,
        name: "Synthetic Organization",
        role: "enterprise_admin",
        membershipRole: "admin",
        status: "active",
      },
    ],
    currentOrganizationId: organizationId,
    currentOrganizationRole: "enterprise_admin",
    permissions: {
      ...context.permissions,
      canUseEnterprise: true,
      canManageOrganization: true,
    },
  };
}

function createServiceHarness({
  permissionContext = createPersonalPermissionContext(),
  response = { synthetic: true },
  walletError,
  routeNotFoundError,
}: {
  permissionContext?: PermissionContext;
  response?: unknown;
  walletError?: unknown;
  routeNotFoundError?: unknown;
} = {}) {
  const calls: RequestCall[] = [];
  const scopeCalls: ControlOwnerScope[] = [];
  const walletCalls: Array<{ ownerType: WalletOwnerType; ownerId: string }> = [];
  const emptyWalletCalls: Array<{ ownerType: WalletOwnerType; ownerId: string }> = [];
  const emptyWallet = createSyntheticWallet("organization", "synthetic-empty-organization");

  const deps: AuthAccountServiceDeps = {
    controlApiJsonRequest: async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      return response as T;
    },
    resolveCurrentOwnerScope: () => {
      const ownerScope = resolveCurrentOwnerScope(permissionContext);
      scopeCalls.push(ownerScope);
      return ownerScope;
    },
    getWallet: async (ownerType, ownerId) => {
      walletCalls.push({ ownerType, ownerId });
      if (walletError) {
        throw walletError;
      }

      return createSyntheticWallet(ownerType, ownerId);
    },
    createEmptyWallet: (ownerType, ownerId) => {
      emptyWalletCalls.push({ ownerType, ownerId });
      return emptyWallet;
    },
    isRouteNotFoundError: (error) => error === routeNotFoundError,
  };

  return {
    calls,
    emptyWallet,
    emptyWalletCalls,
    scopeCalls,
    service: createAuthAccountService(deps),
    walletCalls,
  };
}

describe("createAuthAccountService", () => {
  it("reads and updates the current identity through stable /api/me routes", async () => {
    const response = { actor: { id: SYNTHETIC_ACTOR_ID } };
    const { calls, service } = createServiceHarness({ response });
    const updateInput = {
      displayName: "Synthetic User",
      avatar: null,
      phone: "13800000000",
      defaultOrganizationId: "org_synthetic_001",
    };

    await expect(service.getMe()).resolves.toBe(response);
    await expect(service.updateMe(updateInput)).resolves.toBe(response);

    expect(calls).toEqual([
      {
        path: "/api/me",
        init: undefined,
      },
      {
        path: "/api/me",
        init: {
          method: "PUT",
          body: JSON.stringify(updateInput),
        },
      },
    ]);
  });

  it("uses default personal owner scope for API-center config and defaults routes", async () => {
    const response = { defaults: { textModelId: "synthetic-text-model" } };
    const { calls, scopeCalls, service } = createServiceHarness({ response });
    const defaultsInput = {
      textModelId: "synthetic-text-model",
      imageModelId: "synthetic-image-model",
    };

    await expect(service.getApiCenterConfig()).resolves.toBe(response);
    await expect(service.updateApiCenterDefaults(defaultsInput)).resolves.toBe(response);

    expect(scopeCalls).toEqual([
      {
        accountOwnerType: "user",
        accountOwnerId: SYNTHETIC_ACTOR_ID,
        organizationId: null,
        organizationRole: null,
        source: "personal-default",
      },
      {
        accountOwnerType: "user",
        accountOwnerId: SYNTHETIC_ACTOR_ID,
        organizationId: null,
        organizationRole: null,
        source: "personal-default",
      },
    ]);
    expect(calls[0]).toEqual({
      path: "/api/api-center?accountOwnerType=user&accountOwnerId=synthetic-actor",
      init: undefined,
    });
    expect(calls[1].path).toBe(
      "/api/api-center/defaults?accountOwnerType=user&accountOwnerId=synthetic-actor",
    );
    expect(calls[1].init?.method).toBe("PUT");
    expect(parseJsonBody(calls[1])).toEqual(defaultsInput);
  });

  it("uses organization owner scope for encoded API-center vendor routes", async () => {
    const response = { id: "synthetic-vendor/model" };
    const { calls, scopeCalls, service } = createServiceHarness({
      permissionContext: createOrganizationPermissionContext(),
      response,
    });

    await expect(
      service.saveApiCenterVendorApiKey("synthetic vendor/one", "synthetic-api-key"),
    ).resolves.toBe(response);
    await expect(service.testApiCenterVendorConnection("synthetic vendor/one")).resolves.toBe(response);
    await expect(
      service.updateApiVendorModel("synthetic vendor/one", "model/one", {
        enabled: true,
      }),
    ).resolves.toBe(response);

    expect(scopeCalls).toEqual([
      {
        accountOwnerType: "organization",
        accountOwnerId: "synthetic-organization",
        organizationId: "synthetic-organization",
        organizationRole: "enterprise_admin",
        source: "current-organization",
      },
      {
        accountOwnerType: "organization",
        accountOwnerId: "synthetic-organization",
        organizationId: "synthetic-organization",
        organizationRole: "enterprise_admin",
        source: "current-organization",
      },
      {
        accountOwnerType: "organization",
        accountOwnerId: "synthetic-organization",
        organizationId: "synthetic-organization",
        organizationRole: "enterprise_admin",
        source: "current-organization",
      },
    ]);
    expect(calls[0].path).toBe(
      "/api/api-center/vendors/synthetic%20vendor%2Fone/api-key?accountOwnerType=organization&accountOwnerId=synthetic-organization",
    );
    expect(calls[0].init?.method).toBe("PUT");
    expect(parseJsonBody(calls[0])).toEqual({ apiKey: "synthetic-api-key" });
    expect(calls[1]).toEqual({
      path: "/api/api-center/vendors/synthetic%20vendor%2Fone/test?accountOwnerType=organization&accountOwnerId=synthetic-organization",
      init: { method: "POST" },
    });
    expect(calls[2].path).toBe(
      "/api/api-center/vendors/synthetic%20vendor%2Fone/models/model%2Fone?accountOwnerType=organization&accountOwnerId=synthetic-organization",
    );
    expect(calls[2].init?.method).toBe("PUT");
    expect(parseJsonBody(calls[2])).toEqual({ enabled: true });
  });

  it("uses auth provider and login routes with synthetic credentials", async () => {
    const response = { actorId: "synthetic-actor" };
    const { calls, service } = createServiceHarness({ response });
    const loginInput = {
      email: "synthetic.user@example.test",
      password: "synthetic-password",
    };

    await expect(service.getAuthProviders()).resolves.toBe(response);
    await expect(service.loginWithEmail(loginInput)).resolves.toBe(response);
    await expect(service.loginAdminWithEmail(loginInput)).resolves.toBe(response);
    await expect(service.exchangeGoogleLogin("synthetic-google-code")).resolves.toBe(response);

    expect(calls[0]).toEqual({
      path: "/api/auth/providers",
      init: undefined,
    });
    expect(calls[1].path).toBe("/api/auth/login");
    expect(calls[1].init?.method).toBe("POST");
    expect(parseJsonBody(calls[1])).toEqual(loginInput);
    expect(calls[2].path).toBe("/api/auth/admin/login");
    expect(calls[2].init?.method).toBe("POST");
    expect(parseJsonBody(calls[2])).toEqual(loginInput);
    expect(calls[3].path).toBe("/api/auth/google/exchange");
    expect(calls[3].init?.method).toBe("POST");
    expect(parseJsonBody(calls[3])).toEqual({ code: "synthetic-google-code" });
  });

  it("uses password bootstrap, change, and admin reset routes without reshaping bodies", async () => {
    const response = { actorId: "synthetic-actor", passwordConfigured: true };
    const { calls, service } = createServiceHarness({ response });
    const bootstrapInput = {
      email: "ops@xiaolou.local",
      password: "synthetic-bootstrap-password",
    };
    const changeInput = {
      currentPassword: "synthetic-current-password",
      newPassword: "synthetic-new-password",
    };
    const adminResetInput = {
      email: "synthetic.user@example.test",
      newPassword: "synthetic-admin-reset-password",
    };
    const resetRequestInput = {
      email: "synthetic.user@example.test",
    };
    const resetCompleteInput = {
      resetToken: "synthetic-reset-token",
      newPassword: "synthetic-reset-password",
    };

    await expect(service.bootstrapPlatformPassword(bootstrapInput)).resolves.toBe(response);
    await expect(service.changePassword(changeInput)).resolves.toBe(response);
    await expect(service.adminResetPassword(adminResetInput)).resolves.toBe(response);
    await expect(service.requestPasswordReset(resetRequestInput)).resolves.toBe(response);
    await expect(service.completePasswordReset(resetCompleteInput)).resolves.toBe(response);

    expect(calls[0].path).toBe("/api/auth/password/bootstrap-admin");
    expect(calls[0].init?.method).toBe("POST");
    expect(parseJsonBody(calls[0])).toEqual(bootstrapInput);
    expect(calls[1].path).toBe("/api/auth/password/change");
    expect(calls[1].init?.method).toBe("POST");
    expect(parseJsonBody(calls[1])).toEqual(changeInput);
    expect(calls[2].path).toBe("/api/auth/password/admin-reset");
    expect(calls[2].init?.method).toBe("POST");
    expect(parseJsonBody(calls[2])).toEqual(adminResetInput);
    expect(calls[3].path).toBe("/api/auth/password/reset/request");
    expect(calls[3].init?.method).toBe("POST");
    expect(parseJsonBody(calls[3])).toEqual(resetRequestInput);
    expect(calls[4].path).toBe("/api/auth/password/reset/complete");
    expect(calls[4].init?.method).toBe("POST");
    expect(parseJsonBody(calls[4])).toEqual(resetCompleteInput);
  });

  it("uses personal and enterprise registration routes with synthetic inputs", async () => {
    const response = { actorId: "synthetic-actor" };
    const { calls, service } = createServiceHarness({ response });
    const personalInput = {
      displayName: "Synthetic Person",
      email: "person@example.test",
      password: "synthetic-person-password",
    };
    const enterpriseInput = {
      companyName: "Synthetic Company",
      adminName: "Synthetic Admin",
      email: "admin@example.test",
      password: "synthetic-admin-password",
      industry: "synthetic-industry",
    };

    await expect(service.registerPersonalUser(personalInput)).resolves.toBe(response);
    await expect(service.registerEnterpriseAdmin(enterpriseInput)).resolves.toBe(response);

    expect(calls[0].path).toBe("/api/auth/register/personal");
    expect(calls[0].init?.method).toBe("POST");
    expect(parseJsonBody(calls[0])).toEqual(personalInput);
    expect(calls[1].path).toBe("/api/auth/register/enterprise-admin");
    expect(calls[1].init?.method).toBe("POST");
    expect(parseJsonBody(calls[1])).toEqual(enterpriseInput);
  });

  it("uses encoded organization member routes for list, create, update, password reset, and delete", async () => {
    const response = { items: [] };
    const { calls, service } = createServiceHarness({ response });
    const memberInput = {
      displayName: "Synthetic Member",
      email: "member@example.test",
      membershipRole: "admin" as const,
      canUseOrganizationWallet: true,
    };
    const updateInput = {
      displayName: "Renamed Member",
      email: "renamed@example.test",
      phone: "13800000000",
      newPassword: "synthetic-updated-password",
    };

    await expect(service.listOrganizationMembers("synthetic organization/1", "member 1")).resolves.toBe(response);
    await expect(
      service.createOrganizationMember("synthetic organization/1", memberInput),
    ).resolves.toBe(response);
    await expect(
      service.updateOrganizationMemberAccount("synthetic organization/1", "user/member 1", updateInput),
    ).resolves.toBe(response);
    await expect(
      service.resetOrganizationMemberPassword("synthetic organization/1", "user/member 1", {
        newPassword: "synthetic-password",
      }),
    ).resolves.toBe(response);
    await expect(
      service.deleteOrganizationMemberAccount("synthetic organization/1", "user/member 1"),
    ).resolves.toBe(response);

    const expectedPath = "/api/organizations/synthetic%20organization%2F1/members";
    expect(calls[0]).toEqual({
      path: `${expectedPath}?query=member%201`,
      init: undefined,
    });
    expect(calls[1].path).toBe(expectedPath);
    expect(calls[1].init?.method).toBe("POST");
    expect(parseJsonBody(calls[1])).toEqual(memberInput);
    expect(calls[2].path).toBe(
      "/api/organizations/synthetic%20organization%2F1/members/user%2Fmember%201/account",
    );
    expect(calls[2].init?.method).toBe("PUT");
    expect(parseJsonBody(calls[2])).toEqual(updateInput);
    expect(calls[3].path).toBe(
      "/api/organizations/synthetic%20organization%2F1/members/user%2Fmember%201/password",
    );
    expect(calls[3].init?.method).toBe("POST");
    expect(parseJsonBody(calls[3])).toEqual({ newPassword: "synthetic-password" });
    expect(calls[4].path).toBe(
      "/api/organizations/synthetic%20organization%2F1/members/user%2Fmember%201",
    );
    expect(calls[4].init?.method).toBe("DELETE");
  });

  it("returns an empty organization wallet fallback for not-found wallet routes", async () => {
    const notFound = new Error("synthetic not found");
    const { emptyWallet, emptyWalletCalls, service, walletCalls } = createServiceHarness({
      walletError: notFound,
      routeNotFoundError: notFound,
    });

    await expect(service.getOrganizationWallet("synthetic-organization")).resolves.toBe(emptyWallet);

    expect(walletCalls).toEqual([
      {
        ownerType: "organization",
        ownerId: "synthetic-organization",
      },
    ]);
    expect(emptyWalletCalls).toEqual([
      {
        ownerType: "organization",
        ownerId: "synthetic-organization",
      },
    ]);
  });

  it("returns organization wallets and rethrows non-not-found wallet failures", async () => {
    const successHarness = createServiceHarness();

    await expect(successHarness.service.getOrganizationWallet("synthetic-organization")).resolves.toEqual(
      createSyntheticWallet("organization", "synthetic-organization"),
    );
    expect(successHarness.walletCalls).toEqual([
      {
        ownerType: "organization",
        ownerId: "synthetic-organization",
      },
    ]);
    expect(successHarness.emptyWalletCalls).toEqual([]);

    const failure = new Error("synthetic wallet failure");
    const failureHarness = createServiceHarness({
      walletError: failure,
      routeNotFoundError: new Error("different synthetic not found"),
    });

    await expect(failureHarness.service.getOrganizationWallet("synthetic-organization")).rejects.toThrow(
      "synthetic wallet failure",
    );
    expect(failureHarness.emptyWalletCalls).toEqual([]);
  });
});
