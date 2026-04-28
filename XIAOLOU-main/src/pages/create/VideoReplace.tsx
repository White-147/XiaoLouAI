/**
 * Video Replace · Real MVP (revision 2).
 *
 * Revision 2 closes the gaps identified in the post-launch review:
 *  - Source video: local upload + project asset library (videos only).
 *  - Replacement character: local upload + project asset library (images only).
 *    No longer blocked behind source-person selection.
 *  - yolo_conf is now sent with /detect (real per-call threshold).
 *  - Stale source_person_id is cleared on every re-detect.
 *  - Result preview/download wired up — shown ONLY when result_video_url exists
 *    (backend currently never produces one; UI stays honest).
 *
 * UI stage machine:
 *   none → uploading/importing → uploaded → detecting → detected
 *          → (user picks source + replacement + tweaks params)
 *          → submitting → queued
 *          → …future: tracking → mask_ready → replacing → succeeded
 */
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Download,
  Film,
  Loader2,
  Maximize2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AssetSyncDialog,
  type AssetSyncDraft,
} from "../../components/create/AssetSyncControls";
import { CreateStudioSplitLayout } from "../../components/create/CreateStudioSplitLayout";
import {
  ReferenceAssetPicker,
  type ReferenceAssetSelection,
} from "../../components/create/ReferenceAssetPicker";
import {
  cancelVideoReplaceJob,
  createAsset,
  detectVideoReplaceCandidates,
  getAsset,
  getVideoReplaceJob,
  importVideoReplaceJob,
  importVideoReplaceReference,
  submitVideoReplaceGenerate,
  uploadVideoReplaceReference,
  uploadVideoReplaceSource,
  type Asset,
  type VideoReplaceJobStatus,
  type VideoReplacePersonCandidate,
} from "../../lib/api";
import { downloadMediaFile, guessMediaFilename } from "../../lib/download-media";
import { useCurrentProjectId } from "../../lib/session";
import { cn } from "../../lib/utils";
import { useSearchParams } from "react-router-dom";
import {
  DEFAULT_MASK_BLUR_TIER,
  DEFAULT_MASK_DILATION_TIER,
  DEFAULT_SAM2_SIZE,
  DEFAULT_SAMPLE_SIZE,
  DEFAULT_SAMPLE_STEPS_TIER,
  DEFAULT_VACE_INFERENCE_FPS_TIER,
  DEFAULT_VACE_MAX_FRAME_NUM,
  DEFAULT_YOLO_CONF_TIER,
  MASK_BLUR_TIERS,
  MASK_DILATION_TIERS,
  SAM2_SIZE_TIERS,
  SAMPLE_SIZE_OPTIONS,
  SAMPLE_STEPS_TIERS,
  VACE_INFERENCE_FPS_TIERS,
  YOLO_CONF_TIERS,
  type Sam2Size,
  type SampleSize,
  type VaceInferenceFpsTier,
  tierValue,
} from "../../lib/video-replace/presets";

// ────────────────────────────────────────────────────────────────────
const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm,video/x-matroska";
const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp,image/bmp";
const VIDEO_REPLACE_LAST_JOB_KEY = "xiaolou:video-replace:last-job";

function formatTimecode(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "00:00:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const f = Math.floor((sec - Math.floor(sec)) * 100);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}:${String(f).padStart(2, "0")}`;
}

function stageLabel(stage: VideoReplaceJobStatus["stage"] | "none" | "uploading" | "importing"): string {
  switch (stage) {
    case "none":
      return "等待上传源视频";
    case "uploading":
      return "正在上传源视频…";
    case "importing":
      return "正在从资产库导入源视频…";
    case "uploaded":
      return "上传完成，待检测";
    case "detecting":
      return "正在识别人物…";
    case "detected":
      return "已识别人物，请选择";
    case "queued":
      return "已入队，等待执行…";
    case "tracking":
      return "正在追踪遮罩…";
    case "mask_ready":
      return "遮罩已生成";
    case "replacing":
      return "正在合成替换视频…";
    case "succeeded":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return stage;
  }
}

type UiStage =
  | "none"
  | "uploading"
  | "importing"
  | VideoReplaceJobStatus["stage"];

type ReplacementCharacter = {
  url: string;
  filename: string;
  /** Whether the reference came from the project asset library (vs. local upload). */
  origin: "upload" | "asset";
  assetId?: string | null;
};

type SourceVideoTab = "upload" | "asset";
type ReplacementTab = "upload" | "asset";

function assetToSourceVideoSelection(asset: Asset): ReferenceAssetSelection | null {
  const videoUrl = asset.mediaUrl || asset.previewUrl;
  if (!videoUrl) return null;
  if (asset.mediaKind !== "video" && asset.assetType !== "video_ref") return null;
  return {
    id: asset.id,
    name: asset.name,
    url: videoUrl,
    previewUrl: asset.previewUrl || videoUrl,
    assetType: asset.assetType,
    description: asset.description,
    mediaKind: "video",
  };
}

