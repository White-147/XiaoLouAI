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
  Sparkles,
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
  deleteAgentCanvasProject,
  deleteCanvasProject,
  getAgentCanvasProject,
  getCanvasProject,
  getProject,
  listAssets,
  listAgentCanvasProjects,
  listCanvasProjects,
  listVideoReplaceJobs,
  saveAgentCanvasProject,
  saveCanvasProject,
  syncVideoReplaceJobAsset,
  updateAsset,
  uploadFile,
  type Asset,
  type AssetSourceModule,
  type AgentCanvasProjectSummary,
  type CanvasProjectSummary,
} from "../lib/api";
import { useActorId } from "../lib/actor-session";
import { useCurrentProjectId } from "../lib/session";
import { useNavigate } from "react-router-dom";
import { generateGridThumbnail } from "../lib/grid-thumbnail";

// ── Hierarchical category model ────────────────────────────────────
//   Root: image | video
//   Image sub-buckets: character / scene / prop / style (based on assetType)
//   Video sub-buckets: video_create / canvas / video_replace (based on sourceModule)
type RootCategory = "image" | "video";
type CategoryFilter =
  | { root: "image"; assetType: "all" | "character" | "scene" | "prop" | "style" }
  | { root: "video"; sourceModule: "all" | AssetSourceModule };

const IMAGE_SUBCATS = [
  { id: "all", label: "图片资产", icon: ImageIcon },
  { id: "character", label: "角色", icon: Users },
  { id: "scene", label: "场景", icon: Map },
  { id: "prop", label: "道具", icon: Package },
  { id: "style", label: "风格", icon: ImageIcon },
] as const;

const VIDEO_SUBCATS: Array<{ id: "all" | AssetSourceModule; label: string }> = [
  { id: "all", label: "全部视频" },
  { id: "video_create", label: "视频创作" },
  { id: "canvas", label: "画布" },
  { id: "video_replace", label: "人物替换" },
];

const SOURCE_MODULE_LABEL: Record<AssetSourceModule, string> = {
  image_create: "图片创作",
  video_create: "视频创作",
  canvas: "画布",
  video_replace: "人物替换",
  agent_studio: "智能体画布",
};

type AssetFormState = {
  mode: "create" | "edit";
  assetId: string | null;
  rootCategory: RootCategory;
  assetType: string;
  name: string;
  description: string;
  localFile: File | null;
  localFilePreviewUrl: string | null;
};

const ASSET_UPLOAD_ACCEPT =
  "image/jpeg,image/png,image/webp,image/bmp,image/x-ms-bmp,.jpg,.jpeg,.png,.webp,.bmp,video/*";

const AGENT_CANVAS_PROJECT_ASSET_TYPE = "agent_canvas_project";

function assetPreviewUrl(asset: Asset) {
  return getGeneratedMediaUrl(asset.previewUrl);
}

function assetMediaUrl(asset: Asset) {
  return getGeneratedMediaUrl(asset.mediaUrl) || getGeneratedMediaUrl(asset.previewUrl) || null;
}

function isVideoAsset(asset: Asset) {
  if (isAgentCanvasProjectAsset(asset)) return false;
  return asset.mediaKind === "video" || asset.assetType === "video_ref";
}

function isAgentCanvasProjectAsset(asset: Asset) {
  return (
    asset.sourceModule === "agent_studio" &&
    (asset.assetType === AGENT_CANVAS_PROJECT_ASSET_TYPE ||
      asset.mediaKind === AGENT_CANVAS_PROJECT_ASSET_TYPE)
  );
}

function canPreviewAssetVideo(asset: Asset) {
  return isVideoAsset(asset) && Boolean(getGeneratedMediaUrl(asset.mediaUrl));
}

function isVideoReplaceAsset(asset: Asset) {
  return asset.sourceModule === "video_replace" && Boolean(asset.sourceTaskId);
}

function getAgentCanvasProjectMeta(asset: Asset): Record<string, unknown> {
  return asset.sourceMetadata && typeof asset.sourceMetadata === "object"
    ? asset.sourceMetadata
    : {};
}

