import type { FormEvent, KeyboardEvent, RefObject } from 'react';
import { AudioLines, BookOpen, ChevronDown, ImageIcon, Video, X } from 'lucide-react';

import { ChatPanelImageAttachmentMenu } from './ChatPanelImageAttachmentMenu';
import { ChatPanelVideoAttachmentSlots } from './ChatPanelVideoAttachmentSlots';
import type {
    AttachedMedia,
    VideoAttachSlot,
    VideoSlotDefinition,
} from './chatPanelMediaAttachments';
import type { AgentCanvasSkill } from '../config/agentCanvasSkills';

type ComposerMode = 'agent' | 'image' | 'video';

export type ChatPanelComposerBodyProps = {
    composerMode: ComposerMode;
    activeMenu: string | null;
    message: string;
    selectedSkill: AgentCanvasSkill | null;
    attachedMedia: AttachedMedia[];
    isLoading: boolean;
    textareaRef: RefObject<HTMLTextAreaElement | null>;
    videoSlotDefinitions: VideoSlotDefinition[];
    activeVideoAttachSlotId: string | null;
    selectedVideoShot: string;
    onMessageChange: (message: string) => void;
    onSend: () => void;
    onRemoveAttachment: (nodeId: string) => void;
    onRemoveSkill: () => void;
    onVideoAttachSlotToggle: (slotId: string, slot: VideoAttachSlot, disabled?: boolean) => void;
    onVideoLocalUpload: (slot: VideoAttachSlot) => void;
    onVideoAssetLibrary: (slot: VideoAttachSlot) => void;
    onPickFromCanvas: (slot?: VideoAttachSlot) => void;
    onVideoShotToggle: () => void;
    onImageAttachToggle: () => void;
    onImageLocalUpload: () => void;
    onImageAssetLibrary: () => void;
};

function resizeTextarea(event: FormEvent<HTMLTextAreaElement>, maxHeight: number) {
    const target = event.currentTarget;
    target.style.height = 'auto';
    const newHeight = Math.min(target.scrollHeight, maxHeight);
    target.style.height = `${newHeight}px`;
    target.style.overflowY = target.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>, onSend: () => void) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        onSend();
    }
}

export function ChatPanelComposerBody({
    composerMode,
    activeMenu,
    message,
    selectedSkill,
    attachedMedia,
    isLoading,
    textareaRef,
    videoSlotDefinitions,
    activeVideoAttachSlotId,
    selectedVideoShot,
    onMessageChange,
    onSend,
    onRemoveAttachment,
    onRemoveSkill,
    onVideoAttachSlotToggle,
    onVideoLocalUpload,
    onVideoAssetLibrary,
    onPickFromCanvas,
    onVideoShotToggle,
    onImageAttachToggle,
    onImageLocalUpload,
    onImageAssetLibrary,
}: ChatPanelComposerBodyProps) {
    return (
        <>
            {attachedMedia.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-2">
                    {attachedMedia.map((media) => {
                        const Icon = media.type === 'video'
                            ? Video
                            : media.type === 'audio'
                                ? AudioLines
                                : ImageIcon;
                        return (
                            <div
                                key={media.nodeId}
                                className="flex max-w-[150px] items-center gap-1 rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-1 text-xs text-neutral-700"
                            >
                                <Icon size={13} className="shrink-0" />
                                <span className="min-w-0 truncate">{media.nodeId}</span>
                                <button
                                    type="button"
                                    onClick={() => onRemoveAttachment(media.nodeId)}
                                    className="rounded p-0.5 text-neutral-400 hover:bg-neutral-200 hover:text-neutral-900"
                                    aria-label="移除附件"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}

            {composerMode === 'agent' ? (
                <>
                    {selectedSkill && (
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                            <div className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-violet-100 bg-violet-50/80 px-2.5 py-1 text-sm font-medium text-neutral-900">
                                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] bg-white text-violet-500 shadow-sm">
                                    <BookOpen size={10} strokeWidth={2.2} />
                                </span>
                                <span className="truncate">{selectedSkill.title}</span>
                                <button
                                    type="button"
                                    onClick={onRemoveSkill}
                                    className="-mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-neutral-400 transition-colors hover:bg-white hover:text-neutral-700"
                                    aria-label="移除 Skill"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        </div>
                    )}
                    <textarea
                        ref={textareaRef}
                        value={message}
                        onChange={(event) => onMessageChange(event.target.value)}
                        placeholder="请输入你的设计需求"
                        className="max-h-[128px] min-h-[32px] w-full resize-none bg-transparent text-sm leading-6 text-neutral-950 outline-none placeholder:text-neutral-400"
                        rows={1}
                        disabled={isLoading}
                        onInput={(event) => resizeTextarea(event, 128)}
                        onKeyDown={(event) => sendOnEnter(event, onSend)}
                    />
                </>
            ) : (
                <div className="mb-1 flex min-h-[128px] flex-col gap-3">
                    {composerMode === 'video' ? (
                        <div className="flex flex-col items-start gap-2">
                            <ChatPanelVideoAttachmentSlots
                                slots={videoSlotDefinitions}
                                activeSlotId={activeVideoAttachSlotId}
                                menuOpen={activeMenu === 'videoAttach'}
                                onToggleSlot={onVideoAttachSlotToggle}
                                onLocalUpload={onVideoLocalUpload}
                                onAssetLibrary={onVideoAssetLibrary}
                                onPickFromCanvas={onPickFromCanvas}
                            />
                            {selectedVideoShot && (
                                <button
                                    type="button"
                                    onClick={onVideoShotToggle}
                                    className="inline-flex max-w-[260px] items-center gap-1 rounded-md border border-neutral-200 bg-white px-1.5 py-0.5 text-sm text-neutral-950 shadow-sm hover:bg-neutral-50"
                                    title="基础镜头"
                                >
                                    <span className="truncate">{selectedVideoShot}</span>
                                    <ChevronDown size={12} className={`shrink-0 transition-transform ${activeMenu === 'videoShot' ? 'rotate-180' : ''}`} />
                                </button>
                            )}
                        </div>
                    ) : (
                        <ChatPanelImageAttachmentMenu
                            isOpen={activeMenu === 'imageAttach'}
                            onToggle={onImageAttachToggle}
                            onLocalUpload={onImageLocalUpload}
                            onAssetLibrary={onImageAssetLibrary}
                            onPickFromCanvas={onPickFromCanvas}
                        />
                    )}
                    <textarea
                        ref={textareaRef}
                        value={message}
                        onChange={(event) => onMessageChange(event.target.value)}
                        placeholder={composerMode === 'image' ? '今天我们要创作什么' : '今天我们要制作什么视频'}
                        className="max-h-[72px] min-h-[44px] w-full resize-none bg-transparent text-sm leading-6 text-neutral-950 outline-none placeholder:text-neutral-400"
                        rows={3}
                        disabled={isLoading}
                        onInput={(event) => resizeTextarea(event, 72)}
                        onKeyDown={(event) => sendOnEnter(event, onSend)}
                    />
                </div>
            )}
        </>
    );
}
