import type { RefObject } from 'react';

import {
    ChatPanelChineseReplyTip,
    type ChatPanelChineseReplyTipProps,
} from './ChatPanelChineseReplyTip';
import {
    ChatPanelComposerBody,
    type ChatPanelComposerBodyProps,
} from './ChatPanelComposerBody';
import {
    ChatPanelComposerToolbar,
    type ChatPanelComposerToolbarProps,
} from './ChatPanelComposerToolbar';
import {
    ChatPanelThinkingConfirmDialog,
    type ChatPanelThinkingConfirmDialogProps,
} from './ChatPanelThinkingConfirmDialog';

type ChatPanelComposerFileInputProps = {
    inputRef: RefObject<HTMLInputElement | null>;
    accept: string;
    onFilesChange: (files: FileList | null) => void;
};

type ChatPanelComposerProps = {
    chineseReplyTip: ChatPanelChineseReplyTipProps;
    thinkingConfirmDialog: ChatPanelThinkingConfirmDialogProps;
    body: ChatPanelComposerBodyProps;
    toolbar: ChatPanelComposerToolbarProps;
    fileInput: ChatPanelComposerFileInputProps;
};

export function ChatPanelComposer({
    chineseReplyTip,
    thinkingConfirmDialog,
    body,
    toolbar,
    fileInput,
}: ChatPanelComposerProps) {
    return (
        <footer className="shrink-0 bg-white px-2 pb-2">
            <ChatPanelChineseReplyTip {...chineseReplyTip} />

            <div className="relative rounded-[22px] border border-neutral-200 bg-white px-3 pb-3 pt-3 shadow-[0_10px_30px_rgba(15,23,42,0.08)]">
                <ChatPanelThinkingConfirmDialog {...thinkingConfirmDialog} />
                <ChatPanelComposerBody {...body} />
                <ChatPanelComposerToolbar {...toolbar} />

                <input
                    ref={fileInput.inputRef}
                    type="file"
                    accept={fileInput.accept}
                    multiple
                    className="hidden"
                    onChange={(event) => void fileInput.onFilesChange(event.target.files)}
                />
            </div>
        </footer>
    );
}
