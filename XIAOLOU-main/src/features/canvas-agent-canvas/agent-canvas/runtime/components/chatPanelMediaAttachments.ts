import type { XiaolouUploadedMedia } from '../integrations/xiaolouAssetBridge';

export type VideoFrameRole = 'firstFrame' | 'lastFrame';
export type VideoAttachSlot = 'image' | 'video' | 'audio' | VideoFrameRole;
export type AssetLibraryMediaFilter = 'image' | 'video' | 'audio';

export interface AttachedMedia {
    type: 'image' | 'video' | 'audio';
    url: string;
    nodeId: string;
    base64?: string;
    frameRole?: VideoFrameRole;
    previewUrl?: string;
    uploadedUrl?: string;
    assetId?: string;
}

export type VideoSlotDefinition = {
    id: string;
    label: string;
    type: AttachedMedia['type'];
    slot: VideoAttachSlot;
    media?: AttachedMedia | null;
    disabled?: boolean;
    extraCount?: number;
};

export function isMediaFile(file: File) {
    return file.type.startsWith('image/') || file.type.startsWith('video/') || file.type.startsWith('audio/');
}

export function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
}

export function resolveUploadedMediaUrl(uploaded: XiaolouUploadedMedia | null | undefined) {
    return uploaded?.signedReadUrl || uploaded?.url || uploaded?.urlPath || '';
}

export function mediaUrlForPayload(media: AttachedMedia) {
    const durableUrl = media.uploadedUrl || media.url;
    if (durableUrl) return durableUrl;
    return media.type === 'image' && media.base64 ? `data:image/png;base64,${media.base64}` : media.url;
}

export function mediaPreviewUrl(media: AttachedMedia) {
    return media.previewUrl || media.url;
}

export function inferComposerMediaType(file: File): AttachedMedia['type'] {
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('audio/')) return 'audio';
    return 'video';
}

export function assetCategoryForMediaType(type: AttachedMedia['type']) {
    if (type === 'audio') return 'Sound Effect';
    return 'Others';
}

export function assetTypeForMediaType(type: AttachedMedia['type']) {
    if (type === 'video') return 'video_ref';
    if (type === 'audio') return 'audio';
    return 'image_ref';
}

export function mediaAttachmentFromCanvasNode(node: unknown): AttachedMedia | null {
    if (!node || typeof node !== 'object') return null;
    const record = node as Record<string, unknown>;
    const rawType = String(record.type || record.nodeType || '').toLowerCase();
    const type: AttachedMedia['type'] | null = rawType.includes('video')
        ? 'video'
        : rawType.includes('audio')
            ? 'audio'
            : rawType.includes('image')
                ? 'image'
                : null;
    if (!type) return null;

    const url = String(record.resultUrl || record.url || record.mediaUrl || '').trim();
    if (!url) return null;
    const id = String(record.id || `canvas-${Date.now()}`).trim();
    const previewUrl = type === 'video'
        ? String(record.lastFrame || record.thumbnailUrl || url || '').trim()
        : url;
    return {
        type,
        url,
        previewUrl: previewUrl || url,
        nodeId: id,
    };
}

export function getVideoAttachMediaType(slot: VideoAttachSlot): AttachedMedia['type'] {
    if (slot === 'video') return 'video';
    if (slot === 'audio') return 'audio';
    return 'image';
}

export function getVideoAttachAccept(slot: VideoAttachSlot | null) {
    if (slot === 'video') return 'video/*';
    if (slot === 'audio') return 'audio/*';
    if (slot) return 'image/*';
    return null;
}
