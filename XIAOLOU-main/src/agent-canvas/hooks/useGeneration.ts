/**
 * useGeneration.ts
 * 
 * Custom hook for handling AI content generation (images and videos).
 * Manages generation state, API calls, and error handling.
 */

import { NodeData, NodeType, NodeStatus } from '../types';
import { generateImage, generateVideo } from '../services/generationService';
import { recoverGeneration } from '../services/generationService';
import { generateLocalImage } from '../services/localModelService';
import { extractVideoLastFrame } from '../utils/videoHelpers';
import { parseGenerationError } from '../../lib/generation-error';
import { normalizePromptReferenceTokens, type PromptReferenceInfo } from '../utils/promptReferences';
import {
    DEFAULT_XIAOLOU_IMAGE_TO_VIDEO_MODEL_ID,
    normalizeCanvasVideoModelId,
} from '../config/canvasVideoModels';

interface GenerationAccessConfig {
    canGenerate: boolean;
    deniedMessage?: string;
    insufficientCreditsMessage?: string;
}

interface UseGenerationProps {
    nodes: NodeData[];
    updateNode: (id: string, updates: Partial<NodeData>) => void;
    generationAccess?: GenerationAccessConfig;
}

// Module-scoped synchronous lock tracking generations currently in flight. A
// second click on the same node before the backend accepts the first request
// would otherwise enqueue a duplicate task because the node's `status`
// transition to LOADING is only observable after React commits.
const inflightGenerationNodeIds = new Set<string>();

