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
const { filterVisibleVideoReplaceAssets } = require("./video-replace-native");
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
const DEFAULT_AGENT_CANVAS_TEXT_MODEL = "qwen3.6-plus";

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
    console.warn("[routes] actor mismatch on authenticated request, preferring Authorization actor", {
      tokenActorId,
      headerActorId,
      path: url?.pathname || "",
      loopback: isLocalLoopbackClientHint(req),
    });
    resolved = tokenActorId;
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
    ...buildAgentCanvasProjectRoutes(store),
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
      const actorId = getActorId(req, url);
      store.assertProjectAccess(params.projectId, actorId);
      const assetType = url.searchParams.get("assetType");
      return ok({
        items: filterVisibleVideoReplaceAssets(
          store.listAssets(params.projectId, assetType),
          actorId,
          params.projectId,
          store,
        ),
      });
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
      const actorId = getActorId(req, url);
      store.assertProjectAccess(params.projectId, actorId);
      const asset = store.getAsset(params.projectId, params.assetId);
      if (
        asset &&
        !filterVisibleVideoReplaceAssets([asset], actorId, params.projectId, store).length
      ) {
        return failure(404, "NOT_FOUND", "asset not found");
      }
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

function extractPartialAgentActions(text) {
  const raw = String(text || "");
  const actionsMatch = /"actions"\s*:\s*\[/i.exec(raw);
  if (!actionsMatch) return [];

  const arrayStart = raw.indexOf("[", actionsMatch.index);
  if (arrayStart < 0) return [];

  const actions = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = arrayStart + 1; index < raw.length; index += 1) {
    const char = raw[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start >= 0) {
        try {
          actions.push(JSON.parse(raw.slice(start, index + 1)));
        } catch {}
        start = -1;
      }
    }
  }

  return actions;
}

function getAgentActionTypeForServer(action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) return "";
  return String(action.type || action.action || action.kind || "").trim().toLowerCase();
}

function isStoryboardTextCreateAction(action) {
  if (!action || typeof action !== "object" || Array.isArray(action)) return false;
  if (getAgentActionTypeForServer(action) !== "create_node") return false;
  const nodeType = String(action.nodeType || action.typeName || action.kind || action.node?.type || action.data?.type || "").trim().toLowerCase();
  return !nodeType || nodeType === "text" || nodeType.includes("text") || nodeType.includes("文本");
}

function normalizeStoryboardBreakdownActions(actions) {
  if (!Array.isArray(actions)) return [];
  const stamp = Date.now().toString(36);
  const textActions = [];

  actions.forEach((action, index) => {
    if (!isStoryboardTextCreateAction(action)) return;
    const id = String(action.id || action.nodeId || action.targetNodeId || `storyboard-breakdown-${stamp}-${index + 1}`).trim();
    textActions.push({
      ...action,
      id,
      type: "create_node",
      nodeType: "Text",
      title: String(action.title || action.name || action.label || `剧本拆解 - 第 ${textActions.length + 1} 部分`).slice(0, 120),
      content: String(action.content || action.prompt || action.text || "").trim(),
      x: Number.isFinite(Number(action.x)) ? Number(action.x) : 800 + textActions.length * 360,
      y: Number.isFinite(Number(action.y)) ? Number(action.y) : 200,
    });
  });

  if (textActions.length === 0) return [];

  return [
    ...textActions,
    {
      type: "group_nodes",
      groupId: `storyboard-breakdown-group-${stamp}`,
      label: "剧本拆解",
      nodeIds: textActions.map((action) => action.id),
    },
  ];
}

function getAgentCanvasTextModel(store) {
  return process.env.AGENT_CANVAS_TEXT_MODEL || DEFAULT_AGENT_CANVAS_TEXT_MODEL;
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
  if (normalized && normalized !== textModel) {
    return [
      { provider: "dashscope", model: normalized },
      { provider: "dashscope", model: textModel, fallbackOnly: true },
    ];
  }
  return [{ provider: "dashscope", model: textModel }];
}

function normalizeAgentCanvasMaxTokens(value, fallback = 4096, max = 8000) {
  const parsed = Number(value);
  const base = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.max(1024, Math.min(max, Math.round(base)));
}

function createAgentCanvasAbortError() {
  const error = new Error("Agent canvas request aborted");
  error.name = "AbortError";
  error.code = "AGENT_REQUEST_ABORTED";
  error.statusCode = 499;
  return error;
}

function isAgentCanvasAbortError(error) {
  return (
    error?.name === "AbortError" ||
    error?.code === "ABORT_ERR" ||
    error?.code === "AGENT_REQUEST_ABORTED"
  );
}

function throwIfAgentCanvasAborted(signal) {
  if (signal?.aborted) {
    throw createAgentCanvasAbortError();
  }
}

function createAgentCanvasAbortScope(res) {
  const controller = new AbortController();
  let completed = false;
  const abort = () => {
    if (!completed && !controller.signal.aborted) controller.abort();
  };
  if (res?.on) res.on("close", abort);
  return {
    signal: controller.signal,
    finish() {
      completed = true;
      if (res?.off) res.off("close", abort);
    },
  };
}

