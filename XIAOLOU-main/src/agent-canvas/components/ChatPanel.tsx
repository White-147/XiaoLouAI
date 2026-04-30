/**
 * ChatPanel.tsx
 *
 * Right-side chat panel for Agent Canvas.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    AlertCircle,
    ArrowLeftRight,
    AudioLines,
    Banana,
    Bot,
    BookOpen,
    Box,
    Check,
    ChevronDown,
    Film,
    Globe2,
    ImageIcon,
    Lightbulb,
    Link2,
    Loader2,
    MessageSquare,
    MessageSquarePlus,
    MousePointer2,
    PanelRightClose,
    Paperclip,
    Plus,
    Search,
    Send,
    Share2,
    SlidersHorizontal,
    Sparkles,
    Trash2,
    Users,
    Video,
    X,
    Zap,
} from 'lucide-react';
import { ChatMessage } from './ChatMessage';
import { AssetLibraryPanel } from './AssetLibraryPanel';
import {
    useChatAgent,
    ChatMessage as ChatMessageType,
    ChatSession,
    type AgentCanvasSnapshot,
    type CanvasAgentAction,
} from '../hooks/useChatAgent';
import {
    fetchJaazModelsAndTools,
    type JaazModelInfo,
    type JaazToolInfo,
} from '../services/jaazAgentBridge';
import {
    CANVAS_IMAGE_MODELS,
    DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID,
    getCanvasImageQualityOptions,
    getCanvasImageResolutionOptions,
    normalizeCanvasImageOutputCount,
    shouldShowCanvasImageOutputCount,
    shouldShowCanvasImageQuality,
    shouldShowCanvasImageResolution,
    type CanvasImageModel,
} from '../config/canvasImageModels';
import {
    BlackForestLabsIcon,
    GeminiIcon,
    GoogleIcon,
    KlingMonoIcon,
    OpenAIIcon,
    PixVerseIcon,
    QwenIcon,
    SeedIcon,
} from './icons/BrandIcons';
import { useCreateCreditQuote } from '../../lib/useCreateCreditQuote';
import {
    canUseXiaolouImageGenerationBridge,
    generateVideoWithXiaolou,
    getVideoCapabilitiesFromXiaolou,
} from '../integrations/xiaolouGenerationBridge';
import { buildFallbackVideoCapabilities } from '../config/canvasVideoModels';
import type { BridgeMediaCapabilitySet, BridgeMediaModelCapability } from '../types';

type ComposerMenu = 'more' | 'skills' | 'mode' | 'model' | 'imageAttach' | 'imageSettings' | 'videoSettings' | 'videoShot' | 'videoAttach' | 'share' | null;
type ComposerMode = 'agent' | 'image' | 'video';
type ModelPreferenceTab = 'image' | 'video' | '3d';
type VideoComposerMode = 'reference' | 'start_end_frame' | 'multi_param' | 'video_edit' | 'motion_control';
type VideoApiMode = 'image_to_video' | 'start_end_frame' | 'multi_param' | 'video_edit' | 'motion_control' | 'video_extend';
type VideoFrameRole = 'firstFrame' | 'lastFrame';
type VideoAttachSlot = 'image' | 'video' | 'audio' | VideoFrameRole;
type AssetLibraryMediaFilter = 'image' | 'video' | 'audio';

const COMPOSER_MODES: Array<{
    value: ComposerMode;
    label: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
    { value: 'agent', label: 'Agent', icon: Bot },
    { value: 'image', label: '图像', icon: ImageIcon },
    { value: 'video', label: '视频', icon: Video },
];

const VIDEO_MODE_OPTIONS: Array<{
    value: VideoComposerMode;
    label: string;
    apiMode: VideoApiMode;
}> = [
    { value: 'reference', label: '参考图/视频', apiMode: 'image_to_video' },
    { value: 'start_end_frame', label: '首尾帧', apiMode: 'start_end_frame' },
    { value: 'multi_param', label: '多图参考', apiMode: 'multi_param' },
    { value: 'video_edit', label: '视频编辑', apiMode: 'video_edit' },
    { value: 'motion_control', label: '动作控制', apiMode: 'motion_control' },
];

const VIDEO_SHOT_OPTIONS = [
    '环绕主体运镜',
    '固定镜头',
    '手持镜头',
    '拉远缩放',
    '推进',
    '跟随拍摄',
    '向右摇摄',
    '向左摇摄',
    '向上摇摄',
    '向下摇摄',
    '环绕拍摄',
];

const PRIMARY_VIDEO_COMPOSER_MODES = new Set<VideoComposerMode>(['reference', 'start_end_frame']);

const VIDEO_CAPABILITY_API_MODES: VideoApiMode[] = [
    'image_to_video',
    'start_end_frame',
    'multi_param',
    'video_edit',
    'video_extend',
    'motion_control',
];

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

const SKILL_CATEGORIES = [
    { id: 'video', label: 'Video' },
    { id: 'social', label: 'Social Media' },
    { id: 'commerce', label: 'E-Commerce' },
    { id: 'branding', label: 'Branding' },
];

const SKILLS = [
    {
        id: 'seedance-video',
        category: 'video',
        title: 'Seedance 2.0 视频制作',
        description: '将你的创意落地成可直接发布的视频。',
        prompt: '请使用 Seedance 2.0 视频制作 Skill，把我的需求拆解为视频创作方案并生成视频。',
    },
    {
        id: 'one-click-short',
        category: 'video',
        title: '一键到底视频',
        description: '首尾帧衔接，自动生成完整长镜头视频。',
        prompt: '请使用一键到底视频 Skill，规划首尾帧并生成完整连续的视频。',
    },
    {
        id: 'drone-video',
        category: 'video',
        title: '无人机运镜视频',
        description: '使用 Seedance 2.0 创建无人机运镜视频。',
        prompt: '请使用无人机运镜视频 Skill，生成具有航拍推进和空间纵深的视频方案。',
    },
    {
        id: 'social-post',
        category: 'social',
        title: '社媒发布素材',
        description: '整理封面、短文案和发布节奏。',
        prompt: '请使用社媒发布素材 Skill，为这个创意生成适合社媒发布的视觉和文案。',
    },
    {
        id: 'product-card',
        category: 'commerce',
        title: '商品卖点图',
        description: '把商品优势转成可销售的画面。',
        prompt: '请使用商品卖点图 Skill，围绕商品核心卖点生成可投放的图像方案。',
    },
    {
        id: 'brand-style',
        category: 'branding',
        title: '品牌视觉延展',
        description: '延展品牌调性、版式和视觉语言。',
        prompt: '请使用品牌视觉延展 Skill，保持品牌一致性并生成多方向创意。',
    },
];

type ComposerModelOption = {
    id: string;
    label: string;
    provider: string;
    kind: 'text' | 'image' | 'video' | '3d';
};

const MODEL_PREFERENCE_TABS: Array<{ value: ModelPreferenceTab; label: string }> = [
    { value: 'image', label: 'Image' },
    { value: 'video', label: 'Video' },
    { value: '3d', label: '3D' },
];

const PREFERRED_TEXT_MODEL_IDS = [
    'qwen-plus',
    'vertex:gemini-3-flash-preview',
    'vertex:gemini-3.1-pro-preview',
];

const PREFERRED_IMAGE_TOOL_IDS = [
    'xiaolou_image_vertex_gemini_3_pro_image_preview',
    'xiaolou_image_doubao_seedream_5_0_260128',
    'xiaolou_image_gemini_3_pro_image_preview',
];

const PREFERRED_VIDEO_TOOL_IDS = [
    'xiaolou_video_doubao_seedance_2_0_260128',
    'xiaolou_video_vertex_veo_3_1_generate_001',
    'xiaolou_video_pixverse_c1',
];

const PREFERRED_IMAGE_RESOLUTION = '2K';
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

interface AttachedMedia {
    type: 'image' | 'video' | 'audio';
    url: string;
    nodeId: string;
    base64?: string;
    frameRole?: VideoFrameRole;
}

type VideoSlotDefinition = {
    id: string;
    label: string;
    type: AttachedMedia['type'];
    slot: VideoAttachSlot;
    media?: AttachedMedia | null;
    disabled?: boolean;
    extraCount?: number;
};

interface ChatPanelProps {
    isOpen: boolean;
    onClose: () => void;
    userName?: string;
    isDraggingNode?: boolean;
    onNodeDrop?: (nodeId: string, url: string, type: 'image' | 'video') => void;
    canvasTheme?: 'dark' | 'light';
    getCanvasSnapshot?: () => AgentCanvasSnapshot;
    onApplyActions?: (actions: CanvasAgentAction[]) => Promise<void> | void;
}

function Tooltip({
    children,
    label,
    placement = 'top',
}: {
    children: React.ReactNode;
    label: string;
    placement?: 'top' | 'bottom';
}) {
    const placementClass = placement === 'top'
        ? 'bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2'
        : 'right-0 top-[calc(100%+8px)]';

    return (
        <div className="group relative">
            {children}
            <div className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-lg bg-neutral-950 px-3 py-2 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 ${placementClass}`}>
                {label}
            </div>
        </div>
    );
}

function SwitchIndicator({ checked, theme = 'light' }: { checked: boolean; theme?: 'light' | 'dark' }) {
    if (theme === 'dark') {
        return (
            <span
                className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                    checked
                        ? 'justify-end bg-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.2)]'
                        : 'justify-start bg-white/10 ring-1 ring-inset ring-white/20'
                }`}
                aria-hidden="true"
            >
                <span className="h-4 w-4 rounded-full bg-white shadow-sm" />
            </span>
        );
    }
    return (
        <span
            className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? 'justify-end bg-neutral-900' : 'justify-start bg-neutral-200'}`}
            aria-hidden="true"
        >
            <span className="h-4 w-4 rounded-full bg-white shadow" />
        </span>
    );
}

function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    if (diffDays === 1) return '昨天';
    if (diffDays < 7) return `${diffDays} 天前`;
    return date.toLocaleDateString('zh-CN');
}

function isMediaFile(file: File) {
    return file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/');
}

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
        reader.readAsDataURL(file);
    });
}

async function imageUrlToBase64(url: string): Promise<string | undefined> {
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        const dataUrl = await readFileAsDataUrl(new File([blob], 'reference.png', {
            type: blob.type || 'image/png',
        }));
        return dataUrl.split(',')[1] || undefined;
    } catch (err) {
        console.error('Failed to convert image to base64:', err);
        return undefined;
    }
}

function modelDisplayName(model: JaazModelInfo) {
    return model.display_name?.trim() || model.model;
}

function toolDisplayName(tool: JaazToolInfo) {
    return tool.display_name?.trim() || tool.id.replace(/^xiaolou_(image|video)_/, '');
}

function toTextModelOptions(models: JaazModelInfo[]): ComposerModelOption[] {
    return models
        .filter((model) => !model.type || model.type === 'text')
        .map((model) => ({
            id: model.model,
            label: modelDisplayName(model),
            provider: model.provider,
            kind: 'text' as const,
        }));
}

function toToolModelOptions(tools: JaazToolInfo[], kind: 'image' | 'video'): ComposerModelOption[] {
    return tools
        .filter((tool) => tool.type === kind)
        .map((tool) => ({
            id: tool.id,
            label: toolDisplayName(tool),
            provider: tool.provider,
            kind,
        }));
}

function pickPreferredModel(options: ComposerModelOption[], preferredIds: string[]) {
    return preferredIds.find((id) => options.some((option) => option.id === id)) || options[0]?.id || '';
}

function normalizeSelectedModelPool(
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

function toggleModelPoolId(selectedIds: string[], id: string) {
    if (!id) return selectedIds;
    const selected = new Set(selectedIds);
    if (selected.has(id)) {
        selected.delete(id);
    } else {
        selected.add(id);
    }
    return Array.from(selected);
}

function areModelPoolsEqual(a: string[], b: string[]) {
    if (a.length !== b.length) return false;
    const bSet = new Set(b);
    return a.every((id) => bSet.has(id));
}

function modelOptionDescription(option: ComposerModelOption) {
    if (option.kind === 'image') {
        if (option.label.includes('Gemini')) return '小楼 Vertex / Gemini 图像生成能力。';
        if (option.label.includes('Seedream')) return '豆包图像生成，适合高质量创意图。';
        if (option.label.includes('Kling')) return '可灵图像生成工具。';
        return '图像生成工具。';
    }

    if (option.kind === 'video') {
        if (option.label.includes('Seedance')) return 'ByteDance 视频模型，适合图生视频和创意短片。';
        if (option.label.includes('Veo')) return 'Google Veo 视频模型，适合高质量视频生成。';
        if (option.label.includes('PixVerse')) return 'PixVerse 视频模型，适合快速生成视频。';
        if (option.label.includes('Kling') || option.label.includes('kling')) return '可灵视频模型，适合多图和元素视频生成。';
        return '视频生成工具。';
    }

    return '当前模式可用模型。';
}

function modelOptionTime(option: ComposerModelOption) {
    if (option.kind === 'video') {
        if (option.label.includes('Fast')) return '200s';
        if (option.label.includes('Veo')) return '180s';
        return '300s';
    }
    if (option.kind === 'image') return '30s';
    return '';
}

function getModelOptionFingerprint(option: ComposerModelOption) {
    return `${option.provider} ${option.id} ${option.label}`.toLowerCase();
}

function getModelBrandKey(option: ComposerModelOption) {
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

function getModelOptionIcon(
    option: ComposerModelOption,
    size = 16,
    className = 'shrink-0 text-neutral-900',
): React.ReactNode {
    switch (getModelBrandKey(option)) {
        case 'nano-banana':
            return <Banana size={size} strokeWidth={1.85} className={className} />;
        case 'openai':
            return <OpenAIIcon size={size} className={className} />;
        case 'bfl':
            return <BlackForestLabsIcon size={size} className={className} />;
        case 'seed':
            return <SeedIcon size={size} className={className} />;
        case 'qwen':
            return <QwenIcon size={size} className={className} />;
        case 'google':
            return /veo/.test(getModelOptionFingerprint(option))
                ? <GoogleIcon size={size} className={className} />
                : <GeminiIcon size={size} className={className} />;
        case 'kling':
            return <KlingMonoIcon size={size} className={className} />;
        case 'pixverse':
            return <PixVerseIcon size={size} className={className} />;
        case 'grok':
            return <Box size={size} strokeWidth={1.85} className={className} />;
        default:
            return option.kind === 'video'
                ? <Video size={size} strokeWidth={1.85} className={className} />
                : <Sparkles size={size} strokeWidth={1.85} className={className} />;
    }
}

function normalizeToolKey(value?: string | null) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^xiaolou_(image|video)_/, '')
        .replace(/^vertex:/, 'vertex_')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
}

function getCanvasImageModelForTool(toolId?: string, toolLabel?: string): CanvasImageModel {
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

function getVideoModelIdForTool(
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

function capabilityOptions(values?: string[]) {
    return Array.from(new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean)));
}

function sortByPreferredOrder(values: string[], order: string[]) {
    const orderMap = new Map(order.map((value, index) => [value.toLowerCase(), index]));
    return [...values].sort((a, b) => {
        const aOrder = orderMap.get(a.toLowerCase());
        const bOrder = orderMap.get(b.toLowerCase());
        if (aOrder != null || bOrder != null) {
            return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER);
        }
        return a.localeCompare(b, 'zh-CN', { numeric: true });
    });
}

function sortVideoAspectRatios(values?: string[]) {
    return sortByPreferredOrder(capabilityOptions(values), [
        'Auto',
        'adaptive',
        '16:9',
        '4:3',
        '1:1',
        '3:4',
        '9:16',
        '2:3',
        '3:2',
        '21:9',
    ]);
}

function sortVideoResolutions(values?: string[]) {
    return capabilityOptions(values).sort((a, b) => {
        const aNumber = Number.parseInt(a.replace(/[^\d]/g, ''), 10);
        const bNumber = Number.parseInt(b.replace(/[^\d]/g, ''), 10);
        if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
        if (Number.isFinite(aNumber)) return -1;
        if (Number.isFinite(bNumber)) return 1;
        return a.localeCompare(b, 'zh-CN', { numeric: true });
    });
}

function sortVideoDurations(values?: string[]) {
    return capabilityOptions(values).sort((a, b) => {
        const aNumber = Number.parseInt(a.replace(/[^\d]/g, ''), 10);
        const bNumber = Number.parseInt(b.replace(/[^\d]/g, ''), 10);
        if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
        return a.localeCompare(b, 'zh-CN', { numeric: true });
    });
}

function getVideoApiModesForComposerMode(mode: VideoComposerMode): VideoApiMode[] {
    if (mode === 'reference') return ['image_to_video', 'multi_param'];
    if (mode === 'video_edit') return ['video_edit', 'video_extend'];
    return [VIDEO_MODE_OPTIONS.find((item) => item.value === mode)?.apiMode || 'image_to_video'];
}

function isVideoCapabilitySetAvailable(capability?: BridgeMediaCapabilitySet | null) {
    return Boolean(capability && capability.supported !== false);
}

function isVideoComposerModeSupportedByCapability(mode: VideoComposerMode, capability: BridgeMediaModelCapability) {
    if (mode === 'reference') {
        return isVideoCapabilitySetAvailable(capability.inputModes.text_to_video) ||
            isVideoCapabilitySetAvailable(capability.inputModes.single_reference) ||
            isVideoCapabilitySetAvailable(capability.inputModes.multi_param);
    }
    if (mode === 'video_edit') {
        return isVideoCapabilitySetAvailable(capability.inputModes.video_edit) ||
            isVideoCapabilitySetAvailable(capability.inputModes.video_extend);
    }
    const apiMode = getVideoApiModesForComposerMode(mode)[0];
    return isVideoCapabilitySetAvailable(capability.inputModes[apiMode as keyof typeof capability.inputModes]);
}

function mergeVideoCapabilityItems(items: BridgeMediaModelCapability[]) {
    const merged = new Map<string, BridgeMediaModelCapability>();
    items.forEach((item) => {
        const existing = merged.get(item.id);
        if (!existing) {
            merged.set(item.id, item);
            return;
        }
        merged.set(item.id, {
            ...existing,
            ...item,
            inputModes: {
                ...existing.inputModes,
                ...item.inputModes,
            },
            maxReferenceImages: Math.max(existing.maxReferenceImages || 0, item.maxReferenceImages || 0) || undefined,
            maxReferenceVideos: Math.max(existing.maxReferenceVideos || 0, item.maxReferenceVideos || 0) || undefined,
            maxReferenceAudios: Math.max(existing.maxReferenceAudios || 0, item.maxReferenceAudios || 0) || undefined,
        });
    });
    return Array.from(merged.values());
}

function isVideoCapabilityAvailableForApiMode(apiMode: VideoApiMode, capability: BridgeMediaModelCapability) {
    if (apiMode === 'image_to_video') {
        return isVideoCapabilitySetAvailable(capability.inputModes.text_to_video) ||
            isVideoCapabilitySetAvailable(capability.inputModes.single_reference);
    }
    return isVideoCapabilitySetAvailable(capability.inputModes[apiMode as keyof typeof capability.inputModes]);
}

function buildFallbackVideoCapabilityMap(): Record<VideoApiMode, BridgeMediaModelCapability[]> {
    const fallbackCapabilities = buildFallbackVideoCapabilities();
    return Object.fromEntries(
        VIDEO_CAPABILITY_API_MODES.map((mode) => [
            mode,
            fallbackCapabilities.filter((capability) => isVideoCapabilityAvailableForApiMode(mode, capability)),
        ]),
    ) as Record<VideoApiMode, BridgeMediaModelCapability[]>;
}

function chooseCapabilityValue(current: string, values: string[] | undefined, fallback = '') {
    const options = capabilityOptions(values);
    if (current && options.includes(current)) return current;
    return options[0] || fallback;
}

function getCapabilityStatusLabel(status?: string) {
    if (status === 'stable') return 'stable';
    if (status === 'experimental') return 'experimental';
    if (status === 'untested') return 'untested';
    if (status === 'preview') return 'preview';
    return status || '';
}

function mediaUrlForPayload(media: AttachedMedia) {
    return media.type === 'image' && media.base64 ? `data:image/png;base64,${media.base64}` : media.url;
}

function isSeedanceVideoModelId(modelId?: string | null) {
    return String(modelId || '').startsWith('doubao-seedance');
}

function isVideoAudioGenerationSupported(
    modelId: string,
    modelCapability?: BridgeMediaModelCapability | null,
    capabilitySet?: BridgeMediaCapabilitySet | null,
) {
    if (capabilitySet?.supportsGenerateAudio || modelCapability?.supportsGenerateAudio) return true;
    if (modelId.startsWith('vertex:veo-3.1')) return true;
    if (isSeedanceVideoModelId(modelId)) return true;
    return modelId === 'kling-omni-video' || modelId === 'kling-v3-omni';
}

function isVideoMultiReferenceSupported(capability?: BridgeMediaModelCapability | null) {
    return isVideoCapabilitySetAvailable(capability?.inputModes.multi_param);
}

function getVideoMultiReferenceImageLimit(
    modelId: string,
    capability: BridgeMediaModelCapability | null | undefined,
    rawMax: number,
) {
    const fallback = rawMax > 0 ? rawMax : 3;
    if (capability?.provider === 'google-vertex' || isSeedanceVideoModelId(modelId)) {
        return fallback;
    }
    return Math.min(fallback, 3);
}

function getVideoAttachMediaType(slot: VideoAttachSlot): AttachedMedia['type'] {
    if (slot === 'video') return 'video';
    if (slot === 'audio') return 'audio';
    return 'image';
}

function getVideoAttachAccept(slot: VideoAttachSlot | null) {
    if (slot === 'video') return 'video/*';
    if (slot === 'audio') return 'audio/*';
    if (slot) return 'image/*';
    return null;
}

function getVideoSlotIcon(type: AttachedMedia['type']) {
    if (type === 'video') return Video;
    if (type === 'audio') return AudioLines;
    return ImageIcon;
}

function snap32(value: number): number {
    if (!Number.isFinite(value) || value <= 0) return 32;
    return Math.max(32, Math.round(value / 32) * 32);
}

function parseRatio(ratio: string): { w: number; h: number } | null {
    if (!ratio) return null;
    if (ratio.includes('x')) {
        const [w, h] = ratio.split('x').map(Number);
        return w > 0 && h > 0 ? { w, h } : null;
    }
    const [w, h] = ratio.split(':').map(Number);
    return w > 0 && h > 0 ? { w, h } : null;
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

function getRatioIcon(ratio: string) {
    const parsed = parseRatio(ratio);
    if (!parsed) {
        return <span className="h-4 w-4 rounded-[3px] border border-current" />;
    }
    const maxDim = 18;
    const scale = maxDim / Math.max(parsed.w, parsed.h);
    const width = Math.max(8, Math.round(parsed.w * scale));
    const height = Math.max(8, Math.round(parsed.h * scale));

    return (
        <span
            className="rounded-[3px] border border-current"
            style={{ width, height }}
        />
    );
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

function menuButtonClass(isActive = false) {
    return `flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-800 transition-colors ${isActive ? 'bg-neutral-100' : 'hover:bg-neutral-100'}`;
}

function videoToolbarButtonClass(isActive = false) {
    return `flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-transparent text-neutral-800 transition-colors ${isActive ? 'bg-neutral-100' : 'hover:bg-neutral-100'}`;
}

type FloatingPanelLayout = {
    left: number;
    bottom: number;
    width: number;
    maxHeight: number;
};

const FLOATING_MENU_PADDING = 16;
const FLOATING_MENU_TRIGGER_GAP = 8;

function getFloatingPanelLayout(trigger: HTMLElement | null, preferredWidth: number): FloatingPanelLayout | null {
    if (!trigger || typeof window === 'undefined') return null;
    const rect = trigger.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(preferredWidth, Math.max(280, viewportWidth - FLOATING_MENU_PADDING * 2));
    const maxLeft = Math.max(FLOATING_MENU_PADDING, viewportWidth - width - FLOATING_MENU_PADDING);
    const left = Math.min(Math.max(rect.right - width, FLOATING_MENU_PADDING), maxLeft);
    const bottom = Math.max(FLOATING_MENU_PADDING, viewportHeight - rect.top + FLOATING_MENU_TRIGGER_GAP);
    const maxHeight = Math.max(220, rect.top - FLOATING_MENU_PADDING - FLOATING_MENU_TRIGGER_GAP);

    return { left, bottom, width, maxHeight };
}

export const ChatPanel: React.FC<ChatPanelProps> = ({
    isOpen,
    onClose,
    isDraggingNode = false,
    canvasTheme = 'light',
    getCanvasSnapshot,
    onApplyActions,
}) => {
    const isDark = canvasTheme === 'dark';
    const [message, setMessage] = useState('');
    const [attachedMedia, setAttachedMedia] = useState<AttachedMedia[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [showConversationMenu, setShowConversationMenu] = useState(false);
    const [historySearch, setHistorySearch] = useState('');
    const [showChineseTip, setShowChineseTip] = useState(true);
    const [activeMenu, setActiveMenu] = useState<ComposerMenu>(null);
    const [composerMode, setComposerMode] = useState<ComposerMode>('agent');
    const [skillCategory, setSkillCategory] = useState(SKILL_CATEGORIES[0].id);
    const [webSearchEnabled, setWebSearchEnabled] = useState(false);
    const [canvasFilesEnabled, setCanvasFilesEnabled] = useState(true);
    const [showAssetLibrary, setShowAssetLibrary] = useState(false);
    const [thinkingModeEnabled, setThinkingModeEnabled] = useState(false);
    const [jaazModels, setJaazModels] = useState<JaazModelInfo[]>([]);
    const [jaazTools, setJaazTools] = useState<JaazToolInfo[]>([]);
    const [isLoadingModelCatalog, setIsLoadingModelCatalog] = useState(false);
    const [modelCatalogError, setModelCatalogError] = useState<string | null>(null);
    const [selectedTextModel, setSelectedTextModel] = useState('');
    const [selectedImageTool, setSelectedImageTool] = useState('');
    const [selectedVideoTool, setSelectedVideoTool] = useState('');
    const [selectedImageToolIds, setSelectedImageToolIds] = useState<string[]>([]);
    const [selectedVideoToolIds, setSelectedVideoToolIds] = useState<string[]>([]);
    const [modelPreferenceTab, setModelPreferenceTab] = useState<ModelPreferenceTab>('image');
    const [autoModelPreference, setAutoModelPreference] = useState(true);
    const [imageResolution, setImageResolution] = useState(PREFERRED_IMAGE_RESOLUTION);
    const [imageAspectRatio, setImageAspectRatio] = useState('1:1');
    const [imageBatchCount, setImageBatchCount] = useState(1);
    const [videoComposerMode, setVideoComposerMode] = useState<VideoComposerMode>('reference');
    const [videoCapabilities, setVideoCapabilities] = useState<Record<string, BridgeMediaModelCapability[]>>({});
    const [isLoadingVideoCapabilities, setIsLoadingVideoCapabilities] = useState(false);
    const [videoCapabilityError, setVideoCapabilityError] = useState<string | null>(null);
    const [videoAspectRatio, setVideoAspectRatio] = useState('16:9');
    const [videoResolution, setVideoResolution] = useState('720p');
    const [videoDuration, setVideoDuration] = useState('5s');
    const [videoEditMode, setVideoEditMode] = useState('modify');
    const [videoQualityMode, setVideoQualityMode] = useState('std');
    const [videoGenerateAudio, setVideoGenerateAudio] = useState(false);
    const [selectedVideoShot, setSelectedVideoShot] = useState('');
    const [pendingVideoAttachSlot, setPendingVideoAttachSlot] = useState<VideoAttachSlot | null>(null);
    const [activeVideoAttachSlotId, setActiveVideoAttachSlotId] = useState<string | null>(null);
    const [assetLibraryMediaFilter, setAssetLibraryMediaFilter] = useState<AssetLibraryMediaFilter | null>(null);
    const [isGeneratingComposerVideo, setIsGeneratingComposerVideo] = useState(false);
    const [showThinkingConfirm, setShowThinkingConfirm] = useState(false);
    const [thinkingConfirmNeverAsk, setThinkingConfirmNeverAsk] = useState(() => (
        typeof window !== 'undefined'
            ? window.localStorage.getItem('xiaolou.agentCanvas.skipThinkingConfirm') === 'true'
            : false
    ));

    const {
        messages,
        topic,
        isLoading,
        error,
        sessions,
        isLoadingSessions,
        sendMessage,
        startNewChat,
        loadSession,
        deleteSession,
        hasMessages,
    } = useChatAgent({ getCanvasSnapshot, onApplyActions });

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pendingVideoAttachSlotRef = useRef<VideoAttachSlot | null>(null);
    const videoSettingsButtonRef = useRef<HTMLButtonElement>(null);
    const videoShotButtonRef = useRef<HTMLButtonElement>(null);
    const [videoFloatingMenuLayout, setVideoFloatingMenuLayout] = useState<FloatingPanelLayout | null>(null);

    const updatePendingVideoAttachSlot = (slot: VideoAttachSlot | null) => {
        pendingVideoAttachSlotRef.current = slot;
        setPendingVideoAttachSlot(slot);
        if (!slot) {
            setActiveVideoAttachSlotId(null);
        }
    };

    useEffect(() => {
        if (!activeMenu && !showConversationMenu && !showThinkingConfirm) return;

        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return;

            if (!target.closest('[data-agent-active-menu-root]')) {
                setActiveMenu(null);
            }
            if (!target.closest('[data-agent-conversation-menu-root]')) {
                setShowConversationMenu(false);
            }
            if (!target.closest('[data-agent-thinking-menu-root]')) {
                setShowThinkingConfirm(false);
            }
        };

        document.addEventListener('pointerdown', handlePointerDown, true);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown, true);
        };
    }, [activeMenu, showConversationMenu, showThinkingConfirm]);

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isLoading]);

    useEffect(() => {
        if (activeMenu !== 'videoSettings' && activeMenu !== 'videoShot') {
            setVideoFloatingMenuLayout(null);
            return;
        }

        const preferredWidth = activeMenu === 'videoSettings' ? 368 : 360;
        const triggerRef = activeMenu === 'videoSettings' ? videoSettingsButtonRef : videoShotButtonRef;
        let frameId = 0;

        const updateLayout = () => {
            window.cancelAnimationFrame(frameId);
            frameId = window.requestAnimationFrame(() => {
                setVideoFloatingMenuLayout(getFloatingPanelLayout(triggerRef.current, preferredWidth));
            });
        };

        updateLayout();
        window.addEventListener('resize', updateLayout);
        window.addEventListener('scroll', updateLayout, true);

        return () => {
            window.cancelAnimationFrame(frameId);
            window.removeEventListener('resize', updateLayout);
            window.removeEventListener('scroll', updateLayout, true);
        };
    }, [activeMenu]);

    useEffect(() => {
        let cancelled = false;

        const loadCatalog = async () => {
            setIsLoadingModelCatalog(true);
            setModelCatalogError(null);
            try {
                const catalog = await fetchJaazModelsAndTools();
                if (cancelled) return;
                setJaazModels(catalog.models);
                setJaazTools(catalog.tools);
            } catch (err) {
                if (cancelled) return;
                setModelCatalogError(err instanceof Error ? err.message : '模型列表加载失败');
            } finally {
                if (!cancelled) {
                    setIsLoadingModelCatalog(false);
                }
            }
        };

        void loadCatalog();

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        const loadVideoCapabilities = async () => {
            setIsLoadingVideoCapabilities(true);
            setVideoCapabilityError(null);
            const applyFallbackCapabilities = () => {
                setVideoCapabilities(buildFallbackVideoCapabilityMap());
                setVideoCapabilityError(null);
            };

            try {
                if (!canUseXiaolouImageGenerationBridge()) {
                    if (!cancelled) {
                        applyFallbackCapabilities();
                    }
                    return;
                }

                const entries = await Promise.all(
                    VIDEO_CAPABILITY_API_MODES.map(async (mode) => {
                        const response = await getVideoCapabilitiesFromXiaolou(mode);
                        return [mode, response.items || []] as const;
                    }),
                );
                if (!cancelled) {
                    setVideoCapabilities(Object.fromEntries(entries));
                }
            } catch (err) {
                if (!cancelled) {
                    setVideoCapabilityError(err instanceof Error ? err.message : '视频能力加载失败');
                }
            } finally {
                if (!cancelled) {
                    setIsLoadingVideoCapabilities(false);
                }
            }
        };

        void loadVideoCapabilities();

        return () => {
            cancelled = true;
        };
    }, []);

    const textModelOptions = useMemo(() => toTextModelOptions(jaazModels), [jaazModels]);
    const imageModelOptions = useMemo(() => toToolModelOptions(jaazTools, 'image'), [jaazTools]);
    const videoModelOptions = useMemo(() => toToolModelOptions(jaazTools, 'video'), [jaazTools]);

    useEffect(() => {
        if (!selectedTextModel && textModelOptions.length > 0) {
            setSelectedTextModel(pickPreferredModel(textModelOptions, PREFERRED_TEXT_MODEL_IDS));
        }
    }, [selectedTextModel, textModelOptions]);

    useEffect(() => {
        if (!imageModelOptions.length) {
            setSelectedImageTool('');
            setSelectedImageToolIds([]);
            return;
        }

        const nextPool = normalizeSelectedModelPool(
            selectedImageToolIds,
            imageModelOptions,
            PREFERRED_IMAGE_TOOL_IDS,
        );
        if (!areModelPoolsEqual(selectedImageToolIds, nextPool)) {
            setSelectedImageToolIds(nextPool);
        }
        if (!nextPool.includes(selectedImageTool)) {
            setSelectedImageTool(nextPool[0] || '');
        }
    }, [selectedImageTool, selectedImageToolIds, imageModelOptions]);

    useEffect(() => {
        if (!videoModelOptions.length) {
            setSelectedVideoTool('');
            setSelectedVideoToolIds([]);
            return;
        }

        const nextPool = normalizeSelectedModelPool(
            selectedVideoToolIds,
            videoModelOptions,
            PREFERRED_VIDEO_TOOL_IDS,
        );
        if (!areModelPoolsEqual(selectedVideoToolIds, nextPool)) {
            setSelectedVideoToolIds(nextPool);
        }
        if (!nextPool.includes(selectedVideoTool)) {
            setSelectedVideoTool(nextPool[0] || '');
        }
    }, [selectedVideoTool, selectedVideoToolIds, videoModelOptions]);

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
    const hasComposerPayload = message.trim().length > 0 || attachedMedia.length > 0;
    const selectedVideoOption = useMemo(
        () => videoModelOptions.find((option) => option.id === selectedVideoTool),
        [selectedVideoTool, videoModelOptions],
    );
    const activeImageToolPool = useMemo(
        () => selectedImageToolIds.length ? selectedImageToolIds : (selectedImageTool ? [selectedImageTool] : []),
        [selectedImageTool, selectedImageToolIds],
    );
    const activeVideoToolPool = useMemo(
        () => selectedVideoToolIds.length ? selectedVideoToolIds : (selectedVideoTool ? [selectedVideoTool] : []),
        [selectedVideoTool, selectedVideoToolIds],
    );
    const selectedImagePoolLabels = useMemo(
        () => activeImageToolPool
            .map((id) => imageModelOptions.find((option) => option.id === id)?.label || id)
            .filter(Boolean),
        [activeImageToolPool, imageModelOptions],
    );
    const selectedVideoPoolLabels = useMemo(
        () => activeVideoToolPool
            .map((id) => videoModelOptions.find((option) => option.id === id)?.label || id)
            .filter(Boolean),
        [activeVideoToolPool, videoModelOptions],
    );
    const allVideoCapabilityItems = useMemo(
        () => Object.values(videoCapabilities).flat(),
        [videoCapabilities],
    );
    const allMergedVideoCapabilityItems = useMemo(
        () => mergeVideoCapabilityItems(allVideoCapabilityItems),
        [allVideoCapabilityItems],
    );
    const currentVideoModelId = useMemo(
        () => getVideoModelIdForTool(selectedVideoTool, selectedVideoOption?.label, allVideoCapabilityItems),
        [allVideoCapabilityItems, selectedVideoOption?.label, selectedVideoTool],
    );
    const currentFullVideoModelCapability = allMergedVideoCapabilityItems.find((item) => item.id === currentVideoModelId) || null;
    const availableVideoModeOptions = useMemo(
        () => {
            if (!currentVideoModelId) return [];
            return VIDEO_MODE_OPTIONS.filter((mode) => {
                const isVisiblePrimaryMode = PRIMARY_VIDEO_COMPOSER_MODES.has(mode.value);
                const isVisibleEditMode = mode.value === 'video_edit' && getVideoApiModesForComposerMode(mode.value).some((apiMode) =>
                    (videoCapabilities[apiMode] || []).some((item) =>
                        item.id === currentVideoModelId &&
                        isVideoComposerModeSupportedByCapability(mode.value, item),
                    ),
                );
                if (!isVisiblePrimaryMode && !isVisibleEditMode) return false;
                return getVideoApiModesForComposerMode(mode.value).some((apiMode) =>
                    (videoCapabilities[apiMode] || []).some((item) =>
                        item.id === currentVideoModelId &&
                        isVideoComposerModeSupportedByCapability(mode.value, item),
                    ),
                );
            });
        },
        [currentVideoModelId, videoCapabilities],
    );
    const videoApiMode = getVideoApiModesForComposerMode(videoComposerMode)[0] || 'image_to_video';
    const currentVideoModeCapabilities = useMemo(
        () => mergeVideoCapabilityItems(
            getVideoApiModesForComposerMode(videoComposerMode)
                .flatMap((mode) => videoCapabilities[mode] || []),
        ),
        [videoCapabilities, videoComposerMode],
    );
    const currentVideoModelCapability = currentVideoModeCapabilities.find((item) => item.id === currentVideoModelId) || null;
    const currentVideoCapabilitySet: BridgeMediaCapabilitySet | null = (() => {
        if (!currentVideoModelCapability) return null;
        if (videoApiMode === 'image_to_video') {
            const imageCount = attachedMedia.filter((item) => item.type === 'image').length;
            const multiReference = currentFullVideoModelCapability?.inputModes.multi_param ||
                currentVideoModelCapability.inputModes.multi_param ||
                null;
            if (
                isVideoCapabilitySetAvailable(multiReference) &&
                (imageCount > 1 || (!currentVideoModelCapability.inputModes.single_reference && !currentVideoModelCapability.inputModes.text_to_video))
            ) {
                return multiReference;
            }
            const imageRefs = imageCount > 0;
            return imageRefs
                ? currentVideoModelCapability.inputModes.single_reference || currentVideoModelCapability.inputModes.text_to_video || null
                : currentVideoModelCapability.inputModes.text_to_video || currentVideoModelCapability.inputModes.single_reference || null;
        }
        if (videoComposerMode === 'video_edit') {
            if (videoEditMode === 'extend') {
                return currentVideoModelCapability.inputModes.video_extend ||
                    currentVideoModelCapability.inputModes.video_edit ||
                    null;
            }
            return currentVideoModelCapability.inputModes.video_edit ||
                currentVideoModelCapability.inputModes.video_extend ||
                null;
        }
        return currentVideoModelCapability.inputModes[videoApiMode as keyof typeof currentVideoModelCapability.inputModes] || null;
    })();
    const videoEditModeOptions = useMemo(
        () => capabilityOptions([
            ...(currentVideoModelCapability?.inputModes.video_edit?.editModes || []),
            ...(currentVideoModelCapability?.inputModes.video_extend?.editModes || []),
        ]),
        [currentVideoModelCapability],
    );
    const videoAspectRatioOptions = sortVideoAspectRatios(currentVideoCapabilitySet?.supportedAspectRatios);
    const videoResolutionOptions = sortVideoResolutions(currentVideoCapabilitySet?.supportedResolutions);
    const videoDurationOptions = sortVideoDurations(currentVideoCapabilitySet?.supportedDurations);
    const currentVideoAspectRatio = chooseCapabilityValue(videoAspectRatio, videoAspectRatioOptions, '16:9');
    const currentVideoResolution = chooseCapabilityValue(videoResolution, videoResolutionOptions, '720p');
    const currentVideoDuration = chooseCapabilityValue(videoDuration, videoDurationOptions, '5s');
    const videoStatusLabel = getCapabilityStatusLabel(currentVideoModelCapability?.status || currentVideoCapabilitySet?.status);
    const videoImages = attachedMedia.filter((item) => item.type === 'image');
    const videoRefs = attachedMedia.filter((item) => item.type === 'video');
    const videoAudioRefs = attachedMedia.filter((item) => item.type === 'audio');
    const supportsVideoMultiReferenceImages = isVideoMultiReferenceSupported(currentFullVideoModelCapability) ||
        isVideoMultiReferenceSupported(currentVideoModelCapability);
    const rawVideoMaxReferenceImages = Math.max(
        currentVideoCapabilitySet?.maxReferenceImages || 0,
        currentVideoModelCapability?.maxReferenceImages || 0,
        currentFullVideoModelCapability?.maxReferenceImages || 0,
        currentVideoModelCapability?.inputModes.single_reference?.supported ? 1 : 0,
        currentVideoModelCapability?.inputModes.start_end_frame?.supported ? 2 : 0,
    );
    const currentVideoMaxReferenceImages = videoComposerMode === 'start_end_frame'
        ? 2
        : supportsVideoMultiReferenceImages
            ? getVideoMultiReferenceImageLimit(
                currentVideoModelId,
                currentFullVideoModelCapability || currentVideoModelCapability,
                rawVideoMaxReferenceImages,
            )
            : Math.min(Math.max(rawVideoMaxReferenceImages, videoComposerMode === 'reference' ? 1 : 0), 1);
    const currentVideoMaxReferenceVideos = Math.max(
        currentVideoCapabilitySet?.maxReferenceVideos || 0,
        currentVideoModelCapability?.maxReferenceVideos || 0,
        currentFullVideoModelCapability?.maxReferenceVideos || 0,
        isSeedanceVideoModelId(currentVideoModelId) ? 3 : 0,
    );
    const currentVideoMaxReferenceAudios = Math.max(
        currentVideoCapabilitySet?.maxReferenceAudios || 0,
        currentVideoModelCapability?.maxReferenceAudios || 0,
        currentFullVideoModelCapability?.maxReferenceAudios || 0,
        isSeedanceVideoModelId(currentVideoModelId) ? 3 : 0,
    );
    const supportsVideoAudioOutput = isVideoAudioGenerationSupported(
        currentVideoModelId,
        currentFullVideoModelCapability || currentVideoModelCapability,
        currentVideoCapabilitySet,
    );
    const showVideoReferenceSlot = videoComposerMode !== 'start_end_frame' && currentVideoMaxReferenceVideos > 0;
    const showImageReferenceSlot = currentVideoMaxReferenceImages > 0 || videoComposerMode === 'start_end_frame' || videoComposerMode === 'reference';
    const showAudioReferenceSlot = currentVideoMaxReferenceAudios > 0;
    const firstFrameMedia = videoImages.find((item) => item.frameRole === 'firstFrame') || videoImages[0] || null;
    const lastFrameMedia = videoImages.find((item) => item.frameRole === 'lastFrame') ||
        videoImages.find((item) => item.nodeId !== firstFrameMedia?.nodeId) ||
        null;
    const referenceImageSlotCount = showImageReferenceSlot && videoComposerMode !== 'start_end_frame'
        ? Math.max(
            1,
            Math.min(
                currentVideoMaxReferenceImages || 1,
                videoImages.length + (videoImages.length < (currentVideoMaxReferenceImages || 1) ? 1 : 0),
            ),
        )
        : 0;
    const videoSlotDefinitions: VideoSlotDefinition[] = videoComposerMode === 'start_end_frame'
        ? [
            {
                id: 'firstFrame',
                label: '首帧',
                type: 'image' as const,
                slot: 'firstFrame' as const,
                media: firstFrameMedia,
                disabled: false,
            },
            {
                id: 'lastFrame',
                label: '尾帧',
                type: 'image' as const,
                slot: 'lastFrame' as const,
                media: lastFrameMedia,
                disabled: !firstFrameMedia,
            },
        ]
        : ([
            ...Array.from({ length: referenceImageSlotCount }, (_, index) => ({
                id: `image-${index}`,
                label: '图片',
                type: 'image' as const,
                slot: 'image' as const,
                media: videoImages[index] || null,
                disabled: index > videoImages.length,
            })),
            showVideoReferenceSlot ? {
                id: 'video',
                label: '视频',
                type: 'video' as const,
                slot: 'video' as const,
                media: videoRefs[0] || null,
                extraCount: Math.max(videoRefs.length - 1, 0),
                disabled: false,
            } : null,
            showAudioReferenceSlot ? {
                id: 'audio',
                label: '音频',
                type: 'audio' as const,
                slot: 'audio' as const,
                media: videoAudioRefs[0] || null,
                extraCount: Math.max(videoAudioRefs.length - 1, 0),
                disabled: false,
            } : null,
        ] as Array<VideoSlotDefinition | null>).filter((item): item is VideoSlotDefinition => Boolean(item));
    const hasVideoCapability = Boolean(currentVideoModelCapability && currentVideoCapabilitySet?.supported !== false);
    const imageCreditQuote = useCreateCreditQuote(
        'create_image_generate',
        {
            count: showImageOutputCountSettings ? currentImageBatchCount : 1,
            model: selectedImageTool || currentCanvasImageModel.id,
            aspectRatio: imageAspectRatio,
            resolution: showImageResolutionSettings ? (currentImageResolution || undefined) : undefined,
        },
        composerMode === 'image' && hasComposerPayload,
    );
    const imageActionCredits = hasComposerPayload ? imageCreditQuote.quote?.credits ?? 0 : 0;
    const imageActionCreditsLabel = hasComposerPayload && imageCreditQuote.isLoading ? '...' : String(imageActionCredits);
    const imageCountOptions = useMemo(
        () => Array.from(
            { length: Math.min(currentCanvasImageModel.maxOutputImages || 1, MAX_IMAGE_BATCH_COUNT) },
            (_, index) => index + 1,
        ),
        [currentCanvasImageModel.maxOutputImages],
    );

    useEffect(() => {
        if (!imageAspectRatioOptions.includes(imageAspectRatio)) {
            setImageAspectRatio(
                currentCanvasImageModel.defaultAspectRatio ||
                imageAspectRatioOptions.find((option) => option === '1:1') ||
                imageAspectRatioOptions[0] ||
                '1:1',
            );
        }
    }, [currentCanvasImageModel.defaultAspectRatio, imageAspectRatio, imageAspectRatioOptions]);

    useEffect(() => {
        if (!imageResolutionOptions.includes(imageResolution)) {
            setImageResolution(preferredImageResolution);
        }
    }, [imageResolution, imageResolutionOptions, preferredImageResolution]);

    useEffect(() => {
        const nextCount = normalizeCanvasImageOutputCount(currentCanvasImageModel, imageBatchCount);
        if (nextCount !== imageBatchCount) {
            setImageBatchCount(nextCount);
        }
    }, [currentCanvasImageModel, imageBatchCount]);

    useEffect(() => {
        if (!currentVideoModelId || isLoadingVideoCapabilities) return;
        const supportedMode = availableVideoModeOptions[0];
        const currentModeSupported = availableVideoModeOptions.some((mode) => mode.value === videoComposerMode);
        if (supportedMode && !currentModeSupported) {
            setVideoComposerMode(supportedMode.value);
        }
    }, [availableVideoModeOptions, currentVideoModelId, isLoadingVideoCapabilities, videoComposerMode]);

    useEffect(() => {
        if (currentVideoAspectRatio && currentVideoAspectRatio !== videoAspectRatio) {
            setVideoAspectRatio(currentVideoAspectRatio);
        }
        if (currentVideoResolution && currentVideoResolution !== videoResolution) {
            setVideoResolution(currentVideoResolution);
        }
        if (currentVideoDuration && currentVideoDuration !== videoDuration) {
            setVideoDuration(currentVideoDuration);
        }
        const qualityModes = capabilityOptions(currentVideoCapabilitySet?.qualityModes);
        if (qualityModes.length && !qualityModes.includes(videoQualityMode)) {
            setVideoQualityMode(qualityModes[0]);
        }
        const editModes = videoComposerMode === 'video_edit'
            ? videoEditModeOptions
            : capabilityOptions(currentVideoCapabilitySet?.editModes);
        if (editModes.length && !editModes.includes(videoEditMode)) {
            setVideoEditMode(editModes[0]);
        }
    }, [
        currentVideoAspectRatio,
        currentVideoCapabilitySet,
        currentVideoDuration,
        currentVideoResolution,
        videoComposerMode,
        videoEditModeOptions,
        videoAspectRatio,
        videoDuration,
        videoEditMode,
        videoQualityMode,
        videoResolution,
    ]);

    useEffect(() => {
        if (!supportsVideoAudioOutput && videoGenerateAudio) {
            setVideoGenerateAudio(false);
        }
    }, [supportsVideoAudioOutput, videoGenerateAudio]);

    useEffect(() => {
        pendingVideoAttachSlotRef.current = null;
        setPendingVideoAttachSlot(null);
        setActiveVideoAttachSlotId(null);
        setAssetLibraryMediaFilter(null);
    }, [composerMode, currentVideoModelId, videoComposerMode]);

    const getVideoAttachLimit = (slot: VideoAttachSlot) => {
        if (slot === 'firstFrame' || slot === 'lastFrame') return 1;
        if (slot === 'image') return Math.max(currentVideoMaxReferenceImages || 1, 1);
        if (slot === 'video') return Math.max(currentVideoMaxReferenceVideos || 1, 1);
        return Math.max(currentVideoMaxReferenceAudios || 1, 1);
    };

    const applyVideoAttachmentsForSlot = (
        previous: AttachedMedia[],
        incoming: AttachedMedia[],
        slot: VideoAttachSlot | null,
    ) => {
        if (!slot) return [...previous, ...incoming];
        const mediaType = getVideoAttachMediaType(slot);
        const matching = incoming
            .filter((item) => item.type === mediaType)
            .map((item) => ({ ...item, frameRole: undefined }));
        if (!matching.length) return previous;

        if (slot === 'firstFrame' || slot === 'lastFrame') {
            const role = slot;
            const replacedNodeId = role === 'firstFrame' ? firstFrameMedia?.nodeId : lastFrameMedia?.nodeId;
            return [
                ...previous.filter((item) => item.nodeId !== replacedNodeId && item.frameRole !== role),
                { ...matching[0], frameRole: role },
            ];
        }

        const limit = getVideoAttachLimit(slot);
        const currentCount = previous.filter((item) => item.type === mediaType).length;
        if (limit <= 1) {
            return [
                ...previous.filter((item) => item.type !== mediaType),
                matching[0],
            ];
        }
        const remaining = Math.max(limit - currentCount, 0);
        if (remaining <= 0) return previous;
        return [...previous, ...matching.slice(0, remaining)];
    };

    const handleDragEnter = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);

        const nodeData = e.dataTransfer.getData('application/json');
        if (!nodeData) return;

        try {
            const { nodeId, url, type } = JSON.parse(nodeData);
            if (!url || (type !== 'image' && type !== 'video' && type !== 'audio')) return;

            const nextAttachment = {
                type,
                url,
                nodeId,
                base64: type === 'image' ? await imageUrlToBase64(url) : undefined,
            };
            setAttachedMedia((prev) => applyVideoAttachmentsForSlot(
                prev,
                [nextAttachment],
                composerMode === 'video' ? pendingVideoAttachSlotRef.current : null,
            ));
            updatePendingVideoAttachSlot(null);
        } catch (err) {
            console.error('Failed to parse dropped node data:', err);
        }
    };

    const removeAttachment = (nodeId: string) => {
        setAttachedMedia((prev) => prev.filter((item) => item.nodeId !== nodeId));
    };

    const buildComposerInstruction = () => {
        const imageModelLabel = autoModelPreference
            ? (selectedImagePoolLabels.length ? selectedImagePoolLabels.join(' / ') : selectedImageOption?.label || currentCanvasImageModel.name)
            : (selectedImageOption?.label || currentCanvasImageModel.name);
        const videoModelLabel = autoModelPreference
            ? (selectedVideoPoolLabels.length ? selectedVideoPoolLabels.join(' / ') : selectedVideoOption?.label || currentVideoModelId || selectedVideoTool || 'auto')
            : (selectedVideoOption?.label || currentVideoModelId || selectedVideoTool || 'auto');
        const lines: string[] = [
            '请默认使用简体中文回复，除非用户明确要求其他语言。',
        ];

        if (thinkingModeEnabled) {
            lines.push('启用思考模式：先制定复杂任务计划，再按步骤自主执行；回复中只展示清晰结论和必要步骤，不暴露内部推理。');
        }

        if (composerMode === 'image') {
            lines.push('当前选择图像模式：优先完成图片创作、图片分析、图片生成或图片编辑任务。');
            lines.push([
                '图像生成参数：',
                `模型=${imageModelLabel}`,
                showImageResolutionSettings ? `分辨率=${currentImageResolution || '自动'}` : null,
                `宽高比=${currentImageAspectRatioLabel}`,
                showImageDimensionSettings && currentImageSize ? `尺寸=${currentImageSizeLabel}` : null,
                showImageOutputCountSettings ? `数量=${currentImageBatchCount}张` : null,
            ].filter(Boolean).join('；'));
        } else if (composerMode === 'video') {
            lines.push('当前选择视频模式：优先完成视频脚本、视频生成、分镜或运镜任务。');
            lines.push([
                '视频生成参数：',
                `模型=${videoModelLabel}`,
                `生成方式=${VIDEO_MODE_OPTIONS.find((mode) => mode.value === videoComposerMode)?.label || videoComposerMode}`,
                `画幅=${currentVideoAspectRatio}`,
                videoResolutionOptions.length ? `分辨率=${currentVideoResolution}` : null,
                videoDurationOptions.length ? `时长=${currentVideoDuration}` : null,
                supportsVideoAudioOutput ? `音频=${videoGenerateAudio ? '开启' : '关闭'}` : null,
                webSearchEnabled ? '网络搜索=开启' : null,
                selectedVideoShot ? `基础镜头=${selectedVideoShot}` : null,
            ].filter(Boolean).join('；'));
        } else {
            lines.push('当前选择 Agent 模式：可综合使用 Planner Agent、图片/视频 Creator Agent 和工具调用完成任务。');
        }

        return lines.join('\n');
    };

    const buildVideoPayload = (currentMessage: string, currentMedia: AttachedMedia[]) => {
        const images = currentMedia.filter((item) => item.type === 'image');
        const videos = currentMedia.filter((item) => item.type === 'video');
        const audios = currentMedia.filter((item) => item.type === 'audio');
        const promptBase = currentMessage || 'Generate a video';
        const prompt = selectedVideoShot
            ? `${promptBase}\n基础镜头：${selectedVideoShot}`
            : promptBase;
        const durationSeconds = Number.parseInt(currentVideoDuration.replace(/[^\d]/g, ''), 10) || 5;
        const maxReferenceImages = currentVideoMaxReferenceImages || currentVideoCapabilitySet?.maxReferenceImages || currentVideoModelCapability?.maxReferenceImages || 3;
        const referenceAudioUrls = showAudioReferenceSlot
            ? audios.slice(0, currentVideoMaxReferenceAudios || 3).map(mediaUrlForPayload)
            : [];
        const firstFrame = images.find((item) => item.frameRole === 'firstFrame') || images[0] || null;
        const lastFrame = images.find((item) => item.frameRole === 'lastFrame') ||
            images.find((item) => item.nodeId !== firstFrame?.nodeId) ||
            null;
        const shouldUseMultiReferenceImages = images.length > 0 &&
            videos.length === 0 &&
            supportsVideoMultiReferenceImages &&
            (
                images.length > 1 ||
                (!currentVideoModelCapability?.inputModes.single_reference && !currentVideoModelCapability?.inputModes.text_to_video)
            );
        const basePayload = {
            prompt,
            model: currentVideoModelId,
            aspectRatio: currentVideoAspectRatio,
            resolution: currentVideoResolution,
            duration: durationSeconds,
            generateAudio: supportsVideoAudioOutput ? videoGenerateAudio : false,
            networkSearch: webSearchEnabled,
            qualityMode: videoQualityMode,
            referenceAudioUrls: referenceAudioUrls.length ? referenceAudioUrls : undefined,
        };

        if (videoComposerMode === 'start_end_frame') {
            if (!firstFrame || !lastFrame) throw new Error('首尾帧模式需要上传首帧和尾帧两张图片。');
            return {
                payload: {
                    ...basePayload,
                    videoMode: 'start_end_frame',
                    firstFrameUrl: mediaUrlForPayload(firstFrame),
                    lastFrameUrl: mediaUrlForPayload(lastFrame),
                },
                nodeMode: 'frame-to-frame' as const,
            };
        }

        if (videoComposerMode === 'multi_param' || shouldUseMultiReferenceImages) {
            if (!images.length) throw new Error('多图参考模式需要至少一张参考图。');
            return {
                payload: {
                    ...basePayload,
                    videoMode: 'multi_param',
                    multiReferenceImageUrls: images.slice(0, maxReferenceImages).map(mediaUrlForPayload),
                },
                nodeMode: 'multi-reference' as const,
            };
        }

        if (videoComposerMode === 'video_edit') {
            const effectiveVideoMode = videoEditMode === 'extend' && currentVideoModelCapability?.inputModes.video_extend
                ? 'video_extend'
                : 'video_edit';
            if (!videos.length) throw new Error('视频编辑模式需要上传参考视频。');
            return {
                payload: {
                    ...basePayload,
                    videoMode: effectiveVideoMode,
                    referenceVideoUrls: videos.slice(0, currentVideoCapabilitySet?.maxReferenceVideos || 1).map(mediaUrlForPayload),
                    referenceImageUrl: images[0] ? mediaUrlForPayload(images[0]) : undefined,
                    editMode: videoEditMode,
                },
                nodeMode: effectiveVideoMode === 'video_extend' ? 'video-extend' as const : 'video-edit' as const,
            };
        }

        if (videoComposerMode === 'motion_control') {
            if (!images.length) throw new Error('动作控制模式需要上传角色参考图。');
            return {
                payload: {
                    ...basePayload,
                    videoMode: 'motion_control',
                    motionReferenceVideoUrl: videos[0] ? mediaUrlForPayload(videos[0]) : undefined,
                    referenceVideoUrls: videos.length ? videos.slice(0, currentVideoCapabilitySet?.maxReferenceVideos || 1).map(mediaUrlForPayload) : undefined,
                    characterReferenceImageUrl: mediaUrlForPayload(images[0]),
                    referenceImageUrl: mediaUrlForPayload(images[0]),
                },
                nodeMode: 'motion-control' as const,
            };
        }

        if (videos.length) {
            if (isSeedanceVideoModelId(currentVideoModelId)) {
                return {
                    payload: {
                        ...basePayload,
                        videoMode: images[0] ? 'image_to_video' : 'text_to_video',
                        referenceImageUrl: images[0] ? mediaUrlForPayload(images[0]) : undefined,
                        referenceVideoUrls: videos.slice(0, currentVideoMaxReferenceVideos || 3).map(mediaUrlForPayload),
                    },
                    nodeMode: 'standard' as const,
                };
            }
            const editCap = ['video_edit', 'video_extend'].some((mode) =>
                (videoCapabilities[mode as VideoApiMode] || []).some((item) => item.id === currentVideoModelId),
            );
            const fallbackVideoMode = (videoCapabilities.video_edit || []).some((item) => item.id === currentVideoModelId)
                ? 'video_edit'
                : 'video_extend';
            if (!editCap) throw new Error('当前模型没有开放视频参考输入，请切换到支持视频编辑/参考的模型。');
            return {
                payload: {
                    ...basePayload,
                    videoMode: fallbackVideoMode,
                    referenceVideoUrls: videos.slice(0, 1).map(mediaUrlForPayload),
                    referenceImageUrl: images[0] ? mediaUrlForPayload(images[0]) : undefined,
                    editMode: fallbackVideoMode === 'video_extend' ? 'extend' : 'modify',
                },
                nodeMode: fallbackVideoMode === 'video_extend' ? 'video-extend' as const : 'video-edit' as const,
            };
        }

        return {
            payload: {
                ...basePayload,
                videoMode: images[0] ? 'image_to_video' : 'text_to_video',
                referenceImageUrl: images[0] ? mediaUrlForPayload(images[0]) : undefined,
            },
            nodeMode: 'standard' as const,
        };
    };

    const handleDirectVideoGenerate = async () => {
        if (isGeneratingComposerVideo || isLoading) return;
        if (!onApplyActions) {
            await handleSend();
            return;
        }

        const currentMessage = message.trim();
        const currentMedia = attachedMedia;
        let videoRequest: ReturnType<typeof buildVideoPayload>;
        try {
            videoRequest = buildVideoPayload(currentMessage, currentMedia);
        } catch (err) {
            setVideoCapabilityError(err instanceof Error ? err.message : '视频参数不完整');
            return;
        }

        const nodeId = `agent-video-${Date.now()}`;
        setMessage('');
        setAttachedMedia([]);
        setActiveMenu(null);
        setIsGeneratingComposerVideo(true);
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }

        try {
            await onApplyActions([{
                type: 'create_node',
                node: {
                    id: nodeId,
                    type: 'video',
                    title: '视频',
                    prompt: videoRequest.payload.prompt,
                    status: 'loading',
                    model: currentVideoModelId,
                    videoModel: currentVideoModelId,
                    aspectRatio: currentVideoAspectRatio,
                    resolution: currentVideoResolution,
                    videoDuration: Number.parseInt(currentVideoDuration.replace(/[^\d]/g, ''), 10) || 5,
                    videoMode: videoRequest.nodeMode,
                    generateAudio: supportsVideoAudioOutput ? videoGenerateAudio : false,
                    networkSearch: webSearchEnabled,
                    referenceAudioUrls: videoRequest.payload.referenceAudioUrls,
                },
            } as CanvasAgentAction]);

            const result = await generateVideoWithXiaolou({
                ...videoRequest.payload,
                onTaskIdAssigned: (taskId) => {
                    void onApplyActions([{
                        type: 'update_node',
                        nodeId,
                        updates: { taskId },
                    } as CanvasAgentAction]);
                },
            });

            await onApplyActions([{
                type: 'update_node',
                nodeId,
                updates: {
                    status: 'success',
                    resultUrl: result.resultUrl,
                    taskId: result.taskId,
                    model: result.model || currentVideoModelId,
                    videoModel: result.model || currentVideoModelId,
                },
            } as CanvasAgentAction]);
        } catch (err) {
            await onApplyActions([{
                type: 'update_node',
                nodeId,
                updates: {
                    status: 'error',
                    errorMessage: err instanceof Error ? err.message : '视频生成失败',
                },
            } as CanvasAgentAction]);
        } finally {
            setIsGeneratingComposerVideo(false);
        }
    };

    const handleSend = async () => {
        if ((!message.trim() && attachedMedia.length === 0) || isLoading) return;

        const currentMessage = message.trim();
        const currentMedia = attachedMedia;

        setMessage('');
        setAttachedMedia([]);
        setActiveMenu(null);
        if (textareaRef.current) {
            textareaRef.current.style.height = 'auto';
        }

        const selectedToolId = autoModelPreference
            ? undefined
            : composerMode === 'image'
                ? selectedImageTool
                : composerMode === 'video'
                    ? selectedVideoTool
                    : undefined;
        const selectedToolType = composerMode === 'image'
            ? 'image'
            : composerMode === 'video'
                ? 'video'
                : undefined;
        const allowedImageToolIds = composerMode === 'video' ? undefined : activeImageToolPool;
        const allowedVideoToolIds = composerMode === 'image' ? undefined : activeVideoToolPool;

        await sendMessage(
            currentMessage,
            currentMedia.length > 0
                ? currentMedia.map((item) => ({
                    type: item.type,
                    url: item.url,
                    nodeId: item.nodeId,
                    base64: item.base64,
                }))
                : undefined,
            {
                mode: 'agent',
                model: selectedTextModel || 'auto',
                toolId: selectedToolId,
                toolType: selectedToolType,
                preferredImageToolId: selectedImageTool,
                preferredVideoToolId: selectedVideoTool,
                allowedImageToolIds,
                allowedVideoToolIds,
                autoModelPreference,
                webSearch: webSearchEnabled,
                includeCanvasFiles: canvasFilesEnabled,
                instruction: buildComposerInstruction(),
            },
        );
    };

    const handleNewChat = () => {
        startNewChat();
        setMessage('');
        setAttachedMedia([]);
        setActiveMenu(null);
        setShowConversationMenu(false);
        setShowChineseTip(true);
    };

    const handleLoadSession = async (sessionId: string) => {
        await loadSession(sessionId);
        setShowConversationMenu(false);
        setShowChineseTip(false);
    };

    const handleDeleteSession = async (e: React.MouseEvent, sessionId: string) => {
        e.stopPropagation();
        await deleteSession(sessionId);
    };

    const handleShareChat = async () => {
        try {
            await navigator.clipboard?.writeText(window.location.href);
        } catch {
            // Clipboard permission is optional; sharing will become a server action later.
        }
    };

    const handleShareConversationImage = async () => {
        try {
            const body = messages
                .map((m) => `${m.role === 'user' ? '用户' : '助手'}：${m.content}`)
                .join('\n\n');
            const text = `【${topicTitle}】\n\n${body}`;
            await navigator.clipboard?.writeText(text);
        } catch {
            /* optional */
        }
        setActiveMenu(null);
    };

    const handlePublishConversation = async () => {
        const url = window.location.href;
        if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
            try {
                await navigator.share({
                    title: topicTitle,
                    text: '查看对话',
                    url,
                });
                setActiveMenu(null);
                return;
            } catch {
                /* user cancelled or share failed */
            }
        }
        await handleShareChat();
        setActiveMenu(null);
    };

    const handleUploadFiles = async (files: FileList | null) => {
        const pendingSlot = composerMode === 'video' ? pendingVideoAttachSlotRef.current : null;
        const pendingMediaType = pendingSlot ? getVideoAttachMediaType(pendingSlot) : null;
        const selectedFiles = Array.from(files || []).filter((file) => {
            if (!isMediaFile(file)) return false;
            if (!pendingMediaType) return true;
            return file.type.startsWith(`${pendingMediaType}/`);
        });
        if (!selectedFiles.length) {
            updatePendingVideoAttachSlot(null);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
            return;
        }

        const nextAttachments = await Promise.all(selectedFiles.map(async (file, index) => {
            const isImage = file.type.startsWith('image/');
            const isAudio = file.type.startsWith('audio/');
            const url = await readFileAsDataUrl(file);
            return {
                type: isImage ? 'image' as const : isAudio ? 'audio' as const : 'video' as const,
                url,
                nodeId: `upload-${Date.now()}-${index}-${file.name}`,
                base64: isImage ? url.split(',')[1] || undefined : undefined,
            };
        }));

        setAttachedMedia((prev) => applyVideoAttachmentsForSlot(prev, nextAttachments, pendingSlot));
        setActiveMenu(null);
        updatePendingVideoAttachSlot(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleAssetLibrarySelect = async (url: string, type: 'image' | 'video' | 'audio') => {
        const nextAttachment = {
            type,
            url,
            nodeId: `library-${Date.now()}`,
            base64: type === 'image' ? await imageUrlToBase64(url) : undefined,
        };
        setAttachedMedia((prev) => applyVideoAttachmentsForSlot(
            prev,
            [nextAttachment],
            composerMode === 'video' ? pendingVideoAttachSlotRef.current : null,
        ));
        updatePendingVideoAttachSlot(null);
        setAssetLibraryMediaFilter(null);
        setShowAssetLibrary(false);
    };

    const handleSkillSelect = (prompt: string) => {
        setMessage((prev) => {
            const trimmed = prev.trim();
            return trimmed ? `${trimmed}\n${prompt}` : prompt;
        });
        setActiveMenu(null);
        textareaRef.current?.focus();
    };

    const handleThinkingClick = () => {
        if (thinkingConfirmNeverAsk) {
            setThinkingModeEnabled(true);
            setComposerMode('agent');
            handleNewChat();
            return;
        }
        setShowThinkingConfirm(true);
    };

    const confirmThinkingNewChat = () => {
        if (thinkingConfirmNeverAsk) {
            window.localStorage.setItem('xiaolou.agentCanvas.skipThinkingConfirm', 'true');
        }
        setThinkingModeEnabled(true);
        setComposerMode('agent');
        setShowThinkingConfirm(false);
        handleNewChat();
    };

    const handlePickFromCanvas = (slot?: VideoAttachSlot) => {
        if (slot) {
            updatePendingVideoAttachSlot(slot);
        }
        setActiveMenu(null);
        setIsDragOver(true);
        textareaRef.current?.focus();
        window.setTimeout(() => setIsDragOver(false), 1400);
    };

    if (!isOpen) return null;

    const showHighlight = isDraggingNode || isDragOver;
    const topicTitle = topic || (hasMessages ? '新的对话' : '智能体画布');
    const normalizedHistorySearch = historySearch.trim().toLowerCase();
    const visibleSessions = sessions.filter((session) => {
        if (!normalizedHistorySearch) return true;
        return session.topic.toLowerCase().includes(normalizedHistorySearch);
    });
    const activeMode = COMPOSER_MODES.find((item) => item.value === composerMode) || COMPOSER_MODES[0];
    const ActiveModeIcon = activeMode.icon;
    const visibleSkills = SKILLS.filter((skill) => skill.category === skillCategory);
    const activeModelOptions = composerMode === 'image'
        ? imageModelOptions
        : composerMode === 'video'
            ? videoModelOptions
            : textModelOptions;
    const activeModelId = composerMode === 'image'
        ? selectedImageTool
        : composerMode === 'video'
            ? selectedVideoTool
            : selectedTextModel;
    const activeModelOption = activeModelOptions.find((option) => option.id === activeModelId);
    const modelPreferenceOptions = modelPreferenceTab === 'image'
        ? imageModelOptions
        : modelPreferenceTab === 'video'
            ? videoModelOptions
            : [];
    const modelPreferenceSelectedId = modelPreferenceTab === 'image'
        ? selectedImageTool
        : modelPreferenceTab === 'video'
            ? selectedVideoTool
            : '';
    const activeModelTooltip = '模型偏好';
    const hasRequiredVideoPayload = (() => {
        if (!hasComposerPayload) return false;
        if (videoComposerMode === 'start_end_frame') return videoImages.length >= 2;
        if (videoComposerMode === 'multi_param') return videoImages.length > 0;
        if (videoComposerMode === 'video_edit') return videoRefs.length > 0;
        if (videoComposerMode === 'motion_control') return videoImages.length > 0;
        return Boolean(message.trim() || attachedMedia.length > 0);
    })();
    const isActionDisabled = composerMode === 'agent'
        ? isLoading
        : composerMode === 'video'
            ? isLoading || isGeneratingComposerVideo || isLoadingVideoCapabilities || !hasRequiredVideoPayload || !hasVideoCapability
            : isLoading || !hasComposerPayload;
    const actionTooltip = composerMode === 'agent'
        ? '语音输入'
        : composerMode === 'image'
            ? hasComposerPayload ? '生成图像' : '请输入提示词'
            : !hasVideoCapability
                ? '当前模型无可用视频能力'
                : hasRequiredVideoPayload ? '生成视频' : '请补充视频素材或提示词';
    const composerFileAccept = getVideoAttachAccept(pendingVideoAttachSlot) ||
        (composerMode === 'image'
        ? 'image/*'
        : composerMode === 'video'
            ? ['image/*', showVideoReferenceSlot ? 'video/*' : null, showAudioReferenceSlot ? 'audio/*' : null]
                .filter(Boolean)
                .join(',')
            : 'image/*,video/*');

    const openLocalUploadForVideoSlot = (slot: VideoAttachSlot) => {
        updatePendingVideoAttachSlot(slot);
        setActiveMenu(null);
        window.setTimeout(() => fileInputRef.current?.click(), 0);
    };

    const openAssetLibraryForVideoSlot = (slot: VideoAttachSlot) => {
        updatePendingVideoAttachSlot(slot);
        setAssetLibraryMediaFilter(getVideoAttachMediaType(slot));
        setActiveMenu(null);
        setShowAssetLibrary(true);
    };

    const toggleVideoAttachMenu = (slotId: string, slot: VideoAttachSlot, disabled?: boolean) => {
        if (disabled) return;
        const isSameSlot = activeMenu === 'videoAttach' && activeVideoAttachSlotId === slotId;
        updatePendingVideoAttachSlot(isSameSlot ? null : slot);
        setActiveVideoAttachSlotId(isSameSlot ? null : slotId);
        setActiveMenu(isSameSlot ? null : 'videoAttach');
    };

    const renderVideoAttachMenu = (slot: VideoAttachSlot) => {
        const mediaType = getVideoAttachMediaType(slot);
        const uploadLabel = mediaType === 'video'
            ? '从本地上传视频'
            : mediaType === 'audio'
                ? '音频'
                : '从本地上传图片';
        return (
            <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-[212px] rounded-xl border border-neutral-100 bg-white p-2 shadow-2xl" data-agent-active-menu-root>
                <button
                    type="button"
                    onClick={() => openLocalUploadForVideoSlot(slot)}
                    className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm text-neutral-900 hover:bg-neutral-50"
                >
                    <Paperclip size={16} />
                    {uploadLabel}
                </button>
                <button
                    type="button"
                    onClick={() => openAssetLibraryForVideoSlot(slot)}
                    className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-neutral-900 hover:bg-neutral-50"
                >
                    <Users size={16} className="mt-0.5 shrink-0" />
                    <span className="min-w-0">
                        <span className="block whitespace-nowrap">从素材库选择</span>
                        {mediaType === 'audio' && (
                            <span className="mt-0.5 block text-xs leading-4 text-neutral-400">
                                角色素材需通过素材库审核后方可使用
                            </span>
                        )}
                    </span>
                </button>
                {mediaType !== 'audio' && (
                    <button
                        type="button"
                        onClick={() => handlePickFromCanvas(slot)}
                        className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm text-neutral-900 hover:bg-neutral-50"
                    >
                        <MousePointer2 size={16} />
                        从画布选择
                    </button>
                )}
            </div>
        );
    };

    const handleComposerAction = () => {
        if (composerMode === 'agent' && !hasComposerPayload) {
            textareaRef.current?.focus();
            return;
        }

        if (composerMode === 'video') {
            void handleDirectVideoGenerate();
            return;
        }

        void handleSend();
    };

    const getVideoFloatingPanelStyle = (fallbackWidth: number): React.CSSProperties => {
        if (videoFloatingMenuLayout) {
            return {
                left: videoFloatingMenuLayout.left,
                bottom: videoFloatingMenuLayout.bottom,
                width: videoFloatingMenuLayout.width,
                maxHeight: videoFloatingMenuLayout.maxHeight,
            };
        }

        return {
            right: FLOATING_MENU_PADDING,
            bottom: 72,
            width: `min(${fallbackWidth}px, calc(100vw - ${FLOATING_MENU_PADDING * 2}px))`,
            maxHeight: `calc(100vh - ${FLOATING_MENU_PADDING * 2}px)`,
        };
    };

    const videoFloatingPanelClass = 'fixed z-50 overflow-y-auto rounded-2xl border border-border bg-card text-card-foreground shadow-[0_18px_60px_rgba(0,0,0,0.24)]';
    const videoFloatingHeadingClass = 'mb-3 text-sm font-semibold text-foreground';
    const videoSectionLabelClass = 'text-sm font-medium text-muted-foreground';
    const videoSegmentClass = 'flex flex-nowrap overflow-x-auto rounded-xl bg-muted p-0.5';
    const videoSegmentButtonClass = (selected: boolean) => `h-8 min-w-max flex-1 whitespace-nowrap rounded-lg px-3 text-sm transition-colors ${
        selected ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
    }`;
    const videoChoiceButtonClass = (selected: boolean, extra = '') => `${extra} rounded-xl border transition-colors ${
        selected
            ? 'border-primary/40 bg-primary/10 text-foreground shadow-sm'
            : 'border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground'
    }`;
    const videoChipButtonClass = (selected: boolean) => `h-9 rounded-full border px-3 text-sm transition-colors ${
        selected
            ? 'border-primary/40 bg-primary/10 text-foreground shadow-sm'
            : 'border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground'
    }`;
    const videoToggleRowClass = 'flex items-center justify-between rounded-xl bg-muted px-3 py-2';
    const videoToggleButtonClass = (checked: boolean) => `flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${
        checked ? 'bg-primary' : 'bg-border'
    }`;

    return (
        <div
            className={`agent-chat-panel fixed right-0 top-0 z-[90] flex h-full w-[400px] flex-col border-l bg-card text-card-foreground shadow-2xl transition-all duration-300 ${showHighlight ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {showHighlight && (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-blue-500/10">
                    <div className="rounded-2xl border-2 border-dashed border-blue-400 bg-white/95 px-8 py-6 text-center shadow-lg">
                        <Sparkles className="mx-auto mb-2 h-10 w-10 text-blue-500" />
                        <p className="font-medium text-blue-700">将图片或视频拖到这里作为参考</p>
                    </div>
                </div>
            )}

            <header className="relative flex h-12 shrink-0 items-center justify-between border-b border-neutral-100 px-4">
                <h2 className="min-w-0 truncate text-sm font-semibold text-neutral-950">
                    {topicTitle}
                </h2>

                <div className="flex items-center gap-1">
                    <div className="relative flex items-center" data-agent-conversation-menu-root>
                        <Tooltip label="新建对话" placement="bottom">
                            <button
                                type="button"
                                onClick={handleNewChat}
                                className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-700 transition-colors hover:bg-neutral-100"
                                aria-label="新建对话"
                            >
                                <MessageSquarePlus size={15} />
                            </button>
                        </Tooltip>
                        <button
                            type="button"
                            onClick={() => setShowConversationMenu((value) => !value)}
                            className={`flex h-8 w-5 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 ${showConversationMenu ? 'bg-neutral-100' : ''}`}
                            aria-label="展开历史对话"
                        >
                            <ChevronDown
                                size={14}
                                className={`transition-transform ${showConversationMenu ? 'rotate-180' : ''}`}
                            />
                        </button>

                        {showConversationMenu && (
                            <div className="absolute right-0 top-10 z-50 w-72 rounded-2xl border border-neutral-100 bg-white p-3 shadow-2xl">
                                <div className="px-1 pb-3 text-sm font-semibold text-neutral-950">历史对话</div>
                                <label className="mb-2 flex h-10 items-center gap-2 rounded-lg border border-neutral-200 px-3 text-neutral-400">
                                    <Search size={15} />
                                    <input
                                        value={historySearch}
                                        onChange={(e) => setHistorySearch(e.target.value)}
                                        placeholder="请输入搜索关键词"
                                        className="min-w-0 flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
                                    />
                                </label>
                                <div className="max-h-64 space-y-1 overflow-y-auto">
                                    {isLoadingSessions ? (
                                        <div className="flex h-16 items-center justify-center">
                                            <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
                                        </div>
                                    ) : visibleSessions.length > 0 ? (
                                        visibleSessions.map((session: ChatSession) => (
                                            <div
                                                key={session.id}
                                                role="button"
                                                tabIndex={0}
                                                onClick={() => handleLoadSession(session.id)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                        e.preventDefault();
                                                        handleLoadSession(session.id);
                                                    }
                                                }}
                                                className="group flex w-full items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-left transition-colors hover:bg-neutral-100"
                                            >
                                                <MessageSquare size={14} className="shrink-0 text-neutral-500" />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-sm text-neutral-900">
                                                        {session.topic}
                                                    </span>
                                                    <span className="block text-xs text-neutral-400">
                                                        {session.messageCount} 条消息 · {formatDate(session.updatedAt || session.createdAt)}
                                                    </span>
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={(e) => handleDeleteSession(e, session.id)}
                                                    className="rounded-md p-1 text-neutral-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                                                    aria-label="删除对话"
                                                >
                                                    <Trash2 size={13} />
                                                </button>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
                                            {topicTitle}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="relative" data-agent-active-menu-root>
                        <Tooltip label="分享对话" placement="bottom">
                            <button
                                type="button"
                                onClick={() => {
                                    setShowConversationMenu(false);
                                    setActiveMenu((m) => (m === 'share' ? null : 'share'));
                                }}
                                className={`flex h-8 w-8 items-center justify-center rounded-lg text-neutral-700 transition-colors ${
                                    activeMenu === 'share' ? 'bg-neutral-100' : 'hover:bg-neutral-100'
                                }`}
                                aria-label="分享对话"
                                aria-expanded={activeMenu === 'share'}
                            >
                                <Share2 size={15} />
                            </button>
                        </Tooltip>
                        {activeMenu === 'share' && (
                            <div
                                className={`absolute right-0 top-full z-50 mt-1.5 w-[min(100vw-1.5rem,24rem)] rounded-2xl px-3.5 py-2.5 text-left shadow-[0_8px_32px_rgba(0,0,0,0.12)] ${
                                    isDark
                                        ? 'border border-zinc-600/80 bg-zinc-900 text-zinc-100'
                                        : 'border border-neutral-200/90 bg-white text-neutral-950'
                                }`}
                                role="dialog"
                                aria-label="分享当前对话"
                            >
                                <h3
                                    className={`text-base font-bold leading-tight tracking-tight ${
                                        isDark ? 'text-zinc-50' : 'text-neutral-950'
                                    }`}
                                >
                                    分享当前对话
                                </h3>
                                <div
                                    className={`mt-1.5 flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 ${
                                        isDark
                                            ? 'bg-zinc-800/95 ring-1 ring-inset ring-white/10'
                                            : 'bg-[#f5f5f5]'
                                    }`}
                                >
                                    <AlertCircle
                                        className={`h-5 w-5 shrink-0 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}
                                        strokeWidth={2}
                                        aria-hidden
                                    />
                                    <div className="min-w-0 flex-1">
                                        <p
                                            className={`text-sm font-bold leading-tight ${
                                                isDark ? 'text-zinc-50' : 'text-neutral-900'
                                            }`}
                                        >
                                            公开浏览权限
                                        </p>
                                        <div
                                            className={`mt-0.5 text-xs font-normal leading-[1.35] ${
                                                isDark ? 'text-zinc-400' : 'text-neutral-600'
                                            }`}
                                        >
                                            <p>有链接的人可以浏览对话内容，不可编辑</p>
                                            <p className="mt-0.5">分享后的对话过程，在分享链接内同步</p>
                                        </div>
                                    </div>
                                </div>
                                <div className="mt-1.5 grid grid-cols-3 items-stretch gap-1.5">
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            await handleShareChat();
                                            setActiveMenu(null);
                                        }}
                                        className={`flex min-h-12 w-full min-w-0 flex-row items-center justify-center gap-1.5 rounded-xl border px-1.5 py-2.5 text-xs font-medium leading-tight ${
                                            isDark
                                                ? 'border-zinc-600 bg-zinc-900/80 text-zinc-100 hover:bg-zinc-800'
                                                : 'border-neutral-200 bg-white text-neutral-950 hover:bg-neutral-50'
                                        }`}
                                    >
                                        <Link2 className="h-5 w-5 shrink-0" strokeWidth={1.8} />
                                        <span className="min-w-0 text-balance text-center text-xs font-medium leading-tight">
                                            复制对话链接
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void handleShareConversationImage()}
                                        className={`flex min-h-12 w-full min-w-0 flex-row items-center justify-center gap-1.5 rounded-xl border px-1.5 py-2.5 text-xs font-medium leading-tight ${
                                            isDark
                                                ? 'border-zinc-600 bg-zinc-900/80 text-zinc-100 hover:bg-zinc-800'
                                                : 'border-neutral-200 bg-white text-neutral-950 hover:bg-neutral-50'
                                        }`}
                                    >
                                        <ImageIcon className="h-5 w-5 shrink-0" strokeWidth={1.8} />
                                        <span className="min-w-0 text-balance text-center text-xs font-medium leading-tight">
                                            分享对话图片
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => void handlePublishConversation()}
                                        className="flex min-h-12 w-full min-w-0 flex-row items-center justify-center gap-1.5 rounded-xl border border-[#222] bg-[#222] px-1.5 py-2.5 text-xs font-medium leading-tight text-white"
                                    >
                                        <Send className="h-5 w-5 shrink-0 text-white" strokeWidth={1.8} />
                                        <span className="min-w-0 text-balance text-center text-xs font-medium leading-tight">
                                            发布对话
                                        </span>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <Tooltip label="收起" placement="bottom">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-700 transition-colors hover:bg-neutral-100"
                            aria-label="收起"
                        >
                            <PanelRightClose size={16} />
                        </button>
                    </Tooltip>
                </div>
            </header>

            <main className="flex-1 overflow-y-auto px-4 pb-4 pt-3">
                {!hasMessages ? (
                    <div className="flex min-h-[48vh] flex-col items-center justify-center text-center">
                        <h1 className="text-3xl font-bold tracking-normal text-neutral-950">你好</h1>
                        <p className="mt-4 max-w-[260px] text-sm leading-6 text-neutral-500">
                            输入你的设计需求，我会默认用中文回复，并帮助你整理画布、生成图片或视频。
                        </p>
                    </div>
                ) : (
                    <div className="space-y-5">
                        {messages.map((msg: ChatMessageType) => (
                            <ChatMessage
                                key={msg.id}
                                role={msg.role}
                                content={msg.content}
                                media={msg.media}
                                timestamp={msg.timestamp}
                            />
                        ))}
                    </div>
                )}

                {isLoading && (
                    <div className="mt-4 flex items-center gap-2 text-sm text-neutral-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        正在生成回复...
                    </div>
                )}

                {error && (
                    <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-600">
                        {error}
                    </div>
                )}

                <div ref={messagesEndRef} />
            </main>

            <footer className="shrink-0 bg-white px-2 pb-2">
                {showChineseTip && (
                    <div
                        className={`mx-1 mb-1 flex items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-xs ${
                            isDark
                                ? 'border-emerald-400/20 bg-emerald-950/35 text-emerald-100'
                                : 'border-lime-200 bg-lime-50 text-[#2f3d13]'
                        }`}
                    >
                        <span className="inline-flex min-w-0 items-center gap-2">
                            <span
                                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                                    isDark ? 'bg-emerald-400/20 text-emerald-50' : 'bg-lime-300 text-[#15200a]'
                                }`}
                            >
                                +
                            </span>
                            <span className="truncate">已默认使用中文回复，可切换 Agent / 图像 / 视频模式</span>
                        </span>
                        <button
                            type="button"
                            onClick={() => setShowChineseTip(false)}
                            className={`rounded-md p-0.5 transition-colors ${
                                isDark
                                    ? 'text-emerald-100/70 hover:bg-emerald-400/10 hover:text-emerald-50'
                                    : 'text-[#5f6f1d] hover:bg-lime-100 hover:text-[#15200a]'
                            }`}
                            aria-label="关闭提示"
                        >
                            <X size={14} />
                        </button>
                    </div>
                )}

                <div className="relative rounded-[22px] border border-neutral-200 bg-white px-3 pb-3 pt-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
                    {showThinkingConfirm && (
                        <div className="absolute bottom-[54px] left-10 right-5 z-50 rounded-xl border border-neutral-200 bg-white p-5 shadow-2xl" data-agent-thinking-menu-root>
                            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-950">
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-xs text-white">!</span>
                                新建对话？
                            </div>
                            <p className="mb-4 text-sm leading-6 text-neutral-700">
                                切换模式会新建对话。您可以随时从历史列表中访问此对话。
                            </p>
                            <label className="mb-5 flex items-center gap-2 text-sm text-neutral-900">
                                <span>不再询问</span>
                                <button
                                    type="button"
                                    onClick={() => setThinkingConfirmNeverAsk((value) => !value)}
                                    className={`relative h-4 w-8 rounded-full transition-colors ${thinkingConfirmNeverAsk ? 'bg-neutral-950' : 'bg-neutral-200'}`}
                                    aria-pressed={thinkingConfirmNeverAsk}
                                >
                                    <span
                                        className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${thinkingConfirmNeverAsk ? 'translate-x-4' : 'translate-x-0.5'}`}
                                    />
                                </button>
                            </label>
                            <div className="flex justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowThinkingConfirm(false)}
                                    className="rounded-lg bg-neutral-100 px-5 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-200"
                                >
                                    取消
                                </button>
                                <button
                                    type="button"
                                    onClick={confirmThinkingNewChat}
                                    className="rounded-lg bg-neutral-950 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800"
                                >
                                    新建
                                </button>
                            </div>
                        </div>
                    )}

                    {attachedMedia.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-2">
                            {attachedMedia.map((media) => {
                                const Icon = media.type === 'video'
                                    ? Video
                                    : media.type === 'audio'
                                        ? AudioLines
                                        : ImageIcon;
                                return (
                                    <div
                                        key={media.nodeId}
                                        className="flex max-w-[150px] items-center gap-1 rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-700"
                                    >
                                        <Icon size={13} className="shrink-0" />
                                        <span className="min-w-0 truncate">{media.nodeId}</span>
                                        <button
                                            type="button"
                                            onClick={() => removeAttachment(media.nodeId)}
                                            className="rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-900"
                                            aria-label="移除附件"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {composerMode === 'agent' ? (
                        <textarea
                            ref={textareaRef}
                            value={message}
                            onChange={(e) => setMessage(e.target.value)}
                            placeholder="请输入你的设计需求"
                            className="max-h-[128px] min-h-[32px] w-full resize-none bg-transparent text-sm leading-6 text-neutral-950 outline-none placeholder:text-neutral-400"
                            rows={1}
                            disabled={isLoading}
                            onInput={(e) => {
                                const target = e.target as HTMLTextAreaElement;
                                target.style.height = 'auto';
                                const newHeight = Math.min(target.scrollHeight, 128);
                                target.style.height = `${newHeight}px`;
                                target.style.overflowY = target.scrollHeight > 128 ? 'auto' : 'hidden';
                            }}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                        />
                    ) : (
                        <div className="mb-1 flex min-h-[128px] flex-col gap-3">
                            {composerMode === 'video' ? (
                                <div className="flex flex-col items-start gap-2">
                                    <div className="flex max-w-[300px] flex-wrap gap-2">
                                        {videoSlotDefinitions.map((slot) => {
                                            const media = slot.media || null;
                                            const SlotIcon = getVideoSlotIcon(slot.type);
                                            return (
                                                <div key={slot.id} className="relative" data-agent-active-menu-root>
                                                    <button
                                                        type="button"
                                                        onClick={() => toggleVideoAttachMenu(slot.id, slot.slot, slot.disabled)}
                                                        disabled={slot.disabled}
                                                        className={`relative flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl text-xs font-medium leading-tight transition-colors ${slot.disabled
                                                            ? 'cursor-not-allowed bg-neutral-100/55 text-neutral-300'
                                                            : activeMenu === 'videoAttach' && activeVideoAttachSlotId === slot.id
                                                                ? 'bg-neutral-200 text-neutral-800'
                                                                : 'bg-neutral-100/80 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
                                                        }`}
                                                        aria-label={`添加${slot.label}`}
                                                    >
                                                        {media ? (
                                                            media.type === 'image' ? (
                                                                <img src={media.url} alt="" className="h-full w-full object-cover" />
                                                            ) : media.type === 'video' ? (
                                                                <Film size={16} />
                                                            ) : (
                                                                <AudioLines size={16} />
                                                            )
                                                        ) : (
                                                            <>
                                                                <SlotIcon size={16} />
                                                                <span className="max-w-[3.5rem] truncate text-center">{slot.label}</span>
                                                            </>
                                                        )}
                                                        {!!slot.extraCount && slot.extraCount > 0 && (
                                                            <span className="absolute right-0.5 top-0.5 rounded-full bg-neutral-900 px-1 py-0.5 text-[9px] font-semibold text-white">
                                                                +{slot.extraCount}
                                                            </span>
                                                        )}
                                                    </button>
                                                    {activeMenu === 'videoAttach' && activeVideoAttachSlotId === slot.id && renderVideoAttachMenu(slot.slot)}
                                                </div>
                                            );
                                        })}
                                    </div>
                                    {selectedVideoShot && (
                                        <button
                                            type="button"
                                            onClick={() => setActiveMenu((value) => value === 'videoShot' ? null : 'videoShot')}
                                            className="inline-flex max-w-[260px] items-center gap-1 rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-sm text-neutral-950 shadow-sm hover:bg-neutral-50"
                                            title="基础镜头"
                                        >
                                            <span className="truncate">{selectedVideoShot}</span>
                                            <ChevronDown size={12} className={`shrink-0 transition-transform ${activeMenu === 'videoShot' ? 'rotate-180' : ''}`} />
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className="relative w-fit" data-agent-active-menu-root>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setActiveMenu((value) => value === 'imageAttach' ? null : 'imageAttach');
                                        }}
                                        className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-neutral-300 transition-colors hover:text-neutral-500 ${activeMenu === 'imageAttach' ? 'bg-neutral-100' : 'bg-neutral-100/80 hover:bg-neutral-100'}`}
                                        aria-label="添加图片参考"
                                    >
                                        <Plus size={20} strokeWidth={1.7} />
                                    </button>

                                    {activeMenu === 'imageAttach' && composerMode === 'image' && (
                                        <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-[174px] rounded-xl border border-neutral-100 bg-white p-2 shadow-2xl" data-agent-active-menu-root>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setActiveMenu(null);
                                                    updatePendingVideoAttachSlot(null);
                                                    window.setTimeout(() => fileInputRef.current?.click(), 0);
                                                }}
                                                className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm text-neutral-900 hover:bg-neutral-50"
                                            >
                                                <Paperclip size={16} />
                                                从本地上传图片
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setActiveMenu(null);
                                                    updatePendingVideoAttachSlot(null);
                                                    setAssetLibraryMediaFilter('image');
                                                    setShowAssetLibrary(true);
                                                }}
                                                className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm text-neutral-900 hover:bg-neutral-50"
                                            >
                                                <Users size={16} />
                                                从素材库选择
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handlePickFromCanvas()}
                                                className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm text-neutral-900 hover:bg-neutral-50"
                                            >
                                                <MousePointer2 size={16} />
                                                从画布选择
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}
                            <textarea
                                ref={textareaRef}
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder={composerMode === 'image' ? '今天我们要创作什么' : '今天我们要制作什么视频'}
                                className="max-h-[72px] min-h-[44px] w-full resize-none bg-transparent text-sm leading-6 text-neutral-950 outline-none placeholder:text-neutral-400"
                                rows={3}
                                disabled={isLoading}
                                onInput={(e) => {
                                    const target = e.target as HTMLTextAreaElement;
                                    target.style.height = 'auto';
                                    const newHeight = Math.min(target.scrollHeight, 72);
                                    target.style.height = `${newHeight}px`;
                                    target.style.overflowY = target.scrollHeight > 72 ? 'auto' : 'hidden';
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey) {
                                        e.preventDefault();
                                        handleSend();
                                    }
                                }}
                            />
                        </div>
                    )}

                    <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="agent-chat-composer-controls flex min-w-0 items-center gap-1.5">
                            {composerMode === 'agent' && (
                                <>
                                    <div className="group relative" data-agent-active-menu-root>
                                        <Tooltip label="更多">
                                            <button
                                                type="button"
                                                onClick={() => setActiveMenu((value) => value === 'more' ? null : 'more')}
                                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${activeMenu === 'more' ? 'bg-neutral-100 text-neutral-950' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
                                                aria-label="更多"
                                            >
                                                <Plus size={17} />
                                            </button>
                                        </Tooltip>

                                        {activeMenu === 'more' && (
                                            <div className="absolute bottom-11 left-0 z-50 w-60 rounded-xl border border-neutral-100 bg-white p-2 shadow-2xl">
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        updatePendingVideoAttachSlot(null);
                                                        setAssetLibraryMediaFilter(null);
                                                        window.setTimeout(() => fileInputRef.current?.click(), 0);
                                                    }}
                                                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-neutral-900 hover:bg-neutral-50"
                                                >
                                                    <Paperclip size={16} />
                                                    上传文件
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setActiveMenu(null);
                                                        updatePendingVideoAttachSlot(null);
                                                        setAssetLibraryMediaFilter(null);
                                                        setShowAssetLibrary(true);
                                                    }}
                                                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-neutral-900 hover:bg-neutral-50"
                                                >
                                                    <Users size={16} />
                                                    从素材库选择
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setCanvasFilesEnabled((value) => !value);
                                                    }}
                                                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm text-neutral-900 transition-colors ${canvasFilesEnabled ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
                                                    aria-pressed={canvasFilesEnabled}
                                                >
                                                    <span className="flex items-center gap-3">
                                                        <Box size={16} />
                                                        读取画布文件
                                                    </span>
                                                    {canvasFilesEnabled && <Check size={15} />}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setWebSearchEnabled((value) => !value);
                                                    }}
                                                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm text-neutral-900 transition-colors ${webSearchEnabled ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
                                                    aria-pressed={webSearchEnabled}
                                                >
                                                    <span className="flex items-center gap-3">
                                                        <Globe2 size={16} />
                                                        联网搜索
                                                    </span>
                                                    <SwitchIndicator checked={webSearchEnabled} />
                                                </button>
                                            </div>
                                        )}
                                    </div>

                                    <div className="relative" data-agent-active-menu-root>
                                        <Tooltip label="Skills">
                                            <button
                                                type="button"
                                                onClick={() => setActiveMenu((value) => value === 'skills' ? null : 'skills')}
                                                className={menuButtonClass(activeMenu === 'skills')}
                                                aria-label="Skills"
                                            >
                                                <BookOpen size={16} />
                                            </button>
                                        </Tooltip>

                                        {activeMenu === 'skills' && (
                                            <div className="absolute bottom-11 left-[-48px] z-50 w-[392px] rounded-xl border border-neutral-100 bg-white p-4 shadow-2xl">
                                        <div className="mb-3 text-sm font-semibold text-neutral-950">Skills</div>
                                        <div className="mb-3 flex gap-2 overflow-x-auto pb-1">
                                            {SKILL_CATEGORIES.map((category) => (
                                                <button
                                                    key={category.id}
                                                    type="button"
                                                    onClick={() => setSkillCategory(category.id)}
                                                    className={`inline-flex h-8 shrink-0 items-center rounded-lg border px-3 text-xs transition-colors ${skillCategory === category.id
                                                        ? 'border-neutral-900 bg-neutral-950 text-white'
                                                        : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                                                        }`}
                                                >
                                                    {category.label}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                                            <div className="flex items-start gap-3 rounded-xl bg-neutral-50 px-3 py-3 text-neutral-400">
                                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white">
                                                    <BookOpen size={15} />
                                                </div>
                                                <div>
                                                    <div className="text-sm">基于此对话创建 Skill</div>
                                                    <div className="mt-1 text-xs">在 Thinking 模式下将对话总结为可复用的 Skill</div>
                                                </div>
                                            </div>
                                            {visibleSkills.map((skill) => (
                                                <button
                                                    key={skill.id}
                                                    type="button"
                                                    onClick={() => handleSkillSelect(skill.prompt)}
                                                    className="flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-neutral-50"
                                                >
                                                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600">
                                                        <Video size={15} />
                                                    </span>
                                                    <span className="min-w-0">
                                                        <span className="block text-sm font-medium text-neutral-950">{skill.title}</span>
                                                        <span className="mt-1 block text-xs leading-5 text-neutral-500">{skill.description}</span>
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}

                            <div className="relative" data-agent-active-menu-root>
                                <button
                                    type="button"
                                    onClick={() => setActiveMenu((value) => value === 'mode' ? null : 'mode')}
                                    className={composerMode === 'video'
                                        ? `flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-transparent px-0.5 text-sm font-semibold whitespace-nowrap text-neutral-800 transition-colors ${activeMenu === 'mode' ? 'bg-neutral-100 text-neutral-950' : 'hover:bg-neutral-100'}`
                                        : `flex h-8 shrink-0 items-center gap-1 rounded-xl px-2.5 text-sm whitespace-nowrap transition-colors ${activeMenu === 'mode' ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-800 hover:bg-neutral-100'}`
                                    }
                                    aria-label="选择模式"
                                >
                                    {composerMode === 'video' ? (
                                        <span className="relative flex h-[19px] w-[20px] shrink-0 items-center justify-center">
                                            <Video size={18} strokeWidth={2.1} />
                                            <Sparkles size={8} strokeWidth={2.2} className="absolute -right-0.5 -top-0.5" />
                                        </span>
                                    ) : (
                                        <ActiveModeIcon size={15} className="shrink-0" />
                                    )}
                                    <span className="agent-chat-fit-label">{activeMode.label}</span>
                                    <ChevronDown
                                        size={composerMode === 'video' ? 14 : 13}
                                        className={`shrink-0 transition-transform ${activeMenu === 'mode' ? 'rotate-180' : ''}`}
                                    />
                                </button>

                                {activeMenu === 'mode' && (
                                    <div className="absolute bottom-11 left-0 z-50 w-48 rounded-xl border border-neutral-100 bg-white p-2 shadow-2xl">
                                        {COMPOSER_MODES.map((mode) => {
                                            const Icon = mode.icon;
                                            const selected = composerMode === mode.value;
                                            return (
                                                <button
                                                    key={mode.value}
                                                    type="button"
                                                    onClick={() => {
                                                        setComposerMode(mode.value);
                                                        if (mode.value === 'image' || mode.value === 'video') {
                                                            setModelPreferenceTab(mode.value);
                                                        }
                                                        setActiveMenu(null);
                                                    }}
                                                    className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm text-neutral-900 hover:bg-neutral-50"
                                                >
                                                    <span className="flex items-center gap-3">
                                                        <Icon size={16} />
                                                        {mode.label}
                                                    </span>
                                                    {selected && <Check size={15} />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {composerMode === 'image' && (
                                <div className="relative" data-agent-active-menu-root>
                                    <button
                                        type="button"
                                        onClick={() => setActiveMenu((value) => value === 'imageSettings' ? null : 'imageSettings')}
                                        className={`agent-chat-image-settings-button flex h-8 min-w-0 shrink items-center gap-1 rounded-xl px-2.5 text-sm text-neutral-800 whitespace-nowrap transition-colors ${activeMenu === 'imageSettings' ? 'bg-neutral-100' : 'hover:bg-neutral-100'}`}
                                        aria-label="图像参数"
                                        title={imageSettingsTitle}
                                    >
                                        <span className="agent-chat-fit-summary">{imageSettingsSummary}</span>
                                        <ChevronDown
                                            size={13}
                                            className={`shrink-0 transition-transform ${activeMenu === 'imageSettings' ? 'rotate-180' : ''}`}
                                        />
                                    </button>

                                    {activeMenu === 'imageSettings' && (
                                        <div
                                            className="absolute bottom-11 left-[-96px] z-50 w-[304px] max-h-[430px] overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xl"
                                            onWheel={(e) => e.stopPropagation()}
                                        >
                                            <div className="space-y-4">
                                                {showImageQualitySettings && (
                                                <div className="space-y-2">
                                                    <div className="text-sm font-medium text-neutral-700">质量</div>
                                                    <div className="grid grid-cols-4 gap-2 rounded-xl bg-neutral-100 p-1">
                                                        {imageQualityOptions.map((option) => {
                                                            const selected = currentImageQualityLabel === option;
                                                            return (
                                                                <button
                                                                    key={option}
                                                                    type="button"
                                                                    className={`rounded-lg px-0 py-2 text-sm transition-colors ${selected
                                                                        ? 'bg-white text-neutral-950 shadow-sm'
                                                                        : 'text-neutral-700 hover:bg-white/70'
                                                                        }`}
                                                                >
                                                                    {option}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                                )}

                                                {showImageResolutionSettings && (
                                                <div className="space-y-2">
                                                    <div className="text-sm font-medium text-neutral-700">分辨率</div>
                                                    <div className="grid grid-cols-3 gap-2">
                                                        {imageResolutionOptions.map((option) => {
                                                            const selected = currentImageResolution === option;
                                                            const previewSize = formatImageSize(getImageDisplaySize(currentCanvasImageModel, imageAspectRatio, option));
                                                            return (
                                                                <button
                                                                    key={option}
                                                                    type="button"
                                                                    title={`${option} · ${previewSize}`}
                                                                    onClick={() => setImageResolution(option)}
                                                                    className={`rounded-xl border px-0 py-2 text-sm transition-colors ${selected
                                                                        ? 'border-neutral-300 bg-neutral-100 text-neutral-950 shadow-sm'
                                                                        : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                                                                        }`}
                                                                >
                                                                    {option}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                                )}

                                                {showImageDimensionSettings && (
                                                <div className="space-y-2">
                                                    <div className="text-sm font-medium text-neutral-700">尺寸</div>
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex h-9 flex-1 items-center gap-2 rounded-lg bg-neutral-100 px-3 text-sm text-neutral-900">
                                                            <span className="text-neutral-500">W</span>
                                                            <span className="tabular-nums">{currentImageSize?.w ?? '--'}</span>
                                                        </div>
                                                        <ArrowLeftRight size={13} className="-rotate-90 text-neutral-400" />
                                                        <div className="flex h-9 flex-1 items-center gap-2 rounded-lg bg-neutral-100 px-3 text-sm text-neutral-900">
                                                            <span className="text-neutral-500">H</span>
                                                            <span className="tabular-nums">{currentImageSize?.h ?? '--'}</span>
                                                        </div>
                                                    </div>
                                                </div>
                                                )}

                                                <div className="space-y-2">
                                                    <div className="text-sm font-medium text-neutral-700">Size</div>
                                                    <div className="grid max-h-[154px] grid-cols-3 gap-2 overflow-y-auto pr-1">
                                                        {imageAspectRatioOptions.map((option) => {
                                                            const selected = imageAspectRatio === option;
                                                            return (
                                                                <button
                                                                    key={option}
                                                                    type="button"
                                                                    onClick={() => setImageAspectRatio(option)}
                                                                    className={`flex h-[72px] flex-col items-center justify-between rounded-lg border px-2 py-3 text-sm transition-colors ${selected
                                                                        ? 'border-neutral-300 bg-neutral-100 text-neutral-950'
                                                                        : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                                                                        }`}
                                                                >
                                                                    <span className="flex h-6 items-center justify-center">
                                                                        {getRatioIcon(option)}
                                                                    </span>
                                                                    <span>{RATIO_DISPLAY[option] || option}</span>
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>

                                                {showImageOutputCountSettings && (
                                                <div className="space-y-2">
                                                    <div className="text-sm font-medium text-neutral-700">Image</div>
                                                    <div className="grid grid-cols-4 gap-2">
                                                        {imageCountOptions.map((count) => {
                                                            const selected = currentImageBatchCount === count;
                                                            return (
                                                                <button
                                                                    key={count}
                                                                    type="button"
                                                                    onClick={() => setImageBatchCount(normalizeCanvasImageOutputCount(currentCanvasImageModel, count))}
                                                                    className={`rounded-lg border px-0 py-2 text-sm transition-colors ${selected
                                                                        ? 'border-neutral-300 bg-neutral-100 text-neutral-950'
                                                                        : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                                                                        }`}
                                                                >
                                                                    {count} img
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {composerMode === 'video' && (
                                <div className="relative flex shrink-0 items-center gap-4" data-agent-active-menu-root>
                                    <button
                                        ref={videoSettingsButtonRef}
                                        type="button"
                                        onClick={() => setActiveMenu((value) => value === 'videoSettings' ? null : 'videoSettings')}
                                        className={videoToolbarButtonClass(activeMenu === 'videoSettings')}
                                        aria-label="视频设置"
                                        title={videoStatusLabel ? `视频设置 · ${videoStatusLabel}` : '视频设置'}
                                    >
                                        <SlidersHorizontal size={18} strokeWidth={2.1} />
                                    </button>
                                    <button
                                        ref={videoShotButtonRef}
                                        type="button"
                                        onClick={() => setActiveMenu((value) => value === 'videoShot' ? null : 'videoShot')}
                                        className={videoToolbarButtonClass(activeMenu === 'videoShot' || Boolean(selectedVideoShot))}
                                        aria-label="基础镜头"
                                        title="基础镜头"
                                    >
                                        <Video size={18} strokeWidth={2.1} />
                                    </button>

                                    {activeMenu === 'videoShot' && (
                                        <div
                                            className={`${videoFloatingPanelClass} p-4`}
                                            style={getVideoFloatingPanelStyle(360)}
                                            onWheel={(e) => e.stopPropagation()}
                                        >
                                            <div className={videoFloatingHeadingClass}>基础镜头</div>
                                            <div className="flex flex-wrap gap-2">
                                                {VIDEO_SHOT_OPTIONS.map((option) => {
                                                    const selected = selectedVideoShot === option;
                                                    return (
                                                        <button
                                                            key={option}
                                                            type="button"
                                                            onClick={() => {
                                                                setSelectedVideoShot(option);
                                                                setActiveMenu(null);
                                                            }}
                                                            className={videoChipButtonClass(selected)}
                                                        >
                                                            {option}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {activeMenu === 'videoSettings' && (
                                        <div
                                            className={`${videoFloatingPanelClass} p-4`}
                                            style={getVideoFloatingPanelStyle(368)}
                                            onWheel={(e) => e.stopPropagation()}
                                        >
                                            <div className="space-y-4">
                                                <div className="space-y-2">
                                                    <div className={videoSectionLabelClass}>Generate method</div>
                                                    {availableVideoModeOptions.length > 0 && (
                                                        <div className={videoSegmentClass}>
                                                            {availableVideoModeOptions.map((mode) => (
                                                                <button
                                                                    key={mode.value}
                                                                    type="button"
                                                                    onClick={() => {
                                                                        setVideoComposerMode(mode.value);
                                                                    }}
                                                                    className={videoSegmentButtonClass(videoComposerMode === mode.value)}
                                                                >
                                                                    {mode.label}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>

                                                {videoCapabilityError && (
                                                    <div className="rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-600">
                                                        {videoCapabilityError}
                                                    </div>
                                                )}

                                                {isLoadingVideoCapabilities ? (
                                                    <div className="rounded-xl bg-muted px-3 py-3 text-center text-sm text-muted-foreground">
                                                        正在加载视频能力...
                                                    </div>
                                                ) : !hasVideoCapability ? (
                                                    <div className="rounded-xl bg-muted px-3 py-3 text-center text-sm text-muted-foreground">
                                                        当前模型没有开放该模式能力
                                                    </div>
                                                ) : (
                                                    <>
                                                        {!!videoAspectRatioOptions.length && videoComposerMode !== 'motion_control' && (
                                                            <div className="space-y-2">
                                                                <div className={videoSectionLabelClass}>Size</div>
                                                                <div className="grid grid-cols-3 gap-2">
                                                                    {videoAspectRatioOptions.map((ratio) => (
                                                                        <button
                                                                            key={ratio}
                                                                            type="button"
                                                                            onClick={() => setVideoAspectRatio(ratio)}
                                                                            className={videoChoiceButtonClass(currentVideoAspectRatio === ratio, 'flex h-[72px] flex-col items-center justify-center gap-2 text-sm')}
                                                                        >
                                                                            {ratio.toLowerCase() === 'auto' || ratio.toLowerCase() === 'adaptive' ? (
                                                                                <span>Auto</span>
                                                                            ) : (
                                                                                <>
                                                                                    {getRatioIcon(ratio)}
                                                                                    <span>{ratio}</span>
                                                                                </>
                                                                            )}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {!!videoResolutionOptions.length && videoComposerMode !== 'motion_control' && (
                                                            <div className="space-y-2">
                                                                <div className={videoSectionLabelClass}>Resolution</div>
                                                                <div className="grid grid-cols-3 gap-2">
                                                                    {videoResolutionOptions.map((resolution) => (
                                                                        <button
                                                                            key={resolution}
                                                                            type="button"
                                                                            onClick={() => setVideoResolution(resolution)}
                                                                            className={videoChoiceButtonClass(currentVideoResolution === resolution, 'h-9 text-sm')}
                                                                        >
                                                                            {resolution}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {!!videoDurationOptions.length && videoComposerMode !== 'motion_control' && (
                                                            <div className="space-y-2">
                                                                <div className={videoSectionLabelClass}>Duration</div>
                                                                <div className="grid grid-cols-4 gap-2">
                                                                    {videoDurationOptions.map((duration) => (
                                                                        <button
                                                                            key={duration}
                                                                            type="button"
                                                                            onClick={() => setVideoDuration(duration)}
                                                                            className={videoChoiceButtonClass(currentVideoDuration === duration, 'h-9 text-sm')}
                                                                        >
                                                                            {duration}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {videoComposerMode === 'video_edit' && (
                                                            <div className="space-y-2">
                                                                <div className={videoSectionLabelClass}>Edit mode</div>
                                                                <div className="grid grid-cols-2 gap-2">
                                                                    {videoEditModeOptions.map((mode) => (
                                                                        <button
                                                                            key={mode}
                                                                            type="button"
                                                                            onClick={() => setVideoEditMode(mode)}
                                                                            className={videoChoiceButtonClass(videoEditMode === mode, 'h-9 text-sm')}
                                                                        >
                                                                            {mode}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {videoComposerMode === 'motion_control' && (
                                                            <div className="space-y-2">
                                                                <div className={videoSectionLabelClass}>Mode</div>
                                                                <div className="grid grid-cols-2 gap-2">
                                                                    {capabilityOptions(currentVideoCapabilitySet?.qualityModes).map((mode) => (
                                                                        <button
                                                                            key={mode}
                                                                            type="button"
                                                                            onClick={() => setVideoQualityMode(mode)}
                                                                            className={videoChoiceButtonClass(videoQualityMode === mode, 'h-9 text-sm')}
                                                                        >
                                                                            {mode}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {supportsVideoAudioOutput && (
                                                            <div className={videoToggleRowClass}>
                                                                <span className="text-base text-foreground">音频</span>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setVideoGenerateAudio((value) => !value)}
                                                                    className={videoToggleButtonClass(videoGenerateAudio)}
                                                                    aria-pressed={videoGenerateAudio}
                                                                >
                                                                    <span className={`h-5 w-5 rounded-full bg-white transition-transform ${videoGenerateAudio ? 'translate-x-4' : ''}`} />
                                                                </button>
                                                            </div>
                                                        )}

                                                        <div className={videoToggleRowClass}>
                                                            <span className="text-base text-foreground">网络搜索</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => setWebSearchEnabled((value) => !value)}
                                                                className={videoToggleButtonClass(webSearchEnabled)}
                                                                aria-pressed={webSearchEnabled}
                                                            >
                                                                <span className={`h-5 w-5 rounded-full bg-white transition-transform ${webSearchEnabled ? 'translate-x-4' : ''}`} />
                                                            </button>
                                                        </div>

                                                        {videoStatusLabel && (
                                                            <div className="text-xs text-muted-foreground">
                                                                能力状态：{videoStatusLabel}
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                            {composerMode === 'agent' && (
                                <div className="group relative" data-agent-thinking-menu-root>
                                    <button
                                        type="button"
                                        onClick={handleThinkingClick}
                                        className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${thinkingModeEnabled ? 'bg-neutral-950 text-white' : 'text-neutral-800 hover:bg-neutral-100'}`}
                                        aria-label="思考模式"
                                    >
                                        <Lightbulb size={16} />
                                    </button>
                                    <div className="pointer-events-none absolute bottom-10 right-0 z-50 w-36 rounded-lg bg-neutral-950 px-3 py-2 text-xs text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                                        <div className="font-semibold">思考模式</div>
                                        <div className="mt-1 text-neutral-300">新建对话</div>
                                        <div className="mt-1 leading-4 text-neutral-300">制定复杂任务并自主执行</div>
                                    </div>
                                </div>
                            )}
                            <div className="relative" data-agent-active-menu-root>
                                <Tooltip label={activeModelTooltip}>
                                    <button
                                        type="button"
                                        onClick={() => setActiveMenu((value) => value === 'model' ? null : 'model')}
                                        disabled={isLoadingModelCatalog && activeModelOptions.length === 0}
                                        className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${activeMenu === 'model' ? 'bg-neutral-950 text-white' : 'text-neutral-700 hover:bg-neutral-100'}`}
                                        aria-label="选择模型"
                                    >
                                        {isLoadingModelCatalog && activeModelOptions.length === 0 ? (
                                            <Loader2 size={15} className="animate-spin" />
                                        ) : composerMode === 'agent' ? (
                                            <Box size={16} />
                                        ) : activeModelOption ? (
                                            getModelOptionIcon(
                                                activeModelOption,
                                                16,
                                                `shrink-0 ${activeMenu === 'model' ? 'text-white' : 'text-neutral-800'}`,
                                            )
                                        ) : (
                                            <Sparkles size={16} />
                                        )}
                                    </button>
                                </Tooltip>

                                {activeMenu === 'model' && composerMode === 'agent' && (
                                    <div
                                        className={`absolute bottom-11 right-0 z-50 w-80 max-w-[min(20rem,calc(100vw-1.5rem))] rounded-xl p-2 shadow-2xl ${
                                            isDark
                                                ? 'border border-white/10 bg-[#1a1916] text-zinc-100'
                                                : 'border border-neutral-200 bg-white text-neutral-900'
                                        }`}
                                    >
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                            <div
                                                className={
                                                    isDark
                                                        ? 'text-sm font-semibold text-zinc-100'
                                                        : 'text-sm font-semibold text-neutral-950'
                                                }
                                            >
                                                模型偏好
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => setAutoModelPreference((value) => !value)}
                                                className={`flex items-center gap-1.5 rounded-md px-1 py-0.5 text-xs font-medium transition-colors ${
                                                    isDark
                                                        ? 'text-zinc-300 hover:bg-white/5 hover:text-zinc-100'
                                                        : 'text-neutral-700 hover:text-neutral-950'
                                                }`}
                                                aria-pressed={autoModelPreference}
                                            >
                                                自动
                                                <SwitchIndicator checked={autoModelPreference} theme={isDark ? 'dark' : 'light'} />
                                            </button>
                                        </div>

                                        <div
                                            className={`mb-2 grid grid-cols-3 rounded-md p-0.5 ${
                                                isDark ? 'bg-zinc-800/90' : 'bg-neutral-100'
                                            }`}
                                        >
                                            {MODEL_PREFERENCE_TABS.map((tabItem) => (
                                                <button
                                                    key={tabItem.value}
                                                    type="button"
                                                    onClick={() => setModelPreferenceTab(tabItem.value)}
                                                    className={`h-7 rounded-sm text-xs font-medium transition-colors ${
                                                        modelPreferenceTab === tabItem.value
                                                            ? isDark
                                                                ? 'bg-zinc-600 text-zinc-50 shadow-sm'
                                                                : 'bg-white text-neutral-950 shadow-sm'
                                                            : isDark
                                                              ? 'text-zinc-400 hover:text-zinc-200'
                                                              : 'text-neutral-600 hover:text-neutral-950'
                                                    }`}
                                                >
                                                    {tabItem.label}
                                                </button>
                                            ))}
                                        </div>

                                        {modelCatalogError ? (
                                            <div
                                                className={`mb-2 rounded-md px-2.5 py-1.5 text-xs leading-4 ${
                                                    isDark
                                                        ? 'bg-red-950/50 text-red-300'
                                                        : 'bg-red-50 text-red-600'
                                                }`}
                                            >
                                                {modelCatalogError}
                                            </div>
                                        ) : null}

                                        <div
                                            className={
                                                isDark
                                                    ? 'mb-1.5 text-xs font-medium text-zinc-500'
                                                    : 'mb-1.5 text-xs font-medium text-neutral-500'
                                            }
                                        >
                                            {modelPreferenceTab === 'image' ? 'Image' : modelPreferenceTab === 'video' ? 'Video' : '3D'}
                                        </div>

                                        <div className="max-h-60 overflow-y-auto pr-0.5">
                                            {modelPreferenceTab === '3d' ? (
                                                <div
                                                    className={
                                                        isDark
                                                            ? 'rounded-lg bg-zinc-800/50 px-3 py-5 text-center text-xs text-zinc-500'
                                                            : 'rounded-lg bg-neutral-50 px-3 py-5 text-center text-xs text-neutral-500'
                                                    }
                                                >
                                                    暂无接入 3D 模型
                                                </div>
                                            ) : modelPreferenceOptions.length > 0 ? (
                                                modelPreferenceOptions.map((option) => {
                                                    const selected = option.kind === 'image'
                                                        ? activeImageToolPool.includes(option.id)
                                                        : option.kind === 'video'
                                                            ? activeVideoToolPool.includes(option.id)
                                                            : option.id === modelPreferenceSelectedId;
                                                    const timeLabel = modelOptionTime(option);
                                                    return (
                                                        <button
                                                            key={option.id}
                                                            type="button"
                                                            onClick={() => {
                                                                if (option.kind === 'image') {
                                                                    setSelectedImageTool(option.id);
                                                                    setSelectedImageToolIds((prev) => (
                                                                        autoModelPreference ? toggleModelPoolId(prev, option.id) : [option.id]
                                                                    ));
                                                                } else if (option.kind === 'video') {
                                                                    setSelectedVideoTool(option.id);
                                                                    setSelectedVideoToolIds((prev) => (
                                                                        autoModelPreference ? toggleModelPoolId(prev, option.id) : [option.id]
                                                                    ));
                                                                }
                                                            }}
                                                            className={
                                                                isDark
                                                                    ? 'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-zinc-200 transition-colors hover:bg-white/5'
                                                                    : 'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-800 transition-colors hover:bg-neutral-50'
                                                            }
                                                        >
                                                            <span
                                                                className={
                                                                    isDark
                                                                        ? 'flex h-8 w-8 shrink-0 items-center justify-center text-zinc-300'
                                                                        : 'flex h-8 w-8 shrink-0 items-center justify-center text-neutral-700'
                                                                }
                                                            >
                                                                {getModelOptionIcon(option, 15)}
                                                            </span>
                                                            <span className="min-w-0 flex-1">
                                                                <span
                                                                    className={
                                                                        isDark
                                                                            ? 'block truncate text-sm font-medium text-zinc-100'
                                                                            : 'block truncate text-sm font-medium text-neutral-800'
                                                                    }
                                                                >
                                                                    {option.label}
                                                                    {option.kind === 'video' && option.label.includes('Seedance') && (
                                                                        <span
                                                                            className={
                                                                                isDark
                                                                                    ? 'ml-1.5 rounded bg-blue-500/20 px-1 py-0.5 text-[10px] font-medium text-blue-300'
                                                                                    : 'ml-1.5 rounded bg-blue-100 px-1 py-0.5 text-[10px] font-medium text-blue-600'
                                                                            }
                                                                        >
                                                                            会员专属
                                                                        </span>
                                                                    )}
                                                                </span>
                                                                <span
                                                                    className={
                                                                        isDark
                                                                            ? 'mt-0.5 block line-clamp-2 text-xs leading-4 text-zinc-500'
                                                                            : 'mt-0.5 block line-clamp-2 text-xs leading-4 text-neutral-500'
                                                                    }
                                                                >
                                                                    {modelOptionDescription(option)}
                                                                </span>
                                                                {timeLabel && (
                                                                    <span
                                                                        className={
                                                                            isDark
                                                                                ? 'mt-0.5 inline-flex rounded bg-zinc-700/80 px-1 py-0.5 text-[10px] text-zinc-400'
                                                                                : 'mt-0.5 inline-flex rounded bg-neutral-100 px-1 py-0.5 text-[10px] text-neutral-500'
                                                                        }
                                                                    >
                                                                        {timeLabel}
                                                                    </span>
                                                                )}
                                                            </span>
                                                            {selected && (
                                                                <Check
                                                                    size={14}
                                                                    className={
                                                                        isDark
                                                                            ? 'h-3.5 w-3.5 shrink-0 text-zinc-100'
                                                                            : 'h-3.5 w-3.5 shrink-0 text-neutral-800'
                                                                    }
                                                                    aria-hidden="true"
                                                                />
                                                            )}
                                                        </button>
                                                    );
                                                })
                                            ) : (
                                                <div
                                                    className={
                                                        isDark
                                                            ? 'rounded-lg bg-zinc-800/50 px-3 py-5 text-center text-xs text-zinc-500'
                                                            : 'rounded-lg bg-neutral-50 px-3 py-5 text-center text-xs text-neutral-500'
                                                    }
                                                >
                                                    {isLoadingModelCatalog ? '正在加载模型...' : '暂无可用模型'}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {activeMenu === 'model' && composerMode !== 'agent' && (
                                    <div className="absolute bottom-11 right-0 z-50 w-48 rounded-xl border border-neutral-200 bg-white p-2 shadow-2xl">
                                        {activeModelOptions.length > 0 ? (
                                            activeModelOptions.map((option) => {
                                                const selected = option.id === activeModelId;
                                                return (
                                                    <button
                                                        key={option.id}
                                                        type="button"
                                                        onClick={() => {
                                                            if (composerMode === 'image') {
                                                                setSelectedImageTool(option.id);
                                                                setSelectedImageToolIds([option.id]);
                                                            } else {
                                                                setSelectedVideoTool(option.id);
                                                                setSelectedVideoToolIds([option.id]);
                                                            }
                                                            setActiveMenu(null);
                                                        }}
                                                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-50"
                                                    >
                                                        <span className="flex min-w-0 flex-1 items-center gap-2">
                                                            {getModelOptionIcon(option, 15)}
                                                            <span className="min-w-0 truncate">{option.label}</span>
                                                        </span>
                                                        {selected && <Check size={14} className="shrink-0" />}
                                                    </button>
                                                );
                                            })
                                        ) : (
                                            <div className="px-3 py-5 text-center text-sm text-neutral-500">
                                                {isLoadingModelCatalog ? '正在加载模型...' : '暂无可用模型'}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            <Tooltip label={actionTooltip}>
                                <button
                                    type="button"
                                    onClick={handleComposerAction}
                                    disabled={isActionDisabled}
                                    className={composerMode === 'image'
                                        ? `flex h-11 min-w-[64px] items-center justify-center gap-1 rounded-full px-4 text-sm font-semibold transition-colors ${isActionDisabled
                                            ? 'cursor-not-allowed bg-neutral-100 text-neutral-400'
                                            : 'bg-neutral-950 text-white hover:bg-neutral-800'
                                        }`
                                        : composerMode === 'agent'
                                            ? `flex h-12 w-12 items-center justify-center rounded-full text-white shadow-sm transition-colors ${isActionDisabled
                                                ? 'cursor-wait bg-neutral-300'
                                                : 'bg-neutral-950 hover:bg-neutral-800'
                                            }`
                                            : `flex h-10 min-w-[56px] items-center justify-center gap-1 rounded-full px-3 text-sm font-semibold text-white transition-colors ${isActionDisabled
                                                ? 'cursor-not-allowed bg-neutral-300'
                                                : 'bg-neutral-950 hover:bg-neutral-800'
                                            }`
                                    }
                                    aria-label={composerMode === 'agent' ? '语音输入' : composerMode === 'image' ? (hasComposerPayload ? `生成图像，消耗 ${imageActionCreditsLabel} 积分` : '请输入提示词') : '生成视频'}
                                >
                                    {isLoading || isGeneratingComposerVideo ? (
                                        <Loader2 size={16} className="animate-spin" />
                                    ) : composerMode === 'image' ? (
                                        <>
                                            <Zap size={15} fill="currentColor" />
                                            <span className="tabular-nums">{imageActionCreditsLabel}</span>
                                        </>
                                    ) : composerMode === 'video' ? (
                                        <>
                                            <Zap size={15} fill="currentColor" />
                                            <span className="tabular-nums">0</span>
                                        </>
                                    ) : (
                                        <AudioLines size={composerMode === 'agent' ? 20 : 17} />
                                    )}
                                </button>
                            </Tooltip>
                        </div>
                    </div>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept={composerFileAccept}
                        multiple
                        className="hidden"
                        onChange={(event) => void handleUploadFiles(event.target.files)}
                    />
                </div>
            </footer>

            <AssetLibraryPanel
                isOpen={showAssetLibrary}
                onClose={() => {
                    setShowAssetLibrary(false);
                    setAssetLibraryMediaFilter(null);
                    updatePendingVideoAttachSlot(null);
                }}
                onSelectAsset={handleAssetLibrarySelect}
                variant="modal"
                canvasTheme={canvasTheme}
                mediaFilter={assetLibraryMediaFilter}
            />
        </div>
    );
};

interface ChatBubbleProps {
    onClick: () => void;
    isOpen: boolean;
}

export const ChatBubble: React.FC<ChatBubbleProps> = ({ onClick, isOpen }) => {
    if (isOpen) return null;

    return (
        <button
            type="button"
            onClick={onClick}
            className="fixed right-4 top-4 z-50 flex h-9 items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground"
            aria-label="打开对话"
        >
            <MessageSquare size={14} />
            <span>对话</span>
        </button>
    );
};