function getAgentCanvasProjectEditPath(asset: Asset) {
  const meta = getAgentCanvasProjectMeta(asset);
  const canvasId = typeof meta.canvasId === "string" ? meta.canvasId.trim() : "";
  const sessionId = typeof meta.sessionId === "string" ? meta.sessionId.trim() : "";
  if (!canvasId) return "/create/agent-studio";
  const params = new URLSearchParams({ canvasId });
  if (sessionId) params.set("sessionId", sessionId);
  return `/create/agent-studio?${params.toString()}`;
}

const agentCanvasProjectPrefetchInFlight = new Set<string>();
const AGENT_CANVAS_PREFETCH_TTL_MS = 2 * 60 * 1000;
const AGENT_CANVAS_PREFETCH_INDEX_KEY = "xiaolou:jaaz-prefetch:index";

function rememberJaazPrefetchCacheKey(key: string) {
  if (typeof window === "undefined") return;
  try {
    const now = Date.now();
    const previous = JSON.parse(
      window.sessionStorage.getItem(AGENT_CANVAS_PREFETCH_INDEX_KEY) || "[]",
    ) as Array<{ key: string; cachedAt: number }>;
    const next = [
      { key, cachedAt: now },
      ...previous.filter((item) => item.key !== key),
    ].slice(0, 6);
    for (const item of previous) {
      if (!next.some((entry) => entry.key === item.key)) {
        window.sessionStorage.removeItem(item.key);
      }
    }
    window.sessionStorage.setItem(AGENT_CANVAS_PREFETCH_INDEX_KEY, JSON.stringify(next));
  } catch {
    // Prefetch cache is best-effort only.
  }
}

function writeJaazPrefetchCache(key: string, payload: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      key,
      JSON.stringify({
        cachedAt: Date.now(),
        ttlMs: AGENT_CANVAS_PREFETCH_TTL_MS,
        payload,
      }),
    );
    rememberJaazPrefetchCacheKey(key);
  } catch {
    // Large canvases can exceed sessionStorage quota; opening still works without cache.
  }
}

function prefetchAgentCanvasProject(asset: Asset) {
  const meta = getAgentCanvasProjectMeta(asset);
  const canvasId = typeof meta.canvasId === "string" ? meta.canvasId.trim() : "";
  const sessionId = typeof meta.sessionId === "string" ? meta.sessionId.trim() : "";
  if (!canvasId || agentCanvasProjectPrefetchInFlight.has(canvasId)) return;

  agentCanvasProjectPrefetchInFlight.add(canvasId);
  const canvasKey = `xiaolou:jaaz-prefetch:canvas:${canvasId}`;
  void fetch(`/jaaz-api/api/canvas/${encodeURIComponent(canvasId)}`, {
    credentials: "same-origin",
  })
    .then(async (response) => {
      if (response.ok) {
        writeJaazPrefetchCache(canvasKey, await response.json());
      }
      if (!sessionId) return;
      const chatResponse = await fetch(
        `/jaaz-api/api/chat_session/${encodeURIComponent(sessionId)}?limit=80`,
        { credentials: "same-origin" },
      );
      if (chatResponse.ok) {
        writeJaazPrefetchCache(
          `xiaolou:jaaz-prefetch:chat:${sessionId}:latest`,
          await chatResponse.json(),
        );
      }
    })
    .catch(() => {
      // Silent warmup failure; normal click path can still load from Jaaz.
    })
    .finally(() => {
      window.setTimeout(() => agentCanvasProjectPrefetchInFlight.delete(canvasId), 5000);
    });
}

function assetMatchesQuery(asset: Asset, rawQuery: string) {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return true;

  return [
    asset.name,
    asset.description,
    asset.assetType,
    asset.mediaKind,
    asset.sourceModule,
    asset.sourceTaskId,
  ]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(query));
}

function imageAssetTypeLabel(assetType: string) {
  const match = IMAGE_SUBCATS.find((item) => item.id === assetType);
  return match?.label || assetType;
}

function videoAssetSubLabel(asset: Asset) {
  const mod = (asset.sourceModule as AssetSourceModule | null) ?? null;
  return mod ? SOURCE_MODULE_LABEL[mod] || mod : "未分组";
}

