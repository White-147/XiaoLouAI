import { Suspense, lazy, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  Building2,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Eye,
  EyeOff,
  Film,
  FlaskConical,
  FolderOpen,
  HelpCircle,
  Image as ImageIcon,
  Keyboard,
  LayoutDashboard,
  LayoutTemplate,
  LoaderCircle,
  LogIn,
  LogOut,
  Mic,
  MonitorPlay,
  Moon,
  MoreHorizontal,
  PlaySquare,
  Settings,
  ShieldCheck,
  Sparkles,
  Sun,
  Trash2,
  UserPlus,
  UserRound,
  Users,
  Video,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  getMe,
  ensureJaazServices,
  listProjects,
  loginWithEmail,
  registerPersonalUser,
  registerEnterpriseAdmin,
  exchangeGoogleLogin,
  syncAgentStudioAsset,
  syncAgentStudioCanvasProject,
  type AgentStudioAssetSyncInput,
  type AgentStudioCanvasProjectSyncInput,
  type PermissionContext,
  type RegisterPersonalInput,
  type RegisterEnterpriseAdminInput,
} from "../lib/api";
import {
  getKnownActors,
  getKnownActorToken,
  rememberKnownActor,
  removeKnownActor,
  setCurrentActorId,
  setAuthToken,
  logout,
  useActorId,
} from "../lib/actor-session";
import { isLocalLoopbackAccess, SUPER_ADMIN_DEMO_ACTOR_ID } from "../lib/local-loopback";
import { runNavigationGuards } from "../lib/navigation-guards";
import { getCurrentProjectId, setCurrentProjectId } from "../lib/session";
import { useTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { removeGoogleLoginParams } from "../lib/google-auth";
// Lazy-load the canvas shells so users who never open them pay no parse cost.
const CanvasCreate = lazy(() => import("../pages/create/CanvasCreate"));
const AgentCanvasCreate = lazy(() => import("../pages/create/AgentCanvasCreate"));
const AgentStudioCanvasCreate = lazy(() => import("../pages/create/JaazAgentCanvasEmbed"));
import { ProfileModal } from "./modals/ProfileModal";
import { GoogleLoginButton } from "./auth/GoogleLoginButton";

const CanvasLoadingFallback = () => (
  <div className="flex h-full w-full items-center justify-center bg-[#f8f6f1] px-6 text-[#171512]">
    <div className="w-full max-w-md rounded-[28px] border border-[rgba(23,21,18,0.08)] bg-white/92 p-6 shadow-[0_24px_80px_rgba(17,24,39,0.12)] backdrop-blur-md">
      <div className="text-xs font-semibold tracking-[0.28em] text-[#8f877a]">CANVAS</div>
      <div className="mt-3 text-2xl font-semibold text-[#161411]">正在打开画布项目</div>
      <p className="mt-3 text-sm leading-6 text-[#6c655b]">
        正在装载画布编辑器并恢复项目节点，这一步在站内跳转和外网环境下都可能稍慢一点。
      </p>
      <div className="mt-5 h-2 overflow-hidden rounded-full bg-[#ece7dd]">
        <div className="h-full w-1/3 animate-pulse rounded-full bg-[#4f46e5]" />
      </div>
    </div>
  </div>
);

type NavItem = {
  name: string;
  path?: string;
  icon: typeof LayoutDashboard;
  children?: Array<{
    name: string;
    path: string;
    icon: typeof LayoutDashboard;
  }>;
};

const navItems: NavItem[] = [
  { name: "首页", path: "/home", icon: LayoutDashboard },
  { name: "创意入口", path: "/playground", icon: FlaskConical },
  { name: "创境天幕", path: "/create/canvas", icon: LayoutTemplate },
  {
    name: "通用创作",
    icon: ImageIcon,
    children: [
      { name: "图片创作", path: "/create/image", icon: ImageIcon },
      { name: "视频创作", path: "/create/video", icon: Video },
    ],
  },
  {
    name: "剧集创作",
    icon: Film,
    children: [
      { name: "全局设定", path: "/comic/global", icon: Settings },
      { name: "故事叙述", path: "/comic/script", icon: BookOpen },
      { name: "角色场景资产", path: "/comic/entities", icon: Users },
      { name: "分镜脚本", path: "/comic/storyboard", icon: LayoutTemplate },
      { name: "分镜视频", path: "/comic/video", icon: PlaySquare },
      { name: "配音与口型", path: "/comic/dubbing", icon: Mic },
      { name: "成片预览", path: "/comic/preview", icon: MonitorPlay },
    ],
  },
  { name: "项目管理", path: "/assets", icon: FolderOpen },
];

const demoActors = [
  { id: "guest", label: "游客", detail: "浏览案例与注册入口，不可创建作品" },
  { id: "user_personal_001", label: "注册用户", detail: "个人项目、个人资产与积分钱包" },
  { id: "user_member_001", label: "企业成员", detail: "共享项目、企业资产与团队协作" },
  { id: "user_demo_001", label: "企业管理员", detail: "成员管理、钱包扣费与共享权限" },
  { id: "ops_demo_001", label: "运营管理员", detail: "平台配置、企业审核与订单管理" },
  { id: SUPER_ADMIN_DEMO_ACTOR_ID, label: "超级管理员", detail: "系统配置、审计日志与风控能力" },
];

function formatPlatformRole(context: PermissionContext | null) {
  if (!context) return "--";
  if (context.currentOrganizationRole === "enterprise_admin") return "企业管理员";
  if (context.currentOrganizationRole === "enterprise_member") return "企业成员";
  if (context.platformRole === "ops_admin") return "运营管理员";
  if (context.platformRole === "super_admin") return "超级管理员";
  if (context.platformRole === "customer") return "注册用户";
  return "游客";
}

function AuthField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{props.label}</span>
      <input
        type={props.type || "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className="h-10 w-full rounded-xl border border-border/70 bg-background/55 px-3.5 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
      />
    </label>
  );
}

