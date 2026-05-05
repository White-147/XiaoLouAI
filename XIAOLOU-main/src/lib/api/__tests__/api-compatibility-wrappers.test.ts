import { afterEach, describe, expect, it, vi } from "vitest";

type ApiModule = typeof import("../../api.ts");
type ServiceMethod = ReturnType<typeof vi.fn>;
type MockService = Record<string, ServiceMethod>;

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
    createAdminEnterpriseService: vi.fn(() => services.adminEnterprise),
    createAuthAccountService: vi.fn(() => services.authAccount),
    createJobsService: vi.fn(() => services.jobs),
    createMediaService: vi.fn(() => services.media),
    createPlaygroundService: vi.fn(() => services.playground),
    createProjectsCanvasCreateService: vi.fn(() => services.projectsCanvasCreate),
    createToolboxService: vi.fn(() => services.toolbox),
    createWalletPaymentService: vi.fn(() => services.walletPayment),
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
      "streamPlaygroundChat",
      "listCanvasProjects",
      "saveCanvasProject",
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
      getWallet: api.getWallet,
    });
    expect(factories.createProjectsCanvasCreateService.mock.calls[0][0]).toMatchObject({
      createCanonicalJob: services.jobs.createCanonicalJob,
    });
    expect(factories.createToolboxService.mock.calls[0][0]).toMatchObject({
      mapControlJobToTask: services.jobs.mapControlJobToTask,
    });
    expect(factories.createMediaService.mock.calls[0][0]).toMatchObject({
      controlApiJsonRequest: expect.any(Function),
      getCurrentActorId: expect.any(Function),
      buildControlMediaScope: expect.any(Function),
      createClientId: expect.any(Function),
      createApiRequestError: expect.any(Function),
    });
  });

  it("forwards low-risk wrapper arguments to service methods without reshaping them", async () => {
    const { api, services } = await importApiWithMockServices();
    const mePatch = { displayName: "Synthetic User", avatar: null };
    const file = new File(["synthetic bytes"], "synthetic-upload.png", { type: "image/png" });
    const imageInput = {
      projectId: "synthetic-project",
      prompt: "Synthetic image prompt",
      idempotencyKey: "synthetic-image-key",
    };
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

    await expect(api.updateMe(mePatch)).resolves.toEqual({
      serviceName: "authAccount",
      methodName: "updateMe",
      args: [mePatch],
    });
    await expect(api.listTasks("synthetic-project", "image.render")).resolves.toEqual({
      serviceName: "jobs",
      methodName: "listTasks",
      args: ["synthetic-project", "image.render"],
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
    await expect(api.saveCanvasProject(canvasInput)).resolves.toEqual({
      serviceName: "projectsCanvasCreate",
      methodName: "saveCanvasProject",
      args: [canvasInput],
    });
    await expect(api.runToolboxCapability("character_replace", toolboxInput)).resolves.toEqual({
      serviceName: "toolbox",
      methodName: "runToolboxCapability",
      args: ["character_replace", toolboxInput],
    });

    expect(services.authAccount.updateMe).toHaveBeenCalledWith(mePatch);
    expect(services.jobs.listTasks).toHaveBeenCalledWith("synthetic-project", "image.render");
    expect(services.media.uploadFile).toHaveBeenCalledWith(file, "image");
    expect(services.projectsCanvasCreate.generateCreateImages).toHaveBeenCalledWith(imageInput);
    expect(services.projectsCanvasCreate.saveCanvasProject).toHaveBeenCalledWith(canvasInput);
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
      amountCents: 100,
      paymentMethod: "wechat_pay",
    } as Parameters<ApiModule["createWalletRechargeOrder"]>[0];

    await expect(api.createWalletRechargeOrder(rechargeInput)).rejects.toBe(retiredError);
    expect(retiredError.status).toBe(410);
    expect(retiredError.code).toBe("PAYMENT_RETIRED");
    expect(services.walletPayment.createWalletRechargeOrder).toHaveBeenCalledWith(rechargeInput);
  });
});
