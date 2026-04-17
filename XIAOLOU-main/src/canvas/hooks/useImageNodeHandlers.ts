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
            angleMode: false
        };

        // Add new node and close angle mode on source
        setNodes(prev => [
            ...prev.map(n => n.id === nodeId ? { ...n, angleMode: false } : n),
            newImageNode
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
                    mode: imageNode.angleSettings.mode || 'camera'
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

            setNodes(prev => prev.map(n =>
                n.id === newNodeId
                    ? {
                        ...n,
                        status: NodeStatus.SUCCESS,
                        resultUrl: result.imageUrl,
                        seed: result.seed
                    }
                    : n
            ));
        } catch (error: any) {
            console.error('[ChangeAngle] Error:', error?.message || error);

            setNodes(prev => prev.map(n =>
                n.id === newNodeId
                    ? {
                        ...n,
                        status: NodeStatus.ERROR,
                        errorMessage: error.message || '多角度生成失败'
                    }
                    : n
            ));
        }
    }, [nodes, setNodes, setSelectedNodeIds]);

    return {
        handleImageToImage,
        handleImageToVideo,
        handleChangeAngleGenerate
    };
};
