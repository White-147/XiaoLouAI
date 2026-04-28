/**
 * NodeContent.tsx
 * 
 * Displays the content area of a canvas node.
 * Handles result display (image/video) and placeholder states.
 */

import React, { useRef, useState, useEffect } from 'react';
import { AlertTriangle, Loader2, Maximize2, ImageIcon as ImageIcon, Film, Pencil, Video, GripVertical, Download, Expand, Shrink, HardDrive } from 'lucide-react';
import { NodeData, NodeStatus, NodeType } from '../../types';
import { classifyCanvasPersistedUrl } from '../../utils/canvasPersistence';

/**
 * Return a URL that is safe to hand to <img src>/<video src>, or undefined
 * when the value is poisoned (`[truncated:...]`, an overly long non-URL, a
 * raw `data:` URL larger than our persistence budget, etc.). `data:` and
 * `blob:` URLs are allowed at render time because they originate from
 * in-memory runtime state (live file previews, fresh toDataURL extracts);
 * they are only forbidden when they reach the persistence layer.
 */
function safeRenderableMediaUrl(value: unknown): string | undefined {
    if (typeof value !== 'string' || !value) return undefined;
    const cls = classifyCanvasPersistedUrl(value);
    if (cls === 'truncated' || cls === 'oversized' || cls === 'garbage') {
        return undefined;
    }
    return value;
}

interface NodeContentProps {
    data: NodeData;
    inputUrl?: string;
    selected: boolean;
    isIdle: boolean;
    isLoading: boolean;
    isSuccess: boolean;
    getAspectRatioStyle: () => { aspectRatio: string };
    onExpand?: (imageUrl: string) => void;
    onDragStart?: (nodeId: string, hasContent: boolean) => void;
    onDragEnd?: () => void;
    // Text node callbacks
    onWriteContent?: (nodeId: string) => void;
    onTextToVideo?: (nodeId: string) => void;
    onTextToImage?: (nodeId: string) => void;
    // Image node callbacks
    onImageToImage?: (nodeId: string) => void;
    onImageToVideo?: (nodeId: string) => void;
    onUpdate?: (nodeId: string, updates: Partial<NodeData>) => void;
    // Social sharing
    onPostToX?: (nodeId: string, mediaUrl: string, mediaType: 'image' | 'video') => void;
}

