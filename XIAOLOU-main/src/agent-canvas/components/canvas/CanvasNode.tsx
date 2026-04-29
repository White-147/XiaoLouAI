/**
 * CanvasNode.tsx
 * 
 * Main canvas node component.
 * Orchestrates NodeContent, NodeControls, and NodeConnectors sub-components.
 */

import React from 'react';
import { CanvasNodeUploadSource, NodeData, NodeStatus, NodeType } from '../../types';
import { NodeConnectors } from './NodeConnectors';
import { NodeContent } from './NodeContent';
import { NodeControls } from './NodeControls';
import { ImageNodeFloatingToolbar, type ImageNodeToolbarActionId } from './ImageNodeFloatingToolbar';
import { VideoNodeFloatingToolbar } from './VideoNodeFloatingToolbar';
import { VideoSettingsPanel } from './video-settings';
import { ChangeAnglePanel } from './ChangeAnglePanel';
import { areNodeDataEqualExceptPosition, areConnectedCanvasNodeInputsEqual } from './nodeRenderEquality';
import { getNodeWidth, isResizableNode } from '../../utils/nodeGeometry';
import type { ResizeHandle } from '../../hooks/useNodeResizing';

function getNodeTypeLabel(type: NodeType): string {
  switch (type) {
    case NodeType.TEXT: return '文本';
    case NodeType.IMAGE: return '图片';
    case NodeType.VIDEO: return '视频';
    case NodeType.AUDIO: return '音频';
    case NodeType.IMAGE_EDITOR: return '图片编辑';
    case NodeType.VIDEO_EDITOR: return '视频编辑';
    case NodeType.STORYBOARD: return '分镜管理';
    case NodeType.CAMERA_ANGLE: return '多角度';
    case NodeType.LOCAL_IMAGE_MODEL: return '本地图片模型';
    case NodeType.LOCAL_VIDEO_MODEL: return '本地视频模型';
    default: return type;
  }
}

function getNodeDisplayTitle(data: NodeData): string {
  return data.title || getNodeTypeLabel(data.type);
}

