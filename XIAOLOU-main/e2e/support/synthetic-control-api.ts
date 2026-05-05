import type { Page, Route } from "@playwright/test";

export const SYNTHETIC_E2E_ACTOR_ID = "synthetic-e2e-actor";

const SYNTHETIC_NOW = "2026-05-05T00:00:00.000Z";
const SYNTHETIC_STORAGE_ORIGIN = "https://synthetic-storage.invalid";

type SyntheticRequestRecord = {
  method: string;
  path: string;
  body?: unknown;
};

type SyntheticHarness = {
  requests: SyntheticRequestRecord[];
  storageRequests: SyntheticRequestRecord[];
  blockedExternalUrls: string[];
};

type SyntheticControlApiOptions = {
  preloadAuth?: boolean;
  unauthenticatedMe?: boolean;
};

type SyntheticState = {
  assets: unknown[];
  imageResults: unknown[];
  videoResults: unknown[];
  jobs: Record<string, ReturnType<typeof syntheticJob>>;
};

type SyntheticResponse = {
  status: number;
  body: unknown;
};

const FORBIDDEN_REAL_MATERIAL_PATTERNS = [
  /\.runtime/i,
  /deploy[\\/]local-secrets/i,
  /production[-_ ]?(dump|snapshot)/i,
  /BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE KEY/i,
  /\bsk_(?:live|prod)_[A-Za-z0-9_-]{8,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
];

function assertSyntheticFixtureBoundary<T>(value: T): T {
  const serialized = JSON.stringify(value);
  if (!serialized) return value;

  const matchedPattern = FORBIDDEN_REAL_MATERIAL_PATTERNS.find((pattern) => pattern.test(serialized));
  if (matchedPattern) {
    throw new Error(`Synthetic fixture boundary rejected real-material marker: ${matchedPattern}`);
  }

  return value;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function syntheticPermissionContext() {
  return {
    actor: {
      id: SYNTHETIC_E2E_ACTOR_ID,
      displayName: "Synthetic E2E Actor",
      email: "synthetic-e2e@example.invalid",
      platformRole: "customer",
      status: "active",
      defaultOrganizationId: "synthetic-org",
    },
    platformRole: "customer",
    organizations: [
      {
        id: "synthetic-org",
        name: "Synthetic Organization",
        role: "enterprise_admin",
        membershipRole: "admin",
        status: "active",
      },
    ],
    currentOrganizationId: "synthetic-org",
    currentOrganizationRole: "enterprise_admin",
    permissions: {
      canCreateProject: true,
      canRecharge: true,
      canUseEnterprise: true,
      canManageOrganization: true,
      canManageOps: false,
      canManageSystem: false,
    },
  };
}

function syntheticProject() {
  return {
    id: "synthetic-project",
    title: "Synthetic Project",
    summary: "Synthetic browser smoke project",
    description: "Synthetic browser smoke project",
    status: "active",
    step: "global",
    coverUrl: `${SYNTHETIC_STORAGE_ORIGIN}/objects/synthetic-project-cover.png`,
    organizationId: null,
    ownerType: "user",
    ownerId: SYNTHETIC_E2E_ACTOR_ID,
    createdAt: SYNTHETIC_NOW,
    updatedAt: SYNTHETIC_NOW,
  };
}

function syntheticJob(
  id = "synthetic-job",
  jobType = "synthetic_smoke",
  payload: Record<string, unknown> = {},
  result: Record<string, unknown> = {},
) {
  const mergedPayload = {
    type: jobType,
    jobType,
    domain: "synthetic",
    actionCode: jobType,
    inputSummary: "Synthetic job",
    ...payload,
  };
  return {
    id,
    type: jobType,
    job_type: jobType,
    status: "succeeded",
    progress: 100,
    progressPercent: 100,
    accountOwnerType: "user",
    accountOwnerId: SYNTHETIC_E2E_ACTOR_ID,
    lane: "account-control",
    provider_route: "synthetic-control-api",
    providerRoute: "synthetic-control-api",
    payload: mergedPayload,
    createdAt: SYNTHETIC_NOW,
    updatedAt: SYNTHETIC_NOW,
    created_at: SYNTHETIC_NOW,
    updated_at: SYNTHETIC_NOW,
    result: {
      text: "Synthetic job completed",
      url: `${SYNTHETIC_STORAGE_ORIGIN}/objects/${id}.txt`,
      outputSummary: "Synthetic job completed",
      ...result,
    },
  };
}

function syntheticToolboxCapabilities() {
  return [
    {
      code: "motion_transfer",
      name: "Synthetic Motion Transfer",
      status: "mock_ready",
      queue: "synthetic",
      description: "Synthetic-only toolbox capability for browser smoke.",
    },
    {
      code: "storyboard_25",
      name: "Synthetic Storyboard",
      status: "mock_ready",
      queue: "synthetic",
      description: "Synthetic-only storyboard capability for browser smoke.",
    },
  ];
}

function syntheticModels() {
  return [
    {
      id: "qwen-plus",
      name: "Qwen Plus Synthetic",
      provider: "synthetic-control-api",
      configured: true,
      default: true,
    },
  ];
}

function syntheticConversation() {
  return {
    id: "synthetic-conversation",
    title: "Synthetic conversation",
    model: "qwen-plus",
    accountOwnerType: "user",
    accountOwnerId: SYNTHETIC_E2E_ACTOR_ID,
    createdAt: SYNTHETIC_NOW,
    updatedAt: SYNTHETIC_NOW,
  };
}

function syntheticMessage(role: "user" | "assistant") {
  return {
    id: `synthetic-message-${role}`,
    conversationId: "synthetic-conversation",
    role,
    content: role === "user" ? "Synthetic prompt" : "Synthetic response",
    createdAt: SYNTHETIC_NOW,
  };
}

function syntheticApiCenterConfig() {
  return {
    actorId: SYNTHETIC_E2E_ACTOR_ID,
    defaults: {
      textModelId: "synthetic-text",
      visionModelId: "synthetic-vision",
      imageModelId: "synthetic-image",
      videoModelId: "synthetic-video",
      audioModelId: "synthetic-audio",
    },
    vendors: [
      {
        id: "synthetic-provider",
        name: "Synthetic Provider",
        enabled: true,
        configured: false,
        supportedDomains: ["text", "vision", "image", "video", "audio"],
        models: [
          {
            id: "synthetic-text",
            name: "Synthetic Text",
            domain: "text",
            enabled: true,
            inputPrice: "-",
            outputPrice: "-",
          },
          {
            id: "synthetic-image",
            name: "Synthetic Image",
            domain: "image",
            enabled: true,
            inputPrice: "-",
            outputPrice: "-",
          },
        ],
        providerHealth: {
          status: "unknown",
          checkedAt: null,
          evidenceKind: "staged_evidence",
          isStagedEvidence: true,
        },
      },
    ],
  };
}

function syntheticAsset(input: Record<string, unknown> = {}, index = 1) {
  const mediaUrl = readString(input.mediaUrl, `${SYNTHETIC_STORAGE_ORIGIN}/objects/synthetic-asset-${index}.png`);
  const previewUrl = readString(input.previewUrl, mediaUrl);
  return {
    id: `synthetic-asset-${index}`,
    projectId: "synthetic-project",
    assetType: readString(input.assetType, "image_ref"),
    name: readString(input.name, `Synthetic Asset ${index}`),
    description: readString(input.description, "Synthetic browser interaction asset"),
    previewUrl,
    mediaKind: readString(input.mediaKind, "image"),
    mediaUrl,
    scope: "user:synthetic-e2e-actor",
    sourceModule: input.sourceModule ?? "synthetic",
    sourceMetadata: readRecord(input.sourceMetadata),
    createdAt: SYNTHETIC_NOW,
    updatedAt: SYNTHETIC_NOW,
  };
}

function syntheticImageResult(input: Record<string, unknown> = {}) {
  const prompt = readString(input.prompt, "Synthetic image prompt");
  return {
    id: "synthetic-image-result",
    taskId: "synthetic-create-image-job",
    prompt,
    model: readString(input.model, "doubao-seedream-5-0-260128"),
    style: readString(input.style, "cinematic"),
    aspectRatio: readString(input.aspectRatio, "16:9"),
    resolution: readString(input.resolution, "1K"),
    referenceImageUrl: input.referenceImageUrl ?? null,
    referenceImageUrls: Array.isArray(input.referenceImageUrls) ? input.referenceImageUrls : [],
    batchIndex: 0,
    imageUrl: `${SYNTHETIC_STORAGE_ORIGIN}/objects/synthetic-image-result.png`,
    createdAt: SYNTHETIC_NOW,
  };
}

function syntheticVideoResult(input: Record<string, unknown> = {}) {
  const prompt = readString(input.prompt, "Synthetic video prompt");
  return {
    id: "synthetic-video-result",
    taskId: "synthetic-create-video-job",
    prompt,
    model: readString(input.model, "doubao-seedance-2-0-260128"),
    duration: readString(input.duration, "5s"),
    outputDuration: readString(input.duration, "5s"),
    aspectRatio: readString(input.aspectRatio, "16:9"),
    outputAspectRatio: readString(input.aspectRatio, "16:9"),
    resolution: readString(input.resolution, "720p"),
    outputResolution: readString(input.resolution, "720p"),
    videoUrl: `${SYNTHETIC_STORAGE_ORIGIN}/objects/synthetic-video-result.mp4`,
    thumbnailUrl: `${SYNTHETIC_STORAGE_ORIGIN}/objects/synthetic-video-result.png`,
    createdAt: SYNTHETIC_NOW,
  };
}

function createSyntheticState(): SyntheticState {
  return {
    assets: [],
    imageResults: [],
    videoResults: [],
    jobs: {},
  };
}

function syntheticResponse(body: unknown, status = 200): SyntheticResponse {
  return { body, status };
}

function parseRequestBody(raw: string | null): unknown {
  if (!raw) return undefined;
  try {
    return assertSyntheticFixtureBoundary(JSON.parse(raw));
  } catch {
    return assertSyntheticFixtureBoundary(raw);
  }
}

function isSyntheticApiPath(pathname: string) {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname === "/jaaz-api" ||
    pathname.startsWith("/jaaz-api/") ||
    pathname === "/jaaz" ||
    pathname.startsWith("/jaaz/") ||
    pathname.startsWith("/uploads/") ||
    pathname.startsWith("/canvas-library/") ||
    pathname.startsWith("/twitcanva-api/") ||
    pathname.startsWith("/twitcanva-library/") ||
    pathname.startsWith("/vr-")
  );
}

function responseFor(
  state: SyntheticState,
  pathname: string,
  method: string,
  body: unknown,
  hasAuthorization: boolean,
  options: SyntheticControlApiOptions,
) {
  if (method === "OPTIONS") return {};

  if (pathname === "/api/me" && options.unauthenticatedMe && !hasAuthorization) {
    return syntheticResponse(
      { error: { code: "SYNTHETIC_AUTH_REQUIRED", message: "Synthetic auth required" } },
      401,
    );
  }
  if (pathname === "/api/me") return syntheticPermissionContext();
  if (pathname === "/api/accounts/ensure") return { accountId: SYNTHETIC_E2E_ACTOR_ID, ensured: true };
  if (pathname === "/api/projects") return method === "GET" ? { items: [syntheticProject()], total: 1 } : syntheticProject();
  if (/^\/api\/projects\/[^/]+\/assets$/.test(pathname)) {
    if (method === "GET") return { items: state.assets };
    const asset = syntheticAsset(readRecord(body), state.assets.length + 1);
    state.assets.push(asset);
    return asset;
  }
  if (/^\/api\/projects\/[^/]+\/assets\/[^/]+$/.test(pathname)) {
    return state.assets[0] ?? syntheticAsset();
  }
  if (pathname.startsWith("/api/projects/")) return syntheticProject();
  if (pathname === "/api/canvas-projects" || pathname === "/api/agent-canvas/projects") return { items: [], total: 0 };
  if (pathname.startsWith("/api/canvas-projects/") || pathname.startsWith("/api/agent-canvas/projects/")) return {};

  if (pathname === "/api/capabilities") {
    return {
      service: "synthetic-control-api",
      mode: "synthetic-e2e",
      implementedDomains: ["toolbox", "media", "playground", "projects", "create"],
      toolbox: syntheticToolboxCapabilities(),
    };
  }

  if (pathname === "/api/toolbox/capabilities") {
    return { items: syntheticToolboxCapabilities(), stagingArea: [] };
  }
  if (pathname.startsWith("/api/toolbox/")) {
    const payload = readRecord(body);
    const job = syntheticJob(
      "synthetic-toolbox-job",
      "toolbox_synthetic_run",
      {
        domain: "toolbox",
        actionCode: pathname.split("/").pop() || "toolbox",
        inputSummary: readString(payload.note, "Synthetic toolbox run"),
        ...payload,
      },
      { outputSummary: "Synthetic toolbox result" },
    );
    state.jobs[job.id] = job;
    return {
      taskId: job.id,
      status: job.status,
      job,
      text: "Synthetic toolbox result",
      targetLang: "en",
      imageUrl: `${SYNTHETIC_STORAGE_ORIGIN}/objects/storyboard.png`,
      model: "synthetic-model",
    };
  }

  if (pathname === "/api/playground/config") {
    return { defaultModel: "qwen-plus", models: syntheticModels(), memory: { enabled: true, updatedAt: null } };
  }
  if (pathname === "/api/playground/models") {
    return { defaultModel: "qwen-plus", items: syntheticModels() };
  }
  if (pathname === "/api/playground/conversations") {
    return method === "GET" ? { items: [syntheticConversation()] } : syntheticConversation();
  }
  if (pathname.includes("/messages")) {
    return { items: [syntheticMessage("user"), syntheticMessage("assistant")] };
  }
  if (pathname.startsWith("/api/playground/conversations/")) return syntheticConversation();
  if (pathname === "/api/playground/chat-jobs") {
    const job = syntheticJob("synthetic-playground-job");
    return method === "GET"
      ? { items: [] }
      : {
          conversation: syntheticConversation(),
          userMessage: syntheticMessage("user"),
          assistantMessage: syntheticMessage("assistant"),
          job,
        };
  }
  if (pathname.startsWith("/api/playground/chat-jobs/")) {
    return { job: syntheticJob("synthetic-playground-job") };
  }
  if (pathname === "/api/playground/memories") {
    return { preference: { enabled: true, updatedAt: null }, items: [] };
  }
  if (pathname.startsWith("/api/playground/memories")) {
    return { key: "synthetic-memory", value: "synthetic", enabled: true, updatedAt: SYNTHETIC_NOW };
  }

  if (pathname === "/api/api-center" || pathname === "/api/api-center/defaults") return syntheticApiCenterConfig();
  if (pathname.startsWith("/api/api-center/")) return syntheticApiCenterConfig();

  if (pathname === "/api/wallet" || pathname === "/api/wallets") {
    return {
      items: [],
      wallet: {
        id: "synthetic-wallet",
        ownerType: "user",
        walletOwnerType: "user",
        ownerId: SYNTHETIC_E2E_ACTOR_ID,
        creditsAvailable: 100,
        creditsFrozen: 0,
        currency: "CNY",
        updatedAt: SYNTHETIC_NOW,
      },
    };
  }
  if (pathname === "/api/wallet/usage-stats") {
    return {
      todayUsedCredits: 0,
      monthUsedCredits: 0,
      totalUsedCredits: 0,
      refundedCredits: 0,
      pendingFrozenCredits: 0,
      recentTaskCount: 0,
      lastActivityAt: null,
    };
  }
  if (pathname.startsWith("/api/wallets/")) return {};

  if (pathname === "/api/media/upload-begin") {
    return {
      media_object_id: "synthetic-media-object",
      mediaObjectId: "synthetic-media-object",
      upload_session_id: "synthetic-upload-session",
      uploadSessionId: "synthetic-upload-session",
      upload_url: `${SYNTHETIC_STORAGE_ORIGIN}/upload/synthetic-object`,
      uploadUrl: `${SYNTHETIC_STORAGE_ORIGIN}/upload/synthetic-object`,
      objectKey: "synthetic-object",
      headers: {},
      fileUrl: `${SYNTHETIC_STORAGE_ORIGIN}/objects/synthetic-object`,
    };
  }
  if (pathname === "/api/media/upload-complete" || pathname === "/api/media/move-temp-to-permanent") {
    return { url: `${SYNTHETIC_STORAGE_ORIGIN}/objects/synthetic-object`, fileUrl: `${SYNTHETIC_STORAGE_ORIGIN}/objects/synthetic-object` };
  }
  if (pathname === "/api/media/signed-read-url") {
    return {
      url: `${SYNTHETIC_STORAGE_ORIGIN}/read/synthetic-object`,
      signed_read_url: `${SYNTHETIC_STORAGE_ORIGIN}/read/synthetic-object`,
      signedReadUrl: `${SYNTHETIC_STORAGE_ORIGIN}/read/synthetic-object`,
    };
  }

  if (pathname === "/api/create/images" || pathname === "/api/create/videos") {
    if (method === "GET") {
      return pathname.endsWith("/images")
        ? { items: state.imageResults, total: state.imageResults.length }
        : { items: state.videoResults, total: state.videoResults.length };
    }
    const jobType = pathname.endsWith("/images") ? "create_image_generate" : "create_video_generate";
    const job = syntheticJob("synthetic-create-job", jobType, readRecord(body));
    state.jobs[job.id] = job;
    return { taskId: job.id, status: job.status, job };
  }
  if (pathname.startsWith("/api/create/images/") || pathname.startsWith("/api/create/videos/")) return {};

  if (pathname === "/api/jobs") {
    if (method === "GET") return Object.values(state.jobs);

    const requestBody = readRecord(body);
    const payload = readRecord(requestBody.payload);
    const jobType = readString(requestBody.jobType, readString(payload.jobType, "synthetic_smoke"));
    const jobId =
      jobType === "create_image_generate"
        ? "synthetic-create-image-job"
        : jobType === "create_video_generate"
          ? "synthetic-create-video-job"
          : `synthetic-${jobType.replace(/[^a-z0-9_-]/gi, "-")}-job`;
    const job = syntheticJob(jobId, jobType, payload, { outputSummary: `${jobType} completed` });
    state.jobs[job.id] = job;

    if (jobType === "create_image_generate") {
      state.imageResults = [syntheticImageResult(payload)];
    }
    if (jobType === "create_video_generate") {
      state.videoResults = [syntheticVideoResult(payload)];
    }

    return job;
  }
  if (pathname.startsWith("/api/jobs/")) {
    const jobId = pathname.split("/")[3] || "synthetic-job";
    const job = state.jobs[jobId] ?? syntheticJob(jobId);
    if (pathname.endsWith("/cancel")) {
      const cancelledJob = { ...job, status: "cancelled", cancelled: true };
      state.jobs[jobId] = cancelledJob;
      return cancelledJob;
    }
    return job;
  }

  if (pathname === "/api/auth/providers") return { google: { configured: false } };
  if (pathname === "/api/auth/register/personal" || pathname === "/api/auth/register/enterprise-admin") {
    const permissionContext = syntheticPermissionContext();
    return {
      actorId: SYNTHETIC_E2E_ACTOR_ID,
      token: btoa(`${SYNTHETIC_E2E_ACTOR_ID}:synthetic`),
      displayName: permissionContext.actor.displayName,
      email: permissionContext.actor.email,
      controlApiClientAssertion: "synthetic-e2e-client-assertion",
      permissionContext,
      wallets: [],
      wallet: null,
      organization: pathname.endsWith("/enterprise-admin")
        ? {
            id: "synthetic-org",
            name: "Synthetic Organization",
            status: "active",
            assetLibraryStatus: null,
          }
        : null,
      onboarding: {
        mode: pathname.endsWith("/enterprise-admin") ? "enterprise_admin" : "personal",
        title: "Synthetic registration",
        detail: "Synthetic-only registration response",
        tempPassword: null,
        generatedPassword: false,
      },
    };
  }
  if (pathname.startsWith("/api/auth/")) {
    const permissionContext = syntheticPermissionContext();
    return {
      actorId: SYNTHETIC_E2E_ACTOR_ID,
      token: btoa(`${SYNTHETIC_E2E_ACTOR_ID}:synthetic`),
      displayName: permissionContext.actor.displayName,
      email: permissionContext.actor.email,
      controlApiClientAssertion: "synthetic-e2e-client-assertion",
      permissionContext,
    };
  }

  if (pathname === "/api/admin/pricing-rules") return { items: [] };
  if (pathname === "/api/admin/orders") return { items: [], total: 0 };
  if (pathname.startsWith("/api/admin/")) return {};
  if (pathname === "/api/enterprise-applications") return { items: [], total: 0 };
  if (pathname.startsWith("/api/enterprise-applications/")) return {};

  return { synthetic: true, path: pathname, method };
}

async function fulfillJson(route: Route, value: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(assertSyntheticFixtureBoundary(value)),
    headers: {
      "cache-control": "no-store",
      "x-synthetic-e2e": "true",
    },
  });
}

