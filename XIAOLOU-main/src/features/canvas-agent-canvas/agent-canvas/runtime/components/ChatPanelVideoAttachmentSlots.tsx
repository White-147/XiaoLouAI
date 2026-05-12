import { AudioLines, Film, ImageIcon, MousePointer2, Paperclip, Users } from 'lucide-react';
import {
    getVideoAttachMediaType,
    mediaPreviewUrl,
    type AttachedMedia,
    type VideoAttachSlot,
    type VideoSlotDefinition,
} from './chatPanelMediaAttachments';

type VideoComposerModeForSlots =
    | 'reference'
    | 'start_end_frame'
    | 'multi_param'
    | 'video_edit'
    | 'motion_control';

type BuildVideoSlotDefinitionsInput = {
    videoComposerMode: VideoComposerModeForSlots;
    videoImages: AttachedMedia[];
    videoRefs: AttachedMedia[];
    videoAudioRefs: AttachedMedia[];
    showImageReferenceSlot: boolean;
    showVideoReferenceSlot: boolean;
    showAudioReferenceSlot: boolean;
    currentVideoMaxReferenceImages: number;
};

export function buildVideoSlotDefinitions({
    videoComposerMode,
    videoImages,
    videoRefs,
    videoAudioRefs,
    showImageReferenceSlot,
    showVideoReferenceSlot,
    showAudioReferenceSlot,
    currentVideoMaxReferenceImages,
}: BuildVideoSlotDefinitionsInput): VideoSlotDefinition[] {
    const firstFrameMedia = videoImages.find((item) => item.frameRole === 'firstFrame') || videoImages[0] || null;
    const lastFrameMedia = videoImages.find((item) => item.frameRole === 'lastFrame') ||
        videoImages.find((item) => item.nodeId !== firstFrameMedia?.nodeId) ||
        null;
    const referenceImageSlotCount = showImageReferenceSlot && videoComposerMode !== 'start_end_frame'
        ? Math.max(
            1,
            Math.min(
                currentVideoMaxReferenceImages || 1,
                videoImages.length + (videoImages.length < (currentVideoMaxReferenceImages || 1) ? 1 : 0),
            ),
        )
        : 0;

    if (videoComposerMode === 'start_end_frame') {
        return [
            {
                id: 'firstFrame',
                label: '首帧',
                type: 'image',
                slot: 'firstFrame',
                media: firstFrameMedia,
                disabled: false,
            },
            {
                id: 'lastFrame',
                label: '尾帧',
                type: 'image',
                slot: 'lastFrame',
                media: lastFrameMedia,
                disabled: !firstFrameMedia,
            },
        ];
    }

    return ([
        ...Array.from({ length: referenceImageSlotCount }, (_, index) => ({
            id: `image-${index}`,
            label: '图片',
            type: 'image' as const,
            slot: 'image' as const,
            media: videoImages[index] || null,
            disabled: index > videoImages.length,
        })),
        showVideoReferenceSlot ? {
            id: 'video',
            label: '视频',
            type: 'video' as const,
            slot: 'video' as const,
            media: videoRefs[0] || null,
            extraCount: Math.max(videoRefs.length - 1, 0),
            disabled: false,
        } : null,
        showAudioReferenceSlot ? {
            id: 'audio',
            label: '音频',
            type: 'audio' as const,
            slot: 'audio' as const,
            media: videoAudioRefs[0] || null,
            extraCount: Math.max(videoAudioRefs.length - 1, 0),
            disabled: false,
        } : null,
    ] as Array<VideoSlotDefinition | null>).filter((item): item is VideoSlotDefinition => Boolean(item));
}

function getVideoSlotIcon(type: AttachedMedia['type']) {
    if (type === 'video') return Film;
    if (type === 'audio') return AudioLines;
    return ImageIcon;
}

