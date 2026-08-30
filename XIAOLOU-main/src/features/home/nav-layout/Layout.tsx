import { Suspense, lazy, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  FolderOpen,
  LoaderCircle,
  LogIn,
  ShieldCheck,
  Sparkles,
  UserPlus,
} from "lucide-react";
import {
  getMe,
  listProjects,
  loginWithEmail,
  requestPasswordReset,
  completePasswordReset,
  startDemoSession,
  registerPersonalUser,
  registerEnterpriseAdmin,
  exchangeGoogleLogin,
  type PermissionContext,
  type RegisterPersonalInput,
  type RegisterEnterpriseAdminInput,
} from "../../../lib/api";
import {
  getKnownActors,
  getKnownActorControlApiClientAssertion,
  getKnownActorToken,
  hasSessionCredentials,
  isLocalDemoActorId,
  rememberKnownActor,
  removeKnownActor,
  setCurrentActorId,
  setControlApiClientAssertion,
  setAuthToken,
  logout,
  useActorId,
} from "../../../lib/actor-session";
import { isLocalLoopbackAccess, SUPER_ADMIN_DEMO_ACTOR_ID } from "../../../lib/local-loopback";
import { runNavigationGuards } from "./navigation-guards";
import { setCurrentProjectId } from "../../../lib/session";
import { useTheme } from "../../../lib/theme";
import { cn } from "../../../lib/utils";
import { removeGoogleLoginParams } from "../../../lib/google-auth";
import { AuthModal, type AuthRegisterMode, type AuthTab, type ResetStep } from "./AuthModal";
import { demoActors, navItems, type NavItem } from "./navItems";
import { SidebarShell, type CollapsedNavFlyout } from "./SidebarShell";
import { ProfileModal } from "./ProfileModal";
import { loadPlaygroundPage } from "./routePrefetch";

// Lazy-load the canvas shells so users who never open them pay no parse cost.
const Playground = lazy(loadPlaygroundPage);
const CanvasCreate = lazy(() => import("../../canvas-agent-canvas/canvas/CanvasCreate"));
const AgentCanvasCreate = lazy(() => import("../../canvas-agent-canvas/agent-canvas/AgentCanvasCreate"));

const CanvasLoadingFallback = () => (
  <div className="flex h-full w-full items-center justify-center bg-[#f8f6f1] px-6 text-[#171512] dark:bg-background dark:text-foreground">
    <div className="flex flex-col items-center">
      <img
        src={`${import.meta.env.BASE_URL}chuangjing-logo-shell.png`}
        alt="创境AI Logo"
        className="relative h-11 w-11 animate-[agentCanvasLogoLoad_1.35s_ease-in-out_infinite] object-contain drop-shadow-[0_6px_16px_rgba(212,143,71,0.28)]"
      />
      <div className="mt-4 text-xs font-semibold tracking-[0.26em] text-[#8f877a] dark:text-muted-foreground">
        CANVAS
      </div>
      <style>
        {`@keyframes agentCanvasLogoLoad {
          0%, 100% { transform: translateY(0) scale(0.96); opacity: 0.72; }
          50% { transform: translateY(-3px) scale(1.05); opacity: 1; }
        }`}
      </style>
    </div>
  </div>
);

