const {
  accepted,
  ok,
  parsePagination,
  readJsonBody,
  readTextBody,
  sendEvent
} = require("./http");
const {
  buildFallbackRedirect,
  buildFrontendRedirect,
  completeGoogleCallback,
  consumeGoogleLoginExchange,
  createGoogleAuthorizationUrl,
  createGoogleLoginExchange,
  isGoogleAuthConfigured,
} = require("./google-auth");
const { createUploadFromRequest, getPublicUploadUrl, readUploadByUrlPath, sendUpload } = require("./uploads");
const {
  analyzeVideoWithQwenOmni,
  hasQwenOmniApiKey,
  isAllowedQwenOmniModel,
  ALLOWED_QWEN_OMNI_MODELS,
} = require("./qwen-omni");
const { generateTextWithAliyun, translateTextWithAliyun, hasAliyunApiKey } = require("./aliyun");
const {
  generateVertexGeminiChat,
  generateVertexGeminiImages,
  hasVertexCredentials,
} = require("./vertex");
const { createUploadFromBuffer } = require("./uploads");
const { decodeAuthToken } = require("./store");
const { buildCanvasLibraryRoutes } = require("./canvas-library");
const { isLocalLoopbackClientHint, SUPER_ADMIN_DEMO_ACTOR_ID } = require("./local-loopback-request");
const {
  createLiveRechargeSession,
  assertAlipayNotificationMatchesOrder,
  getRechargeCapabilities,
  parseAlipayNotification,
  parseWechatNotification,
  refreshRechargeOrder,
  renderAlipayCheckoutPage,
} = require("./payments");
const {
  calculateRechargeCredits,
  normalizeRechargeAmount,
} = require("./payments/recharge-pricing");
const { collectNetworkAccessInfo } = require("./network-access");
const { ensureJaazServices, getJaazServiceStatus } = require("./jaaz-services");
const {
  syncJaazAssetToProject,
  syncJaazCanvasProjectToProject,
} = require("./jaaz-asset-sync");

const ARK_BASE = "https://ark.cn-beijing.volces.com/api/v3";
const DEFAULT_CHAT_MODEL = "doubao-seed-2-0-mini-260215";
const DEFAULT_AGENT_CANVAS_GEMINI_MODEL = "vertex:gemini-3-flash-preview";
const DEFAULT_AGENT_CANVAS_TEXT_MODEL = "qwen-plus";

function route(method, path, handler) {
  return { method, path, handler, statusCode: 200 };
}

function routeWithStatus(method, path, statusCode, handler) {
  return { method, path, handler, statusCode };
}

function failure(statusCode, code, message) {
  return {
    error: {
      statusCode,
      code,
      message
    }
  };
}

function redirect(res, location) {
  res.writeHead(302, {
    Location: location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function getActorId(req, url) {
  let resolved;
  let headerActorId = null;
  let tokenActorId = null;
  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const userId = decodeAuthToken(authHeader.slice(7));
    if (userId) {
      tokenActorId = userId;
      resolved = userId;
    }
  }

  const headerValue = req.headers["x-actor-id"];
  if (typeof headerValue === "string" && headerValue.trim()) {
    headerActorId = headerValue.trim();
  } else if (Array.isArray(headerValue) && headerValue[0]?.trim()) {
    headerActorId = headerValue[0].trim();
  }

  if (headerActorId && tokenActorId && headerActorId !== tokenActorId) {
    if (isLocalLoopbackClientHint(req)) {
      console.warn("[routes] actor mismatch on loopback request, preferring X-Actor-Id", {
        tokenActorId,
        headerActorId,
        path: url?.pathname || "",
      });
      resolved = headerActorId;
    } else {
      resolved = tokenActorId;
    }
  } else if (!resolved && headerActorId) {
    resolved = headerActorId;
  }

  if (!resolved) {
    const queryActorId = url?.searchParams?.get("actorId");
    if (queryActorId && queryActorId.trim()) {
      resolved = queryActorId.trim();
    }
  }

  if (resolved === SUPER_ADMIN_DEMO_ACTOR_ID && !isLocalLoopbackClientHint(req)) {
    return "guest";
  }

  return resolved;
}

function parseNumberParam(url, name) {
  const value = Number(url.searchParams.get(name) || "0");
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function parseCreditQuoteInput(url) {
  return {
    sourceText: url.searchParams.get("sourceText") || undefined,
    text: url.searchParams.get("text") || undefined,
    count: parseNumberParam(url, "count"),
    shotCount: parseNumberParam(url, "shotCount"),
    storyboardId: url.searchParams.get("storyboardId") || undefined,
    model: url.searchParams.get("model") || undefined,
    aspectRatio: url.searchParams.get("aspectRatio") || undefined,
    resolution: url.searchParams.get("resolution") || undefined,
  };
}

function buildRoutes(store) {
  return [
    ...buildSystemRoutes(store),
    ...buildAuthRoutes(store),
    ...buildWalletRoutes(store),
    ...buildApiCenterRoutes(store),
    ...buildPlaygroundRoutes(store),
    ...buildChatRoutes(),
    ...buildAgentCanvasRoutes(store),
    ...buildVertexProxyRoutes(),
    ...buildCreateRoutes(store),
    ...buildProjectRoutes(store),
    ...buildTaskRoutes(store),
    ...buildToolboxRoutes(store),
    ...buildAdminRoutes(store),
    ...buildCanvasProjectRoutes(store),
    ...buildCanvasLibraryRoutes(store),
  ];
}

/**
 * OpenAI-compatible proxy for Vertex Gemini chat models.
 * Mounted at /api/vertex-openai/v1/ for internal and compatible external clients.
 *
 * Included models (Preview):
 *   vertex:gemini-3-flash-preview   → label "Gemini 3+"
 *   vertex:gemini-3.1-pro-preview   → label "Gemini 3.1+"
 *
 * NOT included:
 *   gemini-3-pro-preview  → discontinued by Google 2026-03-26
 */
function buildVertexProxyRoutes() {
  let vertex;
  function getVertex() {
    if (!vertex) vertex = require("./vertex");
    return vertex;
  }

  return [
    route("GET", "/api/vertex-openai/v1/models", () => {
      return getVertex().getVertexChatModelList();
    }),
    routeWithStatus("POST", "/api/vertex-openai/v1/chat/completions", 200, async ({ req }) => {
      const body = await readJsonBody(req);
      const v = getVertex();
      const internalModelId = String(body?.model || "vertex:gemini-3-flash-preview");

      if (!v.isVertexChatModel(internalModelId)) {
        return {
          error: {
            statusCode: 400,
            code: "UNSUPPORTED_MODEL",
            message: `Model ${internalModelId} is not a supported Vertex chat model. Supported: ${[...v.VERTEX_CHAT_MODEL_IDS].join(", ")}`,
          }
        };
      }

      if (!v.hasVertexCredentials()) {
        return {
          error: {
            statusCode: 503,
            code: "PROVIDER_NOT_CONFIGURED",
            message: "Vertex AI credentials not configured. Set VERTEX_PROJECT_ID and VERTEX_API_KEY (or GOOGLE_APPLICATION_CREDENTIALS) in core-api/.env.local.",
          }
        };
      }

      return await v.generateVertexGeminiChat({
        internalModelId,
        messages: body?.messages || [],
        max_tokens: body?.max_tokens,
        temperature: body?.temperature,
      });
    }),
  ];
}

function buildAuthRoutes(store) {
  return [
    route("GET", "/api/auth/providers", () =>
      ok({
        google: {
          configured: isGoogleAuthConfigured(),
        },
      })
    ),
    route("GET", "/api/auth/google/start", ({ res, url }) => {
      const authorizationUrl = createGoogleAuthorizationUrl({
        returnTo: url.searchParams.get("returnTo"),
        frontendOrigin: url.searchParams.get("frontendOrigin"),
      });
      redirect(res, authorizationUrl);
    }),
    route("GET", "/api/auth/google/callback", async ({ res, url }) => {
      let location;
      let sessionForRedirect = null;
      try {
        const { session, profile } = await completeGoogleCallback(url);
        sessionForRedirect = session;
        const loginResult = store.loginWithGoogle(profile);
        const exchangeCode = createGoogleLoginExchange(loginResult);
        location = buildFrontendRedirect(session, { googleLoginCode: exchangeCode });
      } catch (error) {
        const session = error?.session || sessionForRedirect;
        const params = {
          googleLoginError: error?.code || "GOOGLE_LOGIN_FAILED",
          message: error?.message || "Google login failed.",
        };
        location = session ? buildFrontendRedirect(session, params) : buildFallbackRedirect(params);
      }
      redirect(res, location);
    }),
    routeWithStatus("POST", "/api/auth/google/exchange", 200, async ({ req }) => {
      const body = await readJsonBody(req);
      return ok(consumeGoogleLoginExchange(body?.code));
    }),
    routeWithStatus("POST", "/api/auth/login", 200, async ({ req }) => {
      const body = await readJsonBody(req);
      return ok(store.loginWithEmail(body));
    }),
    routeWithStatus("POST", "/api/auth/admin/login", 200, async ({ req }) => {
      const body = await readJsonBody(req);
      return ok(store.loginAdminWithEmail(body));
    }),
    routeWithStatus("POST", "/api/auth/register/personal", 201, async ({ req }) => {
      const body = await readJsonBody(req);
      return ok(store.registerPersonalUser(body));
    }),
    routeWithStatus("POST", "/api/auth/register/enterprise-admin", 201, async ({ req }) => {
      const body = await readJsonBody(req);
      return ok(store.registerEnterpriseAdmin(body));
    }),
  ];
}

function buildSystemRoutes(store) {
  return [
    route("GET", "/uploads/:fileName", ({ params, res, req }) => {
      const served = sendUpload(res, params.fileName, req);
      if (!served) return failure(404, "NOT_FOUND", "upload not found");
    }),
    routeWithStatus("POST", "/api/uploads", 201, async ({ req, url }) => {
      const upload = await createUploadFromRequest(req, url.searchParams.get("kind") || "file");
      return ok({
        ...upload,
        url: getPublicUploadUrl(req, upload.urlPath)
      });
    }),
    route("GET", "/healthz", () =>
      ok({ status: "ok", service: "core-api", mode: store.mode || "mock" })
    ),
    route("GET", "/api/jaaz/status", async () =>
      ok(await getJaazServiceStatus())
    ),
    routeWithStatus("POST", "/api/jaaz/ensure", 202, async () =>
      ok(await ensureJaazServices({ reason: "frontend" }))
    ),
    routeWithStatus("POST", "/api/demo/reset", 200, () => {
      store.reset();
      return ok({
        reset: true,
        projectId: "proj_demo_001"
      });
    }),
    route("GET", "/api/capabilities", () =>
      ok({
        service: "core-api",
        mode: store.mode || "mock",
        implementedDomains: [
          "create",
          "uploads",
          "projects",
          "settings",
          "scripts",
          "assets",
          "storyboards",
          "videos",
          "dubbings",
          "timeline",
          "tasks",
          "wallet",
          "billing",
          "enterprise",
          "toolbox"
        ],
        toolbox: store.getToolboxCapabilities()
      })
    ),
    route("GET", "/api/system/network-access", () =>
      ok(
        collectNetworkAccessInfo(
          Number(process.env.FRONTEND_PORT || "3000"),
          Number(process.env.PORT || "4100"),
        ),
      )
    ),
    route("GET", "/api/me", ({ req, url }) =>
      ok(store.getPermissionContext(getActorId(req, url)))
    ),
    route("PUT", "/api/me", async ({ req, url }) => {
      const body = await readJsonBody(req);
      return ok(store.updateMe(getActorId(req, url), body));
    }),
    route("GET", "/api/tasks/stream", ({ req, res, url }) => {
      const actorId = getActorId(req, url);
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*"
      });

      sendEvent(res, "ready", { connectedAt: new Date().toISOString() });
      sendEvent(res, "snapshot", { tasks: store.listTasks(url.searchParams.get("projectId"), actorId) });

      const onEvent = (event) => {
        const projectId = url.searchParams.get("projectId");
        if (projectId && event.payload.projectId && event.payload.projectId !== projectId) {
          return;
        }
        if (actorId) {
          try {
            if (event.payload?.projectId) {
              store.assertProjectAccess(event.payload.projectId, actorId);
            } else if (event.payload?.actorId && event.payload.actorId !== actorId) {
              return;
            }
          } catch {
            return;
          }
        }
        sendEvent(res, event.type, event);
      };

      const heartbeat = setInterval(() => {
        sendEvent(res, "heartbeat", { timestamp: new Date().toISOString() });
      }, 15000);

      store.events.on("event", onEvent);

      req.on("close", () => {
        clearInterval(heartbeat);
        store.events.off("event", onEvent);
      });
    })
  ];
}

function buildWalletRoutes(store) {
  return [
    route("GET", "/api/wallet", ({ req, url }) => ok(store.getWallet(getActorId(req, url)))),
    route("GET", "/api/wallets", ({ req, url }) =>
      ok({ items: store.listWallets(getActorId(req, url)) })
    ),
    route("GET", "/api/wallet/usage-stats", ({ req, url }) =>
      ok(store.getWalletUsageStats(getActorId(req, url), url.searchParams.get("mode") || "personal"))
    ),
    route("GET", "/api/wallets/:walletId/ledger", ({ params, req, url }) =>
      ok({ items: store.listWalletLedger(params.walletId, getActorId(req, url)) })
    ),
    route("GET", "/api/wallet/recharge-capabilities", ({ req }) =>
      ok(getRechargeCapabilities(req))
    ),
    routeWithStatus("POST", "/api/wallet/recharge-orders", 201, async ({ req, url }) => {
      const body = await readJsonBody(req);
      const amount = normalizeRechargeAmount(body.amount);
      const credits = calculateRechargeCredits(amount);
      const paymentMethod = String(body.paymentMethod || "wechat_pay");
      const mode = String(body.mode || "live");
      const scene = body.scene == null ? null : String(body.scene);
      const capabilitySet = getRechargeCapabilities(req);
      const capability = capabilitySet.methods.find((item) => item.paymentMethod === paymentMethod);

      if (!body.planId || !body.planName) {
        return failure(400, "BAD_REQUEST", "planId and planName are required");
      }

      if (!capability) {
        return failure(400, "BAD_REQUEST", `unsupported paymentMethod: ${paymentMethod}`);
      }

      if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(credits) || credits <= 0) {
        return failure(400, "BAD_REQUEST", "amount must resolve to positive recharge credits");
      }

      if (mode === "demo_mock") {
        if (!capability.demoMock.available) {
          return failure(403, "FORBIDDEN", capability.demoMock.reason || "demo mock payment is not available");
        }
      } else if (mode === "live") {
        if (!capability.live.available) {
          return failure(409, "PAYMENT_PROVIDER_NOT_READY", capability.live.reason || "live payment is not ready");
        }
      } else {
        return failure(400, "BAD_REQUEST", `unsupported mode: ${mode}`);
      }

      const createdOrder = store.createWalletRechargeOrder(
        {
          planId: body.planId,
          planName: body.planName,
          billingCycle: body.billingCycle,
          paymentMethod,
          mode,
          scene,
          amount,
          credits,
          walletId: body.walletId,
        },
        getActorId(req, url),
      );

      if (mode === "demo_mock") {
        return ok(createdOrder);
      }

      try {
        const sessionPatch = await createLiveRechargeSession(createdOrder, req);
        const updatedOrder =
          store.updateWalletRechargeOrder(createdOrder.id, sessionPatch, createdOrder.actorId, {
            allowPlatformAdmin: true,
          }) || createdOrder;

        return ok(updatedOrder);
      } catch (error) {
        store.updateWalletRechargeOrder(
          createdOrder.id,
          {
            status: paymentMethod === "bank_transfer" ? "pending" : "failed",
            failureReason: error?.message || "Unable to create payment session.",
          },
          createdOrder.actorId,
          { allowPlatformAdmin: true },
        );
        throw error;
      }
    }),
    route("GET", "/api/wallet/recharge-orders/:orderId", ({ params, req, url }) => {
      const order = store.getWalletRechargeOrder(params.orderId, getActorId(req, url));
      if (!order) return failure(404, "NOT_FOUND", "recharge order not found");
      return ok(order);
    }),
    routeWithStatus("POST", "/api/wallet/recharge-orders/:orderId/refresh-status", 200, async ({ params, req, url }) => {
      const actorId = getActorId(req, url);
      const currentOrder = store.getWalletRechargeOrder(params.orderId, actorId);
      if (!currentOrder) return failure(404, "NOT_FOUND", "recharge order not found");

      const providerState = await refreshRechargeOrder(currentOrder);
      const nextOrder =
        providerState.status === "paid"
          ? store.markWalletRechargeOrderPaid(currentOrder.id, actorId || currentOrder.actorId, providerState)
          : store.updateWalletRechargeOrder(currentOrder.id, providerState, actorId || currentOrder.actorId, {
              allowPlatformAdmin: true,
            });
      return ok(nextOrder || store.getWalletRechargeOrder(currentOrder.id, actorId || currentOrder.actorId));
    }),
    routeWithStatus("POST", "/api/wallet/recharge-orders/:orderId/bank-transfer-proof", 200, async ({ params, req, url }) => {
      const body = await readJsonBody(req);
      const order = store.submitWalletRechargeTransferProof(params.orderId, body, getActorId(req, url));
      if (!order) return failure(404, "NOT_FOUND", "recharge order not found");
      return ok(order);
    }),
    routeWithStatus("POST", "/api/wallet/recharge-orders/:orderId/confirm", 200, ({ params, req, url }) => {
      const order = store.confirmWalletRechargeOrder(params.orderId, getActorId(req, url));
      if (!order) return failure(404, "NOT_FOUND", "recharge order not found");
      return ok(order);
    }),
    route("GET", "/api/payments/alipay/checkout/:orderId", ({ params, req, res }) => {
      const order = store.getWalletRechargeOrder(params.orderId, null);
      if (!order) return failure(404, "NOT_FOUND", "recharge order not found");
      const html = renderAlipayCheckoutPage(order, req);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(html);
      return undefined;
    }),
    routeWithStatus("POST", "/api/payments/wechat/notify", 200, async ({ req, res }) => {
      const rawBody = await readTextBody(req);
      try {
        const notification = parseWechatNotification(rawBody, req.headers);
        const order = store.getWalletRechargeOrder(notification.orderId, null);
        if (order) {
          store.markWalletRechargeOrderPaid(order.id, null, {
            provider: "wechat",
            providerTradeNo: notification.providerTradeNo,
            paidAt: notification.paidAt,
            notifyPayload: notification.notifyPayload,
            failureReason: null,
          });
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ code: "SUCCESS", message: "成功" }));
      } catch (error) {
        res.writeHead(error?.statusCode || 400, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ code: "FAIL", message: error?.message || "callback failed" }));
      }
      return undefined;
    }),
    routeWithStatus("POST", "/api/payments/alipay/notify", 200, async ({ req, res }) => {
      const rawBody = await readTextBody(req);
      const params = Object.fromEntries(new URLSearchParams(rawBody));
      try {
        const notification = parseAlipayNotification(params);
        const order = store.getWalletRechargeOrder(notification.orderId, null);
        if (!order) {
          const error = new Error("Alipay notification order was not found locally.");
          error.statusCode = 404;
          error.code = "ALIPAY_ORDER_NOT_FOUND";
          throw error;
        }

        assertAlipayNotificationMatchesOrder(notification, order);
        if (notification.status === "paid") {
          store.markWalletRechargeOrderPaid(order.id, null, {
            provider: "alipay",
            providerTradeNo: notification.providerTradeNo,
            paidAt: notification.paidAt,
            notifyPayload: notification.notifyPayload,
            failureReason: null,
          });
        } else {
          store.updateWalletRechargeOrder(
            order.id,
            {
              provider: "alipay",
              providerTradeNo: notification.providerTradeNo,
              notifyPayload: notification.notifyPayload,
            },
            order.actorId,
            { allowPlatformAdmin: true },
          );
        }
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("success");
      } catch (error) {
        res.writeHead(error?.statusCode || 400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("failure");
      }
      return undefined;
    }),
  ];
}

