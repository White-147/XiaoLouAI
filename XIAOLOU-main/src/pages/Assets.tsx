import {
  ChevronDown,
  ChevronRight,
  Clock,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  LoaderCircle,
  Map,
  Package,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GeneratedMediaPlaceholder,
  getGeneratedMediaUrl,
} from "../components/media/GenerationPlaceholder";
import { cn } from "../lib/utils";
import {
  createAsset,
  deleteAsset,
  deleteCanvasProject,
  getCanvasProject,
  getProject,
  listAssets,
  listCanvasProjects,
  saveCanvasProject,
  updateAsset,
  uploadFile,
  type Asset,
  type CanvasProjectSummary,
} from "../lib/api";
import { useCurrentProjectId } from "../lib/session";
import { useNavigate } from "react-router-dom";
import { generateGridThumbnail } from "../lib/grid-thumbnail";

const CATEGORY_CONFIG = [
  { id: "all", label: "全部", icon: FolderOpen },
  { id: "character", label: "角色", icon: Users },
  { id: "scene", label: "场景", icon: Map },
  { id: "prop", label: "道具", icon: Package },
  { id: "style", label: "风格", icon: ImageIcon },
  { id: "video_ref", label: "视频素材", icon: Video },
] as const;

type AssetFormState = {
  mode: "create" | "edit";
  assetId: string | null;
  assetType: string;
  name: string;
  description: string;
  localFile: File | null;
  localFilePreviewUrl: string | null;
};

const ASSET_UPLOAD_ACCEPT =
  "image/jpeg,image/png,image/webp,image/bmp,image/x-ms-bmp,.jpg,.jpeg,.png,.webp,.bmp,video/*";

function assetPreviewUrl(asset: Asset) {
  return getGeneratedMediaUrl(asset.previewUrl);
}

function assetMediaUrl(asset: Asset) {
  return getGeneratedMediaUrl(asset.mediaUrl) || getGeneratedMediaUrl(asset.previewUrl) || null;
}

function isVideoAsset(asset: Asset) {
  return asset.mediaKind === "video" || asset.assetType === "video_ref";
}

function canPreviewAssetVideo(asset: Asset) {
  return isVideoAsset(asset) && Boolean(getGeneratedMediaUrl(asset.mediaUrl));
}

function assetTypeLabel(assetType: string) {
  const match = CATEGORY_CONFIG.find((item) => item.id === assetType);
  return match?.label || assetType;
}

type SidebarSection = "assets" | "canvas-projects";

