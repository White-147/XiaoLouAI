const {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  createSign,
  createVerify,
  randomUUID,
} = require("node:crypto");
const {
  amountToFen,
  getClientIp,
  joinUrl,
  resolvePublicBaseUrl,
  resolveReturnBaseUrl,
  resolveSecretValue,
} = require("./shared");

const WECHAT_GATEWAY = "https://api.mch.weixin.qq.com";

function buildWechatConfig() {
  const appId = String(process.env.WECHAT_PAY_APP_ID || "").trim();
  const mchId = String(process.env.WECHAT_PAY_MCH_ID || "").trim();
  const privateKeyPem = resolveSecretValue(
    process.env.WECHAT_PAY_PRIVATE_KEY || process.env.WECHAT_PAY_PRIVATE_KEY_PATH,
  );
  const serialNo = String(process.env.WECHAT_PAY_CERT_SERIAL || "").trim();
  const apiV3Key = String(process.env.WECHAT_PAY_API_V3_KEY || "").trim();
  const platformCredential = resolveSecretValue(
    process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY ||
      process.env.WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH ||
      process.env.WECHAT_PAY_PLATFORM_CERT ||
      process.env.WECHAT_PAY_PLATFORM_CERT_PATH,
  );

  const missing = [];
  if (!appId) missing.push("WECHAT_PAY_APP_ID");
  if (!mchId) missing.push("WECHAT_PAY_MCH_ID");
  if (!privateKeyPem) missing.push("WECHAT_PAY_PRIVATE_KEY");
  if (!serialNo) missing.push("WECHAT_PAY_CERT_SERIAL");
  if (!apiV3Key) missing.push("WECHAT_PAY_API_V3_KEY");
  if (!platformCredential) missing.push("WECHAT_PAY_PLATFORM_PUBLIC_KEY");

  const available = missing.length === 0;

  return {
    available,
    reason: available ? null : `Missing ${missing.join(", ")}`,
    appId,
    mchId,
    serialNo,
    apiV3Key,
    privateKeyPem,
    platformCredential,
  };
}

function assertWechatConfigured() {
  const config = buildWechatConfig();
  if (!config.available) {
    const error = new Error(config.reason || "WeChat Pay is not configured.");
    error.statusCode = 503;
    error.code = "PAYMENT_PROVIDER_NOT_CONFIGURED";
    throw error;
  }
  return config;
}

function buildAuthorizationHeader(config, method, pathnameWithQuery, body) {
  const nonce = randomUUID().replace(/-/g, "");
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const message = `${method}\n${pathnameWithQuery}\n${timestamp}\n${nonce}\n${body}\n`;
  const signer = createSign("RSA-SHA256");
  signer.update(message);
  signer.end();
  const signature = signer.sign(createPrivateKey(config.privateKeyPem), "base64");

  return [
    'WECHATPAY2-SHA256-RSA2048',
    `mchid="${config.mchId}"`,
    `nonce_str="${nonce}"`,
    `signature="${signature}"`,
    `timestamp="${timestamp}"`,
    `serial_no="${config.serialNo}"`,
  ].join(",");
}

async function wechatRequest(config, method, pathnameWithQuery, payload = null) {
  const body = payload ? JSON.stringify(payload) : "";
  const response = await fetch(`${WECHAT_GATEWAY}${pathnameWithQuery}`, {
    method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: buildAuthorizationHeader(config, method, pathnameWithQuery, body),
      "User-Agent": "xiaolou-core-api/1.0",
    },
    body: body || undefined,
  });

  const rawText = await response.text();
  let parsed = null;
  if (rawText) {
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = { rawText };
    }
  }

  if (!response.ok) {
    const error = new Error(
      parsed?.message ||
        parsed?.detail ||
        `WeChat Pay request failed with status ${response.status}.`,
    );
    error.statusCode = response.status;
    error.code = "WECHAT_PAY_REQUEST_FAILED";
    error.details = parsed;
    throw error;
  }

  return parsed || {};
}

function buildWechatDescription(order) {
  return `${order.planName} ${order.credits} credits`;
}

async function createWechatPayment(order, req) {
  const config = assertWechatConfigured();
  const notifyUrl = joinUrl(resolvePublicBaseUrl(req), "/api/payments/wechat/notify");
  const redirectBaseUrl = resolveReturnBaseUrl(req);
  const amount = {
    total: amountToFen(order.amount),
    currency: order.currency || "CNY",
  };

  const commonPayload = {
    appid: config.appId,
    mchid: config.mchId,
    description: buildWechatDescription(order),
    out_trade_no: order.providerTradeNo || order.id,
    notify_url: notifyUrl,
    amount,
    attach: JSON.stringify({
      orderId: order.id,
      walletId: order.walletId,
      paymentMethod: order.paymentMethod,
    }),
    time_expire: new Date(order.expiredAt || order.expiresAt).toISOString(),
  };

  if (order.scene === "mobile_h5") {
    const response = await wechatRequest(config, "POST", "/v3/pay/transactions/h5", {
      ...commonPayload,
      scene_info: {
        payer_client_ip: getClientIp(req),
        h5_info: {
          type: "Wap",
        },
      },
    });
    return {
      provider: "wechat",
      providerTradeNo: commonPayload.out_trade_no,
      h5Url: response.h5_url || null,
      redirectUrl: `${redirectBaseUrl}/wallet/recharge?orderId=${encodeURIComponent(order.id)}`,
      qrCodeHint: "Open the WeChat H5 payment page in your browser to complete payment.",
      notifyPayload: null,
    };
  }

  const response = await wechatRequest(config, "POST", "/v3/pay/transactions/native", commonPayload);
  return {
    provider: "wechat",
    providerTradeNo: commonPayload.out_trade_no,
    codeUrl: response.code_url || null,
    qrCodePayload: response.code_url || null,
    qrCodeHint: "Use WeChat to scan the real payment QR code.",
    notifyPayload: null,
  };
}

