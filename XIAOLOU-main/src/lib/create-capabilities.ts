/**
 * Unified media capability types shared across create/image, create/video, and create/canvas.
 *
 * These types define the single source of truth for model capabilities.
 * The backend (core-api/store.js) is the authoritative data source;
 * frontends consume these via /api/create/{images,videos}/capabilities.
 */

export type MediaKind = "image" | "video";

export type MediaModelProvider =
  | "google"
  | "google-vertex"
  | "kling"
  | "openai"
  | "volcengine"
  | "hailuo"
  | "grok"
  | "bytedance"
  | "pixverse"
  | "other";

export type MediaModelStatus = "stable" | "experimental" | "failing" | "preview" | "untested";

export type ImageInputMode = "text_to_image" | "image_to_image" | "multi_image";

export type VideoInputMode =
  | "text_to_video"
  | "single_reference"
  | "start_end_frame"
  | "multi_param"
  | "video_reference"
  | "video_edit"
  | "motion_control"
  | "video_extend";

/**
 * Video mode values accepted by the generation API (`/api/create/videos/generate`).
 * Differs from `VideoInputMode` in that the API uses `image_to_video` (not
 * `single_reference`) to describe single-reference generation.
 */
export type VideoGenerationMode =
  | "text_to_video"
  | "image_to_video"
  | "start_end_frame"
  | "multi_param"
  | "video_edit"
  | "motion_control"
  | "video_extend";

export type MediaInputMode = ImageInputMode | VideoInputMode;

export interface MediaCapabilitySet {
  supported: boolean;
  status: MediaModelStatus;
  supportedAspectRatios: string[];
  supportedResolutions: string[];
  supportedQualities?: string[];
  supportedDurations?: string[];
  durationControl?: "fixed" | "selectable";
  aspectRatioControl?: "fixed" | "selectable";
  resolutionControl?: "none" | "fixed" | "selectable";
  qualityControl?: "none" | "fixed" | "selectable";
  outputCountControl?: "fixed" | "selectable";
  defaultAspectRatio?: string | null;
  defaultResolution?: string | null;
  defaultQuality?: string | null;
  defaultOutputCount?: number | null;
  maxOutputImages?: number | null;
  supportsNativeOutputCount?: boolean;
  defaultDuration?: string | null;
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  maxReferenceAudios?: number;
  qualityModes?: string[];
  editModes?: string[];
  requires?: string[];
  note?: string | null;
}

export interface MediaModelCapability {
  id: string;
  label: string;
  provider: MediaModelProvider;
  kind: MediaKind;
  status: MediaModelStatus;
  note?: string | null;
  recommended?: boolean;
  maxReferenceImages?: number;
  maxReferenceVideos?: number;
  maxReferenceAudios?: number;
  inputModes: Partial<Record<MediaInputMode, MediaCapabilitySet>>;
}

export interface MediaCapabilitiesResponse {
  kind: MediaKind;
  mode: string;
  defaultModel?: string | null;
  items: MediaModelCapability[];
}

/**
 * Canvas-side video mode aliases that map to the canonical backend modes.
 * Used for normalizing mode names across the bridge.
 */
export const VIDEO_MODE_ALIASES: Record<string, string> = {
  "frame-to-frame": "start_end_frame",
  "multi-reference": "multi_param",
  "image-to-video": "image_to_video",
  "text-to-video": "text_to_video",
  "motion-control": "motion_control",
  "video-edit": "video_edit",
  "video-extend": "video_extend",
};

export function normalizeVideoMode(mode: string | null | undefined): string {
  const trimmed = String(mode || "").trim().toLowerCase();
  return VIDEO_MODE_ALIASES[trimmed] || trimmed;
}
