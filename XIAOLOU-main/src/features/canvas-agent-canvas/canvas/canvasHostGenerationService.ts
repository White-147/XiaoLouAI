import {
  generateCreateImages,
  generateCreateVideos,
  getCreateImageCapabilities,
  getCreateVideoCapabilities,
  getTask,
  listAssets,
  listCreateImages,
  listCreateVideos,
  newIdempotencyKey,
} from "./api/canvas";
import { parseGenerationError } from "../../../lib/generation-error";
import type {
  CanvasHostServices,
  HostFindStrayGenerationRequest,
  HostRecoverGenerationRequest,
  HostRecoverGenerationResult,
} from "./runtime/integrations/canvasHostServices";
import {
  getVideoCapabilityInputMode,
  inlineReferenceImageUrl,
  normalizeBridgeSelectableValue,
  normalizeBridgeVideoMode,
  normalizeBridgeVideoModeDuration,
  resolveAbsoluteAssetUrl,
} from "./canvasBridgeMedia";

const CREATE_IMAGE_POLL_INTERVAL_MS = 1500;
const CREATE_IMAGE_TIMEOUT_MS = 300000; // 5 minutes
const CREATE_VIDEO_TIMEOUT_MS = 660000; // 11 minutes

type CanvasGenerationServices = Pick<
  CanvasHostServices,
  | "generateImage"
  | "generateVideo"
  | "recoverGeneration"
  | "findStrayGeneration"
  | "getImageCapabilities"
  | "getVideoCapabilities"
>;

