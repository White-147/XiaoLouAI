import { AudioLines, Loader2, Square, Zap } from 'lucide-react';

import type { ComposerActionState } from './useChatPanelComposerAction';

type ChatPanelComposerActionButtonProps = {
    action: ComposerActionState;
    onClick: () => void;
};

export function ChatPanelComposerActionButton({
    action,
    onClick,
}: ChatPanelComposerActionButtonProps) {
    const {
        mode,
        disabled,
        ariaLabel,
        isAgentGenerating,
        isBusy,
        imageActionCreditsLabel,
    } = action;

    return (
        <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={mode === 'image'
                ? `flex h-11 min-w-[64px] items-center justify-center gap-1 rounded-full px-4 text-sm font-semibold transition-colors ${disabled
                    ? 'cursor-not-allowed bg-neutral-100 text-neutral-400'
                    : 'bg-neutral-950 text-white hover:bg-neutral-800'
                }`
                : mode === 'agent'
                    ? `flex h-12 w-12 items-center justify-center rounded-full text-white shadow-sm transition-colors ${isAgentGenerating
                        ? 'bg-red-600 hover:bg-red-700'
                        : disabled
                            ? 'cursor-not-allowed bg-neutral-300'
                            : 'bg-neutral-950 hover:bg-neutral-800'
                    }`
                    : `flex h-10 min-w-[56px] items-center justify-center gap-1 rounded-full px-3 text-sm font-semibold text-white transition-colors ${disabled
                        ? 'cursor-not-allowed bg-neutral-300'
                        : 'bg-neutral-950 hover:bg-neutral-800'
                    }`
            }
            aria-label={ariaLabel}
        >
            {isAgentGenerating ? (
                <Square size={15} fill="currentColor" className="animate-pulse" />
            ) : isBusy ? (
                <Loader2 size={16} className="animate-spin" />
            ) : mode === 'image' ? (
                <>
                    <Zap size={15} fill="currentColor" />
                    <span className="tabular-nums">{imageActionCreditsLabel}</span>
                </>
            ) : mode === 'video' ? (
                <>
                    <Zap size={15} fill="currentColor" />
                    <span className="tabular-nums">0</span>
                </>
            ) : (
                <AudioLines size={mode === 'agent' ? 20 : 17} />
            )}
        </button>
    );
}
