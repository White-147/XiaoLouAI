const { createSign, createVerify } = require("node:crypto");
const { joinUrl, resolvePublicBaseUrl, resolveReturnBaseUrl, resolveSecretValue } = require("./shared");

const DEFAULT_ALIPAY_GATEWAY = "https://openapi.alipay.com/gateway.do";
const SANDBOX_ALIPAY_GATEWAY = "https://openapi-sandbox.dl.alipaydev.com/gateway.do";

function normalizeAlipayEnv(value) {
  const normalized = String(value || "sandbox").trim().toLowerCase();
  return normalized === "production" ? "production" : "sandbox";
}

function resolveAlipayGateway(env) {
  const override = String(process.env.ALIPAY_GATEWAY || "").trim();
  if (override) return override;
  return env === "production" ? DEFAULT_ALIPAY_GATEWAY : SANDBOX_ALIPAY_GATEWAY;
}

function formatAlipayAmount(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? amount.toFixed(2) : "0.00";
}

function buildAlipayConfig() {
  const appId = String(process.env.ALIPAY_APP_ID || "").trim();
  const privateKeyPem = resolveSecretValue(
    process.env.ALIPAY_PRIVATE_KEY || process.env.ALIPAY_PRIVATE_KEY_PATH,
  );
  const publicKeyPem = resolveSecretValue(
    process.env.ALIPAY_PUBLIC_KEY || process.env.ALIPAY_PUBLIC_KEY_PATH,
  );
  const sellerId = String(process.env.ALIPAY_SELLER_ID || "").trim();
  const env = normalizeAlipayEnv(process.env.ALIPAY_ENV);
  const gateway = resolveAlipayGateway(env);

  const missing = [];
  if (!appId) missing.push("ALIPAY_APP_ID");
  if (!privateKeyPem) missing.push("ALIPAY_PRIVATE_KEY");
  if (!publicKeyPem) missing.push("ALIPAY_PUBLIC_KEY");
  if (!sellerId) missing.push("ALIPAY_SELLER_ID");

  const available = missing.length === 0;
  return {
    available,
    reason: available ? null : `Missing ${missing.join(", ")}`,
    appId,
    sellerId,
    env,
    privateKeyPem,
    publicKeyPem,
    gateway,
  };
}

function assertAlipayConfigured() {
  const config = buildAlipayConfig();
  if (!config.available) {
    const error = new Error(config.reason || "Alipay is not configured.");
    error.statusCode = 503;
    error.code = "PAYMENT_PROVIDER_NOT_CONFIGURED";
    throw error;
  }
  return config;
}

function formatAlipayTimestamp(value = new Date()) {
  const pad = (input) => String(input).padStart(2, "0");
  return [
    value.getFullYear(),
    "-",
    pad(value.getMonth() + 1),
    "-",
    pad(value.getDate()),
    " ",
    pad(value.getHours()),
    ":",
    pad(value.getMinutes()),
    ":",
    pad(value.getSeconds()),
  ].join("");
}

