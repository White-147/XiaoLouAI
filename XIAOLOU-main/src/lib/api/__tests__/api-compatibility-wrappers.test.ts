import { afterEach, describe, expect, it, vi } from "vitest";

import type { PermissionContext } from "../../api";

type ApiModule = typeof import("../../api.ts");
type ServiceMethod = ReturnType<typeof vi.fn>;
type MockService = Record<string, ServiceMethod>;

function installBrowserStorageMock() {
  const store = new Map<string, string>();
  const storage = {
    get length() {
      return store.size;
    },
    clear: vi.fn(() => {
      store.clear();
    }),
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
  } satisfies Storage;
  class SyntheticCustomEvent<T = unknown> {
    type: string;
    detail: T | undefined;

    constructor(type: string, init?: CustomEventInit<T>) {
      this.type = type;
      this.detail = init?.detail;
    }
  }

  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("CustomEvent", SyntheticCustomEvent);
  vi.stubGlobal("window", {
    localStorage: storage,
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    location: { origin: "http://127.0.0.1:3000" },
  });
}

function createSelectorPermissionContext(): PermissionContext {
  return {
    actor: {
      id: "user_demo_001",
      displayName: "Synthetic Admin",
      email: "synthetic-admin@example.test",
      phone: null,
      avatar: null,
      platformRole: "customer",
      status: "active",
      defaultOrganizationId: "org-alpha",
    },
    platformRole: "customer",
    organizations: [
      {
        id: "org-alpha",
        name: "Org Alpha",
        role: "enterprise_admin",
        membershipRole: "admin",
        status: "active",
        assetLibraryStatus: "ready",
      },
      {
        id: "org-beta",
        name: "Org Beta",
        role: "enterprise_member",
        membershipRole: "member",
        status: "active",
        assetLibraryStatus: "ready",
      },
    ],
    currentOrganizationId: "org-alpha",
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

function createMockService(serviceName: string, methodNames: string[]) {
  const service: MockService = {};
  for (const methodName of methodNames) {
    service[methodName] = vi.fn(async (...args: unknown[]) => ({
      serviceName,
      methodName,
      args,
    }));
  }
  return service;
}

async function importApiWithMockServices() {
  vi.resetModules();

  const services = {
    adminEnterprise: createMockService("adminEnterprise", [
      "listPricingRules",
      "listAdminOrders",
      "reviewAdminOrder",
    ]),
    authAccount: createMockService("authAccount", [
      "getMe",
      "updateMe",
      "getApiCenterConfig",
      "updateApiCenterDefaults",
      "saveApiCenterVendorApiKey",
      "testApiCenterVendorConnection",
      "updateApiVendorModel",
      "listOrganizationMembers",
      "createOrganizationMember",
      "getOrganizationWallet",
      "loginWithEmail",
      "loginAdminWithEmail",
      "bootstrapPlatformPassword",
      "changePassword",
      "adminResetPassword",
      "requestPasswordReset",
      "completePasswordReset",
      "getAuthProviders",
      "exchangeGoogleLogin",
      "registerPersonalUser",
      "registerEnterpriseAdmin",
    ]),
    jobs: createMockService("jobs", [
      "createCanonicalJob",
      "mapControlJobToTask",
      "listTasks",
      "getTask",
      "dismissTask",
      "deleteTask",
      "clearTasks",
    ]),
    media: createMockService("media", ["uploadFile", "uploadDataUrlAsFile"]),
    playground: createMockService("playground", [
      "getPlaygroundConfig",
      "listPlaygroundModels",
      "listPlaygroundConversations",
      "createPlaygroundConversation",
      "updatePlaygroundConversation",
      "deletePlaygroundConversation",
      "getPlaygroundConversation",
      "listPlaygroundMessages",
      "listPlaygroundChatJobs",
      "getPlaygroundChatJob",
      "startPlaygroundChatJob",
      "runPlaygroundChatFacade",
      "listPlaygroundMemories",
      "updatePlaygroundMemoryPreference",
      "updatePlaygroundMemory",
      "deletePlaygroundMemory",
      "streamPlaygroundChat",
    ]),
    projectsCanvasCreate: createMockService("projectsCanvasCreate", [
      "listProjects",
      "listCreateImages",
      "generateCreateImages",
      "listCreateVideos",
      "generateCreateVideos",
      "deleteCreateImage",
      "deleteCreateVideo",
      "createProject",
      "updateProject",
      "getProject",
      "getProjectOverview",
      "getSettings",
      "updateSettings",
      "getScript",
      "updateScript",
      "rewriteScript",
      "listAssets",
      "getAsset",
      "createAsset",
      "syncAgentStudioAsset",
      "syncAgentStudioCanvasProject",
      "updateAsset",
      "deleteAsset",
      "extractAssets",
      "generateAssetImage",
      "listStoryboards",
      "getStoryboard",
      "updateStoryboard",
      "deleteStoryboard",
      "autoGenerateStoryboards",
      "getCreateCreditQuote",
      "getProjectCreditQuote",
      "generateStoryboardImage",
      "listVideos",
      "generateVideo",
      "listDubbings",
      "updateDubbing",
      "generateDubbing",
      "generateLipSync",
      "getTimeline",
      "updateTimeline",
      "createExport",
      "getCreateImageCapabilities",
      "getCreateVideoCapabilities",
      "listCanvasProjects",
      "getCanvasProject",
      "saveCanvasProject",
      "deleteCanvasProject",
      "listAgentCanvasProjects",
      "getAgentCanvasProject",
      "saveAgentCanvasProject",
      "deleteAgentCanvasProject",
    ]),
    toolbox: createMockService("toolbox", [
      "getToolboxCapabilities",
      "getCapabilities",
      "translateText",
      "generateStoryboardGrid25",
      "reverseVideoPrompt",
      "runToolboxCapability",
    ]),
    walletPayment: createMockService("walletPayment", [
      "getWallet",
      "listWallets",
      "listWalletLedger",
      "getWalletUsageStats",
      "searchCreditUsageSubjects",
      "getAdminCreditUsageStats",
      "createWalletRechargeOrder",
      "getWalletRechargeCapabilities",
      "getWalletRechargeOrder",
      "refreshWalletRechargeOrderStatus",
      "submitWalletRechargeTransferProof",
      "confirmWalletRechargeOrder",
    ]),
  };

  const factories = {
    createAdminEnterpriseService: vi.fn((_deps?: unknown) => services.adminEnterprise),
    createAuthAccountService: vi.fn((_deps?: unknown) => services.authAccount),
    createJobsService: vi.fn((_deps?: unknown) => services.jobs),
    createMediaService: vi.fn((_deps?: unknown) => services.media),
    createPlaygroundService: vi.fn((_deps?: unknown) => services.playground),
    createProjectsCanvasCreateService: vi.fn((_deps?: unknown) => services.projectsCanvasCreate),
    createToolboxService: vi.fn((_deps?: unknown) => services.toolbox),
    createWalletPaymentService: vi.fn((_deps?: unknown) => services.walletPayment),
  };

  vi.doMock("../../api/admin-enterprise", () => ({
    createAdminEnterpriseService: factories.createAdminEnterpriseService,
  }));
  vi.doMock("../../api/auth-account", () => ({
    createAuthAccountService: factories.createAuthAccountService,
  }));
  vi.doMock("../../api/jobs", () => ({
    createJobsService: factories.createJobsService,
  }));
  vi.doMock("../../api/media", () => ({
    createMediaService: factories.createMediaService,
  }));
  vi.doMock("../../api/playground", () => ({
    createPlaygroundService: factories.createPlaygroundService,
  }));
  vi.doMock("../../api/projects-canvas-create", () => ({
    createProjectsCanvasCreateService: factories.createProjectsCanvasCreateService,
  }));
  vi.doMock("../../api/toolbox", () => ({
    createToolboxService: factories.createToolboxService,
  }));
  vi.doMock("../../api/wallet-payment", () => ({
    createWalletPaymentService: factories.createWalletPaymentService,
  }));

  const api = (await import("../../api.ts")) as ApiModule;
  return { api, factories, services };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("api.ts compatibility wrappers", () => {
  it("keeps selected public facade exports callable", async () => {
    const { api } = await importApiWithMockServices();

    const expectedFunctionExports = [
      "getMe",
      "updateMe",
      "listProjects",
      "listTasks",
      "getTask",
      "dismissTask",
      "deleteTask",
      "clearTasks",
      "getWallet",
      "listWallets",
      "uploadFile",
      "uploadDataUrlAsFile",
      "listPricingRules",
      "reviewAdminOrder",
      "listPlaygroundConversations",
      "startPlaygroundChatJob",
      "runPlaygroundChatFacade",
      "streamPlaygroundChat",
      "bootstrapPlatformPassword",
      "changePassword",
      "adminResetPassword",
      "requestPasswordReset",
      "completePasswordReset",
      "listCanvasProjects",
      "saveCanvasProject",
      "translateText",
      "generateStoryboardGrid25",
      "reverseVideoPrompt",
      "runToolboxCapability",
      "generateCreateImages",
      "ApiRequestError",
    ];

    for (const exportName of expectedFunctionExports) {
      expect(typeof api[exportName as keyof ApiModule]).toBe("function");
    }
  });

  it("wires wrapper services through the existing factory boundaries", async () => {
    const { api, factories, services } = await importApiWithMockServices();

    expect(factories.createWalletPaymentService).toHaveBeenCalledOnce();
    expect(factories.createAuthAccountService).toHaveBeenCalledOnce();
    expect(factories.createJobsService).toHaveBeenCalledOnce();
    expect(factories.createMediaService).toHaveBeenCalledOnce();
    expect(factories.createPlaygroundService).toHaveBeenCalledOnce();
    expect(factories.createProjectsCanvasCreateService).toHaveBeenCalledOnce();
    expect(factories.createToolboxService).toHaveBeenCalledOnce();
    expect(factories.createAdminEnterpriseService).toHaveBeenCalledOnce();

    expect(factories.createAuthAccountService.mock.calls[0][0]).toMatchObject({
      controlApiJsonRequest: expect.any(Function),
      resolveCurrentOwnerScope: expect.any(Function),
      getWallet: api.getWallet,
    });
    expect(factories.createWalletPaymentService.mock.calls[0][0]).toMatchObject({
      controlApiJsonRequest: expect.any(Function),
      getCurrentActorId: expect.any(Function),
      resolveCurrentOwnerScope: expect.any(Function),
    });
    expect(factories.createPlaygroundService.mock.calls[0][0]).toMatchObject({
      controlApiJsonRequest: expect.any(Function),
      controlApiStreamRequest: expect.any(Function),
      getCurrentActorId: expect.any(Function),
      resolveCurrentOwnerScope: expect.any(Function),
      createApiRequestError: expect.any(Function),
      hasSessionCredentials: expect.any(Function),
      isAuthBoundaryError: expect.any(Function),
    });
    expect(factories.createProjectsCanvasCreateService.mock.calls[0][0]).toMatchObject({
      controlApiJsonRequest: expect.any(Function),
      getCurrentActorId: expect.any(Function),
      resolveCurrentOwnerScope: expect.any(Function),
      createCanonicalJob: services.jobs.createCanonicalJob,
    });
    expect(factories.createToolboxService.mock.calls[0][0]).toMatchObject({
      controlApiJsonRequest: expect.any(Function),
      getCurrentActorId: expect.any(Function),
      resolveCurrentOwnerScope: expect.any(Function),
      mapControlJobToTask: services.jobs.mapControlJobToTask,
    });
    expect(factories.createJobsService.mock.calls[0][0]).toMatchObject({
      controlApiJsonRequest: expect.any(Function),
      getCurrentActorId: expect.any(Function),
      resolveCurrentOwnerScope: expect.any(Function),
      createClientId: expect.any(Function),
      isNotFoundError: expect.any(Function),
    });
    expect(factories.createMediaService.mock.calls[0][0]).toMatchObject({
      controlApiJsonRequest: expect.any(Function),
      getCurrentActorId: expect.any(Function),
      resolveCurrentOwnerScope: expect.any(Function),
      createClientId: expect.any(Function),
      createApiRequestError: expect.any(Function),
    });
  });

  it("lets stable service resolvers use an explicit current organization selection", async () => {
    installBrowserStorageMock();
    const { factories } = await importApiWithMockServices();
    const { setCurrentActorId } = await import("../../actor-session");
    const { setCurrentOrganizationSelection } = await import("../../current-organization-context");
    const context = createSelectorPermissionContext();
    setCurrentActorId(context.actor.id);
    setCurrentOrganizationSelection(context, "org-beta");

    const authDeps = factories.createAuthAccountService.mock.calls[0][0] as {
      resolveCurrentOwnerScope: () => unknown;
    };
    const walletDeps = factories.createWalletPaymentService.mock.calls[0][0] as {
      resolveCurrentOwnerScope: () => unknown;
    };
    const toolboxDeps = factories.createToolboxService.mock.calls[0][0] as {
      resolveCurrentOwnerScope: () => unknown;
    };

    const expectedScope = {
      accountOwnerType: "organization",
      accountOwnerId: "org-beta",
      organizationId: "org-beta",
      organizationRole: "enterprise_member",
      source: "current-organization",
    };

    expect(authDeps.resolveCurrentOwnerScope()).toEqual(expectedScope);
    expect(walletDeps.resolveCurrentOwnerScope()).toEqual(expectedScope);
    expect(toolboxDeps.resolveCurrentOwnerScope()).toEqual(expectedScope);
  });

  it("forwards low-risk wrapper arguments to service methods without reshaping them", async () => {
    const { api, services } = await importApiWithMockServices();
    const mePatch = {
      displayName: "Synthetic User",
      avatar: null,
      phone: "13800000000",
      defaultOrganizationId: "org_synthetic_001",
    };
    const apiCenterDefaultsPatch = {
      textModelId: "synthetic-text-model",
    };
    const file = new File(["synthetic bytes"], "synthetic-upload.png", { type: "image/png" });
    const imageInput = {
      projectId: "synthetic-project",
      prompt: "Synthetic image prompt",
      idempotencyKey: "synthetic-image-key",
    };
    const chatInput = {
      conversationId: "synthetic-conversation",
      message: "Synthetic chat",
      model: "qwen-plus",
    };
    const onChatEvent = vi.fn();
    const signal = new AbortController().signal;
    const taskId = "synthetic-task/1";
    const canvasInput = {
      id: "synthetic canvas/1",
      title: "Synthetic Canvas",
      canvasData: { nodes: [{ id: "node-1" }] },
      expectedUpdatedAt: null,
    };
    const toolboxInput = {
      projectId: "synthetic-project",
      target: "synthetic target",
      note: "synthetic note",
    };
    const passwordChangeInput = {
      currentPassword: "synthetic-current-password",
      newPassword: "synthetic-new-password",
    };
    const passwordBootstrapInput = {
      email: "ops@xiaolou.local",
      password: "synthetic-bootstrap-password",
    };
    const passwordAdminResetInput = {
      email: "synthetic@example.test",
      newPassword: "synthetic-reset-password",
    };
    const passwordResetRequestInput = {
      email: "synthetic@example.test",
    };
    const passwordResetCompleteInput = {
      resetToken: "synthetic-reset-token",
      newPassword: "synthetic-token-reset-password",
    };
    const storyboardReferences = [
      {
        name: "synthetic-reference",
        url: "https://synthetic.example/reference.png",
      },
    ];

    await expect(api.updateMe(mePatch)).resolves.toEqual({
      serviceName: "authAccount",
      methodName: "updateMe",
      args: [mePatch],
    });
    await expect(api.getApiCenterConfig()).resolves.toEqual({
      serviceName: "authAccount",
      methodName: "getApiCenterConfig",
      args: [],
    });
    await expect(api.updateApiCenterDefaults(apiCenterDefaultsPatch)).resolves.toEqual({
      serviceName: "authAccount",
      methodName: "updateApiCenterDefaults",
      args: [apiCenterDefaultsPatch],
    });
    await expect(api.saveApiCenterVendorApiKey("synthetic-vendor", "synthetic-api-key")).resolves.toEqual({
      serviceName: "authAccount",
      methodName: "saveApiCenterVendorApiKey",
      args: ["synthetic-vendor", "synthetic-api-key"],
    });
    await expect(api.testApiCenterVendorConnection("synthetic-vendor")).resolves.toEqual({
      serviceName: "authAccount",
      methodName: "testApiCenterVendorConnection",
      args: ["synthetic-vendor"],
    });
    await expect(api.updateApiVendorModel("synthetic-vendor", "synthetic-model", { enabled: true })).resolves.toEqual({
      serviceName: "authAccount",
      methodName: "updateApiVendorModel",
      args: ["synthetic-vendor", "synthetic-model", { enabled: true }],
    });
    await expect(api.bootstrapPlatformPassword(passwordBootstrapInput)).resolves.toEqual({
      serviceName: "authAccount",
      methodName: "bootstrapPlatformPassword",
      args: [passwordBootstrapInput],
    });
    await expect(api.changePassword(passwordChangeInput)).resolves.toEqual({
      serviceName: "authAccount",
      methodName: "changePassword",
      args: [passwordChangeInput],
    });
    await expect(api.adminResetPassword(passwordAdminResetInput)).resolves.toEqual({
      serviceName: "authAccount",
      methodName: "adminResetPassword",
      args: [passwordAdminResetInput],
    });
    await expect(api.requestPasswordReset(passwordResetRequestInput)).resolves.toEqual({
      serviceName: "authAccount",
      methodName: "requestPasswordReset",
      args: [passwordResetRequestInput],
    });
    await expect(api.completePasswordReset(passwordResetCompleteInput)).resolves.toEqual({
      serviceName: "authAccount",
      methodName: "completePasswordReset",
      args: [passwordResetCompleteInput],
    });
    await expect(api.listTasks("synthetic-project", "image.render")).resolves.toEqual({
      serviceName: "jobs",
      methodName: "listTasks",
      args: ["synthetic-project", "image.render"],
    });
    await expect(api.dismissTask(taskId)).resolves.toEqual({
      serviceName: "jobs",
      methodName: "dismissTask",
      args: [taskId],
    });
    await expect(api.deleteTask(taskId)).resolves.toEqual({
      serviceName: "jobs",
      methodName: "dismissTask",
      args: [taskId],
    });
    await expect(api.listWallets()).resolves.toEqual({
      serviceName: "walletPayment",
      methodName: "listWallets",
      args: [undefined, undefined],
    });
    await expect(api.getWallet("organization", "synthetic-organization")).resolves.toEqual({
      serviceName: "walletPayment",
      methodName: "getWallet",
      args: ["organization", "synthetic-organization"],
    });
    await expect(api.getWalletUsageStats()).resolves.toEqual({
      serviceName: "walletPayment",
      methodName: "getWalletUsageStats",
      args: [undefined, undefined],
    });
    await expect(api.uploadFile(file, "image")).resolves.toEqual({
      serviceName: "media",
      methodName: "uploadFile",
      args: [file, "image"],
    });
    await expect(api.generateCreateImages(imageInput)).resolves.toEqual({
      serviceName: "projectsCanvasCreate",
      methodName: "generateCreateImages",
      args: [imageInput],
    });
    await expect(api.runPlaygroundChatFacade(chatInput, onChatEvent, signal)).resolves.toEqual({
      serviceName: "playground",
      methodName: "runPlaygroundChatFacade",
      args: [chatInput, onChatEvent, signal],
    });
    await expect(api.streamPlaygroundChat(chatInput, onChatEvent, signal)).resolves.toEqual({
      serviceName: "playground",
      methodName: "streamPlaygroundChat",
      args: [chatInput, onChatEvent, signal],
    });
    await expect(api.saveCanvasProject(canvasInput)).resolves.toEqual({
      serviceName: "projectsCanvasCreate",
      methodName: "saveCanvasProject",
      args: [canvasInput],
    });
    await expect(api.translateText("Synthetic source text", "zh")).resolves.toEqual({
      serviceName: "toolbox",
      methodName: "translateText",
      args: ["Synthetic source text", "zh"],
    });
    await expect(
      api.generateStoryboardGrid25("Synthetic plot text", {
        references: storyboardReferences,
        model: "synthetic-storyboard-model",
      }),
    ).resolves.toEqual({
      serviceName: "toolbox",
      methodName: "generateStoryboardGrid25",
      args: [
        "Synthetic plot text",
        {
          references: storyboardReferences,
          model: "synthetic-storyboard-model",
        },
      ],
    });
    await expect(
      api.reverseVideoPrompt("https://synthetic.example/video.mp4", {
        model: "qwen3.5-omni-plus",
      }),
    ).resolves.toEqual({
      serviceName: "toolbox",
      methodName: "reverseVideoPrompt",
      args: [
        "https://synthetic.example/video.mp4",
        {
          model: "qwen3.5-omni-plus",
        },
      ],
    });
    await expect(api.runToolboxCapability("character_replace", toolboxInput)).resolves.toEqual({
      serviceName: "toolbox",
      methodName: "runToolboxCapability",
      args: ["character_replace", toolboxInput],
    });

    expect(services.authAccount.updateMe).toHaveBeenCalledWith(mePatch);
    expect(services.authAccount.getApiCenterConfig).toHaveBeenCalledWith();
    expect(services.authAccount.updateApiCenterDefaults).toHaveBeenCalledWith(apiCenterDefaultsPatch);
    expect(services.authAccount.saveApiCenterVendorApiKey).toHaveBeenCalledWith(
      "synthetic-vendor",
      "synthetic-api-key",
    );
    expect(services.authAccount.testApiCenterVendorConnection).toHaveBeenCalledWith("synthetic-vendor");
    expect(services.authAccount.updateApiVendorModel).toHaveBeenCalledWith(
      "synthetic-vendor",
      "synthetic-model",
      { enabled: true },
    );
    expect(services.authAccount.bootstrapPlatformPassword).toHaveBeenCalledWith(passwordBootstrapInput);
    expect(services.authAccount.changePassword).toHaveBeenCalledWith(passwordChangeInput);
    expect(services.authAccount.adminResetPassword).toHaveBeenCalledWith(passwordAdminResetInput);
    expect(services.authAccount.requestPasswordReset).toHaveBeenCalledWith(passwordResetRequestInput);
    expect(services.authAccount.completePasswordReset).toHaveBeenCalledWith(passwordResetCompleteInput);
    expect(services.jobs.listTasks).toHaveBeenCalledWith("synthetic-project", "image.render");
    expect(services.jobs.dismissTask).toHaveBeenCalledTimes(2);
    expect(services.jobs.dismissTask).toHaveBeenCalledWith(taskId);
    expect(services.jobs.deleteTask).not.toHaveBeenCalled();
    expect(services.walletPayment.listWallets).toHaveBeenCalledWith(undefined, undefined);
    expect(services.walletPayment.getWallet).toHaveBeenCalledWith("organization", "synthetic-organization");
    expect(services.walletPayment.getWalletUsageStats).toHaveBeenCalledWith(undefined, undefined);
    expect(services.media.uploadFile).toHaveBeenCalledWith(file, "image");
    expect(services.projectsCanvasCreate.generateCreateImages).toHaveBeenCalledWith(imageInput);
    expect(services.playground.runPlaygroundChatFacade).toHaveBeenCalledTimes(1);
    expect(services.playground.runPlaygroundChatFacade).toHaveBeenCalledWith(chatInput, onChatEvent, signal);
    expect(services.playground.streamPlaygroundChat).toHaveBeenCalledWith(chatInput, onChatEvent, signal);
    expect(services.projectsCanvasCreate.saveCanvasProject).toHaveBeenCalledWith(canvasInput);
    expect(services.toolbox.translateText).toHaveBeenCalledWith("Synthetic source text", "zh");
    expect(services.toolbox.generateStoryboardGrid25).toHaveBeenCalledWith("Synthetic plot text", {
      references: storyboardReferences,
      model: "synthetic-storyboard-model",
    });
    expect(services.toolbox.reverseVideoPrompt).toHaveBeenCalledWith("https://synthetic.example/video.mp4", {
      model: "qwen3.5-omni-plus",
    });
    expect(services.toolbox.runToolboxCapability).toHaveBeenCalledWith("character_replace", toolboxInput);
  });

  it("preserves service fallback results and ApiRequestError rejections at the facade", async () => {
    const { api, services } = await importApiWithMockServices();
    const fallbackWallet = {
      id: "synthetic-empty-organization-wallet",
      ownerType: "organization",
      ownerId: "synthetic-organization",
      creditsAvailable: 0,
      creditsFrozen: 0,
      currency: "CNY",
      updatedAt: "2026-05-05T00:00:00.000Z",
    };
    services.authAccount.getOrganizationWallet.mockResolvedValueOnce(fallbackWallet);

    await expect(api.getOrganizationWallet("synthetic-organization")).resolves.toBe(fallbackWallet);
    expect(services.authAccount.getOrganizationWallet).toHaveBeenCalledWith("synthetic-organization");

    const retiredError = new api.ApiRequestError("Synthetic payment writes are retired", {
      code: "PAYMENT_RETIRED",
      status: 410,
    });
    services.walletPayment.createWalletRechargeOrder.mockRejectedValueOnce(retiredError);
    const rechargeInput = {
      planId: "synthetic-plan",
      planName: "Synthetic Plan",
      billingCycle: "monthly",
      paymentMethod: "wechat_pay",
      amount: 100,
      credits: 1000,
    } satisfies Parameters<ApiModule["createWalletRechargeOrder"]>[0];

    await expect(api.createWalletRechargeOrder(rechargeInput)).rejects.toBe(retiredError);
    expect(retiredError.status).toBe(410);
    expect(retiredError.code).toBe("PAYMENT_RETIRED");
    expect(services.walletPayment.createWalletRechargeOrder).toHaveBeenCalledWith(rechargeInput);
  });
});
