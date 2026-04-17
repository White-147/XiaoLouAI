import {
  ArrowRight,
  Film,
  LoaderCircle,
  MonitorPlay,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getCurrentActorId, useActorId } from "../lib/actor-session";
import {
  createProject,
  getMe,
  getToolboxCapabilities,
  listProjects,
  listWallets,
  mapStepToComicPath,
  runToolboxCapability,
  type PermissionContext,
  type Project,
  type ToolboxCapability,
  type Wallet as WalletInfo,
} from "../lib/api";
import { setCurrentProjectId, useCurrentProjectId } from "../lib/session";
import { cn } from "../lib/utils";

const RUNNABLE_TOOLBOX_CODES = [
  "character_replace",
  "motion_transfer",
  "upscale_restore",
] as const;

const TOOLBOX_CACHE_KEY_PREFIX = "xiaolou.home.toolbox-capabilities.v1";
const TOOLBOX_RETRY_DELAYS_MS = [1200, 3000];
const DEFAULT_TOOLBOX_CAPABILITIES: ToolboxCapability[] = [
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
    status: "mock_ready",
    queue: "video-gpu",
    description: "把参考动作迁移到指定角色或现有镜头视频。",
  },
  {
    code: "upscale_restore",
    name: "超清修复",
    status: "mock_ready",
    queue: "image-cpu",
    description: "对低清镜头图、视频帧或导出视频做超分修复。",
  },
  {
    code: "toolbox_reserved",
    name: "待开发能力",
    status: "placeholder",
    queue: "unassigned",
    description: "预留未来工具箱能力入口，例如表情迁移、镜头扩图和局部重绘。",
  },
];

