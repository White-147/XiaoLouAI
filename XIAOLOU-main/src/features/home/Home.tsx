import {
  ArrowRight,
  AudioLines,
  Bot,
  Box,
  BookOpen,
  Brush,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Check,
  Clock,
  Film,
  Globe2,
  ImageIcon,
  LayoutTemplate,
  Lightbulb,
  LoaderCircle,
  MonitorPlay,
  Paperclip,
  Plus,
  Send,
  Sparkles,
  Wand2,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  ChangeEvent,
  type CSSProperties,
  FormEvent,
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "react-router-dom";
import {
  SKILL_CATEGORIES as HOME_SKILL_CATEGORIES,
  SKILLS as HOME_SKILLS,
  type AgentCanvasSkill,
} from "../canvas-agent-canvas/agent-canvas/runtime/config/agentCanvasSkills";
import { CANVAS_IMAGE_MODELS } from "../canvas-agent-canvas/agent-canvas/runtime/config/canvasImageModels";
import { XIAOLOU_IMAGE_TO_VIDEO_MODELS } from "../canvas-agent-canvas/agent-canvas/runtime/config/canvasVideoModels";
import { getCurrentActorId, useActorId } from "../../lib/actor-session";
import {
  getMe,
  getToolboxCapabilities,
  listAgentCanvasProjects,
  listPlaygroundModels,
  listWallets,
  startPlaygroundChatJob,
  type AgentCanvasProjectSummary,
  type PermissionContext,
  type PlaygroundModel,
  type ToolboxCapability,
  type Wallet as WalletInfo,
} from "../../lib/api";
import { cn } from "../../lib/utils";
import { preloadPlaygroundPage } from "./nav-layout/routePrefetch";

const HomeScriptBreakdownTool = lazy(() => import("../toolbox/script-breakdown/ScriptBreakdown"));
const HomeVideoReplaceTool = lazy(() => import("../toolbox/video-replace/VideoReplace"));
const HomeVideoReverseTool = lazy(() => import("../toolbox/video-reverse/VideoReverse"));
const HomeStoryboardGrid25Tool = lazy(() => import("../toolbox/storyboard-25/StoryboardGrid25"));
const HomeWalletRecharge = lazy(
  () => import("../wallet-payments-api-center/wallet-recharge/WalletRecharge"),
);

const TOOLBOX_LOCAL_OVERRIDES: Partial<
  Record<string, Partial<Pick<ToolboxCapability, "name" | "description" | "status">>>
> = {
  video_character_replace: {
    name: "剧本拆解提示词",
    description: "输入剧本或故事大纲，AI 自动拆解为分镜级别的文生视频提示词。",
  },
  character_replace: {
    name: "人物替换",
    description: "在保留镜头构图的前提下替换主角身份、服装与角色特征。",
  },
  motion_transfer: {
    status: "coming_soon",
    description: "把参考动作迁移到指定角色或现有镜头视频，能力正在接入。",
  },
  upscale_restore: {
    name: "视频反推提示词",
    description: "对已有视频逐帧分析，反推出可复现镜头的文生视频提示词。",
  },
  storyboard_25: {
    name: "25 格分镜",
    description: "上传角色参考图并描述剧情，快速生成 25 宫格分镜和对应提示词。",
  },
};

const EXTRA_FRONTEND_ONLY_TOOLS: ToolboxCapability[] = [
  {
    code: "storyboard_25",
    name: "25 格分镜",
    status: "mock_ready",
    queue: "image-gpu",
    description: "上传角色参考图并描述剧情，快速生成 25 宫格分镜和对应提示词。",
  },
];

function clearAgentCanvasDraftSession(actorId: string | null | undefined) {
  try {
    const normalizedActorId = typeof actorId === "string" && actorId.trim() ? actorId.trim() : null;
    const sessionScope = normalizedActorId || "guest";
    const draftScope = normalizedActorId || "default";
    window.localStorage.removeItem(`xiaolou:agent-canvas-session-project:${sessionScope}`);
    window.localStorage.removeItem(`xiaolou:agent-canvas:draft:${draftScope}`);
  } catch {
    // Local storage can be unavailable in restricted environments.
  }
}

const DEFAULT_TOOLBOX_CAPABILITIES: ToolboxCapability[] = [
  {
    code: "video_character_replace",
    name: "剧本拆解提示词",
    status: "mock_ready",
    queue: "video-gpu",
    description: "输入剧本或故事大纲，AI 自动拆解为分镜级别的文生视频提示词。",
  },
  {
    code: "character_replace",
    name: "人物替换",
    status: "mock_ready",
    queue: "image-gpu",
    description: "在保留镜头构图的前提下替换主角身份、服装与角色特征。",
  },
  {
    code: "motion_transfer",
    name: "动作迁移",
    status: "coming_soon",
    queue: "video-gpu",
    description: "把参考动作迁移到指定角色或现有镜头视频，能力正在接入。",
  },
  {
    code: "upscale_restore",
    name: "视频反推提示词",
    status: "mock_ready",
    queue: "image-cpu",
    description: "对已有视频逐帧分析，反推出可复现镜头的文生视频提示词。",
  },
  {
    code: "storyboard_25",
    name: "25 格分镜",
    status: "mock_ready",
    queue: "image-gpu",
    description: "上传角色参考图并描述剧情，快速生成 25 宫格分镜和对应提示词。",
  },
  {
    code: "toolbox_reserved",
    name: "待开发能力",
    status: "placeholder",
    queue: "unassigned",
    description: "预留未来工具箱能力入口，例如表情迁移、镜头扩图和局部重绘。",
  },
];

const TOOLBOX_CACHE_KEY_PREFIX = "xiaolou.home.toolbox-capabilities.v4";
const TOOLBOX_ORDER = [
  "video_character_replace",
  "character_replace",
  "upscale_restore",
  "storyboard_25",
  "motion_transfer",
  "toolbox_reserved",
] as const;

const TOOL_VISUALS: Record<string, { icon: LucideIcon; tone: string; route?: string }> = {
  video_character_replace: {
    icon: Film,
    tone: "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300",
    route: "/create/script-breakdown",
  },
  character_replace: {
    icon: ImageIcon,
    tone: "bg-cyan-500/10 text-cyan-700 ring-cyan-500/20 dark:text-cyan-300",
    route: "/create/video-replace",
  },
  upscale_restore: {
    icon: MonitorPlay,
    tone: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300",
    route: "/create/video-reverse",
  },
  storyboard_25: {
    icon: LayoutTemplate,
    tone: "bg-amber-500/12 text-amber-700 ring-amber-500/20 dark:text-amber-300",
    route: "/create/storyboard-25",
  },
  motion_transfer: {
    icon: Wand2,
    tone: "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300",
  },
};

function applyLocalOverrides(tools: ToolboxCapability[]): ToolboxCapability[] {
  const base = tools.map((tool) => ({
    ...tool,
    ...(TOOLBOX_LOCAL_OVERRIDES[tool.code] ?? {}),
  }));
  const existing = new Set(base.map((tool) => tool.code));

  for (const extra of EXTRA_FRONTEND_ONLY_TOOLS) {
    if (!existing.has(extra.code)) {
      base.push({
        ...extra,
        ...(TOOLBOX_LOCAL_OVERRIDES[extra.code] ?? {}),
      });
    }
  }

  const orderIndex = (code: string) => {
    const index = TOOLBOX_ORDER.indexOf(code as (typeof TOOLBOX_ORDER)[number]);
    return index === -1 ? TOOLBOX_ORDER.length + 1 : index;
  };

  return base.sort((left, right) => orderIndex(left.code) - orderIndex(right.code));
}

function getToolboxCacheKey(actorId: string) {
  return `${TOOLBOX_CACHE_KEY_PREFIX}:${actorId || "guest"}`;
}

function readCachedToolboxCapabilities(actorId: string) {
  if (typeof window === "undefined") return [] as ToolboxCapability[];

  try {
    const raw = window.localStorage.getItem(getToolboxCacheKey(actorId));
    if (!raw) return [] as ToolboxCapability[];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [] as ToolboxCapability[];
    return parsed.filter(
      (item): item is ToolboxCapability =>
        !!item &&
        typeof item === "object" &&
        typeof item.code === "string" &&
        typeof item.name === "string" &&
        typeof item.status === "string" &&
        typeof item.queue === "string" &&
        typeof item.description === "string",
    );
  } catch {
    return [] as ToolboxCapability[];
  }
}

function getInitialToolboxCapabilities(actorId: string) {
  const cached = readCachedToolboxCapabilities(actorId);
  return applyLocalOverrides(cached.length ? cached : DEFAULT_TOOLBOX_CAPABILITIES);
}

function writeCachedToolboxCapabilities(actorId: string, tools: ToolboxCapability[]) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(getToolboxCacheKey(actorId), JSON.stringify(tools));
  } catch {
    // Cache failures should never block the live homepage.
  }
}