function buildApiCenterRoutes(store) {
  return [
    route("GET", "/api/api-center", ({ req, url }) =>
      ok(store.getApiCenterConfig(getActorId(req, url)))
    ),
    route("PUT", "/api/api-center/defaults", async ({ req, url }) => {
      const body = await readJsonBody(req);
      return ok(store.updateApiCenterDefaults(body, getActorId(req, url)));
    }),
    route("PUT", "/api/api-center/vendors/:vendorId/api-key", async ({ params, req, url }) => {
      const body = await readJsonBody(req);
      return ok(
        store.saveApiCenterVendorApiKey(params.vendorId, body.apiKey, getActorId(req, url))
      );
    }),
    route("POST", "/api/api-center/vendors/:vendorId/test", async ({ params, req, url }) =>
      ok(await store.testApiCenterVendorConnection(params.vendorId, getActorId(req, url)))
    ),
    route(
      "PUT",
      "/api/api-center/vendors/:vendorId/models/:modelId",
      async ({ params, req, url }) => {
        const body = await readJsonBody(req);
        return ok(
          store.updateApiVendorModel(
            params.vendorId,
            params.modelId,
            body,
            getActorId(req, url)
          )
        );
      }
    ),
  ];
}

function buildCreateRoutes(store) {
  return [
    route("GET", "/api/create/credit-quote", ({ req, url }) => {
      const actionCode = url.searchParams.get("action");
      if (!actionCode) {
        return failure(400, "BAD_REQUEST", "action is required");
      }

      return ok(
        store.getCreateCreditQuote(
          url.searchParams.get("projectId") || null,
          actionCode,
          parseCreditQuoteInput(url),
          getActorId(req, url),
        ),
      );
    }),
    route("GET", "/api/create/images", ({ req, url }) =>
      ok({ items: store.listCreateImages(getActorId(req, url)) })
    ),
    route("GET", "/api/create/images/capabilities", ({ url }) =>
      ok(store.getCreateImageCapabilities(url.searchParams.get("mode") || null))
    ),
    routeWithStatus("POST", "/api/create/images/generate", 202, async ({ req, url }) => {
      const body = await readJsonBody(req);
      // Honour the standard ``Idempotency-Key`` header (Stripe-style) so
      // clients can safely retry without duplicating provider work. Body
      // field ``idempotencyKey`` acts as a fallback for environments where
      // custom headers are stripped by a proxy.
      const idempotencyKey =
        String(req.headers["idempotency-key"] || req.headers["Idempotency-Key"] || "").trim() ||
        (typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "");
      return accepted(
        store.makeCreateImageTask({
          ...body,
          actorId: getActorId(req, url),
          idempotencyKey: idempotencyKey || undefined,
        }),
      );
    }),
    route("GET", "/api/create/videos", ({ req, url }) =>
      ok({ items: store.listCreateVideos(getActorId(req, url)) })
    ),
    route("GET", "/api/create/videos/capabilities", ({ url }) =>
      ok(store.getCreateVideoCapabilities(url.searchParams.get("mode") || null))
    ),
    routeWithStatus("POST", "/api/create/videos/generate", 202, async ({ req, url }) => {
      const body = await readJsonBody(req);
      const idempotencyKey =
        String(req.headers["idempotency-key"] || req.headers["Idempotency-Key"] || "").trim() ||
        (typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "");
      return accepted(
        store.makeCreateVideoTask({
          ...body,
          actorId: getActorId(req, url),
          idempotencyKey: idempotencyKey || undefined,
        }),
      );
    }),
    route("DELETE", "/api/create/images/:imageId", ({ params, req, url }) => {
      const removed = store.deleteCreateImage(params.imageId, getActorId(req, url));
      if (!removed) return failure(404, "NOT_FOUND", "image not found");
      return ok(removed);
    }),
    route("DELETE", "/api/create/videos/:videoId", ({ params, req, url }) => {
      const removed = store.deleteCreateVideo(params.videoId, getActorId(req, url));
      if (!removed) return failure(404, "NOT_FOUND", "video not found");
      return ok(removed);
    })
  ];
}

