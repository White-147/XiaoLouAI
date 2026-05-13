import type { ComponentType } from 'react';
import { Check, ChevronDown, Sparkles, Video } from 'lucide-react';

type ComposerMode = 'agent' | 'image' | 'video';

type ComposerModeOption = {
    value: ComposerMode;
    label: string;
    icon: ComponentType<{ size?: number; className?: string }>;
};

type ChatPanelModeMenuProps = {
    modes: ComposerModeOption[];
    activeMode: ComposerMode;
    isOpen: boolean;
    onToggle: () => void;
    onSelect: (mode: ComposerMode) => void;
};

export function ChatPanelModeMenu({
    modes,
    activeMode,
    isOpen,
    onToggle,
    onSelect,
}: ChatPanelModeMenuProps) {
    const activeModeOption = modes.find((item) => item.value === activeMode) || modes[0];
    const ActiveModeIcon = activeModeOption.icon;
    const isVideoMode = activeMode === 'video';

    return (
        <div className="relative" data-agent-active-menu-root>
            <button
                type="button"
                onClick={onToggle}
                className={isVideoMode
                    ? `flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-transparent px-0.5 text-sm font-semibold whitespace-nowrap text-neutral-800 transition-colors ${isOpen ? 'bg-neutral-100 text-neutral-950' : 'hover:bg-neutral-100'}`
                    : `flex h-8 shrink-0 items-center gap-1 rounded-xl px-2.5 text-sm whitespace-nowrap transition-colors ${isOpen ? 'bg-neutral-100 text-neutral-950' : 'text-neutral-800 hover:bg-neutral-100'}`
                }
                aria-label="选择模式"
            >
                {isVideoMode ? (
                    <span className="relative flex h-[19px] w-[20px] shrink-0 items-center justify-center">
                        <Video size={18} strokeWidth={2.1} />
                        <Sparkles size={8} strokeWidth={2.2} className="absolute -right-0.5 -top-0.5" />
                    </span>
                ) : (
                    <ActiveModeIcon size={15} className="shrink-0" />
                )}
                <span className="agent-chat-fit-label">{activeModeOption.label}</span>
                <ChevronDown
                    size={isVideoMode ? 14 : 13}
                    className={`shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
            </button>

            {isOpen && (
                <div className="absolute bottom-11 left-0 z-50 w-48 rounded-xl border border-neutral-100 bg-white p-2 shadow-2xl">
                    {modes.map((mode) => {
                        const Icon = mode.icon;
                        const selected = activeMode === mode.value;
                        return (
                            <button
                                key={mode.value}
                                type="button"
                                onClick={() => onSelect(mode.value)}
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
    );
}
