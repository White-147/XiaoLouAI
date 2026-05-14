import type { AssetSyncDraft } from "../../assets-media-projects/asset-sync/AssetSyncControls";
import { getGeneratedMediaUrl } from "../../assets-media-projects/media/GenerationPlaceholder";
import type {
  CreateVideoResult,
  Task,
  VideoMultiReferenceImages,
  VideoMultiReferenceKey,
} from "./api/create-video";

export function multiReferenceUrls(value?: string | string[] | null) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized ? [normalized] : [];
}

export function resultCover(item: CreateVideoResult) {
  return getGeneratedMediaUrl(item.thumbnailUrl);
}

export function playableVideoUrl(item: CreateVideoResult) {
  return getGeneratedMediaUrl(item.videoUrl);
}

export function resultReferenceUrl(url?: string | null) {
  return getGeneratedMediaUrl(url);
}

export function resultMultiReferenceUrl(
  item: Pick<CreateVideoResult, "multiReferenceImages">,
  key: VideoMultiReferenceKey,
) {
  return getGeneratedMediaUrl(multiReferenceUrls(item.multiReferenceImages?.[key])[0]);
}

export function displayedResolution(item: Pick<CreateVideoResult, "outputResolution" | "resolution">) {
  return item.outputResolution || item.resolution;
}

export type VideoOutputMetadata = {
  outputDuration?: string | null;
  outputAspectRatio?: string | null;
  posterUrl?: string | null;
};

export function displayedDuration(
  item: Pick<CreateVideoResult, "duration" | "outputDuration">,
  metadata?: VideoOutputMetadata | null,
) {
  return metadata?.outputDuration || item.outputDuration || item.duration;
}

export function displayedAspectRatio(
  item: Pick<CreateVideoResult, "aspectRatio" | "outputAspectRatio">,
  metadata?: VideoOutputMetadata | null,
) {
  return metadata?.outputAspectRatio || item.outputAspectRatio || item.aspectRatio;
}

export function formatOutputDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return `${Math.max(1, Math.round(seconds))}s`;
}

export function formatOutputAspectRatio(width: number, height: number) {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return null;
  const ratio = width / height;
  const knownRatios = [
    { label: "16:9", value: 16 / 9 },
    { label: "9:16", value: 9 / 16 },
    { label: "1:1", value: 1 },
    { label: "4:3", value: 4 / 3 },
    { label: "3:4", value: 3 / 4 },
    { label: "3:2", value: 3 / 2 },
    { label: "2:3", value: 2 / 3 },
  ];

  let bestLabel: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of knownRatios) {
    const distance = Math.abs(ratio - candidate.value);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestLabel = candidate.label;
    }
  }
  return bestLabel && bestDistance <= 0.05 ? bestLabel : `${Math.round(width)}:${Math.round(height)}`;
}

export const videoOutputMetadataCache = new Map<string, VideoOutputMetadata>();
export const videoOutputMetadataInflight = new Map<string, Promise<VideoOutputMetadata>>();

export function derivedResultCover(
  item: CreateVideoResult,
  metadata?: Pick<VideoOutputMetadata, "posterUrl"> | null,
) {
  return metadata?.posterUrl || resultCover(item);
}

export function readVideoOutputMetadata(url: string) {
  if (videoOutputMetadataCache.has(url)) {
    return Promise.resolve(videoOutputMetadataCache.get(url) || {});
  }
  if (videoOutputMetadataInflight.has(url)) {
    return videoOutputMetadataInflight.get(url) || Promise.resolve({});
  }

  const promise = new Promise<VideoOutputMetadata>((resolve) => {
    const video = document.createElement("video");
    let settled = false;
    const buildMetadata = () => {
      const metadata: VideoOutputMetadata = {
        outputDuration: formatOutputDuration(video.duration),
        outputAspectRatio: formatOutputAspectRatio(video.videoWidth, video.videoHeight),
      };
      try {
        const width = video.videoWidth;
        const height = video.videoHeight;
        if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext("2d");
          if (context) {
            context.drawImage(video, 0, 0, width, height);
            metadata.posterUrl = canvas.toDataURL("image/jpeg", 0.92);
          }
        }
      } catch {}
      return metadata;
    };
    const cleanup = () => {
      video.removeAttribute("src");
      video.load();
      videoOutputMetadataInflight.delete(url);
    };
    const settle = (metadata: VideoOutputMetadata) => {
      if (settled) return;
      settled = true;
      videoOutputMetadataCache.set(url, metadata);
      cleanup();
      resolve(metadata);
    };
    video.preload = "metadata";
    video.crossOrigin = "anonymous";
    video.onloadeddata = () => {
      settle(buildMetadata());
    };
    video.onloadedmetadata = () => {
      if (video.readyState >= 2) {
        settle(buildMetadata());
      }
    };
    video.onerror = () => {
      settle({});
    };
    video.src = url;
  });

  videoOutputMetadataInflight.set(url, promise);
  return promise;
}

export function taskLastFrame(task: Task) {
  const value = task.metadata?.lastFrameUrl;
  return typeof value === "string" ? getGeneratedMediaUrl(value) : null;
}

