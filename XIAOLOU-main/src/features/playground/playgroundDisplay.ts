import { Bot, Image as ImageIcon, Video, type LucideIcon } from "lucide-react";
import type {
  PlaygroundChatJob,
  PlaygroundConversation,
  PlaygroundMemory,
  PlaygroundMessage,
  PlaygroundModel,
} from "../../lib/api";

export type MemoryDraft = {
  key: string;
  value: string;
  enabled: boolean;
};

export type ComposerMode = "agent" | "image" | "video";

export type PlaygroundSkillCategory = {
  id: string;
  label: string;
};

export type PlaygroundSkill = {
  id: string;
  category: string;
  title: string;
  description: string;
  prompt: string;
};

export const starterPrompts = [
  "把一个悬疑短剧创意拆成三幕，并给出每幕冲突",
  "帮我把角色设定整理成可执行的视觉方向",
  "先问我 3 个关键问题，再整理成可拍摄方案",
  "把这个营销短片写成 10 条分镜提示词",
];

export const composerModes: Array<{
  value: ComposerMode;
  label: string;
  description: string;
  icon: LucideIcon;
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

export const skillCategories: PlaygroundSkillCategory[] = [
  { id: "script", label: "脚本" },
  { id: "video", label: "视频" },
  { id: "brand", label: "品牌" },
];

export const playgroundSkills: PlaygroundSkill[] = [
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

export function formatTime(value: string | null | undefined) {
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

export function upsertMessage(items: PlaygroundMessage[], message: PlaygroundMessage) {
  const existingIndex = items.findIndex((item) => item.id === message.id);
  if (existingIndex === -1) return [...items, message];
  const next = [...items];
  next[existingIndex] = message;
  return next;
}

export function upsertConversation(
  items: PlaygroundConversation[],
  conversation: PlaygroundConversation,
) {
  const existingIndex = items.findIndex((item) => item.id === conversation.id);
  if (existingIndex === -1) return [conversation, ...items];
  const next = [...items];
  next[existingIndex] = conversation;
  return next;
}

export function isActiveChatJob(job: PlaygroundChatJob | null | undefined) {
  return job ? job.status === "queued" || job.status === "running" : false;
}

export function buildMemoryDrafts(memories: PlaygroundMemory[]) {
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

export function replacePlaygroundConversationUrl(conversationId: string | null) {
  const url = new URL(window.location.href);
  if (conversationId) {
    url.searchParams.set("conversationId", conversationId);
  } else {
    url.searchParams.delete("conversationId");
  }
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function getJobLabel(job: PlaygroundChatJob | null | undefined) {
  if (!job) return "";
  if (job.status === "queued") return "排队中";
  if (job.status === "running") return "生成中";
  if (job.status === "failed") return "失败";
  if (job.status === "cancelled") return "已取消";
  return "已完成";
}

export function getMessageStatusLabel(status: PlaygroundMessage["status"]) {
  if (status === "queued") return "排队中";
  if (status === "running" || status === "pending") return "后台生成中";
  return "后台生成中";
}

export function buildComposerMessage(
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

export function modelLabel(model: PlaygroundModel) {
  return model.name || model.id;
}