function buildProjectRoutes(store) {
  return [
    route("GET", "/api/projects", ({ req, url }) => {
      const pagination = parsePagination(url);
      return ok(
        store.listProjects(pagination.page, pagination.pageSize, getActorId(req, url)),
        pagination,
      );
    }),
    routeWithStatus("POST", "/api/projects", 201, async ({ req, url }) => {
      const body = await readJsonBody(req);
      if (!body.title) return failure(400, "BAD_REQUEST", "title is required");
      return ok(store.createProject(body, getActorId(req, url)));
    }),
    route("GET", "/api/projects/:projectId", ({ params, req, url }) => {
      const project = store.getProject(params.projectId, getActorId(req, url));
      if (!project) return failure(404, "NOT_FOUND", "project not found");
      return ok(project);
    }),
    route("PUT", "/api/projects/:projectId", async ({ params, req, url }) => {
      const body = await readJsonBody(req);
      const project = store.updateProject(params.projectId, body, getActorId(req, url));
      if (!project) return failure(404, "NOT_FOUND", "project not found");
      return ok(project);
    }),
    route("GET", "/api/projects/:projectId/overview", ({ params, req, url }) => {
      const overview = store.getProjectOverview(params.projectId, getActorId(req, url));
      if (!overview) return failure(404, "NOT_FOUND", "project not found");
      return ok(overview);
    }),
    route("GET", "/api/projects/:projectId/credit-quote", ({ params, req, url }) => {
      const actionCode = url.searchParams.get("action");
      if (!actionCode) {
        return failure(400, "BAD_REQUEST", "action is required");
      }

      return ok(
        store.getProjectCreditQuote(
          params.projectId,
          actionCode,
          parseCreditQuoteInput(url),
          getActorId(req, url),
        ),
      );
    }),
    route("GET", "/api/projects/:projectId/settings", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const settings = store.getSettings(params.projectId);
      if (!settings) return failure(404, "NOT_FOUND", "project settings not found");
      return ok(settings);
    }),
    route("PUT", "/api/projects/:projectId/settings", async ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const body = await readJsonBody(req);
      const settings = store.updateSettings(params.projectId, body);
      if (!settings) return failure(404, "NOT_FOUND", "project settings not found");
      return ok(settings);
    }),
    route("GET", "/api/projects/:projectId/script", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const script = store.getScript(params.projectId);
      if (!script) return failure(404, "NOT_FOUND", "script not found");
      return ok(script);
    }),
    route("PUT", "/api/projects/:projectId/script", async ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const body = await readJsonBody(req);
      if (typeof body.content !== "string") return failure(400, "BAD_REQUEST", "content is required");
      const script = store.updateScript(params.projectId, body.content);
      if (!script) return failure(404, "NOT_FOUND", "script not found");
      return ok(script);
    }),
    routeWithStatus("POST", "/api/projects/:projectId/script/rewrite", 202, async ({ params, req, url }) => {
      const body = await readJsonBody(req);
      if (!body.instruction) return failure(400, "BAD_REQUEST", "instruction is required");
      return accepted(
        store.makeScriptRewriteTask(params.projectId, {
          ...body,
          actorId: getActorId(req, url),
        }),
      );
    }),
    route("GET", "/api/projects/:projectId/assets", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const assetType = url.searchParams.get("assetType");
      return ok({ items: store.listAssets(params.projectId, assetType) });
    }),
      routeWithStatus("POST", "/api/projects/:projectId/assets/extract", 202, async ({ params, req, url }) => {
        const body = await readJsonBody(req);
        return accepted(
          store.makeAssetExtractTask(params.projectId, {
            ...body,
          actorId: getActorId(req, url),
          }),
        );
      }),
      routeWithStatus("POST", "/api/projects/:projectId/assets/agent-studio/sync", 201, async ({ params, req, url }) => {
        store.assertProjectAccess(params.projectId, getActorId(req, url));
        const body = await readJsonBody(req);
        try {
          return ok(
            await syncJaazAssetToProject({
              store,
              projectId: params.projectId,
              body,
            }),
          );
        } catch (error) {
          return failure(
            error?.statusCode || 500,
            error?.code || "AGENT_STUDIO_ASSET_SYNC_FAILED",
            error?.message || "agent studio asset sync failed",
          );
        }
      }),
      routeWithStatus("POST", "/api/projects/:projectId/assets/agent-studio/projects/sync", 201, async ({ params, req, url }) => {
        store.assertProjectAccess(params.projectId, getActorId(req, url));
        const body = await readJsonBody(req);
        try {
          return ok(
            await syncJaazCanvasProjectToProject({
              store,
              projectId: params.projectId,
              body,
            }),
          );
        } catch (error) {
          return failure(
            error?.statusCode || 500,
            error?.code || "AGENT_STUDIO_PROJECT_SYNC_FAILED",
            error?.message || "agent studio project sync failed",
          );
        }
      }),
      routeWithStatus("POST", "/api/projects/:projectId/assets", 201, async ({ params, req, url }) => {
        store.assertProjectAccess(params.projectId, getActorId(req, url));
        const body = await readJsonBody(req);
      if (!body.assetType || !body.name) {
        return failure(400, "BAD_REQUEST", "assetType and name are required");
      }
      const persisted = await store.persistEphemeralAssetMedia(body);
      const asset =
        persisted.scope === "manual"
          ? store.saveProjectAsset(params.projectId, {
              ...persisted,
              scope: persisted.scope || "manual",
            })
          : store.createAsset(params.projectId, persisted);
      if (!asset) return failure(404, "NOT_FOUND", "project not found");
      return ok(asset);
    }),
    route("GET", "/api/projects/:projectId/assets/:assetId", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const asset = store.getAsset(params.projectId, params.assetId);
      if (!asset) return failure(404, "NOT_FOUND", "asset not found");
      return ok(asset);
    }),
    route("PUT", "/api/projects/:projectId/assets/:assetId", async ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const body = await readJsonBody(req);
      const persisted = await store.persistEphemeralAssetMedia(body);
      const asset = store.updateAsset(params.projectId, params.assetId, persisted);
      if (!asset) return failure(404, "NOT_FOUND", "asset not found");
      return ok(asset);
    }),
    routeWithStatus(
      "POST",
      "/api/projects/:projectId/assets/:assetId/images/generate",
      202,
      async ({ params, req, url }) => {
        store.assertProjectAccess(params.projectId, getActorId(req, url));
        const asset = store.getAsset(params.projectId, params.assetId);
        if (!asset) return failure(404, "NOT_FOUND", "asset not found");

        const body = await readJsonBody(req);
        return accepted(
          store.makeAssetImageGenerateTask(params.projectId, params.assetId, {
            ...body,
            actorId: getActorId(req, url),
          }),
        );
      }
    ),
    routeWithStatus("DELETE", "/api/projects/:projectId/assets/:assetId", 200, ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const removed = store.deleteAsset(params.projectId, params.assetId);
      if (!removed) return failure(404, "NOT_FOUND", "asset not found");
      return ok({ deleted: true, assetId: params.assetId });
    }),
    route("GET", "/api/projects/:projectId/storyboards", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const episodeNoParam = url.searchParams.get("episodeNo");
      const episodeNo = episodeNoParam != null ? parseInt(episodeNoParam, 10) : null;
      let items = store.listStoryboards(params.projectId);
      if (episodeNo != null && !Number.isNaN(episodeNo)) {
        items = items.filter((s) => (s.episodeNo ?? 1) === episodeNo);
      }
      return ok({ items });
    }),
    routeWithStatus("POST", "/api/projects/:projectId/storyboards/auto-generate", 202, async ({ params, req, url }) => {
      const body = await readJsonBody(req);
      return accepted(
        store.makeStoryboardGenerateTask(params.projectId, {
          ...body,
          actorId: getActorId(req, url),
        }),
      );
    }),
    route("GET", "/api/projects/:projectId/storyboards/:storyboardId", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const storyboard = store.getStoryboard(params.projectId, params.storyboardId);
      if (!storyboard) return failure(404, "NOT_FOUND", "storyboard not found");
      return ok(storyboard);
    }),
    route("PUT", "/api/projects/:projectId/storyboards/:storyboardId", async ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const body = await readJsonBody(req);
      const storyboard = store.updateStoryboard(params.projectId, params.storyboardId, body);
      if (!storyboard) return failure(404, "NOT_FOUND", "storyboard not found");
      return ok(storyboard);
    }),
    routeWithStatus("DELETE", "/api/projects/:projectId/storyboards/:storyboardId", 200, ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const removed = store.deleteStoryboard(params.projectId, params.storyboardId);
      if (!removed) return failure(404, "NOT_FOUND", "storyboard not found");
      return ok({ deleted: true, storyboardId: params.storyboardId });
    }),
    route("GET", "/api/projects/:projectId/videos", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      return ok({ items: store.listVideos(params.projectId) });
    }),
    route("GET", "/api/projects/:projectId/videos/:videoId", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const video = store.getVideo(params.projectId, params.videoId);
      if (!video) return failure(404, "NOT_FOUND", "video not found");
      return ok(video);
    }),
    route("GET", "/api/projects/:projectId/dubbings", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      return ok({ items: store.listDubbings(params.projectId) });
    }),
    route("GET", "/api/projects/:projectId/dubbings/:dubbingId", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const dubbing = store.getDubbing(params.projectId, params.dubbingId);
      if (!dubbing) return failure(404, "NOT_FOUND", "dubbing not found");
      return ok(dubbing);
    }),
    route("PUT", "/api/projects/:projectId/dubbings/:dubbingId", async ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const body = await readJsonBody(req);
      const dubbing = store.updateDubbing(params.projectId, params.dubbingId, body);
      if (!dubbing) return failure(404, "NOT_FOUND", "dubbing not found");
      return ok(dubbing);
    }),
    routeWithStatus("POST", "/api/storyboards/:storyboardId/images/generate", 202, async ({ params, req, url }) => {
      const actorId = getActorId(req, url);
      const storyboard = store.findStoryboard(params.storyboardId);
      if (!storyboard) return failure(404, "NOT_FOUND", "storyboard not found");
      store.assertProjectAccess(storyboard.projectId, actorId);
      const body = await readJsonBody(req);
      return accepted(
        store.makeImageGenerateTask(params.storyboardId, {
          ...body,
          actorId,
        }),
      );
    }),
    routeWithStatus("POST", "/api/storyboards/:storyboardId/videos/generate", 202, async ({ params, req, url }) => {
      const actorId = getActorId(req, url);
      const storyboard = store.findStoryboard(params.storyboardId);
      if (!storyboard) return failure(404, "NOT_FOUND", "storyboard not found");
      store.assertProjectAccess(storyboard.projectId, actorId);
      const body = await readJsonBody(req);
      return accepted(
        store.makeVideoGenerateTask(params.storyboardId, {
          ...body,
          actorId,
        }),
      );
    }),
    routeWithStatus("POST", "/api/storyboards/:storyboardId/dubbings/generate", 202, async ({ params, req, url }) => {
      const actorId = getActorId(req, url);
      const storyboard = store.findStoryboard(params.storyboardId);
      if (!storyboard) return failure(404, "NOT_FOUND", "storyboard not found");
      store.assertProjectAccess(storyboard.projectId, actorId);
      const body = await readJsonBody(req);
      return accepted(
        store.makeDubbingGenerateTask(params.storyboardId, {
          ...body,
          actorId,
        }),
      );
    }),
    routeWithStatus("POST", "/api/storyboards/:storyboardId/lipsync/generate", 202, ({ params, req, url }) => {
      const actorId = getActorId(req, url);
      const storyboard = store.findStoryboard(params.storyboardId);
      if (!storyboard) return failure(404, "NOT_FOUND", "storyboard not found");
      store.assertProjectAccess(storyboard.projectId, actorId);
      return accepted(
        store.makeLipSyncTask(params.storyboardId, {
          actorId,
        }),
      );
    }),
    route("GET", "/api/projects/:projectId/tasks", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      return ok({ items: store.listTasks(params.projectId, getActorId(req, url)) });
    }),
    route("GET", "/api/projects/:projectId/timeline", ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const timeline = store.getTimeline(params.projectId);
      if (!timeline) return failure(404, "NOT_FOUND", "timeline not found");
      return ok(timeline);
    }),
    route("PUT", "/api/projects/:projectId/timeline", async ({ params, req, url }) => {
      store.assertProjectAccess(params.projectId, getActorId(req, url));
      const body = await readJsonBody(req);
      const timeline = store.updateTimeline(params.projectId, body);
      if (!timeline) return failure(404, "NOT_FOUND", "timeline not found");
      return ok(timeline);
    }),
    routeWithStatus("POST", "/api/projects/:projectId/exports", 202, async ({ params, req, url }) => {
      const body = await readJsonBody(req);
      return accepted(
        store.makeExportTask(params.projectId, {
          ...body,
          actorId: getActorId(req, url),
        }),
      );
    })
  ];
}