async function requestAgentCanvasCompletion(messages, options = {}) {
  const signal = options.signal;
  throwIfAgentCanvasAborted(signal);
  const requestedModel = String(options.model || process.env.AGENT_CANVAS_MODEL || "auto").trim();
  const textModel = String(options.textModel || process.env.AGENT_CANVAS_TEXT_MODEL || DEFAULT_AGENT_CANVAS_TEXT_MODEL).trim();
  const maxTokens = normalizeAgentCanvasMaxTokens(options.maxTokens, 4096, options.maxTokenLimit || 8000);
  const plan = getAgentCanvasModelPlan(requestedModel, textModel);
  const errors = [];

  console.info("[agent-canvas] planner model plan", {
    requestedModel,
    textModel,
    plan: plan.map((item) => ({
      provider: item.provider,
      model: item.model,
      fallbackOnly: item.fallbackOnly === true,
    })),
  });

  for (const candidate of plan) {
    throwIfAgentCanvasAborted(signal);
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
          max_tokens: maxTokens,
          useGoogleSearch: options.useWebSearch === true,
        });
        throwIfAgentCanvasAborted(signal);
        const text = extractOpenAiCompletionText(completion);
        if (text) {
          console.info("[agent-canvas] planner model selected", {
            provider: "vertex",
            model: candidate.model,
          });
          return {
            text,
            provider: "vertex",
            model: candidate.model,
            groundingSources: completion.groundingSources,
          };
        }
        errors.push(`Gemini 3 returned empty text from ${candidate.model}.`);
      } catch (error) {
        if (isAgentCanvasAbortError(error) || signal?.aborted) throw createAgentCanvasAbortError();
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
          max_tokens: maxTokens,
          signal,
          onDelta: typeof options.onDelta === "function"
            ? (delta) => options.onDelta({
                ...delta,
                provider: "dashscope",
                model: candidate.model || DEFAULT_AGENT_CANVAS_TEXT_MODEL,
              })
            : undefined,
        });
        throwIfAgentCanvasAborted(signal);
        if (text) {
          const primaryModel = plan.find((item) => !item.fallbackOnly)?.model;
          console.info("[agent-canvas] planner model selected", {
            provider: "dashscope",
            model: candidate.model || DEFAULT_AGENT_CANVAS_TEXT_MODEL,
            fallbackFrom: candidate.fallbackOnly ? primaryModel : undefined,
          });
          return {
            text,
            provider: "dashscope",
            model: candidate.model || DEFAULT_AGENT_CANVAS_TEXT_MODEL,
            fallbackFrom: candidate.fallbackOnly ? primaryModel : undefined,
          };
        }
        errors.push(`Text model returned empty text from ${candidate.model || DEFAULT_AGENT_CANVAS_TEXT_MODEL}.`);
      } catch (error) {
        if (isAgentCanvasAbortError(error) || signal?.aborted) throw createAgentCanvasAbortError();
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

const AGENT_CANVAS_ACTION_LABELS = {
  create_node: "创建节点",
  update_node: "更新节点",
  delete_nodes: "删除节点",
  delete_node: "删除节点",
  connect_nodes: "连接节点",
  connect_node: "连接节点",
  move_nodes: "移动节点",
  move_node: "移动节点",
  layout_nodes: "整理布局",
  layout: "整理布局",
  group_nodes: "分组节点",
  group_node: "分组节点",
  generate_image: "生成图片",
  generate_video: "生成视频",
  save_canvas: "保存画布",
};

function agentCanvasHttpError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function writeAgentCanvasEvent(res, eventName, data) {
  if (res.writableEnded || res.destroyed) return;
  sendEvent(res, eventName, data);
}

function writeAgentCanvasStreamHeaders(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });
}

function emitAgentCanvasStatus(emit, phase, title, detail, status = "active") {
  if (typeof emit !== "function") return;
  emit("status", {
    phase,
    title,
    detail,
    status,
    timestamp: new Date().toISOString(),
  });
}

function emitAgentCanvasDelta(emit, kind, text, meta = {}) {
  if (typeof emit !== "function" || !text) return;
  const safeKind = kind === "reasoning" ? "reasoning" : "content";
  for (const chunk of Array.from(String(text))) {
    emit("delta", {
      kind: safeKind,
      text: chunk,
      provider: meta.provider,
      model: meta.model,
      timestamp: new Date().toISOString(),
    });
  }
}

function summarizeAgentCanvasActionTypes(actions) {
  if (!Array.isArray(actions) || actions.length === 0) return [];
  const counts = new Map();
  actions.forEach((action) => {
    const type = getAgentActionTypeForServer(action) || "unknown";
    counts.set(type, (counts.get(type) || 0) + 1);
  });
  return Array.from(counts.entries()).map(([type, count]) => ({
    type,
    label: AGENT_CANVAS_ACTION_LABELS[type] || type,
    count,
  }));
}

function formatAgentCanvasActionSummary(actions) {
  const summary = summarizeAgentCanvasActionTypes(actions);
  if (summary.length === 0) return "没有需要执行的画布动作";
  return summary.map((item) => `${item.label} x${item.count}`).join("、");
}

function getAgentCanvasRequestContextDetail(body, canvasSummary, attachments) {
  const parts = [
    `模型：${String(body?.modelLabel || body?.model || "Auto")}`,
    body?.skillTitle ? `Skill：${String(body.skillTitle)}` : null,
    `节点：${Array.isArray(canvasSummary?.nodes) ? canvasSummary.nodes.length : 0}`,
    `选中：${Array.isArray(canvasSummary?.selectedNodeIds) ? canvasSummary.selectedNodeIds.length : 0}`,
    `附件：${Array.isArray(attachments) ? attachments.length : 0}`,
  ].filter(Boolean);
  return parts.join(" · ");
}

function emitAgentCanvasParsedActions(emit, actions) {
  if (!Array.isArray(actions) || actions.length === 0) {
    emitAgentCanvasStatus(emit, "THINKING", "解析模型动作", "没有需要执行的画布动作", "done");
    return;
  }
  emitAgentCanvasStatus(emit, "THINKING", "解析模型动作", `收到 ${actions.length} 个画布动作`, "done");
  emitAgentCanvasStatus(emit, "USING_TOOLS", `已生成 ${actions.length} 个画布动作`, formatAgentCanvasActionSummary(actions), "active");
}

let agentCanvasLangGraphRuntimePromise = null;

function getAgentCanvasLangGraphRuntime() {
  if (!agentCanvasLangGraphRuntimePromise) {
    agentCanvasLangGraphRuntimePromise = import("./agent-canvas-langgraph.mjs");
  }
  return agentCanvasLangGraphRuntimePromise;
}

function shouldUseAgentCanvasLangGraph(body, skillId) {
  if (skillId === "storyboard-breakdown") return false;
  if (body?.mode && body.mode !== "agent") return false;
  const enabled = String(process.env.AGENT_CANVAS_LANGGRAPH_ENABLED || "true").trim().toLowerCase();
  if (enabled === "false" || enabled === "0" || enabled === "off") return false;
  const runtime = String(body?.runtime || process.env.AGENT_CANVAS_RUNTIME || "langgraphjs").trim().toLowerCase();
  return !["legacy", "planner", "json"].includes(runtime);
}

function shouldFallbackFromAgentCanvasLangGraph() {
  const fallback = String(process.env.AGENT_CANVAS_LANGGRAPH_FALLBACK || "true").trim().toLowerCase();
  return fallback !== "false" && fallback !== "0" && fallback !== "off";
}

const storyboardBreakdownCheckpoints = new Map();
const STORYBOARD_BREAKDOWN_CHECKPOINT_TTL_MS = 2 * 60 * 60 * 1000;
const STORYBOARD_BREAKDOWN_MAX_SHOTS = 25;

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function getStoryboardBreakdownBatchSize() {
  return clampNumber(process.env.AGENT_CANVAS_STORYBOARD_BATCH_SIZE, 5, 8, 5);
}

