import type {
  AdminRechargeOrder,
  PlatformAccount,
  PricingRule,
  UpdatePlatformAccountInput,
  WalletRechargeOrder,
} from "../api";

type ControlApiJsonRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export type AdminEnterpriseServiceDeps = {
  controlApiJsonRequest: ControlApiJsonRequest;
  retiredRechargeError: (flow: string) => never;
};

export function createAdminEnterpriseService({
  controlApiJsonRequest,
  retiredRechargeError,
}: AdminEnterpriseServiceDeps) {
  return {
    listPricingRules() {
      return controlApiJsonRequest<{ items: PricingRule[] }>("/api/admin/pricing-rules");
    },

    listAdminOrders() {
      return controlApiJsonRequest<{ items: AdminRechargeOrder[] }>("/api/admin/orders");
    },

    listPlatformAccounts(query?: string) {
      const queryText = query?.trim();
      const queryString = queryText ? `?query=${encodeURIComponent(queryText)}` : "";
      return controlApiJsonRequest<{ items: PlatformAccount[] }>(`/api/admin/accounts${queryString}`);
    },

    updatePlatformAccount(userId: string, input: UpdatePlatformAccountInput) {
      return controlApiJsonRequest<PlatformAccount>(
        `/api/admin/accounts/${encodeURIComponent(userId)}`,
        {
          method: "PUT",
          body: JSON.stringify(input),
        },
      );
    },

    deletePlatformAccount(userId: string) {
      return controlApiJsonRequest<PlatformAccount>(
        `/api/admin/accounts/${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      );
    },

    async reviewAdminOrder(
      orderId: string,
      input: { decision: "approve" | "reject"; note?: string },
    ): Promise<WalletRechargeOrder> {
      void orderId;
      void input;
      return retiredRechargeError("Manual recharge review");
    },
  };
}
