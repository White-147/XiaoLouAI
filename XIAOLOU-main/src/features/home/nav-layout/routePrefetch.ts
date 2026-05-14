type RoutePrefetchEntry = {
  matches: (path: string) => boolean;
  loaders: Array<() => Promise<unknown>>;
};

const pathMatches = (path: string, route: string) =>
  path === route || path.startsWith(`${route}/`);

const routePrefetchEntries: RoutePrefetchEntry[] = [
  { matches: (path) => pathMatches(path, "/playground"), loaders: [() => import("../../playground/Playground")] },
  { matches: (path) => pathMatches(path, "/enterprise"), loaders: [() => import("../../account-admin-enterprise/enterprise-console/EnterpriseConsole")] },
  { matches: (path) => pathMatches(path, "/wallet/recharge"), loaders: [() => import("../../wallet-payments-api-center/wallet-recharge/WalletRecharge")] },
  { matches: (path) => pathMatches(path, "/wallet/usage"), loaders: [() => import("../../wallet-payments-api-center/credit-usage/CreditUsage")] },
  { matches: (path) => pathMatches(path, "/admin"), loaders: [() => import("../../account-admin-enterprise/super-admin-console/SuperAdminConsole")] },
  { matches: (path) => pathMatches(path, "/script-plaza"), loaders: [() => import("../../comic-production/script-plaza/ScriptPlaza")] },
  { matches: (path) => pathMatches(path, "/create/image"), loaders: [() => import("../../create-image/image-create/ImageCreate")] },
  { matches: (path) => pathMatches(path, "/create/video"), loaders: [() => import("../../create-video/video-create/VideoCreate")] },
  { matches: (path) => pathMatches(path, "/create/video-replace"), loaders: [() => import("../../toolbox/video-replace/VideoReplace")] },
  { matches: (path) => pathMatches(path, "/create/script-breakdown"), loaders: [() => import("../../toolbox/script-breakdown/ScriptBreakdown")] },
  { matches: (path) => pathMatches(path, "/create/video-reverse"), loaders: [() => import("../../toolbox/video-reverse/VideoReverse")] },
  { matches: (path) => pathMatches(path, "/create/storyboard-25"), loaders: [() => import("../../toolbox/storyboard-25/StoryboardGrid25")] },
  { matches: (path) => pathMatches(path, "/create/canvas"), loaders: [() => import("../../canvas-agent-canvas/canvas/CanvasCreate")] },
  { matches: (path) => pathMatches(path, "/create/agent-canvas"), loaders: [() => import("../../canvas-agent-canvas/agent-canvas/AgentCanvasCreate")] },
  {
    matches: (path) => pathMatches(path, "/comic/global"),
    loaders: [() => import("../../comic-production/comic/ComicShell"), () => import("../../comic-production/comic/GlobalSettings")],
  },
  {
    matches: (path) => pathMatches(path, "/comic/script"),
    loaders: [() => import("../../comic-production/comic/ComicShell"), () => import("../../comic-production/comic/StoryScript")],
  },
  {
    matches: (path) => pathMatches(path, "/comic/entities"),
    loaders: [() => import("../../comic-production/comic/ComicShell"), () => import("../../comic-production/comic/Entities")],
  },
  {
    matches: (path) => pathMatches(path, "/comic/storyboard"),
    loaders: [() => import("../../comic-production/comic/ComicShell"), () => import("../../comic-production/comic/Storyboard")],
  },
  {
    matches: (path) => pathMatches(path, "/comic/video"),
    loaders: [() => import("../../comic-production/comic/ComicShell"), () => import("../../comic-production/comic/Video")],
  },
  {
    matches: (path) => pathMatches(path, "/comic/dubbing"),
    loaders: [() => import("../../comic-production/comic/ComicShell"), () => import("../../comic-production/comic/Dubbing")],
  },
  {
    matches: (path) => pathMatches(path, "/comic/preview"),
    loaders: [() => import("../../comic-production/comic/ComicShell"), () => import("../../comic-production/comic/Preview")],
  },
  { matches: (path) => pathMatches(path, "/assets"), loaders: [() => import("../../assets-media-projects/assets/Assets")] },
];

const prefetchedRouteModules = new Set<string>();

export function prefetchRouteModule(path: string) {
  if (typeof window === "undefined") return;

  const pathname = path.split(/[?#]/, 1)[0] || "/";
  const entry = routePrefetchEntries.find((candidate) => candidate.matches(pathname));
  if (!entry || prefetchedRouteModules.has(pathname)) return;

  prefetchedRouteModules.add(pathname);
  void Promise.all(entry.loaders.map((load) => load())).catch(() => {
    prefetchedRouteModules.delete(pathname);
  });
}
