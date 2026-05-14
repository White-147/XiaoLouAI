import { Clock, History, LoaderCircle, Pencil, Plus, Search, Trash2, X } from "lucide-react";
import type { PlaygroundChatJob, PlaygroundConversation } from "../../lib/api";
import { cn } from "../../lib/utils";
import { formatTime, getJobLabel } from "./playgroundDisplay";

type ConversationDrawerProps = {
  conversations: PlaygroundConversation[];
  activeConversation: PlaygroundConversation | null;
  activeJobByConversation: Map<string, PlaygroundChatJob>;
  conversationSearch: string;
  setConversationSearch: (value: string) => void;
  onClose: () => void;
  onStartNewConversation: () => void;
  onOpenConversation: (conversation: PlaygroundConversation) => void;
  onRenameConversation: (conversation: PlaygroundConversation) => void;
  onRemoveConversation: (conversation: PlaygroundConversation) => void;
};

export function ConversationDrawer({
  conversations,
  activeConversation,
  activeJobByConversation,
  conversationSearch,
  setConversationSearch,
  onClose,
  onStartNewConversation,
  onOpenConversation,
  onRenameConversation,
  onRemoveConversation,
}: ConversationDrawerProps) {
  return (
    <aside className="flex h-full w-[min(350px,calc(100vw-40px))] shrink-0 flex-col border-r border-neutral-200 bg-white shadow-2xl xl:w-[330px] xl:shadow-none dark:border-border dark:bg-card">
      <header className="border-b border-neutral-200 px-4 py-4 dark:border-border">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-950 dark:text-foreground">历史对话</h2>
            <p className="mt-1 text-xs text-neutral-500">{conversations.length || 0} 个历史记录</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950 dark:hover:bg-accent dark:hover:text-foreground"
            aria-label="关闭会话栏"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={onStartNewConversation}
          className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-neutral-950 text-sm font-medium text-white transition hover:bg-neutral-800 dark:bg-primary dark:text-primary-foreground"
        >
          <Plus className="h-4 w-4" />
          新对话
        </button>
        <label className="mt-3 flex h-10 items-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-500 dark:border-border dark:bg-background">
          <Search className="h-4 w-4" />
          <input
            value={conversationSearch}
            onChange={(event) => setConversationSearch(event.currentTarget.value)}
            placeholder="搜索会话"
            className="min-w-0 flex-1 bg-transparent text-neutral-950 outline-none placeholder:text-neutral-400 dark:text-foreground"
          />
        </label>
      </header>

      <div className="flex-1 overflow-y-auto p-2">
        {conversations.length === 0 ? (
          <div className="flex h-44 flex-col items-center justify-center px-4 text-center text-sm text-neutral-500">
            <History className="mb-3 h-6 w-6" />
            还没有对话记录
          </div>
        ) : (
          conversations.map((conversation) => {
            const job = activeJobByConversation.get(conversation.id);
            return (
              <div
                key={conversation.id}
                className={cn(
                  "group mb-1 rounded-xl border border-transparent p-3 transition",
                  activeConversation?.id === conversation.id
                    ? "border-neutral-300 bg-neutral-100 dark:border-primary/30 dark:bg-primary/10"
                    : "hover:bg-neutral-50 dark:hover:bg-accent",
                )}
              >
                <button
                  type="button"
                  onClick={() => void onOpenConversation(conversation)}
                  className="block w-full text-left"
                >
                  <div className="line-clamp-1 text-sm font-medium text-neutral-950 dark:text-foreground">
                    {conversation.title || "新对话"}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-neutral-500">
                    {job ? (
                      <LoaderCircle className="h-3.5 w-3.5 animate-spin text-blue-500" />
                    ) : (
                      <Clock className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {job
                        ? `${getJobLabel(job)} ${job.progress || 0}%`
                        : formatTime(conversation.lastMessageAt || conversation.updatedAt)}
                    </span>
                    <span>{conversation.messageCount || 0} 条</span>
                  </div>
                </button>
                <div className="mt-2 hidden items-center gap-1 group-hover:flex">
                  <button
                    type="button"
                    onClick={() => void onRenameConversation(conversation)}
                    className="inline-flex h-7 items-center gap-1 rounded-full border border-neutral-200 px-2 text-xs text-neutral-500 hover:bg-white hover:text-neutral-950 dark:border-border dark:hover:bg-background dark:hover:text-foreground"
                  >
                    <Pencil className="h-3 w-3" />
                    重命名
                  </button>
                  <button
                    type="button"
                    onClick={() => void onRemoveConversation(conversation)}
                    className="inline-flex h-7 items-center gap-1 rounded-full border border-neutral-200 px-2 text-xs text-neutral-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600 dark:border-border"
                  >
                    <Trash2 className="h-3 w-3" />
                    删除
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
