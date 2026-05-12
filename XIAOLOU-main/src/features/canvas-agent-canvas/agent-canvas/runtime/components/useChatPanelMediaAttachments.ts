import { useCallback, useRef, useState, type DragEvent, type RefObject } from 'react';
import {
    createXiaolouAsset,
    uploadXiaolouMediaFile,
    type XiaolouAssetLibraryItem,
} from '../integrations/xiaolouAssetBridge';
import {
    assetCategoryForMediaType,
    assetTypeForMediaType,
    getVideoAttachMediaType,
    inferComposerMediaType,
    isMediaFile,
    mediaAttachmentFromCanvasNode,
    readFileAsDataUrl,
    resolveUploadedMediaUrl,
    type AssetLibraryMediaFilter,
    type AttachedMedia,
    type VideoAttachSlot,
} from './chatPanelMediaAttachments';

type ComposerMode = 'agent' | 'image' | 'video';

type CanvasSnapshotLike = {
    selectedNodeIds?: unknown[];
    nodes?: unknown[];
};

type VideoAttachmentLimits = {
    image: number;
    video: number;
    audio: number;
};

type UseChatPanelMediaAttachmentsOptions = {
    composerMode: ComposerMode;
    fileInputRef: RefObject<HTMLInputElement | null>;
    getCanvasSnapshot?: () => CanvasSnapshotLike | undefined;
    focusComposer?: () => void;
    closeActiveMenu: () => void;
    setShowAssetLibrary: (show: boolean) => void;
};

