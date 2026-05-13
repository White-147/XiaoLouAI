import { useCallback, useMemo, type ReactNode } from 'react';

import {
    getCanvasImageQualityOptions,
    getCanvasImageResolutionOptions,
    normalizeCanvasImageOutputCount,
    shouldShowCanvasImageOutputCount,
    shouldShowCanvasImageQuality,
    shouldShowCanvasImageResolution,
    type CanvasImageModel,
} from '../config/canvasImageModels';
import {
    getCanvasImageModelForTool,
    normalizeToolKey,
    type ComposerModelOption,
} from './chatPanelModelOptions';

export const PREFERRED_IMAGE_RESOLUTION = '2K';

const MAX_IMAGE_BATCH_COUNT = 10;

const RATIO_INFO_2K: Record<string, { w: number; h: number }> = {
    '8:1': { w: 2048, h: 256 },
    '4:1': { w: 2048, h: 512 },
    '21:9': { w: 3136, h: 1344 },
    '16:9': { w: 2912, h: 1632 },
    '3:2': { w: 2688, h: 1792 },
    '4:3': { w: 2464, h: 1856 },
    '5:4': { w: 2560, h: 2048 },
    '1:1': { w: 2048, h: 2048 },
    '4:5': { w: 2048, h: 2560 },
    '3:4': { w: 1856, h: 2464 },
    '2:3': { w: 1792, h: 2688 },
    '9:16': { w: 1632, h: 2912 },
    '1:4': { w: 512, h: 2048 },
    '1:8': { w: 256, h: 2048 },
};

const SEEDREAM_SIZE_MAP: Record<string, { w: number; h: number }> = {
    '1K:1:1': { w: 1024, h: 1024 },
    '1K:4:3': { w: 1152, h: 864 },
    '1K:3:4': { w: 864, h: 1152 },
    '1K:16:9': { w: 1280, h: 720 },
    '1K:9:16': { w: 720, h: 1280 },
    '1K:3:2': { w: 1248, h: 832 },
    '1K:2:3': { w: 832, h: 1248 },
    '1K:21:9': { w: 1512, h: 648 },
    '2K:1:1': { w: 2048, h: 2048 },
    '2K:4:3': { w: 2304, h: 1728 },
    '2K:3:4': { w: 1728, h: 2304 },
    '2K:16:9': { w: 2848, h: 1600 },
    '2K:9:16': { w: 1600, h: 2848 },
    '2K:3:2': { w: 2496, h: 1664 },
    '2K:2:3': { w: 1664, h: 2496 },
    '2K:21:9': { w: 3136, h: 1344 },
    '3K:1:1': { w: 3072, h: 3072 },
    '3K:4:3': { w: 3456, h: 2592 },
    '3K:3:4': { w: 2592, h: 3456 },
    '3K:16:9': { w: 4096, h: 2304 },
    '3K:9:16': { w: 2304, h: 4096 },
    '3K:3:2': { w: 3744, h: 2496 },
    '3K:2:3': { w: 2496, h: 3744 },
    '3K:21:9': { w: 4704, h: 2016 },
};

const RESOLUTION_BASE: Record<string, number> = {
    '512': 512,
    '1K': 1024,
    '2K': 2048,
    '3K': 3072,
    '4K': 4096,
};

const RATIO_DISPLAY: Record<string, string> = {
    '1024x1024': '1:1',
    '1536x1024': '3:2',
    '1024x1536': '2:3',
};

type UseChatPanelImageSettingsParams = {
    selectedImageTool: string;
    imageModelOptions: ComposerModelOption[];
    imageResolution: string;
    imageAspectRatio: string;
    imageBatchCount: number;
    getRatioIcon: (ratio: string) => ReactNode;
};

export function parseRatio(ratio: string): { w: number; h: number } | null {
    if (!ratio) return null;
    if (ratio.includes('x')) {
        const [w, h] = ratio.split('x').map(Number);
        return w > 0 && h > 0 ? { w, h } : null;
    }
    const [w, h] = ratio.split(':').map(Number);
    return w > 0 && h > 0 ? { w, h } : null;
}

function snap32(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 32;
    return Math.max(32, Math.round(value / 32) * 32);
}

function computeRatioDimensions(ratio: string, resolution: string): { w: number; h: number } | null {
    const base = RESOLUTION_BASE[resolution] ?? RESOLUTION_BASE['2K'];
    const hardcoded = RATIO_INFO_2K[ratio];

    if (hardcoded) {
        const scale = base / 2048;
        return { w: snap32(hardcoded.w * scale), h: snap32(hardcoded.h * scale) };
    }

    const parsed = parseRatio(ratio);
    if (!parsed) return null;

    if (ratio.includes('x')) {
        const maxDim = Math.max(parsed.w, parsed.h);
        const scale = base / Math.max(maxDim, 1);
        return { w: snap32(parsed.w * scale), h: snap32(parsed.h * scale) };
    }

    const aspect = parsed.w / parsed.h;
    return {
        w: snap32(base * Math.sqrt(aspect)),
        h: snap32(base / Math.sqrt(aspect)),
    };
}

function uniqueResolutions(resolutions: string[]) {
    return Array.from(new Set(resolutions.filter(Boolean)));
}

function getPreferredImageResolution(resolutions: string[], defaultResolution?: string) {
    const options = uniqueResolutions(resolutions);
    if (!options.length) return '';
    if (options.includes(PREFERRED_IMAGE_RESOLUTION)) return PREFERRED_IMAGE_RESOLUTION;
    if (defaultResolution && options.includes(defaultResolution)) return defaultResolution;
    return options[0];
}

function isSeedreamModel(model: CanvasImageModel) {
    return normalizeToolKey(model.id).includes('seedream');
}

