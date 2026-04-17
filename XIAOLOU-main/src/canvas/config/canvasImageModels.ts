export type CanvasImageModel = {
  id: string;
  name: string;
  provider: 'google' | 'kling' | 'openai' | 'volcengine';
  supportsImageToImage: boolean;
  supportsMultiImage: boolean;
  recommended?: boolean;
  resolutions: string[];
  aspectRatios: string[];
};

export const DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID = 'gemini-3-pro-image-preview';

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
  },
  {
    id: 'gemini-3-pro-image-preview',
    name: 'Gemini 3 Pro',
    provider: 'google',
    supportsImageToImage: true,
    supportsMultiImage: true,
    resolutions: ['1K', '2K', '4K'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'],
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    name: 'Gemini 3.1 Flash',
    provider: 'google',
    supportsImageToImage: true,
    supportsMultiImage: true,
    resolutions: ['1K', '2K', '4K'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'],
  },
  {
    id: 'gemini-2.5-flash-image',
    name: 'Gemini 2.5 Flash',
    provider: 'google',
    supportsImageToImage: true,
    supportsMultiImage: true,
    resolutions: ['1K', '2K'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'],
  },
];

export const CANVAS_IMAGE_MODELS: CanvasImageModel[] = [
  ...XIAOLOU_TEXT_TO_IMAGE_MODELS,
  {
    id: 'gpt-image-1.5',
    name: 'GPT Image 1.5',
    provider: 'openai',
    supportsImageToImage: true,
    supportsMultiImage: true,
    recommended: true,
    resolutions: [],
    aspectRatios: ['1024x1024', '1536x1024', '1024x1536'],
  },
  {
    id: 'kling-v1-5',
    name: 'Kling V1.5',
    provider: 'kling',
    supportsImageToImage: true,
    supportsMultiImage: false,
    resolutions: ['1K', '2K'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
  },
  {
    id: 'kling-v2-1',
    name: 'Kling V2.1',
    provider: 'kling',
    supportsImageToImage: false,
    supportsMultiImage: true,
    recommended: true,
    resolutions: ['1K', '2K'],
    aspectRatios: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
  },
];

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
    defaultAspectRatio: m.aspectRatios[0] || null,
    defaultResolution: m.resolutions[0] || null,
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
      provider: m.provider as BridgeMediaModelProvider,
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

  if (normalized === 'gemini-pro' || normalized === 'imagen-3.0-generate-002') {
    return DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID;
  }

  return normalized;
}
