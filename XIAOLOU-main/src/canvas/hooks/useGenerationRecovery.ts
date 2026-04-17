/**
 * useGenerationRecovery.ts
 * 
 * Custom hook that checks for nodes in 'loading' status and polls
 * the backend to see if their generation has finished.
 */

import { useEffect, useCallback, useRef } from 'react';
import { NodeData, NodeStatus, NodeType } from '../types';
import { extractVideoLastFrame } from '../utils/videoHelpers';
import { getRuntimeConfig } from '../runtimeConfig';
import { buildCanvasApiUrl } from '../integrations/twitcanvaRuntimePaths';
import {
    listXiaolouAssets,
    type XiaolouAssetLibraryItem,
} from '../integrations/xiaolouAssetBridge';

interface UseGenerationRecoveryOptions {
    nodes: NodeData[];
    updateNode: (id: string, updates: Partial<NodeData>) => void;
}

function normalizeRecoveryText(value?: string | null) {
    return String(value || '').trim().toLowerCase();
}

function findEmbeddedRecoveryAsset(
    node: NodeData | undefined,
    assets: XiaolouAssetLibraryItem[],
): XiaolouAssetLibraryItem | null {
    if (!node) return null;
    if (node.type !== NodeType.IMAGE && node.type !== NodeType.VIDEO) return null;

    const normalizedPrompt = normalizeRecoveryText(node.prompt);
    if (!normalizedPrompt) {
        return null;
    }

    const expectedType = node.type === NodeType.VIDEO ? 'video' : 'image';
    const minimumTimestamp = typeof node.generationStartTime === 'number'
        ? node.generationStartTime - 5000
        : null;

    const candidates = assets.filter((asset) => {
        if (asset.type !== expectedType || !asset.url) {
            return false;
        }

        if (normalizeRecoveryText(asset.generationPrompt) !== normalizedPrompt) {
            return false;
        }

        if (minimumTimestamp && asset.createdAt) {
            const createdAt = new Date(asset.createdAt).getTime();
            if (Number.isFinite(createdAt) && createdAt < minimumTimestamp) {
                return false;
            }
        }

        return true;
    });

    if (!candidates.length) {
        return null;
    }

    return candidates.sort((left, right) => {
        const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
        const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
        return rightTime - leftTime;
    })[0] || null;
}

export const useGenerationRecovery = ({
    nodes,
    updateNode
}: UseGenerationRecoveryOptions) => {
    // Use a ref to access current nodes without causing re-renders
    const nodesRef = useRef<NodeData[]>(nodes);
    nodesRef.current = nodes;

    const isEmbedded = getRuntimeConfig().isEmbedded;

    const checkStatus = useCallback(async (nodeId: string, embeddedAssets?: XiaolouAssetLibraryItem[]) => {
        try {
            const node = nodesRef.current.find(n => n.id === nodeId);
            if (!node || node.status !== NodeStatus.LOADING) {
                return;
            }

            if (isEmbedded) {
                const recoveredAsset = findEmbeddedRecoveryAsset(node, embeddedAssets || []);
                if (!recoveredAsset?.url) {
                    return;
                }

                console.log(`[Recovery] Recovered embedded result for node ${nodeId} from project assets`);

                const updates: Partial<NodeData> = {
                    status: NodeStatus.SUCCESS,
                    resultUrl: recoveredAsset.url,
                    errorMessage: undefined,
                    generationStartTime: undefined,
                };

                if (recoveredAsset.aspectRatio) {
                    updates.aspectRatio = recoveredAsset.aspectRatio;
                    updates.resultAspectRatio = recoveredAsset.aspectRatio.replace(':', '/');
                }

                if (node.type === NodeType.VIDEO) {
                    const previewUrl = String(recoveredAsset.previewUrl || '').trim();
                    if (previewUrl) {
                        updates.lastFrame = previewUrl;
                    } else {
                        try {
                            const lastFrame = await extractVideoLastFrame(recoveredAsset.url);
                            updates.lastFrame = lastFrame;
                        } catch (err) {
                            console.error(`[Recovery] Failed to extract embedded last frame for node ${nodeId}:`, err);
                        }
                    }
                }

                updateNode(nodeId, updates);
                return;
            }

            const response = await fetch(buildCanvasApiUrl(`/generation-status/${nodeId}`));
            if (response.ok) {
                const data = await response.json();
                if (data.status === 'success' && data.resultUrl) {
                    // Race condition check: If node has a generationStartTime, compare with result's createdAt
                    // This prevents applying stale results from previous generations
                    if (node?.generationStartTime && data.createdAt) {
                        const resultCreatedAt = new Date(data.createdAt).getTime();
                        if (resultCreatedAt < node.generationStartTime) {
                            // Stale result, skip silently (don't spam console)
                            return;
                        }
                    }

                    console.log(`[Recovery] Found new result for node ${nodeId}`);

                    // Update node with success status and result URL
                    const updates: Partial<NodeData> = {
                        status: NodeStatus.SUCCESS,
                        resultUrl: data.resultUrl,
                        errorMessage: undefined,
                        generationStartTime: undefined // Clear the timestamp after successful recovery
                    };

                    // If it's a video, extract the last frame for chaining
                    if (data.type === 'video') {
                        try {
                            const lastFrame = await extractVideoLastFrame(data.resultUrl);
                            updates.lastFrame = lastFrame;
                        } catch (err) {
                            console.error(`[Recovery] Failed to extract last frame for node ${nodeId}:`, err);
                        }
                    }

                    updateNode(nodeId, updates);
                }
            }
        } catch (error) {
            console.error(`[Recovery] Error checking status for node ${nodeId}:`, error);
        }
    }, [updateNode, isEmbedded]);

    // Track loading node IDs for stable dependency
    const loadingNodeIds = nodes
        .filter(n => n.status === NodeStatus.LOADING)
        .map(n => n.id)
        .join(',');

    useEffect(() => {
        if (!loadingNodeIds) return;

        const nodeIds = loadingNodeIds.split(',');
        const isPageVisible = () =>
            typeof document === 'undefined' || document.visibilityState === 'visible';

        // Check each loading node every 10 seconds
        const checkAll = async () => {
            if (!isPageVisible()) {
                return;
            }

            let embeddedAssets: XiaolouAssetLibraryItem[] | undefined;

            if (isEmbedded) {
                try {
                    embeddedAssets = await listXiaolouAssets();
                } catch (error) {
                    console.error('[Recovery] Failed to list embedded assets:', error);
                    return;
                }
            }

            await Promise.all(nodeIds.map((nodeId) => checkStatus(nodeId, embeddedAssets)));
        };

        let intervalId: ReturnType<typeof setInterval> | null = null;

        const startPolling = () => {
            if (intervalId || !isPageVisible()) {
                return;
            }
            void checkAll();
            intervalId = setInterval(() => {
                void checkAll();
            }, 10000);
        };

        const stopPolling = () => {
            if (!intervalId) {
                return;
            }
            clearInterval(intervalId);
            intervalId = null;
        };

        const handleVisibilityChange = () => {
            if (isPageVisible()) {
                startPolling();
            } else {
                stopPolling();
            }
        };

        startPolling();

        if (typeof document !== 'undefined') {
            document.addEventListener('visibilitychange', handleVisibilityChange);
        }

        return () => {
            stopPolling();
            if (typeof document !== 'undefined') {
                document.removeEventListener('visibilitychange', handleVisibilityChange);
            }
        };
    }, [loadingNodeIds, checkStatus, isEmbedded]); // Stable string dependency instead of nodes array
};
