import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";

const STORAGE_PREFIX = "xiaolou:create-studio:sidebar:";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type CreateStudioSplitLayoutProps = {
  /** 用于区分图片/视频页本地存储宽度 */
  pageKey: string;
  sidebar: ReactNode;
  children: ReactNode;
  className?: string;
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
};

export function CreateStudioSplitLayout({
  pageKey,
  sidebar,
  children,
  className,
  defaultWidth = 320,
  minWidth = 240,
  maxWidth = 560,
}: CreateStudioSplitLayoutProps) {
  const storageKey = `${STORAGE_PREFIX}${pageKey}`;

  const readStoredWidth = useCallback(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw == null) return defaultWidth;
      const n = Number(raw);
      return Number.isFinite(n) ? n : defaultWidth;
    } catch {
      return defaultWidth;
    }
  }, [storageKey, defaultWidth]);

  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clamp(readStoredWidth(), minWidth, maxWidth),
  );

  const [resizing, setResizing] = useState(false);
  const startPointerX = useRef(0);
  const startWidth = useRef(sidebarWidth);
  const widthRef = useRef(sidebarWidth);

  useEffect(() => {
    widthRef.current = sidebarWidth;
  }, [sidebarWidth]);

  const effectiveMax = useCallback(() => {
    if (typeof window === "undefined") return maxWidth;
    return clamp(maxWidth, minWidth, window.innerWidth - 280);
  }, [maxWidth, minWidth]);

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      startPointerX.current = event.clientX;
      startWidth.current = widthRef.current;
      setResizing(true);
    },
    [],
  );

  useEffect(() => {
    if (!resizing) return;

    const move = (event: PointerEvent) => {
      const delta = event.clientX - startPointerX.current;
      const next = clamp(startWidth.current + delta, minWidth, effectiveMax());
      widthRef.current = next;
      setSidebarWidth(next);
    };

    const up = () => {
      setResizing(false);
      try {
        localStorage.setItem(storageKey, String(widthRef.current));
      } catch {
        /* ignore */
      }
    };

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);

    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
    };
  }, [resizing, minWidth, effectiveMax, storageKey]);

  return (
    <div className={cn("flex h-full min-h-0 w-full min-w-0 bg-background", className)}>
      <aside
        className="flex min-h-0 min-w-0 shrink-0 flex-col border-r border-border bg-card/30"
        style={{ width: sidebarWidth }}
      >
        {sidebar}
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调节左侧参数栏宽度"
        title="拖动调节宽度"
        onPointerDown={handleResizePointerDown}
        className={cn(
          "group/resize relative z-10 w-2 shrink-0 cursor-col-resize touch-none select-none",
          "border-r border-transparent hover:border-primary/30",
          resizing ? "border-primary/40 bg-primary/10" : "",
        )}
      >
        <span
          className={cn(
            "absolute inset-y-2 left-1/2 w-px -translate-x-1/2 rounded-full bg-border transition-colors",
            "group-hover/resize:bg-primary/60",
            resizing ? "bg-primary" : "",
          )}
        />
      </div>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
