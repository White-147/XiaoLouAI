import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  LoaderCircle,
  Map,
  Package,
  Plus,
  RefreshCw,
  Search,
  Upload,
  Users,
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  GeneratedMediaPlaceholder,
  getGeneratedMediaUrl,
} from "../../components/media/GenerationPlaceholder";
import { cn } from "../../lib/utils";
import {
  createAsset,
  generateStoryboardImage,
  getProjectOverview,
  uploadFile,
  updateStoryboard,
  type Asset,
  type Storyboard,
} from "../../lib/api";
import { useCurrentProjectId } from "../../lib/session";

interface StoryboardEditorProps {
  shotId: number;
  onBack: () => void;
}

const PARAM_OPTIONS: Record<string, string[]> = {
  composition: ["居中构图", "对角线构图", "前景遮挡", "留白构图"],
  shotType: ["近景", "中景", "远景", "特写"],
  focalLength: ["24mm", "35mm", "50mm", "85mm"],
  colorTone: ["暖色", "冷色", "霓虹", "低饱和"],
  lighting: ["柔光", "逆光", "雨夜霓虹", "顶光"],
  technique: ["手持感", "电影感", "写实摄影", "浅景深"],
};

function assetTabToType(tab: string) {
  if (tab === "characters") return "character";
  if (tab === "scenes") return "scene";
  return "prop";
}

function previewImage(storyboard: Storyboard) {
  return getGeneratedMediaUrl(storyboard.imageUrl);
}

