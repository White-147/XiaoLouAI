/**
 * useGeneration.ts
 * 
 * Custom hook for handling AI content generation (images and videos).
 * Manages generation state, API calls, and error handling.
 */

import { NodeData, NodeType, NodeStatus } from '../types';
import { generateImage, generateVideo } from '../services/generationService';
import { generateLocalImage } from '../services/localModelService';
import { extractVideoLastFrame } from '../utils/videoHelpers';

interface UseGenerationProps {
    nodes: NodeData[];
    updateNode: (id: string, updates: Partial<NodeData>) => void;
}

export const useGeneration = ({ nodes, updateNode }: UseGenerationProps) => {
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

        const appendUniqueImageReference = (target: string[], url?: string) => {
            const normalized = String(url || '').trim();
            if (!normalized || target.includes(normalized) || target.length >= 14) {
                return;
            }

            target.push(normalized);
        };

        // Get prompts from connected TEXT nodes (if any)
        const getTextNodePrompts = (): string[] => {
            if (!node.parentIds) return [];
            return node.parentIds
                .map(pid => nodes.find(n => n.id === pid))
                .filter(n => n?.type === NodeType.TEXT && n.prompt)
                .map(n => n!.prompt);
        };

        // Combine prompts: TEXT node prompts + node's own prompt
        const textNodePrompts = getTextNodePrompts();
        const combinedPrompt = [...textNodePrompts, node.prompt].filter(Boolean).join('\n\n');

        // For Kling frame-to-frame with both start and end frames, prompt is optional
        const isKlingFrameToFrame =
            node.type === NodeType.VIDEO &&
            node.videoModel?.startsWith('kling-') &&
            node.videoMode === 'frame-to-frame' &&
            (node.parentIds && node.parentIds.length >= 2);

        if (!combinedPrompt && !isKlingFrameToFrame) return;

        updateNode(id, { status: NodeStatus.LOADING, generationStartTime: Date.now() });

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
                            if (parent?.resultUrl) {
                                appendUniqueImageReference(imageBase64s, parent.resultUrl);
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

                // Generate image with all parent images and character references
                const rawResultUrl = await generateImage({
                    prompt: combinedPrompt,
                    aspectRatio: node.aspectRatio,
                    resolution: node.resolution,
                    imageBase64: imageBase64s.length > 0 ? imageBase64s : undefined,
                    imageModel: node.imageModel,
                    nodeId: id,
                    // Kling V1.5 reference settings
                    klingReferenceMode: node.klingReferenceMode,
                    klingFaceIntensity: node.klingFaceIntensity,
                    klingSubjectIntensity: node.klingSubjectIntensity
                });

                // Add cache-busting parameter to force browser to fetch new image
                // (Backend uses nodeId as filename, so URL is the same for regenerated images)
                const resultUrl = appendCacheBustParam(rawResultUrl);

                // Detect actual image dimensions (for display purposes only)
                const { resultAspectRatio } = await getImageAspectRatio(resultUrl);

                // Keep user's selected aspectRatio - don't overwrite it with detected ratio
                updateNode(id, {
                    status: NodeStatus.SUCCESS,
                    resultUrl,
                    resultAspectRatio,
                    // Note: aspectRatio is intentionally NOT updated to preserve user's selection
                    errorMessage: undefined
                });


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
                        if (parent?.type !== NodeType.TEXT && parent?.resultUrl) {
                            imageBase64s.push(parent.resultUrl);
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

                    // Detect actual image dimensions
                    const { resultAspectRatio } = await getImageAspectRatio(resultUrl);

                    updateNode(id, {
                        status: NodeStatus.SUCCESS,
                        resultUrl,
                        resultAspectRatio,
                        errorMessage: undefined
                    });
                } else {
                    throw new Error(result.error || '本地生成失败');
                }

            } else if (node.type === NodeType.VIDEO) {
                // Get first parent image for video generation (start frame)
                let imageBase64: string | undefined;
                let lastFrameBase64: string | undefined;

                // Get non-TEXT parent nodes (image sources only)
                const imageParentIds = node.parentIds?.filter(pid => {
                    const parent = nodes.find(n => n.id === pid);
                    return parent?.type !== NodeType.TEXT;
                }) || [];

                const imageOnlyParentIds = imageParentIds.filter(pid => {
                    const p = nodes.find(n => n.id === pid);
                    return p?.type === NodeType.IMAGE;
                });

                // Motion Reference logic (Kling 2.6)
                let motionReferenceUrl: string | undefined;
                let isMotionControl = false;
                if (node.videoModel === 'kling-v2-6') {
                    const videoParent = node.parentIds
                        ?.map(pid => nodes.find(n => n.id === pid))
                        .find(n => n?.type === NodeType.VIDEO && n.resultUrl);

                    if (videoParent) {
                        motionReferenceUrl = videoParent.resultUrl;
                        isMotionControl = true;
                    }
                }

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
                        videoModel: node.videoModel,
                        generateAudio: node.generateAudio,
                        networkSearch: node.networkSearch,
                        nodeId: id,
                    });
                    const ftfRawUrl = ftfResult.resultUrl;
                    const ftfResultUrl = appendCacheBustParam(ftfRawUrl);
                    let ftfLastFrame = ftfResult.previewUrl ? appendCacheBustParam(ftfResult.previewUrl) : undefined;
                    if (!ftfLastFrame) {
                        try { ftfLastFrame = await extractVideoLastFrame(ftfResultUrl); } catch { /* non-fatal */ }
                    }
                    // Phase C fix: if no thumbnail/preview was obtained, fall back to the user's
                    // end-frame input as the poster so the video node always has a preview image.
                    // This prevents the "black screen until load" lag that made FTF feel more choppy.
                    if (!ftfLastFrame && lastFrameBase64) {
                        ftfLastFrame = lastFrameBase64;
                    }
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
                            vid.src = ftfResultUrl;
                        });
                    } catch { /* ignore */ }
                    updateNode(id, {
                        status: NodeStatus.SUCCESS,
                        resultUrl: ftfResultUrl,
                        resultAspectRatio: ftfResultAspectRatio,
                        aspectRatio: ftfAspectRatio,
                        lastFrame: ftfLastFrame,
                        errorMessage: undefined,
                    });

                } else {

                const isFrameToFrame = !isMotionControl && isFrameToFrameMode &&
                    (imageOnlyParentIds.length >= 2 || (node.frameInputs && node.frameInputs.length >= 2));
                const isMultiReference = !isMotionControl && !isFrameToFrame && imageOnlyParentIds.length >= 2;

                let multiReferenceImageUrls: string[] | undefined;

                if (isMultiReference) {
                    multiReferenceImageUrls = imageOnlyParentIds
                        .map(pid => nodes.find(n => n.id === pid))
                        .filter(n => n?.resultUrl)
                        .map(n => n!.resultUrl!);
                } else if (isFrameToFrame && imageParentIds.length >= 2) {
                    const parent1 = nodes.find(n => n.id === imageParentIds[0]);
                    const parent2 = nodes.find(n => n.id === imageParentIds[1]);

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

                        if (parent?.type === NodeType.VIDEO && parent.lastFrame) {
                            imageBase64 = parent.lastFrame;
                        } else if (parent?.resultUrl) {
                            imageBase64 = parent.resultUrl;
                        }
                    }
                }

                // Generate video
                const videoResult = await generateVideo({
                    prompt: combinedPrompt,
                    imageBase64,
                    lastFrameBase64,
                    multiReferenceImageUrls,
                    videoMode: isMultiReference
                        ? 'multi_param'
                        : isFrameToFrame
                            ? 'start_end_frame'
                            : imageBase64
                                ? 'image_to_video'
                                : 'text_to_video',
                    aspectRatio: node.aspectRatio,
                    resolution: node.resolution,
                    duration: node.videoDuration,
                    videoModel: node.videoModel,
                    motionReferenceUrl,
                    generateAudio: node.generateAudio,
                    networkSearch: node.networkSearch,
                    nodeId: id
                });
                const rawResultUrl = videoResult.resultUrl;

                // Add cache-busting parameter to force browser to fetch new video
                // (Backend uses nodeId as filename, so URL is the same for regenerated videos)
                const resultUrl = appendCacheBustParam(rawResultUrl);

                // Extract last frame for chaining (non-fatal)
                let lastFrame = videoResult.previewUrl ? appendCacheBustParam(videoResult.previewUrl) : undefined;
                if (!lastFrame) {
                    try {
                        lastFrame = await extractVideoLastFrame(resultUrl);
                    } catch {
                        console.warn('[useGeneration] Failed to extract last frame, video will still be shown.');
                    }
                }

                // Detect video aspect ratio
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
                        video.src = resultUrl;
                    });
                } catch (e) {
                    // Ignore errors, use undefined aspect ratio
                }

                updateNode(id, {
                    status: NodeStatus.SUCCESS,
                    resultUrl,
                    resultAspectRatio,
                    aspectRatio,
                    lastFrame,
                    errorMessage: undefined // Clear any previous error
                });

                } // end else (non-frame-to-frame video path)

            }
        } catch (error: any) {
            // Handle errors
            const msg = error.toString().toLowerCase();
            let errorMessage = error.message || '生成失败';

            if (msg.includes('unable to process input image') || msg.includes('invalid_argument')) {
                errorMessage = '⚠️ 输入图片格式不兼容。Veo 要求：JPEG 格式，16:9 或 9:16 比例。请尝试其他图片或不带输入图生成。';
            }

            updateNode(id, { status: NodeStatus.ERROR, errorMessage });
            console.error('Generation failed:', error);
        }
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        handleGenerate
    };
};