export const useGeneration = ({ nodes, updateNode, generationAccess }: UseGenerationProps) => {
    // ============================================================================
    // HELPERS
    // ============================================================================

    const appendCacheBustParam = (url: string): string => {
        if (!url || url.startsWith('data:')) {
            return url;
        }

        const hashIndex = url.indexOf('#');
        const baseUrl = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
        const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
        const separator = baseUrl.includes('?') ? '&' : '?';
        return `${baseUrl}${separator}t=${Date.now()}${hash}`;
    };

    /**
     * Convert pixel dimensions to closest standard aspect ratio
     */
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
            { label: '21:9', value: 21 / 9 }
        ];

        let closest = standardRatios[0];
        let minDiff = Math.abs(ratio - closest.value);

        for (const r of standardRatios) {
            const diff = Math.abs(ratio - r.value);
            if (diff < minDiff) {
                minDiff = diff;
                closest = r;
            }
        }

        return closest.label;
    };

    /**
     * Detect the actual aspect ratio of an image
     * @param imageUrl - URL or base64 of the image
     * @returns Promise with resultAspectRatio (exact) and aspectRatio (closest standard)
     */
    const getImageAspectRatio = (imageUrl: string): Promise<{ resultAspectRatio: string; aspectRatio: string }> => {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const resultAspectRatio = `${img.naturalWidth}/${img.naturalHeight}`;
                const aspectRatio = getClosestAspectRatio(img.naturalWidth, img.naturalHeight);
                resolve({ resultAspectRatio, aspectRatio });
            };
            img.onerror = () => {
                resolve({ resultAspectRatio: '16/9', aspectRatio: '16:9' });
            };
            img.src = imageUrl;
        });
    };

    const reconcileAcceptedTask = async (
        node: NodeData,
        taskId: string,
    ): Promise<'succeeded' | 'failed' | 'pending' | 'unavailable'> => {
        const kind =
            node.type === NodeType.VIDEO
                ? 'video'
                : (node.type === NodeType.IMAGE || node.type === NodeType.IMAGE_EDITOR)
                    ? 'image'
                    : null;
        if (!kind) {
            return 'unavailable';
        }

        try {
            const recovered = await recoverGeneration({ kind, taskId } as { kind: 'image' | 'video'; taskId: string });
            if (!recovered) {
                return 'unavailable';
            }

            if (recovered.status === 'succeeded') {
                const recoveredResultUrl = appendCacheBustParam(recovered.resultUrl);
                updateNode(node.id, {
                    status: NodeStatus.SUCCESS,
                    resultUrl: recoveredResultUrl,
                    errorMessage: undefined,
                    taskId,
                });

                if (kind === 'image') {
                    getImageAspectRatio(recoveredResultUrl).then(({ resultAspectRatio }) => {
                        updateNode(node.id, { resultAspectRatio });
                    }).catch(() => { /* non-fatal */ });
                } else if (recovered.previewUrl) {
                    updateNode(node.id, { lastFrame: appendCacheBustParam(recovered.previewUrl) });
                } else {
                    extractVideoLastFrame(recoveredResultUrl).then((frame) => {
                        updateNode(node.id, { lastFrame: frame });
                    }).catch(() => { /* non-fatal */ });
                }

                return 'succeeded';
            }

            if (recovered.status === 'failed') {
                updateNode(node.id, {
                    status: NodeStatus.ERROR,
                    errorMessage: recovered.error || '生成失败',
                    taskId,
                });
                return 'failed';
            }

            updateNode(node.id, {
                status: NodeStatus.LOADING,
                errorMessage: undefined,
                taskId,
            });
            return 'pending';
        } catch {
            return 'unavailable';
        }
    };

    // ============================================================================
    // GENERATION HANDLER
    // ============================================================================

    /**
     * Handles content generation for a node
     * Supports image and video generation with parent node chaining
     * 
     * @param id - ID of the node to generate content for
     */
    const handleGenerate = async (id: string) => {
        const node = nodes.find(n => n.id === id);
        if (!node) return;
        let acceptedTaskId: string | undefined;

        if (generationAccess && !generationAccess.canGenerate) {
            updateNode(id, {
                status: NodeStatus.ERROR,
                errorMessage: generationAccess.deniedMessage || '当前账号暂无创作权限，请稍后重试。',
                taskId: undefined,
            });
            return;
        }

        // Synchronous re-entrancy guard. If another invocation is mid-flight
        // for this node, skip. This complements the NodeControls UI which
        // already unmounts the Generate button while the node is LOADING, but
        // protects against programmatic re-invocations (storyboards,
        // setTimeout stagger, keyboard-triggered fast retries, etc.).
        if (inflightGenerationNodeIds.has(id)) return;
        if (node.status === NodeStatus.LOADING) return;
        inflightGenerationNodeIds.add(id);

        const appendUniqueImageReference = (target: string[], url?: string) => {
            const normalized = String(url || '').trim();
            if (!normalized || target.includes(normalized) || target.length >= 14) {
                return;
            }

            target.push(normalized);
        };

        const resolveImageReferenceFromNode = async (source?: NodeData): Promise<string | undefined> => {
            if (!source || source.type === NodeType.TEXT) {
                return undefined;
            }

            if (source.type === NodeType.VIDEO) {
                if (source.lastFrame) {
                    return source.lastFrame;
                }

                if (!source.resultUrl) {
                    return undefined;
                }

                try {
                    const frame = await extractVideoLastFrame(source.resultUrl);
                    if (frame) {
                        updateNode(source.id, { lastFrame: frame });
                        return frame;
                    }
                } catch {
                    return undefined;
                }

                return undefined;
            }

            return source.resultUrl;
        };

        const getPromptReferences = (): PromptReferenceInfo[] => {
            if (!node.parentIds) return [];
            return node.parentIds
                .map(pid => nodes.find(n => n.id === pid))
                .filter(n => n && (n.type === NodeType.IMAGE || n.type === NodeType.VIDEO) && (n.resultUrl || n.lastFrame))
                .map((n, index) => ({
                    id: n!.id,
                    label: `参考图${index + 1}`,
                }));
        };

        const promptReferences = getPromptReferences();

        // Get prompts from connected TEXT nodes (if any)
        const getTextNodePrompts = (): string[] => {
            if (!node.parentIds) return [];
            return node.parentIds
                .map(pid => nodes.find(n => n.id === pid))
                .filter(n => n?.type === NodeType.TEXT && n.prompt)
                .map(n => normalizePromptReferenceTokens(n!.prompt, []));
        };

        // Combine prompts: TEXT node prompts + node's own prompt
        const textNodePrompts = getTextNodePrompts();
        const ownPrompt = normalizePromptReferenceTokens(node.prompt, promptReferences);
        const combinedPrompt = [...textNodePrompts, ownPrompt].filter(Boolean).join('\n\n');

        // For Kling frame-to-frame with both start and end frames, prompt is optional
        const nodeVideoModelForPromptGate = node.type === NodeType.VIDEO
            ? normalizeCanvasVideoModelId(node.videoModel)
            : undefined;
        const isKlingFrameToFrame =
            node.type === NodeType.VIDEO &&
            nodeVideoModelForPromptGate?.startsWith('kling-') &&
            node.videoMode === 'frame-to-frame' &&
            (node.parentIds && node.parentIds.length >= 2);

        if (!combinedPrompt && !isKlingFrameToFrame) return;

        // Clear any previous error reason up front so a user-visible failure
        // pill doesn't linger while the retry is in flight. The new error (if
        // any) is written in the catch block below.
        updateNode(id, {
            status: NodeStatus.LOADING,
            generationStartTime: Date.now(),
            errorMessage: undefined,
            // Clear the previous task linkage before a fresh attempt starts.
            // If the new request is rejected before the backend accepts it
            // (for example due to insufficient credits), keeping the old taskId
            // makes the node look like that historical task failed.
            taskId: undefined,
        });

        try {
            if (node.type === NodeType.IMAGE || node.type === NodeType.IMAGE_EDITOR) {
                // Collect ALL parent images for multi-input generation
                const imageBase64s: string[] = [];

                // Treat an already uploaded/generated image on the current node as the primary
                // reference for same-node regeneration.
                appendUniqueImageReference(imageBase64s, node.resultUrl);

                // Get images from all direct parents (excluding TEXT nodes)
                if (node.parentIds && node.parentIds.length > 0) {
                    for (const parentId of node.parentIds) {
                        let currentId: string | undefined = parentId;

                        // Traverse up the chain to find an image source (skip TEXT nodes)
                        while (currentId && imageBase64s.length < 14) { // Gemini 3 Pro limit
                            const parent = nodes.find(n => n.id === currentId);
                            // Skip TEXT nodes - they provide prompts, not images
                            if (parent?.type === NodeType.TEXT) {
                                break;
                            }
                            const imageReferenceUrl = await resolveImageReferenceFromNode(parent);
                            if (imageReferenceUrl) {
                                appendUniqueImageReference(imageBase64s, imageReferenceUrl);
                                break; // Found image for this parent chain
                            } else {
                                // Continue up this chain
                                currentId = parent?.parentIds?.[0];
                            }
                        }
                    }
                }

                // Add character reference URLs from storyboard nodes (for maintaining character consistency)
                if (node.characterReferenceUrls && node.characterReferenceUrls.length > 0) {
                    for (const charUrl of node.characterReferenceUrls) {
                        appendUniqueImageReference(imageBase64s, charUrl);
                    }
                }

                // Generate image with all parent images and storyboard character references.
                // onTaskIdAssigned fires as soon as the backend accepts the task
                // (BEFORE polling completes) so we can persist the task id on
                // the node. If the user navigates away / refreshes, the canvas
                // recovery layer uses this id to hydrate the finished result.
                const imageResult = await generateImage({
                    prompt: combinedPrompt,
                    aspectRatio: node.aspectRatio,
                    resolution: node.resolution,
                    imageBase64: imageBase64s.length > 0 ? imageBase64s : undefined,
                    imageModel: node.imageModel,
                    nodeId: id,
                    onTaskIdAssigned: (taskId) => {
                        if (!taskId) return;
                        acceptedTaskId = taskId;
                        updateNode(id, { taskId });
                    },
                });

                // Add cache-busting parameter to force browser to fetch new image
                // (Backend uses nodeId as filename, so URL is the same for regenerated images)
                const resultUrl = appendCacheBustParam(imageResult.resultUrl);

                // ── Step 1: surface SUCCESS immediately ──────────────────────
                // getImageAspectRatio downloads the full image to read pixel dims.
                // For a remote 1-4 MB generated image this can take 1-5 s.
                // Awaiting it here blocks SUCCESS for that entire duration, causing
                // the same "time gap" observed for videos. Apply SUCCESS+resultUrl
                // right away and compute resultAspectRatio in the background.
                updateNode(id, {
                    status: NodeStatus.SUCCESS,
                    resultUrl,
                    // Note: aspectRatio is intentionally NOT updated to preserve user's selection
                    errorMessage: undefined,
                    taskId: imageResult.taskId ?? acceptedTaskId,
                });

                // ── Step 2: async aspect-ratio detection (purely cosmetic) ──
                getImageAspectRatio(resultUrl).then(({ resultAspectRatio }) => {
                    updateNode(id, { resultAspectRatio });
                }).catch(() => { /* non-fatal */ });


            } else if (node.type === NodeType.LOCAL_IMAGE_MODEL) {
                // --- LOCAL MODEL GENERATION ---
                // Check if model is selected
                if (!node.localModelId && !node.localModelPath) {
                    updateNode(id, {
                        status: NodeStatus.ERROR,
                        errorMessage: '未选择本地模型，请先选择一个模型。'
                    });
                    return;
                }

                // Get parent images if any
                const imageBase64s: string[] = [];
                if (node.parentIds && node.parentIds.length > 0) {
                    for (const parentId of node.parentIds) {
                        const parent = nodes.find(n => n.id === parentId);
                        const imageReferenceUrl = await resolveImageReferenceFromNode(parent);
                        if (imageReferenceUrl) {
                            imageBase64s.push(imageReferenceUrl);
                        }
                    }
                }

                // Call local generation API
                const result = await generateLocalImage({
                    modelId: node.localModelId,
                    modelPath: node.localModelPath,
                    prompt: combinedPrompt,
                    aspectRatio: node.aspectRatio,
                    resolution: node.resolution || '512'
                });

                if (result.success && result.resultUrl) {
                    // Add cache-busting parameter
                    const resultUrl = appendCacheBustParam(result.resultUrl);

                    // ── Step 1: surface SUCCESS immediately ──────────────────────
                    updateNode(id, {
                        status: NodeStatus.SUCCESS,
                        resultUrl,
                        errorMessage: undefined
                    });

                    // ── Step 2: async aspect-ratio detection (purely cosmetic) ──
                    getImageAspectRatio(resultUrl).then(({ resultAspectRatio }) => {
                        updateNode(id, { resultAspectRatio });
                    }).catch(() => { /* non-fatal */ });
                } else {
                    throw new Error(result.error || '本地生成失败');
                }

            } else if (node.type === NodeType.VIDEO) {
                const effectiveVideoModel = normalizeCanvasVideoModelId(
                    node.videoModel || DEFAULT_XIAOLOU_IMAGE_TO_VIDEO_MODEL_ID
                );
                if (node.videoModel !== effectiveVideoModel || node.model !== effectiveVideoModel) {
                    updateNode(id, {
                        videoModel: effectiveVideoModel,
                        model: effectiveVideoModel,
                    });
                }

                // Get first parent image for video generation (start frame)
                let imageBase64: string | undefined;
                let lastFrameBase64: string | undefined;

                const parentNodes = node.parentIds
                    ?.map(pid => nodes.find(n => n.id === pid))
                    .filter((parent): parent is NodeData => Boolean(parent)) || [];
                const videoReferenceUrls = parentNodes
                    .filter(parent => parent.type === NodeType.VIDEO && parent.resultUrl)
                    .map(parent => parent.resultUrl!)
                    .filter((url, index, list) => list.indexOf(url) === index);
                const audioReferenceUrls = parentNodes
                    .filter(parent => parent.type === NodeType.AUDIO && parent.resultUrl)
                    .map(parent => parent.resultUrl!)
                    .filter((url, index, list) => list.indexOf(url) === index);

                const imageParentIds = parentNodes
                    .filter(parent => parent.type === NodeType.IMAGE || parent.type === NodeType.VIDEO)
                    .map(parent => parent.id);

                const imageOnlyParentIds = imageParentIds.filter(pid => {
                    const p = nodes.find(n => n.id === pid);
                    return p?.type === NodeType.IMAGE;
                });

                const isMotionControl = node.videoMode === 'motion-control';
                const motionReferenceVideoUrl = node.motionReferenceVideoUrl || videoReferenceUrls[0];

                const isFrameToFrameMode = node.videoMode === 'frame-to-frame';

                // In frame-to-frame mode we MUST have exactly one start and one end frame.
                // Validate early so we never silently fall through to single-image-to-video.
                if (isFrameToFrameMode && !isMotionControl) {
                    // Resolve start frame: prefer frameInputs order, fall back to first imageOnlyParent
                    const startFrameInput = node.frameInputs?.find(f => f.order === 'start');
                    const endFrameInput = node.frameInputs?.find(f => f.order === 'end');

                    if (startFrameInput) {
                        const startNode = nodes.find(n => n.id === startFrameInput.nodeId);
                        if (startNode?.resultUrl) imageBase64 = startNode.resultUrl;
                    }
                    if (endFrameInput) {
                        const endNode = nodes.find(n => n.id === endFrameInput.nodeId);
                        if (endNode?.resultUrl) lastFrameBase64 = endNode.resultUrl;
                    }

                    // Old-data compat: if frameInputs not set, fall back to ordered parentIds
                    if (!startFrameInput && !endFrameInput && imageOnlyParentIds.length >= 2) {
                        const p0 = nodes.find(n => n.id === imageOnlyParentIds[0]);
                        const p1 = nodes.find(n => n.id === imageOnlyParentIds[1]);
                        if (p0?.resultUrl) imageBase64 = p0.resultUrl;
                        if (p1?.resultUrl) lastFrameBase64 = p1.resultUrl;
                    } else if (startFrameInput && !endFrameInput && imageOnlyParentIds.length >= 2) {
                        // start set but end missing — try second imageOnlyParent
                        const fallbackEnd = imageOnlyParentIds.find(pid => pid !== startFrameInput.nodeId);
                        if (fallbackEnd) {
                            const endNode = nodes.find(n => n.id === fallbackEnd);
                            if (endNode?.resultUrl) lastFrameBase64 = endNode.resultUrl;
                        }
                    }

                    // Hard gate: both frames required
                    if (!imageBase64 || !lastFrameBase64) {
                        updateNode(id, {
                            status: NodeStatus.ERROR,
                            errorMessage: '首尾帧生成需要同时设置首帧和尾帧图片，请为两个槽位各选择一张图片。',
                        });
                        return;
                    }

                    // Both frames confirmed — generate video for start_end_frame mode
                    const ftfResult = await generateVideo({
                        prompt: combinedPrompt,
                        imageBase64,
                        lastFrameBase64,
                        videoMode: 'start_end_frame',
                        aspectRatio: node.aspectRatio,
                        resolution: node.resolution,
                        duration: node.videoDuration,
                        videoModel: effectiveVideoModel,
                        generateAudio: node.generateAudio,
                        networkSearch: node.networkSearch,
                        nodeId: id,
                        onTaskIdAssigned: (taskId) => {
                            if (!taskId) return;
                            acceptedTaskId = taskId;
                            updateNode(id, { taskId });
                        },
                    });
                    const ftfRawUrl = ftfResult.resultUrl;
                    const ftfResultUrl = appendCacheBustParam(ftfRawUrl);

                    // Use the server-provided preview URL if available; otherwise use the
                    // user's last-frame input image as an instant poster (avoids black screen
                    // while the large Veo file is being downloaded).
                    const ftfServerPreview = ftfResult.previewUrl ? appendCacheBustParam(ftfResult.previewUrl) : undefined;
                    const ftfInitialLastFrame = ftfServerPreview || (lastFrameBase64 ?? undefined);

                    // ── Step 1: surface SUCCESS immediately ──────────────────────
                    // Do NOT block on extractVideoLastFrame — a 1080p Veo video can take
                    // 10-60 s to download enough data to extract the last frame, which
                    // would keep the node in LOADING that entire time.
                    let ftfResultAspectRatio: string | undefined;
                    let ftfAspectRatio: string | undefined;
                    try {
                        const vid = document.createElement('video');
                        await new Promise<void>(resolve => {
                            vid.onloadedmetadata = () => {
                                ftfResultAspectRatio = `${vid.videoWidth}/${vid.videoHeight}`;
                                ftfAspectRatio = getClosestAspectRatio(vid.videoWidth, vid.videoHeight);
                                resolve();
                            };
                            vid.onerror = () => resolve();
                            // Metadata usually loads from the first few KB — much faster than seeking.
                            vid.preload = 'metadata';
                            vid.src = ftfResultUrl;
                        });
                    } catch { /* ignore */ }
                    updateNode(id, {
                        status: NodeStatus.SUCCESS,
                        resultUrl: ftfResultUrl,
                        resultAspectRatio: ftfResultAspectRatio,
                        aspectRatio: ftfAspectRatio,
                        lastFrame: ftfInitialLastFrame,
                        errorMessage: undefined,
                        taskId: ftfResult.taskId ?? acceptedTaskId,
                    });

                    // ── Step 2: async last-frame extraction (does NOT block SUCCESS) ─
                    if (!ftfServerPreview) {
                        extractVideoLastFrame(ftfResultUrl).then((frame) => {
                            updateNode(id, { lastFrame: frame });
                        }).catch(() => { /* non-fatal — ftfInitialLastFrame stays */ });
                    }

                } else {

                const isFrameToFrame = !isMotionControl && isFrameToFrameMode &&
                    (imageOnlyParentIds.length >= 2 || (node.frameInputs && node.frameInputs.length >= 2));
                let isMultiReference = !isMotionControl && !isFrameToFrame && imageParentIds.length >= 2;

                let multiReferenceImageUrls: string[] | undefined;

                if (isMultiReference) {
                    multiReferenceImageUrls = [];
                    for (const parentId of imageParentIds) {
                        const parent = nodes.find(n => n.id === parentId);
                        const imageReferenceUrl = await resolveImageReferenceFromNode(parent);
                        if (imageReferenceUrl && !multiReferenceImageUrls.includes(imageReferenceUrl)) {
                            multiReferenceImageUrls.push(imageReferenceUrl);
                        }
                    }

                    if (multiReferenceImageUrls.length < 2) {
                        imageBase64 = multiReferenceImageUrls[0];
                        multiReferenceImageUrls = undefined;
                        isMultiReference = false;
                    }
                } else if (isFrameToFrame && imageOnlyParentIds.length >= 2) {
                    const parent1 = nodes.find(n => n.id === imageOnlyParentIds[0]);
                    const parent2 = nodes.find(n => n.id === imageOnlyParentIds[1]);

                    if (node.frameInputs && node.frameInputs.length >= 2) {
                        const startFrameInput = node.frameInputs.find(f => f.order === 'start');
                        const endFrameInput = node.frameInputs.find(f => f.order === 'end');

                        if (startFrameInput) {
                            const startNode = nodes.find(n => n.id === startFrameInput.nodeId);
                            if (startNode?.resultUrl) {
                                imageBase64 = startNode.resultUrl;
                            }
                        }

                        if (endFrameInput) {
                            const endNode = nodes.find(n => n.id === endFrameInput.nodeId);
                            if (endNode?.resultUrl) {
                                lastFrameBase64 = endNode.resultUrl;
                            }
                        }
                    } else {
                        if (parent1?.resultUrl) imageBase64 = parent1.resultUrl;
                        if (parent2?.resultUrl) lastFrameBase64 = parent2.resultUrl;
                    }
                } else if (imageParentIds.length > 0) {
                    if (isMotionControl) {
                        const characterParent = node.parentIds
                            ?.map(pid => nodes.find(n => n.id === pid))
                            .find(n => n?.type === NodeType.IMAGE && n.resultUrl);

                        if (characterParent?.resultUrl) {
                            imageBase64 = characterParent.resultUrl;
                        }
                    } else {
                        const parent = nodes.find(n => n.id === imageParentIds[0]);
                        imageBase64 = await resolveImageReferenceFromNode(parent);
                    }
                }

                const explicitVideoMode =
                    node.videoMode === 'video-edit'
                        ? 'video_edit'
                        : node.videoMode === 'video-extend'
                            ? 'video_extend'
                            : node.videoMode === 'motion-control'
                                ? 'motion_control'
                                : node.videoMode === 'multi-reference'
                                    ? 'multi_param'
                                    : undefined;
                const characterReferenceImageUrl = node.characterReferenceImageUrl || imageBase64;
                const requestedVideoMode = explicitVideoMode ||
                    (isMultiReference
                        ? 'multi_param'
                        : isFrameToFrame
                            ? 'start_end_frame'
                            : imageBase64
                                ? 'image_to_video'
                                : 'text_to_video');

                // Generate video
                const videoResult = await generateVideo({
                    prompt: combinedPrompt,
                    imageBase64,
                    lastFrameBase64,
                    multiReferenceImageUrls,
                    referenceVideoUrls: videoReferenceUrls.length ? videoReferenceUrls : node.referenceVideoUrls,
                    referenceAudioUrls: audioReferenceUrls.length ? audioReferenceUrls : node.referenceAudioUrls,
                    videoMode: requestedVideoMode,
                    aspectRatio: node.aspectRatio,
                    resolution: node.resolution,
                    duration: node.videoDuration,
                    videoModel: effectiveVideoModel,
                    motionReferenceVideoUrl,
                    characterReferenceImageUrl,
                    editMode: node.editMode,
                    editPresetId: node.editPresetId,
                    qualityMode: node.qualityMode,
                    generateAudio: node.generateAudio,
                    networkSearch: node.networkSearch,
                    nodeId: id,
                    onTaskIdAssigned: (taskId) => {
                        if (!taskId) return;
                        acceptedTaskId = taskId;
                        updateNode(id, { taskId });
                    },
                });
                const rawResultUrl = videoResult.resultUrl;

                // Add cache-busting parameter to force browser to fetch new video
                // (Backend uses nodeId as filename, so URL is the same for regenerated videos)
                const resultUrl = appendCacheBustParam(rawResultUrl);

                // Use server-provided preview/thumbnail if available; avoids
                // the black-screen flash before the video can play.
                const serverPreview = videoResult.previewUrl
                    ? appendCacheBustParam(videoResult.previewUrl)
                    : undefined;

                // Detect video aspect ratio from metadata headers — this only
                // needs a few KB of the file and is fast (< 1 s usually).
                let resultAspectRatio: string | undefined;
                let aspectRatio: string | undefined;
                try {
                    const video = document.createElement('video');
                    await new Promise<void>((resolve) => {
                        video.onloadedmetadata = () => {
                            resultAspectRatio = `${video.videoWidth}/${video.videoHeight}`;
                            aspectRatio = getClosestAspectRatio(video.videoWidth, video.videoHeight);
                            resolve();
                        };
                        video.onerror = () => resolve();
                        video.preload = 'metadata';
                        video.src = resultUrl;
                    });
                } catch {
                    // non-fatal
                }

                // ── Step 1: surface SUCCESS immediately ──────────────────────
                // extractVideoLastFrame requires seeking to the end of the video,
                // which forces the browser to download a large chunk of the file
                // (potentially 10-60 s for a 1080p Veo video). Running it BEFORE
                // updateNode keeps the node in LOADING that entire time — a
                // confusing delay that users see as "canvas stuck in generating".
                updateNode(id, {
                    status: NodeStatus.SUCCESS,
                    resultUrl,
                    resultAspectRatio,
                    aspectRatio,
                    lastFrame: serverPreview,
                    errorMessage: undefined,
                    taskId: videoResult.taskId ?? acceptedTaskId,
                });

                // ── Step 2: async last-frame extraction (poster fallback) ──
                if (!serverPreview) {
                    extractVideoLastFrame(resultUrl).then((frame) => {
                        updateNode(id, { lastFrame: frame });
                    }).catch(() => {
                        // non-fatal — video plays without a poster
                    });
                }

                } // end else (non-frame-to-frame video path)

            }
        } catch (error: any) {
            // Handle errors — surface the real backend/provider reason so the
            // user can actually act on it. Prefix with the error code/class
            // (e.g. "ConnectionError", "UNSUPPORTED_VIDEO_DURATION") when the
            // thrower provides one.
            const msg = error?.toString?.().toLowerCase() ?? '';
            const rawMessage: string = (error?.message || '').toString().trim() || '生成失败';
            const errorTypeTag: string = (
                error?.code ||
                error?.name ||
                ''
            ).toString().trim();
            const parsedError = parseGenerationError(error);
            let errorMessage =
                parsedError.category === 'web_balance_insufficient'
                    ? (generationAccess?.insufficientCreditsMessage || '当前账号余额不足，请前往充值页补充额度后重试。')
                    : (parsedError.category !== 'unknown'
                        ? parsedError.message
                        : (errorTypeTag && errorTypeTag !== 'Error'
                            ? `[${errorTypeTag}] ${rawMessage}`
                            : rawMessage));

            if (msg.includes('unable to process input image') || msg.includes('invalid_argument')) {
                errorMessage = `${errorMessage}\n提示：Veo 要求 JPEG 格式、16:9 或 9:16 比例，请尝试其他图片或不带输入图生成。`;
            }

            if (acceptedTaskId) {
                const reconciled = await reconcileAcceptedTask(node, acceptedTaskId);
                if (reconciled === 'succeeded' || reconciled === 'failed') {
                    console.warn('Generation completed via recovery after local error:', {
                        nodeId: id,
                        taskId: acceptedTaskId,
                        reconciled,
                        error,
                    });
                    return;
                }

                if (reconciled === 'pending') {
                    console.warn('Generation recovery is still pending after local error; surfacing original error:', {
                        nodeId: id,
                        taskId: acceptedTaskId,
                        error,
                    });
                }
            }

            updateNode(id, { status: NodeStatus.ERROR, errorMessage });
            console.error('Generation failed:', error);
        } finally {
            inflightGenerationNodeIds.delete(id);
        }
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        handleGenerate
    };
};
