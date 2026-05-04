import {
  Download,
  Image as ImageIcon,
  LoaderCircle,
  Map as MapIcon,
  Package,
  Plus,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Users,
  X,
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  ReferenceAssetPicker,
  type ReferenceAssetSelection,
} from "../../components/create/ReferenceAssetPicker";
import { cn } from "../../lib/utils";
import {
  createAsset,
  deleteAsset,
  extractAssets,
  generateAssetImage,
  getTask,
  listAssets,
  listTasks,
  updateAsset,
  uploadFile,
  type Asset,
  type Task,
} from "../../lib/api";
import { saveProjectScript } from "../../lib/project-script-store";
import { useCurrentProjectId } from "../../lib/session";

const tabs = [
  { id: "character", name: "角色", icon: Users },
  { id: "scene", name: "场景", icon: MapIcon },
  { id: "prop", name: "道具", icon: Package },
] as const;

const imageModels = ["Wan 2.6 T2I", "WanX 2.1 Image Edit"] as const;
const aspectRatios = ["1:1", "16:9", "9:16"] as const;

type AssetTab = (typeof tabs)[number]["id"];

type AssetDraft = {
  name: string;
  description: string;
  generationPrompt: string;
  negativePrompt: string;
  referenceImageUrls: string[];
  imageModel: string;
  aspectRatio: string;
};

function assetImageUrl(asset: Asset) {
  if (
    asset.imageStatus === "ready" &&
    asset.previewUrl &&
    !asset.previewUrl.includes("mock.assets.local")
  ) {
    return asset.previewUrl;
  }

  return null;
}

function buildDraft(asset: Asset): AssetDraft {
  return {
    name: asset.name,
    description: asset.description || "",
    generationPrompt: asset.generationPrompt || "",
    negativePrompt: asset.negativePrompt || "",
    referenceImageUrls: Array.isArray(asset.referenceImageUrls) ? asset.referenceImageUrls : [],
    imageModel: asset.imageModel || "Wan 2.6 T2I",
    aspectRatio: asset.aspectRatio || "1:1",
  };
}

function normalizeImageModel(referenceImageUrls: string[], imageModel: string) {
  if (!referenceImageUrls.length && imageModel === "WanX 2.1 Image Edit") {
    return "Wan 2.6 T2I";
  }

  return imageModel || "Wan 2.6 T2I";
}

function imageStatusLabel(status?: string | null) {
  if (status === "queued") return "排队中";
  if (status === "running") return "生成中";
  if (status === "ready") return "已出图";
  if (status === "failed") return "生成失败";
  return "待生成";
}

function assetImageFallbackLabel(asset: Asset) {
  if (asset.imageStatus === "failed") return "出图失败";
  if (asset.imageStatus === "queued" || asset.imageStatus === "running") {
    return imageStatusLabel(asset.imageStatus);
  }

  return "未出图";
}

function AssetPreview({
  asset,
  className,
  compact = false,
}: {
  asset: Asset;
  className: string;
  compact?: boolean;
}) {
  const imageUrl = assetImageUrl(asset);

  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={asset.name}
        className={className}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center bg-muted/50 text-muted-foreground",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-2 px-3 text-center">
        <ImageIcon className={compact ? "h-5 w-5" : "h-8 w-8"} />
        <div className={compact ? "text-[11px] font-medium" : "text-sm font-medium"}>
          {assetImageFallbackLabel(asset)}
        </div>
      </div>
    </div>
  );
}

function taskStatusLabel(status?: string | null) {
  if (status === "queued") return "排队中";
  if (status === "running") return "处理中";
  if (status === "succeeded") return "已完成";
  if (status === "failed") return "失败";
  return status || "待开始";
}

function sortByNewest<T extends { updatedAt?: string; createdAt?: string }>(items: T[]) {
  return [...items].sort((left, right) => {
    const a = left.updatedAt || left.createdAt || "";
    const b = right.updatedAt || right.createdAt || "";
    return b.localeCompare(a);
  });
}

