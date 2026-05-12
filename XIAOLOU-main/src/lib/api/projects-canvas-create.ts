import { normalizeVideoMode } from "../create-capabilities";
import type {
  MediaCapabilitiesResponse,
  MediaCapabilitySet,
  MediaModelCapability,
  MediaModelStatus,
  VideoGenerationMode,
} from "../create-capabilities";
import type { ControlOwnerScope } from "../control-owner-scope";
import type {
  AgentCanvasProject,
  AgentCanvasProjectSummary,
  AgentStudioAssetSyncInput,
  AgentStudioCanvasProjectSyncInput,
  Asset,
  AssetImageGenerateInput,
  CanvasProject,
  CanvasProjectSummary,
  CreateAssetInput,
  CreateImageResult,
  CreateVideoResult,
  CreditQuote,
  CreditQuoteRequestInput,
  Dubbing,
  Project,
  ProjectOverview,
  Script,
  Settings,
  Storyboard,
  Timeline,
  VideoItem,
  VideoMultiReferenceImages,
} from "./projects-canvas-create-types";
import type { CanonicalJobInput, TaskAccepted } from "./jobs";

type ControlApiJsonRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

type ControlMediaRequestScope = {
  accountOwnerType: NonNullable<ControlOwnerScope["accountOwnerType"]>;
  accountOwnerId: string;
  regionCode: "CN";
  currency: "CNY";
};

type GenerateCreateImagesInput = {
  projectId?: string;
  assetSyncMode?: "auto" | "manual";
  prompt: string;
  negativePrompt?: string;
  model?: string;
  style?: string;
  aspectRatio?: string;
  resolution?: string;
  count?: number;
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
  idempotencyKey?: string;
};

type GenerateCreateVideosInput = {
  projectId?: string;
  assetSyncMode?: "auto" | "manual";
  prompt: string;
  model?: string;
  duration?: string;
  aspectRatio?: string;
  resolution?: string;
  motionStrength?: number;
  keepConsistency?: boolean;
  referenceImageUrl?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  videoMode?: VideoGenerationMode | "video_edit" | "motion_control" | "video_extend";
  multiReferenceImages?: VideoMultiReferenceImages;
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  editMode?: string;
  editPresetId?: string;
  motionReferenceVideoUrl?: string;
  characterReferenceImageUrl?: string;
  qualityMode?: string;
  generateAudio?: boolean;
  networkSearch?: boolean;
  idempotencyKey?: string;
};

type CanvasProjectSaveInput = {
  id?: string;
  title?: string;
  thumbnailUrl?: string | null;
  canvasData?: unknown;
  expectedUpdatedAt?: string | null;
  baseTitle?: string | null;
  baseCanvasData?: unknown;
};

type AgentCanvasProjectSaveInput = CanvasProjectSaveInput & {
  agentContext?: unknown | null;
};

export type ProjectsCanvasCreateServiceDeps = {
  controlApiJsonRequest: ControlApiJsonRequest;
  getCurrentActorId: () => string;
  resolveCurrentOwnerScope: () => ControlOwnerScope;
  createCanonicalJob: (input: CanonicalJobInput) => Promise<TaskAccepted>;
};

function mediaCapabilitySet(
  status: MediaModelStatus = "stable",
  overrides: Partial<MediaCapabilitySet> = {},
) {
  return {
    supported: true,
    status,
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
    supportedResolutions: ["720p", "1080p", "1K", "2K", "4K"],
    supportedDurations: ["4s", "5s", "8s", "10s", "15s"],
    durationControl: "selectable" as const,
    aspectRatioControl: "selectable" as const,
    resolutionControl: "selectable" as const,
    defaultAspectRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: "5s",
    maxReferenceImages: 7,
    maxReferenceVideos: 1,
    maxReferenceAudios: 1,
    note: "Queued through canonical Control API jobs during the Windows-native cutover.",
    ...overrides,
  };
}

