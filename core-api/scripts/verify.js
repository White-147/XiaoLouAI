const http = require("node:http");
const { generateKeyPairSync } = require("node:crypto");
const { rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const sharp = require("sharp");

function request(baseUrl, path, init = {}) {
  const url = new URL(path, baseUrl);

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method: init.method || "GET",
        headers: init.headers || {},
        agent: false,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let body = null;
          if (text) {
            try {
              body = JSON.parse(text);
            } catch {
              body = text;
            }
          }
          resolve({
            status: res.statusCode || 0,
            body,
            text,
          });
        });
      }
    );

    req.on("error", reject);

    if (init.body) {
      req.write(init.body);
    }

    req.end();
  });
}

async function bootServer() {
  const { createServer } = require("../src/server");
  const server = createServer();

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function main() {
  const verifyDbPath = join(tmpdir(), `core-api-verify-${Date.now()}.sqlite`);
  const verifyUploadDir = join(tmpdir(), `core-api-uploads-${Date.now()}`);
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const alipayPrivateKey = privateKey.export({ type: "pkcs8", format: "pem" });
  const alipayPublicKey = publicKey.export({ type: "spki", format: "pem" });
  process.env.CORE_API_DB_PATH = verifyDbPath;
  process.env.CORE_API_UPLOAD_DIR = verifyUploadDir;
  process.env.ALIPAY_ENV = "sandbox";
  process.env.ALIPAY_APP_ID = "verify-alipay-app";
  process.env.ALIPAY_PRIVATE_KEY = alipayPrivateKey;
  process.env.ALIPAY_PUBLIC_KEY = alipayPublicKey;
  process.env.ALIPAY_SELLER_ID = "2088000000000000";
  process.env.RECHARGE_CREDITS_PER_RMB = "2";
  process.env.SUPER_ADMIN_EMAIL = "verify-admin@xiaolou.test";
  process.env.SUPER_ADMIN_PASSWORD = "VerifyAdminPassword-2026!";
  process.env.SUPER_ADMIN_DISPLAY_NAME = "Verify Super Admin";
  const verifyPng = await sharp({
    create: {
      width: 1,
      height: 1,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  })
    .png()
    .toBuffer();

  const boot = await bootServer();

  const health = await request(boot.baseUrl, "/healthz");
  const projects = await request(boot.baseUrl, "/api/projects");
  const overview = await request(boot.baseUrl, "/api/projects/proj_demo_001/overview");
  const projectTasks = await request(boot.baseUrl, "/api/projects/proj_demo_001/tasks");
  const toolbox = await request(boot.baseUrl, "/api/toolbox/capabilities");
  const createImages = await request(boot.baseUrl, "/api/create/images");
  const createVideos = await request(boot.baseUrl, "/api/create/videos");
  // Note: /api/admin/api-config was removed from the routing layer.
  // We still verify the endpoint gives a non-500 response (404 is acceptable)
  // rather than asserting specific payload shape that no longer applies.
  const apiConfig = await request(boot.baseUrl, "/api/admin/api-config");
  const storyboardGeneration = await request(
    boot.baseUrl,
    "/api/projects/proj_demo_001/storyboards/auto-generate",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }
  );
  const uploaded = await request(boot.baseUrl, "/api/uploads?kind=test", {
    method: "POST",
    headers: {
      "Content-Type": "image/png",
      "X-Upload-Filename": encodeURIComponent("verify-image.png"),
    },
    body: verifyPng,
  });
  const createdProject = await request(boot.baseUrl, "/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Persistence Verify Project",
      summary: "Created during verification.",
    }),
  });
  const publicMockCapabilities = await request(boot.baseUrl, "/api/wallet/recharge-capabilities", {
    headers: { Origin: "https://public-demo.example" },
  });
  const adminLogin = await request(boot.baseUrl, "/api/auth/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://public-demo.example" },
    body: JSON.stringify({
      email: process.env.SUPER_ADMIN_EMAIL,
      password: process.env.SUPER_ADMIN_PASSWORD,
    }),
  });
  const alipayOrder = await request(boot.baseUrl, "/api/wallet/recharge-orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Actor-Id": "user_personal_001",
    },
    body: JSON.stringify({
      planId: "verify-alipay",
      planName: "Verify Alipay",
      billingCycle: "oneTime",
      paymentMethod: "alipay",
      mode: "live",
      scene: "pc_page",
      amount: 1,
      credits: 9999,
    }),
  });

  if (health.status !== 200) throw new Error("healthz failed");
  if (health.body?.data?.mode !== "sqlite") throw new Error("health mode failed");
  if (projects.status !== 200) throw new Error("projects failed");
  if (overview.status !== 200) throw new Error("project overview failed");
  if (!overview.body?.data?.project?.id) throw new Error("project overview payload failed");
  if (projectTasks.status !== 200) throw new Error("project tasks failed");
  if (!Array.isArray(projectTasks.body?.data?.items)) throw new Error("project tasks payload failed");
  if (toolbox.status !== 200) throw new Error("toolbox failed");
  if (createImages.status !== 200) throw new Error("create images failed");
  if (!Array.isArray(createImages.body?.data?.items)) throw new Error("create images payload failed");
  if (createVideos.status !== 200) throw new Error("create videos failed");
  if (!Array.isArray(createVideos.body?.data?.items)) throw new Error("create videos payload failed");
  // /api/admin/api-config was removed; 404 is the expected response now.
  if (apiConfig.status !== 404 && apiConfig.status !== 200) {
    throw new Error(`api config endpoint returned unexpected status ${apiConfig.status}`);
  }
  if (storyboardGeneration.status !== 202) throw new Error("storyboard auto generate failed");
  if (uploaded.status !== 201) throw new Error("upload failed");
  if (!uploaded.body?.data?.url?.includes("/uploads/")) throw new Error("upload payload failed");
  if (uploaded.body?.data?.contentType !== "image/jpeg") throw new Error("upload conversion failed");
  if (!String(uploaded.body?.data?.storedName || "").endsWith(".jpg")) {
    throw new Error("upload stored extension failed");
  }
  if (createdProject.status !== 201) throw new Error("project creation failed");
  if (adminLogin.status !== 200) throw new Error(`admin login failed: ${adminLogin.text}`);
  if (adminLogin.body?.data?.permissionContext?.platformRole !== "super_admin") {
    throw new Error("admin login did not return super_admin permission context");
  }
  const publicAdminMe = await request(boot.baseUrl, "/api/me", {
    headers: {
      Authorization: `Bearer ${adminLogin.body.data.token}`,
      Origin: "https://public-demo.example",
    },
  });
  if (publicAdminMe.status !== 200 || publicAdminMe.body?.data?.platformRole !== "super_admin") {
    throw new Error("public super-admin token should be accepted outside loopback");
  }
  if (publicMockCapabilities.status !== 200) throw new Error("recharge capabilities failed");
  if (!publicMockCapabilities.body?.data?.demoMockEnabled) {
    throw new Error("demo mock should be visible for public hosts by default");
  }
  if (!publicMockCapabilities.body?.data?.demoMockAllowedHosts?.includes("*")) {
    throw new Error("demo mock allowed hosts should include wildcard by default");
  }
  const publicWechatMock = publicMockCapabilities.body?.data?.methods?.find(
    (method) => method.paymentMethod === "wechat_pay"
  );
  if (!publicWechatMock?.demoMock?.available) {
    throw new Error("wechat demo mock should be available for public hosts");
  }
  const publicAlipayMock = publicMockCapabilities.body?.data?.methods?.find(
    (method) => method.paymentMethod === "alipay"
  );
  if (!publicAlipayMock?.demoMock?.available) {
    throw new Error("alipay demo mock should be available for public hosts");
  }
  const alipayMockOrder = await request(boot.baseUrl, "/api/wallet/recharge-orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Actor-Id": "user_personal_001",
      Origin: "https://public-demo.example",
    },
    body: JSON.stringify({
      planId: "verify-alipay-mock",
      planName: "Verify Alipay Mock",
      billingCycle: "oneTime",
      paymentMethod: "alipay",
      mode: "demo_mock",
      scene: "desktop_qr",
      amount: 1,
      credits: 9999,
    }),
  });
  if (alipayMockOrder.status !== 201) {
    throw new Error(`alipay demo mock order creation failed: ${alipayMockOrder.text}`);
  }
  if (alipayMockOrder.body?.data?.paymentMethod !== "alipay" || alipayMockOrder.body?.data?.mode !== "demo_mock") {
    throw new Error("alipay demo mock order payload failed");
  }
  if (alipayMockOrder.body?.data?.credits !== 2) {
    throw new Error("alipay demo mock order did not recalculate credits from RMB amount");
  }
  if (!String(alipayMockOrder.body?.data?.qrCodePayload || "").startsWith("alipay://")) {
    throw new Error("alipay demo mock order should expose an alipay mock QR payload");
  }
  const alipayMockPaid = await request(
    boot.baseUrl,
    `/api/wallet/recharge-orders/${encodeURIComponent(alipayMockOrder.body.data.id)}/confirm`,
    {
      method: "POST",
      headers: { "X-Actor-Id": "user_personal_001" },
    },
  );
  if (alipayMockPaid.status !== 200 || alipayMockPaid.body?.data?.status !== "paid") {
    throw new Error(`alipay demo mock confirm failed: ${alipayMockPaid.text}`);
  }
  if (alipayOrder.status !== 201) throw new Error(`alipay order creation failed: ${alipayOrder.text}`);
  if (alipayOrder.body?.data?.credits !== 2) {
    throw new Error("alipay order did not recalculate credits from RMB amount");
  }
  if (!String(alipayOrder.body?.data?.redirectUrl || "").includes("/api/payments/alipay/checkout/")) {
    throw new Error("alipay order did not return checkout redirect");
  }

  const alipay = require("../src/payments/alipay");
  const signContent = alipay._internals.buildAlipaySignContent({
    b: "2",
    sign: "ignored",
    a: "1",
    sign_type: "RSA2",
  });
  if (signContent !== "a=1&b=2") {
    throw new Error("alipay sign content should exclude sign and sign_type");
  }

  const orderData = alipayOrder.body.data;
  const paidNotifyParams = {
    app_id: process.env.ALIPAY_APP_ID,
    seller_id: process.env.ALIPAY_SELLER_ID,
    out_trade_no: orderData.providerTradeNo || orderData.id,
    trade_no: "2026042522000000000000000001",
    total_amount: Number(orderData.amount).toFixed(2),
    trade_status: "TRADE_SUCCESS",
    gmt_payment: "2026-04-25 12:00:00",
  };
  paidNotifyParams.sign_type = "RSA2";
  paidNotifyParams.sign = alipay._internals.signAlipayParams(paidNotifyParams, alipayPrivateKey);

  const parsedNotify = alipay.parseAlipayNotification(paidNotifyParams);
  alipay.assertAlipayNotificationMatchesOrder(parsedNotify, orderData);
  for (const [label, mutatedNotify] of [
    ["amount", { ...parsedNotify, totalAmount: "2.00" }],
    ["app_id", { ...parsedNotify, appId: "wrong-app" }],
    ["seller_id", { ...parsedNotify, sellerId: "wrong-seller" }],
  ]) {
    let rejected = false;
    try {
      alipay.assertAlipayNotificationMatchesOrder(mutatedNotify, orderData);
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(`alipay notification ${label} mismatch was not rejected`);
    }
  }

  const notifyBody = new URLSearchParams(paidNotifyParams).toString();
  const notifyResponse = await request(boot.baseUrl, "/api/payments/alipay/notify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: notifyBody,
  });
  const repeatedNotifyResponse = await request(boot.baseUrl, "/api/payments/alipay/notify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: notifyBody,
  });
  if (notifyResponse.status !== 200 || notifyResponse.body !== "success") {
    throw new Error(`alipay notify failed: ${notifyResponse.text}`);
  }
  if (repeatedNotifyResponse.status !== 200 || repeatedNotifyResponse.body !== "success") {
    throw new Error(`repeated alipay notify failed: ${repeatedNotifyResponse.text}`);
  }
  const alipayLedger = await request(
    boot.baseUrl,
    `/api/wallets/${encodeURIComponent(orderData.walletId)}/ledger`,
    {
      headers: { "X-Actor-Id": "user_personal_001" },
    },
  );
  if (alipayLedger.status !== 200) throw new Error("alipay ledger lookup failed");
  const rechargeEntries = (alipayLedger.body?.data?.items || []).filter(
    (entry) => entry.orderId === orderData.id && entry.entryType === "recharge",
  );
  if (rechargeEntries.length !== 1 || rechargeEntries[0].amount !== 2) {
    throw new Error("alipay notify should create exactly one recharge ledger entry");
  }

  const personalUsage = await request(boot.baseUrl, "/api/wallet/usage-stats?mode=personal", {
    headers: { "X-Actor-Id": "user_personal_001" },
  });
  if (personalUsage.status !== 200) throw new Error(`personal usage stats failed: ${personalUsage.text}`);
  if (!Array.isArray(personalUsage.body?.data?.series) || personalUsage.body.data.series.length !== 30) {
    throw new Error("personal usage stats should return 30 daily buckets");
  }
  if (personalUsage.body?.data?.subject?.type !== "user") {
    throw new Error("personal usage stats should be scoped to a user subject");
  }

  const organizationUsage = await request(boot.baseUrl, "/api/wallet/usage-stats?mode=organization", {
    headers: { "X-Actor-Id": "user_demo_001" },
  });
  if (organizationUsage.status !== 200) {
    throw new Error(`enterprise admin usage stats failed: ${organizationUsage.text}`);
  }
  if (organizationUsage.body?.data?.subject?.type !== "organization") {
    throw new Error("enterprise admin usage stats should be scoped to organization subject");
  }

  const memberOrganizationUsage = await request(boot.baseUrl, "/api/wallet/usage-stats?mode=organization", {
    headers: { "X-Actor-Id": "user_member_001" },
  });
  if (memberOrganizationUsage.status !== 403) {
    throw new Error("enterprise member should not access organization usage stats");
  }

  const usageSubjects = await request(boot.baseUrl, "/api/admin/credit-usage-subjects?search=demo", {
    headers: { "X-Actor-Id": "ops_demo_001" },
  });
  if (usageSubjects.status !== 200) throw new Error(`admin usage subject search failed: ${usageSubjects.text}`);
  if (!Array.isArray(usageSubjects.body?.data?.items) || !usageSubjects.body.data.items.length) {
    throw new Error("admin usage subject search should return subjects");
  }

  const platformUsage = await request(
    boot.baseUrl,
    "/api/admin/credit-usage-stats?subjectType=platform",
    {
      headers: { "X-Actor-Id": "ops_demo_001" },
    },
  );
  if (platformUsage.status !== 200) throw new Error(`admin platform usage stats failed: ${platformUsage.text}`);
  if (platformUsage.body?.data?.subject?.type !== "platform") {
    throw new Error("admin platform usage stats should be scoped to platform subject");
  }

  await new Promise((resolve) => setTimeout(resolve, 2600));
  const generatedStoryboards = await request(boot.baseUrl, "/api/projects/proj_demo_001/storyboards");
  if (generatedStoryboards.status !== 200) throw new Error("storyboard list failed");
  if (!Array.isArray(generatedStoryboards.body?.data?.items) || !generatedStoryboards.body.data.items.length) {
    throw new Error("storyboard auto generation produced no shots");
  }
  if (
    generatedStoryboards.body.data.items.some(
      (item) =>
        item.script === "A new storyboard shot generated from the current script."
    )
  ) {
    throw new Error("storyboard auto generation is still using placeholder copy");
  }

  const createdProjectId = createdProject.body?.data?.id;
  if (!createdProjectId) throw new Error("created project payload failed");

  await closeServer(boot.server);

  delete require.cache[require.resolve("../src/sqlite-store")];
  const { SqliteStore } = require("../src/sqlite-store");
  const store = new SqliteStore({ dbPath: verifyDbPath });
  const reloadedProject = store.getProject(createdProjectId);
  if (!reloadedProject?.id) throw new Error("sqlite persistence failed");
  store.close();

  rmSync(verifyDbPath, { force: true, maxRetries: 3, retryDelay: 50 });
  rmSync(verifyUploadDir, { force: true, recursive: true, maxRetries: 3, retryDelay: 50 });
  console.log("verify ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
