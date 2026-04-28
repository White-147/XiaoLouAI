/**
 * Advanced-setting presets for the Video Replace feature.
 *
 * Frontend UI shows human-readable tier names; every tier maps 1:1 to a real
 * backend parameter (see video-replace-service/app/schemas.py:GenerateRequest).
 * The wire protocol sends numeric / enum values, not tier labels.
 */

export type Sam2Size = "tiny" | "small" | "base_plus";
export type SampleSize = "832*480" | "480*832";

// YOLOv8 confidence
export const YOLO_CONF_TIERS = [
  { id: "relaxed", label: "宽松", hint: "检测更多候选人，易误报", value: 0.25 },
  { id: "standard", label: "标准", hint: "推荐值", value: 0.4 },
  { id: "strict", label: "严格", hint: "只保留高置信度候选人", value: 0.6 },
] as const;

export type YoloConfTier = (typeof YOLO_CONF_TIERS)[number]["id"];
export const DEFAULT_YOLO_CONF_TIER: YoloConfTier = "standard";

// SAM2 checkpoint size
export const SAM2_SIZE_TIERS: Array<{
  id: Sam2Size;
  label: string;
  hint: string;
}> = [
  { id: "tiny", label: "快速", hint: "SAM2-tiny，约 2.5 GB 显存" },
  { id: "small", label: "平衡", hint: "SAM2-small，约 3.5 GB 显存" },
  { id: "base_plus", label: "精细", hint: "SAM2-base+，约 5.5 GB 显存" },
];
export const DEFAULT_SAM2_SIZE: Sam2Size = "tiny";

// Mask dilation
export const MASK_DILATION_TIERS = [
  { id: "tight", label: "紧贴", value: 0 },
  { id: "standard", label: "标准", value: 5 },
  { id: "loose", label: "宽松", value: 10 },
  { id: "extra", label: "更宽", value: 20 },
] as const;

export type MaskDilationTier = (typeof MASK_DILATION_TIERS)[number]["id"];
export const DEFAULT_MASK_DILATION_TIER: MaskDilationTier = "standard";

// Mask edge blur
export const MASK_BLUR_TIERS = [
  { id: "sharp", label: "清晰", value: 0 },
  { id: "light", label: "轻微", value: 4 },
  { id: "soft", label: "柔和", value: 8 },
  { id: "verySoft", label: "很柔", value: 16 },
] as const;

export type MaskBlurTier = (typeof MASK_BLUR_TIERS)[number]["id"];
export const DEFAULT_MASK_BLUR_TIER: MaskBlurTier = "light";

// Wan2.1 sample_steps
export const SAMPLE_STEPS_TIERS = [
  { id: "draft", label: "草稿", hint: "~12 步，12GB 默认", value: 12 },
  { id: "standard", label: "标准", hint: "~20 步，质量更稳", value: 20 },
  { id: "fine", label: "精细", hint: "~30 步，高负载", value: 30 },
] as const;

export type SampleStepsTier = (typeof SAMPLE_STEPS_TIERS)[number]["id"];
export const DEFAULT_SAMPLE_STEPS_TIER: SampleStepsTier = "draft";

export const VACE_INFERENCE_FPS_TIERS = [
  { id: "15", label: "15 FPS", hint: "推荐", value: 15 },
  { id: "30", label: "30 FPS", hint: "更密", value: 30 },
  { id: "60", label: "60 FPS", hint: "高负载", value: 60 },
] as const;

export type VaceInferenceFpsTier = (typeof VACE_INFERENCE_FPS_TIERS)[number]["id"];
export const DEFAULT_VACE_INFERENCE_FPS_TIER: VaceInferenceFpsTier = "15";
export const DEFAULT_VACE_MAX_FRAME_NUM = 21;

// Wan2.1 VACE-1.3B officially bottoms out at 480P.
export const SAMPLE_SIZE_OPTIONS: Array<{
  id: SampleSize;
  label: string;
  note?: string;
  disabled?: boolean;
}> = [
  { id: "832*480", label: "480P 横屏（官方最低）", note: "Wan2.1 VACE-1.3B 仅支持 480P 输出" },
  { id: "480*832", label: "480P 竖屏（官方最低）", note: "更低分辨率暂无官方接口" },
  // 720P 在 12GB 显存下不稳定，当前不开放。
  // { id: "1280*720", label: "720P 横屏", disabled: true },
];
export const DEFAULT_SAMPLE_SIZE: SampleSize = "832*480";

export function tierValue<T extends { id: string; value: number }>(
  tiers: readonly T[],
  tierId: string,
  fallback: number,
): number {
  return tiers.find((t) => t.id === tierId)?.value ?? fallback;
}
