/**
 * generationService.ts
 * 
 * Frontend service layer for AI content generation.
 * When running embedded (bridge available), all generation requests go through the
 * host bridge — no static model whitelist. When running standalone, requests go
 * to the local canvas backend.
 */

import { normalizeCanvasImageModelId } from '../config/canvasImageModels';
import { normalizeCanvasVideoModelId } from '../config/canvasVideoModels';
import {
  canUseXiaolouImageGenerationBridge,
  generateImageWithXiaolou,
  generateVideoWithXiaolou,
} from '../integrations/xiaolouGenerationBridge';
import { buildCanvasApiUrl } from '../integrations/twitcanvaRuntimePaths';

export interface GenerateImageParams {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  imageBase64?: string | string[];
  imageModel?: string;
  nodeId?: string;
  klingReferenceMode?: 'subject' | 'face';
  klingFaceIntensity?: number;
  klingSubjectIntensity?: number;
}

export interface GenerateVideoParams {
  prompt: string;
  imageBase64?: string;
  lastFrameBase64?: string;
  multiReferenceImageUrls?: string[];
  videoMode?: 'text_to_video' | 'image_to_video' | 'start_end_frame' | 'multi_param';
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  videoModel?: string;
  motionReferenceUrl?: string;
  generateAudio?: boolean;
  networkSearch?: boolean;
  nodeId?: string;
}

export interface GenerateVideoResult {
  resultUrl: string;
  previewUrl?: string;
  model?: string;
}

function normalizeReferenceImageUrl(value: string) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  if (typeof window === 'undefined') {
    return normalized;
  }

  if (/^(?:https?:\/\/|data:|blob:)/i.test(normalized)) {
    return normalized;
  }

  try {
    return new URL(normalized, window.location.origin).toString();
  } catch {
    return normalized;
  }
}

function isPrivateOrLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === '127.0.0.1' ||
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized.startsWith('10.') ||
    normalized.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)
  );
}

function shouldInlineReferenceImageUrl(value: string) {
  if (!value) {
    return false;
  }

  if (/^data:/i.test(value)) {
    return true;
  }

  if (/^blob:/i.test(value)) {
    return true;
  }

  try {
    const parsed = new URL(value);
    if (
      parsed.pathname.startsWith('/canvas-library/') ||
      parsed.pathname.startsWith('/twitcanva-library/') ||
      parsed.pathname.startsWith('/library/') ||
      parsed.pathname.startsWith('/uploads/')
    ) {
      return true;
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return true;
    }

    return isPrivateOrLoopbackHostname(parsed.hostname);
  } catch {
    return true;
  }
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read reference image.'));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(objectUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to decode the reference image.'));
    image.src = objectUrl;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Failed to encode the reference image.'));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

