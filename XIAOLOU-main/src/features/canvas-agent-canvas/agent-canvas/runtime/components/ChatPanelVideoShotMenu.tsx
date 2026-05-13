import type { CSSProperties, RefObject } from 'react';
import { Video } from 'lucide-react';

type ChatPanelVideoShotMenuProps = {
    triggerRef: RefObject<HTMLButtonElement | null>;
    isOpen: boolean;
    selectedShot: string;
    options: string[];
    panelStyle: CSSProperties;
    onToggle: () => void;
    onSelect: (shot: string) => void;
};

const toolbarButtonClass = (isActive = false) =>
    `flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-transparent text-neutral-800 transition-colors ${isActive ? 'bg-neutral-100' : 'hover:bg-neutral-100'}`;

const floatingPanelClass = 'fixed z-50 overflow-y-auto rounded-2xl border border-border bg-card text-card-foreground shadow-[0_18px_60px_rgba(0,0,0,0.24)]';
const floatingHeadingClass = 'mb-3 text-sm font-semibold text-foreground';
const chipButtonClass = (selected: boolean) => `h-9 rounded-full border px-3 text-sm transition-colors ${
    selected
        ? 'border-primary/40 bg-primary/10 text-foreground shadow-sm'
        : 'border-border bg-card text-foreground hover:bg-accent hover:text-accent-foreground'
}`;

export function ChatPanelVideoShotMenu({
    triggerRef,
    isOpen,
    selectedShot,
    options,
    panelStyle,
    onToggle,
    onSelect,
}: ChatPanelVideoShotMenuProps) {
    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                onClick={onToggle}
                className={toolbarButtonClass(isOpen || Boolean(selectedShot))}
                aria-label="基础镜头"
                title="基础镜头"
            >
                <Video size={18} strokeWidth={2.1} />
            </button>

            {isOpen && (
                <div
                    className={`${floatingPanelClass} p-4`}
                    style={panelStyle}
                    onWheel={(e) => e.stopPropagation()}
                >
                    <div className={floatingHeadingClass}>基础镜头</div>
                    <div className="flex flex-wrap gap-2">
                        {options.map((option) => (
                            <button
                                key={option}
                                type="button"
                                onClick={() => onSelect(option)}
                                className={chipButtonClass(selectedShot === option)}
                            >
                                {option}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
