import type { RefObject } from 'react';

import { ChatPanelAgentActivityPanel } from './ChatPanelAgentActivityPanel';
import { ChatMessage } from './ChatMessage';
import type {
    AgentActivityEvent,
    ChatMessage as ChatMessageType,
} from '../hooks/useChatAgent';

type ChatPanelMessageListProps = {
    messages: ChatMessageType[];
    activityEvents: AgentActivityEvent[];
    isLoading: boolean;
    hasMessages: boolean;
    error: string | null;
    messagesEndRef: RefObject<HTMLDivElement>;
};

export function ChatPanelMessageList({
    messages,
    activityEvents,
    isLoading,
    hasMessages,
    error,
    messagesEndRef,
}: ChatPanelMessageListProps) {
    return (
        <main className="flex-1 overflow-y-auto px-4 pb-4 pt-3">
            {!hasMessages && activityEvents.length === 0 && !isLoading ? (
                <div className="flex min-h-[48vh] flex-col items-center justify-center text-center">
                    <h1 className="text-3xl font-bold tracking-normal text-neutral-950">你好</h1>
                    <p className="mt-4 max-w-[260px] text-sm leading-6 text-neutral-500">
                        输入你的设计需求，我会默认用中文回复，并帮助你整理画布、生成图片或视频。
                    </p>
                </div>
            ) : (
                <div className="space-y-5">
                    {messages.map((msg: ChatMessageType) => (
                        <ChatMessage
                            key={msg.id}
                            role={msg.role}
                            content={msg.content}
                            media={msg.media}
                            timestamp={msg.timestamp}
                        />
                    ))}
                    {(isLoading || activityEvents.length > 0) && (
                        <ChatPanelAgentActivityPanel events={activityEvents} pending={isLoading} />
                    )}
                </div>
            )}

            {error && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-600">
                    {error}
                </div>
            )}

            <div ref={messagesEndRef} />
        </main>
    );
}
