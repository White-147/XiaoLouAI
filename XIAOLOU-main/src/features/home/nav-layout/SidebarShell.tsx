import {
  ArrowRight,
  Building2,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  LogIn,
  LogOut,
  Moon,
  Settings,
  Sun,
  Trash2,
  UserPlus,
  UserRound,
  Users,
  type LucideIcon,
} from "lucide-react";
import { type Dispatch, type MouseEvent, type ReactNode, type RefObject, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { NavLink } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import type { PermissionContext } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { prefetchRouteModule } from "./routePrefetch";
import type { DemoActor, NavItem } from "./navItems";

export type CollapsedNavFlyout = {
  parentName: string;
  top: number;
  left: number;
};

type RecentActor = {
  id: string;
  label: string;
  detail?: string | null;
  token?: string | null;
};

type SidebarShellProps = {
  actorId: string;
  isCollapsed: boolean;
  setIsCollapsed: Dispatch<SetStateAction<boolean>>;
  collapsedNavFlyout: CollapsedNavFlyout | null;
  setCollapsedNavFlyout: Dispatch<SetStateAction<CollapsedNavFlyout | null>>;
  visibleNavItems: NavItem[];
  expandedMenus: Record<string, boolean>;
  setExpandedMenus: Dispatch<SetStateAction<Record<string, boolean>>>;
  handleGuardedNavigate: (path: string, event: MouseEvent<HTMLAnchorElement>) => void | Promise<void>;
  permissionContext: PermissionContext | null;
  loadingAccount: boolean;
  isDark: boolean;
  themeToggleLabel: string;
  onToggleTheme: () => void;
  isMoreModalOpen: boolean;
  setIsMoreModalOpen: Dispatch<SetStateAction<boolean>>;
  isSettingsIdentityOpen: boolean;
  setIsSettingsIdentityOpen: Dispatch<SetStateAction<boolean>>;
  settingsMenuRef: RefObject<HTMLDivElement | null>;
  canOpenManagementPanel: boolean;
  isLoopback: boolean;
  visibleDemoActors: DemoActor[];
  recentActors: RecentActor[];
  onOpenProfile: () => void;
  onOpenAuth: () => void;
  onOpenLogin: () => void;
  onOpenRegister: () => void;
  onOpenManagementPanel: () => void;
  onLogout: () => void;
  onSwitchActor: (actorId: string) => void;
  onRecentActorLoginNeeded: (emailGuess: string) => void;
  onRemoveKnownActor: (actorId: string) => void;
};

const sidebarWidthExpanded = 182;
const sidebarWidthCollapsed = 72;
const sidebarLabelTransition = { duration: 0.16, ease: "easeOut" as const };

function SidebarItemLabel({
  show,
  children,
  className,
}: {
  show: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.span
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -4 }}
          transition={sidebarLabelTransition}
          className={cn(
            "block w-[110px] max-w-[110px] shrink-0 overflow-hidden truncate whitespace-nowrap text-left leading-snug will-change-[opacity,transform]",
            className,
          )}
        >
          {children}
        </motion.span>
      ) : null}
    </AnimatePresence>
  );
}

type SidebarIconPreset =
  | "home"
  | "flask"
  | "memory"
  | "canvas"
  | "image"
  | "video"
  | "film"
  | "folder"
  | "shield"
  | "settings"
  | "book"
  | "users"
  | "mic"
  | "theme"
  | "more"
  | "login"
  | "default";

function getSidebarIconPreset(label: string, path?: string): SidebarIconPreset {
  if (label === "首页" || path === "/home") return "home";
  if (path === "/playground") return "memory";
  if (label.includes("入口")) return "flask";
  if (label.includes("记忆")) return "memory";
  if (label.includes("天幕") || label.includes("画布") || label.includes("分镜脚本")) return "canvas";
  if (label.includes("图片") || label.includes("通用")) return "image";
  if (label.includes("视频") || label.includes("预览")) return "video";
  if (label.includes("剧集")) return "film";
  if (label.includes("项目")) return "folder";
  if (label.includes("管理员") || label.includes("订单")) return "shield";
  if (label.includes("设置") || label.includes("设定")) return "settings";
  if (label.includes("故事")) return "book";
  if (label.includes("角色")) return "users";
  if (label.includes("配音")) return "mic";
  if (label.includes("切换")) return "theme";
  if (label.includes("更多")) return "more";
  if (label.includes("登录") || label.includes("注册")) return "login";
  return "default";
}

function HomeDoorIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="sidebar-home-icon"
      aria-hidden="true"
    >
      <path d="M3.5 10.3 12 3.7l8.5 6.6" />
      <path d="M5.5 10v9.2h13V10" />
      <path d="M9.2 19.2v-6.7c0-.5.4-.9.9-.9h3.8c.5 0 .9.4.9.9v6.7" />
      <path className="sidebar-home-icon__light" d="M10.1 12.7h4" />
      <g className="sidebar-home-icon__door">
        <path d="M10.4 19v-6.3h3.3V19" />
        <path d="M12.9 15.8h.1" />
      </g>
    </svg>
  );
}

function AnimatedSidebarIcon({
  icon: Icon,
  label,
  path,
  size = "md",
}: {
  icon: LucideIcon;
  label: string;
  path?: string;
  size?: "sm" | "md";
}) {
  const preset = getSidebarIconPreset(label, path);

  return (
    <span
      className={cn("sidebar-animated-icon", size === "sm" ? "h-4 w-4" : "h-5 w-5")}
      data-preset={preset}
      aria-hidden="true"
    >
      {preset === "home" ? (
        <HomeDoorIcon />
      ) : (
        <>
          <Icon className="sidebar-animated-icon__base" strokeWidth={2} />
          <span className="sidebar-animated-icon__motion sidebar-animated-icon__motion-a" />
          <span className="sidebar-animated-icon__motion sidebar-animated-icon__motion-b" />
          <span className="sidebar-animated-icon__motion sidebar-animated-icon__motion-c" />
        </>
      )}
    </span>
  );
}

