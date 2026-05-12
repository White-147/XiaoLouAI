import type {
  CreateWalletRechargeOrderInput,
  CreditUsageMode,
  CreditUsageStats,
  CreditUsageSubject,
  Wallet,
  WalletLedgerEntry,
  WalletOwnerType,
  WalletRechargeCapabilities,
  WalletRechargeOrder,
} from "./wallet-types";
import type { ControlOwnerScope } from "../control-owner-scope";

type ControlApiJsonRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export type WalletPaymentServiceDeps = {
  controlApiJsonRequest: ControlApiJsonRequest;
  getCurrentActorId: () => string;
  resolveCurrentOwnerScope: () => ControlOwnerScope;
  isRouteNotFoundError: (error: unknown) => boolean;
  isLocalLoopbackAccess: () => boolean;
  superAdminDemoActorId: string;
  createEmptyWallet: (ownerType: WalletOwnerType, ownerId: string) => Wallet;
  normalizeWalletRecord: (wallet: Wallet, actorId: string) => Wallet;
  retiredRechargeError: (flow: string) => never;
};

function walletOwnerTypeForControlApi(ownerType: WalletOwnerType) {
  return ownerType === "platform" ? "system" : ownerType;
}

function walletOwnerTypeFromControlScope(ownerScope: ControlOwnerScope): WalletOwnerType {
  if (ownerScope.accountOwnerType === "organization") return "organization";
  if (ownerScope.accountOwnerType === "system") return "platform";
  return "user";
}

function buildWalletQuery(
  ownerType: WalletOwnerType,
  ownerId: string,
  extra?: Record<string, string | undefined>,
) {
  const params = new URLSearchParams({
    accountOwnerType: walletOwnerTypeForControlApi(ownerType),
    accountOwnerId: ownerId || "guest",
  });

  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) params.set(key, value);
  }

  return params.toString();
}

function emptyCreditUsageStats(
  subject: CreditUsageSubject,
  mode: CreditUsageStats["mode"],
  wallets: Wallet[] = [],
): CreditUsageStats {
  return {
    subject,
    mode,
    windowDays: 30,
    bucket: "day",
    wallets,
    summary: {
      consumedCredits: 0,
      todayConsumedCredits: 0,
      refundedCredits: 0,
      pendingFrozenCredits: 0,
      availableCredits: wallets.reduce((sum, wallet) => sum + Number(wallet.availableCredits ?? wallet.creditsAvailable ?? 0), 0),
      frozenCredits: wallets.reduce((sum, wallet) => sum + Number(wallet.frozenCredits ?? wallet.creditsFrozen ?? 0), 0),
      recentTaskCount: 0,
      lastActivityAt: null,
    },
    series: [],
    recentEntries: [],
  };
}

function retiredWalletRechargeCapabilities(): WalletRechargeCapabilities {
  const unavailable = "Retired during Windows-native cutover; real provider evidence is required before reopening recharge writes.";
  return {
    requestHost: typeof window === "undefined" ? null : window.location.host,
    demoMockEnabled: false,
    demoMockAllowedHosts: [],
    methods: [
      {
        paymentMethod: "wechat_pay",
        label: "WeChat Pay",
        detail: "Provider recharge writes are closed.",
        live: { available: false, reason: unavailable, scenes: [] },
        demoMock: { available: false, reason: unavailable, scenes: [] },
      },
      {
        paymentMethod: "alipay",
        label: "Alipay",
        detail: "Provider recharge writes are closed.",
        live: { available: false, reason: unavailable, scenes: [] },
        demoMock: { available: false, reason: unavailable, scenes: [] },
      },
      {
        paymentMethod: "bank_transfer",
        label: "Bank transfer",
        detail: "Manual recharge review is closed.",
        live: { available: false, reason: unavailable, scenes: [] },
        demoMock: { available: false, reason: unavailable, scenes: [] },
      },
    ],
  };
}

