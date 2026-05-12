import type {
  AdminOrderReviewInput,
  AdminRechargeOrder,
  PlatformAccount,
  PricingRule,
  UpdatePlatformAccountInput,
} from "./admin-enterprise-types";
import type { WalletRechargeOrder } from "./wallet-types";

export type AdminEnterpriseServiceContract = {
  listPricingRules: () => Promise<{ items: PricingRule[] }>;
  listAdminOrders: () => Promise<{ items: AdminRechargeOrder[] }>;
  listPlatformAccounts: (query?: string) => Promise<{ items: PlatformAccount[] }>;
  updatePlatformAccount: (
    userId: string,
    input: UpdatePlatformAccountInput,
  ) => Promise<PlatformAccount>;
  deletePlatformAccount: (userId: string) => Promise<PlatformAccount>;
  reviewAdminOrder: (
    orderId: string,
    input: AdminOrderReviewInput,
  ) => Promise<WalletRechargeOrder>;
};

export function createAdminEnterpriseFacade(adminEnterpriseService: AdminEnterpriseServiceContract) {
  return {
    listPricingRules() {
      return adminEnterpriseService.listPricingRules();
    },
    listAdminOrders() {
      return adminEnterpriseService.listAdminOrders();
    },
    listPlatformAccounts(query?: string) {
      return adminEnterpriseService.listPlatformAccounts(query);
    },
    updatePlatformAccount(userId: string, input: UpdatePlatformAccountInput) {
      return adminEnterpriseService.updatePlatformAccount(userId, input);
    },
    deletePlatformAccount(userId: string) {
      return adminEnterpriseService.deletePlatformAccount(userId);
    },
    reviewAdminOrder(orderId: string, input: AdminOrderReviewInput) {
      return adminEnterpriseService.reviewAdminOrder(orderId, input);
    },
  };
}
