import { useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { CheckCircle2, ChevronLeft, ChevronRight, LoaderCircle } from "lucide-react";
import { getProjectOverview } from "../../lib/api";
import { runNavigationGuards } from "../../lib/navigation-guards";
import { useCurrentProjectId } from "../../lib/session";

const nodes = [
  { id: "global", name: "1 全局设定", path: "/comic/global" },
  { id: "script", name: "2 故事叙述", path: "/comic/script" },
  { id: "entities", name: "3 场景角色道具", path: "/comic/entities" },
  { id: "storyboard", name: "4 分镜脚本", path: "/comic/storyboard" },
  { id: "video", name: "5 分镜视频", path: "/comic/video" },
  { id: "dubbing", name: "6 配音对口型", path: "/comic/dubbing" },
  { id: "preview", name: "7 视频预览", path: "/comic/preview" },
];

export default function ComicShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const [currentProjectId] = useCurrentProjectId();
  const [projectTitle, setProjectTitle] = useState("加载中...");
  const [loading, setLoading] = useState(true);
  const [navigating, setNavigating] = useState(false);

  const currentIndex = nodes.findIndex((node) => location.pathname.includes(node.path));
  const currentNode = nodes[currentIndex];
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < nodes.length - 1;

  useEffect(() => {
    let active = true;

    const loadOverview = async () => {
      setLoading(true);

      try {
        const overview = await getProjectOverview(currentProjectId);
        if (!active) return;
        setProjectTitle(overview.project.title);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadOverview();

    return () => {
      active = false;
    };
  }, [currentProjectId]);

  const handleStepNavigate = async (path: string) => {
    if (navigating || location.pathname === path) return;

    setNavigating(true);
    try {
      await runNavigationGuards();
      navigate(path);
    } catch {
      window.alert("当前剧本保存失败，请稍后重试。");
    } finally {
      setNavigating(false);
    }
  };

  if (!currentNode) return <Outlet />;

  return (
    <div className="flex h-full w-full flex-col bg-background">
      <header className="z-10 flex h-16 shrink-0 items-center justify-between border-b border-border bg-card/50 px-6 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <h1 className="text-lg font-semibold">{currentNode.name}</h1>
          <div className="h-4 w-px bg-border" />
          <span className="text-sm text-muted-foreground">{projectTitle}</span>
          <div className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
            {loading ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CheckCircle2 className="h-3.5 w-3.5" />
            )}
            <span>{loading ? "同步中" : "自动保存"}</span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {hasPrev ? (
            <button
              onClick={() => void handleStepNavigate(nodes[currentIndex - 1].path)}
              disabled={navigating}
              className="flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-70"
            >
              {navigating ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
              上一步
            </button>
          ) : null}
          {hasNext ? (
            <button
              onClick={() => void handleStepNavigate(nodes[currentIndex + 1].path)}
              disabled={navigating}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-70"
            >
              <span>{navigating ? "保存中..." : "下一步"}</span>
              {navigating ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : null}
        </div>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
