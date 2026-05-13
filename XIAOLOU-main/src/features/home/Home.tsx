import {
  Bot,
  Box,
  Check,
  Copy,
  ArrowRight,
  Film,
  ImageIcon,
  LayoutTemplate,
  LoaderCircle,
  MonitorPlay,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Wand2,
  Wifi,
  type LucideIcon,
} from "lucide-react";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getCurrentActorId,
  getKnownActors,
  hasSessionCredentials,
  isLocalDemoActorId,
  rememberKnownActor,
  setAuthToken,
  setControlApiClientAssertion,
  useActorId,
} from "../../lib/actor-session";
import {
  ApiRequestError,
  createProject,
  getMe,
  getNetworkAccessInfo,
  getToolboxCapabilities,
  listPlaygroundModels,
  listProjects,
  listWallets,
  mapStepToComicPath,
  runToolboxCapability,
  startPlaygroundChatJob,
  startDemoSession,
  type NetworkAccessInfo,
  type PermissionContext,
  type PlaygroundModel,
  type Project,
  type ToolboxCapability,
  type Wallet as WalletInfo,
} from "../../lib/api";
import { setCurrentProjectId, useCurrentProjectId } from "../../lib/session";
import { cn } from "../../lib/utils";
import {
  filterWalletsForEntitlement,
  resolveWalletEntitlement,
} from "../../lib/wallet-entitlements";

const RUNNABLE_TOOLBOX_CODES = [
  "motion_transfer",
] as const;

// Local overrides always win over API-returned names/descriptions.
// `status` override forces a tool card into a specific state (e.g. put
// motion_transfer into a "coming soon / 待开发" state without needing a
// backend change).
const TOOLBOX_LOCAL_OVERRIDES: Partial<
  Record<string, Partial<Pick<ToolboxCapability, "name" | "description" | "status">>>
> = {
  video_character_replace: {
    name: "剧本拆解提示词",
    description: "输入剧本或故事大纲，AI 自动拆解为分镜级别的文生视频提示词，大幅提升影视内容的生产效率。",
  },
  character_replace: {
    name: "人物替换",
    description: "在保留镜头构图的前提下替换主角身份、服装与角色特征。",
  },
  motion_transfer: {
    // 产品要求：首页上动作迁移卡片显示"待开发"胶囊，不能点击进入工具。
    // 使用 coming_soon 作为 UI 专用状态，区别于 toolbox_reserved 的通用 placeholder。
    status: "coming_soon",
    description: "把参考动作迁移到指定角色或现有镜头视频。（正在接入）",
  },
  upscale_restore: {
    name: "视频反推提示词",
    description: "对已有视频逐帧分析，自动反推生成对应画面的文生视频提示词，方便复现镜头或进行二次创作。",
  },
  storyboard_25: {
    name: "25 格分镜",
    description: "上传角色参考图并描述剧情，AI 自动生成 25 宫格分镜以及每格对应的提示词，便于快速确立故事节奏。",
  },
};

// 前端独有的工具卡片（后端 capabilities 目前还没有返回它们）。
// 这样即便 /api/capabilities 没返回，卡片也会出现在工具箱里。
const EXTRA_FRONTEND_ONLY_TOOLS: ToolboxCapability[] = [
  {
    code: "storyboard_25",
    name: "25 格分镜",
    status: "mock_ready",
    queue: "image-gpu",
    description: "上传角色参考图并描述剧情，AI 自动生成 25 宫格分镜以及每格对应的提示词，便于快速确立故事节奏。",
  },
];

function applyLocalOverrides(tools: ToolboxCapability[]): ToolboxCapability[] {
  const base = tools.map((t) => {
    const override = TOOLBOX_LOCAL_OVERRIDES[t.code];
    return override ? { ...t, ...override } : t;
  });

  // Merge in any frontend-only tools that the backend hasn't returned yet,
  // so they still appear on the homepage. Existing entries from the API
  // keep their order; new entries get inserted at the tail, then we
  // reorder the whole list to match FRONTEND_TOOLBOX_ORDER below.
  const existing = new Set(base.map((t) => t.code));
  for (const extra of EXTRA_FRONTEND_ONLY_TOOLS) {
    if (!existing.has(extra.code)) {
      base.push({
        ...extra,
        ...(TOOLBOX_LOCAL_OVERRIDES[extra.code] ?? {}),
      });
    }
  }

  // Match the ChuangJingAI homepage order: ready creative tools first,
  // deferred experiments after the usable entries.
  const FRONTEND_TOOLBOX_ORDER = [
    "video_character_replace",
    "character_replace",
    "upscale_restore",
    "storyboard_25",
    "motion_transfer",
    "toolbox_reserved",
  ] as const;

  const orderIndex = (code: string) => {
    const idx = FRONTEND_TOOLBOX_ORDER.indexOf(code as (typeof FRONTEND_TOOLBOX_ORDER)[number]);
    return idx === -1 ? FRONTEND_TOOLBOX_ORDER.length + 1 : idx;
  };

  return base.sort((a, b) => orderIndex(a.code) - orderIndex(b.code));
}

