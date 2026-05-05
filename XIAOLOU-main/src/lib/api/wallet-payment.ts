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
} from "../api";

type ControlApiJsonRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export type WalletPaymentServiceDeps = {
  controlApiJsonRequest: ControlApiJsonRequest;
  getCurrentActorId: () => string;
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
  isRouteNotFoundError,
  isLocalLoopbackAccess,
  superAdminDemoActorId,
  createEmptyWallet,
  normalizeWalletRecord,
  retiredRechargeError,
}: WalletPaymentServiceDeps) {
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
    async getWallet(ownerType: WalletOwnerType = "user", ownerId = getCurrentActorId()) {
      const query = buildWalletQuery(ownerType, ownerId);
      const wallet = await controlApiJsonRequest<Wallet>(`/api/wallet?${query}`);
      return normalizeWalletRecord(wallet, ownerId);
    },

    async listWallets(ownerType: WalletOwnerType = "user", ownerId = getCurrentActorId()) {
      try {
        const query = buildWalletQuery(ownerType, ownerId);
        const response = await controlApiJsonRequest<{ items: Wallet[] }>(`/api/wallets?${query}`);
        return {
          items: response.items.map((wallet) => normalizeWalletRecord(wallet, ownerId)),
        };
      } catch (error) {
        if (!isRouteNotFoundError(error)) throw error;

        const effectiveActorId =
          ownerId === superAdminDemoActorId && !isLocalLoopbackAccess() ? "guest" : ownerId;
        if (effectiveActorId === "guest" || effectiveActorId === "ops_demo_001" || effectiveActorId === superAdminDemoActorId) {
          return { items: [] };
        }

        return { items: [createEmptyWallet(ownerType, effectiveActorId)] };
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

    async getWalletUsageStats(mode: CreditUsageMode = "personal") {
      const actorId = getCurrentActorId();
      const ownerType: WalletOwnerType = mode === "organization" ? "organization" : "user";
      const query = buildWalletQuery(ownerType, actorId, { mode });
      try {
        return await controlApiJsonRequest<CreditUsageStats>(`/api/wallet/usage-stats?${query}`);
      } catch (error) {
        if (!isRouteNotFoundError(error)) throw error;
        const wallet = createEmptyWallet(ownerType, actorId);
        return emptyCreditUsageStats(
          {
            type: ownerType,
            id: actorId,
            label: ownerType === "organization" ? `Organization ${actorId}` : `User ${actorId}`,
            detail: "canonical wallet read surface",
          },
          mode,
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