function buildTaskRoutes(store) {
  return [
    route("GET", "/api/tasks", ({ req, url }) =>
      ok({
        items: store.listTasks(
          url.searchParams.get("projectId"),
          getActorId(req, url),
          url.searchParams.get("type") || undefined,
        ),
      })
    ),
    routeWithStatus("DELETE", "/api/tasks", 200, ({ req, url }) => {
      const projectId = url.searchParams.get("projectId");
      const type = url.searchParams.get("type");
      const result = store.clearTasks(projectId, getActorId(req, url), type || undefined);
      return ok(result);
    }),
    route("GET", "/api/tasks/:taskId", ({ params, req, url }) => {
      const task = store.getTask(params.taskId, getActorId(req, url));
      if (!task) return failure(404, "NOT_FOUND", "task not found");
      return ok(task);
    }),
    routeWithStatus("DELETE", "/api/tasks/:taskId", 200, ({ params, req, url }) => {
      const task = store.deleteTask(params.taskId, getActorId(req, url));
      if (!task) return failure(404, "NOT_FOUND", "task not found");
      return ok({ deleted: true, taskId: params.taskId });
    }),
  ];
}

function buildToolboxRoutes(store) {
  return [
    route("GET", "/api/toolbox", () =>
      ok({
        items: store.getToolboxCapabilities(),
        stagingArea: ["character_replace", "motion_transfer", "upscale_restore"]
      })
    ),
    route("GET", "/api/toolbox/capabilities", () =>
      ok({
        items: store.getToolboxCapabilities(),
        stagingArea: ["character_replace", "motion_transfer", "upscale_restore"]
      })
    ),
    routeWithStatus("POST", "/api/toolbox/character-replace", 202, async ({ req, url }) => {
      const body = await readJsonBody(req);
      return accepted(
        store.makeToolboxTask("character_replace", {
          ...body,
          actorId: getActorId(req, url),
        }),
      );
    }),
    routeWithStatus("POST", "/api/toolbox/motion-transfer", 202, async ({ req, url }) => {
      const body = await readJsonBody(req);
      return accepted(
        store.makeToolboxTask("motion_transfer", {
          ...body,
          actorId: getActorId(req, url),
        }),
      );
    }),
    routeWithStatus("POST", "/api/toolbox/upscale-restore", 202, async ({ req, url }) => {
      const body = await readJsonBody(req);
      return accepted(
        store.makeToolboxTask("upscale_restore", {
          ...body,
          actorId: getActorId(req, url),
        }),
      );
    }),

    // ── Video Reverse Prompt (Qwen3.5-Omni) ──
    // Synchronous: reads the uploaded video from local storage and streams
    // back an AI-generated prompt describing the video.
    //
    // Source resolution priority:
    //   1. 任意 URL，只要 pathname 以 `/uploads/` 开头且能在本地磁盘命中 → base64 直通
    //   2. host 是 localhost / 127.0.0.1 / core-api 自己的 host            → base64 直通（不管路径）
    //   3. 其他真正的公网 URL                                               → remoteUrl，由 DashScope 拉取
    //
    // 这样修复了"上传本地视频后 DashScope 报 'Download multimodal file timed
    // out'"的核心问题 —— DashScope 在阿里云机房，访问不到用户本机 4100 端口，
    // 以前走 remoteUrl 必然超时。
    route("POST", "/api/toolbox/video-reverse-prompt", async ({ req }) => {
      const body = await readJsonBody(req);
      const videoUrl = String(body?.videoUrl || body?.url || "").trim();
      if (!videoUrl) {
        return failure(400, "BAD_REQUEST", "videoUrl is required");
      }

      // ── Source resolution ─────────────────────────────────────────────
      const LOCAL_HOSTS = new Set([
        "localhost",
        "127.0.0.1",
        "0.0.0.0",
        "[::1]",
        "::1",
      ]);

      // core-api 自己的 host（便于判断是否是自家地址）。req.headers.host
      // 例如 "localhost:4100" / "127.0.0.1:4100" / 反代场景下的外网域名。
      const selfHost = String(req.headers.host || "").toLowerCase().trim();

      const hasHttpScheme = /^https?:\/\//i.test(videoUrl);
      let parsedUrl = null;
      let urlPath = videoUrl;
      if (hasHttpScheme) {
        try {
          parsedUrl = new URL(videoUrl);
          urlPath = parsedUrl.pathname;
        } catch {
          parsedUrl = null;
        }
      } else {
        // Treat as bare path (e.g. "/uploads/xxx.mp4")
        try {
          const p = new URL(videoUrl, "http://placeholder.local");
          urlPath = p.pathname;
        } catch {
          /* use as-is */
        }
      }

      const hostLower = parsedUrl
        ? parsedUrl.hostname.toLowerCase()
        : "";
      const hostWithPortLower = parsedUrl
        ? `${parsedUrl.hostname}${parsedUrl.port ? ":" + parsedUrl.port : ""}`.toLowerCase()
        : "";
      const isLocalHost =
        LOCAL_HOSTS.has(hostLower) ||
        (selfHost && hostWithPortLower === selfHost);
      const isUploadPath = urlPath.startsWith("/uploads/");

      let upload = null;
      let sourceKind; // "local-disk" | "remote-url"

      if (isUploadPath) {
        upload = readUploadByUrlPath(urlPath);
        if (upload) {
          sourceKind = "local-disk";
        } else if (!hasHttpScheme || isLocalHost) {
          // 看起来就是本地路径（无 scheme）或者指向本机 host，但磁盘上找不到 —— 报 404
          // 不要偷偷 fallback 到 DashScope，否则用户只会看到误导性的 "Download timed out"。
          return failure(
            404,
            "UPLOAD_NOT_FOUND",
            `No uploaded video matched ${urlPath}`,
          );
        }
        // 否则（公网 host + /uploads/ 路径但本地没有）继续走 remoteUrl
      }

      if (!upload && !hasHttpScheme) {
        // 非 HTTP 且不是有效的 /uploads/ 路径 —— 没法处理
        return failure(
          400,
          "BAD_REQUEST",
          `videoUrl must be a valid HTTP(S) URL or /uploads/* path, got: ${videoUrl.slice(0, 120)}`,
        );
      }

      if (!upload && isLocalHost) {
        // host 指向本机，但路径不是 /uploads/，不会在云端被访问到 —— 明确拒绝
        return failure(
          400,
          "UNREACHABLE_LOCAL_URL",
          `videoUrl points to localhost but is not an uploaded file: ${urlPath}. 请先通过 /api/uploads 上传，或使用公网可访问的 URL。`,
        );
      }

      if (!upload) {
        sourceKind = "remote-url";
      }

      if (!hasQwenOmniApiKey()) {
        return failure(
          503,
          "PROVIDER_NOT_CONFIGURED",
          "QWEN_OMNI_API_KEY is not configured on core-api",
        );
      }

      // Per-request model override. Frontend passes one of the whitelisted
      // IDs via body.model; anything else is rejected so we never forward
      // untrusted strings into DashScope's billing endpoint.
      let modelOverride;
      const rawModel = typeof body?.model === "string" ? body.model.trim() : "";
      if (rawModel) {
        if (!isAllowedQwenOmniModel(rawModel)) {
          return failure(
            400,
            "INVALID_MODEL",
            `model must be one of: ${ALLOWED_QWEN_OMNI_MODELS.join(", ")}`,
          );
        }
        modelOverride = rawModel;
      }

      console.log(
        `[video-reverse] source=${sourceKind} model=${modelOverride || process.env.QWEN_OMNI_MODEL || "(default)"} ` +
          (upload
            ? `path=${urlPath} size=${upload.sizeBytes || "?"}`
            : `remoteUrl=${videoUrl.slice(0, 160)}`),
      );

      try {
        const { text, model: actualModel } = await analyzeVideoWithQwenOmni({
          ...(upload
            ? { absolutePath: upload.absolutePath }
            : { remoteUrl: videoUrl }),
          userPrompt: typeof body?.prompt === "string" && body.prompt.trim()
            ? body.prompt.trim()
            : undefined,
          modelOverride,
        });
        return ok({
          prompt: text,
          model: actualModel,
          source: sourceKind,
        });
      } catch (error) {
        const status = error?.statusCode || 502;
        const code = error?.code || "QWEN_OMNI_ERROR";
        const rawMessage = error?.message || "Qwen-Omni analysis failed";

        // 中文前缀：区分是本机处理失败还是 DashScope/外部链路失败，
        // 避免前端看到裸露的英文错误不知道类别。
        let prefix;
        if (code === "VIDEO_TOO_LARGE") {
          prefix = "视频文件过大";
        } else if (code === "PROVIDER_NOT_CONFIGURED" || code === "BAD_INPUT") {
          prefix = "本地处理失败";
        } else if (sourceKind === "local-disk") {
          prefix = "视频理解服务返回错误";
        } else {
          // remote-url: DashScope 拉取外部 URL 的路径
          prefix = "视频理解服务拉取远端视频失败";
        }

        console.error(
          `[video-reverse] FAILED source=${sourceKind} status=${status} code=${code} msg=${String(rawMessage).slice(0, 300)}`,
        );

        return failure(status, code, `${prefix}：${rawMessage}`);
      }
    }),

    // ── Text Translation (Qwen-Plus, bidirectional CN ↔ EN) ──
    /**
     * POST /api/toolbox/storyboard-grid25
     * Generate a 5×5 storyboard grid image using Vertex Gemini.
     * Body: {
     *   plotText: string,
     *   references?: Array<{ name: string; url: string }>,  // named @-references
     *   model?: string
     * }
     * Response: { imageUrl: string, model: string }
     */
    route("POST", "/api/toolbox/storyboard-grid25", async ({ req, url }) => {
      const body = await readJsonBody(req);
      const plotText = String(body?.plotText || "").trim();
      const rawRefs = Array.isArray(body?.references) ? body.references : [];
      const model = String(body?.model || "vertex:gemini-3-pro-image-preview").trim();
      const actorId = getActorId(req, url);

      if (!plotText) {
        return failure(400, "BAD_REQUEST", "plotText is required");
      }
      if (!hasVertexCredentials()) {
        return failure(503, "PROVIDER_NOT_CONFIGURED", "VERTEX_API_KEY or GOOGLE_APPLICATION_CREDENTIALS is not configured");
      }

      // ── Normalise reference entries ────────────────────────────────────────
      const rawRefList = rawRefs
        .filter((r) => r && typeof r === "object" && String(r.url || "").trim())
        .map((r, i) => ({
          name: String(r.name || `角色${i + 1}`).trim().replace(/^@/, ""),
          url: String(r.url).trim(),
        }));

      /**
       * Convert every reference image to a base64 data-URL in-process.
       *
       * Why not pass the HTTP upload URL directly to vertex.js?
       * → vertex.js tries `fetch(url)` but catches errors silently (console.warn
       *   + skip), so a failed fetch means the image is just omitted without any
       *   visible error.  Reading from disk avoids the HTTP round-trip entirely
       *   and is guaranteed to succeed for local uploads.
       */
      const { readFileSync } = require("node:fs");
      const refs = await Promise.all(
        rawRefList.map(async (r) => {
          let dataUrl = null;

          // ① Local upload path — read directly from disk
          const urlPath = (() => {
            try {
              return new URL(r.url).pathname;
            } catch {
              return r.url.startsWith("/") ? r.url : `/${r.url}`;
            }
          })();
          const localUpload = readUploadByUrlPath(urlPath);
          if (localUpload) {
            try {
              const buf = readFileSync(localUpload.absolutePath);
              const mime = localUpload.contentType || "image/jpeg";
              dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
            } catch (e) {
              console.warn(`[storyboard-grid25] disk read failed for ${r.url}:`, e?.message);
            }
          }

          // ② External HTTPS URL — fetch and inline
          if (!dataUrl && /^https:\/\//i.test(r.url)) {
            try {
              const resp = await fetch(r.url);
              if (resp.ok) {
                const buf = Buffer.from(await resp.arrayBuffer());
                const mime = (resp.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
                dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
              } else {
                console.warn(`[storyboard-grid25] remote fetch ${resp.status} for ${r.url}`);
              }
            } catch (e) {
              console.warn(`[storyboard-grid25] remote fetch failed for ${r.url}:`, e?.message);
            }
          }

          if (!dataUrl) {
            console.warn(`[storyboard-grid25] could not resolve reference image "${r.name}" (${r.url}) — it will be skipped`);
          }

          return { ...r, dataUrl };
        })
      );

      // Keep only the refs that resolved to image data
      const resolvedRefs = refs.filter((r) => r.dataUrl);
      console.log(`[storyboard-grid25] resolved ${resolvedRefs.length}/${rawRefList.length} reference images`);

      // ── Build the storyboard grid prompt ────────────────────────────────
      let referencesSection = "";
      if (resolvedRefs.length > 0) {
        const lines = resolvedRefs.map(
          (r, i) => `  - @${r.name} → reference image ${i + 1}: maintain this character/asset's exact visual appearance, costume, and identity consistently across all panels where it appears.`
        );
        const tagList = resolvedRefs.map((r) => `"@${r.name}"`).join(", ");
        referencesSection = `\nCHARACTER AND ASSET REFERENCES (critical — do not deviate from the provided reference images):
${lines.join("\n")}
Whenever a panel's narrative mentions ${tagList}, draw that character or asset exactly as depicted in the corresponding reference image listed above.
`;
      }

      const gridPrompt = `Create a single high-quality image showing a 5×5 storyboard grid (25 panels total) for the following cinematic narrative.

LAYOUT REQUIREMENTS:
- The entire output image is divided into exactly 5 columns × 5 rows = 25 equal square panels
- Each panel is separated by a clean 3px dark border line
- Each panel has a small panel number (1–25) in its top-left corner, white text with dark outline
- Panels flow left-to-right, top-to-bottom: panel 1 is top-left, panel 25 is bottom-right

VISUAL STYLE:
- Cinematic illustration style with rich color and detail
- Consistent color palette, lighting direction, and art style across all 25 panels
- Each panel depicts one distinct key moment or shot from the story
- Clear visual storytelling — composition, action, and emotion should be legible at thumbnail size
${referencesSection}
NARRATIVE TO ILLUSTRATE (split into 25 sequential moments):
${plotText}

Output: A single unified image containing all 25 storyboard panels with visible panel borders and numbers.`;

      try {
        const dataUrls = await generateVertexGeminiImages({
          internalModelId: model,
          prompt: gridPrompt,
          count: 1,
          aspectRatio: "1:1",
          // Pass resolved base64 data-URLs — guaranteed to be readable by the SDK
          referenceImageUrls: resolvedRefs.map((r) => r.dataUrl),
        });

        if (!dataUrls || !dataUrls.length) {
          return failure(502, "GENERATION_EMPTY", "Gemini returned no images");
        }

        // Persist the data: URL as a local upload so the frontend can load it
        const dataUrl = dataUrls[0];
        let imageUrl = dataUrl;

        if (/^data:/i.test(dataUrl)) {
          const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
          if (m) {
            const buf = Buffer.from(m[2], "base64");
            const ext = m[1].includes("png") ? ".png" : ".jpg";
            const upload = await createUploadFromBuffer({
              buffer: buf,
              kind: "storyboard-grid25",
              originalName: `grid25_${Date.now()}${ext}`,
              contentType: m[1],
            });
            // Build absolute public URL — getPublicUploadUrl(req, urlPath)
            imageUrl = getPublicUploadUrl(req, upload.urlPath);
          }
        }

        const referenceImageUrls = rawRefList.map((item) => item.url).filter(Boolean);
        const completedTask = store.recordCompletedImageTask({
          type: "storyboard_grid25_generate",
          domain: "toolbox",
          actorId,
          inputSummary: plotText.slice(0, 80) || "Storyboard 25-grid image",
          outputSummary: "storyboard 25-grid image completed",
          metadata: {
            prompt: plotText,
            model,
            referenceImageUrls,
            sourceModule: "toolbox_storyboard_grid25",
            imageUrl,
          },
        });
        store.recordCreateStudioImage({
          actorId,
          taskId: completedTask.id,
          sourceModule: "toolbox_storyboard_grid25",
          sourceTaskType: "storyboard_grid25_generate",
          prompt: plotText,
          model,
          style: "storyboard_grid25",
          aspectRatio: "1:1",
          resolution: "1K",
          referenceImageUrls,
          imageUrl,
        });

        return ok({ imageUrl, model, taskId: completedTask.id });
      } catch (err) {
        const status = err?.statusCode || 502;
        const code = err?.code || "GENERATION_ERROR";
        console.error("[storyboard-grid25] generation failed:", err?.message || err);
        return failure(status, code, err?.message || "Storyboard generation failed");
      }
    }),

    route("POST", "/api/toolbox/translate-text", async ({ req }) => {
      const body = await readJsonBody(req);
      const text = String(body?.text || "").trim();
      const targetLang = String(body?.targetLang || "en").trim();

      if (!text) return failure(400, "BAD_REQUEST", "text is required");
      if (!["en", "zh"].includes(targetLang)) {
        return failure(400, "BAD_REQUEST", "targetLang must be 'en' or 'zh'");
      }
      if (!hasAliyunApiKey()) {
        return failure(503, "PROVIDER_NOT_CONFIGURED", "DASHSCOPE_API_KEY is not configured");
      }
      try {
        const translated = await translateTextWithAliyun({ text, targetLang });
        return ok({ text: translated, targetLang });
      } catch (error) {
        const status = error?.statusCode || 502;
        const code = error?.code || "TRANSLATE_ERROR";
        return failure(status, code, error?.message || "Translation failed");
      }
    }),
  ];
}

function buildAdminRoutes(store) {
  return [
    route("GET", "/api/admin/pricing-rules", ({ req, url }) =>
      ok({ items: store.listPricingRules(getActorId(req, url)) })
    ),
    route("GET", "/api/admin/orders", ({ req, url }) =>
      ok({ items: store.listAdminOrders(getActorId(req, url)) })
    ),
    route("GET", "/api/admin/credit-usage-subjects", ({ req, url }) =>
      ok({ items: store.searchCreditUsageSubjects(getActorId(req, url), url.searchParams.get("search") || "") })
    ),
    route("GET", "/api/admin/credit-usage-stats", ({ req, url }) =>
      ok(
        store.getAdminCreditUsageStats(getActorId(req, url), {
          subjectType: url.searchParams.get("subjectType") || "platform",
          subjectId: url.searchParams.get("subjectId") || null,
        })
      )
    ),
    routeWithStatus("POST", "/api/admin/orders/:orderId/review", 200, async ({ params, req, url }) => {
      const body = await readJsonBody(req);
      const order = store.reviewWalletRechargeOrder(params.orderId, body, getActorId(req, url));
      if (!order) return failure(404, "NOT_FOUND", "recharge order not found");
      return ok(order);
    }),
    route("GET", "/api/organizations/:id/members", ({ params, req, url }) =>
      ok({ items: store.listOrganizationMembers(params.id, getActorId(req, url)) })
    ),
    routeWithStatus("POST", "/api/organizations/:id/members", 201, async ({ params, req, url }) => {
      const body = await readJsonBody(req);
      return ok(store.createOrganizationMember(params.id, body, getActorId(req, url)));
    }),
    route("GET", "/api/organizations/:id/wallet", ({ params, req, url }) =>
      ok(store.getOrganizationWallet(params.id, getActorId(req, url)))
    ),
    route("GET", "/api/enterprise-applications", ({ req, url }) =>
      ok({ items: store.listEnterpriseApplications(getActorId(req, url)) })
    ),
    routeWithStatus("POST", "/api/enterprise-applications", 201, async ({ req }) => {
      const body = await readJsonBody(req);
      if (!body.companyName || !body.contactName || !body.contactPhone) {
        return failure(400, "BAD_REQUEST", "companyName, contactName and contactPhone are required");
      }
      return ok(store.createEnterpriseApplication(body));
    })
  ];
}

function summarizeAgentCanvas(canvas, options = {}) {
  const includeFiles = options.includeFiles === true;
  const nodes = Array.isArray(canvas?.nodes) ? canvas.nodes : [];
  const groups = Array.isArray(canvas?.groups) ? canvas.groups : [];
  return {
    title: typeof canvas?.title === "string" ? canvas.title.slice(0, 160) : "",
    selectedNodeIds: Array.isArray(canvas?.selectedNodeIds) ? canvas.selectedNodeIds.slice(0, 40) : [],
    viewport: canvas?.viewport && typeof canvas.viewport === "object" ? canvas.viewport : undefined,
    nodes: nodes.slice(0, 80).map((node) => ({
      id: String(node?.id || ""),
      type: String(node?.type || ""),
      title: String(node?.title || "").slice(0, 80),
      prompt: String(node?.prompt || "").slice(0, 500),
      x: Number(node?.x) || 0,
      y: Number(node?.y) || 0,
      parentIds: Array.isArray(node?.parentIds) ? node.parentIds.slice(0, 20) : [],
      status: String(node?.status || ""),
      hasResultUrl: Boolean(node?.resultUrl),
      ...(includeFiles
        ? {
            resultUrl: String(node?.resultUrl || ""),
            inputUrl: String(node?.inputUrl || ""),
            lastFrame: String(node?.lastFrame || ""),
            model: String(node?.model || node?.imageModel || node?.videoModel || ""),
            aspectRatio: String(node?.aspectRatio || ""),
            resolution: String(node?.resolution || ""),
          }
        : {}),
    })),
    groups: groups.slice(0, 40).map((group) => ({
      id: String(group?.id || ""),
      label: String(group?.label || "").slice(0, 80),
      nodeIds: Array.isArray(group?.nodeIds) ? group.nodeIds.slice(0, 40) : [],
    })),
    files: includeFiles
      ? nodes
          .filter((node) => node?.resultUrl || node?.inputUrl || node?.lastFrame || node?.editorBackgroundUrl)
          .slice(0, 80)
          .map((node) => ({
            nodeId: String(node?.id || ""),
            type: String(node?.type || ""),
            title: String(node?.title || "").slice(0, 120),
            prompt: String(node?.prompt || "").slice(0, 500),
            resultUrl: String(node?.resultUrl || ""),
            inputUrl: String(node?.inputUrl || ""),
            lastFrame: String(node?.lastFrame || ""),
            backgroundUrl: String(node?.editorBackgroundUrl || ""),
            model: String(node?.model || node?.imageModel || node?.videoModel || ""),
            status: String(node?.status || ""),
          }))
      : undefined,
  };
}

function extractAgentJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || raw;
  try {
    return JSON.parse(candidate);
  } catch {}

  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch {}
  }

  return null;
}

