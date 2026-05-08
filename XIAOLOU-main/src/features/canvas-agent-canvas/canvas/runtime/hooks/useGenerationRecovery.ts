/**
 * useGenerationRecovery.ts
 *
 * Reconciles canvas nodes persisted in the LOADING state with the actual
 * server-side task status. Two recovery paths:
 *
 *   1. Primary — `node.taskId` set
 *      Calls the host service `recoverGeneration({ kind, taskId })` which
 *      checks the task store + createStudioImages/Videos list and returns
 *      { status: 'succeeded', resultUrl, previewUrl? } | { 'failed' } |
 *      { 'pending' }. Updates the node accordingly.
 *
 *   2. Fallback (legacy data without taskId) — prompt/time heuristic
 *      Calls `findStrayGeneration({ kind, prompt, createdAfter })` on the
 *      host which scans recent create-studio images/videos for a matching
 *      prompt. Used for canvas nodes that were persisted before taskId
 *      tracking landed.
 *
 *   3. Existing asset-library scan
 *      Preserved for callers that rely on manual asset sync to surface
 *      generation results under the project's asset library.
 *
 * In all cases the hook also:
 *   - extracts a lastFrame poster when the video result has no preview URL,
 *     so `CanvasVideoPreview` always has something to show before the video
 *     bytes arrive (poster-first display requirement).
 *   - hard-expires nodes that have been LOADING for longer than
 *     STALE_LOADING_TIMEOUT_MS with neither a taskId nor a findable stray
 *     result, so the UI does not hang forever on truly orphaned state.
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
import {
    canUseXiaolouImageGenerationBridge,
    recoverGenerationWithXiaolou,
    findStrayGenerationWithXiaolou,
} from '../integrations/xiaolouGenerationBridge';

interface UseGenerationRecoveryOptions {
    nodes: NodeData[];
    updateNode: (id: string, updates: Partial<NodeData>) => void;
}

/** 30 min — truly orphaned nodes (no taskId, no recoverable stray) get
 *  flipped to ERROR so the user can retry. Still-in-flight generations
 *  refresh `generationStartTime` via the primary path long before this. */