interface CanvasNodeProps {
  data: NodeData;
  inputUrl?: string;
  connectedImageNodes?: { id: string; url: string; type?: NodeType }[];
  availableCanvasNodes?: { id: string; url: string; type?: NodeType }[];
  onUpdate: (id: string, updates: Partial<NodeData>) => void;
  onGenerate: (id: string) => void;
  canGenerate?: boolean;
  generateDisabledReason?: string;
  onAttachAssetToVideoNode?: (targetNodeId: string, url: string, type: 'image' | 'video' | 'audio') => void;
  onSetFrameSlot?: (targetNodeId: string, url: string, slot: 'start' | 'end') => void;
  onClearFrameSlot?: (targetNodeId: string, slot: 'start' | 'end') => void;
  onSetCanvasNodeAsFrameSlot?: (targetNodeId: string, canvasNodeId: string, slot: 'start' | 'end') => void;
  onAddNext: (id: string, type: 'left' | 'right') => void;
  selected: boolean;
  showControls?: boolean; // Only show controls when single node is selected (not in group selection)
  onSelect: (id: string) => void;
  onNodePointerDown: (e: React.PointerEvent, id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  onConnectorDown: (e: React.PointerEvent, id: string, side: 'left' | 'right') => void;
  isHoveredForConnection?: boolean;
  creditQuoteProjectId?: string | null;
  onOpenEditor?: (nodeId: string) => void;
  onUpload?: (nodeId: string, imageSource: CanvasNodeUploadSource) => void;
  onAttachReferenceImages?: (nodeId: string, imageSources: CanvasNodeUploadSource[]) => void;
  onPickFromLibrary?: (nodeId: string) => void;
  onSyncToProjectAssets?: (nodeId: string) => void;
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
  onChangeAngleGenerate?: (nodeId: string) => void;
  zoom: number;
  // Mouse event callbacks for chat panel drag functionality
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  // Theme
  canvasTheme?: 'dark' | 'light';
  // Social sharing
  onPostToX?: (nodeId: string, mediaUrl: string, mediaType: 'image' | 'video') => void;
  onPostToTikTok?: (nodeId: string, mediaUrl: string) => void;
  allowSocialShare?: boolean;
  allowChatDrag?: boolean;
  allowCameraAngle?: boolean;
  // Resize handle wiring — the parent owns the resize state so the snap
  // engine / drag hook never fight with it.
  onResizeHandlePointerDown?: (e: React.PointerEvent, nodeId: string, handle: ResizeHandle) => void;
  /** 图片节点主浮层操作（与 ImageNodeToolbarActionId 一一对应，可选） */
  onImageNodeToolbarAction?: (nodeId: string, action: ImageNodeToolbarActionId) => void;
}

const CanvasNodeInner: React.FC<CanvasNodeProps> = ({
  data,
  inputUrl,
  connectedImageNodes,
  availableCanvasNodes,
  onUpdate,
  onGenerate,
  canGenerate = true,
  generateDisabledReason,
  onAttachAssetToVideoNode,
  onSetFrameSlot,
  onClearFrameSlot,
  onSetCanvasNodeAsFrameSlot,
  onAddNext,
  selected,
  showControls = true, // Default to true for backward compatibility
  onSelect,
  onNodePointerDown,
  onContextMenu,
  onConnectorDown,
  isHoveredForConnection,
  creditQuoteProjectId,
  onOpenEditor,
  onUpload,
  onAttachReferenceImages,
  onPickFromLibrary,
  onSyncToProjectAssets,
  onExpand,
  onDragStart,
  onDragEnd,
  onWriteContent,
  onTextToVideo,
  onTextToImage,
  onImageToImage,
  onImageToVideo,
  onChangeAngleGenerate,
  zoom,
  onMouseEnter,
  onMouseLeave,
  canvasTheme = 'dark',
  onPostToX,
  onPostToTikTok,
  allowSocialShare = true,
  allowChatDrag = true,
  allowCameraAngle = true,
  onResizeHandlePointerDown,
  onImageNodeToolbarAction,
}) => {
  // ============================================================================
  // STATE
  // ============================================================================

  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const [editedTitle, setEditedTitle] = React.useState(getNodeDisplayTitle(data));
  const titleInputRef = React.useRef<HTMLInputElement>(null);

  const isIdle = data.status === NodeStatus.IDLE || data.status === NodeStatus.ERROR;
  const isLoading = data.status === NodeStatus.LOADING;
  const isSuccess = data.status === NodeStatus.SUCCESS;
  const nodeDisplayTitle = getNodeDisplayTitle(data);

  // Theme helper
  const isDark = canvasTheme === 'dark';

  // Render floating toolbars at screen-1x across the canvas zoom range.
  // The canvas currently bottoms out at 0.1x, so this still prevents runaway
  // child sizes while keeping selected-node panels readable at minimum zoom.
  const safeZoom = Math.max(zoom, 0.1);
  const localScale = 1 / safeZoom;
  const shouldShowControls = selected && showControls;
  const shouldHideFloatingLabel = selected || shouldShowControls;
  const showHoverOutline = isResizableNode(data) && !selected;
  const floatingTitleSurfaceClassName = isDark
    ? 'border border-[rgba(245,244,239,0.12)] bg-[#171612]/94 text-[#b6b5b0] shadow-[0_10px_30px_rgba(0,0,0,0.24)] backdrop-blur-md'
    : 'border border-[rgba(26,26,25,0.08)] bg-[#f9f8f6]/94 text-[#6f6f6c] shadow-[0_10px_24px_rgba(17,24,39,0.08)] backdrop-blur-md';
  const floatingTitleInputClassName = isDark
    ? 'border border-blue-400/60 bg-[#11100d]/96 text-[#f5f4ef] shadow-[0_12px_30px_rgba(37,99,235,0.18)]'
    : 'border border-blue-300 bg-white/96 text-[#100f09] shadow-[0_12px_30px_rgba(37,99,235,0.12)]';
  /** 图片/视频成功条：仅当选中节点时显示，悬停未选中节点不显示 */
  const mediaToolbarVisibilityClassName = selected
    ? 'opacity-100 pointer-events-auto'
    : 'pointer-events-none opacity-0';

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Focus input when entering edit mode
  React.useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  // Update local state when data.title changes
  React.useEffect(() => {
    setEditedTitle(nodeDisplayTitle);
  }, [nodeDisplayTitle]);

  // Collapse the floating title UI whenever selection UI takes over.
  React.useEffect(() => {
    if (!shouldHideFloatingLabel || !isEditingTitle) return;

    setIsEditingTitle(false);
    setEditedTitle(nodeDisplayTitle);
  }, [isEditingTitle, nodeDisplayTitle, shouldHideFloatingLabel]);

  // Auto-detect aspect ratio for legacy images/videos that don't have resultAspectRatio
  React.useEffect(() => {
    // Only detect if we have a result but no stored aspect ratio
    if (!isSuccess || !data.resultUrl || data.resultAspectRatio) return;

    if (data.type === NodeType.VIDEO) {
      // Detect video dimensions
      const video = document.createElement('video');
      video.onloadedmetadata = () => {
        if (video.videoWidth && video.videoHeight) {
          onUpdate(data.id, { resultAspectRatio: `${video.videoWidth}/${video.videoHeight}` });
        }
      };
      video.src = data.resultUrl;
    } else {
      // Detect image dimensions
      const img = new Image();
      img.onload = () => {
        if (img.naturalWidth && img.naturalHeight) {
          onUpdate(data.id, { resultAspectRatio: `${img.naturalWidth}/${img.naturalHeight}` });
        }
      };
      img.src = data.resultUrl;
    }
  }, [isSuccess, data.resultUrl, data.resultAspectRatio, data.type, data.id, onUpdate]);

  // ============================================================================
  // HELPERS
  // ============================================================================

  const getAspectRatioStyle = () => {
    // When there's a successful result, ALWAYS use the result's aspect ratio (lock the node size)
    // This prevents the node from resizing when user selects a different ratio for regeneration
    if (isSuccess && data.resultUrl) {
      // Use stored result aspect ratio if available
      if (data.resultAspectRatio) {
        return { aspectRatio: data.resultAspectRatio };
      }
      // If no stored ratio, use default (shouldn't happen for new content, but handles legacy)
      if (data.type === NodeType.VIDEO) {
        return { aspectRatio: '16/9' };
      }
      // Keep current shape for images without stored ratio (legacy)
      return { aspectRatio: '1/1' };
    }

    // Video nodes without result - use default 16:9
    if (data.type === NodeType.VIDEO) {
      return { aspectRatio: '16/9' };
    }

    // Image nodes without result - use the selected aspect ratio for preview
    const ratio = data.aspectRatio || 'Auto';
    // Auto defaults to 16:9 for video-ready format
    if (ratio === 'Auto') return { aspectRatio: '16/9' };

    const [w, h] = ratio.split(':');
    return { aspectRatio: `${w}/${h}` };
  };

  const handleTitleSave = () => {
    setIsEditingTitle(false);
    const trimmed = editedTitle.trim();
    const typeLabel = getNodeTypeLabel(data.type);
    if (trimmed && trimmed !== typeLabel && trimmed !== data.type) {
      onUpdate(data.id, { title: trimmed });
    } else if (!trimmed) {
      setEditedTitle(getNodeDisplayTitle(data));
    }
  };

  const handleNodePointerDown = (e: React.PointerEvent) => {
    // Clear any browser text selection before node selection/dragging kicks in.
    window.getSelection?.()?.removeAllRanges();
    onNodePointerDown(e, data.id);
  };

  // ============================================================================
  // RENDER
  // ============================================================================

  // Special rendering for Image Editor node
  if (data.type === NodeType.IMAGE_EDITOR) {
    return (
      <div
        className={`absolute flex items-center group/node touch-none pointer-events-auto`}
        style={{
          transform: `translate(${data.x}px, ${data.y}px)`,
          transition: 'box-shadow 0.2s',
          zIndex: selected ? 50 : 10
        }}
        onPointerDown={handleNodePointerDown}
        onContextMenu={(e) => onContextMenu(e, data.id)}
      >
        <NodeConnectors nodeId={data.id} onConnectorDown={onConnectorDown} canvasTheme={canvasTheme} />

        {/* Image Editor Node Card */}
        <div
          className={`relative rounded-2xl transition-all duration-200 flex flex-col ${inputUrl ? '' : isDark ? 'bg-[#1d1b16] border border-[rgba(245,244,239,0.12)] shadow-2xl' : 'bg-[#f9f8f6] border border-[rgba(26,26,25,0.12)] shadow-lg'} ${selected ? 'ring-1 ring-blue-500/30' : ''}`}
          style={{
            width: inputUrl ? 'auto' : '340px',
            maxWidth: inputUrl ? '500px' : 'none'
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (onOpenEditor) {
              onOpenEditor(data.id);
            }
          }}
        >
          {/* Header */}
          {!shouldHideFloatingLabel && (
            <div className="absolute -top-8 left-0 select-none text-sm px-2 py-0.5 rounded font-medium text-neutral-600">
            图片编辑
            </div>
          )}

          {/* Content Area */}
          <div
            className={`flex flex-col items-center justify-center ${inputUrl || data.resultUrl ? 'p-0' : 'p-6'}`}
            style={{ minHeight: inputUrl || data.resultUrl ? 'auto' : '380px' }}
          >
            {inputUrl || data.resultUrl ? (
              <img
                src={data.resultUrl || inputUrl}
                alt="内容"
                className={`rounded-xl w-full h-full object-cover ${selected ? 'ring-2 ring-blue-500 shadow-2xl' : ''}`}
                style={{ maxHeight: '500px' }}
                draggable={false}
              />
            ) : (
              <div className="text-neutral-500 text-center text-sm">
                Double click to open editor
              </div>
            )}
          </div>


        </div>
      </div>
    );
  }

  // Special rendering for Camera Angle node (result view)
  if (data.type === NodeType.CAMERA_ANGLE) {
    return (
      <div
        className={`absolute flex items-center group/node touch-none pointer-events-auto`}
        style={{
          transform: `translate(${data.x}px, ${data.y}px)`,
          transition: 'box-shadow 0.2s',
          zIndex: selected ? 50 : 10
        }}
        onPointerDown={handleNodePointerDown}
        onContextMenu={(e) => onContextMenu(e, data.id)}
      >
        <NodeConnectors nodeId={data.id} onConnectorDown={onConnectorDown} canvasTheme={canvasTheme} />

        {/* Relative wrapper for the Card */}
        <div className="relative group/nodecard">
          {/* Unified Toolbar - Appears above the card on hover */}
          {data.resultUrl && (
            <div
              className="absolute -top-20 left-0 right-0 flex justify-center opacity-0 group-hover/nodecard:opacity-100 transition-opacity z-20"
              style={{
                transform: `scale(${localScale})`,
                transformOrigin: 'bottom center'
              }}
            >
              <div className="flex items-center gap-1 px-2 py-1.5 bg-[#171612]/95 rounded-full border border-[rgba(245,244,239,0.12)] shadow-xl backdrop-blur-md">
                {/* Multi-angle button - Re-enable tweaking */}
                {allowCameraAngle && (
                  <>
                    <button
                      onClick={() => onUpdate(data.id, {
                        angleMode: !data.angleMode,
                        angleSettings: data.angleSettings || { mode: 'camera', rotation: 0, tilt: 0, scale: 0, wideAngle: false }
                      })}
                      onPointerDown={(e) => e.stopPropagation()}
                      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${data.angleMode
                        ? 'bg-blue-500 text-white'
                        : 'text-neutral-300 hover:bg-neutral-700 hover:text-white'
                        }`}
                    >
                      <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                        <line x1="12" y1="22.08" x2="12" y2="12" />
                      </svg>
                      多角度
                    </button>
                    <div className="w-px h-4 bg-neutral-600 mx-1" />
                  </>
                )}

                {/* Expand Button */}
                <button
                  onClick={() => onExpand?.(data.resultUrl!)}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="p-1.5 text-neutral-300 hover:bg-neutral-700 hover:text-white rounded-full transition-colors"
                  title="查看原图"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="15 3 21 3 21 9" />
                    <polyline points="9 21 3 21 3 15" />
                    <line x1="21" y1="3" x2="14" y2="10" />
                    <line x1="3" y1="21" x2="10" y2="14" />
                  </svg>
                </button>
                {/* Post to X Button */}
                {allowSocialShare && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onPostToX?.(data.id, data.resultUrl!, 'image'); }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="p-1.5 text-neutral-300 hover:bg-neutral-700 hover:text-white rounded-full transition-colors"
                    title="发布到 X"
                  >
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="currentColor">
                      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                    </svg>
                  </button>
                )}
                {/* Download Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (data.resultUrl) {
                      const filename = `image_${data.id}.png`;
                      const cleanUrl = data.resultUrl.split('?')[0];
                      if (data.resultUrl.startsWith('data:')) {
                        const link = document.createElement('a');
                        link.href = data.resultUrl;
                        link.download = filename;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      } else {
                        fetch(cleanUrl, { cache: 'no-store' })
                          .then(res => res.blob())
                          .then(blob => {
                            const url = window.URL.createObjectURL(blob);
                            const link = document.createElement('a');
                            link.href = url;
                            link.download = filename;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            window.URL.revokeObjectURL(url);
                          })
                          .catch(() => {
                            const link = document.createElement('a');
                            link.href = cleanUrl;
                            link.download = filename;
                            link.target = '_blank';
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                          });
                      }
                    }
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="p-1.5 text-neutral-300 hover:bg-neutral-700 hover:text-white rounded-full transition-colors"
                  title="下载"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
                {/* Drag to Chat Handle */}
                {allowChatDrag && (
                  <div
                    draggable
                    onPointerDown={(e) => e.stopPropagation()}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/json', JSON.stringify({
                        nodeId: data.id,
                        url: data.resultUrl,
                        type: 'image'
                      }));
                      e.dataTransfer.effectAllowed = 'copy';
                      onDragStart?.(data.id, true);
                    }}
                    onDragEnd={() => onDragEnd?.()}
                    className="p-1.5 bg-cyan-500/80 hover:bg-cyan-400 rounded-full text-white cursor-grab active:cursor-grabbing"
                    title="拖拽到对话"
                  >
                    <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="9" cy="5" r="1" fill="currentColor" />
                      <circle cx="9" cy="12" r="1" fill="currentColor" />
                      <circle cx="9" cy="19" r="1" fill="currentColor" />
                      <circle cx="15" cy="5" r="1" fill="currentColor" />
                      <circle cx="15" cy="12" r="1" fill="currentColor" />
                      <circle cx="15" cy="19" r="1" fill="currentColor" />
                    </svg>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Node Card */}
          <div
            className={`relative rounded-2xl transition-all duration-200 flex flex-col ${isDark ? 'bg-[#1d1b16] border border-[rgba(245,244,239,0.12)] shadow-2xl' : 'bg-[#f9f8f6] border border-[rgba(26,26,25,0.12)] shadow-lg'} ${selected ? 'ring-1 ring-blue-500/30' : ''}`}
            style={{
              width: '340px',
            }}
          >
            {/* Header */}
            {!shouldHideFloatingLabel && (
              <div className="absolute -top-8 left-0 select-none text-sm px-2 py-0.5 rounded font-medium text-blue-400">
              多角度
            </div>

            )}

            {/* Content Area */}
            <div
              className={`flex flex-col items-center justify-center ${data.resultUrl ? 'p-0' : 'p-6'}`}
              style={{ minHeight: data.resultUrl ? 'auto' : '340px' }}
            >
              {data.resultUrl ? (
                <img
                  src={data.resultUrl}
                  alt="内容"
                  className={`rounded-xl w-full h-auto object-cover ${selected ? 'ring-2 ring-blue-500 shadow-2xl' : ''}`}
                  draggable={false}
                />
              ) : data.status === NodeStatus.ERROR ? (
                // Match the IMAGE/VIDEO node error overlay so a long
                // `[CODE] reason\n详情：…` block renders nicely here too —
                // title + scrollable red-bg reason + retry hint.
                <div
                  className="flex min-h-[340px] max-w-[300px] flex-col items-center justify-center gap-2 px-4 text-center"
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <div className="rounded-full bg-red-500/15 p-2 text-red-400">
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="12" />
                      <line x1="12" y1="16" x2="12.01" y2="16" />
                    </svg>
                  </div>
                  <div className="text-sm font-medium text-red-300">多角度生成失败</div>
                  <div className="max-h-40 w-full overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-red-500/5 px-2 py-1.5 text-[11px] leading-5 text-red-200 ring-1 ring-inset ring-red-500/20">
                    {data.errorMessage || '当前多角度任务未能生成新的视角结果。'}
                  </div>
                  <div className="text-[10px] text-neutral-500">可重新生成以重试。</div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 text-neutral-500">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
                  <span className="text-sm">正在生成多角度结果...</span>
                </div>
              )}
            </div>
          </div>

          {/* Control Panel (Only for re-adjusting angle if needed) */}
          {allowCameraAngle && shouldShowControls && data.angleMode && data.resultUrl && (
            <div className="absolute top-[calc(100%+12px)] left-1/2 -translate-x-1/2 flex justify-center z-[100]">
              <div
                data-node-panel="angle"
                data-node-owner-id={data.id}
                style={{
                  transform: `scale(${localScale})`,
                  transformOrigin: 'top center',
                  transition: 'transform 0.1s ease-out'
                }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <ChangeAnglePanel
                  imageUrl={data.resultUrl}
                  settings={data.angleSettings || { mode: 'camera', rotation: 0, tilt: 0, scale: 0, wideAngle: false }}
                  onSettingsChange={(settings) => onUpdate(data.id, { angleSettings: settings })}
                  onClose={() => onUpdate(data.id, { angleMode: false })}
                  onGenerate={onChangeAngleGenerate ? () => onChangeAngleGenerate(data.id) : () => { }}
                  isLoading={isLoading}
                  canvasTheme={canvasTheme}
                  errorMessage={data.errorMessage}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Special rendering for Video Editor node
  if (data.type === NodeType.VIDEO_EDITOR) {
    // Get video URL from parent node or own resultUrl
    const videoUrl = inputUrl || data.resultUrl;

    return (
      <div
        className={`absolute flex items-center group/node touch-none pointer-events-auto`}
        style={{
          transform: `translate(${data.x}px, ${data.y}px)`,
          transition: 'box-shadow 0.2s',
          zIndex: selected ? 50 : 10
        }}
        onPointerDown={handleNodePointerDown}
        onContextMenu={(e) => onContextMenu(e, data.id)}
      >
        <NodeConnectors nodeId={data.id} onConnectorDown={onConnectorDown} canvasTheme={canvasTheme} />

        {/* Video Editor Node Card */}
        <div
          className={`relative rounded-2xl transition-all duration-200 flex flex-col ${videoUrl ? '' : isDark ? 'bg-[#1d1b16] border border-[rgba(245,244,239,0.12)] shadow-2xl' : 'bg-[#f9f8f6] border border-[rgba(26,26,25,0.12)] shadow-lg'} ${selected ? 'ring-1 ring-purple-500/30' : ''}`}
          style={{
            width: videoUrl ? 'auto' : '340px',
            maxWidth: videoUrl ? '500px' : 'none'
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (onOpenEditor) {
              onOpenEditor(data.id);
            }
          }}
        >
          {/* Header */}
          {!shouldHideFloatingLabel && (
            <div className="absolute -top-8 left-0 select-none text-sm px-2 py-0.5 rounded font-medium text-purple-400">
            视频编辑
          </div>

          )}

          {/* Content Area */}
          <div
            className={`flex flex-col items-center justify-center ${videoUrl ? 'p-0' : 'p-6'}`}
            style={{ minHeight: videoUrl ? 'auto' : '380px' }}
          >
            {videoUrl ? (
              <video
                src={videoUrl}
                className={`rounded-xl w-full h-auto object-cover ${selected ? 'ring-2 ring-purple-500 shadow-2xl' : ''}`}
                style={{ maxHeight: '500px', aspectRatio: '16/9' }}
                muted
                playsInline
                onMouseEnter={(e) => (e.currentTarget as HTMLVideoElement).play()}
                onMouseLeave={(e) => {
                  const video = e.currentTarget as HTMLVideoElement;
                  video.pause();
                  video.currentTime = 0;
                }}
              />
            ) : (
              <div className="text-neutral-500 text-center text-sm">
                <p>Connect a Video node</p>
                <p className="text-xs mt-1 text-neutral-600">Double click to open editor</p>
              </div>
            )}
          </div>

          {/* Trim indicator (if trimmed) */}
          {data.trimStart !== undefined && data.trimEnd !== undefined && (
            <div className="absolute bottom-2 left-2 right-2 bg-black/70 rounded-lg px-2 py-1 text-xs text-purple-300 flex justify-between">
              <span>Trimmed: {data.trimStart.toFixed(1)}s - {data.trimEnd.toFixed(1)}s</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      data-node-id={data.id}
      data-node-owner-id={data.id}
      data-canvas-node
      className={`absolute group/node touch-none pointer-events-auto`}
      style={{
        transform: `translate(${data.x}px, ${data.y}px)`,
        transition: 'box-shadow 0.2s',
        zIndex: selected ? 50 : 10,
        transformOrigin: 'top left',
        willChange: 'transform',
      }}
      onPointerDown={handleNodePointerDown}
      onContextMenu={(e) => onContextMenu(e, data.id)}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <NodeConnectors nodeId={data.id} onConnectorDown={onConnectorDown} canvasTheme={canvasTheme} />

      {/* Relative wrapper for the Image Card to allow absolute positioning of controls below it */}
      <div className="relative group/nodecard">
        {showHoverOutline && (
          <div className="pointer-events-none absolute -inset-[2px] z-10 rounded-[18px] border border-transparent transition-colors duration-150 group-hover/node:border-blue-400/70 group-hover/node:shadow-[0_0_0_1px_rgba(96,165,250,0.18)]" />
        )}

        {/* 图片结果节点主浮层（与参考条一致；同步 / 拖对话在「更多」内） */}
        {data.type === NodeType.IMAGE && isSuccess && data.resultUrl && (
          <div
            data-node-toolbar="media"
            data-node-owner-id={data.id}
            className={`pointer-events-auto absolute -top-24 left-1/2 z-[140] w-[min(100vw-1.5rem,56rem)] max-w-[calc(100vw-0.5rem)] min-w-0 -translate-x-1/2 transition-opacity ${mediaToolbarVisibilityClassName}`}
          >
            <ImageNodeFloatingToolbar
              nodeId={data.id}
              isDark={isDark}
              resultUrl={data.resultUrl}
              localScale={localScale}
              isStoryboardExtract={!!(data.prompt && data.prompt.startsWith('Extract panel #'))}
              allowCameraAngle={allowCameraAngle}
              angleMode={!!data.angleMode}
              onUpdateAngleMode={(open) => {
                onUpdate(data.id, {
                  angleMode: open,
                  angleSettings: data.angleSettings || {
                    mode: 'camera',
                    rotation: 0,
                    tilt: 0,
                    scale: 0,
                    wideAngle: false,
                  },
                });
              }}
              onExpand={onExpand}
              onOpenEditor={onOpenEditor}
              onSyncToProjectAssets={onSyncToProjectAssets}
              onToolbarAction={onImageNodeToolbarAction}
            />
          </div>
        )}

        {/* 视频结果：节点右侧竖向浮层（图一仅图标；悬停浮层为图二：文案 + 行高亮） */}
        {data.type === NodeType.VIDEO && isSuccess && data.resultUrl && (
          <div
            data-node-toolbar="media"
            data-node-owner-id={data.id}
            className={`pointer-events-auto absolute top-1/2 z-[140] transition-opacity ${mediaToolbarVisibilityClassName}`}
            style={{
              left: '100%',
              marginLeft: '8px',
              transform: `translateY(-50%) scale(${localScale})`,
              transformOrigin: 'left center',
            }}
          >
            <VideoNodeFloatingToolbar
              nodeId={data.id}
              isDark={isDark}
              resultUrl={data.resultUrl}
              onToolbarAction={onImageNodeToolbarAction}
            />
          </div>
        )}

        {/* Main Node Card — width is user-resizable via the corner handles
            for IMAGE/VIDEO/LOCAL_* nodes, and falls back to the legacy
            per-type default for anything else. Height follows from the
            aspect-ratio-driven content area, so the card grows/shrinks
            proportionally without any skew. */}
        <div
          className={`relative rounded-2xl border transition-shadow duration-300 flex flex-col shadow-2xl ${isDark ? 'bg-[#1d1b16]' : 'bg-[#f9f8f6]'} ${selected && isResizableNode(data) ? 'border-transparent' : selected ? 'border-blue-500/50 ring-1 ring-blue-500/30' : isDark ? 'border-[rgba(245,244,239,0.12)] group-hover/node:border-[rgba(96,165,250,0.45)] group-hover/node:shadow-[0_22px_48px_rgba(0,0,0,0.34)]' : 'border-[rgba(26,26,25,0.12)] group-hover/node:border-[rgba(59,130,246,0.45)] group-hover/node:shadow-[0_18px_36px_rgba(15,23,42,0.12)]'}`}
          style={{ width: `${getNodeWidth(data)}px` }}
        >
          {/* Selection chrome for resizable media nodes: outline + corner
              handles + type label + pixel-dimension readout. Rendered only
              while the node is selected and idle (not during an in-flight
              generation, where the card may still be re-laying out). All
              overlays sit outside the card's radius so the blue frame
              frames the image, matching Lovart's look. */}
          {selected && isResizableNode(data) && !isLoading && onResizeHandlePointerDown && (() => {
            // Parse `resultAspectRatio` back into natural pixel dimensions.
            // Stored as `"W/H"` by the onload-aspect-detection effect above
            // and by the various services that write generation results.
            // Show the badge only when both sides look like real pixel
            // counts (>10) so we never print `NaN × NaN` or a ratio like
            // `4 × 3` from a legacy record.
            let pixelW = 0;
            let pixelH = 0;
            if (data.resultAspectRatio) {
              const [ws, hs] = data.resultAspectRatio.split('/');
              const w = parseInt(ws, 10);
              const h = parseInt(hs, 10);
              if (Number.isFinite(w) && Number.isFinite(h) && w > 10 && h > 10) {
                pixelW = w;
                pixelH = h;
              }
            }
            const showDimBadge = isSuccess && pixelW > 0 && pixelH > 0;

            const typeLabel = getNodeTypeLabel(data.type);

            return (
              <>
                {/* Outer selection frame — 3px outside the card, solid blue,
                    drawn with non-scaling border so it stays crisp. */}
                <div
                  className="absolute pointer-events-none rounded-[14px]"
                  style={{
                    top: -3,
                    left: -3,
                    right: -3,
                    bottom: -3,
                    border: `${Math.max(1, 1.5 * localScale)}px solid #3b82f6`,
                    zIndex: 29,
                  }}
                />

                {/* Top-left type label (e.g. "Image" / "视频") in blue text,
                    positioned just above the frame like Lovart. */}
                <div
                  className="absolute select-none text-blue-500 font-medium whitespace-nowrap pointer-events-none"
                  style={{
                    left: -3,
                    top: -3,
                    transform: `translateY(-100%) scale(${localScale})`,
                    transformOrigin: 'bottom left',
                    fontSize: 12,
                    lineHeight: '16px',
                    paddingBottom: 2,
                  }}
                >
                  {typeLabel}
                </div>

                {/* Top-right actual pixel dimensions in blue text. */}
                {showDimBadge && (
                  <div
                    className="absolute select-none text-blue-500 font-medium whitespace-nowrap pointer-events-none tabular-nums"
                    style={{
                      right: -3,
                      top: -3,
                      transform: `translateY(-100%) scale(${localScale})`,
                      transformOrigin: 'bottom right',
                      fontSize: 12,
                      lineHeight: '16px',
                      paddingBottom: 2,
                    }}
                  >
                    {pixelW} × {pixelH}
                  </div>
                )}

                {/* Four corner resize handles, anchored to the frame corners
                    so they visually pin to the blue outline. */}
                {(['tl', 'tr', 'bl', 'br'] as ResizeHandle[]).map((handle) => {
                  const isTop = handle === 'tl' || handle === 'tr';
                  const isLeft = handle === 'tl' || handle === 'bl';
                  const cursor = handle === 'tl' || handle === 'br' ? 'nwse-resize' : 'nesw-resize';
                  return (
                    <div
                      key={handle}
                      data-canvas-resize-handle={handle}
                      onPointerDown={(e) => onResizeHandlePointerDown(e, data.id, handle)}
                      className="absolute z-30 pointer-events-auto"
                      style={{
                        top: isTop ? -3 : 'auto',
                        bottom: isTop ? 'auto' : -3,
                        left: isLeft ? -3 : 'auto',
                        right: isLeft ? 'auto' : -3,
                        width: 10 * localScale,
                        height: 10 * localScale,
                        transform: `translate(${isLeft ? -50 : 50}%, ${isTop ? -50 : 50}%)`,
                        cursor,
                      }}
                    >
                      <div
                        className="w-full h-full bg-white border border-blue-500"
                        style={{ pointerEvents: 'none' }}
                      />
                    </div>
                  );
                })}
              </>
            );
          })()}
          {/* Header (Editable Title) - Positioned horizontally on top-left side */}
          {!shouldHideFloatingLabel && (
            isEditingTitle ? (
            <input
              ref={titleInputRef}
              type="text"
              value={editedTitle}
              onChange={(e) => setEditedTitle(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleTitleSave();
                } else if (e.key === 'Escape') {
                  setEditedTitle(nodeDisplayTitle);
                  setIsEditingTitle(false);
                }
              }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              className={`absolute select-text whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium outline-none ${floatingTitleInputClassName}`}
              style={{
                left: 0,
                top: -6,
                minWidth: '72px',
                transform: `translateY(-100%) scale(${localScale})`,
                transformOrigin: 'bottom left',
              }}
            />
          ) : (
            <div
              className={`absolute select-none whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition-colors cursor-text ${floatingTitleSurfaceClassName}`}
              style={{
                left: 0,
                top: -6,
                transform: `translateY(-100%) scale(${localScale})`,
                transformOrigin: 'bottom left',
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setIsEditingTitle(true);
              }}
              title="双击编辑标题"
            >
              {nodeDisplayTitle}
            </div>
            )
          )}

          {/* Content Area */}
          <NodeContent
            data={data}
            inputUrl={inputUrl}
            selected={selected}
            isIdle={isIdle}
            isLoading={isLoading}
            isSuccess={isSuccess}
            getAspectRatioStyle={getAspectRatioStyle}
            onExpand={onExpand}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onWriteContent={onWriteContent}
            onTextToVideo={onTextToVideo}
            onTextToImage={onTextToImage}
            onImageToImage={onImageToImage}
            onImageToVideo={onImageToVideo}
            onUpdate={onUpdate}
            onPostToX={onPostToX}
          />
        </div>

        {/* Control Panel - Only show when single node is selected (not in group selection) */}
        {/* Hide controls for storyboard-generated scenes */}
        {shouldShowControls && data.type !== NodeType.TEXT && !(data.prompt && data.prompt.startsWith('Extract panel #')) && (
          (data.type === NodeType.VIDEO || data.type === NodeType.LOCAL_VIDEO_MODEL) ? (
            <div
              className="absolute top-[calc(100%+12px)] left-1/2 -translate-x-1/2 flex justify-center z-[100]"
              style={{ width: 'min(580px, calc(100vw - 176px))' }}
            >
              <VideoSettingsPanel
                data={data}
                inputUrl={inputUrl}
                isLoading={isLoading}
                isSuccess={isSuccess}
                connectedImageNodes={connectedImageNodes}
                availableCanvasNodes={availableCanvasNodes}
                onUpdate={onUpdate}
                onGenerate={onGenerate}
                canGenerate={canGenerate}
                generateDisabledReason={generateDisabledReason}
                onAttachAsset={onAttachAssetToVideoNode}
                onSetFrameSlot={onSetFrameSlot}
                onClearFrameSlot={onClearFrameSlot}
                onSetCanvasNodeAsFrameSlot={onSetCanvasNodeAsFrameSlot}
                onSelect={onSelect}
                zoom={zoom}
                canvasTheme={canvasTheme}
              />
            </div>
          ) : (
            <div
              className="absolute top-[calc(100%+12px)] left-1/2 -translate-x-1/2 flex justify-center z-[100]"
              style={{ width: 'min(540px, calc(100vw - 176px))' }}
            >
              <NodeControls
                data={data}
                inputUrl={inputUrl}
                isLoading={isLoading}
                isSuccess={isSuccess}
                connectedImageNodes={connectedImageNodes}
                availableCanvasNodes={availableCanvasNodes}
                onUpdate={onUpdate}
                onGenerate={onGenerate}
                canGenerate={canGenerate}
                generateDisabledReason={generateDisabledReason}
                onChangeAngleGenerate={onChangeAngleGenerate}
                onUpload={onUpload}
                onAttachReferenceImages={onAttachReferenceImages}
                onPickFromLibrary={onPickFromLibrary}
                onSelect={onSelect}
                zoom={zoom}
                creditQuoteProjectId={creditQuoteProjectId}
                canvasTheme={canvasTheme}
                allowCameraAngle={allowCameraAngle}
              />
            </div>
          )
        )}
      </div>
    </div >
  );
};

