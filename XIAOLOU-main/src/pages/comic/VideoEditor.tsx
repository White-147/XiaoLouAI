import {
  ChevronLeft,
  ChevronRight,
  Download,
  Image as ImageIcon,
  LayoutGrid,
  List,
  LoaderCircle,
  Play,
  PlaySquare,
  Search,
  Settings2,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  GeneratedMediaPlaceholder,
  getGeneratedMediaUrl,
} from "../../components/media/GenerationPlaceholder";
import { cn } from "../../lib/utils";
import {
  generateVideo,
  getProjectOverview,
  uploadFile,
  updateStoryboard,
  type Asset,
  type Storyboard,
  type VideoItem,
} from "../../lib/api";
import { useCurrentProjectId } from "../../lib/session";

interface VideoEditorProps {
  shotId: number;
  onBack: () => void;
}

function videoStatusLabel(status: string | null | undefined) {
  if (status === "queued") return "排队中";
  if (status === "running") return "生成中";
  if (status === "ready") return "已完成";
  if (status === "failed") return "生成失败";
  return "未生成";
}

function getSupportedVideoResolutions(model: string) {
  return model === "WanX 2.1 I2V Turbo" ? ["720p", "480p"] : ["1080p", "720p", "480p"];
}

function normalizeVideoResolution(model: string, resolution: string | null | undefined) {
  const supported = getSupportedVideoResolutions(model);
  const normalized = String(resolution || "").trim().toLowerCase();
  return supported.includes(normalized) ? normalized : supported[0];
}

function getAllowedVideoModels(mode: string) {
  return mode === "start_end_frame"
    ? ["Wan 2.2 KF2V Flash", "WanX 2.1 KF2V Plus"]
    : ["WanX 2.1 I2V Turbo", "WanX 2.1 I2V Plus"];
}

function coverImage(storyboard: Storyboard) {
  return getGeneratedMediaUrl(storyboard.imageUrl);
}

function videoThumb(video: VideoItem) {
  return getGeneratedMediaUrl(video.thumbnailUrl);
}

function previewableVideoUrl(video: VideoItem) {
  if (typeof video.videoUrl !== "string" || !video.videoUrl) return null;
  return video.videoUrl.includes("mock.assets.local") ? null : video.videoUrl;
}

