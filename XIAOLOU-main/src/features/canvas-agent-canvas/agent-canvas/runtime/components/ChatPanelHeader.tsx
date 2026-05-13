import type { ComponentProps } from 'react';
import { PanelRightClose } from 'lucide-react';

import { ChatPanelConversationMenu } from './ChatPanelConversationMenu';
import { ChatPanelHeaderTooltip } from './ChatPanelHeaderTooltip';
import { ChatPanelShareMenu } from './ChatPanelShareMenu';

type ChatPanelHeaderProps = {
    title: string;
    conversationMenu: ComponentProps<typeof ChatPanelConversationMenu>;
    shareMenu: ComponentProps<typeof ChatPanelShareMenu>;
    onClose: () => void;
};

export function ChatPanelHeader({
    title,
    conversationMenu,
    shareMenu,
    onClose,
}: ChatPanelHeaderProps) {
    return (
        <header className="relative flex h-12 shrink-0 items-center justify-between border-b border-neutral-100 px-4">
            <h2 className="min-w-0 truncate text-sm font-semibold text-neutral-950">
                {title}
            </h2>

            <div className="flex items-center gap-1">
                <ChatPanelConversationMenu {...conversationMenu} />
                <ChatPanelShareMenu {...shareMenu} />

                <ChatPanelHeaderTooltip label="收起">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-700 transition-colors hover:bg-neutral-100"
                        aria-label="收起"
                    >
                        <PanelRightClose size={16} />
                    </button>
                </ChatPanelHeaderTooltip>
            </div>
        </header>
    );
}