export function hasMultiReferenceImages(item: CreateVideoResult) {
  const m = item.multiReferenceImages;
  if (!m || typeof m !== "object") return false;
  return Object.values(m).some((value) => multiReferenceUrls(value).length > 0);
}

export function videoPreviewReason(item: CreateVideoResult) {
  const hasStillInput = Boolean(
    item.referenceImageUrl ||
      item.resolvedReferenceImageUrl ||
      item.firstFrameUrl ||
      hasMultiReferenceImages(item),
  );
  if (!hasStillInput && !item.model.includes("T2V") && !item.model.includes("KF2V")) {
    return "这条结果缺少参考图或首尾帧输入。请按当前创作模式重新生成。";
  }

  return "这条结果没有拿到真实可播放地址。请去 API 中心检查视频模型与密钥配置后再重新生成。";
}

export function videoCoverReason(item: CreateVideoResult) {
  if (playableVideoUrl(item)) {
    return "当前结果没有返回封面图，但视频已经可播放。点击卡片即可预览。";
  }

  return "当前结果暂无封面预览。";
}

export function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function summarizeVideoPrompt(value: string, fallback: string): string {
  const normalized = (value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.length > 18 ? `${normalized.slice(0, 18)}...` : normalized;
}

export function resolveTaskProjectId(task: Task | null | undefined): string | null {
  const directProjectId = typeof task?.projectId === "string" ? task.projectId.trim() : "";
  if (directProjectId) return directProjectId;
  const metadataProjectId =
    task?.metadata && typeof task.metadata.projectId === "string"
      ? task.metadata.projectId.trim()
      : "";
  return metadataProjectId || null;
}

export function buildVideoAssetDraft(
  item: CreateVideoResult,
  targetProjectId?: string | null,
): AssetSyncDraft {
  const mediaUrl = playableVideoUrl(item);
  const previewUrl = resultCover(item);
  return {
    id: item.id,
    mediaKind: "video",
    previewUrl: previewUrl || null,
    mediaUrl: mediaUrl || null,
    prompt: item.prompt || "",
    model: item.model || "",
    aspectRatio: displayedAspectRatio(item) || item.aspectRatio || "",
    taskId: item.taskId ?? null,
    targetProjectId: targetProjectId || null,
    referenceImageUrl: item.referenceImageUrl ?? null,
    defaultAssetType: "video_ref",
    sourceModule: "video_create",
    defaultName: summarizeVideoPrompt(item.prompt, `视频素材 ${formatTime(item.createdAt)}`),
    defaultDescription: [
      item.prompt,
      `来源：视频创作`,
      item.model ? `模型：${item.model}` : "",
      item.videoMode ? `模式：${item.videoMode}` : "",
      `比例：${displayedAspectRatio(item) || item.aspectRatio || ""}`,
      `分辨率：${displayedResolution(item)}`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export function taskReference(task: Task) {
  const first = task.metadata?.firstFrameUrl;
  if (typeof first === "string" && first) return getGeneratedMediaUrl(first);
  const multi = task.metadata?.multiReferenceImages;
  if (multi && typeof multi === "object") {
    const order: VideoMultiReferenceKey[] = [
      "scene",
      "character",
      "prop",
      "pose",
      "expression",
      "effect",
      "sketch",
    ];
    for (const key of order) {
      const u = multiReferenceUrls((multi as VideoMultiReferenceImages)[key])[0];
      if (u) return getGeneratedMediaUrl(u);
    }
  }
  const resolved = task.metadata?.resolvedReferenceImageUrl;
  if (typeof resolved === "string" && resolved) return getGeneratedMediaUrl(resolved);
  const ref = task.metadata?.referenceImageUrl;
  if (typeof ref === "string" && ref) return getGeneratedMediaUrl(ref);
  return null;
}

export function taskReferenceCaption(task: Task) {
  const meta = task.metadata;
  if (meta && typeof meta.firstFrameUrl === "string" && meta.firstFrameUrl) {
    return "首尾帧输入";
  }
  if (meta?.multiReferenceImages && typeof meta.multiReferenceImages === "object") {
    const m = meta.multiReferenceImages as VideoMultiReferenceImages;
    if (Object.values(m).some((value) => multiReferenceUrls(value).length > 0)) {
      return "多参参考图";
    }
  }
  if (meta && typeof meta.referenceImageUrl === "string" && meta.referenceImageUrl) {
    return "参考图";
  }
  return "参考输入";
}

export function resolvedTaskReferenceCaption(task: Task) {
  const meta = task.metadata;
  if (meta && typeof meta.firstFrameUrl === "string" && meta.firstFrameUrl) {
    return "首尾帧输入";
  }
  if (meta?.multiReferenceImages && typeof meta.multiReferenceImages === "object") {
    const m = meta.multiReferenceImages as VideoMultiReferenceImages;
    if (Object.values(m).some((value) => multiReferenceUrls(value).length > 0)) {
      return "多参参考图";
    }
  }
  if (meta && typeof meta.resolvedReferenceImageUrl === "string" && meta.resolvedReferenceImageUrl) {
    return "主参考图";
  }
  if (meta && typeof meta.referenceImageUrl === "string" && meta.referenceImageUrl) {
    return "参考图";
  }
  return "参考输入";
}
