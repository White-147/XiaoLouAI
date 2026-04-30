import { CANVAS_IMAGE_MODELS } from '../config/canvasImageModels';
import { XIAOLOU_IMAGE_TO_VIDEO_MODELS } from '../config/canvasVideoModels';

export type NativeAgentModelInfo = {
    provider: string;
    model: string;
    display_name?: string | null;
    url: string;
    type?: 'text' | 'image' | 'tool' | 'video';
};

export type NativeAgentToolInfo = {
    provider: string;
    id: string;
    display_name?: string | null;
    type?: 'image' | 'tool' | 'video';
};

export async function fetchNativeAgentModelsAndTools() {
    const models: NativeAgentModelInfo[] = [
        { provider: 'auto', model: 'auto', display_name: 'Auto', url: '', type: 'text' },
        { provider: 'dashscope', model: 'qwen3.6-plus', display_name: 'Qwen3.6-Plus', url: '', type: 'text' },
        { provider: 'vertex', model: 'vertex:gemini-3-flash-preview', display_name: 'Gemini 3', url: '', type: 'text' },
        { provider: 'dashscope', model: 'qwen-plus', display_name: 'Qwen Plus', url: '', type: 'text' },
    ];

    const imageTools: NativeAgentToolInfo[] = CANVAS_IMAGE_MODELS
        .filter((model) => !model.hiddenUnlessConfigured)
        .map((model) => ({
            provider: model.provider,
            id: model.id,
            display_name: model.name,
            type: 'image',
        }));

    const videoTools: NativeAgentToolInfo[] = XIAOLOU_IMAGE_TO_VIDEO_MODELS
        .map((model) => ({
            provider: model.provider,
            id: model.id,
            display_name: model.name,
            type: 'video',
        }));

    return {
        models,
        tools: [...imageTools, ...videoTools],
    };
}
