#!/usr/bin/env node

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) {
      if (!args._) args._ = [];
      args._.push(item);
      continue;
    }

    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }

  return args;
}

function fail(message) {
  throw new Error(message);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function readSecret({ inline, file, envName, envPathName }) {
  if (inline && String(inline).trim()) return String(inline);
  if (file && String(file).trim()) return readText(file);
  if (envName && process.env[envName]) return process.env[envName];
  if (envPathName && process.env[envPathName]) return readText(process.env[envPathName]);
  return "";
}

function getProperty(record, name) {
  if (!record || typeof record !== "object") return undefined;
  return record[name];
}

function getHeader(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (String(key).toLowerCase() === wanted) {
      return value == null ? "" : String(value);
    }
  }
  return "";
}

function parseFormEncoded(rawBody) {
  const params = {};
  const search = new URLSearchParams(String(rawBody || ""));
  for (const [key, value] of search.entries()) {
    params[key] = value;
  }
  return params;
}

function getAlipayParams(record) {
  if (record.params && typeof record.params === "object") {
    return { ...record.params };
  }

  const rawBody = getProperty(record, "rawBody");
  if (rawBody != null && String(rawBody).trim()) {
    const text = String(rawBody);
    if (text.trimStart().startsWith("{")) {
      return JSON.parse(text);
    }
    return parseFormEncoded(text);
  }

  if (record.body && typeof record.body === "object") {
    return { ...record.body };
  }

  fail("Alipay native record is missing params, rawBody, or body.");
}

function serializeAlipayValue(value) {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function buildAlipaySignContent(params) {
  return Object.keys(params)
    .filter((key) => key !== "sign" && key !== "sign_type" && params[key] !== undefined && params[key] !== null && params[key] !== "")
    .sort()
    .map((key) => `${key}=${serializeAlipayValue(params[key])}`)
    .join("&");
}

function verifyAlipayParams(params, publicKeyPem) {
  const signature = String(params.sign || "").trim();
  if (!signature) fail("Alipay callback is missing sign.");

  const signType = String(params.sign_type || "RSA2").trim().toUpperCase();
  const algorithm = signType === "RSA" ? "RSA-SHA1" : "RSA-SHA256";
  const verifier = crypto.createVerify(algorithm);
  verifier.update(buildAlipaySignContent(params), "utf8");
  verifier.end();
  return verifier.verify(publicKeyPem, signature, "base64");
}

function signAlipayParams(params, privateKeyPem) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(buildAlipaySignContent(params), "utf8");
  signer.end();
  return signer.sign(privateKeyPem, "base64");
}

function verifyWechatNotification(record, publicKeyPem) {
  const rawBody = getRawBody(record);
  const headers = record.headers || {};
  const timestamp = getHeader(headers, "Wechatpay-Timestamp");
  const nonce = getHeader(headers, "Wechatpay-Nonce");
  const signature = getHeader(headers, "Wechatpay-Signature");
  const serial = getHeader(headers, "Wechatpay-Serial");
  if (!timestamp || !nonce || !signature || !serial) {
    fail("WeChat Pay callback is missing timestamp, nonce, signature, or serial header.");
  }

  const message = `${timestamp}\n${nonce}\n${rawBody}\n`;
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(message, "utf8");
  verifier.end();
  const ok = verifier.verify(crypto.createPublicKey(publicKeyPem), signature, "base64");
  return { ok, rawBody, headers: { timestamp, nonce, signature, serial } };
}

function decryptWechatResource(resource, apiV3Key) {
  if (!resource || typeof resource !== "object") fail("WeChat Pay callback payload is missing resource.");
  const algorithm = String(resource.algorithm || "").trim();
  if (algorithm && algorithm !== "AEAD_AES_256_GCM") {
    fail(`Unsupported WeChat Pay resource algorithm: ${algorithm}`);
  }

  const key = Buffer.from(String(apiV3Key || ""), "utf8");
  if (key.length !== 32) {
    fail("WECHAT_PAY_API_V3_KEY must be exactly 32 UTF-8 bytes.");
  }

  const ciphertext = Buffer.from(String(resource.ciphertext || ""), "base64");
  if (ciphertext.length <= 16) {
    fail("WeChat Pay resource ciphertext is too short.");
  }

  const encrypted = ciphertext.subarray(0, ciphertext.length - 16);
  const authTag = ciphertext.subarray(ciphertext.length - 16);
  const nonce = Buffer.from(String(resource.nonce || ""), "utf8");
  const associatedData = Buffer.from(String(resource.associated_data || ""), "utf8");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(authTag);
  if (associatedData.length > 0) {
    decipher.setAAD(associatedData);
  }

  const plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8"));
}

