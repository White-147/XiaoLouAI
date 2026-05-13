import { AlertCircle, ImageIcon, Link2, Send, Share2 } from 'lucide-react';

import { ChatPanelHeaderTooltip } from './ChatPanelHeaderTooltip';

type ChatPanelShareMenuProps = {
    isOpen: boolean;
    isDark: boolean;
    onToggleOpen: () => void;
    onCopyLink: () => void | Promise<void>;
    onShareImage: () => void | Promise<void>;
    onPublish: () => void | Promise<void>;
};

function getShareActionButtonClass(isDark: boolean) {
    return `flex min-h-12 w-full min-w-0 flex-row items-center justify-center gap-1.5 rounded-xl border px-1.5 py-2.5 text-xs font-medium leading-tight ${
        isDark
            ? 'border-zinc-600 bg-zinc-900/80 text-zinc-100 hover:bg-zinc-800'
            : 'border-neutral-200 bg-white text-neutral-950 hover:bg-neutral-50'
    }`;
}

export function ChatPanelShareMenu({
    isOpen,
    isDark,
    onToggleOpen,
    onCopyLink,
    onShareImage,
    onPublish,
}: ChatPanelShareMenuProps) {
    const actionButtonClass = getShareActionButtonClass(isDark);

    return (
        <div className="relative" data-agent-active-menu-root>
            <ChatPanelHeaderTooltip label="分享对话">
                <button
                    type="button"
                    onClick={onToggleOpen}
                    className={`flex h-8 w-8 items-center justify-center rounded-lg text-neutral-700 transition-colors ${
                        isOpen ? 'bg-neutral-100' : 'hover:bg-neutral-100'
                    }`}
                    aria-label="分享对话"
                    aria-expanded={isOpen}
                >
                    <Share2 size={15} />
                </button>
            </ChatPanelHeaderTooltip>
            {isOpen && (
                <div
                    className={`absolute right-0 top-full z-50 mt-1.5 w-[min(100vw-1.5rem,24rem)] rounded-2xl px-3.5 py-2.5 text-left shadow-[0_8px_32px_rgba(0,0,0,0.12)] ${
                        isDark
                            ? 'border border-zinc-600/80 bg-zinc-900 text-zinc-100'
                            : 'border border-neutral-200/90 bg-white text-neutral-950'
                    }`}
                    role="dialog"
                    aria-label="分享当前对话"
                >
                    <h3
                        className={`text-base font-bold leading-tight tracking-tight ${
                            isDark ? 'text-zinc-50' : 'text-neutral-950'
                        }`}
                    >
                        分享当前对话
                    </h3>
                    <div
                        className={`mt-1.5 flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 ${
                            isDark
                                ? 'bg-zinc-800/95 ring-1 ring-inset ring-white/10'
                                : 'bg-[#f5f5f5]'
                        }`}
                    >
                        <AlertCircle
                            className={`h-5 w-5 shrink-0 ${isDark ? 'text-zinc-400' : 'text-neutral-500'}`}
                            strokeWidth={2}
                            aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                            <p
                                className={`text-sm font-bold leading-tight ${
                                    isDark ? 'text-zinc-50' : 'text-neutral-900'
                                }`}
                            >
                                公开浏览权限
                            </p>
                            <div
                                className={`mt-0.5 text-xs font-normal leading-[1.35] ${
                                    isDark ? 'text-zinc-400' : 'text-neutral-600'
                                }`}
                            >
                                <p>有链接的人可以浏览对话内容，不可编辑</p>
                                <p className="mt-0.5">分享后的对话过程，在分享链接内同步</p>
                            </div>
                        </div>
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 items-stretch gap-1.5">
                        <button
                            type="button"
                            onClick={() => void onCopyLink()}
                            className={actionButtonClass}
                        >
                            <Link2 className="h-5 w-5 shrink-0" strokeWidth={1.8} />
                            <span className="min-w-0 text-balance text-center text-xs font-medium leading-tight">
                                复制对话链接
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => void onShareImage()}
                            className={actionButtonClass}
                        >
                            <ImageIcon className="h-5 w-5 shrink-0" strokeWidth={1.8} />
                            <span className="min-w-0 text-balance text-center text-xs font-medium leading-tight">
                                分享对话图片
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => void onPublish()}
                            className="flex min-h-12 w-full min-w-0 flex-row items-center justify-center gap-1.5 rounded-xl border border-[#222] bg-[#222] px-1.5 py-2.5 text-xs font-medium leading-tight text-white"
                        >
                            <Send className="h-5 w-5 shrink-0 text-white" strokeWidth={1.8} />
                            <span className="min-w-0 text-balance text-center text-xs font-medium leading-tight">
                                发布对话
                            </span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
