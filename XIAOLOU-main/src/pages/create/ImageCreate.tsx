import {
  Clock3,
  Download,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { type ChangeEvent, type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AssetSyncDialog,
  AssetSyncDropzone,
  type AssetSyncDraft,
} from "../../components/create/AssetSyncControls";
import { CreateStudioSplitLayout } from "../../components/create/CreateStudioSplitLayout";
import {
  REFERENCE_ASSET_MIME,
  ReferenceAssetPicker,
  type ReferenceAssetSelection,
} from "../../components/create/ReferenceAssetPicker";
import {
  GeneratedMediaPlaceholder,
  getGeneratedMediaUrl,
} from "../../components/media/GenerationPlaceholder";
import { downloadMediaFile, guessMediaFilename } from "../../lib/download-media";
import { parseGenerationError } from "../../lib/generation-error";
import {
  formatTaskStatusLabel,
  getTaskFailureReason,
  getTaskStatusPillClass,
} from "../../lib/task-status";
import { prepareReferenceUploadFile } from "../../lib/prepare-reference-upload";
import { useActorId } from "../../lib/actor-session";
import { cn } from "../../lib/utils";
import {
  createAsset,
  deleteTask,
  deleteCreateImage,
  generateCreateImages,
  getCreateImageCapabilities,
  listCreateImages,
  listTasks,
  newIdempotencyKey,
  uploadFile,
  type CreateImageResult,
  type MediaModelCapability,
  type Task,
} from "../../lib/api";
import { useCurrentProjectId } from "../../lib/session";

type ReferenceImageState = {
  id: string;
  url: string;
  originalName: string;
  source: "upload" | "asset";
  assetId?: string | null;
};

const MAX_REFERENCE_IMAGES = 4;
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;
const MIN_REFERENCE_IMAGE_DIMENSION = 240;
const MAX_REFERENCE_IMAGE_DIMENSION = 8000;
const CREATE_IMAGE_REFERENCE_ACCEPT =
  "image/jpeg,image/png,image/webp,image/bmp,image/x-ms-bmp,.jpg,.jpeg,.png,.webp,.bmp";
// Invalid legacy image model IDs are intentionally excluded from the picker.
// Vertex models use "vertex:" prefix as internalId; labels end with "+" per naming convention.
// Yunwu-routed models keep their original names (no "+" suffix).
const FALLBACK_IMAGE_MODELS = [
  "doubao-seedream-5-0-260128",
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
  "gemini-2.5-flash-image",
  "vertex:gemini-3-pro-image-preview",
  "vertex:gemini-3.1-flash-image-preview",
] as const;

const FALLBACK_IMAGE_MODEL_LABELS: Record<string, string> = {
  "doubao-seedream-5-0-260128": "Seedream 5.0 (文/图/多参考)",
  "gemini-3-pro-image-preview": "Gemini 3 Pro",
  "gemini-3.1-flash-image-preview": "Gemini 3.1 Flash",
  "gemini-2.5-flash-image": "Gemini 2.5 Flash",
  // Vertex AI official models — "+" suffix to distinguish from Yunwu-routed variants
  "vertex:gemini-3-pro-image-preview": "Gemini 3 Pro Image+",
  "vertex:gemini-3.1-flash-image-preview": "Gemini 3.1 Flash Image+",
};
const FALLBACK_IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;
const IMAGE_PAGE_SIZE = 9;
const IMAGE_RECENT_TASK_TYPES = new Set([
  "create_image_generate",
  "storyboard_image_generate",
  "asset_image_generate",
  "storyboard_grid25_generate",
  "character_replace",
  "upscale_restore",
]);

type CreateImageModel = string;
type CreateImageReferenceKind = "jpeg" | "png" | "webp" | "bmp" | "gif";

function isImageRecentTask(task: Task) {
  return IMAGE_RECENT_TASK_TYPES.has(task.type);
}

type LocalReferenceImageMetadata = {
  kind: CreateImageReferenceKind;
  width: number;
  height: number;
  hasTransparencyChannel: boolean;
};

function ChoiceRadioGroup({
  name,
  value,
  options,
  onChange,
  columnsClassName = "grid-cols-3",
}: {
  name: string;
  value: string;
  options: readonly string[];
  onChange: (nextValue: string) => void;
  columnsClassName?: string;
}) {
  return (
    <div className={cn("grid gap-2", columnsClassName)} role="radiogroup" aria-label={name}>
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          onClick={() => onChange(option)}
          className={cn(
            "flex cursor-pointer items-center justify-center rounded-md border py-2 text-xs font-medium transition-colors",
            "border-border hover:border-primary/50",
            value === option ? "border-primary bg-primary/10 text-primary" : "",
            "focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary/50",
          )}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

function fileExtension(name: string) {
  const match = /\.([^.]+)$/.exec(name);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function detectCreateImageReferenceKind(
  file: File,
  bytes: Uint8Array,
): CreateImageReferenceKind | null {
  const normalizedType = file.type.toLowerCase();
  if (normalizedType.includes("jpeg")) return "jpeg";
  if (normalizedType.includes("png")) return "png";
  if (normalizedType.includes("webp")) return "webp";
  if (normalizedType.includes("bmp")) return "bmp";
  if (normalizedType.includes("gif")) return "gif";

  const extension = fileExtension(file.name);
  if (extension === ".jpg" || extension === ".jpeg") return "jpeg";
  if (extension === ".png") return "png";
  if (extension === ".webp") return "webp";
  if (extension === ".bmp") return "bmp";
  if (extension === ".gif") return "gif";

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
  if (
    bytes.length >= 6 &&
    (String.fromCharCode(...bytes.slice(0, 6)) === "GIF87a" ||
      String.fromCharCode(...bytes.slice(0, 6)) === "GIF89a")
  ) {
    return "gif";
  }
  if (bytes.length >= 2 && String.fromCharCode(bytes[0], bytes[1]) === "BM") return "bmp";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

function readUInt24LE(bytes: Uint8Array, offset: number) {
  if (offset + 3 > bytes.length) return null;
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function parsePngMetadata(bytes: Uint8Array): LocalReferenceImageMetadata | null {
  if (bytes.length < 33) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const colorType = bytes[25];
  let hasTransparencyChannel = colorType === 4 || colorType === 6;
  let offset = 8;

  while (offset + 12 <= bytes.length) {
    const chunkLength = view.getUint32(offset);
    const chunkType = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const nextOffset = offset + 12 + chunkLength;
    if (nextOffset > bytes.length) break;
    if (chunkType === "tRNS") {
      hasTransparencyChannel = true;
      break;
    }
    if (chunkType === "IEND") break;
    offset = nextOffset;
  }

  return { kind: "png", width, height, hasTransparencyChannel };
}

function parseJpegMetadata(bytes: Uint8Array): LocalReferenceImageMetadata | null {
  if (bytes.length < 4) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  while (offset + 3 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xd8 || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker >= 0xd0 && marker <= 0xd9) {
      offset += 2;
      continue;
    }
    if (offset + 4 > bytes.length) break;
    const segmentLength = view.getUint16(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > bytes.length) break;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (offset + 9 > bytes.length) break;
      return {
        kind: "jpeg",
        width: view.getUint16(offset + 7),
        height: view.getUint16(offset + 5),
        hasTransparencyChannel: false,
      };
    }
    offset += 2 + segmentLength;
  }

  return null;
}

function parseWebpMetadata(bytes: Uint8Array): LocalReferenceImageMetadata | null {
  if (bytes.length < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunkType = String.fromCharCode(...bytes.slice(12, 16));

  if (chunkType === "VP8X") {
    const widthMinusOne = readUInt24LE(bytes, 24);
    const heightMinusOne = readUInt24LE(bytes, 27);
    if (widthMinusOne == null || heightMinusOne == null) return null;
    return {
      kind: "webp",
      width: widthMinusOne + 1,
      height: heightMinusOne + 1,
      hasTransparencyChannel: false,
    };
  }

  if (chunkType === "VP8L") {
    if (bytes[20] !== 0x2f || bytes.length < 25) return null;
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    return {
      kind: "webp",
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      hasTransparencyChannel: false,
    };
  }

  if (chunkType === "VP8 ") {
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return {
      kind: "webp",
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
      hasTransparencyChannel: false,
    };
  }

  return null;
}

function parseBmpMetadata(bytes: Uint8Array): LocalReferenceImageMetadata | null {
  if (bytes.length < 26) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dibHeaderSize = view.getUint32(14, true);
  if (dibHeaderSize === 12) {
    return {
      kind: "bmp",
      width: view.getUint16(18, true),
      height: view.getUint16(20, true),
      hasTransparencyChannel: false,
    };
  }
  return {
    kind: "bmp",
    width: Math.abs(view.getInt32(18, true)),
    height: Math.abs(view.getInt32(22, true)),
    hasTransparencyChannel: false,
  };
}

function readLocalReferenceImageMetadata(
  file: File,
  bytes: Uint8Array,
): LocalReferenceImageMetadata | null {
  const kind = detectCreateImageReferenceKind(file, bytes);
  if (!kind) return null;
  if (kind === "png") return parsePngMetadata(bytes);
  if (kind === "jpeg") return parseJpegMetadata(bytes);
  if (kind === "webp") return parseWebpMetadata(bytes);
  if (kind === "bmp") return parseBmpMetadata(bytes);
  if (kind === "gif") return { kind, width: 1, height: 1, hasTransparencyChannel: false };
  return null;
}

async function validateCreateImageReferenceFile(file: File) {
  if (file.size > MAX_REFERENCE_IMAGE_BYTES) {
    return `${file.name} 超过 10MB，请压缩后再上传。`;
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detectCreateImageReferenceKind(file, bytes);
  if (kind === "gif") {
    return `${file.name} 是 GIF 格式，当前仅支持 JPG/JPEG、PNG（不支持透明通道）、WEBP、BMP。`;
  }

  const metadata = readLocalReferenceImageMetadata(file, bytes);
  if (!metadata) {
    return `${file.name} 不是受支持的参考图格式，请上传 JPG/JPEG、PNG、WEBP 或 BMP。`;
  }

  if (metadata.kind === "png" && metadata.hasTransparencyChannel) {
    return `${file.name} 是带透明通道的 PNG，当前参考图模式不建议透明 PNG，请先去除透明背景。`;
  }

  if (
    metadata.width < MIN_REFERENCE_IMAGE_DIMENSION ||
    metadata.width > MAX_REFERENCE_IMAGE_DIMENSION ||
    metadata.height < MIN_REFERENCE_IMAGE_DIMENSION ||
    metadata.height > MAX_REFERENCE_IMAGE_DIMENSION
  ) {
    return `${file.name} 的尺寸为 ${metadata.width}x${metadata.height}，宽高都需要在 240 到 8000 像素之间。`;
  }

  return null;
}

function resolveEffectiveImageModel(referenceCount: number): string {
  void referenceCount;
  return "doubao-seedream-5-0-260128";
}

function imageModelHint(referenceCount: number) {
  if (referenceCount > 1) {
    return "已上传多张参考图，推荐使用 Seedream 5.0 进行多参考融合生成。";
  }
  if (referenceCount === 1) {
    return "已上传 1 张参考图，推荐使用 Seedream 5.0 进行图生图。";
  }
  return "推荐使用 Seedream 5.0（火山引擎豆包）进行文生图，支持图生图与多参考生图。";
}

function resultImage(item: CreateImageResult) {
  return getGeneratedMediaUrl(item.imageUrl);
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function taskReferenceImages(task: Task) {
  const list = Array.isArray(task.metadata?.referenceImageUrls)
    ? task.metadata.referenceImageUrls.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0,
      )
    : [];
  if (list.length) return list.slice(0, MAX_REFERENCE_IMAGES);
  const value = task.metadata?.referenceImageUrl;
  return typeof value === "string" && value.trim() ? [value] : [];
}

function taskReference(task: Task) {
  return getGeneratedMediaUrl(taskReferenceImages(task)[0]) || null;
}

function taskModel(task: Task) {
  const value = task.metadata?.model ?? task.metadata?.imageModel;
  return typeof value === "string" && value.trim() ? value : null;
}

function resultReferenceImages(item: CreateImageResult) {
  const list = Array.isArray(item.referenceImageUrls)
    ? item.referenceImageUrls.filter(
        (value): value is string => typeof value === "string" && value.trim().length > 0,
      )
    : [];
  if (list.length) {
    return list
      .slice(0, MAX_REFERENCE_IMAGES)
      .map((url) => getGeneratedMediaUrl(url))
      .filter((url): url is string => Boolean(url));
  }
  const fallback = getGeneratedMediaUrl(item.referenceImageUrl);
  return fallback ? [fallback] : [];
}

function mergeReferenceImages(
  current: ReferenceImageState[],
  incoming: ReferenceImageState[],
) {
  const merged = [...current];

  for (const next of incoming) {
    const duplicateIndex = merged.findIndex(
      (item) => item.url === next.url || (next.assetId && item.assetId === next.assetId),
    );
    if (duplicateIndex >= 0) {
      merged.splice(duplicateIndex, 1);
    }
    merged.push(next);
  }

  return merged.slice(-MAX_REFERENCE_IMAGES);
}

function summarizePrompt(value: string, fallback: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return fallback;
  return normalized.length > 18 ? `${normalized.slice(0, 18)}...` : normalized;
}

function buildImageAssetDraft(item: CreateImageResult): AssetSyncDraft {
  const imageUrl = resultImage(item);

  return {
    id: item.id,
    mediaKind: "image",
    previewUrl: imageUrl,
    mediaUrl: imageUrl,
    prompt: item.prompt,
    model: item.model,
    aspectRatio: item.aspectRatio,
    taskId: item.taskId ?? null,
    referenceImageUrl: item.referenceImageUrl ?? null,
    defaultAssetType: "style",
    sourceModule: "image_create",
    defaultName: summarizePrompt(item.prompt, `图片素材 ${formatTime(item.createdAt)}`),
    defaultDescription: [
      item.prompt,
      `来源：图片创作`,
      `模型：${item.model}`,
      `风格：${item.style}`,
      `比例：${item.aspectRatio}`,
      `清晰度：${item.resolution}`,
    ].join("\n"),
  };
}

const STYLE_OPTIONS = ["电影感", "赛博朋克", "古风写意", "写实摄影"];

export default function ImageCreate() {
  const actorId = useActorId();
  const [currentProjectId] = useCurrentProjectId();
  const [prompt, setPrompt] = useState("");
  const [negativePrompt, setNegativePrompt] = useState("");
  const [model, setModel] = useState<CreateImageModel>("doubao-seedream-5-0-260128");
  const [style, setStyle] = useState("电影感");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("2K");
  const [imageCount, setImageCount] = useState(1);
  const [imageCapabilities, setImageCapabilities] = useState<MediaModelCapability[]>([]);
  const [capsLoading, setCapsLoading] = useState(true);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyModel, setHistoryModel] = useState("all");
  const [referenceImages, setReferenceImages] = useState<ReferenceImageState[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [results, setResults] = useState<CreateImageResult[]>([]);
  const [page, setPage] = useState(1);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [previewItem, setPreviewItem] = useState<CreateImageResult | null>(null);
  const [referencePreview, setReferencePreview] = useState<{ url: string; title: string } | null>(null);
  const draggingRef = useRef<AssetSyncDraft | null>(null);
  // Synchronous guard against rapid double-clicks of the generate button.
  // React's `generating` state only propagates after a re-render, so two
  // clicks fired within a single frame can both enter handleGenerate before
  // the button becomes disabled. This ref closes that window.
  const generatingRef = useRef(false);
  const [draggingItem, setDraggingItem] = useState<AssetSyncDraft | null>(null);
  const [syncDraft, setSyncDraft] = useState<AssetSyncDraft | null>(null);
  const [syncingAsset, setSyncingAsset] = useState(false);
  const [syncDragActive, setSyncDragActive] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [referenceDropActive, setReferenceDropActive] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [confirmClearTasksOpen, setConfirmClearTasksOpen] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [imageResponse, taskResponse] = await Promise.all([
        listCreateImages(),
        listTasks(),
      ]);
      setResults(imageResponse.items);
      // 只保留最近的部分任务，避免前端长列表拖慢渲染
      setTasks(taskResponse.items.filter(isImageRecentTask).slice(0, 100));
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
    let cancelled = false;
    async function loadCaps() {
      setCapsLoading(true);
      try {
        const resp = await getCreateImageCapabilities();
        if (!cancelled && resp.items?.length > 0) {
          setImageCapabilities(resp.items);
        }
      } catch (err) {
        console.warn("[ImageCreate] Failed to load capabilities, using fallback:", err);
      } finally {
        if (!cancelled) setCapsLoading(false);
      }
    }
    loadCaps();
    return () => { cancelled = true; };
  }, []);

  const capModelList = useMemo(() => {
    if (imageCapabilities.length > 0) {
      return imageCapabilities.map((cap) => ({
        id: cap.id,
        label: cap.label,
        resolutions: cap.inputModes?.text_to_image?.supportedResolutions
          ?? cap.inputModes?.image_to_image?.supportedResolutions
          ?? [],
        aspectRatios: cap.inputModes?.text_to_image?.supportedAspectRatios
          ?? cap.inputModes?.image_to_image?.supportedAspectRatios
          ?? [],
        recommended: cap.recommended,
      }));
    }
    return FALLBACK_IMAGE_MODELS.map((id) => ({
      id,
      label: FALLBACK_IMAGE_MODEL_LABELS[id] ?? id,
      resolutions: [...FALLBACK_IMAGE_RESOLUTIONS],
      aspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
      recommended: id === "doubao-seedream-5-0-260128",
    }));
  }, [imageCapabilities]);

  const currentCapModel = capModelList.find((m) => m.id === model) ?? capModelList[0];
  const currentAspectRatios = currentCapModel?.aspectRatios ?? ["16:9", "1:1", "9:16"];
  const currentResolutions = currentCapModel?.resolutions ?? [...FALLBACK_IMAGE_RESOLUTIONS];

  useEffect(() => {
    if (currentAspectRatios.length > 0 && !currentAspectRatios.includes(aspectRatio)) {
      setAspectRatio(currentAspectRatios[0]);
    }
  }, [model, currentAspectRatios, aspectRatio]);

  useEffect(() => {
    if (currentResolutions.length > 0 && !currentResolutions.includes(resolution)) {
      setResolution(currentResolutions[0]);
    }
  }, [model, currentResolutions, resolution]);

  const filteredResults = useMemo(() => {
    return results.filter((item) => {
      const matchQuery =
        !historyQuery ||
        item.prompt.includes(historyQuery) ||
        item.style.includes(historyQuery) ||
        item.taskId?.includes(historyQuery);
      const matchModel = historyModel === "all" || item.model === historyModel;
      return matchQuery && matchModel;
    });
  }, [historyModel, historyQuery, results]);

  const totalPages = Math.max(1, Math.ceil(filteredResults.length / IMAGE_PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const pagedResults = useMemo(() => {
    const startIndex = (currentPage - 1) * IMAGE_PAGE_SIZE;
    return filteredResults.slice(startIndex, startIndex + IMAGE_PAGE_SIZE);
  }, [filteredResults, currentPage]);

  useEffect(() => {
    // 搜索条件或模型筛选变化时自动回到第一页
    setPage(1);
  }, [historyModel, historyQuery]);

  const modelOptions = useMemo(
    () => ["all", ...Array.from(new Set(results.map((item) => item.model)))],
    [results],
  );

  const recentTasks = useMemo(() => tasks.slice(0, 6), [tasks]);
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

  useEffect(() => {
    if (!syncNotice) return;

    const timer = window.setTimeout(() => {
      setSyncNotice(null);
    }, 3200);

    return () => window.clearTimeout(timer);
  }, [syncNotice]);

  const recommendedModel = useMemo(
    () => resolveEffectiveImageModel(referenceImages.length),
    [referenceImages.length],
  );

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    if (generatingRef.current) return;
    generatingRef.current = true;

    setGenerating(true);
    setGenerateError(null);
    try {
      const referenceImageUrls = referenceImages.map((item) => item.url);
      await generateCreateImages({
        projectId: currentProjectId,
        prompt,
        negativePrompt,
        model,
        style,
        aspectRatio,
        resolution,
        count: imageCount,
        referenceImageUrl: referenceImageUrls[0],
        referenceImageUrls,
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

  const handleDeleteImage = async (id: string) => {
    try {
      await deleteCreateImage(id);
      setResults((prev) => prev.filter((item) => item.id !== id));
      if (previewItem?.id === id) setPreviewItem(null);
    } catch {
      window.alert("删除失败，请稍后重试。");
    }
  };

  const handleReferenceUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    if (referenceImages.length >= MAX_REFERENCE_IMAGES) {
      window.alert("参考图最多支持 4 张，请先删除一张再上传新的。");
      event.target.value = "";
      return;
    }
    const files = Array.from<File>(event.currentTarget.files ?? []);
    if (!files.length) {
      event.target.value = "";
      return;
    }
    const remainingSlots = MAX_REFERENCE_IMAGES - referenceImages.length;
    const validFiles: File[] = [];
    const validationMessages: string[] = [];
    let convertedPngCount = 0;

    setGenerateError(null);
    for (const file of files) {
      try {
        const prepared = await prepareReferenceUploadFile(file);
        if (prepared.convertedFromPng) {
          convertedPngCount += 1;
        }
        const validationMessage = await validateCreateImageReferenceFile(prepared.file);
        if (validationMessage) {
          validationMessages.push(validationMessage);
          continue;
        }
        validFiles.push(prepared.file);
      } catch (error) {
        validationMessages.push(
          error instanceof Error ? error.message : `${file.name} failed to prepare for upload.`,
        );
      }
    }

    const nextFiles = validFiles.slice(0, remainingSlots);
    const notices = [...validationMessages];
    if (convertedPngCount > 0) {
      notices.push(`Converted ${convertedPngCount} PNG reference image(s) to JPG before upload.`);
    }
    /*
    if (convertedPngCount > 0) {
      notices.push(`宸茶嚜鍔ㄥ皢 ${convertedPngCount} 寮?PNG 鍙傝€冨浘杞崲涓?JPG 鍚庝笂浼犮€?);
    }
    */
    if (validFiles.length > nextFiles.length) {
      notices.push("最多只会保留 4 张参考图，多出的文件已忽略。");
    }
    if (notices.length) {
      setGenerateError(notices[0]);
      window.alert(notices.join("\n"));
    }
    if (!nextFiles.length) {
      event.target.value = "";
      return;
    }

    setUploading(true);
    try {
      const uploadedItems = await Promise.all(
        nextFiles.map(async (file) => {
          const uploaded = await uploadFile(file, "create-image-reference");
          return {
            id: uploaded.id,
            url: uploaded.url,
            originalName: uploaded.originalName,
            source: "upload" as const,
          };
        }),
      );
      setReferenceImages((current) => mergeReferenceImages(current, uploadedItems));
    } catch (error) {
      const message = error instanceof Error ? error.message : "参考图上传失败，请稍后重试。";
      setGenerateError(message);
      window.alert(message);
    } finally {
      setUploading(false);
      event.target.value = "";
    }
  };

  const applyReferenceAsset = (asset: ReferenceAssetSelection) => {
    setReferenceImages((current) =>
      mergeReferenceImages(current, [
        {
          id: asset.id,
          url: asset.url,
          originalName: asset.name,
          source: "asset",
          assetId: asset.id,
        },
      ]),
    );
    setReferenceDropActive(false);
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

  const openAssetSync = (item: CreateImageResult) => {
    setSyncDraft(buildImageAssetDraft(item));
    setSyncDragActive(false);
    setDraggingItem(null);
  };

  const handleResultDragStart = (event: DragEvent<HTMLElement>, item: CreateImageResult) => {
    const draft = buildImageAssetDraft(item);
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
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
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
      const asset = await createAsset(currentProjectId, input);
      setSyncNotice(`已同步到资产库：${asset.name}`);
      setSyncDraft(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Asset sync failed. Please try again.";
      setSyncNotice(message);
      window.alert(message);
    } finally {
      setSyncingAsset(false);
    }
  };

  const handleDismissTask = async (id: string) => {
    await deleteTask(id);
    setTasks((current) => current.filter((task) => task.id !== id));
  };

  const handleClearTasks = async () => {
    await Promise.all(tasks.map((task) => deleteTask(task.id)));
    setTasks([]);
    setConfirmClearTasksOpen(false);
  };

  const previewReferences = previewItem ? resultReferenceImages(previewItem) : [];

  return (
    <>
      <CreateStudioSplitLayout
        pageKey="image-create"
        sidebar={
          <>
            <div className="shrink-0 border-b border-border p-4">
              <h2 className="flex items-center gap-2 font-medium">
                <Settings2 className="h-4 w-4 text-primary" />
                生成参数
              </h2>
            </div>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overflow-x-hidden overscroll-y-contain p-4 custom-scrollbar">
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
                accept={CREATE_IMAGE_REFERENCE_ACCEPT}
                multiple
                className="hidden"
                onChange={(event) => void handleReferenceUpload(event)}
              />
            </label>
            {referenceImages.length ? (
              <div className="grid grid-cols-2 gap-2">
                {referenceImages.map((item, index) => (
                  <div
                    key={`${item.id}_${index}`}
                    className="overflow-hidden rounded-lg border border-border bg-muted/20"
                  >
                    <div className="relative">
                      <img
                        src={getGeneratedMediaUrl(item.url) || undefined}
                        alt={item.originalName}
                        className="aspect-video w-full cursor-zoom-in object-cover"
                        referrerPolicy="no-referrer"
                        onDoubleClick={() =>
                          setReferencePreview({
                            url: getGeneratedMediaUrl(item.url) || item.url,
                            title: item.originalName || `参考图 ${index + 1}`,
                          })
                        }
                        title="双击放大查看原图"
                      />
                      <div className="absolute left-2 top-2 flex items-center gap-2">
                        {index === 0 ? (
                          <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
                            主参考
                          </span>
                        ) : null}
                        <span className="rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white">
                          {index + 1}/4
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setReferenceImages((current) => current.filter((_, itemIndex) => itemIndex !== index))
                        }
                        className="absolute right-2 top-2 rounded-full bg-black/55 p-1 text-white transition-colors hover:bg-destructive hover:text-destructive-foreground"
                        title="移除该参考图"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-2 border-t border-border bg-background/80 px-3 py-2 text-[11px] text-muted-foreground">
                      <span className="truncate">{item.originalName}</span>
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                        {item.source === "asset" ? "资产库" : "本地上传"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {false && referenceImages.length ? (
              <div className="space-y-2">
                <div className="overflow-hidden rounded-lg border border-border bg-muted/20">
                  <img
                    src={getGeneratedMediaUrl(referenceImages[0]?.url) || undefined}
                    alt={referenceImages[0]?.originalName}
                    className="aspect-video w-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                  <div className="flex items-center justify-between border-t border-border bg-background/80 px-3 py-2 text-[11px] text-muted-foreground">
                    <span className="truncate">{referenceImages[0]?.originalName}</span>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                      {referenceImages[0]?.source === "asset" ? "资产库" : "本地上传"}
                    </span>
                  </div>
                </div>
                {referenceImages.length > 1 ? (
                  <div className="flex flex-wrap gap-2">
                    {referenceImages.slice(1).map((item, index) => (
                      <div
                        key={`${item.id}_${index}`}
                        className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-1.5"
                      >
                        <img
                          src={getGeneratedMediaUrl(item.url) || undefined}
                          alt={item.originalName}
                          className="h-10 w-10 rounded object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                          <span className="max-w-[6rem] truncate">{item.originalName}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setReferenceImages((current) =>
                                current.filter((_, i) => i !== index + 1),
                              )
                            }
                            className="rounded p-0.5 hover:bg-destructive/10 hover:text-destructive"
                            title="移除该参考图"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            <p className="text-[11px] leading-5 text-muted-foreground">
              你可以上传本地参考图，也可以直接从下方资产库挑选素材作为参考。最多支持 4 张参考图，会结合这些参考图与提示词一起生成画面。
            </p>
            <p className="text-[11px] leading-5 text-primary/80">
              支持点击缩略图快速引用，也支持把素材卡拖到这个区域。
            </p>
          </div>

          <ReferenceAssetPicker
            projectId={currentProjectId}
            selectedAssetId={
              referenceImages[referenceImages.length - 1]?.source === "asset"
                ? referenceImages[referenceImages.length - 1]?.assetId || null
                : null
            }
            onSelect={applyReferenceAsset}
          />

          <div className="space-y-2">
            <label className="text-sm font-medium">模型</label>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {capModelList.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] leading-5 text-muted-foreground">
              {imageModelHint(referenceImages.length)} 推荐模型：{recommendedModel}（可手动切换）
            </p>
            <p className="text-[11px] leading-5 text-muted-foreground/80">
              参考图仅支持 JPG/JPEG、PNG（不支持透明通道）、WEBP、BMP，单张不超过 10MB，宽高需在 240 到 8000 像素之间。
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">负面提示词</label>
            <textarea
              value={negativePrompt}
              onChange={(event) => setNegativePrompt(event.target.value)}
              rows={3}
              placeholder="例如：模糊、低质量、畸形手部、重复主体"
              className="w-full resize-none rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">风格</label>
            <select
              value={style}
              onChange={(event) => setStyle(event.target.value)}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            >
              {STYLE_OPTIONS.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">画幅比例</label>
            <div className="grid grid-cols-3 gap-2">
              {currentAspectRatios.map((ratio) => (
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
          </div>

          {currentResolutions.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-medium">清晰度</label>
            <ChoiceRadioGroup
              name="create-image-resolution"
              value={resolution}
              options={currentResolutions}
              onChange={setResolution}
            />
          </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">生成张数</label>
            <div className="flex items-center gap-4">
              <input
                type="range"
                min="1"
                max="4"
                value={imageCount}
                onChange={(event) => setImageCount(Number(event.target.value))}
                className="flex-1 accent-primary"
              />
              <span className="w-4 text-right text-sm font-medium">{imageCount}</span>
            </div>
          </div>
        </div>
          </>
        }
      >
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-16 shrink-0 items-center border-b border-border bg-card/30 px-6">
          <div>
            <h1 className="flex items-center gap-2 text-lg font-semibold">
              <ImageIcon className="h-5 w-5 text-primary" />
              图片创作
            </h1>
            <p className="text-xs text-muted-foreground">
              独立创作结果只做临时输出，可预览、下载，也可以同步到资产库。
            </p>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-y-contain p-6 custom-scrollbar">
          <div className="glass-panel flex flex-col gap-4 rounded-2xl p-4">
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              className="h-24 w-full resize-none bg-transparent text-sm leading-relaxed placeholder:text-muted-foreground/50 focus:outline-none"
              placeholder="输入一段话，描述你想生成的画面"
            />

            <div className="flex items-center justify-end gap-3 border-t border-border pt-3">
              <button
                onClick={() => {
                  setPrompt("");
                  setNegativePrompt("");
                }}
                className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                <Trash2 className="h-4 w-4" />
                清空提示词
              </button>
              {referenceImages.length ? (
                <button
                  onClick={() => setReferenceImages([])}
                  className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                >
                  <Upload className="h-4 w-4" />
                  清除参考图
                </button>
              ) : null}
              <button
                onClick={() => void handleGenerate()}
                disabled={generating || !prompt.trim()}
                className="flex items-center gap-2 rounded-md bg-primary px-6 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {generating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                开始生成
              </button>
            </div>
            {generateError ? (
              <div className="whitespace-pre-wrap rounded-xl border border-rose-600/40 bg-rose-500/15 px-4 py-3 text-xs leading-6 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                {generateError}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <h3 className="text-sm font-medium">生成结果</h3>
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <div className="relative w-full md:w-64">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={historyQuery}
                  onChange={(event) => setHistoryQuery(event.target.value)}
                  placeholder="搜索提示词、风格或任务 ID"
                  className="w-full rounded-lg border border-border bg-input py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
              <select
                value={historyModel}
                onChange={(event) => setHistoryModel(event.target.value)}
                className="rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              >
                {modelOptions.map((item) => (
                  <option key={item} value={item}>
                    {item === "all" ? "全部模型" : item}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void loadData()}
                className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                <RefreshCw className="h-4 w-4" />
                刷新
              </button>
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
            </div>
          </div>

          <div className="grid grid-cols-1 items-stretch gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid grid-cols-1 items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
              {pagedResults.map((item) => {
                const imageUrl = resultImage(item);
                const referencePreviewUrls = resultReferenceImages(item);

                return (
                  <article
                    key={item.id}
                    draggable
                    onDragStart={(event) => handleResultDragStart(event, item)}
                    onDragEnd={handleResultDragEnd}
                    className={cn(
                      "glass-panel group flex h-full min-h-0 flex-col overflow-hidden rounded-xl transition-transform",
                      draggingItem?.id === item.id ? "scale-[0.98] opacity-70" : "",
                    )}
                  >
                    <button
                      onClick={() => setPreviewItem(item)}
                      className="block aspect-video w-full shrink-0 overflow-hidden bg-muted text-left"
                    >
                      {imageUrl ? (
                        <img
                          src={imageUrl}
                          alt={item.prompt}
                          className="h-full w-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <GeneratedMediaPlaceholder
                          kind="image"
                          className="h-full w-full"
                          description="图片生成完成后会在这里显示"
                        />
                      )}
                    </button>

                    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
                      <p className="line-clamp-2 shrink-0 text-sm text-foreground">{item.prompt}</p>
                      <div className="flex shrink-0 flex-wrap gap-2 text-[11px] text-muted-foreground">
                        <span>{item.model}</span>
                        <span>{item.resolution}</span>
                        {item.taskId ? <span>{item.taskId}</span> : null}
                      </div>

                      <div className="flex min-h-0 flex-1 flex-col gap-3">
                        {referencePreviewUrls.length ? (
                          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 p-2">
                            <div className="flex -space-x-2">
                              {referencePreviewUrls.slice(0, 4).map((url, index) => (
                                <img
                                  key={`${item.id}_ref_${index}`}
                                  src={url}
                                  alt={`reference-${index + 1}`}
                                  className="h-10 w-10 rounded-md border border-background object-cover"
                                  referrerPolicy="no-referrer"
                                />
                              ))}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {referencePreviewUrls.length > 1
                                ? `多参考图生成 · ${referencePreviewUrls.length} 张`
                                : "带参考图生成"}
                            </span>
                          </div>
                        ) : null}
                      </div>

                      <div className="mt-auto flex shrink-0 items-center justify-between border-t border-border/50 pt-3">
                        <span className="text-[11px] text-muted-foreground">
                          {formatTime(item.createdAt)}
                        </span>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => openAssetSync(item)}
                            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                          >
                            同步资产
                          </button>
                          <button
                            onClick={() => setPreviewItem(item)}
                            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                          >
                            预览
                          </button>
                          {imageUrl ? (
                            <button
                              type="button"
                              onClick={() =>
                                void downloadMediaFile(
                                  imageUrl,
                                  guessMediaFilename(imageUrl, item.id, "image"),
                                )
                              }
                              className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                            >
                              <Download className="h-3.5 w-3.5" />
                              下载
                            </button>
                          ) : null}
                          <button
                            onClick={() => void handleDeleteImage(item.id)}
                            title="删除此结果"
                            className="rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
              {filteredResults.length > IMAGE_PAGE_SIZE ? (
                <div className="col-span-full mt-2 flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="flex h-8 items-center justify-center rounded border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    上一页
                  </button>
                  <div className="flex items-center gap-1">
                    {Array.from({ length: totalPages }, (_, index) => {
                      const pageNumber = index + 1;
                      return (
                        <button
                          key={pageNumber}
                          type="button"
                          onClick={() => setPage(pageNumber)}
                          className={cn(
                            "flex h-8 min-w-[2rem] items-center justify-center rounded border px-2 text-xs",
                            pageNumber === currentPage
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border text-muted-foreground hover:bg-accent",
                          )}
                        >
                          {pageNumber}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="flex h-8 items-center justify-center rounded border border-border px-3 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    下一页
                  </button>
                </div>
              ) : null}
            </div>

            <aside className="glass-panel rounded-2xl p-4">
              <AssetSyncDropzone
                dragActive={syncDragActive}
                syncing={syncingAsset}
                notice={syncNotice}
                onDragOver={handleSyncDragOver}
                onDragLeave={handleSyncDragLeave}
                onDrop={handleSyncDrop}
              />
              <div className="mb-4 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-medium">最近任务</h3>
                </div>
                {recentTasks.length ? (
                  <button
                    type="button"
                    onClick={() => setConfirmClearTasksOpen(true)}
                    className="rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                  >
                    清空
                  </button>
                ) : null}
              </div>
              <div className="space-y-3">
                {recentTasks.map((task) => {
                  const failureReason = getTaskFailureReason(task);
                  return (
                  <div
                    key={task.id}
                    className={cn(
                      "rounded-xl border p-3",
                      failureReason
                        ? "border-rose-500/30 bg-rose-500/5"
                        : "border-border bg-muted/20",
                    )}
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium">{task.id}</span>
                      <div className="flex items-center gap-1">
                        <span className={getTaskStatusPillClass(task)}>
                          {formatTaskStatusLabel(task)}
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleDismissTask(task.id)}
                          className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          title="从列表中移除此任务"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {task.inputSummary || "暂无任务描述"}
                    </p>
                    {failureReason ? (
                      <div className="mt-2 rounded-md border border-rose-600/40 bg-rose-500/15 p-2 text-[11px] leading-5 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
                        <div className="mb-0.5 font-semibold text-rose-800 dark:text-rose-300">失败原因</div>
                        <div className="whitespace-pre-wrap break-words">{failureReason}</div>
                      </div>
                    ) : null}
                    {taskModel(task) ? (
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        模型：{taskModel(task)}
                      </div>
                    ) : null}
                    {taskReferenceImages(task).length > 1 ? (
                      <div className="mt-2 text-[11px] text-muted-foreground">
                        参考图：{taskReferenceImages(task).length} 张
                      </div>
                    ) : null}
                    {taskReference(task) ? (
                      <div className="mt-2 flex items-center gap-2">
                        <img
                          src={taskReference(task) || undefined}
                          alt="reference"
                          className="h-8 w-8 rounded object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <span className="text-[11px] text-muted-foreground">已关联参考图</span>
                      </div>
                    ) : null}
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      {formatTime(task.createdAt)}
                    </div>
                  </div>
                  );
                })}
                {!recentTasks.length ? (
                  <div className="rounded-xl border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                    还没有生成任务
                  </div>
                ) : null}
              </div>
            </aside>
          </div>
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
                {resultImage(previewItem) ? (
                  <img
                    src={resultImage(previewItem) || undefined}
                    alt={previewItem.prompt}
                    className="h-full w-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <GeneratedMediaPlaceholder
                    kind="image"
                    className="h-full min-h-[360px] w-full bg-black text-zinc-300"
                    description="当前结果还没有生成真实图片"
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
                    <div className="mt-1 font-medium">{previewItem.model}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">清晰度</div>
                    <div className="mt-1 font-medium">{previewItem.resolution}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">比例</div>
                    <div className="mt-1 font-medium">{previewItem.aspectRatio}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">风格</div>
                    <div className="mt-1 font-medium">{previewItem.style}</div>
                  </div>
                </div>
                {previewReferences.length ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">{previewReferences.length} 张参考图</div>
                    {previewReferences.length > 1 ? (
                      <div className="grid grid-cols-2 gap-2">
                        {previewReferences.map((url, index) => (
                          <div
                            key={`${previewItem.id}_preview_ref_${index}`}
                            className="overflow-hidden rounded-lg border border-border bg-muted/20"
                          >
                            <img
                              src={url}
                              alt={`reference-${index + 1}`}
                              className="aspect-video w-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                            <div className="flex items-center justify-between px-3 py-2 text-[11px] text-muted-foreground">
                              <span>参考图 {index + 1}</span>
                              {index === 0 ? <span className="text-primary">主参考</span> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="text-xs text-muted-foreground">参考图</div>
                    {previewReferences[0] ? (
                      <img
                        src={previewReferences[0]}
                        alt="reference"
                        className="w-full rounded-lg border border-border object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : null}
                  </div>
                ) : null}
                {resultImage(previewItem) ? (
                  <button
                    type="button"
                    onClick={() => {
                      const url = resultImage(previewItem);
                      if (!url) return;
                      void downloadMediaFile(url, guessMediaFilename(url, previewItem.id, "image"));
                    }}
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
      </CreateStudioSplitLayout>

      <AssetSyncDialog
        item={syncDraft}
        submitting={syncingAsset}
        onClose={() => setSyncDraft(null)}
        onSubmit={handleSyncSubmit}
      />
    </>
  );
}