export default function Layout() {
  const actorId = useActorId();
  const location = useLocation();
  const navigate = useNavigate();
  const isPlaygroundRoute = location.pathname === "/playground" || location.pathname.startsWith("/playground/");
  const isCanvasRoute = location.pathname === "/create/canvas";
  const isAgentCanvasRoute = location.pathname === "/create/agent-canvas";
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [collapsedNavFlyout, setCollapsedNavFlyout] = useState<CollapsedNavFlyout | null>(null);
  const [theme, setTheme] = useTheme();
  const [isMoreModalOpen, setIsMoreModalOpen] = useState(false);
  const [isSettingsIdentityOpen, setIsSettingsIdentityOpen] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const [navigating, setNavigating] = useState(false);
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [permissionContext, setPermissionContext] = useState<PermissionContext | null>(null);
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({
    剧集创作: false,
    通用创作: false,
  });
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authTab, setAuthTab] = useState<AuthTab>("login");
  const [authRegisterMode, setAuthRegisterMode] = useState<AuthRegisterMode>("personal");
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [knownActorsVer, setKnownActorsVer] = useState(0);
  const [hasMountedPlayground, setHasMountedPlayground] = useState(isPlaygroundRoute);
  const shouldMountPlayground = hasMountedPlayground || isPlaygroundRoute;
  const hasMountedCanvas = isCanvasRoute;
  const hasMountedAgentCanvas = isAgentCanvasRoute;
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [resetStep, setResetStep] = useState<ResetStep>("request");
  const [resetForm, setResetForm] = useState({
    email: "",
    resetToken: "",
    newPassword: "",
    confirmPassword: "",
  });

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
    setControlApiClientAssertion(null);
    setCurrentActorId("guest");
    navigate("/home");
  }, [actorId, navigate]);

  useEffect(() => {
    if (isPlaygroundRoute) {
      setHasMountedPlayground(true);
    }
  }, [isPlaygroundRoute]);

  useEffect(() => {
    let active = true;

    const loadContext = async () => {
      setLoadingAccount(true);
      try {
        if (isLocalDemoActorId(actorId) && !hasSessionCredentials()) {
          const result = await startDemoSession(actorId);
          if (active) {
            const demoActor = demoActors.find((actor) => actor.id === result.actorId);
            setAuthToken(result.token);
            setControlApiClientAssertion(result.controlApiClientAssertion);
            rememberKnownActor({
              id: result.actorId,
              label: demoActor?.label ?? result.displayName,
              detail: demoActor?.detail ?? result.email,
              token: result.token,
              controlApiClientAssertion: result.controlApiClientAssertion,
            });
            setCurrentActorId(result.actorId);
            setPermissionContext(result.permissionContext);
            setKnownActorsVer((value) => value + 1);
            void listProjects()
              .then((response) => {
                if (!active) return;
                const nextProjectId = response.items[0]?.id;
                if (nextProjectId) {
                  setCurrentProjectId(nextProjectId, result.actorId);
                }
              })
              .catch(() => {});
          }
          return;
        }

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
        setControlApiClientAssertion(result.controlApiClientAssertion);
        rememberKnownActor({
          id: result.actorId,
          label: result.displayName,
          detail: result.email,
          token: result.token,
          controlApiClientAssertion: result.controlApiClientAssertion,
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

  const isDark = theme === "dark";
  const themeToggleLabel = isDark ? "切换到浅色" : "切换到深色";
  const canAccessAgentCanvas =
    permissionContext?.permissions.canCreateProject === true ||
    (isLoopback && actorId === SUPER_ADMIN_DEMO_ACTOR_ID) ||
    permissionContext?.platformRole === "super_admin";
  const recentActors = useMemo(
    () => getKnownActors().filter((item) => !demoActors.some((actor) => actor.id === item.id)),
    [knownActorsVer, actorId],
  );
  const showCreateImageVideoNav =
    isLocalLoopbackAccess() &&
    (actorId === SUPER_ADMIN_DEMO_ACTOR_ID || permissionContext?.platformRole === "super_admin");
  const canOpenManagementPanel =
    permissionContext?.currentOrganizationRole === "enterprise_admin" ||
    permissionContext?.platformRole === "super_admin";

  const visibleNavItems = useMemo(() => {
    const agentCanvasNavItem: NavItem = { name: "智能画布", path: "/create/agent-canvas", icon: Sparkles };
    const baseItems = showCreateImageVideoNav
      ? navItems
      : navItems.filter(
          (item) =>
            !item.children?.some((child) => child.path === "/create/image" || child.path === "/create/video"),
        );
    const betaItems = canAccessAgentCanvas
      ? baseItems.flatMap((item) => (item.path === "/playground" ? [item, agentCanvasNavItem] : [item]))
      : baseItems;

    return betaItems;
  }, [canAccessAgentCanvas, showCreateImageVideoNav]);

  useEffect(() => {
    if (!isCollapsed) {
      setCollapsedNavFlyout(null);
    }
  }, [isCollapsed]);

  useEffect(() => {
    if (!collapsedNavFlyout) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const panel = document.getElementById("sidebar-collapsed-nav-flyout");
      if (panel?.contains(target)) return;
      const triggers = document.querySelectorAll("[data-sidebar-flyout-trigger]");
      for (const element of triggers) {
        if (element.contains(target)) return;
      }
      setCollapsedNavFlyout(null);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [collapsedNavFlyout]);

  useEffect(() => {
    if (!collapsedNavFlyout) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCollapsedNavFlyout(null);
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

  useEffect(() => {
    if (!isMoreModalOpen) {
      setIsSettingsIdentityOpen(false);
      return;
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (settingsMenuRef.current?.contains(target)) return;
      setIsMoreModalOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsMoreModalOpen(false);
      }
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isMoreModalOpen]);

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

  const selectFirstProjectForActor = async (nextActorId: string) => {
    try {
      const response = await listProjects();
      const nextProjectId = response.items[0]?.id;
      if (nextProjectId) {
        setCurrentProjectId(nextProjectId, nextActorId);
      }
    } catch {}
  };

  const handleSwitchActor = async (nextActorId: string) => {
    setAuthError(null);
    setAuthPending(true);
    try {
      if (nextActorId === "guest") {
        setAuthToken(null);
        setControlApiClientAssertion(null);
        setCurrentActorId("guest");
        setPermissionContext(null);
      } else if (isLocalDemoActorId(nextActorId)) {
        const result = await startDemoSession(nextActorId);
        const demoActor = demoActors.find((actor) => actor.id === result.actorId);
        setAuthToken(result.token);
        setControlApiClientAssertion(result.controlApiClientAssertion);
        rememberKnownActor({
          id: result.actorId,
          label: demoActor?.label ?? result.displayName,
          detail: demoActor?.detail ?? result.email,
          token: result.token,
          controlApiClientAssertion: result.controlApiClientAssertion,
        });
        setCurrentActorId(result.actorId);
        setPermissionContext(result.permissionContext);
        setKnownActorsVer((value) => value + 1);
        await selectFirstProjectForActor(result.actorId);
      } else {
        const savedToken = getKnownActorToken(nextActorId);
        const savedControlApiClientAssertion = getKnownActorControlApiClientAssertion(nextActorId);
        setAuthToken(savedToken);
        setControlApiClientAssertion(savedControlApiClientAssertion);
        setCurrentActorId(nextActorId);
        await selectFirstProjectForActor(nextActorId);
      }

      setIsMoreModalOpen(false);
      setIsAuthModalOpen(false);
      navigate("/home");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "身份切换失败，请稍后重试。");
      setAuthTab("login");
      setIsMoreModalOpen(false);
      setIsAuthModalOpen(true);
    } finally {
      setAuthPending(false);
    }
  };

  const handleLogin = async () => {
    setAuthPending(true);
    setAuthError(null);
    setAuthNotice(null);
    try {
      const result = await loginWithEmail(loginForm);
      setAuthToken(result.token);
      setControlApiClientAssertion(result.controlApiClientAssertion);
      rememberKnownActor({
        id: result.actorId,
        label: result.displayName,
        detail: result.email,
        token: result.token,
        controlApiClientAssertion: result.controlApiClientAssertion,
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

  const handleRequestPasswordReset = async () => {
    const email = (resetForm.email || loginForm.email).trim();
    if (!email) {
      setAuthError("请先填写需要重置密码的邮箱。");
      return;
    }

    setAuthPending(true);
    setAuthError(null);
    setAuthNotice(null);
    try {
      const result = await requestPasswordReset({ email });
      setResetForm((current) => ({
        ...current,
        email,
        resetToken: result.resetToken || current.resetToken,
      }));
      setResetStep("complete");
      setAuthNotice(
        result.resetToken
          ? "已生成本地重置 token，可以直接设置新密码。"
          : "密码重置请求已受理，请使用收到的重置 token 设置新密码。",
      );
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "密码重置请求失败，请稍后重试。");
    } finally {
      setAuthPending(false);
    }
  };

  const handleCompletePasswordReset = async () => {
    if (!resetForm.resetToken.trim() || !resetForm.newPassword.trim()) {
      setAuthError("请填写重置 token 和新密码。");
      return;
    }

    if (resetForm.newPassword !== resetForm.confirmPassword) {
      setAuthError("两次输入的新密码不一致。");
      return;
    }

    setAuthPending(true);
    setAuthError(null);
    setAuthNotice(null);
    try {
      await completePasswordReset({
        resetToken: resetForm.resetToken,
        newPassword: resetForm.newPassword,
      });
      setLoginForm({ email: resetForm.email, password: "" });
      setResetForm({ email: "", resetToken: "", newPassword: "", confirmPassword: "" });
      setResetStep("request");
      setAuthTab("login");
      setAuthNotice("密码已重置，请使用新密码登录。");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "密码重置失败，请稍后重试。");
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
    setAuthNotice(null);
    try {
      const result =
        authRegisterMode === "personal"
          ? await registerPersonalUser(personalForm)
          : await registerEnterpriseAdmin(enterpriseForm);
      if (result.token) {
        setAuthToken(result.token);
      }
      setControlApiClientAssertion(result.controlApiClientAssertion);
      rememberKnownActor({
        id: result.actorId,
        label: result.permissionContext.actor.displayName,
        detail: authRegisterMode === "personal" ? "注册用户" : "企业管理员",
        token: result.token ?? null,
        controlApiClientAssertion: result.controlApiClientAssertion ?? null,
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

  const openAuthModal = () => {
    setAuthError(null);
    setIsAuthModalOpen(true);
  };

  const openLoginModal = () => {
    setAuthTab("login");
    setAuthError(null);
    setIsAuthModalOpen(true);
  };

  const openRegisterModal = () => {
    setIsMoreModalOpen(false);
    setAuthTab("register");
    setAuthError(null);
    setIsAuthModalOpen(true);
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <SidebarShell
        actorId={actorId}
        isCollapsed={isCollapsed}
        setIsCollapsed={setIsCollapsed}
        collapsedNavFlyout={collapsedNavFlyout}
        setCollapsedNavFlyout={setCollapsedNavFlyout}
        visibleNavItems={visibleNavItems}
        expandedMenus={expandedMenus}
        setExpandedMenus={setExpandedMenus}
        handleGuardedNavigate={handleGuardedNavigate}
        permissionContext={permissionContext}
        loadingAccount={loadingAccount}
        isDark={isDark}
        themeToggleLabel={themeToggleLabel}
        onToggleTheme={() => setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"))}
        isMoreModalOpen={isMoreModalOpen}
        setIsMoreModalOpen={setIsMoreModalOpen}
        isSettingsIdentityOpen={isSettingsIdentityOpen}
        setIsSettingsIdentityOpen={setIsSettingsIdentityOpen}
        settingsMenuRef={settingsMenuRef}
        canOpenManagementPanel={canOpenManagementPanel}
        isLoopback={isLoopback}
        visibleDemoActors={visibleDemoActors}
        recentActors={recentActors}
        onOpenProfile={() => setIsProfileModalOpen(true)}
        onOpenAuth={openAuthModal}
        onOpenLogin={openLoginModal}
        onOpenRegister={openRegisterModal}
        onOpenManagementPanel={() =>
          navigate(permissionContext?.platformRole === "super_admin" ? "/admin" : "/enterprise")
        }
        onLogout={handleLogout}
        onSwitchActor={(nextActorId) => void handleSwitchActor(nextActorId)}
        onRecentActorLoginNeeded={(emailGuess) => {
          setLoginForm({ email: emailGuess, password: "" });
          setAuthTab("login");
          setAuthError(null);
          setIsMoreModalOpen(false);
          setIsAuthModalOpen(true);
        }}
        onRemoveKnownActor={(nextActorId) => {
          removeKnownActor(nextActorId);
          setKnownActorsVer((value) => value + 1);
        }}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        returnTo={location.pathname}
        authTab={authTab}
        setAuthTab={setAuthTab}
        authRegisterMode={authRegisterMode}
        setAuthRegisterMode={setAuthRegisterMode}
        authPending={authPending}
        authError={authError}
        setAuthError={setAuthError}
        authNotice={authNotice}
        setAuthNotice={setAuthNotice}
        showPassword={showPassword}
        setShowPassword={setShowPassword}
        loginForm={loginForm}
        setLoginForm={setLoginForm}
        resetStep={resetStep}
        setResetStep={setResetStep}
        resetForm={resetForm}
        setResetForm={setResetForm}
        personalForm={personalForm}
        setPersonalForm={setPersonalForm}
        enterpriseForm={enterpriseForm}
        setEnterpriseForm={setEnterpriseForm}
        onLogin={handleLogin}
        onRequestPasswordReset={handleRequestPasswordReset}
        onCompletePasswordReset={handleCompletePasswordReset}
        onRegister={handleRegister}
      />

      <ProfileModal
        isOpen={isProfileModalOpen}
        onClose={() => setIsProfileModalOpen(false)}
        context={permissionContext}
        onUpdateContext={setPermissionContext}
      />

      <main className="relative flex h-full flex-1 flex-col overflow-hidden bg-background">
        {!isPlaygroundRoute && !isCanvasRoute && !isAgentCanvasRoute ? <Outlet /> : null}

        {shouldMountPlayground ? (
          <div
            className={cn(
              "absolute inset-0 bg-background",
              isPlaygroundRoute ? "block" : "pointer-events-none hidden",
            )}
            aria-hidden={!isPlaygroundRoute}
          >
            <Suspense
              fallback={
                <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-background text-sm text-muted-foreground">
                  页面加载中...
                </div>
              }
            >
              <Playground />
            </Suspense>
          </div>
        ) : null}

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
                <AgentCanvasCreate key={actorId || "guest"} />
              </Suspense>
            ) : loadingAccount ? (
              <CanvasLoadingFallback />
            ) : (
              <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-[#f7f5ef] px-6 text-center text-[#171512] dark:bg-background dark:text-foreground">
                <div className="w-full max-w-[520px]">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#171512] text-[#f7f5ef] shadow-sm dark:bg-primary dark:text-primary-foreground">
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                  <div className="mt-5 text-xs font-semibold tracking-[0.24em] text-[#8f877a] dark:text-muted-foreground">
                    AGENT CANVAS
                  </div>
                  <h2 className="mt-2 text-2xl font-semibold tracking-normal">暂无智能画布权限</h2>
                  <p className="mx-auto mt-3 max-w-[420px] text-sm leading-6 text-[#6c655b] dark:text-muted-foreground">
                    当前账号没有创作项目权限。登录或注册后即可进入智能画布，已有项目也会继续从项目库打开。
                  </p>
                  <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setAuthTab("login");
                        setAuthError(null);
                        setAuthNotice(null);
                        setIsAuthModalOpen(true);
                      }}
                      className="inline-flex h-10 items-center gap-2 rounded-full bg-[#171512] px-4 text-sm font-medium text-[#f7f5ef] transition hover:bg-[#2b2924] dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90"
                    >
                      <LogIn className="h-4 w-4" />
                      登录账号
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAuthTab("register");
                        setAuthRegisterMode("personal");
                        setAuthError(null);
                        setAuthNotice(null);
                        setIsAuthModalOpen(true);
                      }}
                      className="inline-flex h-10 items-center gap-2 rounded-full border border-[rgba(23,21,18,0.12)] bg-white px-4 text-sm font-medium text-[#171512] transition hover:bg-[#eeece6] dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-accent"
                    >
                      <UserPlus className="h-4 w-4" />
                      注册创作账号
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate("/assets")}
                      className="inline-flex h-10 items-center gap-2 rounded-full border border-transparent px-3 text-sm font-medium text-[#6c655b] transition hover:bg-white hover:text-[#171512] dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground"
                    >
                      <FolderOpen className="h-4 w-4" />
                      查看项目库
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
}
