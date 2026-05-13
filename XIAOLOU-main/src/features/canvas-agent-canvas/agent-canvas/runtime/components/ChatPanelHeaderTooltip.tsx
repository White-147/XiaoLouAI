import type { ReactNode } from 'react';

type ChatPanelHeaderTooltipProps = {
    children: ReactNode;
    label: string;
};

export function ChatPanelHeaderTooltip({
    children,
    label,
}: ChatPanelHeaderTooltipProps) {
    return (
        <div className="group relative">
            {children}
            <div className="pointer-events-none absolute right-0 top-[calc(100%+8px)] z-50 whitespace-nowrap rounded-lg bg-neutral-950 px-3 py-2 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                {label}
            </div>
        </div>
    );
}