function getStoryboardBreakdownCheckpointKey(sessionId) {
  const raw = String(sessionId || "").trim();
  return raw || `storyboard-breakdown-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function pruneStoryboardBreakdownCheckpoints() {
  const now = Date.now();
  for (const [key, value] of storyboardBreakdownCheckpoints.entries()) {
    if (!value?.updatedAtMs || now - value.updatedAtMs > STORYBOARD_BREAKDOWN_CHECKPOINT_TTL_MS) {
      storyboardBreakdownCheckpoints.delete(key);
    }
  }
}

function stableAgentIdPart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || Math.random().toString(36).slice(2, 10);
}

function hasStoryboardSourceText(message) {
  const text = String(message || "").trim();
  if (text.length >= 80) return true;
  if (text.split(/\r?\n/).filter((line) => line.trim()).length >= 3) return true;
  return /[。！？；：“”「」『』]/.test(text);
}

function isStoryboardContinueRequest(message) {
  return /继续|剩余|后续|continue|resume|remaining/i.test(String(message || ""));
}

function buildHeuristicStoryboardPlan(message) {
  const text = String(message || "").trim();
  const lengthScore = Math.ceil(Math.max(text.length, 400) / 650);
  const totalParts = Math.max(3, Math.min(STORYBOARD_BREAKDOWN_MAX_SHOTS, lengthScore + 2));
  return {
    totalParts,
    parts: Array.from({ length: totalParts }, (_, index) => ({
      index: index + 1,
      title: `剧本拆解 - 分镜 ${index + 1}`,
      sourceScope: `按剧情顺序覆盖第 ${index + 1}/${totalParts} 个分镜头`,
    })),
    warnings: ["STORYBOARD_PLAN_USED_HEURISTIC"],
  };
}

function normalizeStoryboardPlan(rawPlan, message) {
  const fallback = buildHeuristicStoryboardPlan(message);
  const requestedTotalParts = Number(
    rawPlan?.totalParts || rawPlan?.partCount || rawPlan?.totalShots || rawPlan?.shotCount || fallback.totalParts,
  );
  const totalParts = Math.max(
    1,
    Math.min(STORYBOARD_BREAKDOWN_MAX_SHOTS, requestedTotalParts || fallback.totalParts),
  );
  const rawParts = Array.isArray(rawPlan?.parts)
    ? rawPlan.parts
    : (Array.isArray(rawPlan?.shots) ? rawPlan.shots : []);
  const parts = [];
  for (let index = 1; index <= totalParts; index += 1) {
    const raw =
      rawParts.find((item) => Number(item?.index || item?.shotIndex || item?.shot) === index) ||
      rawParts[index - 1] ||
      {};
    parts.push({
      index,
      title: String(raw.title || raw.name || `剧本拆解 - 分镜 ${index}`).slice(0, 120),
      sourceScope: String(raw.sourceScope || raw.scope || raw.summary || `按剧情顺序覆盖第 ${index}/${totalParts} 个分镜头`).slice(0, 500),
    });
  }
  const warnings = Array.isArray(rawPlan?.warnings) ? rawPlan.warnings.map(String).slice(0, 12) : fallback.warnings;
  if (requestedTotalParts > STORYBOARD_BREAKDOWN_MAX_SHOTS) {
    warnings.push(`STORYBOARD_MAX_SHOTS_CLAMPED_${STORYBOARD_BREAKDOWN_MAX_SHOTS}`);
  }
  return {
    totalParts,
    parts,
    warnings,
  };
}

function buildStoryboardBreakdownBatches(parts, batchSize) {
  const batches = [];
  for (let index = 0; index < parts.length; index += batchSize) {
    batches.push({
      index: batches.length + 1,
      startPart: parts[index]?.index || index + 1,
      endPart: parts[Math.min(index + batchSize, parts.length) - 1]?.index || index + batchSize,
      parts: parts.slice(index, index + batchSize),
    });
  }
  return batches;
}

function getStoryboardScriptExcerpt(script, batch, totalParts) {
  const text = String(script || "");
  const partCount = Math.max(1, Array.isArray(batch?.parts) ? batch.parts.length : 1);
  const maxChars = partCount > 1 ? 6500 : 4200;
  if (text.length <= maxChars) {
    return {
      text,
      coverage: "full",
      start: 0,
      end: text.length,
    };
  }
  const safeTotal = Math.max(1, Number(totalParts) || 1);
  const startRatio = Math.max(0, (Number(batch.startPart || 1) - 1) / safeTotal);
  const endRatio = Math.min(1, Number(batch.endPart || batch.startPart || 1) / safeTotal);
  const rawStart = Math.max(0, Math.floor(text.length * startRatio));
  const rawEnd = Math.min(text.length, Math.ceil(text.length * endRatio));
  const rawWindow = Math.max(1, rawEnd - rawStart);
  const extra = Math.max(0, maxChars - rawWindow);
  let start = Math.max(0, rawStart - Math.floor(extra / 2));
  let end = Math.min(text.length, rawEnd + Math.ceil(extra / 2));
  if (end - start > maxChars) {
    const center = Math.floor((rawStart + rawEnd) / 2);
    start = Math.max(0, center - Math.floor(maxChars / 2));
    end = Math.min(text.length, start + maxChars);
    start = Math.max(0, end - maxChars);
  }
  return {
    text: text.slice(start, end),
    coverage: `${batch.startPart}-${batch.endPart}/${safeTotal}`,
    start,
    end,
  };
}

function buildCompactStoryboardPlanForBatch(plan, batch) {
  const totalParts = Math.max(1, Number(plan?.totalParts) || 1);
  const parts = Array.isArray(plan?.parts) ? plan.parts : [];
  const start = Math.max(1, Number(batch?.startPart || 1));
  const end = Math.max(start, Number(batch?.endPart || start));
  const nearbyParts = parts
    .filter((part) => {
      const index = Number(part?.index);
      return index >= start - 1 && index <= end + 1;
    })
    .map((part) => ({
      index: Number(part?.index),
      title: String(part?.title || "").slice(0, 80),
      sourceScope: String(part?.sourceScope || "").slice(0, 220),
    }));
  return {
    totalParts,
    maxShots: STORYBOARD_BREAKDOWN_MAX_SHOTS,
    requestedRange: { start, end },
    nearbyParts,
  };
}

function buildCompactStoryboardBatchRules() {
  return [
    `最高优先级：最多生成 ${STORYBOARD_BREAKDOWN_MAX_SHOTS} 个分镜头，绝不能超过。`,
    "最高优先级：一个分镜头必须对应一个 Text 文本节点；一个 Text 节点里只能写一个分镜头。",
    "如果其它 Skill 提示词要求 50-55 个镜头、9-12 个 Part、或一个 Part 内包含多个镜头，一律忽略，以本规则为准。",
    "核心规则：忠实原剧本，不删改核心剧情和对白，不新增无关剧情。",
    "输出为可直接用于视频创作的文字分镜 Shot，每个 Shot 独立完整。",
    "每个 Shot 必须包含：时间/天气/光线、核心摄影机与参数、出场人物与道具、绝对人物站位、风格。",
    "每个 Shot 必须包含：时长、环境描写、时间切片与画面细分、景别、镜头运动与衔接、音效、背景音乐。",
    "人物站位、朝向、表情和动作必须连续一致；表情自然克制，动作写实收敛。",
    "每个 Shot 必须自包含；不要写“同上”。",
    "严禁图片/视频生成动作，严禁 connect_nodes，只创建 Text 节点。",
  ].join("\n");
}

function buildStoryboardPlannerPrompt() {
  return [
    "You are PlannerAgent for XiaoLou storyboard breakdown.",
    "Plan the script breakdown before writing any detailed storyboard content.",
    `Hard limit: plan at most ${STORYBOARD_BREAKDOWN_MAX_SHOTS} storyboard shots. Never exceed this number.`,
    "In this API, totalParts means total storyboard shots. Each part is exactly one shot, and each shot will become exactly one Text node.",
    "Return ONLY JSON: {\"totalParts\":number,\"parts\":[{\"index\":1,\"title\":\"...\",\"sourceScope\":\"...\"}],\"warnings\":[]}.",
    "Use Simplified Chinese.",
    `Use fewer than ${STORYBOARD_BREAKDOWN_MAX_SHOTS} shots when the source text is short. For long scripts, cap the plan at ${STORYBOARD_BREAKDOWN_MAX_SHOTS} shots.`,
    "Each planned shot should be self-contained and suitable for one Text node later.",
    "Do not output detailed shot content in this planning step.",
  ].join("\n");
}

function buildStoryboardBatchPrompt() {
  return [
    "You are StoryboardBatchAgent for XiaoLou Agent Canvas.",
    "Generate ONLY the requested storyboard shots for this batch. Do not generate earlier or later shots.",
    "Each requested part is exactly one storyboard shot. One shot must map to one Text node.",
    "Return ONLY JSON: {\"response\":\"short Chinese summary\",\"actions\":[...],\"warnings\":[]}.",
    "Each action must be a Text node action: {\"type\":\"create_node\",\"nodeType\":\"Text\",\"id\":\"shot-id\",\"title\":\"剧本拆解 - 分镜 N\",\"content\":\"Markdown content\"}.",
    "Produce exactly one create_node action per requested storyboard shot.",
    "Each Text node content must describe exactly one storyboard shot. Do not put multiple shots in one Text node.",
    "Do not create image/video nodes. Do not call generate_image/generate_video. Do not connect nodes.",
    "Keep each Text node content complete and closed. If a shot would be too long, summarize that shot more tightly instead of starting an unfinished node.",
    "Use the user's original script faithfully: do not delete core plot or dialogue, do not add unrelated plot, and keep the requested storyboard format.",
  ].join("\n");
}

function normalizeStoryboardBatchTextActions(actions, batch, checkpoint) {
  const rawActions = Array.isArray(actions) ? actions : [];
  const byPartIndex = new Map();
  rawActions.forEach((action, offset) => {
    if (!isStoryboardTextCreateAction(action)) return;
    const partIndex = Number(action.partIndex || action.index || action.part || batch.parts[offset]?.index || 0);
    if (!partIndex || byPartIndex.has(partIndex)) return;
    byPartIndex.set(partIndex, action);
  });

  return batch.parts.map((part, offset) => {
    const raw = byPartIndex.get(part.index) || rawActions[offset] || {};
    const id = `storyboard-breakdown-${checkpoint.runId}-part-${String(part.index).padStart(2, "0")}`;
    const content = String(raw.content || raw.prompt || raw.text || "").trim();
    return {
      ...raw,
      id,
      type: "create_node",
      nodeType: "Text",
      partIndex: part.index,
      shotIndex: part.index,
      title: String(raw.title || part.title || `剧本拆解 - 分镜 ${part.index}`).slice(0, 120),
      content: content || `## ${part.title}\n\n本分镜生成内容为空，请重新运行剧本拆解。`,
      x: 800 + ((part.index - 1) % 4) * 380,
      y: 200 + Math.floor((part.index - 1) / 4) * 300,
    };
  });
}

