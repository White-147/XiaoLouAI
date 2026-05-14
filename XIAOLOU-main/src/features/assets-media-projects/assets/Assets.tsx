import { FolderOpen, LayoutGrid, LoaderCircle, Plus, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createAsset,
  deleteAsset,
  deleteAgentCanvasProject,
  deleteCanvasProject,
  getAgentCanvasProject,
  getCanvasProject,
  getProject,
  listAgentCanvasProjects,
  listCanvasProjects,
  listVideoReplaceJobs,
  saveAgentCanvasProject,
  saveCanvasProject,
  syncVideoReplaceJobAsset,
  updateAsset,
  uploadFile,
  type Asset,
  type AgentCanvasProjectSummary,
  type CanvasProjectSummary,
} from "./api/assets";
import { useActorId } from "../../../lib/actor-session";
import { isRetiredLegacyMediaUrl } from "../../../lib/media-url-policy";
import { useCurrentProjectId } from "../../../lib/session";
import { useNavigate } from "react-router-dom";
import { generateGridThumbnail } from "../../../lib/grid-thumbnail";
import {
  SOURCE_MODULE_LABEL,
  assetMatchesQuery,
  assetMediaUrl,
  imageAssetTypeLabel,
  isAgentCanvasProjectAsset,
  isVideoAsset,
  isVideoReplaceAsset,
  type AssetFormState,
  type CategoryFilter,
  type RootCategory,
  type SidebarSection,
} from "./assetDisplay";
import {
  ASSETS_BACKGROUND_REFRESH_MS,
  fetchProjectAssets,
  getCachedProjectAssets,
  groupByLocalDate,
  normalizeAgentCanvasProjectSummaries,
  normalizeCanvasProjectSummaries,
  projectTitleCache,
  setCachedProjectAssets,
  shouldRefreshProjectAssets,
  syncedVideoReplaceProjects,
} from "./assetCache";
import { AssetFormModal } from "./AssetFormModal";
import { AssetGrid } from "./AssetGrid";
import { AssetPreviewModal } from "./AssetPreviewModal";
import { AssetSidebar } from "./AssetSidebar";
import { CanvasProjectSection } from "./CanvasProjectSection";