export function createWalletPaymentService({
  controlApiJsonRequest,
  getCurrentActorId,
  resolveCurrentOwnerScope,
  isRouteNotFoundError,
  isLocalLoopbackAccess,
  superAdminDemoActorId,
  createEmptyWallet,
  normalizeWalletRecord,
  retiredRechargeError,
}: WalletPaymentServiceDeps) {
  const resolveWalletOwner = (
    ownerType?: WalletOwnerType,
    ownerId?: string,
  ) => {
    if (ownerType) {
      return {
        ownerType,
        ownerId: ownerId ?? getCurrentActorId(),
      };
    }

    const ownerScope = resolveCurrentOwnerScope();
    return {
      ownerType: walletOwnerTypeFromControlScope(ownerScope),
      ownerId: ownerScope.accountOwnerId ?? getCurrentActorId(),
    };
  };

  const resolveUsageOwner = (
    mode?: CreditUsageMode,
    ownerId?: string,
  ) => {
    const actorId = getCurrentActorId();
    const ownerScope = ownerId ? null : resolveCurrentOwnerScope();
    const resolvedOwnerType = ownerScope
      ? walletOwnerTypeFromControlScope(ownerScope)
      : "user";
    const effectiveMode =
      mode ?? (resolvedOwnerType === "organization" ? "organization" : "personal");
    const ownerType: WalletOwnerType =
      effectiveMode === "organization" ? "organization" : "user";
    const effectiveOwnerId =
      ownerId ??
      (ownerType === resolvedOwnerType ? ownerScope?.accountOwnerId : null) ??
      actorId;

    return {
      mode: effectiveMode,
      ownerType,
      ownerId: effectiveOwnerId,
    };
  };

  const currentUserSubject = (): CreditUsageSubject => {
    const actorId = getCurrentActorId();
    return {
      type: "user",
      id: actorId,
      label: `User ${actorId}`,
      detail: "canonical wallet read surface",
    };
  };

  return {
    async getWallet(ownerType?: WalletOwnerType, ownerId?: string) {
      const owner = resolveWalletOwner(ownerType, ownerId);
      const query = buildWalletQuery(owner.ownerType, owner.ownerId);
      const wallet = await controlApiJsonRequest<Wallet>(`/api/wallet?${query}`);
      return normalizeWalletRecord(wallet, owner.ownerId);
    },

    async listWallets(ownerType?: WalletOwnerType, ownerId?: string) {
      const owner = resolveWalletOwner(ownerType, ownerId);
      try {
        const query = buildWalletQuery(owner.ownerType, owner.ownerId);
        const response = await controlApiJsonRequest<{ items: Wallet[] }>(`/api/wallets?${query}`);
        return {
          items: response.items.map((wallet) => normalizeWalletRecord(wallet, owner.ownerId)),
        };
      } catch (error) {
        if (!isRouteNotFoundError(error)) throw error;

        const effectiveActorId =
          owner.ownerId === superAdminDemoActorId && !isLocalLoopbackAccess() ? "guest" : owner.ownerId;
        if (effectiveActorId === "guest" || effectiveActorId === "ops_demo_001" || effectiveActorId === superAdminDemoActorId) {
          return { items: [] };
        }

        return { items: [createEmptyWallet(owner.ownerType, effectiveActorId)] };
      }
    },

    async listWalletLedger(walletId: string) {
      try {
        return await controlApiJsonRequest<{ items: WalletLedgerEntry[] }>(
          `/api/wallets/${encodeURIComponent(walletId)}/ledger`,
        );
      } catch (error) {
        if (isRouteNotFoundError(error)) {
          return { items: [] };
        }
        throw error;
      }
    },

    async getWalletUsageStats(mode?: CreditUsageMode, ownerId?: string) {
      const owner = resolveUsageOwner(mode, ownerId);
      const query = buildWalletQuery(owner.ownerType, owner.ownerId, { mode: owner.mode });
      try {
        return await controlApiJsonRequest<CreditUsageStats>(`/api/wallet/usage-stats?${query}`);
      } catch (error) {
        if (!isRouteNotFoundError(error)) throw error;
        const wallet = createEmptyWallet(owner.ownerType, owner.ownerId);
        return emptyCreditUsageStats(
          {
            type: owner.ownerType,
            id: owner.ownerId,
            label: owner.ownerType === "organization" ? `Organization ${owner.ownerId}` : `User ${owner.ownerId}`,
            detail: "canonical wallet read surface",
          },
          owner.mode,
          [wallet],
        );
      }
    },

    async searchCreditUsageSubjects(search?: string) {
      const normalizedSearch = search?.trim();
      const subject = currentUserSubject();
      if (normalizedSearch && !subject.label.toLowerCase().includes(normalizedSearch.toLowerCase())) {
        return { items: [] };
      }
      return { items: [subject] };
    },

    async getAdminCreditUsageStats(input: {
      subjectType: CreditUsageSubject["type"];
      subjectId?: string | null;
    }) {
      return emptyCreditUsageStats(
        {
          type: input.subjectType,
          id: input.subjectId ?? null,
          label: input.subjectId ? `${input.subjectType} ${input.subjectId}` : "Platform",
          detail: "legacy admin billing read flow retired",
        },
        "admin",
      );
    },

    async createWalletRechargeOrder(input: CreateWalletRechargeOrderInput): Promise<WalletRechargeOrder> {
      void input;
      return retiredRechargeError("Wallet recharge order creation");
    },

    async getWalletRechargeCapabilities() {
      return retiredWalletRechargeCapabilities();
    },

    async getWalletRechargeOrder(orderId: string): Promise<WalletRechargeOrder> {
      void orderId;
      return retiredRechargeError("Wallet recharge order lookup");
    },

    async refreshWalletRechargeOrderStatus(orderId: string): Promise<WalletRechargeOrder> {
      void orderId;
      return retiredRechargeError("Wallet recharge order refresh");
    },

    async submitWalletRechargeTransferProof(
      orderId: string,
      input: {
        voucherFiles: string[];
        note?: string;
        transferReference?: string;
      },
    ): Promise<WalletRechargeOrder> {
      void orderId;
      void input;
      return retiredRechargeError("Wallet recharge transfer proof submission");
    },

    async confirmWalletRechargeOrder(orderId: string): Promise<WalletRechargeOrder> {
      void orderId;
      return retiredRechargeError("Wallet recharge confirmation");
    },
  };
}
