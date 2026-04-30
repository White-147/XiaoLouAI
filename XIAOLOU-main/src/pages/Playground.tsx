import { FormEvent, useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Bot,
  Check,
  ChevronRight,
  Clock,
  History,
  LoaderCircle,
  MessageSquarePlus,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Send,
  Sparkles,
  StickyNote,
  Trash2,
} from "lucide-react";
import {
  deletePlaygroundConversation,
  deletePlaygroundMemory,
  listPlaygroundChatJobs,
  listPlaygroundConversations,
  listPlaygroundMemories,
  listPlaygroundMessages,
  listPlaygroundModels,
  startPlaygroundChatJob,
  updatePlaygroundConversation,
  updatePlaygroundMemory,
  updatePlaygroundMemoryPreference,
  type PlaygroundChatJob,
  type PlaygroundConversation,
  type PlaygroundMemory,
  type PlaygroundMemoryPreference,
  type PlaygroundMessage,
  type PlaygroundModel,
} from "../lib/api";
import { useActorId } from "../lib/actor-session";
import { cn } from "../lib/utils";

function formatTime(value: string | null | undefined) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "刚刚";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function upsertMessage(items: PlaygroundMessage[], message: PlaygroundMessage) {
  const existingIndex = items.findIndex((item) => item.id === message.id);
  if (existingIndex === -1) return [...items, message];
  const next = [...items];
  next[existingIndex] = message;
  return next;
}

function upsertConversation(items: PlaygroundConversation[], conversation: PlaygroundConversation) {
  const existingIndex = items.findIndex((item) => item.id === conversation.id);
  if (existingIndex === -1) return [conversation, ...items];
  const next = [...items];
  next[existingIndex] = conversation;
  return next;
}

function isActiveChatJob(job: PlaygroundChatJob | null | undefined) {
  return job ? job.status === "queued" || job.status === "running" : false;
}

type MemoryDraft = {
  key: string;
  value: string;
  enabled: boolean;
};

