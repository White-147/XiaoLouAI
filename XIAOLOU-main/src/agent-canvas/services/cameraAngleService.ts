/**
 * cameraAngleService.ts
 * 
 * Service for calling the Modal Camera Angle API.
 * Transforms images by adjusting the camera viewing angle.
 */

import { DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID, isXiaolouTextToImageModel, normalizeCanvasImageModelId } from '../config/canvasImageModels';
import { canUseXiaolouImageGenerationBridge, generateImageWithXiaolou } from '../integrations/xiaolouGenerationBridge';
import { getRuntimeEnvValue } from '../runtimeConfig';

// ============================================================================
// TYPES
// ============================================================================

interface CameraAngleRequest {
    image: string;      // base64-encoded image
    rotation: number;   // -180 to 180 degrees (horizontal)
    tilt: number;       // -90 to 90 degrees (vertical)
    zoom: number;       // 0-100 (close-up effect, mapped to 0-10 for API)
    seed?: number;      // optional reproducibility seed
    numSteps?: number;  // optional, default 4
}

interface CameraAngleResponse {
    image: string;           // base64-encoded result
    prompt: string;          // generated prompt
    seed: number;            // seed used
    inference_time_ms: number;
}

type CameraAngleGenerationOptions = {
    model?: string;
    aspectRatio?: string;
    resolution?: string;
    wideAngle?: boolean;
    mode?: 'subject' | 'camera';
    onTaskIdAssigned?: (taskId: string) => void;
};

// ============================================================================
// CONFIGURATION
// ============================================================================

const MODAL_ENDPOINT = getRuntimeEnvValue('VITE_MODAL_CAMERA_ENDPOINT');

// Timeout for API calls (5 minutes for cold start)
const API_TIMEOUT_MS = 5 * 60 * 1000;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Convert a URL or blob URL to a base64-encoded string
 */
async function urlToBase64(url: string): Promise<string> {
    // Already base64
    if (url.startsWith('data:image')) {
        return url;
    }

    try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error('[CameraAngle] Error converting URL to base64:', error);
        throw new Error('Failed to load image');
    }
}

function normalizeSelectableValue(value?: string) {
    const normalized = String(value || '').trim();
    if (!normalized || normalized.toLowerCase() === 'auto') {
        return undefined;
    }

    return normalized;
}

function describeZoom(zoom: number) {
    if (zoom >= 80) {
        return 'a close-up framing while keeping the subject fully recognizable';
    }
    if (zoom >= 55) {
        return 'a medium-close framing with slightly tighter composition';
    }
    if (zoom >= 25) {
        return 'a medium framing with balanced subject coverage';
    }
    if (zoom <= -1) {
        return 'a wider framing';
    }

    return 'roughly the same framing distance as the original image';
}

function buildCameraAnglePrompt(
    rotation: number,
    tilt: number,
    zoom: number,
    wideAngle?: boolean,
    mode: 'subject' | 'camera' = 'camera'
) {
    if (mode === 'subject') {
        const horizontalDirection =
            rotation > 0
                ? `rotate the subject about ${Math.abs(rotation)} degrees toward the viewer's right while the camera remains stable`
                : rotation < 0
                    ? `rotate the subject about ${Math.abs(rotation)} degrees toward the viewer's left while the camera remains stable`
                    : 'keep the subject facing direction centered';

        const verticalDirection =
            tilt > 0
                ? `tilt the subject upward by about ${Math.abs(tilt)} degrees`
                : tilt < 0
                    ? `tilt the subject downward by about ${Math.abs(tilt)} degrees`
                    : 'keep the subject vertically level';

        return [
            'Create a new image from the provided reference image.',
            'Keep the same subject identity, outfit, hairstyle, body proportions, background, lighting, colors, and composition style.',
            'Keep the camera framing largely stable and change the subject orientation instead of moving the camera.',
            `${horizontalDirection}.`,
            `${verticalDirection}.`,
            `Keep ${describeZoom(zoom)}.`,
            'Preserve the same person and clothing details with strong consistency.',
            'Do not invent new props, do not replace the character, and do not change the background scene.',
            'Return a clean, photorealistic single image.',
        ].join(' ');
    }

    const horizontalDirection =
        rotation > 0
            ? `rotate the camera about ${Math.abs(rotation)} degrees to the subject's right`
            : rotation < 0
                ? `rotate the camera about ${Math.abs(rotation)} degrees to the subject's left`
                : 'keep the horizontal camera angle centered';

    const verticalDirection =
        tilt > 0
            ? `raise the camera to a bird's-eye angle of about ${Math.abs(tilt)} degrees`
            : tilt < 0
                ? `lower the camera to a worm's-eye angle of about ${Math.abs(tilt)} degrees`
                : 'keep the vertical camera angle level';

    const lensDirection = wideAngle
        ? 'Use a subtle wide-angle lens perspective without distorting the subject.'
        : 'Use a natural lens perspective.';

    return [
        'Create a new image from the provided reference image.',
        'Keep the same subject identity, outfit, hairstyle, body proportions, pose intent, scene, lighting, colors, and overall composition logic.',
        'Only change the camera viewpoint.',
        `${horizontalDirection}.`,
        `${verticalDirection}.`,
        `Use ${describeZoom(zoom)}.`,
        lensDirection,
        'Do not change the subject into a different person or object, and do not invent new accessories or background elements.',
        'Return a clean, photorealistic single image.',
    ].join(' ');
}

