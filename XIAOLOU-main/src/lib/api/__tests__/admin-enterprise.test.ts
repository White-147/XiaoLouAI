import { describe, expect, it } from "vitest";
import { createAdminEnterpriseService } from "../admin-enterprise";
import type { RequestCall } from "./synthetic-fixtures";

function createRequestRecorder(response: unknown) {
  const calls: RequestCall[] = [];
  const controlApiJsonRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push({ path, init });
    return response as T;
  };

  return { calls, controlApiJsonRequest };
}

function createRetiredRecorder() {
  const flows: string[] = [];
  const retiredRechargeError = (flow: string): never => {
    flows.push(flow);
    throw new Error(`retired:${flow}`);
  };

  return { flows, retiredRechargeError };
}

describe("createAdminEnterpriseService", () => {
  it("lists pricing rules through the stable admin route", async () => {
    const response = {
      items: [
        {
          id: "synthetic-pricing-rule",
          priceCents: 100,
        },
      ],
    };
    const { calls, controlApiJsonRequest } = createRequestRecorder(response);
    const { retiredRechargeError } = createRetiredRecorder();
    const service = createAdminEnterpriseService({
      controlApiJsonRequest,
      retiredRechargeError,
    });

    await expect(service.listPricingRules()).resolves.toBe(response);
    expect(calls).toEqual([
      {
        path: "/api/admin/pricing-rules",
        init: undefined,
      },
    ]);
  });

  it("lists admin orders through the stable admin route", async () => {
    const response = {
      items: [
        {
          id: "synthetic-admin-order",
          status: "pending",
        },
      ],
    };
    const { calls, controlApiJsonRequest } = createRequestRecorder(response);
    const { retiredRechargeError } = createRetiredRecorder();
    const service = createAdminEnterpriseService({
      controlApiJsonRequest,
      retiredRechargeError,
    });

    await expect(service.listAdminOrders()).resolves.toBe(response);
    expect(calls).toEqual([
      {
        path: "/api/admin/orders",
        init: undefined,
      },
    ]);
  });

  it("reviews admin recharge orders through the reopened admin route", async () => {
    const response = {
      id: "synthetic-admin-order",
      status: "paid",
      reviewStatus: "approved",
    };
    const { calls, controlApiJsonRequest } = createRequestRecorder(response);
    const { flows, retiredRechargeError } = createRetiredRecorder();
    const service = createAdminEnterpriseService({
      controlApiJsonRequest,
      retiredRechargeError,
    });

    await expect(
      service.reviewAdminOrder("synthetic-admin-order", {
        decision: "approve",
        note: "synthetic approval note",
      }),
    ).resolves.toBe(response);
    expect(flows).toEqual([]);
    expect(calls).toEqual([
      {
        path: "/api/admin/orders/synthetic-admin-order/review",
        init: {
          method: "POST",
          body: JSON.stringify({
            decision: "approve",
            note: "synthetic approval note",
          }),
        },
      },
    ]);
  });
});
