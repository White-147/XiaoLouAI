/**
 * ChatMessage.tsx
 *
 * Message renderer for the Agent Canvas chat panel.
 */

import React, { useState } from 'react';
import { Check, Copy, ThumbsDown, ThumbsUp } from 'lucide-react';
import { writeClipboardText } from '../utils/secureContextPolyfills';

interface ChatMessageProps {
    role: 'user' | 'assistant';
    content: string;
    media?: {
        type: 'image' | 'video' | 'audio';
        url: string;
    }[];
    timestamp?: Date;
}

interface CodeBlockProps {
    code: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ code }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        const ok = await writeClipboardText(code);
        if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="group relative my-3">
            <pre className="overflow-x-auto rounded-xl border border-neutral-800 bg-neutral-950 p-3 text-sm">
                <code className="whitespace-pre-wrap break-words text-cyan-200">{code}</code>
            </pre>
            <button
                type="button"
                onClick={handleCopy}
                className="absolute right-2 top-2 rounded-md bg-neutral-800 p-1.5 text-neutral-300 opacity-0 transition-all hover:bg-neutral-700 group-hover:opacity-100"
                title={copied ? '已复制' : '复制到剪贴板'}
            >
                {copied ? (
                    <Check size={14} className="text-green-400" />
                ) : (
                    <Copy size={14} />
                )}
            </button>
        </div>
    );
};

function parseContent(content: string): Array<{ type: 'text' | 'code'; content: string }> {
    const segments: Array<{ type: 'text' | 'code'; content: string }> = [];
    const codeBlockRegex = /```(?:\w+)?\n?([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
        if (match.index > lastIndex) {
            const text = content.slice(lastIndex, match.index).trim();
            if (text) segments.push({ type: 'text', content: text });
        }

        segments.push({ type: 'code', content: match[1].trim() });
        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
        const text = content.slice(lastIndex).trim();
        if (text) segments.push({ type: 'text', content: text });
    }

    if (segments.length === 0) {
        segments.push({ type: 'text', content });
    }

    return segments;
}

function MessageMedia({
    media,
    compact = false,
}: {
    media?: ChatMessageProps['media'];
    compact?: boolean;
}) {
    if (!media?.length) return null;

    return (
        <div className={compact ? 'mb-2 flex flex-wrap gap-2' : 'mb-4 space-y-3'}>
            {media.map((item, index) => {
                if (item.type === 'image') {
                    return (
                        <img
                            key={`${item.url}-${index}`}
                            src={item.url}
                            alt={`附件 ${index + 1}`}
                            className={
                                compact
                                    ? 'h-16 w-16 rounded-lg object-cover'
                                    : 'max-h-[260px] w-full rounded-lg object-contain'
                            }
                        />
                    );
                }

                if (item.type === 'audio') {
                    return (
                        <audio
                            key={`${item.url}-${index}`}
                            src={item.url}
                            className={compact ? 'w-44' : 'w-full'}
                            controls
                        />
                    );
                }

                return (
                    <video
                        key={`${item.url}-${index}`}
                        src={item.url}
                        className={
                            compact
                                ? 'h-16 w-16 rounded-lg object-cover'
                                : 'max-h-[280px] w-full rounded-lg bg-neutral-100 object-contain'
                        }
                        controls
                    />
                );
            })}
        </div>
    );
}

export const ChatMessage: React.FC<ChatMessageProps> = ({
    role,
    content,
    media,
    timestamp,
}) => {
    const isUser = role === 'user';
    const cleanedContent = content.replace(/\[IMAGE \d+ ATTACHED\]/g, '').trim();
    const segments = parseContent(cleanedContent);

    if (isUser) {
        return (
            <div className="flex justify-end">
                <div className="max-w-[86%] rounded-2xl bg-neutral-50 px-4 py-3 text-sm leading-6 text-neutral-950 shadow-sm">
                    <MessageMedia media={media} compact />
                    {segments.map((segment, index) => (
                        segment.type === 'code' ? (
                            <CodeBlock key={index} code={segment.content} />
                        ) : (
                            <div key={index} className="whitespace-pre-wrap break-words">
                                {segment.content}
                            </div>
                        )
                    ))}
                    {timestamp && (
                        <div className="mt-2 text-[11px] text-neutral-400">
                            {timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <article className="w-full text-neutral-950">
            <MessageMedia media={media} />

            {segments.map((segment, index) => (
                segment.type === 'code' ? (
                    <CodeBlock key={index} code={segment.content} />
                ) : (
                    <div
                        key={index}
                        className="whitespace-pre-wrap break-words text-[15px] font-medium leading-7 text-neutral-950"
                    >
                        {segment.content}
                    </div>
                )
            ))}

            <div className="mt-3 flex items-center gap-3 text-neutral-400">
                <button
                    type="button"
                    className="rounded-md p-1 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                    aria-label="喜欢"
                >
                    <ThumbsUp size={14} />
                </button>
                <button
                    type="button"
                    className="rounded-md p-1 transition-colors hover:bg-neutral-100 hover:text-neutral-700"
                    aria-label="不喜欢"
                >
                    <ThumbsDown size={14} />
                </button>
                {timestamp && (
                    <span className="ml-auto text-[11px]">
                        {timestamp.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                )}
            </div>
        </article>
    );
};

export default ChatMessage;