const TOOLBOX_CACHE_KEY_PREFIX = "xiaolou.home.toolbox-capabilities.v3";
const GREETING_NAME_CACHE_KEY_PREFIX = "xiaolou.home.greeting-name";
const TOOLBOX_RETRY_DELAYS_MS = [1200, 3000];
const LOCAL_DEMO_GREETING_NAMES: Record<string, string> = {
  user_personal_001: "注册用户",
  user_demo_001: "企业管理员",
  user_member_001: "企业成员",
  ops_demo_001: "运营管理员",
  root_demo_001: "超级管理员",
};
const DEFAULT_TOOLBOX_CAPABILITIES: ToolboxCapability[] = [
  {
    code: "video_character_replace",
    name: "剧本拆解提示词",
    status: "mock_ready",
    queue: "video-gpu",
    description: "输入剧本或故事大纲，AI 自动拆解为分镜级别的文生视频提示词，大幅提升影视内容的生产效率。",
  },
  {
    code: "character_replace",
    name: "人物替换",
    status: "mock_ready",
    queue: "image-gpu",
    description: "在保留镜头构图的前提下替换主角身份、服装与角色特征。",
  },
  {
    code: "motion_transfer",
    name: "动作迁移",
    status: "coming_soon",
    queue: "video-gpu",
    description: "把参考动作迁移到指定角色或现有镜头视频。（正在接入）",
  },
  {
    code: "upscale_restore",
    name: "视频反推提示词",
    status: "mock_ready",
    queue: "image-cpu",
    description: "对已有视频逐帧分析，自动反推生成对应画面的文生视频提示词，方便复现镜头或进行二次创作。",
  },
  {
    code: "storyboard_25",
    name: "25 格分镜",
    status: "mock_ready",
    queue: "image-gpu",
    description: "上传角色参考图并描述剧情，AI 自动生成 25 宫格分镜以及每格对应的提示词，便于快速确立故事节奏。",
  },
  {
    code: "toolbox_reserved",
    name: "待开发能力",
    status: "placeholder",
    queue: "unassigned",
    description: "预留未来工具箱能力入口，例如表情迁移、镜头扩图和局部重绘。",
  },
];

const TOOL_VISUALS: Record<string, { icon: LucideIcon; tone: string }> = {
  video_character_replace: {
    icon: Film,
    tone: "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300",
  },
  character_replace: {
    icon: ImageIcon,
    tone: "bg-cyan-500/10 text-cyan-700 ring-cyan-500/20 dark:text-cyan-300",
  },
  upscale_restore: {
    icon: MonitorPlay,
    tone: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
  },
  storyboard_25: {
    icon: LayoutTemplate,
    tone: "bg-amber-500/12 text-amber-700 ring-amber-500/20 dark:text-amber-300",
  },
  motion_transfer: {
    icon: Wand2,
    tone: "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300",
  },
};

function getToolboxCacheKey(actorId: string) {
  return `${TOOLBOX_CACHE_KEY_PREFIX}:${actorId || "guest"}`;
}

function getGreetingNameCacheKey(actorId: string) {
  return `${GREETING_NAME_CACHE_KEY_PREFIX}:${actorId || "guest"}`;
}

function readCachedGreetingName(actorId: string) {
  if (!actorId || actorId === "guest") return null;

  if (LOCAL_DEMO_GREETING_NAMES[actorId]) {
    return LOCAL_DEMO_GREETING_NAMES[actorId];
  }

  const knownActorName =
    getKnownActors().find((item) => item.id === actorId)?.label?.trim() || null;
  if (knownActorName) return knownActorName;

  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(getGreetingNameCacheKey(actorId))?.trim() || null;
}

function writeCachedGreetingName(actorId: string, displayName: string | null | undefined) {
  if (typeof window === "undefined" || !actorId || actorId === "guest") return;

  const normalized = displayName?.trim();
  if (!normalized) return;

  window.localStorage.setItem(getGreetingNameCacheKey(actorId), normalized);
}

function normalizeGreetingName(displayName: string | null | undefined) {
  const normalized = displayName?.trim();
  if (!normalized) return null;
  return normalized.toLowerCase() === "guest" ? "游客" : normalized;
}

function readCachedToolboxCapabilities(actorId: string) {
  if (typeof window === "undefined") return [] as ToolboxCapability[];

  try {
    const raw = window.localStorage.getItem(getToolboxCacheKey(actorId));
    if (!raw) return [] as ToolboxCapability[];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as ToolboxCapability[];
    return parsed.filter(
      (item): item is ToolboxCapability =>
        !!item &&
        typeof item === "object" &&
        typeof item.code === "string" &&
        typeof item.name === "string" &&
        typeof item.status === "string" &&
        typeof item.queue === "string" &&
        typeof item.description === "string",
    );
  } catch {
    return [] as ToolboxCapability[];
  }
}

function getInitialToolboxCapabilities(actorId: string) {
  const cached = readCachedToolboxCapabilities(actorId);
  return applyLocalOverrides(cached.length ? cached : DEFAULT_TOOLBOX_CAPABILITIES);
}

function writeCachedToolboxCapabilities(actorId: string, tools: ToolboxCapability[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(getToolboxCacheKey(actorId), JSON.stringify(tools));
  } catch {
    // Ignore cache write failures so the live response still wins.
  }
}

