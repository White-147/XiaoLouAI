import { describe, expect, it } from "vitest";
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

function createServiceHarness({
  response = { synthetic: true },
  walletError,
  routeNotFoundError,
}: {
  response?: unknown;
  walletError?: unknown;
  routeNotFoundError?: unknown;
} = {}) {
  const calls: RequestCall[] = [];
  const scopeCalls: Array<string | undefined> = [];
  const walletCalls: Array<{ ownerType: WalletOwnerType; ownerId: string }> = [];
  const emptyWalletCalls: Array<{ ownerType: WalletOwnerType; ownerId: string }> = [];
  const emptyWallet = createSyntheticWallet("organization", "synthetic-empty-organization");

  const deps: AuthAccountServiceDeps = {
    controlApiJsonRequest: async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      return response as T;
    },
    buildControlScopeQuery: (actorId?: string) => {
      scopeCalls.push(actorId);
      return `actorId=${SYNTHETIC_ACTOR_ID}`;
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

  it("uses scoped API-center config and defaults routes with stable request bodies", async () => {
    const response = { defaults: { textModelId: "synthetic-text-model" } };
    const { calls, scopeCalls, service } = createServiceHarness({ response });
    const defaultsInput = {
      textModelId: "synthetic-text-model",
      imageModelId: "synthetic-image-model",
    };

    await expect(service.getApiCenterConfig()).resolves.toBe(response);
    await expect(service.updateApiCenterDefaults(defaultsInput)).resolves.toBe(response);

    expect(scopeCalls).toEqual([undefined, undefined]);
    expect(calls[0]).toEqual({
      path: "/api/api-center?actorId=synthetic-actor",
      init: undefined,
    });
    expect(calls[1].path).toBe("/api/api-center/defaults?actorId=synthetic-actor");
    expect(calls[1].init?.method).toBe("PUT");
    expect(parseJsonBody(calls[1])).toEqual(defaultsInput);
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

  it("uses encoded organization member routes for list and create", async () => {
    const response = { items: [] };
    const { calls, service } = createServiceHarness({ response });
    const memberInput = {
      displayName: "Synthetic Member",
      email: "member@example.test",
      membershipRole: "admin" as const,
      canUseOrganizationWallet: true,
    };

    await expect(service.listOrganizationMembers("synthetic organization/1")).resolves.toBe(response);
    await expect(
      service.createOrganizationMember("synthetic organization/1", memberInput),
    ).resolves.toBe(response);

    const expectedPath = "/api/organizations/synthetic%20organization%2F1/members";
    expect(calls[0]).toEqual({
      path: expectedPath,
      init: undefined,
    });
    expect(calls[1].path).toBe(expectedPath);
    expect(calls[1].init?.method).toBe("POST");
    expect(parseJsonBody(calls[1])).toEqual(memberInput);
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
});
