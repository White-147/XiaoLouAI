import { type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  ChevronDown,
  ChevronRight,
  Clock,
  FolderOpen,
  Image as ImageIcon,
  LayoutGrid,
  LoaderCircle,
  Sparkles,
  Video,
} from "lucide-react";
import { cn } from "../../../lib/utils";
import type { CanvasProjectSummary } from "./api/assets";
import {
  IMAGE_SUBCATS,
  VIDEO_SUBCATS,
  type CategoryFilter,
  type SidebarSection,
} from "./assetDisplay";

type AssetCounts = {
  image: Record<string, number>;
  video: Record<string, number>;
};

type AssetSidebarProps = {
  projectTitle: string;
  activeSection: SidebarSection;
  filter: CategoryFilter;
  counts: AssetCounts;
  imageExpanded: boolean;
  videoExpanded: boolean;
  canvasExpanded: boolean;
  canvasProjects: CanvasProjectSummary[];
  showInitialCanvasLoading: boolean;
  agentCanvasSyncedAssetCount: number;
  legacyAgentCanvasProjectAssetCount: number;
  agentCanvasProjectCount: number;
  onActiveSectionChange: Dispatch<SetStateAction<SidebarSection>>;
  onFilterChange: Dispatch<SetStateAction<CategoryFilter>>;
  onImageExpandedChange: Dispatch<SetStateAction<boolean>>;
  onVideoExpandedChange: Dispatch<SetStateAction<boolean>>;
  onCanvasExpandedChange: Dispatch<SetStateAction<boolean>>;
};

export function AssetSidebar({
  projectTitle,
  activeSection,
  filter,
  counts,
  imageExpanded,
  videoExpanded,
  canvasExpanded,
  canvasProjects,
  showInitialCanvasLoading,
  agentCanvasSyncedAssetCount,
  legacyAgentCanvasProjectAssetCount,
  agentCanvasProjectCount,
  onActiveSectionChange,
  onFilterChange,
  onImageExpandedChange,
  onVideoExpandedChange,
  onCanvasExpandedChange,
}: AssetSidebarProps) {
  return (
    <aside className="flex w-72 flex-col border-r border-border bg-card/30">
      <div className="border-b border-border p-4">
        <h2 className="flex items-center gap-2 font-medium">
          <FolderOpen className="h-4 w-4 text-primary" />
          资产库
        </h2>
        <p className="mt-2 text-xs text-muted-foreground">当前项目：{projectTitle}</p>
      </div>

      <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
        <button
          onClick={() => {
            onImageExpandedChange((value) => !value);
            onActiveSectionChange("assets");
            onFilterChange({ root: "image", assetType: "all" });
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
                  onActiveSectionChange("assets");
                  onFilterChange({ root: "image", assetType: item.id } as CategoryFilter);
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

        <button
          onClick={() => {
            onVideoExpandedChange((value) => !value);
            onActiveSectionChange("assets");
            onFilterChange({ root: "video", sourceModule: "all" });
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
                  onActiveSectionChange("assets");
                  onFilterChange({ root: "video", sourceModule: item.id } as CategoryFilter);
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

        <SidebarButton
          active={activeSection === "agent-canvas-assets"}
          icon={<Sparkles className="h-4 w-4" />}
          label="智能画布资产"
          count={agentCanvasSyncedAssetCount}
          onClick={() => onActiveSectionChange("agent-canvas-assets")}
        />

        <div className="my-2" />

        <SidebarButton
          active={activeSection === "legacy-agent-canvas-project-assets"}
          icon={<LayoutGrid className="h-4 w-4" />}
          label="历史智能画布工程"
          count={legacyAgentCanvasProjectAssetCount}
          onClick={() => onActiveSectionChange("legacy-agent-canvas-project-assets")}
        />

        <div className="my-2" />

        <SidebarButton
          active={activeSection === "agent-canvas-projects"}
          icon={<Sparkles className="h-4 w-4" />}
          label="智能画布项目"
          count={agentCanvasProjectCount}
          onClick={() => onActiveSectionChange("agent-canvas-projects")}
        />

        <div className="my-2" />

        <button
          onClick={() => {
            onCanvasExpandedChange((value) => !value);
            onActiveSectionChange("canvas-projects");
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
              canvasProjects.map((project) => (
                <div
                  key={project.id}
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <span className="flex items-center gap-2 truncate">
                    <Clock className="h-3.5 w-3.5 shrink-0 opacity-60" />
                    <span className="truncate">{project.title}</span>
                  </span>
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

type SidebarButtonProps = {
  active: boolean;
  icon: ReactNode;
  label: string;
  count: number;
  onClick: () => void;
};

function SidebarButton({ active, icon, label, count, onClick }: SidebarButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary/10 text-primary"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      <span className="flex items-center gap-3">
        {icon}
        {label}
      </span>
      <span className={cn("rounded-full px-2 py-0.5 text-xs", active ? "bg-primary/20" : "bg-secondary")}>
        {count}
      </span>
    </button>
  );
}
