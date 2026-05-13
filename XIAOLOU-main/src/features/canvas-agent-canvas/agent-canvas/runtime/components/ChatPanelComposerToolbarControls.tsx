import type { CSSProperties, RefObject } from 'react';
import { BookOpen, Plus } from 'lucide-react';

import { ChatPanelAgentMoreMenu } from './ChatPanelAgentMoreMenu';
import { ChatPanelImageSettingsMenu } from './ChatPanelImageSettingsMenu';
import { ChatPanelModeMenu } from './ChatPanelModeMenu';
import { ChatPanelSkillsMenu } from './ChatPanelSkillsMenu';
import { ChatPanelToolbarTooltip } from './ChatPanelToolbarTooltip';
import { ChatPanelVideoSettingsMenu } from './ChatPanelVideoSettingsMenu';
import { ChatPanelVideoShotMenu } from './ChatPanelVideoShotMenu';
import type {
    ComposerMenu,
    ComposerMode,
    ComposerModeOption,
    ImageAspectRatioOption,
    ImageResolutionOption,
    ImageSize,
    VideoAspectRatioOption,
    VideoComposerMode,
    VideoModeOption,
} from './ChatPanelComposerToolbarTypes';
import type {
    AgentCanvasSkill,
    AgentCanvasSkillCategory,
} from '../config/agentCanvasSkills';

export type ChatPanelComposerToolbarControlsProps = {
    composerMode: ComposerMode;
    activeMenu: ComposerMenu;
    modes: ComposerModeOption[];
    canvasFilesEnabled: boolean;
    webSearchEnabled: boolean;
    skillCategories: AgentCanvasSkillCategory[];
    skills: AgentCanvasSkill[];
    skillCategory: string;
    selectedSkillId?: string | null;
    imageSettingsSummary: string;
    imageSettingsTitle: string;
    showImageQualitySettings: boolean;
    imageQualityOptions: string[];
    currentImageQualityLabel: string;
    showImageResolutionSettings: boolean;
    imageResolutionMenuOptions: ImageResolutionOption[];
    currentImageResolution: string;
    showImageDimensionSettings: boolean;
    currentImageSize: ImageSize;
    imageAspectRatioMenuOptions: ImageAspectRatioOption[];
    imageAspectRatio: string;
    showImageOutputCountSettings: boolean;
    imageCountOptions: number[];
    currentImageBatchCount: number;
    videoSettingsButtonRef: RefObject<HTMLButtonElement | null>;
    videoShotButtonRef: RefObject<HTMLButtonElement | null>;
    videoStatusLabel: string;
    availableVideoModeOptions: VideoModeOption[];
    videoComposerMode: VideoComposerMode;
    videoCapabilityError: string | null;
    isLoadingVideoCapabilities: boolean;
    hasVideoCapability: boolean;
    videoAspectRatioMenuOptions: VideoAspectRatioOption[];
    currentVideoAspectRatio: string;
    videoResolutionOptions: string[];
    currentVideoResolution: string;
    videoDurationOptions: string[];
    currentVideoDuration: string;
    videoEditModeOptions: string[];
    videoEditMode: string;
    videoQualityModeOptions: string[];
    videoQualityMode: string;
    supportsVideoAudioOutput: boolean;
    videoGenerateAudio: boolean;
    selectedVideoShot: string;
    videoShotOptions: string[];
    getVideoFloatingPanelStyle: (fallbackWidth: number) => CSSProperties;
    onToggleMoreMenu: () => void;
    onUploadFile: () => void;
    onAssetLibrary: () => void;
    onToggleCanvasFiles: () => void;
    onToggleWebSearch: () => void;
    onToggleSkillsMenu: () => void;
    onSkillCategoryChange: (categoryId: string) => void;
    onSkillSelect: (skill: AgentCanvasSkill) => void;
    onToggleModeMenu: () => void;
    onSelectComposerMode: (mode: ComposerMode) => void;
    onToggleImageSettingsMenu: () => void;
    onImageResolutionChange: (resolution: string) => void;
    onImageAspectRatioChange: (aspectRatio: string) => void;
    onImageBatchCountChange: (count: number) => void;
    onToggleVideoSettingsMenu: () => void;
    onVideoComposerModeChange: (mode: VideoComposerMode) => void;
    onVideoAspectRatioChange: (ratio: string) => void;
    onVideoResolutionChange: (resolution: string) => void;
    onVideoDurationChange: (duration: string) => void;
    onVideoEditModeChange: (mode: string) => void;
    onVideoQualityModeChange: (mode: string) => void;
    onToggleVideoGenerateAudio: () => void;
    onToggleVideoShotMenu: () => void;
    onSelectVideoShot: (shot: string) => void;
};