export function resolveCameraAngleModelId(modelId?: string | null) {
    const normalizedModelId = normalizeCanvasImageModelId(modelId);
    if (isXiaolouTextToImageModel(normalizedModelId)) {
        return normalizedModelId;
    }

    return DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID;
}

/**
 * Fetch with timeout support
 */
async function fetchWithTimeout(
    url: string,
    options: RequestInit,
    timeout: number
): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(id);
        return response;
    } catch (error: any) {
        clearTimeout(id);
        if (error.name === 'AbortError') {
            throw new Error('Request timed out. The server may be starting up (cold start). Please try again in a few minutes.');
        }
        throw error;
    }
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

/**
 * Generate a camera-angle-adjusted version of an image.
 * 
 * @param imageUrl - URL or base64 of the source image
 * @param rotation - Horizontal rotation in degrees (-180 to 180)
 * @param tilt - Vertical tilt in degrees (-90 to 90)
 * @param zoom - Zoom level (0-100, will be scaled to 0-10 for API)
 * @returns Promise with the resulting image as a data URL
 */
export async function generateCameraAngle(
    imageUrl: string,
    rotation: number,
    tilt: number,
    zoom: number,
    options: CameraAngleGenerationOptions = {}
): Promise<{ imageUrl: string; seed: number; inferenceTimeMs: number; taskId?: string }> {
    // If no change, return original image
    if (rotation === 0 && tilt === 0 && zoom === 0) {
        console.log('[CameraAngle] No change requested, returning original');
        return { imageUrl, seed: 0, inferenceTimeMs: 0 };
    }

    if (canUseXiaolouImageGenerationBridge()) {
        const resolvedModelId = resolveCameraAngleModelId(options.model);
        const prompt = buildCameraAnglePrompt(rotation, tilt, zoom, options.wideAngle, options.mode || 'camera');
        const result = await generateImageWithXiaolou({
            prompt,
            model: resolvedModelId,
            aspectRatio: normalizeSelectableValue(options.aspectRatio),
            resolution: normalizeSelectableValue(options.resolution),
            referenceImageUrls: [imageUrl],
            onTaskIdAssigned: options.onTaskIdAssigned,
        });

        if (!result.resultUrl) {
            throw new Error('No image data returned from XiaoLou.');
        }

        return {
            imageUrl: result.resultUrl,
            seed: 0,
            inferenceTimeMs: 0,
            taskId: result.taskId,
        };
    }

    // Validate legacy endpoint only when not embedded in XiaoLou
    if (!MODAL_ENDPOINT) {
        throw new Error('Modal Camera Angle endpoint not configured. Please set VITE_MODAL_CAMERA_ENDPOINT in .env.local');
    }

    console.log('[CameraAngle] Generating with:', { rotation, tilt, zoom });

    // Convert image to base64
    const imageBase64 = await urlToBase64(imageUrl);

    // Strip data URL prefix if present for API
    const base64Data = imageBase64.includes(',')
        ? imageBase64.split(',')[1]
        : imageBase64;

    // Build request
    const request: CameraAngleRequest = {
        image: base64Data,
        rotation,
        tilt,
        zoom: zoom / 10, // Scale 0-100 to 0-10 for API
    };

    console.log('[CameraAngle] Calling Modal API...');
    const startTime = Date.now();

    try {
        const response = await fetchWithTimeout(
            MODAL_ENDPOINT,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request),
            },
            API_TIMEOUT_MS
        );

        if (!response.ok) {
            const errorText = await response.text();
            console.error('[CameraAngle] API error:', response.status, errorText);
            throw new Error(`Camera angle API error: ${response.status} - ${errorText}`);
        }

        const result: CameraAngleResponse = await response.json();
        const totalTime = Date.now() - startTime;

        console.log('[CameraAngle] Success!', {
            inferenceTimeMs: result.inference_time_ms,
            totalTimeMs: totalTime,
            seed: result.seed
        });

        // Return as data URL
        return {
            imageUrl: `data:image/png;base64,${result.image}`,
            seed: result.seed,
            inferenceTimeMs: result.inference_time_ms
        };
    } catch (error: any) {
        console.error('[CameraAngle] Request failed:', error);
        throw error;
    }
}

/**
 * Check if the Modal endpoint is configured
 */
export function isEndpointConfigured(): boolean {
    return canUseXiaolouImageGenerationBridge() || !!MODAL_ENDPOINT;
}