const WINDOWS_NATIVE_IMAGE_CAPABILITIES: MediaModelCapability[] = [
  {
    id: "vertex:gemini-3-pro-image-preview",
    label: "Gemini 3 Pro Image+",
    provider: "google-vertex",
    kind: "image",
    status: "stable",
    recommended: true,
    inputModes: {
      text_to_image: mediaCapabilitySet("stable", {
        supportedAspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
        supportedResolutions: ["1K", "2K", "4K"],
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
      }),
      image_to_image: mediaCapabilitySet("stable", {
        supportedAspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
        supportedResolutions: ["1K", "2K", "4K"],
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
        maxReferenceImages: 1,
      }),
      multi_image: mediaCapabilitySet("stable", {
        supportedAspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"],
        supportedResolutions: ["1K", "2K", "4K"],
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
        maxReferenceImages: 4,
      }),
    },
  },
  {
    id: "vertex:gemini-3.1-flash-image-preview",
    label: "Gemini 3.1 Flash Image+",
    provider: "google-vertex",
    kind: "image",
    status: "stable",
    inputModes: {
      text_to_image: mediaCapabilitySet("stable", {
        supportedAspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "1:8", "4:1", "8:1"],
        supportedResolutions: ["1K", "2K", "4K"],
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
      }),
      image_to_image: mediaCapabilitySet("stable", {
        supportedAspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "1:8", "4:1", "8:1"],
        supportedResolutions: ["1K", "2K", "4K"],
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
        maxReferenceImages: 1,
      }),
      multi_image: mediaCapabilitySet("stable", {
        supportedAspectRatios: ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:4", "1:8", "4:1", "8:1"],
        supportedResolutions: ["1K", "2K", "4K"],
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
        maxReferenceImages: 4,
      }),
    },
  },
  {
    id: "doubao-seedream-5-0-260128",
    label: "Seedream 5.0",
    provider: "bytedance",
    kind: "image",
    status: "stable",
    recommended: true,
    inputModes: {
      text_to_image: mediaCapabilitySet("stable", { defaultResolution: "1K" }),
      image_to_image: mediaCapabilitySet("stable", { maxReferenceImages: 1 }),
      multi_image: mediaCapabilitySet("stable", { maxReferenceImages: 4 }),
    },
  },
];

const VERTEX_VEO_31_DURATIONS = ["4s", "6s", "8s"];
const VERTEX_VEO_31_ASPECT_RATIOS = ["16:9", "9:16"];
const VERTEX_VEO_31_RESOLUTIONS = ["1080p", "720p", "4k"];
const VERTEX_VEO_31_LITE_RESOLUTIONS = ["1080p", "720p"];