function menuButtonClass(isActive = false) {
    return `flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-neutral-800 transition-colors ${isActive ? 'bg-neutral-100' : 'hover:bg-neutral-100'}`;
}

export function ChatPanelComposerToolbarControls({
    composerMode,
    activeMenu,
    modes,
    canvasFilesEnabled,
    webSearchEnabled,
    skillCategories,
    skills,
    skillCategory,
    selectedSkillId,
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
    videoShotOptions,
    getVideoFloatingPanelStyle,
    onToggleMoreMenu,
    onUploadFile,
    onAssetLibrary,
    onToggleCanvasFiles,
    onToggleWebSearch,
    onToggleSkillsMenu,
    onSkillCategoryChange,
    onSkillSelect,
    onToggleModeMenu,
    onSelectComposerMode,
    onToggleImageSettingsMenu,
    onImageResolutionChange,
    onImageAspectRatioChange,
    onImageBatchCountChange,
    onToggleVideoSettingsMenu,
    onVideoComposerModeChange,
    onVideoAspectRatioChange,
    onVideoResolutionChange,
    onVideoDurationChange,
    onVideoEditModeChange,
    onVideoQualityModeChange,
    onToggleVideoGenerateAudio,
    onToggleVideoShotMenu,
    onSelectVideoShot,
}: ChatPanelComposerToolbarControlsProps) {
    return (
        <div className="agent-chat-composer-controls flex min-w-0 items-center gap-1.5">
            {composerMode === 'agent' && (
                <>
                    <div className="group relative" data-agent-active-menu-root>
                        <ChatPanelToolbarTooltip label="更多">
                            <button
                                type="button"
                                onClick={onToggleMoreMenu}
                                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${activeMenu === 'more' ? 'bg-neutral-100 text-neutral-950' : 'bg-neutral-100 text-neutral-700 hover:bg-neutral-200'}`}
                                aria-label="更多"
                            >
                                <Plus size={17} />
                            </button>
                        </ChatPanelToolbarTooltip>

                        {activeMenu === 'more' && (
                            <ChatPanelAgentMoreMenu
                                canvasFilesEnabled={canvasFilesEnabled}
                                webSearchEnabled={webSearchEnabled}
                                onUploadFile={onUploadFile}
                                onAssetLibrary={onAssetLibrary}
                                onToggleCanvasFiles={onToggleCanvasFiles}
                                onToggleWebSearch={onToggleWebSearch}
                            />
                        )}
                    </div>

                    <div className="relative" data-agent-active-menu-root>
                        <ChatPanelToolbarTooltip label="Skills">
                            <button
                                type="button"
                                onClick={onToggleSkillsMenu}
                                className={menuButtonClass(activeMenu === 'skills')}
                                aria-label="Skills"
                            >
                                <BookOpen size={16} />
                            </button>
                        </ChatPanelToolbarTooltip>

                        {activeMenu === 'skills' && (
                            <ChatPanelSkillsMenu
                                categories={skillCategories}
                                skills={skills}
                                activeCategoryId={skillCategory}
                                selectedSkillId={selectedSkillId}
                                onCategoryChange={onSkillCategoryChange}
                                onSkillSelect={onSkillSelect}
                            />
                        )}
                    </div>
                </>
            )}

            <ChatPanelModeMenu
                modes={modes}
                activeMode={composerMode}
                isOpen={activeMenu === 'mode'}
                onToggle={onToggleModeMenu}
                onSelect={onSelectComposerMode}
            />

            {composerMode === 'image' && (
                <ChatPanelImageSettingsMenu
                    isOpen={activeMenu === 'imageSettings'}
                    summary={imageSettingsSummary}
                    title={imageSettingsTitle}
                    showQualitySettings={showImageQualitySettings}
                    qualityOptions={imageQualityOptions}
                    currentQualityLabel={currentImageQualityLabel}
                    showResolutionSettings={showImageResolutionSettings}
                    resolutionOptions={imageResolutionMenuOptions}
                    currentResolution={currentImageResolution}
                    showDimensionSettings={showImageDimensionSettings}
                    currentSize={currentImageSize}
                    aspectRatioOptions={imageAspectRatioMenuOptions}
                    currentAspectRatio={imageAspectRatio}
                    showOutputCountSettings={showImageOutputCountSettings}
                    countOptions={imageCountOptions}
                    currentBatchCount={currentImageBatchCount}
                    onToggle={onToggleImageSettingsMenu}
                    onResolutionChange={onImageResolutionChange}
                    onAspectRatioChange={onImageAspectRatioChange}
                    onBatchCountChange={onImageBatchCountChange}
                />
            )}

            {composerMode === 'video' && (
                <div className="relative flex shrink-0 items-center gap-4" data-agent-active-menu-root>
                    <ChatPanelVideoSettingsMenu
                        triggerRef={videoSettingsButtonRef}
                        isOpen={activeMenu === 'videoSettings'}
                        statusLabel={videoStatusLabel}
                        panelStyle={getVideoFloatingPanelStyle(368)}
                        availableModeOptions={availableVideoModeOptions}
                        videoComposerMode={videoComposerMode}
                        videoCapabilityError={videoCapabilityError}
                        isLoadingVideoCapabilities={isLoadingVideoCapabilities}
                        hasVideoCapability={hasVideoCapability}
                        aspectRatioOptions={videoAspectRatioMenuOptions}
                        currentAspectRatio={currentVideoAspectRatio}
                        resolutionOptions={videoResolutionOptions}
                        currentResolution={currentVideoResolution}
                        durationOptions={videoDurationOptions}
                        currentDuration={currentVideoDuration}
                        editModeOptions={videoEditModeOptions}
                        editMode={videoEditMode}
                        qualityModeOptions={videoQualityModeOptions}
                        qualityMode={videoQualityMode}
                        supportsAudioOutput={supportsVideoAudioOutput}
                        generateAudio={videoGenerateAudio}
                        webSearchEnabled={webSearchEnabled}
                        onToggle={onToggleVideoSettingsMenu}
                        onComposerModeChange={onVideoComposerModeChange}
                        onAspectRatioChange={onVideoAspectRatioChange}
                        onResolutionChange={onVideoResolutionChange}
                        onDurationChange={onVideoDurationChange}
                        onEditModeChange={onVideoEditModeChange}
                        onQualityModeChange={onVideoQualityModeChange}
                        onToggleGenerateAudio={onToggleVideoGenerateAudio}
                        onToggleWebSearch={onToggleWebSearch}
                    />
                    <ChatPanelVideoShotMenu
                        triggerRef={videoShotButtonRef}
                        isOpen={activeMenu === 'videoShot'}
                        selectedShot={selectedVideoShot}
                        options={videoShotOptions}
                        panelStyle={getVideoFloatingPanelStyle(360)}
                        onToggle={onToggleVideoShotMenu}
                        onSelect={onSelectVideoShot}
                    />
                </div>
            )}
        </div>
    );
}
