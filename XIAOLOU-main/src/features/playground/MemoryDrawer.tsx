import {
  Check,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  Save,
  Sparkles,
  StickyNote,
  Trash2,
} from "lucide-react";
import type { PlaygroundMemory, PlaygroundMemoryPreference } from "../../lib/api";
import { cn } from "../../lib/utils";
import { formatTime, type MemoryDraft } from "./playgroundDisplay";

type MemoryDrawerProps = {
  memories: PlaygroundMemory[];
  enabledMemoryCount: number;
  memoryPreference: PlaygroundMemoryPreference;
  canUsePlayground: boolean;
  memoryDrafts: Record<string, MemoryDraft>;
  savingMemoryKey: string | null;
  onToggleMemoryPreference: () => void;
  onRefreshMemories: () => void;
  onClose: () => void;
  updateDraft: (sourceKey: string, patch: Partial<MemoryDraft>) => void;
  saveMemory: (sourceKey: string) => void;
  removeMemory: (memory: PlaygroundMemory) => void;
};

export function MemoryDrawer({
  memories,
  enabledMemoryCount,
  memoryPreference,
  canUsePlayground,
  memoryDrafts,
  savingMemoryKey,
  onToggleMemoryPreference,
  onRefreshMemories,
  onClose,
  updateDraft,
  saveMemory,
  removeMemory,
}: MemoryDrawerProps) {
  return (
    <aside className="flex h-full w-[min(360px,100%)] shrink-0 flex-col border-l border-neutral-200 bg-white shadow-2xl xl:w-[340px] xl:shadow-none dark:border-border dark:bg-card">
      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-border">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-950 dark:text-foreground">
            <StickyNote className="h-4 w-4 text-blue-500" />
            记忆
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            {memories.length ? `${enabledMemoryCount}/${memories.length} 条启用` : "暂无记忆"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleMemoryPreference}
            disabled={!canUsePlayground}
            className={cn(
              "inline-flex h-8 items-center gap-1 rounded-full border px-2 text-xs transition disabled:cursor-not-allowed disabled:opacity-50",
              memoryPreference.enabled
                ? "border-blue-100 bg-blue-50 text-blue-700"
                : "border-neutral-200 text-neutral-500 hover:bg-neutral-50 dark:border-border",
            )}
          >
            <Check className="h-3.5 w-3.5" />
            {memoryPreference.enabled ? "启用" : "停用"}
          </button>
          <button
            type="button"
            onClick={() => void onRefreshMemories()}
            disabled={!canUsePlayground}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:hover:bg-accent dark:hover:text-foreground"
            aria-label="刷新记忆"
            title="刷新记忆"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950 dark:hover:bg-accent dark:hover:text-foreground"
            aria-label="收起记忆"
            title="收起记忆"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-3">
        {memories.length === 0 ? (
          <div className="flex h-full min-h-64 flex-col items-center justify-center px-6 text-center">
            <Sparkles className="h-8 w-8 text-neutral-400" />
            <h3 className="mt-3 text-sm font-semibold text-neutral-950 dark:text-foreground">还没有自动记忆</h3>
            <p className="mt-2 text-xs leading-5 text-neutral-500">
              持续对话后，系统会把稳定偏好和长期信息沉淀到这里。
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {memories.map((memory) => {
              const draft = memoryDrafts[memory.key] || {
                key: memory.key,
                value: memory.value,
                enabled: memory.enabled !== false,
              };
              return (
                <article
                  key={memory.key}
                  className="rounded-xl border border-neutral-200 bg-neutral-50/80 p-3 dark:border-border dark:bg-background"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2 text-xs font-medium text-neutral-500">
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(event) =>
                          updateDraft(memory.key, { enabled: event.currentTarget.checked })
                        }
                        className="h-3.5 w-3.5 accent-neutral-950"
                      />
                      启用
                    </label>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void saveMemory(memory.key)}
                        disabled={savingMemoryKey === memory.key}
                        className="inline-flex h-7 items-center gap-1 rounded-full border border-neutral-200 bg-white px-2 text-xs text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 disabled:opacity-60 dark:border-border dark:bg-card"
                      >
                        {savingMemoryKey === memory.key ? (
                          <LoaderCircle className="h-3 w-3 animate-spin" />
                        ) : (
                          <Save className="h-3 w-3" />
                        )}
                        保存
                      </button>
                      <button
                        type="button"
                        onClick={() => void removeMemory(memory)}
                        className="inline-flex h-7 items-center justify-center rounded-full border border-neutral-200 bg-white px-2 text-neutral-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-border dark:bg-card"
                        aria-label="删除记忆"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <input
                    value={draft.key}
                    onChange={(event) => updateDraft(memory.key, { key: event.currentTarget.value })}
                    className="h-9 w-full rounded-lg border border-neutral-200 bg-white px-2.5 text-xs font-medium text-neutral-950 outline-none transition focus:border-neutral-400 dark:border-border dark:bg-card dark:text-foreground"
                  />
                  <textarea
                    value={draft.value}
                    onChange={(event) =>
                      updateDraft(memory.key, { value: event.currentTarget.value })
                    }
                    rows={4}
                    className="mt-2 w-full resize-none rounded-lg border border-neutral-200 bg-white px-2.5 py-2 text-xs leading-5 text-neutral-950 outline-none transition focus:border-neutral-400 dark:border-border dark:bg-card dark:text-foreground"
                  />
                  <div className="mt-2 flex items-center justify-between text-[11px] text-neutral-500">
                    <span>
                      置信度 {memory.confidence == null ? "--" : Math.round(memory.confidence * 100)}
                    </span>
                    <span>{formatTime(memory.updatedAt)}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
