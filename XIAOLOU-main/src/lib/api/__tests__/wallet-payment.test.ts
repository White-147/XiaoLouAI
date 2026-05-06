import { describe, expect, it } from "vitest";
import type {
  CreditUsageStats,
  Wallet,
  WalletLedgerEntry,
  WalletOwnerType,
} from "../../api";
import { createWalletPaymentService } from "../wallet-payment";
import {
  SYNTHETIC_ACTOR_ID,
  SYNTHETIC_CREATED_AT,
  SYNTHETIC_UPDATED_AT,
  type RequestCall,
  type RequestHandler,
} from "./synthetic-fixtures";

type WalletPaymentServiceDeps = Parameters<typeof createWalletPaymentService>[0];

const SYNTHETIC_NOT_FOUND = new Error("synthetic route not found");

function createSyntheticWallet(overrides: Partial<Wallet> = {}): Wallet {
  return {
    id: "synthetic-wallet",
    ownerType: "user",
    walletOwnerType: "user",
    ownerId: SYNTHETIC_ACTOR_ID,
    displayName: "Synthetic Wallet",
    availableCredits: 120,
    frozenCredits: 5,
    creditsAvailable: 120,
    creditsFrozen: 5,
    currency: "CNY",
    status: "active",
    updatedAt: SYNTHETIC_CREATED_AT,
    ...overrides,
  };
}

function createSyntheticLedgerEntry(overrides: Partial<WalletLedgerEntry> = {}): WalletLedgerEntry {
  return {
    id: "synthetic-ledger-entry",
    walletId: "synthetic-wallet",
    entryType: "credit",
    amount: 12,
    balanceAfter: 120,
    frozenBalanceAfter: 5,
    sourceType: "synthetic",
    sourceId: "synthetic-source",
    projectId: null,
    orderId: null,
    createdBy: SYNTHETIC_ACTOR_ID,
    metadata: {
      fixture: "synthetic",
    },
    createdAt: SYNTHETIC_UPDATED_AT,
    ...overrides,
  };
}

function createSyntheticUsageStats(overrides: Partial<CreditUsageStats> = {}): CreditUsageStats {
  const wallet = createSyntheticWallet();
  return {
    subject: {
      type: "user",
      id: SYNTHETIC_ACTOR_ID,
      label: "User synthetic-actor",
      detail: "synthetic fixture",
    },
    mode: "personal",
    windowDays: 30,
    bucket: "day",
    wallets: [wallet],
    summary: {
      consumedCredits: 8,
      todayConsumedCredits: 2,
      refundedCredits: 0,
      pendingFrozenCredits: 5,
      availableCredits: 120,
      frozenCredits: 5,
      recentTaskCount: 1,
      lastActivityAt: "2026-05-05T00:02:00.000Z",
    },
    series: [],
    recentEntries: [],
    ...overrides,
  };
}

function createServiceHarness({
  actorId = SYNTHETIC_ACTOR_ID,
  handler = () => createSyntheticWallet(),
  localLoopback = false,
  superAdminDemoActorId = "synthetic-super-admin",
}: {
  actorId?: string;
  handler?: RequestHandler;
  localLoopback?: boolean;
  superAdminDemoActorId?: string;
} = {}) {
  const calls: RequestCall[] = [];
  const emptyWalletCalls: Array<{ ownerType: WalletOwnerType; ownerId: string }> = [];
  const localLoopbackChecks: string[] = [];
  const normalizedWallets: Array<{ wallet: Wallet; actorId: string }> = [];
  const retiredFlows: string[] = [];

  const deps: WalletPaymentServiceDeps = {
    controlApiJsonRequest: async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      return (await handler(path, init)) as T;
    },
    getCurrentActorId: () => actorId,
    isRouteNotFoundError: (error) => error === SYNTHETIC_NOT_FOUND,
    isLocalLoopbackAccess: () => {
      localLoopbackChecks.push("checked");
      return localLoopback;
    },
    superAdminDemoActorId,
    createEmptyWallet: (ownerType, ownerId) => {
      emptyWalletCalls.push({ ownerType, ownerId });
      return createSyntheticWallet({
        id: `synthetic-empty-${ownerType}-${ownerId}`,
        ownerType,
        walletOwnerType: ownerType,
        ownerId,
        displayName: `Synthetic Empty ${ownerType} ${ownerId}`,
        availableCredits: 0,
        frozenCredits: 0,
        creditsAvailable: 0,
        creditsFrozen: 0,
      });
    },
    normalizeWalletRecord: (wallet, normalizedActorId) => {
      normalizedWallets.push({ wallet, actorId: normalizedActorId });
      return {
        ...wallet,
        displayName: `${wallet.displayName ?? "Synthetic Wallet"} normalized for ${normalizedActorId}`,
      };
    },
    retiredRechargeError: (flow) => {
      retiredFlows.push(flow);
      throw new Error(`retired:${flow}`);
    },
  };

  return {
    calls,
    emptyWalletCalls,
    localLoopbackChecks,
    normalizedWallets,
    retiredFlows,
    service: createWalletPaymentService(deps),
  };
}

