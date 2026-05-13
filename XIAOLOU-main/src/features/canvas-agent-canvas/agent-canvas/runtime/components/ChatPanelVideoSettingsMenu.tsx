import type { CSSProperties, ReactNode, RefObject } from 'react';
import { SlidersHorizontal } from 'lucide-react';

type VideoComposerMode =
    | 'reference'
    | 'start_end_frame'
    | 'multi_param'
    | 'video_edit'
    | 'motion_control';

type VideoModeOption = {
    value: VideoComposerMode;
    label: string;
};

type VideoAspectRatioOption = {
    value: string;
    label: string;
    icon?: ReactNode;
};

type ChatPanelVideoSettingsMenuProps = {
    triggerRef: RefObject<HTMLButtonElement | null>;
    isOpen: boolean;
    statusLabel: string;
    panelStyle: CSSProperties;
    availableModeOptions: VideoModeOption[];
    videoComposerMode: VideoComposerMode;
    videoCapabilityError: string | null;
    isLoadingVideoCapabilities: boolean;
    hasVideoCapability: boolean;
    aspectRatioOptions: VideoAspectRatioOption[];
    currentAspectRatio: string;
    resolutionOptions: string[];
    currentResolution: string;
    durationOptions: string[];
    currentDuration: string;
    editModeOptions: string[];
    editMode: string;
    qualityModeOptions: string[];
    qualityMode: string;
    supportsAudioOutput: boolean;
    generateAudio: boolean;
    webSearchEnabled: boolean;
    onToggle: () => void;
    onComposerModeChange: (mode: VideoComposerMode) => void;
    onAspectRatioChange: (ratio: string) => void;
    onResolutionChange: (resolution: string) => void;
    onDurationChange: (duration: string) => void;
    onEditModeChange: (mode: string) => void;
    onQualityModeChange: (mode: string) => void;
    onToggleGenerateAudio: () => void;
    onToggleWebSearch: () => void;
};

const toolbarButtonClass = (isActive = false) =>
    `flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-transparent text-neutral-800 transition-colors ${isActive ? 'bg-neutral-100' : 'hover:bg-neutral-100'}`;

const floatingPanelClass = 'fixed z-50 overflow-y-auto rounded-2xl border border-border bg-card text-card-foreground shadow-[0_18px_60px_rgba(0,0,0,0.24)]';
const sectionLabelClass = 'text-sm font-medium text-muted-foreground';
const segmentClass = 'flex flex-nowrap overflow-x-auto rounded-xl bg-muted p-0.5';
const segmentButtonClass = (selected: boolean) => `h-8 min-w-max flex-1 whitespace-nowrap rounded-lg px-3 text-sm transition-colors ${
    selected ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
}`;
const choiceButtonClass = (selected: boolean, extra = '') => `${extra} rounded-xl border transition-colors ${
    selected
        ? 'border-primary/40 bg-primary/10 text-foreground shadow-sm'
        : 'border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground'
}`;
const toggleRowClass = 'flex items-center justify-between rounded-xl bg-muted px-3 py-2';
const toggleButtonClass = (checked: boolean) => `flex h-6 w-10 items-center rounded-full p-0.5 transition-colors ${
    checked ? 'bg-primary' : 'bg-border'
}`;