export default function Assets() {
  const navigate = useNavigate();
  const [currentProjectId] = useCurrentProjectId();
  const [projectTitle, setProjectTitle] = useState("当前项目");
  const [assets, setAssets] = useState<Asset[]>([]);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [assetsLoadedOnce, setAssetsLoadedOnce] = useState(false);
  const [assetsRefreshing, setAssetsRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formState, setFormState] = useState<AssetFormState | null>(null);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);

  const [activeSection, setActiveSection] = useState<SidebarSection>("assets");
  const [assetsExpanded, setAssetsExpanded] = useState(true);
  const [canvasExpanded, setCanvasExpanded] = useState(true);
  const [canvasProjects, setCanvasProjects] = useState<CanvasProjectSummary[]>([]);
  const [canvasLoadedOnce, setCanvasLoadedOnce] = useState(false);
  const [canvasRefreshing, setCanvasRefreshing] = useState(false);
  const [deletingCanvasId, setDeletingCanvasId] = useState<string | null>(null);
  const assetLoadRequestIdRef = useRef(0);
  const projectTitleRequestIdRef = useRef(0);
  const canvasLoadRequestIdRef = useRef(0);
  const canvasThumbnailBackfillRunRef = useRef(0);

  const loadProjectTitle = useCallback(async () => {
    const requestId = ++projectTitleRequestIdRef.current;
    try {
      const project = await getProject(currentProjectId);
      if (requestId !== projectTitleRequestIdRef.current) return;
      setProjectTitle(project.title);
    } catch {
      // keep the previous title if the lightweight project request fails
    }
  }, [currentProjectId]);

  const loadAssets = useCallback(async () => {
    const requestId = ++assetLoadRequestIdRef.current;
    setAssetsRefreshing(true);
    try {
      const assetResponse = await listAssets(currentProjectId);
      if (requestId !== assetLoadRequestIdRef.current) return;
      setAssets(assetResponse.items);
      setAssetsLoadedOnce(true);
    } catch {
      // keep the latest settled asset list on refresh failures
    } finally {
      if (requestId === assetLoadRequestIdRef.current) {
        setAssetsRefreshing(false);
      }
    }
  }, [currentProjectId]);

  const backfillCanvasThumbnails = useCallback(
    async (projects: CanvasProjectSummary[]) => {
      const runId = ++canvasThumbnailBackfillRunRef.current;
      const missing = projects.filter((project) => !project.thumbnailUrl);
      if (missing.length === 0) return;

      for (const project of missing) {
        if (runId !== canvasThumbnailBackfillRunRef.current) return;

        try {
          const detail = await getCanvasProject(project.id);
          if (runId !== canvasThumbnailBackfillRunRef.current) return;

          const data = detail.canvasData as {
            nodes?: { type?: string; resultUrl?: string; status?: string }[];
          } | null;
          const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
          const imageUrls = nodes
            .filter(
              (node) =>
                node.type === "Image" &&
                node.status === "success" &&
                node.resultUrl &&
                !node.resultUrl.startsWith("data:"),
            )
            .map((node) => {
              const url = node.resultUrl!;
              if (/^https?:\/\//i.test(url)) {
                try {
                  const parsed = new URL(url);
                  if (parsed.pathname.startsWith("/uploads/")) return parsed.pathname;
                } catch {
                  // keep original url when parsing fails
                }
              }
              return url;
            })
            .slice(0, 4);

          if (imageUrls.length === 0) continue;

          const blob = await generateGridThumbnail(imageUrls);
          if (runId !== canvasThumbnailBackfillRunRef.current || !blob) continue;

          const file = new File([blob], `canvas-thumb-${Date.now()}.jpg`, { type: "image/jpeg" });
          const uploaded = await uploadFile(file, "canvas-thumbnail");
          const thumbUrl = uploaded.url || uploaded.urlPath;

          await saveCanvasProject({ id: project.id, thumbnailUrl: thumbUrl });
          if (runId !== canvasThumbnailBackfillRunRef.current) return;

          setCanvasProjects((prev) =>
            prev.map((item) => (item.id === project.id ? { ...item, thumbnailUrl: thumbUrl } : item)),
          );
        } catch {
          // non-fatal
        }
      }
    },
    [],
  );

  const loadCanvasProjects = useCallback(async () => {
    const requestId = ++canvasLoadRequestIdRef.current;
    canvasThumbnailBackfillRunRef.current += 1;
    setCanvasRefreshing(true);
    try {
      const response = await listCanvasProjects();
      if (requestId !== canvasLoadRequestIdRef.current) return;
      setCanvasProjects(response.items);
      setCanvasLoadedOnce(true);
      void backfillCanvasThumbnails(response.items);
    } catch {
      // keep the latest settled canvas project list on refresh failures
    } finally {
      if (requestId === canvasLoadRequestIdRef.current) {
        setCanvasRefreshing(false);
      }
    }
  }, [backfillCanvasThumbnails]);

  const refreshAssetsView = useCallback(() => {
    void loadProjectTitle();
    void loadAssets();
  }, [loadAssets, loadProjectTitle]);

  useEffect(() => {
    refreshAssetsView();
  }, [refreshAssetsView]);

  useEffect(() => {
    const refresh = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }
      refreshAssetsView();
    };

    const intervalId = window.setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
    };
  }, [refreshAssetsView]);

  useEffect(() => {
    void loadCanvasProjects();
  }, [loadCanvasProjects]);

  const counts = useMemo(() => {
    const next = Object.fromEntries(CATEGORY_CONFIG.map((item) => [item.id, 0])) as Record<
      string,
      number
    >;
    next.all = assets.length;

    for (const asset of assets) {
      if (asset.assetType in next) {
        next[asset.assetType] += 1;
      }
    }

    return next;
  }, [assets]);

  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      const matchCategory = activeCategory === "all" || asset.assetType === activeCategory;
      const matchQuery =
        !query ||
        asset.name.includes(query) ||
        asset.description.includes(query) ||
        asset.assetType.includes(query);

      return matchCategory && matchQuery;
    });
  }, [activeCategory, assets, query]);

  const showInitialAssetsLoading = !assetsLoadedOnce && assetsRefreshing;
  const showInitialCanvasLoading = !canvasLoadedOnce && canvasRefreshing;

  const openCreate = () => {
    setFormState({
      mode: "create",
      assetId: null,
      assetType: activeCategory === "all" ? "character" : activeCategory,
      name: "",
      description: "",
      localFile: null,
      localFilePreviewUrl: null,
    });
  };

  const openEdit = (asset: Asset) => {
    setFormState({
      mode: "edit",
      assetId: asset.id,
      assetType: asset.assetType,
      name: asset.name,
      description: asset.description,
      localFile: null,
      localFilePreviewUrl: null,
    });
  };

  const closeForm = () => {
    setFormState(null);
  };

  const handleSubmit = async () => {
    if (!formState || !formState.name.trim()) return;

    setSubmitting(true);
    try {
      let previewUrl: string | null | undefined = undefined;
      let mediaUrl: string | null | undefined = undefined;
      let mediaKind: string | null | undefined = undefined;

      if (formState.localFile) {
        const isVideo = formState.localFile.type.startsWith("video/");
        const kind = isVideo ? "asset-video" : "asset-image";
        const uploaded = await uploadFile(formState.localFile, kind);
        mediaKind = isVideo ? "video" : "image";
        // 使用完整的公共 URL，确保在前端直接可预览，
        // 同时后端仍可通过 pathname 解析到 /uploads/ 读取文件。
        mediaUrl = uploaded.url;
        if (!isVideo) {
          previewUrl = uploaded.url;
        }
      }

      if (formState.mode === "create") {
        await createAsset(currentProjectId, {
          assetType: formState.assetType,
          name: formState.name.trim(),
          description: formState.description.trim(),
          previewUrl,
          mediaKind,
          mediaUrl,
        });
      } else if (formState.assetId) {
        await updateAsset(currentProjectId, formState.assetId, {
          assetType: formState.assetType,
          name: formState.name.trim(),
          description: formState.description.trim(),
          ...(previewUrl !== undefined ? { previewUrl } : {}),
          ...(mediaKind !== undefined ? { mediaKind } : {}),
          ...(mediaUrl !== undefined ? { mediaUrl } : {}),
        });
      }

      closeForm();
      await loadAssets();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Upload failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (assetId: string) => {
    setDeletingId(assetId);
    try {
      await deleteAsset(currentProjectId, assetId);
      await loadAssets();
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteCanvasProject = async (projectId: string) => {
    // Guard: prevent double-deleting the same project
    if (deletingCanvasId === projectId) return;

    // Optimistic removal — card disappears immediately so user can't interact with it
    const removed = canvasProjects.find((p) => p.id === projectId);
    setCanvasProjects((prev) => prev.filter((p) => p.id !== projectId));
    setDeletingCanvasId(projectId);

    try {
      await deleteCanvasProject(projectId);
      // Silent background refresh to sync server truth (no await — UI is already updated)
      void loadCanvasProjects().catch(() => {});
    } catch (err) {
      // API failed — restore the removed card
      if (removed) {
        setCanvasProjects((prev) => {
          // Re-insert in original position (sorted by updatedAt desc)
          const next = [...prev, removed].sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          );
          return next;
        });
      }
      console.error("[Assets] Failed to delete canvas project:", err);
    } finally {
      setDeletingCanvasId(null);
    }
  };

  return (
    <div className="flex h-full w-full bg-background">
      <aside className="flex w-72 flex-col border-r border-border bg-card/30">
        <div className="border-b border-border p-4">
          <h2 className="flex items-center gap-2 font-medium">
            <FolderOpen className="h-4 w-4 text-primary" />
            资产库
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">当前项目：{projectTitle}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
          {/* 全部资产（可折叠） */}
          <button
            onClick={() => {
              setAssetsExpanded((v) => !v);
              setActiveSection("assets");
              setActiveCategory("all");
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              activeSection === "assets" && activeCategory === "all"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-3">
              {assetsExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <FolderOpen className="h-4 w-4" />
              全部
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                activeSection === "assets" && activeCategory === "all" ? "bg-primary/20" : "bg-secondary",
              )}
            >
              {counts.all ?? 0}
            </span>
          </button>

          {assetsExpanded ? (
            <div className="ml-4 mt-1 space-y-0.5 border-l border-border/50 pl-2">
              {CATEGORY_CONFIG.filter((item) => item.id !== "all").map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveSection("assets");
                    setActiveCategory(item.id);
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                    activeSection === "assets" && activeCategory === item.id
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <span className="flex items-center gap-3">
                    <item.icon className="h-3.5 w-3.5" />
                    {item.label}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs",
                      activeSection === "assets" && activeCategory === item.id ? "bg-primary/20" : "bg-secondary",
                    )}
                  >
                    {counts[item.id] ?? 0}
                  </span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="my-2" />

          {/* 画布项目（可折叠） */}
          <button
            onClick={() => {
              setCanvasExpanded((v) => !v);
              setActiveSection("canvas-projects");
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              activeSection === "canvas-projects"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-3">
              {canvasExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <LayoutGrid className="h-4 w-4" />
              画布项目
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                activeSection === "canvas-projects" ? "bg-primary/20" : "bg-secondary",
              )}
            >
              {canvasProjects.length}
            </span>
          </button>

          {canvasExpanded && activeSection === "canvas-projects" ? (
            <div className="ml-4 mt-1 space-y-0.5 border-l border-border/50 pl-2">
              {showInitialCanvasLoading ? (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  加载中...
                </div>
              ) : canvasProjects.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  暂无画布项目
                </p>
              ) : (
                canvasProjects.map((cp) => (
                  <div
                    key={cp.id}
                    className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <span className="flex items-center gap-2 truncate">
                      <Clock className="h-3.5 w-3.5 shrink-0 opacity-60" />
                      <span className="truncate">{cp.title}</span>
                    </span>
                  </div>
                ))
              )}
            </div>
          ) : null}
        </div>
      </aside>

      <section className="flex flex-1 flex-col overflow-hidden">
        {activeSection === "assets" ? (
          <>
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card/30 px-6">
              <div className="relative w-80">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索资产名称或描述"
                  className="w-full rounded-lg border border-border bg-input py-2 pl-9 pr-4 text-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div className="flex items-center gap-3">
                {assetsRefreshing ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
                <button
                  onClick={refreshAssetsView}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                >
                  刷新
                </button>
                <button
                  onClick={openCreate}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Plus className="h-4 w-4" />
                  新增资产
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {showInitialAssetsLoading ? (
                <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
                  <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm">加载资产中...</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-5">
                {filteredAssets.map((asset) => {
                  const pendingDelete = deletingId === asset.id;
                  const previewUrl = assetPreviewUrl(asset);

                  return (
                    <article
                      key={asset.id}
                      className="glass-panel group flex flex-col overflow-hidden rounded-xl"
                    >
                      <div className="relative aspect-square bg-muted">
                        <button
                          onClick={() => setPreviewAsset(asset)}
                          className="absolute inset-0 block h-full w-full overflow-hidden text-left"
                        >
                          {previewUrl ? (
                            <img
                              src={previewUrl}
                              alt={asset.name}
                              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <GeneratedMediaPlaceholder
                              kind={isVideoAsset(asset) ? "video" : "image"}
                              className="h-full w-full"
                              description="生成后会在这里显示预览"
                            />
                          )}
                        </button>

                        {isVideoAsset(asset) ? (
                          <div className="absolute left-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur">
                            视频素材
                          </div>
                        ) : null}

                        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={() => setPreviewAsset(asset)}
                            className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                            title="预览"
                          >
                            <Play className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => openEdit(asset)}
                            className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                            title="编辑"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => void handleDelete(asset.id)}
                            disabled={pendingDelete}
                            className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
                            title="删除"
                          >
                            {pendingDelete ? (
                              <LoaderCircle className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-1 flex-col p-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <h3 className="truncate text-sm font-medium">{asset.name}</h3>
                          <span className="rounded bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                            {assetTypeLabel(asset.assetType)}
                          </span>
                        </div>
                        <p className="line-clamp-2 flex-1 text-xs text-muted-foreground">
                          {asset.description || "暂无描述"}
                        </p>
                      </div>
                    </article>
                  );
                })}
                </div>
              )}

              {!showInitialAssetsLoading && filteredAssets.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                  <FolderOpen className="mb-4 h-12 w-12 opacity-20" />
                  <p>当前分类下还没有资产</p>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card/30 px-6">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <LayoutGrid className="h-4 w-4 text-primary" />
                画布项目
                <span className="text-xs text-muted-foreground">（同账号多设备自动同步）</span>
              </h3>
              <div className="flex items-center gap-3">
                {canvasRefreshing ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
                <button
                  onClick={() => void loadCanvasProjects()}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                >
                  刷新
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {showInitialCanvasLoading ? (
                <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
                  <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm">加载画布项目中...</p>
                </div>
              ) : canvasProjects.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                  <LayoutGrid className="mb-4 h-12 w-12 opacity-20" />
                  <p>暂无画布项目</p>
                  <p className="mt-1 text-xs">在天幕中点击 SAVE 后，项目会自动保存到这里</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-5">
                  {canvasProjects.map((cp) => (
                    <article
                      key={cp.id}
                      className="glass-panel group flex cursor-pointer flex-col overflow-hidden rounded-xl"
                      onClick={() => navigate(`/create/canvas?canvasProjectId=${cp.id}`)}
                    >
                      <div className="relative aspect-video bg-muted">
                        {cp.thumbnailUrl ? (
                          <img
                            src={getGeneratedMediaUrl(cp.thumbnailUrl) || cp.thumbnailUrl}
                            alt={cp.title}
                            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center">
                            <LayoutGrid className="h-10 w-10 opacity-20" />
                          </div>
                        )}

                        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/create/canvas?canvasProjectId=${cp.id}`); }}
                            className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                            title="打开"
                          >
                            <Play className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); void handleDeleteCanvasProject(cp.id); }}
                            className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
                            title="删除"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-1 flex-col p-3">
                        <h3 className="truncate text-sm font-medium">{cp.title}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {new Date(cp.updatedAt).toLocaleString("zh-CN")}
                        </p>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {formState ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-border bg-background p-6 shadow-2xl">
            <h3 className="mb-6 text-lg font-semibold">
              {formState.mode === "create" ? "新增资产" : "编辑资产"}
            </h3>

            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">资产类型</label>
                <select
                  value={formState.assetType}
                  onChange={(event) =>
                    setFormState((current) =>
                      current ? { ...current, assetType: event.target.value } : current,
                    )
                  }
                  className="w-full rounded-lg border border-border bg-input px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  {CATEGORY_CONFIG.filter((item) => item.id !== "all").map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">资产名称</label>
                <input
                  value={formState.name}
                  onChange={(event) =>
                    setFormState((current) =>
                      current ? { ...current, name: event.target.value } : current,
                    )
                  }
                  className="w-full rounded-lg border border-border bg-input px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">本地文件（图片或视频，可选）</label>
                <input
                  type="file"
                  accept={ASSET_UPLOAD_ACCEPT}
                  onChange={(event) => {
                    const file = event.target.files?.[0] ?? null;
                    setFormState((current) => {
                      if (!current) return current;
                      // 尽量释放旧的预览 URL，避免内存泄露（忽略 revoke 失败）
                      if (current.localFilePreviewUrl) {
                        try {
                          URL.revokeObjectURL(current.localFilePreviewUrl);
                        } catch {
                          // ignore
                        }
                      }
                      return {
                        ...current,
                        localFile: file,
                        localFilePreviewUrl: file ? URL.createObjectURL(file) : null,
                      };
                    });
                  }}
                  className="w-full text-sm text-muted-foreground file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-foreground hover:file:bg-accent"
                />
                {formState.localFile ? (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      已选择文件：{formState.localFile.name}
                    </p>
                    {formState.localFilePreviewUrl && formState.localFile.type.startsWith("image/") ? (
                      <div className="mt-2 inline-flex items-center gap-3 rounded-lg border border-dashed border-border bg-muted/40 p-2">
                        <div className="h-16 w-16 overflow-hidden rounded-md border border-border bg-background">
                          <img
                            src={formState.localFilePreviewUrl}
                            alt={formState.localFile.name}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          本地图片预览，仅用于确认上传内容。
                        </span>
                      </div>
                    ) : formState.localFilePreviewUrl && formState.localFile.type.startsWith("video/") ? (
                      <div className="mt-2 inline-flex items-center gap-3 rounded-lg border border-dashed border-border bg-muted/40 p-2">
                        <div className="h-16 w-16 overflow-hidden rounded-md border border-border bg-background">
                          <video
                            src={formState.localFilePreviewUrl}
                            className="h-full w-full object-cover"
                            muted
                          />
                        </div>
                        <span className="text-xs text-muted-foreground">
                          本地视频预览（静音），用于确认上传内容。
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    支持直接上传本地图片或视频文件，系统会自动保存为当前资产的素材。
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">描述</label>
                <textarea
                  value={formState.description}
                  onChange={(event) =>
                    setFormState((current) =>
                      current ? { ...current, description: event.target.value } : current,
                    )
                  }
                  className="h-28 w-full resize-none rounded-lg border border-border bg-input px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50"
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={closeForm}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
              >
                取消
              </button>
              <button
                onClick={() => void handleSubmit()}
                disabled={submitting || !formState.name.trim()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "提交中..." : formState.mode === "create" ? "创建资产" : "保存修改"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewAsset ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl rounded-2xl border border-border bg-background shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold">{previewAsset.name}</h3>
                <p className="text-xs text-muted-foreground">
                  {isVideoAsset(previewAsset) ? "视频素材预览" : "图片资产预览"}
                </p>
              </div>
              <button
                onClick={() => setPreviewAsset(null)}
                className="rounded-md p-2 transition-colors hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-6 p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="overflow-hidden rounded-xl border border-border bg-black">
                {canPreviewAssetVideo(previewAsset) ? (
                  <video
                    src={assetMediaUrl(previewAsset) || undefined}
                    poster={assetPreviewUrl(previewAsset) || undefined}
                    controls
                    className="h-full min-h-[320px] w-full object-contain"
                  />
                ) : assetPreviewUrl(previewAsset) ? (
                  <img
                    src={assetPreviewUrl(previewAsset) || undefined}
                    alt={previewAsset.name}
                    className="h-full min-h-[320px] w-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <GeneratedMediaPlaceholder
                    kind={isVideoAsset(previewAsset) ? "video" : "image"}
                    className="h-full min-h-[320px] w-full bg-black text-zinc-300"
                    description="当前资产还没有可预览的真实媒体"
                  />
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">资产类型</div>
                  <div className="mt-1 font-medium">{assetTypeLabel(previewAsset.assetType)}</div>
                </div>
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">描述</div>
                  <div className="mt-1 text-sm leading-6">
                    {previewAsset.description || "暂无描述"}
                  </div>
                </div>
                {assetMediaUrl(previewAsset) ? (
                  <a
                    href={assetMediaUrl(previewAsset) || undefined}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    打开原始文件
                  </a>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