function resolveVisibleWallets(wallets: WalletInfo[], me: PermissionContext | null) {
  if (!me || !wallets.length) return wallets;
  const isEnterprise =
    me.currentOrganizationRole === "enterprise_admin" ||
    me.currentOrganizationRole === "enterprise_member";
  if (isEnterprise) {
    const orgWallets = wallets.filter((wallet) => wallet.ownerType === "organization");
    return orgWallets.length ? orgWallets : wallets;
  }
  return wallets.filter((wallet) => wallet.ownerType !== "organization");
}

function formatCredits(value: number | null | undefined, unlimited?: boolean) {
  if (unlimited) return "无限";
  if (typeof value !== "number") return "80";
  return value.toLocaleString("zh-CN");
}

function formatAttachmentSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  const megabytes = bytes / 1024 / 1024;
  return `${megabytes >= 10 ? megabytes.toFixed(0) : megabytes.toFixed(1)} MB`;
}

function canReadHomeAttachmentAsText(file: File) {
  const lowerName = file.name.toLowerCase();
  return (
    file.type.startsWith("text/") ||
    file.type === "application/json" ||
    HOME_TEXT_ATTACHMENT_EXTENSIONS.some((extension) => lowerName.endsWith(extension))
  );
}

function formatCanvasDate(value: string | null | undefined) {
  if (!value) return "刚刚更新";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "刚刚更新";
  return `更新于 ${new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)}`;
}

function getCanvasProjectMetric(
  project: AgentCanvasProjectSummary,
  key: "nodeCount" | "messageCount",
) {
  const value = (project as AgentCanvasProjectSummary & Partial<Record<typeof key, number>>)[key];
  return typeof value === "number" ? value : null;
}

function toolStatusLabel(status: string) {
  if (status === "mock_ready") return "已接入";
  if (status === "placeholder") return "待接入";
  if (status === "coming_soon") return "待开发";
  return status;
}

function isToolLocked(status: string) {
  return status === "placeholder" || status === "coming_soon";
}

function getToolVisual(tool: ToolboxCapability) {
  return TOOL_VISUALS[tool.code] ?? {
    icon: Sparkles,
    tone: "bg-primary/10 text-primary ring-primary/20",
  };
}

type HomeModelPreferenceTab = "cot" | "image" | "video" | "3d";
type HomeMediaModelPreferenceTab = Exclude<HomeModelPreferenceTab, "cot">;

type HomeModelLogoInput = {
  id?: string;
  name?: string;
  label?: string;
  provider?: string;
};

type OfficialModelLogoMeta = {
  kind: "qwen" | "gemini";
  src: string;
  layout: "wordmark" | "glyph";
};

type HomeModelPreferenceOption = {
  id: string;
  label: string;
  description: string;
  provider?: string;
  icon: LucideIcon;
  timeLabel?: string;
};

type HomeAttachment = {
  id: string;
  name: string;
  size: number;
  type: string;
  content?: string;
  contentTruncated?: boolean;
};

type HomePromptTransitionBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type HomePromptTransitionSnapshot = {
  message: string;
  skillTitle: string | null;
  attachmentsCount: number;
  modelName: string;
  durationMs: number;
  from: HomePromptTransitionBox;
  to: HomePromptTransitionBox;
};

const HOME_TEXT_ATTACHMENT_MAX_CHARS = 12000;
const HOME_TEXT_ATTACHMENT_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".tsv",
  ".xml",
  ".yaml",
  ".yml",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".css",
  ".html",
];

const HOME_MODEL_PREFERENCE_TABS: Array<{ value: HomeModelPreferenceTab; label: string }> = [
  { value: "cot", label: "CoT" },
  { value: "image", label: "Image" },
  { value: "video", label: "Video" },
  { value: "3d", label: "3D" },
];

const HOME_TO_PLAYGROUND_TRANSITION_MS = 780;

const OFFICIAL_MODEL_LOGOS: Record<OfficialModelLogoMeta["kind"], OfficialModelLogoMeta> = {
  qwen: {
    kind: "qwen",
    src: "https://img.alicdn.com/imgextra/i2/O1CN01g0dCMZ261m1aU7qlI_!!6000000007602-55-tps-104-28.svg",
    layout: "wordmark",
  },
  gemini: {
    kind: "gemini",
    src: "https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg",
    layout: "glyph",
  },
};

function getOfficialModelLogo(model: HomeModelLogoInput) {
  const identity = `${model.id ?? ""} ${model.name ?? ""} ${model.label ?? ""} ${model.provider ?? ""}`.toLowerCase();
  if (identity.includes("qwen")) return OFFICIAL_MODEL_LOGOS.qwen;
  if (identity.includes("gemini")) return OFFICIAL_MODEL_LOGOS.gemini;
  return null;
}

function OfficialModelLogo({
  logo,
  variant,
  className,
}: {
  logo: OfficialModelLogoMeta;
  variant: "chip" | "menu";
  className?: string;
}) {
  return (
    <img
      src={logo.src}
      alt=""
      aria-hidden="true"
      data-model-logo={logo.kind}
      loading="lazy"
      decoding="async"
      className={cn(
        "block shrink-0 object-contain",
        logo.layout === "wordmark"
          ? "h-3.5 w-[52px]"
          : variant === "menu"
            ? "h-4 w-4"
            : "h-3.5 w-3.5",
        className,
      )}
    />
  );
}

function homeMediaModelDescription(kind: "image" | "video", label: string) {
  if (kind === "image") {
    if (label.includes("Gemini")) return "小楼 Vertex / Gemini 图像生成能力。";
    if (label.includes("Seedream")) return "豆包图像生成，适合高质量创意图。";
    if (label.includes("Kling")) return "可灵图像生成工具。";
    return "图像生成工具。";
  }

  if (label.includes("Seedance")) return "ByteDance 视频模型，适合图生视频和创意短片。";
  if (label.includes("Veo")) return "Google Veo 视频模型，适合高质量视频生成。";
  if (label.includes("PixVerse")) return "PixVerse 视频模型，适合快速生成视频。";
  if (label.includes("Kling") || label.includes("kling")) return "可灵视频模型，适合多图和元素视频生成。";
  return "视频生成工具。";
}

function homeMediaModelTime(kind: "image" | "video", label: string) {
  if (kind === "image") return "30s";
  if (label.includes("Fast")) return "200s";
  if (label.includes("Veo")) return "180s";
  return "300s";
}

const HOME_MEDIA_MODEL_OPTIONS: Record<HomeMediaModelPreferenceTab, HomeModelPreferenceOption[]> = {
  image: CANVAS_IMAGE_MODELS
    .filter((model) => !model.hiddenUnlessConfigured)
    .map((model) => ({
      id: model.id,
      label: model.name,
      description: homeMediaModelDescription("image", model.name),
      provider: model.provider,
      icon: ImageIcon,
      timeLabel: homeMediaModelTime("image", model.name),
    })),
  video: XIAOLOU_IMAGE_TO_VIDEO_MODELS.map((model) => ({
    id: model.id,
    label: model.name,
    description: homeMediaModelDescription("video", model.name),
    provider: model.provider,
    icon: Film,
    timeLabel: homeMediaModelTime("video", model.name),
  })),
  "3d": [],
};

function isMediaModelPreferenceTab(tab: HomeModelPreferenceTab): tab is HomeMediaModelPreferenceTab {
  return tab !== "cot";
}

function getDefaultHomeMediaModelIds(tab: HomeMediaModelPreferenceTab) {
  return HOME_MEDIA_MODEL_OPTIONS[tab].slice(0, 1).map((option) => option.id);
}

function normalizeHomeSelectedModelIds(
  selectedIds: string[],
  options: Array<{ id: string }>,
  fallbackIds: string[] = [],
) {
  const optionIds = new Set(options.map((option) => option.id));
  const kept = Array.from(new Set(selectedIds)).filter((id) => optionIds.has(id));
  if (kept.length) return kept;

  const fallback = fallbackIds.filter((id) => optionIds.has(id));
  if (fallback.length) return fallback;

  return options.slice(0, 1).map((option) => option.id);
}

function toggleHomeSelectedModelId(selectedIds: string[], id: string) {
  if (!id) return selectedIds;
  const selected = new Set(selectedIds);
  if (selected.has(id)) {
    if (selected.size <= 1) return selectedIds;
    selected.delete(id);
  } else {
    selected.add(id);
  }
  return Array.from(selected);
}

function areHomeSelectedModelIdsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((id) => rightSet.has(id));
}