function getAgentCanvasTextModel(store) {
  const fallback = process.env.AGENT_CANVAS_TEXT_MODEL || DEFAULT_AGENT_CANVAS_TEXT_MODEL;
  const defaultTextModel =
    typeof store?.getDefaultModelId === "function"
      ? store.getDefaultModelId("textModelId", fallback)
      : fallback;
  return typeof store?.getNodePrimaryModel === "function"
    ? store.getNodePrimaryModel("script", defaultTextModel)
    : defaultTextModel;
}

function extractOpenAiCompletionText(payload) {
  return String(payload?.choices?.[0]?.message?.content || payload?.output_text || "").trim();
}

function compactAgentProviderError(error) {
  const raw = String(error?.message || error || "provider request failed");
  return raw.replace(/\s+/g, " ").slice(0, 240);
}

function getAgentCanvasModelPlan(requestedModel, fallbackTextModel) {
  const normalized = String(requestedModel || "auto").trim() || "auto";
  const textModel = String(fallbackTextModel || DEFAULT_AGENT_CANVAS_TEXT_MODEL).trim();
  if (normalized === "auto" || normalized === "__auto__") {
    return [
      { provider: "vertex", model: DEFAULT_AGENT_CANVAS_GEMINI_MODEL },
      { provider: "dashscope", model: textModel },
    ];
  }
  if (normalized.startsWith("vertex:")) {
    return [
      { provider: "vertex", model: normalized },
      { provider: "dashscope", model: textModel, fallbackOnly: true },
    ];
  }
  return [{ provider: "dashscope", model: normalized || textModel }];
}