export const NodeContent: React.FC<NodeContentProps> = ({
    data,
    inputUrl,
    selected,
    isIdle,
    isLoading,
    isSuccess,
    getAspectRatioStyle,
    onExpand,
    onDragStart,
    onDragEnd,
    onWriteContent,
    onTextToVideo,
    onTextToImage,
    onImageToImage,
    onImageToVideo,
    onUpdate,
    onPostToX
}) => {
    // Local state for text node textarea to prevent lag
    const [localPrompt, setLocalPrompt] = useState(data.prompt || '');
    const updateTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastSentPromptRef = useRef<string | undefined>(data.prompt); // Track what we sent

    // Helper: Check if node is image-type (includes local image model)
    const isImageType = data.type === NodeType.IMAGE || data.type === NodeType.LOCAL_IMAGE_MODEL;
    // Helper: Check if node is video-type (includes local video model)
    const isVideoType = data.type === NodeType.VIDEO || data.type === NodeType.LOCAL_VIDEO_MODEL;
    // Helper: Check if node is local model
    const isLocalModel = data.type === NodeType.LOCAL_IMAGE_MODEL || data.type === NodeType.LOCAL_VIDEO_MODEL;
    const resultMediaUrl = safeRenderableMediaUrl(data.resultUrl);
    const resultPosterUrl = safeRenderableMediaUrl(data.lastFrame);

    // Sync local state ONLY when data.prompt changes externally (not from our own update)
    useEffect(() => {
        if (data.prompt !== lastSentPromptRef.current) {
            setLocalPrompt(data.prompt || '');
            lastSentPromptRef.current = data.prompt;
        }
    }, [data.prompt]);

    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (updateTimeoutRef.current) {
                clearTimeout(updateTimeoutRef.current);
            }
        };
    }, []);

    const handleTextChange = (value: string) => {
        setLocalPrompt(value); // Update local state immediately
        lastSentPromptRef.current = value; // Track that we're about to send this

        // Debounce parent update
        if (updateTimeoutRef.current) {
            clearTimeout(updateTimeoutRef.current);
        }
        updateTimeoutRef.current = setTimeout(() => {
            onUpdate?.(data.id, { prompt: value });
        }, 150);
    };

    return (
        <div className={`transition-all duration-200 ${!selected ? 'p-0 rounded-2xl overflow-hidden' : 'p-1'}`}>
            {/* Result View */}
            {(isSuccess || isLoading || data.status === NodeStatus.ERROR) && resultMediaUrl ? (
                <div
                    className={`relative w-full bg-black group/image ${!selected ? '' : 'rounded-xl overflow-hidden'}`}
                    style={getAspectRatioStyle()}
                >
                    {isVideoType ? (
                        <CanvasVideoPreview
                            src={resultMediaUrl!}
                            poster={resultPosterUrl || undefined}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <img src={resultMediaUrl!} alt="生成结果" className="w-full h-full object-cover pointer-events-none" />
                    )}

                    {/* Regenerating Overlay - Shows when loading with existing content */}
                    {isLoading && (
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-20">
                            <Loader2 size={40} className="animate-spin text-blue-400" />
                            <span className="mt-3 text-sm text-white font-medium">正在重新生成…</span>
                        </div>
                    )}
                    {data.status === NodeStatus.ERROR && !isLoading && (
                        <div className="absolute left-3 top-3 z-20 flex max-w-[80%] items-start gap-2 rounded-lg bg-red-950/85 px-2.5 py-2 text-left text-[11px] text-red-100 shadow-lg ring-1 ring-inset ring-red-400/25 backdrop-blur-sm">
                            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-red-300" />
                            <div className="min-w-0">
                                <div className="font-medium text-red-200">本次生成失败，已保留上次成功结果</div>
                                <div className="mt-0.5 line-clamp-2 break-words text-red-100/80">
                                    {data.errorMessage || '可重新生成以重试。'}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            ) : data.type === NodeType.TEXT ? (
                /* Text Node - Menu or Editing Mode */
                <div className={`relative w-full bg-[#1a1a1a] rounded-2xl overflow-hidden ${selected ? 'ring-1 ring-blue-500/30' : ''}`}>
                    {data.textMode === 'editing' ? (
                        /* Editing Mode - Text Area */
                        <div className="p-4">
                            <textarea
                                value={localPrompt}
                                onChange={(e) => handleTextChange(e.target.value)}
                                onPointerDown={(e) => e.stopPropagation()}
                                onWheel={(e) => e.stopPropagation()}
                                onBlur={() => {
                                    // Ensure final value is saved on blur
                                    if (updateTimeoutRef.current) {
                                        clearTimeout(updateTimeoutRef.current);
                                    }
                                    if (localPrompt !== data.prompt) {
                                        onUpdate?.(data.id, { prompt: localPrompt });
                                    }
                                }}
                                placeholder="在此输入文本内容…"
                                className="w-full bg-transparent text-white text-sm resize-none outline-none placeholder:text-neutral-600"
                                style={{ minHeight: data.isPromptExpanded ? '300px' : '150px' }}
                                autoFocus
                            />
                            {/* Expand/Shrink Button */}
                            <div className="flex justify-end mt-2">
                                <button
                                    onClick={() => onUpdate?.(data.id, { isPromptExpanded: !data.isPromptExpanded })}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-neutral-500 hover:text-white hover:bg-neutral-700 rounded transition-colors"
                                    title={data.isPromptExpanded ? '收起编辑区' : '展开编辑区'}
                                >
                                    {data.isPromptExpanded ? <Shrink size={12} /> : <Expand size={12} />}
                                    <span>{data.isPromptExpanded ? '收起' : '展开'}</span>
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* Menu Mode - Show Options */
                        <div className="p-5 flex flex-col gap-4">
                            {/* Header */}
                            <div className="text-neutral-500 text-sm font-medium">
                                你可以：
                            </div>

                            {/* Menu Options */}
                            <div className="flex flex-col gap-1">
                                <TextNodeMenuItem
                                    icon={<Pencil size={16} />}
                                    label="自行撰写内容"
                                    onClick={() => onWriteContent?.(data.id)}
                                />
                                <TextNodeMenuItem
                                    icon={<Video size={16} />}
                                    label="文本生成视频"
                                    onClick={() => onTextToVideo?.(data.id)}
                                />
                                <TextNodeMenuItem
                                    icon={<ImageIcon size={16} />}
                                    label="文本生成图片"
                                    onClick={() => onTextToImage?.(data.id)}
                                />
                            </div>
                        </div>
                    )}
                </div>
            ) : (
                /* Placeholder / Empty State for Image/Video */
                <div className={`relative w-full aspect-[4/3] bg-[#141414] flex flex-col items-center justify-center gap-3 overflow-hidden
            ${isLoading ? 'animate-pulse' : ''} 
            ${!selected ? 'rounded-2xl' : 'rounded-xl border border-dashed border-neutral-800'}`
                }>
                    {/* Input Image Preview for Video Nodes */}
                    {isVideoType && inputUrl && (
                        <div className="absolute inset-0 z-0">
                            <img src={inputUrl} alt="输入帧" className="w-full h-full object-cover opacity-30 blur-sm" />
                            <div className="absolute inset-0 bg-black/40" />
                            <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 rounded text-[10px] text-white font-medium flex items-center gap-1">
                                <ImageIcon size={10} />
                                输入帧
                            </div>
                        </div>
                    )}

                    {isLoading ? (
                        <div className="relative z-10 flex flex-col items-center gap-2">
                            <Loader2 size={32} className="animate-spin text-blue-400" />
                            <span className="text-xs text-neutral-500 font-medium">正在生成…</span>
                        </div>
                    ) : data.status === NodeStatus.ERROR ? (
                        /* Error State - Surface the real backend/provider failure
                           reason so users can act on it (ConnectionError, HTTP
                           codes, provider messages, etc.). Without this branch
                           failed nodes fell back to the empty-placeholder UI and
                           looked visually identical to "idle". */
                        <div
                            className="relative z-10 flex max-w-[260px] flex-col items-center gap-2 px-3 text-center"
                            onPointerDown={(e) => e.stopPropagation()}
                        >
                            <div className="rounded-full bg-red-500/15 p-2 text-red-400">
                                <AlertTriangle size={22} />
                            </div>
                            <div className="text-sm font-medium text-red-300">生成失败</div>
                            <div className="max-h-40 w-full overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-red-500/5 px-2 py-1.5 text-[11px] leading-5 text-red-200 ring-1 ring-inset ring-red-500/20">
                                {data.errorMessage || '任务已失败，但未记录具体原因。请查看浏览器控制台或服务器日志。'}
                            </div>
                            <div className="text-[10px] text-neutral-500">可重新生成以重试。</div>
                        </div>
                    ) : (
                        <div className="relative z-10 flex flex-col items-center justify-center gap-4 px-4 text-neutral-400/70">
                            <div className="relative flex items-center justify-center">
                                {isVideoType ? (
                                    isLocalModel ? <><Film size={44} /><HardDrive size={16} className="absolute -bottom-1 -right-1 text-purple-400" /></> : <Film size={44} />
                                ) : (
                                    isLocalModel ? <><ImageIcon size={44} /><HardDrive size={16} className="absolute -bottom-1 -right-1 text-purple-400" /></> : <ImageIcon size={44} />
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ============================================================================
// HELPER COMPONENTS
// ============================================================================

interface CanvasVideoPreviewProps {
    src: string;
    poster?: string;
    className?: string;
}

const MAX_AUTO_VIDEO_ATTACHES = 1;
let activeAutoVideoAttachCount = 0;
const autoVideoAttachQueue = new Set<() => void>();

function scheduleAutoVideoAttach(start: () => void): () => void {
    let cancelled = false;

    const tryStart = () => {
        if (cancelled) return;

        if (activeAutoVideoAttachCount < MAX_AUTO_VIDEO_ATTACHES) {
            activeAutoVideoAttachCount += 1;
            autoVideoAttachQueue.delete(tryStart);
            start();
            return;
        }

        autoVideoAttachQueue.add(tryStart);
    };

    tryStart();

    return () => {
        cancelled = true;
        autoVideoAttachQueue.delete(tryStart);
    };
}

function releaseAutoVideoAttachSlot() {
    if (activeAutoVideoAttachCount > 0) {
        activeAutoVideoAttachCount -= 1;
    }

    const next = autoVideoAttachQueue.values().next().value as (() => void) | undefined;
    if (next) {
        autoVideoAttachQueue.delete(next);
        window.requestAnimationFrame(() => next());
    }
}

const CanvasVideoPreview: React.FC<CanvasVideoPreviewProps> = ({ src, poster, className }) => {
    const [isVideoReady, setIsVideoReady] = useState(false);
    const [attachedSrc, setAttachedSrc] = useState('');
    const [isVisible, setIsVisible] = useState(false);
    const [userRequestedLoad, setUserRequestedLoad] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const autoAttachSlotRef = useRef(false);

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries[0]?.isIntersecting) {
                    setIsVisible(true);
                    observer.disconnect();
                }
            },
            {
                root: null,
                rootMargin: '200px',
                threshold: 0.1
            }
        );

        observer.observe(element);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (autoAttachSlotRef.current) {
            autoAttachSlotRef.current = false;
            releaseAutoVideoAttachSlot();
        }
        setIsVideoReady(false);
        setAttachedSrc('');
        setUserRequestedLoad(false);
    }, [src]);

    useEffect(() => {
        if (!src || attachedSrc || (!isVisible && !userRequestedLoad)) {
            return;
        }

        let rafHandle = 0;
        let timeoutHandle: number | undefined;
        let idleHandle: number | undefined;
        let cancelQueuedAttach = () => {};

        const attach = () => {
            rafHandle = window.requestAnimationFrame(() => {
                setAttachedSrc(src);
            });
        };

        const startAttach = () => {
            if ('requestIdleCallback' in window && !userRequestedLoad) {
                idleHandle = (window as Window & {
                    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
                }).requestIdleCallback?.(() => attach(), { timeout: 300 });
            } else if (userRequestedLoad) {
                attach();
            } else {
                timeoutHandle = window.setTimeout(attach, 80);
            }
        };

        if (userRequestedLoad) {
            startAttach();
        } else {
            cancelQueuedAttach = scheduleAutoVideoAttach(() => {
                autoAttachSlotRef.current = true;
                startAttach();
            });
        }

        return () => {
            cancelQueuedAttach();
            if (idleHandle && 'cancelIdleCallback' in window) {
                (window as Window & { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback?.(idleHandle);
            }
            if (timeoutHandle) {
                window.clearTimeout(timeoutHandle);
            }
            if (rafHandle) {
                window.cancelAnimationFrame(rafHandle);
            }
            if (autoAttachSlotRef.current) {
                autoAttachSlotRef.current = false;
                releaseAutoVideoAttachSlot();
            }
        };
    }, [attachedSrc, isVisible, src, userRequestedLoad]);

    const markVideoReady = () => {
        setIsVideoReady(true);
        if (autoAttachSlotRef.current) {
            autoAttachSlotRef.current = false;
            releaseAutoVideoAttachSlot();
        }
    };

    return (
        <div
            ref={containerRef}
            className="relative w-full h-full bg-black"
            onPointerDown={() => setUserRequestedLoad(true)}
            onMouseEnter={() => setUserRequestedLoad(true)}
        >
            {poster ? (
                <img
                    src={poster}
                    alt="视频预览"
                    className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 pointer-events-none ${isVideoReady ? 'opacity-0' : 'opacity-100'}`}
                />
            ) : null}
            <video
                key={attachedSrc || src}
                src={attachedSrc || undefined}
                poster={poster}
                controls
                loop
                playsInline
                preload={userRequestedLoad ? 'auto' : 'metadata'}
                className={`${className || ''} transition-opacity duration-200 ${isVideoReady || !poster ? 'opacity-100' : 'opacity-0'}`}
                onLoadedData={markVideoReady}
                onLoadedMetadata={markVideoReady}
                onCanPlay={markVideoReady}
                onError={() => {
                    if (autoAttachSlotRef.current) {
                        autoAttachSlotRef.current = false;
                        releaseAutoVideoAttachSlot();
                    }
                }}
            />
        </div>
    );
};

interface TextNodeMenuItemProps {
    icon: React.ReactNode;
    label: string;
    onClick?: () => void;
}

/**
 * Menu item component for Text node options
 */
const TextNodeMenuItem: React.FC<TextNodeMenuItemProps> = ({ icon, label, onClick }) => (
    <button
        className="flex items-center gap-3 w-full p-2.5 rounded-lg text-left text-neutral-400 hover:bg-[#252525] hover:text-white transition-colors"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={onClick}
    >
        <span className="text-neutral-500">{icon}</span>
        <span className="text-sm font-medium">{label}</span>
    </button>
);
