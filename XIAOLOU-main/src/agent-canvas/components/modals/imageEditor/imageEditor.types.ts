/**
 * imageEditor.types.ts
 * 
 * Shared types and constants for the Image Editor modal.
 */

import {
    CANVAS_IMAGE_MODELS,
    DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID,
    normalizeCanvasImageModelId
} from '../../../config/canvasImageModels';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Arrow element for annotations
 */
export interface ArrowElement {
    id: string;
    type: 'arrow';
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    color: string;
    lineWidth: number;
}

/**
 * Text element for annotations
 */
export interface TextElement {
    id: string;
    type: 'text';
    x: number;
    y: number;
    text: string;
    fontSize: number;
    color: string;
    fontFamily: string;
}

/**
 * Union type for all drawable elements
 */
export type EditorElement = ArrowElement | TextElement;

/**
 * Snapshot of editor state for undo/redo
 */
export interface HistoryState {
    canvasData: string | null; // Base64 image data of brush canvas
    elements: EditorElement[];
    imageUrl?: string; // Current image URL (for crop undo/redo)
}

/**
 * Props for the main ImageEditorModal component
 */
export interface ImageEditorModalProps {
    isOpen: boolean;
    nodeId: string;
    imageUrl?: string;
    initialPrompt?: string;
    initialModel?: string;
    initialAspectRatio?: string;
    initialResolution?: string;
    initialElements?: EditorElement[];
    initialCanvasData?: string;
    initialCanvasSize?: { width: number; height: number };
    initialBackgroundUrl?: string;
    onClose: () => void;
    onGenerate: (id: string, prompt: string, count: number) => void;
    onUpdate: (id: string, updates: any) => void;
}

/**
 * Image model configuration — provider union kept open for new providers
 */
export interface ImageModel {
    id: string;
    name: string;
    provider: string;
    supportsImageToImage: boolean;
    supportsMultiImage: boolean;
    recommended?: boolean;
    resolutions: string[];
    resolutionControl?: 'none' | 'fixed' | 'selectable';
    qualities?: string[];
    qualityControl?: 'none' | 'fixed' | 'selectable';
    aspectRatios: string[];
    defaultResolution?: string;
    defaultQuality?: string;
    defaultAspectRatio?: string;
    supportsNativeOutputCount?: boolean;
    maxOutputImages?: number;
    defaultOutputCount?: number;
    hiddenUnlessConfigured?: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Static fallback model list — ONLY used when the XiaoLou host bridge is
 * unavailable (standalone mode or bridge error). All primary model data
 * should come from useImageCapabilities() via the bridge.
 */
export const FALLBACK_IMAGE_MODELS: ImageModel[] = CANVAS_IMAGE_MODELS.filter((model) => !model.hiddenUnlessConfigured);

export const DEFAULT_IMAGE_EDITOR_MODEL_ID = DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID;

export function normalizeImageEditorModelId(modelId?: string) {
    return normalizeCanvasImageModelId(modelId);
}

/**
 * Preset brush colors
 */
export const PRESET_COLORS = ['#ff0000', '#3b82f6', '#22c55e', '#eab308', '#ec4899', '#8b5cf6'];