function homeModelDisplayName(model: PlaygroundModel) {
  const id = model.id.toLowerCase();
  const name = model.name || model.id;
  if (id.includes("qwen-plus")) return "Qwen3.6-Plus";
  if (id.includes("gemini")) return "Gemini 3";
  return name;
}

function homeModelDescription(model: PlaygroundModel) {
  const id = model.id.toLowerCase();
  if (id.includes("qwen-plus")) {
    return "文本推理与长任务规划模型，适合复杂 Agent 步骤拆解。";
  }
  if (id.includes("qwen-max")) {
    return "更强的创意生成与上下文推理模型，适合脚本润色和方案扩写。";
  }
  if (id.includes("gemini")) {
    return "多模态上下文理解模型，适合快速规划和多信息整合。";
  }
  return model.provider
    ? `${model.provider} 模型，适合首页创意对话和任务拆解。`
    : "适合首页创意对话、任务拆解和制作方向规划。";
}

function waitForHomeTransition(durationMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, durationMs);
  });
}

function createHomePromptTransitionSnapshot({
  composer,
  message,
  skillTitle,
  attachmentsCount,
  modelName,
}: {
  composer: HTMLElement | null;
  message: string;
  skillTitle: string | null;
  attachmentsCount: number;
  modelName: string;
}): HomePromptTransitionSnapshot | null {
  if (!composer || typeof window === "undefined") return null;

  const sourceRect = composer.getBoundingClientRect();
  const mainRect = composer.closest("main")?.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const contentLeft = mainRect?.left ?? 0;
  const contentWidth = mainRect?.width ?? viewportWidth;
  const horizontalInset = viewportWidth < 640 ? 24 : 40;
  const bottomGap = viewportWidth < 640 ? 12 : 16;
  const targetWidth = Math.min(768, Math.max(280, contentWidth - horizontalInset));
  const targetHeight = Math.min(
    Math.max(sourceRect.height, 126),
    Math.max(126, viewportHeight - bottomGap * 2),
  );

  return {
    message,
    skillTitle,
    attachmentsCount,
    modelName,
    durationMs: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? 120
      : HOME_TO_PLAYGROUND_TRANSITION_MS,
    from: {
      x: sourceRect.left,
      y: sourceRect.top,
      width: sourceRect.width,
      height: sourceRect.height,
    },
    to: {
      x: contentLeft + Math.max(0, (contentWidth - targetWidth) / 2),
      y: Math.max(bottomGap, viewportHeight - bottomGap - targetHeight),
      width: targetWidth,
      height: targetHeight,
    },
  };
}

