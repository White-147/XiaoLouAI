import {
    CANVAS_IMAGE_MODELS,
    DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID,
    type CanvasImageModel,
} from '../config/canvasImageModels';
import type {
    NativeAgentModelInfo,
    NativeAgentToolInfo,
} from '../services/nativeAgentCatalog';
import type { BridgeMediaModelCapability } from '../types';

export type ModelPreferenceTab = 'cot' | 'image' | 'video' | '3d';

export type ComposerModelOption = {
    id: string;
    label: string;
    provider: string;
    kind: 'text' | 'image' | 'video' | '3d';
};

export const MODEL_PREFERENCE_TABS: Array<{ value: ModelPreferenceTab; label: string }> = [
    { value: 'cot', label: 'CoT' },
    { value: 'image', label: 'Image' },
    { value: 'video', label: 'Video' },
    { value: '3d', label: '3D' },
];

export const COT_TEXT_MODEL_IDS = [
    'qwen3.6-plus',
    'vertex:gemini-3-flash-preview',
];

export const PREFERRED_TEXT_MODEL_IDS = [
    ...COT_TEXT_MODEL_IDS,
    'qwen-plus',
    'vertex:gemini-3.1-pro-preview',
];

export const PREFERRED_IMAGE_TOOL_IDS = [
    'xiaolou_image_vertex_gemini_3_pro_image_preview',
    'xiaolou_image_doubao_seedream_5_0_260128',
    'xiaolou_image_gemini_3_pro_image_preview',
];

export const PREFERRED_VIDEO_TOOL_IDS = [
    'xiaolou_video_doubao_seedance_2_0_260128',
    'xiaolou_video_vertex_veo_3_1_generate_001',
    'xiaolou_video_pixverse_c1',
];

function modelDisplayName(model: NativeAgentModelInfo) {
    return model.display_name?.trim() || model.model;
}

function toolDisplayName(tool: NativeAgentToolInfo) {
    return tool.display_name?.trim() || tool.id.replace(/^xiaolou_(image|video)_/, '');
}

export function toTextModelOptions(models: NativeAgentModelInfo[]): ComposerModelOption[] {
    return models
        .filter((model) => !model.type || model.type === 'text')
        .map((model) => ({
            id: model.model,
            label: modelDisplayName(model),
            provider: model.provider,
            kind: 'text' as const,
        }));
}

export function toToolModelOptions(tools: NativeAgentToolInfo[], kind: 'image' | 'video'): ComposerModelOption[] {
    return tools
        .filter((tool) => tool.type === kind)
        .map((tool) => ({
            id: tool.id,
            label: toolDisplayName(tool),
            provider: tool.provider,
            kind,
        }));
}

export function pickPreferredModel(options: ComposerModelOption[], preferredIds: string[]) {
    return preferredIds.find((id) => options.some((option) => option.id === id)) || options[0]?.id || '';
}

export function normalizeSelectedModelPool(
    selectedIds: string[],
    options: ComposerModelOption[],
    preferredIds: string[],
) {
    const optionIds = new Set(options.map((option) => option.id));
    const kept = Array.from(new Set(selectedIds)).filter((id) => optionIds.has(id));
    if (kept.length) return kept;
    const preferred = preferredIds.filter((id) => optionIds.has(id));
    if (preferred.length) return preferred;
    return options.slice(0, 1).map((option) => option.id);
}

export function toggleModelPoolId(selectedIds: string[], id: string) {
    if (!id) return selectedIds;
    const selected = new Set(selectedIds);
    if (selected.has(id)) {
        selected.delete(id);
    } else {
        selected.add(id);
    }
    return Array.from(selected);
}

export function areModelPoolsEqual(a: string[], b: string[]) {
    if (a.length !== b.length) return false;
    const bSet = new Set(b);
    return a.every((id) => bSet.has(id));
}

export function getModelOptionFingerprint(option: ComposerModelOption) {
    return `${option.provider} ${option.id} ${option.label}`.toLowerCase();
}

