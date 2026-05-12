import { MousePointer2, Paperclip, Plus, Users } from 'lucide-react';

type ChatPanelImageAttachmentMenuProps = {
    isOpen: boolean;
    onToggle: () => void;
    onLocalUpload: () => void;
    onAssetLibrary: () => void;
    onPickFromCanvas: () => void;
};

export function ChatPanelImageAttachmentMenu({
    isOpen,
    onToggle,
    onLocalUpload,
    onAssetLibrary,
    onPickFromCanvas,
}: ChatPanelImageAttachmentMenuProps) {
    return (
        <div className="relative w-fit" data-agent-active-menu-root>
            <button
                type="button"
                onClick={onToggle}
                className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl text-neutral-300 transition-colors hover:text-neutral-500 ${isOpen ? 'bg-neutral-100' : 'bg-neutral-100/80 hover:bg-neutral-100'}`}
                aria-label="添加图片参考"
            >
                <Plus size={20} strokeWidth={1.7} />
            </button>

            {isOpen && (
                <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-[174px] rounded-xl border border-neutral-100 bg-white p-2 shadow-2xl" data-agent-active-menu-root>
                    <button
                        type="button"
                        onClick={onLocalUpload}
                        className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm text-neutral-900 hover:bg-neutral-50"
                    >
                        <Paperclip size={16} />
                        从本地上传图片
                    </button>
                    <button
                        type="button"
                        onClick={onAssetLibrary}
                        className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm text-neutral-900 hover:bg-neutral-50"
                    >
                        <Users size={16} />
                        从素材库选择
                    </button>
                    <button
                        type="button"
                        onClick={onPickFromCanvas}
                        className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm text-neutral-900 hover:bg-neutral-50"
                    >
                        <MousePointer2 size={16} />
                        从画布选择
                    </button>
                </div>
            )}
        </div>
    );
}