async function requestAgentCanvasCompletion(messages, options = {}) {
  const requestedModel = String(options.model || process.env.AGENT_CANVAS_MODEL || "auto").trim();
  const textModel = String(options.textModel || process.env.AGENT_CANVAS_TEXT_MODEL || DEFAULT_AGENT_CANVAS_TEXT_MODEL).trim();
  const plan = getAgentCanvasModelPlan(requestedModel, textModel);
  const errors = [];

  for (const candidate of plan) {
    if (candidate.provider === "vertex") {
      if (!hasVertexCredentials()) {
        errors.push(`Gemini 3 is not configured for ${candidate.model}. Set VERTEX_API_KEY in core-api/.env.local.`);
        continue;
      }
      try {
        const completion = await generateVertexGeminiChat({
          internalModelId: candidate.model,
          messages,
          stream: false,
          temperature: 0.2,
          max_tokens: 4096,
          useGoogleSearch: options.useWebSearch === true,
        });
        const text = extractOpenAiCompletionText(completion);
        if (text) {
          return {
            text,
            provider: "vertex",
            model: candidate.model,
            groundingSources: completion.groundingSources,
          };
        }
        errors.push(`Gemini 3 returned empty text from ${candidate.model}.`);
      } catch (error) {
        errors.push(`Gemini 3 ${candidate.model}: ${compactAgentProviderError(error)}`);
      }
      continue;
    }

    if (candidate.provider === "dashscope") {
      if (!hasAliyunApiKey()) {
        errors.push(`Text model is not configured for ${candidate.model}. Set DASHSCOPE_API_KEY in core-api/.env.local.`);
        continue;
      }
      try {
        const text = await generateTextWithAliyun({
          messages,
          model: candidate.model || DEFAULT_AGENT_CANVAS_TEXT_MODEL,
          temperature: 0.2,
          max_tokens: 4096,
        });
        if (text) {
          const firstVertex = plan.find((item) => item.provider === "vertex")?.model;
          return {
            text,
            provider: "dashscope",
            model: candidate.model || DEFAULT_AGENT_CANVAS_TEXT_MODEL,
            fallbackFrom: candidate.fallbackOnly ? firstVertex : undefined,
          };
        }
        errors.push(`Text model returned empty text from ${candidate.model || DEFAULT_AGENT_CANVAS_TEXT_MODEL}.`);
      } catch (error) {
        errors.push(`Text model ${candidate.model || DEFAULT_AGENT_CANVAS_TEXT_MODEL}: ${compactAgentProviderError(error)}`);
      }
    }
  }

  const error = new Error(
    `智能画布模型暂不可用：${errors.join(" ")}`
  );
  error.statusCode = 503;
  error.code = "AGENT_MODEL_NOT_CONFIGURED";
  throw error;
}

function normalizeAgentCanvasTools(tools) {
  const source = tools && typeof tools === "object" ? tools : {};
  return {
    webSearch: source.webSearch === true || source.networkSearch === true,
    canvasFiles: source.canvasFiles !== false && source.includeCanvasFiles !== false,
  };
}

async function buildAgentCanvasWebSearchContext(message) {
  if (!hasVertexCredentials()) {
    throw Object.assign(new Error("Gemini 3 web search is not configured. Set VERTEX_API_KEY in core-api/.env.local."), {
      code: "WEB_SEARCH_NOT_CONFIGURED",
      statusCode: 503,
    });
  }

  const completion = await generateVertexGeminiChat({
    internalModelId: DEFAULT_AGENT_CANVAS_GEMINI_MODEL,
    useGoogleSearch: true,
    temperature: 0.1,
    max_tokens: 1200,
    messages: [
      {
        role: "system",
        content: [
          "Use Google Search to gather current, relevant facts for a creative canvas planning agent.",
          "Return a concise research brief with factual points and source titles/URLs when available.",
          "Do not produce canvas actions.",
        ].join(" "),
      },
      { role: "user", content: String(message || "").slice(0, 2000) },
    ],
  });

  return {
    provider: "vertex",
    model: DEFAULT_AGENT_CANVAS_GEMINI_MODEL,
    summary: extractOpenAiCompletionText(completion),
    sources: Array.isArray(completion.groundingSources) ? completion.groundingSources : [],
  };
}

function buildAgentCanvasRoutes(store) {
  return [
    route("POST", "/api/agent-canvas/chat", async ({ req, url }) => {
      const actorId = getActorId(req, url);
      if (!actorId) return failure(401, "UNAUTHORIZED", "Login required");
      store.assertSuperAdmin(actorId);

      const body = await readJsonBody(req);
      const message = String(body?.message || "").trim();
      if (!message) return failure(400, "BAD_REQUEST", "message is required");

      const tools = normalizeAgentCanvasTools(body?.tools);
      const toolWarnings = [];
      const canvasSummary = summarizeAgentCanvas(body?.canvas, { includeFiles: tools.canvasFiles });
      const attachments = Array.isArray(body?.attachments) ? body.attachments.slice(0, 12) : [];
      let webSearch = null;
      if (tools.webSearch) {
        try {
          webSearch = await buildAgentCanvasWebSearchContext(message);
        } catch (error) {
          toolWarnings.push(error?.code || "WEB_SEARCH_UNAVAILABLE");
          console.warn("[agent-canvas] web search unavailable", error?.message || error);
        }
      }
      const systemPrompt = [
        "You are XiaoLou Agent Canvas planner, a Lovart/Jaaz-style deep canvas orchestration agent.",
        "Return ONLY JSON with this shape: {\"response\":\"short user-facing text\",\"actions\":[],\"warnings\":[]}.",
        "Default to Simplified Chinese for response, topic, action titles, prompts, and every user-facing text. Only use another language when the user explicitly asks for it.",
        "Read the current canvas graph, selected nodes, node positions, user message, and attachments before planning.",
        tools.canvasFiles
          ? "Canvas file inspection is enabled. Use canvas.files and node resultUrl/inputUrl/lastFrame metadata to understand existing media files."
          : "Canvas file inspection is disabled. Do not assume access to media file URLs beyond the basic graph summary.",
        webSearch
          ? "Web search is enabled. Use the provided webSearch brief as current research context, and mention source titles briefly in response when useful."
          : "Web search is disabled or unavailable. Do not claim live web facts unless provided by the user.",
        "You do not call external APIs directly. You only plan canvas actions for the XiaoLou frontend and existing XiaoLou APIs to validate and apply.",
        "Allowed action types: create_node, update_node, delete_nodes, connect_nodes, move_nodes, layout_nodes, group_nodes, generate_image, generate_video, save_canvas.",
        "Use existing node types only: Text, Image, Video, Audio, Image Editor, Video Editor, Storyboard Manager, Camera Angle, Local Image Model, Local Video Model.",
        "If the user gives a clear create/edit/delete/move/layout/connect/group/generate/save command, do not ask a clarifying question. Produce at least one action with reasonable defaults.",
        "For create_node use fields like {\"type\":\"create_node\",\"nodeType\":\"Text\",\"title\":\"...\",\"content\":\"...\",\"x\":0,\"y\":0}.",
        "For generate_image or generate_video, include a strong prompt and then layout/connect the resulting node when useful.",
        "When the user asks for visual creation, produce generate_image or generate_video actions with concrete prompts, referenceNodeIds when relevant, and follow-up layout/connect actions.",
        "When the user asks to organize, compare, storyboard, or iterate, produce multiple ordered actions that create/update/connect/group/layout nodes.",
        "For generation actions, include nodeId when targeting an existing node, or include prompt/title/x/y to let the frontend create a node.",
      ].join("\n");

      let completion;
      try {
        completion = await requestAgentCanvasCompletion(
          [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content: JSON.stringify({
                message,
                sessionId: body?.sessionId || null,
                canvas: canvasSummary,
                attachments,
                webSearch,
                tools,
              }),
            },
          ],
          {
            model: body?.model,
            textModel: getAgentCanvasTextModel(store),
            useWebSearch: false,
          }
        );
      } catch (error) {
        return failure(
          error?.statusCode || 503,
          error?.code || "AGENT_MODEL_ERROR",
          error?.message || "智能体画布模型调用失败"
        );
      }

      const modelText = completion.text;
      const parsed = extractAgentJson(modelText);
      if (!parsed || typeof parsed !== "object") {
        return ok({
          sessionId: body?.sessionId || null,
          response: modelText || "我暂时无法生成结构化画布操作。",
          actions: [],
          warnings: ["MODEL_RETURNED_UNSTRUCTURED_TEXT", ...toolWarnings],
          provider: completion.provider,
          model: completion.model,
          fallbackFrom: completion.fallbackFrom,
          groundingSources: completion.groundingSources || webSearch?.sources,
          tools,
        });
      }

      return ok({
        sessionId: body?.sessionId || null,
        response: String(parsed.response || "完成。"),
        actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 50) : [],
        warnings: [
          ...(Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 20) : []),
          ...toolWarnings,
        ].slice(0, 30),
        topic: typeof parsed.topic === "string" ? parsed.topic.slice(0, 80) : undefined,
        provider: completion.provider,
        model: completion.model,
        fallbackFrom: completion.fallbackFrom,
        groundingSources: completion.groundingSources || webSearch?.sources,
        tools,
      });
    }),
  ];
}

