import React, { memo } from 'react';

interface ToggleSwitchProps {
    enabled: boolean;
    onToggle: () => void;
}

function ToggleSwitch({ enabled, onToggle }: ToggleSwitchProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={onToggle}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 flex-shrink-0 cursor-pointer ${
                enabled ? 'bg-neutral-800' : 'bg-neutral-300'
            }`}
        >
            <span
                className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                    enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
            />
        </button>
    );
}

interface AudioToggleProps {
    audioEnabled: boolean;
    onAudioToggle: () => void;
    isDark: boolean;
    networkSearchEnabled?: boolean;
    onNetworkSearchToggle?: () => void;
}

const AudioToggleComponent: React.FC<AudioToggleProps> = ({
    audioEnabled,
    onAudioToggle,
    isDark,
    networkSearchEnabled = false,
    onNetworkSearchToggle,
}) => {
    return (
        <div className="space-y-0">
            <div className="flex items-center justify-between py-2">
                <span className={`text-sm font-medium ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                    音频
                </span>
                <ToggleSwitch enabled={audioEnabled} onToggle={onAudioToggle} />
            </div>
            <div className="flex items-center justify-between py-2">
                <span className={`text-sm font-medium ${isDark ? 'text-neutral-300' : 'text-neutral-700'}`}>
                    网络搜索
                </span>
                <ToggleSwitch
                    enabled={networkSearchEnabled}
                    onToggle={onNetworkSearchToggle || (() => {})}
                />
            </div>
        </div>
    );
};

export const AudioToggle = memo(AudioToggleComponent);
