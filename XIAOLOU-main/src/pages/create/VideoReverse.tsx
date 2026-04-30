import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Cpu,
  FolderOpen,
  Languages,
  Play,
  RefreshCw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";
import {
  reverseVideoPrompt,
  translateText,
  uploadFile,
  type QwenOmniModel,
} from "../../lib/api";
import { useCurrentProjectId } from "../../lib/session";
import {
  ReferenceAssetPicker,
  type ReferenceAssetSelection,
} from "../../components/create/ReferenceAssetPicker";

// ─── Qwen-Omni model options (must match core-api ALLOWED_QWEN_OMNI_MODELS) ──
type ModelOption = {
  id: QwenOmniModel;
  label: string;
  tagline: string;
  badge?: "default" | "quality" | "fallback";
};

const MODEL_OPTIONS: readonly ModelOption[] = [
  {
    id: "qwen3.5-omni-flash",
    label: "Qwen3.5-Omni-Flash",
    tagline: "速度/质量/价格均衡（推荐）",
    badge: "default",
  },
  {
    id: "qwen3.5-omni-plus",
    label: "Qwen3.5-Omni-Plus",
    tagline: "最高质量，推理更慢、费用更高",
    badge: "quality",
  },
  {
    id: "qwen-omni-turbo",
    label: "Qwen-Omni-Turbo",
    tagline: "旧版稳定款，账号无 3.5 权限时回退",
    badge: "fallback",
  },
] as const;

const DEFAULT_MODEL: QwenOmniModel = "qwen3.5-omni-flash";
const MODEL_STORAGE_KEY = "xiaolou.videoReverse.qwenModel";
const MAX_PREVIEW_DURATION_SECONDS = 10 * 60;
const MAX_LOCAL_MP4_BYTES = 1024 * 1024 * 1024;

function resolveModel(value: string | null | undefined): QwenOmniModel {
  const match = MODEL_OPTIONS.find((opt) => opt.id === value);
  return match ? match.id : DEFAULT_MODEL;
}

