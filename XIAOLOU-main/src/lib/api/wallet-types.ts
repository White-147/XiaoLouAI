export type WalletOwnerType = "user" | "organization" | "platform";

export type Wallet = {
  id?: string;
  ownerType?: WalletOwnerType;
  walletOwnerType?: WalletOwnerType;
  ownerId: string;
  displayName?: string;
  availableCredits?: number;
  frozenCredits?: number;
  creditsAvailable: number;
  creditsFrozen: number;
  currency: string;
  status?: string;
  allowNegative?: boolean;
  unlimitedCredits?: boolean;
  updatedAt: string;
};

export type WalletLedgerEntry = {
  id: string;
  walletId: string;
  entryType: string;
  amount: number;
  balanceAfter: number;
  frozenBalanceAfter: number;
  sourceType: string;
  sourceId: string;
  projectId: string | null;
  orderId: string | null;
  createdBy: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CreditUsageMode = "personal" | "organization";

export type CreditUsageSeriesPoint = {
  bucketStart: string;
  bucketLabel: string;
  consumedCredits: number;
  refundedCredits: number;
};

export type CreditUsageSubject = {
  type: WalletOwnerType | "unknown";
  id: string | null;
  label: string;
  detail: string | null;
  role?: string;
};

export type CreditUsageStats = {
  subject: CreditUsageSubject;
  mode: CreditUsageMode | "admin" | null;
  windowDays: number;
  bucket: "day" | string;
  wallets: Wallet[];
  summary: {
    consumedCredits: number;
    todayConsumedCredits: number;
    refundedCredits: number;
    pendingFrozenCredits: number;
    availableCredits: number;
    frozenCredits: number;
    recentTaskCount: number;
    lastActivityAt: string | null;
  };
  series: CreditUsageSeriesPoint[];
  recentEntries: WalletLedgerEntry[];
};

export type WalletRechargePaymentMethod = "wechat_pay" | "alipay" | "bank_transfer";
export type WalletRechargeMode = "live" | "demo_mock";
export type WalletRechargeScene =
  | "desktop_qr"
  | "mobile_h5"
  | "pc_page"
  | "mobile_wap"
  | "bank_transfer";

export type BankTransferAccount = {
  accountName: string;
  bankName: string;
  accountNo: string;
  branchName?: string | null;
  remarkTemplate?: string | null;
  instructions?: string | null;
};

export type WalletRechargeOrder = {
  id: string;
  planId: string;
  planName: string;
  billingCycle: string;
  paymentMethod: WalletRechargePaymentMethod | string;
  provider?: string | null;
  scene?: WalletRechargeScene | string | null;
  mode?: WalletRechargeMode | string;
  amount: number;
  credits: number;
  currency: string;
  status: string;
  actorId?: string;
  walletId?: string;
  walletOwnerType?: WalletOwnerType;
  walletOwnerId?: string;
  payerType?: WalletOwnerType;
  providerTradeNo?: string | null;
  codeUrl?: string | null;
  h5Url?: string | null;
  redirectUrl?: string | null;
  notifyPayload?: Record<string, unknown> | null;
  paidAt?: string | null;
  expiredAt?: string | null;
  failureReason?: string | null;
  voucherFiles?: string[];
  reviewStatus?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  reviewNote?: string | null;
  qrCodePayload?: string | null;
  qrCodeHint?: string | null;
  bankAccount?: BankTransferAccount | null;
  transferReference?: string | null;
  transferNote?: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string | null;
};

export type CreateWalletRechargeOrderInput = {
  planId: string;
  planName: string;
  billingCycle: string;
  paymentMethod: WalletRechargePaymentMethod | string;
  mode?: WalletRechargeMode;
  scene?: WalletRechargeScene;
  amount: number;
  credits: number;
  walletId?: string;
};

export type WalletRechargeTransferProofInput = {
  voucherFiles: string[];
  note?: string;
  transferReference?: string;
};

export type WalletRechargeMethodCapability = {
  paymentMethod: WalletRechargePaymentMethod;
  label: string;
  detail: string;
  live: {
    available: boolean;
    reason?: string | null;
    scenes: WalletRechargeScene[];
  };
  demoMock: {
    available: boolean;
    reason?: string | null;
    scenes: WalletRechargeScene[];
  };
  bankAccount?: BankTransferAccount | null;
};

export type WalletRechargeCapabilities = {
  requestHost: string | null;
  demoMockEnabled: boolean;
  demoMockAllowedHosts: string[];
  methods: WalletRechargeMethodCapability[];
};