const WINDOWS_NATIVE_VIDEO_CAPABILITIES: MediaModelCapability[] = [
  {
    id: "vertex:veo-3.1-generate-001",
    label: "Veo 3.1+",
    provider: "google-vertex",
    kind: "video",
    status: "stable",
    recommended: true,
    inputModes: {
      text_to_video: mediaCapabilitySet("stable", {
        supportedDurations: VERTEX_VEO_31_DURATIONS,
        supportedAspectRatios: VERTEX_VEO_31_ASPECT_RATIOS,
        supportedResolutions: VERTEX_VEO_31_RESOLUTIONS,
        defaultDuration: "8s",
      }),
      single_reference: mediaCapabilitySet("stable", {
        supportedDurations: VERTEX_VEO_31_DURATIONS,
        supportedAspectRatios: VERTEX_VEO_31_ASPECT_RATIOS,
        supportedResolutions: VERTEX_VEO_31_RESOLUTIONS,
        defaultDuration: "8s",
      }),
      start_end_frame: mediaCapabilitySet("stable", {
        supportedDurations: VERTEX_VEO_31_DURATIONS,
        supportedAspectRatios: VERTEX_VEO_31_ASPECT_RATIOS,
        supportedResolutions: VERTEX_VEO_31_RESOLUTIONS,
        defaultDuration: "8s",
      }),
      multi_param: mediaCapabilitySet("stable", {
        supportedDurations: VERTEX_VEO_31_DURATIONS,
        supportedAspectRatios: VERTEX_VEO_31_ASPECT_RATIOS,
        supportedResolutions: VERTEX_VEO_31_RESOLUTIONS,
        defaultDuration: "8s",
        maxReferenceImages: 3,
      }),
    },
  },
  {
    id: "vertex:veo-3.1-fast-generate-001",
    label: "Veo 3.1 Fast+",
    provider: "google-vertex",
    kind: "video",
    status: "stable",
    inputModes: {
      text_to_video: mediaCapabilitySet("stable", {
        supportedDurations: VERTEX_VEO_31_DURATIONS,
        supportedAspectRatios: VERTEX_VEO_31_ASPECT_RATIOS,
        supportedResolutions: VERTEX_VEO_31_RESOLUTIONS,
        defaultDuration: "8s",
      }),
      single_reference: mediaCapabilitySet("stable", {
        supportedDurations: VERTEX_VEO_31_DURATIONS,
        supportedAspectRatios: VERTEX_VEO_31_ASPECT_RATIOS,
        supportedResolutions: VERTEX_VEO_31_RESOLUTIONS,
        defaultDuration: "8s",
      }),
      start_end_frame: mediaCapabilitySet("stable", {
        supportedDurations: VERTEX_VEO_31_DURATIONS,
        supportedAspectRatios: VERTEX_VEO_31_ASPECT_RATIOS,
        supportedResolutions: VERTEX_VEO_31_RESOLUTIONS,
        defaultDuration: "8s",
      }),
      multi_param: mediaCapabilitySet("stable", {
        supportedDurations: VERTEX_VEO_31_DURATIONS,
        supportedAspectRatios: VERTEX_VEO_31_ASPECT_RATIOS,
        supportedResolutions: VERTEX_VEO_31_RESOLUTIONS,
        defaultDuration: "8s",
        maxReferenceImages: 3,
      }),
    },
  },
  {
    id: "vertex:veo-3.1-lite-generate-001",
    label: "Veo 3.1 Lite+",
    provider: "google-vertex",
    kind: "video",
    status: "preview",
    inputModes: {
      text_to_video: mediaCapabilitySet("preview", {
        supportedDurations: VERTEX_VEO_31_DURATIONS,
        supportedAspectRatios: VERTEX_VEO_31_ASPECT_RATIOS,
        supportedResolutions: VERTEX_VEO_31_LITE_RESOLUTIONS,
        defaultDuration: "8s",
      }),
      single_reference: mediaCapabilitySet("preview", {
        supportedDurations: VERTEX_VEO_31_DURATIONS,
        supportedAspectRatios: VERTEX_VEO_31_ASPECT_RATIOS,
        supportedResolutions: VERTEX_VEO_31_LITE_RESOLUTIONS,
        defaultDuration: "8s",
      }),
      start_end_frame: mediaCapabilitySet("preview", {
        supportedDurations: VERTEX_VEO_31_DURATIONS,
        supportedAspectRatios: VERTEX_VEO_31_ASPECT_RATIOS,
        supportedResolutions: VERTEX_VEO_31_LITE_RESOLUTIONS,
        defaultDuration: "8s",
      }),
    },
  },
  {
    id: "doubao-seedance-2-0-260128",
    label: "Seedance 2.0",
    provider: "bytedance",
    kind: "video",
    status: "stable",
    recommended: true,
    inputModes: {
      text_to_video: mediaCapabilitySet("stable"),
      single_reference: mediaCapabilitySet("stable", { defaultAspectRatio: "adaptive" }),
      start_end_frame: mediaCapabilitySet("stable", { defaultAspectRatio: "adaptive" }),
      multi_param: mediaCapabilitySet("stable", { defaultResolution: "1080p" }),
      video_edit: mediaCapabilitySet("experimental", { maxReferenceVideos: 1 }),
      motion_control: mediaCapabilitySet("experimental", { maxReferenceVideos: 1 }),
      video_extend: mediaCapabilitySet("experimental", { maxReferenceVideos: 1 }),
    },
  },
  {
    id: "kling-video",
    label: "kling-video",
    provider: "kling",
    kind: "video",
    status: "stable",
    inputModes: {
      text_to_video: mediaCapabilitySet("stable", { supportedDurations: ["5s", "10s"] }),
      single_reference: mediaCapabilitySet("stable", { supportedDurations: ["5s", "10s"] }),
      start_end_frame: mediaCapabilitySet("stable", { supportedDurations: ["5s", "10s"] }),
    },
  },
];

