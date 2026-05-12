import { getAuthToken, getCurrentActorId } from "../actor-session";
import type { Asset } from "../api";
import {
  ApiRequestError,
  assertNoLegacyMutatingRequest,
} from "./control-api-client";

// Video Replace MVP
// Chain: browser -> 3000 (Vite) -> 4100 (core-api, native handler) -> Python CLI.
// Core-api handles /api/video-replace and /vr-* paths itself and spawns Python
// subprocesses (vr_probe_cli.py / vr_detect_cli.py / vr_pipeline_cli.py) on demand.

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
  };
};

const VIDEO_REPLACE_BASE = "/api/video-replace";

export type VideoReplaceStage =
  | "uploaded"
  | "detecting"
  | "detected"
  | "queued"
  | "tracking"
  | "mask_ready"
  | "replacing"
  | "succeeded"
  | "failed"
  | "cancelled";

export type VideoReplaceMeta = {
  duration_seconds: number;
  width: number;
  height: number;
  fps: number;
  frame_count: number;
  codec: string | null;
};

export type VideoReplaceUploadResult = {
  job_id: string;
  video_url: string;
  thumbnail_url: string | null;
  meta: VideoReplaceMeta;
};

export type VideoReplaceReferenceResult = {
  url: string;
  filename: string;
  content_type: string;
  size_bytes: number;
};

export type VideoReplacePersonCandidate = {
  person_id: string;
  bbox: number[];
  confidence: number;
  preview_url: string;
  mask_preview_url: string | null;
};

export type VideoReplaceDetection = {
  job_id: string;
  keyframe_index: number;
  keyframe_url: string;
  candidates: VideoReplacePersonCandidate[];
};

export type VideoReplaceAdvanced = {
  yolo_conf: number;
  sam2_size: "tiny" | "small" | "base_plus";
  mask_dilation_px: number;
  mask_blur_px: number;
  sample_steps: number;
  sample_size: "832*480" | "480*832";
  inference_fps?: 15 | 30 | 60;
  max_frame_num?: number;
  frame_num?: number;
  output_fps?: number;
  base_seed: number | null;
};

export type VideoReplaceMode = "full" | "lite";

export type VideoReplaceJobStatus = {
  job_id: string;
  stage: VideoReplaceStage;
  progress: number;
  message: string | null;
  error: string | null;
  queue_ahead?: number | null;
  queue_position?: number | null;
  created_at: string;
  updated_at: string;
  actor_id?: string | null;
  project_id?: string | null;
  project_asset_id?: string | null;
  source_video_url: string | null;
  thumbnail_url: string | null;
  meta: VideoReplaceMeta | null;
  detection: VideoReplaceDetection | null;
  source_person_id: string | null;
  target_reference_url: string | null;
  advanced: VideoReplaceAdvanced | null;
  mask_preview_url: string | null;
  // Legacy (aliases the final/browser-compat deliverable)
  result_video_url: string | null;
  result_download_url: string | null;
  // Dual-track results: `raw` is the pipeline artifact before postprocess,
  // `final` is the H.264/AAC mp4 with audio muxed back in -- this is what
  // the UI must play and offer as a download.
  raw_result_video_url: string | null;
  final_result_video_url: string | null;
  final_result_download_url: string | null;
  // Which pipeline actually ran. "full" = SAM2 + VACE, "lite" = OpenCV fallback.
  mode: VideoReplaceMode | null;
  tracker_backend: string | null;
  replacer_backend: string | null;
};

export type VideoReplaceGenerateInput = {
  source_person_id: string;
  target_reference_url: string;
  project_id?: string | null;
  prompt?: string | null;
  yolo_conf?: number;
  sam2_size?: "tiny" | "small" | "base_plus";
  mask_dilation_px?: number;
  mask_blur_px?: number;
  sample_steps?: number;
  sample_size?: "832*480" | "480*832";
  inference_fps?: 15 | 30 | 60;
  max_frame_num?: number;
  base_seed?: number | null;
};

