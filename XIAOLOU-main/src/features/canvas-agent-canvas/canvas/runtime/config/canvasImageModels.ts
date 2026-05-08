export type CanvasImageModel = {
  id: string;
  /** Frontend display label.
   * Yunwu-routed models keep their original name.
   * Official Vertex AI models end with "+" (e.g. "Gemini 3 Pro Image+").
   * The "+" is ONLY in the label, never in internalId or rawModelId.
   */
  name: string;
  provider: 'google' | 'google-vertex' | 'kling' | 'openai' | 'volcengine';
  supportsImageToImage: boolean;
  supportsMultiImage: boolean;
  recommended?: boolean;
  resolutions: string[];
  aspectRatios: string[];
  defaultResolution?: string;
  defaultAspectRatio?: string;
};

export const DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID = 'vertex:gemini-3-pro-image-preview';

const GEMINI_STANDARD_IMAGE_ASPECT_RATIOS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
const GEMINI_31_FLASH_IMAGE_ASPECT_RATIOS = [...GEMINI_STANDARD_IMAGE_ASPECT_RATIOS, '1:4', '1:8', '4:1', '8:1'];
const GEMINI_3_PRO_IMAGE_RESOLUTIONS = ['1K', '2K', '4K'];
const GEMINI_3_1_FLASH_IMAGE_RESOLUTIONS = ['512', '1K', '2K', '4K'];
const GEMINI_2_5_FLASH_IMAGE_RESOLUTIONS = ['1K'];
const VERTEX_GEMINI_IMAGE_RESOLUTIONS = ['1K', '2K', '4K'];
const KLING_IMAGE_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];
const KLING_IMAGE_RESOLUTIONS = ['1K', '2K'];

/**
 * Vertex AI model ID convention:
 *   internalId  : "vertex:<rawModelId>"   (e.g. "vertex:gemini-3-pro-image-preview")
 *   name (label): ends with "+"           (e.g. "Gemini 3 Pro Image+")
 *   rawModelId  : stripped of "vertex:"  — what actually goes to the Vertex API
 *
 * Excluded Vertex models:
 *   gemini-3-pro-preview  → discontinued by Google 2026-03-26
 */
