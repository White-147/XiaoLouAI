import {
  Download,
  Layers,
  LoaderCircle,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { type ChangeEvent, type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AssetSyncDialog,
  type AssetSyncDraft,
} from "../../assets-media-projects/asset-sync/AssetSyncControls";
import { CreateStudioSplitLayout } from "../../create-workbench/studio-layout/CreateStudioSplitLayout";
import {
  REFERENCE_ASSET_MIME,
  ReferenceAssetPicker,
  type ReferenceAssetSelection,
} from "../../assets-media-projects/reference-assets/ReferenceAssetPicker";
import {
  GeneratedMediaPlaceholder,
  getGeneratedMediaUrl,
} from "../../assets-media-projects/media/GenerationPlaceholder";
import { downloadMediaFile, guessMediaFilename } from "../../../lib/download-media";
import { parseGenerationError } from "../../../lib/generation-error";
import { prepareReferenceUploadFile } from "../../../lib/prepare-reference-upload";
import { useActorId } from "../../../lib/actor-session";
import { cn } from "../../../lib/utils";
import {
  clearTasks,
  createAsset,
  deleteTask,
  deleteCreateVideo,
  getTask,
  getCreateVideoCapabilities,
  generateCreateVideos,
  listCreateVideos,
  listTasks,
  newIdempotencyKey,
  uploadFile,
  type VideoInputMode,
  type CreateVideoResult,
  type Task,
  type VideoMultiReferenceKey,
} from "./api/create-video";
import { useCurrentProjectId } from "../../../lib/session";
import {
  DEFAULT_FIXED_VIDEO_DURATION,
  DEFAULT_I2V_MODEL,
  DEFAULT_START_END_MODEL,
  DEFAULT_START_END_RESOLUTION,
  DEFAULT_VIDEO_ASPECT_RATIO,
  DEFAULT_VIDEO_RESOLUTION,
  FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES,
  FALLBACK_MULTI_PARAM_CAPABILITIES,
  FALLBACK_START_END_CAPABILITIES,
  FIXED_ASPECT_RATIO_OPTIONS,
  FIXED_DURATION_OPTIONS,
  GENERAL_ASPECT_RATIO_OPTIONS,
  GENERAL_DURATION_OPTIONS,
  GENERAL_VIDEO_RESOLUTION_OPTIONS,
  IMAGE_TO_VIDEO_RESOLUTION_OPTIONS,
  MULTI_REF_MODEL_OPTIONS,
  MULTI_PARAM_RESOLUTION_OPTIONS,
  START_END_RESOLUTION_OPTIONS,
  VIDEO_MODE_TABS,
  VIDEO_PAGE_SIZE,
  capabilityStatusLabel,
  capabilityStatusTone,
  enrichVideoCapabilities,
  formatVideoResultModelDisplay,
  getImageToVideoCapabilitySet,
  getImageToVideoOptionStatus,
  getMultiParamCapabilitySet,
  getStartEndCapabilitySet,
  imageToVideoModelLabel,
  multiParamModelLabel,
  pickFallbackVideoCapability,
  resolveImageToVideoInputMode,
  startEndModelLabel,
  withVeoVideoModelDisplayRemark,
  type VideoCapability,
  type VideoCreateMode,
} from "./videoCapabilities";
import {
  buildVideoAssetDraft,
  derivedResultCover,
  displayedAspectRatio,
  displayedDuration,
  displayedResolution,
  hasMultiReferenceImages,
  multiReferenceUrls,
  playableVideoUrl,
  readVideoOutputMetadata,
  resolveTaskProjectId,
  resultMultiReferenceUrl,
  resultReferenceUrl,
  videoOutputMetadataCache,
  videoPreviewReason,
  type VideoOutputMetadata,
} from "./videoResultHelpers";
import {
  MULTI_REF_LABELS,
  MULTI_REF_ORDER,
  MultiReferenceSlots,
  appendMultiRefItems,
  buildMultiReferencePayload,
  createEmptyMultiRefSlots,
  type ReferenceImageState,
} from "./MultiReferenceSlots";
import { VideoReferenceInputs } from "./VideoReferenceInputs";
import { VideoResultsGrid } from "./VideoResultsGrid";
import { VideoTaskHistory } from "./VideoTaskHistory";

export default function VideoCreate() {
  const actorId = useActorId();
  const [currentProjectId] = useCurrentProjectId();
  const [videoMode, setVideoMode] = useState<VideoCreateMode>("image_to_video");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState(DEFAULT_I2V_MODEL);
  const [startEndModel, setStartEndModel] = useState<string>(DEFAULT_START_END_MODEL);
  const [multiRefModel, setMultiRefModel] = useState<string>(MULTI_REF_MODEL_OPTIONS[0]);
  const [duration, setDuration] = useState(DEFAULT_FIXED_VIDEO_DURATION);
  const [aspectRatio, setAspectRatio] = useState(DEFAULT_VIDEO_ASPECT_RATIO);
  const [resolution, setResolution] = useState(DEFAULT_VIDEO_RESOLUTION);
  const [motionStrength, setMotionStrength] = useState(5);
  const [keepConsistency, setKeepConsistency] = useState(true);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyModel, setHistoryModel] = useState("all");
  const [referenceImage, setReferenceImage] = useState<ReferenceImageState | null>(null);
  const [startFrame, setStartFrame] = useState<ReferenceImageState | null>(null);
  const [endFrame, setEndFrame] = useState<ReferenceImageState | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<null | "start" | "end">(null);
  const [results, setResults] = useState<CreateVideoResult[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [previewItem, setPreviewItem] = useState<CreateVideoResult | null>(null);
  const [syncDraft, setSyncDraft] = useState<AssetSyncDraft | null>(null);
  const [syncingAsset, setSyncingAsset] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [syncDragActive, setSyncDragActive] = useState(false);
  const [draggingItem, setDraggingItem] = useState<AssetSyncDraft | null>(null);
  const draggingRef = useRef<AssetSyncDraft | null>(null);
  // Synchronous guard against rapid double-clicks of the generate button.
  // React's `generating` state only propagates on the next render, so two
  // clicks landing in the same frame would both enqueue backend tasks.
  const generatingRef = useRef(false);
  const [referencePreview, setReferencePreview] = useState<{ url: string; title: string } | null>(null);
  const [referenceDropActive, setReferenceDropActive] = useState(false);
  const [startDropActive, setStartDropActive] = useState(false);
  const [endDropActive, setEndDropActive] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [multiRefSlots, setMultiRefSlots] = useState(createEmptyMultiRefSlots);
  const [multiAssetTarget, setMultiAssetTarget] = useState<VideoMultiReferenceKey | null>(null);
  const [uploadingMultiSlot, setUploadingMultiSlot] = useState<VideoMultiReferenceKey | null>(null);

  const [multiDropSlot, setMultiDropSlot] = useState<VideoMultiReferenceKey | null>(null);
  const [confirmClearTasksOpen, setConfirmClearTasksOpen] = useState(false);
  const [derivedVideoMetadata, setDerivedVideoMetadata] = useState<Record<string, VideoOutputMetadata>>({});
  const [imageToVideoCapabilities, setImageToVideoCapabilities] = useState<VideoCapability[]>(
    FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES,
  );
  const [imageToVideoDefaultModel, setImageToVideoDefaultModel] = useState(DEFAULT_I2V_MODEL);
  const [imageToVideoCapabilityNotice, setImageToVideoCapabilityNotice] = useState<string | null>(null);
  const [multiParamCapabilities, setMultiParamCapabilities] = useState<VideoCapability[]>(
    FALLBACK_MULTI_PARAM_CAPABILITIES,
  );
  const [multiParamDefaultModel, setMultiParamDefaultModel] = useState("doubao-seedance-2-0-260128");
  const [multiParamCapabilityNotice, setMultiParamCapabilityNotice] = useState<string | null>(null);
  const [startEndCapabilities, setStartEndCapabilities] = useState<VideoCapability[]>(
    FALLBACK_START_END_CAPABILITIES,
  );
  const [startEndDefaultModel, setStartEndDefaultModel] = useState(DEFAULT_START_END_MODEL);
  const [startEndCapabilityNotice, setStartEndCapabilityNotice] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const currentImageToVideoInputMode = useMemo<VideoInputMode>(
    () => resolveImageToVideoInputMode(referenceImage?.url),
    [referenceImage?.url],
  );
  const selectedImageToVideoCapability = useMemo(() => {
    return (
      imageToVideoCapabilities.find((item) => item.id === model) ||
      imageToVideoCapabilities.find((item) => item.id === imageToVideoDefaultModel) ||
      pickFallbackVideoCapability(FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES, DEFAULT_I2V_MODEL) ||
      null
    );
  }, [imageToVideoCapabilities, imageToVideoDefaultModel, model]);
  const selectedImageToVideoCapabilitySet = useMemo(
    () => getImageToVideoCapabilitySet(selectedImageToVideoCapability, currentImageToVideoInputMode),
    [currentImageToVideoInputMode, selectedImageToVideoCapability],
  );
  const selectedMultiParamCapability = useMemo(() => {
    return (
      multiParamCapabilities.find((item) => item.id === multiRefModel) ||
      multiParamCapabilities.find((item) => item.id === multiParamDefaultModel) ||
      pickFallbackVideoCapability(FALLBACK_MULTI_PARAM_CAPABILITIES, "doubao-seedance-2-0-260128") ||
      null
    );
  }, [multiParamCapabilities, multiParamDefaultModel, multiRefModel]);
  const selectedMultiParamCapabilitySet = useMemo(
    () => getMultiParamCapabilitySet(selectedMultiParamCapability),
    [selectedMultiParamCapability],
  );
  const selectedStartEndCapability = useMemo(() => {
    return (
      startEndCapabilities.find((item) => item.id === startEndModel) ||
      startEndCapabilities.find((item) => item.id === startEndDefaultModel) ||
      pickFallbackVideoCapability(FALLBACK_START_END_CAPABILITIES, DEFAULT_START_END_MODEL) ||
      null
    );
  }, [startEndCapabilities, startEndDefaultModel, startEndModel]);
  const selectedStartEndCapabilitySet = useMemo(
    () => getStartEndCapabilitySet(selectedStartEndCapability),
    [selectedStartEndCapability],
  );
  const supportsCurrentImageToVideoInput = useMemo(() => {
    if (!selectedImageToVideoCapability) return false;
    if (currentImageToVideoInputMode === "single_reference") {
      return Boolean(selectedImageToVideoCapability.supportsSingleReference);
    }
    return Boolean(selectedImageToVideoCapability.supportsTextToVideo);
  }, [currentImageToVideoInputMode, selectedImageToVideoCapability]);
  const imageToVideoRequiresReference = Boolean(
    selectedImageToVideoCapability &&
      !selectedImageToVideoCapability.supportsTextToVideo &&
      selectedImageToVideoCapability.supportsSingleReference,
  );
  const imageToVideoCapabilityStatus =
    selectedImageToVideoCapabilitySet?.status || selectedImageToVideoCapability?.status || "experimental";
  const imageToVideoCapabilityNote =
    selectedImageToVideoCapabilitySet?.note ||
    selectedImageToVideoCapability?.note ||
    imageToVideoCapabilityNotice;
  const startEndCapabilityStatus =
    selectedStartEndCapabilitySet?.status || selectedStartEndCapability?.status || "experimental";
  const startEndCapabilityNote =
    selectedStartEndCapabilitySet?.note ||
    selectedStartEndCapability?.note ||
    startEndCapabilityNotice;
  const startEndInputNotice = useMemo(() => {
    if (!selectedStartEndCapability) return null;
    if (
      selectedStartEndCapability.supportsStartEndFrame === false ||
      selectedStartEndCapabilitySet?.supported === false
    ) {
      return "当前模型在首尾帧模式不可用，请切换到支持该模式的模型。";
    }
    if (!startFrame?.url && !endFrame?.url) {
      return "首尾帧模式需要同时上传首帧和尾帧。";
    }
    if (!startFrame?.url) {
      return "当前缺少首帧，首尾帧模式必须同时提供首帧和尾帧。";
    }
    if (!endFrame?.url) {
      return "当前缺少尾帧，首尾帧模式必须同时提供首帧和尾帧。";
    }
    return "已上传首帧和尾帧，当前会严格按首尾帧能力生成视频。";
  }, [endFrame?.url, selectedStartEndCapability, selectedStartEndCapabilitySet?.supported, startFrame?.url]);
  const imageToVideoInputNotice = useMemo(() => {
    if (!selectedImageToVideoCapability) return null;
    if (
      !selectedImageToVideoCapability.supportsTextToVideo &&
      !selectedImageToVideoCapability.supportsSingleReference
    ) {
      return "当前模型在图生视频页暂不可用，请切换到支持文生或单参考图的模型。";
    }
    if (referenceImage?.url && !selectedImageToVideoCapability.supportsSingleReference) {
      return "当前模型不支持单参考图视频，请移除参考图或切换到支持单参考图的模型。";
    }
    if (!referenceImage?.url && imageToVideoRequiresReference) {
      return "当前模型只支持单参考图视频，请先上传参考图，或切换到 grok-video-3 进行纯文生视频。";
    }
    if (referenceImage?.url) {
      return "已上传参考图，当前会按单参考图视频方式生成。";
    }
    return "未上传参考图时将按纯文本视频生成；上传参考图后会自动切换为单参考图视频。";
  }, [imageToVideoRequiresReference, referenceImage?.url, selectedImageToVideoCapability]);

  const canStartGeneration = useMemo(() => {
    if (!prompt.trim()) return false;
    if (videoMode === "image_to_video") {
      return supportsCurrentImageToVideoInput;
    }
    if (videoMode === "start_end_frame") {
      const supportsStartEnd =
        selectedStartEndCapability?.supportsStartEndFrame !== false &&
        selectedStartEndCapabilitySet?.supported !== false;
      return Boolean(startFrame?.url) && Boolean(endFrame?.url) && Boolean(supportsStartEnd);
    }
    return true;
  }, [
    prompt,
    selectedStartEndCapability?.supportsStartEndFrame,
    selectedStartEndCapabilitySet?.supported,
    startFrame?.url,
    endFrame?.url,
    supportsCurrentImageToVideoInput,
    videoMode,
  ]);

  const availableResolutionOptions = useMemo(() => {
    if (videoMode === "image_to_video") {
      const options = selectedImageToVideoCapabilitySet?.supportedResolutions?.filter(Boolean);
      return options?.length ? options : IMAGE_TO_VIDEO_RESOLUTION_OPTIONS;
    }
    if (videoMode === "start_end_frame") {
      const options = selectedStartEndCapabilitySet?.supportedResolutions?.filter(Boolean);
      return options?.length ? options : START_END_RESOLUTION_OPTIONS;
    }
    if (videoMode === "multi_param") {
      const options = selectedMultiParamCapabilitySet?.supportedResolutions?.filter(Boolean);
      return options?.length ? options : MULTI_PARAM_RESOLUTION_OPTIONS;
    }
    return GENERAL_VIDEO_RESOLUTION_OPTIONS;
  }, [selectedImageToVideoCapabilitySet, selectedMultiParamCapabilitySet, selectedStartEndCapabilitySet, videoMode]);
  const availableDurationOptions = useMemo(() => {
    if (videoMode === "image_to_video") {
      const options = selectedImageToVideoCapabilitySet?.supportedDurations?.filter(Boolean);
      return options?.length ? options : FIXED_DURATION_OPTIONS;
    }
    if (videoMode === "start_end_frame") {
      const options = selectedStartEndCapabilitySet?.supportedDurations?.filter(Boolean);
      return options?.length ? options : FIXED_DURATION_OPTIONS;
    }
    if (videoMode === "multi_param") {
      const options = selectedMultiParamCapabilitySet?.supportedDurations?.filter(Boolean);
      return options?.length ? options : FIXED_DURATION_OPTIONS;
    }
    return GENERAL_DURATION_OPTIONS;
  }, [selectedImageToVideoCapabilitySet, selectedMultiParamCapabilitySet, selectedStartEndCapabilitySet, videoMode]);
  const availableAspectRatioOptions = useMemo(() => {
    if (videoMode === "image_to_video") {
      const options = selectedImageToVideoCapabilitySet?.supportedAspectRatios?.filter(Boolean);
      return options?.length ? options : FIXED_ASPECT_RATIO_OPTIONS;
    }
    if (videoMode === "start_end_frame") {
      const options = selectedStartEndCapabilitySet?.supportedAspectRatios?.filter(Boolean);
      return options?.length ? options : FIXED_ASPECT_RATIO_OPTIONS;
    }
    if (videoMode === "multi_param") {
      const options = selectedMultiParamCapabilitySet?.supportedAspectRatios?.filter(Boolean);
      return options?.length ? options : FIXED_ASPECT_RATIO_OPTIONS;
    }
    return GENERAL_ASPECT_RATIO_OPTIONS;
  }, [selectedImageToVideoCapabilitySet, selectedMultiParamCapabilitySet, selectedStartEndCapabilitySet, videoMode]);

  const loadData = async () => {
    setLoading(true);
    try {
      const capabilityResponsePromise = getCreateVideoCapabilities("image_to_video").catch(() => null);
      const multiParamCapabilityResponsePromise =
        getCreateVideoCapabilities("multi_param").catch(() => null);
      const startEndCapabilityResponsePromise =
        getCreateVideoCapabilities("start_end_frame").catch(() => null);
      const [videoResponse, taskResponse] = await Promise.all([
        listCreateVideos(),
        listTasks(undefined, "create_video_generate"),
      ]);
      setResults(videoResponse.items);
      setTasks(taskResponse.items.slice(0, 100));
      setLoading(false);
      const [
        capabilityResponse,
        multiParamCapabilityResponse,
        startEndCapabilityResponse,
      ] = await Promise.all([
        capabilityResponsePromise,
        multiParamCapabilityResponsePromise,
        startEndCapabilityResponsePromise,
      ]);
      if (capabilityResponse?.items?.length) {
        setImageToVideoCapabilities(enrichVideoCapabilities(capabilityResponse.items));
        setImageToVideoDefaultModel(capabilityResponse.defaultModel || DEFAULT_I2V_MODEL);
        setImageToVideoCapabilityNotice(null);
      } else {
        setImageToVideoCapabilities(FALLBACK_IMAGE_TO_VIDEO_CAPABILITIES);
        setImageToVideoDefaultModel(DEFAULT_I2V_MODEL);
        setImageToVideoCapabilityNotice("能力接口暂不可用，已回退到本地模型目录。");
      }
      if (multiParamCapabilityResponse?.items?.length) {
        setMultiParamCapabilities(enrichVideoCapabilities(multiParamCapabilityResponse.items));
        setMultiParamDefaultModel(multiParamCapabilityResponse.defaultModel || "doubao-seedance-2-0-260128");
        setMultiParamCapabilityNotice(null);
      } else {
        setMultiParamCapabilities(FALLBACK_MULTI_PARAM_CAPABILITIES);
        setMultiParamDefaultModel("doubao-seedance-2-0-260128");
        setMultiParamCapabilityNotice("多参模型能力接口暂不可用，已回退到本地模型目录。");
      }
      if (startEndCapabilityResponse?.items?.length) {
        setStartEndCapabilities(enrichVideoCapabilities(startEndCapabilityResponse.items));
        setStartEndDefaultModel(startEndCapabilityResponse.defaultModel || DEFAULT_START_END_MODEL);
        setStartEndCapabilityNotice(null);
      } else {
        setStartEndCapabilities(FALLBACK_START_END_CAPABILITIES);
        setStartEndDefaultModel(DEFAULT_START_END_MODEL);
        setStartEndCapabilityNotice("首尾帧模型能力接口暂不可用，已回退到本地模型目录。");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  useEffect(() => {
    setPreviewItem(null);
    setSyncDraft(null);
    setSyncNotice(null);
    void loadData();
  }, [actorId]);

  useEffect(() => {
    const clearMultiDrop = () => setMultiDropSlot(null);
    window.addEventListener("dragend", clearMultiDrop);
    return () => window.removeEventListener("dragend", clearMultiDrop);
  }, []);

  useEffect(() => {
    if (videoMode !== "image_to_video") return;
    if (imageToVideoCapabilities.some((item) => item.id === model)) return;
    setModel(imageToVideoDefaultModel || DEFAULT_I2V_MODEL);
  }, [imageToVideoCapabilities, imageToVideoDefaultModel, model, videoMode]);

  useEffect(() => {
    if (videoMode !== "multi_param") return;
    if (multiParamCapabilities.some((item) => item.id === multiRefModel)) return;
    setMultiRefModel(multiParamDefaultModel || "doubao-seedance-2-0-260128");
  }, [multiParamCapabilities, multiParamDefaultModel, multiRefModel, videoMode]);

  useEffect(() => {
    if (videoMode !== "start_end_frame") return;
    if (startEndCapabilities.some((item) => item.id === startEndModel)) return;
    setStartEndModel(startEndDefaultModel || DEFAULT_START_END_MODEL);
  }, [startEndCapabilities, startEndDefaultModel, startEndModel, videoMode]);

  useEffect(() => {
    if (!availableResolutionOptions.some((option) => option === resolution)) {
      setResolution(availableResolutionOptions[0]);
    }
  }, [availableResolutionOptions, resolution]);

  useEffect(() => {
    if (!availableDurationOptions.some((option) => option === duration)) {
      setDuration(availableDurationOptions[0]);
    }
  }, [availableDurationOptions, duration]);

  useEffect(() => {
    if (!availableAspectRatioOptions.some((option) => option === aspectRatio)) {
      setAspectRatio(availableAspectRatioOptions[0]);
    }
  }, [aspectRatio, availableAspectRatioOptions]);

  useEffect(() => {
    let cancelled = false;
    const candidates = [...results, ...(previewItem ? [previewItem] : [])]
      .map((item) => playableVideoUrl(item))
      .filter((url): url is string => Boolean(url))
      .filter((url) => !derivedVideoMetadata[url] && !videoOutputMetadataCache.has(url));

    if (!candidates.length) {
      return;
    }

    const uniqueCandidates = Array.from(new Set(candidates));
    void Promise.all(
      uniqueCandidates.map(async (url) => {
        const metadata = await readVideoOutputMetadata(url);
        if (cancelled) return;
        setDerivedVideoMetadata((current) => {
          if (current[url]) return current;
          return { ...current, [url]: metadata };
        });
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [derivedVideoMetadata, previewItem, results]);

  const filteredResults = useMemo(() => {
    return results.filter((item) => {
      const matchQuery =
        !historyQuery ||
        item.prompt.includes(historyQuery) ||
        item.duration.includes(historyQuery) ||
        item.outputDuration?.includes(historyQuery) ||
        item.aspectRatio.includes(historyQuery) ||
        item.outputAspectRatio?.includes(historyQuery) ||
        item.taskId?.includes(historyQuery);
      const matchModel = historyModel === "all" || item.model === historyModel;
      return matchQuery && matchModel;
    });
  }, [historyModel, historyQuery, results]);

  const taskProjectIdByTaskId = useMemo(() => {
    const next = new Map<string, string>();
    for (const task of tasks) {
      const taskProjectId = resolveTaskProjectId(task);
      if (taskProjectId) {
        next.set(task.id, taskProjectId);
      }
    }
    return next;
  }, [tasks]);

  const totalPages = Math.max(1, Math.ceil(filteredResults.length / VIDEO_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const pagedResults = useMemo(() => {
    const startIndex = (currentPage - 1) * VIDEO_PAGE_SIZE;
    return filteredResults.slice(startIndex, startIndex + VIDEO_PAGE_SIZE);
  }, [filteredResults, currentPage]);

  useEffect(() => {
    // 搜索或模型筛选变化时重置到第一页
    setPage(1);
  }, [historyModel, historyQuery]);

  const modelOptions = useMemo(
    () => ["all", ...Array.from(new Set(results.map((item) => item.model)))],
    [results],
  );

  const recentTasks = useMemo(() => tasks.slice(0, 6), [tasks]);
  const previewVideoUrl = previewItem ? playableVideoUrl(previewItem) : null;
  const previewVideoMetadata = previewVideoUrl ? derivedVideoMetadata[previewVideoUrl] : null;
  const hasActiveTasks = useMemo(
    () => tasks.some((item) => item.status === "queued" || item.status === "running"),
    [tasks],
  );

  useEffect(() => {
    if (!hasActiveTasks) return;

    const timer = window.setInterval(() => {
      void loadData();
    }, 4000);

    return () => window.clearInterval(timer);
  }, [hasActiveTasks]);

  const handleDismissTask = async (id: string) => {
    await deleteTask(id);
    setTasks((current) => current.filter((task) => task.id !== id));
  };

  const handleClearTasks = async () => {
    await clearTasks(currentProjectId, "create_video_generate");
    setTasks([]);
    setConfirmClearTasksOpen(false);
  };

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (!canStartGeneration) return;
    if (generatingRef.current) return;
    generatingRef.current = true;

    const multiPayload = videoMode === "multi_param" ? buildMultiReferencePayload(multiRefSlots) : undefined;
    const effectiveModel =
      videoMode === "multi_param"
        ? multiPayload && Object.keys(multiPayload).length
          ? multiRefModel
          : multiParamDefaultModel || "doubao-seedance-2-0-260128"
        : videoMode === "start_end_frame"
          ? startEndModel
          : model;

    setGenerating(true);
    setGenerateError(null);
    try {
      await generateCreateVideos({
        projectId: currentProjectId,
        prompt,
        model: effectiveModel,
        duration,
        aspectRatio,
        resolution,
        motionStrength,
        keepConsistency,
        videoMode,
        ...(videoMode === "image_to_video" && referenceImage?.url
          ? { referenceImageUrl: referenceImage.url }
          : {}),
        ...(videoMode === "start_end_frame" && startFrame?.url && endFrame?.url
          ? {
              firstFrameUrl: startFrame.url,
              lastFrameUrl: endFrame.url,
            }
          : {}),
        ...(videoMode === "multi_param" && multiPayload ? { multiReferenceImages: multiPayload } : {}),
        idempotencyKey: newIdempotencyKey(),
      });
      await loadData();
    } catch (error) {
      const parsed = parseGenerationError(error);
      setGenerateError(parsed.message);
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  };

  const handleDeleteVideo = async (id: string) => {
    try {
      await deleteCreateVideo(id);
      setResults((prev) => prev.filter((item) => item.id !== id));
      if (previewItem?.id === id) setPreviewItem(null);
    } catch {
      window.alert("删除失败，请稍后重试。");
    }
  };

  // ── Manual sync (result → project asset library, manual) ──────────
  const openAssetSync = (item: CreateVideoResult) => {
    const targetProjectId = item.taskId ? taskProjectIdByTaskId.get(item.taskId) || null : null;
    setSyncDraft(buildVideoAssetDraft(item, targetProjectId));
    setSyncDragActive(false);
    setDraggingItem(null);
  };

  const handleResultDragStart = (event: DragEvent<HTMLElement>, item: CreateVideoResult) => {
    const targetProjectId = item.taskId ? taskProjectIdByTaskId.get(item.taskId) || null : null;
    const draft = buildVideoAssetDraft(item, targetProjectId);
    draggingRef.current = draft;
    setDraggingItem(draft);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", draft.id);
  };

  const handleResultDragEnd = () => {
    draggingRef.current = null;
    setDraggingItem(null);
    setSyncDragActive(false);
  };

  const handleSyncDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setSyncDragActive(true);
  };

  const handleSyncDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setSyncDragActive(false);
  };

  const handleSyncDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const item = draggingRef.current;
    if (!item) return;
    setSyncDraft(item);
    draggingRef.current = null;
    setDraggingItem(null);
    setSyncDragActive(false);
  };

  const handleSyncSubmit = async (input: Parameters<typeof createAsset>[1]) => {
    setSyncingAsset(true);
    try {
      let targetProjectId = syncDraft?.targetProjectId || null;
      const syncTaskId = typeof syncDraft?.taskId === "string" ? syncDraft.taskId.trim() : "";
      if (!targetProjectId && syncTaskId) {
        try {
          targetProjectId = resolveTaskProjectId(await getTask(syncTaskId));
        } catch {
          targetProjectId = null;
        }
      }
      const asset = await createAsset(targetProjectId || currentProjectId, input);
      setSyncNotice(`已同步到资产库：${asset.name}`);
      setSyncDraft(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步到资产库失败，请稍后重试。";
      setSyncNotice(message);
      window.alert(message);
    } finally {
      setSyncingAsset(false);
    }
  };

  useEffect(() => {
    if (!syncNotice) return;
    const timer = window.setTimeout(() => setSyncNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [syncNotice]);

  const handleReferenceUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const prepared = await prepareReferenceUploadFile(file);
      const uploaded = await uploadFile(prepared.file, "create-video-reference");
      setReferenceImage({
        id: uploaded.id,
        url: uploaded.url,
        originalName: uploaded.originalName,
        source: "upload",
      });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Reference upload failed. Please try again.");
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const handleFrameUpload = async (event: ChangeEvent<HTMLInputElement>, slot: "start" | "end") => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingSlot(slot);
    try {
      const prepared = await prepareReferenceUploadFile(file);
      const uploaded = await uploadFile(prepared.file, "create-video-frame");
      const next: ReferenceImageState = {
        id: uploaded.id,
        url: uploaded.url,
        originalName: uploaded.originalName,
        source: "upload",
      };
      if (slot === "start") setStartFrame(next);
      else setEndFrame(next);
    } catch (error) {
      window.alert(
        error instanceof Error
          ? error.message
          : slot === "start"
            ? "Start frame upload failed. Please try again."
            : "End frame upload failed. Please try again."
      );
    } finally {
      setUploadingSlot(null);
      event.target.value = "";
    }
  };

  const applyReferenceAsset = (asset: ReferenceAssetSelection) => {
    setReferenceImage({
      id: asset.id,
      url: asset.url,
      originalName: asset.name,
      source: "asset",
      assetId: asset.id,
    });
    setReferenceDropActive(false);
  };

  const applyStartFrameAsset = (asset: ReferenceAssetSelection) => {
    setStartFrame({
      id: asset.id,
      url: asset.url,
      originalName: asset.name,
      source: "asset",
      assetId: asset.id,
    });
    setStartDropActive(false);
  };

  const applyEndFrameAsset = (asset: ReferenceAssetSelection) => {
    setEndFrame({
      id: asset.id,
      url: asset.url,
      originalName: asset.name,
      source: "asset",
      assetId: asset.id,
    });
    setEndDropActive(false);
  };

  const handleReferenceDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(REFERENCE_ASSET_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setReferenceDropActive(true);
  };

  const handleReferenceDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setReferenceDropActive(false);
  };

  const handleReferenceDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const payload = event.dataTransfer.getData(REFERENCE_ASSET_MIME);
    if (!payload) {
      setReferenceDropActive(false);
      return;
    }

    try {
      applyReferenceAsset(JSON.parse(payload) as ReferenceAssetSelection);
    } catch {
      setReferenceDropActive(false);
    }
  };

  const handleStartFrameDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(REFERENCE_ASSET_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setStartDropActive(true);
  };

  const handleEndFrameDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(REFERENCE_ASSET_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setEndDropActive(true);
  };

  const handleStartFrameDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setStartDropActive(false);
  };

  const handleEndFrameDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setEndDropActive(false);
  };

  const handleStartFrameDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setStartDropActive(false);
    const payload = event.dataTransfer.getData(REFERENCE_ASSET_MIME);
    if (!payload) return;
    try {
      applyStartFrameAsset(JSON.parse(payload) as ReferenceAssetSelection);
    } catch {
      /* ignore */
    }
  };

  const handleEndFrameDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setEndDropActive(false);
    const payload = event.dataTransfer.getData(REFERENCE_ASSET_MIME);
    if (!payload) return;
    try {
      applyEndFrameAsset(JSON.parse(payload) as ReferenceAssetSelection);
    } catch {
      /* ignore */
    }
  };

  const handleMultiSlotUpload = async (event: ChangeEvent<HTMLInputElement>, slot: VideoMultiReferenceKey) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setUploadingMultiSlot(slot);
    try {
      const uploadedItems = await Promise.all(
        files.map(async (file) => {
          const prepared = await prepareReferenceUploadFile(file);
          const uploaded = await uploadFile(prepared.file, "create-video-multi-ref");
          return {
            id: uploaded.id,
            url: uploaded.url,
            originalName: uploaded.originalName,
            source: "upload" as const,
          };
        }),
      );
      setMultiRefSlots((prev) => ({
        ...prev,
        [slot]: appendMultiRefItems(prev[slot], uploadedItems),
      }));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Reference upload failed. Please try again.");
    } finally {
      setUploadingMultiSlot(null);
      event.target.value = "";
    }
  };

  const applyMultiSlotAsset = (slot: VideoMultiReferenceKey, asset: ReferenceAssetSelection) => {
    setMultiRefSlots((prev) => ({
      ...prev,
      [slot]: appendMultiRefItems(prev[slot], [
        {
          id: asset.id,
          url: asset.url,
          originalName: asset.name,
          source: "asset",
          assetId: asset.id,
        },
      ]),
    }));
    setMultiDropSlot(null);
  };

  const removeMultiSlotAsset = (slot: VideoMultiReferenceKey, assetId: string) => {
    setMultiRefSlots((prev) => ({
      ...prev,
      [slot]: prev[slot].filter((item) => (item.assetId || item.id) !== assetId),
    }));
  };

  const handleMultiSlotDragOver = (slot: VideoMultiReferenceKey) => (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(REFERENCE_ASSET_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setMultiDropSlot(slot);
  };

  const handleMultiSlotDragLeave = (slot: VideoMultiReferenceKey) => (event: DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setMultiDropSlot((cur) => (cur === slot ? null : cur));
  };

  const handleMultiSlotDropAsset = (slot: VideoMultiReferenceKey) => (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setMultiDropSlot(null);
    const payload = event.dataTransfer.getData(REFERENCE_ASSET_MIME);
    if (!payload) return;
    try {
      applyMultiSlotAsset(slot, JSON.parse(payload) as ReferenceAssetSelection);
    } catch {
      /* ignore */
    }
  };

  const clearMultiSlot = (slot: VideoMultiReferenceKey) => {
    setMultiRefSlots((prev) => ({ ...prev, [slot]: [] }));
  };

  return (
    <CreateStudioSplitLayout
      pageKey="video-create"
      sidebar={
        <>
          <div className="shrink-0 border-b border-border p-4">
          <h2 className="flex items-center gap-2 font-medium">
            <Settings2 className="h-4 w-4 text-primary" />
            生成参数
          </h2>
        </div>

          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overflow-x-hidden p-4 custom-scrollbar">
          <VideoReferenceInputs>

          {videoMode === "image_to_video" ? (
            <>
          <div
            className={cn(
              "space-y-2 rounded-2xl border border-transparent p-1 transition-colors",
              referenceDropActive ? "border-primary/50 bg-primary/5" : "",
            )}
            onDragOver={handleReferenceDragOver}
            onDragLeave={handleReferenceDragLeave}
            onDrop={handleReferenceDrop}
          >
            <label className="text-sm font-medium">参考图</label>
            <label
              className={cn(
                "flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-sm transition-colors hover:border-primary/50 hover:text-primary",
                referenceDropActive ? "border-primary bg-primary/10 text-primary" : "",
              )}
            >
              {uploading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              上传参考图
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => void handleReferenceUpload(event)}
              />
            </label>
            {referenceImage ? (
                  <div className="relative overflow-hidden rounded-lg border border-border bg-muted/20">
                    <button
                      type="button"
                      onClick={() => setReferenceImage(null)}
                      className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/70 bg-background/85 text-muted-foreground shadow-sm transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                      title="移除当前参考图"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <img
                      src={getGeneratedMediaUrl(referenceImage.url) || undefined}
                  alt={referenceImage.originalName}
                      className="aspect-video w-full cursor-zoom-in object-cover"
                  referrerPolicy="no-referrer"
                      onDoubleClick={() =>
                        setReferencePreview({
                          url: getGeneratedMediaUrl(referenceImage.url) || referenceImage.url,
                          title: referenceImage.originalName || "参考图",
                        })
                      }
                      title="双击放大查看原图"
                />
                <div className="flex items-center justify-between border-t border-border bg-background/80 px-3 py-2 text-[11px] text-muted-foreground">
                  <span className="truncate">{referenceImage.originalName}</span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                    {referenceImage.source === "asset" ? "资产库" : "本地上传"}
                  </span>
                </div>
              </div>
            ) : null}
            <p className="text-[11px] leading-5 text-primary/80">
                  可从下方资产库点选，或拖拽素材到此处。
            </p>
          </div>

          <ReferenceAssetPicker
            projectId={currentProjectId}
            selectedAssetId={referenceImage?.source === "asset" ? referenceImage.assetId || null : null}
            onSelect={applyReferenceAsset}
          />

              <div className="hidden rounded-xl border border-primary/20 bg-primary/8 px-3 py-2 text-[11px] leading-5 text-primary">
                当前图生视频会按所选模型的真实可用能力执行；<span className="font-medium">veo3.1-pro</span> 与 <span className="font-medium">veo3.1</span> 的单参考图链路已验证可用。
              </div>

              <div className="rounded-xl border border-amber-600/40 bg-amber-500/15 px-3 py-2 text-[11px] leading-5 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                当前图生视频建议优先使用 <span className="font-medium">PixVerse V6</span> 或 <span className="font-medium">PixVerse C1</span>；
                旧的 Yunwu <span className="font-medium">veo3.1</span> / <span className="font-medium">veo3.1-pro</span> 仅保留兼容，不再作为主推荐模型。
              </div>

          <div className="space-y-2">
                <label className="text-sm font-medium">图生视频模型</label>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
                  {imageToVideoCapabilities.map((option) => (
                    <option key={option.id} value={option.id}>
                      {imageToVideoModelLabel(option)}（{capabilityStatusLabel(
                        getImageToVideoOptionStatus(option, currentImageToVideoInputMode),
                      )}）
                </option>
              ))}
            </select>
            <p className="text-[11px] leading-5 text-muted-foreground">
                  {imageToVideoCapabilityNote}
                </p>
                <div className="flex items-center justify-between gap-3 text-[11px]">
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2 py-0.5 font-medium",
                      capabilityStatusTone(imageToVideoCapabilityStatus),
                    )}
                  >
                    {capabilityStatusLabel(imageToVideoCapabilityStatus)}
                  </span>
                  <span className="text-muted-foreground">
                    {currentImageToVideoInputMode === "single_reference" ? "当前输入：单参考图视频" : "当前输入：纯文本视频"}
                  </span>
          </div>
                {imageToVideoInputNotice ? (
                  <div
                    className={cn(
                      "rounded-xl border px-3 py-2 text-[11px] leading-5",
                      imageToVideoRequiresReference && !referenceImage?.url
                        ? "border-amber-600/40 bg-amber-500/15 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
                        : "border-border/60 bg-background/40 text-muted-foreground",
                    )}
                  >
                    {imageToVideoInputNotice}
                  </div>
                ) : null}
                {imageToVideoCapabilityNotice ? (
                  <div className="rounded-xl border border-border/60 bg-background/40 px-3 py-2 text-[11px] leading-5 text-muted-foreground">
                    {imageToVideoCapabilityNotice}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}

          {videoMode === "start_end_frame" ? (
            <>
              <div
                className={cn(
                  "space-y-2 rounded-2xl border border-transparent p-1 transition-colors",
                  startDropActive ? "border-primary/50 bg-primary/5" : "",
                )}
                onDragOver={handleStartFrameDragOver}
                onDragLeave={handleStartFrameDragLeave}
                onDrop={handleStartFrameDrop}
              >
                <label className="text-sm font-medium">首帧（必填）</label>
                <label
                  className={cn(
                    "flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-sm transition-colors hover:border-primary/50 hover:text-primary",
                    startDropActive ? "border-primary bg-primary/10 text-primary" : "",
                  )}
                >
                  {uploadingSlot === "start" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  上传首帧
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => void handleFrameUpload(event, "start")}
                  />
                </label>
                {startFrame ? (
                  <div className="relative overflow-hidden rounded-lg border border-border bg-muted/20">
                    <button
                      type="button"
                      onClick={() => setStartFrame(null)}
                      className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/70 bg-background/85 text-muted-foreground shadow-sm transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                      title="移除当前首帧"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <img
                      src={getGeneratedMediaUrl(startFrame.url) || undefined}
                      alt={startFrame.originalName}
                      className="aspect-video w-full cursor-zoom-in object-cover"
                      referrerPolicy="no-referrer"
                      onDoubleClick={() =>
                        setReferencePreview({
                          url: getGeneratedMediaUrl(startFrame.url) || startFrame.url,
                          title: startFrame.originalName || "首帧",
                        })
                      }
                      title="双击放大查看原图"
                    />
                    <div className="flex items-center justify-between border-t border-border bg-background/80 px-3 py-2 text-[11px] text-muted-foreground">
                      <span className="truncate">{startFrame.originalName}</span>
                    </div>
                  </div>
                ) : null}
              </div>

              <div
                className={cn(
                  "space-y-2 rounded-2xl border border-transparent p-1 transition-colors",
                  endDropActive ? "border-primary/50 bg-primary/5" : "",
                )}
                onDragOver={handleEndFrameDragOver}
                onDragLeave={handleEndFrameDragLeave}
                onDrop={handleEndFrameDrop}
              >
                <label className="text-sm font-medium">尾帧（必填）</label>
                <label
                  className={cn(
                    "flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-3 text-sm transition-colors hover:border-primary/50 hover:text-primary",
                    endDropActive ? "border-primary bg-primary/10 text-primary" : "",
                  )}
                >
                  {uploadingSlot === "end" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  上传尾帧
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => void handleFrameUpload(event, "end")}
                  />
                </label>
                {endFrame ? (
                  <div className="relative overflow-hidden rounded-lg border border-border bg-muted/20">
                    <button
                      type="button"
                      onClick={() => setEndFrame(null)}
                      className="absolute right-2 top-2 z-10 inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/70 bg-background/85 text-muted-foreground shadow-sm transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                      title="移除当前尾帧"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                    <img
                      src={getGeneratedMediaUrl(endFrame.url) || undefined}
                      alt={endFrame.originalName}
                      className="aspect-video w-full cursor-zoom-in object-cover"
                      referrerPolicy="no-referrer"
                      onDoubleClick={() =>
                        setReferencePreview({
                          url: getGeneratedMediaUrl(endFrame.url) || endFrame.url,
                          title: endFrame.originalName || "尾帧",
                        })
                      }
                      title="双击放大查看原图"
                    />
                    <div className="flex items-center justify-between border-t border-border bg-background/80 px-3 py-2 text-[11px] text-muted-foreground">
                      <span className="truncate">{endFrame.originalName}</span>
                    </div>
                  </div>
                ) : null}
              </div>

              <ReferenceAssetPicker
                projectId={currentProjectId}
                selectedAssetId={startFrame?.source === "asset" ? startFrame.assetId || null : null}
                onSelect={applyStartFrameAsset}
                heading="从资产库选取首帧"
                hint="点击图片资产后将自动应用为首帧"
              />

              <ReferenceAssetPicker
                projectId={currentProjectId}
                selectedAssetId={endFrame?.source === "asset" ? endFrame.assetId || null : null}
                onSelect={applyEndFrameAsset}
                heading="从资产库选取尾帧"
                hint="点击图片资产后将自动应用为尾帧"
              />

              <div className="rounded-xl border border-primary/20 bg-primary/8 px-3 py-2 text-[11px] leading-5 text-primary">
                当前首尾帧模式会严格要求首帧与尾帧同时提供；默认优先按 <span className="font-medium">PixVerse V6</span> 的真实能力生成。
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">首尾帧模型</label>
                <select
                  value={startEndModel}
                  onChange={(event) => setStartEndModel(event.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {startEndCapabilities.map((option) => (
                    <option key={option.id} value={option.id}>
                      {startEndModelLabel(option)}
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5",
                      capabilityStatusTone(startEndCapabilityStatus),
                    )}
                  >
                    {capabilityStatusLabel(startEndCapabilityStatus)}
                  </span>
                  <span className="text-muted-foreground">
                    当前模型{" "}
                    {withVeoVideoModelDisplayRemark(
                      selectedStartEndCapability?.id || startEndModel,
                      selectedStartEndCapability?.label || startEndModel,
                    )}{" "}
                    按真实首尾帧能力执行
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {startEndCapabilityNote ||
                    "当前首尾帧模式已接入能力表；不同模型的稳定性和参数范围以下拉状态为准。"}
                </p>
                {startEndInputNotice ? <p className="text-xs text-amber-800 dark:text-amber-300">{startEndInputNotice}</p> : null}
              </div>
            </>
          ) : null}

          {videoMode === "multi_param" ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-border/70 bg-background/35 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
                当前多参考视频会按所选模型的真实能力执行；不同模型的最多参考图数量和稳定性以下方能力表为准，系统仍会优先保留
                <span className="font-medium text-foreground"> scene / character / prop </span>
                这三类主参考图。
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">多参考视频模型</label>
                <select
                  value={multiRefModel}
                  onChange={(event) => setMultiRefModel(event.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {multiParamCapabilities.map((option) => (
                    <option key={option.id} value={option.id}>
                      {multiParamModelLabel(option)}
                    </option>
                  ))}
                </select>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5",
                      capabilityStatusTone(
                        selectedMultiParamCapabilitySet?.status || selectedMultiParamCapability?.status || "experimental",
                      ),
                    )}
                  >
                    {capabilityStatusLabel(
                      selectedMultiParamCapabilitySet?.status || selectedMultiParamCapability?.status || "experimental",
                    )}
                  </span>
                  <span className="text-muted-foreground">
                    当前接入最多 {selectedMultiParamCapability?.maxReferenceImages || 7} 张参考图
                  </span>
                  <span className="rounded-full border border-border/60 px-2 py-0.5 text-muted-foreground">
                    {selectedMultiParamCapability?.maxReferenceImagesSource === "official"
                      ? "官方上限"
                      : "当前接入上限"}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {selectedMultiParamCapabilitySet?.note ||
                    selectedMultiParamCapability?.note ||
                    "当前多参考模型会按后端能力表路由到对应的 Yunwu 官方接口。"}
                </p>
                {multiParamCapabilityNotice ? (
                  <p className="text-xs text-amber-800 dark:text-amber-300">{multiParamCapabilityNotice}</p>
                ) : null}
              </div>
              <div className="hidden rounded-xl border border-border/70 bg-background/35 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
                多参考生成当前优先按 <span className="font-medium text-foreground">PixVerse C1 Fusion</span> 的真实能力执行。
                系统会按场景→角色→道具→姿态→表情→特效→手绘顺序组织参考信息，并优先保证前三张参考图的约束有效。
              </div>
              <div className="hidden space-y-2">
                <label className="text-sm font-medium">多参考视频模型</label>
                <select
                  value={multiRefModel}
                  onChange={(event) =>
                    setMultiRefModel(event.target.value as (typeof MULTI_REF_MODEL_OPTIONS)[number])
                  }
                  className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {MULTI_REF_MODEL_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {formatVideoResultModelDisplay(option)}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  当前多参生成会优先使用 PixVerse C1 Fusion；若能力接口不可用，则才回退到本地 fallback 模型目录。
                </p>
              </div>

              <MultiReferenceSlots
                projectId={currentProjectId}
                isActive={videoMode === "multi_param"}
                slots={multiRefSlots}
                assetTarget={multiAssetTarget}
                dropSlot={multiDropSlot}
                uploadingSlot={uploadingMultiSlot}
                onSetAssetTarget={setMultiAssetTarget}
                onClearSlot={clearMultiSlot}
                onUpload={handleMultiSlotUpload}
                onDragOver={handleMultiSlotDragOver}
                onDragLeave={handleMultiSlotDragLeave}
                onDrop={handleMultiSlotDropAsset}
                onPreview={setReferencePreview}
                onApplyAsset={applyMultiSlotAsset}
                onRemoveAsset={removeMultiSlotAsset}
              />
            </div>
          ) : null}

          <div className="space-y-2">
            <label className="text-sm font-medium">视频时长</label>
            <div className={cn("grid gap-2", availableDurationOptions.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
              {availableDurationOptions.map((item) => (
                <button
                  key={item}
                  onClick={() => setDuration(item)}
                  className={cn(
                    "rounded-md border py-2 text-xs font-medium transition-colors",
                    duration === item
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/50",
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
            {videoMode === "multi_param" ? (
              <p className="text-xs text-muted-foreground">
                PixVerse C1 Fusion 的时长以后端能力表为准；当前按官方支持 5s / 8s。
              </p>
            ) : null}
            {videoMode === "start_end_frame" ? (
              <p className="text-xs text-muted-foreground">
                首尾帧模式现在严格要求首帧和尾帧都必填；PixVerse 首尾帧按官方支持 1s–15s。
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">画幅比例</label>
            <div
              className={cn(
                "grid gap-2",
                availableAspectRatioOptions.length === 1 ? "grid-cols-1" : "grid-cols-3",
              )}
            >
              {availableAspectRatioOptions.map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => setAspectRatio(ratio)}
                  className={cn(
                    "rounded-md border py-2 text-xs font-medium transition-colors",
                    aspectRatio === ratio
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/50",
                  )}
                >
                  {ratio}
                </button>
              ))}
            </div>
            {videoMode === "multi_param" ? (
              <p className="text-xs text-muted-foreground">
                PixVerse C1 Fusion 的画幅以后端能力表为准；若官方支持显式画幅，则按官方可选项展示。
              </p>
            ) : null}
            {videoMode === "start_end_frame" ? (
              <p className="text-xs text-muted-foreground">
                PixVerse 首尾帧按官方 transition 接口执行；若官方不支持显式画幅，则统一按 adaptive 自动处理。
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">清晰度</label>
            <select
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {availableResolutionOptions.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
            {videoMode === "multi_param" ? (
              <p className="text-xs text-muted-foreground">
                PixVerse C1 Fusion 的清晰度以后端能力表为准；当前支持 360p / 540p / 720p / 1080p。
              </p>
            ) : null}
            {videoMode === "start_end_frame" ? (
              <p className="text-xs text-muted-foreground">
                PixVerse 首尾帧的清晰度以后端能力表为准；当前支持 360p / 540p / 720p / 1080p。
              </p>
            ) : null}
            {videoMode === "image_to_video" && model === "veo3.1-pro" ? (
              <p className="text-xs text-muted-foreground">
                云雾 `veo3.1-pro` 图生视频当前统一按增强模式执行，稳定输出仅保留 1080p。
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">运动强度</label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="1"
                max="10"
                value={motionStrength}
                onChange={(event) => setMotionStrength(Number(event.target.value))}
                className="flex-1 accent-primary"
              />
              <span className="w-4 text-right text-sm font-medium">{motionStrength}</span>
            </div>
          </div>

          <div className="flex items-center justify-between">
            <label className="text-sm font-medium">保持一致性</label>
            <button
              onClick={() => setKeepConsistency((current) => !current)}
              className={cn(
                "relative h-5 w-10 rounded-full transition-colors",
                keepConsistency ? "bg-primary" : "bg-secondary",
              )}
            >
              <span
                className={cn(
                  "absolute top-1 h-3 w-3 rounded-full transition-all",
                  keepConsistency
                    ? "right-1 bg-primary-foreground"
                    : "left-1 bg-muted-foreground",
                )}
              />
            </button>
          </div>
          </VideoReferenceInputs>
        </div>
        </>
      }
    >
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b border-border bg-card/30 px-6 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <Video className="h-5 w-5 text-primary" />
              视频创作
            </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                独立创作结果只做临时输出，可预览和下载。
              </p>
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-background/40 p-1">
              {VIDEO_MODE_TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setVideoMode(tab.id);
                    if (tab.id === "image_to_video") {
                      setResolution(DEFAULT_VIDEO_RESOLUTION);
                    } else if (tab.id === "start_end_frame") {
                      setResolution(DEFAULT_START_END_RESOLUTION);
                    }
                    setGenerateError(null);
                  }}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-all sm:text-sm",
                    videoMode === tab.id
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  {tab.id === "multi_param" ? <Layers className="h-3.5 w-3.5 sm:h-4 sm:w-4" /> : null}
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6 custom-scrollbar">
          <div className="glass-panel flex flex-col gap-4 rounded-2xl p-4">
              <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/10 px-4 py-3 text-xs leading-6 text-indigo-100">
                {videoMode === "image_to_video"
                  ? "图生视频：上传一张参考图，用提示词描述镜头动作；当前优先按 PixVerse V6 / PixVerse C1 的真实能力执行，旧 Yunwu 模型仅保留兼容。"
                  : videoMode === "start_end_frame"
                    ? "首尾帧：上传首帧与尾帧（都必填），用提示词补充过渡意图；当前默认优先走 PixVerse V6，并严格按官方接口生成。"
                    : "多参生成：上传多张参考图后由系统整理多参信息，并优先走 PixVerse C1 Fusion；能力、画幅、时长都以后端返回的真实能力表为准。"}
            </div>
            {videoMode === "image_to_video" ? (
              <div className="rounded-xl border border-border/60 bg-background/30 px-4 py-3 text-xs leading-6 text-muted-foreground">
                当前模型{" "}
                <span className="font-medium text-foreground">
                  {withVeoVideoModelDisplayRemark(model, selectedImageToVideoCapability?.label || model)}
                </span>
                处于“{capabilityStatusLabel(imageToVideoCapabilityStatus)}”状态。
                {!referenceImage?.url && imageToVideoRequiresReference
                  ? " 该模型只支持单参考图视频，请先上传参考图。"
                  : !referenceImage?.url
                    ? " 未上传参考图时会按纯文本视频生成。"
                    : " 已上传参考图，当前会按单参考图视频生成。"}
            </div>
            ) : null}
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="h-24 w-full resize-none bg-transparent text-sm leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none"
              placeholder="输入一段话，描述视频中的动作、变化和镜头语言"
            />

            <div className="flex items-center justify-end gap-3 border-t border-border pt-3">
              <button
                onClick={() => setPrompt("")}
                className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                <Trash2 className="h-4 w-4" />
                清空提示词
              </button>
              {videoMode === "image_to_video" && referenceImage ? (
                <button
                  onClick={() => setReferenceImage(null)}
                  className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                >
                  <Upload className="h-4 w-4" />
                  清除参考图
                </button>
              ) : null}
              {videoMode === "start_end_frame" && (startFrame || endFrame) ? (
                <button
                  onClick={() => {
                    setStartFrame(null);
                    setEndFrame(null);
                  }}
                  className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                >
                  <Upload className="h-4 w-4" />
                  清除首尾帧
                </button>
              ) : null}
              {videoMode === "multi_param" &&
              MULTI_REF_ORDER.some((key) => multiRefSlots[key].length > 0) ? (
                <button
                  onClick={() => {
                    setMultiRefSlots(createEmptyMultiRefSlots());
                    setMultiAssetTarget(null);
                  }}
                  className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                >
                  <Trash2 className="h-4 w-4" />
                  清除多参参考图
                </button>
              ) : null}
              <button
                onClick={() => void handleGenerate()}
                disabled={generating || !canStartGeneration}
                className="flex items-center gap-2 rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {generating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {!canStartGeneration && prompt.trim()
                  ? videoMode === "image_to_video"
                    ? "请先上传参考图"
                    : videoMode === "start_end_frame"
                      ? "请先上传首帧和尾帧"
                      : "开始生成"
                  : "开始生成"}
              </button>
            </div>
            {generateError ? (
              <div className="whitespace-pre-wrap rounded-xl border border-rose-600/40 bg-rose-500/15 px-4 py-3 text-xs leading-6 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                {generateError}
              </div>
            ) : null}
          </div>

          <VideoResultsGrid
            historyQuery={historyQuery}
            historyModel={historyModel}
            modelOptions={modelOptions}
            loading={loading}
            pagedResults={pagedResults}
            filteredResultCount={filteredResults.length}
            videoPageSize={VIDEO_PAGE_SIZE}
            currentPage={currentPage}
            totalPages={totalPages}
            derivedVideoMetadata={derivedVideoMetadata}
            draggingItemId={draggingItem?.id || null}
            onHistoryQueryChange={setHistoryQuery}
            onHistoryModelChange={setHistoryModel}
            onRefresh={() => void loadData()}
            onPageChange={setPage}
            onResultDragStart={handleResultDragStart}
            onResultDragEnd={handleResultDragEnd}
            onPreview={setPreviewItem}
            onAssetSync={openAssetSync}
            onDelete={handleDeleteVideo}
            taskHistory={
              <VideoTaskHistory
                recentTasks={recentTasks}
                syncDragActive={syncDragActive}
                syncingAsset={syncingAsset}
                syncNotice={syncNotice}
                onSyncDragOver={handleSyncDragOver}
                onSyncDragLeave={handleSyncDragLeave}
                onSyncDrop={handleSyncDrop}
                onRequestClearTasks={() => setConfirmClearTasksOpen(true)}
                onDismissTask={handleDismissTask}
              />
            }
          />
        </div>
      </section>

      {previewItem ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold">结果预览</h3>
                <p className="text-xs text-muted-foreground">{previewItem.taskId || previewItem.id}</p>
              </div>
              <button
                onClick={() => setPreviewItem(null)}
                className="rounded-md p-2 transition-colors hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-6 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="overflow-hidden rounded-xl border border-border bg-black">
                {previewVideoUrl ? (
                  <video
                    src={previewVideoUrl || undefined}
                    poster={derivedResultCover(previewItem, previewVideoMetadata) || undefined}
                    controls
                    className="h-full w-full"
                  />
                ) : (
                  <GeneratedMediaPlaceholder
                    kind="video"
                    className="h-full min-h-[360px] w-full bg-black text-zinc-300"
                    description="当前结果还没有生成真实视频"
                  />
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">提示词</div>
                  <p className="text-sm leading-6">{previewItem.prompt}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">模型</div>
                    <div className="mt-1 font-medium">{formatVideoResultModelDisplay(previewItem.model)}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">时长</div>
                    <div className="mt-1 font-medium">{displayedDuration(previewItem, previewVideoMetadata)}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">比例</div>
                    <div className="mt-1 font-medium">{displayedAspectRatio(previewItem, previewVideoMetadata)}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">清晰度</div>
                    <div className="mt-1 font-medium">{displayedResolution(previewItem)}</div>
                  </div>
                </div>
                {previewItem.duration !== displayedDuration(previewItem, previewVideoMetadata) ? (
                  <div className="rounded-lg border border-border p-3 text-xs">
                    <div className="text-muted-foreground">请求时长</div>
                    <div className="mt-1 font-medium">{previewItem.duration}</div>
                  </div>
                ) : null}
                {previewItem.aspectRatio !== displayedAspectRatio(previewItem, previewVideoMetadata) ? (
                  <div className="rounded-lg border border-border p-3 text-xs">
                    <div className="text-muted-foreground">请求比例</div>
                    <div className="mt-1 font-medium">{previewItem.aspectRatio}</div>
                  </div>
                ) : null}
                {previewItem.requestedResolution &&
                previewItem.requestedResolution !== displayedResolution(previewItem) ? (
                  <div className="rounded-lg border border-border p-3 text-xs">
                    <div className="text-muted-foreground">请求清晰度</div>
                    <div className="mt-1 font-medium">{previewItem.requestedResolution}</div>
                  </div>
                ) : null}
                {previewItem.firstFrameUrl || previewItem.lastFrameUrl ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">首尾帧</div>
                    <div className="grid grid-cols-2 gap-2">
                      {previewItem.firstFrameUrl ? (
                        <img
                          src={resultReferenceUrl(previewItem.firstFrameUrl) || undefined}
                          alt="首帧"
                          className="w-full rounded-lg border border-border object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : null}
                      {previewItem.lastFrameUrl ? (
                        <img
                          src={resultReferenceUrl(previewItem.lastFrameUrl) || undefined}
                          alt="尾帧"
                          className="w-full rounded-lg border border-border object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : null}
                    </div>
                  </div>
                ) : hasMultiReferenceImages(previewItem) ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">多参参考</div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {MULTI_REF_ORDER.map((key) => {
                        const u = resultMultiReferenceUrl(previewItem, key);
                        if (!u) return null;
                        return (
                          <div key={key} className="space-y-1">
                            <img
                              src={u}
                              alt={MULTI_REF_LABELS[key]}
                              className="aspect-video w-full rounded-lg border border-border object-cover"
                              referrerPolicy="no-referrer"
                            />
                            <div className="text-[10px] text-muted-foreground">{MULTI_REF_LABELS[key]}</div>
                          </div>
                        );
                      })}
                    </div>
                    {previewItem.resolvedReferenceImageUrl ? (
                      <div className="space-y-2">
                        <div className="text-xs text-muted-foreground">主参考图</div>
                        <img
                          src={resultReferenceUrl(previewItem.resolvedReferenceImageUrl) || undefined}
                          alt="主参考图"
                          className="w-full rounded-lg border border-border object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    ) : null}
                  </div>
                ) : previewItem.referenceImageUrl ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">参考图</div>
                    <img
                      src={resultReferenceUrl(previewItem.referenceImageUrl) || undefined}
                      alt="reference"
                      className="w-full rounded-lg border border-border object-cover"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                ) : null}
                {!previewVideoUrl ? (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-100">
                    {videoPreviewReason(previewItem)}
                  </div>
                ) : null}
                {previewVideoUrl ? (
                  <button
                    type="button"
                    onClick={() =>
                      void downloadMediaFile(
                        previewVideoUrl,
                        guessMediaFilename(previewVideoUrl, previewItem.id, "video"),
                      )
                    }
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Download className="h-4 w-4" />
                    下载到本地
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {confirmClearTasksOpen ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl">
            <h3 className="text-base font-semibold">确认清空最近任务？</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              该操作会删除当前账号下的最近任务记录，且不可恢复。
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmClearTasksOpen(false)}
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleClearTasks()}
                className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground hover:bg-destructive/90"
              >
                确认清空
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {referencePreview ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold">参考图预览</h3>
                <p className="text-xs text-muted-foreground">{referencePreview.title}</p>
              </div>
              <button
                onClick={() => setReferencePreview(null)}
                className="rounded-md p-2 transition-colors hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex min-h-[360px] items-center justify-center overflow-auto bg-black p-4">
              <img
                src={getGeneratedMediaUrl(referencePreview.url) || undefined}
                alt={referencePreview.title}
                className="max-h-[80vh] max-w-full object-contain"
                referrerPolicy="no-referrer"
      />
    </div>
          </div>
        </div>
      ) : null}
      <AssetSyncDialog
        item={syncDraft}
        submitting={syncingAsset}
        onClose={() => setSyncDraft(null)}
        onSubmit={handleSyncSubmit}
      />
    </CreateStudioSplitLayout>
  );
}