function makeStoryboardGroupAction(checkpoint) {
  return {
    type: "group_nodes",
    groupId: `storyboard-breakdown-group-${checkpoint.runId}`,
    label: "剧本拆解",
    nodeIds: checkpoint.nodeIds.slice(),
  };
}

async function requestStoryboardJsonCompletion(messages, options) {
  const completion = await requestAgentCanvasCompletion(messages, options);
  return {
    completion,
    parsed: extractAgentJson(completion.text),
    recoveredActions: extractPartialAgentActions(completion.text),
  };
}

async function generateStoryboardBatchActions(batch, context) {
  const {
    sourceText,
    skillInstructionForModel,
    skillInstruction,
    plan,
    checkpoint,
    model,
    textModel,
    maxTokens,
    signal,
    onDelta,
  } = context;
  throwIfAgentCanvasAborted(signal);
  const scriptExcerpt = getStoryboardScriptExcerpt(sourceText, batch, plan.totalParts);
  const batchResult = await requestStoryboardJsonCompletion(
    [
      { role: "system", content: buildStoryboardBatchPrompt() },
      {
        role: "user",
        content: JSON.stringify({
          scriptExcerpt: scriptExcerpt.text,
          scriptCoverage: scriptExcerpt.coverage,
          fullScriptLength: String(sourceText || "").length,
          compactStoryboardRules: buildCompactStoryboardBatchRules(),
          userSkillInstructionHint: String(skillInstructionForModel || skillInstruction || "").slice(0, 600),
          plan: buildCompactStoryboardPlanForBatch(plan, batch),
          currentBatch: batch,
          checkpoint: {
            completedParts: checkpoint.completedParts,
            totalParts: checkpoint.totalParts,
          },
        }),
      },
    ],
    {
      model,
      textModel,
      maxTokens: Math.min(batch.parts.length > 1 ? 6500 : 2600, 1800 + batch.parts.length * 950),
      maxTokenLimit: 7000,
      useWebSearch: false,
      signal,
      onDelta,
    },
  );

  const rawActions = Array.isArray(batchResult.parsed?.actions)
    ? batchResult.parsed.actions
    : batchResult.recoveredActions;
  const warnings = [];
  if (!batchResult.parsed && batchResult.recoveredActions.length > 0) {
    warnings.push(`BATCH_${batch.index}_RECOVERED_PARTIAL_ACTIONS`);
  }
  const textActions = normalizeStoryboardBatchTextActions(rawActions, batch, checkpoint);
  const missingCount = textActions.filter((action) => /生成内容为空/.test(String(action.content || ""))).length;
  if (missingCount > 0) warnings.push(`BATCH_${batch.index}_MISSING_${missingCount}_PARTS`);

  return {
    completion: batchResult.completion,
    textActions,
    warnings,
  };
}

function splitStoryboardBatchForRetry(batch) {
  return batch.parts.map((part, index) => ({
    index: Number(`${batch.index}${index + 1}`),
    startPart: part.index,
    endPart: part.index,
    parts: [part],
  }));
}