export default function VideoEditor({ shotId, onBack }: VideoEditorProps) {
  const [currentProjectId] = useCurrentProjectId();
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [currentShotNo, setCurrentShotNo] = useState(shotId);
  const [activeMode, setActiveMode] = useState("image_to_video");
  const [resultView, setResultView] = useState<"grid" | "list">("grid");
  const [assetQuery, setAssetQuery] = useState("");
  const [videoPrompt, setVideoPrompt] = useState("");
  const [motionPreset, setMotionPreset] = useState("智能运镜");
  const [motionDescription, setMotionDescription] = useState("");
  const [videoModel, setVideoModel] = useState("WanX 2.1 I2V Turbo");
  const [videoAspectRatio, setVideoAspectRatio] = useState("16:9");
  const [videoDuration, setVideoDuration] = useState("3s");
  const [videoResolution, setVideoResolution] = useState("720p");
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [referenceImageUrls, setReferenceImageUrls] = useState<string[]>([]);
  const [startFrameUrl, setStartFrameUrl] = useState<string | null>(null);
  const [endFrameUrl, setEndFrameUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [uploadingReference, setUploadingReference] = useState(false);
  const [uploadingStartFrame, setUploadingStartFrame] = useState(false);
  const [uploadingEndFrame, setUploadingEndFrame] = useState(false);
  const [previewVideoId, setPreviewVideoId] = useState<string | null>(null);
  const hydratedRef = useRef(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const overview = await getProjectOverview(currentProjectId);
      setStoryboards(overview.storyboards);
      setAssets(overview.assets);
      setVideos(overview.videos);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, [currentProjectId]);

  const currentStoryboard =
    storyboards.find((item) => item.shotNo === currentShotNo) ?? storyboards[0] ?? null;

  useEffect(() => {
    if (!currentStoryboard) return;
    const nextVideoModel =
      currentStoryboard.videoModel ||
      (currentStoryboard.videoMode === "start_end_frame"
        ? "Wan 2.2 KF2V Flash"
        : "WanX 2.1 I2V Turbo");

    setActiveMode(currentStoryboard.videoMode || "image_to_video");
    setVideoPrompt(currentStoryboard.videoPrompt || currentStoryboard.script || "");
    setMotionPreset(currentStoryboard.motionPreset || "智能运镜");
    setMotionDescription(currentStoryboard.motionDescription || "");
    setVideoModel(nextVideoModel);
    setVideoAspectRatio(currentStoryboard.videoAspectRatio || "16:9");
    setVideoDuration(currentStoryboard.videoDuration || "3s");
    setVideoResolution(normalizeVideoResolution(nextVideoModel, currentStoryboard.videoResolution));
    setSelectedAssetIds(currentStoryboard.assetIds || []);
    setReferenceImageUrls(currentStoryboard.referenceImageUrls || []);
    setStartFrameUrl(currentStoryboard.startFrameUrl || null);
    setEndFrameUrl(currentStoryboard.endFrameUrl || null);
    hydratedRef.current = true;
  }, [currentStoryboard?.id]);

  useEffect(() => {
    if (!currentStoryboard || !hydratedRef.current) return;

    const timeout = window.setTimeout(() => {
      void updateStoryboard(currentProjectId, currentStoryboard.id, {
        videoMode: activeMode,
        videoPrompt,
        motionPreset,
        motionDescription,
        videoModel,
        videoAspectRatio,
        videoDuration,
        videoResolution: normalizeVideoResolution(videoModel, videoResolution),
        assetIds: selectedAssetIds,
        referenceImageUrls,
        startFrameUrl,
        endFrameUrl,
      });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [
    activeMode,
    currentProjectId,
    currentStoryboard,
    endFrameUrl,
    motionDescription,
    motionPreset,
    referenceImageUrls,
    selectedAssetIds,
    startFrameUrl,
    videoAspectRatio,
    videoDuration,
    videoModel,
    videoPrompt,
    videoResolution,
  ]);

  useEffect(() => {
    const allowedModels = getAllowedVideoModels(activeMode);
    if (!allowedModels.includes(videoModel)) {
      setVideoModel(allowedModels[0]);
      return;
    }

    const nextResolution = normalizeVideoResolution(videoModel, videoResolution);
    if (nextResolution !== videoResolution) {
      setVideoResolution(nextResolution);
    }
  }, [activeMode, videoModel, videoResolution]);

  useEffect(() => {
    if (!currentStoryboard) return;
    if (!generating && currentStoryboard.videoStatus !== "queued" && currentStoryboard.videoStatus !== "running") {
      return;
    }

    const timer = window.setInterval(() => {
      void loadData();
    }, 3500);

    return () => window.clearInterval(timer);
  }, [currentProjectId, currentStoryboard, generating]);

  const shotVideos = useMemo(() => {
    if (!currentStoryboard) return [];
    return videos.filter((item) => item.storyboardId === currentStoryboard.id);
  }, [currentStoryboard, videos]);

  const previewVideo = useMemo(
    () => shotVideos.find((item) => item.id === previewVideoId) ?? null,
    [previewVideoId, shotVideos],
  );

  useEffect(() => {
    if (!previewVideoId) return;
    if (!shotVideos.some((item) => item.id === previewVideoId)) {
      setPreviewVideoId(null);
    }
  }, [previewVideoId, shotVideos]);

  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      const matchType = ["character", "scene", "prop"].includes(asset.assetType);
      const matchQuery =
        !assetQuery ||
        asset.name.includes(assetQuery) ||
        asset.description.includes(assetQuery);
      return matchType && matchQuery;
    });
  }, [assetQuery, assets]);

  const toggleAsset = (assetId: string) => {
    setSelectedAssetIds((current) =>
      current.includes(assetId)
        ? current.filter((item) => item !== assetId)
        : [...current, assetId],
    );
  };

  const shiftShot = (offset: number) => {
    if (!storyboards.length) return;
    const currentIndex = storyboards.findIndex((item) => item.shotNo === currentShotNo);
    const nextIndex = Math.min(Math.max(currentIndex + offset, 0), storyboards.length - 1);
    setCurrentShotNo(storyboards[nextIndex].shotNo);
  };

  const handleGenerate = async () => {
    if (!currentStoryboard) return;

    setGenerating(true);
    try {
      await updateStoryboard(currentProjectId, currentStoryboard.id, {
        videoMode: activeMode,
        videoPrompt,
        motionPreset,
        motionDescription,
        videoModel,
        videoAspectRatio,
        videoDuration,
        videoResolution: normalizeVideoResolution(videoModel, videoResolution),
        assetIds: selectedAssetIds,
        referenceImageUrls,
        startFrameUrl,
        endFrameUrl,
      });
      await generateVideo(currentStoryboard.id, {
        mode: activeMode,
        motionPreset:
          activeMode === "image_to_video"
            ? `${motionPreset}${motionDescription ? ` / ${motionDescription}` : ""}`
            : "start_end_frame",
      });
      await loadData();
    } finally {
      setGenerating(false);
    }
  };

  const handleUploadReferenceImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingReference(true);
    try {
      const uploaded = await uploadFile(file, "video-reference");
      setReferenceImageUrls((current) => [uploaded.url, ...current].slice(0, 6));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Reference upload failed. Please try again.");
    } finally {
      setUploadingReference(false);
      event.target.value = "";
    }
  };

  const handleUploadStartFrame = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingStartFrame(true);
    try {
      const uploaded = await uploadFile(file, "video-start-frame");
      setStartFrameUrl(uploaded.url);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Start frame upload failed. Please try again.");
    } finally {
      setUploadingStartFrame(false);
      event.target.value = "";
    }
  };

  const handleUploadEndFrame = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingEndFrame(true);
    try {
      const uploaded = await uploadFile(file, "video-end-frame");
      setEndFrameUrl(uploaded.url);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "End frame upload failed. Please try again.");
    } finally {
      setUploadingEndFrame(false);
      event.target.value = "";
    }
  };

  return (
    <div className="absolute inset-0 z-20 flex h-full w-full flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card/50 px-4 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-3">
            <span className="rounded bg-secondary px-2 py-0.5 text-xs font-mono font-medium text-secondary-foreground">
              S{String(currentStoryboard?.shotNo ?? currentShotNo).padStart(2, "0")}
            </span>
            <span className="text-sm font-medium">
              {currentStoryboard?.title ?? "镜头视频编辑"}
            </span>
            <div className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              {videoStatusLabel(currentStoryboard?.videoStatus)}
            </div>
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => shiftShot(-1)}
            className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" />
            上一镜头
          </button>
          <button
            onClick={() => shiftShot(1)}
            className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            下一镜头
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-[420px] flex-col border-r border-border bg-card/30">
          <div className="flex items-center gap-2 border-b border-border p-4">
            <button
              onClick={() => setActiveMode("image_to_video")}
              className={cn(
                "flex-1 rounded-md py-2 text-sm font-medium transition-colors",
                activeMode === "image_to_video"
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              图生视频
            </button>
            <button
              onClick={() => setActiveMode("start_end_frame")}
              className={cn(
                "flex-1 rounded-md py-2 text-sm font-medium transition-colors",
                activeMode === "start_end_frame"
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              首尾帧视频
            </button>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto p-4 custom-scrollbar">
            <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
              <span className="mr-2 font-medium text-primary">脚本:</span>
              {currentStoryboard?.script || "当前镜头暂无脚本。"}
            </div>

            {activeMode === "image_to_video" ? (
              <>
                <div className="space-y-2">
                  <label className="text-sm font-medium">参考图</label>
                  <div className="aspect-video overflow-hidden rounded-lg border border-dashed border-border bg-muted/20">
                    {referenceImageUrls[0] ? (
                      <img
                        src={referenceImageUrls[0]}
                        alt="reference"
                        className="h-full w-full object-cover opacity-80"
                        referrerPolicy="no-referrer"
                      />
                    ) : currentStoryboard && coverImage(currentStoryboard) ? (
                      <img
                        src={coverImage(currentStoryboard) || undefined}
                        alt={currentStoryboard.title}
                        className="h-full w-full object-cover opacity-80"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <GeneratedMediaPlaceholder
                        kind="image"
                        className="h-full w-full"
                        description="分镜图生成后会在这里显示"
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-accent">
                      {uploadingReference ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      上传参考图
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => void handleUploadReferenceImage(event)}
                      />
                    </label>
                    {referenceImageUrls.length ? (
                      <button
                        onClick={() => setReferenceImageUrls([])}
                        className="rounded-md border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-accent"
                      >
                        清空参考图
                      </button>
                    ) : null}
                  </div>
                  {referenceImageUrls.length > 1 ? (
                    <div className="grid grid-cols-3 gap-2">
                      {referenceImageUrls.slice(1).map((url) => (
                        <img
                          key={url}
                          src={url}
                          alt="reference"
                          className="aspect-square w-full rounded-md border border-border object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ))}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Settings2 className="h-4 w-4 text-muted-foreground" />
                    镜头运动
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {["智能运镜", "平移", "推进", "拉远", "环绕", "静止"].map((item) => (
                      <button
                        key={item}
                        onClick={() => setMotionPreset(item)}
                        className={cn(
                          "rounded-md border py-2 text-xs font-medium transition-colors",
                          motionPreset === item
                            ? "border-primary bg-primary/10 text-primary"
                            : "border-border hover:border-primary/50 hover:text-primary",
                        )}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                  <input
                    value={motionDescription}
                    onChange={(event) => setMotionDescription(event.target.value)}
                    placeholder="补充镜头运动描述"
                    className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">首帧</label>
                  <div className="aspect-square overflow-hidden rounded-lg border border-dashed border-border bg-muted/20">
                    {startFrameUrl ? (
                      <img
                        src={startFrameUrl}
                        alt="start-frame"
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : currentStoryboard && coverImage(currentStoryboard) ? (
                      <img
                        src={coverImage(currentStoryboard) || undefined}
                        alt="current-storyboard"
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <GeneratedMediaPlaceholder kind="image" className="h-full w-full" />
                    )}
                  </div>
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-accent">
                    {uploadingStartFrame ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    上传首帧
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => void handleUploadStartFrame(event)}
                    />
                  </label>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">尾帧</label>
                  <div className="aspect-square overflow-hidden rounded-lg border border-dashed border-border bg-muted/20">
                    {endFrameUrl ? (
                      <img
                        src={endFrameUrl}
                        alt="tail-frame"
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        上传尾帧后会在这里预览
                      </div>
                    )}
                  </div>
                  <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-accent">
                    {uploadingEndFrame ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    上传尾帧
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => void handleUploadEndFrame(event)}
                    />
                  </label>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" />
                视频提示词
              </label>
              <p className="text-xs leading-5 text-muted-foreground">
                系统会把这里的内容与脚本、运镜、节奏、构图一起合成为最终视频提示词。
              </p>
              <textarea
                value={videoPrompt}
                onChange={(event) => setVideoPrompt(event.target.value)}
                placeholder="补充当前镜头想强调的动作、情绪、景别或表演重点"
                className="h-32 w-full resize-none rounded-lg border border-border bg-input p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>

            <div className="grid grid-cols-2 gap-4 border-t border-border pt-4">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">模型</label>
                <select
                  value={videoModel}
                  onChange={(event) => setVideoModel(event.target.value)}
                  className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-xs focus:outline-none"
                >
                  {activeMode === "start_end_frame" ? (
                    <>
                      <option>Wan 2.2 KF2V Flash</option>
                      <option>WanX 2.1 KF2V Plus</option>
                    </>
                  ) : (
                    <>
                      <option>WanX 2.1 I2V Turbo</option>
                      <option>WanX 2.1 I2V Plus</option>
                    </>
                  )}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">画面比例</label>
                <select
                  value={videoAspectRatio}
                  onChange={(event) => setVideoAspectRatio(event.target.value)}
                  className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-xs focus:outline-none"
                >
                  <option>16:9</option>
                  <option>9:16</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">时长</label>
                <select
                  value={videoDuration}
                  onChange={(event) => setVideoDuration(event.target.value)}
                  className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-xs focus:outline-none"
                >
                  <option>3s</option>
                  <option>5s</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">清晰度</label>
                <select
                  value={videoResolution}
                  onChange={(event) => setVideoResolution(event.target.value)}
                  className="w-full rounded-md border border-border bg-input px-2 py-1.5 text-xs focus:outline-none"
                >
                  {getSupportedVideoResolutions(videoModel).map((resolution) => (
                    <option key={resolution}>{resolution}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="border-t border-border bg-card p-4">
            <button
              onClick={() => void handleGenerate()}
              disabled={generating || !currentStoryboard}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
            >
              {generating ? (
                <LoaderCircle className="h-5 w-5 animate-spin" />
              ) : (
                <PlaySquare className="h-5 w-5" />
              )}
              开始生成视频
            </button>
          </div>
        </div>

        <div className="flex flex-1 flex-col bg-muted/10">
          <div className="flex h-14 items-center justify-between border-b border-border bg-card/30 px-6">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setResultView("grid")}
                className={cn(
                  "rounded-md p-2 transition-colors",
                  resultView === "grid"
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                onClick={() => setResultView("list")}
                className={cn(
                  "rounded-md p-2 transition-colors",
                  resultView === "list"
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
            <span className="text-sm text-muted-foreground">当前镜头结果 {shotVideos.length} 条</span>
          </div>

          <div className="flex flex-1 overflow-hidden">
            <div className="flex flex-1 flex-col overflow-y-auto p-6 custom-scrollbar">
              {shotVideos.length ? (
                <div
                  className={cn(
                    resultView === "grid"
                      ? "grid grid-cols-1 gap-4 xl:grid-cols-2"
                      : "space-y-4",
                  )}
                >
                  {shotVideos.map((video) => (
                    <article key={video.id} className="glass-panel overflow-hidden rounded-xl">
                      <div className="relative aspect-video bg-black">
                        {videoThumb(video) ? (
                          <img
                            src={videoThumb(video) || undefined}
                            alt={video.id}
                            className="h-full w-full object-cover opacity-80"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <GeneratedMediaPlaceholder
                            kind="video"
                            className="h-full w-full bg-black text-zinc-300"
                            description="视频生成完成后会在这里显示"
                          />
                        )}
                        {previewableVideoUrl(video) ? (
                          <button
                            onClick={() => setPreviewVideoId(video.id)}
                            className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary/90 text-primary-foreground"
                          >
                            <Play className="ml-0.5 h-6 w-6" />
                          </button>
                        ) : null}
                      </div>
                      <div className="space-y-2 p-3 text-sm">
                        <div className="flex items-center justify-between">
                          <span>v{video.version}</span>
                          <span className="text-muted-foreground">{video.durationSeconds}s</span>
                        </div>
                        <p className="text-xs text-muted-foreground">{video.status}</p>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              if (previewableVideoUrl(video)) {
                                setPreviewVideoId(video.id);
                              }
                            }}
                            disabled={!previewableVideoUrl(video)}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Play className="h-3.5 w-3.5" />
                            预览
                          </button>
                          {previewableVideoUrl(video) ? (
                            <a
                              href={previewableVideoUrl(video) ?? undefined}
                              download
                              className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium transition-colors hover:bg-accent"
                            >
                              <Download className="h-3.5 w-3.5" />
                              下载
                            </a>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground">
                  <ImageIcon className="mb-4 h-12 w-12 opacity-40" />
                  <p className="text-lg font-medium text-foreground">还没有生成结果</p>
                  <p className="mt-2 text-sm">左侧设置好参数后，就可以为当前镜头发起视频生成。</p>
                </div>
              )}
            </div>

            <aside className="flex w-80 flex-col border-l border-border bg-card/30">
              <div className="border-b border-border p-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={assetQuery}
                    onChange={(event) => setAssetQuery(event.target.value)}
                    placeholder="搜索参考素材"
                    className="w-full rounded-lg border border-border bg-input py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>

              <div className="grid flex-1 grid-cols-2 gap-3 overflow-y-auto p-4 custom-scrollbar">
                {filteredAssets.map((asset) => {
                  const selected = selectedAssetIds.includes(asset.id);
                  const imageSrc = getGeneratedMediaUrl(asset.previewUrl);

                  return (
                    <button
                      key={asset.id}
                      onClick={() => toggleAsset(asset.id)}
                      className="group text-left"
                    >
                      <div
                        className={cn(
                          "aspect-square overflow-hidden rounded-lg border transition-colors",
                          selected ? "border-primary ring-2 ring-primary/30" : "border-border",
                        )}
                      >
                        {imageSrc ? (
                          <img
                            src={imageSrc}
                            alt={asset.name}
                            className="h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <GeneratedMediaPlaceholder kind="image" compact className="h-full w-full" />
                        )}
                      </div>
                      <div className="mt-1.5 truncate text-center text-xs font-medium">
                        {asset.name}
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>
          </div>
        </div>
      </div>

      {previewVideo && previewableVideoUrl(previewVideo) ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/75 p-6">
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <div className="text-sm font-medium">镜头视频预览</div>
                <div className="text-xs text-muted-foreground">
                  v{previewVideo.version} · {previewVideo.durationSeconds}s
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={previewableVideoUrl(previewVideo) ?? undefined}
                  download
                  className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
                >
                  <Download className="h-4 w-4" />
                  下载
                </a>
                <button
                  onClick={() => setPreviewVideoId(null)}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border transition-colors hover:bg-accent"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="aspect-video bg-black">
              <video
                src={previewableVideoUrl(previewVideo) ?? undefined}
                controls
                autoPlay
                preload="metadata"
                className="h-full w-full"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
