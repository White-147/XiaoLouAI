import { FormEvent, useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronLeft,
  ChevronRight,
  History,
  LoaderCircle,
  MessageSquarePlus,
  Sparkles,
  StickyNote,
} from "lucide-react";
import {
  deletePlaygroundConversation,
  deletePlaygroundMemory,
  getPlaygroundConversation,
  listPlaygroundChatJobs,
  listPlaygroundConversations,
  listPlaygroundMemories,
  listPlaygroundMessages,
  listPlaygroundModels,
  streamPlaygroundChat,
  updatePlaygroundConversation,
  updatePlaygroundMemory,
  updatePlaygroundMemoryPreference,
  type PlaygroundChatJob,
  type PlaygroundConversation,
  type PlaygroundMemory,
  type PlaygroundMemoryPreference,
  type PlaygroundMessage,
  type PlaygroundModel,
} from "../../lib/api";
import { hasSessionCredentials, useActorId } from "../../lib/actor-session";
import { cn } from "../../lib/utils";
import { ConversationDrawer } from "./ConversationDrawer";
import { MemoryDrawer } from "./MemoryDrawer";
import { PlaygroundComposer } from "./PlaygroundComposer";
import {
  buildComposerMessage,
  buildMemoryDrafts,
  getJobLabel,
  getMessageStatusLabel,
  isActiveChatJob,
  playgroundSkills,
  replacePlaygroundConversationUrl,
  skillCategories,
  starterPrompts,
  upsertConversation,
  upsertMessage,
  type ComposerMode,
  type MemoryDraft,
  type PlaygroundSkill,
} from "./playgroundDisplay";

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
  const [conversationPanelOpen, setConversationPanelOpen] = useState(false);
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(
    () => new URLSearchParams(location.search).get("panel") === "memory",
  );
  const [composerMode, setComposerMode] = useState<ComposerMode>("agent");
  const [thinkingModeEnabled, setThinkingModeEnabled] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<PlaygroundSkill | null>(null);
  const [activeSkillCategory, setActiveSkillCategory] = useState(skillCategories[0]?.id || "script");
  const [skillMenuOpen, setSkillMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  const canUsePlayground = hasSessionCredentials();
  const activeJobByConversation = new Map(
    activeJobs.filter(isActiveChatJob).map((job) => [job.conversationId, job]),
  );
  const activeConversationJob = activeConversation
    ? activeJobByConversation.get(activeConversation.id) || null
    : null;
  const isBusy = sending || Boolean(activeConversationJob);
  const hasActiveJobs = activeJobs.some(isActiveChatJob);
  const enabledMemoryCount = memories.filter((memory) => memory.enabled !== false).length;
  const activeJobIds = activeJobs
    .filter(isActiveChatJob)
    .map((job) => `${job.id}:${job.status}`)
    .join("|");
  const visibleSkills = playgroundSkills.filter((skill) => skill.category === activeSkillCategory);

  useEffect(() => {
    if (location.pathname !== "/playground") {
      navigate(`/playground${location.search}`, { replace: true });
    }
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const panel = params.get("panel");
    if (panel === "memory") setMemoryPanelOpen(true);
    if (panel === "history") setConversationPanelOpen(true);
  }, [location.search]);

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
    setMemoryDrafts(buildMemoryDrafts(response.items));
    return response.items;
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([loadModels(), loadConversations(), loadMemories(), loadActiveJobs()])
      .then(async ([, latestConversations, , latestJobs]) => {
        if (!active) return;
        const params = new URLSearchParams(location.search);
        const conversationIdFromUrl = params.get("conversationId");
        const restoreConversationId =
          conversationIdFromUrl ||
          latestJobs.find(isActiveChatJob)?.conversationId ||
          latestConversations[0]?.id;
        if (!restoreConversationId) return;

        let restoreConversation =
          latestConversations.find((item) => item.id === restoreConversationId) || null;
        if (!restoreConversation && conversationIdFromUrl) {
          try {
            restoreConversation = await getPlaygroundConversation(conversationIdFromUrl);
          } catch {
            restoreConversation = null;
          }
        }
        if (!restoreConversation || !active) return;

        setActiveConversation(restoreConversation);
        setSelectedModel(restoreConversation.model || "qwen-plus");
        replacePlaygroundConversationUrl(restoreConversation.id);
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
  }, [actorId, loadActiveJobs, loadConversations, loadMemories, loadModels, location.search]);

  useEffect(() => {
    if (!hasActiveJobs) return;

    let cancelled = false;
    const refresh = async () => {
      try {
        const jobs = await loadActiveJobs();
        if (cancelled) return;

        const selectedConversationId = activeConversation?.id || null;
        const stillHasActiveJobs = jobs.some(isActiveChatJob);
        const selectedConversationHasActiveJob = selectedConversationId
          ? jobs.some((job) => isActiveChatJob(job) && job.conversationId === selectedConversationId)
          : false;

        if (selectedConversationId && (selectedConversationHasActiveJob || !stillHasActiveJobs)) {
          const response = await listPlaygroundMessages(selectedConversationId);
          if (!cancelled) setMessages(response.items);
        }

        if (!stillHasActiveJobs) {
          const latestConversations = await loadConversations();
          if (cancelled) return;
          if (selectedConversationId) {
            const current = latestConversations.find((item) => item.id === selectedConversationId);
            if (current) setActiveConversation(current);
          }
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
    setSelectedSkill(null);
    setSkillMenuOpen(false);
    setModelMenuOpen(false);
    setModeMenuOpen(false);
    replacePlaygroundConversationUrl(null);
  };

  const openConversation = async (conversation: PlaygroundConversation) => {
    setError(null);
    setActiveConversation(conversation);
    setSelectedModel(conversation.model || "qwen-plus");
    replacePlaygroundConversationUrl(conversation.id);
    try {
      const response = await listPlaygroundMessages(conversation.id);
      setMessages(response.items);
      setConversationPanelOpen(false);
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
      replacePlaygroundConversationUrl(null);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = input.trim();
    if (!message || isBusy) return;
    const submittedMessage = buildComposerMessage(
      message,
      composerMode,
      selectedSkill,
      thinkingModeEnabled,
    );
    setInput("");
    setError(null);
    setSending(true);
    setSkillMenuOpen(false);
    setModelMenuOpen(false);
    setModeMenuOpen(false);

    try {
      await streamPlaygroundChat(
        {
          conversationId: activeConversation?.id || null,
          message: submittedMessage,
          model: selectedModel,
        },
        (chatEvent) => {
          if (chatEvent.type === "conversation") {
            setActiveConversation(chatEvent.conversation);
            setSelectedModel(chatEvent.conversation.model || selectedModel);
            setConversations((items) => upsertConversation(items, chatEvent.conversation));
            replacePlaygroundConversationUrl(chatEvent.conversation.id);
            return;
          }

          if (chatEvent.type === "user_message" || chatEvent.type === "assistant_message") {
            setMessages((items) => upsertMessage(items, chatEvent.message));
            return;
          }

          if (chatEvent.type === "delta") {
            setMessages((items) =>
              items.map((item) =>
                item.id === chatEvent.messageId
                  ? {
                      ...item,
                      content: `${item.content}${chatEvent.delta}`,
                      status: "running",
                    }
                  : item,
              ),
            );
            return;
          }

          if (chatEvent.type === "job") {
            setActiveJobs((items) => [
              chatEvent.job,
              ...items.filter((item) => item.id !== chatEvent.job.id),
            ]);
            return;
          }

          if (chatEvent.type === "done") {
            setActiveConversation(chatEvent.conversation);
            setSelectedModel(chatEvent.conversation.model || selectedModel);
            setConversations((items) => upsertConversation(items, chatEvent.conversation));
            replacePlaygroundConversationUrl(chatEvent.conversation.id);
            if (chatEvent.message) {
              setMessages((items) => upsertMessage(items, chatEvent.message!));
            }
            setMemories(chatEvent.memories);
            setMemoryDrafts(buildMemoryDrafts(chatEvent.memories));
            if (chatEvent.job) {
              setActiveJobs((items) => [
                chatEvent.job!,
                ...items.filter((item) => item.id !== chatEvent.job?.id),
              ]);
            }
            return;
          }

          setError(chatEvent.message || "Playground 流式传输失败");
        },
      );
      setSelectedSkill(null);
      void loadConversations();
      void loadActiveJobs();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "发送失败");
      setInput(message);
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

  const chooseSkill = (skill: PlaygroundSkill) => {
    setSelectedSkill(skill);
    setComposerMode("agent");
    setInput((value) => (value.trim() ? value : skill.prompt));
    setSkillMenuOpen(false);
  };

  const chooseStarterPrompt = (prompt: string) => {
    setInput(prompt);
    setSelectedSkill(null);
  };

  const renderConversationPanel = () => (
    <ConversationDrawer
      conversations={conversations}
      activeConversation={activeConversation}
      activeJobByConversation={activeJobByConversation}
      conversationSearch={conversationSearch}
      setConversationSearch={setConversationSearch}
      onClose={() => setConversationPanelOpen(false)}
      onStartNewConversation={startNewConversation}
      onOpenConversation={openConversation}
      onRenameConversation={renameConversation}
      onRemoveConversation={removeConversation}
    />
  );

  const renderMemoryPanel = () => (
    <MemoryDrawer
      memories={memories}
      enabledMemoryCount={enabledMemoryCount}
      memoryPreference={memoryPreference}
      canUsePlayground={canUsePlayground}
      memoryDrafts={memoryDrafts}
      savingMemoryKey={savingMemoryKey}
      onToggleMemoryPreference={toggleMemoryPreference}
      onRefreshMemories={() => void loadMemories()}
      onClose={() => setMemoryPanelOpen(false)}
      updateDraft={updateDraft}
      saveMemory={saveMemory}
      removeMemory={removeMemory}
    />
  );

  const renderComposer = (compact = false) => (
    <PlaygroundComposer
      compact={compact}
      input={input}
      setInput={setInput}
      canUsePlayground={canUsePlayground}
      activeConversationJob={activeConversationJob}
      onSubmit={handleSubmit}
      selectedSkill={selectedSkill}
      setSelectedSkill={setSelectedSkill}
      skillMenuOpen={skillMenuOpen}
      setSkillMenuOpen={setSkillMenuOpen}
      activeSkillCategory={activeSkillCategory}
      setActiveSkillCategory={setActiveSkillCategory}
      visibleSkills={visibleSkills}
      chooseSkill={chooseSkill}
      composerMode={composerMode}
      setComposerMode={setComposerMode}
      modeMenuOpen={modeMenuOpen}
      setModeMenuOpen={setModeMenuOpen}
      thinkingModeEnabled={thinkingModeEnabled}
      setThinkingModeEnabled={setThinkingModeEnabled}
      models={models}
      selectedModel={selectedModel}
      setSelectedModel={setSelectedModel}
      modelMenuOpen={modelMenuOpen}
      setModelMenuOpen={setModelMenuOpen}
      isBusy={isBusy}
      sending={sending}
    />
  );

  if (loading) {
    return (
      <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-white text-sm text-neutral-500 dark:bg-background">
        <div className="inline-flex items-center gap-2 rounded-full border border-neutral-200 bg-white px-4 py-3 shadow-sm dark:border-border dark:bg-card">
          <LoaderCircle className="h-4 w-4 animate-spin text-blue-500" />
          正在加载 Playground
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-1 overflow-hidden bg-[#f6f4ef] text-neutral-950 dark:bg-background dark:text-foreground">
      {conversationPanelOpen ? (
        <>
          <button
            type="button"
            className="absolute inset-0 z-20 bg-neutral-950/15 xl:hidden"
            onClick={() => setConversationPanelOpen(false)}
            aria-label="关闭会话栏遮罩"
          />
          <div className="absolute inset-y-0 left-0 z-30 xl:relative xl:inset-auto xl:z-auto">
            {renderConversationPanel()}
          </div>
        </>
      ) : null}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-neutral-200 bg-white/90 px-4 backdrop-blur dark:border-border dark:bg-background/90">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConversationPanelOpen(true)}
              className="inline-flex h-9 items-center gap-2 rounded-full border border-neutral-200 bg-white px-3 text-sm text-neutral-700 transition hover:bg-neutral-50 hover:text-neutral-950 dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground"
            >
              <History className="h-4 w-4" />
              历史
            </button>
            <button
              type="button"
              onClick={startNewConversation}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-neutral-950 px-3 text-sm font-medium text-white transition hover:bg-neutral-800 dark:bg-primary dark:text-primary-foreground"
            >
              <MessageSquarePlus className="h-4 w-4" />
              新对话
            </button>
          </div>

          <div className="hidden min-w-0 flex-1 text-center sm:block">
            <div className="truncate text-sm font-medium text-neutral-950 dark:text-foreground">
              {activeConversation?.title || "创意入口"}
            </div>
            {activeConversationJob ? (
              <div className="mt-0.5 inline-flex items-center gap-1.5 text-xs text-blue-600">
                <LoaderCircle className="h-3 w-3 animate-spin" />
                {getJobLabel(activeConversationJob)}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setMemoryPanelOpen(true)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-sm transition",
              memoryPanelOpen
                ? "border-blue-100 bg-blue-50 text-blue-700"
                : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50 hover:text-neutral-950 dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground",
            )}
          >
            <StickyNote className="h-4 w-4" />
            记忆
          </button>
        </header>

        {error ? (
          <div className="mx-auto mt-4 w-full max-w-3xl px-4">
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
              {error}
            </div>
          </div>
        ) : null}

        {messages.length === 0 ? (
          <section className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8">
            <div className="mb-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-neutral-950 text-white shadow-sm dark:bg-primary dark:text-primary-foreground">
                <Sparkles className="h-6 w-6" />
              </div>
              <h1 className="mt-5 text-3xl font-semibold tracking-normal text-neutral-950 dark:text-foreground">
                你想创作什么？
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-neutral-500">
                从一句想法进入创作，后续会话和长期记忆都在两侧抽屉里保留。
              </p>
            </div>

            {renderComposer(false)}

            <div className="mt-5 grid w-full max-w-3xl gap-2 sm:grid-cols-2">
              {starterPrompts.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  onClick={() => chooseStarterPrompt(prompt)}
                  className="rounded-2xl border border-neutral-200 bg-white px-4 py-3 text-left text-sm leading-6 text-neutral-700 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-950 dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </section>
        ) : (
          <>
            <section className="flex-1 overflow-y-auto px-4 py-6">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
                {messages.map((message) => {
                  const isUser = message.role === "user";
                  const isWorking =
                    !isUser &&
                    (message.status === "queued" ||
                      message.status === "running" ||
                      message.status === "pending");
                  return (
                    <article
                      key={message.id}
                      className={cn("flex", isUser ? "justify-end" : "justify-start")}
                    >
                      <div
                        className={cn(
                          "min-w-0 rounded-[18px] px-4 py-3 text-sm leading-6 shadow-sm",
                          isUser
                            ? "max-w-[min(86%,720px)] border border-[#eee4d5] bg-[#fbf7ef] text-neutral-950 shadow-[0_10px_26px_rgba(120,90,50,0.08)] dark:border-neutral-600 dark:bg-neutral-700 dark:text-white dark:shadow-none"
                            : "w-full bg-transparent text-neutral-950 shadow-none dark:text-foreground",
                        )}
                      >
                        {isUser ? (
                          <p className="whitespace-pre-wrap">{message.content}</p>
                        ) : isWorking && !message.content ? (
                          <div className="inline-flex items-center gap-2 text-neutral-500">
                            <LoaderCircle className="h-4 w-4 animate-spin text-blue-500" />
                            {activeConversationJob
                              ? getJobLabel(activeConversationJob)
                              : getMessageStatusLabel(message.status)}
                          </div>
                        ) : (
                          <div className="prose prose-sm max-w-none text-neutral-950 dark:prose-invert dark:text-foreground">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {message.content || "正在思考..."}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
            <div className="shrink-0 border-t border-neutral-200 bg-[#f6f4ef]/95 px-4 py-4 backdrop-blur dark:border-border dark:bg-background/95">
              {renderComposer(true)}
            </div>
          </>
        )}
      </main>

      {memoryPanelOpen ? (
        <>
          <button
            type="button"
            className="absolute inset-0 z-20 bg-neutral-950/15 xl:hidden"
            onClick={() => setMemoryPanelOpen(false)}
            aria-label="关闭记忆栏遮罩"
          />
          <div className="absolute inset-y-0 right-0 z-30 xl:relative xl:inset-auto xl:z-auto">
            {renderMemoryPanel()}
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={() => setMemoryPanelOpen(true)}
          className="absolute right-4 top-20 hidden h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-sm transition hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:flex dark:border-border dark:bg-card dark:hover:text-foreground"
          aria-label="展开记忆"
          title="展开记忆"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      {!conversationPanelOpen ? (
        <button
          type="button"
          onClick={() => setConversationPanelOpen(true)}
          className="absolute left-4 top-20 hidden h-9 w-9 items-center justify-center rounded-full border border-neutral-200 bg-white text-neutral-500 shadow-sm transition hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:flex dark:border-border dark:bg-card dark:hover:text-foreground"
          aria-label="展开历史"
          title="展开历史"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      ) : null}
    </div>
  );
}
