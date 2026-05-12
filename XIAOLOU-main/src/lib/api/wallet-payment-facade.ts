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
  WalletRechargeTransferProofInput,
} from "./wallet-types";

export type WalletPaymentServiceContract = {
  getWallet: (ownerType?: WalletOwnerType, ownerId?: string) => Promise<Wallet>;
  listWallets: (ownerType?: WalletOwnerType, ownerId?: string) => Promise<{ items: Wallet[] }>;
  listWalletLedger: (walletId: string) => Promise<{ items: WalletLedgerEntry[] }>;
  getWalletUsageStats: (mode?: CreditUsageMode, ownerId?: string) => Promise<CreditUsageStats>;
  searchCreditUsageSubjects: (search?: string) => Promise<{ items: CreditUsageSubject[] }>;
  getAdminCreditUsageStats: (input: {
    subjectType: CreditUsageSubject["type"];
    subjectId?: string | null;
  }) => Promise<CreditUsageStats>;
  createWalletRechargeOrder: (
    input: CreateWalletRechargeOrderInput,
  ) => Promise<WalletRechargeOrder>;
  getWalletRechargeCapabilities: () => Promise<WalletRechargeCapabilities>;
  getWalletRechargeOrder: (orderId: string) => Promise<WalletRechargeOrder>;
  refreshWalletRechargeOrderStatus: (orderId: string) => Promise<WalletRechargeOrder>;
  submitWalletRechargeTransferProof: (
    orderId: string,
    input: WalletRechargeTransferProofInput,
  ) => Promise<WalletRechargeOrder>;
  confirmWalletRechargeOrder: (orderId: string) => Promise<WalletRechargeOrder>;
};

export function createWalletPaymentFacade(walletPaymentService: WalletPaymentServiceContract) {
  return {
    getWallet(ownerType?: WalletOwnerType, ownerId?: string) {
      return walletPaymentService.getWallet(ownerType, ownerId);
    },
    listWallets(ownerType?: WalletOwnerType, ownerId?: string) {
      return walletPaymentService.listWallets(ownerType, ownerId);
    },
    listWalletLedger(walletId: string) {
      return walletPaymentService.listWalletLedger(walletId);
    },
    getWalletUsageStats(mode?: CreditUsageMode, ownerId?: string) {
      return walletPaymentService.getWalletUsageStats(mode, ownerId);
    },
    searchCreditUsageSubjects(search?: string) {
      return walletPaymentService.searchCreditUsageSubjects(search);
    },
    getAdminCreditUsageStats(input: {
      subjectType: CreditUsageSubject["type"];
      subjectId?: string | null;
    }) {
      return walletPaymentService.getAdminCreditUsageStats(input);
    },
    createWalletRechargeOrder(input: CreateWalletRechargeOrderInput) {
      return walletPaymentService.createWalletRechargeOrder(input);
    },
    getWalletRechargeCapabilities() {
      return walletPaymentService.getWalletRechargeCapabilities();
    },
    getWalletRechargeOrder(orderId: string) {
      return walletPaymentService.getWalletRechargeOrder(orderId);
    },
    refreshWalletRechargeOrderStatus(orderId: string) {
      return walletPaymentService.refreshWalletRechargeOrderStatus(orderId);
    },
    submitWalletRechargeTransferProof(
      orderId: string,
      input: WalletRechargeTransferProofInput,
    ) {
      return walletPaymentService.submitWalletRechargeTransferProof(orderId, input);
    },
    confirmWalletRechargeOrder(orderId: string) {
      return walletPaymentService.confirmWalletRechargeOrder(orderId);
    },
  };
}