function isVertexVeoModel(model?: string | null) {
  return String(model || "").trim().toLowerCase().startsWith("vertex:veo-");
}

function normalizeCreateVideoPayloadForProvider(
  input: Omit<GenerateCreateVideosInput, "idempotencyKey">,
) {
  const body = { ...input };
  const mode = normalizeVideoMode(body.videoMode);
  const referenceImageUrl = String(body.referenceImageUrl || "").trim();
  if (
    isVertexVeoModel(body.model) &&
    referenceImageUrl &&
    !String(body.firstFrameUrl || "").trim() &&
    (!mode || mode === "image_to_video" || mode === "single_reference")
  ) {
    body.firstFrameUrl = referenceImageUrl;
  }
  return body;
}

function canvasProjectSummaryTime(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function dedupeCanvasProjectSummaries<T extends CanvasProjectSummary>(items: T[]) {
  const byId = new Map<string, T>();
  for (const item of items) {
    const normalizedId = typeof item?.id === "string" ? item.id.trim() : "";
    if (!normalizedId) continue;
    const candidate = item.id === normalizedId ? item : { ...item, id: normalizedId };
    const existing = byId.get(normalizedId);
    if (
      !existing ||
      canvasProjectSummaryTime(candidate.updatedAt) > canvasProjectSummaryTime(existing.updatedAt) ||
      (canvasProjectSummaryTime(candidate.updatedAt) === canvasProjectSummaryTime(existing.updatedAt) &&
        canvasProjectSummaryTime(candidate.createdAt) > canvasProjectSummaryTime(existing.createdAt))
    ) {
      byId.set(normalizedId, candidate as T);
    }
  }
  return Array.from(byId.values()).sort(
    (left, right) =>
      canvasProjectSummaryTime(right.updatedAt) - canvasProjectSummaryTime(left.updatedAt) ||
      canvasProjectSummaryTime(right.createdAt) - canvasProjectSummaryTime(left.createdAt),
  );
}

function buildLocalCreditQuote(
  actionCode: string,
  input?: CreditQuoteRequestInput,
  projectId: string | null = null,
) {
  return {
    actionCode,
    label: actionCode,
    description: "Read-only estimate while project billing writes are cut over to canonical jobs.",
    credits: 0,
    quantity: input?.count ?? input?.shotCount ?? 1,
    currency: "CNY",
    walletId: null,
    walletName: null,
    walletOwnerType: "user",
    availableCredits: 0,
    frozenCredits: 0,
    billingPolicy: "personal_only",
    projectId,
    projectOwnerType: projectId ? "personal" : null,
    budgetLimitCredits: null,
    budgetUsedCredits: 0,
    budgetRemainingCredits: null,
    canAfford: true,
    reason: null,
  } satisfies CreditQuote;
}

function buildControlMediaScope(
  actorId: string,
  ownerScope: ControlOwnerScope,
): ControlMediaRequestScope {
  return {
    accountOwnerType: ownerScope.accountOwnerType ?? "user",
    accountOwnerId: ownerScope.accountOwnerId ?? actorId,
    regionCode: "CN",
    currency: "CNY",
  };
}

function buildControlScopeQuery(actorId: string, ownerScope: ControlOwnerScope) {
  const scope = buildControlMediaScope(actorId, ownerScope);
  const params = new URLSearchParams();
  params.set("accountOwnerType", scope.accountOwnerType);
  params.set("accountOwnerId", scope.accountOwnerId);
  return params.toString();
}

export function createProjectsCanvasCreateService({
  controlApiJsonRequest,
  getCurrentActorId,
  resolveCurrentOwnerScope,
  createCanonicalJob,
}: ProjectsCanvasCreateServiceDeps) {
  const createAsset = (
    projectId: string,
    input: CreateAssetInput,
  ): Promise<Asset> => {
    return controlApiJsonRequest<Asset>(`/api/projects/${encodeURIComponent(projectId)}/assets`, {
      method: "POST",
      body: JSON.stringify(input),
    });
  };

  const getCreateCreditQuote = async (
    actionCode: string,
    input?: CreditQuoteRequestInput,
  ) => buildLocalCreditQuote(actionCode, input, input?.projectId || null);

  const getProjectCreditQuote = async (
    projectId: string,
    actionCode: string,
    input?: CreditQuoteRequestInput,
  ) => buildLocalCreditQuote(actionCode, input, projectId);

  return {
    listProjects() {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      return controlApiJsonRequest<{ items: Project[]; total: number; page?: number; pageSize?: number }>(
        `/api/projects?${buildControlScopeQuery(actorId, ownerScope)}`,
      );
    },

    listCreateImages() {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      return controlApiJsonRequest<{ items: CreateImageResult[] }>(
        `/api/create/images?${buildControlScopeQuery(actorId, ownerScope)}`,
      );
    },

    generateCreateImages(input: GenerateCreateImagesInput) {
      const { idempotencyKey, ...body } = input;
      return createCanonicalJob({
        jobType: "create_image_generate",
        domain: "create",
        lane: "account-media",
        idempotencyKey,
        actionCode: "create_image_generate",
        inputSummary: body.prompt,
        payload: body,
      });
    },

    listCreateVideos() {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      return controlApiJsonRequest<{ items: CreateVideoResult[] }>(
        `/api/create/videos?${buildControlScopeQuery(actorId, ownerScope)}`,
      );
    },

    async getCreateImageCapabilities(mode?: string | null) {
      return {
        kind: "image",
        mode: mode || "text_to_image",
        defaultModel: "vertex:gemini-3-pro-image-preview",
        items: WINDOWS_NATIVE_IMAGE_CAPABILITIES,
      } satisfies MediaCapabilitiesResponse;
    },

    async getCreateVideoCapabilities(mode: string) {
      return {
        kind: "video",
        mode: normalizeVideoMode(mode) || "image_to_video",
        defaultModel: "vertex:veo-3.1-generate-001",
        items: WINDOWS_NATIVE_VIDEO_CAPABILITIES,
      } satisfies MediaCapabilitiesResponse;
    },

    generateCreateVideos(input: GenerateCreateVideosInput) {
      const { idempotencyKey, ...rawBody } = input;
      const body = normalizeCreateVideoPayloadForProvider(rawBody);
      const providerRoute =
        isVertexVeoModel(body.model)
          ? "closed-api-vertex"
          : null;
      return createCanonicalJob({
        jobType: "create_video_generate",
        domain: "create",
        lane: "account-media",
        ...(providerRoute ? { providerRoute } : {}),
        idempotencyKey,
        actionCode: "create_video_generate",
        inputSummary: body.prompt,
        payload: body,
      });
    },

    deleteCreateImage(imageId: string) {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      return controlApiJsonRequest<{ deleted: boolean; id: string }>(
        `/api/create/images/${encodeURIComponent(imageId)}?${buildControlScopeQuery(actorId, ownerScope)}`,
        { method: "DELETE" },
      );
    },

    deleteCreateVideo(videoId: string) {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      return controlApiJsonRequest<{ deleted: boolean; id: string }>(
        `/api/create/videos/${encodeURIComponent(videoId)}?${buildControlScopeQuery(actorId, ownerScope)}`,
        { method: "DELETE" },
      );
    },

    createProject(input: {
      title: string;
      summary?: string;
      ownerType?: "personal" | "organization";
      organizationId?: string;
    }) {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      return controlApiJsonRequest<Project>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          ...buildControlMediaScope(actorId, ownerScope),
          ...input,
        }),
      });
    },

    updateProject(projectId: string, input: Partial<Project>) {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      return controlApiJsonRequest<Project>(`/api/projects/${encodeURIComponent(projectId)}`, {
        method: "PUT",
        body: JSON.stringify({
          ...buildControlMediaScope(actorId, ownerScope),
          ...input,
          id: projectId,
        }),
      });
    },

    getProject(projectId: string) {
      return controlApiJsonRequest<Project>(`/api/projects/${encodeURIComponent(projectId)}`);
    },

    getProjectOverview(projectId: string) {
      return controlApiJsonRequest<ProjectOverview>(`/api/projects/${encodeURIComponent(projectId)}/overview`);
    },

    getSettings(projectId: string) {
      return controlApiJsonRequest<Settings>(`/api/projects/${encodeURIComponent(projectId)}/settings`);
    },

    updateSettings(projectId: string, input: Partial<Settings>) {
      return controlApiJsonRequest<Settings>(`/api/projects/${encodeURIComponent(projectId)}/settings`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },

    getScript(projectId: string) {
      return controlApiJsonRequest<Script>(`/api/projects/${encodeURIComponent(projectId)}/script`);
    },

    updateScript(
      projectId: string,
      content: string,
      options?: { episodeScripts?: Record<string, string> },
    ) {
      return controlApiJsonRequest<Script>(`/api/projects/${encodeURIComponent(projectId)}/script`, {
        method: "PUT",
        body: JSON.stringify({
          content,
          ...(options?.episodeScripts ? { episodeScripts: options.episodeScripts } : {}),
        }),
      });
    },

    rewriteScript(projectId: string, instruction: string) {
      return createCanonicalJob({
        jobType: "script_rewrite_requested",
        domain: "project",
        actionCode: "script_rewrite",
        inputSummary: instruction,
        payload: { projectId, instruction },
      });
    },

    listAssets(projectId: string, assetType?: string) {
      const params = new URLSearchParams();
      if (assetType) params.set("assetType", assetType);
      const query = params.toString();
      return controlApiJsonRequest<{ items: Asset[] }>(
        `/api/projects/${encodeURIComponent(projectId)}/assets${query ? `?${query}` : ""}`,
      );
    },

    getAsset(projectId: string, assetId: string) {
      return controlApiJsonRequest<Asset>(
        `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`,
      );
    },

    createAsset,

    syncAgentStudioAsset(projectId: string, input: AgentStudioAssetSyncInput) {
      return createAsset(projectId, {
        assetType: input.mediaKind === "video" ? "video_ref" : "image_ref",
        name: input.name || input.fileName || "Agent Studio asset",
        description: input.description || input.prompt || "",
        previewUrl: input.fileUrl,
        mediaKind: input.mediaKind || "image",
        mediaUrl: input.fileUrl,
        sourceModule: "agent_studio",
        sourceMetadata: input as Record<string, unknown>,
      });
    },

    syncAgentStudioCanvasProject(projectId: string, input: AgentStudioCanvasProjectSyncInput) {
      return createAsset(projectId, {
        assetType: "canvas_project",
        name: input.title || "Agent Studio canvas",
        description: input.description || "",
        previewUrl: input.thumbnailUrl || input.canvasUrl || null,
        mediaKind: "image",
        mediaUrl: input.canvasUrl || input.thumbnailUrl || null,
        sourceModule: "agent_studio",
        sourceMetadata: input as Record<string, unknown>,
      });
    },

    updateAsset(projectId: string, assetId: string, input: Partial<Asset>) {
      return controlApiJsonRequest<Asset>(
        `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`,
        {
          method: "PUT",
          body: JSON.stringify(input),
        },
      );
    },

    deleteAsset(projectId: string, assetId: string) {
      return controlApiJsonRequest<{ deleted: boolean; assetId: string }>(
        `/api/projects/${encodeURIComponent(projectId)}/assets/${encodeURIComponent(assetId)}`,
        { method: "DELETE" },
      );
    },

    extractAssets(projectId: string, sourceText: string) {
      return createCanonicalJob({
        jobType: "project_assets_extract_requested",
        domain: "project",
        actionCode: "assets_extract",
        inputSummary: sourceText,
        payload: { projectId, sourceText },
      });
    },

    generateAssetImage(projectId: string, assetId: string, input: AssetImageGenerateInput) {
      return createCanonicalJob({
        jobType: "asset_image_generate",
        domain: "project",
        actionCode: "asset_image_generate",
        inputSummary: input.generationPrompt,
        payload: { projectId, assetId, ...input },
      });
    },

    listStoryboards(projectId: string, episodeNo?: number) {
      const params = new URLSearchParams();
      if (episodeNo != null) params.set("episodeNo", String(episodeNo));
      const query = params.toString();
      return controlApiJsonRequest<{ items: Storyboard[] }>(
        `/api/projects/${encodeURIComponent(projectId)}/storyboards${query ? `?${query}` : ""}`,
      );
    },

    getStoryboard(projectId: string, storyboardId: string) {
      return controlApiJsonRequest<Storyboard>(
        `/api/projects/${encodeURIComponent(projectId)}/storyboards/${encodeURIComponent(storyboardId)}`,
      );
    },

    updateStoryboard(projectId: string, storyboardId: string, input: Partial<Storyboard>) {
      return controlApiJsonRequest<Storyboard>(
        `/api/projects/${encodeURIComponent(projectId)}/storyboards/${encodeURIComponent(storyboardId)}`,
        {
          method: "PUT",
          body: JSON.stringify(input),
        },
      );
    },

    deleteStoryboard(projectId: string, storyboardId: string) {
      return controlApiJsonRequest<{ deleted: boolean; storyboardId: string }>(
        `/api/projects/${encodeURIComponent(projectId)}/storyboards/${encodeURIComponent(storyboardId)}`,
        { method: "DELETE" },
      );
    },

    autoGenerateStoryboards(
      projectId: string,
      sourceText?: string,
      options?: { systemPrompt?: string; maxShots?: number; episodeNo?: number },
    ) {
      return createCanonicalJob({
        jobType: "storyboards_auto_generate",
        domain: "project",
        actionCode: "storyboards_auto_generate",
        inputSummary: sourceText,
        payload: {
          projectId,
          ...(sourceText ? { sourceText } : {}),
          ...(options?.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
          ...(options?.maxShots ? { maxShots: options.maxShots } : {}),
          ...(options?.episodeNo != null ? { episodeNo: options.episodeNo } : {}),
        },
      });
    },

    getCreateCreditQuote,
    getProjectCreditQuote,

    generateStoryboardImage(
      storyboardId: string,
      prompt?: string,
      referenceImageUrls?: string[],
      imageModel?: string,
    ) {
      return createCanonicalJob({
        jobType: "storyboard_image_generate",
        domain: "project",
        actionCode: "storyboard_image_generate",
        inputSummary: prompt,
        payload: {
          storyboardId,
          prompt,
          ...(referenceImageUrls?.length ? { referenceImageUrls } : {}),
          ...(imageModel ? { imageModel } : {}),
        },
      });
    },

    listVideos(projectId: string) {
      return controlApiJsonRequest<{ items: VideoItem[] }>(
        `/api/projects/${encodeURIComponent(projectId)}/videos`,
      );
    },

    generateVideo(storyboardId: string, input?: { motionPreset?: string; mode?: string }) {
      return createCanonicalJob({
        jobType: "storyboard_video_generate",
        domain: "project",
        actionCode: "storyboard_video_generate",
        inputSummary: input?.motionPreset || input?.mode || storyboardId,
        payload: { storyboardId, ...(input ?? {}) },
      });
    },

    listDubbings(projectId: string) {
      return controlApiJsonRequest<{ items: Dubbing[] }>(
        `/api/projects/${encodeURIComponent(projectId)}/dubbings`,
      );
    },

    updateDubbing(projectId: string, dubbingId: string, input: Partial<Dubbing>) {
      return controlApiJsonRequest<Dubbing>(
        `/api/projects/${encodeURIComponent(projectId)}/dubbings/${encodeURIComponent(dubbingId)}`,
        {
          method: "PUT",
          body: JSON.stringify(input),
        },
      );
    },

    generateDubbing(storyboardId: string, input?: { text?: string; speakerName?: string; voicePreset?: string }) {
      return createCanonicalJob({
        jobType: "storyboard_dubbing_generate",
        domain: "project",
        actionCode: "storyboard_dubbing_generate",
        inputSummary: input?.text || storyboardId,
        payload: { storyboardId, ...(input ?? {}) },
      });
    },

    generateLipSync(storyboardId: string) {
      return createCanonicalJob({
        jobType: "storyboard_lipsync_generate",
        domain: "project",
        actionCode: "storyboard_lipsync_generate",
        inputSummary: storyboardId,
        payload: { storyboardId },
      });
    },

    getTimeline(projectId: string) {
      return controlApiJsonRequest<Timeline>(`/api/projects/${encodeURIComponent(projectId)}/timeline`);
    },

    updateTimeline(projectId: string, input: Pick<Timeline, "tracks" | "totalDurationSeconds">) {
      return controlApiJsonRequest<Timeline>(`/api/projects/${encodeURIComponent(projectId)}/timeline`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
    },

    createExport(projectId: string, format = "mp4") {
      return controlApiJsonRequest<{ id: string; projectId: string; format: string; status: string; jobId?: string | null }>(
        `/api/projects/${encodeURIComponent(projectId)}/exports`,
        {
          method: "POST",
          body: JSON.stringify({ format }),
        },
      );
    },

    async listCanvasProjects() {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      const response = await controlApiJsonRequest<{ items: CanvasProjectSummary[] }>(
        `/api/canvas-projects?${buildControlScopeQuery(actorId, ownerScope)}`,
      );
      return {
        ...response,
        items: dedupeCanvasProjectSummaries(Array.isArray(response.items) ? response.items : []),
      };
    },

    getCanvasProject(projectId: string) {
      return controlApiJsonRequest<CanvasProject>(`/api/canvas-projects/${encodeURIComponent(projectId)}`);
    },

    saveCanvasProject(input: CanvasProjectSaveInput) {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      const path = input.id
        ? `/api/canvas-projects/${encodeURIComponent(input.id)}`
        : "/api/canvas-projects";
      return controlApiJsonRequest<CanvasProject>(path, {
        method: input.id ? "PUT" : "POST",
        body: JSON.stringify({
          ...buildControlMediaScope(actorId, ownerScope),
          ...input,
        }),
      });
    },

    deleteCanvasProject(projectId: string) {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      return controlApiJsonRequest<{ deleted: boolean; projectId: string }>(
        `/api/canvas-projects/${encodeURIComponent(projectId)}?${buildControlScopeQuery(actorId, ownerScope)}`,
        { method: "DELETE" },
      );
    },

    async listAgentCanvasProjects() {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      const response = await controlApiJsonRequest<{ items: AgentCanvasProjectSummary[] }>(
        `/api/agent-canvas/projects?${buildControlScopeQuery(actorId, ownerScope)}`,
      );
      return {
        ...response,
        items: dedupeCanvasProjectSummaries(
          Array.isArray(response.items) ? response.items : [],
        ) as AgentCanvasProjectSummary[],
      };
    },

    getAgentCanvasProject(projectId: string) {
      return controlApiJsonRequest<AgentCanvasProject>(
        `/api/agent-canvas/projects/${encodeURIComponent(projectId)}`,
      );
    },

    saveAgentCanvasProject(input: AgentCanvasProjectSaveInput) {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      const path = input.id
        ? `/api/agent-canvas/projects/${encodeURIComponent(input.id)}`
        : "/api/agent-canvas/projects";
      return controlApiJsonRequest<AgentCanvasProject>(path, {
        method: input.id ? "PUT" : "POST",
        body: JSON.stringify({
          ...buildControlMediaScope(actorId, ownerScope),
          ...input,
          kind: "agent_canvas",
          agentContext: input.agentContext ?? null,
        }),
      });
    },

    deleteAgentCanvasProject(projectId: string) {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      return controlApiJsonRequest<{ deleted: boolean; projectId: string }>(
        `/api/agent-canvas/projects/${encodeURIComponent(projectId)}?${buildControlScopeQuery(actorId, ownerScope)}`,
        { method: "DELETE" },
      );
    },
  };
}
