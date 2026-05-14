import type { CanvasProjectLoadState } from "./canvasProjectSaveHelpers";

type CanvasProjectLoadDisplayStatus = Exclude<CanvasProjectLoadState["status"], "idle">;

type CanvasProjectLoadOverlayProps = {
  loadState: CanvasProjectLoadState;
  displayStatus?: CanvasProjectLoadDisplayStatus;
  onRetry: () => void;
  onReload: () => void;
};

export default function CanvasProjectLoadOverlay({
  loadState,
  displayStatus,
  onRetry,
  onReload,
}: CanvasProjectLoadOverlayProps) {
  const status = displayStatus || (loadState.status === "idle" ? "loading" : loadState.status);
  const description =
    status === "syncing"
      ? "正在校准当前账号可访问的项目范围，完成后会自动加载目标画布。"
      : status === "loading"
        ? "目标项目已定位，正在恢复节点和视口状态。"
        : loadState.status === "error"
          ? loadState.message
          : "目标项目已定位，正在恢复节点和视口状态。";

  return (
    <div className="pointer-events-auto absolute inset-0 z-[120] flex items-center justify-center bg-background/70 px-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 text-card-foreground shadow-2xl">
        <div className="text-sm font-semibold tracking-[0.24em] text-muted-foreground">
          CANVAS
        </div>
        <div className="mt-3 text-2xl font-semibold">
          {status === "syncing"
            ? "正在同步当前账号项目上下文"
            : status === "loading"
              ? "正在加载智能画布项目"
              : "智能画布项目加载失败"}
        </div>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {description}
        </p>
        {loadState.status === "error" ? (
          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center justify-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              重试加载
            </button>
            <button
              type="button"
              onClick={onReload}
              className="inline-flex items-center justify-center rounded-full border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition hover:bg-accent hover:text-accent-foreground"
            >
              刷新当前页
            </button>
          </div>
        ) : (
          <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
          </div>
        )}
      </div>
    </div>
  );
}