async function assertCanvasVideoModelReady(model: string, videoMode: string) {
  const modelId = String(model || "").trim();
  if (!modelId) {
    throw new Error("视频生成缺少模型参数，请重新选择视频模型后再生成。");
  }

  let capabilities: Awaited<ReturnType<typeof getCreateVideoCapabilities>>;
  try {
    capabilities = await getCreateVideoCapabilities(videoMode);
  } catch (err) {
    console.warn("[CanvasCreate] Failed to load video capabilities before generation:", err);
    throw new Error("视频模型配置获取失败，请刷新页面或检查模型配置后再生成。");
  }

  const target = capabilities.items.find((item) => item.id === modelId);
  const inputMode = getVideoCapabilityInputMode(videoMode);
  const modeCapability = target?.inputModes?.[inputMode];
  if (!target || !modeCapability || modeCapability.supported === false || target.status === "failing" || modeCapability.status === "failing") {
    throw new Error(`当前视频模型不可用于该生成模式：${modelId} / ${videoMode}。请重新选择可用模型后再生成。`);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isTerminalGenerationLookupError(err: unknown) {
  const anyErr = err as { code?: string; status?: number } | null | undefined;
  const code = String(anyErr?.code || "").trim().toUpperCase();
  const status = typeof anyErr?.status === "number" ? anyErr.status : 0;
  return (
    code === "FORBIDDEN" ||
    code === "UNAUTHORIZED" ||
    code === "NOT_FOUND" ||
    status === 401 ||
    status === 403 ||
    status === 404
  );
}

function shouldUseProjectAssetFallback(projectId?: string | null) {
  const normalized = String(projectId || "").trim();
  return Boolean(normalized) && !/^(agent_)?canvas_/i.test(normalized);
}

function describeTaskFailure(
  task: Pick<Awaited<ReturnType<typeof getTask>>, "outputSummary" | "currentStage">,
  fallback: string,
) {
  const reason =
    String(task.outputSummary || "").trim() ||
    String(task.currentStage || "").trim() ||
    "";
  return reason ? parseGenerationError(new Error(reason)).message : fallback;
}

async function waitForCreateImageResult(taskId: string) {
  const deadline = Date.now() + CREATE_IMAGE_TIMEOUT_MS;
  let lastStatus = "queued";
  while (Date.now() < deadline) {
    let task: Awaited<ReturnType<typeof getTask>>;
    try {
      task = await getTask(taskId);
    } catch (err) {
      if (isTerminalGenerationLookupError(err)) throw err;
      console.warn("[CanvasCreate] waitForCreateImageResult transient getTask failure:", err);
      await sleep(CREATE_IMAGE_POLL_INTERVAL_MS);
      continue;
    }
    lastStatus = task.status || lastStatus;
    if (["failed", "cancelled", "canceled"].includes(task.status)) {
      throw new Error(describeTaskFailure(task, "图片创作任务失败。"));
    }
    try {
      const response = await listCreateImages();
      const matched = response.items.find((item) => item.taskId === taskId);
      const resultUrl = resolveAbsoluteAssetUrl(matched?.imageUrl);
      if (matched && resultUrl) return { resultUrl, model: matched.model };
    } catch (err) {
      if (isTerminalGenerationLookupError(err)) throw err;
      console.warn("[CanvasCreate] waitForCreateImageResult transient listCreateImages failure:", err);
    }
    await sleep(CREATE_IMAGE_POLL_INTERVAL_MS);
  }
  throw new Error(`图片创作结果等待超时，最后状态：${lastStatus}`);
}

async function waitForCreateVideoResult(taskId: string, projectId?: string) {
  const deadline = Date.now() + CREATE_VIDEO_TIMEOUT_MS;
  let lastStatus = "queued";
  let succeededWithoutUrl = 0;
  while (Date.now() < deadline) {
    let task: Awaited<ReturnType<typeof getTask>>;
    try {
      task = await getTask(taskId);
    } catch (err) {
      if (isTerminalGenerationLookupError(err)) throw err;
      console.warn("[CanvasCreate] waitForCreateVideoResult transient getTask failure:", err);
      await sleep(CREATE_IMAGE_POLL_INTERVAL_MS);
      continue;
    }
    lastStatus = task.status || lastStatus;
    if (["failed", "cancelled", "canceled"].includes(task.status)) {
      throw new Error(describeTaskFailure(task, "视频创作任务失败。"));
    }
    let matched:
      | Awaited<ReturnType<typeof listCreateVideos>>["items"][number]
      | undefined;
    try {
      const response = await listCreateVideos();
      matched = response.items.find((item) => item.taskId === taskId);
      const resultUrl = resolveAbsoluteAssetUrl(matched?.videoUrl);
      if (matched && resultUrl) {
        return { resultUrl, previewUrl: resolveAbsoluteAssetUrl(matched.thumbnailUrl) || undefined, model: matched.model };
      }
    } catch (err) {
      if (isTerminalGenerationLookupError(err)) throw err;
      console.warn("[CanvasCreate] waitForCreateVideoResult transient listCreateVideos failure:", err);
    }
    if (shouldUseProjectAssetFallback(projectId)) {
      try {
        const assetResponse = await listAssets(projectId, "video_ref");
        const matchedAsset = assetResponse.items.find(
          (a) => String(a.sourceTaskId || "").trim() === taskId,
        );
        const assetUrl =
          resolveAbsoluteAssetUrl(matchedAsset?.mediaUrl) ||
          resolveAbsoluteAssetUrl(matchedAsset?.previewUrl);
        if (matchedAsset && assetUrl) {
          return {
            resultUrl: assetUrl,
            previewUrl: resolveAbsoluteAssetUrl(matchedAsset.previewUrl) || undefined,
            model: matched?.model || matchedAsset.imageModel || undefined,
          };
        }
      } catch (err) {
        console.warn("[CanvasCreate] waitForCreateVideoResult optional listAssets failure:", err);
      }
    }
    if (task.status === "succeeded" && ++succeededWithoutUrl > 6) {
      throw new Error("视频任务已完成，但未能获取有效视频地址。");
    }
    await sleep(CREATE_IMAGE_POLL_INTERVAL_MS);
  }
  throw new Error(`视频创作结果等待超时，最后状态：${lastStatus}`);
}

function describeRecoveryLookupError(
  err: unknown,
  kind: "image" | "video",
): string {
  const anyErr = err as { code?: string; status?: number; message?: string } | null | undefined;
  const code = String(anyErr?.code || "").toUpperCase();
  const status = typeof anyErr?.status === "number" ? anyErr.status : 0;
  const rawMessage = String(anyErr?.message || "").trim();
  const kindLabel = kind === "image" ? "图片" : "视频";

  if (code === "FORBIDDEN" || code === "UNAUTHORIZED" || status === 401 || status === 403) {
    return (
      `[${code || "FORBIDDEN"}] 历史${kindLabel}任务已无法访问（可能是跨账户、已被清理或会话已过期）。` +
      `请删除该节点并重新生成。详情：${rawMessage || "You do not have access to this task."}`
    );
  }
  if (code === "NOT_FOUND" || status === 404) {
    return (
      `[${code || "NOT_FOUND"}] 历史${kindLabel}任务记录不存在（可能已被清理或超时）。` +
      `请删除该节点并重新生成。`
    );
  }
  return rawMessage || "无法获取任务状态。";
}

async function recoverImageGeneration(taskId: string): Promise<HostRecoverGenerationResult> {
  let taskStatus: string | undefined;
  try {
    const task = await getTask(taskId);
    taskStatus = task?.status;
    if (["failed", "cancelled", "canceled"].includes(task.status || "")) {
      return {
        status: "failed",
        error: describeTaskFailure(task, "图片创作任务失败。"),
      };
    }
  } catch (err) {
    if (isTerminalGenerationLookupError(err)) {
      return {
        status: "failed",
        error: describeRecoveryLookupError(err, "image"),
      };
    }
    console.warn("[CanvasCreate] recoverImageGeneration transient getTask failure:", err);
    return { status: "pending" };
  }

  try {
    const response = await listCreateImages();
    const matched = response.items.find((item) => item.taskId === taskId);
    const resultUrl = resolveAbsoluteAssetUrl(matched?.imageUrl);
    if (matched && resultUrl) {
      return { status: "succeeded", resultUrl, model: matched.model };
    }
  } catch (err) {
    // Transient - fall through to pending.
  }

  if (taskStatus === "succeeded") {
    // Task says done but no row yet - still pending client-side.
    return { status: "pending" };
  }
  return { status: "pending" };
}

async function recoverVideoGeneration(
  taskId: string,
  projectId?: string | null,
): Promise<HostRecoverGenerationResult> {
  let taskStatus: string | undefined;
  try {
    const task = await getTask(taskId);
    taskStatus = task?.status;
    if (["failed", "cancelled", "canceled"].includes(task.status || "")) {
      return {
        status: "failed",
        error: describeTaskFailure(task, "视频创作任务失败。"),
      };
    }
  } catch (err) {
    if (isTerminalGenerationLookupError(err)) {
      return {
        status: "failed",
        error: describeRecoveryLookupError(err, "video"),
      };
    }
    console.warn("[CanvasCreate] recoverVideoGeneration transient getTask failure:", err);
    return { status: "pending" };
  }

  try {
    const response = await listCreateVideos();
    const matched = response.items.find((item) => item.taskId === taskId);
    const resultUrl = resolveAbsoluteAssetUrl(matched?.videoUrl);
    if (matched && resultUrl) {
      return {
        status: "succeeded",
        resultUrl,
        previewUrl: resolveAbsoluteAssetUrl(matched.thumbnailUrl) || undefined,
        model: matched.model,
      };
    }
  } catch { /* fall through */ }

  if (shouldUseProjectAssetFallback(projectId)) {
    try {
      const assetResponse = await listAssets(projectId, "video_ref");
      const matchedAsset = assetResponse.items.find(
        (a) => String(a.sourceTaskId || "").trim() === taskId,
      );
      const assetUrl =
        resolveAbsoluteAssetUrl(matchedAsset?.mediaUrl) ||
        resolveAbsoluteAssetUrl(matchedAsset?.previewUrl);
      if (matchedAsset && assetUrl) {
        return {
          status: "succeeded",
          resultUrl: assetUrl,
          previewUrl: resolveAbsoluteAssetUrl(matchedAsset.previewUrl) || undefined,
          model: matchedAsset.imageModel || undefined,
        };
      }
    } catch { /* fall through */ }
  }

  if (taskStatus === "succeeded") {
    return { status: "pending" };
  }
  return { status: "pending" };
}

function normalizePromptForMatch(value?: string | null): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

async function findStrayImageResult(
  request: HostFindStrayGenerationRequest,
): Promise<
  | null
  | { resultUrl: string; previewUrl?: string; model?: string; taskId?: string; createdAt?: string }
> {
  const targetPrompt = normalizePromptForMatch(request.prompt);
  const minTs = typeof request.createdAfter === "number" ? request.createdAfter : 0;
  const skip = new Set((request.excludeTaskIds || []).filter(Boolean));
  try {
    const response = await listCreateImages();
    // Newest first.
    const sorted = [...response.items].sort((a, b) => {
      const ta = Date.parse(a.createdAt || "") || 0;
      const tb = Date.parse(b.createdAt || "") || 0;
      return tb - ta;
    });
    for (const item of sorted) {
      if (!item || skip.has(item.taskId)) continue;
      const createdAtMs = Date.parse(item.createdAt || "") || 0;
      if (minTs && createdAtMs < minTs) continue;
      if (targetPrompt && normalizePromptForMatch(item.prompt) !== targetPrompt) continue;
      const resultUrl = resolveAbsoluteAssetUrl(item.imageUrl);
      if (!resultUrl) continue;
      return {
        resultUrl,
        model: item.model,
        taskId: item.taskId,
        createdAt: item.createdAt,
      };
    }
  } catch (err) {
    console.warn("[CanvasCreate] findStrayImageResult failed:", err);
  }
  return null;
}

async function findStrayVideoResult(
  request: HostFindStrayGenerationRequest,
): Promise<
  | null
  | { resultUrl: string; previewUrl?: string; model?: string; taskId?: string; createdAt?: string }
> {
  const targetPrompt = normalizePromptForMatch(request.prompt);
  const minTs = typeof request.createdAfter === "number" ? request.createdAfter : 0;
  const skip = new Set((request.excludeTaskIds || []).filter(Boolean));
  try {
    const response = await listCreateVideos();
    const sorted = [...response.items].sort((a, b) => {
      const ta = Date.parse(a.createdAt || "") || 0;
      const tb = Date.parse(b.createdAt || "") || 0;
      return tb - ta;
    });
    for (const item of sorted) {
      if (!item || skip.has(item.taskId)) continue;
      const createdAtMs = Date.parse(item.createdAt || "") || 0;
      if (minTs && createdAtMs < minTs) continue;
      if (targetPrompt && normalizePromptForMatch(item.prompt) !== targetPrompt) continue;
      const resultUrl = resolveAbsoluteAssetUrl(item.videoUrl);
      if (!resultUrl) continue;
      return {
        resultUrl,
        previewUrl: resolveAbsoluteAssetUrl(item.thumbnailUrl) || undefined,
        model: item.model,
        taskId: item.taskId,
        createdAt: item.createdAt,
      };
    }
  } catch (err) {
    console.warn("[CanvasCreate] findStrayVideoResult failed:", err);
  }
  return null;
}

export function createCanvasHostGenerationService(
  resolveReadyProjectId: () => Promise<string>,
): CanvasGenerationServices {
  return {
    async generateImage(payload) {
      const readyProjectId = await resolveReadyProjectId();
      const referenceImageUrls = await Promise.all(
        (payload.referenceImageUrls || []).filter(Boolean).map(inlineReferenceImageUrl),
      );
      const accepted = await generateCreateImages({
        projectId: readyProjectId,
        assetSyncMode: "manual",
        prompt: payload.prompt?.trim() || "",
        model: payload.model?.trim(),
        aspectRatio: payload.aspectRatio?.trim() || undefined,
        resolution: payload.resolution?.trim() || undefined,
        count: 1,
        referenceImageUrls: referenceImageUrls.filter(Boolean),
        idempotencyKey: newIdempotencyKey(),
      });
      try { payload.onTaskIdAssigned?.(accepted.taskId); } catch { /* ignore */ }
      const result = await waitForCreateImageResult(accepted.taskId);
      return { ...result, taskId: accepted.taskId };
    },

    async generateVideo(payload) {
      const readyProjectId = await resolveReadyProjectId();
      const requestedMode = normalizeBridgeVideoMode(payload.videoMode);
      const isMultiRef = Array.isArray(payload.multiReferenceImageUrls) && payload.multiReferenceImageUrls.length > 0;
      const isVideoReferenceMode =
        requestedMode === "video_edit" ||
        requestedMode === "motion_control" ||
        requestedMode === "video_extend";
      const isStartEnd =
        requestedMode === "start_end_frame" ||
        (!isMultiRef && Boolean(payload.firstFrameUrl && payload.lastFrameUrl));

      const referenceImageUrl = payload.referenceImageUrl
        ? await inlineReferenceImageUrl(payload.referenceImageUrl)
        : undefined;
      const firstFrameUrl = payload.firstFrameUrl
        ? await inlineReferenceImageUrl(payload.firstFrameUrl)
        : undefined;
      const lastFrameUrl = payload.lastFrameUrl
        ? await inlineReferenceImageUrl(payload.lastFrameUrl)
        : undefined;

      let multiReferenceImages: Record<string, string[]> | undefined;
      if (isMultiRef) {
        const inlined = (await Promise.all(
          payload.multiReferenceImageUrls!.map(inlineReferenceImageUrl),
        )).filter(Boolean) as string[];
        if (inlined.length > 0) {
          const keys = ["scene", "character", "prop", "pose", "expression", "effect", "sketch"];
          multiReferenceImages = {};
          inlined.forEach((url, i) => {
            const key = keys[i % keys.length];
            if (!multiReferenceImages![key]) multiReferenceImages![key] = [];
            multiReferenceImages![key].push(url);
          });
        }
      }

      if (requestedMode === "start_end_frame" && (!firstFrameUrl || !lastFrameUrl)) {
        throw new Error("首尾帧模式要求同时提供首帧和尾帧。");
      }
      if (isVideoReferenceMode && !(payload.referenceVideoUrls?.length || payload.motionReferenceVideoUrl)) {
        throw new Error("该视频模式要求提供参考视频素材。");
      }

      const videoMode =
        requestedMode === "video_edit" ? "video_edit" :
        requestedMode === "motion_control" ? "motion_control" :
        requestedMode === "video_extend" ? "video_extend" :
        requestedMode === "multi_param" ? "multi_param" :
        requestedMode === "start_end_frame" ? "start_end_frame" :
        requestedMode === "image_to_video" ? "image_to_video" :
        requestedMode === "text_to_video" ? "text_to_video" :
        isMultiRef ? "multi_param" :
        isStartEnd ? "start_end_frame" :
        referenceImageUrl ? "image_to_video" : "text_to_video";
      const videoModel = payload.model?.trim() || "";
      await assertCanvasVideoModelReady(videoModel, videoMode);

      const accepted = await generateCreateVideos({
        projectId: readyProjectId,
        assetSyncMode: "manual",
        prompt: payload.prompt?.trim() || "",
        model: videoModel,
        duration: normalizeBridgeVideoModeDuration(payload.duration),
        aspectRatio: normalizeBridgeSelectableValue(payload.aspectRatio),
        resolution: normalizeBridgeSelectableValue(payload.resolution),
        referenceImageUrl: (isStartEnd || isMultiRef) ? undefined : referenceImageUrl,
        firstFrameUrl: isStartEnd ? firstFrameUrl : undefined,
        lastFrameUrl: isStartEnd ? lastFrameUrl : undefined,
        multiReferenceImages,
        referenceVideoUrls: payload.referenceVideoUrls?.filter(Boolean),
        referenceAudioUrls: payload.referenceAudioUrls?.filter(Boolean),
        editMode: payload.editMode,
        editPresetId: payload.editPresetId,
        motionReferenceVideoUrl: payload.motionReferenceVideoUrl || payload.referenceVideoUrls?.[0],
        characterReferenceImageUrl: payload.characterReferenceImageUrl
          ? await inlineReferenceImageUrl(payload.characterReferenceImageUrl)
          : referenceImageUrl,
        qualityMode: payload.qualityMode,
        videoMode,
        generateAudio: payload.generateAudio,
        networkSearch: payload.networkSearch,
        idempotencyKey: newIdempotencyKey(),
      });
      try { payload.onTaskIdAssigned?.(accepted.taskId); } catch { /* ignore */ }
      const result = await waitForCreateVideoResult(accepted.taskId, readyProjectId);
      return { ...result, taskId: accepted.taskId };
    },

    async recoverGeneration(request: HostRecoverGenerationRequest): Promise<HostRecoverGenerationResult> {
      if (request.kind === "image") {
        return recoverImageGeneration(request.taskId);
      }
      const recoveryProjectId = request.projectId ?? await resolveReadyProjectId();
      return recoverVideoGeneration(request.taskId, recoveryProjectId);
    },

    async findStrayGeneration(request: HostFindStrayGenerationRequest) {
      if (request.kind === "image") return findStrayImageResult(request);
      return findStrayVideoResult(request);
    },

    async getImageCapabilities(mode) {
      return getCreateImageCapabilities(mode ?? null);
    },

    async getVideoCapabilities(mode) {
      return getCreateVideoCapabilities(mode ?? "image_to_video");
    },
  };
}
