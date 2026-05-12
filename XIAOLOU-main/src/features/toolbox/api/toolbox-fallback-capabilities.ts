import type { ToolboxCapability } from "./toolbox-types";

export const WINDOWS_NATIVE_TOOLBOX_CAPABILITIES: ToolboxCapability[] = [
  {
    code: "video_character_replace",
    name: "Script breakdown prompt",
    status: "local",
    queue: "canonical-jobs",
    description: "Frontend-only entry; no legacy toolbox write route is used.",
  },
  {
    code: "character_replace",
    name: "Character replace",
    status: "local",
    queue: "canonical-jobs",
    description:
      "Use the dedicated video replace surface; legacy toolbox write route is retired.",
  },
  {
    code: "motion_transfer",
    name: "Motion transfer",
    status: "coming_soon",
    queue: "canonical-jobs",
    description:
      "Queued as a canonical job only after worker/provider evidence is available.",
  },
  {
    code: "upscale_restore",
    name: "Video reverse prompt",
    status: "local",
    queue: "canonical-jobs",
    description:
      "Use the dedicated reverse prompt surface; legacy toolbox write route is retired.",
  },
  {
    code: "storyboard_25",
    name: "25-grid storyboard",
    status: "local",
    queue: "canonical-jobs",
    description:
      "Frontend entry retained; legacy direct toolbox write route is retired.",
  },
];
