/**
 * useImageNodeHandlers.ts
 * 
 * Handles Image node menu actions (Image to Image, Image to Video, Change Angle).
 * Creates connected nodes when users select these options from the placeholder.
 */

import React from 'react';
import { generateUUID } from '../utils/secureContextPolyfills';
import { NodeData, NodeType, NodeStatus } from '../types';
import { generateCameraAngle, resolveCameraAngleModelId } from '../services/cameraAngleService';
import { uploadAsset } from '../services/assetService';
import { recoverGeneration } from '../services/generationService';
import { DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID, normalizeCanvasImageModelId } from '../config/canvasImageModels';
import { DEFAULT_XIAOLOU_IMAGE_TO_VIDEO_MODEL_ID } from '../config/canvasVideoModels';
import { getRuntimeConfig } from '../runtimeConfig';

// ============================================================================
// TYPES
// ============================================================================

interface UseImageNodeHandlersOptions {
    nodes: NodeData[];
    setNodes: React.Dispatch<React.SetStateAction<NodeData[]>>;
    setSelectedNodeIds: React.Dispatch<React.SetStateAction<string[]>>;
    onGenerateNode?: (nodeId: string) => void; // Callback to trigger generation on a node
}

// ============================================================================
// HOOK
// ============================================================================

export const useImageNodeHandlers = ({
    nodes,
    setNodes,
    setSelectedNodeIds,
    onGenerateNode
}: UseImageNodeHandlersOptions) => {
    const appendCacheBustParam = React.useCallback((url: string): string => {
        if (!url || url.startsWith('data:')) {
            return url;
        }

        const hashIndex = url.indexOf('#');
        const baseUrl = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
        const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
        const separator = baseUrl.includes('?') ? '&' : '?';
        return `${baseUrl}${separator}t=${Date.now()}${hash}`;
    }, []);

    const reconcileAcceptedCameraAngleTask = React.useCallback(async (
        targetNodeId: string,
        taskId: string,
    ): Promise<'succeeded' | 'failed' | 'pending' | 'unavailable'> => {
        try {
            const recovered = await recoverGeneration({ kind: 'image', taskId });
            if (!recovered) {
                return 'unavailable';
            }

            if (recovered.status === 'succeeded') {
                setNodes(prev => prev.map(node =>
                    node.id === targetNodeId
                        ? {
                            ...node,
                            status: NodeStatus.SUCCESS,
                            resultUrl: appendCacheBustParam(recovered.resultUrl),
                            errorMessage: undefined,
                            taskId,
                        }
                        : node
                ));
                return 'succeeded';
            }

            if (recovered.status === 'pending') {
                setNodes(prev => prev.map(node =>
                    node.id === targetNodeId
                        ? {
                            ...node,
                            status: NodeStatus.LOADING,
                            errorMessage: undefined,
                            taskId,
                        }
                        : node
                ));
                return 'pending';
            }

            setNodes(prev => prev.map(node =>
                node.id === targetNodeId
                    ? {
                        ...node,
                        status: NodeStatus.ERROR,
                        errorMessage: recovered.error || '多角度生成失败',
                        taskId,
                    }
                    : node
            ));
            return 'failed';
        } catch {
            return 'unavailable';
        }
    }, [appendCacheBustParam, setNodes]);

    /**
     * Handle "Image to Image" - creates a new Image node connected to this Image node
     * The current node becomes the input (parent) for the new Image node
     */
    const handleImageToImage = (nodeId: string) => {
        const imageNode = nodes.find(n => n.id === nodeId);
        if (!imageNode) return;

        // Create Image node to the right
        const newNodeId = generateUUID();
        const GAP = 100;
        const NODE_WIDTH = 340;

        const newImageNode: NodeData = {
            id: newNodeId,
            type: NodeType.IMAGE,
            x: imageNode.x + NODE_WIDTH + GAP,
            y: imageNode.y,
            prompt: '',
            status: NodeStatus.IDLE,
            model: normalizeCanvasImageModelId(imageNode.imageModel || imageNode.model),
            imageModel: normalizeCanvasImageModelId(imageNode.imageModel || imageNode.model || DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID),
            aspectRatio: 'Auto',
            resolution: 'Auto',
            parentIds: [nodeId] // Connect to the source image node
        };

        // Add new image node
        setNodes(prev => [...prev, newImageNode]);
        setSelectedNodeIds([newNodeId]);
    };

    /**
     * Handle "Image to Video" - creates a new Video node connected to this Image node
     * The current node becomes the input frame for the new Video node
     */
    const handleImageToVideo = (nodeId: string) => {
        const imageNode = nodes.find(n => n.id === nodeId);
        if (!imageNode) return;

        // Create Video node to the right
        const newNodeId = generateUUID();
        const GAP = 100;
        const NODE_WIDTH = 340;

        const newVideoNode: NodeData = {
            id: newNodeId,
            type: NodeType.VIDEO,
            x: imageNode.x + NODE_WIDTH + GAP,
            y: imageNode.y,
            prompt: '',
            status: NodeStatus.IDLE,
            model: getRuntimeConfig().isEmbedded ? DEFAULT_XIAOLOU_IMAGE_TO_VIDEO_MODEL_ID : 'Banana Pro',
            videoModel: getRuntimeConfig().isEmbedded ? DEFAULT_XIAOLOU_IMAGE_TO_VIDEO_MODEL_ID : undefined,
            aspectRatio: 'Auto',
            resolution: 'Auto',
            parentIds: [nodeId] // Connect to the source image node
        };

        // Add new video node
        setNodes(prev => [...prev, newVideoNode]);
        setSelectedNodeIds([newNodeId]);
    };

    /**
     * Handle "Change Angle Generate" - calls Modal Camera Angle API
     * Creates a new Image node with the transformed result
     */
    const handleChangeAngleGenerate = React.useCallback(async (nodeId: string) => {
        const imageNode = nodes.find(n => n.id === nodeId);
        if (!imageNode || !imageNode.angleSettings || !imageNode.resultUrl) {
            console.error('[ChangeAngle] Missing required data:', {
                hasNode: !!imageNode,
                hasSettings: !!imageNode?.angleSettings,
                hasResultUrl: !!imageNode?.resultUrl
            });
            return;
        }

        // Create Image node to the right
        const newNodeId = generateUUID();
        const GAP = 100;
        const NODE_WIDTH = 340;
        const cameraAngleModelId = resolveCameraAngleModelId(
            imageNode.imageModel || imageNode.model || DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID
        );

        // Create placeholder node in LOADING state
        const newImageNode: NodeData = {
            id: newNodeId,
            type: NodeType.CAMERA_ANGLE,
            x: imageNode.x + NODE_WIDTH + GAP,
            y: imageNode.y,
            // Prompt is stored for reference but not displayed in the specialized node
            prompt: `${(imageNode.angleSettings.mode || 'camera') === 'subject' ? 'Subject angle' : 'Camera angle'}: rotation=${imageNode.angleSettings.rotation}°, tilt=${imageNode.angleSettings.tilt}°`,
            status: NodeStatus.LOADING,
            model: cameraAngleModelId,
            imageModel: cameraAngleModelId,
            aspectRatio: imageNode.aspectRatio || 'Auto',
            resolution: imageNode.resolution || 'Auto',
            parentIds: [nodeId], // Connect to source

            // Persist angle settings to the new node so controls can be re-opened with same state
            angleSettings: {
                mode: imageNode.angleSettings.mode || 'camera',
                ...imageNode.angleSettings
            },
            angleMode: false,
            generationStartTime: Date.now(),
        };

        let acceptedTaskId: string | undefined;

        // Add new node and close angle mode on source, and also clear any
        // lingering errorMessage on the new node (we just created it in
        // LOADING state, but if the user is retrying from a failed node the
        // caller may pass through the old one — guard anyway so a stale red
        // banner never flashes during a fresh attempt).
        setNodes(prev => [
            ...prev.map(n => n.id === nodeId ? { ...n, angleMode: false } : n),
            { ...newImageNode, errorMessage: undefined },
        ]);
        setSelectedNodeIds([newNodeId]);

        try {
            console.log('[ChangeAngle] Starting generation:', {
                nodeId,
                newNodeId,
                model: cameraAngleModelId,
                rotation: imageNode.angleSettings.rotation,
                tilt: imageNode.angleSettings.tilt,
                scale: imageNode.angleSettings.scale,
                resultUrlPrefix: imageNode.resultUrl?.slice(0, 60),
            });

            const ANGLE_TIMEOUT_MS = 180_000;
            const generationPromise = generateCameraAngle(
                imageNode.resultUrl,
                imageNode.angleSettings.rotation,
                imageNode.angleSettings.tilt,
                imageNode.angleSettings.scale,
                {
                    model: cameraAngleModelId,
                    aspectRatio: imageNode.aspectRatio,
                    resolution: imageNode.resolution,
                    wideAngle: imageNode.angleSettings.wideAngle,
                    mode: imageNode.angleSettings.mode || 'camera',
                    onTaskIdAssigned: (taskId) => {
                        if (!taskId) return;
                        acceptedTaskId = taskId;
                        setNodes(prev => prev.map(node =>
                            node.id === newNodeId
                                ? {
                                    ...node,
                                    taskId,
                                }
                                : node
                        ));
                    },
                }
            );
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('多角度生成超时，请稍后重试。')), ANGLE_TIMEOUT_MS);
            });

            const result = await Promise.race([generationPromise, timeoutPromise]);

            console.log('[ChangeAngle] Success:', {
                hasImageUrl: !!result.imageUrl,
                imageUrlPrefix: result.imageUrl?.slice(0, 60),
            });

            // Camera Angle service currently returns `data:image/png;base64,...`.
            // Upload to the asset library so we never persist the base64 blob
            // into canvasProjectsByActorId.
            let persistUrl = result.imageUrl;
            if (typeof persistUrl === 'string' && persistUrl.startsWith('data:')) {
                try {
                    const uploaded = await uploadAsset(persistUrl, 'image', `camera-angle:${newNodeId}`);
                    if (uploaded && !uploaded.startsWith('data:')) {
                        persistUrl = uploaded;
                    }
                } catch (uploadErr) {
                    console.warn('[ChangeAngle] Failed to upload camera-angle output, keeping inline URL only for current session:', uploadErr);
                    // If we cannot upload, flip to ERROR rather than persist base64.
                    setNodes(prev => prev.map(n =>
                        n.id === newNodeId
                            ? {
                                ...n,
                                status: NodeStatus.ERROR,
                                errorMessage: '多角度结果上传失败，请重试',
                            }
                            : n
                    ));
                    return;
                }
            }

            setNodes(prev => prev.map(n =>
                n.id === newNodeId
                    ? {
                        ...n,
                        status: NodeStatus.SUCCESS,
                        resultUrl: persistUrl,
                        seed: result.seed,
                        errorMessage: undefined,
                        taskId: result.taskId ?? acceptedTaskId,
                    }
                    : n
            ));
        } catch (error: any) {
            console.error('[ChangeAngle] Error:', error?.message || error);

            if (acceptedTaskId) {
                const reconciled = await reconcileAcceptedCameraAngleTask(newNodeId, acceptedTaskId);
                if (reconciled !== 'unavailable') {
                    console.warn('[ChangeAngle] Reconciled accepted task after local failure:', {
                        nodeId: newNodeId,
                        taskId: acceptedTaskId,
                        reconciled,
                    });
                    return;
                }
            }

            // Surface the concrete backend/provider reason in the same
            // `[CODE] 原因` format that `/create/image` and `/create/video` use,
            // so users can tell a model / config / quota problem apart from a
            // transient network or permission issue. For a few well-known
            // codes (FORBIDDEN / UNAUTHORIZED / NOT_FOUND on task lookup) we
            // also prepend a short Chinese explanation because the raw
            // upstream text is pure English and non-actionable on its own.
            const rawMessage: string =
                (error?.message || '').toString().trim() || '多角度生成失败';
            const errorTypeTag: string = (error?.code || error?.name || '')
                .toString()
                .trim();
            const statusCode: number =
                typeof error?.status === 'number' ? error.status : 0;

            let hint: string | null = null;
            const tagUpper = errorTypeTag.toUpperCase();
            if (
                tagUpper === 'FORBIDDEN' ||
                tagUpper === 'UNAUTHORIZED' ||
                statusCode === 401 ||
                statusCode === 403
            ) {
                hint =
                    '历史任务已无法访问（可能是跨账户、已被清理或会话已过期）。请点击源图的"多角度"再次发起。';
            } else if (
                tagUpper === 'NOT_FOUND' ||
                statusCode === 404
            ) {
                hint =
                    '任务记录不存在（可能已被清理或超时）。请重新发起多角度生成。';
            } else if (
                tagUpper === 'REFERENCE_IMAGE_EXPIRED' ||
                /参考图链接已失效/.test(rawMessage)
            ) {
                hint =
                    '源图链接已失效，请先重新生成或替换源图后再尝试多角度。';
            } else if (
                tagUpper === 'PROVIDER_NOT_CONFIGURED' ||
                tagUpper === 'VERTEX_UNCONFIGURED'
            ) {
                hint =
                    '当前模型后端尚未配置，请更换模型或在后台补齐 API Key / 项目 ID。';
            }

            const codeTag =
                errorTypeTag && tagUpper !== 'ERROR' ? `[${errorTypeTag}] ` : '';
            const errorMessage = hint
                ? `${codeTag}${hint}\n详情：${rawMessage}`
                : `${codeTag}${rawMessage}`;

            setNodes(prev => prev.map(n =>
                n.id === newNodeId
                    ? {
                        ...n,
                        status: NodeStatus.ERROR,
                        errorMessage,
                    }
                    : n
            ));
        }
    }, [nodes, reconcileAcceptedCameraAngleTask, setNodes, setSelectedNodeIds]);

    return {
        handleImageToImage,
        handleImageToVideo,
        handleChangeAngleGenerate
    };
};
