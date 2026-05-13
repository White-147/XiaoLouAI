import type { ReactNode } from 'react';
import { ArrowLeftRight, ChevronDown } from 'lucide-react';

type ImageSize = {
    w: number;
    h: number;
} | null;

type ImageResolutionOption = {
    value: string;
    previewSize: string;
};

type ImageAspectRatioOption = {
    value: string;
    label: string;
    icon: ReactNode;
};

type ChatPanelImageSettingsMenuProps = {
    isOpen: boolean;
    summary: string;
    title: string;
    showQualitySettings: boolean;
    qualityOptions: string[];
    currentQualityLabel: string;
    showResolutionSettings: boolean;
    resolutionOptions: ImageResolutionOption[];
    currentResolution: string;
    showDimensionSettings: boolean;
    currentSize: ImageSize;
    aspectRatioOptions: ImageAspectRatioOption[];
    currentAspectRatio: string;
    showOutputCountSettings: boolean;
    countOptions: number[];
    currentBatchCount: number;
    onToggle: () => void;
    onResolutionChange: (resolution: string) => void;
    onAspectRatioChange: (aspectRatio: string) => void;
    onBatchCountChange: (count: number) => void;
};

export function ChatPanelImageSettingsMenu({
    isOpen,
    summary,
    title,
    showQualitySettings,
    qualityOptions,
    currentQualityLabel,
    showResolutionSettings,
    resolutionOptions,
    currentResolution,
    showDimensionSettings,
    currentSize,
    aspectRatioOptions,
    currentAspectRatio,
    showOutputCountSettings,
    countOptions,
    currentBatchCount,
    onToggle,
    onResolutionChange,
    onAspectRatioChange,
    onBatchCountChange,
}: ChatPanelImageSettingsMenuProps) {
    return (
        <div className="relative" data-agent-active-menu-root>
            <button
                type="button"
                onClick={onToggle}
                className={`agent-chat-image-settings-button flex h-8 min-w-0 shrink items-center gap-1 rounded-xl px-2.5 text-sm text-neutral-800 whitespace-nowrap transition-colors ${isOpen ? 'bg-neutral-100' : 'hover:bg-neutral-100'}`}
                aria-label="图像参数"
                title={title}
            >
                <span className="agent-chat-fit-summary">{summary}</span>
                <ChevronDown
                    size={13}
                    className={`shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
            </button>

            {isOpen && (
                <div
                    className="absolute bottom-11 left-[-96px] z-50 w-[304px] max-h-[430px] overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-4 shadow-2xl"
                    onWheel={(e) => e.stopPropagation()}
                >
                    <div className="space-y-4">
                        {showQualitySettings && (
                            <div className="space-y-2">
                                <div className="text-sm font-medium text-neutral-700">质量</div>
                                <div className="grid grid-cols-4 gap-2 rounded-xl bg-neutral-100 p-1">
                                    {qualityOptions.map((option) => {
                                        const selected = currentQualityLabel === option;
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

                        {showResolutionSettings && (
                            <div className="space-y-2">
                                <div className="text-sm font-medium text-neutral-700">分辨率</div>
                                <div className="grid grid-cols-3 gap-2">
                                    {resolutionOptions.map((option) => {
                                        const selected = currentResolution === option.value;
                                        return (
                                            <button
                                                key={option.value}
                                                type="button"
                                                title={`${option.value} · ${option.previewSize}`}
                                                onClick={() => onResolutionChange(option.value)}
                                                className={`rounded-xl border px-0 py-2 text-sm transition-colors ${selected
                                                    ? 'border-neutral-300 bg-neutral-100 text-neutral-950 shadow-sm'
                                                    : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                                                }`}
                                            >
                                                {option.value}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}

                        {showDimensionSettings && (
                            <div className="space-y-2">
                                <div className="text-sm font-medium text-neutral-700">尺寸</div>
                                <div className="flex items-center gap-2">
                                    <div className="flex h-9 flex-1 items-center gap-2 rounded-lg bg-neutral-100 px-3 text-sm text-neutral-900">
                                        <span className="text-neutral-500">W</span>
                                        <span className="tabular-nums">{currentSize?.w ?? '--'}</span>
                                    </div>
                                    <ArrowLeftRight size={13} className="-rotate-90 text-neutral-400" />
                                    <div className="flex h-9 flex-1 items-center gap-2 rounded-lg bg-neutral-100 px-3 text-sm text-neutral-900">
                                        <span className="text-neutral-500">H</span>
                                        <span className="tabular-nums">{currentSize?.h ?? '--'}</span>
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="space-y-2">
                            <div className="text-sm font-medium text-neutral-700">Size</div>
                            <div className="grid max-h-[154px] grid-cols-3 gap-2 overflow-y-auto pr-1">
                                {aspectRatioOptions.map((option) => {
                                    const selected = currentAspectRatio === option.value;
                                    return (
                                        <button
                                            key={option.value}
                                            type="button"
                                            onClick={() => onAspectRatioChange(option.value)}
                                            className={`flex h-[72px] flex-col items-center justify-between rounded-lg border px-2 py-3 text-sm transition-colors ${selected
                                                ? 'border-neutral-300 bg-neutral-100 text-neutral-950'
                                                : 'border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50'
                                            }`}
                                        >
                                            <span className="flex h-6 items-center justify-center">
                                                {option.icon}
                                            </span>
                                            <span>{option.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {showOutputCountSettings && (
                            <div className="space-y-2">
                                <div className="text-sm font-medium text-neutral-700">Image</div>
                                <div className="grid grid-cols-4 gap-2">
                                    {countOptions.map((count) => {
                                        const selected = currentBatchCount === count;
                                        return (
                                            <button
                                                key={count}
                                                type="button"
                                                onClick={() => onBatchCountChange(count)}
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
    );
}