function VideoAttachMenu({
    slot,
    onLocalUpload,
    onAssetLibrary,
    onPickFromCanvas,
}: {
    slot: VideoAttachSlot;
    onLocalUpload: (slot: VideoAttachSlot) => void;
    onAssetLibrary: (slot: VideoAttachSlot) => void;
    onPickFromCanvas: (slot: VideoAttachSlot) => void;
}) {
    const mediaType = getVideoAttachMediaType(slot);
    const uploadLabel = mediaType === 'video'
        ? '从本地上传视频'
        : mediaType === 'audio'
            ? '音频'
            : '从本地上传图片';

    return (
        <div className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-[212px] rounded-xl border border-neutral-100 bg-white p-2 shadow-2xl" data-agent-active-menu-root>
            <button
                type="button"
                onClick={() => onLocalUpload(slot)}
                className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm text-neutral-900 hover:bg-neutral-50"
            >
                <Paperclip size={16} />
                {uploadLabel}
            </button>
            <button
                type="button"
                onClick={() => onAssetLibrary(slot)}
                className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left text-sm text-neutral-900 hover:bg-neutral-50"
            >
                <Users size={16} className="mt-0.5 shrink-0" />
                <span className="min-w-0">
                    <span className="block whitespace-nowrap">从素材库选择</span>
                    {mediaType === 'audio' && (
                        <span className="mt-0.5 block text-xs leading-4 text-neutral-400">
                            角色素材需通过素材库审核后方可使用
                        </span>
                    )}
                </span>
            </button>
            {mediaType !== 'audio' && (
                <button
                    type="button"
                    onClick={() => onPickFromCanvas(slot)}
                    className="flex w-full items-center gap-2.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm text-neutral-900 hover:bg-neutral-50"
                >
                    <MousePointer2 size={16} />
                    从画布选择
                </button>
            )}
        </div>
    );
}

type ChatPanelVideoAttachmentSlotsProps = {
    slots: VideoSlotDefinition[];
    activeSlotId: string | null;
    menuOpen: boolean;
    onToggleSlot: (slotId: string, slot: VideoAttachSlot, disabled?: boolean) => void;
    onLocalUpload: (slot: VideoAttachSlot) => void;
    onAssetLibrary: (slot: VideoAttachSlot) => void;
    onPickFromCanvas: (slot: VideoAttachSlot) => void;
};

export function ChatPanelVideoAttachmentSlots({
    slots,
    activeSlotId,
    menuOpen,
    onToggleSlot,
    onLocalUpload,
    onAssetLibrary,
    onPickFromCanvas,
}: ChatPanelVideoAttachmentSlotsProps) {
    return (
        <div className="flex max-w-[300px] flex-wrap gap-2">
            {slots.map((slot) => {
                const media = slot.media || null;
                const SlotIcon = getVideoSlotIcon(slot.type);
                const isActive = menuOpen && activeSlotId === slot.id;

                return (
                    <div key={slot.id} className="relative" data-agent-active-menu-root>
                        <button
                            type="button"
                            onClick={() => onToggleSlot(slot.id, slot.slot, slot.disabled)}
                            disabled={slot.disabled}
                            className={`relative flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 overflow-hidden rounded-2xl text-xs font-medium leading-tight transition-colors ${slot.disabled
                                ? 'cursor-not-allowed bg-neutral-100/55 text-neutral-300'
                                : isActive
                                    ? 'bg-neutral-200 text-neutral-800'
                                    : 'bg-neutral-100/80 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-700'
                            }`}
                            aria-label={`添加${slot.label}`}
                        >
                            {media ? (
                                media.type === 'image' ? (
                                    <img src={mediaPreviewUrl(media)} alt="" className="h-full w-full object-cover" />
                                ) : media.type === 'video' ? (
                                    <Film size={16} />
                                ) : (
                                    <AudioLines size={16} />
                                )
                            ) : (
                                <>
                                    <SlotIcon size={16} />
                                    <span className="max-w-[3.5rem] truncate text-center">{slot.label}</span>
                                </>
                            )}
                            {!!slot.extraCount && slot.extraCount > 0 && (
                                <span className="absolute right-0.5 top-0.5 rounded-full bg-neutral-900 px-1 py-0.5 text-[9px] font-semibold text-white">
                                    +{slot.extraCount}
                                </span>
                            )}
                        </button>
                        {isActive && (
                            <VideoAttachMenu
                                slot={slot.slot}
                                onLocalUpload={onLocalUpload}
                                onAssetLibrary={onAssetLibrary}
                                onPickFromCanvas={onPickFromCanvas}
                            />
                        )}
                    </div>
                );
            })}
        </div>
    );
}