describe("createWalletPaymentService", () => {
  it("reads and normalizes a wallet through the stable Control API query", async () => {
    const wallet = createSyntheticWallet({
      id: "synthetic-organization-wallet",
      ownerType: "organization",
      walletOwnerType: "organization",
      ownerId: "synthetic-organization",
    });
    const { calls, normalizedWallets, service } = createServiceHarness({
      handler: () => wallet,
    });

    await expect(service.getWallet("organization", "synthetic-organization")).resolves.toMatchObject({
      id: "synthetic-organization-wallet",
      displayName: "Synthetic Wallet normalized for synthetic-organization",
    });

    expect(calls).toEqual([
      {
        path: "/api/wallet?accountOwnerType=organization&accountOwnerId=synthetic-organization",
        init: undefined,
      },
    ]);
    expect(normalizedWallets).toEqual([
      {
        wallet,
        actorId: "synthetic-organization",
      },
    ]);
  });

  it("lists wallets with normalization and not-found fallback boundaries", async () => {
    const listedWallet = createSyntheticWallet({ id: "synthetic-listed-wallet" });
    const successHarness = createServiceHarness({
      handler: () => ({
        items: [listedWallet],
      }),
    });

    await expect(successHarness.service.listWallets("platform", "synthetic-platform")).resolves.toEqual({
      items: [
        {
          ...listedWallet,
          displayName: "Synthetic Wallet normalized for synthetic-platform",
        },
      ],
    });
    expect(successHarness.calls).toEqual([
      {
        path: "/api/wallets?accountOwnerType=system&accountOwnerId=synthetic-platform",
        init: undefined,
      },
    ]);
    expect(successHarness.normalizedWallets).toEqual([
      {
        wallet: listedWallet,
        actorId: "synthetic-platform",
      },
    ]);

    const fallbackHarness = createServiceHarness({
      handler: () => {
        throw SYNTHETIC_NOT_FOUND;
      },
    });
    await expect(fallbackHarness.service.listWallets("user", "synthetic-missing-user")).resolves.toEqual({
      items: [
        createSyntheticWallet({
          id: "synthetic-empty-user-synthetic-missing-user",
          ownerId: "synthetic-missing-user",
          displayName: "Synthetic Empty user synthetic-missing-user",
          availableCredits: 0,
          frozenCredits: 0,
          creditsAvailable: 0,
          creditsFrozen: 0,
        }),
      ],
    });
    expect(fallbackHarness.emptyWalletCalls).toEqual([
      {
        ownerType: "user",
        ownerId: "synthetic-missing-user",
      },
    ]);

    const superAdminHarness = createServiceHarness({
      handler: () => {
        throw SYNTHETIC_NOT_FOUND;
      },
      superAdminDemoActorId: "synthetic-super-admin",
    });
    await expect(superAdminHarness.service.listWallets("user", "synthetic-super-admin")).resolves.toEqual({
      items: [],
    });
    expect(superAdminHarness.localLoopbackChecks).toEqual(["checked"]);
    expect(superAdminHarness.emptyWalletCalls).toEqual([]);
  });

  it("reads wallet ledger through encoded paths and falls back to empty items on not-found", async () => {
    const ledgerEntry = createSyntheticLedgerEntry();
    const successHarness = createServiceHarness({
      handler: () => ({
        items: [ledgerEntry],
      }),
    });

    await expect(successHarness.service.listWalletLedger("synthetic wallet/with slash")).resolves.toEqual({
      items: [ledgerEntry],
    });
    expect(successHarness.calls).toEqual([
      {
        path: "/api/wallets/synthetic%20wallet%2Fwith%20slash/ledger",
        init: undefined,
      },
    ]);

    const fallbackHarness = createServiceHarness({
      handler: () => {
        throw SYNTHETIC_NOT_FOUND;
      },
    });
    await expect(fallbackHarness.service.listWalletLedger("synthetic-missing-wallet")).resolves.toEqual({
      items: [],
    });
  });

  it("reads usage stats and builds synthetic not-found fallback summaries", async () => {
    const stats = createSyntheticUsageStats({
      mode: "organization",
      subject: {
        type: "organization",
        id: "synthetic-actor",
        label: "Organization synthetic-actor",
        detail: "synthetic fixture",
      },
    });
    const successHarness = createServiceHarness({
      handler: () => stats,
    });

    await expect(successHarness.service.getWalletUsageStats("organization")).resolves.toBe(stats);
    expect(successHarness.calls).toEqual([
      {
        path: "/api/wallet/usage-stats?accountOwnerType=organization&accountOwnerId=synthetic-actor&mode=organization",
        init: undefined,
      },
    ]);

    const fallbackHarness = createServiceHarness({
      handler: () => {
        throw SYNTHETIC_NOT_FOUND;
      },
    });
    await expect(fallbackHarness.service.getWalletUsageStats("personal")).resolves.toMatchObject({
      subject: {
        type: "user",
        id: "synthetic-actor",
        label: "User synthetic-actor",
        detail: "canonical wallet read surface",
      },
      mode: "personal",
      summary: {
        availableCredits: 0,
        frozenCredits: 0,
        consumedCredits: 0,
        todayConsumedCredits: 0,
        recentTaskCount: 0,
      },
      series: [],
      recentEntries: [],
    });
    expect(fallbackHarness.emptyWalletCalls).toEqual([
      {
        ownerType: "user",
        ownerId: "synthetic-actor",
      },
    ]);
  });

  it("reads organization usage stats with an explicit owner id", async () => {
    const stats = createSyntheticUsageStats({
      mode: "organization",
      subject: {
        type: "organization",
        id: "synthetic-organization",
        label: "Organization synthetic-organization",
        detail: "synthetic fixture",
      },
    });
    const { calls, service } = createServiceHarness({
      handler: () => stats,
    });

    await expect(service.getWalletUsageStats("organization", "synthetic-organization")).resolves.toBe(stats);
    expect(calls).toEqual([
      {
        path: "/api/wallet/usage-stats?accountOwnerType=organization&accountOwnerId=synthetic-organization&mode=organization",
        init: undefined,
      },
    ]);
  });

  it("keeps local credit usage subject searches and admin stats network-free", async () => {
    const { calls, service } = createServiceHarness();

    await expect(service.searchCreditUsageSubjects(" synthetic-ACTOR ")).resolves.toEqual({
      items: [
        {
          type: "user",
          id: "synthetic-actor",
          label: "User synthetic-actor",
          detail: "canonical wallet read surface",
        },
      ],
    });
    await expect(service.searchCreditUsageSubjects("missing subject")).resolves.toEqual({
      items: [],
    });
    await expect(
      service.getAdminCreditUsageStats({
        subjectType: "platform",
        subjectId: null,
      }),
    ).resolves.toMatchObject({
      subject: {
        type: "platform",
        id: null,
        label: "Platform",
        detail: "legacy admin billing read flow retired",
      },
      mode: "admin",
      summary: {
        consumedCredits: 0,
        availableCredits: 0,
        frozenCredits: 0,
      },
    });
    expect(calls).toEqual([]);
  });

  it("keeps recharge capabilities and retired recharge wrappers closed without network calls", async () => {
    const { calls, retiredFlows, service } = createServiceHarness();

    await expect(service.getWalletRechargeCapabilities()).resolves.toMatchObject({
      requestHost: null,
      demoMockEnabled: false,
      demoMockAllowedHosts: [],
      methods: [
        {
          paymentMethod: "wechat_pay",
          live: { available: false, scenes: [] },
          demoMock: { available: false, scenes: [] },
        },
        {
          paymentMethod: "alipay",
          live: { available: false, scenes: [] },
          demoMock: { available: false, scenes: [] },
        },
        {
          paymentMethod: "bank_transfer",
          live: { available: false, scenes: [] },
          demoMock: { available: false, scenes: [] },
        },
      ],
    });

    await expect(
      service.createWalletRechargeOrder({
        planId: "synthetic-plan",
        planName: "Synthetic plan",
        billingCycle: "monthly",
        paymentMethod: "wechat_pay",
        amount: 100,
        credits: 1000,
      }),
    ).rejects.toThrow("retired:Wallet recharge order creation");
    await expect(service.getWalletRechargeOrder("synthetic-order")).rejects.toThrow(
      "retired:Wallet recharge order lookup",
    );
    await expect(service.refreshWalletRechargeOrderStatus("synthetic-order")).rejects.toThrow(
      "retired:Wallet recharge order refresh",
    );
    await expect(
      service.submitWalletRechargeTransferProof("synthetic-order", {
        voucherFiles: ["synthetic-voucher"],
        note: "synthetic note",
        transferReference: "synthetic-reference",
      }),
    ).rejects.toThrow("retired:Wallet recharge transfer proof submission");
    await expect(service.confirmWalletRechargeOrder("synthetic-order")).rejects.toThrow(
      "retired:Wallet recharge confirmation",
    );

    expect(retiredFlows).toEqual([
      "Wallet recharge order creation",
      "Wallet recharge order lookup",
      "Wallet recharge order refresh",
      "Wallet recharge transfer proof submission",
      "Wallet recharge confirmation",
    ]);
    expect(calls).toEqual([]);
  });
});