async function buildStoryboardBreakdownPlan(body, context) {
  const { message, skillInstruction, model, textModel, signal, onDelta } = context;
  throwIfAgentCanvasAborted(signal);
  const promptBudget = 24000;
  const sourceForPlanning = String(message || "").slice(0, promptBudget);
  const { completion, parsed } = await requestStoryboardJsonCompletion(
    [
      { role: "system", content: buildStoryboardPlannerPrompt() },
      {
        role: "user",
        content: JSON.stringify({
          script: sourceForPlanning,
          scriptLength: String(message || "").length,
          skillInstructionSummary: String(skillInstruction || "").slice(0, 4000),
          existingCanvas: body?.canvas ? "canvas snapshot provided" : "none",
        }),
      },
    ],
    {
      model,
      textModel,
      maxTokens: 2200,
      maxTokenLimit: 3000,
      useWebSearch: false,
      signal,
      onDelta,
    },
  );
  return {
    completion,
    plan: normalizeStoryboardPlan(parsed, message),
  };
}

async function runBatchedStoryboardBreakdown(store, body, context) {
  const {
    emit,
    message,
    skillInstruction,
    skillInstructionForModel,
    maxTokens,
    tools,
    toolWarnings,
    model,
    textModel,
    signal,
    onDelta,
  } = context;
  throwIfAgentCanvasAborted(signal);
  pruneStoryboardBreakdownCheckpoints();
  const checkpointKey = getStoryboardBreakdownCheckpointKey(body?.sessionId);
  const previousCheckpoint = storyboardBreakdownCheckpoints.get(checkpointKey);
  const wantsContinue = isStoryboardContinueRequest(message);
  const sourceText = wantsContinue && previousCheckpoint?.sourceText
    ? previousCheckpoint.sourceText
    : message;

  if (!hasStoryboardSourceText(sourceText)) {
    return {
      sessionId: body?.sessionId || null,
      response: "请先粘贴需要拆解的剧本正文，我会按批次自动拆解并写入画布。",
      actions: [],
      warnings: ["STORYBOARD_SOURCE_REQUIRED", ...toolWarnings],
      tools,
    };
  }

  const runId = stableAgentIdPart(checkpointKey);

  const batchSize = getStoryboardBreakdownBatchSize();
  let plannerCompletion = null;
  let plan = null;
  let checkpoint = null;

  if (
    wantsContinue &&
    previousCheckpoint?.plan &&
    previousCheckpoint.status !== "completed" &&
    previousCheckpoint.completedParts < previousCheckpoint.totalParts
  ) {
    plan = previousCheckpoint.plan;
    checkpoint = {
      ...previousCheckpoint,
      batchSize,
      status: "running",
      updatedAt: new Date().toISOString(),
      updatedAtMs: Date.now(),
    };
    emitAgentCanvasStatus(
      emit,
      "THINKING",
      "Storyboard checkpoint resumed",
      `从第 ${checkpoint.completedParts + 1}/${checkpoint.totalParts} 部分继续`,
      "done",
    );
  } else {
    emitAgentCanvasStatus(emit, "THINKING", "Storyboard Planner", "正在判断总长度和拆分段数", "active");
    const plannerResult = await buildStoryboardBreakdownPlan(body, {
      message: sourceText,
      skillInstruction,
      model,
      textModel,
      signal,
      onDelta,
    });
    plannerCompletion = plannerResult.completion;
    plan = plannerResult.plan;
    checkpoint = {
      key: checkpointKey,
      runId,
      sourceText,
      plan,
      totalParts: plan.totalParts,
      batchSize,
      completedParts: 0,
      completedBatches: 0,
      nodeIds: [],
      status: "running",
      updatedAt: new Date().toISOString(),
      updatedAtMs: Date.now(),
    };
  }
  storyboardBreakdownCheckpoints.set(checkpointKey, checkpoint);

  const remainingParts = plan.parts.filter((part) => part.index > checkpoint.completedParts);
  const batches = buildStoryboardBreakdownBatches(remainingParts, batchSize);

  emitAgentCanvasStatus(
    emit,
    "THINKING",
    "Storyboard Planner 完成",
    `共 ${plan.totalParts} 个部分，剩余 ${remainingParts.length} 个，按每批 ${batchSize} 个节点写回`,
    "done",
  );

  const allActions = [];
  const warnings = [...(plan.warnings || []), ...toolWarnings];
  let latestCompletion = plannerCompletion;
  const streamActions = typeof emit === "function";

  for (const batch of batches) {
    throwIfAgentCanvasAborted(signal);
    emitAgentCanvasStatus(
      emit,
      "THINKING",
      `Storyboard Batch ${batch.index}/${batches.length}`,
      `生成第 ${batch.startPart}-${batch.endPart} 部分`,
      "active",
    );

    let generatedBatches = [];
    let shouldStop = false;
    try {
      const output = await generateStoryboardBatchActions(batch, {
        sourceText,
        skillInstructionForModel,
        skillInstruction,
        plan,
        checkpoint,
        model,
        textModel,
        maxTokens,
        signal,
        onDelta,
      });
      generatedBatches = [{ batch, ...output }];
    } catch (error) {
      if (isAgentCanvasAbortError(error)) throw error;
      warnings.push(`BATCH_${batch.index}_FAILED_RETRYING_SPLIT`);
      warnings.push(`BATCH_${batch.index}_ERROR:${compactAgentProviderError(error)}`);
      console.warn("[agent-canvas] storyboard batch failed, retrying split", {
        batch: batch.index,
        parts: batch.parts.map((part) => part.index),
        message: error?.message || error,
      });
      if (batch.parts.length > 1) {
        for (const retryBatch of splitStoryboardBatchForRetry(batch)) {
          try {
            emitAgentCanvasStatus(
              emit,
              "THINKING",
              `Storyboard retry Part ${retryBatch.startPart}`,
              "批次过大，正在拆成单个 Part 重试",
              "active",
            );
            const output = await generateStoryboardBatchActions(retryBatch, {
              sourceText,
              skillInstructionForModel,
              skillInstruction,
              plan,
              checkpoint,
              model,
              textModel,
              maxTokens,
              signal,
              onDelta,
            });
            generatedBatches.push({ batch: retryBatch, ...output });
          } catch (retryError) {
            if (isAgentCanvasAbortError(retryError)) throw retryError;
            warnings.push(`BATCH_${retryBatch.index}_FAILED`);
            warnings.push(`BATCH_${retryBatch.index}_ERROR:${compactAgentProviderError(retryError)}`);
            checkpoint.status = "failed";
            checkpoint.lastError = retryError?.message || "Storyboard batch failed";
            checkpoint.updatedAt = new Date().toISOString();
            checkpoint.updatedAtMs = Date.now();
            storyboardBreakdownCheckpoints.set(checkpointKey, checkpoint);
            emitAgentCanvasStatus(
              emit,
              "ERROR",
              `Storyboard Part ${retryBatch.startPart} 失败`,
              retryError?.message || "当前 Part 生成失败，可继续从 checkpoint 恢复",
              "error",
            );
            console.warn("[agent-canvas] storyboard retry batch failed", {
              batch: retryBatch.index,
              part: retryBatch.startPart,
              message: retryError?.message || retryError,
            });
            shouldStop = true;
            break;
          }
        }
      } else {
        warnings.push(`BATCH_${batch.index}_FAILED`);
        warnings.push(`BATCH_${batch.index}_ERROR:${compactAgentProviderError(error)}`);
        checkpoint.status = "failed";
        checkpoint.lastError = error?.message || "Storyboard batch failed";
        checkpoint.updatedAt = new Date().toISOString();
        checkpoint.updatedAtMs = Date.now();
        storyboardBreakdownCheckpoints.set(checkpointKey, checkpoint);
        emitAgentCanvasStatus(
          emit,
          "ERROR",
          `Storyboard Batch ${batch.index} 失败`,
          error?.message || "当前批次生成失败，可继续从 checkpoint 恢复",
          "error",
        );
        shouldStop = true;
      }
    }
    if (shouldStop && generatedBatches.length === 0) break;

    for (const generated of generatedBatches) {
      const effectiveBatch = generated.batch;
      latestCompletion = generated.completion;
      warnings.push(...generated.warnings);
      const textActions = generated.textActions;

      checkpoint.completedParts = Math.max(checkpoint.completedParts, effectiveBatch.endPart);
      checkpoint.completedBatches = (Number(checkpoint.completedBatches) || 0) + 1;
      checkpoint.nodeIds = Array.from(new Set([...checkpoint.nodeIds, ...textActions.map((action) => action.id)]));
      checkpoint.updatedAt = new Date().toISOString();
      checkpoint.updatedAtMs = Date.now();
      storyboardBreakdownCheckpoints.set(checkpointKey, checkpoint);

      const batchActions = [...textActions, makeStoryboardGroupAction(checkpoint)];
      allActions.push(...batchActions);
      if (streamActions) {
        emit("actions", {
          agent: "StoryboardBatchAgent",
          actions: batchActions,
          checkpoint: {
            sessionId: checkpointKey,
            completedParts: checkpoint.completedParts,
            totalParts: checkpoint.totalParts,
            completedBatches: checkpoint.completedBatches,
            totalBatches: batches.length,
          },
          timestamp: new Date().toISOString(),
        });
      }
      emitAgentCanvasStatus(
        emit,
        "USING_TOOLS",
        `Storyboard Batch ${effectiveBatch.index} 已写回`,
        `已写入 ${textActions.length} 个 Text 节点，进度 ${checkpoint.completedParts}/${checkpoint.totalParts}`,
        "done",
      );
    }
    if (shouldStop) break;
  }

  const completedAllParts = checkpoint.completedParts >= checkpoint.totalParts;
  checkpoint.status = completedAllParts ? "completed" : (checkpoint.status === "failed" ? "failed" : "paused");
  checkpoint.updatedAt = new Date().toISOString();
  checkpoint.updatedAtMs = Date.now();
  storyboardBreakdownCheckpoints.set(checkpointKey, checkpoint);

  const finalActions = streamActions ? [] : allActions;
  return {
    sessionId: body?.sessionId || checkpointKey,
    actions: finalActions,
    response: completedAllParts
      ? `剧本拆解已按 ${checkpoint.completedBatches} 个批次完成，共写入 ${checkpoint.nodeIds.length} 个文本节点。`
      : `剧本拆解已写入 ${checkpoint.nodeIds.length} 个文本节点，当前进度 ${checkpoint.completedParts}/${checkpoint.totalParts}。同一会话再次发送“继续”会从 checkpoint 接着生成。`,
    warnings: Array.from(new Set([
      "STORYBOARD_BATCHED_RUN",
      ...(completedAllParts ? [] : ["STORYBOARD_BATCHED_RUN_INCOMPLETE"]),
      ...warnings,
    ])).slice(0, 30),
    topic: "剧本拆解",
    provider: latestCompletion?.provider,
    model: latestCompletion?.model,
    fallbackFrom: latestCompletion?.fallbackFrom,
    groundingSources: latestCompletion?.groundingSources,
    tools,
    runtime: {
      type: "storyboard-batched",
      checkpoint: {
        sessionId: checkpointKey,
        completedParts: checkpoint.completedParts,
        totalParts: checkpoint.totalParts,
        completedBatches: checkpoint.completedBatches,
        totalBatches: batches.length,
        batchSize,
      },
    },
  };
}