function serializeAlipayValue(value) {
  if (value == null) return "";
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function buildAlipaySignContent(params) {
  return Object.keys(params)
    .filter((key) => key !== "sign" && key !== "sign_type" && params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .map((key) => `${key}=${serializeAlipayValue(params[key])}`)
    .join("&");
}

function signAlipayParams(params, privateKeyPem) {
  const signer = createSign("RSA-SHA256");
  signer.update(buildAlipaySignContent(params), "utf8");
  signer.end();
  return signer.sign(privateKeyPem, "base64");
}

function verifyAlipayParams(params, publicKeyPem) {
  const signature = String(params.sign || "").trim();
  if (!signature) return false;

  const verifier = createVerify("RSA-SHA256");
  verifier.update(buildAlipaySignContent(params), "utf8");
  verifier.end();
  return verifier.verify(publicKeyPem, signature, "base64");
}

function buildAlipayGatewayParams({ method, bizContent, notifyUrl, returnUrl, config }) {
  const params = {
    app_id: config.appId,
    method,
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: formatAlipayTimestamp(),
    version: "1.0",
    format: "JSON",
    biz_content: bizContent,
  };
  if (notifyUrl) {
    params.notify_url = notifyUrl;
  }
  if (returnUrl) {
    params.return_url = returnUrl;
  }
  params.sign = signAlipayParams(params, config.privateKeyPem);
  return params;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildAutoSubmitHtml(gateway, params) {
  const inputs = Object.entries(params)
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(serializeAlipayValue(value))}" />`,
    )
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Redirecting to Alipay</title>
  </head>
  <body>
    <form id="alipay-checkout" method="GET" action="${escapeHtml(gateway)}">
      ${inputs}
      <noscript><button type="submit">Continue to Alipay</button></noscript>
    </form>
    <script>document.getElementById("alipay-checkout").submit();</script>
  </body>
</html>`;
}

function buildAlipayBizContent(order, config = buildAlipayConfig()) {
  const bizContent = {
    out_trade_no: order.providerTradeNo || order.id,
    product_code: order.scene === "mobile_wap" ? "QUICK_WAP_WAY" : "FAST_INSTANT_TRADE_PAY",
    total_amount: formatAlipayAmount(order.amount),
    subject: order.planName,
    body: `${order.planName} ${order.credits} credits`,
    passback_params: encodeURIComponent(JSON.stringify({ orderId: order.id, walletId: order.walletId })),
    timeout_express: "15m",
  };
  if (config.sellerId) {
    bizContent.seller_id = config.sellerId;
  }
  return bizContent;
}

function createAlipayPayment(order) {
  assertAlipayConfigured();
  return {
    provider: "alipay",
    providerTradeNo: order.providerTradeNo || order.id,
    redirectUrl: `/api/payments/alipay/checkout/${encodeURIComponent(order.id)}`,
    qrCodeHint: "Redirect to Alipay to complete payment, then return to refresh status.",
    notifyPayload: null,
  };
}

function renderAlipayCheckoutPage(order, req) {
  const config = assertAlipayConfigured();
  const notifyUrl = joinUrl(resolvePublicBaseUrl(req), "/api/payments/alipay/notify");
  const returnUrl = `${resolveReturnBaseUrl(req)}/wallet/recharge?orderId=${encodeURIComponent(order.id)}`;
  const method = order.scene === "mobile_wap" ? "alipay.trade.wap.pay" : "alipay.trade.page.pay";
  const params = buildAlipayGatewayParams({
    method,
    bizContent: buildAlipayBizContent(order, config),
    notifyUrl,
    returnUrl,
    config,
  });
  return buildAutoSubmitHtml(config.gateway, params);
}

function getAlipayResponseEnvelope(method) {
  return `${method.replace(/\./g, "_")}_response`;
}

async function gatewayPost(config, method, bizContent) {
  const params = buildAlipayGatewayParams({
    method,
    bizContent,
    notifyUrl: null,
    returnUrl: null,
    config,
  });
  const response = await fetch(config.gateway, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body: new URLSearchParams(
      Object.entries(params).map(([key, value]) => [key, serializeAlipayValue(value)]),
    ),
  });

  const rawText = await response.text();
  let parsed = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    parsed = { rawText };
  }

  if (!response.ok) {
    const error = new Error(`Alipay request failed with status ${response.status}.`);
    error.statusCode = response.status;
    error.code = "ALIPAY_REQUEST_FAILED";
    error.details = parsed;
    throw error;
  }

  const envelope = getAlipayResponseEnvelope(method);
  return parsed?.[envelope] || parsed || {};
}

async function queryAlipayPayment(order) {
  const config = assertAlipayConfigured();
  const response = await gatewayPost(config, "alipay.trade.query", {
    out_trade_no: order.providerTradeNo || order.id,
  });
  if (String(response.code || "") !== "10000") {
    const error = new Error(response.sub_msg || response.msg || "Alipay query failed.");
    error.statusCode = 502;
    error.code = "ALIPAY_QUERY_FAILED";
    error.details = response;
    throw error;
  }

  const expectedTradeNo = String(order.providerTradeNo || order.id || "").trim();
  const actualTradeNo = String(response.out_trade_no || "").trim();
  if (actualTradeNo && expectedTradeNo && actualTradeNo !== expectedTradeNo) {
    const error = new Error("Alipay query out_trade_no does not match the local order.");
    error.statusCode = 409;
    error.code = "ALIPAY_ORDER_MISMATCH";
    error.details = response;
    throw error;
  }

  if (response.total_amount !== undefined && formatAlipayAmount(response.total_amount) !== formatAlipayAmount(order.amount)) {
    const error = new Error("Alipay query total_amount does not match the local order.");
    error.statusCode = 409;
    error.code = "ALIPAY_AMOUNT_MISMATCH";
    error.details = response;
    throw error;
  }

  if (response.seller_id !== undefined && String(response.seller_id || "").trim() !== config.sellerId) {
    const error = new Error("Alipay query seller_id does not match ALIPAY_SELLER_ID.");
    error.statusCode = 409;
    error.code = "ALIPAY_SELLER_MISMATCH";
    error.details = response;
    throw error;
  }

  const tradeStatus = String(response.trade_status || "").trim();
  const normalized = {
    provider: "alipay",
    providerTradeNo: response.out_trade_no || order.providerTradeNo || order.id,
    transactionId: response.trade_no || null,
    totalAmount: response.total_amount || null,
    sellerId: response.seller_id || null,
    notifyPayload: response,
  };

  if (tradeStatus === "TRADE_SUCCESS" || tradeStatus === "TRADE_FINISHED") {
    return {
      ...normalized,
      status: "paid",
      paidAt: response.send_pay_date || new Date().toISOString(),
      failureReason: null,
    };
  }

  if (tradeStatus === "TRADE_CLOSED") {
    return {
      ...normalized,
      status: "closed",
      failureReason: response.sub_msg || "Alipay trade was closed.",
    };
  }

  return {
    ...normalized,
    status:
      Date.parse(order.expiredAt || order.expiresAt || "") <= Date.now() ? "expired" : "pending",
    failureReason: null,
  };
}

function parseAlipayNotification(params) {
  const config = assertAlipayConfigured();
  if (!verifyAlipayParams(params, config.publicKeyPem)) {
    const error = new Error("Invalid Alipay callback signature.");
    error.statusCode = 400;
    error.code = "INVALID_SIGNATURE";
    throw error;
  }

  const tradeStatus = String(params.trade_status || "").trim();
  return {
    orderId: String(params.out_trade_no || "").trim(),
    providerTradeNo: String(params.out_trade_no || "").trim() || null,
    transactionId: String(params.trade_no || "").trim() || null,
    appId: String(params.app_id || "").trim() || null,
    sellerId: String(params.seller_id || "").trim() || null,
    totalAmount: String(params.total_amount || "").trim() || null,
    tradeStatus,
    status:
      tradeStatus === "TRADE_SUCCESS" || tradeStatus === "TRADE_FINISHED" ? "paid" : "pending",
    paidAt: String(params.gmt_payment || "").trim() || null,
    notifyPayload: params,
  };
}

function makeAlipayValidationError(code, message) {
  const error = new Error(message);
  error.statusCode = 409;
  error.code = code;
  return error;
}

function assertAlipayNotificationMatchesOrder(notification, order) {
  const config = assertAlipayConfigured();
  if (!notification || !order) {
    throw makeAlipayValidationError("ALIPAY_ORDER_MISSING", "Alipay notification or local order is missing.");
  }

  if (notification.appId !== config.appId) {
    throw makeAlipayValidationError("ALIPAY_APP_MISMATCH", "Alipay notification app_id does not match ALIPAY_APP_ID.");
  }

  if (notification.sellerId !== config.sellerId) {
    throw makeAlipayValidationError("ALIPAY_SELLER_MISMATCH", "Alipay notification seller_id does not match ALIPAY_SELLER_ID.");
  }

  const expectedTradeNo = String(order.providerTradeNo || order.id || "").trim();
  if (notification.providerTradeNo !== expectedTradeNo) {
    throw makeAlipayValidationError("ALIPAY_ORDER_MISMATCH", "Alipay notification out_trade_no does not match the local order.");
  }

  if (formatAlipayAmount(notification.totalAmount) !== formatAlipayAmount(order.amount)) {
    throw makeAlipayValidationError("ALIPAY_AMOUNT_MISMATCH", "Alipay notification total_amount does not match the local order.");
  }

  return true;
}

function getAlipayCapabilities() {
  const config = buildAlipayConfig();
  return {
    available: config.available,
    reason: config.reason,
    scenes: ["pc_page", "mobile_wap"],
  };
}

module.exports = {
  assertAlipayNotificationMatchesOrder,
  createAlipayPayment,
  getAlipayCapabilities,
  parseAlipayNotification,
  queryAlipayPayment,
  renderAlipayCheckoutPage,
  _internals: {
    buildAlipaySignContent,
    buildAlipayConfig,
    formatAlipayAmount,
    signAlipayParams,
    verifyAlipayParams,
  },
};