function encryptWechatResource(plaintext, apiV3Key, nonce, associatedData) {
  const key = Buffer.from(apiV3Key, "utf8");
  const cipher = crypto.createCipheriv("aes-256-gcm", key, Buffer.from(nonce, "utf8"));
  if (associatedData) {
    cipher.setAAD(Buffer.from(associatedData, "utf8"));
  }
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(plaintext), "utf8")),
    cipher.final(),
  ]);
  return Buffer.concat([encrypted, cipher.getAuthTag()]).toString("base64");
}

function getRawBody(record) {
  if (record.rawBody != null) return String(record.rawBody);
  if (record.body != null) return JSON.stringify(record.body);
  fail("Native provider record is missing rawBody or body.");
}

function inferNativeFormat(record) {
  const explicit = String(record.format || record.inputFormat || record.providerFormat || "").trim();
  if (explicit) return explicit;

  const provider = String(record.provider || "").toLowerCase();
  if (provider.includes("alipay")) return "alipay-rsa2-form";
  if (provider.includes("wechat") || provider.includes("wxpay")) return "wechat-v3-notification";
  fail("Unable to infer native provider format.");
}

function adaptAlipay(record, options) {
  const publicKeyPem = readSecret({
    inline: options["alipay-public-key"],
    file: options["alipay-public-key-file"],
    envName: "ALIPAY_PUBLIC_KEY",
    envPathName: "ALIPAY_PUBLIC_KEY_PATH",
  });
  if (!publicKeyPem) fail("Missing Alipay public key. Pass --alipay-public-key-file or set ALIPAY_PUBLIC_KEY_PATH.");

  const params = getAlipayParams(record);
  const ok = verifyAlipayParams(params, publicKeyPem);
  if (!ok) fail("Invalid Alipay callback signature.");

  return {
    description: record.description || "verified native Alipay callback",
    provider: record.provider || "alipay",
    format: "alipay-form",
    params,
    providerVerification: {
      provider: "alipay",
      signatureValid: true,
      signType: params.sign_type || "RSA2",
      signContentSha256: crypto.createHash("sha256").update(buildAlipaySignContent(params), "utf8").digest("hex"),
    },
  };
}

function adaptWechat(record, options) {
  const publicKeyPem = readSecret({
    inline: options["wechat-platform-public-key"],
    file: options["wechat-platform-public-key-file"],
    envName: "WECHAT_PAY_PLATFORM_PUBLIC_KEY",
    envPathName: "WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH",
  }) || readSecret({
    file: options["wechat-platform-cert-file"],
    envName: "WECHAT_PAY_PLATFORM_CERT",
    envPathName: "WECHAT_PAY_PLATFORM_CERT_PATH",
  });
  if (!publicKeyPem) fail("Missing WeChat Pay platform public key. Pass --wechat-platform-public-key-file or set WECHAT_PAY_PLATFORM_PUBLIC_KEY_PATH.");

  const apiV3Key = String(options["wechat-api-v3-key"] || process.env.WECHAT_PAY_API_V3_KEY || "");
  if (!apiV3Key) fail("Missing WeChat Pay API v3 key. Pass --wechat-api-v3-key or set WECHAT_PAY_API_V3_KEY.");

  const verification = verifyWechatNotification(record, publicKeyPem);
  if (!verification.ok) fail("Invalid WeChat Pay callback signature.");

  const payload = JSON.parse(verification.rawBody || "{}");
  const decrypted = decryptWechatResource(payload.resource, apiV3Key);
  return {
    description: record.description || "verified native WeChat Pay callback",
    provider: record.provider || "wechatpay",
    format: "wechat-v3-plaintext",
    body: {
      ...payload,
      resource_plaintext: decrypted,
    },
    headers: record.headers || {},
    providerVerification: {
      provider: "wechatpay",
      signatureValid: true,
      serial: verification.headers.serial,
      decrypted: true,
      rawBodySha256: crypto.createHash("sha256").update(verification.rawBody, "utf8").digest("hex"),
    },
  };
}

function adaptRecord(record, options) {
  const format = inferNativeFormat(record);
  if (format === "alipay-rsa2-form" || format === "alipay-form-native") {
    return adaptAlipay(record, options);
  }
  if (format === "wechat-v3-notification" || format === "wechatpay-v3-notification") {
    return adaptWechat(record, options);
  }
  if (format === "alipay-form" || format === "wechat-v3-plaintext" || format === "canonical") {
    return record;
  }
  fail(`Unsupported native provider format: ${format}`);
}

