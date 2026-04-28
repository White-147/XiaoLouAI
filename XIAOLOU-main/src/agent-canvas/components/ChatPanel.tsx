/**
 * ChatPanel.tsx
 *
 * Right-side chat panel for Agent Canvas.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    ArrowLeftRight,
    AudioLines,
    Bot,
    BookOpen,
    Box,
    Check,
    ChevronDown,
    Globe2,
    ImageIcon,
    Lightbulb,
    Loader2,
    MessageSquare,
    MessageSquarePlus,
    MousePointer2,
    PanelRightClose,
    Paperclip,
    Plus,
    Search,
    Share2,
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
    type CanvasImageModel,
} from '../config/canvasImageModels';

type ComposerMenu = 'more' | 'skills' | 'mode' | 'model' | 'imageAttach' | 'imageSettings' | null;
type ComposerMode = 'agent' | 'image' | 'video';
type ModelPreferenceTab = 'image' | 'video' | '3d';

const COMPOSER_MODES: Array<{
    value: ComposerMode;
    label: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
}> = [
    { value: 'agent', label: 'Agent', icon: Bot },
    { value: 'image', label: '图像', icon: ImageIcon },
    { value: 'video', label: '视频', icon: Video },
];

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
    type: 'image' | 'video';
    url: string;
    nodeId: string;
    base64?: string;
}

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
        ? 'bottom-10 left-1/2 -translate-x-1/2'
        : 'right-0 top-10';

    return (
        <div className="group relative">
            {children}
            <div className={`pointer-events-none absolute z-50 whitespace-nowrap rounded-lg bg-neutral-950 px-3 py-2 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 ${placementClass}`}>
                {label}
            </div>
        </div>
    );
}

function SwitchIndicator({ checked }: { checked: boolean }) {
    return (
        <span
            className={`inline-flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${checked ? 'justify-end bg-neutral-900' : 'justify-start bg-neutral-200'}`}
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
    return file.type.startsWith('image/') || file.type.startsWith('video/');
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

function normalizeToolKey(value?: string | null) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^xiaolou_image_/, '')
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

export const ChatPanel: React.FC<ChatPanelProps> = ({
    isOpen,
    onClose,
    isDraggingNode = false,
    getCanvasSnapshot,
    onApplyActions,
}) => {
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
    const [modelPreferenceTab, setModelPreferenceTab] = useState<ModelPreferenceTab>('image');
    const [autoModelPreference, setAutoModelPreference] = useState(true);
    const [imageResolution, setImageResolution] = useState(PREFERRED_IMAGE_RESOLUTION);
    const [imageAspectRatio, setImageAspectRatio] = useState('1:1');
    const [imageBatchCount, setImageBatchCount] = useState(1);
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

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isLoading]);

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

    const textModelOptions = useMemo(() => toTextModelOptions(jaazModels), [jaazModels]);
    const imageModelOptions = useMemo(() => toToolModelOptions(jaazTools, 'image'), [jaazTools]);
    const videoModelOptions = useMemo(() => toToolModelOptions(jaazTools, 'video'), [jaazTools]);

    useEffect(() => {
        if (!selectedTextModel && textModelOptions.length > 0) {
            setSelectedTextModel(pickPreferredModel(textModelOptions, PREFERRED_TEXT_MODEL_IDS));
        }
    }, [selectedTextModel, textModelOptions]);

    useEffect(() => {
        if (!selectedImageTool && imageModelOptions.length > 0) {
            setSelectedImageTool(pickPreferredModel(imageModelOptions, PREFERRED_IMAGE_TOOL_IDS));
        }
    }, [selectedImageTool, imageModelOptions]);

    useEffect(() => {
        if (!selectedVideoTool && videoModelOptions.length > 0) {
            setSelectedVideoTool(pickPreferredModel(videoModelOptions, PREFERRED_VIDEO_TOOL_IDS));
        }
    }, [selectedVideoTool, videoModelOptions]);

    const selectedImageOption = useMemo(
        () => imageModelOptions.find((option) => option.id === selectedImageTool),
        [imageModelOptions, selectedImageTool],
    );
    const currentCanvasImageModel = useMemo(
        () => getCanvasImageModelForTool(selectedImageTool, selectedImageOption?.label),
        [selectedImageOption?.label, selectedImageTool],
    );
    const imageResolutionOptions = useMemo(
        () => uniqueResolutions(currentCanvasImageModel.resolutions.length ? currentCanvasImageModel.resolutions : ['1K']),
        [currentCanvasImageModel.resolutions],
    );
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
    const imageCountOptions = useMemo(
        () => Array.from({ length: MAX_IMAGE_BATCH_COUNT }, (_, index) => index + 1),
        [],
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

    const addAttachment = (attachment: AttachedMedia) => {
        setAttachedMedia((prev) => {
            if (prev.some((item) => item.nodeId === attachment.nodeId)) return prev;
            return [...prev, attachment];
        });
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
            if (!url || (type !== 'image' && type !== 'video')) return;

            addAttachment({
                type,
                url,
                nodeId,
                base64: type === 'image' ? await imageUrlToBase64(url) : undefined,
            });
        } catch (err) {
            console.error('Failed to parse dropped node data:', err);
        }
    };

    const removeAttachment = (nodeId: string) => {
        setAttachedMedia((prev) => prev.filter((item) => item.nodeId !== nodeId));
    };

    const buildComposerInstruction = () => {
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
                `模型=${selectedImageOption?.label || currentCanvasImageModel.name}`,
                `分辨率=${currentImageResolution || '自动'}`,
                `宽高比=${currentImageAspectRatioLabel}`,
                currentImageSize ? `尺寸=${currentImageSizeLabel}` : null,
                `数量=${imageBatchCount}张`,
            ].filter(Boolean).join('；'));
        } else if (composerMode === 'video') {
            lines.push('当前选择视频模式：优先完成视频脚本、视频生成、分镜或运镜任务。');
        } else {
            lines.push('当前选择 Agent 模式：可综合使用 Planner Agent、图片/视频 Creator Agent 和工具调用完成任务。');
        }

        return lines.join('\n');
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

        const selectedToolId = composerMode === 'image'
            ? selectedImageTool
            : composerMode === 'video'
                ? selectedVideoTool
                : undefined;
        const selectedToolType = composerMode === 'image'
            ? 'image'
            : composerMode === 'video'
                ? 'video'
                : undefined;

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

    const handleUploadFiles = async (files: FileList | null) => {
        const selectedFiles = Array.from(files || []).filter(isMediaFile);
        if (!selectedFiles.length) return;

        const nextAttachments = await Promise.all(selectedFiles.map(async (file, index) => {
            const isImage = file.type.startsWith('image/');
            const url = isImage ? await readFileAsDataUrl(file) : URL.createObjectURL(file);
            return {
                type: isImage ? 'image' as const : 'video' as const,
                url,
                nodeId: `upload-${Date.now()}-${index}-${file.name}`,
                base64: isImage ? url.split(',')[1] || undefined : undefined,
            };
        }));

        setAttachedMedia((prev) => [...prev, ...nextAttachments]);
        setActiveMenu(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    const handleAssetLibrarySelect = async (url: string, type: 'image' | 'video') => {
        addAttachment({
            type,
            url,
            nodeId: `library-${Date.now()}`,
            base64: type === 'image' ? await imageUrlToBase64(url) : undefined,
        });
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

    const handlePickFromCanvas = () => {
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

    return (
        <div
            className={`fixed right-0 top-0 z-40 flex h-full w-[400px] flex-col border-l bg-white text-neutral-950 shadow-2xl transition-all duration-300 ${showHighlight ? 'border-blue-500 ring-2 ring-blue-200' : 'border-neutral-200'}`}
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
                    <div className="relative flex items-center">
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

                    <Tooltip label="分享对话" placement="bottom">
                        <button
                            type="button"
                            onClick={handleShareChat}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-700 transition-colors hover:bg-neutral-100"
                            aria-label="分享对话"
                        >
                            <Share2 size={15} />
                        </button>
                    </Tooltip>

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
                    <div className="mx-1 mb-1 flex items-center justify-between gap-2 rounded-2xl bg-lime-50 px-3 py-2 text-xs text-neutral-700">
                        <span className="inline-flex min-w-0 items-center gap-2">
                            <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-lime-300 text-[10px] font-bold text-neutral-900">+</span>
                            <span className="truncate">已默认使用中文回复，可切换 Agent / 图像 / 视频模式</span>
                        </span>
                        <button
                            type="button"
                            onClick={() => setShowChineseTip(false)}
                            className="rounded-md p-0.5 text-neutral-500 hover:bg-lime-100 hover:text-neutral-900"
                            aria-label="关闭提示"
                        >
                            <X size={14} />
                        </button>
                    </div>
                )}

                <div className="relative rounded-[22px] border border-neutral-200 bg-white px-3 pb-3 pt-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
                    {showThinkingConfirm && (
                        <div className="absolute bottom-[54px] left-10 right-5 z-50 rounded-xl border border-neutral-200 bg-white p-5 shadow-2xl">
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
                                const Icon = media.type === 'video' ? Video : ImageIcon;
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
                        <div className="relative mb-1 min-h-[128px]">
                            <div className="absolute left-0 top-0">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (composerMode === 'image') {
                                            setActiveMenu((value) => value === 'imageAttach' ? null : 'imageAttach');
                                            return;
                                        }
                                        fileInputRef.current?.click();
                                    }}
                                    className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-neutral-300 transition-colors hover:text-neutral-500 ${activeMenu === 'imageAttach' ? 'bg-neutral-100' : 'bg-neutral-100/80 hover:bg-neutral-100'}`}
                                    aria-label={composerMode === 'image' ? '添加图片参考' : '添加视频素材'}
                                >
                                    <Plus size={20} strokeWidth={1.7} />
                                </button>

                                {activeMenu === 'imageAttach' && composerMode === 'image' && (
                                    <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-[174px] rounded-xl border border-neutral-100 bg-white p-2 shadow-2xl">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setActiveMenu(null);
                                                fileInputRef.current?.click();
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
                                                setShowAssetLibrary(true);
                                            }}
                                            className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm text-neutral-900 hover:bg-neutral-50"
                                        >
                                            <Users size={16} />
                                            从素材库选择
                                        </button>
                                        <button
                                            type="button"
                                            onClick={handlePickFromCanvas}
                                            className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm text-neutral-900 hover:bg-neutral-50"
                                        >
                                            <MousePointer2 size={16} />
                                            从画布选择
                                        </button>
                                    </div>
                                )}
                            </div>
                            <textarea
                                ref={textareaRef}
                                value={message}
                                onChange={(e) => setMessage(e.target.value)}
                                placeholder={composerMode === 'image' ? '今天我们要创作什么' : '今天我们要制作什么视频'}
                                className="absolute left-0 right-0 top-[76px] max-h-[72px] min-h-[44px] resize-none bg-transparent text-sm leading-6 text-neutral-950 outline-none placeholder:text-neutral-400"
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
                        <div className="flex min-w-0 items-center gap-1.5">
                            {composerMode === 'agent' && (
                                <>
                                    <div className="group relative">
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
                                                    onClick={() => fileInputRef.current?.click()}
                                                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-neutral-900 hover:bg-neutral-50"
                                                >
                                                    <Paperclip size={16} />
                                                    上传文件
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setActiveMenu(null);
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

                                    <div className="relative">
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

                            <div className="relative">
                                <button
                                    type="button"
                                    onClick={() => setActiveMenu((value) => value === 'mode' ? null : 'mode')}
                                    className={`flex h-8 shrink-0 items-center gap-1 rounded-xl px-2.5 text-sm transition-colors ${activeMenu === 'mode' ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-800 hover:bg-neutral-100'}`}
                                    aria-label="选择模式"
                                >
                                    <ActiveModeIcon size={15} />
                                    <span>{activeMode.label}</span>
                                    <ChevronDown
                                        size={13}
                                        className={`transition-transform ${activeMenu === 'mode' ? 'rotate-180' : ''}`}
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
                                <div className="relative">
                                    <button
                                        type="button"
                                        onClick={() => setActiveMenu((value) => value === 'imageSettings' ? null : 'imageSettings')}
                                        className={`flex h-8 shrink-0 items-center gap-1 rounded-xl px-2.5 text-sm text-neutral-800 transition-colors ${activeMenu === 'imageSettings' ? 'bg-neutral-100' : 'hover:bg-neutral-100'}`}
                                        aria-label="图像参数"
                                    >
                                        <span>{currentImageResolution || '自动'} · {currentImageSizeLabel} · {imageBatchCount} img</span>
                                        <ChevronDown
                                            size={13}
                                            className={`transition-transform ${activeMenu === 'imageSettings' ? 'rotate-180' : ''}`}
                                        />
                                    </button>

                                    {activeMenu === 'imageSettings' && (
                                        <div
                                            className="absolute bottom-11 left-[-96px] z-50 w-[304px] max-h-[430px] overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xl"
                                            onWheel={(e) => e.stopPropagation()}
                                        >
                                            <div className="space-y-4">
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

                                                <div className="space-y-2">
                                                    <div className="text-sm font-medium text-neutral-700">Image</div>
                                                    <div className="grid grid-cols-4 gap-2">
                                                        {imageCountOptions.map((count) => {
                                                            const selected = imageBatchCount === count;
                                                            return (
                                                                <button
                                                                    key={count}
                                                                    type="button"
                                                                    onClick={() => setImageBatchCount(count)}
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
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {composerMode === 'video' && (
                                <div className="flex shrink-0 items-center gap-1 rounded-xl bg-neutral-50 p-1">
                                    <button type="button" className="flex h-7 items-center gap-1 rounded-lg bg-white px-2 text-xs font-medium text-neutral-900 shadow-sm">
                                        <Video size={13} />
                                        视频
                                    </button>
                                    <button type="button" className="flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-neutral-500 hover:bg-white">
                                        <ImageIcon size={13} />
                                        图片
                                    </button>
                                </div>
                            )}
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                            {composerMode === 'agent' && (
                                <div className="group relative">
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
                            <div className="relative">
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
                                        ) : (
                                            <Sparkles size={16} />
                                        )}
                                    </button>
                                </Tooltip>

                                {activeMenu === 'model' && composerMode === 'agent' && (
                                    <div className="absolute bottom-11 right-0 z-50 w-[396px] rounded-2xl border border-neutral-100 bg-white p-4 shadow-2xl">
                                        <div className="mb-4 flex items-center justify-between">
                                            <div className="text-base font-semibold text-neutral-950">模型偏好</div>
                                            <button
                                                type="button"
                                                onClick={() => setAutoModelPreference((value) => !value)}
                                                className="flex items-center gap-2 text-sm font-medium text-neutral-700"
                                                aria-pressed={autoModelPreference}
                                            >
                                                自动
                                                <SwitchIndicator checked={autoModelPreference} />
                                            </button>
                                        </div>

                                        <div className="mb-4 grid grid-cols-3 rounded-lg bg-neutral-100 p-1">
                                            {MODEL_PREFERENCE_TABS.map((tabItem) => (
                                                <button
                                                    key={tabItem.value}
                                                    type="button"
                                                    onClick={() => setModelPreferenceTab(tabItem.value)}
                                                    className={`h-8 rounded-md text-sm font-medium transition-colors ${modelPreferenceTab === tabItem.value ? 'bg-white text-neutral-950 shadow-sm' : 'text-neutral-700 hover:text-neutral-950'}`}
                                                >
                                                    {tabItem.label}
                                                </button>
                                            ))}
                                        </div>

                                        {modelCatalogError ? (
                                            <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs leading-5 text-red-600">
                                                {modelCatalogError}
                                            </div>
                                        ) : null}

                                        <div className="mb-2 text-sm font-semibold text-neutral-400">
                                            {modelPreferenceTab === 'image' ? 'Image' : modelPreferenceTab === 'video' ? 'Video' : '3D'}
                                        </div>

                                        <div className="max-h-72 overflow-y-auto pr-1">
                                            {modelPreferenceTab === '3d' ? (
                                                <div className="rounded-xl bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">
                                                    暂无接入 3D 模型
                                                </div>
                                            ) : modelPreferenceOptions.length > 0 ? (
                                                modelPreferenceOptions.map((option) => {
                                                    const selected = option.id === modelPreferenceSelectedId;
                                                    const timeLabel = modelOptionTime(option);
                                                    const OptionIcon = option.kind === 'video' ? Video : Sparkles;
                                                    return (
                                                        <button
                                                            key={option.id}
                                                            type="button"
                                                            onClick={() => {
                                                                if (option.kind === 'image') {
                                                                    setSelectedImageTool(option.id);
                                                                } else if (option.kind === 'video') {
                                                                    setSelectedVideoTool(option.id);
                                                                }
                                                            }}
                                                            className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition-colors hover:bg-neutral-50"
                                                        >
                                                            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-neutral-700">
                                                                <OptionIcon size={18} />
                                                            </span>
                                                            <span className="min-w-0 flex-1">
                                                                <span className="block truncate text-base font-medium text-neutral-800">
                                                                    {option.label}
                                                                    {option.kind === 'video' && option.label.includes('Seedance') && (
                                                                        <span className="ml-2 rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-600">会员专属</span>
                                                                    )}
                                                                </span>
                                                                <span className="mt-1 block text-xs leading-5 text-neutral-500">
                                                                    {modelOptionDescription(option)}
                                                                </span>
                                                                {timeLabel && (
                                                                    <span className="mt-1 inline-flex rounded bg-neutral-100 px-1.5 py-0.5 text-xs text-neutral-500">
                                                                        {timeLabel}
                                                                    </span>
                                                                )}
                                                            </span>
                                                            <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded bg-neutral-100 text-neutral-400 ${selected ? 'opacity-100' : 'opacity-40'}`}>
                                                                {selected && <Check size={13} />}
                                                            </span>
                                                        </button>
                                                    );
                                                })
                                            ) : (
                                                <div className="rounded-xl bg-neutral-50 px-4 py-8 text-center text-sm text-neutral-500">
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
                                                            } else {
                                                                setSelectedVideoTool(option.id);
                                                            }
                                                            setActiveMenu(null);
                                                        }}
                                                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-neutral-800 hover:bg-neutral-50"
                                                    >
                                                        <span className="min-w-0 truncate">{option.label}</span>
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
                            <button
                                type="button"
                                onClick={handleSend}
                                disabled={isLoading || (!message.trim() && attachedMedia.length === 0)}
                                className={composerMode === 'image'
                                    ? `flex h-9 min-w-[52px] items-center justify-center gap-1 rounded-full px-3 text-sm font-medium transition-colors ${isLoading || (!message.trim() && attachedMedia.length === 0)
                                        ? 'cursor-not-allowed bg-neutral-100 text-neutral-400'
                                        : 'bg-neutral-950 text-white hover:bg-neutral-800'
                                    }`
                                    : `flex h-9 w-9 items-center justify-center rounded-full text-white transition-colors ${isLoading || (!message.trim() && attachedMedia.length === 0)
                                        ? 'cursor-not-allowed bg-neutral-300'
                                        : 'bg-neutral-950 hover:bg-neutral-800'
                                    }`
                                }
                                aria-label="发送"
                            >
                                {isLoading ? (
                                    <Loader2 size={16} className="animate-spin" />
                                ) : composerMode === 'image' ? (
                                    <>
                                        <Zap size={14} fill="currentColor" />
                                        <span>2</span>
                                    </>
                                ) : (
                                    <AudioLines size={17} />
                                )}
                            </button>
                        </div>
                    </div>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept={composerMode === 'image' ? 'image/*' : composerMode === 'video' ? 'image/*,video/*' : 'image/*,video/*'}
                        multiple
                        className="hidden"
                        onChange={(event) => void handleUploadFiles(event.target.files)}
                    />
                </div>
            </footer>

            <AssetLibraryPanel
                isOpen={showAssetLibrary}
                onClose={() => setShowAssetLibrary(false)}
                onSelectAsset={handleAssetLibrarySelect}
                variant="modal"
                canvasTheme="light"
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
            className="fixed right-4 top-4 z-50 flex h-9 items-center gap-1.5 rounded-xl bg-neutral-100 px-3 text-sm font-medium text-neutral-900 shadow-sm transition-colors hover:bg-neutral-200"
            aria-label="打开对话"
        >
            <MessageSquare size={14} />
            <span>对话</span>
        </button>
    );
};
