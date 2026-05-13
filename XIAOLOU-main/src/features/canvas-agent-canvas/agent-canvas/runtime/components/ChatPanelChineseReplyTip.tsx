import { X } from 'lucide-react';

export type ChatPanelChineseReplyTipProps = {
    isOpen: boolean;
    isDark: boolean;
    onClose: () => void;
};

export function ChatPanelChineseReplyTip({
    isOpen,
    isDark,
    onClose,
}: ChatPanelChineseReplyTipProps) {
    if (!isOpen) return null;

    return (
        <div
            className={`mx-1 mb-1 flex items-center justify-between gap-2 rounded-2xl border px-3 py-2 text-xs ${
                isDark
                    ? 'border-emerald-400/20 bg-emerald-950/35 text-emerald-100'
                    : 'border-lime-200 bg-lime-50 text-[#2f3d13]'
            }`}
        >
            <span className="inline-flex min-w-0 items-center gap-2">
                <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
                        isDark ? 'bg-emerald-400/20 text-emerald-50' : 'bg-lime-300 text-[#15200a]'
                    }`}
                >
                    +
                </span>
                <span className="truncate">已默认使用中文回复，可切换 Agent / 图像 / 视频模式</span>
            </span>
            <button
                type="button"
                onClick={onClose}
                className={`rounded-md p-0.5 transition-colors ${
                    isDark
                        ? 'text-emerald-100/70 hover:bg-emerald-400/10 hover:text-emerald-50'
                        : 'text-[#5f6f1d] hover:bg-lime-100 hover:text-[#15200a]'
                }`}
                aria-label="关闭提示"
            >
                <X size={14} />
            </button>
        </div>
    );
}