export function useChatPanelMediaAttachments({
    composerMode,
    fileInputRef,
    getCanvasSnapshot,
    focusComposer,
    closeActiveMenu,
    setShowAssetLibrary,
}: UseChatPanelMediaAttachmentsOptions) {
    const [attachedMedia, setAttachedMedia] = useState<AttachedMedia[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [pendingVideoAttachSlot, setPendingVideoAttachSlot] = useState<VideoAttachSlot | null>(null);
    const [activeVideoAttachSlotId, setActiveVideoAttachSlotId] = useState<string | null>(null);
    const [assetLibraryMediaFilter, setAssetLibraryMediaFilter] = useState<AssetLibraryMediaFilter | null>(null);
    const pendingVideoAttachSlotRef = useRef<VideoAttachSlot | null>(null);
    const videoAttachmentLimitsRef = useRef<VideoAttachmentLimits>({
        image: 1,
        video: 1,
        audio: 1,
    });

    const updatePendingVideoAttachSlot = useCallback((slot: VideoAttachSlot | null) => {
        pendingVideoAttachSlotRef.current = slot;
        setPendingVideoAttachSlot(slot);
        if (!slot) {
            setActiveVideoAttachSlotId(null);
        }
    }, []);

    const resetVideoAttachmentState = useCallback(() => {
        pendingVideoAttachSlotRef.current = null;
        setPendingVideoAttachSlot(null);
        setActiveVideoAttachSlotId(null);
        setAssetLibraryMediaFilter(null);
    }, []);

    const setVideoAttachmentLimits = useCallback((limits: VideoAttachmentLimits) => {
        videoAttachmentLimitsRef.current = limits;
    }, []);

    const clearAttachedMedia = useCallback(() => {
        setAttachedMedia([]);
    }, []);

    const getVideoAttachLimit = useCallback((slot: VideoAttachSlot) => {
        const limits = videoAttachmentLimitsRef.current;
        if (slot === 'firstFrame' || slot === 'lastFrame') return 1;
        if (slot === 'image') return Math.max(limits.image || 1, 1);
        if (slot === 'video') return Math.max(limits.video || 1, 1);
        return Math.max(limits.audio || 1, 1);
    }, []);

    const applyVideoAttachmentsForSlot = useCallback((
        previous: AttachedMedia[],
        incoming: AttachedMedia[],
        slot: VideoAttachSlot | null,
    ) => {
        if (!slot) return [...previous, ...incoming];
        const mediaType = getVideoAttachMediaType(slot);
        const matching = incoming
            .filter((item) => item.type === mediaType)
            .map((item) => ({ ...item, frameRole: undefined }));
        if (!matching.length) return previous;

        if (slot === 'firstFrame' || slot === 'lastFrame') {
            const previousImages = previous.filter((item) => item.type === 'image');
            const firstFrameMedia = previousImages.find((item) => item.frameRole === 'firstFrame') || previousImages[0] || null;
            const lastFrameMedia = previousImages.find((item) => item.frameRole === 'lastFrame') ||
                previousImages.find((item) => item.nodeId !== firstFrameMedia?.nodeId) ||
                null;
            const role = slot;
            const replacedNodeId = role === 'firstFrame' ? firstFrameMedia?.nodeId : lastFrameMedia?.nodeId;
            return [
                ...previous.filter((item) => item.nodeId !== replacedNodeId && item.frameRole !== role),
                { ...matching[0], frameRole: role },
            ];
        }

        const limit = getVideoAttachLimit(slot);
        const currentCount = previous.filter((item) => item.type === mediaType).length;
        if (limit <= 1) {
            return [
                ...previous.filter((item) => item.type !== mediaType),
                matching[0],
            ];
        }
        const remaining = Math.max(limit - currentCount, 0);
        if (remaining <= 0) return previous;
        return [...previous, ...matching.slice(0, remaining)];
    }, [getVideoAttachLimit]);

    const handleDragEnter = useCallback((e: DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e: DragEvent) => {
        e.preventDefault();
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
        }
    }, []);

    const handleDragOver = useCallback((e: DragEvent) => {
        e.preventDefault();
    }, []);

    const handleDrop = useCallback(async (e: DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);

        const nodeData = e.dataTransfer.getData('application/json');
        if (!nodeData) return;

        try {
            const { nodeId, url, type } = JSON.parse(nodeData);
            if (!url || (type !== 'image' && type !== 'video' && type !== 'audio')) return;

            const nextAttachment = {
                type,
                url,
                nodeId,
                previewUrl: url,
            };
            setAttachedMedia((prev) => applyVideoAttachmentsForSlot(
                prev,
                [nextAttachment],
                composerMode === 'video' ? pendingVideoAttachSlotRef.current : null,
            ));
            updatePendingVideoAttachSlot(null);
        } catch (err) {
            console.error('Failed to parse dropped node data:', err);
        }
    }, [applyVideoAttachmentsForSlot, composerMode, updatePendingVideoAttachSlot]);

    const removeAttachment = useCallback((nodeId: string) => {
        setAttachedMedia((prev) => prev.filter((item) => item.nodeId !== nodeId));
    }, []);

    const buildAttachmentFromLocalFile = useCallback(async (file: File, index: number): Promise<AttachedMedia> => {
        const type = inferComposerMediaType(file);
        const localDataUrl = type === 'image' ? await readFileAsDataUrl(file) : '';
        const baseAttachment: AttachedMedia = {
            type,
            url: localDataUrl,
            previewUrl: localDataUrl || undefined,
            nodeId: `upload-${Date.now()}-${index}-${file.name}`,
            base64: type === 'image' ? localDataUrl.split(',')[1] || undefined : undefined,
        };

        try {
            const uploaded = await uploadXiaolouMediaFile(file, `agent-canvas-${type}-reference`);
            const uploadedUrl = resolveUploadedMediaUrl(uploaded);
            if (!uploadedUrl) {
                if (baseAttachment.url) return baseAttachment;
                const fallbackUrl = await readFileAsDataUrl(file);
                return { ...baseAttachment, url: fallbackUrl, previewUrl: fallbackUrl };
            }

            let asset: XiaolouAssetLibraryItem | null = null;
            try {
                asset = await createXiaolouAsset({
                    assetType: assetTypeForMediaType(type),
                    name: file.name,
                    category: assetCategoryForMediaType(type),
                    mediaKind: type,
                    mediaUrl: uploadedUrl,
                    sourceUrl: uploadedUrl,
                    previewUrl: type === 'image' ? uploadedUrl : uploadedUrl,
                    scope: 'manual',
                    sourceModule: 'canvas',
                });
            } catch (assetError) {
                console.warn('[ChatPanel] Local upload succeeded but project asset sync failed:', assetError);
            }

            const durableUrl = asset?.url || uploadedUrl;
            return {
                ...baseAttachment,
                url: durableUrl,
                uploadedUrl,
                previewUrl: asset?.previewUrl || (type === 'image' ? localDataUrl || durableUrl : durableUrl),
                assetId: asset?.id,
                base64: undefined,
            };
        } catch (uploadError) {
            console.warn('[ChatPanel] Failed to upload local file through Xiaolou media service:', uploadError);
            if (baseAttachment.url) return baseAttachment;
            const fallbackUrl = await readFileAsDataUrl(file);
            return { ...baseAttachment, url: fallbackUrl, previewUrl: fallbackUrl };
        }
    }, []);

    const handleUploadFiles = useCallback(async (files: FileList | null) => {
        const pendingSlot = composerMode === 'video' ? pendingVideoAttachSlotRef.current : null;
        const pendingMediaType = pendingSlot ? getVideoAttachMediaType(pendingSlot) : null;
        const selectedFiles = Array.from(files || []).filter((file) => {
            if (!isMediaFile(file)) return false;
            if (!pendingMediaType) return true;
            return file.type.startsWith(`${pendingMediaType}/`);
        });
        if (!selectedFiles.length) {
            updatePendingVideoAttachSlot(null);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
            return;
        }

        const nextAttachments = await Promise.all(
            selectedFiles.map((file, index) => buildAttachmentFromLocalFile(file, index)),
        );

        setAttachedMedia((prev) => applyVideoAttachmentsForSlot(prev, nextAttachments, pendingSlot));
        closeActiveMenu();
        updatePendingVideoAttachSlot(null);
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    }, [
        applyVideoAttachmentsForSlot,
        buildAttachmentFromLocalFile,
        closeActiveMenu,
        composerMode,
        fileInputRef,
        updatePendingVideoAttachSlot,
    ]);

    const handleAssetLibrarySelect = useCallback(async (url: string, type: 'image' | 'video' | 'audio') => {
        const nextAttachment = {
            type,
            url,
            previewUrl: url,
            nodeId: `library-${Date.now()}`,
        };
        setAttachedMedia((prev) => applyVideoAttachmentsForSlot(
            prev,
            [nextAttachment],
            composerMode === 'video' ? pendingVideoAttachSlotRef.current : null,
        ));
        updatePendingVideoAttachSlot(null);
        setAssetLibraryMediaFilter(null);
        setShowAssetLibrary(false);
    }, [applyVideoAttachmentsForSlot, composerMode, setShowAssetLibrary, updatePendingVideoAttachSlot]);

    const handlePickFromCanvas = useCallback((slot?: VideoAttachSlot) => {
        if (slot) {
            updatePendingVideoAttachSlot(slot);
        }
        const snapshot = getCanvasSnapshot?.();
        const selectedNodeIds = new Set((snapshot?.selectedNodeIds || []).map(String));
        const selectedMedia = (snapshot?.nodes || [])
            .filter((node) => {
                const nodeId = String((node as Record<string, unknown> | null)?.id || '');
                return nodeId && selectedNodeIds.has(nodeId);
            })
            .map(mediaAttachmentFromCanvasNode)
            .filter((item): item is AttachedMedia => Boolean(item));
        const targetSlot = slot || (composerMode === 'video' ? pendingVideoAttachSlotRef.current : null);
        const targetType = targetSlot ? getVideoAttachMediaType(targetSlot) : 'image';
        const matchingMedia = selectedMedia.filter((item) => item.type === targetType);
        if (matchingMedia.length) {
            setAttachedMedia((prev) => applyVideoAttachmentsForSlot(
                prev,
                matchingMedia,
                composerMode === 'video' ? targetSlot : null,
            ));
            updatePendingVideoAttachSlot(null);
            closeActiveMenu();
            setIsDragOver(false);
            return;
        }
        closeActiveMenu();
        setIsDragOver(true);
        focusComposer?.();
        window.setTimeout(() => setIsDragOver(false), 1400);
    }, [
        applyVideoAttachmentsForSlot,
        closeActiveMenu,
        composerMode,
        focusComposer,
        getCanvasSnapshot,
        updatePendingVideoAttachSlot,
    ]);

    const openLocalUploadForVideoSlot = useCallback((slot: VideoAttachSlot) => {
        updatePendingVideoAttachSlot(slot);
        closeActiveMenu();
        window.setTimeout(() => fileInputRef.current?.click(), 0);
    }, [closeActiveMenu, fileInputRef, updatePendingVideoAttachSlot]);

    const openAssetLibraryForVideoSlot = useCallback((slot: VideoAttachSlot) => {
        updatePendingVideoAttachSlot(slot);
        setAssetLibraryMediaFilter(getVideoAttachMediaType(slot));
        closeActiveMenu();
        setShowAssetLibrary(true);
    }, [closeActiveMenu, setShowAssetLibrary, updatePendingVideoAttachSlot]);

    return {
        activeVideoAttachSlotId,
        assetLibraryMediaFilter,
        attachedMedia,
        clearAttachedMedia,
        handleAssetLibrarySelect,
        handleDragEnter,
        handleDragLeave,
        handleDragOver,
        handleDrop,
        handlePickFromCanvas,
        handleUploadFiles,
        isDragOver,
        openAssetLibraryForVideoSlot,
        openLocalUploadForVideoSlot,
        pendingVideoAttachSlot,
        removeAttachment,
        resetVideoAttachmentState,
        setActiveVideoAttachSlotId,
        setAssetLibraryMediaFilter,
        setVideoAttachmentLimits,
        updatePendingVideoAttachSlot,
    };
}