function getImageDisplaySize(
    model: CanvasImageModel,
    aspectRatio: string,
    resolution: string,
): { w: number; h: number } | null {
    const normalizedResolution = String(resolution || model.defaultResolution || PREFERRED_IMAGE_RESOLUTION).trim().toUpperCase();
    const normalizedAspectRatio = aspectRatio || model.defaultAspectRatio || '1:1';

    if (isSeedreamModel(model)) {
        const seedreamTier = normalizedResolution === '3K' || normalizedResolution === '4K' ? '3K' : '2K';
        return SEEDREAM_SIZE_MAP[`${seedreamTier}:${normalizedAspectRatio}`] || SEEDREAM_SIZE_MAP[`${seedreamTier}:1:1`] || null;
    }

    return computeRatioDimensions(normalizedAspectRatio, normalizedResolution);
}

function formatImageSize(size: { w: number; h: number } | null) {
    return size ? `${size.w}×${size.h}` : '--';
}

export function useChatPanelImageSettings({
    selectedImageTool,
    imageModelOptions,
    imageResolution,
    imageAspectRatio,
    imageBatchCount,
    getRatioIcon,
}: UseChatPanelImageSettingsParams) {
    const selectedImageOption = useMemo(
        () => imageModelOptions.find((option) => option.id === selectedImageTool),
        [imageModelOptions, selectedImageTool],
    );
    const currentCanvasImageModel = useMemo(
        () => getCanvasImageModelForTool(selectedImageTool, selectedImageOption?.label),
        [selectedImageOption?.label, selectedImageTool],
    );
    const imageResolutionOptions = useMemo(
        () => uniqueResolutions(getCanvasImageResolutionOptions(currentCanvasImageModel)),
        [currentCanvasImageModel],
    );
    const imageQualityOptions = useMemo(
        () => getCanvasImageQualityOptions(currentCanvasImageModel),
        [currentCanvasImageModel],
    );
    const showImageQualitySettings = shouldShowCanvasImageQuality(currentCanvasImageModel);
    const showImageResolutionSettings = shouldShowCanvasImageResolution(currentCanvasImageModel);
    const showImageOutputCountSettings = shouldShowCanvasImageOutputCount(currentCanvasImageModel);
    const showImageDimensionSettings = showImageQualitySettings && !showImageResolutionSettings;
    const imageAspectRatioOptions = useMemo(
        () => currentCanvasImageModel.aspectRatios.length ? currentCanvasImageModel.aspectRatios : ['1:1'],
        [currentCanvasImageModel.aspectRatios],
    );
    const preferredImageResolution = useMemo(
        () => getPreferredImageResolution(imageResolutionOptions, currentCanvasImageModel.defaultResolution),
        [currentCanvasImageModel.defaultResolution, imageResolutionOptions],
    );
    const currentImageResolution = imageResolutionOptions.includes(imageResolution)
        ? imageResolution
        : preferredImageResolution;
    const currentImageAspectRatioLabel = RATIO_DISPLAY[imageAspectRatio] || imageAspectRatio;
    const currentImageSize = getImageDisplaySize(currentCanvasImageModel, imageAspectRatio, currentImageResolution);
    const currentImageSizeLabel = formatImageSize(currentImageSize);
    const currentImageQualityLabel = showImageQualitySettings ? (imageQualityOptions[0] || '') : '';
    const currentImageBatchCount = normalizeCanvasImageOutputCount(currentCanvasImageModel, imageBatchCount);
    const imageSettingsSummary = [
        currentImageQualityLabel,
        showImageResolutionSettings ? (currentImageResolution || '自动') : null,
        currentImageAspectRatioLabel,
        showImageOutputCountSettings ? `${currentImageBatchCount} img` : null,
    ].filter(Boolean).join(' · ');
    const imageSettingsTitle = [
        imageSettingsSummary,
        showImageDimensionSettings && currentImageSize ? currentImageSizeLabel : null,
    ].filter(Boolean).join(' · ');
    const imageCountOptions = useMemo(
        () => Array.from(
            { length: Math.min(currentCanvasImageModel.maxOutputImages || 1, MAX_IMAGE_BATCH_COUNT) },
            (_, index) => index + 1,
        ),
        [currentCanvasImageModel.maxOutputImages],
    );
    const imageResolutionMenuOptions = useMemo(
        () => imageResolutionOptions.map((option) => ({
            value: option,
            previewSize: formatImageSize(getImageDisplaySize(currentCanvasImageModel, imageAspectRatio, option)),
        })),
        [currentCanvasImageModel, imageAspectRatio, imageResolutionOptions],
    );
    const imageAspectRatioMenuOptions = useMemo(
        () => imageAspectRatioOptions.map((option) => ({
            value: option,
            label: RATIO_DISPLAY[option] || option,
            icon: getRatioIcon(option),
        })),
        [getRatioIcon, imageAspectRatioOptions],
    );
    const normalizeImageBatchCount = useCallback(
        (count: number) => normalizeCanvasImageOutputCount(currentCanvasImageModel, count),
        [currentCanvasImageModel],
    );

    return {
        selectedImageOption,
        currentCanvasImageModel,
        imageResolutionOptions,
        imageQualityOptions,
        showImageQualitySettings,
        showImageResolutionSettings,
        showImageOutputCountSettings,
        showImageDimensionSettings,
        imageAspectRatioOptions,
        preferredImageResolution,
        currentImageResolution,
        currentImageAspectRatioLabel,
        currentImageSize,
        currentImageSizeLabel,
        currentImageQualityLabel,
        currentImageBatchCount,
        imageSettingsSummary,
        imageSettingsTitle,
        imageCountOptions,
        imageResolutionMenuOptions,
        imageAspectRatioMenuOptions,
        normalizeImageBatchCount,
    };
}