function readJsonl(filePath) {
  const lines = readText(filePath).split(/\r?\n/);
  const records = [];
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    records.push({ line: index + 1, record: JSON.parse(trimmed) });
  });
  return records;
}

function writeJsonl(filePath, records) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, records.map((record) => JSON.stringify(record)).join("\n") + (records.length ? "\n" : ""), "utf8");
}

function writeJson(filePath, value) {
  ensureDir(filePath);
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function adaptCommand(options) {
  const inputFile = options.input;
  const outputFile = options.output;
  const reportFile = options.report;
  if (!inputFile || !outputFile || !reportFile) {
    fail("adapt requires --input, --output, and --report.");
  }

  const outputs = [];
  const items = [];
  for (const entry of readJsonl(inputFile)) {
    const item = {
      line: entry.line,
      provider: entry.record.provider || null,
      input_format: entry.record.format || null,
      status: "ok",
      output_format: null,
      error: null,
    };
    try {
      const adapted = adaptRecord(entry.record, options);
      outputs.push(adapted);
      item.output_format = adapted.format || null;
      item.provider = adapted.provider || item.provider;
    } catch (error) {
      item.status = "failed";
      item.error = error.message;
    }
    items.push(item);
  }

  writeJsonl(outputFile, outputs);
  const failed = items.filter((item) => item.status === "failed");
  const report = {
    generated_at_utc: new Date().toISOString(),
    status: failed.length > 0 ? "failed" : "ok",
    input_file: path.resolve(inputFile),
    output_file: path.resolve(outputFile),
    total: items.length,
    adapted: outputs.length,
    failed: failed.length,
    items,
  };
  writeJson(reportFile, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (failed.length > 0) {
    process.exitCode = 2;
  }
}

function signWechatRawBody(rawBody, privateKeyPem, timestamp, nonce) {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${timestamp}\n${nonce}\n${rawBody}\n`, "utf8");
  signer.end();
  return signer.sign(privateKeyPem, "base64");
}

function makeSyntheticCommand(options) {
  const outputFile = options.output;
  const invalidOutputFile = options["invalid-output"];
  const keysDir = options["keys-dir"];
  const reportFile = options.report;
  if (!outputFile || !invalidOutputFile || !keysDir || !reportFile) {
    fail("make-synthetic requires --output, --invalid-output, --keys-dir, and --report.");
  }

  fs.mkdirSync(keysDir, { recursive: true });
  const alipayKeys = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const wechatKeys = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const alipayPublicKeyFile = path.join(keysDir, "synthetic-alipay-public.pem");
  const alipayPrivateKeyFile = path.join(keysDir, "synthetic-alipay-private.pem");
  const wechatPublicKeyFile = path.join(keysDir, "synthetic-wechat-platform-public.pem");
  const wechatPrivateKeyFile = path.join(keysDir, "synthetic-wechat-platform-private.pem");
  fs.writeFileSync(alipayPublicKeyFile, alipayKeys.publicKey, "utf8");
  fs.writeFileSync(alipayPrivateKeyFile, alipayKeys.privateKey, "utf8");
  fs.writeFileSync(wechatPublicKeyFile, wechatKeys.publicKey, "utf8");
  fs.writeFileSync(wechatPrivateKeyFile, wechatKeys.privateKey, "utf8");

  const alipayParams = {
    notify_id: "synthetic-native-alipay-notify-001",
    out_trade_no: "synthetic-native-alipay-order-001",
    trade_no: "2026050222000000001001",
    total_amount: "23.45",
    trade_status: "TRADE_SUCCESS",
    gmt_payment: "2026-05-02 15:20:21",
    app_id: "synthetic-native-alipay-app",
    seller_id: "synthetic-native-alipay-seller",
    sign_type: "RSA2",
  };
  alipayParams.sign = signAlipayParams(alipayParams, alipayKeys.privateKey);
  const alipayRawBody = new URLSearchParams(alipayParams).toString();

  const alipayPendingParams = {
    notify_id: "synthetic-native-alipay-notify-pending",
    out_trade_no: "synthetic-native-alipay-order-pending",
    trade_no: "2026050222000000001002",
    total_amount: "8.88",
    trade_status: "WAIT_BUYER_PAY",
    gmt_payment: "2026-05-02 15:21:22",
    app_id: "synthetic-native-alipay-app",
    seller_id: "synthetic-native-alipay-seller",
    sign_type: "RSA2",
  };
  alipayPendingParams.sign = signAlipayParams(alipayPendingParams, alipayKeys.privateKey);
  const alipayPendingRawBody = new URLSearchParams(alipayPendingParams).toString();

  const apiV3Key = "0123456789abcdef0123456789abcdef";
  const wechatPlaintext = {
    appid: "wxsyntheticnativeappid",
    mchid: "1900000000",
    out_trade_no: "synthetic-native-wechat-order-001",
    transaction_id: "4200000000202605020000001001",
    trade_type: "JSAPI",
    trade_state: "SUCCESS",
    trade_state_desc: "payment success",
    success_time: "2026-05-02T15:22:23+08:00",
    amount: {
      total: 2345,
      payer_total: 2345,
      currency: "CNY",
      payer_currency: "CNY",
    },
  };
  const resourceNonce = "syntheticnonce16";
  const associatedData = "transaction";
  const wechatBody = {
    id: "synthetic-native-wechat-notify-001",
    create_time: "2026-05-02T15:22:24+08:00",
    event_type: "TRANSACTION.SUCCESS",
    resource_type: "encrypt-resource",
    summary: "payment success",
    resource: {
      original_type: "transaction",
      algorithm: "AEAD_AES_256_GCM",
      ciphertext: encryptWechatResource(wechatPlaintext, apiV3Key, resourceNonce, associatedData),
      associated_data: associatedData,
      nonce: resourceNonce,
    },
  };
  const wechatRawBody = JSON.stringify(wechatBody);
  const wechatTimestamp = "1777706544";
  const wechatNonce = "syntheticwechatnonce";
  const wechatSignature = signWechatRawBody(wechatRawBody, wechatKeys.privateKey, wechatTimestamp, wechatNonce);

  const validRecords = [
    {
      description: "synthetic native Alipay RSA2 success callback",
      provider: "alipay",
      format: "alipay-rsa2-form",
      rawBody: alipayRawBody,
    },
    {
      description: "synthetic native Alipay RSA2 pending callback",
      provider: "alipay",
      format: "alipay-rsa2-form",
      rawBody: alipayPendingRawBody,
    },
    {
      description: "synthetic native WeChat Pay v3 encrypted success callback",
      provider: "wechatpay",
      format: "wechat-v3-notification",
      rawBody: wechatRawBody,
      headers: {
        "Wechatpay-Timestamp": wechatTimestamp,
        "Wechatpay-Nonce": wechatNonce,
        "Wechatpay-Serial": "SYNTHETICPLATFORMSERIAL",
        "Wechatpay-Signature": wechatSignature,
      },
    },
  ];
  writeJsonl(outputFile, validRecords);

  const invalidRecords = [
    {
      description: "synthetic native Alipay RSA2 invalid signature callback",
      provider: "alipay",
      format: "alipay-rsa2-form",
      rawBody: alipayRawBody.replace("23.45", "23.46"),
    },
    {
      description: "synthetic native WeChat Pay v3 invalid signature callback",
      provider: "wechatpay",
      format: "wechat-v3-notification",
      rawBody: wechatRawBody,
      headers: {
        "Wechatpay-Timestamp": wechatTimestamp,
        "Wechatpay-Nonce": wechatNonce,
        "Wechatpay-Serial": "SYNTHETICPLATFORMSERIAL",
        "Wechatpay-Signature": `${wechatSignature.slice(0, -4)}ABCD`,
      },
    },
  ];
  writeJsonl(invalidOutputFile, invalidRecords);

  const report = {
    generated_at_utc: new Date().toISOString(),
    status: "ok",
    valid_input_file: path.resolve(outputFile),
    invalid_input_file: path.resolve(invalidOutputFile),
    alipay_public_key_file: path.resolve(alipayPublicKeyFile),
    alipay_private_key_file: path.resolve(alipayPrivateKeyFile),
    wechat_platform_public_key_file: path.resolve(wechatPublicKeyFile),
    wechat_platform_private_key_file: path.resolve(wechatPrivateKeyFile),
    wechat_api_v3_key: apiV3Key,
    valid_records: validRecords.length,
    invalid_records: invalidRecords.length,
  };
  writeJson(reportFile, report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function main() {
  const [command, ...rest] = process.argv.slice(2);
  const options = parseArgs(rest);
  if (command === "adapt") {
    adaptCommand(options);
    return;
  }
  if (command === "make-synthetic") {
    makeSyntheticCommand(options);
    return;
  }
  fail("Usage: payment-provider-native-adapter.js <adapt|make-synthetic> [options]");
}

try {
  main();
} catch (error) {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
}
