export type ChatPanelThinkingConfirmDialogProps = {
    isOpen: boolean;
    neverAsk: boolean;
    onToggleNeverAsk: () => void;
    onCancel: () => void;
    onConfirm: () => void;
};

export function ChatPanelThinkingConfirmDialog({
    isOpen,
    neverAsk,
    onToggleNeverAsk,
    onCancel,
    onConfirm,
}: ChatPanelThinkingConfirmDialogProps) {
    if (!isOpen) return null;

    return (
        <div
            className="absolute bottom-[54px] left-10 right-5 z-50 rounded-xl border border-neutral-200 bg-white p-5 shadow-2xl"
            data-agent-thinking-menu-root
        >
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-neutral-950">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-neutral-900 text-xs text-white">!</span>
                新建对话？
            </div>
            <p className="mb-4 text-sm leading-6 text-neutral-700">
                切换模式会新建对话。您可以随时从历史列表中访问此对话。
            </p>
            <label className="mb-5 flex items-center gap-2 text-sm text-neutral-900">
                <span>不再询问</span>
                <button
                    type="button"
                    onClick={onToggleNeverAsk}
                    className={`relative h-4 w-8 rounded-full transition-colors ${neverAsk ? 'bg-neutral-950' : 'bg-neutral-200'}`}
                    aria-pressed={neverAsk}
                >
                    <span
                        className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-transform ${neverAsk ? 'translate-x-4' : 'translate-x-0.5'}`}
                    />
                </button>
            </label>
            <div className="flex justify-end gap-2">
                <button
                    type="button"
                    onClick={onCancel}
                    className="rounded-lg bg-neutral-100 px-5 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-200"
                >
                    取消
                </button>
                <button
                    type="button"
                    onClick={onConfirm}
                    className="rounded-lg bg-neutral-950 px-5 py-2 text-sm font-medium text-white hover:bg-neutral-800"
                >
                    新建
                </button>
            </div>
        </div>
    );
}
