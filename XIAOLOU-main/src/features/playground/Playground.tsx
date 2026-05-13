import { FormEvent, useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  BookOpen,
  Bot,
  Box,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  History,
  Image as ImageIcon,
  Lightbulb,
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
  Video,
  X,
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

type MemoryDraft = {
  key: string;
  value: string;
  enabled: boolean;
};

type ComposerMode = "agent" | "image" | "video";

type PlaygroundSkillCategory = {
  id: string;
  label: string;
};

type PlaygroundSkill = {
  id: string;
  category: string;
  title: string;
  description: string;
  prompt: string;
};

const starterPrompts = [
  "把一个悬疑短剧创意拆成三幕，并给出每幕冲突",
  "帮我把角色设定整理成可执行的视觉方向",
  "先问我 3 个关键问题，再整理成可拍摄方案",
  "把这个营销短片写成 10 条分镜提示词",
];

const composerModes: Array<{
  value: ComposerMode;
  label: string;
  description: string;
  icon: typeof Bot;
}> = [
  {
    value: "agent",
    label: "Agent",
    description: "规划、拆解和执行创意任务",
    icon: Bot,
  },
  {
    value: "image",
    label: "图像",
    description: "偏向画面、构图、风格与生图提示词",
    icon: ImageIcon,
  },
  {
    value: "video",
    label: "视频",
    description: "偏向镜头、节奏、运动和分镜",
    icon: Video,
  },
];

const skillCategories: PlaygroundSkillCategory[] = [
  { id: "script", label: "脚本" },
  { id: "video", label: "视频" },
  { id: "brand", label: "品牌" },
];

const playgroundSkills: PlaygroundSkill[] = [
  {
    id: "story-breakdown",
    category: "script",
    title: "剧本拆解提示词",
    description: "把剧本或故事梗概拆成可执行分镜。",
    prompt: "请把我提供的剧本拆成结构清晰的分镜提示词，保留人物、场景、镜头运动、情绪和时长。",
  },
  {
    id: "character-visual",
    category: "script",
    title: "角色视觉设定",
    description: "整理角色、服装、表演和视觉连续性。",
    prompt: "请把角色设定整理成可用于图像和视频生成的视觉说明，包含外观、服装、表演、光影和一致性约束。",
  },
  {
    id: "short-video-plan",
    category: "video",
    title: "短视频创作方案",
    description: "从一句想法生成镜头节奏和发布结构。",
    prompt: "请把我的想法拆成短视频创作方案，包含开场钩子、镜头节奏、画面提示词、字幕和发布文案。",
  },
  {
    id: "video-prompt-polish",
    category: "video",
    title: "视频提示词润色",
    description: "把粗略想法改写成稳定的视频生成提示。",
    prompt: "请把我的描述润色成视频生成提示词，强调镜头运动、主体动作、光影、景别、转场和负面约束。",
  },
  {
    id: "brand-style",
    category: "brand",
    title: "品牌视觉延展",
    description: "延展品牌调性、版式和视觉语言。",
    prompt: "请保持品牌一致性，为我的主题生成 3 个可执行视觉方向，包含色彩、构图、材质、字体氛围和示例提示词。",
  },
];

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

function buildMemoryDrafts(memories: PlaygroundMemory[]) {
  return Object.fromEntries(
    memories.map((item) => [
      item.key,
      {
        key: item.key,
        value: item.value,
        enabled: item.enabled !== false,
      },
    ]),
  );
}

function replacePlaygroundConversationUrl(conversationId: string | null) {
  const url = new URL(window.location.href);
  if (conversationId) {
    url.searchParams.set("conversationId", conversationId);
  } else {
    url.searchParams.delete("conversationId");
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

function getJobLabel(job: PlaygroundChatJob | null | undefined) {
  if (!job) return "";
  if (job.status === "queued") return "排队中";
  if (job.status === "running") return "生成中";
  if (job.status === "failed") return "失败";
  if (job.status === "cancelled") return "已取消";
  return "已完成";
}

function getMessageStatusLabel(status: PlaygroundMessage["status"]) {
  if (status === "queued") return "排队中";
  if (status === "running" || status === "pending") return "后台生成中";
  return "后台生成中";
}

function buildComposerMessage(
  rawMessage: string,
  mode: ComposerMode,
  skill: PlaygroundSkill | null,
  thinkingEnabled: boolean,
) {
  const instructions: string[] = [];
  if (skill) {
    instructions.push(`当前启用 Skill：${skill.title}\n${skill.prompt}`);
  }
  if (mode === "image") {
    instructions.push("请按图像创作方向回复，优先给出画面、风格、构图、主体、光影和提示词。");
  }
  if (mode === "video") {
    instructions.push("请按视频创作方向回复，优先给出镜头、节奏、运动、分镜、时长和可执行提示词。");
  }
  if (thinkingEnabled) {
    instructions.push("请先给出简短思路或步骤，再给出可直接执行的结果。");
  }
  return [...instructions, rawMessage].join("\n\n");
}

function modelLabel(model: PlaygroundModel) {
  return model.name || model.id;
}

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
  const activeJobIds = activeJobs
    .filter(isActiveChatJob)
    .map((job) => `${job.id}:${job.status}`)
    .join("|");
  const selectedModelName =
    models.find((model) => model.id === selectedModel)?.name || selectedModel || "Qwen Plus";
  const activeMode = composerModes.find((mode) => mode.value === composerMode) || composerModes[0];
  const ActiveModeIcon = activeMode.icon;
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
    <aside className="flex h-full w-[min(350px,calc(100vw-40px))] shrink-0 flex-col border-r border-neutral-200 bg-white shadow-2xl xl:w-[330px] xl:shadow-none dark:border-border dark:bg-card">
      <header className="border-b border-neutral-200 px-4 py-4 dark:border-border">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-950 dark:text-foreground">历史对话</h2>
            <p className="mt-1 text-xs text-neutral-500">{conversations.length || 0} 个历史记录</p>
          </div>
          <button
            type="button"
            onClick={() => setConversationPanelOpen(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950 dark:hover:bg-accent dark:hover:text-foreground"
            aria-label="关闭会话栏"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <button
          type="button"
          onClick={startNewConversation}
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
                  onClick={() => void openConversation(conversation)}
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
                    onClick={() => void renameConversation(conversation)}
                    className="inline-flex h-7 items-center gap-1 rounded-full border border-neutral-200 px-2 text-xs text-neutral-500 hover:bg-white hover:text-neutral-950 dark:border-border dark:hover:bg-background dark:hover:text-foreground"
                  >
                    <Pencil className="h-3 w-3" />
                    重命名
                  </button>
                  <button
                    type="button"
                    onClick={() => void removeConversation(conversation)}
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

  const renderMemoryPanel = () => (
    <aside className="flex h-full w-[min(370px,calc(100vw-40px))] shrink-0 flex-col border-l border-neutral-200 bg-white shadow-2xl xl:w-[350px] xl:shadow-none dark:border-border dark:bg-card">
      <header className="flex min-h-16 items-center justify-between gap-3 border-b border-neutral-200 px-4 py-3 dark:border-border">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-950 dark:text-foreground">
            <StickyNote className="h-4 w-4 text-blue-500" />
            记忆中心
          </h2>
          <p className="mt-1 text-xs text-neutral-500">
            {memories.length ? `${memories.length} 条已保存` : "暂无记忆"}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleMemoryPreference}
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
            onClick={() => void loadMemories()}
            disabled={!canUsePlayground}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-neutral-200 text-neutral-500 transition hover:bg-neutral-50 hover:text-neutral-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-border dark:hover:bg-accent dark:hover:text-foreground"
            aria-label="刷新记忆"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setMemoryPanelOpen(false)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-950 dark:hover:bg-accent dark:hover:text-foreground"
            aria-label="关闭记忆栏"
          >
            <X className="h-4 w-4" />
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

  const renderComposer = (compact = false) => (
    <form onSubmit={handleSubmit} className="mx-auto w-full max-w-3xl">
      <div className="relative rounded-[22px] border border-neutral-200 bg-white px-3 pb-3 pt-3 shadow-[0_18px_50px_rgba(24,24,27,0.10)] transition focus-within:border-neutral-300 dark:border-border dark:bg-card">
        {selectedSkill ? (
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
              <BookOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{selectedSkill.title}</span>
              <button
                type="button"
                onClick={() => setSelectedSkill(null)}
                className="ml-0.5 rounded-full p-0.5 text-blue-500 transition hover:bg-blue-100 hover:text-blue-800"
                aria-label="取消 Skill"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          </div>
        ) : null}

        <textarea
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          disabled={!canUsePlayground || Boolean(activeConversationJob)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={canUsePlayground ? "写下你的想法、任务或要创作的内容..." : "请先登录后使用 Playground"}
          rows={compact ? 2 : 4}
          className={cn(
            "w-full resize-none bg-transparent px-1 text-sm leading-6 text-neutral-950 outline-none placeholder:text-neutral-400 dark:text-foreground",
            compact ? "min-h-14" : "min-h-28",
          )}
        />

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setSkillMenuOpen((open) => !open);
                  setModelMenuOpen(false);
                  setModeMenuOpen(false);
                }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm transition",
                  skillMenuOpen || selectedSkill
                    ? "bg-blue-50 text-blue-700"
                    : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground",
                )}
                aria-expanded={skillMenuOpen}
              >
                <BookOpen className="h-4 w-4" />
                Skills
              </button>

              {skillMenuOpen ? (
                <div className="absolute bottom-11 left-0 z-40 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-neutral-200 bg-white text-left text-neutral-950 shadow-2xl dark:border-border dark:bg-card dark:text-foreground">
                  <div className="border-b border-neutral-100 px-3 py-2 dark:border-border">
                    <div className="text-sm font-semibold">Skills</div>
                    <div className="mt-1 text-xs text-neutral-500">选择一个创意处理方式。</div>
                  </div>
                  <div className="flex gap-1 overflow-x-auto border-b border-neutral-100 px-2 py-2 dark:border-border">
                    {skillCategories.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => setActiveSkillCategory(category.id)}
                        className={cn(
                          "h-8 shrink-0 rounded-full px-3 text-xs font-medium transition",
                          activeSkillCategory === category.id
                            ? "bg-neutral-950 text-white dark:bg-primary dark:text-primary-foreground"
                            : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950 dark:hover:bg-accent dark:hover:text-foreground",
                        )}
                      >
                        {category.label}
                      </button>
                    ))}
                  </div>
                  <div className="max-h-72 overflow-y-auto p-2">
                    {visibleSkills.map((skill) => {
                      const selected = selectedSkill?.id === skill.id;
                      return (
                        <button
                          key={skill.id}
                          type="button"
                          onClick={() => chooseSkill(skill)}
                          className={cn(
                            "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition",
                            selected ? "bg-blue-50 text-blue-700" : "hover:bg-neutral-50 dark:hover:bg-accent",
                          )}
                        >
                          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
                          <span className="min-w-0">
                            <span className="block text-sm font-medium">{skill.title}</span>
                            <span className="mt-1 block text-xs leading-5 text-neutral-500">
                              {skill.description}
                            </span>
                          </span>
                          {selected ? <Check className="ml-auto h-4 w-4 shrink-0" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setModeMenuOpen((open) => !open);
                  setSkillMenuOpen(false);
                  setModelMenuOpen(false);
                }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm transition",
                  modeMenuOpen
                    ? "bg-neutral-950 text-white"
                    : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground",
                )}
                aria-expanded={modeMenuOpen}
              >
                <ActiveModeIcon className="h-4 w-4" />
                {activeMode.label}
                <ChevronDown className="h-3.5 w-3.5" />
              </button>

              {modeMenuOpen ? (
                <div className="absolute bottom-11 left-0 z-40 w-64 rounded-2xl border border-neutral-200 bg-white p-2 text-sm text-neutral-950 shadow-2xl dark:border-border dark:bg-card dark:text-foreground">
                  {composerModes.map((mode) => {
                    const Icon = mode.icon;
                    const selected = composerMode === mode.value;
                    return (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={() => {
                          setComposerMode(mode.value);
                          setModeMenuOpen(false);
                          if (mode.value !== "agent") setSelectedSkill(null);
                        }}
                        className="flex w-full items-start justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-neutral-50 dark:hover:bg-accent"
                      >
                        <span className="flex min-w-0 gap-3">
                          <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>
                            <span className="block font-medium">{mode.label}</span>
                            <span className="mt-1 block text-xs leading-5 text-neutral-500">
                              {mode.description}
                            </span>
                          </span>
                        </span>
                        {selected ? <Check className="h-4 w-4 shrink-0" /> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <button
              type="button"
              onClick={() => setThinkingModeEnabled((enabled) => !enabled)}
              aria-pressed={thinkingModeEnabled}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm transition",
                thinkingModeEnabled
                  ? "bg-neutral-950 text-white"
                  : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground",
              )}
              title="思考模式"
            >
              <Lightbulb className="h-4 w-4" />
              {thinkingModeEnabled ? "深度思考" : "思考"}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setModelMenuOpen((open) => !open);
                  setSkillMenuOpen(false);
                  setModeMenuOpen(false);
                }}
                disabled={models.length === 0}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm transition disabled:cursor-not-allowed disabled:opacity-50",
                  modelMenuOpen
                    ? "bg-neutral-950 text-white"
                    : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground",
                )}
                aria-expanded={modelMenuOpen}
                aria-label="选择模型"
                title={`模型：${selectedModelName}`}
              >
                <Box className="h-4 w-4" />
                <span className="max-w-28 truncate">{selectedModelName}</span>
              </button>

              {modelMenuOpen ? (
                <div className="absolute bottom-11 left-0 z-40 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-neutral-200 bg-white text-left text-neutral-950 shadow-2xl dark:border-border dark:bg-card dark:text-foreground">
                  <div className="border-b border-neutral-100 px-3 py-2.5 dark:border-border">
                    <div className="text-sm font-semibold">模型选择</div>
                    <div className="mt-1 text-xs text-neutral-500">用于当前 Playground 对话。</div>
                  </div>
                  <div className="max-h-72 overflow-y-auto p-2">
                    {models.map((model) => {
                      const active = selectedModel === model.id;
                      return (
                        <button
                          key={model.id}
                          type="button"
                          onClick={() => {
                            setSelectedModel(model.id);
                            setModelMenuOpen(false);
                          }}
                          disabled={isBusy}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-55",
                            active ? "bg-blue-50 text-blue-700" : "text-neutral-800 hover:bg-neutral-50 dark:text-foreground dark:hover:bg-accent",
                          )}
                        >
                          <Box className="h-4 w-4 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{modelLabel(model)}</span>
                            <span className="block truncate text-[11px] text-neutral-500">
                              {model.provider || "Playground"}
                            </span>
                          </span>
                          {active ? <Check className="h-4 w-4 shrink-0" /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <button
            type="submit"
            disabled={!canUsePlayground || isBusy || !input.trim()}
            className="ml-auto inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-neutral-950 text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-neutral-200 disabled:text-neutral-400 dark:bg-primary dark:text-primary-foreground"
            aria-label="发送"
          >
            {sending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </form>
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