function HomePromptTransitionOverlay({
  snapshot,
}: {
  snapshot: HomePromptTransitionSnapshot | null;
}) {
  if (!snapshot) return null;

  const style = {
    "--home-transition-from-x": `${snapshot.from.x}px`,
    "--home-transition-from-y": `${snapshot.from.y}px`,
    "--home-transition-from-width": `${snapshot.from.width}px`,
    "--home-transition-from-height": `${snapshot.from.height}px`,
    "--home-transition-to-x": `${snapshot.to.x}px`,
    "--home-transition-to-y": `${snapshot.to.y}px`,
    "--home-transition-to-width": `${snapshot.to.width}px`,
    "--home-transition-to-height": `${snapshot.to.height}px`,
    "--home-transition-duration": `${snapshot.durationMs}ms`,
  } as CSSProperties;

  return (
    <div className="home-playground-transition-layer" aria-hidden="true">
      <div className="home-playground-transition-card" style={style}>
        <div className="flex min-h-full flex-col rounded-[22px] border border-neutral-200 bg-white px-3 pb-3 pt-3 shadow-[0_30px_80px_rgba(15,23,42,0.22)] dark:border-border dark:bg-card">
          {snapshot.skillTitle ? (
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 dark:border-blue-400/30 dark:bg-blue-500/15 dark:text-blue-200">
                <BookOpen className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{snapshot.skillTitle}</span>
              </span>
            </div>
          ) : null}
          <div className="line-clamp-2 min-h-[72px] px-1 text-left text-sm leading-6 text-neutral-950 dark:text-foreground">
            {snapshot.message}
          </div>
          <div className="mt-auto flex items-center justify-between gap-2 pt-2">
            <div className="flex min-w-0 items-center gap-1.5 text-neutral-600 dark:text-muted-foreground">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-neutral-100 dark:bg-accent">
                <Plus className="h-4 w-4" />
              </span>
              <span className="hidden h-8 items-center gap-1 rounded-xl px-2.5 text-sm sm:flex">
                <BookOpen className="h-3.5 w-3.5" />
                Skills
              </span>
              <span className="flex h-8 items-center gap-1 rounded-xl px-2.5 text-sm">
                <Bot className="h-3.5 w-3.5" />
                Agent
              </span>
              {snapshot.attachmentsCount ? (
                <span className="rounded-full bg-neutral-100 px-2 py-1 text-xs dark:bg-accent">
                  {snapshot.attachmentsCount} 个附件
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5">
              <span className="hidden max-w-36 truncate rounded-full bg-neutral-100 px-2 py-1 text-xs text-neutral-500 dark:bg-accent dark:text-muted-foreground sm:inline">
                {snapshot.modelName}
              </span>
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-950 text-white shadow-sm dark:bg-foreground dark:text-background">
                <Send className="h-4 w-4" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const actorId = useActorId();
  const [me, setMe] = useState<PermissionContext | null>(null);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [tools, setTools] = useState<ToolboxCapability[]>(() =>
    getInitialToolboxCapabilities(getCurrentActorId()),
  );
  const [canvasProjects, setCanvasProjects] = useState<AgentCanvasProjectSummary[]>([]);
  const [models, setModels] = useState<PlaygroundModel[]>([]);
  const [selectedModel, setSelectedModel] = useState("qwen-plus");
  const [selectedModelPoolIds, setSelectedModelPoolIds] = useState<string[]>(["qwen-plus"]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [homeMoreMenuOpen, setHomeMoreMenuOpen] = useState(false);
  const [homeSkillMenuOpen, setHomeSkillMenuOpen] = useState(false);
  const [homeSelectedSkill, setHomeSelectedSkill] = useState<AgentCanvasSkill | null>(null);
  const [homeActiveSkillCategory, setHomeActiveSkillCategory] = useState(
    HOME_SKILL_CATEGORIES[0]?.id || "script",
  );
  const [homeWebSearchEnabled, setHomeWebSearchEnabled] = useState(false);
  const [homeThinkingModeEnabled, setHomeThinkingModeEnabled] = useState(false);
  const [homeAttachments, setHomeAttachments] = useState<HomeAttachment[]>([]);
  const [autoModelPreference, setAutoModelPreference] = useState(true);
  const [rechargeModalOpen, setRechargeModalOpen] = useState(false);
  const [rechargeCurtainOrigin, setRechargeCurtainOrigin] = useState({ x: 0, y: 0 });
  const [activeToolModal, setActiveToolModal] = useState<ToolboxCapability | null>(null);
  const [toolModalOrigin, setToolModalOrigin] = useState({ x: 0, y: 0 });
  const [modelPreferenceTab, setModelPreferenceTab] =
    useState<HomeModelPreferenceTab>("cot");
  const [selectedMediaModelIds, setSelectedMediaModelIds] = useState<
    Record<HomeMediaModelPreferenceTab, string[]>
  >({
    image: getDefaultHomeMediaModelIds("image"),
    video: getDefaultHomeMediaModelIds("video"),
    "3d": [],
  });
  const [prompt, setPrompt] = useState("");
  const [promptSending, setPromptSending] = useState(false);
  const [homePromptTransition, setHomePromptTransition] =
    useState<HomePromptTransitionSnapshot | null>(null);
  const [toolboxLoading, setToolboxLoading] = useState(true);
  const [canvasLoading, setCanvasLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(true);
  const [dashboardIssues, setDashboardIssues] = useState({
    me: false,
    wallets: false,
    tools: false,
    canvas: false,
    playground: false,
    toolsUsingCache: false,
  });
  const dashboardRequestRef = useRef(0);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);
  const homeMoreMenuRef = useRef<HTMLDivElement | null>(null);
  const homeSkillMenuRef = useRef<HTMLDivElement | null>(null);
  const homeFileInputRef = useRef<HTMLInputElement | null>(null);
  const homeComposerRef = useRef<HTMLDivElement | null>(null);
  const canvasCarouselRef = useRef<HTMLDivElement | null>(null);

  const primaryWallet = useMemo(() => {
    const list = resolveVisibleWallets(wallets, me);
    return list[0] ?? null;
  }, [wallets, me]);

  const visibleCanvasProjects = useMemo(
    () => canvasProjects.slice(0, 4),
    [canvasProjects],
  );

  const modelOptions = useMemo<PlaygroundModel[]>(() => {
    const configured = models.filter((model) => model.configured !== false);
    if (configured.length) return configured;
    if (models.length) return models;
    return [
      {
        id: "qwen-plus",
        name: "Qwen Plus",
        provider: "qwen",
        configured: true,
        default: true,
      },
    ];
  }, [models]);

  const activeModels = useMemo(() => modelOptions.slice(0, 4), [modelOptions]);
  const defaultHomeTextModelId = useMemo(
    () => modelOptions.find((model) => model.default)?.id || modelOptions[0]?.id || "qwen-plus",
    [modelOptions],
  );

  const selectedModelName = useMemo(
    () => {
      const selectedNames = selectedModelPoolIds
        .map((id) => {
          const selected = modelOptions.find((model) => model.id === id);
          return selected ? homeModelDisplayName(selected) : id;
        })
        .filter(Boolean);
      if (selectedNames.length > 1) return `${selectedNames[0]} +${selectedNames.length - 1}`;
      return selectedNames[0] || selectedModel;
    },
    [modelOptions, selectedModel, selectedModelPoolIds],
  );

  const homeVisibleSkills = useMemo(
    () => HOME_SKILLS.filter((skill) => skill.category === homeActiveSkillCategory),
    [homeActiveSkillCategory],
  );

  const homeActiveSkillCategoryLabel = useMemo(
    () =>
      HOME_SKILL_CATEGORIES.find((category) => category.id === homeActiveSkillCategory)?.label ||
      "Skills",
    [homeActiveSkillCategory],
  );

  const modelPreferenceOptions = useMemo<HomeModelPreferenceOption[]>(() => {
    if (modelPreferenceTab === "cot") {
      return modelOptions.map((model) => ({
        id: model.id,
        label: homeModelDisplayName(model),
        description: homeModelDescription(model),
        provider: model.provider,
        icon: Box,
      }));
    }
    return HOME_MEDIA_MODEL_OPTIONS[modelPreferenceTab];
  }, [modelOptions, modelPreferenceTab]);

  useEffect(() => {
    const nextPool = normalizeHomeSelectedModelIds(
      selectedModelPoolIds,
      modelOptions,
      [defaultHomeTextModelId],
    );
    if (!areHomeSelectedModelIdsEqual(selectedModelPoolIds, nextPool)) {
      setSelectedModelPoolIds(nextPool);
    }
    if (!nextPool.includes(selectedModel)) {
      setSelectedModel(nextPool[0] || defaultHomeTextModelId);
    }
  }, [defaultHomeTextModelId, modelOptions, selectedModel, selectedModelPoolIds]);

  const visibleToolboxTools = useMemo(
    () => (tools.length ? tools : DEFAULT_TOOLBOX_CAPABILITIES).slice(0, 6),
    [tools],
  );
  const readyToolCount = useMemo(
    () => visibleToolboxTools.filter((tool) => !isToolLocked(tool.status)).length,
    [visibleToolboxTools],
  );
  const selectedModelCountLabel =
    selectedModelPoolIds.length > 1 ? `${selectedModelPoolIds.length} 个文本模型` : selectedModelName;
  const canvasProjectCountLabel = canvasProjects.length
    ? `${canvasProjects.length} 个画布项目`
    : "画布随时新建";
  const rechargeCurtainStyle = useMemo(
    () =>
      ({
        "--recharge-origin-x": `${rechargeCurtainOrigin.x}px`,
        "--recharge-origin-y": `${rechargeCurtainOrigin.y}px`,
      }) as CSSProperties,
    [rechargeCurtainOrigin],
  );
  const toolCurtainStyle = useMemo(
    () =>
      ({
        "--recharge-origin-x": `${toolModalOrigin.x}px`,
        "--recharge-origin-y": `${toolModalOrigin.y}px`,
      }) as CSSProperties,
    [toolModalOrigin],
  );

  const dashboardNotice = useMemo(() => {
    const notices: string[] = [];
    if (dashboardIssues.me) notices.push("账户上下文加载失败");
    if (dashboardIssues.wallets) notices.push("钱包服务暂时不可用");
    if (dashboardIssues.tools) {
      notices.push(
        dashboardIssues.toolsUsingCache
          ? "工具箱能力加载失败，已使用缓存"
          : "工具箱能力加载失败",
      );
    }
    if (dashboardIssues.canvas) notices.push("智能画布项目暂时不可用");
    if (dashboardIssues.playground) notices.push("Playground 模型加载失败");
    return notices.length ? `${notices.join("，")}。其余内容已继续显示。` : null;
  }, [dashboardIssues]);

  const loadDashboard = async () => {
    const requestId = ++dashboardRequestRef.current;
    const cachedTools = readCachedToolboxCapabilities(actorId);
    const initialTools = cachedTools.length ? cachedTools : DEFAULT_TOOLBOX_CAPABILITIES;

    setRefreshing(true);
    setToolboxLoading(true);
    setCanvasLoading(true);
    setTools(applyLocalOverrides(initialTools));
    setDashboardIssues({
      me: false,
      wallets: false,
      tools: false,
      canvas: false,
      playground: false,
      toolsUsingCache: false,
    });

    const commitIfCurrent = (callback: () => void) => {
      if (dashboardRequestRef.current !== requestId) return false;
      callback();
      return true;
    };

    const mePromise = getMe()
      .then((value) => {
        commitIfCurrent(() => {
          setMe(value);
          setDashboardIssues((prev) => ({ ...prev, me: false }));
        });
        return value;
      })
      .catch(() => {
        commitIfCurrent(() => {
          setMe(null);
          setDashboardIssues((prev) => ({ ...prev, me: true }));
        });
        return null;
      });

    const walletsPromise = listWallets()
      .then((value) => {
        commitIfCurrent(() => {
          setWallets(value.items);
          setDashboardIssues((prev) => ({ ...prev, wallets: false }));
        });
      })
      .catch(() => {
        commitIfCurrent(() => {
          setWallets([]);
          setDashboardIssues((prev) => ({ ...prev, wallets: true }));
        });
      });

    const toolsPromise = getToolboxCapabilities()
      .then((value) => {
        const merged = applyLocalOverrides(value.items);
        commitIfCurrent(() => {
          setTools(merged);
          setToolboxLoading(false);
          writeCachedToolboxCapabilities(actorId, merged);
          setDashboardIssues((prev) => ({
            ...prev,
            tools: false,
            toolsUsingCache: false,
          }));
        });
      })
      .catch(() => {
        const fallbackTools = cachedTools.length
          ? cachedTools
          : readCachedToolboxCapabilities(actorId);
        const resolvedFallbackTools = applyLocalOverrides(
          fallbackTools.length ? fallbackTools : DEFAULT_TOOLBOX_CAPABILITIES,
        );
        commitIfCurrent(() => {
          setTools(resolvedFallbackTools);
          setToolboxLoading(false);
          setDashboardIssues((prev) => ({
            ...prev,
            tools: true,
            toolsUsingCache: fallbackTools.length > 0,
          }));
        });
      });

    const canvasPromise = mePromise
      .then((context) => {
        if (!context || context.platformRole === "guest") {
          commitIfCurrent(() => {
            setCanvasProjects([]);
            setCanvasLoading(false);
            setDashboardIssues((prev) => ({ ...prev, canvas: false }));
          });
          return null;
        }
        return listAgentCanvasProjects().then((value) => {
          commitIfCurrent(() => {
            setCanvasProjects(value.items);
            setCanvasLoading(false);
            setDashboardIssues((prev) => ({ ...prev, canvas: false }));
          });
        });
      })
      .catch(() => {
        commitIfCurrent(() => {
          setCanvasProjects([]);
          setCanvasLoading(false);
          setDashboardIssues((prev) => ({ ...prev, canvas: true }));
        });
      });

    const modelsPromise = listPlaygroundModels()
      .then((value) => {
        commitIfCurrent(() => {
          setModels(value.items);
          setSelectedModel((current) => {
            if (current && value.items.some((item) => item.id === current)) return current;
            return value.defaultModel || value.items[0]?.id || "qwen-plus";
          });
          setDashboardIssues((prev) => ({ ...prev, playground: false }));
        });
      })
      .catch(() => {
        commitIfCurrent(() => {
          setModels([]);
          setDashboardIssues((prev) => ({ ...prev, playground: true }));
        });
      });

    await Promise.allSettled([
      mePromise,
      walletsPromise,
      toolsPromise,
      canvasPromise,
      modelsPromise,
    ]);

    if (dashboardRequestRef.current === requestId) {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void loadDashboard();
  }, [actorId]);

  useEffect(() => {
    if (!modelMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (modelMenuRef.current?.contains(event.target as Node)) return;
      setModelMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModelMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!homeMoreMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (homeMoreMenuRef.current?.contains(event.target as Node)) return;
      setHomeMoreMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHomeMoreMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [homeMoreMenuOpen]);

  useEffect(() => {
    if (!homeSkillMenuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (homeSkillMenuRef.current?.contains(event.target as Node)) return;
      setHomeSkillMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHomeSkillMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [homeSkillMenuOpen]);

  useEffect(() => {
    if (!rechargeModalOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setRechargeModalOpen(false);
        void loadDashboard();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [rechargeModalOpen]);

  useEffect(() => {
    if (!activeToolModal) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setActiveToolModal(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [activeToolModal]);

  const handleHomeFileInputChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length) {
      const batchId = Date.now();
      const nextAttachments = await Promise.all(
        files.map(async (file, index): Promise<HomeAttachment> => {
          let content: string | undefined;
          let contentTruncated = false;

          if (canReadHomeAttachmentAsText(file)) {
            try {
              const text = await file.text();
              contentTruncated = text.length > HOME_TEXT_ATTACHMENT_MAX_CHARS;
              content = text.slice(0, HOME_TEXT_ATTACHMENT_MAX_CHARS);
            } catch {
              content = undefined;
            }
          }

          return {
            id: `${batchId}-${index}-${file.name}`,
            name: file.name,
            size: file.size,
            type: file.type || "file",
            content,
            contentTruncated,
          };
        }),
      );
      setHomeAttachments((current) => [...current, ...nextAttachments]);
    }
  };

  const handlePromptSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = prompt.trim();
    if (!message || promptSending || homePromptTransition) return;

    const skillContext = homeSelectedSkill
      ? [
          `当前启用 Skill：${homeSelectedSkill.title}`,
          homeSelectedSkill.hiddenInstruction || homeSelectedSkill.prompt,
        ].join("\n")
      : "";

    const transitionSnapshot = createHomePromptTransitionSnapshot({
      composer: homeComposerRef.current,
      message,
      skillTitle: homeSelectedSkill?.title ?? null,
      attachmentsCount: homeAttachments.length,
      modelName: selectedModelName,
    });

    setPromptSending(true);
    setModelMenuOpen(false);
    setHomeMoreMenuOpen(false);
    setHomeSkillMenuOpen(false);
    preloadPlaygroundPage();
    if (transitionSnapshot) setHomePromptTransition(transitionSnapshot);

    const transitionPromise = transitionSnapshot
      ? waitForHomeTransition(transitionSnapshot.durationMs)
      : Promise.resolve();

    try {
      const chatJobPromise = startPlaygroundChatJob({
        conversationId: null,
        message,
        model: selectedModel,
        attachments: homeAttachments.map((file) => ({
          name: file.name,
          size: file.size,
          type: file.type,
          content: file.content,
          contentTruncated: file.contentTruncated,
        })),
        webSearch: homeWebSearchEnabled,
        thinkingMode: homeThinkingModeEnabled,
        mode: "agent",
        context: skillContext || undefined,
        preferredImageToolId: selectedMediaModelIds.image[0],
        allowedImageToolIds: selectedMediaModelIds.image,
      });
      const [result] = await Promise.all([chatJobPromise, transitionPromise]);
      setHomeSelectedSkill(null);
      setHomeSkillMenuOpen(false);
      const conversationId = result.conversation?.id;
      navigate(
        conversationId
          ? `/playground?conversationId=${encodeURIComponent(conversationId)}`
          : "/playground",
      );
    } catch {
      await transitionPromise;
      setHomePromptTransition(null);
      setPromptSending(false);
      window.alert("发送到 Playground 失败，请稍后重试。");
    }
  };

  const handleToolbox = (tool: ToolboxCapability, button: HTMLButtonElement) => {
    if (isToolLocked(tool.status)) return;
    const rect = button.getBoundingClientRect();
    setToolModalOrigin({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    setActiveToolModal(tool);
  };

  const openCanvasProject = (project: AgentCanvasProjectSummary) => {
    navigate(`/create/agent-canvas?agentCanvasProjectId=${encodeURIComponent(project.id)}`);
  };

  const openNewCanvas = () => {
    clearAgentCanvasDraftSession(actorId);
    navigate("/create/agent-canvas");
  };

  const scrollCanvasCarousel = (direction: "left" | "right") => {
    const carousel = canvasCarouselRef.current;
    if (!carousel) return;
    carousel.scrollBy({
      left: direction === "left" ? -carousel.clientWidth * 0.85 : carousel.clientWidth * 0.85,
      behavior: "smooth",
    });
  };

  const enableHomeAutoModelPreference = () => {
    setAutoModelPreference(true);
    setSelectedModel(defaultHomeTextModelId);
    setSelectedModelPoolIds(defaultHomeTextModelId ? [defaultHomeTextModelId] : []);
    setSelectedMediaModelIds({
      image: getDefaultHomeMediaModelIds("image"),
      video: getDefaultHomeMediaModelIds("video"),
      "3d": [],
    });
  };

  const toggleHomeAutoModelPreference = () => {
    if (autoModelPreference) {
      setAutoModelPreference(false);
    } else {
      enableHomeAutoModelPreference();
    }
  };

  const selectHomeModelPreference = (option: HomeModelPreferenceOption) => {
    setAutoModelPreference(false);
    if (modelPreferenceTab === "cot") {
      setSelectedModelPoolIds((current) => {
        const nextPool = toggleHomeSelectedModelId(current, option.id);
        if (nextPool.includes(option.id)) {
          setSelectedModel(option.id);
        } else if (!nextPool.includes(selectedModel)) {
          setSelectedModel(nextPool[0] || defaultHomeTextModelId);
        }
        return nextPool;
      });
    } else if (isMediaModelPreferenceTab(modelPreferenceTab)) {
      setSelectedMediaModelIds((current) => ({
        ...current,
        [modelPreferenceTab]: toggleHomeSelectedModelId(current[modelPreferenceTab] || [], option.id),
      }));
    }
  };

  const closeRechargeModal = () => {
    setRechargeModalOpen(false);
    void loadDashboard();
  };

  const openRechargeModalFromButton = (button: HTMLButtonElement) => {
    const rect = button.getBoundingClientRect();
    setRechargeCurtainOrigin({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
    setRechargeModalOpen(true);
  };

  const renderActiveToolModal = (tool: ToolboxCapability) => {
    if (tool.code === "video_character_replace") return <HomeScriptBreakdownTool />;
    if (tool.code === "character_replace") return <HomeVideoReplaceTool />;
    if (tool.code === "upscale_restore") return <HomeVideoReverseTool />;
    if (tool.code === "storyboard_25") return <HomeStoryboardGrid25Tool />;

    return (
      <div className="flex h-full flex-col items-center justify-center bg-background p-8 text-center">
        <Sparkles className="h-10 w-10 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold text-foreground">{tool.name}</h3>
        <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
          这个工具正在整理成卡片工作台，准备好后会直接在这里打开。
        </p>
      </div>
    );
  };

  const activeToolVisual = activeToolModal ? getToolVisual(activeToolModal) : null;
  const ActiveToolIcon = activeToolVisual?.icon ?? Sparkles;

  return (
    <div className="custom-scrollbar flex-1 overflow-y-auto bg-white text-foreground dark:bg-background">
      <HomePromptTransitionOverlay snapshot={homePromptTransition} />
      <div className="mx-auto flex min-h-full w-full max-w-[1320px] flex-col px-5 pb-12 pt-5 sm:px-8 lg:px-12">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={(event) => {
              if (me?.permissions.canRecharge) {
                openRechargeModalFromButton(event.currentTarget);
              }
            }}
            disabled={!me?.permissions.canRecharge}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-medium text-foreground shadow-sm transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Zap className="h-3.5 w-3.5 text-primary" fill="none" />
            <span>{formatCredits(primaryWallet?.creditsAvailable, primaryWallet?.unlimitedCredits)}</span>
            <span className="text-muted-foreground">升级</span>
          </button>
        </div>

        {rechargeModalOpen ? (
          <div
            className="recharge-curtain-overlay fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto bg-slate-950/15 px-4 py-8 sm:px-6"
            style={rechargeCurtainStyle}
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                closeRechargeModal();
              }
            }}
          >
            <div
              className="recharge-curtain-panel relative z-10 w-full max-w-6xl overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_32px_90px_rgba(15,23,42,0.32)] dark:border-border/70 dark:bg-background"
              role="dialog"
              aria-modal="true"
              aria-label="充值钱包"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <Suspense
                fallback={
                  <div className="flex min-h-[70vh] items-center justify-center gap-2 bg-background text-sm text-muted-foreground">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    正在打开充值中心...
                  </div>
                }
              >
                <HomeWalletRecharge
                  variant="modal"
                  onClose={closeRechargeModal}
                  onRechargeComplete={() => void loadDashboard()}
                />
              </Suspense>
            </div>
          </div>
        ) : null}

        {activeToolModal ? (
          <div
            className="recharge-curtain-overlay fixed inset-0 z-[82] flex items-start justify-center overflow-y-auto bg-slate-950/15 px-3 py-2 sm:px-5 sm:py-3"
            style={toolCurtainStyle}
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) {
                setActiveToolModal(null);
              }
            }}
          >
            <div
              className="recharge-curtain-panel relative z-10 flex h-[calc(100dvh-1rem)] w-full max-w-7xl flex-col overflow-hidden rounded-[28px] border border-white/70 bg-white shadow-[0_32px_90px_rgba(15,23,42,0.32)] dark:border-border/70 dark:bg-background sm:h-[calc(100dvh-1.5rem)]"
              role="dialog"
              aria-modal="true"
              aria-label={`${activeToolModal.name} 工具卡片`}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/70 bg-white/86 px-4 backdrop-blur-xl dark:bg-background/86 sm:px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1",
                      activeToolVisual?.tone ?? "bg-primary/10 text-primary ring-primary/20",
                    )}
                  >
                    <ActiveToolIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 text-left">
                    <div className="truncate text-sm font-semibold text-foreground">
                      {activeToolModal.name}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {activeToolModal.description}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveToolModal(null)}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label="关闭工具卡片"
                  title="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <Suspense
                  fallback={
                    <div className="flex h-full items-center justify-center gap-2 bg-background text-sm text-muted-foreground">
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                      正在打开工具卡片...
                    </div>
                  }
                >
                  {renderActiveToolModal(activeToolModal)}
                </Suspense>
              </div>
            </div>
          </div>
        ) : null}

        {dashboardNotice ? (
          <div
            className="mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200"
            role="status"
          >
            {dashboardNotice}
          </div>
        ) : null}

        <section className="flex min-h-[300px] flex-col items-center justify-center py-6 text-center sm:min-h-[360px] lg:min-h-[380px]">
          <div
            className={cn(
              "flex flex-col items-center text-center transform-gpu transition-all duration-[820ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
              homePromptTransition ? "pointer-events-none -translate-y-10 opacity-0 blur-sm" : "translate-y-0 opacity-100",
            )}
          >
            <div className="flex items-center gap-3">
              <img
                src="/chuangjing-logo-shell.png"
                alt="创境AI Logo"
                className="h-10 w-10 shrink-0 object-contain drop-shadow-[0_6px_16px_rgba(212,143,71,0.28)] sm:h-11 sm:w-11"
              />
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                创境AI 让创作更简单
              </h1>
            </div>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
              你的创意代理，帮你从一句话进入对话、工具箱和智能画布。
            </p>
            <div className="mt-4 flex max-w-3xl flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
              <span className="inline-flex h-7 items-center rounded-full border border-border bg-background px-3">
                {readyToolCount} 个工具可用
              </span>
              <span className="inline-flex h-7 items-center rounded-full border border-border bg-background px-3">
                {canvasProjectCountLabel}
              </span>
              <span className="inline-flex h-7 items-center rounded-full border border-border bg-background px-3">
                {autoModelPreference ? "模型自动偏好" : selectedModelCountLabel}
              </span>
            </div>
          </div>

          <div
            className={cn(
              "mt-6 flex w-full flex-col items-center transform-gpu transition-all duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
              homePromptTransition ? "pointer-events-none translate-y-12 opacity-0 blur-sm" : "translate-y-0 opacity-100",
            )}
          >
          <form onSubmit={handlePromptSubmit} className="w-full max-w-3xl">
            <div
              ref={homeComposerRef}
              className="relative rounded-[22px] border border-neutral-200 bg-white px-3 pb-3 pt-3 text-left shadow-[0_10px_30px_rgba(15,23,42,0.08)] transition focus-within:border-neutral-300 focus-within:shadow-[0_18px_42px_rgba(15,23,42,0.1)] dark:border-border dark:bg-card"
            >
              <input
                ref={homeFileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={handleHomeFileInputChange}
              />
              {homeSelectedSkill ? (
                <div className="mb-2 flex items-center gap-2">
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                    <BookOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{homeSelectedSkill.title}</span>
                    <button
                      type="button"
                      onClick={() => setHomeSelectedSkill(null)}
                      className="ml-0.5 rounded-full p-0.5 text-blue-500 transition hover:bg-blue-100 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="取消 Skill"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                </div>
              ) : null}
              {homeAttachments.length ? (
                <div className="mb-2 flex flex-wrap gap-2">
                  {homeAttachments.map((file) => (
                    <span
                      key={file.id}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-neutral-200 bg-neutral-50 px-2.5 py-1 text-xs text-neutral-700 dark:border-border dark:bg-muted dark:text-muted-foreground"
                    >
                      <Paperclip className="h-3.5 w-3.5 shrink-0" />
                      <span className="max-w-[13rem] truncate">{file.name}</span>
                      <span className="shrink-0 text-neutral-400">{formatAttachmentSize(file.size)}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setHomeAttachments((current) => current.filter((item) => item.id !== file.id))
                        }
                        className="ml-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-neutral-400 transition hover:bg-neutral-200 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-accent dark:hover:text-foreground"
                        aria-label={`移除 ${file.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                disabled={promptSending}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder="让创境AI帮你设计一个短片脚本、角色设定或视觉方向"
                rows={2}
                className="max-h-[150px] min-h-[72px] w-full resize-none bg-transparent px-1 text-sm leading-6 text-neutral-950 outline-none placeholder:text-neutral-400 disabled:cursor-not-allowed dark:text-foreground dark:placeholder:text-muted-foreground"
                aria-label="创意输入"
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5 text-neutral-500 dark:text-muted-foreground">
                  <div ref={homeMoreMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setHomeMoreMenuOpen((open) => !open);
                        setHomeSkillMenuOpen(false);
                        setModelMenuOpen(false);
                      }}
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        homeMoreMenuOpen
                          ? "bg-neutral-100 text-neutral-950 dark:bg-accent dark:text-foreground"
                          : "hover:bg-neutral-100 hover:text-neutral-900 dark:hover:bg-accent dark:hover:text-foreground",
                      )}
                      aria-label="更多"
                      aria-expanded={homeMoreMenuOpen}
                      title="更多"
                    >
                      <Plus className="h-4 w-4" />
                    </button>

                    {homeMoreMenuOpen ? (
                      <div className="absolute bottom-11 left-0 z-50 w-60 rounded-xl border border-neutral-100 bg-white p-2 text-neutral-900 shadow-2xl dark:border-border dark:bg-card dark:text-foreground">
                        <button
                          type="button"
                          onClick={() => {
                            setHomeMoreMenuOpen(false);
                            window.setTimeout(() => homeFileInputRef.current?.click(), 0);
                          }}
                          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-accent"
                        >
                          <Paperclip className="h-4 w-4" />
                          上传文件
                        </button>
                        <button
                          type="button"
                          onClick={() => setHomeWebSearchEnabled((value) => !value)}
                          className={cn(
                            "flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            homeWebSearchEnabled
                              ? "bg-neutral-100 dark:bg-accent"
                              : "hover:bg-neutral-50 dark:hover:bg-accent",
                          )}
                          aria-pressed={homeWebSearchEnabled}
                        >
                          <span className="flex items-center gap-3">
                            <Globe2 className="h-4 w-4" />
                            联网搜索
                          </span>
                          <span
                            className={cn(
                              "relative h-5 w-9 rounded-full transition-colors",
                              homeWebSearchEnabled ? "bg-neutral-950 dark:bg-primary" : "bg-neutral-200 dark:bg-muted",
                            )}
                          >
                            <span
                              className={cn(
                                "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                                homeWebSearchEnabled ? "translate-x-4" : "translate-x-0",
                              )}
                            />
                          </span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                  <div ref={homeSkillMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setHomeSkillMenuOpen((open) => !open);
                        setHomeMoreMenuOpen(false);
                        setModelMenuOpen(false);
                      }}
                      className={cn(
                        "flex h-8 shrink-0 items-center gap-1 rounded-xl px-2.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        homeSkillMenuOpen || homeSelectedSkill
                          ? "bg-blue-50 text-blue-700"
                          : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950 dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground",
                      )}
                      aria-label="Skills"
                      aria-expanded={homeSkillMenuOpen}
                      title="Skills"
                    >
                      <BookOpen className="h-3.5 w-3.5 shrink-0" />
                      <span>Skills</span>
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 transition",
                          homeSkillMenuOpen ? "rotate-180" : "",
                        )}
                      />
                    </button>
                    {homeSkillMenuOpen ? (
                      <div className="absolute bottom-11 left-0 z-50 flex w-[min(24rem,calc(100vw-2rem))] max-h-[28rem] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white text-left text-neutral-900 shadow-2xl dark:border-border dark:bg-card dark:text-foreground">
                        <div className="border-b border-neutral-100 px-3 py-2 dark:border-border">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">
                            Skills
                          </div>
                          <div className="mt-1 text-sm font-semibold text-neutral-950 dark:text-foreground">
                            {homeSelectedSkill?.title || homeActiveSkillCategoryLabel}
                          </div>
                        </div>
                        <div className="flex gap-1 overflow-x-auto border-b border-neutral-100 px-2 py-2 dark:border-border">
                          {HOME_SKILL_CATEGORIES.map((category) => {
                            const active = homeActiveSkillCategory === category.id;
                            return (
                              <button
                                key={category.id}
                                type="button"
                                onClick={() => setHomeActiveSkillCategory(category.id)}
                                className={cn(
                                  "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                  active
                                    ? "bg-neutral-950 text-white dark:bg-foreground dark:text-background"
                                    : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200 hover:text-neutral-950 dark:bg-muted dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground",
                                )}
                              >
                                {category.label}
                              </button>
                            );
                          })}
                        </div>
                        <div className="custom-scrollbar max-h-72 overflow-y-auto p-2">
                          {homeVisibleSkills.length ? (
                            homeVisibleSkills.map((skill) => {
                              const selected = homeSelectedSkill?.id === skill.id;
                              return (
                                <button
                                  key={skill.id}
                                  type="button"
                                  onClick={() => {
                                    setHomeSelectedSkill(skill);
                                    setPrompt((value) => (value.trim() ? value : skill.prompt));
                                    setHomeSkillMenuOpen(false);
                                  }}
                                  className={cn(
                                    "flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-accent",
                                    selected ? "bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" : "text-neutral-800 dark:text-foreground",
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                                      selected ? "bg-blue-100 text-blue-600 dark:bg-blue-500/20 dark:text-blue-300" : "bg-neutral-100 text-neutral-500 dark:bg-muted dark:text-muted-foreground",
                                    )}
                                  >
                                    <Sparkles className="h-4 w-4" />
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-semibold">
                                      {skill.title}
                                    </span>
                                    <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-neutral-500 dark:text-muted-foreground">
                                      {skill.description}
                                    </span>
                                  </span>
                                  {selected ? <Check className="mt-2 h-4 w-4 shrink-0" /> : null}
                                </button>
                              );
                            })
                          ) : (
                            <div className="px-3 py-6 text-center text-sm text-neutral-500 dark:text-muted-foreground">
                              当前分类暂无 Skill
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="flex h-8 shrink-0 items-center gap-1 rounded-xl px-2.5 text-sm text-neutral-800 transition hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground"
                    aria-label="当前模式：Agent"
                    title="Agent"
                  >
                    <Bot className="h-3.5 w-3.5 shrink-0" />
                    <span>Agent</span>
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setHomeThinkingModeEnabled((value) => !value)}
                    aria-pressed={homeThinkingModeEnabled}
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      homeThinkingModeEnabled
                        ? "bg-neutral-950 text-white dark:bg-foreground dark:text-background"
                        : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950 dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground",
                    )}
                    aria-label="思考模式"
                    title="思考模式"
                  >
                    <Lightbulb className="h-4 w-4" />
                  </button>
                  <div ref={modelMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        setModelMenuOpen((open) => !open);
                        setHomeMoreMenuOpen(false);
                        setHomeSkillMenuOpen(false);
                      }}
                      className={cn(
                        "inline-flex h-8 w-8 items-center justify-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        modelMenuOpen
                          ? "bg-neutral-950 text-white dark:bg-foreground dark:text-background"
                          : "text-neutral-500 hover:bg-neutral-100 hover:text-neutral-950 dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground",
                      )}
                      aria-label="选择模型"
                      aria-expanded={modelMenuOpen}
                      title={`模型：${selectedModelName}`}
                    >
                      <Box className="h-4 w-4" />
                    </button>

                    {modelMenuOpen ? (
                      <div className="absolute bottom-11 right-[-2.75rem] z-50 w-72 max-w-[calc(100vw-6rem)] rounded-xl border border-neutral-200 bg-white p-2 text-left text-neutral-900 shadow-2xl dark:border-border dark:bg-card dark:text-foreground sm:right-0 sm:w-80 sm:max-w-[min(20rem,calc(100vw-1.5rem))]">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-neutral-950 dark:text-foreground">
                            模型偏好
                          </div>
                          <button
                            type="button"
                            onClick={toggleHomeAutoModelPreference}
                            className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-medium text-neutral-700 transition-colors hover:text-neutral-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-muted-foreground dark:hover:text-foreground"
                            aria-pressed={autoModelPreference}
                          >
                            自动
                            <span
                              className={cn(
                                "relative h-5 w-9 rounded-full transition-colors",
                                autoModelPreference ? "bg-neutral-950" : "bg-neutral-200",
                              )}
                            >
                              <span
                                className={cn(
                                  "absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
                                  autoModelPreference ? "translate-x-4" : "translate-x-0",
                                )}
                              />
                            </span>
                          </button>
                        </div>

                        <div className="mb-2 grid grid-cols-4 rounded-md bg-neutral-100 p-0.5 dark:bg-muted">
                          {HOME_MODEL_PREFERENCE_TABS.map((tab) => (
                            <button
                              key={tab.value}
                              type="button"
                              onClick={() => setModelPreferenceTab(tab.value)}
                              className={cn(
                                "h-7 rounded-sm text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                modelPreferenceTab === tab.value
                                  ? "bg-white text-neutral-950 shadow-sm dark:bg-background dark:text-foreground"
                                  : "text-neutral-600 hover:text-neutral-950 dark:text-muted-foreground dark:hover:text-foreground",
                              )}
                            >
                              {tab.label}
                            </button>
                          ))}
                        </div>

                        <div className="mb-1.5 text-xs font-medium text-neutral-500 dark:text-muted-foreground">
                          {HOME_MODEL_PREFERENCE_TABS.find((tab) => tab.value === modelPreferenceTab)?.label}
                        </div>

                        <div className="max-h-60 overflow-y-auto pr-0.5">
                          {modelPreferenceOptions.length > 0 ? (
                            modelPreferenceOptions.map((option) => {
                              const Icon = option.icon;
                              const officialLogo = getOfficialModelLogo(option);
                              const selected =
                                modelPreferenceTab === "cot"
                                  ? selectedModelPoolIds.includes(option.id)
                                  : isMediaModelPreferenceTab(modelPreferenceTab) &&
                                    (selectedMediaModelIds[modelPreferenceTab] || []).includes(option.id);
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => selectHomeModelPreference(option)}
                                  aria-pressed={selected}
                                  className={cn(
                                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-800 transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-foreground dark:hover:bg-accent",
                                    selected ? "bg-neutral-50 dark:bg-accent/70" : "",
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "flex h-8 shrink-0 items-center justify-center text-neutral-700 dark:text-muted-foreground",
                                      officialLogo?.layout === "wordmark" ? "w-14" : "w-8",
                                    )}
                                  >
                                    {officialLogo ? (
                                      <OfficialModelLogo logo={officialLogo} variant="menu" />
                                    ) : (
                                      <Icon className="h-3.5 w-3.5" />
                                    )}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium text-neutral-800 dark:text-foreground">
                                      {option.label}
                                      {option.timeLabel ? (
                                        <span className="ml-1.5 rounded bg-blue-100 px-1 py-0.5 text-[10px] font-medium text-blue-600">
                                          {option.timeLabel}
                                        </span>
                                      ) : null}
                                    </span>
                                    <span className="mt-0.5 block line-clamp-2 text-xs leading-4 text-neutral-500 dark:text-muted-foreground">
                                      {option.description}
                                    </span>
                                  </span>
                                  {selected ? (
                                    <Check className="h-3.5 w-3.5 shrink-0 text-neutral-800 dark:text-foreground" />
                                  ) : null}
                                </button>
                              );
                            })
                          ) : (
                            <div className="rounded-lg bg-neutral-50 px-3 py-5 text-center text-xs text-neutral-500 dark:bg-muted dark:text-muted-foreground">
                              暂无接入 3D 模型
                            </div>
                          )}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <button
                    type="submit"
                    disabled={!prompt.trim() || promptSending}
                    className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-neutral-950 text-white shadow-sm transition hover:bg-neutral-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-neutral-300 dark:bg-foreground dark:text-background dark:hover:bg-foreground/90 dark:disabled:bg-neutral-700 dark:disabled:text-neutral-300"
                    aria-label="发送到 Playground"
                    title="发送到 Playground"
                  >
                    {promptSending ? (
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    ) : !prompt.trim() ? (
                      <AudioLines className="h-5 w-5" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </form>

          <div className="mt-4 w-full max-w-3xl overflow-hidden">
            <div className="custom-scrollbar -mx-5 flex snap-x gap-2 overflow-x-auto px-5 pb-1 sm:mx-0 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0 sm:pb-0">
            {activeModels.map((model) => {
              const officialLogo = getOfficialModelLogo(model);
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    setAutoModelPreference(false);
                    setSelectedModelPoolIds((current) => {
                      const nextPool = toggleHomeSelectedModelId(current, model.id);
                      if (nextPool.includes(model.id)) {
                        setSelectedModel(model.id);
                      } else if (!nextPool.includes(selectedModel)) {
                        setSelectedModel(nextPool[0] || defaultHomeTextModelId);
                      }
                      return nextPool;
                    });
                  }}
                  className={cn(
                    "inline-flex h-8 shrink-0 snap-start items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selectedModelPoolIds.includes(model.id)
                      ? "border-primary/55 bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                  aria-pressed={selectedModelPoolIds.includes(model.id)}
                >
                  {officialLogo ? <OfficialModelLogo logo={officialLogo} variant="chip" /> : null}
                  {model.name || model.id}
                </button>
              );
            })}
            {toolboxLoading ? (
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-background px-3 text-xs font-medium text-muted-foreground">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                同步工具箱
              </span>
            ) : null}
            </div>
          </div>
          </div>
        </section>

        <section
          className={cn(
            "mx-auto mt-3 w-full max-w-5xl transform-gpu transition-all duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
            homePromptTransition ? "pointer-events-none translate-y-12 opacity-0 blur-sm" : "translate-y-0 opacity-100",
          )}
        >
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">AI 工具箱</h2>
            </div>
            <span className="shrink-0 rounded-full border border-border bg-muted/35 px-2.5 py-1 text-xs font-medium text-muted-foreground">
              已接入 {readyToolCount}/{visibleToolboxTools.length}
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleToolboxTools.map((tool) => {
              const visual = getToolVisual(tool);
              const Icon = visual.icon;
              const locked = isToolLocked(tool.status);
              return (
                <button
                  key={tool.code}
                  type="button"
                  onClick={(event) => handleToolbox(tool, event.currentTarget)}
                  disabled={locked}
                  className={cn(
                    "group relative flex min-h-[6.75rem] transform-gpu items-start gap-3 rounded-lg border border-border bg-background p-3.5 text-left shadow-sm transition-[transform,box-shadow,border-color,background-color] duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    locked
                      ? "cursor-not-allowed opacity-60"
                      : "hover:z-20 hover:border-primary/45 hover:bg-white hover:shadow-[0_22px_55px_rgba(15,23,42,0.16)] hover:[transform:perspective(900px)_translateY(-8px)_rotateX(5deg)_rotateY(-2deg)_scale(1.045)] dark:hover:bg-card",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ring-1 transition-transform duration-300 ease-out group-hover:scale-110",
                      visual.tone,
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-foreground">
                          {tool.name}
                        </span>
                        <span className="mt-1 inline-flex rounded-full border border-border bg-muted/35 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {toolStatusLabel(tool.status)}
                        </span>
                      </span>
                      {!locked ? (
                        <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
                      ) : null}
                    </span>
                    <span className="mt-2 line-clamp-2 block text-xs leading-5 text-muted-foreground">
                      {tool.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section
          className={cn(
            "mx-auto mt-8 w-full max-w-5xl transform-gpu transition-all duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)]",
            homePromptTransition ? "pointer-events-none translate-y-14 opacity-0 blur-sm" : "translate-y-0 opacity-100",
          )}
        >
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">智能画布项目</h2>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-full border border-border bg-muted/35 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                最近 {visibleCanvasProjects.length || 0}
              </span>
              <div className="hidden items-center gap-1 sm:flex">
                <button
                  type="button"
                  onClick={() => scrollCanvasCarousel("left")}
                  disabled={canvasLoading}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45"
                  aria-label="向左查看画布项目"
                  title="向左查看"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => scrollCanvasCarousel("right")}
                  disabled={canvasLoading}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-45"
                  aria-label="向右查看画布项目"
                  title="向右查看"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>

          <div className="relative -mx-5 overflow-hidden px-5 sm:-mx-2 sm:px-2">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-8 bg-gradient-to-r from-white to-transparent dark:from-background" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-8 bg-gradient-to-l from-white to-transparent dark:from-background" />
            <div
              ref={canvasCarouselRef}
              className="custom-scrollbar -my-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 py-4"
              aria-label="智能画布项目走马灯"
            >
              {canvasLoading ? (
                Array.from({ length: 4 }).map((_, index) => (
                  <div
                    key={index}
                    className="h-44 w-[14.5rem] shrink-0 snap-start animate-pulse rounded-lg border border-border bg-muted/40 sm:w-64"
                  />
                ))
              ) : (
                <>
                  <button
                    type="button"
                    onClick={openNewCanvas}
                    className="flex h-44 w-[14.5rem] shrink-0 snap-start transform-gpu flex-col items-center justify-center rounded-lg border border-dashed border-border bg-background text-muted-foreground shadow-sm transition-[transform,box-shadow,border-color,background-color,color] duration-300 ease-out hover:z-20 hover:border-primary/40 hover:bg-primary/5 hover:text-primary hover:shadow-[0_20px_45px_rgba(79,70,229,0.18)] hover:[transform:perspective(900px)_translateY(-8px)_rotateX(4deg)_scale(1.05)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
                  >
                    <Plus className="h-6 w-6" />
                    <span className="mt-4 text-sm font-medium">新建智能画布</span>
                    <span className="mt-1 text-xs text-muted-foreground">从空白画布开始</span>
                  </button>

                  {visibleCanvasProjects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => openCanvasProject(project)}
                      className="group relative h-44 w-[14.5rem] shrink-0 snap-start overflow-hidden rounded-lg border border-border bg-neutral-950 text-left shadow-sm outline-none transform-gpu transition-[transform,box-shadow,border-color] duration-300 ease-out hover:z-20 hover:border-primary/45 hover:shadow-[0_22px_55px_rgba(15,23,42,0.24)] hover:[transform:perspective(900px)_translateY(-9px)_rotateX(5deg)_rotateY(-3deg)_scale(1.06)] focus-visible:ring-2 focus-visible:ring-ring sm:w-64"
                    >
                      {project.thumbnailUrl ? (
                        <img
                          src={project.thumbnailUrl}
                          alt={project.title}
                          className="absolute inset-0 h-full w-full object-cover object-center transition duration-500 ease-out group-hover:scale-110"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="absolute inset-0 grid grid-cols-3 gap-px bg-border">
                          {Array.from({ length: 6 }).map((_, index) => (
                            <div
                              key={index}
                              className={cn(
                                "bg-background",
                                index % 3 === 0 ? "bg-primary/8" : "",
                                index % 4 === 0 ? "bg-muted/70" : "",
                              )}
                            />
                          ))}
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-black/5 transition duration-300 group-hover:from-black/72 group-hover:via-black/12" />
                      <div className="absolute left-3 top-3 rounded-full bg-white/92 px-2 py-0.5 text-[11px] font-medium text-foreground shadow-sm backdrop-blur dark:bg-card/90">
                        智能画布
                      </div>
                      <div className="absolute inset-x-0 bottom-0 p-3 text-white">
                        <div className="truncate text-sm font-semibold drop-shadow">
                          {project.title || "Untitled"}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/78">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {formatCanvasDate(project.updatedAt || project.createdAt)}
                          </span>
                          {getCanvasProjectMetric(project, "nodeCount") !== null ? (
                            <span>{getCanvasProjectMetric(project, "nodeCount")} 节点</span>
                          ) : null}
                          {getCanvasProjectMetric(project, "messageCount") !== null ? (
                            <span>{getCanvasProjectMetric(project, "messageCount")} 对话</span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  ))}

                  {!visibleCanvasProjects.length ? (
                    <div className="flex h-44 w-[18rem] shrink-0 snap-start flex-col justify-center rounded-lg border border-border bg-muted/25 p-5 text-sm text-muted-foreground sm:w-[28rem]">
                      <Brush className="mb-3 h-5 w-5" />
                      还没有保存的智能画布。创建后，最近的画布项目会显示在这里。
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