function labelOf(id: QwenOmniModel): string {
  return MODEL_OPTIONS.find((opt) => opt.id === id)?.label ?? id;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "-";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatFileSize(bytes: number) {
  if (!bytes || bytes <= 0) return "-";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function isMp4File(file: File) {
  return file.type === "video/mp4" || /\.mp4$/i.test(file.name);
}

function formatDurationLimit(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest > 0 ? `${minutes}分${rest}秒` : `${minutes}分钟`;
}

/** Detect if text is predominantly CJK */
function isChinese(text: string) {
  const cjk = text.match(/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/g);
  return (cjk?.length ?? 0) / text.length > 0.15;
}

/** Try to get FPS from the video track via captureStream API */
function extractFps(video: HTMLVideoElement): string {
  try {
    const captureStream = (
      video as HTMLVideoElement & { captureStream?: () => MediaStream }
    ).captureStream;
    if (typeof captureStream !== "function") return "-";
    const stream = captureStream.call(video);
    const tracks = stream.getVideoTracks();
    if (tracks.length === 0) return "-";
    const settings = tracks[0].getSettings();
    const fps = settings.frameRate;
    if (fps && fps > 0) {
      tracks.forEach((t) => t.stop());
      return `${Math.round(fps)} fps`;
    }
    tracks.forEach((t) => t.stop());
  } catch {
    /* not supported */
  }
  return "-";
}

// ─── component ───────────────────────────────────────────────────────────────

export default function VideoReverse() {
  const [currentProjectId] = useCurrentProjectId();

  // Video source state
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoPreviewError, setVideoPreviewError] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  // Asset picker
  const [showAssetPicker, setShowAssetPicker] = useState(false);

  // Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [isComplete, setIsComplete] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Metadata
  const [metadata, setMetadata] = useState({
    resolution: "-",
    fps: "-",
    duration: "-",
    fileSize: "-",
  });

  // Translation
  const [isTranslating, setIsTranslating] = useState(false);
  const [translated, setTranslated] = useState<string | null>(null);
  const [showTranslated, setShowTranslated] = useState(false);

  // Copy feedback
  const [copied, setCopied] = useState(false);

  // Qwen-Omni model selection (persisted per-browser). Initialised lazily from
  // localStorage so we never read the storage key on every re-render.
  const [selectedModel, setSelectedModel] = useState<QwenOmniModel>(() => {
    if (typeof window === "undefined") return DEFAULT_MODEL;
    try {
      return resolveModel(window.localStorage.getItem(MODEL_STORAGE_KEY));
    } catch {
      return DEFAULT_MODEL;
    }
  });
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoElRef = useRef<HTMLVideoElement>(null);
  const progressTimerRef = useRef<number | null>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const localPreviewUrlRef = useRef<string | null>(null);
  const uploadRequestIdRef = useRef(0);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current != null) window.clearInterval(progressTimerRef.current);
      if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
    };
  }, []);

  // Persist the model choice so it survives refresh/navigation.
  useEffect(() => {
    try {
      window.localStorage.setItem(MODEL_STORAGE_KEY, selectedModel);
    } catch {
      /* storage disabled — not fatal */
    }
  }, [selectedModel]);

  // Close the model dropdown on outside click / Escape.
  useEffect(() => {
    if (!modelMenuOpen) return;
    const onDown = (ev: MouseEvent) => {
      if (!modelMenuRef.current) return;
      if (!modelMenuRef.current.contains(ev.target as Node)) setModelMenuOpen(false);
    };
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setModelMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [modelMenuOpen]);

  // ── Progress helpers ──
  const startFakeProgress = () => {
    setProgress(1);
    setStatusText("正在提取：环境细节与光影分布...");
    if (progressTimerRef.current != null) window.clearInterval(progressTimerRef.current);
    progressTimerRef.current = window.setInterval(() => {
      setProgress((prev) => {
        if (prev >= 92) return prev;
        const next = prev + (prev < 30 ? 3 : prev < 60 ? 1.5 : 0.8);
        if (next >= 30 && prev < 30) setStatusText("正在分析：主体动作与镜头运动...");
        else if (next >= 60 && prev < 60) setStatusText("正在生成：语义描述与风格标签...");
        else if (next >= 85 && prev < 85) setStatusText("即将完成，整理输出...");
        return Math.min(92, next);
      });
    }, 650);
  };

  const stopFakeProgress = () => {
    if (progressTimerRef.current != null) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  };

  // ── Reset analysis/prompt state (does NOT touch uploadedUrl — callers manage it) ──
  const resetVideo = () => {
    setPrompt("");
    setTranslated(null);
    setShowTranslated(false);
    setIsComplete(false);
    setProgress(0);
    setStatusText("");
    setErrorText(null);
    setVideoPreviewError(null);
    setMetadata({ resolution: "-", fps: "-", duration: "-", fileSize: "-" });
  };

  const revokeLocalPreviewUrl = () => {
    if (!localPreviewUrlRef.current) return;
    URL.revokeObjectURL(localPreviewUrlRef.current);
    localPreviewUrlRef.current = null;
  };

  const uploadSelectedVideo = async (file: File, requestId: number) => {
    setIsUploading(true);
    try {
      const uploaded = await uploadFile(file, "video");
      if (uploadRequestIdRef.current === requestId) {
        setUploadedUrl(uploaded.url);
        setStatusText("视频上传完成，可以生成提示词。");
      }
    } catch (err) {
      if (uploadRequestIdRef.current === requestId) {
        setUploadedUrl(null);
        setErrorText(err instanceof Error ? err.message : "视频上传失败");
      }
    } finally {
      if (uploadRequestIdRef.current === requestId) {
        setIsUploading(false);
      }
    }
  };

  // ── Local file upload ──
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    uploadRequestIdRef.current += 1;
    revokeLocalPreviewUrl();
    resetVideo();
    setIsUploading(false);

    if (!isMp4File(file)) {
      setVideoFile(null);
      setVideoUrl(null);
      setUploadedUrl(null);
      setErrorText("请上传 MP4 视频文件。当前预览要求使用 .mp4 格式。");
      return;
    }

    if (file.size > MAX_LOCAL_MP4_BYTES) {
      setVideoFile(null);
      setVideoUrl(null);
      setUploadedUrl(null);
      setErrorText(`MP4 文件过大，当前最多支持 ${formatFileSize(MAX_LOCAL_MP4_BYTES)}。`);
      return;
    }

    setVideoFile(file);
    const blobUrl = URL.createObjectURL(file);
    localPreviewUrlRef.current = blobUrl;
    setVideoUrl(blobUrl);
    setShowAssetPicker(false);
    setUploadedUrl(null);
    setMetadata((m) => ({ ...m, fileSize: formatFileSize(file.size) }));
    setStatusText(`已加载本地 MP4，读取元数据后会自动上传（最长 ${formatDurationLimit(MAX_PREVIEW_DURATION_SECONDS)}）。`);
  };

  // ── Asset library selection ──
  const handleAssetSelect = (asset: ReferenceAssetSelection) => {
    uploadRequestIdRef.current += 1;
    resetVideo();
    setIsUploading(false);
    revokeLocalPreviewUrl();
    setVideoFile(null);
    setVideoUrl(asset.url);
    setUploadedUrl(asset.url);
    setShowAssetPicker(false);
  };

  // ── Read metadata from <video> element after it loads ──
  const handleVideoMetadata = () => {
    const el = videoElRef.current;
    if (!el) return;
    setVideoPreviewError(null);
    const w = el.videoWidth;
    const h = el.videoHeight;
    const dur = el.duration;
    const fps = extractFps(el);
    setMetadata((prev) => ({
      ...prev,
      resolution: w && h ? `${w} × ${h}` : "-",
      fps,
      duration: formatDuration(dur),
    }));

    if (Number.isFinite(dur) && dur > MAX_PREVIEW_DURATION_SECONDS + 0.5) {
      setUploadedUrl(null);
      setIsUploading(false);
      setStatusText("");
      setErrorText(`视频时长超过限制，当前最多支持预览 ${formatDurationLimit(MAX_PREVIEW_DURATION_SECONDS)} 的 MP4。`);
      return;
    }

    if (videoFile && videoUrl?.startsWith("blob:") && !uploadedUrl && !isUploading) {
      const requestId = uploadRequestIdRef.current;
      setStatusText("MP4 元数据读取完成，正在上传视频...");
      void uploadSelectedVideo(videoFile, requestId);
    }
  };

  const handleVideoError = () => {
    if (videoUrl?.startsWith("blob:")) {
      uploadRequestIdRef.current += 1;
      setUploadedUrl(null);
      setIsUploading(false);
      setVideoPreviewError("当前 MP4 编码无法在浏览器中预览。请使用 H.264 + AAC 编码的 MP4，最长 10 分钟。");
      return;
    }

    setVideoPreviewError("当前视频无法在浏览器中预览，但仍可用于反推。请确认视频地址可访问，或换一个视频重试。");
  };

  // ── Generate prompt ──
  const handleGenerate = async () => {
    if (!uploadedUrl) {
      setErrorText(isUploading ? "视频正在上传，请稍候..." : "请先上传或选择视频");
      return;
    }
    setIsAnalyzing(true);
    setIsComplete(false);
    setProgress(0);
    setPrompt("");
    setTranslated(null);
    setShowTranslated(false);
    setErrorText(null);
    startFakeProgress();

    try {
      const res = await reverseVideoPrompt(uploadedUrl, { model: selectedModel });
      stopFakeProgress();
      setProgress(100);
      setStatusText(`解析完成（${res.model || labelOf(selectedModel)}）`);
      setIsComplete(true);
      setPrompt(res.prompt);
    } catch (err) {
      stopFakeProgress();
      setProgress(0);
      setStatusText("");
      setErrorText(err instanceof Error ? err.message : "视频反推失败");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ── Translate ──
  const handleTranslate = async () => {
    if (!prompt || isTranslating) return;

    if (translated && !showTranslated) {
      setShowTranslated(true);
      return;
    }
    if (showTranslated) {
      setShowTranslated(false);
      return;
    }

    setIsTranslating(true);
    setErrorText(null);
    try {
      const targetLang = isChinese(prompt) ? "en" : "zh";
      const res = await translateText(prompt, targetLang);
      setTranslated(res.text);
      setShowTranslated(true);
      setStatusText(targetLang === "zh" ? "已翻译为中文" : "已翻译为英文");
      window.setTimeout(() => setStatusText((s) => (s.startsWith("已翻译") ? "" : s)), 1800);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : "翻译失败");
    } finally {
      setIsTranslating(false);
    }
  };

  // ── Copy ──
  const handleCopy = async () => {
    const text = showTranslated && translated ? translated : prompt;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setErrorText("复制失败，请手动选择文本");
    }
  };

  const displayText = showTranslated && translated ? translated : prompt;
  const noVideo = !uploadedUrl && !isUploading;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background px-4 py-3 text-foreground sm:px-5 sm:py-4">
      {/* Header — 与 /create/video-replace 统一视觉风格 */}
      <div className="mb-3 shrink-0">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <span className="text-primary">合成工具箱：</span>视频反推提示词
        </h1>
        <p className="mt-1.5 text-xs text-muted-foreground">
          上传或从资产库选择视频 → 选择视频理解模型 → 点击"生成提示词"，AI 将输出可直接复用的中文分镜描述。
        </p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:items-stretch lg:gap-5">
        {/* ── Left Column ── */}
        <div className="flex w-full shrink-0 flex-col gap-3 lg:w-[min(22rem,100%)] lg:max-w-sm">
          {/* Video Preview */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="group relative mb-4 aspect-video w-full overflow-hidden rounded-lg border border-border bg-muted/30">
              {videoUrl ? (
                <video
                  key={videoUrl}
                  ref={videoElRef}
                  src={videoUrl}
                  controls
                  preload="metadata"
                  onLoadedMetadata={handleVideoMetadata}
                  onError={handleVideoError}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <Play className="h-8 w-8 opacity-30" />
                  <span className="text-xs">暂无视频</span>
                </div>
              )}

              {isUploading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/70 backdrop-blur-sm">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-muted border-t-primary" />
                  <span className="text-[11px] font-medium text-foreground/80">视频上传中...</span>
                </div>
              )}
            </div>
            {videoPreviewError && (
              <div className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-300">
                {videoPreviewError}
              </div>
            )}

            {/* Progress Bar */}
            <div className="mb-4">
              <div className="mb-1.5 flex justify-between text-[11px] font-medium">
                <span className="text-muted-foreground">解析进度</span>
                <span className="text-blue-500">{Math.round(progress)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted/50">
                <div
                  className="h-full bg-blue-600 transition-all duration-300 ease-out"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="mt-2 min-h-[1rem] text-[11px] text-muted-foreground">{statusText}</div>
              {errorText && (
                <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-destructive">
                  {errorText}
                </div>
              )}
            </div>

            {/* Upload / Asset library buttons */}
            <input
              type="file"
              accept="video/mp4,.mp4"
              className="hidden"
              ref={fileInputRef}
              onChange={(e) => void handleFileChange(e)}
            />
            <div className="flex gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2.5 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/80"
              >
                <Upload className="h-3.5 w-3.5" />
                本地上传
              </button>
              <button
                onClick={() => setShowAssetPicker((v) => !v)}
                disabled={!currentProjectId}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-xs font-medium transition-colors",
                  showAssetPicker
                    ? "bg-primary/15 text-primary"
                    : "bg-accent text-accent-foreground hover:bg-accent/80",
                  !currentProjectId && "pointer-events-none opacity-40",
                )}
                title={currentProjectId ? "从资产库选择视频" : "请先在首页选择一个项目"}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                资产库
              </button>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
              本地预览支持 MP4，最长 {formatDurationLimit(MAX_PREVIEW_DURATION_SECONDS)}，
              单文件最大 {formatFileSize(MAX_LOCAL_MP4_BYTES)}。推荐 H.264 + AAC 编码。
            </p>

            {/* Asset Picker Dropdown */}
            {showAssetPicker && currentProjectId && (
              <div className="mt-3 rounded-xl border border-border bg-card p-4 shadow-2xl shadow-black/10">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs font-medium text-foreground">选择视频资产</span>
                  <button
                    onClick={() => setShowAssetPicker(false)}
                    className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <ReferenceAssetPicker
                  projectId={currentProjectId}
                  mediaKind="video"
                  hint="点击视频卡片即可加载到解析区"
                  onSelect={handleAssetSelect}
                />
              </div>
            )}
          </div>

          {/* Metadata Box */}
          <div className="rounded-xl border border-border bg-card p-4">
            <h3 className="mb-3 text-[11px] font-medium text-muted-foreground">视频元数据</h3>
            <div className="space-y-2 text-xs">
              {(
                [
                  ["分辨率", metadata.resolution],
                  ["帧率", metadata.fps],
                  ["时长", metadata.duration],
                  ["文件大小", metadata.fileSize],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span className="text-foreground">{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right Column ── */}
        <div className="flex min-h-[18rem] min-w-0 flex-1 flex-col rounded-xl border border-border bg-card p-4 sm:p-5 lg:min-h-0">
          {/* Header */}
          <div className="mb-3 flex shrink-0 items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Sparkles className="h-4 w-4 text-blue-500" />
              提示词解析窗口
              {showTranslated && (
                <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-medium text-indigo-500">
                  {isChinese(prompt) ? "EN" : "中文"} 翻译版
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div
                className="flex items-center gap-1.5 rounded bg-blue-500/10 px-2 py-1 text-[10px] font-semibold text-blue-500"
                title="当前使用的视频理解模型（可在下方切换）"
              >
                <Cpu className="h-3 w-3" />
                {labelOf(selectedModel)}
              </div>
              {isComplete && (
                <div className="rounded bg-blue-500/10 px-2.5 py-1 text-[10px] font-semibold text-blue-500">
                  解析完成
                </div>
              )}
            </div>
          </div>

          {/* Text Area */}
          <div className="relative mb-3 flex min-h-[12rem] flex-1 flex-col rounded-lg border border-border bg-background p-4 sm:min-h-[14rem] lg:min-h-0">
            <textarea
              value={displayText}
              onChange={(e) => {
                if (showTranslated) setTranslated(e.target.value);
                else setPrompt(e.target.value);
              }}
              placeholder="上传视频并点击生成提示词..."
              className="min-h-[8rem] w-full flex-1 resize-none bg-transparent pb-12 font-mono text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:outline-none lg:min-h-0"
            />

            {/* Action Buttons inside Text Area */}
            <div className="absolute bottom-3 right-3 flex gap-1.5">
              <button
                onClick={() => void handleTranslate()}
                disabled={!prompt || isTranslating}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
                  showTranslated
                    ? "bg-indigo-500/15 text-indigo-500 hover:bg-indigo-500/25"
                    : "bg-accent text-accent-foreground hover:bg-accent/80",
                )}
                title={
                  showTranslated
                    ? "查看原文"
                    : "翻译为" + (isChinese(prompt) ? "英文" : "中文")
                }
              >
                {isTranslating ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border border-muted border-t-indigo-500" />
                ) : (
                  <Languages className="h-3.5 w-3.5" />
                )}
                {showTranslated ? "查看原文" : "中英翻译"}
              </button>
              <button
                onClick={() => void handleCopy()}
                disabled={!displayText}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
                  copied
                    ? "bg-green-500/15 text-green-600 dark:text-green-400"
                    : "bg-accent text-accent-foreground hover:bg-accent/80",
                )}
              >
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "已复制" : "复制内容"}
              </button>
            </div>
          </div>

          {/* Generate Button + Model Badge */}
          <div className="mt-auto flex shrink-0 gap-2">
            <button
              onClick={() => void handleGenerate()}
              disabled={isAnalyzing || isUploading || noVideo}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-lg py-3 text-sm font-bold text-primary-foreground transition-all",
                isAnalyzing || isUploading || noVideo
                  ? "cursor-not-allowed bg-primary/50"
                  : "bg-primary hover:bg-primary/90",
              )}
            >
              {isAnalyzing ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                  解析中...
                </>
              ) : isUploading ? (
                <>
                  <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground" />
                  视频上传中...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4 fill-current" />
                  生成提示词
                </>
              )}
            </button>

            {/* Model selector — click to switch between whitelisted Qwen-Omni IDs */}
            <div ref={modelMenuRef} className="relative shrink-0">
              <button
                type="button"
                onClick={() => setModelMenuOpen((v) => !v)}
                disabled={isAnalyzing}
                title="切换视频理解模型"
                aria-haspopup="listbox"
                aria-expanded={modelMenuOpen}
                className={cn(
                  "group flex h-12 shrink-0 items-center gap-2 rounded-lg border px-3 transition-colors",
                  isAnalyzing
                    ? "cursor-not-allowed border-border bg-accent opacity-60"
                    : "border-blue-500/30 bg-blue-500/10 hover:border-blue-500/60 hover:bg-blue-500/15",
                )}
              >
                <Cpu className="h-4 w-4 text-blue-500" />
                <div className="flex flex-col items-start leading-tight">
                  <span className="text-[10px] font-semibold text-blue-500/70">
                    模型
                  </span>
                  <span className="text-[11px] font-semibold text-blue-500">
                    {labelOf(selectedModel)}
                  </span>
                </div>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-blue-500/70 transition-transform",
                    modelMenuOpen && "rotate-180",
                  )}
                />
              </button>

              {modelMenuOpen && (
                <div
                  role="listbox"
                  className="absolute right-0 bottom-full z-30 mb-2 w-72 overflow-hidden rounded-lg border border-border bg-popover shadow-2xl shadow-black/40"
                >
                  <div className="border-b border-border/60 px-3 py-2 text-[11px] font-semibold text-muted-foreground">
                    选择视频理解模型
                  </div>
                  {MODEL_OPTIONS.map((opt) => {
                    const active = opt.id === selectedModel;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          setSelectedModel(opt.id);
                          setModelMenuOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors",
                          active
                            ? "bg-blue-500/10 text-blue-500"
                            : "text-foreground hover:bg-accent",
                        )}
                      >
                        <div
                          className={cn(
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                            active
                              ? "border-blue-500 bg-blue-500"
                              : "border-border",
                          )}
                        >
                          {active && <Check className="h-2.5 w-2.5 text-white" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12px] font-semibold">{opt.label}</span>
                            {opt.badge === "default" && (
                              <span className="rounded bg-blue-500/15 px-1.5 py-px text-[10px] font-semibold text-blue-500">
                                默认
                              </span>
                            )}
                            {opt.badge === "quality" && (
                              <span className="rounded bg-purple-500/15 px-1.5 py-px text-[10px] font-semibold text-purple-500">
                                高质
                              </span>
                            )}
                            {opt.badge === "fallback" && (
                              <span className="rounded bg-amber-500/15 px-1.5 py-px text-[10px] font-semibold text-amber-500">
                                回退
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                            {opt.tagline}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
