import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "../../lib/utils";
import {
  getProjectOverview,
  updateProject,
  updateSettings,
} from "../../lib/api";
import { useCurrentProjectId } from "../../lib/session";

const STYLE_TEMPLATES = [
  "电影颗粒雨夜",
  "复古民国",
  "都市情感",
  "霓虹悬疑",
  "柔光写实",
  "旧上海电影感",
];

const STRATEGIES = ["lite", "standard", "plus"] as const;

export default function GlobalSettings() {
  const [currentProjectId] = useCurrentProjectId();
  const [loading, setLoading] = useState(true);
  const [projectName, setProjectName] = useState("");
  const [aspectRatio, setAspectRatio] = useState("9:16");
  const [styleTemplate, setStyleTemplate] = useState("");
  const [maxShots, setMaxShots] = useState("20");
  const [strategy, setStrategy] = useState("standard");
  const hydratedRef = useRef(false);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      try {
        const overview = await getProjectOverview(currentProjectId);
        if (!active) return;

        setProjectName(overview.project.title);
        setAspectRatio(overview.settings.aspectRatio || "9:16");
        setStyleTemplate(overview.settings.visualStyle || STYLE_TEMPLATES[0]);
        setMaxShots(String(Math.max(overview.storyboards.length || 0, 20)));
        setStrategy(
          overview.settings.modelProfile === "lite" ||
            overview.settings.modelProfile === "plus"
            ? overview.settings.modelProfile
            : "standard",
        );
        hydratedRef.current = true;
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [currentProjectId]);

  useEffect(() => {
    if (!hydratedRef.current) return;

    const timeout = window.setTimeout(() => {
      void Promise.all([
        updateProject(currentProjectId, { title: projectName }),
        updateSettings(currentProjectId, {
          aspectRatio,
          visualStyle: styleTemplate,
          modelProfile: strategy,
          targetDurationSeconds: Number(maxShots) * 5,
        }),
      ]);
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [aspectRatio, currentProjectId, maxShots, projectName, strategy, styleTemplate]);

  return (
    <div className="h-full overflow-y-auto p-8 custom-scrollbar">
      <div className="mx-auto max-w-4xl space-y-8">
        <div className="flex items-center gap-3">
          <h2 className="text-2xl font-semibold tracking-tight">全局设定</h2>
          {loading ? <LoaderCircle className="h-5 w-5 animate-spin text-primary" /> : null}
        </div>
        <p className="text-muted-foreground">全局设定已经接入后端设置接口。页面内修改会自动保存到当前项目。</p>

        <div className="glass-panel space-y-8 rounded-2xl p-8">
          <div className="space-y-3">
            <label className="text-sm font-medium">项目名称</label>
            <input
              type="text"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              className="w-full rounded-lg border border-border bg-input px-4 py-2.5 transition-shadow focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">风格模板</label>
            <div className="flex max-h-[240px] flex-wrap gap-2 overflow-y-auto rounded-xl border border-border bg-secondary/20 p-4 custom-scrollbar">
              {STYLE_TEMPLATES.map((style) => (
                <button
                  key={style}
                  onClick={() => setStyleTemplate(style)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    styleTemplate === style
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground",
                  )}
                >
                  {style}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">画面比例</label>
            <div className="grid grid-cols-3 gap-4">
              {["16:9", "9:16", "1:1"].map((ratio) => (
                <button
                  key={ratio}
                  onClick={() => setAspectRatio(ratio)}
                  className={cn(
                    "rounded-lg border py-3 text-sm font-medium transition-colors",
                    aspectRatio === ratio
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border hover:border-primary/50",
                  )}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">剧本最大分镜数</label>
            <input
              type="number"
              value={maxShots}
              onChange={(event) => setMaxShots(event.target.value)}
              className="w-full rounded-lg border border-border bg-input px-4 py-2.5 transition-shadow focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>

          <div className="space-y-3">
            <label className="text-sm font-medium">生成策略</label>
            <div className="grid grid-cols-3 gap-4">
              {STRATEGIES.map((item) => (
                <button
                  key={item}
                  onClick={() => setStrategy(item)}
                  className={cn(
                    "rounded-lg border py-3 text-sm font-medium uppercase transition-colors",
                    strategy === item
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/50",
                  )}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
