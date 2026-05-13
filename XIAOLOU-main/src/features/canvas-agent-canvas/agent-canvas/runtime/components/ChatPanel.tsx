/**
 * ChatPanel.tsx
 *
 * Right-side chat panel for Agent Canvas.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Bot,
    ImageIcon,
    MessageSquare,
    Video,
} from 'lucide-react';
import { AssetLibraryPanel } from './AssetLibraryPanel';
import { ChatPanelComposer } from './ChatPanelComposer';
import type { ChatPanelComposerBodyProps } from './ChatPanelComposerBody';
import type { ChatPanelComposerToolbarActionsProps } from './ChatPanelComposerToolbarActions';
import type { ChatPanelComposerToolbarControlsProps } from './ChatPanelComposerToolbarControls';
import type {
    ComposerMenu,
    ComposerMode,
    ComposerModeOption,
} from './ChatPanelComposerToolbarTypes';
import { ChatPanelDropOverlay } from './ChatPanelDropOverlay';
import { ChatPanelHeader } from './ChatPanelHeader';
import { ChatPanelMessageList } from './ChatPanelMessageList';
import { getModelOptionIcon } from './chatPanelModelOptionIcon';
import {
    PRIMARY_VIDEO_COMPOSER_MODES,
    VIDEO_MODE_OPTIONS,
    VIDEO_SHOT_OPTIONS,
} from './chatPanelVideoOptions';
import {
    useChatAgent,
    type AgentCanvasSnapshot,
    type AgentCanvasProjectChatContext,
    type CanvasAgentAction,
} from '../hooks/useChatAgent';
import {
    type ModelPreferenceTab,
} from './chatPanelModelOptions';
import {
    getVideoAttachAccept,
    type VideoAttachSlot,
} from './chatPanelMediaAttachments';
import { useChatPanelMediaAttachments } from './useChatPanelMediaAttachments';
import { useChatPanelComposerAction } from './useChatPanelComposerAction';
import { useChatPanelComposerMenuActions } from './useChatPanelComposerMenuActions';
import { useChatPanelComposerShellActions } from './useChatPanelComposerShellActions';
import { useChatPanelFloatingPanelLayout } from './useChatPanelFloatingPanelLayout';
import {
    useChatPanelVideoGeneration,
    type VideoComposerMode,
} from './useChatPanelVideoGeneration';
import { useChatPanelSendMessage } from './useChatPanelSendMessage';
import { useChatPanelModelCatalog } from './useChatPanelModelCatalog';
import { useChatPanelModelMenuActions } from './useChatPanelModelMenuActions';
import { useChatPanelModelSelection } from './useChatPanelModelSelection';
import { useChatPanelOutsideDismiss } from './useChatPanelOutsideDismiss';
import { useChatPanelToolbarSettingsActions } from './useChatPanelToolbarSettingsActions';
import { useChatPanelVisibility } from './useChatPanelVisibility';
import { useChatPanelVideoCapabilityCatalog } from './useChatPanelVideoCapabilityCatalog';
import {
    useChatPanelVideoCapabilities,
} from './useChatPanelVideoCapabilities';
import {
    PREFERRED_IMAGE_RESOLUTION,
    parseRatio,
    useChatPanelImageSettings,
} from './useChatPanelImageSettings';
import { useChatPanelHeaderActions } from './useChatPanelHeaderActions';
import {
    THINKING_CONFIRM_SKIP_STORAGE_KEY,
    useChatPanelThinkingMode,
} from './useChatPanelThinkingMode';
import { useCreateCreditQuote } from '../../../shared/useCreateCreditQuote';
import {
    SKILL_CATEGORIES as AGENT_SKILL_CATEGORIES,
    SKILLS as AGENT_SKILLS,
    type AgentCanvasSkill,
} from '../config/agentCanvasSkills';

const COMPOSER_MODES: ComposerModeOption[] = [
    { value: 'agent', label: 'Agent', icon: Bot },
    { value: 'image', label: '图像', icon: ImageIcon },
    { value: 'video', label: '视频', icon: Video },
];

interface ChatPanelProps {
    isOpen: boolean;
    onClose: () => void;
    userName?: string;
    isDraggingNode?: boolean;
    onNodeDrop?: (nodeId: string, url: string, type: 'image' | 'video') => void;
    canvasTheme?: 'dark' | 'light';
    getCanvasSnapshot?: () => AgentCanvasSnapshot;
    onApplyActions?: (actions: CanvasAgentAction[]) => Promise<void> | void;
    restoreProjectContext?: AgentCanvasProjectChatContext | null;
    onProjectContextChange?: (context: AgentCanvasProjectChatContext) => void;
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

const CHAT_BUBBLE_TRANSITION_MS = 180;

export const ChatPanel: React.FC<ChatPanelProps> = ({
    isOpen,
    onClose,
    isDraggingNode = false,
    canvasTheme = 'light',
    getCanvasSnapshot,
    onApplyActions,
    restoreProjectContext,
    onProjectContextChange,
}) => {
    const isDark = canvasTheme === 'dark';
    const [message, setMessage] = useState('');
    const [showConversationMenu, setShowConversationMenu] = useState(false);
    const [historySearch, setHistorySearch] = useState('');
    const [showChineseTip, setShowChineseTip] = useState(true);
    const [activeMenu, setActiveMenu] = useState<ComposerMenu>(null);
    const [composerMode, setComposerMode] = useState<ComposerMode>('agent');
    const [skillCategory, setSkillCategory] = useState(AGENT_SKILL_CATEGORIES[0].id);
    const [selectedSkill, setSelectedSkill] = useState<AgentCanvasSkill | null>(null);
    const [webSearchEnabled, setWebSearchEnabled] = useState(false);
    const [canvasFilesEnabled, setCanvasFilesEnabled] = useState(true);
    const [showAssetLibrary, setShowAssetLibrary] = useState(false);
    const [thinkingModeEnabled, setThinkingModeEnabled] = useState(false);
    const [modelPreferenceTab, setModelPreferenceTab] = useState<ModelPreferenceTab>('cot');
    const [autoModelPreference, setAutoModelPreference] = useState(true);
    const [imageResolution, setImageResolution] = useState(PREFERRED_IMAGE_RESOLUTION);
    const [imageAspectRatio, setImageAspectRatio] = useState('1:1');
    const [imageBatchCount, setImageBatchCount] = useState(1);
    const [videoComposerMode, setVideoComposerMode] = useState<VideoComposerMode>('reference');
    const [videoAspectRatio, setVideoAspectRatio] = useState('16:9');
    const [videoResolution, setVideoResolution] = useState('720p');
    const [videoDuration, setVideoDuration] = useState('5s');
    const [videoEditMode, setVideoEditMode] = useState('modify');
    const [videoQualityMode, setVideoQualityMode] = useState('std');
    const [videoGenerateAudio, setVideoGenerateAudio] = useState(false);
    const [selectedVideoShot, setSelectedVideoShot] = useState('');
    const [showThinkingConfirm, setShowThinkingConfirm] = useState(false);
    const [thinkingConfirmNeverAsk, setThinkingConfirmNeverAsk] = useState(() => (
        typeof window !== 'undefined'
            ? window.localStorage.getItem(THINKING_CONFIRM_SKIP_STORAGE_KEY) === 'true'
            : false
    ));
    const dismissActiveMenu = useCallback(() => {
        setActiveMenu(null);
    }, []);
    const dismissConversationMenu = useCallback(() => {
        setShowConversationMenu(false);
    }, []);
    const dismissThinkingConfirm = useCallback(() => {
        setShowThinkingConfirm(false);
    }, []);
    const handlePanelClosed = useCallback(() => {
        dismissActiveMenu();
        dismissConversationMenu();
        dismissThinkingConfirm();
    }, [dismissActiveMenu, dismissConversationMenu, dismissThinkingConfirm]);
    const {
        shouldRenderPanel,
        isPanelVisible,
        panelTransitionStyle,
    } = useChatPanelVisibility({
        isOpen,
        onPanelClosed: handlePanelClosed,
    });
    const {
        isLoadingModelCatalog,
        modelCatalogError,
        textModelOptions,
        cotTextModelOptions,
        imageModelOptions,
        videoModelOptions,
        selectedTextModel,
        selectedImageTool,
        selectedVideoTool,
        selectedImageToolIds,
        selectedVideoToolIds,
        setSelectedTextModel,
        setSelectedImageTool,
        setSelectedVideoTool,
        setSelectedImageToolIds,
        setSelectedVideoToolIds,
    } = useChatPanelModelCatalog();
    const {
        videoCapabilities,
        isLoadingVideoCapabilities,
        videoCapabilityError,
        setVideoCapabilityError,
    } = useChatPanelVideoCapabilityCatalog();

    const {
        messages,
        topic,
        isLoading,
        activityEvents,
        error,
        sessions,
        isLoadingSessions,
        sendMessage,
        cancelGeneration,
        startNewChat,
        loadSession,
        deleteSession,
        hasMessages,
    } = useChatAgent({
        getCanvasSnapshot,
        onApplyActions,
        restoreProjectContext,
        onProjectContextChange,
    });

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const videoSettingsButtonRef = useRef<HTMLButtonElement>(null);
    const videoShotButtonRef = useRef<HTMLButtonElement>(null);
    const { getVideoFloatingPanelStyle } = useChatPanelFloatingPanelLayout({
        activeMenu,
        videoSettingsButtonRef,
        videoShotButtonRef,
    });

    const {
        activeVideoAttachSlotId,
        assetLibraryMediaFilter,
        attachedMedia,
        clearAttachedMedia,
        handleAssetLibrarySelect,
        handleDragEnter,
        handleDragLeave,
        handleDragOver,
        handleDrop,
        handlePickFromCanvas,
        handleUploadFiles,
        isDragOver,
        openAssetLibraryForVideoSlot,
        openLocalUploadForVideoSlot,
        pendingVideoAttachSlot,
        removeAttachment,
        resetVideoAttachmentState,
        setActiveVideoAttachSlotId,
        setAssetLibraryMediaFilter,
        setVideoAttachmentLimits,
        updatePendingVideoAttachSlot,
    } = useChatPanelMediaAttachments({
        composerMode,
        fileInputRef,
        getCanvasSnapshot,
        focusComposer: () => textareaRef.current?.focus(),
        closeActiveMenu: () => setActiveMenu(null),
        setShowAssetLibrary,
    });

    useChatPanelOutsideDismiss({
        isActiveMenuOpen: activeMenu !== null,
        isConversationMenuOpen: showConversationMenu,
        isThinkingConfirmOpen: showThinkingConfirm,
        onDismissActiveMenu: dismissActiveMenu,
        onDismissConversationMenu: dismissConversationMenu,
        onDismissThinkingConfirm: dismissThinkingConfirm,
    });

    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages, isLoading, activityEvents]);

    useEffect(() => {
        if (composerMode !== 'agent' && selectedSkill) {
            setSelectedSkill(null);
        }
    }, [composerMode, selectedSkill]);

    const {
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
    } = useChatPanelImageSettings({
        selectedImageTool,
        imageModelOptions,
        imageResolution,
        imageAspectRatio,
        imageBatchCount,
        getRatioIcon,
    });
    const hasComposerPayload = message.trim().length > 0 || attachedMedia.length > 0 || !!selectedSkill;
    const {
        activeImageToolPool,
        activeVideoToolPool,
        selectedImagePoolLabels,
        selectedVideoPoolLabels,
        activeModelOptions,
        activeModelId,
        activeModelOption,
        modelPreferenceOptions,
        isModelPreferenceOptionSelected,
        handleModelPreferenceOptionSelect,
        handleActiveModelSelect,
    } = useChatPanelModelSelection({
        composerMode,
        modelPreferenceTab,
        autoModelPreference,
        textModelOptions,
        cotTextModelOptions,
        imageModelOptions,
        videoModelOptions,
        selectedTextModel,
        selectedImageTool,
        selectedVideoTool,
        selectedImageToolIds,
        selectedVideoToolIds,
        setSelectedTextModel,
        setSelectedImageTool,
        setSelectedVideoTool,
        setSelectedImageToolIds,
        setSelectedVideoToolIds,
        onActiveModelSelected: () => setActiveMenu(null),
    });
    const {
        selectedVideoOption,
        currentVideoModelId,
        availableVideoModeOptions,
        currentVideoModelCapability,
        currentVideoCapabilitySet,
        videoEditModeOptions,
        effectiveVideoEditModeOptions,
        videoAspectRatioOptions,
        videoResolutionOptions,
        videoDurationOptions,
        currentVideoAspectRatio,
        currentVideoResolution,
        currentVideoDuration,
        videoAspectRatioMenuOptions,
        videoQualityModeOptions,
        videoStatusLabel,
        videoImages,
        videoRefs,
        supportsVideoMultiReferenceImages,
        currentVideoMaxReferenceImages,
        currentVideoMaxReferenceVideos,
        currentVideoMaxReferenceAudios,
        supportsVideoAudioOutput,
        showVideoReferenceSlot,
        showAudioReferenceSlot,
        videoSlotDefinitions,
        hasVideoCapability,
    } = useChatPanelVideoCapabilities({
        selectedVideoTool,
        videoModelOptions,
        videoCapabilities,
        videoComposerMode,
        videoEditMode,
        videoAspectRatio,
        videoResolution,
        videoDuration,
        attachedMedia,
        videoModeOptions: VIDEO_MODE_OPTIONS,
        primaryVideoComposerModes: PRIMARY_VIDEO_COMPOSER_MODES,
        getRatioIcon,
    });
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
        const nextCount = normalizeImageBatchCount(imageBatchCount);
        if (nextCount !== imageBatchCount) {
            setImageBatchCount(nextCount);
        }
    }, [imageBatchCount, normalizeImageBatchCount]);

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
        if (videoQualityModeOptions.length && !videoQualityModeOptions.includes(videoQualityMode)) {
            setVideoQualityMode(videoQualityModeOptions[0]);
        }
        if (effectiveVideoEditModeOptions.length && !effectiveVideoEditModeOptions.includes(videoEditMode)) {
            setVideoEditMode(effectiveVideoEditModeOptions[0]);
        }
    }, [
        currentVideoAspectRatio,
        currentVideoDuration,
        currentVideoResolution,
        effectiveVideoEditModeOptions,
        videoAspectRatio,
        videoDuration,
        videoEditMode,
        videoQualityModeOptions,
        videoQualityMode,
        videoResolution,
    ]);

    useEffect(() => {
        if (!supportsVideoAudioOutput && videoGenerateAudio) {
            setVideoGenerateAudio(false);
        }
    }, [supportsVideoAudioOutput, videoGenerateAudio]);

    useEffect(() => {
        resetVideoAttachmentState();
    }, [composerMode, currentVideoModelId, resetVideoAttachmentState, videoComposerMode]);

    useEffect(() => {
        setVideoAttachmentLimits({
            image: Math.max(currentVideoMaxReferenceImages || 1, 1),
            video: Math.max(currentVideoMaxReferenceVideos || 1, 1),
            audio: Math.max(currentVideoMaxReferenceAudios || 1, 1),
        });
    }, [
        currentVideoMaxReferenceAudios,
        currentVideoMaxReferenceImages,
        currentVideoMaxReferenceVideos,
        setVideoAttachmentLimits,
    ]);

    const handleSend = useChatPanelSendMessage({
        message,
        attachedMedia,
        selectedSkill,
        isLoading,
        sendMessage,
        onComposerSent: () => {
            setMessage('');
            clearAttachedMedia();
            setSelectedSkill(null);
            setActiveMenu(null);
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
            }
        },
        selectedTextModel,
        selectedImageTool,
        selectedVideoTool,
        activeModelLabel: activeModelOption?.label,
        activeImageToolPool,
        activeVideoToolPool,
        canvasFilesEnabled,
        composerMode,
        thinkingModeEnabled,
        autoModelPreference,
        selectedImagePoolLabels,
        selectedImageLabel: selectedImageOption?.label,
        defaultImageLabel: currentCanvasImageModel.name,
        selectedVideoPoolLabels,
        selectedVideoLabel: selectedVideoOption?.label,
        currentVideoModelId,
        showImageResolutionSettings,
        currentImageResolution,
        currentImageAspectRatioLabel,
        showImageDimensionSettings,
        hasCurrentImageSize: Boolean(currentImageSize),
        currentImageSizeLabel,
        showImageOutputCountSettings,
        currentImageBatchCount,
        videoComposerMode,
        videoModeOptions: VIDEO_MODE_OPTIONS,
        currentVideoAspectRatio,
        showVideoResolution: videoResolutionOptions.length > 0,
        currentVideoResolution,
        showVideoDuration: videoDurationOptions.length > 0,
        currentVideoDuration,
        supportsVideoAudioOutput,
        videoGenerateAudio,
        webSearchEnabled,
        selectedVideoShot,
    });

    const {
        isGeneratingComposerVideo,
        handleDirectVideoGenerate,
    } = useChatPanelVideoGeneration({
        isLoading,
        message,
        attachedMedia,
        onApplyActions,
        onFallbackSend: handleSend,
        onCapabilityError: setVideoCapabilityError,
        onGenerationStarted: () => {
            setMessage('');
            clearAttachedMedia();
            setActiveMenu(null);
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
            }
        },
        selectedVideoShot,
        currentVideoDuration,
        currentVideoModelId,
        currentVideoAspectRatio,
        currentVideoResolution,
        currentVideoMaxReferenceImages,
        currentVideoMaxReferenceVideos,
        currentVideoMaxReferenceAudios,
        currentVideoCapabilitySet,
        currentVideoModelCapability,
        supportsVideoMultiReferenceImages,
        supportsVideoAudioOutput,
        videoGenerateAudio,
        webSearchEnabled,
        videoQualityMode,
        showAudioReferenceSlot,
        videoComposerMode,
        videoEditMode,
        videoCapabilities,
    });

    const {
        composerAction,
        handleComposerAction,
    } = useChatPanelComposerAction({
        mode: composerMode,
        isLoading,
        isGeneratingComposerVideo,
        isLoadingVideoCapabilities,
        hasComposerPayload,
        videoComposerMode,
        videoImageCount: videoImages.length,
        videoReferenceCount: videoRefs.length,
        hasTextPrompt: message.trim().length > 0,
        attachedMediaCount: attachedMedia.length,
        hasVideoCapability,
        imageActionCreditsLabel,
        onCancelGeneration: cancelGeneration,
        onFocusComposer: () => textareaRef.current?.focus(),
        onGenerateVideo: handleDirectVideoGenerate,
        onSend: handleSend,
    });

    const topicTitle = topic || (hasMessages ? '新的对话' : '智能体画布');
    const resetHeaderComposerForNewChat = useCallback(() => {
        setMessage('');
        clearAttachedMedia();
        setSelectedSkill(null);
        dismissActiveMenu();
        dismissConversationMenu();
        setShowChineseTip(true);
    }, [clearAttachedMedia, dismissActiveMenu, dismissConversationMenu]);
    const closeHeaderAfterSessionLoad = useCallback(() => {
        dismissConversationMenu();
        setShowChineseTip(false);
    }, [dismissConversationMenu]);
    const {
        handleNewChat,
        handleLoadSession,
        handleDeleteSession,
        handleCopyShareLink,
        handleShareConversationImage,
        handlePublishConversation,
    } = useChatPanelHeaderActions({
        messages,
        topicTitle,
        startNewChat,
        loadSession,
        deleteSession,
        onNewChatReset: resetHeaderComposerForNewChat,
        onSessionLoaded: closeHeaderAfterSessionLoad,
        onShareMenuClose: dismissActiveMenu,
    });
    const {
        handleThinkingClick,
        confirmThinkingNewChat,
    } = useChatPanelThinkingMode({
        thinkingConfirmNeverAsk,
        setThinkingModeEnabled,
        setComposerMode,
        setThinkingConfirmOpen: setShowThinkingConfirm,
        onNewChat: handleNewChat,
    });
    const {
        handleSkillSelect,
        toggleSkillsMenu,
        toggleImageAttachMenu,
        openLocalUploadForImageAttachment,
        openAssetLibraryForImageAttachment,
        toggleAgentMoreMenu,
        openLocalUploadFromAgentMoreMenu,
        openAssetLibraryFromAgentMoreMenu,
        toggleModeMenu,
        selectComposerMode,
        toggleImageSettingsMenu,
        toggleVideoSettingsMenu,
        toggleVideoShotMenu,
        selectVideoShot,
        toggleVideoAttachMenu,
    } = useChatPanelComposerMenuActions({
        activeMenu,
        activeVideoAttachSlotId,
        fileInputRef,
        setActiveMenu,
        setActiveVideoAttachSlotId,
        setAssetLibraryMediaFilter,
        setComposerMode,
        setModelPreferenceTab,
        setSelectedSkill,
        setSelectedVideoShot,
        setShowAssetLibrary,
        focusComposer: () => textareaRef.current?.focus(),
        updatePendingVideoAttachSlot,
    });
    const {
        toggleModelMenu,
        toggleAutoModelPreference,
    } = useChatPanelModelMenuActions({
        setActiveMenu,
        setAutoModelPreference,
    });
    const {
        toggleCanvasFiles,
        toggleWebSearch,
        setNormalizedImageBatchCount,
        toggleVideoGenerateAudio,
    } = useChatPanelToolbarSettingsActions({
        normalizeImageBatchCount,
        setCanvasFilesEnabled,
        setImageBatchCount,
        setVideoGenerateAudio,
        setWebSearchEnabled,
    });
    const {
        removeSelectedSkill,
        closeChineseReplyTip,
        toggleThinkingConfirmNeverAsk,
        cancelThinkingConfirm,
    } = useChatPanelComposerShellActions({
        setSelectedSkill,
        setShowChineseTip,
        setShowThinkingConfirm,
        setThinkingConfirmNeverAsk,
    });

    if (!shouldRenderPanel) return null;

    const showHighlight = isDraggingNode || isDragOver;
    const normalizedHistorySearch = historySearch.trim().toLowerCase();
    const visibleSessions = sessions.filter((session) => {
        if (!normalizedHistorySearch) return true;
        return session.topic.toLowerCase().includes(normalizedHistorySearch);
    });
    const activeModelTooltip = '模型偏好';
    const composerFileAccept = getVideoAttachAccept(pendingVideoAttachSlot) ||
        (composerMode === 'image'
        ? 'image/*'
        : composerMode === 'video'
            ? ['image/*', showVideoReferenceSlot ? 'video/*' : null, showAudioReferenceSlot ? 'audio/*' : null]
                .filter(Boolean)
                .join(',')
            : 'image/*,video/*');

    const composerBodyProps: ChatPanelComposerBodyProps = {
        composerMode,
        activeMenu,
        message,
        selectedSkill,
        attachedMedia,
        isLoading,
        textareaRef,
        videoSlotDefinitions,
        activeVideoAttachSlotId,
        selectedVideoShot,
        onMessageChange: setMessage,
        onSend: handleSend,
        onRemoveAttachment: removeAttachment,
        onRemoveSkill: removeSelectedSkill,
        onVideoAttachSlotToggle: toggleVideoAttachMenu,
        onVideoLocalUpload: openLocalUploadForVideoSlot,
        onVideoAssetLibrary: openAssetLibraryForVideoSlot,
        onPickFromCanvas: handlePickFromCanvas,
        onVideoShotToggle: toggleVideoShotMenu,
        onImageAttachToggle: toggleImageAttachMenu,
        onImageLocalUpload: openLocalUploadForImageAttachment,
        onImageAssetLibrary: openAssetLibraryForImageAttachment,
    };

    const toolbarControlsProps: ChatPanelComposerToolbarControlsProps = {
        composerMode,
        activeMenu,
        modes: COMPOSER_MODES,
        canvasFilesEnabled,
        webSearchEnabled,
        skillCategories: AGENT_SKILL_CATEGORIES,
        skills: AGENT_SKILLS,
        skillCategory,
        selectedSkillId: selectedSkill?.id,
        imageSettingsSummary,
        imageSettingsTitle,
        showImageQualitySettings,
        imageQualityOptions,
        currentImageQualityLabel,
        showImageResolutionSettings,
        imageResolutionMenuOptions,
        currentImageResolution,
        showImageDimensionSettings,
        currentImageSize,
        imageAspectRatioMenuOptions,
        imageAspectRatio,
        showImageOutputCountSettings,
        imageCountOptions,
        currentImageBatchCount,
        videoSettingsButtonRef,
        videoShotButtonRef,
        videoStatusLabel,
        availableVideoModeOptions,
        videoComposerMode,
        videoCapabilityError,
        isLoadingVideoCapabilities,
        hasVideoCapability,
        videoAspectRatioMenuOptions,
        currentVideoAspectRatio,
        videoResolutionOptions,
        currentVideoResolution,
        videoDurationOptions,
        currentVideoDuration,
        videoEditModeOptions,
        videoEditMode,
        videoQualityModeOptions,
        videoQualityMode,
        supportsVideoAudioOutput,
        videoGenerateAudio,
        selectedVideoShot,
        videoShotOptions: VIDEO_SHOT_OPTIONS,
        getVideoFloatingPanelStyle,
        onToggleMoreMenu: toggleAgentMoreMenu,
        onUploadFile: openLocalUploadFromAgentMoreMenu,
        onAssetLibrary: openAssetLibraryFromAgentMoreMenu,
        onToggleCanvasFiles: toggleCanvasFiles,
        onToggleWebSearch: toggleWebSearch,
        onToggleSkillsMenu: toggleSkillsMenu,
        onSkillCategoryChange: setSkillCategory,
        onSkillSelect: handleSkillSelect,
        onToggleModeMenu: toggleModeMenu,
        onSelectComposerMode: selectComposerMode,
        onToggleImageSettingsMenu: toggleImageSettingsMenu,
        onImageResolutionChange: setImageResolution,
        onImageAspectRatioChange: setImageAspectRatio,
        onImageBatchCountChange: setNormalizedImageBatchCount,
        onToggleVideoSettingsMenu: toggleVideoSettingsMenu,
        onVideoComposerModeChange: setVideoComposerMode,
        onVideoAspectRatioChange: setVideoAspectRatio,
        onVideoResolutionChange: setVideoResolution,
        onVideoDurationChange: setVideoDuration,
        onVideoEditModeChange: setVideoEditMode,
        onVideoQualityModeChange: setVideoQualityMode,
        onToggleVideoGenerateAudio: toggleVideoGenerateAudio,
        onToggleVideoShotMenu: toggleVideoShotMenu,
        onSelectVideoShot: selectVideoShot,
    };

    const toolbarActionsProps: ChatPanelComposerToolbarActionsProps = {
        composerMode,
        activeMenu,
        thinkingModeEnabled,
        activeModelTooltip,
        isLoadingModelCatalog,
        activeModelOptions,
        activeModelId,
        activeModelOption,
        isDark,
        autoModelPreference,
        modelPreferenceTab,
        modelPreferenceOptions,
        modelCatalogError,
        composerAction,
        getModelOptionIcon,
        isModelPreferenceOptionSelected,
        onThinkingClick: handleThinkingClick,
        onToggleModelMenu: toggleModelMenu,
        onToggleAutoModelPreference: toggleAutoModelPreference,
        onModelPreferenceTabChange: setModelPreferenceTab,
        onModelPreferenceOptionSelect: handleModelPreferenceOptionSelect,
        onActiveModelSelect: handleActiveModelSelect,
        onComposerAction: handleComposerAction,
    };

    const headerConversationMenuProps = {
        isOpen: showConversationMenu,
        search: historySearch,
        sessions: visibleSessions,
        isLoadingSessions,
        fallbackTopicTitle: topicTitle,
        onNewChat: handleNewChat,
        onToggleOpen: () => setShowConversationMenu((value) => !value),
        onSearchChange: setHistorySearch,
        onLoadSession: handleLoadSession,
        onDeleteSession: handleDeleteSession,
    };

    const headerShareMenuProps = {
        isOpen: activeMenu === 'share',
        isDark,
        onToggleOpen: () => {
            dismissConversationMenu();
            setActiveMenu((m) => (m === 'share' ? null : 'share'));
        },
        onCopyLink: handleCopyShareLink,
        onShareImage: handleShareConversationImage,
        onPublish: handlePublishConversation,
    };

    return (
        <div
            aria-hidden={!isPanelVisible}
            className={`agent-chat-panel fixed right-0 top-0 z-[90] flex h-full w-[400px] transform-gpu select-text flex-col border-l bg-card text-card-foreground shadow-2xl will-change-transform ${isPanelVisible ? '' : 'pointer-events-none'} ${showHighlight ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}
            style={panelTransitionStyle}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
        >
            {showHighlight && <ChatPanelDropOverlay />}

            <ChatPanelHeader
                title={topicTitle}
                conversationMenu={headerConversationMenuProps}
                shareMenu={headerShareMenuProps}
                onClose={onClose}
            />

            <ChatPanelMessageList
                messages={messages}
                activityEvents={activityEvents}
                isLoading={isLoading}
                hasMessages={hasMessages}
                error={error}
                messagesEndRef={messagesEndRef}
            />

            <ChatPanelComposer
                chineseReplyTip={{
                    isOpen: showChineseTip,
                    isDark,
                    onClose: closeChineseReplyTip,
                }}
                thinkingConfirmDialog={{
                    isOpen: showThinkingConfirm,
                    neverAsk: thinkingConfirmNeverAsk,
                    onToggleNeverAsk: toggleThinkingConfirmNeverAsk,
                    onCancel: cancelThinkingConfirm,
                    onConfirm: confirmThinkingNewChat,
                }}
                body={composerBodyProps}
                toolbar={{
                    controls: toolbarControlsProps,
                    actions: toolbarActionsProps,
                }}
                fileInput={{
                    inputRef: fileInputRef,
                    accept: composerFileAccept,
                    onFilesChange: handleUploadFiles,
                }}
            />

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
    const [shouldRenderBubble, setShouldRenderBubble] = useState(!isOpen);
    const [isBubbleVisible, setIsBubbleVisible] = useState(!isOpen);

    useEffect(() => {
        let frameId = 0;
        let timeoutId = 0;

        if (isOpen) {
            setIsBubbleVisible(false);
            timeoutId = window.setTimeout(() => {
                setShouldRenderBubble(false);
            }, CHAT_BUBBLE_TRANSITION_MS);
        } else {
            setShouldRenderBubble(true);
            frameId = window.requestAnimationFrame(() => {
                setIsBubbleVisible(true);
            });
        }

        return () => {
            if (frameId) window.cancelAnimationFrame(frameId);
            if (timeoutId) window.clearTimeout(timeoutId);
        };
    }, [isOpen]);

    if (!shouldRenderBubble) return null;

    const bubbleTransitionStyle: React.CSSProperties = {
        opacity: isBubbleVisible ? 1 : 0,
        transform: isBubbleVisible ? 'translate3d(0, 0, 0) scale(1)' : 'translate3d(12px, 0, 0) scale(0.96)',
        transition: `transform ${CHAT_BUBBLE_TRANSITION_MS}ms ease, opacity ${CHAT_BUBBLE_TRANSITION_MS}ms ease`,
    };

    return (
        <button
            type="button"
            onClick={onClick}
            className={`fixed right-4 top-4 z-50 flex h-9 transform-gpu items-center gap-1.5 rounded-xl border border-border bg-card px-3 text-sm font-medium text-foreground shadow-sm transition-colors will-change-transform hover:bg-accent hover:text-accent-foreground ${isBubbleVisible ? '' : 'pointer-events-none'}`}
            style={bubbleTransitionStyle}
            aria-label="打开对话"
            aria-hidden={!isBubbleVisible}
        >
            <MessageSquare size={14} />
            <span>对话</span>
        </button>
    );
};
