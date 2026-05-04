const {
  assertAlipayNotificationMatchesOrder,
  getAlipayCapabilities,
  createAlipayPayment,
  parseAlipayNotification,
  queryAlipayPayment,
  renderAlipayCheckoutPage,
} = require("./alipay");
const { getWechatCapabilities, createWechatPayment, parseWechatNotification, queryWechatPayment } = require("./wechat");
const {
  getBankTransferConfig,
  getPaymentMockAllowedHosts,
  getRequestHintHostname,
  isDemoMockAllowedForRequest,
} = require("./shared");

function getRechargeCapabilities(req) {
  const requestHost = getRequestHintHostname(req) || null;
  const demoMockEnabled = isDemoMockAllowedForRequest(req);
  const wechat = getWechatCapabilities();
  const alipay = getAlipayCapabilities();
  const bankTransfer = getBankTransferConfig();

  return {
    requestHost,
    demoMockEnabled,
    demoMockAllowedHosts: getPaymentMockAllowedHosts(),
    methods: [
      {
        paymentMethod: "wechat_pay",
        label: "微信支付",
        detail: "PC 扫码 / 移动 H5",
        live: wechat,
        demoMock: {
          available: demoMockEnabled,
          reason: demoMockEnabled ? null : "Current host is not allowed to use demo mock payments.",
          scenes: ["desktop_qr"],
        },
      },
      {
        paymentMethod: "alipay",
        label: "支付宝",
        detail: "电脑网站支付 / 手机网站支付",
        live: alipay,
        demoMock: {
          available: demoMockEnabled,
          reason: demoMockEnabled ? null : "Current host is not allowed to use demo mock payments.",
          scenes: ["desktop_qr"],
        },
      },
      {
        paymentMethod: "bank_transfer",
        label: "对公转账",
        detail: "企业采购 / 财务审核入账",
        live: {
          available: bankTransfer.available,
          reason: bankTransfer.reason,
          scenes: ["bank_transfer"],
        },
        demoMock: {
          available: false,
          reason: "Bank transfer demo is not exposed as a mock payment path.",
          scenes: [],
        },
        bankAccount: bankTransfer.account,
      },
    ],
  };
}

async function createLiveRechargeSession(order, req) {
  if (order.paymentMethod === "wechat_pay") {
    return createWechatPayment(order, req);
  }
  if (order.paymentMethod === "alipay") {
    return createAlipayPayment(order, req);
  }
  if (order.paymentMethod === "bank_transfer") {
    const bankTransfer = getBankTransferConfig();
    if (!bankTransfer.available) {
      const error = new Error(bankTransfer.reason || "Bank transfer is not configured.");
      error.statusCode = 503;
      error.code = "PAYMENT_PROVIDER_NOT_CONFIGURED";
      throw error;
    }
    return {
      provider: "bank_transfer",
      status: "pending",
      bankAccount: bankTransfer.account,
      qrCodeHint: "Complete the company bank transfer, then upload the transfer proof for review.",
    };
  }

  const error = new Error(`Unsupported payment method ${order.paymentMethod}`);
  error.statusCode = 400;
  error.code = "BAD_REQUEST";
  throw error;
}

async function refreshRechargeOrder(order) {
  if (order.mode !== "live") {
    return {
      status: order.status,
      provider: order.provider,
      providerTradeNo: order.providerTradeNo || null,
      notifyPayload: order.notifyPayload || null,
    };
  }

  if (order.paymentMethod === "wechat_pay") {
    return queryWechatPayment(order);
  }
  if (order.paymentMethod === "alipay") {
    return queryAlipayPayment(order);
  }

  return {
    status: order.status,
    provider: order.provider,
    providerTradeNo: order.providerTradeNo || null,
    notifyPayload: order.notifyPayload || null,
  };
}

module.exports = {
  assertAlipayNotificationMatchesOrder,
  createLiveRechargeSession,
  getRechargeCapabilities,
  parseAlipayNotification,
  parseWechatNotification,
  refreshRechargeOrder,
  renderAlipayCheckoutPage,
};