export function getModelBrandKey(option: ComposerModelOption) {
    const value = getModelOptionFingerprint(option);

    if (/nano[\s_-]*banana|banana/.test(value)) return 'nano-banana';
    if (/openai|gpt[\s_-]*image|gpt-image|dall/.test(value)) return 'openai';
    if (/black[\s_-]*forest|bfl|flux/.test(value)) return 'bfl';
    if (/seedream|seedance|doubao|volcengine|volces|bytedance|byte[\s_-]*dance|ark/.test(value)) return 'seed';
    if (/qwen|dashscope|tongyi|aliyun|alibaba/.test(value)) return 'qwen';
    if (/gemini|google|vertex|veo|imagen/.test(value)) return 'google';
    if (/kling|kuaishou/.test(value)) return 'kling';
    if (/pixverse/.test(value)) return 'pixverse';
    if (/grok|xai|x\.ai/.test(value)) return 'grok';

    return null;
}

export function normalizeToolKey(value?: string | null) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^xiaolou_(image|video)_/, '')
        .replace(/^vertex:/, 'vertex_')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

export function getCanvasImageModelForTool(toolId?: string, toolLabel?: string): CanvasImageModel {
    const defaultModel =
        CANVAS_IMAGE_MODELS.find((model) => model.id === DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID) ||
        CANVAS_IMAGE_MODELS[0];
    const toolKey = normalizeToolKey(toolId);
    const labelKey = normalizeToolKey(toolLabel);

    return (
        CANVAS_IMAGE_MODELS.find((model) => normalizeToolKey(model.id) === toolKey) ||
        CANVAS_IMAGE_MODELS.find((model) => normalizeToolKey(model.name) === labelKey) ||
        CANVAS_IMAGE_MODELS.find((model) => toolKey.includes(normalizeToolKey(model.id))) ||
        CANVAS_IMAGE_MODELS.find((model) => labelKey.includes(normalizeToolKey(model.name))) ||
        defaultModel
    );
}

export function getVideoModelIdForTool(
    toolId: string | undefined,
    toolLabel: string | undefined,
    capabilities: BridgeMediaModelCapability[],
) {
    const direct = toolId ? VIDEO_MODEL_ID_ALIASES[toolId] : undefined;
    if (direct) return direct;

    const toolKey = normalizeToolKey(toolId);
    const labelKey = normalizeToolKey(toolLabel);
    const matched = capabilities.find((item) => {
        const idKey = normalizeToolKey(item.id);
        const capabilityLabelKey = normalizeToolKey(item.label);
        return (
            idKey === toolKey ||
            idKey === labelKey ||
            toolKey.includes(idKey) ||
            labelKey.includes(idKey) ||
            capabilityLabelKey === labelKey
        );
    });
    return matched?.id || toolId || '';
}

const VIDEO_MODEL_ID_ALIASES: Record<string, string> = {
    xiaolou_video_pixverse_c1: 'pixverse-c1',
    xiaolou_video_pixverse_v6: 'pixverse-v6',
    xiaolou_video_doubao_seedance_2_0_260128: 'doubao-seedance-2-0-260128',
    xiaolou_video_doubao_seedance_2_0_fast_260128: 'doubao-seedance-2-0-fast-260128',
    xiaolou_video_vertex_veo_3_1_generate_001: 'vertex:veo-3.1-generate-001',
    xiaolou_video_vertex_veo_3_1_fast_generate_001: 'vertex:veo-3.1-fast-generate-001',
    xiaolou_video_vertex_veo_3_1_lite_generate_001: 'vertex:veo-3.1-lite-generate-001',
    xiaolou_video_kling_video: 'kling-video',
    xiaolou_video_kling_omni_video: 'kling-omni-video',
    xiaolou_video_kling_multi_image2video: 'kling-multi-image2video',
    xiaolou_video_kling_multi_elements: 'kling-multi-elements',
    xiaolou_video_veo3_1: 'veo3.1',
    xiaolou_video_veo3_1_pro: 'veo3.1-pro',
    xiaolou_video_veo3_1_fast: 'veo3.1-fast',
    xiaolou_video_veo_3_1_4k: 'veo_3_1-4K',
    xiaolou_video_veo_3_1_fast_4k: 'veo_3_1-fast-4K',
};