// ── Hierarchical category model ────────────────────────────────────
//   Root: image | video
//   Image sub-buckets: character / scene / prop / style (based on assetType)
//   Video sub-buckets: video_create / canvas / video_replace (based on sourceModule)
export default function Assets() {
  const navigate = useNavigate();
  const actorId = useActorId();
  const [currentProjectId] = useCurrentProjectId();
  const [projectTitle, setProjectTitle] = useState(
    () => projectTitleCache.get(currentProjectId) || "当前项目",
  );
  const [assets, setAssets] = useState<Asset[]>(() => getCachedProjectAssets(currentProjectId)?.items || []);
  // Default landing view: image assets, all buckets.
  const [filter, setFilter] = useState<CategoryFilter>({ root: "image", assetType: "all" });
  const [query, setQuery] = useState("");
  const [assetsLoadedOnce, setAssetsLoadedOnce] = useState(() => Boolean(getCachedProjectAssets(currentProjectId)));
  const [assetsRefreshing, setAssetsRefreshing] = useState(false);
  const [syncingVideoReplaceHistory, setSyncingVideoReplaceHistory] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [formState, setFormState] = useState<AssetFormState | null>(null);
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);

  const [activeSection, setActiveSection] = useState<SidebarSection>("assets");
  const [imageExpanded, setImageExpanded] = useState(true);
  const [videoExpanded, setVideoExpanded] = useState(true);
  const [canvasExpanded, setCanvasExpanded] = useState(true);
  const [canvasProjects, setCanvasProjects] = useState<CanvasProjectSummary[]>([]);
  const [canvasLoadedOnce, setCanvasLoadedOnce] = useState(false);
  const [canvasRefreshing, setCanvasRefreshing] = useState(false);
  const [deletingCanvasId, setDeletingCanvasId] = useState<string | null>(null);
  const [agentCanvasProjects, setAgentCanvasProjects] = useState<AgentCanvasProjectSummary[]>([]);
  const [agentCanvasLoadedOnce, setAgentCanvasLoadedOnce] = useState(false);
  const [agentCanvasRefreshing, setAgentCanvasRefreshing] = useState(false);
  const [deletingAgentCanvasId, setDeletingAgentCanvasId] = useState<string | null>(null);
  const assetLoadRequestIdRef = useRef(0);
  const projectTitleRequestIdRef = useRef(0);
  const canvasLoadRequestIdRef = useRef(0);
  const canvasThumbnailBackfillRunRef = useRef(0);
  const agentCanvasLoadRequestIdRef = useRef(0);
  const agentCanvasThumbnailBackfillRunRef = useRef(0);

  const loadProjectTitle = useCallback(async () => {
    const requestId = ++projectTitleRequestIdRef.current;
    try {
      const project = await getProject(currentProjectId);
      if (requestId !== projectTitleRequestIdRef.current) return;
      projectTitleCache.set(currentProjectId, project.title);
      setProjectTitle(project.title);
    } catch {
      /* keep previous */
    }
  }, [actorId, currentProjectId]);

  const loadAssets = useCallback(async (options: { force?: boolean; onlyIfStale?: boolean; silent?: boolean } = {}) => {
    const requestId = ++assetLoadRequestIdRef.current;
    const cached = getCachedProjectAssets(currentProjectId);

    if (!options.force && options.onlyIfStale && cached && !shouldRefreshProjectAssets(currentProjectId)) {
      setAssets(cached.items);
      setAssetsLoadedOnce(true);
      return;
    }

    if (cached) {
      setAssets(cached.items);
      setAssetsLoadedOnce(true);
    }

    if (!options.silent) {
      setAssetsRefreshing(true);
    }

    try {
      const items = await fetchProjectAssets(currentProjectId);
      if (requestId !== assetLoadRequestIdRef.current) return;
      setCachedProjectAssets(currentProjectId, items);
      setAssets(items);
      setAssetsLoadedOnce(true);
    } catch {
      /* keep last list */
    } finally {
      if (requestId === assetLoadRequestIdRef.current) {
        setAssetsRefreshing(false);
      }
    }
  }, [actorId, currentProjectId]);

  const backfillCanvasThumbnails = useCallback(
    async (projects: CanvasProjectSummary[]) => {
      const runId = ++canvasThumbnailBackfillRunRef.current;
      const missing = normalizeCanvasProjectSummaries(projects).filter((project) => !project.thumbnailUrl);
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
                !isRetiredLegacyMediaUrl(node.resultUrl) &&
                !node.resultUrl.startsWith("data:"),
            )
            .map((node) => node.resultUrl!)
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
            normalizeCanvasProjectSummaries(
              prev.map((item) => (item.id === project.id ? { ...item, thumbnailUrl: thumbUrl } : item)),
            ),
          );
        } catch {
          /* non-fatal */
        }
      }
    },
    [],
  );

  const backfillAgentCanvasThumbnails = useCallback(
    async (projects: AgentCanvasProjectSummary[]) => {
      const runId = ++agentCanvasThumbnailBackfillRunRef.current;
      const missing = normalizeAgentCanvasProjectSummaries(projects).filter((project) => !project.thumbnailUrl);
      if (missing.length === 0) return;

      for (const project of missing) {
        if (runId !== agentCanvasThumbnailBackfillRunRef.current) return;

        try {
          const detail = await getAgentCanvasProject(project.id);
          if (runId !== agentCanvasThumbnailBackfillRunRef.current) return;

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
                !isRetiredLegacyMediaUrl(node.resultUrl) &&
                !node.resultUrl.startsWith("data:"),
            )
            .map((node) => node.resultUrl!)
            .slice(0, 4);

          if (imageUrls.length === 0) continue;

          const blob = await generateGridThumbnail(imageUrls);
          if (runId !== agentCanvasThumbnailBackfillRunRef.current || !blob) continue;

          const file = new File([blob], `agent-canvas-thumb-${Date.now()}.jpg`, { type: "image/jpeg" });
          const uploaded = await uploadFile(file, "canvas-thumbnail");
          const thumbUrl = uploaded.url || uploaded.urlPath;

          await saveAgentCanvasProject({ id: project.id, thumbnailUrl: thumbUrl });
          if (runId !== agentCanvasThumbnailBackfillRunRef.current) return;

          setAgentCanvasProjects((prev) =>
            normalizeAgentCanvasProjectSummaries(
              prev.map((item) => (item.id === project.id ? { ...item, thumbnailUrl: thumbUrl } : item)),
            ),
          );
        } catch {
          /* non-fatal */
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
      const normalizedItems = normalizeCanvasProjectSummaries(response.items);
      setCanvasProjects(normalizedItems);
      setCanvasLoadedOnce(true);
      void backfillCanvasThumbnails(normalizedItems);
    } catch {
      /* keep */
    } finally {
      if (requestId === canvasLoadRequestIdRef.current) {
        setCanvasRefreshing(false);
      }
    }
  }, [actorId, backfillCanvasThumbnails]);

  const loadAgentCanvasProjects = useCallback(async () => {
    const requestId = ++agentCanvasLoadRequestIdRef.current;
    agentCanvasThumbnailBackfillRunRef.current += 1;
    setAgentCanvasRefreshing(true);
    try {
      const response = await listAgentCanvasProjects();
      if (requestId !== agentCanvasLoadRequestIdRef.current) return;
      const normalizedItems = normalizeAgentCanvasProjectSummaries(response.items);
      setAgentCanvasProjects(normalizedItems);
      setAgentCanvasLoadedOnce(true);
      void backfillAgentCanvasThumbnails(normalizedItems);
    } catch {
      /* keep */
    } finally {
      if (requestId === agentCanvasLoadRequestIdRef.current) {
        setAgentCanvasRefreshing(false);
      }
    }
  }, [actorId, backfillAgentCanvasThumbnails]);

  const refreshAssetsView = useCallback((options: { force?: boolean; onlyIfStale?: boolean; silent?: boolean } = {}) => {
    void loadProjectTitle();
    void loadAssets(options);
  }, [loadAssets, loadProjectTitle]);

  const syncVideoReplaceHistory = useCallback(
    async (options: { force?: boolean; silent?: boolean } = {}) => {
      if (!options.force && syncedVideoReplaceProjects.has(currentProjectId)) return;
      if (!options.silent) {
        setSyncingVideoReplaceHistory(true);
      }

      try {
        const response = await listVideoReplaceJobs(30, currentProjectId);
        const jobs = response.items.filter(
          (item) => Boolean(item.source_video_url) && item.project_id === currentProjectId,
        );
        await Promise.allSettled(
          jobs.map((item) => syncVideoReplaceJobAsset(currentProjectId, item.job_id)),
        );
        syncedVideoReplaceProjects.add(currentProjectId);
        await loadAssets({ force: true, silent: true });
      } catch {
        /* Older backend builds do not expose history sync yet. */
      } finally {
        if (!options.silent) {
          setSyncingVideoReplaceHistory(false);
        }
      }
    },
    [currentProjectId, loadAssets],
  );

  useEffect(() => {
    const cachedAssets = getCachedProjectAssets(currentProjectId);
    const cachedTitle = projectTitleCache.get(currentProjectId);

    setProjectTitle(cachedTitle || "当前项目");
    setAssets(cachedAssets?.items || []);
    setAssetsLoadedOnce(Boolean(cachedAssets));
    refreshAssetsView({
      onlyIfStale: Boolean(cachedAssets),
      silent: Boolean(cachedAssets),
    });
  }, [currentProjectId, refreshAssetsView]);

  useEffect(() => {
    void syncVideoReplaceHistory({ silent: true });
  }, [syncVideoReplaceHistory]);

  useEffect(() => {
    if (activeSection !== "canvas-projects") return;
    void import("../../canvas-agent-canvas/canvas/CanvasCreate");
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== "agent-canvas-projects") return;
    void import("../../canvas-agent-canvas/agent-canvas/AgentCanvasCreate");
  }, [activeSection]);

  useEffect(() => {
    const refresh = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      refreshAssetsView({ onlyIfStale: true, silent: true });
    };

    const intervalId = window.setInterval(refresh, ASSETS_BACKGROUND_REFRESH_MS);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
    };
  }, [refreshAssetsView]);

  useEffect(() => {
    void loadCanvasProjects();
  }, [loadCanvasProjects]);

  useEffect(() => {
    void loadAgentCanvasProjects();
  }, [loadAgentCanvasProjects]);

  const agentCanvasSyncedAssets = useMemo(
    () =>
      assets.filter(
        (asset) => asset.sourceModule === "agent_studio" && !isAgentCanvasProjectAsset(asset),
      ),
    [assets],
  );

  const legacyAgentCanvasProjectAssets = useMemo(
    () => assets.filter((asset) => isAgentCanvasProjectAsset(asset)),
    [assets],
  );

  // ── Bucket counts ─────────────────────────────────────────────────
  const counts = useMemo(() => {
    const image = {
      all: 0,
      character: 0,
      scene: 0,
      prop: 0,
      style: 0,
    } as Record<string, number>;
    const video = {
      all: 0,
      image_create: 0,
      video_create: 0,
      canvas: 0,
      video_replace: 0,
    } as Record<string, number>;

    for (const asset of assets) {
      if (isAgentCanvasProjectAsset(asset)) continue;
      if (isVideoAsset(asset)) {
        video.all += 1;
        const mod = String(asset.sourceModule || "");
        if (mod in video) video[mod] += 1;
      } else {
        image.all += 1;
        if (asset.assetType in image) image[asset.assetType] += 1;
      }
    }

    return { image, video };
  }, [assets]);

  // ── Filtering ─────────────────────────────────────────────────────
  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      if (isAgentCanvasProjectAsset(asset)) return false;
      // Root: image vs. video
      if (filter.root === "image") {
        if (isVideoAsset(asset)) return false;
        if (filter.assetType !== "all" && asset.assetType !== filter.assetType) return false;
      } else {
        if (!isVideoAsset(asset)) return false;
        if (filter.sourceModule !== "all" && asset.sourceModule !== filter.sourceModule) {
          return false;
        }
      }

      return assetMatchesQuery(asset, query);
    });
  }, [assets, filter, query]);

  const filteredAgentCanvasSyncedAssets = useMemo(
    () => agentCanvasSyncedAssets.filter((asset) => assetMatchesQuery(asset, query)),
    [agentCanvasSyncedAssets, query],
  );

  const filteredLegacyAgentCanvasProjectAssets = useMemo(
    () => legacyAgentCanvasProjectAssets.filter((asset) => assetMatchesQuery(asset, query)),
    [legacyAgentCanvasProjectAssets, query],
  );

  const assetDateGroups = useMemo(
    () => groupByLocalDate(filteredAssets, (asset) => asset.createdAt),
    [filteredAssets],
  );

  const agentCanvasSyncedAssetDateGroups = useMemo(
    () => groupByLocalDate(filteredAgentCanvasSyncedAssets, (asset) => asset.createdAt),
    [filteredAgentCanvasSyncedAssets],
  );

  const legacyAgentCanvasProjectDateGroups = useMemo(
    () => groupByLocalDate(filteredLegacyAgentCanvasProjectAssets, (asset) => asset.updatedAt || asset.createdAt),
    [filteredLegacyAgentCanvasProjectAssets],
  );

  const canvasProjectDateGroups = useMemo(
    () => groupByLocalDate(canvasProjects, (project) => project.updatedAt),
    [canvasProjects],
  );

  const agentCanvasProjectDateGroups = useMemo(
    () => groupByLocalDate(agentCanvasProjects, (project) => project.updatedAt),
    [agentCanvasProjects],
  );

  const showInitialAssetsLoading = !assetsLoadedOnce && assetsRefreshing;
  const showInitialCanvasLoading = !canvasLoadedOnce && canvasRefreshing;
  const showInitialAgentCanvasLoading = !agentCanvasLoadedOnce && agentCanvasRefreshing;

  // ── Create / edit form ────────────────────────────────────────────
  const openCreate = () => {
    const rootCategory: RootCategory = filter.root;
    setFormState({
      mode: "create",
      assetId: null,
      rootCategory,
      assetType:
        rootCategory === "video"
          ? "video_ref"
          : filter.root === "image" && filter.assetType !== "all"
            ? filter.assetType
            : "character",
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
      rootCategory: isVideoAsset(asset) ? "video" : "image",
      assetType: asset.assetType,
      name: asset.name,
      description: asset.description,
      localFile: null,
      localFilePreviewUrl: null,
    });
  };

  const closeForm = () => setFormState(null);

  const handleSubmit = async () => {
    if (!formState || !formState.name.trim()) return;

    setSubmitting(true);
    try {
      let previewUrl: string | null | undefined;
      let mediaUrl: string | null | undefined;
      let mediaKind: string | null | undefined;

      if (formState.localFile) {
        const isVideo = formState.localFile.type.startsWith("video/");
        const kind = isVideo ? "asset-video" : "asset-image";
        const uploaded = await uploadFile(formState.localFile, kind);
        mediaKind = isVideo ? "video" : "image";
        mediaUrl = uploaded.url;
        if (!isVideo) previewUrl = uploaded.url;
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
      await loadAssets({ force: true });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "提交失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (assetId: string) => {
    setDeletingId(assetId);
    try {
      await deleteAsset(currentProjectId, assetId);
      await loadAssets({ force: true });
    } finally {
      setDeletingId(null);
    }
  };

  const openVideoReplaceForAsset = (asset: Asset) => {
    if (isVideoReplaceAsset(asset) && asset.sourceTaskId) {
      navigate(`/create/video-replace?job_id=${encodeURIComponent(asset.sourceTaskId)}`);
      return;
    }
    const mediaUrl = assetMediaUrl(asset);
    if (isVideoAsset(asset) && mediaUrl) {
      navigate(`/create/video-replace?source_asset_id=${encodeURIComponent(asset.id)}`);
    }
  };

  const handleDeleteCanvasProject = async (projectId: string) => {
    if (deletingCanvasId === projectId) return;
    const removed = canvasProjects.find((p) => p.id === projectId);
    setCanvasProjects((prev) => prev.filter((p) => p.id !== projectId));
    setDeletingCanvasId(projectId);
    try {
      await deleteCanvasProject(projectId);
      void loadCanvasProjects().catch(() => {});
    } catch (err) {
      if (removed) {
        setCanvasProjects((prev) =>
          normalizeCanvasProjectSummaries([...prev, removed]),
        );
      }
      console.error("[Assets] Failed to delete canvas project:", err);
    } finally {
      setDeletingCanvasId(null);
    }
  };

  const handleDeleteAgentCanvasProject = async (projectId: string) => {
    if (deletingAgentCanvasId === projectId) return;
    const removed = agentCanvasProjects.find((p) => p.id === projectId);
    setAgentCanvasProjects((prev) => prev.filter((p) => p.id !== projectId));
    setDeletingAgentCanvasId(projectId);
    try {
      await deleteAgentCanvasProject(projectId);
      void loadAgentCanvasProjects().catch(() => {});
    } catch (err) {
      if (removed) {
        setAgentCanvasProjects((prev) =>
          normalizeAgentCanvasProjectSummaries([...prev, removed]),
        );
      }
      console.error("[Assets] Failed to delete agent canvas project:", err);
    } finally {
      setDeletingAgentCanvasId(null);
    }
  };

  const headerTitle =
    filter.root === "image"
      ? filter.assetType === "all"
        ? "图片资产"
        : imageAssetTypeLabel(filter.assetType)
      : filter.sourceModule === "all"
        ? "全部视频"
        : SOURCE_MODULE_LABEL[filter.sourceModule];

  const renderDateLine = (dateKey: string) => (
    <div className="flex items-center gap-3">
      <h4 className="text-xs font-medium text-muted-foreground">{dateKey}</h4>
      <div className="h-px flex-1 bg-border/70" />
    </div>
  );

  return (
    <div className="flex h-full w-full bg-background">
      <AssetSidebar
        projectTitle={projectTitle}
        activeSection={activeSection}
        filter={filter}
        counts={counts}
        imageExpanded={imageExpanded}
        videoExpanded={videoExpanded}
        canvasExpanded={canvasExpanded}
        canvasProjects={canvasProjects}
        showInitialCanvasLoading={showInitialCanvasLoading}
        agentCanvasSyncedAssetCount={agentCanvasSyncedAssets.length}
        legacyAgentCanvasProjectAssetCount={legacyAgentCanvasProjectAssets.length}
        agentCanvasProjectCount={agentCanvasProjects.length}
        onActiveSectionChange={setActiveSection}
        onFilterChange={setFilter}
        onImageExpandedChange={setImageExpanded}
        onVideoExpandedChange={setVideoExpanded}
        onCanvasExpandedChange={setCanvasExpanded}
      />

      <section className="flex flex-1 flex-col overflow-hidden">
        {activeSection === "assets" ? (
          <>
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card/30 px-6">
              <div className="flex items-center gap-4">
                <h3 className="text-sm font-medium text-foreground">{headerTitle}</h3>
                <div className="relative w-80">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索资产名称、描述或来源"
                    className="w-full rounded-lg border border-border bg-input py-2 pl-9 pr-4 text-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                {assetsRefreshing ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
                {filter.root === "video" && filter.sourceModule === "video_replace" ? (
                  <button
                    onClick={() => void syncVideoReplaceHistory({ force: true })}
                    disabled={syncingVideoReplaceHistory}
                    className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {syncingVideoReplaceHistory ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    同步人物替换任务
                  </button>
                ) : null}
                <button
                  onClick={() => refreshAssetsView({ force: true })}
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
                <AssetGrid
                  dateGroups={assetDateGroups}
                  deletingId={deletingId}
                  variant="assets"
                  renderDateLine={renderDateLine}
                  onPreviewAsset={setPreviewAsset}
                  onEditAsset={openEdit}
                  onDeleteAsset={handleDelete}
                  onOpenVideoReplace={openVideoReplaceForAsset}
                  onOpenAgentCanvas={() => navigate("/create/agent-canvas")}
                />
              )}

              {!showInitialAssetsLoading && filteredAssets.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                  <FolderOpen className="mb-4 h-12 w-12 opacity-20" />
                  <p>当前分类下还没有资产</p>
                </div>
              ) : null}
            </div>
          </>
        ) : activeSection === "agent-canvas-assets" ? (
          <>
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card/30 px-6">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" />
                智能画布资产
                <span className="text-xs text-muted-foreground">
                  （智能画布同步素材会保留在当前项目，已同步 {agentCanvasSyncedAssets.length} 项）
                </span>
              </h3>
              <div className="flex items-center gap-3">
                <div className="relative w-72">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索智能画布资产"
                    className="w-full rounded-lg border border-border bg-input py-2 pl-9 pr-4 text-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                {assetsRefreshing ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
                <button
                  onClick={() => refreshAssetsView({ force: true })}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                >
                  刷新
                </button>
                <button
                  onClick={() => navigate("/create/agent-canvas")}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Sparkles className="h-4 w-4" />
                  打开智能画布
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {showInitialAssetsLoading ? (
                <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
                  <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm">加载智能画布资产中...</p>
                </div>
              ) : filteredAgentCanvasSyncedAssets.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                  <Sparkles className="mb-4 h-12 w-12 opacity-20" />
                  <p>暂无智能画布资产</p>
                  <p className="mt-1 text-xs">在智能画布中上传或生成图片/视频后，会自动同步到这里</p>
                </div>
              ) : (
                <AssetGrid
                  dateGroups={agentCanvasSyncedAssetDateGroups}
                  deletingId={deletingId}
                  variant="agent-canvas-assets"
                  renderDateLine={renderDateLine}
                  onPreviewAsset={setPreviewAsset}
                  onEditAsset={openEdit}
                  onDeleteAsset={handleDelete}
                  onOpenVideoReplace={openVideoReplaceForAsset}
                  onOpenAgentCanvas={() => navigate("/create/agent-canvas")}
                />
              )}
            </div>
          </>
        ) : activeSection === "legacy-agent-canvas-project-assets" ? (
          <>
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card/30 px-6">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <LayoutGrid className="h-4 w-4 text-primary" />
                历史智能画布工程
                <span className="text-xs text-muted-foreground">
                  （旧入口保存的可编辑工程仅保留为历史记录，已归档 {legacyAgentCanvasProjectAssets.length} 项）
                </span>
              </h3>
              <div className="flex items-center gap-3">
                <div className="relative w-72">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索历史智能画布工程"
                    className="w-full rounded-lg border border-border bg-input py-2 pl-9 pr-4 text-sm transition-shadow focus:outline-none focus:ring-2 focus:ring-primary/50"
                  />
                </div>
                {assetsRefreshing ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
                <button
                  onClick={() => refreshAssetsView({ force: true })}
                  className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
                >
                  刷新
                </button>
                <button
                  onClick={() => navigate("/create/agent-canvas")}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Sparkles className="h-4 w-4" />
                  新建智能画布
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {showInitialAssetsLoading ? (
                <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
                  <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm">加载历史智能画布工程中...</p>
                </div>
              ) : filteredLegacyAgentCanvasProjectAssets.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                  <LayoutGrid className="mb-4 h-12 w-12 opacity-20" />
                  <p>暂无历史智能画布工程</p>
                  <p className="mt-1 text-xs">旧入口退役后不再新建此类工程，可在智能画布项目中继续创建新项目</p>
                </div>
              ) : (
                <AssetGrid
                  dateGroups={legacyAgentCanvasProjectDateGroups}
                  deletingId={deletingId}
                  variant="legacy-agent-canvas-project-assets"
                  renderDateLine={renderDateLine}
                  onPreviewAsset={setPreviewAsset}
                  onEditAsset={openEdit}
                  onDeleteAsset={handleDelete}
                  onOpenVideoReplace={openVideoReplaceForAsset}
                  onOpenAgentCanvas={() => navigate("/create/agent-canvas")}
                />
              )}
            </div>
          </>
        ) : activeSection === "agent-canvas-projects" ? (
          <CanvasProjectSection
            mode="agent"
            projects={agentCanvasProjects}
            dateGroups={agentCanvasProjectDateGroups}
            loading={showInitialAgentCanvasLoading}
            refreshing={agentCanvasRefreshing}
            deletingId={deletingAgentCanvasId}
            renderDateLine={renderDateLine}
            onRefresh={loadAgentCanvasProjects}
            onOpenProject={(projectId) => navigate(`/create/agent-canvas?agentCanvasProjectId=${projectId}`)}
            onDeleteProject={handleDeleteAgentCanvasProject}
            onCreateAgentCanvas={() => navigate("/create/agent-canvas")}
          />
        ) : (
          <CanvasProjectSection
            mode="canvas"
            projects={canvasProjects}
            dateGroups={canvasProjectDateGroups}
            loading={showInitialCanvasLoading}
            refreshing={canvasRefreshing}
            deletingId={deletingCanvasId}
            renderDateLine={renderDateLine}
            onRefresh={loadCanvasProjects}
            onOpenProject={(projectId) => navigate(`/create/canvas?canvasProjectId=${projectId}`)}
            onDeleteProject={handleDeleteCanvasProject}
          />
        )}
      </section>

      {formState ? (
        <AssetFormModal
          formState={formState}
          submitting={submitting}
          setFormState={setFormState}
          onClose={closeForm}
          onSubmit={handleSubmit}
        />
      ) : null}

      {previewAsset ? (
        <AssetPreviewModal
          asset={previewAsset}
          onClose={() => setPreviewAsset(null)}
          onOpenVideoReplace={openVideoReplaceForAsset}
        />
      ) : null}
    </div>
  );
}