function getPlaygroundDefaultModel(store) {
  return typeof store?.getDefaultModelId === "function"
    ? store.getDefaultModelId("textModelId", DEFAULT_AGENT_CANVAS_TEXT_MODEL)
    : DEFAULT_AGENT_CANVAS_TEXT_MODEL;
}

async function requestPlaygroundCompletion(messages, options = {}) {
  const model = String(options.model || DEFAULT_AGENT_CANVAS_TEXT_MODEL).trim() || DEFAULT_AGENT_CANVAS_TEXT_MODEL;

  if (model.startsWith("vertex:")) {
    if (!hasVertexCredentials()) {
      const error = new Error("Vertex Gemini is not configured.");
      error.statusCode = 503;
      error.code = "PROVIDER_NOT_CONFIGURED";
      throw error;
    }
    const completion = await generateVertexGeminiChat({
      internalModelId: model,
      messages,
      stream: false,
      temperature: options.temperature ?? 0.4,
      max_tokens: options.max_tokens ?? 4096,
    });
    const text = extractOpenAiCompletionText(completion);
    if (!text) {
      const error = new Error("Model returned empty text.");
      error.statusCode = 502;
      error.code = "EMPTY_MODEL_RESPONSE";
      throw error;
    }
    return { text, provider: "vertex", model };
  }

  if (!hasAliyunApiKey()) {
    const error = new Error("DashScope text model is not configured.");
    error.statusCode = 503;
    error.code = "PROVIDER_NOT_CONFIGURED";
    throw error;
  }

  const text = await generateTextWithAliyun({
    messages,
    model,
    temperature: options.temperature ?? 0.4,
    max_tokens: options.max_tokens ?? 4096,
  });
  if (!text) {
    const error = new Error("Model returned empty text.");
    error.statusCode = 502;
    error.code = "EMPTY_MODEL_RESPONSE";
    throw error;
  }
  return { text, provider: "dashscope", model };
}

function buildPlaygroundChatMessages(store, actorId, conversationId) {
  const preference = store.getPlaygroundMemoryPreference(actorId);
  const memories = preference.enabled
    ? store
        .listPlaygroundMemories(actorId)
        .filter((item) => item.enabled !== false)
        .slice(0, 24)
    : [];
  const memoryBlock = memories.length
    ? memories.map((item) => `- ${item.key}: ${item.value}`).join("\n")
    : "No saved memory yet.";
  const history = store
    .listPlaygroundMessages(actorId, conversationId)
    .filter((item) => {
      if (item.role === "user") return true;
      if (item.role !== "assistant") return false;
      if (["queued", "running", "pending", "error"].includes(String(item.status || ""))) return false;
      return Boolean(String(item.content || "").trim());
    })
    .slice(-18)
    .map((item) => ({
      role: item.role,
      content: String(item.content || "").slice(0, 12000),
    }));

  return [
    {
      role: "system",
      content: [
        "You are XiaoLou Playground, a helpful Chinese-first creative AI assistant.",
        "Reply in the same language as the user's latest message. If the user writes Chinese, reply in Chinese.",
        "Use the saved memory only when it is relevant. Do not reveal internal memory rules.",
        "Be practical, concise, and useful for creative production work.",
        "Saved memory:",
        memoryBlock,
      ].join("\n"),
    },
    ...history,
  ];
}

function parsePlaygroundMemoryJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() || raw;
  const candidates = [candidate];
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(candidate.slice(start, end + 1));
  for (const item of candidates) {
    try {
      const parsed = JSON.parse(item);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed?.memories)) return parsed.memories;
    } catch {}
  }
  return [];
}

async function extractPlaygroundMemories(store, actorId, conversationId, userMessage, assistantMessage, sourceMessageId, model) {
  const preference = store.getPlaygroundMemoryPreference(actorId);
  if (preference.enabled === false) return [];

  const existing = store
    .listPlaygroundMemories(actorId)
    .filter((item) => item.enabled !== false)
    .slice(0, 40)
    .map((item) => ({ key: item.key, value: item.value }));
  const memoryModel = getPlaygroundDefaultModel(store) || model || DEFAULT_AGENT_CANVAS_TEXT_MODEL;
  const prompt = [
    "Extract durable user memories from the latest exchange.",
    "Return ONLY JSON: {\"memories\":[{\"key\":\"short-key\",\"value\":\"clear memory in Chinese if appropriate\",\"confidence\":0.0-1.0}]}",
    "Only save stable preferences, long-term user facts, project preferences, recurring style choices, or durable workflow needs.",
    "Do not save passwords, API keys, payment info, one-time requests, private identifiers, or transient task details.",
    "If there is nothing durable to remember, return {\"memories\":[]}.",
    `Existing memories: ${JSON.stringify(existing).slice(0, 6000)}`,
    `User: ${String(userMessage || "").slice(0, 5000)}`,
    `Assistant: ${String(assistantMessage || "").slice(0, 5000)}`,
  ].join("\n");

  try {
    const completion = await requestPlaygroundCompletion(
      [
        { role: "system", content: "You are a strict JSON memory extraction engine." },
        { role: "user", content: prompt },
      ],
      { model: memoryModel, temperature: 0.1, max_tokens: 1200 },
    );
    const memories = parsePlaygroundMemoryJson(completion.text);
    return store.upsertPlaygroundMemories(actorId, memories, {
      conversationId,
      messageId: sourceMessageId,
    });
  } catch (error) {
    console.warn("[playground] memory extraction skipped", error?.message || error);
    return [];
  }
}

function writePlaygroundEvent(res, eventName, data) {
  if (res.writableEnded || res.destroyed) return;
  sendEvent(res, eventName, data);
}

function writePlaygroundStreamHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
}

function splitPlaygroundDeltas(text) {
  const chars = Array.from(String(text || ""));
  const chunks = [];
  for (let index = 0; index < chars.length; index += 18) {
    chunks.push(chars.slice(index, index + 18).join(""));
  }
  return chunks.length ? chunks : [""];
}

const PLAYGROUND_CHAT_TERMINAL_JOB_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const playgroundChatJobRunners = new Map();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPlaygroundChatJobActive(job) {
  return job && !PLAYGROUND_CHAT_TERMINAL_JOB_STATUSES.has(String(job.status || ""));
}

function createPlaygroundChatJob(store, actorId, body = {}) {
  const userText = String(body?.message || "").trim();
  if (!userText) {
    const error = new Error("message is required");
    error.statusCode = 400;
    error.code = "BAD_REQUEST";
    throw error;
  }

  let conversation = body?.conversationId
    ? store.getPlaygroundConversation(actorId, String(body.conversationId))
    : null;
  if (!conversation) {
    conversation = store.createPlaygroundConversation(actorId, {
      firstMessage: userText,
      model: body?.model,
    });
  } else if (body?.model && body.model !== conversation.model) {
    conversation = store.updatePlaygroundConversation(actorId, conversation.id, { model: body.model });
  }

  const existingActiveJob = store.listPlaygroundChatJobs(actorId, {
    conversationId: conversation.id,
    activeOnly: true,
    limit: 1,
  })[0];
  if (existingActiveJob) {
    const error = new Error("This Playground conversation already has a running chat job.");
    error.statusCode = 409;
    error.code = "CHAT_JOB_IN_PROGRESS";
    throw error;
  }

  const model = String(body?.model || conversation.model || getPlaygroundDefaultModel(store)).trim();
  const userMessage = store.appendPlaygroundMessage(actorId, conversation.id, {
    role: "user",
    content: userText,
    model,
  });
  const assistantMessage = store.appendPlaygroundMessage(actorId, conversation.id, {
    role: "assistant",
    content: "",
    model,
    status: "queued",
    metadata: { provider: null },
  });
  const job = store.createPlaygroundChatJob(actorId, {
    conversationId: conversation.id,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
    model,
    request: {
      message: userText,
      model,
      temperature: body?.temperature ?? 0.45,
      max_tokens: body?.max_tokens ?? 4096,
    },
  });
  const queuedAssistantMessage = store.replacePlaygroundMessage(
    actorId,
    conversation.id,
    assistantMessage.id,
    {
      status: "queued",
      metadata: { jobId: job.id, jobStatus: "queued" },
    },
  ) || assistantMessage;

  startPlaygroundChatJob(store, actorId, job.id);

  return {
    job,
    conversation: store.getPlaygroundConversation(actorId, conversation.id),
    userMessage,
    assistantMessage: queuedAssistantMessage,
  };
}

function startPlaygroundChatJob(store, actorId, jobId) {
  const runnerKey = `${actorId}:${jobId}`;
  if (playgroundChatJobRunners.has(runnerKey)) return;

  const runner = (async () => {
    await wait(0);
    try {
      await runPlaygroundChatJob(store, actorId, jobId);
    } catch (error) {
      console.error("[playground] chat job runner failed", {
        actorId,
        jobId,
        error: error?.message || error,
      });
    } finally {
      playgroundChatJobRunners.delete(runnerKey);
    }
  })();
  playgroundChatJobRunners.set(runnerKey, runner);
}

async function runPlaygroundChatJob(store, actorId, jobId) {
  let job = store.getPlaygroundChatJob(actorId, jobId);
  if (!isPlaygroundChatJobActive(job)) return;

  store.updatePlaygroundChatJob(actorId, jobId, { status: "running", progress: 10 });
  if (job.assistantMessageId) {
    store.replacePlaygroundMessage(actorId, job.conversationId, job.assistantMessageId, {
      status: "running",
      metadata: { jobId, jobStatus: "running" },
    });
  }

  job = store.getPlaygroundChatJob(actorId, jobId);
  const request = job.request || {};
  const model = String(request.model || job.model || getPlaygroundDefaultModel(store)).trim();
  const userText = String(request.message || "").trim();

  try {
    const completion = await requestPlaygroundCompletion(
      buildPlaygroundChatMessages(store, actorId, job.conversationId),
      {
        model,
        temperature: request.temperature ?? 0.45,
        max_tokens: request.max_tokens ?? 4096,
      },
    );
    store.updatePlaygroundChatJob(actorId, jobId, { progress: 82 });
    const assistantMessageId = job.assistantMessageId;
    const finalAssistant = assistantMessageId
      ? store.replacePlaygroundMessage(actorId, job.conversationId, assistantMessageId, {
          content: completion.text,
          status: "complete",
          metadata: { jobId, jobStatus: "succeeded", provider: completion.provider, model: completion.model },
        })
      : store.appendPlaygroundMessage(actorId, job.conversationId, {
          role: "assistant",
          content: completion.text,
          model: completion.model,
          status: "complete",
          metadata: { jobId, jobStatus: "succeeded", provider: completion.provider, model: completion.model },
        });

    const changedMemories = await extractPlaygroundMemories(
      store,
      actorId,
      job.conversationId,
      userText,
      completion.text,
      finalAssistant?.id || assistantMessageId,
      completion.model,
    );

    store.updatePlaygroundChatJob(actorId, jobId, {
      status: "succeeded",
      progress: 100,
      result: {
        messageId: finalAssistant?.id || assistantMessageId,
        conversationId: job.conversationId,
        memoryCount: changedMemories.length,
        memories: changedMemories,
      },
    });
  } catch (error) {
    const message = error?.message || "Playground model request failed.";
    if (job.assistantMessageId) {
      store.replacePlaygroundMessage(actorId, job.conversationId, job.assistantMessageId, {
        content: message,
        status: "error",
        metadata: { jobId, jobStatus: "failed", code: error?.code || "MODEL_ERROR" },
      });
    } else {
      store.appendPlaygroundMessage(actorId, job.conversationId, {
        role: "assistant",
        content: message,
        model,
        status: "error",
        metadata: { jobId, jobStatus: "failed", code: error?.code || "MODEL_ERROR" },
      });
    }
    store.updatePlaygroundChatJob(actorId, jobId, {
      status: "failed",
      progress: 100,
      error: { code: error?.code || "MODEL_ERROR", message },
    });
  }
}