export async function installSyntheticControlApi(
  page: Page,
  baseURL: string,
  options: SyntheticControlApiOptions = {},
): Promise<SyntheticHarness> {
  const appOrigin = new URL(baseURL).origin;
  const state = createSyntheticState();
  const harness: SyntheticHarness = {
    requests: [],
    storageRequests: [],
    blockedExternalUrls: [],
  };

  if (options.preloadAuth !== false) {
    await page.addInitScript(({ actorId }) => {
      const token = window.btoa(`${actorId}:synthetic-e2e`);
      window.localStorage.setItem("xiaolou-current-actor-id", actorId);
      window.localStorage.setItem("xiaolou-auth-token", token);
      window.localStorage.setItem("xiaolou-control-api-client-assertion", "synthetic-e2e-client-assertion");
      window.localStorage.setItem(
        "xiaolou-known-actors",
        JSON.stringify([
          {
            id: actorId,
            label: "Synthetic E2E Actor",
            detail: "synthetic browser smoke",
            token,
            controlApiClientAssertion: "synthetic-e2e-client-assertion",
          },
        ]),
      );
    }, { actorId: SYNTHETIC_E2E_ACTOR_ID });
  }

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());

    if (url.origin === SYNTHETIC_STORAGE_ORIGIN) {
      harness.storageRequests.push({ method: request.method(), path: `${url.pathname}${url.search}` });
      await route.fulfill({
        status: request.method() === "PUT" ? 200 : 204,
        body: "",
        headers: { "x-synthetic-e2e": "fake-storage" },
      });
      return;
    }

    if (url.origin === appOrigin && isSyntheticApiPath(url.pathname)) {
      const requestBody = parseRequestBody(request.postData());
      harness.requests.push({
        method: request.method(),
        path: `${url.pathname}${url.search}`,
        ...(requestBody !== undefined ? { body: requestBody } : {}),
      });
      const response = responseFor(
        state,
        url.pathname,
        request.method(),
        requestBody,
        Boolean(request.headers().authorization),
        options,
      );
      if (
        response &&
        typeof response === "object" &&
        "status" in response &&
        "body" in response
      ) {
        const { status, body } = response as SyntheticResponse;
        await fulfillJson(route, body, status);
      } else {
        await fulfillJson(route, response);
      }
      return;
    }

    if (url.origin === appOrigin || url.protocol === "data:" || url.protocol === "blob:") {
      await route.continue();
      return;
    }

    harness.blockedExternalUrls.push(url.toString());
    await route.abort("blockedbyclient");
  });

  return harness;
}