function areCanvasNodePropsEqual(prev: CanvasNodeProps, next: CanvasNodeProps): boolean {
  if (prev.data !== next.data) {
    if (prev.data.x !== next.data.x || prev.data.y !== next.data.y) return false;
    if (!areNodeDataEqualExceptPosition(prev.data, next.data)) return false;
  }
  if (prev.inputUrl !== next.inputUrl) return false;
  if (!areConnectedCanvasNodeInputsEqual(prev.connectedImageNodes, next.connectedImageNodes)) return false;
  if (prev.selected !== next.selected) return false;
  if (prev.showControls !== next.showControls) return false;
  if (prev.isHoveredForConnection !== next.isHoveredForConnection) return false;
  if (prev.zoom !== next.zoom) return false;
  if (prev.canvasTheme !== next.canvasTheme) return false;
  if (prev.canGenerate !== next.canGenerate) return false;
  if (prev.generateDisabledReason !== next.generateDisabledReason) return false;
  if (prev.creditQuoteProjectId !== next.creditQuoteProjectId) return false;
  if (prev.allowSocialShare !== next.allowSocialShare) return false;
  if (prev.allowChatDrag !== next.allowChatDrag) return false;
  if (prev.allowCameraAngle !== next.allowCameraAngle) return false;
  if (prev.onSyncToProjectAssets !== next.onSyncToProjectAssets) return false;
  if (prev.onImageNodeToolbarAction !== next.onImageNodeToolbarAction) return false;
  return true;
}

export const CanvasNode = React.memo(CanvasNodeInner, areCanvasNodePropsEqual);