async function streamPlaygroundJob(store, actorId, jobId, req, res) {
  let closed = false;
  res.on("close", () => {
    closed = true;
  });

  let lastStatus = "";
  let lastProgress = -1;
  while (!closed) {
    let job;
    try {
      job = store.getPlaygroundChatJob(actorId, jobId);
    } catch (error) {
      writePlaygroundEvent(res, "error", {
        code: error?.code || "NOT_FOUND",
        message: error?.message || "Playground chat job not found.",
      });
      break;
    }

    if (job.status !== lastStatus || job.progress !== lastProgress) {
      writePlaygroundEvent(res, "job", { job });
      lastStatus = job.status;
      lastProgress = job.progress;
    }

    if (PLAYGROUND_CHAT_TERMINAL_JOB_STATUSES.has(job.status)) {
      if (job.status === "succeeded") {
        const resultMessageId = job.result?.messageId || job.assistantMessageId;
        const finalMessage = store
          .listPlaygroundMessages(actorId, job.conversationId)
          .find((item) => item.id === resultMessageId);
        writePlaygroundEvent(res, "done", {
          conversation: store.getPlaygroundConversation(actorId, job.conversationId),
          message: finalMessage || null,
          memories: Array.isArray(job.result?.memories) ? job.result.memories : [],
          job,
        });
      } else {
        writePlaygroundEvent(res, "error", {
          code: job.error?.code || "MODEL_ERROR",
          message: job.error?.message || "Playground model request failed.",
          job,
        });
      }
      break;
    }

    await wait(750);
  }

  if (!res.writableEnded) {
    res.end();
  }
}

function buildPlaygroundRoutes(store) {
  return [
    route("GET", "/api/playground/config", ({ req, url }) =>
      ok({
        defaultModel: getPlaygroundDefaultModel(store),
        memory: store.getPlaygroundMemoryPreference(getActorId(req, url) || "guest"),
      })
    ),
    route("GET", "/api/playground/models", () =>
      ok({
        defaultModel: getPlaygroundDefaultModel(store),
        items: store.listPlaygroundModels(),
      })
    ),
    route("GET", "/api/playground/conversations", ({ req, url }) => {
      const actorId = getActorId(req, url) || "guest";
      return ok({
        items: store.listPlaygroundConversations(actorId, {
          search: url.searchParams.get("search"),
          limit: url.searchParams.get("limit"),
        }),
      });
    }),
    routeWithStatus("POST", "/api/playground/conversations", 201, async ({ req, url }) => {
      const actorId = getActorId(req, url) || "guest";
      const body = await readJsonBody(req);
      return ok(store.createPlaygroundConversation(actorId, body || {}));
    }),
    route("GET", "/api/playground/conversations/:conversationId", ({ params, req, url }) => {
      const actorId = getActorId(req, url) || "guest";
      return ok(store.getPlaygroundConversation(actorId, params.conversationId));
    }),
    route("PATCH", "/api/playground/conversations/:conversationId", async ({ params, req, url }) => {
      const actorId = getActorId(req, url) || "guest";
      const body = await readJsonBody(req);
      return ok(store.updatePlaygroundConversation(actorId, params.conversationId, body || {}));
    }),
    route("DELETE", "/api/playground/conversations/:conversationId", ({ params, req, url }) => {
      const actorId = getActorId(req, url) || "guest";
      const removed = store.deletePlaygroundConversation(actorId, params.conversationId);
      if (!removed) return failure(404, "NOT_FOUND", "Playground conversation not found");
      return ok({ deleted: true, conversationId: params.conversationId });
    }),
    route("GET", "/api/playground/conversations/:conversationId/messages", ({ params, req, url }) => {
      const actorId = getActorId(req, url) || "guest";
      return ok({ items: store.listPlaygroundMessages(actorId, params.conversationId) });
    }),
    route("GET", "/api/playground/memories", ({ req, url }) => {
      const actorId = getActorId(req, url) || "guest";
      return ok({
        preference: store.getPlaygroundMemoryPreference(actorId),
        items: store.listPlaygroundMemories(actorId),
      });
    }),
    route("PATCH", "/api/playground/memories/preferences", async ({ req, url }) => {
      const actorId = getActorId(req, url) || "guest";
      const body = await readJsonBody(req);
      return ok(store.setPlaygroundMemoryPreference(actorId, body || {}));
    }),
    route("PATCH", "/api/playground/memories/:key", async ({ params, req, url }) => {
      const actorId = getActorId(req, url) || "guest";
      const body = await readJsonBody(req);
      return ok(store.updatePlaygroundMemory(actorId, params.key, body || {}));
    }),
    route("DELETE", "/api/playground/memories/:key", ({ params, req, url }) => {
      const actorId = getActorId(req, url) || "guest";
      const removed = store.deletePlaygroundMemory(actorId, params.key);
      if (!removed) return failure(404, "NOT_FOUND", "Playground memory not found");
      return ok({ deleted: true, key: params.key });
    }),
    route("GET", "/api/playground/chat-jobs", ({ req, url }) => {
      const actorId = getActorId(req, url) || "guest";
      return ok({
        items: store.listPlaygroundChatJobs(actorId, {
          conversationId: url.searchParams.get("conversationId"),
          status: url.searchParams.get("status"),
          activeOnly: url.searchParams.get("activeOnly"),
          limit: url.searchParams.get("limit"),
        }),
      });
    }),
    routeWithStatus("POST", "/api/playground/chat-jobs", 202, async ({ req, url }) => {
      const actorId = getActorId(req, url) || "guest";
      const body = await readJsonBody(req);
      return ok(createPlaygroundChatJob(store, actorId, body || {}));
    }),
    route("GET", "/api/playground/chat-jobs/:jobId", ({ params, req, url }) => {
      const actorId = getActorId(req, url) || "guest";
      return ok({ job: store.getPlaygroundChatJob(actorId, params.jobId) });
    }),
    route("POST", "/api/playground/chat", async ({ req, res, url }) => {
      const actorId = getActorId(req, url) || "guest";
      const body = await readJsonBody(req);
      const created = createPlaygroundChatJob(store, actorId, body || {});

      writePlaygroundStreamHeaders(res);
      writePlaygroundEvent(res, "conversation", { conversation: created.conversation });
      writePlaygroundEvent(res, "user_message", { message: created.userMessage });
      writePlaygroundEvent(res, "assistant_message", { message: created.assistantMessage });
      writePlaygroundEvent(res, "job", { job: created.job });

      await streamPlaygroundJob(store, actorId, created.job.id, req, res);
      return undefined;
    }),
  ];
}

function buildChatRoutes() {
  return [
    route("POST", "/api/chat/completions", async ({ req, res }) => {
      const apiKey = process.env.VOLCENGINE_ARK_API_KEY;
      if (!apiKey) {
        return failure(
          500,
          "CHAT_NOT_CONFIGURED",
          "VOLCENGINE_ARK_API_KEY is not configured. Add it to core-api/.env.local"
        );
      }

      const body = await readJsonBody(req);
      const messages = body.messages || [];
      if (!messages.length) {
        return failure(400, "BAD_REQUEST", "messages array is required");
      }

      const model = body.model || DEFAULT_CHAT_MODEL;
      const stream = body.stream !== false;

      const arkBody = JSON.stringify({
        model,
        messages,
        stream,
        temperature: body.temperature ?? 0.7,
        max_tokens: body.max_tokens ?? 4096,
      });

      const arkRes = await fetch(`${ARK_BASE}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: arkBody,
      });

      if (!arkRes.ok) {
        let errMsg = `Volcengine Ark returned ${arkRes.status}`;
        try {
          const errBody = await arkRes.text();
          errMsg += `: ${errBody}`;
        } catch {}
        return failure(arkRes.status >= 500 ? 502 : arkRes.status, "ARK_ERROR", errMsg);
      }

      if (!stream) {
        const data = await arkRes.json();
        return data;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });

      const reader = arkRes.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          res.write(chunk);
        }
      } catch {
        /* connection closed */
      } finally {
        res.end();
      }
    }),

    route("GET", "/api/chat/models", () => {
      return ok({
        models: [
          {
            id: DEFAULT_CHAT_MODEL,
            name: "Doubao Seed 2.0 Mini",
            provider: "volcengine",
            contextLength: 256000,
          },
        ],
      });
    }),
  ];
}

function buildCanvasProjectRoutes(store) {
  return [
    route("GET", "/api/canvas-projects", ({ req, url }) => {
      const actorId = getActorId(req, url);
      if (!actorId) return failure(401, "UNAUTHORIZED", "Login required");
      return ok({ items: store.listCanvasProjectSummaries(actorId) });
    }),

    route("GET", "/api/canvas-projects/:projectId", ({ params, req, url }) => {
      const actorId = getActorId(req, url);
      if (!actorId) return failure(401, "UNAUTHORIZED", "Login required");
      const project = store.getCanvasProject(actorId, params.projectId);
      if (!project) return failure(404, "NOT_FOUND", "Canvas project not found");
      return ok(project);
    }),

    routeWithStatus("POST", "/api/canvas-projects", 201, async ({ req, url }) => {
      const actorId = getActorId(req, url);
      if (!actorId) return failure(401, "UNAUTHORIZED", "Login required");
      const body = await readJsonBody(req);
      const project = store.saveCanvasProject(actorId, body || {});
      return ok(project);
    }),

    route("PUT", "/api/canvas-projects/:projectId", async ({ params, req, url }) => {
      const actorId = getActorId(req, url);
      if (!actorId) return failure(401, "UNAUTHORIZED", "Login required");
      const body = await readJsonBody(req);
      const project = store.saveCanvasProject(actorId, { ...(body || {}), id: params.projectId });
      return ok(project);
    }),

    routeWithStatus("DELETE", "/api/canvas-projects/:projectId", 200, ({ params, req, url }) => {
      const actorId = getActorId(req, url);
      if (!actorId) return failure(401, "UNAUTHORIZED", "Login required");
      const removed = store.deleteCanvasProject(actorId, params.projectId);
      if (!removed) return failure(404, "NOT_FOUND", "Canvas project not found");
      return ok({ deleted: true, projectId: params.projectId });
    }),
  ];
}

module.exports = {
  buildRoutes
};
