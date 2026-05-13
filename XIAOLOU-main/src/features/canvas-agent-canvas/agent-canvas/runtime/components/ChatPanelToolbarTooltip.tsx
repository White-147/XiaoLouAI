import type { ReactNode } from 'react';

type ChatPanelToolbarTooltipProps = {
    children: ReactNode;
    label: string;
};

export function ChatPanelToolbarTooltip({
    children,
    label,
}: ChatPanelToolbarTooltipProps) {
    return (
        <div className="group relative">
            {children}
            <div className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-lg bg-neutral-950 px-3 py-2 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
                {label}
            </div>
        </div>
    );
}