async function videoReplaceRequest<T>(path: string, init?: RequestInit): Promise<T> {
  assertNoLegacyMutatingRequest(`${VIDEO_REPLACE_BASE}${path}`, init);

  const actorId = getCurrentActorId();
  const token = getAuthToken();
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("X-Actor-Id", actorId);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${VIDEO_REPLACE_BASE}${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  let payload: ApiEnvelope<T> | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      throw new ApiRequestError(
        response.ok ? "视频替换服务返回格式无效" : `视频替换接口错误（${response.status}）`,
        { code: "VR_INVALID_RESPONSE", status: response.status || 500 },
      );
    }
  }
  if (!payload) {
    throw new ApiRequestError(
      response.ok ? "视频替换服务返回为空" : `视频替换接口错误（${response.status}）`,
      { code: "VR_EMPTY_RESPONSE", status: response.status || 500 },
    );
  }
  if (!response.ok || !payload.success) {
    throw new ApiRequestError(
      payload.error?.message ?? "视频替换接口请求失败",
      { code: payload.error?.code, status: response.status },
    );
  }
  return payload.data;
}

export async function uploadVideoReplaceSource(file: File) {
  const form = new FormData();
  form.append("file", file);
  return videoReplaceRequest<VideoReplaceUploadResult>("/upload", {
    method: "POST",
    body: form,
  });
}

/**
 * Create a job from an already-hosted video URL (e.g. a project asset
 * served by core-api). The backend fetches and re-persists the video.
 */
export async function importVideoReplaceJob(input: {
  video_url: string;
  original_filename?: string;
  project_id?: string | null;
}) {
  return videoReplaceRequest<VideoReplaceUploadResult>("/jobs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function uploadVideoReplaceReference(file: File) {
  const form = new FormData();
  form.append("file", file);
  return videoReplaceRequest<VideoReplaceReferenceResult>("/reference", {
    method: "POST",
    body: form,
  });
}

/**
 * Pin an existing image asset (e.g. a project character reference) as
 * the replacement character. The backend downloads and re-hosts it so
 * subsequent pipeline stages can read from a stable local path.
 */
export async function importVideoReplaceReference(input: {
  image_url: string;
  original_filename?: string;
}) {
  return videoReplaceRequest<VideoReplaceReferenceResult>("/reference-import", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function detectVideoReplaceCandidates(
  jobId: string,
  opts: { yolo_conf?: number } = {},
) {
  return videoReplaceRequest<VideoReplaceJobStatus>(
    `/jobs/${encodeURIComponent(jobId)}/detect`,
    {
      method: "POST",
      body: JSON.stringify(
        opts.yolo_conf !== undefined ? { yolo_conf: opts.yolo_conf } : {},
      ),
    },
  );
}

export async function submitVideoReplaceGenerate(
  jobId: string,
  input: VideoReplaceGenerateInput,
) {
  return videoReplaceRequest<VideoReplaceJobStatus>(
    `/jobs/${encodeURIComponent(jobId)}/generate`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function getVideoReplaceJob(jobId: string) {
  return videoReplaceRequest<VideoReplaceJobStatus>(
    `/jobs/${encodeURIComponent(jobId)}`,
  );
}

export async function listVideoReplaceJobs(limit = 30, projectId?: string | null) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (projectId) params.set("project_id", projectId);
  return videoReplaceRequest<{ items: VideoReplaceJobStatus[] }>(
    `/jobs?${params.toString()}`,
  );
}

export async function syncVideoReplaceJobAsset(projectId: string, jobId: string) {
  return videoReplaceRequest<{ asset: Asset; job: VideoReplaceJobStatus }>(
    `/jobs/${encodeURIComponent(jobId)}/sync-asset`,
    {
      method: "POST",
      body: JSON.stringify({ project_id: projectId }),
    },
  );
}

export async function cancelVideoReplaceJob(jobId: string) {
  return videoReplaceRequest<VideoReplaceJobStatus>(
    `/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST" },
  );
}

export function videoReplaceStreamUrl(jobId: string): string {
  const params = new URLSearchParams({ actorId: getCurrentActorId() });
  return `${VIDEO_REPLACE_BASE}/jobs/${encodeURIComponent(jobId)}/stream?${params.toString()}`;
}