function getToolboxCacheKey(actorId: string) {
  return `${TOOLBOX_CACHE_KEY_PREFIX}:${actorId || "guest"}`;
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
  return cached.length ? cached : DEFAULT_TOOLBOX_CAPABILITIES;
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

function resolveVisibleWallets(wallets: WalletInfo[], me: PermissionContext | null) {
  if (!me || !wallets.length) return wallets;
  const isEnterprise =
    me.currentOrganizationRole === "enterprise_admin" || me.currentOrganizationRole === "enterprise_member";
  if (isEnterprise) {
    const orgWallets = wallets.filter((w) => w.ownerType === "organization");
    return orgWallets.length ? orgWallets : wallets;
  }
  return wallets.filter((w) => w.ownerType !== "organization");
}

function toolStatusLabel(status: string) {
  if (status === "mock_ready") return "已接入";
  if (status === "placeholder") return "待接入";
  return status;
}

function statusTone(status: string) {
  if (status === "published") return "bg-indigo-500/15 text-indigo-300 ring-indigo-500/20";
  if (status === "draft") return "bg-amber-500/12 text-amber-400 ring-amber-500/20";
  return "bg-sky-500/12 text-sky-400 ring-sky-500/20";
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

  const currentOrg = useMemo(
    () => me?.organizations.find((o) => o.id === me.currentOrganizationId) ?? null,
    [me],
  );

  const primaryWallet = useMemo(() => {
    const list = resolveVisibleWallets(wallets, me);
    return list[0] ?? null;
  }, [wallets, me]);

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

    setTools(initialTools);
    setToolboxLoading(true);

    const commitIfCurrent = (callback: () => void) => {
      if (dashboardRequestRef.current !== requestId) return false;
      callback();
      return true;
    };

    const mePromise = getMe()
      .then((value) => {
        commitIfCurrent(() => {
          setMe(value);
          setDashboardIssues((prev) => ({ ...prev, me: false }));
        });
      })
      .catch(() => {
        commitIfCurrent(() => {
          setMe(null);
          setDashboardIssues((prev) => ({ ...prev, me: true }));
        });
      });

    const projectsPromise = listProjects()
      .then((value) => {
        commitIfCurrent(() => {
          setProjects(value.items);
          setDashboardIssues((prev) => ({ ...prev, projects: false }));
        });
      })
      .catch(() => {
        commitIfCurrent(() => {
          setProjects([]);
          setDashboardIssues((prev) => ({ ...prev, projects: true }));
        });
      });
    const walletsPromise = listWallets()
      .then((value) => {
        commitIfCurrent(() => {
          setWallets(value.items);
          setDashboardIssues((prev) => ({ ...prev, wallets: false }));
        });
      })
      .catch(() => {
        commitIfCurrent(() => {
          setWallets([]);
          setDashboardIssues((prev) => ({ ...prev, wallets: true }));
        });
      });

    const loadToolsWithRetry = async (attempt = 0): Promise<void> => {
      try {
        const value = await getToolboxCapabilities();
        commitIfCurrent(() => {
          setTools(value.items);
          setToolboxLoading(false);
          writeCachedToolboxCapabilities(actorId, value.items);
          setDashboardIssues((prev) => ({
            ...prev,
            tools: false,
            toolsUsingCache: false,
          }));
        });
      } catch {
        const fallbackTools = cachedTools.length
          ? cachedTools
          : readCachedToolboxCapabilities(actorId);
        const resolvedFallbackTools = fallbackTools.length
          ? fallbackTools
          : DEFAULT_TOOLBOX_CAPABILITIES;
        const usingCachedTools = fallbackTools.length > 0;

        commitIfCurrent(() => {
          setTools(resolvedFallbackTools);
          setDashboardIssues((prev) => ({
            ...prev,
            tools: true,
            toolsUsingCache: usingCachedTools,
          }));
          setToolboxLoading(attempt < TOOLBOX_RETRY_DELAYS_MS.length);
        });

        if (attempt < TOOLBOX_RETRY_DELAYS_MS.length) {
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
      mePromise,
      projectsPromise,
      walletsPromise,
      loadToolsWithRetry(),
    ]);

    if (dashboardRequestRef.current === requestId) {
      setRefreshing(false);
    }
  };

  useEffect(() => { void loadDashboard(); }, [actorId]);

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
        budgetLimitCredits: isEnterprise ? 2400 : 600,
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
          <div className="rounded-xl border border-amber-500/20 bg-amber-500/8 px-5 py-3.5 text-sm text-amber-200/90">
            {dashboardNotice}
          </div>
        ) : null}

        {/* ── Hero ── */}
        <section className="relative overflow-hidden rounded-3xl border border-border bg-card p-8 shadow-xl shadow-black/10 sm:p-10">
          <div className="relative flex flex-col gap-5 lg:grid lg:max-w-none lg:grid-cols-[minmax(0,42rem)_auto] lg:items-start lg:gap-x-10 lg:gap-y-5">
            <div className="inline-flex w-fit items-center gap-2 rounded-full bg-primary/10 px-3.5 py-1.5 text-xs font-medium text-primary ring-1 ring-primary/20 lg:row-start-1 lg:col-start-1">
              <Film className="h-3.5 w-3.5" />
              工作台
            </div>

            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl lg:row-start-2 lg:col-start-1">
              {me?.actor?.displayName ? `你好，${me.actor.displayName}` : "欢迎回到小楼"}
            </h1>

            <p className="text-sm leading-7 text-muted-foreground sm:text-base lg:row-start-3 lg:col-start-1">
              {activeProject
                ? `当前聚焦「${activeProject.title}」· ${formatStep(activeProject.currentStep)} · ${activeProject.progressPercent}% 进度`
                : "在这里管理项目、查看资产余额、启用 AI 工具。"}
            </p>

            <button
              type="button"
              onClick={() => void handleCreateProject()}
              disabled={pendingCreate}
              className="inline-flex min-h-11 w-fit shrink-0 items-center gap-2.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/20 transition-all hover:-translate-y-px hover:shadow-lg hover:shadow-primary/25 active:translate-y-0 disabled:pointer-events-none disabled:opacity-50 sm:px-6 lg:row-start-1 lg:col-start-2 lg:self-center lg:justify-self-end"
            >
              {pendingCreate ? (
                <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <Film className="h-4 w-4 shrink-0" />
              )}
              新增AIGC创作项目
            </button>

            <div className="flex flex-wrap items-center gap-3 text-xs lg:row-start-3 lg:col-start-2 lg:max-w-none lg:justify-end">
              {[
                { label: "身份", value: formatRole(me) },
                { label: "组织", value: currentOrg?.name || "个人" },
                { label: "项目总数", value: String(projects.length) },
              ].map((chip) => (
                <div
                  key={chip.label}
                  className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-4 py-2 backdrop-blur"
                >
                  <span className="text-muted-foreground">{chip.label}</span>
                  <span className="font-medium text-foreground">{chip.value}</span>
                </div>
              ))}
              <div className="flex items-center gap-2 rounded-full border border-white/[0.06] bg-white/[0.03] px-4 py-2 backdrop-blur">
                <span className="text-muted-foreground">余额</span>
                <span className="font-medium text-foreground">
                  {primaryWallet
                    ? formatCredits(primaryWallet.creditsAvailable, primaryWallet.unlimitedCredits)
                    : "--"}
                </span>
                {me?.permissions.canRecharge ? (
                  <>
                    <span className="mx-1 h-3 w-px shrink-0 bg-border/80" aria-hidden />
                    <button
                      type="button"
                      onClick={() => navigate("/wallet/recharge")}
                      className="inline-flex items-center gap-1 rounded-md px-1 py-0 text-xs font-medium text-primary underline-offset-4 transition-colors hover:text-primary/80 hover:underline"
                    >
                      充值
                      <ArrowRight className="h-3 w-3 shrink-0" />
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        {/* ── Toolbox ── */}
        {shouldShowToolboxSection ? (
          <section>
            <div className="mb-6 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-xl font-bold tracking-tight text-foreground">AI 工具箱</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {activeProject ? `当前作用项目：${activeProject.title}` : "选择一个项目后可启用工具"}
                </p>
              </div>
              <div className="flex items-center gap-3 text-muted-foreground/50">
                {toolboxLoading ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : null}
                <MonitorPlay className="h-5 w-5" />
              </div>
            </div>

            {tools.length ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {tools.map((tool) => {
                const isPending = runningTool === tool.code;
                const disabled = tool.status === "placeholder" || isPending || !activeProject;

                return (
                  <div
                    key={tool.code}
                    className={cn(
                      "group relative flex flex-col overflow-hidden rounded-2xl border p-5 transition-all duration-200",
                      tool.status === "placeholder"
                        ? "border-white/[0.04] bg-white/[0.01] opacity-50 grayscale-[0.15]"
                        : "border-white/[0.06] bg-white/[0.025] hover:-translate-y-0.5 hover:border-primary/15 hover:shadow-lg hover:shadow-primary/5",
                    )}
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/8 text-primary">
                        {isPending ? <LoaderCircle className="h-[18px] w-[18px] animate-spin" /> : <Sparkles className="h-[18px] w-[18px]" />}
                      </div>
                      <span className={cn(
                        "rounded-full px-2.5 py-0.5 text-[10px] font-medium",
                        tool.status === "placeholder"
                          ? "bg-white/[0.04] text-muted-foreground/60"
                          : "bg-indigo-500/10 text-indigo-300",
                      )}>
                        {toolStatusLabel(tool.status)}
                      </span>
                    </div>

                    <h3 className="mb-1.5 text-sm font-semibold text-foreground">{tool.name}</h3>
                    <p className="mb-5 flex-1 text-xs leading-5 text-muted-foreground">{tool.description}</p>

                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => void handleToolbox(tool)}
                      className="flex h-9 w-full items-center justify-center rounded-lg bg-white/[0.04] text-xs font-medium text-foreground/70 transition-colors hover:bg-primary/10 hover:text-primary disabled:pointer-events-none disabled:opacity-40"
                    >
                      {tool.status === "placeholder"
                        ? "开发中"
                        : isPending
                          ? "处理中…"
                          : activeProject
                            ? "进入工具"
                            : "先选择项目"}
                    </button>
                  </div>
                );
              })}
              </div>
            ) : toolboxLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={`tool-skeleton-${index}`}
                    className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5"
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="h-10 w-10 animate-pulse rounded-xl bg-white/[0.08]" />
                      <div className="h-5 w-16 animate-pulse rounded-full bg-white/[0.06]" />
                    </div>
                    <div className="mb-2 h-5 w-2/3 animate-pulse rounded bg-white/[0.08]" />
                    <div className="mb-1.5 h-4 w-full animate-pulse rounded bg-white/[0.05]" />
                    <div className="mb-5 h-4 w-5/6 animate-pulse rounded bg-white/[0.05]" />
                    <div className="h-9 w-full animate-pulse rounded-lg bg-white/[0.06]" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] px-6 py-8 text-sm text-muted-foreground">
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
      </div>
    </div>
  );
}