export default function Layout() {
  const actorId = useActorId();
  const location = useLocation();
  const navigate = useNavigate();
  const isCanvasRoute = location.pathname === "/create/canvas";
  const isAgentCanvasRoute = location.pathname === "/create/agent-canvas";
  const isAgentStudioCanvasRoute = location.pathname === "/create/agent-studio";
  const [isCollapsed, setIsCollapsed] = useState(true);
  /** 收起侧栏时，带子菜单项的浮层（不自动展开侧栏） */
  const [collapsedNavFlyout, setCollapsedNavFlyout] = useState<{
    parentName: string;
    top: number;
    left: number;
  } | null>(null);
  const [theme, setTheme] = useTheme();
  const [isMoreModalOpen, setIsMoreModalOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [permissionContext, setPermissionContext] = useState<PermissionContext | null>(null);
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({
    剧集创作: false,
    通用创作: false,
  });
  /** 侧栏展开宽度约为原 272px 的 2/3；收起宽度略收，与整体比例协调 */
  const sidebarWidthExpanded = 182;
  const sidebarWidthCollapsed = 72;
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState<"login" | "register">("login");
  const [authRegisterMode, setAuthRegisterMode] = useState<"personal" | "enterprise_admin">("personal");
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [knownActorsVer, setKnownActorsVer] = useState(0);
  // Canvas mounting policy: canvas shells are mounted only for their routes.
  const hasMountedCanvas = isCanvasRoute;
  const hasMountedAgentCanvas = isAgentCanvasRoute;
  const [hasMountedAgentStudioCanvas, setHasMountedAgentStudioCanvas] = useState(isAgentStudioCanvasRoute);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });

  // True only for localhost / 127.0.0.1 / ::1 — false on every real external domain
  // or LAN IP. Stable for the lifetime of the page (hostname never changes).
  const isLoopback = typeof window !== "undefined" && isLocalLoopbackAccess();

  const visibleDemoActors = useMemo(() => {
    if (typeof window === "undefined") {
      return demoActors;
    }
    return isLocalLoopbackAccess()
      ? demoActors
      : demoActors.filter((actor) => actor.id !== SUPER_ADMIN_DEMO_ACTOR_ID);
  }, []);
  const [personalForm, setPersonalForm] = useState<RegisterPersonalInput>({
    displayName: "",
    email: "",
    phone: "",
    password: "",
  });
  const [enterpriseForm, setEnterpriseForm] = useState<RegisterEnterpriseAdminInput>({
    companyName: "",
    adminName: "",
    email: "",
    phone: "",
    password: "",
    licenseNo: "",
    industry: "",
    teamSize: "",
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isLocalLoopbackAccess()) return;
    if (actorId !== SUPER_ADMIN_DEMO_ACTOR_ID) return;
    setAuthToken(null);
    setCurrentActorId("guest");
    navigate("/home");
  }, [actorId, navigate]);

  useEffect(() => {
    if (isAgentStudioCanvasRoute) {
      setHasMountedAgentStudioCanvas(true);
    }
  }, [isAgentStudioCanvasRoute]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const allowedOrigins = new Set([window.location.origin]);
    try {
      const configuredJaazUrl = String(import.meta.env.VITE_JAAZ_AGENT_CANVAS_URL || "/jaaz/").trim() || "/jaaz/";
      allowedOrigins.add(new URL(configuredJaazUrl, window.location.href).origin);
    } catch {
      // Keep same-origin as the safe default.
    }

    const handleMessage = (event: MessageEvent) => {
      if (!allowedOrigins.has(event.origin)) return;
      const message = event.data as {
        type?: string;
        asset?: AgentStudioAssetSyncInput;
        project?: AgentStudioCanvasProjectSyncInput;
      } | null;

      if (
        message?.type === "xiaolou:agent-asset:upsert" &&
        message.asset?.fileUrl
      ) {
        const projectId = getCurrentProjectId(actorId);
        void syncAgentStudioAsset(projectId, message.asset)
          .then((asset) => {
            window.dispatchEvent(
              new CustomEvent("xiaolou:agent-asset:synced", {
                detail: { projectId, asset },
              }),
            );
          })
          .catch((error) => {
            console.warn("[Layout] Failed to sync Jaaz asset:", error);
          });
        return;
      }

      if (
        message?.type === "xiaolou:agent-canvas-project:upsert" &&
        message.project?.canvasId
      ) {
        const projectId = getCurrentProjectId(actorId);
        void syncAgentStudioCanvasProject(projectId, message.project)
          .then((projectAsset) => {
            window.dispatchEvent(
              new CustomEvent("xiaolou:agent-canvas-project:synced", {
                detail: { projectId, asset: projectAsset },
              }),
            );
          })
          .catch((error) => {
            console.warn("[Layout] Failed to sync Jaaz canvas project:", error);
            window.dispatchEvent(
              new CustomEvent("xiaolou:agent-canvas-project:sync-failed", {
                detail: { projectId, error },
              }),
            );
          });
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [actorId]);

  useEffect(() => {
    const keepJaazAlive = () => {
      void ensureJaazServices().catch((error) => {
        if (import.meta.env.DEV) {
          console.warn("[jaaz] keepalive failed", error);
        }
      });
    };

    keepJaazAlive();
    const intervalId = window.setInterval(keepJaazAlive, 60_000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!profileMenuOpen) return;
    const handleClickOutside = (e: globalThis.MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(e.target as Node)) {
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [profileMenuOpen]);

  useEffect(() => {
    if (isCollapsed) setProfileMenuOpen(false);
  }, [isCollapsed]);

  useEffect(() => {
    let active = true;

    const loadContext = async () => {
      setLoadingAccount(true);
      try {
        const response = await getMe();
        if (active) {
          setPermissionContext(response);
        }
      } finally {
        if (active) {
          setLoadingAccount(false);
        }
      }
    };

    void loadContext();

    return () => {
      active = false;
    };
  }, [actorId]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const googleLoginCode = params.get("googleLoginCode");
    const googleLoginError = params.get("googleLoginError");
    if (!googleLoginCode && !googleLoginError) return;

    let active = true;
    const cleanGoogleParams = () => {
      const nextSearch = removeGoogleLoginParams(location.search);
      navigate(`${location.pathname}${nextSearch}${location.hash}`, { replace: true });
    };

    if (googleLoginError) {
      setAuthTab("login");
      setAuthError(params.get("message") || googleLoginError);
      setIsAuthModalOpen(true);
      cleanGoogleParams();
      return () => {
        active = false;
      };
    }

    setAuthPending(true);
    setAuthError(null);
    void exchangeGoogleLogin(googleLoginCode || "")
      .then((result) => {
        if (!active) return;
        setAuthToken(result.token);
        rememberKnownActor({
          id: result.actorId,
          label: result.displayName,
          detail: result.email,
          token: result.token,
        });
        setCurrentActorId(result.actorId);
        setPermissionContext(result.permissionContext);
        setKnownActorsVer((value) => value + 1);
        setIsAuthModalOpen(false);
        setIsMoreModalOpen(false);
        return listProjects()
          .then((response) => {
            const nextProjectId = response.items[0]?.id;
            if (nextProjectId) {
              setCurrentProjectId(nextProjectId, result.actorId);
            }
          })
          .catch(() => {});
      })
      .catch((error) => {
        if (!active) return;
        setAuthTab("login");
        setAuthError(error instanceof Error ? error.message : "Google 登录失败，请稍后重试。");
        setIsAuthModalOpen(true);
      })
      .finally(() => {
        if (!active) return;
        setAuthPending(false);
        cleanGoogleParams();
      });

    return () => {
      active = false;
    };
  }, [location.hash, location.pathname, location.search, navigate]);

  const currentOrganizationName =
    permissionContext?.organizations.find((item) => item.id === permissionContext.currentOrganizationId)?.name ??
    null;
  const isDark = theme === "dark";
  const themeToggleLabel = isDark ? "切换到浅色" : "切换到深色";
  const canAccessAgentCanvas =
    (isLoopback && actorId === SUPER_ADMIN_DEMO_ACTOR_ID) ||
    permissionContext?.platformRole === "super_admin";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const recentActors = useMemo(
    () => getKnownActors().filter((item) => !demoActors.some((actor) => actor.id === item.id)),
    [knownActorsVer, actorId],
  );
  const showCreateImageVideoNav =
    isLocalLoopbackAccess() &&
    (actorId === SUPER_ADMIN_DEMO_ACTOR_ID || permissionContext?.platformRole === "super_admin");

  const visibleNavItems = useMemo(() => {
    const adminNavItem: NavItem = { name: "订单审核", path: "/admin/orders", icon: CreditCard };
    const adminLoginNavItem: NavItem = { name: "管理员登录", path: "/admin/login", icon: ShieldCheck };
    const agentCanvasNavItem: NavItem = { name: "智能画布", path: "/create/agent-canvas", icon: Sparkles };
    const agentStudioCanvasNavItem: NavItem = { name: "智能体画布", path: "/create/agent-studio", icon: Sparkles };
    const baseItems = showCreateImageVideoNav
      ? navItems
      : navItems.filter(
          (item) =>
            !item.children?.some((child) => child.path === "/create/image" || child.path === "/create/video"),
        );
    const betaItems = canAccessAgentCanvas
      ? baseItems.flatMap((item) => (item.path === "/create/canvas" ? [item, agentCanvasNavItem, agentStudioCanvasNavItem] : [item]))
      : baseItems;

    if (permissionContext?.permissions.canManageOps || permissionContext?.permissions.canManageSystem) {
      return [...betaItems, adminNavItem];
    }

    return [...betaItems, adminLoginNavItem];
  }, [
    canAccessAgentCanvas,
    permissionContext?.permissions.canManageOps,
    permissionContext?.permissions.canManageSystem,
    showCreateImageVideoNav,
  ]);

  useEffect(() => {
    if (!isCollapsed) {
      setCollapsedNavFlyout(null);
    }
  }, [isCollapsed]);

  useEffect(() => {
    if (!collapsedNavFlyout) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      const panel = document.getElementById("sidebar-collapsed-nav-flyout");
      if (panel?.contains(target)) return;
      const triggers = document.querySelectorAll("[data-sidebar-flyout-trigger]");
      for (const el of triggers) {
        if (el.contains(target)) return;
      }
      setCollapsedNavFlyout(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [collapsedNavFlyout]);

  useEffect(() => {
    if (!collapsedNavFlyout) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCollapsedNavFlyout(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [collapsedNavFlyout]);

  useEffect(() => {
    if (!collapsedNavFlyout) return;
    const onResize = () => setCollapsedNavFlyout(null);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [collapsedNavFlyout]);

  const handleGuardedNavigate = async (path: string, event: MouseEvent<HTMLAnchorElement>) => {
    if (location.pathname === path || navigating) return;

    event.preventDefault();
    setNavigating(true);
    try {
      await runNavigationGuards();
      navigate(path);
    } catch {
      window.alert("当前内容保存失败，请稍后重试。");
    } finally {
      setNavigating(false);
    }
  };

  const handleSwitchActor = (nextActorId: string) => {
    const savedToken = getKnownActorToken(nextActorId);
    setAuthToken(savedToken);
    setCurrentActorId(nextActorId);
    void listProjects()
      .then((response) => {
        const nextProjectId = response.items[0]?.id;
        if (nextProjectId) {
          setCurrentProjectId(nextProjectId, nextActorId);
        }
      })
      .catch(() => {});
    setIsMoreModalOpen(false);
    setIsAuthModalOpen(false);
    navigate("/home");
  };

  const handleLogin = async () => {
    setAuthPending(true);
    setAuthError(null);
    try {
      const result = await loginWithEmail(loginForm);
      setAuthToken(result.token);
      rememberKnownActor({
        id: result.actorId,
        label: result.displayName,
        detail: result.email,
        token: result.token,
      });
      setCurrentActorId(result.actorId);
      try {
        const projectResponse = await listProjects();
        const nextProjectId = projectResponse.items[0]?.id;
        if (nextProjectId) {
          setCurrentProjectId(nextProjectId, result.actorId);
        }
      } catch {}
      setIsAuthModalOpen(false);
      setLoginForm({ email: "", password: "" });
      navigate("/home");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "登录失败，请稍后重试。");
    } finally {
      setAuthPending(false);
    }
  };

  const handleLogout = () => {
    logout();
    setPermissionContext(null);
    setIsMoreModalOpen(false);
    navigate("/home");
  };

  const handleRegister = async () => {
    setAuthPending(true);
    setAuthError(null);
    try {
      const result =
        authRegisterMode === "personal"
          ? await registerPersonalUser(personalForm)
          : await registerEnterpriseAdmin(enterpriseForm);
      if (result.token) {
        setAuthToken(result.token);
      }
      rememberKnownActor({
        id: result.actorId,
        label: result.permissionContext.actor.displayName,
        detail: authRegisterMode === "personal" ? "注册用户" : "企业管理员",
        token: result.token ?? null,
      });
      setCurrentActorId(result.actorId);
      try {
        const projectResponse = await listProjects();
        const nextProjectId = projectResponse.items[0]?.id;
        if (nextProjectId) {
          setCurrentProjectId(nextProjectId, result.actorId);
        }
      } catch {}
      setIsAuthModalOpen(false);
      navigate(authRegisterMode === "enterprise_admin" ? "/enterprise" : "/home");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "注册失败，请稍后重试。");
    } finally {
      setAuthPending(false);
    }
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <motion.aside
        initial={false}
        animate={{ width: isCollapsed ? sidebarWidthCollapsed : sidebarWidthExpanded }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative z-20 flex h-full shrink-0 flex-col border-r border-border bg-card/50 backdrop-blur-sm"
      >
        <div className="flex h-16 items-center overflow-hidden border-b border-border">
          {/* paddingLeft animates in sync with sidebar width — avoids the instant jump that justify-center causes */}
          <motion.div
            animate={{ paddingLeft: isCollapsed ? 20 : 12 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="flex flex-1 items-center gap-3 overflow-hidden"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-transparent">
              <img
                src="/chuangjing-logo.png"
                alt="创境AI Logo"
                className="h-8 w-8 object-contain"
              />
            </div>
            <AnimatePresence>
              {!isCollapsed ? (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  className="whitespace-nowrap text-lg font-semibold tracking-tight text-foreground"
                >
                  创境AI
                </motion.span>
              ) : null}
            </AnimatePresence>
          </motion.div>

          <button
            type="button"
            aria-label={isCollapsed ? "展开侧边栏" : "收起侧边栏"}
            onClick={() => setIsCollapsed((prev) => !prev)}
            className="absolute -right-3 top-5 z-30 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-secondary transition-colors hover:bg-accent"
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>

        <div
          className="flex-1 space-y-1 overflow-y-auto px-2 py-4 custom-scrollbar"
          onScroll={() => {
            if (collapsedNavFlyout) setCollapsedNavFlyout(null);
          }}
        >
          {visibleNavItems.map((item) => (
            <div key={item.name}>
              {item.children ? (
                <div>
                  <button
                    type="button"
                    data-sidebar-flyout-trigger
                    aria-expanded={
                      isCollapsed
                        ? collapsedNavFlyout?.parentName === item.name
                        : Boolean(expandedMenus[item.name])
                    }
                    onClick={(e) => {
                      if (isCollapsed) {
                        const el = e.currentTarget;
                        const r = el.getBoundingClientRect();
                        setCollapsedNavFlyout((prev) =>
                          prev?.parentName === item.name ? null : { parentName: item.name, top: r.top, left: r.right + 8 },
                        );
                      } else {
                        setExpandedMenus((prev) => ({ ...prev, [item.name]: !prev[item.name] }));
                      }
                    }}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                      isCollapsed ? "justify-center" : "justify-start text-left",
                      !isCollapsed && expandedMenus[item.name] ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                      <item.icon className="h-5 w-5" />
                    </span>
                    {!isCollapsed ? (
                      <span className="min-w-0 flex-1 text-left leading-snug">{item.name}</span>
                    ) : null}
                  </button>

                  <AnimatePresence>
                    {!isCollapsed && expandedMenus[item.name] ? (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="ml-3 mt-1 space-y-1 overflow-hidden border-l border-border pl-3"
                      >
                        {item.children.map((child) => (
                          <NavLink
                            key={child.path}
                            to={child.path}
                            end
                            onClick={(event) => {
                              void handleGuardedNavigate(child.path, event);
                            }}
                            className={({ isActive }) =>
                              cn(
                                "flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors",
                                isActive
                                  ? "bg-primary/10 font-medium text-primary"
                                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                              )
                            }
                          >
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                              <child.icon className="h-4 w-4" />
                            </span>
                            <span className="min-w-0 flex-1 text-left leading-snug">{child.name}</span>
                          </NavLink>
                        ))}
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              ) : (
                <NavLink
                  to={item.path || "/home"}
                  onClick={(event) => item.path && void handleGuardedNavigate(item.path, event)}
                  className={({ isActive }) =>
                    cn(
                      "flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-sm transition-colors",
                      isCollapsed ? "justify-center" : "justify-start text-left",
                      isActive
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )
                  }
                  title={isCollapsed ? item.name : undefined}
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                    <item.icon className="h-5 w-5" />
                  </span>
                  {!isCollapsed ? (
                    <span className="min-w-0 flex-1 text-left leading-snug">{item.name}</span>
                  ) : null}
                </NavLink>
              )}
            </div>
          ))}
        </div>

        <div className="border-t border-border p-3">
          {permissionContext && permissionContext.platformRole !== "guest" ? (
            <div ref={profileMenuRef} className="relative mb-3">
              <button
                type="button"
                onClick={() => setProfileMenuOpen((v) => !v)}
                className={cn(
                  "w-full rounded-xl border border-border/70 bg-background/40 transition-all hover:border-primary/30 hover:bg-background/60",
                  isCollapsed
                    ? "flex flex-col items-center gap-1.5 p-2"
                    : "flex items-center gap-3 px-2.5 py-2.5",
                  profileMenuOpen && "border-primary/40 bg-background/60",
                )}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border border-primary/20 bg-primary/10 text-primary">
                  {permissionContext.actor.avatar ? (
                    <img src={permissionContext.actor.avatar} alt="Avatar" className="h-full w-full object-cover" />
                  ) : (
                    <UserRound className="h-4 w-4" />
                  )}
                </div>
                {!isCollapsed && (
                  <div className="min-w-0 flex-1 text-left">
                    <p className="truncate text-sm font-medium text-foreground">
                      {permissionContext.actor.displayName}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <span className="text-[10px] text-muted-foreground">Active</span>
                    </div>
                  </div>
                )}
              </button>

              <AnimatePresence>
                {profileMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 6, scale: 0.97 }}
                    transition={{ duration: 0.15 }}
                    className={cn(
                      "absolute z-50 rounded-xl border border-border bg-card shadow-2xl",
                      isCollapsed
                        ? "bottom-full left-0 mb-2 w-56"
                        : "bottom-full left-0 mb-2 w-full min-w-[200px]",
                    )}
                  >
                    {/* Profile header */}
                    <button
                      type="button"
                      onClick={() => {
                        setProfileMenuOpen(false);
                        setIsProfileModalOpen(true);
                      }}
                      className="w-full border-b border-border p-3 text-left transition-colors hover:bg-accent/50"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-primary/20 bg-primary/10 text-primary">
                          {permissionContext.actor.avatar ? (
                            <img src={permissionContext.actor.avatar} alt="Avatar" className="h-full w-full object-cover" />
                          ) : (
                            <UserRound className="h-5 w-5" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-foreground">
                            {permissionContext.actor.displayName}
                          </p>
                          <div className="flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                            <span className="text-xs text-muted-foreground">
                              {formatPlatformRole(permissionContext)}
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>

                    {/* Menu items */}
                    <div className="p-1.5">
                      <ProfileMenuItem
                        icon={Settings}
                        label="设置"
                        onClick={() => {
                          setProfileMenuOpen(false);
                          setIsMoreModalOpen(true);
                        }}
                      />

                      <div className="my-1.5 border-t border-border/60" />

                      <ProfileMenuItem
                        icon={Building2}
                        label="管理面板"
                        onClick={() => {
                          setProfileMenuOpen(false);
                          navigate("/enterprise");
                        }}
                      />

                      <ProfileMenuItem
                        icon={CreditCard}
                        label="积分统计"
                        onClick={() => {
                          setProfileMenuOpen(false);
                          navigate("/wallet/usage");
                        }}
                      />

                      <div className="my-1.5 border-t border-border/60" />

                      <ProfileMenuItem
                        icon={Keyboard}
                        label="快捷键"
                        onClick={() => setProfileMenuOpen(false)}
                      />

                      <div className="my-1.5 border-t border-border/60" />

                      <ProfileMenuItem
                        icon={LogOut}
                        label="退出登录"
                        danger
                        onClick={() => {
                          setProfileMenuOpen(false);
                          handleLogout();
                        }}
                      />
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAuthError(null);
                setIsAuthModalOpen(true);
              }}
              className={cn(
                "group mb-3 w-full rounded-xl border text-left transition-all duration-200",
                "border-primary/40 bg-gradient-to-r from-primary/10 to-primary/5",
                "hover:border-primary/60 hover:from-primary/20 hover:to-primary/10 hover:shadow-sm hover:shadow-primary/10",
                "active:scale-[0.98]",
                isCollapsed ? "p-2" : "px-3 py-2.5",
              )}
              title={isCollapsed ? "登录 / 注册" : undefined}
            >
              {!isCollapsed ? (
                loadingAccount ? (
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15">
                      <LoaderCircle className="h-4 w-4 animate-spin text-primary/70" />
                    </div>
                    <p className="text-sm text-muted-foreground">同步中...</p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary transition-colors group-hover:bg-primary/25">
                      <LogIn className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-primary">登录 / 注册</p>
                      <p className="truncate text-[11px] leading-tight text-muted-foreground">解锁全部功能</p>
                    </div>
                  </div>
                )
              ) : (
                <div className="flex items-center justify-center">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary transition-colors group-hover:bg-primary/25">
                    <LogIn className="h-4 w-4" />
                  </div>
                </div>
              )}
            </button>
          )}

          <div className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"))}
              className={cn(
                "flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                isCollapsed ? "justify-center" : "justify-start",
              )}
              title={isCollapsed ? themeToggleLabel : undefined}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </span>
              {!isCollapsed ? (
                <span className="min-w-0 flex-1 text-left leading-snug">{themeToggleLabel}</span>
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => setIsMoreModalOpen(true)}
              className={cn(
                "flex min-h-11 w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                isCollapsed ? "justify-center" : "justify-start",
              )}
              title={isCollapsed ? "更多" : undefined}
            >
              <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                <MoreHorizontal className="h-5 w-5" />
              </span>
              {!isCollapsed ? <span className="min-w-0 flex-1 text-left leading-snug">更多</span> : null}
            </button>
          </div>
        </div>
      </motion.aside>

      <AnimatePresence>
        {isMoreModalOpen ? (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="mx-4 w-full max-w-4xl rounded-2xl border border-border bg-background p-6 shadow-2xl"
            >
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    {isLoopback ? "身份切换与账号入口" : "账号切换"}
                  </h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {isLoopback
                      ? "可以切换演示身份验证权限，也可以进入公开注册页体验个人用户和企业管理员注册流程。"
                      : "快速切换到已记录的登录账号，或登录新账号。"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="关闭弹窗"
                  onClick={() => setIsMoreModalOpen(false)}
                  className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_340px]">
                <div>
                  {/* 演示身份区块：仅在本地回环（localhost / 127.0.0.1）访问时显示 */}
                  {isLoopback && (
                    <>
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">演示身份</p>
                        <button
                          type="button"
                          onClick={() => {
                            setIsMoreModalOpen(false);
                            setAuthTab("register");
                            setAuthError(null);
                            setIsAuthModalOpen(true);
                          }}
                          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary/15"
                        >
                          <UserPlus className="h-4 w-4" />
                          注册账号
                        </button>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {visibleDemoActors.map((actor) => (
                          <button
                            key={actor.id}
                            type="button"
                            onClick={() => handleSwitchActor(actor.id)}
                            className={cn(
                              "rounded-2xl border px-4 py-4 text-left transition-colors",
                              actorId === actor.id
                                ? "border-primary/35 bg-primary/10"
                                : "border-border/70 bg-background/35 hover:bg-secondary/70",
                            )}
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                                <UserRound className="h-5 w-5" />
                              </div>
                              <div>
                                <div className="font-medium text-foreground">{actor.label}</div>
                                <div className="mt-1 text-xs leading-5 text-muted-foreground">{actor.detail}</div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </>
                  )}

                  {recentActors.length ? (
                    <div className={isLoopback ? "mt-6" : ""}>
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                          最近账号 · 快速切换
                        </p>
                        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">
                          {recentActors.length} 个账号
                        </span>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        {recentActors.map((actor) => {
                          const isActive = actorId === actor.id;
                          const hasToken = !!actor.token;
                          return (
                            <div
                              key={actor.id}
                              className={cn(
                                "group relative rounded-2xl border transition-all",
                                isActive
                                  ? "border-primary/35 bg-primary/10 shadow-sm shadow-primary/10"
                                  : hasToken
                                    ? "border-border/70 bg-background/35 hover:border-primary/25 hover:bg-secondary/70"
                                    : "border-border/50 bg-background/20 opacity-75",
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  if (isActive) return;
                                  if (hasToken) {
                                    handleSwitchActor(actor.id);
                                  } else {
                                    const emailGuess = actor.detail?.includes("@") ? actor.detail : "";
                                    setLoginForm({ email: emailGuess, password: "" });
                                    setAuthTab("login");
                                    setAuthError(null);
                                    setIsMoreModalOpen(false);
                                    setIsAuthModalOpen(true);
                                  }
                                }}
                                className={cn(
                                  "w-full px-4 py-4 text-left",
                                  isActive ? "cursor-default" : "cursor-pointer",
                                )}
                              >
                                <div className="flex items-center gap-3">
                                  <div
                                    className={cn(
                                      "relative flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl",
                                      isActive
                                        ? "bg-primary text-primary-foreground"
                                        : hasToken
                                          ? "bg-primary/12 text-primary"
                                          : "bg-muted/40 text-muted-foreground",
                                    )}
                                  >
                                    <UserRound className="h-5 w-5" />
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                      <span className="truncate font-medium text-foreground">{actor.label}</span>
                                      {isActive ? (
                                        <span className="shrink-0 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                                          当前
                                        </span>
                                      ) : null}
                                    </div>
                                    <div className="mt-1 flex items-center gap-2 text-xs leading-5 text-muted-foreground">
                                      <span className="truncate">{actor.detail || "注册账号"}</span>
                                      {hasToken ? (
                                        <span className="shrink-0 text-indigo-400/80">·&nbsp;可快速切换</span>
                                      ) : (
                                        <span className="shrink-0 text-amber-500/70">·&nbsp;需重新登录</span>
                                      )}
                                    </div>
                                  </div>
                                  {!isActive ? (
                                    hasToken ? (
                                      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                                    ) : (
                                      <LogIn className="h-4 w-4 shrink-0 text-amber-500/50" />
                                    )
                                  ) : null}
                                </div>
                              </button>
                              <button
                                type="button"
                                title="移除此账号记录"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeKnownActor(actor.id);
                                  setKnownActorsVer((v) => v + 1);
                                }}
                                className="absolute right-2 top-2 rounded-lg p-1.5 text-muted-foreground/40 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : !isLoopback ? (
                    /* 外网访问且没有已记录账号时的空状态提示 */
                    <div className="rounded-2xl border border-border/50 bg-background/20 px-5 py-6 text-center">
                      <p className="text-sm text-muted-foreground">暂无已记录的账号</p>
                      <button
                        type="button"
                        onClick={() => {
                          setIsMoreModalOpen(false);
                          setAuthTab("login");
                          setAuthError(null);
                          setIsAuthModalOpen(true);
                        }}
                        className="mt-3 inline-flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary/15"
                      >
                        <LogIn className="h-4 w-4" />
                        立即登录
                      </button>
                    </div>
                  ) : null}
                </div>

                <aside className="rounded-2xl border border-border/70 bg-background/35 p-5">
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">当前上下文</p>
                  <div className="mt-4 space-y-4">
                    <div className="rounded-2xl border border-border/70 bg-secondary/20 p-4">
                      <p className="text-sm font-medium text-foreground">
                        {loadingAccount ? "同步中..." : permissionContext?.actor.displayName || "游客"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {loadingAccount ? "--" : formatPlatformRole(permissionContext)}
                      </p>
                    </div>

                    <div className="space-y-2 text-sm text-muted-foreground">
                      <div className="flex items-center justify-between gap-3">
                        <span>所属组织</span>
                        <span className="font-medium text-foreground">
                          {permissionContext?.organizations.length ?? 0}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>可创建项目</span>
                        <span className="font-medium text-foreground">
                          {permissionContext?.permissions.canCreateProject ? "是" : "否"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>可充值</span>
                        <span className="font-medium text-foreground">
                          {permissionContext?.permissions.canRecharge ? "是" : "否"}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <span>企业管理</span>
                        <span className="font-medium text-foreground">
                          {permissionContext?.permissions.canManageOrganization ? "可用" : "不可用"}
                        </span>
                      </div>
                    </div>

                    {currentOrganizationName ? (
                      <div className="rounded-2xl border border-primary/20 bg-primary/8 p-4 text-sm text-primary">
                        当前组织：{currentOrganizationName}
                      </div>
                    ) : null}

                    {permissionContext?.permissions.canManageOps ? (
                      <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs text-primary">
                        <ShieldCheck className="h-4 w-4" />
                        平台后台能力已启用
                      </div>
                    ) : null}

                    {permissionContext?.permissions.canManageSystem ? (
                      <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs text-primary">
                        <ShieldCheck className="h-4 w-4" />
                        系统级权限已启用
                      </div>
                    ) : null}
                  </div>
                </aside>
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {isAuthModalOpen ? (
          <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm"
            onClick={() => setIsAuthModalOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.2 }}
              onClick={(e) => e.stopPropagation()}
              className="mx-4 w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
            >
              <div className="relative border-b border-border px-6 pt-6">
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
                      <Film className="h-5 w-5 text-primary-foreground" />
                    </div>
                    <div>
                      <p className="text-base font-semibold text-foreground">欢迎来到小楼</p>
                      <p className="text-xs text-muted-foreground">AI 漫剧创作平台</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="关闭"
                    onClick={() => setIsAuthModalOpen(false)}
                    className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
                <div className="flex">
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab("login");
                      setAuthError(null);
                    }}
                    className={cn(
                      "flex-1 border-b-2 pb-3 text-sm font-medium transition-colors",
                      authTab === "login"
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    登录
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab("register");
                      setAuthError(null);
                    }}
                    className={cn(
                      "flex-1 border-b-2 pb-3 text-sm font-medium transition-colors",
                      authTab === "register"
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    注册
                  </button>
                </div>
              </div>

              <div className="max-h-[70vh] overflow-y-auto p-6 custom-scrollbar">
                {authTab === "login" ? (
                  <div className="space-y-4">
                    <GoogleLoginButton returnTo={location.pathname} />
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="h-px flex-1 bg-border" />
                      <span>或使用邮箱登录</span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">邮箱</label>
                      <input
                        type="email"
                        value={loginForm.email}
                        onChange={(e) => setLoginForm((prev) => ({ ...prev, email: e.target.value }))}
                        placeholder="请输入邮箱地址"
                        className="h-10 w-full rounded-xl border border-border/70 bg-background/55 px-3.5 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">密码</label>
                      <div className="relative">
                        <input
                          type={showPassword ? "text" : "password"}
                          value={loginForm.password}
                          onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
                          placeholder="请输入密码"
                          className="h-10 w-full rounded-xl border border-border/70 bg-background/55 px-3.5 pr-10 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((p) => !p)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                        >
                          {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={authPending || !loginForm.email || !loginForm.password}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                      onClick={handleLogin}
                    >
                      {authPending ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <LogIn className="h-4 w-4" />
                      )}
                      {authPending ? "登录中…" : "登录"}
                    </button>

                    {authError && authTab === "login" ? (
                      <div className="rounded-xl border border-amber-600/40 bg-amber-500/15 px-4 py-3 text-xs leading-5 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                        {authError}
                      </div>
                    ) : null}

                    <p className="text-center text-xs text-muted-foreground">
                      还没有账号？
                      <button
                        type="button"
                        onClick={() => { setAuthTab("register"); setAuthError(null); }}
                        className="ml-1 text-primary transition hover:text-primary/80"
                      >
                        立即注册
                      </button>
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <GoogleLoginButton
                      returnTo={location.pathname}
                      label="使用 Google 注册/登录个人账号"
                    />
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="h-px flex-1 bg-border" />
                      <span>或填写资料注册</span>
                      <span className="h-px flex-1 bg-border" />
                    </div>
                    <div className="flex h-10 items-center rounded-xl border border-border/70 bg-background/40 p-1">
                      <button
                        type="button"
                        onClick={() => {
                          setAuthRegisterMode("personal");
                          setAuthError(null);
                        }}
                        className={cn(
                          "flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition",
                          authRegisterMode === "personal"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        个人用户
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAuthRegisterMode("enterprise_admin");
                          setAuthError(null);
                        }}
                        className={cn(
                          "flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition",
                          authRegisterMode === "enterprise_admin"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        企业管理员
                      </button>
                    </div>

                    <div className="rounded-xl border border-primary/20 bg-primary/8 px-4 py-3 text-xs leading-5 text-primary">
                      {authRegisterMode === "personal"
                        ? "注册后自动开通积分钱包与创作权限。"
                        : "注册后自动创建企业组织、企业积分钱包和管理员身份。"}
                    </div>

                    {authRegisterMode === "personal" ? (
                      <div className="space-y-3">
                        <AuthField
                          label="昵称"
                          value={personalForm.displayName}
                          onChange={(v) => setPersonalForm((p) => ({ ...p, displayName: v }))}
                          placeholder="请输入昵称"
                        />
                        <AuthField
                          label="邮箱"
                          value={personalForm.email}
                          onChange={(v) => setPersonalForm((p) => ({ ...p, email: v }))}
                          type="email"
                          placeholder="name@example.com"
                        />
                        <AuthField
                          label="手机号（选填）"
                          value={personalForm.phone || ""}
                          onChange={(v) => setPersonalForm((p) => ({ ...p, phone: v }))}
                          type="tel"
                          placeholder="用于接收通知"
                        />
                        <AuthField
                          label="密码"
                          value={personalForm.password}
                          onChange={(v) => setPersonalForm((p) => ({ ...p, password: v }))}
                          type="password"
                          placeholder="至少 8 位"
                        />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <AuthField
                          label="企业名称"
                          value={enterpriseForm.companyName}
                          onChange={(v) => setEnterpriseForm((p) => ({ ...p, companyName: v }))}
                          placeholder="请输入企业名称"
                        />
                        <div className="grid grid-cols-2 gap-3">
                          <AuthField
                            label="管理员姓名"
                            value={enterpriseForm.adminName}
                            onChange={(v) => setEnterpriseForm((p) => ({ ...p, adminName: v }))}
                            placeholder="负责人姓名"
                          />
                          <AuthField
                            label="手机号"
                            value={enterpriseForm.phone || ""}
                            onChange={(v) => setEnterpriseForm((p) => ({ ...p, phone: v }))}
                            type="tel"
                            placeholder="手机号"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <AuthField
                            label="邮箱"
                            value={enterpriseForm.email}
                            onChange={(v) => setEnterpriseForm((p) => ({ ...p, email: v }))}
                            type="email"
                            placeholder="admin@company.com"
                          />
                          <AuthField
                            label="密码"
                            value={enterpriseForm.password}
                            onChange={(v) => setEnterpriseForm((p) => ({ ...p, password: v }))}
                            type="password"
                            placeholder="设置密码"
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <AuthField
                            label="信用代码（选填）"
                            value={enterpriseForm.licenseNo || ""}
                            onChange={(v) => setEnterpriseForm((p) => ({ ...p, licenseNo: v }))}
                            placeholder="统一社会信用代码"
                          />
                          <AuthField
                            label="团队规模（选填）"
                            value={enterpriseForm.teamSize || ""}
                            onChange={(v) => setEnterpriseForm((p) => ({ ...p, teamSize: v }))}
                            placeholder="如 11-50"
                          />
                        </div>
                        <AuthField
                          label="行业（选填）"
                          value={enterpriseForm.industry || ""}
                          onChange={(v) => setEnterpriseForm((p) => ({ ...p, industry: v }))}
                          placeholder="如 影视、动漫、广告"
                        />
                      </div>
                    )}

                    {authError && authTab === "register" ? (
                      <div className="rounded-xl border border-rose-600/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
                        {authError}
                      </div>
                    ) : null}

                    <button
                      type="button"
                      onClick={() => void handleRegister()}
                      disabled={authPending}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {authPending ? (
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                      ) : (
                        <ArrowRight className="h-4 w-4" />
                      )}
                      {authRegisterMode === "personal" ? "注册个人用户" : "注册企业管理员"}
                    </button>

                    <p className="text-center text-xs text-muted-foreground">
                      已有账号？
                      <button
                        type="button"
                        onClick={() => {
                          setAuthTab("login");
                          setAuthError(null);
                        }}
                        className="ml-1 text-primary transition hover:underline"
                      >
                        立即登录
                      </button>
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>

      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        context={permissionContext}
        onUpdateContext={setPermissionContext}
      />

      <main className="relative flex h-full flex-1 flex-col overflow-hidden bg-background">
        {!isCanvasRoute && !isAgentCanvasRoute && !isAgentStudioCanvasRoute ? <Outlet /> : null}

        {hasMountedCanvas ? (
          <div
            className={cn(
              "absolute inset-0 bg-background",
              isCanvasRoute ? "block" : "pointer-events-none hidden",
            )}
            aria-hidden={!isCanvasRoute}
          >
            <Suspense fallback={<CanvasLoadingFallback />}>
              <CanvasCreate />
            </Suspense>
          </div>
        ) : null}

        {hasMountedAgentCanvas ? (
          <div
            className={cn(
              "absolute inset-0 bg-background",
              isAgentCanvasRoute ? "block" : "pointer-events-none hidden",
            )}
            aria-hidden={!isAgentCanvasRoute}
          >
            {canAccessAgentCanvas ? (
              <Suspense fallback={<CanvasLoadingFallback />}>
                <AgentCanvasCreate />
              </Suspense>
            ) : loadingAccount ? (
              <CanvasLoadingFallback />
            ) : (
              <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-background px-6 text-center">
                <div className="max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
                  <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
                  <h2 className="mt-4 text-lg font-semibold text-foreground">Super admin only</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    The intelligent canvas beta is visible only to super administrators.
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {hasMountedAgentStudioCanvas ? (
          <div
            className={cn(
              "absolute inset-0 bg-background",
              isAgentStudioCanvasRoute ? "block" : "pointer-events-none hidden",
            )}
            aria-hidden={!isAgentStudioCanvasRoute}
          >
            {canAccessAgentCanvas ? (
              <Suspense fallback={<CanvasLoadingFallback />}>
                <AgentStudioCanvasCreate />
              </Suspense>
            ) : loadingAccount ? (
              <CanvasLoadingFallback />
            ) : (
              <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-background px-6 text-center">
                <div className="max-w-md rounded-xl border border-border bg-card p-6 shadow-sm">
                  <ShieldCheck className="mx-auto h-10 w-10 text-muted-foreground" />
                  <h2 className="mt-4 text-lg font-semibold text-foreground">Super admin only</h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    The agent studio canvas is visible only to super administrators.
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : null}

      </main>

      {typeof document !== "undefined" &&
        isCollapsed &&
        collapsedNavFlyout &&
        createPortal(
          <div
            id="sidebar-collapsed-nav-flyout"
            role="menu"
            aria-label="子菜单"
            className="fixed z-[300] min-w-[220px] rounded-lg border border-border bg-card py-1 shadow-2xl"
            style={{ top: collapsedNavFlyout.top, left: collapsedNavFlyout.left }}
          >
            {visibleNavItems
              .find((i) => i.name === collapsedNavFlyout.parentName)
              ?.children?.map((child) => (
                <NavLink
                  key={child.path}
                  to={child.path}
                  end
                  onClick={(event) => {
                    setCollapsedNavFlyout(null);
                    void handleGuardedNavigate(child.path, event);
                  }}
                  className={({ isActive }) =>
                    cn(
                      "flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                      isActive
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )
                  }
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                    <child.icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1 text-left leading-snug">{child.name}</span>
                </NavLink>
              ))}
          </div>,
          document.body,
        )}
    </div>
  );
}

function ProfileMenuItem({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: typeof Settings;
  label: string;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
        danger
          ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span>{label}</span>
    </button>
  );
}
