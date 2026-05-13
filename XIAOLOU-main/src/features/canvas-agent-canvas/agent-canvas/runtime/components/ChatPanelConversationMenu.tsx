import type { KeyboardEvent, MouseEvent } from 'react';
import {
    ChevronDown,
    Loader2,
    MessageSquare,
    MessageSquarePlus,
    Search,
    Trash2,
} from 'lucide-react';

import type { ChatSession } from '../hooks/useChatAgent';
import { ChatPanelHeaderTooltip } from './ChatPanelHeaderTooltip';

type ChatPanelConversationMenuProps = {
    isOpen: boolean;
    search: string;
    sessions: ChatSession[];
    isLoadingSessions: boolean;
    fallbackTopicTitle: string;
    onNewChat: () => void;
    onToggleOpen: () => void;
    onSearchChange: (value: string) => void;
    onLoadSession: (sessionId: string) => void | Promise<void>;
    onDeleteSession: (event: MouseEvent, sessionId: string) => void | Promise<void>;
};

function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    }
    if (diffDays === 1) return '昨天';
    if (diffDays < 7) return `${diffDays} 天前`;
    return date.toLocaleDateString('zh-CN');
}

export function ChatPanelConversationMenu({
    isOpen,
    search,
    sessions,
    isLoadingSessions,
    fallbackTopicTitle,
    onNewChat,
    onToggleOpen,
    onSearchChange,
    onLoadSession,
    onDeleteSession,
}: ChatPanelConversationMenuProps) {
    const handleSessionKeyDown = (event: KeyboardEvent, sessionId: string) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void onLoadSession(sessionId);
        }
    };

    return (
        <div className="relative flex items-center" data-agent-conversation-menu-root>
            <ChatPanelHeaderTooltip label="新建对话">
                <button
                    type="button"
                    onClick={onNewChat}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-700 transition-colors hover:bg-neutral-100"
                    aria-label="新建对话"
                >
                    <MessageSquarePlus size={15} />
                </button>
            </ChatPanelHeaderTooltip>
            <button
                type="button"
                onClick={onToggleOpen}
                className={`flex h-8 w-5 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 ${isOpen ? 'bg-neutral-100' : ''}`}
                aria-label="展开历史对话"
            >
                <ChevronDown
                    size={14}
                    className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
            </button>

            {isOpen && (
                <div className="absolute right-0 top-10 z-50 w-72 rounded-2xl border border-neutral-100 bg-white p-3 shadow-2xl">
                    <div className="px-1 pb-3 text-sm font-semibold text-neutral-950">历史对话</div>
                    <label className="mb-2 flex h-10 items-center gap-2 rounded-lg border border-neutral-200 px-3 text-neutral-400">
                        <Search size={15} />
                        <input
                            value={search}
                            onChange={(event) => onSearchChange(event.target.value)}
                            placeholder="请输入搜索关键词"
                            className="min-w-0 flex-1 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
                        />
                    </label>
                    <div className="max-h-64 space-y-1 overflow-y-auto">
                        {isLoadingSessions ? (
                            <div className="flex h-16 items-center justify-center">
                                <Loader2 className="h-5 w-5 animate-spin text-neutral-500" />
                            </div>
                        ) : sessions.length > 0 ? (
                            sessions.map((session) => (
                                <div
                                    key={session.id}
                                    role="button"
                                    tabIndex={0}
                                    onClick={() => void onLoadSession(session.id)}
                                    onKeyDown={(event) => handleSessionKeyDown(event, session.id)}
                                    className="group flex w-full items-center gap-2 rounded-lg bg-neutral-50 px-3 py-2 text-left transition-colors hover:bg-neutral-100"
                                >
                                    <MessageSquare size={14} className="shrink-0 text-neutral-500" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm text-neutral-900">
                                            {session.topic}
                                        </span>
                                        <span className="block text-xs text-neutral-400">
                                            {session.messageCount} 条消息 · {formatDate(session.updatedAt || session.createdAt)}
                                        </span>
                                    </span>
                                    <button
                                        type="button"
                                        onClick={(event) => void onDeleteSession(event, session.id)}
                                        className="rounded-md p-1 text-neutral-400 opacity-0 transition-all hover:bg-red-50 hover:text-red-500 group-hover:opacity-100"
                                        aria-label="删除对话"
                                    >
                                        <Trash2 size={13} />
                                    </button>
                                </div>
                            ))
                        ) : (
                            <div className="rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
                                {fallbackTopicTitle}
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
