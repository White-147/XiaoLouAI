import { type ReactNode } from "react";
import { LayoutGrid, LoaderCircle, Play, Sparkles, Trash2 } from "lucide-react";
import { GeneratedMediaPlaceholder, getGeneratedMediaUrl } from "../media/GenerationPlaceholder";
import type { AgentCanvasProjectSummary, CanvasProjectSummary } from "./api/assets";
import type { DateGroup } from "./assetCache";

type CanvasProjectListMode = "agent" | "canvas";
type CanvasProjectCardItem = AgentCanvasProjectSummary | CanvasProjectSummary;

type CanvasProjectSectionProps = {
  mode: CanvasProjectListMode;
  projects: CanvasProjectCardItem[];
  dateGroups: DateGroup<CanvasProjectCardItem>[];
  loading: boolean;
  refreshing: boolean;
  deletingId: string | null;
  renderDateLine: (dateKey: string) => ReactNode;
  onRefresh: () => void | Promise<void>;
  onOpenProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void | Promise<void>;
  onCreateAgentCanvas?: () => void;
};

export function CanvasProjectSection({
  mode,
  projects,
  dateGroups,
  loading,
  refreshing,
  deletingId,
  renderDateLine,
  onRefresh,
  onOpenProject,
  onDeleteProject,
  onCreateAgentCanvas,
}: CanvasProjectSectionProps) {
  const isAgentMode = mode === "agent";

  return (
    <>
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-border bg-card/30 px-6">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          {isAgentMode ? (
            <Sparkles className="h-4 w-4 text-primary" />
          ) : (
            <LayoutGrid className="h-4 w-4 text-primary" />
          )}
          {isAgentMode ? "智能画布项目" : "画布项目"}
          <span className="text-xs text-muted-foreground">
            {isAgentMode
              ? `（保存智能画布节点、对话上下文和视口，已保存 ${projects.length} 项）`
              : "（同账号多设备自动同步）"}
          </span>
        </h3>
        <div className="flex items-center gap-3">
          {refreshing ? <LoaderCircle className="h-4 w-4 animate-spin text-primary" /> : null}
          <button
            onClick={() => void onRefresh()}
            className="rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            刷新
          </button>
          {isAgentMode ? (
            <button
              onClick={onCreateAgentCanvas}
              className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Sparkles className="h-4 w-4" />
              新建智能画布
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3 text-muted-foreground">
            <LoaderCircle className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm">{isAgentMode ? "加载智能画布项目中..." : "加载画布项目中..."}</p>
          </div>
        ) : projects.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-muted-foreground">
            {isAgentMode ? (
              <Sparkles className="mb-4 h-12 w-12 opacity-20" />
            ) : (
              <LayoutGrid className="mb-4 h-12 w-12 opacity-20" />
            )}
            <p>{isAgentMode ? "暂无智能画布项目" : "暂无画布项目"}</p>
            <p className="mt-1 text-xs">
              {isAgentMode
                ? "在智能画布中对话或生成后，会自动保存完整界面上下文"
                : "在天幕中点击 SAVE 后，项目会自动保存到这里"}
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {dateGroups.map((group) => (
              <section key={group.dateKey} className="space-y-3">
                {renderDateLine(group.dateKey)}
                <div className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-5">
                  {group.items.map((project) => (
                    <CanvasProjectCard
                      key={project.id}
                      project={project}
                      mode={mode}
                      pendingDelete={deletingId === project.id}
                      onOpenProject={onOpenProject}
                      onDeleteProject={onDeleteProject}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

type CanvasProjectCardProps = {
  mode: CanvasProjectListMode;
  project: CanvasProjectCardItem;
  pendingDelete: boolean;
  onOpenProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void | Promise<void>;
};

function CanvasProjectCard({
  mode,
  project,
  pendingDelete,
  onOpenProject,
  onDeleteProject,
}: CanvasProjectCardProps) {
  const isAgentMode = mode === "agent";

  return (
    <article
      className="glass-panel group flex cursor-pointer flex-col overflow-hidden rounded-xl"
      onClick={() => onOpenProject(project.id)}
    >
      <div className="relative aspect-video bg-muted">
        {project.thumbnailUrl ? (
          <img
            src={getGeneratedMediaUrl(project.thumbnailUrl) || project.thumbnailUrl}
            alt={project.title}
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
          />
        ) : isAgentMode ? (
          <GeneratedMediaPlaceholder
            kind="image"
            label="智能画布"
            className="h-full w-full"
            description="点击后恢复画布和对话上下文"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <LayoutGrid className="h-10 w-10 opacity-20" />
          </div>
        )}

        {isAgentMode ? (
          <div className="absolute left-2 top-2 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-medium text-white backdrop-blur">
            智能画布
          </div>
        ) : null}

        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={(event) => {
              event.stopPropagation();
              onOpenProject(project.id);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
            title={isAgentMode ? "继续编辑" : "打开"}
          >
            <Play className="h-4 w-4" />
          </button>
          <button
            onClick={(event) => {
              event.stopPropagation();
              void onDeleteProject(project.id);
            }}
            disabled={isAgentMode ? pendingDelete : undefined}
            className={
              isAgentMode
                ? "flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground disabled:opacity-50"
                : "flex h-9 w-9 items-center justify-center rounded-full bg-background/85 text-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
            }
            title="删除"
          >
            {isAgentMode && pendingDelete ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-3">
        {isAgentMode ? (
          <>
            <div className="mb-2 flex items-center justify-between gap-2">
              <h3 className="truncate text-sm font-medium">{project.title}</h3>
              <span className="rounded bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground">
                Agent
              </span>
            </div>
            <p className="line-clamp-2 flex-1 text-xs text-muted-foreground">
              保存了智能画布节点、分组、视口和侧边栏对话上下文
            </p>
            <p className="mt-2 text-[11px] text-muted-foreground/80">
              {new Date(project.updatedAt).toLocaleString("zh-CN")}
            </p>
          </>
        ) : (
          <>
            <h3 className="truncate text-sm font-medium">{project.title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {new Date(project.updatedAt).toLocaleString("zh-CN")}
            </p>
          </>
        )}
      </div>
    </article>
  );
}