async function queryWechatPayment(order) {
  const config = assertWechatConfigured();
  const outTradeNo = encodeURIComponent(order.providerTradeNo || order.id);
  const response = await wechatRequest(
    config,
    "GET",
    `/v3/pay/transactions/out-trade-no/${outTradeNo}?mchid=${encodeURIComponent(config.mchId)}`,
  );

  const tradeState = String(response.trade_state || "").trim();
  const normalized = {
    provider: "wechat",
    providerTradeNo: response.out_trade_no || order.providerTradeNo || order.id,
    notifyPayload: response,
  };

  if (tradeState === "SUCCESS") {
    return {
      ...normalized,
      status: "paid",
      paidAt: response.success_time || new Date().toISOString(),
      failureReason: null,
    };
  }

  if (tradeState === "CLOSED" || tradeState === "REVOKED") {
    return {
      ...normalized,
      status: "closed",
      failureReason: response.trade_state_desc || "WeChat Pay order was closed.",
    };
  }

  if (tradeState === "PAYERROR") {
    return {
      ...normalized,
      status: "failed",
      failureReason: response.trade_state_desc || "WeChat Pay reported a payment error.",
    };
  }

  return {
    ...normalized,
    status:
      Date.parse(order.expiredAt || order.expiresAt || "") <= Date.now() ? "expired" : "pending",
    failureReason: null,
  };
}

function verifyWechatSignature(config, rawBody, headers) {
  const timestamp = String(headers["wechatpay-timestamp"] || "").trim();
  const nonce = String(headers["wechatpay-nonce"] || "").trim();
  const signature = String(headers["wechatpay-signature"] || "").trim();
  if (!timestamp || !nonce || !signature) {
    const error = new Error("Missing WeChat Pay signature headers.");
    error.statusCode = 400;
    error.code = "BAD_REQUEST";
    throw error;
  }

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${timestamp}\n${nonce}\n${rawBody}\n`);
  verifier.end();
  const publicKey = createPublicKey(config.platformCredential);
  const ok = verifier.verify(publicKey, signature, "base64");
  if (!ok) {
    const error = new Error("Invalid WeChat Pay callback signature.");
    error.statusCode = 400;
    error.code = "INVALID_SIGNATURE";
    throw error;
  }
}

function decryptWechatResource(resource, apiV3Key) {
  const key = Buffer.from(apiV3Key, "utf8");
  const ciphertext = Buffer.from(String(resource.ciphertext || ""), "base64");
  const nonce = Buffer.from(String(resource.nonce || ""), "utf8");
  const associatedData = Buffer.from(String(resource.associated_data || ""), "utf8");

  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  if (associatedData.length > 0) {
    decipher.setAAD(associatedData);
  }

  const plaintext = Buffer.concat([
    decipher.update(ciphertext.subarray(0, ciphertext.length - 16)),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString("utf8"));
}

function parseWechatNotification(rawBody, headers) {
  const config = assertWechatConfigured();
  verifyWechatSignature(config, rawBody, headers);
  const payload = JSON.parse(rawBody || "{}");
  const resource = payload?.resource;
  if (!resource) {
    const error = new Error("WeChat callback payload is missing resource.");
    error.statusCode = 400;
    error.code = "BAD_REQUEST";
    throw error;
  }

  const decrypted = decryptWechatResource(resource, config.apiV3Key);
  return {
    orderId: String(decrypted.out_trade_no || "").trim(),
    providerTradeNo: String(decrypted.out_trade_no || "").trim() || null,
    transactionId: String(decrypted.transaction_id || "").trim() || null,
    status: String(decrypted.trade_state || "").trim() === "SUCCESS" ? "paid" : "pending",
    paidAt: decrypted.success_time || null,
    notifyPayload: decrypted,
  };
}

function getWechatCapabilities() {
  const config = buildWechatConfig();
  return {
    available: config.available,
    reason: config.reason,
    scenes: ["desktop_qr", "mobile_h5"],
  };
}

module.exports = {
  createWechatPayment,
  getWechatCapabilities,
  parseWechatNotification,
  queryWechatPayment,
};