async function convertPngBlobToJpegDataUrl(blob: Blob) {
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await loadImageElement(objectUrl);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;

    if (!width || !height) {
      throw new Error('The PNG reference image has invalid dimensions.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('The browser could not create a canvas for reference image conversion.');
    }

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const jpegBlob = await canvasToBlob(canvas, 'image/jpeg', 0.92);
    return await blobToDataUrl(jpegBlob);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function normalizeReferenceBlobToDataUrl(blob: Blob, sourceUrl?: string) {
  const normalizedType = String(blob.type || '').toLowerCase();
  const normalizedSourceUrl = String(sourceUrl || '').toLowerCase();
  const isPng =
    normalizedType === 'image/png' ||
    normalizedSourceUrl.startsWith('data:image/png') ||
    normalizedSourceUrl.includes('.png');

  if (isPng) {
    return await convertPngBlobToJpegDataUrl(blob);
  }

  return await blobToDataUrl(blob);
}

async function inlineReferenceImageUrl(value: string) {
  const normalized = normalizeReferenceImageUrl(value);
  if (!normalized || !shouldInlineReferenceImageUrl(normalized) || typeof window === 'undefined') {
    return normalized;
  }

  try {
    const response = await fetch(normalized);
    if (!response.ok) {
      throw new Error(`Unexpected status ${response.status}`);
    }

    const blob = await response.blob();
    return await normalizeReferenceBlobToDataUrl(blob, normalized);
  } catch (error) {
    console.warn('[generationService] Failed to inline reference image, falling back to URL.', error);
    return normalized;
  }
}

async function resolveReferenceImageUrlsForXiaolou(imageBase64?: string | string[]) {
  const references = Array.isArray(imageBase64)
    ? imageBase64
    : imageBase64
      ? [imageBase64]
      : [];

  const resolved = await Promise.all(references.map((value) => inlineReferenceImageUrl(value)));
  return resolved.filter(Boolean);
}

/**
 * Generates an image.
 * Bridge-first: if embedded in XiaoLou host, all models go through the bridge.
 * Fallback: local canvas backend.
 */
export const generateImage = async (params: GenerateImageParams): Promise<string> => {
  try {
    const normalizedModelId = normalizeCanvasImageModelId(params.imageModel);

    if (canUseXiaolouImageGenerationBridge()) {
      const referenceImageUrls = await resolveReferenceImageUrlsForXiaolou(params.imageBase64);

      const data = await generateImageWithXiaolou({
        prompt: params.prompt,
        model: normalizedModelId,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        referenceImageUrls,
      });

      if (!data.resultUrl) {
        throw new Error('No image data returned from XiaoLou.');
      }

      return data.resultUrl;
    }

    const response = await fetch(buildCanvasApiUrl('/generate-image'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...params,
        imageModel: normalizedModelId,
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || response.statusText);
    }

    const data = await response.json();
    if (!data.resultUrl) {
      throw new Error("No image data returned from server");
    }
    return data.resultUrl;

  } catch (error) {
    console.error("Image Generation Error:", error);
    throw error;
  }
};

/**
 * Generates a video.
 * Bridge-first: if embedded in XiaoLou host and no motionReferenceUrl (local-only
 * feature), all models go through the bridge.
 * Fallback: local canvas backend.
 */
export const generateVideo = async (params: GenerateVideoParams): Promise<GenerateVideoResult> => {
  try {
    const normalizedVideoModelId = normalizeCanvasVideoModelId(params.videoModel);
    const requestedVideoMode = String(params.videoMode || '').trim().toLowerCase();

    if (canUseXiaolouImageGenerationBridge() && !params.motionReferenceUrl) {
      const isMultiRef = params.multiReferenceImageUrls && params.multiReferenceImageUrls.length > 0;

      if (isMultiRef) {
        const inlinedUrls = await Promise.all(
          params.multiReferenceImageUrls!.map(url => inlineReferenceImageUrl(url))
        );
        const data = await generateVideoWithXiaolou({
          prompt: params.prompt,
          model: normalizedVideoModelId,
          aspectRatio: params.aspectRatio,
          resolution: params.resolution,
          duration: params.duration,
          multiReferenceImageUrls: inlinedUrls.filter(Boolean),
          videoMode: 'multi_param',
          generateAudio: params.generateAudio,
          networkSearch: params.networkSearch,
        });

        if (!data.resultUrl) {
          throw new Error('No video data returned from XiaoLou.');
        }
        return {
          resultUrl: data.resultUrl,
          previewUrl: data.previewUrl,
          model: data.model,
        };
      }

      const referenceImageUrl = params.imageBase64
        ? await inlineReferenceImageUrl(params.imageBase64)
        : undefined;
      const firstFrameUrl =
        requestedVideoMode === 'start_end_frame' || (params.imageBase64 && params.lastFrameBase64)
          ? referenceImageUrl
          : undefined;
      const lastFrameUrl = params.lastFrameBase64
        ? await inlineReferenceImageUrl(params.lastFrameBase64)
        : undefined;
      if (requestedVideoMode === 'start_end_frame' && (!firstFrameUrl || !lastFrameUrl)) {
        throw new Error('首尾帧模式要求同时提供首帧和尾帧。');
      }
      const videoMode = requestedVideoMode === 'multi_param'
        ? 'multi_param'
        : requestedVideoMode === 'start_end_frame'
          ? 'start_end_frame'
          : requestedVideoMode === 'image_to_video'
            ? 'image_to_video'
            : requestedVideoMode === 'text_to_video'
              ? 'text_to_video'
              : lastFrameUrl
                ? 'start_end_frame'
                : referenceImageUrl
                  ? 'image_to_video'
                  : 'text_to_video';

      const data = await generateVideoWithXiaolou({
        prompt: params.prompt,
        model: normalizedVideoModelId,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        duration: params.duration,
        referenceImageUrl: videoMode === 'image_to_video' ? referenceImageUrl : undefined,
        firstFrameUrl,
        lastFrameUrl,
        videoMode,
        generateAudio: params.generateAudio,
        networkSearch: params.networkSearch,
      });

      if (!data.resultUrl) {
        throw new Error('No video data returned from XiaoLou.');
      }

      return {
        resultUrl: data.resultUrl,
        previewUrl: data.previewUrl,
        model: data.model,
      };
    }

    const response = await fetch(buildCanvasApiUrl('/generate-video'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...params,
        videoModel: normalizedVideoModelId,
      })
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || response.statusText);
    }

    const data = await response.json();
    if (!data.resultUrl) {
      throw new Error("No video data returned from server");
    }
    return {
      resultUrl: data.resultUrl,
      previewUrl: data.thumbnailUrl || data.previewUrl || undefined,
      model: data.model,
    };

  } catch (error) {
    console.error("Video Generation Error:", error);
    throw error;
  }
};