function isRunnableToolboxCode(
  code: string,
): code is (typeof RUNNABLE_TOOLBOX_CODES)[number] {
  return RUNNABLE_TOOLBOX_CODES.includes(
    code as (typeof RUNNABLE_TOOLBOX_CODES)[number],
  );
}

const STEP_LABELS: Record<string, string> = {
  global: "全局设定",
  script: "故事叙述",
  assets: "角色场景",
  storyboards: "分镜脚本",
  videos: "分镜视频",
  dubbing: "配音与口型",
  preview: "成片预览",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "草稿",
  in_production: "制作中",
  published: "已发布",
};

function projectCover(project: Project) {
  if (project.coverUrl && !project.coverUrl.includes("mock.assets.local")) {
    return project.coverUrl;
  }
  return `https://picsum.photos/seed/${project.id}/960/540`;
}

function formatStep(step: string) {
  return STEP_LABELS[step] || step || "未开始";
}

function formatStatus(status: string) {
  return STATUS_LABELS[status] || status || "未知";
}

function formatDateTime(value: string) {
  if (!value) return "--";
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatCredits(value: number | null | undefined, unlimited?: boolean) {
  if (unlimited) return "无限";
  if (typeof value !== "number") return "--";
  return value.toLocaleString("zh-CN");
}

function formatRole(me: PermissionContext | null) {
  if (!me) return "--";
  if (me.currentOrganizationRole === "enterprise_admin") return "企业管理员";
  if (me.currentOrganizationRole === "enterprise_member") return "企业成员";
  if (me.platformRole === "ops_admin") return "运营管理员";
  if (me.platformRole === "super_admin") return "超级管理员";
  if (me.platformRole === "customer") return "注册用户";
  return "游客";
}

function toolStatusLabel(status: string) {
  if (status === "mock_ready") return "已接入";
  if (status === "placeholder") return "待接入";
  if (status === "coming_soon") return "待开发";
  return status;
}

// Tools in any of these statuses render as visually locked + not clickable.
function isToolLocked(status: string) {
  return status === "placeholder" || status === "coming_soon";
}

function getToolVisual(tool: ToolboxCapability) {
  return (
    TOOL_VISUALS[tool.code] ?? {
      icon: Sparkles,
      tone: "bg-primary/10 text-primary ring-primary/20",
    }
  );
}

function homeModelDisplayName(model: PlaygroundModel) {
  if (!model.name && !model.id) return "默认模型";
  if (!model.name) return model.id;
  if (model.name.length <= 18) return model.name;
  return model.name.replace(/^(.{16}).+$/, "$1...");
}

function isAuthBoundaryError(error: unknown) {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
}

function isSignedOutDashboardContext(context: PermissionContext | null) {
  return !hasSessionCredentials() && (!context || context.actor.id === "guest" || context.platformRole === "guest");
}

function statusTone(status: string) {
  if (status === "published")
    return "bg-indigo-500/15 text-indigo-800 ring-indigo-600/40 dark:text-indigo-300 dark:ring-indigo-500/20";
  if (status === "draft")
    return "bg-amber-500/15 text-amber-800 ring-amber-600/40 dark:bg-amber-500/12 dark:text-amber-400 dark:ring-amber-500/20";
  return "bg-sky-500/15 text-sky-800 ring-sky-600/40 dark:bg-sky-500/12 dark:text-sky-400 dark:ring-sky-500/20";
}

export default function Home() {
  const navigate = useNavigate();
  const actorId = useActorId();
  const [currentProjectId] = useCurrentProjectId();
  const [me, setMe] = useState<PermissionContext | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [tools, setTools] = useState<ToolboxCapability[]>(() =>
    getInitialToolboxCapabilities(getCurrentActorId()),
  );
  const [models, setModels] = useState<PlaygroundModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("qwen-plus");
  const [prompt, setPrompt] = useState("");
  const [promptSending, setPromptSending] = useState(false);
  const [networkAccess, setNetworkAccess] = useState<NetworkAccessInfo | null>(null);
  const [networkAccessLoading, setNetworkAccessLoading] = useState(true);
  const [networkAccessError, setNetworkAccessError] = useState(false);
  const [copiedAccessKey, setCopiedAccessKey] = useState<string | null>(null);
  const [toolboxLoading, setToolboxLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(true);
  const [pendingCreate, setPendingCreate] = useState(false);
  const [runningTool, setRunningTool] = useState<string | null>(null);
  const [dashboardIssues, setDashboardIssues] = useState({
    me: false,
    projects: false,
    wallets: false,
    tools: false,
    toolsUsingCache: false,
  });
  const dashboardRequestRef = useRef(0);

  const orderedProjects = useMemo(() => {
    const next = [...projects].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    const idx = next.findIndex((item) => item.id === currentProjectId);
    if (idx > 0) {
      const [active] = next.splice(idx, 1);
      next.unshift(active);
    }
    return next;
  }, [currentProjectId, projects]);

  const activeProject = orderedProjects.find((p) => p.id === currentProjectId) ?? orderedProjects[0] ?? null;
  const cachedGreetingName = useMemo(
    () => readCachedGreetingName(actorId),
    [actorId],
  );
  const guestGreetingName = actorId === "guest" ? "游客" : null;
  const localDemoGreetingName = LOCAL_DEMO_GREETING_NAMES[actorId] ?? null;
  const greetingName =
    guestGreetingName ||
    localDemoGreetingName ||
    normalizeGreetingName(me?.actor?.displayName) ||
    cachedGreetingName ||
    (hasSessionCredentials() && actorId !== "guest" ? "小楼用户" : null);
  const visibleNetworkEntries = useMemo(() => {
    if (!networkAccess) return [];
    return networkAccess.recommendedEntries.length
      ? networkAccess.recommendedEntries
      : networkAccess.additionalEntries;
  }, [networkAccess]);

  const currentOrg = useMemo(
    () => me?.organizations.find((o) => o.id === me.currentOrganizationId) ?? null,
    [me],
  );
  const walletEntitlement = useMemo(() => resolveWalletEntitlement(me), [me]);

  const primaryWallet = useMemo(() => {
    const list = filterWalletsForEntitlement(wallets, walletEntitlement);
    return list[0] ?? null;
  }, [wallets, walletEntitlement]);

  const modelOptions = useMemo<PlaygroundModel[]>(
    () =>
      models.length
        ? models
        : [
            {
              id: "qwen-plus",
              name: "Qwen Plus",
              provider: "fallback",
              configured: true,
              default: true,
            },
          ],
    [models],
  );
  const activeModels = useMemo(() => modelOptions.slice(0, 4), [modelOptions]);
  const selectedModelName = useMemo(() => {
    const model = modelOptions.find((item) => item.id === selectedModel) ?? modelOptions[0];
    return model ? homeModelDisplayName(model) : selectedModel;
  }, [modelOptions, selectedModel]);
  const visibleToolboxTools = useMemo(
    () => (tools.length ? tools : DEFAULT_TOOLBOX_CAPABILITIES).slice(0, 6),
    [tools],
  );
  const readyToolCount = useMemo(
    () => visibleToolboxTools.filter((tool) => !isToolLocked(tool.status)).length,
    [visibleToolboxTools],
  );

  const dashboardNotice = useMemo(() => {
    const notices: string[] = [];

    if (dashboardIssues.me) notices.push("账户上下文加载失败");
    if (dashboardIssues.projects) notices.push("项目列表暂时不可用");
    if (dashboardIssues.wallets) notices.push("钱包服务暂时不可用");
    if (dashboardIssues.tools) {
      notices.push(
        dashboardIssues.toolsUsingCache
          ? "工具箱能力加载失败，已使用缓存"
          : "工具箱能力加载失败",
      );
    }

    return notices.length ? `${notices.join("，")}。其余可用内容已继续显示。` : null;
  }, [dashboardIssues]);

  const loadDashboard = async () => {
    const requestId = ++dashboardRequestRef.current;
    const cachedTools = readCachedToolboxCapabilities(actorId);
    const initialTools = cachedTools.length ? cachedTools : DEFAULT_TOOLBOX_CAPABILITIES;

    setRefreshing(true);
    setDashboardIssues({
      me: false,
      projects: false,
      wallets: false,
      tools: false,
      toolsUsingCache: false,
    });

    setTools(applyLocalOverrides(initialTools));
    setToolboxLoading(true);

    const commitIfCurrent = (callback: () => void) => {
      if (dashboardRequestRef.current !== requestId) return false;
      callback();
      return true;
    };

    let permissionContext: PermissionContext | null = null;
    if (isLocalDemoActorId(actorId) && !hasSessionCredentials()) {
      try {
        const demoSession = await startDemoSession(actorId);
        const sessionCommitted = commitIfCurrent(() => {
          const demoName = LOCAL_DEMO_GREETING_NAMES[demoSession.actorId] ?? demoSession.displayName;
          setAuthToken(demoSession.token);
          setControlApiClientAssertion(demoSession.controlApiClientAssertion);
          rememberKnownActor({
            id: demoSession.actorId,
            label: demoName,
            detail: demoSession.email,
            token: demoSession.token,
            controlApiClientAssertion: demoSession.controlApiClientAssertion,
          });
          writeCachedGreetingName(demoSession.actorId, demoName);
        });
        if (!sessionCommitted) {
          return;
        }
      } catch {
        // Let the normal account context loader decide whether this should surface as an issue.
      }
    }

    try {
      const value = await getMe();
      permissionContext = value;
      commitIfCurrent(() => {
        writeCachedGreetingName(value.actor.id, value.actor.displayName);
        setMe(value);
        setDashboardIssues((prev) => ({ ...prev, me: false }));
      });
    } catch {
      commitIfCurrent(() => {
        setMe(null);
        setDashboardIssues((prev) => ({ ...prev, me: true }));
      });
    }

    const useSignedOutFallback = isSignedOutDashboardContext(permissionContext);

    const projectsPromise = useSignedOutFallback
      ? Promise.resolve(
          commitIfCurrent(() => {
            setProjects([]);
            setDashboardIssues((prev) => ({ ...prev, projects: false }));
          }),
        )
      : listProjects()
          .then((value) => {
            commitIfCurrent(() => {
              setProjects(value.items);
              setDashboardIssues((prev) => ({ ...prev, projects: false }));
            });
          })
          .catch((error) => {
            const suppressIssue = isAuthBoundaryError(error) && !hasSessionCredentials();
            commitIfCurrent(() => {
              setProjects([]);
              setDashboardIssues((prev) => ({ ...prev, projects: !suppressIssue }));
            });
          });
    const walletLoadEntitlement = useSignedOutFallback
      ? null
      : resolveWalletEntitlement(permissionContext);
    const shouldLoadWallets = Boolean(
      walletLoadEntitlement?.ownerType && walletLoadEntitlement.ownerId,
    );
    const walletsPromise = useSignedOutFallback || !shouldLoadWallets
      ? Promise.resolve(
          commitIfCurrent(() => {
            setWallets([]);
            setDashboardIssues((prev) => ({ ...prev, wallets: false }));
          }),
        )
      : listWallets()
          .then((value) => {
            commitIfCurrent(() => {
              setWallets(value.items);
              setDashboardIssues((prev) => ({ ...prev, wallets: false }));
            });
          })
          .catch((error) => {
            const suppressIssue = isAuthBoundaryError(error) && !hasSessionCredentials();
            commitIfCurrent(() => {
              setWallets([]);
              setDashboardIssues((prev) => ({ ...prev, wallets: !suppressIssue }));
            });
          });

    const loadToolsWithRetry = async (attempt = 0): Promise<void> => {
      if (useSignedOutFallback) {
        commitIfCurrent(() => {
          setTools(applyLocalOverrides(initialTools));
          setToolboxLoading(false);
          setDashboardIssues((prev) => ({
            ...prev,
            tools: false,
            toolsUsingCache: false,
          }));
        });
        return;
      }

      try {
        const value = await getToolboxCapabilities();
        const merged = applyLocalOverrides(value.items);
        commitIfCurrent(() => {
          setTools(merged);
          setToolboxLoading(false);
          writeCachedToolboxCapabilities(actorId, merged);
          setDashboardIssues((prev) => ({
            ...prev,
            tools: false,
            toolsUsingCache: false,
          }));
        });
      } catch (error) {
        const fallbackTools = cachedTools.length
          ? cachedTools
          : readCachedToolboxCapabilities(actorId);
        const resolvedFallbackTools = applyLocalOverrides(
          fallbackTools.length ? fallbackTools : DEFAULT_TOOLBOX_CAPABILITIES,
        );
        const usingCachedTools = fallbackTools.length > 0;
        const suppressIssue = isAuthBoundaryError(error) && !hasSessionCredentials();

        commitIfCurrent(() => {
          setTools(resolvedFallbackTools);
          setDashboardIssues((prev) => ({
            ...prev,
            tools: !suppressIssue,
            toolsUsingCache: !suppressIssue && usingCachedTools,
          }));
          setToolboxLoading(!suppressIssue && attempt < TOOLBOX_RETRY_DELAYS_MS.length);
        });

        if (!suppressIssue && attempt < TOOLBOX_RETRY_DELAYS_MS.length) {
          await new Promise((resolve) => window.setTimeout(resolve, TOOLBOX_RETRY_DELAYS_MS[attempt]));
          if (dashboardRequestRef.current === requestId) {
            return loadToolsWithRetry(attempt + 1);
          }
        }

        commitIfCurrent(() => {
          setToolboxLoading(false);
        });
      }
    };

    await Promise.allSettled([
      projectsPromise,
      walletsPromise,
      loadToolsWithRetry(),
    ]);

    if (dashboardRequestRef.current === requestId) {
      setRefreshing(false);
    }
  };

  useEffect(() => { void loadDashboard(); }, [actorId]);

  useEffect(() => {
    let active = true;

    void listPlaygroundModels()
      .then((response) => {
        if (!active) return;
        const items = Array.isArray(response.items) ? response.items : [];
        setModels(items);
        setSelectedModel((current) => {
          if (items.some((model) => model.id === current)) return current;
          return response.defaultModel || items[0]?.id || current;
        });
      })
      .catch(() => {
        if (!active) return;
        setModels([]);
      });

    return () => {
      active = false;
    };
  }, []);

  const loadNetworkAccess = async () => {
    setNetworkAccessLoading(true);
    try {
      const info = await getNetworkAccessInfo();
      setNetworkAccess(info);
      setNetworkAccessError(false);
    } catch {
      setNetworkAccess(null);
      setNetworkAccessError(true);
    } finally {
      setNetworkAccessLoading(false);
    }
  };

  useEffect(() => {
    void loadNetworkAccess();
  }, []);

  const handleCopyAccess = async (value: string, key: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedAccessKey(key);
      window.setTimeout(() => {
        setCopiedAccessKey((current) => (current === key ? null : current));
      }, 1500);
    } catch {
      window.alert("复制失败，请手动选择地址。");
    }
  };

  const handlePromptSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = prompt.trim();
    if (!message || promptSending) return;

    if (!hasSessionCredentials()) {
      window.alert("请先登录或注册账号，再发送到 Playground。");
      return;
    }

    setPromptSending(true);
    try {
      const result = await startPlaygroundChatJob({
        conversationId: null,
        message,
        model: selectedModel,
      });
      setPrompt("");
      const conversationId = result.conversation?.id;
      navigate(
        conversationId
          ? `/playground?conversationId=${encodeURIComponent(conversationId)}`
          : "/playground",
      );
    } catch {
      window.alert("发送到 Playground 失败，请稍后重试。");
    } finally {
      setPromptSending(false);
    }
  };

  const openProject = (project: Project) => {
    setCurrentProjectId(project.id);
    navigate(mapStepToComicPath(project.currentStep));
  };

  const handleCreateProject = async () => {
    if (!me?.permissions.canCreateProject) {
      window.alert("当前身份不能创建项目，请先登录或注册账号。");
      return;
    }
    const isEnterprise = !!me.currentOrganizationId && me.permissions.canManageOrganization;
    setPendingCreate(true);
    try {
      const ts = new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      const project = await createProject({
        title: `漫剧项目 ${ts}`,
        summary: "从首页直接创建的创作项目。",
        ownerType: isEnterprise ? "organization" : "personal",
        organizationId: isEnterprise ? me.currentOrganizationId || undefined : undefined,
      });
      setCurrentProjectId(project.id);
      navigate("/comic/global");
    } catch {
      window.alert("项目创建失败，请确认已登录后重试。");
    } finally {
      setPendingCreate(false);
    }
  };

  const handleToolbox = async (tool: ToolboxCapability) => {
    // 锁定中的工具（placeholder / coming_soon）不允许点击进入，直接忽略。
    if (isToolLocked(tool.status)) {
      return;
    }
    if (tool.code === "video_character_replace") {
      navigate("/create/script-breakdown");
      return;
    }
    if (tool.code === "character_replace") {
      navigate("/create/video-replace");
      return;
    }
    if (tool.code === "upscale_restore") {
      navigate("/create/video-reverse");
      return;
    }
    if (tool.code === "storyboard_25") {
      navigate("/create/storyboard-25");
      return;
    }
    if (!activeProject) return;
    setRunningTool(tool.code);
    try {
      if (isRunnableToolboxCode(tool.code)) {
        await runToolboxCapability(tool.code, {
          projectId: activeProject.id,
          target: activeProject.title,
          note: `${tool.name} from dashboard`,
        });
        await loadDashboard();
      }
    } finally {
      setRunningTool(null);
    }
  };

  const shouldShowToolboxSection =
    toolboxLoading || tools.length > 0 || dashboardIssues.tools || !refreshing;

  return (
    <div className="flex-1 overflow-y-auto bg-background custom-scrollbar">
      <div className="mx-auto max-w-[1280px] space-y-10 px-6 py-10 sm:px-10">
        {dashboardNotice ? (
          <div className="rounded-xl border border-amber-600/40 bg-amber-500/15 px-5 py-3.5 text-sm text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/8 dark:text-amber-200/90">
            {dashboardNotice}
          </div>
        ) : null}

        <section className="mx-auto flex min-h-[38rem] w-full max-w-5xl flex-col items-center justify-center px-1 py-10 text-center sm:py-14">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/35 px-3 py-1.5 text-xs font-medium text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            {greetingName ? `你好，${greetingName}` : "创境 AI 工作台"}
          </div>

          <h1 className="mt-6 max-w-3xl text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
            从一句想法开始创作
          </h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            输入短片脚本、角色设定或视觉方向，直接发送到 Playground 继续拆解、生成和管理创作任务。
          </p>

          <form onSubmit={handlePromptSubmit} className="mt-8 w-full max-w-3xl">
            <div className="rounded-[22px] border border-border bg-card px-3 pb-3 pt-3 text-left shadow-[0_18px_48px_rgba(15,23,42,0.10)] transition focus-within:border-primary/35 focus-within:shadow-[0_22px_60px_rgba(79,70,229,0.16)]">
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                disabled={promptSending}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="让创境AI帮你设计一个短片脚本、角色设定或视觉方向"
                rows={3}
                className="max-h-[160px] min-h-[88px] w-full resize-none bg-transparent px-1 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
                aria-label="创意输入"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                  <span className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-2.5 text-sm">
                    <Bot className="h-3.5 w-3.5 shrink-0" />
                    Agent
                  </span>
                  <span className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-xl px-2.5 text-sm">
                    <Box className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{selectedModelName}</span>
                  </span>
                </div>
                <button
                  type="submit"
                  disabled={!prompt.trim() || promptSending}
                  className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-foreground text-background shadow-sm transition hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground"
                  aria-label="发送到 Playground"
                  title="发送到 Playground"
                >
                  {promptSending ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          </form>

          <div className="mt-4 w-full max-w-3xl overflow-hidden">
            <div className="custom-scrollbar -mx-5 flex snap-x gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0 sm:pb-0">
              {activeModels.map((model) => {
                const selected = model.id === selectedModel;
                return (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => setSelectedModel(model.id)}
                    className={cn(
                      "inline-flex h-8 shrink-0 snap-start items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      selected
                        ? "border-primary/55 bg-primary/10 text-primary"
                        : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                    aria-pressed={selected}
                  >
                    {homeModelDisplayName(model)}
                  </button>
                );
              })}
              {toolboxLoading ? (
                <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-medium text-muted-foreground">
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  同步工具箱
                </span>
              ) : null}
            </div>
          </div>

          <div className="mt-6 flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
            {[
              { label: "身份", value: formatRole(me) },
              { label: "组织", value: currentOrg?.name || "个人" },
              { label: "项目", value: String(projects.length) },
              {
                label: "余额",
                value: primaryWallet
                  ? formatCredits(primaryWallet.creditsAvailable, primaryWallet.unlimitedCredits)
                  : "--",
              },
            ].map((chip) => (
              <span
                key={chip.label}
                className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-background px-3"
              >
                <span>{chip.label}</span>
                <span className="font-medium text-foreground">{chip.value}</span>
              </span>
            ))}
            <button
              type="button"
              onClick={() => void handleCreateProject()}
              disabled={pendingCreate}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-background px-3 font-medium text-foreground transition hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
            >
              {pendingCreate ? (
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              新建项目
            </button>
            {walletEntitlement.canRecharge ? (
              <button
                type="button"
                onClick={() => navigate("/wallet/recharge")}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-background px-3 font-medium text-foreground transition hover:bg-accent"
              >
                充值
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </section>

        {/* ── Toolbox ── */}
        {shouldShowToolboxSection ? (
          <section className="mx-auto w-full max-w-5xl">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-foreground">AI 工具箱</h2>
              </div>
              <span className="shrink-0 rounded-full border border-border bg-muted/35 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                已接入 {readyToolCount}/{visibleToolboxTools.length}
              </span>
            </div>

            {visibleToolboxTools.length ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visibleToolboxTools.map((tool) => {
                  const visual = getToolVisual(tool);
                  const Icon = visual.icon;
                  const isPending = runningTool === tool.code;
                  const locked = isToolLocked(tool.status);
                  const requiresProject =
                    !locked &&
                    tool.code !== "video_character_replace" &&
                    tool.code !== "character_replace" &&
                    tool.code !== "upscale_restore" &&
                    tool.code !== "storyboard_25";
                  const disabled = locked || isPending || (requiresProject && !activeProject);

                  return (
                    <button
                      key={tool.code}
                      type="button"
                      onClick={() => void handleToolbox(tool)}
                      disabled={disabled}
                      className={cn(
                        "group relative flex min-h-[6.75rem] items-start gap-3 rounded-lg border border-border bg-background p-3.5 text-left shadow-sm transition-[transform,box-shadow,border-color,background-color] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        locked
                          ? "cursor-not-allowed opacity-60"
                          : "hover:-translate-y-1 hover:border-primary/45 hover:bg-card hover:shadow-[0_20px_45px_rgba(15,23,42,0.14)]",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 transition-transform duration-200 ease-out group-hover:scale-105",
                          visual.tone,
                        )}
                      >
                        {isPending ? (
                          <LoaderCircle className="h-5 w-5 animate-spin" />
                        ) : (
                          <Icon className="h-5 w-5" />
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-foreground">
                              {tool.name}
                            </span>
                            <span className="mt-1 inline-flex rounded-full border border-border bg-muted/35 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {isPending ? "处理中…" : toolStatusLabel(tool.status)}
                            </span>
                          </span>
                          {!locked ? (
                            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                          ) : null}
                        </span>
                        <span className="mt-2 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                          {requiresProject && !activeProject
                            ? "选择一个项目后可启用该工具。"
                            : tool.description}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : toolboxLoading ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <div
                    key={`tool-skeleton-${index}`}
                    className="min-h-[6.75rem] animate-pulse rounded-lg border border-border bg-muted/30"
                  />
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-muted/25 px-6 py-8 text-sm text-muted-foreground">
                {dashboardIssues.tools
                  ? "工具箱能力正在恢复，请稍后自动重试或手动刷新。"
                  : "工具箱能力暂时为空，请确认账号权限或稍后再试。"}
              </div>
            )}
          </section>
        ) : null}

        {/* ── Projects ── */}
        <section>
          <div className="mb-6 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-foreground">最近项目</h2>
              <p className="mt-1 text-sm text-muted-foreground">当前身份可访问的全部项目</p>
            </div>
            {orderedProjects.length > 4 ? (
              <button
                type="button"
                onClick={() => void loadDashboard()}
                disabled={refreshing}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
              >
                {refreshing ? "刷新中…" : "查看全部"}
              </button>
            ) : null}
          </div>

          {orderedProjects.length ? (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {orderedProjects.map((project) => {
                const isActive = project.id === currentProjectId;
                return (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => openProject(project)}
                    className={cn(
                      "group relative overflow-hidden rounded-2xl border text-left transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-black/25",
                      isActive
                        ? "border-primary/30 bg-primary/[0.03] shadow-lg shadow-primary/10"
                        : "border-white/[0.06] bg-white/[0.02]",
                    )}
                  >
                    <div className="relative aspect-[16/10] overflow-hidden bg-muted/30">
                      <img
                        src={projectCover(project)}
                        alt={project.title}
                        className="h-full w-full object-cover opacity-80 transition-all duration-500 group-hover:scale-105 group-hover:opacity-100"
                        loading="lazy"
                        decoding="async"
                        referrerPolicy="no-referrer"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent" />

                      <div className="absolute left-3 top-3 flex gap-2">
                        <span className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-semibold ring-1 backdrop-blur-sm", statusTone(project.status))}>
                          {formatStatus(project.status)}
                        </span>
                        {project.ownerType === "organization" ? (
                          <span className="rounded-full bg-primary/20 px-2.5 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-primary/20 backdrop-blur-sm">
                            企业
                          </span>
                        ) : null}
                      </div>

                      <div className="absolute bottom-0 left-0 right-0 p-4">
                        <h3 className="truncate text-sm font-semibold text-white drop-shadow-md">{project.title}</h3>
                      </div>
                    </div>

                    <div className="p-4">
                      <p className="line-clamp-2 min-h-[2.5rem] text-xs leading-5 text-muted-foreground">
                        {project.summary || "项目摘要会显示在这里。"}
                      </p>

                      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>{formatStep(project.currentStep)}</span>
                        <span>{formatDateTime(project.updatedAt)}</span>
                      </div>

                      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary transition-[width] duration-500"
                          style={{ width: `${project.progressPercent}%` }}
                        />
                      </div>

                      <div className="mt-4 flex items-center justify-center gap-2 rounded-lg bg-white/[0.04] py-2 text-xs font-medium text-foreground/80 transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                        继续创作
                        <ArrowRight className="h-3.5 w-3.5" />
                      </div>
                    </div>
                  </button>
                );
              })}

              <button
                type="button"
                onClick={() => void handleCreateProject()}
                disabled={pendingCreate}
                className="flex min-h-[280px] flex-col items-center justify-center rounded-2xl border-2 border-dashed border-white/[0.08] text-muted-foreground transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:bg-primary/[0.02] hover:text-primary disabled:pointer-events-none disabled:opacity-50"
              >
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-white/[0.04]">
                  {pendingCreate ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
                </div>
                <span className="text-sm font-medium">新建项目</span>
                <span className="mt-1 text-xs text-muted-foreground">开始新的创作流程</span>
              </button>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] py-16 text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.04]">
                <Film className="h-6 w-6 text-muted-foreground" />
              </div>
              <h3 className="text-base font-medium text-foreground">还没有项目</h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                点击下方按钮创建你的第一个漫剧项目，或先登录获取完整权限。
              </p>
              <button
                type="button"
                onClick={() => void handleCreateProject()}
                disabled={pendingCreate}
                className="mt-6 inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-all hover:-translate-y-px disabled:pointer-events-none disabled:opacity-50"
              >
                {pendingCreate ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                创建第一个项目
              </button>
            </div>
          )}
        </section>

        <section className="mx-auto w-full max-w-5xl">
          <details className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-left">
            <summary className="cursor-pointer list-none text-sm font-medium text-muted-foreground marker:hidden">
              <span className="inline-flex items-center gap-2">
                <Wifi className="h-4 w-4" />
                局域网共享入口
              </span>
            </summary>

            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
                  运维和内测时使用，同一网络的同事可复制地址访问当前项目。
                </p>
                <button
                  type="button"
                  onClick={() => void loadNetworkAccess()}
                  disabled={networkAccessLoading}
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground transition hover:bg-accent disabled:pointer-events-none disabled:opacity-50"
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", networkAccessLoading ? "animate-spin" : "")} />
                  刷新地址
                </button>
              </div>

              {networkAccess ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {visibleNetworkEntries.slice(0, 2).map((entry) => (
                    <div
                      key={`${entry.interfaceName}-${entry.address}`}
                      className="rounded-lg border border-border bg-background p-3"
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                          {entry.interfaceName}
                        </span>
                        <span className="text-xs text-muted-foreground">{entry.address}</span>
                      </div>
                      {[
                        { label: "首页", url: entry.homeUrl },
                        { label: "画布", url: entry.canvasUrl },
                      ].map((row) => {
                        const copyKey = `${entry.address}:${row.label}`;
                        const copied = copiedAccessKey === copyKey;
                        return (
                          <div
                            key={copyKey}
                            className="flex items-center gap-2 border-t border-border/70 py-2 first:border-t-0 first:pt-0 last:pb-0"
                          >
                            <span className="w-8 shrink-0 text-xs text-muted-foreground">{row.label}</span>
                            <code className="min-w-0 flex-1 truncate text-xs text-foreground">
                              {row.url}
                            </code>
                            <button
                              type="button"
                              onClick={() => void handleCopyAccess(row.url, copyKey)}
                              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition hover:text-foreground"
                              aria-label={`复制${row.label}地址`}
                            >
                              {copied ? (
                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-background px-4 py-3 text-xs text-muted-foreground">
                  {networkAccessLoading
                    ? "正在检测当前机器可分享的访问地址..."
                    : networkAccessError
                      ? "未能读取局域网访问地址，请稍后重试。"
                      : "暂未检测到可分享的访问地址。"}
                </div>
              )}
            </div>
          </details>
        </section>
      </div>
    </div>
  );
}