export default function StoryboardEditor({ shotId, onBack }: StoryboardEditorProps) {
  const [currentProjectId] = useCurrentProjectId();
  const [storyboards, setStoryboards] = useState<Storyboard[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [currentShotNo, setCurrentShotNo] = useState(shotId);
  const [activeAssetTab, setActiveAssetTab] = useState("characters");
  const [assetQuery, setAssetQuery] = useState("");
  const [expandedParams, setExpandedParams] = useState<string[]>(["composition"]);
  const [script, setScript] = useState("");
  const [composition, setComposition] = useState("居中构图");
  const [shotType, setShotType] = useState("中景");
  const [focalLength, setFocalLength] = useState("35mm");
  const [colorTone, setColorTone] = useState("霓虹");
  const [lighting, setLighting] = useState("雨夜霓虹");
  const [technique, setTechnique] = useState("电影感");
  const [modelName, setModelName] = useState("Wan 2.6 T2I");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [imageQuality, setImageQuality] = useState("2K");
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [uploadingAsset, setUploadingAsset] = useState(false);
  const hydratedRef = useRef(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const overview = await getProjectOverview(currentProjectId);
      setStoryboards(overview.storyboards);
      setAssets(overview.assets);
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

    setScript(currentStoryboard.script || "");
    setComposition(currentStoryboard.composition || "居中构图");
    setShotType(currentStoryboard.shotType || "中景");
    setFocalLength(currentStoryboard.focalLength || "35mm");
    setColorTone(currentStoryboard.colorTone || "霓虹");
    setLighting(currentStoryboard.lighting || "雨夜霓虹");
    setTechnique(currentStoryboard.technique || "电影感");
    setModelName(currentStoryboard.modelName || "Wan 2.6 T2I");
    setAspectRatio(currentStoryboard.aspectRatio || "16:9");
    setImageQuality(currentStoryboard.imageQuality || "2K");
    setSelectedAssetIds(currentStoryboard.assetIds || []);
    hydratedRef.current = true;
  }, [currentStoryboard?.id]);

  useEffect(() => {
    if (!currentStoryboard || !hydratedRef.current) return;

    const timeout = window.setTimeout(() => {
      void updateStoryboard(currentProjectId, currentStoryboard.id, {
        script,
        composition,
        shotType,
        focalLength,
        colorTone,
        lighting,
        technique,
        modelName,
        aspectRatio,
        imageQuality,
        assetIds: selectedAssetIds,
      });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [
    aspectRatio,
    colorTone,
    composition,
    currentProjectId,
    currentStoryboard,
    focalLength,
    imageQuality,
    lighting,
    modelName,
    script,
    selectedAssetIds,
    shotType,
    technique,
  ]);

  const selectedAssets = useMemo(() => {
    return assets.filter((item) => selectedAssetIds.includes(item.id));
  }, [assets, selectedAssetIds]);

  const filteredAssets = useMemo(() => {
    const targetType = assetTabToType(activeAssetTab);
    return assets.filter((asset) => {
      const matchType = asset.assetType === targetType;
      const matchQuery =
        !assetQuery ||
        asset.name.includes(assetQuery) ||
        asset.description.includes(assetQuery);
      return matchType && matchQuery;
    });
  }, [activeAssetTab, assetQuery, assets]);

  const toggleParam = (param: string) => {
    setExpandedParams((current) =>
      current.includes(param)
        ? current.filter((item) => item !== param)
        : [...current, param],
    );
  };

  const toggleAsset = (assetId: string) => {
    setSelectedAssetIds((current) =>
      current.includes(assetId)
        ? current.filter((item) => item !== assetId)
        : [...current, assetId],
    );
  };

  const handleAssetUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadingAsset(true);
    try {
      const upload = await uploadFile(file, "storyboard-asset");
      const assetType = assetTabToType(activeAssetTab);
      const createdAsset = await createAsset(currentProjectId, {
        assetType,
        name: file.name.replace(/\.[^.]+$/, ""),
        description: "Uploaded from storyboard editor",
        previewUrl: upload.url,
      });
      setAssets((current) => [createdAsset, ...current]);
      setSelectedAssetIds((current) =>
        current.includes(createdAsset.id) ? current : [...current, createdAsset.id],
      );
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Asset upload failed. Please try again.");
    } finally {
      setUploadingAsset(false);
      event.target.value = "";
    }
  };

  const shiftShot = (offset: number) => {
    if (!storyboards.length) return;
    const currentIndex = storyboards.findIndex((item) => item.shotNo === currentShotNo);
    const nextIndex = Math.min(
      Math.max(currentIndex + offset, 0),
      storyboards.length - 1,
    );
    setCurrentShotNo(storyboards[nextIndex].shotNo);
  };

  const handleGenerate = async () => {
    if (!currentStoryboard) return;

    setGenerating(true);
    try {
      await generateStoryboardImage(currentStoryboard.id, script);
      window.setTimeout(() => void loadData(), 1800);
    } finally {
      window.setTimeout(() => setGenerating(false), 1800);
    }
  };

  const paramValues: Record<string, string> = {
    composition,
    shotType,
    focalLength,
    colorTone,
    lighting,
    technique,
  };

  const setParamValue = (key: string, value: string) => {
    if (key === "composition") setComposition(value);
    if (key === "shotType") setShotType(value);
    if (key === "focalLength") setFocalLength(value);
    if (key === "colorTone") setColorTone(value);
    if (key === "lighting") setLighting(value);
    if (key === "technique") setTechnique(value);
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
              {currentStoryboard?.title ?? "镜头编辑"}
            </span>
            {loading ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => void handleGenerate()}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            {generating ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            重新生成分镜图
          </button>
          <button
            onClick={() => shiftShot(1)}
            className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            下一镜头
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex w-72 flex-col overflow-y-auto border-r border-border bg-card/30 custom-scrollbar">
          <div className="border-b border-border p-4 text-sm font-medium">分镜参数</div>
          <div className="space-y-1 p-2">
            {Object.entries(PARAM_OPTIONS).map(([key, options]) => {
              const expanded = expandedParams.includes(key);
              return (
                <div key={key} className="flex flex-col">
                  <button
                    onClick={() => toggleParam(key)}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm transition-colors hover:bg-accent"
                  >
                    <span className={expanded ? "font-medium text-foreground" : "text-muted-foreground"}>
                      {key === "composition"
                        ? "构图"
                        : key === "shotType"
                          ? "景别"
                          : key === "focalLength"
                            ? "镜头焦距"
                            : key === "colorTone"
                              ? "色彩倾向"
                              : key === "lighting"
                                ? "光线"
                                : "摄影技法"}
                    </span>
                    {expanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>
                  {expanded ? (
                    <div className="grid grid-cols-2 gap-2 px-3 pb-2 pt-1">
                      {options.map((item) => (
                        <button
                          key={item}
                          onClick={() => setParamValue(key, item)}
                          className={cn(
                            "rounded border py-1.5 text-xs transition-colors",
                            paramValues[key] === item
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:border-primary/50 hover:text-primary",
                          )}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="mt-2 border-y border-border p-4 text-sm font-medium">资产引用</div>
          <div className="space-y-4 p-4">
            {[
              { label: "角色", icon: Users, assetType: "character" },
              { label: "场景", icon: Map, assetType: "scene" },
              { label: "道具", icon: Package, assetType: "prop" },
            ].map((section) => (
              <div key={section.assetType} className="space-y-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{section.label}</span>
                  <Plus className="h-3.5 w-3.5" />
                </div>
                <div className="flex flex-wrap gap-2">
                  {selectedAssets
                    .filter((asset) => asset.assetType === section.assetType)
                    .map((asset) => (
                      <button
                        key={asset.id}
                        onClick={() => toggleAsset(asset.id)}
                        className="rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs text-primary"
                      >
                        {asset.name}
                      </button>
                    ))}
                  {!selectedAssets.some((asset) => asset.assetType === section.assetType) ? (
                    <div className="rounded-md border border-dashed border-border bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
                      暂未选择
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-1 flex-col overflow-y-auto bg-muted/10 p-6 custom-scrollbar">
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col space-y-6">
            <div className="aspect-video overflow-hidden rounded-xl border border-border/50 bg-black shadow-lg">
              {currentStoryboard && previewImage(currentStoryboard) ? (
                <img
                  src={previewImage(currentStoryboard) || undefined}
                  alt={currentStoryboard.title}
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <GeneratedMediaPlaceholder
                  kind="image"
                  className="h-full w-full bg-black text-zinc-300"
                  description="分镜图生成后会在这里显示"
                />
              )}
            </div>

            <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
              <div className="border-b border-border bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground">
                分镜脚本
              </div>
              <textarea
                value={script}
                onChange={(event) => setScript(event.target.value)}
                className="flex-1 resize-none bg-transparent p-4 text-sm leading-relaxed focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">模型选择</label>
                <select
                  value={modelName}
                  onChange={(event) => setModelName(event.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option>Wan 2.6 T2I</option>
                  <option>WanX 2.1 Image Edit</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">画面比例</label>
                <select
                  value={aspectRatio}
                  onChange={(event) => setAspectRatio(event.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option>16:9</option>
                  <option>9:16</option>
                  <option>1:1</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">图片清晰度</label>
                <select
                  value={imageQuality}
                  onChange={(event) => setImageQuality(event.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <option>1K</option>
                  <option>2K</option>
                  <option>4K</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="flex w-80 flex-col border-l border-border bg-card/30">
          <div className="border-b border-border p-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={assetQuery}
                onChange={(event) => setAssetQuery(event.target.value)}
                placeholder="搜索资产"
                className="w-full rounded-lg border border-border bg-input py-2 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
            </div>
            <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm transition-colors hover:border-primary/50 hover:text-primary">
              {uploadingAsset ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              上传当前分类资产
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => void handleAssetUpload(event)}
              />
            </label>
          </div>

          <div className="flex items-center border-b border-border px-2 pt-2">
            {[
              { id: "characters", label: "角色", icon: Users },
              { id: "scenes", label: "场景", icon: Map },
              { id: "props", label: "道具", icon: Package },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveAssetTab(tab.id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2 text-xs font-medium transition-colors",
                  activeAssetTab === tab.id
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                <tab.icon className="h-3.5 w-3.5" />
                {tab.label}
              </button>
            ))}
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
                        loading="lazy"
                        decoding="async"
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
        </div>
      </div>
    </div>
  );
}