/** 资产列表按创建时间稳定排序，避免生图、保存等更新 updatedAt 后顺序跳动 */
function sortAssetsStable(items: Asset[]) {
  return [...items].sort((a, b) => {
    const ca = a.createdAt || "";
    const cb = b.createdAt || "";
    const t = ca.localeCompare(cb);
    if (t !== 0) return t;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

function isTerminalTask(task?: Task | null) {
  return task?.status === "succeeded" || task?.status === "failed";
}

export default function Entities() {
  const [currentProjectId] = useCurrentProjectId();
  const [activeTab, setActiveTab] = useState<AssetTab>("character");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [draft, setDraft] = useState<AssetDraft>({
    name: "",
    description: "",
    generationPrompt: "",
    negativePrompt: "",
    referenceImageUrls: [],
    imageModel: "Wan 2.6 T2I",
    aspectRatio: "1:1",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createDraftState, setCreateDraftState] = useState({
    name: "",
    description: "",
    generationPrompt: "",
    referenceImageUrls: [] as string[],
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [assetResponse, taskResponse] = await Promise.all([
        listAssets(currentProjectId),
        listTasks(currentProjectId),
      ]);
      setAssets(sortAssetsStable(assetResponse.items));
      setTasks(sortByNewest(taskResponse.items));
    } finally {
      setLoading(false);
    }
  };

  const waitForTaskToSettle = async (taskId: string) => {
    let latestTask: Task | null = null;

    for (let attempt = 0; attempt < 24; attempt += 1) {
      const task = await getTask(taskId);
      latestTask = task;
      setTasks((current) =>
        sortByNewest([...current.filter((item) => item.id !== task.id), task]),
      );

      if (isTerminalTask(task)) {
        return task;
      }

      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }

    return latestTask;
  };

  useEffect(() => {
    void loadData();
  }, [currentProjectId]);

  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      const matchType = asset.assetType === activeTab;
      const matchQuery =
        !searchQuery ||
        asset.name.includes(searchQuery) ||
        asset.description.includes(searchQuery) ||
        (asset.generationPrompt || "").includes(searchQuery);
      return matchType && matchQuery;
    });
  }, [activeTab, assets, searchQuery]);

  const visibleAssets = useMemo(() => {
    const nonSeedAssets = filteredAssets.filter((asset) => asset.scope !== "seed");
    return nonSeedAssets.length ? nonSeedAssets : filteredAssets;
  }, [filteredAssets]);

  const hiddenSeedCount = useMemo(() => {
    if (!visibleAssets.length) return 0;
    return filteredAssets.filter((asset) => asset.scope === "seed").length;
  }, [filteredAssets, visibleAssets]);

  useEffect(() => {
    if (!visibleAssets.length) {
      setSelectedAssetId(null);
      return;
    }

    const currentExists = visibleAssets.some((asset) => asset.id === selectedAssetId);
    if (!currentExists) {
      setSelectedAssetId(visibleAssets[0].id);
    }
  }, [visibleAssets, selectedAssetId]);

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) ?? null,
    [assets, selectedAssetId],
  );
  const selectedAssetImageUrl = selectedAsset ? assetImageUrl(selectedAsset) : null;

  useEffect(() => {
    if (!selectedAsset) return;
    setDraft(buildDraft(selectedAsset));
  }, [selectedAsset?.id]);

  const latestExtractTask = useMemo(
    () => tasks.find((task) => task.type === "asset_extract") ?? null,
    [tasks],
  );

  /** 自动提取已成功完成后，允许从项目资产库挑选参考图（与上传并存） */
  const canUseAssetLibraryForReference = useMemo(() => {
    if (assets.some((a) => a.scope === "extracted")) return true;
    return tasks.some((t) => t.type === "asset_extract" && t.status === "succeeded");
  }, [assets, tasks]);

  const latestImageTaskByAsset = useMemo(() => {
    const taskMap = new Map<string, Task>();

    for (const task of tasks) {
      if (task.type !== "asset_image_generate") continue;
      const assetId = typeof task.metadata?.assetId === "string" ? task.metadata.assetId : null;
      if (assetId && !taskMap.has(assetId)) {
        taskMap.set(assetId, task);
      }
    }

    return taskMap;
  }, [tasks]);

  const selectedAssetTask =
    selectedAssetId ? latestImageTaskByAsset.get(selectedAssetId) ?? null : null;

  const hasActiveTasks = useMemo(
    () =>
      tasks.some(
        (task) =>
          (task.type === "asset_extract" || task.type === "asset_image_generate") &&
          (task.status === "queued" || task.status === "running"),
      ),
    [tasks],
  );

  useEffect(() => {
    if (!hasActiveTasks) return;

    const timer = window.setInterval(() => {
      void loadData();
    }, 3500);

    return () => window.clearInterval(timer);
  }, [hasActiveTasks, currentProjectId]);

  const detailDirty = useMemo(() => {
    if (!selectedAsset) return false;
    return JSON.stringify(buildDraft(selectedAsset)) !== JSON.stringify(draft);
  }, [draft, selectedAsset]);

  const persistSelectedAsset = async () => {
    if (!selectedAsset) return null;

    const normalizedModel = normalizeImageModel(draft.referenceImageUrls, draft.imageModel);
    return updateAsset(currentProjectId, selectedAsset.id, {
      name: draft.name.trim(),
      description: draft.description.trim(),
      generationPrompt: draft.generationPrompt.trim(),
      negativePrompt: draft.negativePrompt.trim(),
      referenceImageUrls: draft.referenceImageUrls,
      imageModel: normalizedModel,
      aspectRatio: draft.aspectRatio,
    });
  };

  const handleExtract = async () => {
    setPendingAction("extract");
    setSearchQuery("");
    setActiveTab("character");
    try {
      const sourceText = await saveProjectScript(currentProjectId);

      if (!sourceText.trim()) {
        window.alert("请先在节点 2 填写并保存故事剧本。");
        return;
      }

      const acceptedTask = await extractAssets(currentProjectId, sourceText);
      await loadData();
      const finishedTask = await waitForTaskToSettle(acceptedTask.taskId);
      await loadData();
      if (finishedTask?.status === "failed") {
        window.alert(finishedTask.outputSummary || "角色/场景/道具提取失败，请稍后重试。");
        return;
      }

      const refreshedAssets = await listAssets(currentProjectId);
      const extractedCount = refreshedAssets.items.filter((asset) => asset.scope === "extracted").length;
      setAssets(sortAssetsStable(refreshedAssets.items));

      if (!extractedCount) {
        window.alert("提取已完成，但没有识别到明确的角色、场景或道具。请检查剧本文本是否足够具体。");
      }
    } catch (error) {
      console.error(error);
      window.alert("角色/场景/道具提取失败，请稍后重试。");
    } finally {
      setPendingAction(null);
    }
  };

  const handleSave = async () => {
    if (!selectedAsset) return;

    setPendingAction("save");
    try {
      const updated = await persistSelectedAsset();
      if (updated) {
        setDraft(buildDraft(updated));
      }
      await loadData();
    } finally {
      setPendingAction(null);
    }
  };

  const handleGenerate = async () => {
    if (!selectedAsset) return;

    setPendingAction("generate");
    try {
      await persistSelectedAsset();
      await generateAssetImage(currentProjectId, selectedAsset.id, {
        generationPrompt: draft.generationPrompt.trim(),
        negativePrompt: draft.negativePrompt.trim(),
        referenceImageUrls: draft.referenceImageUrls,
        imageModel: normalizeImageModel(draft.referenceImageUrls, draft.imageModel),
        aspectRatio: draft.aspectRatio,
      });
      await loadData();
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelete = async (assetId: string) => {
    setPendingAction(`delete:${assetId}`);
    try {
      await deleteAsset(currentProjectId, assetId);
      await loadData();
    } finally {
      setPendingAction(null);
    }
  };

  const handleCreate = async () => {
    if (!createDraftState.name.trim()) return;

    setPendingAction("create");
    try {
      const created = await createAsset(currentProjectId, {
        assetType: activeTab,
        name: createDraftState.name.trim(),
        description: createDraftState.description.trim(),
        generationPrompt: createDraftState.generationPrompt.trim(),
        referenceImageUrls: createDraftState.referenceImageUrls,
        imageModel: normalizeImageModel(
          createDraftState.referenceImageUrls,
          createDraftState.referenceImageUrls.length ? "WanX 2.1 Image Edit" : "Wan 2.6 T2I",
        ),
        scope: "manual",
      });

      setCreateOpen(false);
      setCreateDraftState({
        name: "",
        description: "",
        generationPrompt: "",
        referenceImageUrls: [],
      });
      await loadData();
      setSelectedAssetId(created.id);
    } finally {
      setPendingAction(null);
    }
  };

  const handleCreateReferenceUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setPendingAction("create-upload-reference");
    try {
      const uploaded = await uploadFile(file, "asset-reference");
      setCreateDraftState((current) => ({
        ...current,
        referenceImageUrls: [uploaded.url, ...current.referenceImageUrls].slice(0, 6),
      }));
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Reference upload failed. Please try again.");
    } finally {
      setPendingAction(null);
      event.target.value = "";
    }
  };

  const removeCreateReferenceImage = (url: string) => {
    setCreateDraftState((current) => ({
      ...current,
      referenceImageUrls: current.referenceImageUrls.filter((item) => item !== url),
    }));
  };

  const handleReferenceUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setPendingAction("upload-reference");
    try {
      const uploaded = await uploadFile(file, "asset-reference");
      setDraft((current) => {
        const nextUrls = [uploaded.url, ...current.referenceImageUrls].slice(0, 6);
        return {
          ...current,
          referenceImageUrls: nextUrls,
          imageModel: current.imageModel === "Wan 2.6 T2I" ? "WanX 2.1 Image Edit" : current.imageModel,
        };
      });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Reference upload failed. Please try again.");
    } finally {
      setPendingAction(null);
      event.target.value = "";
    }
  };

  const removeReferenceImage = (url: string) => {
    setDraft((current) => {
      const nextUrls = current.referenceImageUrls.filter((item) => item !== url);
      return {
        ...current,
        referenceImageUrls: nextUrls,
        imageModel: normalizeImageModel(nextUrls, current.imageModel),
      };
    });
  };

  const handleReferenceLibrarySelect = (sel: ReferenceAssetSelection) => {
    setDraft((current) => {
      const nextUrls = [sel.url, ...current.referenceImageUrls].slice(0, 6);
      return {
        ...current,
        referenceImageUrls: nextUrls,
        imageModel:
          nextUrls.length && current.imageModel === "Wan 2.6 T2I"
            ? "WanX 2.1 Image Edit"
            : current.imageModel,
      };
    });
  };

  const handleCreateReferenceLibrarySelect = (sel: ReferenceAssetSelection) => {
    setCreateDraftState((current) => ({
      ...current,
      referenceImageUrls: [sel.url, ...current.referenceImageUrls].slice(0, 6),
    }));
  };

  /** 用资产库已有预览图直接作为本项设定图，不经过「生成图片」任务 */
  const handleReplacePreviewFromLibrary = async (sel: ReferenceAssetSelection) => {
    if (!selectedAsset) return;

    setPendingAction("replace-preview");
    try {
      await updateAsset(currentProjectId, selectedAsset.id, {
        previewUrl: sel.url,
        mediaUrl: sel.url,
        mediaKind: "image",
        imageStatus: "ready",
      });
      await loadData();
    } catch (error) {
      console.error(error);
      window.alert("设定图替换失败，请检查网络或稍后重试。");
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-card/30 px-6">
        <div className="flex items-center gap-2">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.name}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => void handleExtract()}
            className="flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent"
          >
            {pendingAction === "extract" || latestExtractTask?.status === "running" ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            自动提取
          </button>
          <button
            onClick={() => {
              setCreateDraftState({
                name: "",
                description: "",
                generationPrompt: "",
                referenceImageUrls: [],
              });
              setCreateOpen(true);
            }}
            className="flex items-center gap-2 rounded-md bg-secondary px-3 py-1.5 text-sm font-medium text-secondary-foreground transition-colors hover:bg-secondary/80"
          >
            <Plus className="h-4 w-4" />
            手动新增
          </button>
        </div>
      </div>

      <div className="border-b border-border bg-background px-6 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={`搜索${tabs.find((item) => item.id === activeTab)?.name}、描述或提示词`}
              className="w-full rounded-xl border border-border bg-input py-2.5 pl-9 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <span>当前分类 {visibleAssets.length} 个资产</span>
            <span>全部资产 {assets.length} 个</span>
            {loading ? (
              <span className="inline-flex items-center gap-1 text-primary">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                同步中
              </span>
            ) : null}
          </div>
        </div>

        {latestExtractTask ? (
          <div
            className={cn(
              "mt-4 rounded-2xl border p-4",
              latestExtractTask.status === "failed"
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-primary/20 bg-primary/5",
            )}
          >
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-medium">角色 / 场景 / 道具自动提取</div>
                <div className="text-xs text-muted-foreground">
                  {latestExtractTask.outputSummary || latestExtractTask.currentStage || "等待执行"}
                </div>
              </div>
              <div className="rounded-full bg-background/80 px-3 py-1 text-xs font-medium text-foreground">
                {taskStatusLabel(latestExtractTask.status)}
              </div>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${latestExtractTask.progressPercent}%` }}
              />
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="min-h-0 border-r border-border bg-card/20">
          <div className="flex h-full flex-col">
            <div className="border-b border-border px-5 py-4">
              <div className="text-sm font-semibold">已提取资产</div>
              <div className="mt-1 text-xs text-muted-foreground">
                选择一项后可直接编辑提示词、上传参考图并生成资产图
              </div>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4 custom-scrollbar">
              {visibleAssets.map((asset, index) => {
                const active = asset.id === selectedAssetId;

                return (
                  <button
                    key={asset.id}
                    onClick={() => setSelectedAssetId(asset.id)}
                    className={cn(
                      "w-full rounded-2xl border p-3 text-left transition-all",
                      active
                        ? "border-primary bg-primary/10 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]"
                        : "border-border bg-card/50 hover:border-primary/40 hover:bg-accent/40",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <AssetPreview
                        asset={asset}
                        className="h-20 w-20 rounded-xl object-cover"
                        compact
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-sm font-semibold">
                            {tabs.find((tab) => tab.id === activeTab)?.name}
                            {String(index + 1).padStart(2, "0")}：{asset.name}
                          </div>
                          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                            {imageStatusLabel(asset.imageStatus)}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">
                          {asset.description || "等待补充描述"}
                        </p>
                        <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-foreground/75">
                          {asset.generationPrompt || "等待生成提示词"}
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}

              {!loading && !visibleAssets.length ? (
                <div className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  当前分类下还没有资产。可以先自动提取，或者手动新增一项。
                </div>
              ) : null}
            </div>
          </div>
        </aside>

        <section className="min-h-0 overflow-y-auto p-6 custom-scrollbar">
          {selectedAsset ? (
            <div className="space-y-6">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                      {tabs.find((tab) => tab.id === selectedAsset.assetType)?.name || "资产"}
                    </span>
                    <span className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">
                      {imageStatusLabel(selectedAsset.imageStatus)}
                    </span>
                    {selectedAssetTask ? (
                      <span className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
                        最近任务：{taskStatusLabel(selectedAssetTask.status)}
                      </span>
                    ) : null}
                  </div>
                  <h2 className="mt-3 text-2xl font-semibold">
                    {tabs.find((tab) => tab.id === selectedAsset.assetType)?.name}
                    {String(visibleAssets.findIndex((item) => item.id === selectedAsset.id) + 1).padStart(2, "0")}
                    ：{selectedAsset.name}
                  </h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
                    节点三会先用文本模型抽取角色、场景、道具，再把对应提示词交给你校对。你可以直接改 prompt、补参考图，再启动出图。
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    onClick={() => void handleSave()}
                    disabled={!detailDirty || pendingAction === "save"}
                    className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {pendingAction === "save" ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    保存修改
                  </button>
                  <button
                    onClick={() => void handleDelete(selectedAsset.id)}
                    className="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-destructive hover:text-destructive-foreground"
                  >
                    {pendingAction === `delete:${selectedAsset.id}` ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    删除资产
                  </button>
                </div>
              </div>

              <div className="grid gap-6 2xl:grid-cols-[380px_minmax(0,1fr)]">
                <div className="space-y-4">
                  <div className="overflow-hidden rounded-[28px] border border-border bg-card/60 shadow-[0_20px_60px_rgba(0,0,0,0.18)]">
                    <div className="aspect-[4/5] bg-muted/50">
                      <AssetPreview
                        asset={selectedAsset}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="space-y-3 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium">{selectedAsset.name}</div>
                          <div className="text-xs text-muted-foreground">
                            模型 {normalizeImageModel(draft.referenceImageUrls, draft.imageModel)}
                          </div>
                        </div>
                        <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-secondary-foreground">
                          {draft.aspectRatio}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <a
                          href={selectedAssetImageUrl ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          aria-disabled={!selectedAssetImageUrl}
                          tabIndex={selectedAssetImageUrl ? 0 : -1}
                          className={cn(
                            "flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium transition-colors",
                            selectedAssetImageUrl
                              ? "hover:bg-accent"
                              : "pointer-events-none text-muted-foreground opacity-60",
                          )}
                        >
                          <ImageIcon className="h-3.5 w-3.5" />
                          预览
                        </a>
                        <a
                          href={selectedAssetImageUrl ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          aria-disabled={!selectedAssetImageUrl}
                          tabIndex={selectedAssetImageUrl ? 0 : -1}
                          className={cn(
                            "flex items-center justify-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium transition-colors",
                            selectedAssetImageUrl
                              ? "hover:bg-accent"
                              : "pointer-events-none text-muted-foreground opacity-60",
                          )}
                        >
                          <Download className="h-3.5 w-3.5" />
                          下载
                        </a>
                        <button
                          onClick={() => void handleGenerate()}
                          disabled={pendingAction === "generate"}
                          className="flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {pendingAction === "generate" ? (
                            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                          生成图片
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-border bg-card/40 p-4">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">生成状态</div>
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-secondary-foreground">
                        {selectedAssetTask ? taskStatusLabel(selectedAssetTask.status) : "暂无任务"}
                      </span>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${selectedAssetTask?.progressPercent ?? 0}%` }}
                      />
                    </div>
                    <p className="mt-3 text-xs leading-5 text-muted-foreground">
                      {selectedAssetTask?.outputSummary ||
                        selectedAssetTask?.currentStage ||
                        "保存好提示词和参考图后，就可以为当前资产生成对应设定图。"}
                    </p>
                  </div>

                  {canUseAssetLibraryForReference && selectedAsset ? (
                    <div className="relative rounded-3xl border border-border bg-card/40 p-4">
                      {pendingAction === "replace-preview" ? (
                        <div className="absolute right-4 top-4 z-10 flex items-center gap-2 rounded-full bg-background/90 px-2 py-1 text-[11px] text-muted-foreground shadow-sm">
                          <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />
                          替换中…
                        </div>
                      ) : null}
                      <div className="rounded-2xl border border-border/80 bg-background/40 p-3">
                        <ReferenceAssetPicker
                          projectId={currentProjectId}
                          selectedAssetId={null}
                          excludeAssetIds={[selectedAsset.id]}
                          heading="设定图替换（免 AI 生成）"
                          hint="点击缩略图即用该资产预览图替换当前项设定图，不触发「生成图片」。下方「参考图」仍可照常使用。"
                          onSelect={(sel) => void handleReplacePreviewFromLibrary(sel)}
                        />
                      </div>
                    </div>
                  ) : null}

                  <div className="rounded-3xl border border-border bg-card/40 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-medium">参考图片</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          上传后会优先走 `WanX 2.1 Image Edit`，用于保持角色或场景的一致性。
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-accent">
                          {pendingAction === "upload-reference" ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" />
                          ) : (
                            <Upload className="h-4 w-4" />
                          )}
                          上传参考图
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(event) => void handleReferenceUpload(event)}
                          />
                        </label>
                      </div>
                    </div>

                    {canUseAssetLibraryForReference ? (
                      <div className="mt-4 rounded-2xl border border-border/80 bg-background/40 p-3">
                        <ReferenceAssetPicker
                          projectId={currentProjectId}
                          selectedAssetId={null}
                          excludeAssetIds={selectedAsset ? [selectedAsset.id] : []}
                          heading="资产库 · 参考图"
                          hint="点击加入下方参考图列表，用于「生成图片」时的编辑类模型；与上方「设定图替换」不同。"
                          onSelect={handleReferenceLibrarySelect}
                        />
                      </div>
                    ) : (
                      <p className="mt-3 text-[11px] leading-5 text-muted-foreground">
                        完成一次「自动提取」后，可在此从资产库选择已有预览图作为参考（与上传二选一或叠加使用，最多 6 张）。
                      </p>
                    )}

                    {draft.referenceImageUrls.length ? (
                      <div className="mt-4 grid grid-cols-2 gap-3">
                        {draft.referenceImageUrls.map((url) => (
                          <div key={url} className="group relative overflow-hidden rounded-2xl border border-border">
                            <img
                              src={url}
                              alt="reference"
                              className="aspect-square w-full object-cover"
                              loading="lazy"
                              decoding="async"
                              referrerPolicy="no-referrer"
                            />
                            <button
                              onClick={() => removeReferenceImage(url)}
                              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-2xl border border-dashed border-border p-5 text-center text-xs text-muted-foreground">
                        {canUseAssetLibraryForReference
                          ? "还没有参考图片。可从上方资产库点选，或本地上传；也可直接文生图。"
                          : "还没有参考图片。提取完成后可从资产库选择或本地上传；直接生成会走文生图。"}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-3xl border border-border bg-card/40 p-5">
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">资产名称</label>
                        <input
                          value={draft.name}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, name: event.target.value }))
                          }
                          className="w-full rounded-xl border border-border bg-input px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">出图模型</label>
                        <select
                          value={normalizeImageModel(draft.referenceImageUrls, draft.imageModel)}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, imageModel: event.target.value }))
                          }
                          className="w-full rounded-xl border border-border bg-input px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                        >
                          {imageModels.map((model) => (
                            <option
                              key={model}
                              value={model}
                              disabled={model === "WanX 2.1 Image Edit" && !draft.referenceImageUrls.length}
                            >
                              {model}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="mt-4 space-y-2">
                      <label className="text-sm font-medium">资产描述</label>
                      <textarea
                        rows={4}
                        value={draft.description}
                        onChange={(event) =>
                          setDraft((current) => ({ ...current, description: event.target.value }))
                        }
                        placeholder="补充角色特征、场景氛围或道具细节"
                        className="w-full resize-none rounded-2xl border border-border bg-input px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>

                    <div className="mt-4 space-y-2">
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <Sparkles className="h-4 w-4 text-primary" />
                        生成提示词
                      </label>
                      <textarea
                        rows={8}
                        value={draft.generationPrompt}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            generationPrompt: event.target.value,
                          }))
                        }
                        placeholder="文本模型提取后会自动填入资产提示词，你可以继续润色后再出图"
                        className="w-full resize-none rounded-2xl border border-border bg-input px-3 py-3 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/50"
                      />
                    </div>

                    <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
                      <div className="space-y-2">
                        <label className="text-sm font-medium">负面提示词</label>
                        <textarea
                          rows={4}
                          value={draft.negativePrompt}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              negativePrompt: event.target.value,
                            }))
                          }
                          placeholder="例如：模糊、畸形、多余肢体、错误透视"
                          className="w-full resize-none rounded-2xl border border-border bg-input px-3 py-3 text-sm leading-6 focus:outline-none focus:ring-2 focus:ring-primary/50"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-sm font-medium">画幅比例</label>
                        <div className="grid grid-cols-1 gap-2">
                          {aspectRatios.map((ratio) => (
                            <button
                              key={ratio}
                              onClick={() =>
                                setDraft((current) => ({ ...current, aspectRatio: ratio }))
                              }
                              className={cn(
                                "rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors",
                                draft.aspectRatio === ratio
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border hover:border-primary/50 hover:bg-accent",
                              )}
                            >
                              {ratio}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl border border-border bg-card/40 p-5">
                    <div className="text-sm font-medium">操作建议</div>
                    <div className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                      <p>1. 先检查文本模型给出的名称、描述和提示词是否足够聚焦。</p>
                      <p>2. 有参考图时，优先保持 `WanX 2.1 Image Edit`，更适合定向改图和风格对齐。</p>
                      <p>3. 没有参考图时，直接使用 `Wan 2.6 T2I` 生成资产设定图更稳。</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-[420px] flex-col items-center justify-center rounded-[32px] border border-dashed border-border bg-card/20 text-center">
              <ImageIcon className="mb-4 h-12 w-12 text-primary/60" />
              <h3 className="text-lg font-semibold">先选中一个资产</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                自动提取完成后，这里会展示文本模型生成的提示词。你可以继续编辑，再上传参考图生成对应资产图。
              </p>
            </div>
          )}
        </section>
      </div>

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h3 className="text-lg font-semibold">新增{tabs.find((tab) => tab.id === activeTab)?.name}</h3>
                <p className="text-xs text-muted-foreground">先创建资产，再在右侧继续编辑提示词和参考图</p>
              </div>
              <button
                onClick={() => {
                  setCreateOpen(false);
                  setCreateDraftState({
                    name: "",
                    description: "",
                    generationPrompt: "",
                    referenceImageUrls: [],
                  });
                }}
                className="rounded-full p-2 transition-colors hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div className="space-y-2">
                <label className="text-sm font-medium">名称</label>
                <input
                  value={createDraftState.name}
                  onChange={(event) =>
                    setCreateDraftState((current) => ({ ...current, name: event.target.value }))
                  }
                  className="w-full rounded-xl border border-border bg-input px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">描述</label>
                <textarea
                  rows={4}
                  value={createDraftState.description}
                  onChange={(event) =>
                    setCreateDraftState((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                  className="w-full resize-none rounded-2xl border border-border bg-input px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">初始提示词</label>
                <textarea
                  rows={5}
                  value={createDraftState.generationPrompt}
                  onChange={(event) =>
                    setCreateDraftState((current) => ({
                      ...current,
                      generationPrompt: event.target.value,
                    }))
                  }
                  placeholder="可选，创建后仍可继续修改"
                  className="w-full resize-none rounded-2xl border border-border bg-input px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-sm font-medium">参考图</label>
                  <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium transition-colors hover:bg-accent">
                    {pendingAction === "create-upload-reference" ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4" />
                    )}
                    上传参考图
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(event) => void handleCreateReferenceUpload(event)}
                    />
                  </label>
                </div>

                {canUseAssetLibraryForReference ? (
                  <div className="rounded-2xl border border-border/80 bg-card/30 p-3">
                    <ReferenceAssetPicker
                      projectId={currentProjectId}
                      selectedAssetId={null}
                      onSelect={handleCreateReferenceLibrarySelect}
                    />
                  </div>
                ) : (
                  <p className="text-[11px] leading-5 text-muted-foreground">
                    完成「自动提取」后，新建资产时也可从资产库点选参考图。
                  </p>
                )}

                {createDraftState.referenceImageUrls.length ? (
                  <div className="grid grid-cols-3 gap-3">
                    {createDraftState.referenceImageUrls.map((url) => (
                      <div key={url} className="group relative overflow-hidden rounded-2xl border border-border">
                        <img
                          src={url}
                          alt="reference"
                          className="aspect-square w-full object-cover"
                          loading="lazy"
                          decoding="async"
                          referrerPolicy="no-referrer"
                        />
                        <button
                          onClick={() => removeCreateReferenceImage(url)}
                          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-border p-4 text-xs text-muted-foreground">
                    可选。新建时就可以绑定参考图，后续出图会更容易保持角色、场景和道具的一致性。
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 border-t border-border bg-card/40 px-6 py-4">
              <button
                onClick={() => {
                  setCreateOpen(false);
                  setCreateDraftState({
                    name: "",
                    description: "",
                    generationPrompt: "",
                    referenceImageUrls: [],
                  });
                }}
                className="rounded-xl border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                取消
              </button>
              <button
                onClick={() => void handleCreate()}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                {pendingAction === "create" ? "创建中..." : "创建资产"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