export const XIAOLOU_TEXT_TO_IMAGE_MODELS: CanvasImageModel[] = [
  {
    id: 'doubao-seedream-5-0-260128',
    name: 'Seedream 5.0',
    provider: 'volcengine',
    supportsImageToImage: true,
    supportsMultiImage: true,
    recommended: true,
    resolutions: ['2K', '3K'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
    defaultResolution: '2K',
    defaultAspectRatio: '1:1',
  },
  {
    id: 'gemini-3-pro-image-preview',
    name: 'Gemini 3 Pro',
    provider: 'google',
    supportsImageToImage: true,
    supportsMultiImage: true,
    resolutions: GEMINI_3_PRO_IMAGE_RESOLUTIONS,
    aspectRatios: GEMINI_STANDARD_IMAGE_ASPECT_RATIOS,
    defaultResolution: '1K',
    defaultAspectRatio: '1:1',
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    name: 'Gemini 3.1 Flash',
    provider: 'google',
    supportsImageToImage: true,
    supportsMultiImage: true,
    resolutions: GEMINI_3_1_FLASH_IMAGE_RESOLUTIONS,
    aspectRatios: GEMINI_31_FLASH_IMAGE_ASPECT_RATIOS,
    defaultResolution: '1K',
    defaultAspectRatio: '1:1',
  },
  {
    id: 'gemini-2.5-flash-image',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    supportsImageToImage: true,
    supportsMultiImage: true,
    resolutions: GEMINI_2_5_FLASH_IMAGE_RESOLUTIONS,
    aspectRatios: GEMINI_STANDARD_IMAGE_ASPECT_RATIOS,
    defaultResolution: '1K',
    defaultAspectRatio: '1:1',
  },
  // ── Official Vertex AI image models (Preview) ────────────────────────────
  // internalId = "vertex:<rawModelId>"; name ends with "+" to distinguish from Yunwu-routed variants.
  // The "+" only appears in `name`, never in the ID sent to the backend.
  {
    id: 'vertex:gemini-3-pro-image-preview',
    name: 'Gemini 3 Pro Image+',
    provider: 'google-vertex',
    supportsImageToImage: true,
    supportsMultiImage: true,
    resolutions: VERTEX_GEMINI_IMAGE_RESOLUTIONS,
    aspectRatios: GEMINI_STANDARD_IMAGE_ASPECT_RATIOS,
    defaultResolution: '1K',
    defaultAspectRatio: '1:1',
  },
  {
    id: 'vertex:gemini-3.1-flash-image-preview',
    name: 'Gemini 3.1 Flash Image+',
    provider: 'google-vertex',
    supportsImageToImage: true,
    supportsMultiImage: true,
    resolutions: VERTEX_GEMINI_IMAGE_RESOLUTIONS,
    aspectRatios: GEMINI_31_FLASH_IMAGE_ASPECT_RATIOS,
    defaultResolution: '1K',
    defaultAspectRatio: '1:1',
  },
];

// Legacy invalid/retired image model IDs are normalized to the default
// Gemini image model when old workflows are loaded.

export const CANVAS_IMAGE_MODELS: CanvasImageModel[] = [
  ...XIAOLOU_TEXT_TO_IMAGE_MODELS,
  {
    id: 'kling-v1-5',
    name: 'Kling V1.5',
    provider: 'kling',
    supportsImageToImage: true,
    supportsMultiImage: false,
    resolutions: KLING_IMAGE_RESOLUTIONS,
    aspectRatios: KLING_IMAGE_ASPECT_RATIOS,
    defaultResolution: '1K',
    defaultAspectRatio: '1:1',
  },
  {
    id: 'kling-v2-1',
    name: 'Kling V2.1',
    provider: 'kling',
    supportsImageToImage: true,
    supportsMultiImage: true,
    recommended: true,
    resolutions: KLING_IMAGE_RESOLUTIONS,
    aspectRatios: KLING_IMAGE_ASPECT_RATIOS,
    defaultResolution: '1K',
    defaultAspectRatio: '1:1',
  },
];

export function getCanvasImageModel(modelId?: string | null) {
  const normalizedId = normalizeCanvasImageModelId(modelId);
  return CANVAS_IMAGE_MODELS.find((model) => model.id === normalizedId) || CANVAS_IMAGE_MODELS[0];
}

export function getDefaultCanvasImageAspectRatio(modelId?: string | null) {
  const model = getCanvasImageModel(modelId);
  if (!model) {
    return '1:1';
  }
  return model.defaultAspectRatio || (model.aspectRatios.includes('1:1') ? '1:1' : model.aspectRatios[0] || '1:1');
}

export function getDefaultCanvasImageResolution(modelId?: string | null) {
  const model = getCanvasImageModel(modelId);
  if (!model) {
    return '';
  }
  return model.defaultResolution || model.resolutions[0] || '';
}

export function normalizeCanvasImageAspectRatio(modelId?: string | null, aspectRatio?: string | null) {
  const requested = String(aspectRatio || '').trim();
  const model = getCanvasImageModel(modelId);
  if (!model) {
    return requested || '1:1';
  }
  return model.aspectRatios.includes(requested)
    ? requested
    : getDefaultCanvasImageAspectRatio(model.id);
}

export function normalizeCanvasImageResolution(modelId?: string | null, resolution?: string | null) {
  const requested = String(resolution || '').trim().toUpperCase();
  const model = getCanvasImageModel(modelId);
  if (!model) {
    return requested;
  }
  return model.resolutions.includes(requested)
    ? requested
    : getDefaultCanvasImageResolution(model.id);
}

export function isXiaolouTextToImageModel(modelId?: string | null) {
  if (!modelId) {
    return false;
  }

  return XIAOLOU_TEXT_TO_IMAGE_MODELS.some((model) => model.id === modelId);
}

// ─── Fallback conversion: static models → BridgeMediaModelCapability[] ───────
import type { BridgeMediaModelCapability, BridgeMediaCapabilitySet, BridgeMediaModelProvider } from '../types';

function toImageCapSet(
  m: CanvasImageModel,
  maxRef?: number,
): BridgeMediaCapabilitySet {
  return {
    supported: true,
    status: 'stable',
    supportedAspectRatios: m.aspectRatios,
    supportedResolutions: m.resolutions,
    aspectRatioControl: m.aspectRatios.length > 1 ? 'selectable' : 'fixed',
    resolutionControl: m.resolutions.length > 1 ? 'selectable' : 'fixed',
    defaultAspectRatio: m.defaultAspectRatio || m.aspectRatios[0] || null,
    defaultResolution: m.defaultResolution || m.resolutions[0] || null,
    ...(maxRef != null ? { maxReferenceImages: maxRef } : {}),
  };
}

export function buildFallbackImageCapabilities(
  models: CanvasImageModel[] = CANVAS_IMAGE_MODELS,
): BridgeMediaModelCapability[] {
  return models.map((m) => {
    const inputModes: BridgeMediaModelCapability['inputModes'] = {
      text_to_image: toImageCapSet(m),
    };
    if (m.supportsImageToImage) {
      inputModes.image_to_image = toImageCapSet(m, 1);
    }
    if (m.supportsMultiImage) {
      inputModes.multi_image = toImageCapSet(m, 4);
    }
    return {
      id: m.id,
      label: m.name,
      provider: (m.provider === 'google-vertex' ? 'google' : m.provider) as BridgeMediaModelProvider,
      kind: 'image' as const,
      status: 'stable' as const,
      recommended: m.recommended,
      inputModes,
    };
  });
}

export function normalizeCanvasImageModelId(modelId?: string | null) {
  const normalized = String(modelId || '').trim();
  if (!normalized) {
    return DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID;
  }

  // Legacy model aliases — kept only for workflows loaded from local files.
  // The canonical compat layer lives in core-api/src/canvas-library.js.
  // Do NOT add gpt-image-1.5 or other discontinued models here.
  if (
    normalized === 'gemini-pro' ||
    normalized === 'imagen-3.0-generate-002'
  ) {
    return DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID;
  }

  return normalized;
}
