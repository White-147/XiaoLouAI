export type ToolboxCapability = {
  code: string;
  name: string;
  status: string;
  queue: string;
  description: string;
};

export type QwenOmniModel =
  | "qwen3.5-omni-plus"
  | "qwen3.5-omni-flash"
  | "qwen-omni-turbo";

export type StoryboardGrid25Reference = {
  name: string;
  url: string;
};

export type ToolboxCapabilityRunType =
  | "character_replace"
  | "motion_transfer"
  | "upscale_restore";