async function buildAgentCanvasChatResponse(store, req, url, body = {}, emit, runOptions = {}) {
  const signal = runOptions?.signal;
  throwIfAgentCanvasAborted(signal);
  const actorId = getActorId(req, url);
  if (!actorId) throw agentCanvasHttpError(401, "UNAUTHORIZED", "Login required");
  store.assertSuperAdmin(actorId);

  const message = String(body?.message || "").trim();
  if (!message) throw agentCanvasHttpError(400, "BAD_REQUEST", "message is required");
  const instruction = String(body?.instruction || "").trim();
  const skillId = String(body?.skillId || "").trim();
  const skillInstruction = String(body?.skillInstruction || "").trim();
  const maxTokens = skillId === "storyboard-breakdown"
    ? normalizeAgentCanvasMaxTokens(body?.maxTokens, 16000, 16000)
    : 4096;

  const tools = normalizeAgentCanvasTools(body?.tools);
  const agentOptions = {
    mode: body?.mode || "agent",
    skillId: skillId || null,
    toolId: body?.toolId || null,
    toolType: body?.toolType || null,
    preferredImageToolId: body?.preferredImageToolId || null,
    preferredVideoToolId: body?.preferredVideoToolId || null,
    allowedImageToolIds: Array.isArray(body?.allowedImageToolIds) ? body.allowedImageToolIds.slice(0, 20) : [],
    allowedVideoToolIds: Array.isArray(body?.allowedVideoToolIds) ? body.allowedVideoToolIds.slice(0, 20) : [],
    autoModelPreference: body?.autoModelPreference !== false,
    maxTokens,
  };
  const toolWarnings = [];
  const canvasSummary = summarizeAgentCanvas(body?.canvas, { includeFiles: tools.canvasFiles });
  const attachments = Array.isArray(body?.attachments) ? body.attachments.slice(0, 12) : [];
  const contextDetail = getAgentCanvasRequestContextDetail(body, canvasSummary, attachments);
  const emitDelta = (delta) => emitAgentCanvasDelta(emit, delta?.kind, delta?.text, {
    provider: delta?.provider,
    model: delta?.model,
  });
  emitAgentCanvasStatus(emit, "THINKING", "读取画布上下文", contextDetail, "done");
  throwIfAgentCanvasAborted(signal);

  let webSearch = null;
  if (tools.webSearch) {
    emitAgentCanvasStatus(emit, "THINKING", "执行网络检索", "正在整理当前资料", "active");
    try {
      webSearch = await buildAgentCanvasWebSearchContext(message);
      throwIfAgentCanvasAborted(signal);
      const sourceCount = Array.isArray(webSearch?.sources) ? webSearch.sources.length : 0;
      emitAgentCanvasStatus(emit, "THINKING", "网络检索完成", sourceCount > 0 ? `获得 ${sourceCount} 条来源` : "已获得检索摘要", "done");
    } catch (error) {
      if (isAgentCanvasAbortError(error)) throw error;
      toolWarnings.push(error?.code || "WEB_SEARCH_UNAVAILABLE");
      emitAgentCanvasStatus(emit, "THINKING", "网络检索跳过", error?.message || "检索服务暂不可用", "done");
      console.warn("[agent-canvas] web search unavailable", error?.message || error);
    }
  }

  if (skillId === "storyboard-breakdown") {
    try {
      return await runBatchedStoryboardBreakdown(store, body, {
        emit,
        message,
        skillInstruction,
        skillInstructionForModel: `${instruction}\n\n${skillInstruction}`.trim(),
        maxTokens,
        tools,
        toolWarnings,
        model: body?.model,
        textModel: getAgentCanvasTextModel(store),
        onDelta: emitDelta,
        signal,
      });
    } catch (error) {
      if (isAgentCanvasAbortError(error)) throw error;
      emitAgentCanvasStatus(emit, "ERROR", "Storyboard batched run failed", error?.message || "剧本拆解失败", "error");
      throw agentCanvasHttpError(
        error?.statusCode || 503,
        error?.code || "STORYBOARD_BATCHED_RUN_FAILED",
        error?.message || "剧本拆解失败",
      );
    }
  }

  if (shouldUseAgentCanvasLangGraph(body, skillId)) {
    try {
      emitAgentCanvasStatus(emit, "THINKING", "LangGraph.js runtime", "Loading multi-agent runtime", "active");
      const { runAgentCanvasLangGraph } = await getAgentCanvasLangGraphRuntime();
      return await runAgentCanvasLangGraph(
        {
          sessionId: body?.sessionId || null,
          message,
          instruction,
          canvas: canvasSummary,
          attachments,
          webSearch,
          tools,
          toolWarnings,
          maxTokens,
          agentOptions,
          skill: {
            id: skillId || null,
            instruction: skillInstruction || null,
          },
        },
        {
          emit,
          requestCompletion: (messages, options = {}) => requestAgentCanvasCompletion(
            messages,
            {
              model: body?.model,
              textModel: getAgentCanvasTextModel(store),
              maxTokens: options.maxTokens || maxTokens,
              maxTokenLimit: skillId === "storyboard-breakdown" ? 16000 : 8000,
              useWebSearch: false,
              signal,
              onDelta: emitDelta,
            },
          ),
          signal,
        },
      );
    } catch (error) {
      if (isAgentCanvasAbortError(error)) throw error;
      if (!shouldFallbackFromAgentCanvasLangGraph()) {
        emitAgentCanvasStatus(emit, "ERROR", "LangGraph.js runtime failed", error?.message || "Runtime error", "error");
        throw agentCanvasHttpError(
          error?.statusCode || 503,
          error?.code || "AGENT_LANGGRAPH_ERROR",
          error?.message || "Agent Canvas LangGraph runtime failed",
        );
      }
      emitAgentCanvasStatus(emit, "THINKING", "LangGraph.js fallback", error?.message || "Falling back to legacy planner", "done");
      console.warn("[agent-canvas] LangGraph runtime fallback", error?.message || error);
    }
  }

  const systemPrompt = [
    "You are XiaoLou Agent Canvas native planner, a deep canvas orchestration agent for the XiaoLou smart canvas.",
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
    "Never mention Jaaz or assume a Jaaz runtime. Use the provided agentOptions model and tool preferences when setting imageModel, videoModel, toolId, or related action fields.",
    "If the user payload includes instruction or skill.instruction, treat it as additional composer guidance below these system rules.",
    "Allowed action types: create_node, update_node, delete_nodes, connect_nodes, move_nodes, layout_nodes, group_nodes, generate_image, generate_video, save_canvas.",
    "Use existing node types only: Text, Image, Video, Audio, Image Editor, Video Editor, Storyboard Manager, Camera Angle, Local Image Model, Local Video Model.",
    "If the user gives a clear create/edit/delete/move/layout/connect/group/generate/save command, do not ask a clarifying question. Produce at least one action with reasonable defaults.",
    "For create_node use fields like {\"type\":\"create_node\",\"nodeType\":\"Text\",\"title\":\"...\",\"content\":\"...\",\"x\":0,\"y\":0}.",
    "For standalone generate_image or generate_video requests, create the generated node as an independent node. Do not include referenceNodeIds/parentIds and do not connect it to existing nodes.",
    "Selected nodes and nearby canvas media are context only. Never treat selection, proximity, or an existing canvas image/video as a reference request by itself.",
    "Only use referenceNodeIds, parentIds, connect_nodes, image_to_video, start_end_frame, multi_param, video_edit, motion_control, or video_extend when the user explicitly asks to use, reference, animate, continue, edit, connect, or derive from a current/selected/existing canvas node, a provided attachment, or a reference image/video/audio. In those cases set useCanvasReference:true on the generation action.",
    "When the user asks for visual creation, produce generate_image or generate_video actions with concrete prompts; layout the result near the current viewport without connecting it unless the explicit reference rule above is satisfied.",
    "When the user asks to organize, compare, storyboard, or iterate, produce multiple ordered actions that create/update/connect/group/layout nodes.",
    "For generation actions, include nodeId when targeting an existing node, or include prompt/title/x/y to let the frontend create a node.",
    ...(skillId === "storyboard-breakdown" ? [
      "Storyboard breakdown skill is active. Apply the provided skillInstruction as strict production rules, but still return ONLY the JSON shape required above.",
      "If the user message does not include actual script/story text to break down, respond in Chinese with a request to paste the script and return actions: [].",
      "When script text is present, create Text nodes only. Use titles like 剧本拆解 - 第 1 部分, put Markdown breakdown content in content/prompt, then group those Text nodes with group_nodes using label 剧本拆解.",
      "For storyboard breakdown skill, do not create image/video nodes, do not call generate_image/generate_video, do not use referenceNodeIds/parentIds, and do not connect_nodes unless the user explicitly asks for those extra actions.",
    ] : []),
  ].join("\n");

  let completion;
  emitAgentCanvasStatus(emit, "THINKING", "Planner 正在规划画布动作", contextDetail, "active");
  try {
    completion = await requestAgentCanvasCompletion(
      [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: JSON.stringify({
            message,
            instruction,
            sessionId: body?.sessionId || null,
            canvas: canvasSummary,
            attachments,
            webSearch,
            tools,
            agentOptions,
            skill: {
              id: skillId || null,
              instruction: skillInstruction || null,
            },
          }),
        },
      ],
      {
        model: body?.model,
        textModel: getAgentCanvasTextModel(store),
        maxTokens,
        maxTokenLimit: skillId === "storyboard-breakdown" ? 16000 : 8000,
        useWebSearch: false,
        signal,
        onDelta: emitDelta,
      }
    );
  } catch (error) {
    if (isAgentCanvasAbortError(error)) throw error;
    emitAgentCanvasStatus(emit, "ERROR", "Planner 调用失败", error?.message || "智能体画布模型调用失败", "error");
    throw agentCanvasHttpError(
      error?.statusCode || 503,
      error?.code || "AGENT_MODEL_ERROR",
      error?.message || "智能体画布模型调用失败"
    );
  }

  emitAgentCanvasStatus(emit, "THINKING", "Planner 已返回模型结果", `模型：${completion.model || completion.provider || "unknown"}`, "done");
  const modelText = completion.text;
  const parsed = extractAgentJson(modelText);
  if (!parsed || typeof parsed !== "object") {
    const recoveredStoryboardActions = skillId === "storyboard-breakdown"
      ? normalizeStoryboardBreakdownActions(extractPartialAgentActions(modelText)).slice(0, 50)
      : [];
    if (recoveredStoryboardActions.length > 0) {
      const recoveredTextNodeCount = recoveredStoryboardActions.filter((action) => getAgentActionTypeForServer(action) === "create_node").length;
      emitAgentCanvasParsedActions(emit, recoveredStoryboardActions);
      return {
        sessionId: body?.sessionId || null,
        response: `模型返回的剧本拆解 JSON 过长或被截断，我已恢复 ${recoveredTextNodeCount} 个完整文本节点并放入画布。若还缺后续部分，请继续发送“继续拆解剩余部分”。`,
        actions: recoveredStoryboardActions,
        warnings: ["MODEL_RETURNED_PARTIAL_ACTIONS", ...toolWarnings],
        provider: completion.provider,
        model: completion.model,
        fallbackFrom: completion.fallbackFrom,
        groundingSources: completion.groundingSources || webSearch?.sources,
        tools,
      };
    }

    emitAgentCanvasParsedActions(emit, []);
    return {
      sessionId: body?.sessionId || null,
      response: modelText || "我暂时无法生成结构化画布操作。",
      actions: [],
      warnings: ["MODEL_RETURNED_UNSTRUCTURED_TEXT", ...toolWarnings],
      provider: completion.provider,
      model: completion.model,
      fallbackFrom: completion.fallbackFrom,
      groundingSources: completion.groundingSources || webSearch?.sources,
      tools,
    };
  }

  const parsedActions = skillId === "storyboard-breakdown"
    ? normalizeStoryboardBreakdownActions(parsed.actions).slice(0, 50)
    : (Array.isArray(parsed.actions) ? parsed.actions.slice(0, 50) : []);
  emitAgentCanvasParsedActions(emit, parsedActions);

  return {
    sessionId: body?.sessionId || null,
    response: String(parsed.response || "完成。"),
    actions: parsedActions,
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
  };
}