function ProfileMenuItem({
  icon: Icon,
  label,
  danger,
  onClick,
}: {
  icon: LucideIcon;
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

export function SidebarShell({
  actorId,
  isCollapsed,
  setIsCollapsed,
  collapsedNavFlyout,
  setCollapsedNavFlyout,
  visibleNavItems,
  expandedMenus,
  setExpandedMenus,
  handleGuardedNavigate,
  permissionContext,
  loadingAccount,
  isDark,
  themeToggleLabel,
  onToggleTheme,
  isMoreModalOpen,
  setIsMoreModalOpen,
  isSettingsIdentityOpen,
  setIsSettingsIdentityOpen,
  settingsMenuRef,
  canOpenManagementPanel,
  isLoopback,
  visibleDemoActors,
  recentActors,
  onOpenProfile,
  onOpenAuth,
  onOpenLogin,
  onOpenRegister,
  onOpenManagementPanel,
  onLogout,
  onSwitchActor,
  onRecentActorLoginNeeded,
  onRemoveKnownActor,
}: SidebarShellProps) {
  return (
    <>
      <motion.aside
        initial={false}
        animate={{ width: isCollapsed ? sidebarWidthCollapsed : sidebarWidthExpanded }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative z-20 flex h-full shrink-0 flex-col border-r border-border bg-card/50 backdrop-blur-sm"
      >
        <div className="flex h-16 items-center overflow-hidden border-b border-border">
          {/* paddingLeft animates in sync with sidebar width, avoiding center-jump during collapse. */}
          <motion.div
            animate={{ paddingLeft: isCollapsed ? 20 : 12 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="flex flex-1 items-center gap-3 overflow-hidden"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-transparent">
              <img
                src="/chuangjing-logo-shell.png"
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
                    onClick={(event) => {
                      if (isCollapsed) {
                        const rect = event.currentTarget.getBoundingClientRect();
                        setCollapsedNavFlyout((prev) =>
                          prev?.parentName === item.name
                            ? null
                            : { parentName: item.name, top: rect.top, left: rect.right + 8 },
                        );
                      } else {
                        setExpandedMenus((prev) => ({ ...prev, [item.name]: !prev[item.name] }));
                      }
                    }}
                    className={cn(
                      "sidebar-nav-item flex min-h-11 w-full items-center gap-2 overflow-hidden rounded-md px-2 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                      isCollapsed ? "justify-center" : "justify-start text-left",
                      !isCollapsed && expandedMenus[item.name] ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <AnimatedSidebarIcon icon={item.icon} label={item.name} path={item.path} />
                    <SidebarItemLabel show={!isCollapsed} className="flex-1">
                      {item.name}
                    </SidebarItemLabel>
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
                            onMouseEnter={() => prefetchRouteModule(child.path)}
                            onFocus={() => prefetchRouteModule(child.path)}
                            onClick={(event) => {
                              void handleGuardedNavigate(child.path, event);
                            }}
                            className={({ isActive }) =>
                              cn(
                                "sidebar-nav-item flex min-h-11 w-full items-center gap-2 overflow-hidden rounded-md px-2 py-2 text-left text-sm transition-colors",
                                isActive
                                  ? "bg-primary/10 font-medium text-primary"
                                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                              )
                            }
                          >
                            <AnimatedSidebarIcon icon={child.icon} label={child.name} path={child.path} size="sm" />
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
                  onMouseEnter={() => item.path && prefetchRouteModule(item.path)}
                  onFocus={() => item.path && prefetchRouteModule(item.path)}
                  onClick={(event) => item.path && void handleGuardedNavigate(item.path, event)}
                  className={({ isActive }) =>
                    cn(
                      "sidebar-nav-item flex min-h-11 w-full items-center gap-2 overflow-hidden rounded-md px-2 py-2 text-sm transition-colors",
                      isCollapsed ? "justify-center" : "justify-start text-left",
                      isActive
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )
                  }
                  title={isCollapsed ? item.name : undefined}
                >
                  <AnimatedSidebarIcon icon={item.icon} label={item.name} path={item.path} />
                  <SidebarItemLabel show={!isCollapsed} className="flex-1">
                    {item.name}
                  </SidebarItemLabel>
                </NavLink>
              )}
            </div>
          ))}
        </div>

        <div className="border-t border-border p-3">
          {permissionContext && permissionContext.platformRole !== "guest" ? (
            <div className="mb-3">
              <button
                type="button"
                title="账号与个人资料"
                onClick={onOpenProfile}
                className={cn(
                  "w-full rounded-xl border border-border/70 bg-background/40 transition-all hover:border-primary/30 hover:bg-background/60",
                  isCollapsed
                    ? "flex flex-col items-center gap-1.5 p-2"
                    : "flex items-center gap-3 px-2.5 py-2.5",
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
            </div>
          ) : (
            <button
              type="button"
              onClick={onOpenAuth}
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
              onClick={onToggleTheme}
              className={cn(
                "sidebar-nav-item flex min-h-11 w-full items-center gap-2 overflow-hidden rounded-md px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                isCollapsed ? "justify-center" : "justify-start",
              )}
              title={isCollapsed ? themeToggleLabel : undefined}
            >
              <AnimatedSidebarIcon icon={isDark ? Sun : Moon} label={themeToggleLabel} />
              <SidebarItemLabel show={!isCollapsed} className="flex-1">
                {themeToggleLabel}
              </SidebarItemLabel>
            </button>
            <div ref={settingsMenuRef} className="relative">
              <button
                type="button"
                aria-haspopup="menu"
                aria-expanded={isMoreModalOpen}
                onClick={() => setIsMoreModalOpen((open) => !open)}
                className={cn(
                  "sidebar-nav-item flex min-h-11 w-full items-center gap-2 overflow-hidden rounded-md px-2 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                  isMoreModalOpen ? "bg-accent text-accent-foreground" : "",
                  isCollapsed ? "justify-center" : "justify-start",
                )}
                title={isCollapsed ? "设置" : undefined}
              >
                <AnimatedSidebarIcon icon={Settings} label="设置" />
                <SidebarItemLabel show={!isCollapsed} className="flex-1">
                  设置
                </SidebarItemLabel>
              </button>

              <AnimatePresence>
                {isMoreModalOpen ? (
                  <motion.div
                    role="menu"
                    initial={{ opacity: 0, y: 8, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ duration: 0.16 }}
                    className={cn(
                      "absolute bottom-full left-0 z-[120] mb-2 max-w-[calc(100vw-24px)] rounded-xl border border-border bg-card p-2 shadow-2xl transition-[width] duration-200 ease-out",
                      isSettingsIdentityOpen ? "w-80" : "w-48",
                    )}
                  >
                    <div className="space-y-1">
                      <ProfileMenuItem
                        icon={UserRound}
                        label="账号与个人资料"
                        onClick={() => {
                          setIsMoreModalOpen(false);
                          if (permissionContext && permissionContext.platformRole !== "guest") {
                            onOpenProfile();
                          } else {
                            onOpenLogin();
                          }
                        }}
                      />

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => setIsSettingsIdentityOpen((open) => !open)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      >
                        <Users className="h-4 w-4 shrink-0" />
                        <span className="flex min-w-0 items-center gap-0.5">
                          <span className="truncate">身份切换</span>
                          <ChevronRight
                            className={cn(
                              "h-4 w-4 shrink-0 transition-transform",
                              isSettingsIdentityOpen ? "rotate-90" : "",
                            )}
                          />
                        </span>
                      </button>

                      <AnimatePresence initial={false}>
                        {isSettingsIdentityOpen ? (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="my-1 max-h-72 overflow-y-auto rounded-lg border border-border/70 bg-background/40 p-2 custom-scrollbar">
                              <div className="mb-2 flex items-center justify-between gap-2 px-1">
                                <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                  可用身份
                                </span>
                                <button
                                  type="button"
                                  onClick={onOpenRegister}
                                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                                >
                                  <UserPlus className="h-3.5 w-3.5" />
                                  注册账号
                                </button>
                              </div>

                              {isLoopback ? (
                                <div className="space-y-1">
                                  {visibleDemoActors.map((actor) => (
                                    <button
                                      key={actor.id}
                                      type="button"
                                      onClick={() => onSwitchActor(actor.id)}
                                      className={cn(
                                        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                                        actorId === actor.id
                                          ? "bg-primary/10 text-primary"
                                          : "text-muted-foreground hover:bg-accent hover:text-foreground",
                                      )}
                                    >
                                      <UserRound className="h-4 w-4 shrink-0" />
                                      <span className="min-w-0 flex-1">
                                        <span className="block truncate font-medium">{actor.label}</span>
                                        <span className="block truncate text-xs opacity-75">{actor.detail}</span>
                                      </span>
                                      {actorId === actor.id ? (
                                        <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium">
                                          当前
                                        </span>
                                      ) : null}
                                    </button>
                                  ))}
                                </div>
                              ) : null}

                              {recentActors.length ? (
                                <div className={cn("space-y-1", isLoopback ? "mt-2 border-t border-border/60 pt-2" : "")}>
                                  {recentActors.map((actor) => {
                                    const isActive = actorId === actor.id;
                                    const hasToken = !!actor.token;
                                    return (
                                      <div key={actor.id} className="group relative">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (isActive) return;
                                            if (hasToken) {
                                              onSwitchActor(actor.id);
                                            } else {
                                              const emailGuess = actor.detail?.includes("@") ? actor.detail : "";
                                              onRecentActorLoginNeeded(emailGuess);
                                            }
                                          }}
                                          className={cn(
                                            "flex w-full items-center gap-2 rounded-md py-2 pl-2.5 pr-8 text-left text-sm transition-colors",
                                            isActive
                                              ? "bg-primary/10 text-primary"
                                              : hasToken
                                                ? "text-muted-foreground hover:bg-accent hover:text-foreground"
                                                : "text-muted-foreground/75 hover:bg-accent",
                                          )}
                                        >
                                          <UserRound className="h-4 w-4 shrink-0" />
                                          <span className="min-w-0 flex-1">
                                            <span className="block truncate font-medium">{actor.label}</span>
                                            <span className="block truncate text-xs opacity-75">
                                              {actor.detail || (hasToken ? "可快速切换" : "需重新登录")}
                                            </span>
                                          </span>
                                          {!isActive ? (
                                            hasToken ? (
                                              <ArrowRight className="h-4 w-4 shrink-0 opacity-45" />
                                            ) : (
                                              <LogIn className="h-4 w-4 shrink-0 text-amber-500/70" />
                                            )
                                          ) : null}
                                        </button>
                                        <button
                                          type="button"
                                          title="移除此账号记录"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            onRemoveKnownActor(actor.id);
                                          }}
                                          className="absolute right-1.5 top-1.5 rounded-md p-1.5 text-muted-foreground/40 opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : !isLoopback ? (
                                <div className="rounded-md border border-dashed border-border/70 px-3 py-4 text-center text-sm text-muted-foreground">
                                  暂无已记录的账号
                                </div>
                              ) : null}
                            </div>
                          </motion.div>
                        ) : null}
                      </AnimatePresence>

                      {canOpenManagementPanel ? (
                        <ProfileMenuItem
                          icon={Building2}
                          label="管理面板"
                          onClick={() => {
                            setIsMoreModalOpen(false);
                            onOpenManagementPanel();
                          }}
                        />
                      ) : null}
                      <ProfileMenuItem icon={LogOut} label="退出登录" danger onClick={onLogout} />
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </motion.aside>

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
              .find((item) => item.name === collapsedNavFlyout.parentName)
              ?.children?.map((child) => (
                <NavLink
                  key={child.path}
                  to={child.path}
                  end
                  onMouseEnter={() => prefetchRouteModule(child.path)}
                  onFocus={() => prefetchRouteModule(child.path)}
                  onClick={(event) => {
                    setCollapsedNavFlyout(null);
                    void handleGuardedNavigate(child.path, event);
                  }}
                  className={({ isActive }) =>
                    cn(
                      "sidebar-nav-item flex min-h-11 w-full items-center gap-2 overflow-hidden px-3 py-2 text-left text-sm transition-colors",
                      isActive
                        ? "bg-primary/10 font-medium text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    )
                  }
                >
                  <AnimatedSidebarIcon icon={child.icon} label={child.name} path={child.path} size="sm" />
                  <span className="min-w-0 flex-1 text-left leading-snug">{child.name}</span>
                </NavLink>
              ))}
          </div>,
          document.body,
        )}
    </>
  );
}
