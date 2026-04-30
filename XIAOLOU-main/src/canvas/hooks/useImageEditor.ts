/**
 * useImageEditor.ts
 *
 * Custom hook for managing image editor modal state and upload handlers.
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { CanvasNodeUploadSource, type NodeData, NodeStatus } from '../types';
import { uploadAsset } from '../services/assetService';

interface EditorModalState {
    isOpen: boolean;
    nodeId: string | null;
    imageUrl?: string;
}

interface UseImageEditorOptions {
    nodes: NodeData[];
    updateNode: (id: string, updates: Partial<NodeData>) => void;
}

type PreviousImageState = Pick<
    NodeData,
    'resultUrl' | 'resultAspectRatio' | 'aspectRatio' | 'taskId' | 'generationStartTime' | 'loadingKind'
>;

function isFileUploadSource(value: CanvasNodeUploadSource): value is File {
    return typeof File !== 'undefined' && value instanceof File;
}

function readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Failed to read image file.'));
        reader.readAsDataURL(file);
    });
}

export const useImageEditor = ({ nodes, updateNode }: UseImageEditorOptions) => {
    const [editorModal, setEditorModal] = useState<EditorModalState>({
        isOpen: false,
        nodeId: null,
    });
    const previousImageStateRef = useRef<Record<string, PreviousImageState>>({});
    const pendingPreviewUrlRef = useRef<Record<string, string | undefined>>({});

    const revokePendingPreview = useCallback((nodeId: string) => {
        const previewUrl = pendingPreviewUrlRef.current[nodeId];
        if (previewUrl?.startsWith('blob:')) {
            URL.revokeObjectURL(previewUrl);
        }
        delete pendingPreviewUrlRef.current[nodeId];
    }, []);

    useEffect(() => {
        return () => {
            Object.values(pendingPreviewUrlRef.current).forEach((previewUrl) => {
                if (previewUrl?.startsWith('blob:')) {
                    URL.revokeObjectURL(previewUrl);
                }
            });
            pendingPreviewUrlRef.current = {};
        };
    }, []);

    const handleOpenImageEditor = useCallback((nodeId: string) => {
        const node = nodes.find((item) => item.id === nodeId);
        if (!node) return;

        let imageUrl: string | undefined;

        if (node.parentIds && node.parentIds.length > 0) {
            const parentNode = nodes.find((item) => item.id === node.parentIds![0]);
            if (parentNode?.resultUrl) {
                imageUrl = parentNode.resultUrl;
            }
        }

        if (!imageUrl && node.resultUrl) {
            imageUrl = node.resultUrl;
        }

        setEditorModal({
            isOpen: true,
            nodeId,
            imageUrl,
        });
    }, [nodes]);

    const handleCloseImageEditor = useCallback(() => {
        setEditorModal({
            isOpen: false,
            nodeId: null,
        });
    }, []);

    const getClosestAspectRatio = (width: number, height: number): string => {
        const ratio = width / height;
        const standardRatios = [
            { label: '1:1', value: 1 },
            { label: '16:9', value: 16 / 9 },
            { label: '9:16', value: 9 / 16 },
            { label: '4:3', value: 4 / 3 },
            { label: '3:4', value: 3 / 4 },
            { label: '3:2', value: 3 / 2 },
            { label: '2:3', value: 2 / 3 },
            { label: '5:4', value: 5 / 4 },
            { label: '4:5', value: 4 / 5 },
            { label: '21:9', value: 21 / 9 },
        ];

        let closest = standardRatios[0];
        let minDiff = Math.abs(ratio - closest.value);

        for (const candidate of standardRatios) {
            const diff = Math.abs(ratio - candidate.value);
            if (diff < minDiff) {
                minDiff = diff;
                closest = candidate;
            }
        }

        return closest.label;
    };

    const handleUpload = useCallback((nodeId: string, imageSource: CanvasNodeUploadSource) => {
        const isFileSource = isFileUploadSource(imageSource);
        const previewUrl = isFileSource ? URL.createObjectURL(imageSource) : undefined;
        const sourceUrl = isFileSource ? '' : imageSource;
        const isDataUrl = typeof sourceUrl === 'string' && sourceUrl.startsWith('data:');
        const currentNode = nodes.find((node) => node.id === nodeId);

        revokePendingPreview(nodeId);
        previousImageStateRef.current[nodeId] = {
            resultUrl: currentNode?.resultUrl,
            resultAspectRatio: currentNode?.resultAspectRatio,
            aspectRatio: currentNode?.aspectRatio,
            taskId: currentNode?.taskId,
            generationStartTime: currentNode?.generationStartTime,
            loadingKind: currentNode?.loadingKind,
        };
        pendingPreviewUrlRef.current[nodeId] = previewUrl;

        const showUploadingPreview = () => {
            updateNode(nodeId, {
                status: NodeStatus.LOADING,
                loadingKind: 'asset-upload',
                resultUrl: previewUrl,
                resultAspectRatio: undefined,
                errorMessage: undefined,
                taskId: undefined,
                generationStartTime: undefined,
            });
        };

        const commit = (finalUrl: string) => {
            delete previousImageStateRef.current[nodeId];

            const image = new Image();
            image.onload = () => {
                updateNode(nodeId, {
                    resultUrl: finalUrl,
                    resultAspectRatio: `${image.naturalWidth}/${image.naturalHeight}`,
                    aspectRatio: getClosestAspectRatio(image.naturalWidth, image.naturalHeight),
                    status: NodeStatus.SUCCESS,
                    loadingKind: undefined,
                    characterReferenceUrls: undefined,
                    errorMessage: undefined,
                    taskId: undefined,
                    generationStartTime: undefined,
                });
                revokePendingPreview(nodeId);
            };
            image.onerror = () => {
                updateNode(nodeId, {
                    resultUrl: finalUrl,
                    status: NodeStatus.SUCCESS,
                    loadingKind: undefined,
                    characterReferenceUrls: undefined,
                    errorMessage: undefined,
                    taskId: undefined,
                    generationStartTime: undefined,
                });
                revokePendingPreview(nodeId);
            };
            image.src = finalUrl;
        };

        const rollback = () => {
            const previous = previousImageStateRef.current[nodeId];
            delete previousImageStateRef.current[nodeId];
            revokePendingPreview(nodeId);

            if (previous?.resultUrl) {
                updateNode(nodeId, {
                    resultUrl: previous.resultUrl,
                    resultAspectRatio: previous.resultAspectRatio,
                    aspectRatio: previous.aspectRatio,
                    status: NodeStatus.SUCCESS,
                    loadingKind: previous.loadingKind,
                    errorMessage: '本地图片上传失败，请重试。',
                    taskId: previous.taskId,
                    generationStartTime: previous.generationStartTime,
                });
                return;
            }

            updateNode(nodeId, {
                status: NodeStatus.ERROR,
                loadingKind: undefined,
                errorMessage: '本地图片上传失败，请重试。',
                taskId: undefined,
                generationStartTime: undefined,
            });
        };

        if (isFileSource) {
            showUploadingPreview();
            readFileAsDataUrl(imageSource)
                .then((dataUrl) => uploadAsset(dataUrl, 'image', `node-upload:${nodeId}`))
                .then((assetUrl) => {
                    if (!assetUrl || assetUrl.startsWith('data:')) {
                        throw new Error('uploadAsset returned a non-persisted URL.');
                    }
                    commit(assetUrl);
                })
                .catch((error) => {
                    console.error(`[useImageEditor] Failed to upload local image for node ${nodeId}:`, error);
                    rollback();
                });
            return;
        }

        if (!isDataUrl) {
            commit(sourceUrl);
            return;
        }

        showUploadingPreview();
        uploadAsset(sourceUrl, 'image', `node-upload:${nodeId}`)
            .then((assetUrl) => {
                if (!assetUrl || assetUrl.startsWith('data:')) {
                    throw new Error('uploadAsset returned a non-persisted URL.');
                }
                commit(assetUrl);
            })
            .catch((error) => {
                console.error(`[useImageEditor] Failed to upload image for node ${nodeId}:`, error);
                rollback();
            });
    }, [nodes, revokePendingPreview, updateNode]);

    return {
        editorModal,
        handleOpenImageEditor,
        handleCloseImageEditor,
        handleUpload,
    };
};