const UNKNOWN_DATE_LABEL = "未知日期";

type DateGroup<T> = {
  dateKey: string;
  items: T[];
  sortTime: number;
};

type ProjectAssetsCacheEntry = {
  items: Asset[];
  updatedAt: number;
};

const ASSETS_CACHE_STALE_MS = 30_000;
const ASSETS_BACKGROUND_REFRESH_MS = 60_000;
const projectAssetsCache = new globalThis.Map<string, ProjectAssetsCacheEntry>();
const projectAssetsInFlight = new globalThis.Map<string, Promise<Asset[]>>();
const projectTitleCache = new globalThis.Map<string, string>();
const syncedVideoReplaceProjects = new globalThis.Set<string>();

function toLocalDateKey(value: string | null | undefined) {
  if (!value) return UNKNOWN_DATE_LABEL;
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return UNKNOWN_DATE_LABEL;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toDateSortTime(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function groupByLocalDate<T>(
  items: T[],
  getDateValue: (item: T) => string | null | undefined,
): DateGroup<T>[] {
  const groups = new globalThis.Map<string, DateGroup<T>>();

  for (const item of items) {
    const dateValue = getDateValue(item);
    const dateKey = toLocalDateKey(dateValue);
    const sortTime = toDateSortTime(dateValue);
    const group = groups.get(dateKey);

    if (group) {
      group.items.push(item);
      group.sortTime = Math.max(group.sortTime, sortTime);
    } else {
      groups.set(dateKey, { dateKey, items: [item], sortTime });
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      items: [...group.items].sort(
        (left, right) => toDateSortTime(getDateValue(right)) - toDateSortTime(getDateValue(left)),
      ),
    }))
    .sort((left, right) => right.sortTime - left.sortTime);
}

function normalizeCanvasProjectSummaries(items: CanvasProjectSummary[]): CanvasProjectSummary[] {
  const byId = new globalThis.Map<string, CanvasProjectSummary>();
  for (const item of items) {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    if (!id) continue;
    const candidate = item.id === id ? item : { ...item, id };
    const existing = byId.get(id);
    const candidateUpdatedAt = toDateSortTime(candidate.updatedAt);
    const existingUpdatedAt = toDateSortTime(existing?.updatedAt);
    const candidateCreatedAt = toDateSortTime(candidate.createdAt);
    const existingCreatedAt = toDateSortTime(existing?.createdAt);
    if (
      !existing ||
      candidateUpdatedAt > existingUpdatedAt ||
      (candidateUpdatedAt === existingUpdatedAt && candidateCreatedAt > existingCreatedAt)
    ) {
      byId.set(id, candidate);
    }
  }
  return Array.from(byId.values()).sort(
    (left, right) =>
      toDateSortTime(right.updatedAt) - toDateSortTime(left.updatedAt) ||
      toDateSortTime(right.createdAt) - toDateSortTime(left.createdAt),
  );
}

function normalizeAgentCanvasProjectSummaries(items: AgentCanvasProjectSummary[]): AgentCanvasProjectSummary[] {
  const byId = new globalThis.Map<string, AgentCanvasProjectSummary>();
  for (const item of items) {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    if (!id) continue;
    const candidate = item.id === id ? item : { ...item, id };
    const existing = byId.get(id);
    const candidateUpdatedAt = toDateSortTime(candidate.updatedAt);
    const existingUpdatedAt = toDateSortTime(existing?.updatedAt);
    const candidateCreatedAt = toDateSortTime(candidate.createdAt);
    const existingCreatedAt = toDateSortTime(existing?.createdAt);
    if (
      !existing ||
      candidateUpdatedAt > existingUpdatedAt ||
      (candidateUpdatedAt === existingUpdatedAt && candidateCreatedAt > existingCreatedAt)
    ) {
      byId.set(id, candidate);
    }
  }
  return Array.from(byId.values()).sort(
    (left, right) =>
      toDateSortTime(right.updatedAt) - toDateSortTime(left.updatedAt) ||
      toDateSortTime(right.createdAt) - toDateSortTime(left.createdAt),
  );
}

function getCachedProjectAssets(projectId: string) {
  return projectAssetsCache.get(projectId) || null;
}

function setCachedProjectAssets(projectId: string, items: Asset[]) {
  projectAssetsCache.set(projectId, {
    items,
    updatedAt: Date.now(),
  });
}

function shouldRefreshProjectAssets(projectId: string) {
  const cached = getCachedProjectAssets(projectId);
  return !cached || Date.now() - cached.updatedAt > ASSETS_CACHE_STALE_MS;
}

function fetchProjectAssets(projectId: string) {
  const existing = projectAssetsInFlight.get(projectId);
  if (existing) return existing;

  const request = listAssets(projectId)
    .then((response) => response.items)
    .finally(() => {
      projectAssetsInFlight.delete(projectId);
    });
  projectAssetsInFlight.set(projectId, request);
  return request;
}

type SidebarSection =
  | "assets"
  | "agent-studio-assets"
  | "agent-studio-projects"
  | "agent-canvas-projects"
  | "canvas-projects";

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
                !node.resultUrl.startsWith("data:"),
            )
            .map((node) => {
              const url = node.resultUrl!;
              if (/^https?:\/\//i.test(url)) {
                try {
                  const parsed = new URL(url);
                  if (parsed.pathname.startsWith("/uploads/")) return parsed.pathname;
                } catch {
                  /* keep url */
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
                !node.resultUrl.startsWith("data:"),
            )
            .map((node) => {
              const url = node.resultUrl!;
              if (/^https?:\/\//i.test(url)) {
                try {
                  const parsed = new URL(url);
                  if (parsed.pathname.startsWith("/uploads/")) return parsed.pathname;
                } catch {
                  /* keep url */
                }
              }
              return url;
            })
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
    void import("./create/CanvasCreate");
  }, [activeSection]);

  useEffect(() => {
    if (activeSection !== "agent-canvas-projects") return;
    void import("./create/AgentCanvasCreate");
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

  useEffect(() => {
    const refreshAfterAgentAssetSync = (event: Event) => {
      const detail = (event as CustomEvent<{ projectId?: string }>).detail;
      if (detail?.projectId && detail.projectId !== currentProjectId) return;
      void loadAssets({ force: true, silent: true });
    };

    window.addEventListener("xiaolou:agent-asset:synced", refreshAfterAgentAssetSync);
    window.addEventListener("xiaolou:agent-canvas-project:synced", refreshAfterAgentAssetSync);
    return () => {
      window.removeEventListener("xiaolou:agent-asset:synced", refreshAfterAgentAssetSync);
      window.removeEventListener("xiaolou:agent-canvas-project:synced", refreshAfterAgentAssetSync);
    };
  }, [currentProjectId, loadAssets]);

  const agentStudioAssets = useMemo(
    () =>
      assets.filter(
        (asset) => asset.sourceModule === "agent_studio" && !isAgentCanvasProjectAsset(asset),
      ),
    [assets],
  );

  const agentStudioProjectAssets = useMemo(
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

  const agentStudioFilteredAssets = useMemo(
    () => agentStudioAssets.filter((asset) => assetMatchesQuery(asset, query)),
    [agentStudioAssets, query],
  );

  const agentStudioFilteredProjectAssets = useMemo(
    () => agentStudioProjectAssets.filter((asset) => assetMatchesQuery(asset, query)),
    [agentStudioProjectAssets, query],
  );

  const assetDateGroups = useMemo(
    () => groupByLocalDate(filteredAssets, (asset) => asset.createdAt),
    [filteredAssets],
  );

  const agentStudioAssetDateGroups = useMemo(
    () => groupByLocalDate(agentStudioFilteredAssets, (asset) => asset.createdAt),
    [agentStudioFilteredAssets],
  );

  const agentStudioProjectDateGroups = useMemo(
    () => groupByLocalDate(agentStudioFilteredProjectAssets, (asset) => asset.updatedAt || asset.createdAt),
    [agentStudioFilteredProjectAssets],
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
      <aside className="flex w-72 flex-col border-r border-border bg-card/30">
        <div className="border-b border-border p-4">
          <h2 className="flex items-center gap-2 font-medium">
            <FolderOpen className="h-4 w-4 text-primary" />
            资产库
          </h2>
          <p className="mt-2 text-xs text-muted-foreground">当前项目：{projectTitle}</p>
        </div>

        <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
          {/* ── 图片资产（一级） ───────────────────────────────── */}
          <button
            onClick={() => {
              setImageExpanded((v) => !v);
              setActiveSection("assets");
              setFilter({ root: "image", assetType: "all" });
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              activeSection === "assets" && filter.root === "image" && filter.assetType === "all"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-3">
              {imageExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <ImageIcon className="h-4 w-4" />
              图片资产
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                activeSection === "assets" && filter.root === "image" && filter.assetType === "all"
                  ? "bg-primary/20"
                  : "bg-secondary",
              )}
            >
              {counts.image.all ?? 0}
            </span>
          </button>

          {imageExpanded && (
            <div className="ml-4 mt-1 space-y-0.5 border-l border-border/50 pl-2">
              {IMAGE_SUBCATS.filter((item) => item.id !== "all").map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveSection("assets");
                    setFilter({ root: "image", assetType: item.id });
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                    activeSection === "assets" &&
                      filter.root === "image" &&
                      filter.assetType === item.id
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
                      activeSection === "assets" &&
                        filter.root === "image" &&
                        filter.assetType === item.id
                        ? "bg-primary/20"
                        : "bg-secondary",
                    )}
                  >
                    {counts.image[item.id] ?? 0}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="my-2" />

          {/* ── 视频资产（一级） ───────────────────────────────── */}
          <button
            onClick={() => {
              setVideoExpanded((v) => !v);
              setActiveSection("assets");
              setFilter({ root: "video", sourceModule: "all" });
            }}
            className={cn(
              "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              activeSection === "assets" && filter.root === "video" && filter.sourceModule === "all"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-3">
              {videoExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              <Video className="h-4 w-4" />
              视频资产
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                activeSection === "assets" && filter.root === "video" && filter.sourceModule === "all"
                  ? "bg-primary/20"
                  : "bg-secondary",
              )}
            >
              {counts.video.all ?? 0}
            </span>
          </button>

          {videoExpanded && (
            <div className="ml-4 mt-1 space-y-0.5 border-l border-border/50 pl-2">
              {VIDEO_SUBCATS.filter((item) => item.id !== "all").map((item) => (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveSection("assets");
                    setFilter({ root: "video", sourceModule: item.id });
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                    activeSection === "assets" &&
                      filter.root === "video" &&
                      filter.sourceModule === item.id
                      ? "bg-primary/10 font-medium text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  <span className="flex items-center gap-3">
                    <Video className="h-3.5 w-3.5 opacity-70" />
                    {item.label}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs",
                      activeSection === "assets" &&
                        filter.root === "video" &&
                        filter.sourceModule === item.id
                        ? "bg-primary/20"
                        : "bg-secondary",
                    )}
                  >
                    {counts.video[item.id] ?? 0}
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="my-2" />

          <button
            onClick={() => setActiveSection("agent-studio-assets")}
            className={cn(
              "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              activeSection === "agent-studio-assets"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-3">
              <Sparkles className="h-4 w-4" />
              智能体画布资产
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                activeSection === "agent-studio-assets" ? "bg-primary/20" : "bg-secondary",
              )}
            >
              {agentStudioAssets.length}
            </span>
          </button>

          <div className="my-2" />

          <button
            onClick={() => setActiveSection("agent-studio-projects")}
            className={cn(
              "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              activeSection === "agent-studio-projects"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-3">
              <LayoutGrid className="h-4 w-4" />
              Jaaz 智能体画布项目
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                activeSection === "agent-studio-projects" ? "bg-primary/20" : "bg-secondary",
              )}
            >
              {agentStudioProjectAssets.length}
            </span>
          </button>

          <div className="my-2" />

          <button
            onClick={() => setActiveSection("agent-canvas-projects")}
            className={cn(
              "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              activeSection === "agent-canvas-projects"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-3">
              <Sparkles className="h-4 w-4" />
              智能画布项目
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                activeSection === "agent-canvas-projects" ? "bg-primary/20" : "bg-secondary",
              )}
            >
              {agentCanvasProjects.length}
            </span>
          </button>

          <div className="my-2" />

          {/* ── 画布项目 ───────────────────────────────────────── */}
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
                <p className="px-3 py-2 text-xs text-muted-foreground">暂无画布项目</p>
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
                <div className="space-y-8">
                  {assetDateGroups.map((group) => (
                    <section key={group.dateKey} className="space-y-3">
                      {renderDateLine(group.dateKey)}
                      <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-5">
                        {group.items.map((asset) => {
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
                            ) : isVideoAsset(asset) && assetMediaUrl(asset) ? (
                              /* Video with no static cover: let the browser render the first
                                 frame by pointing a muted <video> at the mediaUrl. preload=
                                 "metadata" keeps bandwidth cost minimal. */
                              <video
                                src={assetMediaUrl(asset) || undefined}
                                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                                muted
                                playsInline
                                preload="metadata"
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
                              {videoAssetSubLabel(asset)}
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
                            {isVideoAsset(asset) ? (
                              <button
                                onClick={() => openVideoReplaceForAsset(asset)}
                                className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                                title={isVideoReplaceAsset(asset) ? "继续人物替换" : "人物替换"}
                              >
                                <Sparkles className="h-4 w-4" />
                              </button>
                            ) : null}
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
                              {isVideoAsset(asset)
                                ? videoAssetSubLabel(asset)
                                : imageAssetTypeLabel(asset.assetType)}
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
                    </section>
                  ))}
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
        ) : activeSection === "agent-studio-assets" ? (
          <>
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card/30 px-6">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" />
                智能体画布资产
                <span className="text-xs text-muted-foreground">
                  （新增 Jaaz 素材会同步到当前项目，已同步 {agentStudioAssets.length} 项）
                </span>
              </h3>
              <div className="flex items-center gap-3">
                <div className="relative w-72">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索智能体画布资产"
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
                  onClick={() => navigate("/create/agent-studio")}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Sparkles className="h-4 w-4" />
                  打开智能体画布
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {showInitialAssetsLoading ? (
                <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
                  <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm">加载智能体画布资产中...</p>
                </div>
              ) : agentStudioFilteredAssets.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                  <Sparkles className="mb-4 h-12 w-12 opacity-20" />
                  <p>暂无智能体画布资产</p>
                  <p className="mt-1 text-xs">在智能体画布中上传或生成图片/视频后，会自动同步到这里</p>
                </div>
              ) : (
                <div className="space-y-8">
                  {agentStudioAssetDateGroups.map((group) => (
                    <section key={group.dateKey} className="space-y-3">
                      {renderDateLine(group.dateKey)}
                      <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-5">
                        {group.items.map((asset) => {
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
                                  ) : isVideoAsset(asset) && assetMediaUrl(asset) ? (
                                    <video
                                      src={assetMediaUrl(asset) || undefined}
                                      className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                                      muted
                                      playsInline
                                      preload="metadata"
                                    />
                                  ) : (
                                    <GeneratedMediaPlaceholder
                                      kind={isVideoAsset(asset) ? "video" : "image"}
                                      className="h-full w-full"
                                      description="生成后会在这里显示预览"
                                    />
                                  )}
                                </button>

                                <div className="absolute left-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur">
                                  {isVideoAsset(asset) ? "视频" : "图片"}
                                </div>

                                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                                  <button
                                    onClick={() => setPreviewAsset(asset)}
                                    className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                                    title="预览"
                                  >
                                    <Play className="h-4 w-4" />
                                  </button>
                                  {isVideoAsset(asset) ? (
                                    <button
                                      onClick={() => openVideoReplaceForAsset(asset)}
                                      className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                                      title={isVideoReplaceAsset(asset) ? "继续人物替换" : "人物替换"}
                                    >
                                      <Sparkles className="h-4 w-4" />
                                    </button>
                                  ) : null}
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
                                    智能体画布
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
                    </section>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : activeSection === "agent-studio-projects" ? (
          <>
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card/30 px-6">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <LayoutGrid className="h-4 w-4 text-primary" />
                Jaaz 智能体画布项目
                <span className="text-xs text-muted-foreground">
                  （保存 Jaaz 整个可编辑画布工程，已同步 {agentStudioProjectAssets.length} 项）
                </span>
              </h3>
              <div className="flex items-center gap-3">
                <div className="relative w-72">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索 Jaaz 智能体画布项目"
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
                  onClick={() => navigate("/create/agent-studio")}
                  className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  <Sparkles className="h-4 w-4" />
                  新建 Jaaz 智能体画布
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
              {showInitialAssetsLoading ? (
                <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
                  <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm">加载智能体画布项目中...</p>
                </div>
              ) : agentStudioFilteredProjectAssets.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                  <LayoutGrid className="mb-4 h-12 w-12 opacity-20" />
                  <p>暂无 Jaaz 智能体画布项目</p>
                  <p className="mt-1 text-xs">在智能体画布中发起对话后，会保存为可重新编辑的 Jaaz 工程</p>
                </div>
              ) : (
                <div className="space-y-8">
                  {agentStudioProjectDateGroups.map((group) => (
                    <section key={group.dateKey} className="space-y-3">
                      {renderDateLine(group.dateKey)}
                      <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-5">
                        {group.items.map((asset) => {
                          const pendingDelete = deletingId === asset.id;
                          const previewUrl = assetPreviewUrl(asset);
                          const metadata = getAgentCanvasProjectMeta(asset);
                          const canvasId =
                            typeof metadata.canvasId === "string" ? metadata.canvasId : "";
                          const sessionId =
                            typeof metadata.sessionId === "string" ? metadata.sessionId : "";
                          const editPath = getAgentCanvasProjectEditPath(asset);

                          return (
                            <article
                              key={asset.id}
                              className="glass-panel group flex cursor-pointer flex-col overflow-hidden rounded-xl"
                              onMouseEnter={() => prefetchAgentCanvasProject(asset)}
                              onFocus={() => prefetchAgentCanvasProject(asset)}
                              onClick={() => navigate(editPath)}
                            >
                              <div className="relative aspect-video bg-muted">
                                {previewUrl ? (
                                  <img
                                    src={previewUrl}
                                    alt={asset.name}
                                    className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <GeneratedMediaPlaceholder
                                    kind="image"
                                    label="Jaaz 工程"
                                    className="h-full w-full"
                                    description="点击后恢复整个画布和对话"
                                  />
                                )}

                                <div className="absolute left-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur">
                                  可编辑工程
                                </div>

                                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      navigate(editPath);
                                    }}
                                    className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                                    title="继续编辑"
                                  >
                                    <Play className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleDelete(asset.id);
                                    }}
                                    disabled={pendingDelete}
                                    className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
                                    title="从项目管理中移除"
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
                                    Jaaz
                                  </span>
                                </div>
                                <p className="line-clamp-2 flex-1 text-xs text-muted-foreground">
                                  {asset.description || "保存了 Jaaz 画布、对话和可编辑工程入口"}
                                </p>
                                <div className="mt-2 space-y-1 text-[11px] text-muted-foreground/80">
                                  {canvasId ? <p className="truncate">Canvas: {canvasId}</p> : null}
                                  {sessionId ? <p className="truncate">Session: {sessionId}</p> : null}
                                  <p>{new Date(asset.updatedAt || asset.createdAt).toLocaleString("zh-CN")}</p>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : activeSection === "agent-canvas-projects" ? (
          <>
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card/30 px-6">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" />
                智能画布项目
                <span className="text-xs text-muted-foreground">
                  （保存智能画布节点、对话上下文和视口，已保存 {agentCanvasProjects.length} 项）
                </span>
              </h3>
              <div className="flex items-center gap-3">
                {agentCanvasRefreshing ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
                <button
                  onClick={() => void loadAgentCanvasProjects()}
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
              {showInitialAgentCanvasLoading ? (
                <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
                  <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-sm">加载智能画布项目中...</p>
                </div>
              ) : agentCanvasProjects.length === 0 ? (
                <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
                  <Sparkles className="mb-4 h-12 w-12 opacity-20" />
                  <p>暂无智能画布项目</p>
                  <p className="mt-1 text-xs">在智能画布中对话或生成后，会自动保存完整界面上下文</p>
                </div>
              ) : (
                <div className="space-y-8">
                  {agentCanvasProjectDateGroups.map((group) => (
                    <section key={group.dateKey} className="space-y-3">
                      {renderDateLine(group.dateKey)}
                      <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-5">
                        {group.items.map((cp) => {
                          const pendingDelete = deletingAgentCanvasId === cp.id;
                          return (
                            <article
                              key={cp.id}
                              className="glass-panel group flex cursor-pointer flex-col overflow-hidden rounded-xl"
                              onClick={() => navigate(`/create/agent-canvas?agentCanvasProjectId=${cp.id}`)}
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
                                  <GeneratedMediaPlaceholder
                                    kind="image"
                                    label="智能画布"
                                    className="h-full w-full"
                                    description="点击后恢复画布和对话上下文"
                                  />
                                )}

                                <div className="absolute left-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur">
                                  智能画布
                                </div>

                                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      navigate(`/create/agent-canvas?agentCanvasProjectId=${cp.id}`);
                                    }}
                                    className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                                    title="继续编辑"
                                  >
                                    <Play className="h-4 w-4" />
                                  </button>
                                  <button
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleDeleteAgentCanvasProject(cp.id);
                                    }}
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
                                  <h3 className="truncate text-sm font-medium">{cp.title}</h3>
                                  <span className="rounded bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                                    Agent
                                  </span>
                                </div>
                                <p className="line-clamp-2 flex-1 text-xs text-muted-foreground">
                                  保存了智能画布节点、分组、视口和侧边栏对话上下文
                                </p>
                                <p className="mt-2 text-[11px] text-muted-foreground/80">
                                  {new Date(cp.updatedAt).toLocaleString("zh-CN")}
                                </p>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              )}
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
                <div className="space-y-8">
                  {canvasProjectDateGroups.map((group) => (
                    <section key={group.dateKey} className="space-y-3">
                      {renderDateLine(group.dateKey)}
                      <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-5">
                        {group.items.map((cp) => (
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
                            onClick={(e) => {
                              e.stopPropagation();
                              navigate(`/create/canvas?canvasProjectId=${cp.id}`);
                            }}
                            className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                            title="打开"
                          >
                            <Play className="h-4 w-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDeleteCanvasProject(cp.id);
                            }}
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
                    </section>
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
                  {formState.rootCategory === "image"
                    ? IMAGE_SUBCATS.filter((item) => item.id !== "all").map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))
                    : [
                        <option key="video_ref" value="video_ref">
                          视频素材
                        </option>,
                      ]}
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
                      if (current.localFilePreviewUrl) {
                        try {
                          URL.revokeObjectURL(current.localFilePreviewUrl);
                        } catch {
                          /* ignore */
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
                  {isVideoAsset(previewAsset)
                    ? `视频资产 · 来源：${videoAssetSubLabel(previewAsset)}`
                    : `图片资产 · ${imageAssetTypeLabel(previewAsset.assetType)}`}
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
                  <div className="mt-1 font-medium">
                    {isVideoAsset(previewAsset)
                      ? "视频素材"
                      : imageAssetTypeLabel(previewAsset.assetType)}
                  </div>
                </div>
                {isVideoAsset(previewAsset) ? (
                  <div className="rounded-lg border border-border p-4">
                    <div className="text-xs text-muted-foreground">来源模块</div>
                    <div className="mt-1 font-medium">{videoAssetSubLabel(previewAsset)}</div>
                  </div>
                ) : null}
                <div className="rounded-lg border border-border p-4">
                  <div className="text-xs text-muted-foreground">描述</div>
                  <div className="mt-1 text-sm leading-6">
                    {previewAsset.description || "暂无描述"}
                  </div>
                </div>
                {isVideoAsset(previewAsset) ? (
                  <button
                    type="button"
                    onClick={() => {
                      const asset = previewAsset;
                      setPreviewAsset(null);
                      openVideoReplaceForAsset(asset);
                    }}
                    className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
                  >
                    <Sparkles className="h-4 w-4" />
                    {isVideoReplaceAsset(previewAsset) ? "继续人物替换" : "人物替换"}
                  </button>
                ) : null}
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