export default function VideoReplace() {
  const [currentProjectId] = useCurrentProjectId();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Job state ─────────────────────────────────────────────────────
  const [uiStage, setUiStage] = useState<UiStage>("none");
  const [job, setJob] = useState<VideoReplaceJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [importingSource, setImportingSource] = useState(false);

  // ── Selection state ───────────────────────────────────────────────
  const [sourcePersonId, setSourcePersonId] = useState<string | null>(null);
  const [replacement, setReplacement] = useState<ReplacementCharacter | null>(null);
  const [uploadingReplacement, setUploadingReplacement] = useState(false);

  // ── Source video input tab ────────────────────────────────────────
  const [sourceTab, setSourceTab] = useState<SourceVideoTab>("upload");
  const [replacementTab, setReplacementTab] = useState<ReplacementTab>("upload");

  const [cancelling, setCancelling] = useState(false);

  // ── Advanced settings ─────────────────────────────────────────────
  const [yoloTier, setYoloTier] = useState(DEFAULT_YOLO_CONF_TIER);
  const [sam2Size, setSam2Size] = useState<Sam2Size>(DEFAULT_SAM2_SIZE);
  const [dilationTier, setDilationTier] = useState(DEFAULT_MASK_DILATION_TIER);
  const [blurTier, setBlurTier] = useState(DEFAULT_MASK_BLUR_TIER);
  const [stepsTier, setStepsTier] = useState(DEFAULT_SAMPLE_STEPS_TIER);
  const [sampleSize, setSampleSize] = useState<SampleSize>(DEFAULT_SAMPLE_SIZE);
  const [inferenceFpsTier, setInferenceFpsTier] = useState<VaceInferenceFpsTier>(
    DEFAULT_VACE_INFERENCE_FPS_TIER,
  );
  const [baseSeed, setBaseSeed] = useState<string>("");

  // ── Main preview video element (source OR result, toggled below) ──
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const restoredJobIdRef = useRef<string | null>(null);
  const importedSourceAssetIdRef = useRef<string | null>(null);
  const resetVersionRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [previewMode, setPreviewMode] = useState<"source" | "mask" | "result">("source");
  const [videoLoadError, setVideoLoadError] = useState<string | null>(null);

  // ── Sync-to-asset-library (shared component) ─────────────────────
  const [syncDraft, setSyncDraft] = useState<AssetSyncDraft | null>(null);
  const [syncingAsset, setSyncingAsset] = useState(false);

  // ── Helpers ───────────────────────────────────────────────────────
  const meta = job?.meta ?? null;
  const candidates: VideoReplacePersonCandidate[] = useMemo(
    () => job?.detection?.candidates ?? [],
    [job],
  );

  // Prefer the finalized (H.264/AAC + audio) URL. `result_video_url` is an
  // alias maintained by the backend for legacy callers.
  const finalResultUrl = job?.final_result_video_url ?? job?.result_video_url ?? null;
  const finalDownloadUrl =
    job?.final_result_download_url ?? job?.result_download_url ?? finalResultUrl;
  const hasResultVideo = Boolean(finalResultUrl);
  const jobMode = job?.mode ?? null;
  const statusMessage =
    job?.message ??
    (job?.stage === "queued" && typeof job.queue_ahead === "number"
      ? `GPU 正在处理其他人物替换任务，前方排队 ${job.queue_ahead} 位`
      : null);
  const canSubmit =
    uiStage === "detected" &&
    !!sourcePersonId &&
    candidates.some((c) => c.person_id === sourcePersonId) &&
    !!replacement?.url &&
    !uploadingReplacement;

  // ── Effects ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!job) return;
    setUiStage(job.stage);
    if (job.stage === "failed" && job.error) {
      setError(job.error);
    }
  }, [job]);

  // When a result becomes available, auto-switch preview to the result.
  useEffect(() => {
    if (hasResultVideo) setPreviewMode("result");
  }, [hasResultVideo]);

  // Whenever the candidates list changes, keep the source_person_id in sync
  // with the fresh list:
  //   - stale ids that no longer appear get cleared;
  //   - when only one candidate exists, auto-select it so users don't have to
  //     hunt for the "click me" affordance (the previous UX caused a lot of
  //     support tickets where users thought the replacement section was
  //     broken because they didn't realize the single detected person was
  //     also a selectable button).
  useEffect(() => {
    if (candidates.length === 0) {
      if (sourcePersonId) setSourcePersonId(null);
      return;
    }
    if (sourcePersonId &&
        !candidates.some((c) => c.person_id === sourcePersonId)) {
      setSourcePersonId(null);
      return;
    }
    if (!sourcePersonId && candidates.length === 1) {
      setSourcePersonId(candidates[0].person_id);
    }
  }, [candidates, sourcePersonId]);

  // ── Real-time job polling ─────────────────────────────────────────
  // Once the job enters a running stage (queued / tracking / mask_ready /
  // replacing) keep polling until it reaches a terminal state.
  useEffect(() => {
    if (!job?.job_id) return;
    const TERMINAL: ReadonlySet<string> = new Set([
      "succeeded",
      "failed",
      "cancelled",
      // also stop polling if we're still in detection/upload state
      "uploaded",
      "detecting",
      "detected",
      "none",
    ]);
    if (TERMINAL.has(job.stage)) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      if (cancelled) return;
      try {
        const updated = await getVideoReplaceJob(job.job_id);
        if (cancelled) return;
        setJob(updated);
        if (!TERMINAL.has(updated.stage)) {
          // Continue polling
          timer = setTimeout(() => void poll(), 1800);
        }
      } catch {
        if (!cancelled) {
          // Brief back-off on network error; keep trying
          timer = setTimeout(() => void poll(), 4000);
        }
      }
    };

    // Start after a short delay so the initial submit response is shown first
    timer = setTimeout(() => void poll(), 800);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.job_id, job?.stage]);

  useEffect(() => {
    if (job || searchParams.has("job_id") || searchParams.has("source_asset_id")) return;
    restoredJobIdRef.current = null;
    importedSourceAssetIdRef.current = null;
  }, [job, searchParams]);

  // ── Handlers: source video input ──────────────────────────────────
  const rememberJob = (status: VideoReplaceJobStatus) => {
    restoredJobIdRef.current = status.job_id;
    window.localStorage.setItem(VIDEO_REPLACE_LAST_JOB_KEY, status.job_id);
    const next = new URLSearchParams(searchParams);
    next.set("job_id", status.job_id);
    next.delete("source_asset_id");
    setSearchParams(next, { replace: true });
  };

  const adoptJob = (status: VideoReplaceJobStatus) => {
    setJob(status);
    setSourcePersonId(null);
    rememberJob(status);
    // Keep replacement character across re-detection so the user doesn't
    // have to re-upload it — tracked separately.
  };

  const adoptRestoredJob = (status: VideoReplaceJobStatus) => {
    setJob(status);
    setSourcePersonId(status.source_person_id ?? null);
    if (status.target_reference_url) {
      setReplacement({
        url: status.target_reference_url,
        filename: "reference",
        origin: "asset",
      });
    }
    rememberJob(status);
  };

  const handleVideoUpload = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;

    const requestVersion = resetVersionRef.current;
    setUploading(true);
    setError(null);
    setUiStage("uploading");
    try {
      const result = await uploadVideoReplaceSource(file);
      if (resetVersionRef.current !== requestVersion) return;
      const now = new Date().toISOString();
      adoptJob({
        job_id: result.job_id,
        stage: "uploaded",
        progress: 0,
        message: null,
        error: null,
        created_at: now,
        updated_at: now,
        source_video_url: result.video_url,
        thumbnail_url: result.thumbnail_url,
        meta: result.meta,
        detection: null,
        source_person_id: null,
        target_reference_url: null,
        advanced: null,
        mask_preview_url: null,
        result_video_url: null,
        result_download_url: null,
        raw_result_video_url: null,
        final_result_video_url: null,
        final_result_download_url: null,
        mode: null,
        tracker_backend: null,
        replacer_backend: null,
      });
      setUiStage("uploaded");
    } catch (e) {
      if (resetVersionRef.current !== requestVersion) return;
      setError(e instanceof Error ? e.message : "上传失败");
      setUiStage(job ? job.stage : "none");
    } finally {
      if (resetVersionRef.current === requestVersion) {
        setUploading(false);
      }
    }
  };

  const handleSourceAssetSelected = async (
    asset: ReferenceAssetSelection,
    requestVersion = resetVersionRef.current,
  ) => {
    if (asset.mediaKind !== "video") return;
    setImportingSource(true);
    setError(null);
    setUiStage("importing");
    try {
      const result = await importVideoReplaceJob({
        video_url: asset.url,
        original_filename: asset.name,
      });
      if (resetVersionRef.current !== requestVersion) return;
      const now = new Date().toISOString();
      adoptJob({
        job_id: result.job_id,
        stage: "uploaded",
        progress: 0,
        message: null,
        error: null,
        created_at: now,
        updated_at: now,
        source_video_url: result.video_url,
        thumbnail_url: result.thumbnail_url,
        meta: result.meta,
        detection: null,
        source_person_id: null,
        target_reference_url: null,
        advanced: null,
        mask_preview_url: null,
        result_video_url: null,
        result_download_url: null,
        raw_result_video_url: null,
        final_result_video_url: null,
        final_result_download_url: null,
        mode: null,
        tracker_backend: null,
        replacer_backend: null,
      });
      setUiStage("uploaded");
    } catch (e) {
      if (resetVersionRef.current !== requestVersion) return;
      setError(e instanceof Error ? e.message : "从资产库导入失败");
      setUiStage(job ? job.stage : "none");
    } finally {
      if (resetVersionRef.current === requestVersion) {
        setImportingSource(false);
      }
    }
  };

  // ── Handlers: detection ───────────────────────────────────────────
  useEffect(() => {
    const queryJobId = searchParams.get("job_id");
    const querySourceAssetId = searchParams.get("source_asset_id");
    const lastJobId =
      !queryJobId && !querySourceAssetId
        ? window.localStorage.getItem(VIDEO_REPLACE_LAST_JOB_KEY)
        : null;
    const jobId = queryJobId || lastJobId;
    if (!jobId || job?.job_id === jobId || restoredJobIdRef.current === jobId) return;

    const requestVersion = resetVersionRef.current;
    restoredJobIdRef.current = jobId;
    setError(null);
    void getVideoReplaceJob(jobId)
      .then((status) => {
        if (resetVersionRef.current !== requestVersion) return;
        adoptRestoredJob(status);
      })
      .catch((err) => {
        if (resetVersionRef.current !== requestVersion) return;
        if (lastJobId === jobId) {
          window.localStorage.removeItem(VIDEO_REPLACE_LAST_JOB_KEY);
        }
        setError(err instanceof Error ? err.message : "恢复人物替换任务失败");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.job_id, searchParams]);

  useEffect(() => {
    const assetId = searchParams.get("source_asset_id");
    if (!assetId || job || importedSourceAssetIdRef.current === assetId) return;

    const requestVersion = resetVersionRef.current;
    importedSourceAssetIdRef.current = assetId;
    setSourceTab("asset");
    setError(null);
    void getAsset(currentProjectId, assetId)
      .then((asset) => {
        const selection = assetToSourceVideoSelection(asset);
        if (!selection) {
          throw new Error("该资产不是可用的视频资产");
        }
        if (resetVersionRef.current !== requestVersion) return;
        return handleSourceAssetSelected(selection, requestVersion);
      })
      .catch((err) => {
        if (resetVersionRef.current !== requestVersion) return;
        setError(err instanceof Error ? err.message : "导入视频资产失败");
        setUiStage("none");
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentProjectId, job, searchParams]);

  const handleDetect = async () => {
    if (!job?.job_id) return;
    const requestVersion = resetVersionRef.current;
    setError(null);
    setSourcePersonId(null); // Always clear stale selection before a new detect
    setUiStage("detecting");
    try {
      const updated = await detectVideoReplaceCandidates(job.job_id, {
        yolo_conf: tierValue(YOLO_CONF_TIERS, yoloTier, 0.4),
      });
      if (resetVersionRef.current !== requestVersion) return;
      setJob(updated);
    } catch (e) {
      if (resetVersionRef.current !== requestVersion) return;
      setError(e instanceof Error ? e.message : "检测失败");
      try {
        const fresh = await getVideoReplaceJob(job.job_id);
        if (resetVersionRef.current !== requestVersion) return;
        setJob(fresh);
      } catch {
        /* ignore */
      }
    }
  };

  // ── Handlers: replacement character ───────────────────────────────
  const handleReplacementUpload = async (ev: ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;

    const requestVersion = resetVersionRef.current;
    setUploadingReplacement(true);
    setError(null);
    try {
      const result = await uploadVideoReplaceReference(file);
      if (resetVersionRef.current !== requestVersion) return;
      setReplacement({
        url: result.url,
        filename: result.filename,
        origin: "upload",
      });
    } catch (e) {
      if (resetVersionRef.current !== requestVersion) return;
      setError(e instanceof Error ? e.message : "参考图上传失败");
    } finally {
      if (resetVersionRef.current === requestVersion) {
        setUploadingReplacement(false);
      }
    }
  };

  const handleReplacementAssetSelected = async (asset: ReferenceAssetSelection) => {
    if (asset.mediaKind !== "image") return;
    const requestVersion = resetVersionRef.current;
    setUploadingReplacement(true);
    setError(null);
    try {
      const result = await importVideoReplaceReference({
        image_url: asset.url,
        original_filename: asset.name,
      });
      if (resetVersionRef.current !== requestVersion) return;
      setReplacement({
        url: result.url,
        filename: result.filename,
        origin: "asset",
        assetId: asset.id,
      });
    } catch (e) {
      if (resetVersionRef.current !== requestVersion) return;
      setError(e instanceof Error ? e.message : "从资产库导入参考图失败");
    } finally {
      if (resetVersionRef.current === requestVersion) {
        setUploadingReplacement(false);
      }
    }
  };

  // ── Handlers: submit generate ─────────────────────────────────────
  const handleSubmit = async () => {
    if (!canSubmit || !job?.job_id || !sourcePersonId || !replacement?.url) return;
    const requestVersion = resetVersionRef.current;
    setError(null);
    setUiStage("queued");
    const seedNum = baseSeed.trim() ? Number(baseSeed) : null;
    if (seedNum !== null && !Number.isInteger(seedNum)) {
      setError("随机种子必须是整数");
      setUiStage(job.stage);
      return;
    }
    try {
      const updated = await submitVideoReplaceGenerate(job.job_id, {
        source_person_id: sourcePersonId,
        target_reference_url: replacement.url,
        project_id: currentProjectId,
        yolo_conf: tierValue(YOLO_CONF_TIERS, yoloTier, 0.4),
        sam2_size: sam2Size,
        mask_dilation_px: tierValue(MASK_DILATION_TIERS, dilationTier, 5),
        mask_blur_px: tierValue(MASK_BLUR_TIERS, blurTier, 4),
        sample_steps: tierValue(SAMPLE_STEPS_TIERS, stepsTier, 12),
        sample_size: sampleSize,
        inference_fps: tierValue(
          VACE_INFERENCE_FPS_TIERS,
          inferenceFpsTier,
          15,
        ) as 15 | 30 | 60,
        max_frame_num: DEFAULT_VACE_MAX_FRAME_NUM,
        base_seed: seedNum,
      });
      if (resetVersionRef.current !== requestVersion) return;
      setJob(updated);
    } catch (e) {
      if (resetVersionRef.current !== requestVersion) return;
      setError(e instanceof Error ? e.message : "提交失败");
      try {
        const fresh = await getVideoReplaceJob(job.job_id);
        if (resetVersionRef.current !== requestVersion) return;
        setJob(fresh);
      } catch {
        /* ignore */
      }
    }
  };

  const handleCancel = async () => {
    if (!job?.job_id || cancelling) return;
    const requestVersion = resetVersionRef.current;
    setCancelling(true);
    try {
      const updated = await cancelVideoReplaceJob(job.job_id);
      if (resetVersionRef.current !== requestVersion) return;
      setJob(updated);
    } catch (e) {
      if (resetVersionRef.current !== requestVersion) return;
      setError(e instanceof Error ? e.message : "取消失败");
      try {
        const fresh = await getVideoReplaceJob(job.job_id);
        if (resetVersionRef.current !== requestVersion) return;
        setJob(fresh);
      } catch { /* ignore */ }
    } finally {
      if (resetVersionRef.current === requestVersion) {
        setCancelling(false);
      }
    }
  };

  const handleReset = () => {
    resetVersionRef.current += 1;
    const clearingJobId = job?.job_id ?? searchParams.get("job_id");
    const clearingSourceAssetId = searchParams.get("source_asset_id");

    window.localStorage.removeItem(VIDEO_REPLACE_LAST_JOB_KEY);
    restoredJobIdRef.current = clearingJobId;
    importedSourceAssetIdRef.current = clearingSourceAssetId;
    const next = new URLSearchParams(searchParams);
    next.delete("job_id");
    next.delete("source_asset_id");
    setSearchParams(next, { replace: true });

    setJob(null);
    setSourcePersonId(null);
    setReplacement(null);
    setError(null);
    setUploading(false);
    setImportingSource(false);
    setUploadingReplacement(false);
    setCancelling(false);
    setSourceTab("upload");
    setReplacementTab("upload");
    setYoloTier(DEFAULT_YOLO_CONF_TIER);
    setSam2Size(DEFAULT_SAM2_SIZE);
    setDilationTier(DEFAULT_MASK_DILATION_TIER);
    setBlurTier(DEFAULT_MASK_BLUR_TIER);
    setStepsTier(DEFAULT_SAMPLE_STEPS_TIER);
    setSampleSize(DEFAULT_SAMPLE_SIZE);
    setInferenceFpsTier(DEFAULT_VACE_INFERENCE_FPS_TIER);
    setBaseSeed("");
    setUiStage("none");
    setPreviewMode("source");
    setIsPlaying(false);
    setVideoLoadError(null);
    setSyncDraft(null);
    setSyncingAsset(false);
  };

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      void v.play();
      setIsPlaying(true);
    } else {
      v.pause();
      setIsPlaying(false);
    }
  };

  const handleDownloadResult = async () => {
    const url = finalDownloadUrl;
    if (!url || !job) return;
    await downloadMediaFile(url, guessMediaFilename(url, job.job_id, "video"));
  };

  const openResultAssetSync = () => {
    if (!finalResultUrl) return;
    setSyncDraft({
      id: job!.job_id,
      mediaKind: "video",
      previewUrl: job!.thumbnail_url || null,
      mediaUrl: finalResultUrl,
      prompt: "",
      model: job.advanced ? `VACE-1.3B · ${job.advanced.sample_size}` : "VACE-1.3B",
      aspectRatio: job.advanced?.sample_size || "",
      taskId: job.job_id,
      referenceImageUrl: job.target_reference_url,
      defaultAssetType: "video_ref",
      sourceModule: "video_replace",
      defaultName: `人物替换结果 ${new Date(job.updated_at).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })}`,
      defaultDescription: [
        "来源：人物替换",
        `job_id: ${job.job_id}`,
        job.source_person_id ? `source_person: ${job.source_person_id}` : "",
        job.target_reference_url ? `target_reference: ${job.target_reference_url}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });
  };

  const handleSyncSubmit = async (input: Parameters<typeof createAsset>[1]) => {
    if (!job?.job_id) return;
    setSyncingAsset(true);
    try {
      await createAsset(currentProjectId, input);
      setSyncDraft(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步到资产库失败，请稍后重试。";
      window.alert(message);
    } finally {
      setSyncingAsset(false);
    }
  };

  const previewSrc = useMemo(() => {
    if (previewMode === "result" && finalResultUrl) return finalResultUrl;
    return job?.source_video_url ?? null;
  }, [previewMode, finalResultUrl, job?.source_video_url]);

  // Force the <video> element to reload whenever the src changes — React
  // won't re-trigger `load()` automatically when the DOM node is the same.
  useEffect(() => {
    if (!videoRef.current) return;
    setVideoLoadError(null);
    try {
      videoRef.current.load();
    } catch {
      /* ignore */
    }
  }, [previewSrc]);

  // For mask mode we show a static image (not video)
  const maskPreviewSrc = previewMode === "mask" ? (job?.mask_preview_url ?? null) : null;

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between border-b border-border bg-card/30 px-6 py-4">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <span className="text-primary">合成工具箱：</span>视频人物替换
          </h1>
          <p className="mt-1.5 text-xs text-muted-foreground">
            上传或从资产库选择源视频 → 识别人物 → 选择 SOURCE PERSON → 指定 REPLACEMENT CHARACTER → 配置真实参数后提交。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {jobMode && (
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wider ring-1",
                jobMode === "full"
                  ? "bg-violet-500/15 text-violet-800 ring-violet-600/40 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/30"
                  : "bg-amber-500/15 text-amber-800 ring-amber-600/40 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/30",
              )}
              title={
                jobMode === "full"
                  ? `深度学习 full 模式: ${job?.tracker_backend ?? ""} + ${job?.replacer_backend ?? ""}`
                  : "lite 调试模式: OpenCV 贴图合成，并非真实深度学习替换"
              }
            >
              {jobMode === "full" ? "FULL · DEEP LEARNING" : "LITE · DEMO"}
            </div>
          )}
          <div
            className={cn(
              "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1",
              uiStage === "failed"
                ? "bg-rose-500/15 text-rose-700 ring-rose-600/40 dark:bg-rose-500/10 dark:text-rose-400 dark:ring-rose-500/20"
                : uiStage === "queued" || uiStage === "succeeded"
                  ? "bg-emerald-500/15 text-emerald-700 ring-emerald-600/40 dark:bg-emerald-500/10 dark:text-emerald-500 dark:ring-emerald-500/20"
                  : "bg-sky-500/15 text-sky-800 ring-sky-600/40 dark:bg-sky-500/10 dark:text-sky-400 dark:ring-sky-500/20",
            )}
          >
            {uiStage === "failed" ? (
              <AlertTriangle className="h-3.5 w-3.5" />
            ) : uiStage === "queued" || uiStage === "succeeded" ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <Cloud className="h-3.5 w-3.5" />
            )}
            <span>{stageLabel(uiStage)}</span>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-hidden">
        <CreateStudioSplitLayout
          pageKey="video-replace"
          defaultWidth={380}
          minWidth={320}
          maxWidth={560}
          sidebar={
            <div className="flex h-full flex-col gap-6 overflow-y-auto p-5 custom-scrollbar">
              {/* ── 1. Source video ─────────────────────────────── */}
              <section className="space-y-3">
                <SectionHeader title="源视频 SOURCE VIDEO" />
                {!job ? (
                  <>
                    <TabSwitch
                      tabs={[
                        { id: "upload", label: "本地上传" },
                        { id: "asset", label: "当前项目资产库" },
                      ]}
                      value={sourceTab}
                      onChange={(id) => setSourceTab(id as SourceVideoTab)}
                    />
                    {sourceTab === "upload" ? (
                      <label
                        className={cn(
                          "flex aspect-video cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/10 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary",
                          uploading && "pointer-events-none opacity-60",
                        )}
                      >
                        {uploading ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <Upload className="h-5 w-5" />
                        )}
                        <span>{uploading ? "上传中…" : "点击选择本地视频"}</span>
                        <span className="text-[10px] text-muted-foreground/70">
                          MP4 / MOV / WebM · 最长 15 秒
                        </span>
                        <input
                          type="file"
                          accept={VIDEO_ACCEPT}
                          className="hidden"
                          onChange={(e) => void handleVideoUpload(e)}
                        />
                      </label>
                    ) : (
                      <div className={cn(importingSource && "pointer-events-none opacity-60")}>
                        <ReferenceAssetPicker
                          projectId={currentProjectId}
                          mediaKind="video"
                          heading="当前项目视频资产"
                          hint="选中后自动导入，无需用户手工再次上传。"
                          onSelect={(asset) => void handleSourceAssetSelected(asset)}
                        />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="space-y-2">
                    <div className="relative aspect-video overflow-hidden rounded-xl border border-border bg-muted/30">
                      <SourceThumbnail url={job.thumbnail_url} />
                      <div className="absolute bottom-2 left-2 rounded-md bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
                        {meta ? formatTimecode(meta.duration_seconds) : "--"}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                      <Metric label="分辨率" value={meta ? `${meta.width}×${meta.height}` : "--"} />
                      <Metric label="帧率" value={meta ? `${meta.fps.toFixed(1)} fps` : "--"} />
                      <Metric label="总帧数" value={meta ? String(meta.frame_count) : "--"} />
                      <Metric label="编码" value={meta?.codec ?? "--"} />
                    </div>
                    <button
                      type="button"
                      onClick={handleReset}
                      className="w-full rounded-md border border-border bg-transparent py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent"
                    >
                      更换源视频
                    </button>
                  </div>
                )}
              </section>

              {/* ── 2. Source person ────────────────────────────── */}
              <section className="space-y-3">
                <SectionHeader title="源人物 SOURCE PERSON（源视频中被替换的那个人）" />
                {!job ? (
                  <EmptyHint text="先上传或从资产库选择源视频" />
                ) : uiStage === "uploaded" ? (
                  <button
                    type="button"
                    onClick={() => void handleDetect()}
                    className="w-full rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    识别视频中的人物
                  </button>
                ) : uiStage === "detecting" ? (
                  <div className="flex items-center gap-2 rounded-md border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    正在运行 YOLOv8 检测…
                  </div>
                ) : candidates.length === 0 ? (
                  <div className="space-y-2">
                    <EmptyHint text={job.message ?? "未检测到人物"} />
                    <button
                      type="button"
                      onClick={() => void handleDetect()}
                      className="w-full rounded-md border border-border py-1.5 text-[11px] text-muted-foreground hover:bg-accent"
                    >
                      重新检测
                    </button>
                  </div>
                ) : (
                  <div>
                    <div className="grid grid-cols-2 gap-3">
                      {candidates.map((cand, idx) => {
                        const selected = sourcePersonId === cand.person_id;
                        return (
                          <button
                            type="button"
                            key={cand.person_id}
                            onClick={() => setSourcePersonId(cand.person_id)}
                            className={cn(
                              "relative aspect-[3/4] overflow-hidden rounded-xl border bg-muted/30 transition-all",
                              selected
                                ? "border-2 border-primary ring-2 ring-primary/20 ring-offset-2 ring-offset-background"
                                : "border border-border hover:border-primary/50",
                            )}
                          >
                            {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
                            <img
                              src={cand.preview_url}
                              alt={`candidate ${idx + 1}`}
                              className={cn(
                                "h-full w-full object-cover",
                                selected ? "opacity-100" : "opacity-85 hover:opacity-100",
                              )}
                            />
                            {selected && (
                              <div className="absolute left-0 right-0 top-0 bg-primary/90 py-0.5 text-center text-[10px] font-bold tracking-wider text-white backdrop-blur-sm">
                                SELECTED
                              </div>
                            )}
                            <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between bg-black/55 px-2 py-1 text-[10px] text-white">
                              <span>#{idx + 1}</span>
                              <span>{(cand.confidence * 100).toFixed(0)}%</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDetect()}
                      className="mt-2 w-full rounded-md border border-border py-1.5 text-[11px] text-muted-foreground hover:bg-accent"
                    >
                      重新运行检测（使用当前阈值）
                    </button>
                  </div>
                )}
              </section>

              {/* ── 3. Replacement character ────────────────────── */}
              <section className="space-y-3">
                <SectionHeader title="替换角色 REPLACEMENT CHARACTER（替换后的人物参考图）" />
                {!sourcePersonId ? (
                  <EmptyHint text="请先在上方选择源人物 (SOURCE PERSON)" />
                ) : replacement ? (
                  <div className="relative overflow-hidden rounded-xl border border-border bg-muted/20">
                    {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
                    <img
                      src={replacement.url}
                      alt="replacement character"
                      className="aspect-square w-full object-cover"
                    />
                    <div className="flex items-center justify-between border-t border-border bg-background/80 px-3 py-1.5 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1.5 truncate pr-2">
                        <span className="rounded bg-secondary px-1.5 py-0.5 text-[9px] font-medium text-secondary-foreground">
                          {replacement.origin === "asset" ? "资产库" : "本地上传"}
                        </span>
                        <span className="truncate">{replacement.filename}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => setReplacement(null)}
                        className="rounded p-0.5 text-muted-foreground hover:text-destructive"
                        title="移除"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <TabSwitch
                      tabs={[
                        { id: "upload", label: "本地上传" },
                        { id: "asset", label: "当前项目资产库" },
                      ]}
                      value={replacementTab}
                      onChange={(id) => setReplacementTab(id as ReplacementTab)}
                    />
                    {replacementTab === "upload" ? (
                      <label
                        className={cn(
                          "flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/10 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary",
                          uploadingReplacement && "pointer-events-none opacity-60",
                        )}
                      >
                        {uploadingReplacement ? (
                          <Loader2 className="h-5 w-5 animate-spin" />
                        ) : (
                          <UserRound className="h-5 w-5" />
                        )}
                        <span>
                          {uploadingReplacement ? "处理中…" : "上传替换角色参考图"}
                        </span>
                        <span className="text-[10px] text-muted-foreground/70">
                          JPG / PNG / WebP · 最大 25MB
                        </span>
                        <input
                          type="file"
                          accept={IMAGE_ACCEPT}
                          className="hidden"
                          onChange={(e) => void handleReplacementUpload(e)}
                        />
                      </label>
                    ) : (
                      <div className={cn(uploadingReplacement && "pointer-events-none opacity-60")}>
                        <ReferenceAssetPicker
                          projectId={currentProjectId}
                          mediaKind="image"
                          heading="当前项目参考图"
                          hint="选中后导入为 replacement character，不会改动原资产。"
                          onSelect={(asset) => void handleReplacementAssetSelected(asset)}
                        />
                      </div>
                    )}
                  </>
                )}
              </section>

              {/* ── 4. Advanced settings ────────────────────────── */}
              <section className="space-y-4">
                <SectionHeader title="高级设置 ADVANCED SETTINGS" />

                <TierSelector
                  label="人物检测阈值 (yolo_conf)"
                  tiers={YOLO_CONF_TIERS.map((t) => ({ id: t.id, label: t.label, hint: t.hint }))}
                  value={yoloTier}
                  onChange={(v) => setYoloTier(v as typeof yoloTier)}
                />

                <TierSelector
                  label="分割精度 (sam2_size)"
                  tiers={SAM2_SIZE_TIERS.map((t) => ({
                    id: t.id,
                    label: t.label,
                    hint: t.hint,
                  }))}
                  value={sam2Size}
                  onChange={(v) => setSam2Size(v as Sam2Size)}
                />

                <TierSelector
                  label="遮罩扩张 (mask_dilation_px)"
                  tiers={MASK_DILATION_TIERS.map((t) => ({
                    id: t.id,
                    label: `${t.label} · ${t.value}px`,
                  }))}
                  value={dilationTier}
                  onChange={(v) => setDilationTier(v as typeof dilationTier)}
                />

                <TierSelector
                  label="边缘羽化 (mask_blur_px)"
                  tiers={MASK_BLUR_TIERS.map((t) => ({
                    id: t.id,
                    label: `${t.label} · ${t.value}px`,
                  }))}
                  value={blurTier}
                  onChange={(v) => setBlurTier(v as typeof blurTier)}
                />

                <TierSelector
                  label="生成质量 (sample_steps)"
                  tiers={SAMPLE_STEPS_TIERS.map((t) => ({
                    id: t.id,
                    label: t.label,
                    hint: t.hint,
                  }))}
                  value={stepsTier}
                  onChange={(v) => setStepsTier(v as typeof stepsTier)}
                />

                <TierSelector
                  label="推理帧率 (inference_fps)"
                  tiers={VACE_INFERENCE_FPS_TIERS.map((t) => ({
                    id: t.id,
                    label: t.label,
                    hint: t.hint,
                  }))}
                  value={inferenceFpsTier}
                  onChange={(v) => setInferenceFpsTier(v as VaceInferenceFpsTier)}
                />

                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    输出分辨率 (sample_size)
                  </div>
                  <select
                    value={sampleSize}
                    onChange={(e) => setSampleSize(e.target.value as SampleSize)}
                    className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                  >
                    {SAMPLE_SIZE_OPTIONS.map((opt) => (
                      <option key={opt.id} value={opt.id} disabled={opt.disabled}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <div className="space-y-1 text-[10px] text-muted-foreground">
                    <div>Wan2.1 VACE-1.3B 官方仅支持 `832*480 / 480*832`，没有更低分辨率接口。</div>
                    {SAMPLE_SIZE_OPTIONS.find((opt) => opt.id === sampleSize)?.note && (
                      <div>{SAMPLE_SIZE_OPTIONS.find((opt) => opt.id === sampleSize)?.note}</div>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="text-[11px] font-medium text-muted-foreground">
                    随机种子 (base_seed，留空 = 随机)
                  </div>
                  <input
                    type="number"
                    step={1}
                    value={baseSeed}
                    onChange={(e) => setBaseSeed(e.target.value)}
                    placeholder="例如 42"
                    className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary/50"
                  />
                </div>
              </section>
            </div>
          }
        >
          {/* ── Main preview ─────────────────────────────────────── */}
          <div className="flex h-full flex-col p-6">
            {(hasResultVideo || job?.mask_preview_url) && (
              <div className="mb-3 flex items-center justify-end gap-2 text-xs">
                <span className="text-muted-foreground">预览</span>
                <div className="inline-flex overflow-hidden rounded-md border border-border">
                  <button
                    type="button"
                    onClick={() => setPreviewMode("source")}
                    className={cn(
                      "px-3 py-1.5 transition-colors",
                      previewMode === "source"
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    原视频
                  </button>
                  {job?.mask_preview_url && (
                    <button
                      type="button"
                      onClick={() => setPreviewMode("mask")}
                      className={cn(
                        "px-3 py-1.5 transition-colors",
                        previewMode === "mask"
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-accent",
                      )}
                    >
                      遮罩预览
                    </button>
                  )}
                  {hasResultVideo && (
                    <button
                      type="button"
                      onClick={() => setPreviewMode("result")}
                      className={cn(
                        "px-3 py-1.5 transition-colors",
                        previewMode === "result"
                          ? "bg-primary/10 text-primary"
                          : "text-muted-foreground hover:bg-accent",
                      )}
                    >
                      结果视频
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="relative flex-1 overflow-hidden rounded-2xl border border-border bg-black shadow-2xl">
              {maskPreviewSrc ? (
                // eslint-disable-next-line jsx-a11y/img-redundant-alt
                <img
                  src={maskPreviewSrc}
                  alt="mask preview"
                  className="h-full w-full object-contain"
                />
              ) : previewSrc ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video
                  ref={videoRef}
                  key={previewSrc}
                  src={previewSrc}
                  className="h-full w-full object-contain"
                  playsInline
                  controls={false}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onError={() => {
                    setVideoLoadError(
                      previewMode === "result"
                        ? "结果视频加载失败。请确认后端最终封装成功，或通过『下载结果视频』导出原始文件排查。"
                        : "源视频加载失败。请检查文件或重新上传。",
                    );
                  }}
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted-foreground">
                  <Film className="h-8 w-8 opacity-60" />
                  <p className="text-sm">请从左侧上传或导入源视频</p>
                </div>
              )}

              {previewSrc && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      const v = videoRef.current;
                      if (v?.requestFullscreen) void v.requestFullscreen();
                    }}
                    className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-colors hover:bg-black/60"
                    title="全屏预览"
                  >
                    <Maximize2 className="h-4 w-4" />
                  </button>

                  <div className="absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-6 rounded-full border border-white/10 bg-black/50 px-6 py-2 backdrop-blur-md">
                    <button
                      type="button"
                      className="text-white/70 transition-colors hover:text-white"
                      onClick={() => {
                        if (videoRef.current) videoRef.current.currentTime = 0;
                      }}
                    >
                      <SkipBack className="h-5 w-5 fill-current" />
                    </button>
                    <button
                      type="button"
                      onClick={togglePlay}
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/30 transition-transform hover:scale-105 active:scale-95"
                    >
                      {isPlaying ? (
                        <Pause className="h-5 w-5 fill-current" />
                      ) : (
                        <Play className="ml-0.5 h-5 w-5 fill-current" />
                      )}
                    </button>
                    <button
                      type="button"
                      className="text-white/70 transition-colors hover:text-white"
                      onClick={() => {
                        const v = videoRef.current;
                        if (v) v.currentTime = v.duration || 0;
                      }}
                    >
                      <SkipForward className="h-5 w-5 fill-current" />
                    </button>
                  </div>
                </>
              )}
            </div>

            {/* ── Status bar ───────────────────────────────────── */}
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-border bg-card/30 px-4 py-3 text-xs">
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2 text-foreground">
                  <StageDot stage={uiStage} />
                  <span className="font-medium">{stageLabel(uiStage)}</span>
                  {job?.progress && job.progress > 0 && (
                    <span className="text-muted-foreground">
                      · {(job.progress * 100).toFixed(0)}%
                    </span>
                  )}
                </div>
                {statusMessage && (
                  <div
                    className={cn(
                      job.stage === "replacing"
                        ? "rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-1.5 text-[12px] font-medium text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-300"
                        : job.stage === "queued"
                          ? "rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[12px] font-medium text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-300"
                        : "text-[11px] text-muted-foreground",
                    )}
                  >
                    {statusMessage}
                  </div>
                )}
                {/* Progress bar for running stages */}
                {job && job.progress != null && job.progress > 0 &&
                  !["succeeded","failed","cancelled","uploaded","detected"].includes(job.stage) && (
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-700"
                        style={{ width: `${Math.round(job.progress * 100)}%` }}
                      />
                    </div>
                  )}
                {error && (
                  <div className="flex items-start gap-1.5 whitespace-pre-wrap text-[11px] text-rose-700 dark:text-rose-400">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{error}</span>
                  </div>
                )}
                {videoLoadError && (
                  <div className="flex items-start gap-1.5 text-[11px] text-amber-800 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{videoLoadError}</span>
                  </div>
                )}
                {jobMode === "lite" && uiStage === "succeeded" && (
                  <div className="rounded-md border border-amber-600/40 bg-amber-500/15 px-2 py-1.5 text-[11px] text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
                    ⚠ 本次以 lite/调试模式完成：使用 OpenCV 对参考图做贴图合成。不是真实的深度学习人物替换。
                    {(job?.tracker_backend || job?.replacer_backend) &&
                      ` (tracker: ${job?.tracker_backend}, replacer: ${job?.replacer_backend})`}
                  </div>
                )}
                {jobMode === "full" && uiStage === "succeeded" && (
                  <div className="rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-1.5 text-[11px] text-violet-300">
                    ✓ full 模式完成：{job?.tracker_backend} + {job?.replacer_backend}
                  </div>
                )}
                {job?.job_id && (
                  <div className="text-[10px] text-muted-foreground/60">
                    job_id: {job.job_id}
                  </div>
                )}
              </div>
            </div>

            {/* ── Bottom actions ───────────────────────────────── */}
            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-[11px] text-muted-foreground">
                {!job && "上传或从资产库选择源视频开始"}
                {job && uiStage === "uploaded" && "点击左侧『识别视频中的人物』触发检测"}
                {job && uiStage === "detected" && !sourcePersonId && "请先选择一个源人物"}
                {job &&
                  uiStage === "detected" &&
                  sourcePersonId &&
                  !replacement &&
                  "请指定替换角色参考图（本地上传 / 资产库）"}
                {job &&
                  uiStage === "detected" &&
                  sourcePersonId &&
                  replacement &&
                  "参数齐备，可以提交生成"}
                {job && uiStage === "queued" && "已入队，等待执行（进度实时更新）…"}
                {job && uiStage === "tracking" && "正在追踪人物遮罩，请稍候…"}
                {job && uiStage === "mask_ready" && "遮罩已生成，正在进入替换阶段…"}
                {job && uiStage === "replacing" && "正在生成替换视频，请稍候…"}
                {hasResultVideo && "生成已完成，可预览和下载结果视频"}
              </div>
              <div className="flex items-center gap-3">
                {hasResultVideo && (
                  <>
                    <button
                      type="button"
                      onClick={openResultAssetSync}
                      className="rounded-full border border-border bg-transparent px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                    >
                      同步到资产库
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDownloadResult()}
                      className="flex items-center gap-1.5 rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-600 active:scale-95"
                    >
                      <Download className="h-4 w-4" />
                      下载结果视频
                    </button>
                  </>
                )}
                {job?.job_id &&
                  ["queued", "tracking", "mask_ready", "replacing"].includes(job.stage) && (
                    <button
                      type="button"
                      disabled={cancelling}
                      onClick={() => void handleCancel()}
                      className={cn(
                        "flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition-all",
                        cancelling
                          ? "cursor-not-allowed border-border text-muted-foreground"
                          : "border-rose-500/50 text-rose-500 hover:bg-rose-500/10 active:scale-95",
                      )}
                    >
                      {cancelling ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                      {cancelling ? "取消中…" : "取消生成"}
                    </button>
                  )}
                {uiStage !== "none" && uiStage !== "uploading" && uiStage !== "importing" && (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="rounded-full border border-border bg-transparent px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                  >
                    重置
                  </button>
                )}
                <button
                  type="button"
                  disabled={!canSubmit}
                  onClick={() => void handleSubmit()}
                  className={cn(
                    "rounded-full px-6 py-2 text-sm font-semibold transition-all",
                    canSubmit
                      ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20 hover:bg-primary/90 active:scale-95"
                      : "cursor-not-allowed bg-muted text-muted-foreground",
                  )}
                >
                  开始生成
                </button>
              </div>
            </div>
          </div>
        </CreateStudioSplitLayout>
      </div>

      <AssetSyncDialog
        item={syncDraft}
        submitting={syncingAsset}
        onClose={() => setSyncDraft(null)}
        onSubmit={handleSyncSubmit}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Tiny inline helpers
// ────────────────────────────────────────────────────────────────────
function SectionHeader({ title }: { title: string }) {
  return (
    <h3 className="flex items-center gap-2 text-xs font-bold tracking-wider text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
      {title}
    </h3>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed border-border bg-muted/10 px-3 py-3 text-center text-[11px] text-muted-foreground">
      {text}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-2 py-1.5">
      <div className="text-[10px] text-muted-foreground/70">{label}</div>
      <div className="truncate text-[11px] font-medium text-foreground">{value}</div>
    </div>
  );
}

function TabSwitch({
  tabs,
  value,
  onChange,
}: {
  tabs: Array<{ id: string; label: string }>;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="inline-flex w-full overflow-hidden rounded-md border border-border">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onChange(tab.id)}
          className={cn(
            "flex-1 px-3 py-1.5 text-[11px] font-medium transition-colors",
            value === tab.id
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-accent",
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function TierSelector<T extends string>({
  label,
  tiers,
  value,
  onChange,
}: {
  label: string;
  tiers: Array<{ id: T; label: string; hint?: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={label}>
        {tiers.map((t) => (
          <button
            type="button"
            key={t.id}
            role="radio"
            aria-checked={value === t.id}
            onClick={() => onChange(t.id)}
            className={cn(
              "rounded-md border px-1.5 py-1 text-[11px] font-medium transition-colors",
              value === t.id
                ? "border-primary bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:border-primary/40",
            )}
            title={t.hint}
          >
            {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Source-video thumbnail with a graceful 404 fallback.
 *
 * Old job rows in the DB may reference thumbnail files that were never actually
 * written (see `cv2_io.imwrite` Unicode-path fix in `app/services/cv2_io.py`).
 * When the image fails to load, we render a neutral "已上传" placeholder
 * instead of the browser's default broken-image icon.
 */
function SourceThumbnail({ url }: { url: string | null | undefined }) {
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [url]);

  if (!url || errored) {
    return (
      <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">
        已上传
      </div>
    );
  }

  return (
    // eslint-disable-next-line jsx-a11y/img-redundant-alt
    <img
      src={url}
      alt="source thumbnail"
      className="h-full w-full object-cover"
      onError={() => setErrored(true)}
    />
  );
}

function StageDot({ stage }: { stage: UiStage }) {
  const color =
    stage === "failed" || stage === "cancelled"
      ? "bg-rose-500"
      : stage === "succeeded"
        ? "bg-emerald-500"
        : stage === "detecting" ||
            stage === "tracking" ||
            stage === "replacing" ||
            stage === "uploading" ||
            stage === "importing"
          ? "bg-sky-500 animate-pulse"
          : stage === "none"
            ? "bg-muted-foreground/40"
            : "bg-primary";
  return <span className={cn("h-2 w-2 shrink-0 rounded-full", color)} />;
}