export function ChatPanelVideoSettingsMenu({
    triggerRef,
    isOpen,
    statusLabel,
    panelStyle,
    availableModeOptions,
    videoComposerMode,
    videoCapabilityError,
    isLoadingVideoCapabilities,
    hasVideoCapability,
    aspectRatioOptions,
    currentAspectRatio,
    resolutionOptions,
    currentResolution,
    durationOptions,
    currentDuration,
    editModeOptions,
    editMode,
    qualityModeOptions,
    qualityMode,
    supportsAudioOutput,
    generateAudio,
    webSearchEnabled,
    onToggle,
    onComposerModeChange,
    onAspectRatioChange,
    onResolutionChange,
    onDurationChange,
    onEditModeChange,
    onQualityModeChange,
    onToggleGenerateAudio,
    onToggleWebSearch,
}: ChatPanelVideoSettingsMenuProps) {
    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                onClick={onToggle}
                className={toolbarButtonClass(isOpen)}
                aria-label="视频设置"
                title={statusLabel ? `视频设置 · ${statusLabel}` : '视频设置'}
            >
                <SlidersHorizontal size={18} strokeWidth={2.1} />
            </button>

            {isOpen && (
                <div
                    className={`${floatingPanelClass} p-4`}
                    style={panelStyle}
                    onWheel={(e) => e.stopPropagation()}
                >
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <div className={sectionLabelClass}>Generate method</div>
                            {availableModeOptions.length > 0 && (
                                <div className={segmentClass}>
                                    {availableModeOptions.map((mode) => (
                                        <button
                                            key={mode.value}
                                            type="button"
                                            onClick={() => onComposerModeChange(mode.value)}
                                            className={segmentButtonClass(videoComposerMode === mode.value)}
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
                                {!!aspectRatioOptions.length && videoComposerMode !== 'motion_control' && (
                                    <div className="space-y-2">
                                        <div className={sectionLabelClass}>Size</div>
                                        <div className="grid grid-cols-3 gap-2">
                                            {aspectRatioOptions.map((ratio) => (
                                                <button
                                                    key={ratio.value}
                                                    type="button"
                                                    onClick={() => onAspectRatioChange(ratio.value)}
                                                    className={choiceButtonClass(currentAspectRatio === ratio.value, 'flex h-[72px] flex-col items-center justify-center gap-2 text-sm')}
                                                >
                                                    {ratio.icon ? (
                                                        <>
                                                            {ratio.icon}
                                                            <span>{ratio.label}</span>
                                                        </>
                                                    ) : (
                                                        <span>{ratio.label}</span>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {!!resolutionOptions.length && videoComposerMode !== 'motion_control' && (
                                    <div className="space-y-2">
                                        <div className={sectionLabelClass}>Resolution</div>
                                        <div className="grid grid-cols-3 gap-2">
                                            {resolutionOptions.map((resolution) => (
                                                <button
                                                    key={resolution}
                                                    type="button"
                                                    onClick={() => onResolutionChange(resolution)}
                                                    className={choiceButtonClass(currentResolution === resolution, 'h-9 text-sm')}
                                                >
                                                    {resolution}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {!!durationOptions.length && videoComposerMode !== 'motion_control' && (
                                    <div className="space-y-2">
                                        <div className={sectionLabelClass}>Duration</div>
                                        <div className="grid grid-cols-4 gap-2">
                                            {durationOptions.map((duration) => (
                                                <button
                                                    key={duration}
                                                    type="button"
                                                    onClick={() => onDurationChange(duration)}
                                                    className={choiceButtonClass(currentDuration === duration, 'h-9 text-sm')}
                                                >
                                                    {duration}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {videoComposerMode === 'video_edit' && (
                                    <div className="space-y-2">
                                        <div className={sectionLabelClass}>Edit mode</div>
                                        <div className="grid grid-cols-2 gap-2">
                                            {editModeOptions.map((mode) => (
                                                <button
                                                    key={mode}
                                                    type="button"
                                                    onClick={() => onEditModeChange(mode)}
                                                    className={choiceButtonClass(editMode === mode, 'h-9 text-sm')}
                                                >
                                                    {mode}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {videoComposerMode === 'motion_control' && (
                                    <div className="space-y-2">
                                        <div className={sectionLabelClass}>Mode</div>
                                        <div className="grid grid-cols-2 gap-2">
                                            {qualityModeOptions.map((mode) => (
                                                <button
                                                    key={mode}
                                                    type="button"
                                                    onClick={() => onQualityModeChange(mode)}
                                                    className={choiceButtonClass(qualityMode === mode, 'h-9 text-sm')}
                                                >
                                                    {mode}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {supportsAudioOutput && (
                                    <div className={toggleRowClass}>
                                        <span className="text-base text-foreground">音频</span>
                                        <button
                                            type="button"
                                            onClick={onToggleGenerateAudio}
                                            className={toggleButtonClass(generateAudio)}
                                            aria-pressed={generateAudio}
                                        >
                                            <span className={`h-5 w-5 rounded-full bg-white transition-transform ${generateAudio ? 'translate-x-4' : ''}`} />
                                        </button>
                                    </div>
                                )}

                                <div className={toggleRowClass}>
                                    <span className="text-base text-foreground">网络搜索</span>
                                    <button
                                        type="button"
                                        onClick={onToggleWebSearch}
                                        className={toggleButtonClass(webSearchEnabled)}
                                        aria-pressed={webSearchEnabled}
                                    >
                                        <span className={`h-5 w-5 rounded-full bg-white transition-transform ${webSearchEnabled ? 'translate-x-4' : ''}`} />
                                    </button>
                                </div>

                                {statusLabel && (
                                    <div className="text-xs text-muted-foreground">
                                        能力状态：{statusLabel}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