export default function Playground() {
  const actorId = useActorId();
  const location = useLocation();
  const navigate = useNavigate();
  const [models, setModels] = useState<PlaygroundModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("qwen-plus");
  const [conversations, setConversations] = useState<PlaygroundConversation[]>([]);
  const [activeJobs, setActiveJobs] = useState<PlaygroundChatJob[]>([]);
  const [conversationSearch, setConversationSearch] = useState("");
  const [activeConversation, setActiveConversation] = useState<PlaygroundConversation | null>(null);
  const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [memories, setMemories] = useState<PlaygroundMemory[]>([]);
  const [memoryPreference, setMemoryPreference] = useState<PlaygroundMemoryPreference>({
    enabled: true,
    updatedAt: null,
  });
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, MemoryDraft>>({});
  const [savingMemoryKey, setSavingMemoryKey] = useState<string | null>(null);
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(true);
  const activeJobByConversation = new Map(
    activeJobs.filter(isActiveChatJob).map((job) => [job.conversationId, job]),
  );
  const activeConversationJob = activeConversation
    ? activeJobByConversation.get(activeConversation.id) || null
    : null;
  const hasActiveJobs = activeJobs.some(isActiveChatJob);
  const activeJobIds = activeJobs
    .filter(isActiveChatJob)
    .map((job) => `${job.id}:${job.status}`)
    .join("|");

  useEffect(() => {
    if (location.pathname !== "/playground") {
      navigate("/playground", { replace: true });
    }
  }, [location.pathname, navigate]);

  const loadModels = useCallback(async () => {
    const response = await listPlaygroundModels();
    setModels(response.items);
    setSelectedModel((current) => {
      if (current && response.items.some((item) => item.id === current)) return current;
      return response.defaultModel || response.items[0]?.id || "qwen-plus";
    });
    return response.items;
  }, []);

  const loadConversations = useCallback(async () => {
    const response = await listPlaygroundConversations(conversationSearch);
    setConversations(response.items);
    return response.items;
  }, [conversationSearch]);

  const loadActiveJobs = useCallback(async () => {
    const response = await listPlaygroundChatJobs({ activeOnly: true, limit: 100 });
    setActiveJobs(response.items);
    return response.items;
  }, []);

  const loadMemories = useCallback(async () => {
    const response = await listPlaygroundMemories();
    setMemoryPreference(response.preference);
    setMemories(response.items);
    setMemoryDrafts(
      Object.fromEntries(
        response.items.map((item) => [
          item.key,
          {
            key: item.key,
            value: item.value,
            enabled: item.enabled !== false,
          },
        ]),
      ),
    );
    return response.items;
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([loadModels(), loadConversations(), loadMemories(), loadActiveJobs()])
      .then(async ([, latestConversations, , latestJobs]) => {
        if (!active) return;
        const restoreConversationId =
          latestJobs.find(isActiveChatJob)?.conversationId || latestConversations[0]?.id;
        const restoreConversation = latestConversations.find((item) => item.id === restoreConversationId);
        if (!restoreConversation) return;
        setActiveConversation(restoreConversation);
        setSelectedModel(restoreConversation.model || "qwen-plus");
        const response = await listPlaygroundMessages(restoreConversation.id);
        if (active) setMessages(response.items);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "Playground 加载失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [actorId, loadActiveJobs, loadConversations, loadMemories, loadModels]);

  useEffect(() => {
    if (!hasActiveJobs) return;

    let cancelled = false;
    const refresh = async () => {
      try {
        const [jobs, latestConversations] = await Promise.all([
          loadActiveJobs(),
          loadConversations(),
        ]);
        if (cancelled) return;

        if (activeConversation?.id) {
          const current = latestConversations.find((item) => item.id === activeConversation.id);
          if (current) setActiveConversation(current);
          const response = await listPlaygroundMessages(activeConversation.id);
          if (!cancelled) setMessages(response.items);
        }

        if (!jobs.some(isActiveChatJob)) {
          void loadMemories();
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Playground 任务状态刷新失败");
        }
      }
    };

    const timer = window.setInterval(() => {
      void refresh();
    }, 1500);
    void refresh();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activeConversation?.id, activeJobIds, hasActiveJobs, loadActiveJobs, loadConversations, loadMemories]);

  const startNewConversation = () => {
    setActiveConversation(null);
    setMessages([]);
    setInput("");
    setError(null);
  };

  const openConversation = async (conversation: PlaygroundConversation) => {
    setError(null);
    setActiveConversation(conversation);
    setSelectedModel(conversation.model || "qwen-plus");
    try {
      const response = await listPlaygroundMessages(conversation.id);
      setMessages(response.items);
      void loadActiveJobs();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "会话加载失败");
      setMessages([]);
    }
  };

  const renameConversation = async (conversation: PlaygroundConversation) => {
    const title = window.prompt("重命名会话", conversation.title);
    if (!title?.trim()) return;
    const updated = await updatePlaygroundConversation(conversation.id, { title: title.trim() });
    setConversations((items) => items.map((item) => (item.id === updated.id ? updated : item)));
    if (activeConversation?.id === updated.id) setActiveConversation(updated);
  };

  const removeConversation = async (conversation: PlaygroundConversation) => {
    const confirmed = window.confirm(`删除会话「${conversation.title}」？此操作不可恢复。`);
    if (!confirmed) return;
    await deletePlaygroundConversation(conversation.id);
    setConversations((items) => items.filter((item) => item.id !== conversation.id));
    if (activeConversation?.id === conversation.id) {
      setActiveConversation(null);
      setMessages([]);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || sending || activeConversationJob) return;
    setInput("");
    setError(null);
    setSending(true);

    try {
      const result = await startPlaygroundChatJob({
        conversationId: activeConversation?.id || null,
        message,
        model: selectedModel,
      });
      setActiveConversation(result.conversation);
      setSelectedModel(result.conversation.model || selectedModel);
      setMessages((items) =>
        upsertMessage(upsertMessage(items, result.userMessage), result.assistantMessage),
      );
      setConversations((items) => upsertConversation(items, result.conversation));
      setActiveJobs((items) => [result.job, ...items.filter((item) => item.id !== result.job.id)]);
      void loadConversations();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发送失败");
    } finally {
      setSending(false);
    }
  };

  const updateDraft = (sourceKey: string, patch: Partial<MemoryDraft>) => {
    setMemoryDrafts((drafts) => ({
      ...drafts,
      [sourceKey]: {
        key: drafts[sourceKey]?.key || sourceKey,
        value: drafts[sourceKey]?.value || "",
        enabled: drafts[sourceKey]?.enabled ?? true,
        ...patch,
      },
    }));
  };

  const saveMemory = async (sourceKey: string) => {
    const draft = memoryDrafts[sourceKey];
    if (!draft?.key.trim() || !draft.value.trim()) return;
    setSavingMemoryKey(sourceKey);
    try {
      await updatePlaygroundMemory(sourceKey, {
        key: draft.key.trim(),
        value: draft.value.trim(),
        enabled: draft.enabled,
      });
      await loadMemories();
    } finally {
      setSavingMemoryKey(null);
    }
  };

  const removeMemory = async (memory: PlaygroundMemory) => {
    const confirmed = window.confirm(`删除记忆「${memory.key}」？此操作不可恢复。`);
    if (!confirmed) return;
    await deletePlaygroundMemory(memory.key);
    await loadMemories();
  };

  const toggleMemoryPreference = async () => {
    const next = await updatePlaygroundMemoryPreference({
      enabled: !memoryPreference.enabled,
    });
    setMemoryPreference(next);
  };

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
        <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
        正在加载 Playground
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden bg-background">
      <aside className="flex w-80 shrink-0 flex-col border-r border-border bg-card/40">
        <div className="border-b border-border p-4">
          <button
            type="button"
            onClick={startNewConversation}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            新对话
          </button>
          <label className="mt-3 flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-muted-foreground">
            <Search className="h-4 w-4" />
            <input
              value={conversationSearch}
              onChange={(event) => setConversationSearch(event.currentTarget.value)}
              placeholder="搜索会话"
              className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center px-4 text-center text-sm text-muted-foreground">
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
                    "group mb-1 rounded-md border border-transparent p-3 transition",
                    activeConversation?.id === conversation.id
                      ? "border-primary/30 bg-primary/10"
                      : "hover:bg-accent",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => void openConversation(conversation)}
                    className="block w-full text-left"
                  >
                    <div className="line-clamp-1 text-sm font-medium text-foreground">
                      {conversation.title || "新对话"}
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      {job ? (
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" />
                      ) : (
                        <Clock className="h-3.5 w-3.5" />
                      )}
                      <span>
                        {job
                          ? `${job.status === "queued" ? "排队中" : "生成中"} ${job.progress || 0}%`
                          : formatTime(conversation.lastMessageAt || conversation.updatedAt)}
                      </span>
                      <span>{conversation.messageCount || 0} 条</span>
                    </div>
                  </button>
                  <div className="mt-2 hidden items-center gap-1 group-hover:flex">
                    <button
                      type="button"
                      onClick={() => void renameConversation(conversation)}
                      className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" />
                      重命名
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeConversation(conversation)}
                      className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
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

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-border px-5">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold text-foreground">
              {activeConversation?.title || "新对话"}
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              LibreChat Lite · 小楼原生对话与自动记忆
            </p>
          </div>
          <div className="flex items-center gap-2">
            {activeConversationJob ? (
              <div className="inline-flex h-9 items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 text-xs text-primary">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                {activeConversationJob.status === "queued" ? "排队中" : "后台生成中"}
              </div>
            ) : null}
            <select
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.currentTarget.value)}
              disabled={Boolean(activeConversationJob)}
              className="h-9 min-w-52 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none"
            >
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name || model.id}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setMemoryPanelOpen((value) => !value)}
              aria-pressed={memoryPanelOpen}
              title={memoryPanelOpen ? "收起记忆面板" : "展开记忆面板"}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition",
                memoryPanelOpen
                  ? "border-primary/40 bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <StickyNote className="h-4 w-4" />
              记忆
            </button>
          </div>
        </header>

        <section className="flex-1 overflow-y-auto px-6 py-5">
          {error ? (
            <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          ) : null}

          {messages.length === 0 ? (
            <div className="flex min-h-[520px] flex-col items-center justify-center text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <MessageSquarePlus className="h-7 w-7" />
              </div>
              <h2 className="mt-5 text-2xl font-semibold text-foreground">开始一段新对话</h2>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                输入问题后会自动创建会话，并在回复完成后提取可复用的长期记忆。
              </p>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
              {messages.map((message) => {
                const isUser = message.role === "user";
                const isWorking =
                  !isUser && (message.status === "queued" || message.status === "running" || message.status === "pending");
                return (
                  <article
                    key={message.id}
                    className={cn("flex gap-3", isUser ? "justify-end" : "justify-start")}
                  >
                    {!isUser ? (
                      <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <Bot className="h-4 w-4" />
                      </div>
                    ) : null}
                    <div
                      className={cn(
                        "max-w-[78%] rounded-lg px-4 py-3 text-sm leading-6 shadow-sm",
                        isUser
                          ? "bg-primary text-primary-foreground"
                          : "border border-border bg-card text-foreground",
                      )}
                    >
                      {isUser ? (
                        <p className="whitespace-pre-wrap">{message.content}</p>
                      ) : isWorking && !message.content ? (
                        <div className="inline-flex items-center gap-2 text-muted-foreground">
                          <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                          {message.status === "queued" ? "排队中" : "后台生成中"}
                        </div>
                      ) : (
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {message.content || "正在思考..."}
                        </ReactMarkdown>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <form onSubmit={handleSubmit} className="shrink-0 border-t border-border bg-background p-4">
          <div className="mx-auto flex max-w-4xl items-end gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
            <textarea
              value={input}
              onChange={(event) => setInput(event.currentTarget.value)}
              disabled={Boolean(activeConversationJob)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }
              }}
              placeholder="输入你的问题"
              rows={2}
              className="min-h-12 flex-1 resize-none bg-transparent text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
            />
            <button
              type="submit"
              disabled={sending || Boolean(activeConversationJob) || !input.trim()}
              className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="发送"
            >
              {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </form>
      </main>

      {memoryPanelOpen ? (
        <aside className="flex w-96 shrink-0 flex-col border-l border-border bg-card/40">
          <header className="flex h-16 items-center justify-between border-b border-border px-4">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <StickyNote className="h-4 w-4 text-primary" />
                自动记忆
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {memories.length ? `${memories.length} 条已保存` : "暂无记忆"}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={toggleMemoryPreference}
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs transition",
                  memoryPreference.enabled
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent",
                )}
              >
                <Check className="h-3.5 w-3.5" />
                {memoryPreference.enabled ? "启用" : "停用"}
              </button>
              <button
                type="button"
                onClick={() => void loadMemories()}
                className="inline-flex h-8 items-center justify-center rounded-md border border-border px-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                aria-label="刷新记忆"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setMemoryPanelOpen(false)}
                className="inline-flex h-8 items-center justify-center rounded-md border border-border px-2 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                aria-label="收起记忆面板"
                title="收起记忆面板"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto p-3">
            {memories.length === 0 ? (
              <div className="flex h-full min-h-64 flex-col items-center justify-center px-6 text-center">
                <Sparkles className="h-8 w-8 text-muted-foreground" />
                <h3 className="mt-3 text-sm font-semibold text-foreground">还没有自动记忆</h3>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">
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
                      className="rounded-lg border border-border bg-background p-3 shadow-sm"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-xs text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={draft.enabled}
                            onChange={(event) =>
                              updateDraft(memory.key, { enabled: event.currentTarget.checked })
                            }
                            className="h-3.5 w-3.5 accent-primary"
                          />
                          启用
                        </label>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void saveMemory(memory.key)}
                            disabled={savingMemoryKey === memory.key}
                            className="inline-flex h-7 items-center gap-1 rounded border border-border px-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
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
                            className="inline-flex h-7 items-center justify-center rounded border border-border px-2 text-muted-foreground hover:border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
                            aria-label="删除记忆"
                          >
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      <input
                        value={draft.key}
                        onChange={(event) => updateDraft(memory.key, { key: event.currentTarget.value })}
                        className="h-9 w-full rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground outline-none transition focus:border-primary/50"
                      />
                      <textarea
                        value={draft.value}
                        onChange={(event) =>
                          updateDraft(memory.key, { value: event.currentTarget.value })
                        }
                        rows={4}
                        className="mt-2 w-full resize-none rounded-md border border-border bg-card px-2.5 py-2 text-xs leading-5 text-foreground outline-none transition focus:border-primary/50"
                      />
                      <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
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
      ) : null}
    </div>
  );
}
