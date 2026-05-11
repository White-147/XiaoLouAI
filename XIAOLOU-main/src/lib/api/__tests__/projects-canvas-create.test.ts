import { describe, expect, it } from "vitest";
import type { Task } from "../../api";
import type { ControlOwnerScope } from "../../control-owner-scope";
import { createJobsService } from "../jobs";
import { createProjectsCanvasCreateService } from "../projects-canvas-create";
import {
  parseJsonBody,
  SYNTHETIC_ACTOR_ID,
  SYNTHETIC_CREATED_AT,
  SYNTHETIC_UPDATED_AT,
  type RequestCall,
  type RequestHandler,
} from "./synthetic-fixtures";

type ProjectsCanvasCreateServiceDeps = Parameters<typeof createProjectsCanvasCreateService>[0];
type CanonicalJobInput = Parameters<ProjectsCanvasCreateServiceDeps["createCanonicalJob"]>[0];

function createSyntheticOwnerScope(
  overrides: Partial<ControlOwnerScope> = {},
): ControlOwnerScope {
  return {
    accountOwnerType: "user",
    accountOwnerId: SYNTHETIC_ACTOR_ID,
    organizationId: null,
    organizationRole: null,
    source: "personal-default",
    ...overrides,
  };
}

function createSyntheticOrganizationOwnerScope(
  organizationId = "synthetic-org/one",
): ControlOwnerScope {
  return createSyntheticOwnerScope({
    accountOwnerType: "organization",
    accountOwnerId: organizationId,
    organizationId,
    organizationRole: "enterprise_admin",
    source: "current-organization",
  });
}

function createSyntheticTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "synthetic-task",
    type: "synthetic.job",
    domain: "project",
    projectId: "synthetic-project",
    storyboardId: null,
    actorId: SYNTHETIC_ACTOR_ID,
    actionCode: "synthetic_action",
    walletId: null,
    status: "queued",
    progressPercent: 0,
    currentStage: "queued",
    etaSeconds: 0,
    inputSummary: "Synthetic input",
    outputSummary: null,
    metadata: {},
    createdAt: SYNTHETIC_CREATED_AT,
    updatedAt: SYNTHETIC_UPDATED_AT,
    ...overrides,
  };
}

function createServiceHarness({
  actorId = SYNTHETIC_ACTOR_ID,
  ownerScope,
  handler = () => ({}),
}: {
  actorId?: string;
  ownerScope?: ControlOwnerScope;
  handler?: RequestHandler;
} = {}) {
  const calls: RequestCall[] = [];
  const canonicalJobCalls: CanonicalJobInput[] = [];
  const ownerScopeCalls: ControlOwnerScope[] = [];
  const resolvedOwnerScope =
    ownerScope ?? createSyntheticOwnerScope({ accountOwnerId: actorId });

  const deps: ProjectsCanvasCreateServiceDeps = {
    controlApiJsonRequest: async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      return (await handler(path, init)) as T;
    },
    getCurrentActorId: () => actorId,
    resolveCurrentOwnerScope: () => {
      ownerScopeCalls.push(resolvedOwnerScope);
      return resolvedOwnerScope;
    },
    createCanonicalJob: async (input) => {
      canonicalJobCalls.push(input);
      return {
        taskId: `synthetic-${input.jobType}-task`,
        status: "queued",
        task: createSyntheticTask({
          id: `synthetic-${input.jobType}-task`,
          type: input.jobType,
          domain: input.domain,
          actionCode: input.actionCode ?? input.jobType,
          inputSummary: input.inputSummary ?? null,
          metadata: {
            payload: input.payload,
            idempotencyKey: input.idempotencyKey ?? null,
          },
        }),
      };
    },
  };

  return {
    calls,
    canonicalJobCalls,
    ownerScopeCalls,
    service: createProjectsCanvasCreateService(deps),
  };
}