const STALE_LOADING_TIMEOUT_MS = 30 * 60 * 1000;

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

    /** Apply a successful recovery to the node.
     *
     * Status is flipped to SUCCESS and resultUrl is surfaced IMMEDIATELY so
     * the canvas stops showing "正在生成…" as fast as possible.
     *
     * Previously this function awaited extractVideoLastFrame() before calling
     * updateNode(), which blocked the SUCCESS transition for 10-60 seconds
     * while the browser downloaded enough of the remote Veo video to seek to
     * the last frame. That delay was the direct cause of the visible "time gap"
     * between /create/video (which just reads a URL from the task list) and
     * /create/canvas (which waited for frame extraction before rendering).
     *
     * Fix: apply SUCCESS+resultUrl immediately, then extract the poster in a
     * detached promise and issue a second updateNode once ready.
     */
    const applySuccess = useCallback(
        (
            node: NodeData,
            result: { resultUrl: string; previewUrl?: string; model?: string; taskId?: string },
        ) => {
            // ── Step 1: surface the result right away ────────────────────
            const immediateUpdates: Partial<NodeData> = {
                status: NodeStatus.SUCCESS,
                resultUrl: result.resultUrl,
                errorMessage: undefined,
                generationStartTime: undefined,
            };
            if (result.taskId) immediateUpdates.taskId = result.taskId;

            const preview = node.type === NodeType.VIDEO
                ? String(result.previewUrl || '').trim()
                : '';
            // If the server already returned a thumbnail/poster URL, use it now.
            if (preview) immediateUpdates.lastFrame = preview;

            updateNode(node.id, immediateUpdates);

            // ── Step 2: async poster extraction (does NOT block SUCCESS) ─
            // Only needed when no server-side preview URL was provided.
            if (node.type === NodeType.VIDEO && !preview) {
                extractVideoLastFrame(result.resultUrl).then((frame) => {
                    updateNode(node.id, { lastFrame: frame });
                }).catch((err) => {
                    console.warn(
                        `[Recovery] extractVideoLastFrame failed for node ${node.id}:`,
                        err,
                    );
                });
            }
        },
        [updateNode],
    );

    const checkStatus = useCallback(async (nodeId: string, embeddedAssets?: XiaolouAssetLibraryItem[]) => {
        try {
            const node = nodesRef.current.find(n => n.id === nodeId);
            if (!node || node.status !== NodeStatus.LOADING || node.loadingKind === 'asset-upload') {
                return;
            }

            const kind: 'image' | 'video' | null =
                node.type === NodeType.VIDEO ? 'video'
                : (node.type === NodeType.IMAGE || node.type === NodeType.IMAGE_EDITOR || node.type === NodeType.CAMERA_ANGLE) ? 'image'
                : null;

            // ── Path 1: host-bridged recovery by task id ──────────────────
            if (kind && node.taskId) {
                const result = await recoverGenerationWithXiaolou({ kind, taskId: node.taskId });
                if (result) {
                    if (result.status === 'succeeded') {
                        applySuccess(node, {
                            resultUrl: result.resultUrl,
                            previewUrl: result.previewUrl,
                            model: result.model,
                            taskId: node.taskId,
                        });
                        return;
                    }
                    if (result.status === 'failed') {
                        // Before surfacing the failure, look for a sibling
                        // successful task that matched the same prompt (this
                        // happens when a rapid double-click produced two
                        // provider jobs — one failed, one succeeded — and the
                        // node only persisted the failed task id). Dedup on
                        // the server prevents this going forward, but legacy
                        // nodes can still be rescued.
                        try {
                            const claimedTaskIds = nodesRef.current
                                .map((n) => n.taskId)
                                .filter((t): t is string => typeof t === 'string' && t.length > 0 && t !== node.taskId);
                            const salvage = await findStrayGenerationWithXiaolou({
                                kind,
                                prompt: node.prompt,
                                createdAfter: node.generationStartTime ?? null,
                                excludeTaskIds: claimedTaskIds,
                            });
                            if (salvage) {
                                console.log(
                                    `[Recovery] salvaged successful ${kind} result for node ${nodeId} after task ${node.taskId} failed (new taskId=${salvage.taskId})`,
                                );
                                applySuccess(node, salvage);
                                return;
                            }
                        } catch (salvageErr) {
                            console.warn('[Recovery] salvage lookup failed:', salvageErr);
                        }
                        console.warn(
                            `[Recovery] task ${node.taskId} for node ${nodeId} failed:`,
                            result.error,
                        );
                        updateNode(nodeId, {
                            status: NodeStatus.ERROR,
                            errorMessage: result.error || '生成失败。',
                            generationStartTime: undefined,
                        });
                        return;
                    }
                    // result.status === 'pending' — nothing to do yet.
                    return;
                }
            }

            // ── Path 2: stray-result heuristic (legacy nodes w/o taskId) ──
            if (kind && !node.taskId) {
                const claimedTaskIds = nodesRef.current
                    .map((n) => n.taskId)
                    .filter((t): t is string => typeof t === 'string' && t.length > 0);
                const match = await findStrayGenerationWithXiaolou({
                    kind,
                    prompt: node.prompt,
                    createdAfter: node.generationStartTime ?? null,
                    excludeTaskIds: claimedTaskIds,
                });
                if (match) {
                    console.log(`[Recovery] found stray ${kind} result for node ${nodeId} (taskId=${match.taskId})`);
                    applySuccess(node, match);
                    return;
                }
            }

            // ── Path 3: iframe/embedded — existing asset-library prompt scan ──
            if (isEmbedded) {
                const recoveredAsset = findEmbeddedRecoveryAsset(node, embeddedAssets || []);
                if (!recoveredAsset?.url) {
                    // Path 4: stale-node hard expiry.
                    if (
                        kind &&
                        typeof node.generationStartTime === 'number' &&
                        Date.now() - node.generationStartTime > STALE_LOADING_TIMEOUT_MS
                    ) {
                        updateNode(nodeId, {
                            status: NodeStatus.ERROR,
                            errorMessage: '上次生成未能恢复（可能是页面中断）。请重新生成。',
                            generationStartTime: undefined,
                        });
                    }
                    return;
                }

                applySuccess(node, {
                    resultUrl: recoveredAsset.url,
                    previewUrl: recoveredAsset.previewUrl,
                    model: recoveredAsset.model,
                });
                if (recoveredAsset.aspectRatio) {
                    updateNode(nodeId, {
                        aspectRatio: recoveredAsset.aspectRatio,
                        resultAspectRatio: recoveredAsset.aspectRatio.replace(':', '/'),
                    });
                }
                return;
            }

            // Direct XiaoLou host mode has no legacy /generation-status/<nodeId>
            // endpoint. If we haven't received a task id yet, just wait for the
            // in-flight request to resolve instead of polling the local canvas
            // fallback API with a node id that will always 404.
            if (kind && canUseXiaolouImageGenerationBridge()) {
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

                    applySuccess(node, {
                        resultUrl: data.resultUrl,
                        previewUrl: data.previewUrl,
                        model: data.model,
                    });
                    return;
                }
            }

            // Stale-node hard expiry for direct (non-embedded) path too.
            if (
                kind &&
                typeof node.generationStartTime === 'number' &&
                Date.now() - node.generationStartTime > STALE_LOADING_TIMEOUT_MS
            ) {
                updateNode(nodeId, {
                    status: NodeStatus.ERROR,
                    errorMessage: '上次生成未能恢复（可能是页面中断）。请重新生成。',
                    generationStartTime: undefined,
                });
            }
        } catch (error) {
            console.error(`[Recovery] Error checking status for node ${nodeId}:`, error);
        }
    }, [updateNode, isEmbedded, applySuccess]);

    // Track loading node IDs for stable dependency
    const loadingNodeIds = nodes
        .filter(n => n.status === NodeStatus.LOADING && n.loadingKind !== 'asset-upload')
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
                    // Don't bail — task-based recovery doesn't need the library.
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