function buildAgentCanvasRoutes(store) {
  return [
    route("POST", "/api/agent-canvas/chat", async ({ req, res, url }) => {
      const body = await readJsonBody(req);
      const abortScope = createAgentCanvasAbortScope(res);
      try {
        return ok(await buildAgentCanvasChatResponse(store, req, url, body, undefined, {
          signal: abortScope.signal,
        }));
      } catch (error) {
        if (isAgentCanvasAbortError(error) || abortScope.signal.aborted) {
          return undefined;
        }
        return failure(
          error?.statusCode || 503,
          error?.code || "AGENT_MODEL_ERROR",
          error?.message || "智能体画布模型调用失败"
        );
      } finally {
        abortScope.finish();
      }
    }),
    route("POST", "/api/agent-canvas/chat/stream", async ({ req, res, url }) => {
      const body = await readJsonBody(req);
      const abortScope = createAgentCanvasAbortScope(res);
      writeAgentCanvasStreamHeaders(res);
      const emit = (eventName, data) => {
        if (abortScope.signal.aborted || res.writableEnded || res.destroyed) return;
        writeAgentCanvasEvent(res, eventName, data);
      };

      emit("ready", { connectedAt: new Date().toISOString() });
      try {
        const payload = await buildAgentCanvasChatResponse(store, req, url, body, emit, {
          signal: abortScope.signal,
        });
        if (abortScope.signal.aborted) return undefined;
        emit("result", payload);
        emit("done", { ok: true, timestamp: new Date().toISOString() });
      } catch (error) {
        if (isAgentCanvasAbortError(error) || abortScope.signal.aborted) {
          return undefined;
        }
        emit("error", {
          code: error?.code || "AGENT_MODEL_ERROR",
          message: error?.message || "智能体画布模型调用失败",
          statusCode: error?.statusCode || 503,
        });
      } finally {
        abortScope.finish();
        if (!res.writableEnded && !res.destroyed) res.end();
      }
      return undefined;
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

function buildAgentCanvasProjectRoutes(store) {
  return [
    route("GET", "/api/agent-canvas/projects", ({ req, url }) => {
      const actorId = getActorId(req, url);
      if (!actorId) return failure(401, "UNAUTHORIZED", "Login required");
      return ok({ items: store.listAgentCanvasProjectSummaries(actorId) });
    }),

    route("GET", "/api/agent-canvas/projects/:projectId", ({ params, req, url }) => {
      const actorId = getActorId(req, url);
      if (!actorId) return failure(401, "UNAUTHORIZED", "Login required");
      const project = store.getAgentCanvasProject(actorId, params.projectId);
      if (!project) return failure(404, "NOT_FOUND", "Agent canvas project not found");
      return ok(project);
    }),

    routeWithStatus("POST", "/api/agent-canvas/projects", 201, async ({ req, url }) => {
      const actorId = getActorId(req, url);
      if (!actorId) return failure(401, "UNAUTHORIZED", "Login required");
      const body = await readJsonBody(req);
      const project = store.saveAgentCanvasProject(actorId, body || {});
      return ok(project);
    }),

    route("PUT", "/api/agent-canvas/projects/:projectId", async ({ params, req, url }) => {
      const actorId = getActorId(req, url);
      if (!actorId) return failure(401, "UNAUTHORIZED", "Login required");
      const body = await readJsonBody(req);
      const project = store.saveAgentCanvasProject(actorId, { ...(body || {}), id: params.projectId });
      return ok(project);
    }),

    routeWithStatus("DELETE", "/api/agent-canvas/projects/:projectId", 200, ({ params, req, url }) => {
      const actorId = getActorId(req, url);
      if (!actorId) return failure(401, "UNAUTHORIZED", "Login required");
      const removed = store.deleteAgentCanvasProject(actorId, params.projectId);
      if (!removed) return failure(404, "NOT_FOUND", "Agent canvas project not found");
      return ok({ deleted: true, projectId: params.projectId });
    }),
  ];
}

module.exports = {
  buildRoutes
};
