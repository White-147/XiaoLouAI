import type { AdminRechargeOrder, PricingRule, WalletRechargeOrder } from "../api";

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