describe("createProjectsCanvasCreateService", () => {
  it("routes project list/create/update/read operations through stable paths and scoped bodies", async () => {
    const project = {
      id: "synthetic project/one",
      title: "Synthetic project",
      summary: "Synthetic summary",
      status: "draft",
      coverUrl: null,
      organizationId: null,
      currentStep: "script",
      progressPercent: 10,
      budgetCredits: 0,
      directorAgentName: "Synthetic director",
      createdAt: "2026-05-05T00:00:00.000Z",
      updatedAt: "2026-05-05T00:01:00.000Z",
    };
    const harness = createServiceHarness({
      actorId: "synthetic actor/with space",
      handler: (path) => {
        if (path.startsWith("/api/projects?")) return { items: [project], total: 1, page: 1, pageSize: 20 };
        return project;
      },
    });

    await expect(harness.service.listProjects()).resolves.toEqual({
      items: [project],
      total: 1,
      page: 1,
      pageSize: 20,
    });
    await expect(
      harness.service.createProject({
        title: "Synthetic create",
        summary: "Synthetic body",
        ownerType: "personal",
      }),
    ).resolves.toBe(project);
    await expect(
      harness.service.updateProject("synthetic project/one", {
        title: "Synthetic update",
        progressPercent: 42,
      }),
    ).resolves.toBe(project);
    await expect(harness.service.getProject("synthetic project/one")).resolves.toBe(project);
    await expect(harness.service.getProjectOverview("synthetic project/one")).resolves.toBe(project);

    expect(harness.calls.map((call) => call.path)).toEqual([
      "/api/projects?accountOwnerType=user&accountOwnerId=synthetic+actor%2Fwith+space",
      "/api/projects",
      "/api/projects/synthetic%20project%2Fone",
      "/api/projects/synthetic%20project%2Fone",
      "/api/projects/synthetic%20project%2Fone/overview",
    ]);
    expect(harness.ownerScopeCalls).toHaveLength(3);
    expect(harness.calls[1].init?.method).toBe("POST");
    expect(parseJsonBody(harness.calls[1])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic actor/with space",
      regionCode: "CN",
      currency: "CNY",
      title: "Synthetic create",
      summary: "Synthetic body",
      ownerType: "personal",
    });
    expect(harness.calls[2].init?.method).toBe("PUT");
    expect(parseJsonBody(harness.calls[2])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic actor/with space",
      regionCode: "CN",
      currency: "CNY",
      title: "Synthetic update",
      progressPercent: 42,
      id: "synthetic project/one",
    });
  });

  it("mirrors organization owner scope into project list and write requests", async () => {
    const organizationScope = createSyntheticOrganizationOwnerScope();
    const project = {
      id: "synthetic-project",
      title: "Synthetic organization project",
      summary: null,
      status: "draft",
      coverUrl: null,
      organizationId: organizationScope.organizationId,
      currentStep: "script",
      progressPercent: 0,
      budgetCredits: 0,
      directorAgentName: "Synthetic director",
      createdAt: SYNTHETIC_CREATED_AT,
      updatedAt: SYNTHETIC_UPDATED_AT,
    };
    const harness = createServiceHarness({
      actorId: "synthetic-org-actor",
      ownerScope: organizationScope,
      handler: (path) => {
        if (path.startsWith("/api/projects?")) return { items: [project], total: 1 };
        return project;
      },
    });

    await harness.service.listProjects();
    await harness.service.createProject({
      title: "Synthetic organization create",
      ownerType: "organization",
      organizationId: organizationScope.organizationId ?? undefined,
    });
    await harness.service.updateProject("synthetic-project", {
      title: "Synthetic organization update",
    });

    expect(harness.calls.map((call) => [call.path, call.init?.method ?? "GET"])).toEqual([
      ["/api/projects?accountOwnerType=organization&accountOwnerId=synthetic-org%2Fone", "GET"],
      ["/api/projects", "POST"],
      ["/api/projects/synthetic-project", "PUT"],
    ]);
    expect(parseJsonBody(harness.calls[1])).toMatchObject({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-org/one",
      regionCode: "CN",
      currency: "CNY",
      title: "Synthetic organization create",
      ownerType: "organization",
      organizationId: "synthetic-org/one",
    });
    expect(parseJsonBody(harness.calls[2])).toMatchObject({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-org/one",
      regionCode: "CN",
      currency: "CNY",
      title: "Synthetic organization update",
      id: "synthetic-project",
    });
  });

  it("routes settings, script, asset, storyboard, and timeline resources without real persistence", async () => {
    const harness = createServiceHarness({
      handler: (path) => ({ id: "synthetic-response", projectId: "synthetic project/one", path }),
    });

    await harness.service.getSettings("synthetic project/one");
    await harness.service.updateSettings("synthetic project/one", { tone: "Synthetic tone" });
    await harness.service.getScript("synthetic project/one");
    await harness.service.updateScript("synthetic project/one", "Synthetic script");
    await harness.service.listAssets("synthetic project/one", "image_ref");
    await harness.service.getAsset("synthetic project/one", "asset/one");
    await harness.service.createAsset("synthetic project/one", {
      assetType: "image_ref",
      name: "Synthetic asset",
      mediaUrl: "https://synthetic.invalid/media.png",
    });
    await harness.service.updateAsset("synthetic project/one", "asset/one", {
      name: "Synthetic asset update",
    });
    await harness.service.deleteAsset("synthetic project/one", "asset/one");
    await harness.service.listStoryboards("synthetic project/one", 3);
    await harness.service.getStoryboard("synthetic project/one", "storyboard/one");
    await harness.service.updateStoryboard("synthetic project/one", "storyboard/one", {
      title: "Synthetic storyboard update",
    });
    await harness.service.deleteStoryboard("synthetic project/one", "storyboard/one");
    await harness.service.getTimeline("synthetic project/one");
    await harness.service.updateTimeline("synthetic project/one", {
      tracks: [],
      totalDurationSeconds: 12,
    });
    await harness.service.createExport("synthetic project/one");

    expect(harness.calls.map((call) => [call.path, call.init?.method ?? "GET"])).toEqual([
      ["/api/projects/synthetic%20project%2Fone/settings", "GET"],
      ["/api/projects/synthetic%20project%2Fone/settings", "PUT"],
      ["/api/projects/synthetic%20project%2Fone/script", "GET"],
      ["/api/projects/synthetic%20project%2Fone/script", "PUT"],
      ["/api/projects/synthetic%20project%2Fone/assets?assetType=image_ref", "GET"],
      ["/api/projects/synthetic%20project%2Fone/assets/asset%2Fone", "GET"],
      ["/api/projects/synthetic%20project%2Fone/assets", "POST"],
      ["/api/projects/synthetic%20project%2Fone/assets/asset%2Fone", "PUT"],
      ["/api/projects/synthetic%20project%2Fone/assets/asset%2Fone", "DELETE"],
      ["/api/projects/synthetic%20project%2Fone/storyboards?episodeNo=3", "GET"],
      ["/api/projects/synthetic%20project%2Fone/storyboards/storyboard%2Fone", "GET"],
      ["/api/projects/synthetic%20project%2Fone/storyboards/storyboard%2Fone", "PUT"],
      ["/api/projects/synthetic%20project%2Fone/storyboards/storyboard%2Fone", "DELETE"],
      ["/api/projects/synthetic%20project%2Fone/timeline", "GET"],
      ["/api/projects/synthetic%20project%2Fone/timeline", "PUT"],
      ["/api/projects/synthetic%20project%2Fone/exports", "POST"],
    ]);
    expect(parseJsonBody(harness.calls[1])).toEqual({ tone: "Synthetic tone" });
    expect(parseJsonBody(harness.calls[3])).toEqual({ content: "Synthetic script" });
    expect(parseJsonBody(harness.calls[6])).toEqual({
      assetType: "image_ref",
      name: "Synthetic asset",
      mediaUrl: "https://synthetic.invalid/media.png",
    });
    expect(parseJsonBody(harness.calls[14])).toEqual({
      tracks: [],
      totalDurationSeconds: 12,
    });
    expect(parseJsonBody(harness.calls[15])).toEqual({ format: "mp4" });
  });

  it("maps Agent Studio sync inputs into asset create bodies", async () => {
    const { calls, service } = createServiceHarness();

    await service.syncAgentStudioAsset("synthetic-project", {
      fileUrl: "https://synthetic.invalid/asset.mp4",
      fileName: "synthetic-asset.mp4",
      mediaKind: "video",
      prompt: "Synthetic prompt",
      description: "Synthetic description",
      sessionId: "synthetic-session",
    });
    await service.syncAgentStudioCanvasProject("synthetic-project", {
      canvasId: "synthetic-canvas",
      title: "Synthetic canvas",
      thumbnailUrl: "https://synthetic.invalid/thumb.png",
      canvasUrl: "https://synthetic.invalid/canvas.json",
      description: "Synthetic canvas description",
    });

    expect(calls.map((call) => call.path)).toEqual([
      "/api/projects/synthetic-project/assets",
      "/api/projects/synthetic-project/assets",
    ]);
    expect(parseJsonBody(calls[0])).toEqual({
      assetType: "video_ref",
      name: "synthetic-asset.mp4",
      description: "Synthetic description",
      previewUrl: "https://synthetic.invalid/asset.mp4",
      mediaKind: "video",
      mediaUrl: "https://synthetic.invalid/asset.mp4",
      sourceModule: "agent_studio",
      sourceMetadata: {
        fileUrl: "https://synthetic.invalid/asset.mp4",
        fileName: "synthetic-asset.mp4",
        mediaKind: "video",
        prompt: "Synthetic prompt",
        description: "Synthetic description",
        sessionId: "synthetic-session",
      },
    });
    expect(parseJsonBody(calls[1])).toEqual({
      assetType: "canvas_project",
      name: "Synthetic canvas",
      description: "Synthetic canvas description",
      previewUrl: "https://synthetic.invalid/thumb.png",
      mediaKind: "image",
      mediaUrl: "https://synthetic.invalid/canvas.json",
      sourceModule: "agent_studio",
      sourceMetadata: {
        canvasId: "synthetic-canvas",
        title: "Synthetic canvas",
        thumbnailUrl: "https://synthetic.invalid/thumb.png",
        canvasUrl: "https://synthetic.invalid/canvas.json",
        description: "Synthetic canvas description",
      },
    });
  });

  it("creates project-domain canonical jobs with stable payloads and TaskAccepted results", async () => {
    const { canonicalJobCalls, service } = createServiceHarness();

    await expect(service.rewriteScript("synthetic-project", "Synthetic rewrite instruction")).resolves.toMatchObject({
      taskId: "synthetic-script_rewrite_requested-task",
      status: "queued",
    });
    await service.extractAssets("synthetic-project", "Synthetic source text");
    await service.generateAssetImage("synthetic-project", "synthetic-asset", {
      generationPrompt: "Synthetic asset prompt",
      referenceImageUrls: ["https://synthetic.invalid/reference.png"],
    });
    await service.autoGenerateStoryboards("synthetic-project", "Synthetic storyboard source", {
      systemPrompt: "Synthetic system prompt",
      maxShots: 5,
      episodeNo: 2,
    });
    await service.generateStoryboardImage("synthetic-storyboard", "Synthetic image prompt", [
      "https://synthetic.invalid/storyboard-reference.png",
    ]);
    await service.generateVideo("synthetic-storyboard", {
      motionPreset: "synthetic-motion",
      mode: "synthetic-mode",
    });
    await service.generateDubbing("synthetic-storyboard", {
      text: "Synthetic dubbing text",
      speakerName: "Synthetic speaker",
    });
    await service.generateLipSync("synthetic-storyboard");

    expect(canonicalJobCalls).toEqual([
      {
        jobType: "script_rewrite_requested",
        domain: "project",
        actionCode: "script_rewrite",
        inputSummary: "Synthetic rewrite instruction",
        payload: {
          projectId: "synthetic-project",
          instruction: "Synthetic rewrite instruction",
        },
      },
      {
        jobType: "project_assets_extract_requested",
        domain: "project",
        actionCode: "assets_extract",
        inputSummary: "Synthetic source text",
        payload: {
          projectId: "synthetic-project",
          sourceText: "Synthetic source text",
        },
      },
      {
        jobType: "asset_image_generate",
        domain: "project",
        actionCode: "asset_image_generate",
        inputSummary: "Synthetic asset prompt",
        payload: {
          projectId: "synthetic-project",
          assetId: "synthetic-asset",
          generationPrompt: "Synthetic asset prompt",
          referenceImageUrls: ["https://synthetic.invalid/reference.png"],
        },
      },
      {
        jobType: "storyboards_auto_generate",
        domain: "project",
        actionCode: "storyboards_auto_generate",
        inputSummary: "Synthetic storyboard source",
        payload: {
          projectId: "synthetic-project",
          sourceText: "Synthetic storyboard source",
          systemPrompt: "Synthetic system prompt",
          maxShots: 5,
          episodeNo: 2,
        },
      },
      {
        jobType: "storyboard_image_generate",
        domain: "project",
        actionCode: "storyboard_image_generate",
        inputSummary: "Synthetic image prompt",
        payload: {
          storyboardId: "synthetic-storyboard",
          prompt: "Synthetic image prompt",
          referenceImageUrls: ["https://synthetic.invalid/storyboard-reference.png"],
        },
      },
      {
        jobType: "storyboard_video_generate",
        domain: "project",
        actionCode: "storyboard_video_generate",
        inputSummary: "synthetic-motion",
        payload: {
          storyboardId: "synthetic-storyboard",
          motionPreset: "synthetic-motion",
          mode: "synthetic-mode",
        },
      },
      {
        jobType: "storyboard_dubbing_generate",
        domain: "project",
        actionCode: "storyboard_dubbing_generate",
        inputSummary: "Synthetic dubbing text",
        payload: {
          storyboardId: "synthetic-storyboard",
          text: "Synthetic dubbing text",
          speakerName: "Synthetic speaker",
        },
      },
      {
        jobType: "storyboard_lipsync_generate",
        domain: "project",
        actionCode: "storyboard_lipsync_generate",
        inputSummary: "synthetic-storyboard",
        payload: {
          storyboardId: "synthetic-storyboard",
        },
      },
    ]);
  });

  it("keeps create-domain lists, delete routes, capabilities, local quotes, and jobs synthetic", async () => {
    const { calls, canonicalJobCalls, ownerScopeCalls, service } = createServiceHarness({
      handler: (path) => ({ items: [{ id: "synthetic-create-result", path }] }),
    });

    await service.listCreateImages();
    await service.listCreateVideos();
    await service.deleteCreateImage("image/one");
    await service.deleteCreateVideo("video/one");
    await expect(service.getCreateImageCapabilities(null)).resolves.toMatchObject({
      kind: "image",
      mode: "text_to_image",
      defaultModel: "vertex:gemini-3-pro-image-preview",
      items: expect.arrayContaining([
        expect.objectContaining({ id: "vertex:gemini-3-pro-image-preview", provider: "google-vertex" }),
        expect.objectContaining({ id: "doubao-seedream-5-0-260128", provider: "bytedance" }),
      ]),
    });
    await expect(service.getCreateVideoCapabilities("video_edit")).resolves.toMatchObject({
      kind: "video",
      mode: "video_edit",
      defaultModel: "vertex:veo-3.1-generate-001",
      items: expect.arrayContaining([
        expect.objectContaining({ id: "vertex:veo-3.1-generate-001", provider: "google-vertex" }),
        expect.objectContaining({ id: "doubao-seedance-2-0-260128", provider: "bytedance" }),
        expect.objectContaining({ id: "kling-video", provider: "kling" }),
      ]),
    });
    const videoCapabilities = await service.getCreateVideoCapabilities("video_edit");
    const vertexGenerate = videoCapabilities.items.find((item) => item.id === "vertex:veo-3.1-generate-001");
    const vertexFast = videoCapabilities.items.find((item) => item.id === "vertex:veo-3.1-fast-generate-001");
    const vertexLite = videoCapabilities.items.find((item) => item.id === "vertex:veo-3.1-lite-generate-001");
    expect(vertexGenerate?.inputModes.text_to_video).toMatchObject({
      supportedDurations: ["4s", "6s", "8s"],
      supportedAspectRatios: ["16:9", "9:16"],
      supportedResolutions: ["1080p", "720p", "4k"],
    });
    expect(vertexFast?.inputModes.multi_param).toMatchObject({
      supportedDurations: ["4s", "6s", "8s"],
      supportedAspectRatios: ["16:9", "9:16"],
      supportedResolutions: ["1080p", "720p", "4k"],
      maxReferenceImages: 3,
    });
    expect(vertexLite?.inputModes.start_end_frame).toMatchObject({
      supportedDurations: ["4s", "6s", "8s"],
      supportedAspectRatios: ["16:9", "9:16"],
      supportedResolutions: ["1080p", "720p"],
    });
    expect(vertexLite?.inputModes.multi_param).toBeUndefined();
    await expect(
      service.getCreateCreditQuote("create_image_generate", {
        projectId: "synthetic-project",
        count: 4,
      }),
    ).resolves.toMatchObject({
      actionCode: "create_image_generate",
      credits: 0,
      quantity: 4,
      projectId: "synthetic-project",
      canAfford: true,
    });
    await expect(
      service.getProjectCreditQuote("synthetic-project", "storyboards_auto_generate", {
        shotCount: 6,
      }),
    ).resolves.toMatchObject({
      actionCode: "storyboards_auto_generate",
      quantity: 6,
      projectId: "synthetic-project",
      projectOwnerType: "personal",
    });
    await expect(
      service.generateCreateImages({
        prompt: "Synthetic image prompt",
        model: "synthetic-image-model",
        count: 2,
        idempotencyKey: "synthetic-image-key",
      }),
    ).resolves.toMatchObject({
      taskId: "synthetic-create_image_generate-task",
      task: {
        type: "create_image_generate",
        domain: "create",
      },
    });
    await service.generateCreateVideos({
      prompt: "Synthetic video prompt",
      model: "synthetic-video-model",
      referenceVideoUrls: ["https://synthetic.invalid/reference.mp4"],
      idempotencyKey: "synthetic-video-key",
    });
    await service.generateCreateVideos({
      prompt: "Synthetic Vertex video prompt",
      model: "vertex:veo-3.1-lite-generate-001",
      referenceImageUrl: "data:image/jpeg;base64,AAA=",
      idempotencyKey: "synthetic-vertex-video-key",
    });

    expect(calls.map((call) => [call.path, call.init?.method ?? "GET"])).toEqual([
      ["/api/create/images?accountOwnerType=user&accountOwnerId=synthetic-actor", "GET"],
      ["/api/create/videos?accountOwnerType=user&accountOwnerId=synthetic-actor", "GET"],
      ["/api/create/images/image%2Fone?accountOwnerType=user&accountOwnerId=synthetic-actor", "DELETE"],
      ["/api/create/videos/video%2Fone?accountOwnerType=user&accountOwnerId=synthetic-actor", "DELETE"],
    ]);
    expect(ownerScopeCalls).toHaveLength(4);
    expect(canonicalJobCalls).toEqual([
      {
        jobType: "create_image_generate",
        domain: "create",
        lane: "account-media",
        idempotencyKey: "synthetic-image-key",
        actionCode: "create_image_generate",
        inputSummary: "Synthetic image prompt",
        payload: {
          prompt: "Synthetic image prompt",
          model: "synthetic-image-model",
          count: 2,
        },
      },
      {
        jobType: "create_video_generate",
        domain: "create",
        lane: "account-media",
        idempotencyKey: "synthetic-video-key",
        actionCode: "create_video_generate",
        inputSummary: "Synthetic video prompt",
        payload: {
          prompt: "Synthetic video prompt",
          model: "synthetic-video-model",
          referenceVideoUrls: ["https://synthetic.invalid/reference.mp4"],
        },
      },
      {
        jobType: "create_video_generate",
        domain: "create",
        lane: "account-media",
        providerRoute: "closed-api-vertex",
        idempotencyKey: "synthetic-vertex-video-key",
        actionCode: "create_video_generate",
        inputSummary: "Synthetic Vertex video prompt",
        payload: {
          prompt: "Synthetic Vertex video prompt",
          model: "vertex:veo-3.1-lite-generate-001",
          referenceImageUrl: "data:image/jpeg;base64,AAA=",
          firstFrameUrl: "data:image/jpeg;base64,AAA=",
        },
      },
    ]);
  });

  it("mirrors organization owner scope through create image and video request paths", async () => {
    const organizationScope = createSyntheticOrganizationOwnerScope();
    const harness = createServiceHarness({
      actorId: "synthetic-org-actor",
      ownerScope: organizationScope,
      handler: (path) => ({ items: [{ id: "synthetic-create-result", path }] }),
    });

    await harness.service.listCreateImages();
    await harness.service.listCreateVideos();
    await harness.service.deleteCreateImage("image/one");
    await harness.service.deleteCreateVideo("video/one");

    expect(harness.calls.map((call) => [call.path, call.init?.method ?? "GET"])).toEqual([
      ["/api/create/images?accountOwnerType=organization&accountOwnerId=synthetic-org%2Fone", "GET"],
      ["/api/create/videos?accountOwnerType=organization&accountOwnerId=synthetic-org%2Fone", "GET"],
      ["/api/create/images/image%2Fone?accountOwnerType=organization&accountOwnerId=synthetic-org%2Fone", "DELETE"],
      ["/api/create/videos/video%2Fone?accountOwnerType=organization&accountOwnerId=synthetic-org%2Fone", "DELETE"],
    ]);

    const calls: RequestCall[] = [];
    const controlApiJsonRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      const body = parseJsonBody<Record<string, unknown>>({ path, init });
      return {
        id: `synthetic-${String(body.jobType)}-job`,
        jobType: body.jobType,
        status: "queued",
        payload: body.payload,
        createdByUserId: body.createdByUserId,
        createdAt: SYNTHETIC_CREATED_AT,
        updatedAt: SYNTHETIC_UPDATED_AT,
      } as T;
    };
    const jobsService = createJobsService({
      controlApiJsonRequest,
      getCurrentActorId: () => "synthetic-org-actor",
      resolveCurrentOwnerScope: () => organizationScope,
      createClientId: () => "synthetic-client-id",
      isNotFoundError: () => false,
    });
    const service = createProjectsCanvasCreateService({
      controlApiJsonRequest,
      getCurrentActorId: () => "synthetic-org-actor",
      resolveCurrentOwnerScope: () => organizationScope,
      createCanonicalJob: jobsService.createCanonicalJob,
    });

    await service.generateCreateImages({
      prompt: "Synthetic organization image",
      idempotencyKey: "synthetic-image-key",
    });
    await service.generateCreateVideos({
      prompt: "Synthetic organization video",
      idempotencyKey: "synthetic-video-key",
    });

    expect(calls.map((call) => [call.path, call.init?.method ?? "GET"])).toEqual([
      ["/api/jobs", "POST"],
      ["/api/jobs", "POST"],
    ]);
    expect(parseJsonBody(calls[0])).toMatchObject({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-org/one",
      regionCode: "CN",
      currency: "CNY",
      jobType: "create_image_generate",
      lane: "account-media",
      createdByUserId: "synthetic-org-actor",
      idempotencyKey: "synthetic-image-key",
      payload: {
        prompt: "Synthetic organization image",
        type: "create_image_generate",
        domain: "create",
      },
    });
    expect(parseJsonBody(calls[1])).toMatchObject({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-org/one",
      regionCode: "CN",
      currency: "CNY",
      jobType: "create_video_generate",
      lane: "account-media",
      createdByUserId: "synthetic-org-actor",
      idempotencyKey: "synthetic-video-key",
      payload: {
        prompt: "Synthetic organization video",
        type: "create_video_generate",
        domain: "create",
      },
    });
  });

  it("dedupes canvas summaries and scopes canvas save/delete flows", async () => {
    const harness = createServiceHarness({
      handler: (path) => {
        if (path.startsWith("/api/canvas-projects?")) {
          return {
            items: [
              {
                id: " synthetic-canvas ",
                actorId: "synthetic-actor",
                title: "Older canvas",
                thumbnailUrl: null,
                createdAt: "2026-05-05T00:00:00.000Z",
                updatedAt: "2026-05-05T00:01:00.000Z",
              },
              {
                id: "synthetic-canvas",
                actorId: "synthetic-actor",
                title: "Newer canvas",
                thumbnailUrl: null,
                createdAt: "2026-05-05T00:02:00.000Z",
                updatedAt: "2026-05-05T00:03:00.000Z",
              },
              {
                id: "synthetic-canvas-two",
                actorId: "synthetic-actor",
                title: "Second canvas",
                thumbnailUrl: null,
                createdAt: "2026-05-05T00:04:00.000Z",
                updatedAt: "2026-05-05T00:04:00.000Z",
              },
            ],
          };
        }
        return {
          id: "synthetic-canvas",
          actorId: "synthetic-actor",
          title: "Synthetic canvas",
          thumbnailUrl: null,
          canvasData: {},
          createdAt: "2026-05-05T00:00:00.000Z",
          updatedAt: "2026-05-05T00:05:00.000Z",
        };
      },
    });

    await expect(harness.service.listCanvasProjects()).resolves.toMatchObject({
      items: [
        { id: "synthetic-canvas-two", title: "Second canvas" },
        { id: "synthetic-canvas", title: "Newer canvas" },
      ],
    });
    await harness.service.getCanvasProject("synthetic-canvas/one");
    await harness.service.saveCanvasProject({
      title: "Synthetic new canvas",
      canvasData: { nodes: ["synthetic-node"] },
    });
    await harness.service.saveCanvasProject({
      id: "synthetic-canvas/one",
      title: "Synthetic existing canvas",
      expectedUpdatedAt: "2026-05-05T00:05:00.000Z",
    });
    await harness.service.deleteCanvasProject("synthetic-canvas/one");

    expect(harness.calls.map((call) => [call.path, call.init?.method ?? "GET"])).toEqual([
      ["/api/canvas-projects?accountOwnerType=user&accountOwnerId=synthetic-actor", "GET"],
      ["/api/canvas-projects/synthetic-canvas%2Fone", "GET"],
      ["/api/canvas-projects", "POST"],
      ["/api/canvas-projects/synthetic-canvas%2Fone", "PUT"],
      ["/api/canvas-projects/synthetic-canvas%2Fone?accountOwnerType=user&accountOwnerId=synthetic-actor", "DELETE"],
    ]);
    expect(harness.ownerScopeCalls).toHaveLength(4);
    expect(parseJsonBody(harness.calls[2])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-actor",
      regionCode: "CN",
      currency: "CNY",
      title: "Synthetic new canvas",
      canvasData: { nodes: ["synthetic-node"] },
    });
    expect(parseJsonBody(harness.calls[3])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-actor",
      regionCode: "CN",
      currency: "CNY",
      id: "synthetic-canvas/one",
      title: "Synthetic existing canvas",
      expectedUpdatedAt: "2026-05-05T00:05:00.000Z",
    });
  });

  it("mirrors organization owner scope into canvas list, save, and delete requests", async () => {
    const organizationScope = createSyntheticOrganizationOwnerScope();
    const harness = createServiceHarness({
      actorId: "synthetic-org-actor",
      ownerScope: organizationScope,
      handler: () => ({
        items: [],
        id: "synthetic-canvas",
        actorId: "synthetic-org-actor",
        title: "Synthetic organization canvas",
        thumbnailUrl: null,
        canvasData: {},
        createdAt: SYNTHETIC_CREATED_AT,
        updatedAt: SYNTHETIC_UPDATED_AT,
      }),
    });

    await harness.service.listCanvasProjects();
    await harness.service.saveCanvasProject({
      title: "Synthetic organization canvas",
      canvasData: { nodes: ["synthetic-node"] },
    });
    await harness.service.saveCanvasProject({
      id: "synthetic-canvas",
      title: "Synthetic organization canvas update",
    });
    await harness.service.deleteCanvasProject("synthetic-canvas");

    expect(harness.calls.map((call) => [call.path, call.init?.method ?? "GET"])).toEqual([
      ["/api/canvas-projects?accountOwnerType=organization&accountOwnerId=synthetic-org%2Fone", "GET"],
      ["/api/canvas-projects", "POST"],
      ["/api/canvas-projects/synthetic-canvas", "PUT"],
      ["/api/canvas-projects/synthetic-canvas?accountOwnerType=organization&accountOwnerId=synthetic-org%2Fone", "DELETE"],
    ]);
    expect(parseJsonBody(harness.calls[1])).toMatchObject({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-org/one",
      regionCode: "CN",
      currency: "CNY",
      title: "Synthetic organization canvas",
      canvasData: { nodes: ["synthetic-node"] },
    });
    expect(parseJsonBody(harness.calls[2])).toMatchObject({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-org/one",
      regionCode: "CN",
      currency: "CNY",
      id: "synthetic-canvas",
      title: "Synthetic organization canvas update",
    });
  });

  it("dedupes agent canvas summaries and adds the agent canvas save boundary fields", async () => {
    const harness = createServiceHarness({
      handler: (path) => {
        if (path.startsWith("/api/agent-canvas/projects?")) {
          return {
            items: [
              {
                id: " synthetic-agent-canvas ",
                actorId: "synthetic-actor",
                title: "Older agent canvas",
                thumbnailUrl: null,
                kind: "agent_canvas",
                createdAt: "2026-05-05T00:00:00.000Z",
                updatedAt: "2026-05-05T00:01:00.000Z",
              },
              {
                id: "synthetic-agent-canvas",
                actorId: "synthetic-actor",
                title: "Newer agent canvas",
                thumbnailUrl: null,
                kind: "agent_canvas",
                createdAt: "2026-05-05T00:02:00.000Z",
                updatedAt: "2026-05-05T00:03:00.000Z",
              },
            ],
          };
        }
        return {
          id: "synthetic-agent-canvas",
          actorId: "synthetic-actor",
          title: "Synthetic agent canvas",
          thumbnailUrl: null,
          canvasData: {},
          kind: "agent_canvas",
          agentContext: null,
          createdAt: "2026-05-05T00:00:00.000Z",
          updatedAt: "2026-05-05T00:05:00.000Z",
        };
      },
    });

    await expect(harness.service.listAgentCanvasProjects()).resolves.toMatchObject({
      items: [{ id: "synthetic-agent-canvas", title: "Newer agent canvas" }],
    });
    await harness.service.getAgentCanvasProject("synthetic-agent-canvas/one");
    await harness.service.saveAgentCanvasProject({
      title: "Synthetic new agent canvas",
      canvasData: { graph: "synthetic" },
    });
    await harness.service.saveAgentCanvasProject({
      id: "synthetic-agent-canvas/one",
      title: "Synthetic existing agent canvas",
      agentContext: { agent: "synthetic-agent" },
    });
    await harness.service.deleteAgentCanvasProject("synthetic-agent-canvas/one");

    expect(harness.calls.map((call) => [call.path, call.init?.method ?? "GET"])).toEqual([
      ["/api/agent-canvas/projects?accountOwnerType=user&accountOwnerId=synthetic-actor", "GET"],
      ["/api/agent-canvas/projects/synthetic-agent-canvas%2Fone", "GET"],
      ["/api/agent-canvas/projects", "POST"],
      ["/api/agent-canvas/projects/synthetic-agent-canvas%2Fone", "PUT"],
      [
        "/api/agent-canvas/projects/synthetic-agent-canvas%2Fone?accountOwnerType=user&accountOwnerId=synthetic-actor",
        "DELETE",
      ],
    ]);
    expect(parseJsonBody(harness.calls[2])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-actor",
      regionCode: "CN",
      currency: "CNY",
      title: "Synthetic new agent canvas",
      canvasData: { graph: "synthetic" },
      kind: "agent_canvas",
      agentContext: null,
    });
    expect(parseJsonBody(harness.calls[3])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-actor",
      regionCode: "CN",
      currency: "CNY",
      id: "synthetic-agent-canvas/one",
      title: "Synthetic existing agent canvas",
      agentContext: { agent: "synthetic-agent" },
      kind: "agent_canvas",
    });
  });

  it("mirrors organization owner scope into agent canvas list, save, and delete requests", async () => {
    const organizationScope = createSyntheticOrganizationOwnerScope();
    const harness = createServiceHarness({
      actorId: "synthetic-org-actor",
      ownerScope: organizationScope,
      handler: () => ({
        items: [],
        id: "synthetic-agent-canvas",
        actorId: "synthetic-org-actor",
        title: "Synthetic organization agent canvas",
        thumbnailUrl: null,
        canvasData: {},
        kind: "agent_canvas",
        agentContext: null,
        createdAt: SYNTHETIC_CREATED_AT,
        updatedAt: SYNTHETIC_UPDATED_AT,
      }),
    });

    await harness.service.listAgentCanvasProjects();
    await harness.service.saveAgentCanvasProject({
      title: "Synthetic organization agent canvas",
      canvasData: { graph: "synthetic" },
    });
    await harness.service.saveAgentCanvasProject({
      id: "synthetic-agent-canvas",
      title: "Synthetic organization agent canvas update",
      agentContext: { agent: "synthetic-agent" },
    });
    await harness.service.deleteAgentCanvasProject("synthetic-agent-canvas");

    expect(harness.calls.map((call) => [call.path, call.init?.method ?? "GET"])).toEqual([
      ["/api/agent-canvas/projects?accountOwnerType=organization&accountOwnerId=synthetic-org%2Fone", "GET"],
      ["/api/agent-canvas/projects", "POST"],
      ["/api/agent-canvas/projects/synthetic-agent-canvas", "PUT"],
      [
        "/api/agent-canvas/projects/synthetic-agent-canvas?accountOwnerType=organization&accountOwnerId=synthetic-org%2Fone",
        "DELETE",
      ],
    ]);
    expect(parseJsonBody(harness.calls[1])).toMatchObject({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-org/one",
      regionCode: "CN",
      currency: "CNY",
      title: "Synthetic organization agent canvas",
      canvasData: { graph: "synthetic" },
      kind: "agent_canvas",
      agentContext: null,
    });
    expect(parseJsonBody(harness.calls[2])).toMatchObject({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-org/one",
      regionCode: "CN",
      currency: "CNY",
      id: "synthetic-agent-canvas",
      title: "Synthetic organization agent canvas update",
      agentContext: { agent: "synthetic-agent" },
      kind: "agent_canvas",
    });
  });
});
