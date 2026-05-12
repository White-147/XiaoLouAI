import { Box, Check, Globe2, Paperclip, Users } from 'lucide-react';

type ChatPanelAgentMoreMenuProps = {
    canvasFilesEnabled: boolean;
    webSearchEnabled: boolean;
    onUploadFile: () => void;
    onAssetLibrary: () => void;
    onToggleCanvasFiles: () => void;
    onToggleWebSearch: () => void;
};

function MenuSwitchIndicator({ checked }: { checked: boolean }) {
    return (
        <span
            className={`inline-flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition-colors ${checked ? 'justify-end bg-neutral-900' : 'justify-start bg-neutral-200'}`}
            aria-hidden="true"
        >
            <span className="h-4 w-4 rounded-full bg-white shadow" />
        </span>
    );
}

export function ChatPanelAgentMoreMenu({
    canvasFilesEnabled,
    webSearchEnabled,
    onUploadFile,
    onAssetLibrary,
    onToggleCanvasFiles,
    onToggleWebSearch,
}: ChatPanelAgentMoreMenuProps) {
    return (
        <div className="absolute bottom-11 left-0 z-50 w-60 rounded-xl border border-neutral-100 bg-white p-2 shadow-2xl">
            <button
                type="button"
                onClick={onUploadFile}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-neutral-900 hover:bg-neutral-50"
            >
                <Paperclip size={16} />
                上传文件
            </button>
            <button
                type="button"
                onClick={onAssetLibrary}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-neutral-900 hover:bg-neutral-50"
            >
                <Users size={16} />
                从素材库选择
            </button>
            <button
                type="button"
                onClick={onToggleCanvasFiles}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm text-neutral-900 transition-colors ${canvasFilesEnabled ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
                aria-pressed={canvasFilesEnabled}
            >
                <span className="flex items-center gap-3">
                    <Box size={16} />
                    读取画布文件
                </span>
                {canvasFilesEnabled && <Check size={15} />}
            </button>
            <button
                type="button"
                onClick={onToggleWebSearch}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-sm text-neutral-900 transition-colors ${webSearchEnabled ? 'bg-neutral-100' : 'hover:bg-neutral-50'}`}
                aria-pressed={webSearchEnabled}
            >
                <span className="flex items-center gap-3">
                    <Globe2 size={16} />
                    联网搜索
                </span>
                <MenuSwitchIndicator checked={webSearchEnabled} />
            </button>
        </div>
    );
}
