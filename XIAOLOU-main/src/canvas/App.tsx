/**
 * App.tsx
 * 
 * Main application component for the XiaoLou canvas runtime.
 * Orchestrates canvas, nodes, connections, and user interactions.
 * Uses custom hooks for state management and logic separation.
 */

import React, { useState, useEffect, useRef } from 'react';
import { CanvasToolbar, CanvasTool } from './components/CanvasToolbar';
import { TopBar } from './components/TopBar';
import { CanvasNode } from './components/canvas/CanvasNode';
import { ConnectionsLayer } from './components/canvas/ConnectionsLayer';
import { ContextMenu } from './components/ContextMenu';
import { CanvasNodeUploadSource, ContextMenuState, NodeData, NodeGroup, NodeStatus, NodeType, Viewport } from './types';
import { generateImage, generateVideo, recoverGeneration } from './services/generationService';
import { uploadAsset } from './services/assetService';
import { useCanvasNavigation } from './hooks/useCanvasNavigation';
import { useNodeManagement } from './hooks/useNodeManagement';
import { useConnectionDragging, type SameTypeMediaConnectionChoice } from './hooks/useConnectionDragging';
import { useNodeDragging } from './hooks/useNodeDragging';
import { useNodeResizing, type ResizeHandle } from './hooks/useNodeResizing';
import { AlignmentGuides } from './components/canvas/AlignmentGuides';
import { useGeneration } from './hooks/useGeneration';
import { useSelectionBox } from './hooks/useSelectionBox';
import { useGroupManagement } from './hooks/useGroupManagement';
import { useHistory } from './hooks/useHistory';
import { useCanvasTitle } from './hooks/useCanvasTitle';
import { useWorkflow } from './hooks/useWorkflow';
import { useImageEditor } from './hooks/useImageEditor';
import { useVideoEditor } from './hooks/useVideoEditor';
import { usePanelState } from './hooks/usePanelState';
import { useAssetHandlers } from './hooks/useAssetHandlers';
import { useTextNodeHandlers } from './hooks/useTextNodeHandlers';
import { useImageNodeHandlers } from './hooks/useImageNodeHandlers';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useContextMenuHandlers } from './hooks/useContextMenuHandlers';
import { useAutoSave } from './hooks/useAutoSave';
import { useGenerationRecovery } from './hooks/useGenerationRecovery';
import { useVideoFrameExtraction } from './hooks/useVideoFrameExtraction';
import { extractVideoLastFrame } from './utils/videoHelpers';
import { getNodeRect } from './utils/nodeGeometry';
import { generateUUID } from './utils/secureContextPolyfills';
import { SelectionBoundingBox } from './components/canvas/SelectionBoundingBox';
import { DEFAULT_XIAOLOU_IMAGE_TO_VIDEO_MODEL_ID } from './config/canvasVideoModels';
import { WorkflowPanel } from './components/WorkflowPanel';
import { HistoryPanel } from './components/HistoryPanel';
import { ChatPanel, ChatBubble } from './components/ChatPanel';
import { ImageEditorModal } from './components/modals/ImageEditorModal';
import { VideoEditorModal } from './components/modals/VideoEditorModal';
import { ExpandedMediaModal } from './components/modals/ExpandedMediaModal';
import { CreateAssetModal } from './components/modals/CreateAssetModal';
import { ProjectAssetSyncModal, type CanvasProjectAssetSyncDraft } from './components/modals/ProjectAssetSyncModal';
import { TikTokImportModal } from './components/modals/TikTokImportModal';
import { TwitterPostModal } from './components/modals/TwitterPostModal';
import { TikTokPostModal } from './components/modals/TikTokPostModal';
import { AssetLibraryPanel } from './components/AssetLibraryPanel';
import { useTikTokImport } from './hooks/useTikTokImport';
import { useStoryboardGenerator } from './hooks/useStoryboardGenerator';
import { StoryboardGeneratorModal } from './components/modals/StoryboardGeneratorModal';
import { StoryboardVideoModal } from './components/modals/StoryboardVideoModal';
import { getRuntimeConfig, getDirectEmbedRuntimeConfig } from './runtimeConfig';
import {
  DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID,
  getDefaultCanvasImageAspectRatio,
  getDefaultCanvasImageResolution,
  normalizeCanvasImageAspectRatio,
  normalizeCanvasImageModelId,
  normalizeCanvasImageResolution,
} from './config/canvasImageModels';
import { getXiaolouCanvasDraftStorageKey } from './integrations/xiaolouCanvasSession';
import { canUseXiaolouAssetBridge, createXiaolouAsset } from './integrations/xiaolouAssetBridge';
import { sanitizeCanvasNodesForPersistence } from './utils/canvasPersistence';
import {
  buildCanvasProjectSnapshot,
  isRemoteCanvasVersionNewer,
  mergeCanvasProjectSnapshots,
} from './utils/canvasProjectMerge';
import {
  hasCanvasHostServices,
  getCanvasHostServices,
  subscribeCanvasThemeChange,
  subscribeCanvasProjectLoad,
} from './integrations/canvasHostServices';
import {
  getMe,
  getWalletRechargeCapabilities,
  type PermissionContext,
  type WalletRechargeCapabilities,
} from '../lib/api';
import { useActorId } from '../lib/actor-session';
import { isLocalLoopbackAccess } from '../lib/local-loopback';
import { parseGenerationError } from '../lib/generation-error';

// (No global augmentations needed for direct-embed mode.)

// ============================================================================
// MAIN COMPONENT
// ============================================================================

// Helper to convert URL/Blob to Base64
const urlToBase64 = async (url: string): Promise<string> => {
  if (url.startsWith('data:image')) return url;

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error("Error converting URL to base64:", e);
    return "";
  }
};

function isCanvasFileUploadSource(value: CanvasNodeUploadSource): value is File {
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

type CanvasMediaImportKind = 'image' | 'video';

const CANVAS_MEDIA_IMPORT_MAX_BYTES = 100 * 1024 * 1024;

function getFileStem(file: File) {
  return file.name.replace(/\.[^.]+$/, '').trim() || file.name || 'Imported media';
}

function getCanvasMediaImportKind(file: File): CanvasMediaImportKind | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';

  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'].includes(extension)) return 'image';
  if (extension && ['mp4', 'mov', 'webm', 'm4v'].includes(extension)) return 'video';

  return null;
}

function getCanvasMediaFiles(dataTransfer: DataTransfer | null | undefined) {
  if (!dataTransfer) return [];

  const filesFromList = Array.from(dataTransfer.files || []);
  const filesFromItems = Array.from(dataTransfer.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  const seen = new Set<string>();
  return [...filesFromList, ...filesFromItems].filter((file) => {
    if (!getCanvasMediaImportKind(file)) return false;
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function hasFilesInDataTransfer(dataTransfer: DataTransfer | null | undefined) {
  return Boolean(dataTransfer && Array.from(dataTransfer.types || []).includes('Files'));
}

function isCanvasEditableEventTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : document.activeElement;
  if (!(element instanceof Element)) return false;
  if (element.closest('input, textarea, select, [role="textbox"]')) return true;
  const contentEditable = element.closest('[contenteditable]');
  return contentEditable instanceof HTMLElement && contentEditable.isContentEditable;
}

type CanvasDraftData = {
  workflowId: string | null;
  canvasTitle: string;
  nodes: NodeData[];
  groups: NodeGroup[];
  viewport: Viewport;
  canvasProjectId?: string | null;
  hasUnsavedChanges?: boolean;
  savedAt: string;
};

type CanvasGenerationAccess = {
  canGenerate: boolean;
  deniedMessage: string;
  insufficientCreditsMessage: string;
};

type ScreenBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
};

type RectLike = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

const DEFAULT_CANVAS_TITLES = new Set([
  '',
  'untitled',
  'untitled canvas',
  '未命名画布',
]);

const DEFAULT_CANVAS_TITLE = 'Untitled';
DEFAULT_CANVAS_TITLES.add('未命名画布');

function isDefaultCanvasTitle(title?: string | null) {
  return DEFAULT_CANVAS_TITLES.has(String(title || '').trim().toLowerCase());
}

function hasMeaningfulCanvasContent(options: {
  nodes?: ArrayLike<unknown> | null;
  groups?: ArrayLike<unknown> | null;
  title?: string | null;
}) {
  const nodeCount = typeof options.nodes?.length === 'number' ? options.nodes.length : 0;
  const groupCount = typeof options.groups?.length === 'number' ? options.groups.length : 0;
  return (
    nodeCount > 0 ||
    groupCount > 0 ||
    !isDefaultCanvasTitle(options.title)
  );
}

function getCanvasSafeBounds(rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>): ScreenBounds {
  const left = rect.left + 28;
  const right = rect.right - 28;
  const top = rect.top + 96;
  const bottom = rect.bottom - 112;
  return {
    left,
    top,
    right,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

function unionScreenRects(rects: RectLike[]): RectLike | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

function rectIntersectsBounds(rect: RectLike, bounds: ScreenBounds) {
  return rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom;
}

function getBoundsNudge(rect: RectLike, bounds: ScreenBounds) {
  let dx = 0;
  let dy = 0;

  if (rect.width > bounds.right - bounds.left) {
    dx = bounds.centerX - (rect.left + rect.right) / 2;
  } else if (rect.left < bounds.left) {
    dx = bounds.left - rect.left;
  } else if (rect.right > bounds.right) {
    dx = bounds.right - rect.right;
  }

  if (rect.height > bounds.bottom - bounds.top) {
    dy = bounds.centerY - (rect.top + rect.bottom) / 2;
  } else if (rect.top < bounds.top) {
    dy = bounds.top - rect.top;
  } else if (rect.bottom > bounds.bottom) {
    dy = bounds.bottom - rect.bottom;
  }

  return { dx, dy };
}

function getFallbackCreatePermission(actorId: string) {
  const normalized = String(actorId || '').trim();
  return normalized !== '' && normalized !== 'guest' && normalized !== 'ops_demo_001';
}

function buildGenerationDeniedMessage(options: {
  actorId: string;
  isLoopback: boolean;
  permissionContext: PermissionContext | null;
}) {
  const { actorId, isLoopback, permissionContext } = options;
  if (permissionContext?.permissions.canCreateProject) {
    return '';
  }

  const platformRole = permissionContext?.platformRole || (actorId === 'guest' ? 'guest' : '');
  if (platformRole === 'guest') {
    return isLoopback
      ? '当前是游客模式，请先切换到演示账号或登录后再生成。'
      : '当前账号暂无创作权限，请先登录或切换到可创建账号后再试。';
  }

  return '当前账号暂无创作权限，请联系管理员开通创作权限后再试。';
}

function buildInsufficientCreditsMessage(options: {
  permissionContext: PermissionContext | null;
  rechargeCapabilities: WalletRechargeCapabilities | null;
}) {
  const { permissionContext, rechargeCapabilities } = options;
  const canRecharge = permissionContext?.permissions.canRecharge === true;
  const hasDemoRecharge = rechargeCapabilities?.methods?.some((method) => method.demoMock.available) === true;
  const hasLiveRecharge = rechargeCapabilities?.methods?.some((method) => method.live.available) === true;

  if (!canRecharge) {
    return '当前账号余额不足，请联系管理员充值后重试。';
  }

  if (hasDemoRecharge && hasLiveRecharge) {
    return '当前账号余额不足，请前往充值页补充额度后重试。当前环境同时支持演示充值和真实支付。';
  }

  if (hasDemoRecharge) {
    return '当前账号余额不足，请前往充值页继续演示充值后重试。';
  }

  if (hasLiveRecharge) {
    return '当前账号余额不足，请前往充值页完成充值后重试。';
  }

  return '当前账号余额不足，请前往充值页补充额度后重试。';
}

function getDefaultProjectAssetType(node: NodeData): string {
  return node.type === NodeType.VIDEO ? 'video_ref' : 'style';
}

function buildProjectAssetDraftName(node: NodeData): string {
  const source = String(node.title || node.prompt || '').trim();
  if (!source) {
    return node.type === NodeType.VIDEO ? '画布视频结果' : '画布图片结果';
  }
  return source.length > 40 ? `${source.slice(0, 40)}...` : source;
}

function buildProjectAssetSyncDraft(node: NodeData): CanvasProjectAssetSyncDraft | null {
  if (
    (node.type !== NodeType.IMAGE && node.type !== NodeType.VIDEO) ||
    node.status !== NodeStatus.SUCCESS ||
    !node.resultUrl
  ) {
    return null;
  }

  return {
    id: node.id,
    mediaKind: node.type === NodeType.VIDEO ? 'video' : 'image',
    previewUrl: node.type === NodeType.VIDEO ? (node.lastFrame || node.resultUrl) : node.resultUrl,
    mediaUrl: node.resultUrl,
    prompt: node.prompt || '',
    model: node.type === NodeType.VIDEO
      ? (node.videoModel || node.model || DEFAULT_XIAOLOU_IMAGE_TO_VIDEO_MODEL_ID)
      : normalizeCanvasImageModelId(node.imageModel || node.model || DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID),
    aspectRatio: node.aspectRatio || 'Auto',
    sourceTaskId: null,
    defaultAssetType: getDefaultProjectAssetType(node),
    defaultName: buildProjectAssetDraftName(node),
    defaultDescription: node.prompt || '',
  };
}

function getReferenceChoicePreviewUrl(node?: NodeData) {
  if (!node) return undefined;
  return node.type === NodeType.VIDEO ? (node.lastFrame || node.resultUrl) : node.resultUrl;
}

function getReferenceChoiceLabel(node: NodeData | undefined, fallback: string) {
  const title = String(node?.title || '').trim();
  if (title) return title;
  return fallback;
}

type AppProps = {
  creditQuoteProjectId?: string | null;
};

export default function App({ creditQuoteProjectId = null }: AppProps = {}) {
  // ============================================================================
  // STATE
  // ============================================================================

  const actorId = useActorId();
  const isLoopbackAccess = React.useMemo(
    () => typeof window !== 'undefined' && isLocalLoopbackAccess(),
    []
  );
  const [hasApiKey] = useState(true); // Backend handles API key
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    isOpen: false,
    x: 0,
    y: 0,
    type: 'global'
  });

  const [canvasTheme, setCanvasTheme] = useState<'dark' | 'light'>(() => {
    // Direct-embed mode: read initial theme from host services
    const hostServices = getCanvasHostServices();
    if (hostServices) return hostServices.initialTheme;
    // iframe mode: read from URL or default
    try {
      const params = new URLSearchParams(window.location.search);
      const urlTheme = params.get('theme');
      if (urlTheme === 'light' || urlTheme === 'dark') return urlTheme;
    } catch { /* ignore */ }
    return 'light';
  });
  const [activeTool, setActiveTool] = useState<CanvasTool>('select');
  // Direct-embed mode: when canvas runs directly inside XIAOLOU-main (not in an iframe),
  // window.parent === window. Use the same feature set the iframe used (featurePreset=core +
  // cameraAngle=1). This check is reliable from the very first render, unlike
  // hasCanvasHostServices() which depends on CanvasCreate's render having run first.
  const runtimeConfig = React.useMemo(() => {
    if (typeof window !== 'undefined' && window.parent === window) {
      return getDirectEmbedRuntimeConfig();
    }
    return getRuntimeConfig();
  }, []);
  const { features } = runtimeConfig;

  // iframe-ready signal removed: the canvas now runs in direct-embed mode
  // (window.parent === window) and never needs to notify a parent iframe host.

  // Panel state management (history, chat, asset library, expand)
  const {
    isHistoryPanelOpen,
    handleHistoryClick: panelHistoryClick,
    closeHistoryPanel,
    expandedImageUrl,
    handleExpandImage,
    handleCloseExpand,
    isChatOpen,
    toggleChat,
    closeChat,
    isAssetLibraryOpen,
    assetLibraryY,
    assetLibraryVariant,
    handleAssetsClick: panelAssetsClick,
    closeAssetLibrary,
    openAssetLibraryModal,
    isDraggingNodeToChat,
    handleNodeDragStart,
    handleNodeDragEnd
  } = usePanelState();

  const [canvasHoveredNodeId, setCanvasHoveredNodeId] = useState<string | null>(null);
  const [pendingReferenceChoice, setPendingReferenceChoice] = useState<SameTypeMediaConnectionChoice | null>(null);
  const [permissionContext, setPermissionContext] = useState<PermissionContext | null>(null);
  const [rechargeCapabilities, setRechargeCapabilities] = useState<WalletRechargeCapabilities | null>(null);


  // Canvas title state (via hook)
  const {
    canvasTitle,
    setCanvasTitle,
    isEditingTitle,
    setIsEditingTitle,
    editingTitleValue,
    setEditingTitleValue,
    canvasTitleInputRef
  } = useCanvasTitle();

  const {
    viewport,
    setViewport,
    canvasRef,
    handleWheel: baseHandleWheel,
    handleSliderZoom
  } = useCanvasNavigation();

  // Wrap handleWheel to pass hovered node for zoom-to-center
  const handleWheel = (e: React.WheelEvent) => {
    const hoveredNode = canvasHoveredNodeId ? nodes.find(n => n.id === canvasHoveredNodeId) : undefined;
    baseHandleWheel(e, hoveredNode);
  };

  const {
    nodes,
    setNodes,
    selectedNodeIds,
    setSelectedNodeIds,
    addNode,
    updateNode,
    deleteNode,
    deleteNodes,
    clearSelection,
    handleSelectTypeFromMenu
  } = useNodeManagement();

  const {
    isDraggingConnection,
    connectionStart,
    tempConnectionEnd,
    hoveredNodeId: connectionHoveredNodeId,
    selectedConnection,
    setSelectedConnection,
    handleConnectorPointerDown,
    updateConnectionDrag,
    completeConnectionDrag,
    handleEdgeClick,
    deleteSelectedConnection
  } = useConnectionDragging();

  const {
    handleNodePointerDown,
    primeSnapContext,
    updateNodeDrag,
    endNodeDrag,
    startPanning,
    updatePanning,
    endPanning,
    isDragging,
    releasePointerCapture,
    snapGuides,
  } = useNodeDragging();

  const {
    beginResize,
    updateResize,
    endResize,
    snapGuides: resizeSnapGuides,
  } = useNodeResizing();

  const {
    selectionBox,
    isSelecting,
    startSelection,
    updateSelection,
    endSelection,
    clearSelectionBox
  } = useSelectionBox();

  const {
    groups,
    setGroups, // For workflow loading
    groupNodes,
    ungroupNodes,
    cleanupInvalidGroups,
    getCommonGroup,
    sortGroupNodes,
    renameGroup
  } = useGroupManagement();

  // History for undo/redo
  const {
    present: historyState,
    undo,
    redo,
    pushHistory,
    canUndo,
    canRedo
  } = useHistory({ nodes, groups }, 50);

  // Workflow management
  const {
    workflowId,
    isWorkflowPanelOpen,
    handleSaveWorkflow,
    handleLoadWorkflow,
    handleWorkflowsClick,
    closeWorkflowPanel,
    resetWorkflowId,
    hydrateWorkflowId
  } = useWorkflow({
    nodes,
    groups,
    viewport,
    canvasTitle,
    setNodes,
    setGroups,
    setSelectedNodeIds,
    setCanvasTitle,
    setEditingTitleValue,
    onPanelOpen: () => {
      closeHistoryPanel();
      closeAssetLibrary();
    }
  });

  // Simple dirty flag for unsaved changes tracking
  const [isDirty, setIsDirty] = React.useState(false);
  const hasUnsavedChanges = isDirty && nodes.length > 0;
  const locationSearch = typeof window !== 'undefined' ? window.location.search : '';
  const queryCanvasProjectId = React.useMemo(() => {
    try {
      const value = new URLSearchParams(locationSearch).get('canvasProjectId');
      return typeof value === 'string' && value.trim() ? value.trim() : null;
    } catch {
      return null;
    }
  }, [locationSearch]);
  const clearCanvasProjectQueryParam = React.useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const url = new URL(window.location.href);
    if (!url.searchParams.has('canvasProjectId')) {
      return;
    }
    url.searchParams.delete('canvasProjectId');
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(window.history.state, '', nextUrl);
  }, []);
  const draftStorageKey = React.useMemo(
    () => getXiaolouCanvasDraftStorageKey(queryCanvasProjectId),
    [actorId, queryCanvasProjectId]
  );
  const hasHydratedDraftRef = React.useRef(false);
  const pendingContentViewportSafetyCheckRef = React.useRef(false);
  const pendingSelectionViewportSafetyCheckRef = React.useRef<string | null>(null);
  const hydratedDraftMetaRef = React.useRef<{
    canvasProjectId: string | null;
    hasUnsavedChanges: boolean;
    savedAt: string | null;
  } | null>(null);
  const latestNodesRef = React.useRef(nodes);
  const latestGroupsRef = React.useRef(groups);
  const latestCanvasTitleRef = React.useRef(canvasTitle);
  const latestViewportRef = React.useRef(viewport);
  const latestIsDirtyRef = React.useRef(isDirty);

  // Mark as dirty when nodes or title change
  const isInitialMount = React.useRef(true);
  const lastLoadingCountRef = React.useRef(0);
  const ignoreNextChange = React.useRef(false);

  React.useEffect(() => {
    let active = true;

    const loadCanvasAccountContext = async () => {
      try {
        const [meResponse, rechargeResponse] = await Promise.all([
          getMe(),
          getWalletRechargeCapabilities().catch(() => null),
        ]);
        if (!active) return;
        setPermissionContext(meResponse);
        setRechargeCapabilities(rechargeResponse);
      } catch (error) {
        if (!active) return;
        console.warn('[Canvas] Failed to load account context for generation guard:', error);
        setPermissionContext(null);
        setRechargeCapabilities(null);
      }
    };

    void loadCanvasAccountContext();

    return () => {
      active = false;
    };
  }, [actorId]);

  const canCreateProject = permissionContext?.permissions.canCreateProject ?? getFallbackCreatePermission(actorId);
  const generationDisabledReason = React.useMemo(
    () => buildGenerationDeniedMessage({ actorId, isLoopback: isLoopbackAccess, permissionContext }),
    [actorId, isLoopbackAccess, permissionContext]
  );
  const generationAccess = React.useMemo<CanvasGenerationAccess>(() => ({
    canGenerate: canCreateProject,
    deniedMessage: generationDisabledReason || '当前账号暂无创作权限，请稍后重试。',
    insufficientCreditsMessage: buildInsufficientCreditsMessage({ permissionContext, rechargeCapabilities }),
  }), [canCreateProject, generationDisabledReason, permissionContext, rechargeCapabilities]);

  React.useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (ignoreNextChange.current) {
      ignoreNextChange.current = false;
      return;
    }

    if (!hasMeaningfulCanvasContent({ nodes, groups, title: canvasTitle })) {
      return;
    }

    setIsDirty(true);

    // Trigger immediate save if any node JUST entered LOADING state
    const currentLoadingCount = nodes.filter(n => n.status === NodeStatus.LOADING).length;
    if (currentLoadingCount > lastLoadingCountRef.current) {
      console.log('[App] New loading node detected, triggering immediate save for recovery protection');
      handleSaveWithTracking();
    }
    lastLoadingCountRef.current = currentLoadingCount;
  }, [nodes, canvasTitle]);

  // Update saved state after workflow save
  const handleSaveWithTracking = async () => {
    await handleSaveWorkflow();
    setIsDirty(false);
  };

  // Load workflow and update tracking
  const handleLoadWithTracking = async (id: string) => {
    ignoreNextChange.current = true;
    await handleLoadWorkflow(id);
    setIsDirty(false);
  };

  React.useEffect(() => {
    try {
      const rawDraft = window.localStorage.getItem(draftStorageKey);
      if (!rawDraft) {
        hydratedDraftMetaRef.current = null;
        hasHydratedDraftRef.current = true;
        return;
      }

      const draft = JSON.parse(rawDraft) as Partial<CanvasDraftData>;
      if (!draft || typeof draft !== 'object') {
        return;
      }

      ignoreNextChange.current = true;
      pendingContentViewportSafetyCheckRef.current = true;
      hydratedDraftMetaRef.current = {
        canvasProjectId: typeof draft.canvasProjectId === 'string' && draft.canvasProjectId.trim()
          ? draft.canvasProjectId.trim()
          : queryCanvasProjectId,
        hasUnsavedChanges: draft.hasUnsavedChanges === true,
        savedAt: typeof draft.savedAt === 'string' && draft.savedAt.trim() ? draft.savedAt : null,
      };
      setCanvasTitle(typeof draft.canvasTitle === 'string' && draft.canvasTitle.trim() ? draft.canvasTitle : DEFAULT_CANVAS_TITLE);
      setEditingTitleValue(typeof draft.canvasTitle === 'string' && draft.canvasTitle.trim() ? draft.canvasTitle : DEFAULT_CANVAS_TITLE);
      setNodes(Array.isArray(draft.nodes) ? sanitizeCanvasNodesForPersistence(draft.nodes as NodeData[]) : []);
      setGroups(Array.isArray(draft.groups) ? draft.groups : []);
      setViewport(draft.viewport || { x: 0, y: 0, zoom: 1 });
      setSelectedNodeIds([]);
      hydrateWorkflowId(typeof draft.workflowId === 'string' ? draft.workflowId : null);
      setIsDirty(draft.hasUnsavedChanges === true);
    } catch (error) {
      hydratedDraftMetaRef.current = null;
      console.warn('[Canvas] Failed to restore XiaoLou canvas draft:', error);
    } finally {
      hasHydratedDraftRef.current = true;
    }
  }, [draftStorageKey, hydrateWorkflowId, queryCanvasProjectId, setCanvasTitle, setEditingTitleValue, setGroups, setNodes, setSelectedNodeIds, setViewport]);

  React.useEffect(() => {
    if (!hasHydratedDraftRef.current) {
      return;
    }
    const handle = window.setTimeout(() => {
      try {
        const draft: CanvasDraftData = {
          workflowId,
          canvasTitle,
          nodes: sanitizeCanvasNodesForPersistence(nodes),
          groups,
          viewport,
          canvasProjectId: queryCanvasProjectId,
          hasUnsavedChanges: isDirty,
          savedAt: new Date().toISOString(),
        };
        window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
        hydratedDraftMetaRef.current = {
          canvasProjectId: draft.canvasProjectId || null,
          hasUnsavedChanges: draft.hasUnsavedChanges === true,
          savedAt: draft.savedAt,
        };
      } catch (error) {
        console.warn('[Canvas] Failed to persist XiaoLou canvas draft:', error);
      }
    }, 200);
    return () => window.clearTimeout(handle);
  }, [canvasTitle, draftStorageKey, groups, isDirty, nodes, queryCanvasProjectId, viewport, workflowId]);

  React.useEffect(() => {
    latestNodesRef.current = nodes;
    latestGroupsRef.current = groups;
    latestCanvasTitleRef.current = canvasTitle;
    latestViewportRef.current = viewport;
    latestIsDirtyRef.current = isDirty;
  }, [canvasTitle, groups, isDirty, nodes, viewport]);

  // ── Project / theme sync ──────────────────────────────────────────────────
  //
  // The canvas currently runs in direct-embed mode (window.parent === window).
  // The postMessage-based handlers below are kept as a compat layer in case the
  // canvas is ever run inside an iframe again, but they are guarded to be
  // completely dormant in the current deployment.

  // [compat] postMessage project-load handler — only fires when embedded in iframe
  React.useEffect(() => {
    if (!runtimeConfig.isEmbedded || typeof window === 'undefined' || window.parent === window) {
      return;
    }

    const handleLoadProject = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const data = event.data;
      if (!data || data.channel !== 'xiaolou.loadCanvasProject' || data.direction !== 'command') return;

      const project = data.project;
      if (!project || typeof project !== 'object') return;

      setCanvasTitle(project.title || DEFAULT_CANVAS_TITLE);
      setEditingTitleValue(project.title || DEFAULT_CANVAS_TITLE);
      setNodes(Array.isArray(project.nodes) ? sanitizeCanvasNodesForPersistence(project.nodes as NodeData[]) : []);
      setGroups(Array.isArray(project.groups) ? project.groups : []);
      if (project.viewport) {
        setViewport(project.viewport);
      }
      setSelectedNodeIds([]);
      setIsDirty(false);
    };

    window.addEventListener('message', handleLoadProject);
    return () => window.removeEventListener('message', handleLoadProject);
  }, [runtimeConfig.isEmbedded, setCanvasTitle, setEditingTitleValue, setNodes, setGroups, setViewport, setSelectedNodeIds]);

  // [compat] postMessage theme-sync handler — only fires when embedded in iframe
  React.useEffect(() => {
    if (!runtimeConfig.isEmbedded || typeof window === 'undefined' || window.parent === window) {
      return;
    }
    const handleTheme = (event: MessageEvent) => {
      if (event.source !== window.parent) return;
      const data = event.data;
      if (!data || data.channel !== 'xiaolou.canvasTheme' || data.direction !== 'set') return;
      if (data.theme === 'light' || data.theme === 'dark') {
        setCanvasTheme(data.theme as 'light' | 'dark');
      }
    };
    window.addEventListener('message', handleTheme);
    return () => window.removeEventListener('message', handleTheme);
  }, [runtimeConfig.isEmbedded]);

  // Theme sync — direct-embed: CanvasCreate.tsx notifies via the event bus.
  React.useEffect(() => {
    if (typeof window === 'undefined' || window.parent !== window) return;
    return subscribeCanvasThemeChange(setCanvasTheme);
  }, []);

  // Project load — direct-embed: CanvasCreate.tsx notifies via the event bus.
  React.useEffect(() => {
    if (typeof window === 'undefined' || window.parent !== window) return;
    return subscribeCanvasProjectLoad(
      (project) => {
        const hydratedDraft = hydratedDraftMetaRef.current;
        const remoteUpdatedAtMs = Date.parse(project.updatedAt || '');
        const draftSavedAtMs = Date.parse(hydratedDraft?.savedAt || '');
        const hasMeaningfulLocalDraft = hasMeaningfulCanvasContent({
          nodes: latestNodesRef.current,
          groups: latestGroupsRef.current,
          title: latestCanvasTitleRef.current,
        });
        const remoteProjectHasContent = hasMeaningfulCanvasContent({
          nodes: Array.isArray(project.nodes) ? project.nodes : [],
          groups: Array.isArray(project.groups) ? project.groups : [],
          title: project.title,
        });
        const shouldKeepHydratedDraft =
          !!project.id &&
          hydratedDraft?.hasUnsavedChanges === true &&
          hydratedDraft.canvasProjectId === project.id &&
          (!remoteProjectHasContent || hasMeaningfulLocalDraft) &&
          Number.isFinite(draftSavedAtMs) &&
          (!Number.isFinite(remoteUpdatedAtMs) || draftSavedAtMs >= remoteUpdatedAtMs);

        if (shouldKeepHydratedDraft) {
          console.log('[Canvas] Keeping newer unsaved local draft for canvas project:', project.id);
          setIsDirty(true);
          return;
        }

        ignoreNextChange.current = true; // suppress the dirty flag triggered by setNodes below
        pendingContentViewportSafetyCheckRef.current = true;
        setCanvasTitle(project.title || DEFAULT_CANVAS_TITLE);
        setEditingTitleValue(project.title || DEFAULT_CANVAS_TITLE);
        setNodes(Array.isArray(project.nodes) ? sanitizeCanvasNodesForPersistence(project.nodes as NodeData[]) : []);
        setGroups(Array.isArray(project.groups) ? project.groups as NodeGroup[] : []);
        if (project.viewport) setViewport(project.viewport);
        setSelectedNodeIds([]);
        hydratedDraftMetaRef.current = {
          canvasProjectId: project.id || null,
          hasUnsavedChanges: false,
          savedAt: project.updatedAt || null,
        };
        setIsDirty(false);
      },
      {
        replayLatest: Boolean(queryCanvasProjectId),
        replayProjectId: queryCanvasProjectId || undefined,
      },
    );
  }, [queryCanvasProjectId, setCanvasTitle, setEditingTitleValue, setNodes, setGroups, setViewport, setSelectedNodeIds]);

  React.useEffect(() => {
    if (typeof window === 'undefined' || window.parent !== window) {
      return;
    }

    let cancelled = false;
    let inFlight = false;

    const syncRemoteProject = async () => {
      if (cancelled || inFlight) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

      const services = getCanvasHostServices();
      if (!services?.loadProject || !services.getCanvasProjectVersion) return;

      const baseVersion = services.getCanvasProjectVersion();
      if (!baseVersion?.id) return;
      if (queryCanvasProjectId && baseVersion.id !== queryCanvasProjectId) return;
      const activeProjectId = baseVersion.id;

      inFlight = true;
      try {
        const remoteProject = await services.loadProject(activeProjectId);
        if (cancelled) return;
        if (!isRemoteCanvasVersionNewer(remoteProject.updatedAt, baseVersion.updatedAt)) return;

        const baseCanvasData = baseVersion.canvasData;
        const remoteCanvasData = remoteProject.canvasData;
        const baseSnapshot = buildCanvasProjectSnapshot({
          title: baseVersion.title || remoteProject.title,
          nodes: baseCanvasData?.nodes || [],
          groups: baseCanvasData?.groups || [],
          viewport: baseCanvasData?.viewport,
        });
        const localSnapshot = buildCanvasProjectSnapshot({
          title: latestCanvasTitleRef.current,
          nodes: latestNodesRef.current,
          groups: latestGroupsRef.current,
          viewport: latestViewportRef.current,
        });
        const remoteSnapshot = buildCanvasProjectSnapshot({
          title: remoteProject.title,
          nodes: remoteCanvasData?.nodes || [],
          groups: remoteCanvasData?.groups || [],
          viewport: remoteCanvasData?.viewport,
        });
        const hasLocalChanges = latestIsDirtyRef.current && hasMeaningfulCanvasContent({
          nodes: latestNodesRef.current,
          groups: latestGroupsRef.current,
          title: latestCanvasTitleRef.current,
        });
        const nextSnapshot = hasLocalChanges
          ? mergeCanvasProjectSnapshots(baseSnapshot, localSnapshot, remoteSnapshot)
          : remoteSnapshot;

        ignoreNextChange.current = !hasLocalChanges;
        pendingContentViewportSafetyCheckRef.current = true;
        setCanvasTitle(nextSnapshot.title || DEFAULT_CANVAS_TITLE);
        setEditingTitleValue(nextSnapshot.title || DEFAULT_CANVAS_TITLE);
        setNodes(sanitizeCanvasNodesForPersistence(nextSnapshot.nodes));
        setGroups(nextSnapshot.groups);
        setViewport(nextSnapshot.viewport);
        setSelectedNodeIds([]);
        setIsDirty(hasLocalChanges);
        hydratedDraftMetaRef.current = {
          canvasProjectId: remoteProject.id,
          hasUnsavedChanges: hasLocalChanges,
          savedAt: remoteProject.updatedAt || null,
        };
        services.adoptCanvasProjectVersion?.({
          id: remoteProject.id,
          title: remoteProject.title,
          updatedAt: remoteProject.updatedAt,
          canvasData: remoteProject.canvasData,
        });
        console.log('[Canvas] Remote project version merged:', remoteProject.id);
      } catch (error) {
        if (!cancelled) {
          console.warn('[Canvas] Remote project sync failed:', error);
        }
      } finally {
        inFlight = false;
      }
    };

    const timer = window.setInterval(() => {
      void syncRemoteProject();
    }, 15000);
    const initialTimer = window.setTimeout(() => {
      void syncRemoteProject();
    }, 5000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void syncRemoteProject();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(initialTimer);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [queryCanvasProjectId, setCanvasTitle, setEditingTitleValue, setGroups, setNodes, setSelectedNodeIds, setViewport]);

  const { handleGenerate: handleGenerateSingle } = useGeneration({
    nodes,
    updateNode,
    generationAccess,
  });

  // Keep a ref to handleGenerate so setTimeout callbacks can access the latest version
  const handleGenerateRef = React.useRef<(id: string) => void>(() => undefined);

  const handleGenerate = React.useCallback((id: string) => {
    const sourceNode = nodes.find((node) => node.id === id);
    if (!sourceNode) return;

    const isPlainImageNode = sourceNode.type === NodeType.IMAGE;
    const isPlainVideoNode = sourceNode.type === NodeType.VIDEO;
    const isImageGenerationNode =
      sourceNode.type === NodeType.IMAGE || sourceNode.type === NodeType.IMAGE_EDITOR;
    const batchCount = isImageGenerationNode
      ? Math.max(1, Math.min(10, Number(sourceNode.batchCount) || 1))
      : 1;

    if (
      sourceNode.status === NodeStatus.LOADING ||
      (generationAccess && !generationAccess.canGenerate)
    ) {
      void handleGenerateSingle(id);
      return;
    }

    const textPromptCount = (sourceNode.parentIds || []).reduce((count, parentId) => {
      const parent = nodes.find((node) => node.id === parentId);
      if (parent?.type === NodeType.TEXT && parent.prompt?.trim()) {
        return count + 1;
      }
      return count;
    }, 0);
    const hasPromptSource = Boolean(sourceNode.prompt?.trim()) || textPromptCount > 0;
    const isPromptOptionalKlingFrameToFrameVideo =
      isPlainVideoNode &&
      (sourceNode.videoModel || sourceNode.model || '').startsWith('kling-') &&
      sourceNode.videoMode === 'frame-to-frame' &&
      (sourceNode.parentIds?.length || 0) >= 2;

    const sourceRect = getNodeRect(sourceNode);
    const siblingX = sourceRect.right + 100;
    const siblingYStep = Math.max(sourceRect.height + 80, 500);
    const createGenerationClone = (
      index: number,
      totalCount: number,
      parentIds: string[],
    ): NodeData => {
      const totalHeight = (totalCount - 1) * siblingYStep;
      const startYOffset = -totalHeight / 2;

      return {
        ...sourceNode,
        id: generateUUID(),
        x: siblingX,
        y: sourceNode.y + startYOffset + (index * siblingYStep),
        status: NodeStatus.IDLE,
        loadingKind: undefined,
        resultUrl: undefined,
        resultAspectRatio: undefined,
        errorMessage: undefined,
        taskId: undefined,
        generationStartTime: undefined,
        lastFrame: undefined,
        angleMode: false,
        batchCount: 1,
        parentIds: [...parentIds],
        frameInputs: sourceNode.frameInputs?.map((input) => ({ ...input })),
        characterReferenceUrls: sourceNode.characterReferenceUrls
          ? [...sourceNode.characterReferenceUrls]
          : undefined,
      };
    };

    const hasGeneratedPlainMediaResult =
      (isPlainImageNode || isPlainVideoNode) &&
      typeof sourceNode.resultUrl === 'string' &&
      sourceNode.resultUrl.trim().length > 0;

    if (hasGeneratedPlainMediaResult) {
      if (!hasPromptSource && !isPromptOptionalKlingFrameToFrameVideo) {
        void handleGenerateSingle(id);
        return;
      }

      const cloneCount = isPlainImageNode ? batchCount : 1;
      const clonedNodes = Array.from({ length: cloneCount }, (_, index) =>
        createGenerationClone(
          index,
          cloneCount,
          (sourceNode.parentIds || []).filter((parentId) => parentId !== sourceNode.id),
        ),
      );

      setNodes((prev) => [...prev, ...clonedNodes]);
      setSelectedNodeIds(clonedNodes.map((node) => node.id));

      clonedNodes.forEach((node, index) => {
        window.setTimeout(() => {
          void handleGenerateRef.current(node.id);
        }, 150 + (index * 350));
      });
      return;
    }

    if (!isImageGenerationNode || batchCount <= 1) {
      void handleGenerateSingle(id);
      return;
    }

    if (!hasPromptSource) {
      void handleGenerateSingle(id);
      return;
    }

    const siblingCount = batchCount - 1;
    const extraParentIds =
      sourceNode.resultUrl && !sourceNode.parentIds?.includes(sourceNode.id)
        ? [sourceNode.id, ...(sourceNode.parentIds || [])]
        : [...(sourceNode.parentIds || [])];

    const clonedNodes: NodeData[] = Array.from({ length: siblingCount }, (_, index) =>
      createGenerationClone(index, siblingCount, extraParentIds),
    );

    if (clonedNodes.length > 0) {
      setNodes((prev) => [...prev, ...clonedNodes]);
    }

    void handleGenerateSingle(id);

    clonedNodes.forEach((node, index) => {
      window.setTimeout(() => {
        void handleGenerateRef.current(node.id);
      }, 150 + (index * 350));
    });
  }, [generationAccess, handleGenerateSingle, nodes, setNodes, setSelectedNodeIds]);

  React.useEffect(() => {
    handleGenerateRef.current = handleGenerate;
  }, [handleGenerate]);

  // Create new canvas
  const handleNewCanvas = () => {
    ignoreNextChange.current = true;
    pendingContentViewportSafetyCheckRef.current = false;
    pendingSelectionViewportSafetyCheckRef.current = null;
    setNodes([]);
    setGroups([]);
    setSelectedNodeIds([]);
    setViewport({ x: 0, y: 0, zoom: 1 });
    setCanvasTitle(DEFAULT_CANVAS_TITLE);
    setEditingTitleValue(DEFAULT_CANVAS_TITLE);
    resetWorkflowId();
    setIsDirty(false);
    try {
      window.localStorage.removeItem(draftStorageKey);
    } catch {}
    clearCanvasProjectQueryParam();
    // Direct-embed mode: reset project ID so next save creates a fresh project
    if (typeof window !== 'undefined' && window.parent === window) {
      const services = getCanvasHostServices();
      services?.resetProject();
    }
    // iframe mode: notify parent
    if (typeof window !== 'undefined' && window.parent !== window) {
      window.parent.postMessage({
        channel: 'xiaolou.canvasSaveBridge',
        direction: 'reset',
      }, '*');
    }
  };

  // Image editor modal
  const {
    editorModal,
    handleOpenImageEditor,
    handleCloseImageEditor,
    handleUpload
  } = useImageEditor({ nodes, updateNode });

  // Video editor modal
  const {
    videoEditorModal,
    handleOpenVideoEditor,
    handleCloseVideoEditor,
    handleExportTrimmedVideo
  } = useVideoEditor({ nodes, updateNode });

  /**
   * Routes editor open to the correct handler based on node type
   */
  const handleOpenEditor = React.useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    if (node.type === NodeType.VIDEO_EDITOR) {
      if (!features.videoEditor) return;
      handleOpenVideoEditor(nodeId);
    } else {
      if (!features.imageEditor) return;
      handleOpenImageEditor(nodeId);
    }
  }, [features.imageEditor, features.videoEditor, nodes, handleOpenVideoEditor, handleOpenImageEditor]);

  // Text node handlers
  const {
    handleWriteContent,
    handleTextToVideo,
    handleTextToImage
  } = useTextNodeHandlers({ nodes, updateNode, setNodes, setSelectedNodeIds });

  // Image node handlers
  const {
    handleImageToImage,
    handleImageToVideo,
    handleChangeAngleGenerate
  } = useImageNodeHandlers({ nodes, setNodes, setSelectedNodeIds, onGenerateNode: handleGenerate });

  // Asset handlers (create asset modal)
  const {
    isCreateAssetModalOpen,
    setIsCreateAssetModalOpen,
    nodeToSnapshot,
    handleOpenCreateAsset,
    handleSaveAssetToLibrary,
    handleContextUpload
  } = useAssetHandlers({ nodes, viewport, contextMenu, setNodes });

  const [projectAssetSyncDraft, setProjectAssetSyncDraft] = React.useState<CanvasProjectAssetSyncDraft | null>(null);
  const [isSubmittingProjectAssetSync, setIsSubmittingProjectAssetSync] = React.useState(false);

  const getSafeCanvasScreenPoint = React.useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) {
      return {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      };
    }

    const bounds = getCanvasSafeBounds(rect);
    return {
      x: (bounds.left + bounds.right) / 2,
      y: (bounds.top + bounds.bottom) / 2,
    };
  }, [canvasRef]);

  const handleShowAllElements = React.useCallback(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement) {
      return;
    }

    const nodeRects = Array.from(
      document.querySelectorAll<HTMLElement>('[data-canvas-node][data-node-id]')
    )
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0);

    if (nodeRects.length === 0) {
      return;
    }

    const safeBounds = getCanvasSafeBounds(canvasElement.getBoundingClientRect());
    const union = unionScreenRects(nodeRects);
    if (!union) {
      return;
    }

    const paddedWidth = union.width + 48;
    const paddedHeight = union.height + 48;
    const safeWidth = Math.max(1, safeBounds.right - safeBounds.left);
    const safeHeight = Math.max(1, safeBounds.bottom - safeBounds.top);
    const fitScale = Math.min(safeWidth / paddedWidth, safeHeight / paddedHeight);
    const nextZoom = Math.max(0.1, Math.min(2, viewport.zoom * fitScale));
    const unionCenterX = (union.left + union.right) / 2;
    const unionCenterY = (union.top + union.bottom) / 2;
    const worldCenterX = (unionCenterX - viewport.x) / viewport.zoom;
    const worldCenterY = (unionCenterY - viewport.y) / viewport.zoom;

    setViewport({
      x: safeBounds.centerX - (worldCenterX * nextZoom),
      y: safeBounds.centerY - (worldCenterY * nextZoom),
      zoom: nextZoom,
    });
  }, [canvasRef, setViewport, viewport.x, viewport.y, viewport.zoom]);

  const handleZoomInFromMenu = React.useCallback(() => {
    setViewport((previous) => ({ ...previous, zoom: Math.min(2, previous.zoom + 0.1) }));
  }, [setViewport]);

  const handleZoomOutFromMenu = React.useCallback(() => {
    setViewport((previous) => ({ ...previous, zoom: Math.max(0.1, previous.zoom - 0.1) }));
  }, [setViewport]);

  const handleToolbarQuickAdd = React.useCallback((type: NodeType) => {
    const { x: cx, y: cy } = getSafeCanvasScreenPoint();
    addNode(type, cx, cy, undefined, viewport);
  }, [addNode, getSafeCanvasScreenPoint, viewport]);

  // Keyboard shortcuts (copy/paste/delete/undo/redo)
  const {
    handleCopy,
    handlePaste,
    handleDuplicate
  } = useKeyboardShortcuts({
    nodes,
    selectedNodeIds,
    selectedConnection,
    setNodes,
    setSelectedNodeIds,
    setContextMenu,
    deleteNodes,
    deleteSelectedConnection,
    clearSelection,
    clearSelectionBox,
    undo,
    redo,
    onToolChange: setActiveTool,
    onQuickAddText: () => handleToolbarQuickAdd(NodeType.TEXT),
    onQuickAddImage: () => handleToolbarQuickAdd(NodeType.IMAGE)
  });

  // Auto-Save Management
  useAutoSave({
    isDirty,
    nodes,
    onSave: handleSaveWithTracking,
    interval: 60000 // Save every 60 seconds
  });

  React.useEffect(() => {
    pendingSelectionViewportSafetyCheckRef.current = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
  }, [selectedNodeIds]);

  React.useLayoutEffect(() => {
    if (!pendingContentViewportSafetyCheckRef.current || nodes.length === 0) {
      return;
    }

    let frameId = 0;
    frameId = window.requestAnimationFrame(() => {
      const canvasElement = canvasRef.current;
      if (!canvasElement) {
        return;
      }

      const nodeRects = Array.from(
        document.querySelectorAll<HTMLElement>('[data-canvas-node][data-node-id]')
      )
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);

      pendingContentViewportSafetyCheckRef.current = false;
      if (nodeRects.length === 0) {
        return;
      }

      const safeBounds = getCanvasSafeBounds(canvasElement.getBoundingClientRect());
      const hasVisibleNode = nodeRects.some((rect) => rectIntersectsBounds(rect, safeBounds));
      if (hasVisibleNode) {
        return;
      }

      const union = unionScreenRects(nodeRects);
      if (!union) {
        return;
      }

      const dx = safeBounds.centerX - (union.left + union.right) / 2;
      const dy = safeBounds.centerY - (union.top + union.bottom) / 2;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        return;
      }

      setViewport((previous) => ({
        ...previous,
        x: previous.x + dx,
        y: previous.y + dy,
      }));
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [canvasRef, nodes.length, setViewport]);

  React.useLayoutEffect(() => {
    const selectedNodeId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
    if (!selectedNodeId) {
      return;
    }

    let frameId = 0;
    frameId = window.requestAnimationFrame(() => {
      if (pendingSelectionViewportSafetyCheckRef.current !== selectedNodeId) {
        return;
      }

      const canvasElement = canvasRef.current;
      if (!canvasElement) {
        pendingSelectionViewportSafetyCheckRef.current = null;
        return;
      }

      const ownedRects = Array.from(
        document.querySelectorAll<HTMLElement>(`[data-node-owner-id="${selectedNodeId}"]`)
      )
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0);

      const nodeElement = document.querySelector<HTMLElement>(
        `[data-canvas-node][data-node-id="${selectedNodeId}"]`
      );
      const nodeRect = nodeElement?.getBoundingClientRect();
      if (nodeRect && nodeRect.width > 0 && nodeRect.height > 0) {
        ownedRects.push(nodeRect);
      }

      pendingSelectionViewportSafetyCheckRef.current = null;
      if (ownedRects.length === 0) {
        return;
      }

      const safeBounds = getCanvasSafeBounds(canvasElement.getBoundingClientRect());
      const union = unionScreenRects(ownedRects);
      if (!union) {
        return;
      }

      const { dx, dy } = getBoundsNudge(union, safeBounds);
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {
        return;
      }

      setViewport((previous) => ({
        ...previous,
        x: previous.x + dx,
        y: previous.y + dy,
      }));
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [canvasRef, selectedNodeIds, setViewport]);

  // Generation Recovery Management
  useGenerationRecovery({
    nodes,
    updateNode
  });

  // Video Frame Extraction (auto-extract lastFrame for videos missing thumbnails)
  useVideoFrameExtraction({
    nodes,
    updateNode
  });

  // TikTok Import Tool
  const {
    isModalOpen: isTikTokModalOpen,
    openModal: openTikTokModal,
    closeModal: closeTikTokModal,
    handleVideoImported: handleTikTokVideoImported
  } = useTikTokImport({
    nodes,
    setNodes,
    setSelectedNodeIds,
    viewport
  });

  // Storyboard Generator Tool
  const handleCreateStoryboardNodes = React.useCallback((
    newNodeData: Partial<NodeData>[],
    groupInfo?: { groupId: string; groupLabel: string }
  ) => {
    console.log('[Storyboard] handleCreateStoryboardNodes called with', newNodeData.length, 'nodes, groupInfo:', !!groupInfo);
    const newNodes: NodeData[] = newNodeData.map(data => ({
      id: data.id || generateUUID(),
      type: data.type || NodeType.IMAGE,
      x: data.x || 0,
      y: data.y || 0,
      prompt: data.prompt || '',
      status: data.status || NodeStatus.IDLE,
      model: data.model || DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID,
      imageModel: data.imageModel || DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID,
      aspectRatio: data.aspectRatio || '16:9',
      resolution: data.resolution || getDefaultCanvasImageResolution(data.imageModel || data.model || DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID),
      title: data.title,
      parentIds: data.parentIds || [],
      groupId: data.groupId,
      characterReferenceUrls: data.characterReferenceUrls
    }));

    setNodes(prev => [...prev, ...newNodes]);

    // Auto-group the storyboard nodes
    if (groupInfo && newNodes.length > 0) {
      const newGroup = {
        id: groupInfo.groupId,
        nodeIds: newNodes.map(n => n.id),
        label: groupInfo.groupLabel,
        // Save story context if available to help AI understand the full narrative later
        storyContext: (groupInfo as any).storyContext
      };
      setGroups(prev => [...prev, newGroup]);
    }

    if (newNodes.length > 0) {
      setSelectedNodeIds(newNodes.map(n => n.id));
    }

    // Auto-trigger generation for each storyboard node with a small delay
    // to ensure state is updated before generation starts
    if (groupInfo) {
      setTimeout(() => {
        console.log('[Storyboard] Auto-triggering generation for', newNodes.length, 'nodes');
        newNodes.forEach((node, index) => {
          // Stagger generation calls slightly to avoid overwhelming the API
          setTimeout(() => {
            console.log(`[Storyboard] Starting generation for node ${index + 1}:`, node.id);
            // Use ref to get the latest handleGenerate function
            handleGenerateRef.current(node.id);
          }, index * 500); // 500ms delay between each node
        });
      }, 100); // Initial delay to let state settle
    }
  }, [setNodes, setSelectedNodeIds, setGroups]);

  const storyboardGenerator = useStoryboardGenerator({
    onCreateNodes: handleCreateStoryboardNodes,
    viewport
  });

  const handleEditStoryboard = React.useCallback((groupId: string) => {
    const group = groups.find(g => g.id === groupId);
    if (group?.storyContext) {
      console.log('[App] Editing storyboard:', groupId);
      storyboardGenerator.editStoryboard(group.storyContext);
    }
  }, [groups, storyboardGenerator]);

  // Storyboard Video Modal State
  const [storyboardVideoModal, setStoryboardVideoModal] = useState<{
    isOpen: boolean;
    nodes: NodeData[];
    storyContext?: { story: string; scripts: any[] };
  }>({ isOpen: false, nodes: [] });

  const handleCreateStoryboardVideo = React.useCallback((targetNodeIds?: string[]) => {
    // Determine which nodes to use: explicit list or current selection
    const nodeIdsToCheck = targetNodeIds || selectedNodeIds;

    // Filter for Image nodes only (can't make video from text/video directly in this flow)
    const selectedImageNodes = nodes.filter(n => nodeIdsToCheck.includes(n.id) && n.type === NodeType.IMAGE);

    if (selectedImageNodes.length === 0) {
      console.warn("No image nodes selected for video generation. Checked IDs:", nodeIdsToCheck);
      return;
    }

    // Check if nodes belong to a group with story context
    const firstNode = selectedImageNodes[0];
    const group = firstNode.groupId ? groups.find(g => g.id === firstNode.groupId) : undefined;
    const storyContext = group?.storyContext;

    if (storyContext) {
      console.log('[App] Found Story Context for Video Modal:', {
        storyLength: storyContext.story.length,
        scriptsCount: storyContext.scripts.length
      });
    }

    setStoryboardVideoModal({
      isOpen: true,
      nodes: selectedImageNodes,
      storyContext
    });
  }, [nodes, selectedNodeIds, groups]);

  const handleGenerateStoryVideos = React.useCallback((
    prompts: Record<string, string>,
    settings: { model: string; duration: number; resolution: string; },
    activeNodeIds?: string[]
  ) => {
    // Close modal
    setStoryboardVideoModal(prev => ({ ...prev, isOpen: false }));

    const newNodes: NodeData[] = [];
    // Use activeNodeIds to filter source nodes if provided, otherwise use all
    const sourceNodes = activeNodeIds
      ? storyboardVideoModal.nodes.filter(n => activeNodeIds.includes(n.id))
      : storyboardVideoModal.nodes;

    // Calculate layout bounds of the ENTIRE storyboard to position videos to the RIGHT
    // Use all storyboard nodes to properly calculate the bounding box
    const allStoryboardNodes = storyboardVideoModal.nodes;

    // Assume a default width if not present (though images usually have it)
    const DEFAULT_WIDTH = 400;

    // Find the rightmost edge of the entire group
    const groupMaxX = Math.max(...allStoryboardNodes.map(n => n.x + ((n as any).width || DEFAULT_WIDTH)));

    // Calculate the left edge of the group to maintain relative offsets
    const groupMinX = Math.min(...allStoryboardNodes.map(n => n.x));

    // Shift Amount: Move everything to the right of the group with a gap
    const GAP_X = 100;
    const xOffset = groupMaxX + GAP_X - groupMinX;

    sourceNodes.forEach((sourceNode) => {
      // Create a new Video node for each image
      const newNodeId = generateUUID();
      const PROMPT = prompts[sourceNode.id] || sourceNode.prompt || '动画视频';

      const newVideoNode: NodeData = {
        id: newNodeId,
        type: NodeType.VIDEO,
        // Clone the layout pattern but shifted to the right
        x: sourceNode.x + xOffset,
        y: sourceNode.y,
        prompt: PROMPT,
        status: NodeStatus.IDLE, // Will switch to LOADING when generated
        model: settings.model,
        videoModel: settings.model, // Explicitly set video model
        videoDuration: settings.duration,
        aspectRatio: sourceNode.aspectRatio || '16:9',
        resolution: settings.resolution,
        parentIds: [sourceNode.id], // Connect to source image
        // groupId: undefined, // Explicitly NOT in the group
        videoMode: 'frame-to-frame', // Important for image-to-video
        inputUrl: sourceNode.resultUrl, // Pass image as input
      };

      newNodes.push(newVideoNode);
    });

    // added new nodes to state
    setNodes(prev => [...prev, ...newNodes]);

    // Auto-trigger generation (staggered)
    setTimeout(() => {
      newNodes.forEach((node, index) => {
        setTimeout(() => {
          handleGenerateRef.current(node.id);
        }, index * 1000); // 1s delay between each to avoid rate limits
      });
    }, 500);

  }, [storyboardVideoModal.nodes, setNodes]);

  // Twitter Post Modal State
  const [twitterModal, setTwitterModal] = useState<{
    isOpen: boolean;
    mediaUrl: string | null;
    mediaType: 'image' | 'video';
  }>({ isOpen: false, mediaUrl: null, mediaType: 'image' });

  const handlePostToX = React.useCallback((nodeId: string, mediaUrl: string, mediaType: 'image' | 'video') => {
    console.log('[Twitter] Opening post modal for:', nodeId, mediaUrl, mediaType);
    setTwitterModal({
      isOpen: true,
      mediaUrl,
      mediaType
    });
  }, []);

  // TikTok Post Modal State
  const [tiktokModal, setTiktokModal] = useState<{
    isOpen: boolean;
    mediaUrl: string | null;
  }>({ isOpen: false, mediaUrl: null });

  const handlePostToTikTok = React.useCallback((nodeId: string, mediaUrl: string) => {
    console.log('[TikTok] Opening post modal for:', nodeId, mediaUrl);
    setTiktokModal({
      isOpen: true,
      mediaUrl
    });
  }, []);

  // Context menu handlers
  const {
    handleDoubleClick,
    handleGlobalContextMenu,
    handleAddNext,
    handleNodeContextMenu,
    handleContextMenuCreateAsset,
    handleContextMenuSelect,
    handleToolbarAdd
  } = useContextMenuHandlers({
    nodes,
    viewport,
    contextMenu,
    setContextMenu,
    handleOpenCreateAsset,
    handleSelectTypeFromMenu
  });

  // Wrapper functions that pass closeWorkflowPanel to panel handlers
  const handleHistoryClick = (e: React.MouseEvent) => {
    panelHistoryClick(e, closeWorkflowPanel);
  };

  const handleAssetsClick = (e: React.MouseEvent) => {
    panelAssetsClick(e, closeWorkflowPanel);
  };

  const handleContextMenuAddAssets = () => {
    openAssetLibraryModal(contextMenu.y, closeWorkflowPanel);
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
   * Convert pixel dimensions to closest video aspect ratio (only 16:9 or 9:16)
   */
  const getClosestVideoAspectRatio = (width: number, height: number): string => {
    const ratio = width / height;
    // Video models only support 16:9 (1.78) and 9:16 (0.56)
    // If wider than 1:1 (ratio > 1), use 16:9; otherwise use 9:16
    return ratio >= 1 ? '16:9' : '9:16';
  };

  const handleImportImageToCanvas = React.useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      window.alert('请选择图片文件。');
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      window.alert('图片过大，最大支持 100MB。');
      return;
    }

    const { x: screenX, y: screenY } = getSafeCanvasScreenPoint();
    const previewUrl = URL.createObjectURL(file);
    const nodeId = generateUUID();
    const imageModel = normalizeCanvasImageModelId(DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID);
    const prompt = file.name.replace(/\.[^.]+$/, '') || file.name || 'Imported image';
    const canvasX = (screenX - viewport.x) / viewport.zoom - 170;
    const canvasY = (screenY - viewport.y) / viewport.zoom - 100;

    setNodes((previous) => previous.concat({
      id: nodeId,
      type: NodeType.IMAGE,
      x: canvasX,
      y: canvasY,
      prompt,
      title: prompt,
      status: NodeStatus.LOADING,
      loadingKind: 'asset-upload',
      resultUrl: previewUrl,
      model: imageModel,
      imageModel,
      aspectRatio: 'Auto',
      resolution: 'Auto',
      parentIds: [],
    }));
    setSelectedNodeIds([nodeId]);

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const assetUrl = await uploadAsset(dataUrl, 'image', `canvas-import:${prompt}`);

      await new Promise<void>((resolve) => {
        const image = new Image();
        image.onload = () => {
          setNodes((previous) => previous.map((node) => (
            node.id === nodeId
              ? {
                  ...node,
                  resultUrl: assetUrl,
                  resultAspectRatio: `${image.naturalWidth}/${image.naturalHeight}`,
                  aspectRatio: getClosestAspectRatio(image.naturalWidth, image.naturalHeight),
                  status: NodeStatus.SUCCESS,
                  loadingKind: undefined,
                  errorMessage: undefined,
                }
              : node
          )));
          resolve();
        };
        image.onerror = () => {
          setNodes((previous) => previous.map((node) => (
            node.id === nodeId
              ? {
                  ...node,
                  resultUrl: assetUrl,
                  status: NodeStatus.SUCCESS,
                  loadingKind: undefined,
                  errorMessage: undefined,
                }
              : node
          )));
          resolve();
        };
        image.src = assetUrl;
      });

      URL.revokeObjectURL(previewUrl);
    } catch (error) {
      console.error('[Canvas] Failed to import image from top menu:', error);
      setNodes((previous) => previous.map((node) => (
        node.id === nodeId
          ? {
              ...node,
              resultUrl: undefined,
              status: NodeStatus.ERROR,
              loadingKind: undefined,
              errorMessage: '导入图片失败，请重试。',
            }
          : node
      )));
      URL.revokeObjectURL(previewUrl);
    }
  }, [getSafeCanvasScreenPoint, setNodes, setSelectedNodeIds, viewport.x, viewport.y, viewport.zoom]);

  const handleImportMediaFilesToCanvas = React.useCallback((
    files: File[],
    screenPoint?: { x: number; y: number },
  ) => {
    const mediaFiles = files
      .map((file) => ({ file, kind: getCanvasMediaImportKind(file) }))
      .filter((item): item is { file: File; kind: CanvasMediaImportKind } => Boolean(item.kind));

    if (mediaFiles.length === 0) {
      window.alert('仅支持拖入或粘贴图片、视频文件。');
      return;
    }

    const oversized = mediaFiles.find(({ file }) => file.size > CANVAS_MEDIA_IMPORT_MAX_BYTES);
    if (oversized) {
      window.alert(`${oversized.file.name || '文件'} 过大，最大支持 100MB。`);
      return;
    }

    const fallbackPoint = getSafeCanvasScreenPoint();
    const origin = screenPoint || fallbackPoint;
    const createdIds: string[] = [];

    mediaFiles.forEach(({ file, kind }, index) => {
      const isVideo = kind === 'video';
      const nodeId = generateUUID();
      const prompt = getFileStem(file);
      const previewUrl = URL.createObjectURL(file);
      const x = (origin.x - viewport.x) / viewport.zoom - 170 + index * 36;
      const y = (origin.y - viewport.y) / viewport.zoom - 100 + index * 36;
      const imageModel = normalizeCanvasImageModelId(DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID);
      const videoModel = DEFAULT_XIAOLOU_IMAGE_TO_VIDEO_MODEL_ID;

      const pendingNode: NodeData = {
        id: nodeId,
        type: isVideo ? NodeType.VIDEO : NodeType.IMAGE,
        x,
        y,
        prompt,
        title: prompt,
        status: NodeStatus.LOADING,
        loadingKind: 'asset-upload',
        resultUrl: previewUrl,
        model: isVideo ? videoModel : imageModel,
        videoModel: isVideo ? videoModel : undefined,
        imageModel: isVideo ? undefined : imageModel,
        aspectRatio: isVideo ? '16:9' : 'Auto',
        resolution: isVideo ? 'Auto' : getDefaultCanvasImageResolution(imageModel),
        parentIds: [],
      };

      createdIds.push(nodeId);
      setNodes((previous) => previous.concat(pendingNode));

      void (async () => {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          const assetUrl = await uploadAsset(dataUrl, kind, `canvas-import:${prompt}`);

          if (kind === 'image') {
            const img = new Image();
            await new Promise<void>((resolve) => {
              img.onload = () => {
                setNodes((previous) => previous.map((node) => (
                  node.id === nodeId
                    ? {
                        ...node,
                        resultUrl: assetUrl,
                        resultAspectRatio: `${img.naturalWidth}/${img.naturalHeight}`,
                        aspectRatio: getClosestAspectRatio(img.naturalWidth, img.naturalHeight),
                        status: NodeStatus.SUCCESS,
                        loadingKind: undefined,
                        errorMessage: undefined,
                      }
                    : node
                )));
                resolve();
              };
              img.onerror = () => {
                setNodes((previous) => previous.map((node) => (
                  node.id === nodeId
                    ? {
                        ...node,
                        resultUrl: assetUrl,
                        status: NodeStatus.SUCCESS,
                        loadingKind: undefined,
                        errorMessage: undefined,
                      }
                    : node
                )));
                resolve();
              };
              img.src = assetUrl;
            });
          } else {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;
            await new Promise<void>((resolve) => {
              video.onloadedmetadata = () => {
                const width = video.videoWidth;
                const height = video.videoHeight;
                setNodes((previous) => previous.map((node) => (
                  node.id === nodeId
                    ? {
                        ...node,
                        resultUrl: assetUrl,
                        resultAspectRatio: width && height ? `${width}/${height}` : undefined,
                        aspectRatio: width && height ? getClosestVideoAspectRatio(width, height) : '16:9',
                        status: NodeStatus.SUCCESS,
                        loadingKind: undefined,
                        errorMessage: undefined,
                      }
                    : node
                )));
                resolve();
              };
              video.onerror = () => {
                setNodes((previous) => previous.map((node) => (
                  node.id === nodeId
                    ? {
                        ...node,
                        resultUrl: assetUrl,
                        status: NodeStatus.SUCCESS,
                        loadingKind: undefined,
                        errorMessage: undefined,
                      }
                    : node
                )));
                resolve();
              };
              video.src = assetUrl;
            });
          }
        } catch (error) {
          console.error('[Canvas] Failed to import dropped/pasted media:', error);
          setNodes((previous) => previous.map((node) => (
            node.id === nodeId
              ? {
                  ...node,
                  resultUrl: undefined,
                  status: NodeStatus.ERROR,
                  loadingKind: undefined,
                  errorMessage: '导入媒体失败，请重试。',
                }
              : node
          )));
        } finally {
          URL.revokeObjectURL(previewUrl);
        }
      })();
    });

    if (createdIds.length > 0) {
      setSelectedNodeIds(createdIds);
      setContextMenu((previous) => ({ ...previous, isOpen: false }));
      closeWorkflowPanel();
      closeHistoryPanel();
      closeAssetLibrary();
    }
  }, [
    closeAssetLibrary,
    closeHistoryPanel,
    closeWorkflowPanel,
    getSafeCanvasScreenPoint,
    setNodes,
    setSelectedNodeIds,
    viewport.x,
    viewport.y,
    viewport.zoom,
  ]);

  const handleNavigateHomeFromMenu = React.useCallback(() => {
    if (typeof window !== 'undefined') {
      window.location.assign('/home');
    }
  }, []);

  const handleOpenProjectLibraryFromMenu = React.useCallback(() => {
    if (typeof window !== 'undefined') {
      window.location.assign('/assets');
    }
  }, []);

  const handleDeleteCurrentProjectFromMenu = React.useCallback(async () => {
    if (!queryCanvasProjectId) {
      window.alert('当前画布还没有保存成项目，暂时无法删除。');
      return;
    }

    const services = getCanvasHostServices();
    if (!services?.deleteProject) {
      window.alert('当前环境暂不支持删除项目。');
      return;
    }

    try {
      await services.deleteProject(queryCanvasProjectId);
      handleNewCanvas();
    } catch (error) {
      console.error('[Canvas] Failed to delete current project:', error);
      window.alert('删除当前项目失败，请稍后重试。');
    }
  }, [handleNewCanvas, queryCanvasProjectId]);

  /**
   * Handle selecting an asset from history - creates new node with the image/video
   */
  const handleSelectAsset = (type: 'images' | 'videos', url: string, prompt: string, model?: string) => {
    // Calculate position at center of canvas
    const centerX = (window.innerWidth / 2 - viewport.x) / viewport.zoom - 170;
    const centerY = (window.innerHeight / 2 - viewport.y) / viewport.zoom - 150;

    // Create node with detected aspect ratio
    const createNode = (resultAspectRatio?: string, aspectRatio?: string) => {
      const isVideo = type === 'videos';
      // Use the original model from asset metadata, or fall back to defaults
      const defaultModel = isVideo ? DEFAULT_XIAOLOU_IMAGE_TO_VIDEO_MODEL_ID : DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID;
      const nodeModel = isVideo ? (model || defaultModel) : normalizeCanvasImageModelId(model || defaultModel);

      const newNode: NodeData = {
        id: Date.now().toString(),
        type: isVideo ? NodeType.VIDEO : NodeType.IMAGE,
        x: centerX,
        y: centerY,
        prompt: prompt,
        status: NodeStatus.SUCCESS,
        resultUrl: url,
        resultAspectRatio,
        model: nodeModel,
        videoModel: isVideo ? nodeModel : undefined,
        imageModel: !isVideo ? normalizeCanvasImageModelId(nodeModel) : undefined,
        aspectRatio: aspectRatio || '16:9',
        resolution: isVideo ? 'Auto' : getDefaultCanvasImageResolution(nodeModel)
      };

      setNodes(prev => [...prev, newNode]);
      closeHistoryPanel();
      closeAssetLibrary();
    };

    if (type === 'images') {
      // Detect image dimensions
      const img = new Image();
      img.onload = () => {
        const resultAspectRatio = `${img.naturalWidth}/${img.naturalHeight}`;
        const aspectRatio = getClosestAspectRatio(img.naturalWidth, img.naturalHeight);
        console.log(`[App] Image loaded: ${img.naturalWidth}x${img.naturalHeight} -> ${aspectRatio}`);
        createNode(resultAspectRatio, aspectRatio);
      };
      img.onerror = () => {
        console.log('[App] Image load error, using default 16:9');
        createNode(undefined, '16:9');
      };
      img.src = url;
    } else {
      // Detect video dimensions
      const video = document.createElement('video');
      video.onloadedmetadata = () => {
        const resultAspectRatio = `${video.videoWidth}/${video.videoHeight}`;
        // Use video-specific function that only returns 16:9 or 9:16
        const aspectRatio = getClosestVideoAspectRatio(video.videoWidth, video.videoHeight);
        console.log(`[App] Video loaded: ${video.videoWidth}x${video.videoHeight} -> ${aspectRatio}`);
        createNode(resultAspectRatio, aspectRatio);
      };
      video.onerror = () => {
        console.log('[App] Video load error, using default 16:9');
        createNode(undefined, '16:9');
      };
      video.src = url;
    }
  };

  // Asset library pick target. `null` → default behavior (create a new node).
  const handleAttachImageReferences = React.useCallback(async (
    targetNodeId: string,
    imageSources: CanvasNodeUploadSource[],
  ) => {
    const targetNode = nodes.find((node) => node.id === targetNodeId);
    if (!targetNode || imageSources.length === 0) return;

    const normalizedImageModel = normalizeCanvasImageModelId(DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID);
    const existingReferenceUrls = new Set(
      (targetNode.parentIds || [])
        .map((parentId) => nodes.find((node) => node.id === parentId)?.resultUrl)
        .filter((url): url is string => typeof url === 'string' && url.trim().length > 0),
    );

    const resolvedSources: Array<{ url: string; label: string }> = [];

    for (const source of imageSources) {
      try {
        if (isCanvasFileUploadSource(source) && !source.type.startsWith('image/')) {
          console.warn('[Canvas] Ignored non-image reference upload:', source.name);
          continue;
        }

        let resolvedUrl = '';
        let label = '参考图';

        if (isCanvasFileUploadSource(source)) {
          const dataUrl = await readFileAsDataUrl(source);
          resolvedUrl = await uploadAsset(dataUrl, 'image', `canvas-reference:${targetNodeId}`);
          label = source.name || label;
        } else if (typeof source === 'string' && source.startsWith('data:')) {
          resolvedUrl = await uploadAsset(source, 'image', `canvas-reference:${targetNodeId}`);
        } else {
          resolvedUrl = source;
        }

        if (!resolvedUrl || existingReferenceUrls.has(resolvedUrl) || resolvedSources.some((item) => item.url === resolvedUrl)) {
          continue;
        }

        resolvedSources.push({ url: resolvedUrl, label });
      } catch (error) {
        console.error('[Canvas] Failed to attach image reference source:', error);
      }
    }

    if (resolvedSources.length === 0) return;

    const baseParentCount = targetNode.parentIds?.length || 0;
    const defaultReferenceResolution = getDefaultCanvasImageResolution(normalizedImageModel);
    const createdReferenceNodes = await Promise.all(
      resolvedSources.map(async (source, index) => {
        const referenceNode: NodeData = {
          id: generateUUID(),
          type: NodeType.IMAGE,
          x: targetNode.x - 440,
          y: targetNode.y + (baseParentCount + index) * 120,
          prompt: source.label,
          status: NodeStatus.SUCCESS,
          resultUrl: source.url,
          model: normalizedImageModel,
          imageModel: normalizedImageModel,
          aspectRatio: '16:9',
          resolution: defaultReferenceResolution,
          parentIds: [],
          title: '参考图',
        };

        try {
          const image = new Image();
          await new Promise<void>((resolve) => {
            image.onload = () => {
              referenceNode.resultAspectRatio = `${image.naturalWidth}/${image.naturalHeight}`;
              referenceNode.aspectRatio = getClosestAspectRatio(image.naturalWidth, image.naturalHeight);
              resolve();
            };
            image.onerror = () => resolve();
            image.src = source.url;
          });
        } catch {
          // Ignore metadata failures and keep defaults.
        }

        return referenceNode;
      }),
    );

    setNodes((prev) => {
      if (!prev.some((node) => node.id === targetNodeId)) {
        return prev;
      }

      const appendedIds = createdReferenceNodes.map((node) => node.id);
      return prev
        .map((node) => {
          if (node.id !== targetNodeId) return node;
          const currentParentIds = node.parentIds || [];
          return {
            ...node,
            parentIds: [...currentParentIds, ...appendedIds.filter((id) => !currentParentIds.includes(id))],
          };
        })
        .concat(createdReferenceNodes);
    });
  }, [nodes, setNodes]);

  const [libraryPickTarget, setLibraryPickTarget] = React.useState<
    { nodeId: string } | null
  >(null);

  const handlePickFromLibraryForNode = React.useCallback((nodeId: string) => {
    setLibraryPickTarget({ nodeId });
    openAssetLibraryModal(0, () => {});
  }, [openAssetLibraryModal]);

  const handleLibrarySelect = (url: string, type: 'image' | 'video') => {
    if (libraryPickTarget) {
      const { nodeId } = libraryPickTarget;
      if (type !== 'image') {
        window.alert('图片生成器目前只支持添加图片参考图。');
        return;
      }
      void handleAttachImageReferences(nodeId, [url]);
      setLibraryPickTarget(null);
      closeAssetLibrary();
      return;
    } else {
      handleSelectAsset(type === 'image' ? 'images' : 'videos', url, '素材库资源');
    }
    closeAssetLibrary();
  };

  const handleOpenProjectAssetSync = React.useCallback((draft: CanvasProjectAssetSyncDraft) => {
    if (!canUseXiaolouAssetBridge()) {
      return;
    }
    setProjectAssetSyncDraft(draft);
  }, []);

  const handleOpenProjectAssetSyncForNode = React.useCallback((nodeId: string) => {
    const node = nodes.find((item) => item.id === nodeId);
    const draft = node ? buildProjectAssetSyncDraft(node) : null;
    if (!draft || !canUseXiaolouAssetBridge()) {
      return;
    }
    setProjectAssetSyncDraft(draft);
  }, [nodes]);

  const handleSubmitProjectAssetSync = React.useCallback(async (payload: {
    assetType: string;
    name: string;
    description?: string;
    previewUrl?: string | null;
    mediaKind: 'image' | 'video';
    mediaUrl?: string | null;
    sourceTaskId?: string | null;
    sourceModule: 'canvas';
    generationPrompt?: string;
    imageModel?: string;
    aspectRatio?: string;
    scope: 'manual';
  }) => {
    setIsSubmittingProjectAssetSync(true);
    try {
      await createXiaolouAsset(payload);
      setProjectAssetSyncDraft(null);
    } catch (error) {
      console.error('[Canvas] Failed to sync asset to XiaoLou project library:', error);
      alert('同步到项目资产库失败，请稍后重试。');
    } finally {
      setIsSubmittingProjectAssetSync(false);
    }
  }, []);

  const handleAttachAssetToVideoNode = React.useCallback(async (
    targetNodeId: string,
    url: string,
    type: 'image' | 'video' | 'audio'
  ) => {
    if (type === 'audio') {
      console.warn('[Canvas] Audio assets are not attachable to video generation nodes yet.');
      return;
    }

    const targetNode = nodes.find(n => n.id === targetNodeId);
    if (!targetNode) return;

    const sourceNodeId = generateUUID();
    const existingParentCount = targetNode.parentIds?.length || 0;
    const sourceX = targetNode.x - 440;
    const sourceY = targetNode.y + existingParentCount * 120;
    const isVideo = type === 'video';
    const defaultModel = isVideo ? DEFAULT_XIAOLOU_IMAGE_TO_VIDEO_MODEL_ID : DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID;
    const normalizedImageModel = normalizeCanvasImageModelId(defaultModel);
    const defaultImageResolution = getDefaultCanvasImageResolution(normalizedImageModel);

    const appendSourceNode = (partial: Partial<NodeData>) => {
      const sourceNode: NodeData = {
        id: sourceNodeId,
        type: isVideo ? NodeType.VIDEO : NodeType.IMAGE,
        x: sourceX,
        y: sourceY,
        prompt: '上传素材',
        status: NodeStatus.SUCCESS,
        resultUrl: url,
        model: isVideo ? defaultModel : normalizedImageModel,
        videoModel: isVideo ? defaultModel : undefined,
        imageModel: !isVideo ? normalizedImageModel : undefined,
        aspectRatio: '16:9',
        resolution: isVideo ? 'Auto' : defaultImageResolution,
        parentIds: [],
        title: isVideo ? '参考视频' : '参考图',
        ...partial,
      };

      setNodes(prev => prev
        .map(node => {
          if (node.id !== targetNodeId) return node;
          const currentParentIds = node.parentIds || [];
          if (currentParentIds.includes(sourceNodeId)) return node;
          return { ...node, parentIds: [...currentParentIds, sourceNodeId] };
        })
        .concat(sourceNode));
    };

    if (isVideo) {
      const video = document.createElement('video');
      video.onloadedmetadata = async () => {
        const resultAspectRatio = `${video.videoWidth}/${video.videoHeight}`;
        const aspectRatio = getClosestVideoAspectRatio(video.videoWidth, video.videoHeight);
        let lastFrame: string | undefined;
        try {
          lastFrame = await extractVideoLastFrame(url);
        } catch (error) {
          console.warn('[Canvas] Failed to extract last frame from uploaded reference video:', error);
        }
        appendSourceNode({
          resultAspectRatio,
          aspectRatio,
          lastFrame,
        });
      };
      video.onerror = () => appendSourceNode({});
      video.src = url;
      return;
    }

    const image = new Image();
    image.onload = () => {
      const resultAspectRatio = `${image.naturalWidth}/${image.naturalHeight}`;
      const aspectRatio = getClosestAspectRatio(image.naturalWidth, image.naturalHeight);
      appendSourceNode({
        resultAspectRatio,
        aspectRatio,
      });
    };
    image.onerror = () => appendSourceNode({});
    image.src = url;
  }, [nodes, setNodes]);

  // ─── Frame-slot handlers (first-last-frame mode) ──────────────────────────
  //
  // Each slot ('start' | 'end') holds exactly one image node.
  // These handlers replace (not append) the slot assignment.

  const handleSetFrameSlot = React.useCallback(async (
    targetNodeId: string,
    url: string,
    slot: 'start' | 'end',
  ) => {
    const targetNode = nodes.find(n => n.id === targetNodeId);
    if (!targetNode) return;

    const existingFrameInput = (targetNode.frameInputs || []).find(f => f.order === slot);
    const oldSlotNodeId = existingFrameInput?.nodeId;

    const slotTitle = slot === 'start' ? '首帧' : '尾帧';
    const yOffset = slot === 'start' ? 0 : 140;
    const newNodeId = generateUUID();

    const normalizedImageModel = normalizeCanvasImageModelId(DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID);
    const defaultImageResolution = getDefaultCanvasImageResolution(normalizedImageModel);

    const newSourceNode: NodeData = {
      id: newNodeId,
      type: NodeType.IMAGE,
      x: targetNode.x - 440,
      y: targetNode.y + yOffset,
      prompt: slotTitle,
      status: NodeStatus.SUCCESS,
      resultUrl: url,
      model: normalizedImageModel,
      imageModel: normalizedImageModel,
      aspectRatio: '16:9',
      resolution: defaultImageResolution,
      parentIds: [],
      title: slotTitle,
    };

    // Detect aspect ratio
    try {
      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => {
          newSourceNode.resultAspectRatio = `${img.naturalWidth}/${img.naturalHeight}`;
          newSourceNode.aspectRatio = getClosestAspectRatio(img.naturalWidth, img.naturalHeight);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = url;
      });
    } catch { /* ignore */ }

    setNodes(prev => {
      const oldNode = oldSlotNodeId ? prev.find(n => n.id === oldSlotNodeId) : null;
      // Remove old placeholder node only if it was a frame-slot node and has no other connections
      const shouldRemoveOld = oldNode &&
        (oldNode.title === '首帧' || oldNode.title === '尾帧') &&
        !prev.some(n => n.id !== targetNodeId && (n.parentIds || []).includes(oldSlotNodeId!));

      return prev
        .filter(n => shouldRemoveOld ? n.id !== oldSlotNodeId : true)
        .map(n => {
          if (n.id !== targetNodeId) return n;
          const parentIds = (n.parentIds || []).filter(pid => pid !== oldSlotNodeId);
          const frameInputs = (n.frameInputs || []).filter(f => f.order !== slot);
          return {
            ...n,
            parentIds: [...parentIds, newNodeId],
            frameInputs: [...frameInputs, { nodeId: newNodeId, order: slot }],
          };
        })
        .concat(newSourceNode);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, setNodes]);

  const handleClearFrameSlot = React.useCallback((
    targetNodeId: string,
    slot: 'start' | 'end',
  ) => {
    setNodes(prev => {
      const targetNode = prev.find(n => n.id === targetNodeId);
      if (!targetNode) return prev;

      const frameInput = (targetNode.frameInputs || []).find(f => f.order === slot);
      const slotNodeId = frameInput?.nodeId;

      const slotNode = slotNodeId ? prev.find(n => n.id === slotNodeId) : null;
      const shouldRemove = slotNode &&
        (slotNode.title === '首帧' || slotNode.title === '尾帧') &&
        !prev.some(n => n.id !== targetNodeId && (n.parentIds || []).includes(slotNodeId!));

      return prev
        .filter(n => shouldRemove ? n.id !== slotNodeId : true)
        .map(n => {
          if (n.id !== targetNodeId) return n;
          return {
            ...n,
            parentIds: (n.parentIds || []).filter(pid => pid !== slotNodeId),
            frameInputs: (n.frameInputs || []).filter(f => f.order !== slot),
          };
        });
    });
  }, [setNodes]);

  const handleSetCanvasNodeAsFrameSlot = React.useCallback((
    targetNodeId: string,
    canvasNodeId: string,
    slot: 'start' | 'end',
  ) => {
    setNodes(prev => {
      const targetNode = prev.find(n => n.id === targetNodeId);
      if (!targetNode) return prev;

      const existingInput = (targetNode.frameInputs || []).find(f => f.order === slot);
      const oldSlotNodeId = existingInput?.nodeId;
      if (oldSlotNodeId === canvasNodeId) return prev; // no change

      const oldNode = oldSlotNodeId ? prev.find(n => n.id === oldSlotNodeId) : null;
      const shouldRemoveOld = oldNode &&
        (oldNode.title === '首帧' || oldNode.title === '尾帧') &&
        !prev.some(n => n.id !== targetNodeId && (n.parentIds || []).includes(oldSlotNodeId!));

      return prev
        .filter(n => shouldRemoveOld ? n.id !== oldSlotNodeId : true)
        .map(n => {
          if (n.id !== targetNodeId) return n;
          const parentIds = (n.parentIds || []).filter(pid => pid !== oldSlotNodeId);
          const frameInputs = (n.frameInputs || []).filter(f => f.order !== slot);
          const finalParentIds = parentIds.includes(canvasNodeId) ? parentIds : [...parentIds, canvasNodeId];
          return {
            ...n,
            parentIds: finalParentIds,
            frameInputs: [...frameInputs, { nodeId: canvasNodeId, order: slot }],
          };
        });
    });
  }, [setNodes]);

  // Create asset modal (isCreateAssetModalOpen, handleOpenCreateAsset, handleSaveAssetToLibrary) provided by useAssetHandlers hook

  // ============================================================================
  // EFFECTS
  // ============================================================================

  // Prevent default zoom behavior
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleNativeWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
      }
    };

    canvas.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleNativeWheel);
  }, []);

  useEffect(() => {
    const handleNativePaste = (event: ClipboardEvent) => {
      if (isCanvasEditableEventTarget(event.target)) return;

      const files = getCanvasMediaFiles(event.clipboardData);
      if (files.length === 0) return;

      event.preventDefault();
      handleImportMediaFilesToCanvas(files);
    };

    window.addEventListener('paste', handleNativePaste);
    return () => window.removeEventListener('paste', handleNativePaste);
  }, [handleImportMediaFilesToCanvas]);

  // Keyboard shortcuts (handleCopy, handlePaste, handleDuplicate) provided by useKeyboardShortcuts hook

  // Cleanup invalid groups (groups with less than 2 nodes)
  useEffect(() => {
    cleanupInvalidGroups(nodes, setNodes);
  }, [nodes, cleanupInvalidGroups]);

  // Track state changes for undo/redo (only after drag ends, not during)
  const isApplyingHistory = React.useRef(false);

  useEffect(() => {
    // Don't push to history if we're currently applying history (undo/redo)
    if (isApplyingHistory.current) {
      isApplyingHistory.current = false;
      return;
    }

    // Don't push to history while dragging (wait until drag ends)
    if (isDragging) {
      return;
    }

    // Push to history when nodes or groups change
    pushHistory({ nodes, groups });
  }, [nodes, groups, isDragging]);

  // Apply history state when undo/redo is triggered
  // IMPORTANT: Don't revert nodes if any node is in LOADING status (generation in progress)
  useEffect(() => {
    // Skip if any node is currently generating - don't interrupt the loading state
    const hasLoadingNode = nodes.some(n => n.status === NodeStatus.LOADING);
    if (hasLoadingNode) {
      return;
    }

    if (historyState.nodes !== nodes) {
      isApplyingHistory.current = true;
      setNodes(historyState.nodes);
    }
  }, [historyState]);

  // Simple wrapper for updateNode (sync code removed - TEXT node prompts are combined at generation time)
  const updateNodeWithSync = React.useCallback((id: string, updates: Partial<NodeData>) => {
    updateNode(id, updates);
  }, [updateNode]);

  const handleDeleteConnection = React.useCallback((parentId: string, childId: string) => {
    setNodes(prev => prev.map(n => {
      if (n.id === childId) {
        const existingParents = n.parentIds || [];
        return { ...n, parentIds: existingParents.filter(pid => pid !== parentId) };
      }
      return n;
    }));
    setSelectedConnection(null);
  }, [setNodes, setSelectedConnection]);

  // ============================================================================
  // EVENT HANDLERS
  // ============================================================================

  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).id === 'canvas-background') {
      if (e.button === 0) {
        if (activeTool === 'hand') {
          startPanning(e);
          setSelectedConnection(null);
          setContextMenu(prev => ({ ...prev, isOpen: false }));
        } else {
          startSelection(e);
          clearSelection();
          setSelectedConnection(null);
          setContextMenu(prev => ({ ...prev, isOpen: false }));
          closeWorkflowPanel();
          closeHistoryPanel();
          closeAssetLibrary();
        }
      } else {
        startPanning(e);
        setSelectedConnection(null);
        setContextMenu(prev => ({ ...prev, isOpen: false }));
      }
    }
  };

  const handleGlobalPointerMove = (e: React.PointerEvent) => {
    // 0. Node resize takes priority — we only arm the resize state when the
    // user presses on a corner handle, so this check is effectively free
    // the rest of the time.
    if (updateResize(e, setNodes)) return;

    // 1. Handle Selection Box Update
    if (updateSelection(e)) return;

    // 2. Handle Node Dragging
    if (updateNodeDrag(e, viewport, setNodes, selectedNodeIds)) return;

    // 3. Handle Connection Dragging
    if (updateConnectionDrag(e, nodes, viewport)) return;

    // 4. Handle Canvas Panning (disabled when selection box is active)
    if (!isSelecting) {
      updatePanning(e, setViewport);
    }
  };

  /**
   * Handle when a connection is made between nodes
   * Syncs prompt if parent is a Text node
   */
  const handleConnectionMade = React.useCallback((parentId: string, childId: string) => {
    // Find the parent node
    const parentNode = nodes.find(n => n.id === parentId);
    if (!parentNode) return;

    // If parent is a Text node, sync its prompt to the child
    if (parentNode.type === NodeType.TEXT && parentNode.prompt) {
      updateNode(childId, { prompt: parentNode.prompt });
    }
  }, [nodes, updateNode]);

  const handleSameTypeMediaConnection = React.useCallback((choice: SameTypeMediaConnectionChoice) => {
    setPendingReferenceChoice(choice);
  }, []);

  const handleReferenceChoiceConfirm = React.useCallback((referenceId: string) => {
    if (!pendingReferenceChoice) return;

    const childId = pendingReferenceChoice.sourceId === referenceId
      ? pendingReferenceChoice.targetId
      : pendingReferenceChoice.sourceId;

    const referenceNode = nodes.find(n => n.id === referenceId);
    const childNode = nodes.find(n => n.id === childId);

    if (!referenceNode || !childNode) {
      setPendingReferenceChoice(null);
      return;
    }

    setNodes(prev => prev.map(n => {
      if (n.id !== childId) return n;

      const existingParents = n.parentIds || [];
      const parentIds = existingParents.includes(referenceId)
        ? existingParents
        : [...existingParents, referenceId];

      if (pendingReferenceChoice.mediaType === NodeType.VIDEO && n.type === NodeType.VIDEO) {
        return {
          ...n,
          parentIds,
          videoMode: 'standard',
          frameInputs: undefined,
        };
      }

      return { ...n, parentIds };
    }));
    handleConnectionMade(referenceId, childId);
    setPendingReferenceChoice(null);
  }, [handleConnectionMade, nodes, pendingReferenceChoice, setNodes]);

  const handleGlobalPointerUp = (e: React.PointerEvent) => {
    // 1. Handle Selection Box End
    if (isSelecting) {
      const selectedIds = endSelection(nodes, viewport);
      setSelectedNodeIds(selectedIds);
      releasePointerCapture(e);
      return;
    }

    // 2. Handle Connection Drop
    if (completeConnectionDrag(handleAddNext, setNodes, nodes, handleConnectionMade, handleSameTypeMediaConnection)) {
      releasePointerCapture(e);
      return;
    }

    // 3. Stop Panning
    endPanning();

    // 4. Stop Node Dragging
    endNodeDrag();

    // 5. Stop Node Resizing (no-op if not active)
    endResize();

    // 5. Release capture
    releasePointerCapture(e);
  };

  const handleCanvasDragOver = React.useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(e.dataTransfer)) return;

    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleCanvasDrop = React.useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(e.dataTransfer)) return;

    e.preventDefault();
    e.stopPropagation();

    const files = getCanvasMediaFiles(e.dataTransfer);
    if (files.length === 0) {
      window.alert('仅支持拖入图片、视频文件。');
      return;
    }

    handleImportMediaFilesToCanvas(files, { x: e.clientX, y: e.clientY });
  }, [handleImportMediaFilesToCanvas]);

  const storyboardModalActive = features.storyboard && storyboardGenerator.isModalOpen;
  const tiktokModalActive = features.tiktokImport && isTikTokModalOpen;
  const shouldHideGlobalChrome = storyboardModalActive || tiktokModalActive;

  // Context menu handlers provided by useContextMenuHandlers hook
  // handleDoubleClick, handleGlobalContextMenu, handleAddNext, handleNodeContextMenu,
  // handleContextMenuCreateAsset, handleContextMenuSelect, handleToolbarAdd

  // Pre-compute stable per-node derived props so CanvasNode memo can skip re-renders
  const nodeInputUrls = React.useMemo(() => {
    const map = new Map<string, string | undefined>();
    for (const node of nodes) {
      if (!node.parentIds || node.parentIds.length === 0) {
        map.set(node.id, undefined);
        continue;
      }
      const parent = nodes.find(n => n.id === node.parentIds![0]);
      if (node.type === NodeType.VIDEO_EDITOR && parent?.type === NodeType.VIDEO) {
        map.set(node.id, parent.resultUrl);
      } else if (parent?.type === NodeType.VIDEO && parent.lastFrame) {
        map.set(node.id, parent.lastFrame);
      } else {
        map.set(node.id, parent?.resultUrl);
      }
    }
    return map;
  }, [nodes]);

  const nodeConnectedImages = React.useMemo(() => {
    const map = new Map<string, { id: string; url: string; type?: NodeType }[]>();
    for (const node of nodes) {
      if (!node.parentIds || node.parentIds.length === 0) {
        map.set(node.id, []);
        continue;
      }
      const items = node.parentIds
        .map(pid => nodes.find(n => n.id === pid))
        .filter(p => p && (p.type === NodeType.IMAGE || p.type === NodeType.VIDEO) && p.resultUrl)
        .map(p => ({
          id: p!.id,
          url: (p!.type === NodeType.VIDEO ? p!.lastFrame : p!.resultUrl) || p!.resultUrl!,
          type: p!.type,
        }));
      map.set(node.id, items);
    }
    return map;
  }, [nodes]);

  const availableCanvasNodes = React.useMemo(() => {
    return nodes
      .filter(n => (n.type === NodeType.IMAGE || n.type === NodeType.VIDEO) && n.resultUrl)
      .map(n => ({
        id: n.id,
        url: (n.type === NodeType.VIDEO ? n.lastFrame : n.resultUrl) || n.resultUrl!,
        type: n.type,
      }));
  }, [nodes]);

  const pendingReferenceSourceNode = pendingReferenceChoice
    ? nodes.find(n => n.id === pendingReferenceChoice.sourceId)
    : undefined;
  const pendingReferenceTargetNode = pendingReferenceChoice
    ? nodes.find(n => n.id === pendingReferenceChoice.targetId)
    : undefined;
  const pendingReferenceTitle = pendingReferenceChoice?.mediaType === NodeType.VIDEO
    ? '选择参考画面'
    : '选择参考图片';
  const pendingReferenceDescription = pendingReferenceChoice?.mediaType === NodeType.VIDEO
    ? '请选择哪个视频画面作为参考图，另一个视频节点会使用它生成。'
    : '请选择哪张图片作为参考图，另一张图片节点会使用它生成。';

  const renderReferenceChoiceOption = (node: NodeData | undefined, fallback: string) => {
    if (!node) return null;

    const label = getReferenceChoiceLabel(node, fallback);

    return (
      <button
        key={node.id}
        type="button"
        onClick={() => handleReferenceChoiceConfirm(node.id)}
        className={`group flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg border text-left transition-colors ${canvasTheme === 'dark'
          ? 'border-neutral-700 bg-[#14130f] hover:border-blue-400/70'
          : 'border-neutral-200 bg-white hover:border-blue-400/70'
          }`}
      >
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-black">
          {node.type === NodeType.VIDEO ? (
            node.lastFrame ? (
              <img src={node.lastFrame} alt={label} className="h-full w-full object-cover" draggable={false} />
            ) : node.resultUrl ? (
              <video src={node.resultUrl} className="h-full w-full object-cover" muted playsInline preload="metadata" />
            ) : (
              <div className="flex h-full items-center justify-center text-xs text-neutral-500">暂无预览</div>
            )
          ) : getReferenceChoicePreviewUrl(node) ? (
            <img src={getReferenceChoicePreviewUrl(node)} alt={label} className="h-full w-full object-cover" draggable={false} />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-neutral-500">暂无预览</div>
          )}
        </div>
        <div className="min-w-0 px-3 py-2">
          <div className={`truncate text-sm font-medium ${canvasTheme === 'dark' ? 'text-[#f5f4ef]' : 'text-[#100f09]'}`}>
            {label}
          </div>
          <div className={`mt-0.5 text-xs ${canvasTheme === 'dark' ? 'text-neutral-400' : 'text-neutral-500'}`}>
            作为参考
          </div>
        </div>
      </button>
    );
  };

  return (
    <div className={`relative h-full w-full ${canvasTheme === 'dark' ? 'bg-[#100f09] text-[#f5f4ef]' : 'bg-[#f9f8f6] text-[#100f09]'} overflow-hidden select-none font-sans transition-colors duration-300`}>
      {!shouldHideGlobalChrome && (
        <CanvasToolbar
          activeTool={activeTool}
          onToolChange={setActiveTool}
          onAddText={() => handleToolbarQuickAdd(NodeType.TEXT)}
          onAddImage={() => handleToolbarQuickAdd(NodeType.IMAGE)}
          onAddVideo={() => handleToolbarQuickAdd(NodeType.VIDEO)}
          zoom={viewport.zoom}
          onZoomChange={(z) => setViewport(prev => ({ ...prev, zoom: z }))}
          canvasTheme={canvasTheme}
          onWorkflowsClick={features.workflows ? handleWorkflowsClick : undefined}
          onAssetsClick={features.assets ? handleAssetsClick : undefined}
          onHistoryClick={features.history ? handleHistoryClick : undefined}
          showWorkflows={features.workflows}
          showAssets={features.assets}
          showHistory={features.history}
        />
      )}

      {/* Workflow Panel */}
      {features.workflows && (
        <WorkflowPanel
          isOpen={isWorkflowPanelOpen}
          onClose={closeWorkflowPanel}
          onLoadWorkflow={handleLoadWithTracking}
          currentWorkflowId={workflowId || undefined}
          canvasTheme={canvasTheme}
        />
      )}

      {/* History Panel */}
      {features.history && (
        <HistoryPanel
          isOpen={isHistoryPanelOpen}
          onClose={closeHistoryPanel}
          onSelectAsset={handleSelectAsset}
          onOpenProjectAssetSync={handleOpenProjectAssetSync}
          canvasTheme={canvasTheme}
        />
      )}

      {features.assets && (
        <>
          <AssetLibraryPanel
            isOpen={isAssetLibraryOpen}
            onClose={() => { setLibraryPickTarget(null); closeAssetLibrary(); }}
            onSelectAsset={handleLibrarySelect}
            panelY={assetLibraryY}
            variant={assetLibraryVariant}
            canvasTheme={canvasTheme}
          />

          <CreateAssetModal
            isOpen={isCreateAssetModalOpen}
            onClose={() => setIsCreateAssetModalOpen(false)}
            nodeToSnapshot={nodeToSnapshot}
            onSave={handleSaveAssetToLibrary}
          />

          <ProjectAssetSyncModal
            item={projectAssetSyncDraft}
            submitting={isSubmittingProjectAssetSync}
            onClose={() => {
              if (!isSubmittingProjectAssetSync) {
                setProjectAssetSyncDraft(null);
              }
            }}
            onSubmit={handleSubmitProjectAssetSync}
          />
        </>
      )}

      {/* TikTok Import Modal */}
      {features.tiktokImport && (
        <TikTokImportModal
          isOpen={isTikTokModalOpen}
          onClose={closeTikTokModal}
          onVideoImported={handleTikTokVideoImported}
        />
      )}

      {/* Twitter Post Modal */}
      {features.socialShare && (
        <TwitterPostModal
          isOpen={twitterModal.isOpen}
          onClose={() => setTwitterModal(prev => ({ ...prev, isOpen: false }))}
          mediaUrl={twitterModal.mediaUrl}
          mediaType={twitterModal.mediaType}
        />
      )}

      {/* TikTok Post Modal */}
      {features.socialShare && (
        <TikTokPostModal
          isOpen={tiktokModal.isOpen}
          onClose={() => setTiktokModal(prev => ({ ...prev, isOpen: false }))}
          mediaUrl={tiktokModal.mediaUrl}
        />
      )}

      {/* Storyboard Generator Modal */}
      {features.storyboard && (
        <StoryboardGeneratorModal
          isOpen={storyboardGenerator.isModalOpen}
          onClose={storyboardGenerator.closeModal}
          state={storyboardGenerator.state}
          onSetStep={storyboardGenerator.setStep}
          onToggleCharacter={storyboardGenerator.toggleCharacter}
          onSetSceneCount={storyboardGenerator.setSceneCount}
          onSetStory={storyboardGenerator.setStory}
          onUpdateScript={storyboardGenerator.updateScript}
          onGenerateScripts={storyboardGenerator.generateScripts}
          onBrainstormStory={storyboardGenerator.brainstormStory}
          onOptimizeStory={storyboardGenerator.optimizeStory}
          onGenerateComposite={storyboardGenerator.generateComposite}
          onRegenerateComposite={storyboardGenerator.regenerateComposite}
          onCreateNodes={storyboardGenerator.createStoryboardNodes}
        />
      )}

      {/* Agent Chat */}
      {features.chat && !shouldHideGlobalChrome && (
        <>
          <ChatBubble onClick={toggleChat} isOpen={isChatOpen} />
          <ChatPanel isOpen={isChatOpen} onClose={closeChat} isDraggingNode={isDraggingNodeToChat} canvasTheme={canvasTheme} />
        </>
      )}

      {/* Top Bar */}
      {/* Top Bar */}
      {!shouldHideGlobalChrome && (
        <TopBar
          canvasTitle={canvasTitle}
          isEditingTitle={isEditingTitle}
          editingTitleValue={editingTitleValue}
          canvasTitleInputRef={canvasTitleInputRef}
          setCanvasTitle={setCanvasTitle}
          setIsEditingTitle={setIsEditingTitle}
          setEditingTitleValue={setEditingTitleValue}
          onNew={handleNewCanvas}
          hasUnsavedChanges={hasUnsavedChanges}
          onNavigateHome={handleNavigateHomeFromMenu}
          onOpenProjectLibrary={handleOpenProjectLibraryFromMenu}
          onDeleteCurrentProject={handleDeleteCurrentProjectFromMenu}
          canDeleteCurrentProject={Boolean(queryCanvasProjectId)}
          onImportImage={handleImportImageToCanvas}
          onUndo={undo}
          onRedo={redo}
          canUndo={canUndo}
          canRedo={canRedo}
          onCopy={handleCopy}
          canCopy={selectedNodeIds.length > 0}
          onFitCanvas={handleShowAllElements}
          onZoomIn={handleZoomInFromMenu}
          onZoomOut={handleZoomOutFromMenu}
          canvasTheme={canvasTheme}
        />
      )}

      {pendingReferenceChoice && pendingReferenceSourceNode && pendingReferenceTargetNode && (
        <div
          className="absolute inset-0 z-[1200] flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <div
            className={`w-[min(560px,calc(100vw-32px))] rounded-lg border p-4 shadow-2xl ${canvasTheme === 'dark'
              ? 'border-neutral-700 bg-[#1d1b16] text-[#f5f4ef]'
              : 'border-neutral-200 bg-[#f9f8f6] text-[#100f09]'
              }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-base font-semibold">{pendingReferenceTitle}</div>
                <div className={`mt-1 text-sm ${canvasTheme === 'dark' ? 'text-neutral-400' : 'text-neutral-600'}`}>
                  {pendingReferenceDescription}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setPendingReferenceChoice(null)}
                className={`shrink-0 rounded-md px-2 py-1 text-sm transition-colors ${canvasTheme === 'dark'
                  ? 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
                  : 'text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900'
                  }`}
              >
                取消
              </button>
            </div>

            <div className="mt-4 flex gap-3">
              {renderReferenceChoiceOption(pendingReferenceSourceNode, pendingReferenceChoice.mediaType === NodeType.VIDEO ? '视频 A' : '图片 A')}
              {renderReferenceChoiceOption(pendingReferenceTargetNode, pendingReferenceChoice.mediaType === NodeType.VIDEO ? '视频 B' : '图片 B')}
            </div>
          </div>
        </div>
      )}

      {/* Canvas */}
      <div
        ref={canvasRef}
        id="canvas-background"
        className={`absolute inset-0 ${activeTool === 'hand' ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}${isDragging ? ' canvas-dragging' : ''}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handleGlobalPointerMove}
        onPointerUp={handleGlobalPointerUp}
        onWheel={handleWheel}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleGlobalContextMenu}
        onDragOver={handleCanvasDragOver}
        onDrop={handleCanvasDrop}
      >
        <div
          style={{
            transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`,
            transformOrigin: '0 0',
            width: '100%',
            height: '100%',
            pointerEvents: 'none'
          }}
        >
          {/* SVG Layer for Connections */}
          <svg className="absolute top-0 left-0 w-full h-full overflow-visible pointer-events-none z-10">
            <ConnectionsLayer
              nodes={nodes}
              viewport={viewport}
              canvasTheme={canvasTheme}
              isDraggingConnection={isDraggingConnection}
              connectionStart={connectionStart}
              tempConnectionEnd={tempConnectionEnd}
              selectedConnection={selectedConnection}
              onEdgeClick={handleEdgeClick}
              onDeleteConnection={handleDeleteConnection}
            />
          </svg>

          {/* Alignment guide lines (drawn in world coordinates so they
              scale with the viewport; lines use non-scaling-stroke to stay
              ~1px visually). Rendered for both drag-snap and resize-snap,
              mirroring Lovart's behaviour where guides show up whether the
              user is moving or scaling a node. */}
          <AlignmentGuides guides={[...snapGuides, ...resizeSnapGuides]} />

          {/* Nodes Layer */}
          <div className="pointer-events-none">
            {nodes.map(node => (
              <CanvasNode
                key={node.id}
                data={node}
                inputUrl={nodeInputUrls.get(node.id)}
                connectedImageNodes={nodeConnectedImages.get(node.id)}
                availableCanvasNodes={availableCanvasNodes}
                onUpdate={updateNodeWithSync}
                onGenerate={handleGenerate}
                canGenerate={generationAccess.canGenerate}
                generateDisabledReason={!generationAccess.canGenerate ? generationAccess.deniedMessage : undefined}
                creditQuoteProjectId={creditQuoteProjectId}
                onAttachAssetToVideoNode={handleAttachAssetToVideoNode}
                onSetFrameSlot={handleSetFrameSlot}
                onClearFrameSlot={handleClearFrameSlot}
                onSetCanvasNodeAsFrameSlot={handleSetCanvasNodeAsFrameSlot}
                onAddNext={handleAddNext}
                selected={selectedNodeIds.includes(node.id)}
                showControls={selectedNodeIds.length === 1 && selectedNodeIds.includes(node.id)}
                onNodePointerDown={(e) => {
                  // If shift is held, preserve selection for multi-drag/multi-select
                  if (e.shiftKey) {
                    if (selectedNodeIds.includes(node.id)) {
                      handleNodePointerDown(e, node.id, undefined);
                    } else {
                      // Add to selection
                      setSelectedNodeIds(prev => [...prev, node.id]);
                      handleNodePointerDown(e, node.id, undefined);
                    }
                  } else {
                    // No shift: always select just this node (to show its controls)
                    setSelectedNodeIds([node.id]);
                    handleNodePointerDown(e, node.id, undefined);
                  }
                  // Prime the snap engine with the current world state so the
                  // very first pointermove can already draw guide lines. We
                  // freeze the other-node rects here so the dragged node's
                  // own position updates don't feed back into snap targets.
                  const rect = canvasRef.current?.getBoundingClientRect();
                  primeSnapContext(
                    nodes,
                    rect ? { width: rect.width, height: rect.height } : null,
                  );
                }}
                onResizeHandlePointerDown={(e, nodeId, handle: ResizeHandle) => {
                  const target = nodes.find(n => n.id === nodeId);
                  if (!target) return;
                  const rect = canvasRef.current?.getBoundingClientRect();
                  beginResize(
                    e,
                    target,
                    handle,
                    viewport,
                    nodes,
                    rect ? { width: rect.width, height: rect.height } : null,
                  );
                }}
                onContextMenu={handleNodeContextMenu}
                onSelect={(id) => setSelectedNodeIds([id])}
                onConnectorDown={handleConnectorPointerDown}
                isHoveredForConnection={connectionHoveredNodeId === node.id}
                onOpenEditor={handleOpenEditor}
                onUpload={handleUpload}
                onAttachReferenceImages={handleAttachImageReferences}
                onPickFromLibrary={features.assets ? handlePickFromLibraryForNode : undefined}
                onSyncToProjectAssets={canUseXiaolouAssetBridge() ? handleOpenProjectAssetSyncForNode : undefined}
                onExpand={handleExpandImage}
                onDragStart={features.chat ? handleNodeDragStart : undefined}
                onDragEnd={features.chat ? handleNodeDragEnd : undefined}
                onWriteContent={handleWriteContent}
                onTextToVideo={handleTextToVideo}
                onTextToImage={handleTextToImage}
                onImageToImage={handleImageToImage}
                onImageToVideo={handleImageToVideo}
                onChangeAngleGenerate={features.cameraAngle ? handleChangeAngleGenerate : undefined}
                zoom={viewport.zoom}
                onMouseEnter={() => setCanvasHoveredNodeId(node.id)}
                onMouseLeave={() => setCanvasHoveredNodeId(null)}
                canvasTheme={canvasTheme}
                onPostToX={features.socialShare ? handlePostToX : undefined}
                onPostToTikTok={features.socialShare ? handlePostToTikTok : undefined}
                allowSocialShare={features.socialShare}
                allowChatDrag={features.chat}
                allowCameraAngle={features.cameraAngle}
              />
            ))}
          </div>



          {/* Selection Bounding Box - for selected nodes (2 or more) */}
          {selectedNodeIds.length > 1 && !selectionBox.isActive && (
            <SelectionBoundingBox
              selectedNodes={nodes.filter(n => selectedNodeIds.includes(n.id))}
              group={getCommonGroup(selectedNodeIds)}
              viewport={viewport}
              onGroup={() => groupNodes(selectedNodeIds, setNodes)}
              onUngroup={() => {
                const group = getCommonGroup(selectedNodeIds);
                if (group) ungroupNodes(group.id, setNodes);
              }}
              onBoundingBoxPointerDown={(e) => {
                // Start dragging all selected nodes when clicking on bounding box
                e.stopPropagation();
                if (selectedNodeIds.length > 0) {
                  handleNodePointerDown(e, selectedNodeIds[0], undefined);
                }
              }}
              onRenameGroup={renameGroup}
              onSortNodes={(direction) => {
                const group = getCommonGroup(selectedNodeIds);
                if (group) sortGroupNodes(group.id, direction, nodes, setNodes);
              }}
              onEditStoryboard={features.storyboard ? handleEditStoryboard : undefined}
            />
          )}

          {/* Group Bounding Boxes - for all groups (even when not selected) */}
          {groups.map(group => {
            const groupNodes = nodes.filter(n => n.groupId === group.id);

            // Don't render if group has less than 2 nodes
            if (groupNodes.length < 2) return null;

            const isSelected = groupNodes.every(n => selectedNodeIds.includes(n.id)) && groupNodes.length > 0;

            // Don't render if this group is already shown above (when selected)
            if (isSelected) return null;

            return (
              <SelectionBoundingBox
                key={group.id}
                selectedNodes={groupNodes}
                group={group}
                viewport={viewport}
                onGroup={() => { }} // Already grouped
                onUngroup={() => ungroupNodes(group.id, setNodes)}
                onBoundingBoxPointerDown={(e) => {
                  // Select all nodes in this group and start dragging
                  e.stopPropagation();
                  const nodeIds = groupNodes.map(n => n.id);
                  setSelectedNodeIds(nodeIds);
                  if (nodeIds.length > 0) {
                    handleNodePointerDown(e, nodeIds[0], undefined);
                  }
                }}
                onRenameGroup={renameGroup}
                onSortNodes={(direction) => sortGroupNodes(group.id, direction, nodes, setNodes)}
                onCreateVideo={features.storyboard ? () => {
                  // Pass group nodes directly to avoid selection state race conditions
                  const groupNodeIds = nodes.filter(n => n.groupId === group.id).map(n => n.id);
                  handleCreateStoryboardVideo(groupNodeIds);
                } : undefined}
                onEditStoryboard={features.storyboard ? handleEditStoryboard : undefined}
              />
            );
          })}
        </div>
      </div >

      {/* Selection Box Overlay - Outside transformed canvas for screen-space coordinates */}
      {selectionBox.isActive && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: Math.min(selectionBox.startX, selectionBox.endX),
            top: Math.min(selectionBox.startY, selectionBox.endY),
            width: Math.abs(selectionBox.endX - selectionBox.startX),
            height: Math.abs(selectionBox.endY - selectionBox.startY),
            border: '2px solid #3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            zIndex: 1000
          }}
        />
      )}

      {/* Context Menu */}
      <ContextMenu
        state={contextMenu}
        onClose={() => setContextMenu(prev => ({ ...prev, isOpen: false }))}
        onSelectType={handleContextMenuSelect}
        onUpload={handleContextUpload}
        onUndo={undo}
        onRedo={redo}
        onPaste={handlePaste}
        onCopy={handleCopy}
        onDuplicate={handleDuplicate}
        onCreateAsset={features.assets ? handleContextMenuCreateAsset : undefined}
        onAddAssets={features.assets ? handleContextMenuAddAssets : undefined}
        canUndo={canUndo}
        canRedo={canRedo}
        canvasTheme={canvasTheme}
        allowTextNodes={features.text}
        allowImageNodes={features.image}
        allowVideoNodes={features.video}
        allowImageEditorNodes={features.imageEditor}
        allowVideoEditorNodes={features.videoEditor}
        allowLocalModels={features.localModels}
      />

      {/* Zoom slider now integrated in CanvasToolbar */}

      {features.imageEditor && (
        <ImageEditorModal
          isOpen={editorModal.isOpen}
          nodeId={editorModal.nodeId || ''}
          imageUrl={editorModal.imageUrl}
          initialPrompt={nodes.find(n => n.id === editorModal.nodeId)?.prompt}
          initialModel={nodes.find(n => n.id === editorModal.nodeId)?.imageModel || DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID}
          initialAspectRatio={nodes.find(n => n.id === editorModal.nodeId)?.aspectRatio || getDefaultCanvasImageAspectRatio(nodes.find(n => n.id === editorModal.nodeId)?.imageModel)}
          initialResolution={nodes.find(n => n.id === editorModal.nodeId)?.resolution || getDefaultCanvasImageResolution(nodes.find(n => n.id === editorModal.nodeId)?.imageModel)}
          initialElements={nodes.find(n => n.id === editorModal.nodeId)?.editorElements as any}
          initialCanvasData={nodes.find(n => n.id === editorModal.nodeId)?.editorCanvasData}
          initialCanvasSize={nodes.find(n => n.id === editorModal.nodeId)?.editorCanvasSize}
          initialBackgroundUrl={nodes.find(n => n.id === editorModal.nodeId)?.editorBackgroundUrl}
          onClose={handleCloseImageEditor}
          onGenerate={async (sourceId, prompt, count) => {
            if (!generationAccess.canGenerate) {
              window.alert(generationAccess.deniedMessage);
              return;
            }
            handleCloseImageEditor();

            const sourceNode = nodes.find(n => n.id === sourceId);
            if (!sourceNode) return;

            // Get settings from source node (which were updated by the modal)
            const imageModel = normalizeCanvasImageModelId(sourceNode.imageModel || DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID);
            const aspectRatio = normalizeCanvasImageAspectRatio(imageModel, sourceNode.aspectRatio || getDefaultCanvasImageAspectRatio(imageModel));
            const resolution = normalizeCanvasImageResolution(imageModel, sourceNode.resolution || getDefaultCanvasImageResolution(imageModel));

            const startX = sourceNode.x + 360; // Source width + gap
            const startY = sourceNode.y;

            const newNodes: NodeData[] = [];

            const yStep = 500;
            const totalHeight = (count - 1) * yStep;
            const startYOffset = -totalHeight / 2;

            // Create N nodes with inherited settings
            for (let i = 0; i < count; i++) {
                newNodes.push({
                  id: generateUUID(),
                  type: NodeType.IMAGE,
                  x: startX,
                  y: startY + startYOffset + (i * yStep),
                  prompt: prompt,
                  status: NodeStatus.LOADING,
                  generationStartTime: Date.now(),
                  model: imageModel,
                  imageModel: imageModel,
                  aspectRatio: aspectRatio,
                  resolution: resolution,
                  parentIds: [sourceId]
                });
            }

            // Add new nodes and edges immediately
            // Note: State updates might be batched
            setNodes(prev => [...prev, ...newNodes]);

            // Convert editor image to base64 for generation reference
            let imageBase64: string | undefined = undefined;
            if (editorModal.imageUrl) {
              imageBase64 = await urlToBase64(editorModal.imageUrl);
            }

            newNodes.forEach(async (node) => {
              let acceptedTaskId: string | undefined;
              try {
                const imageResult = await generateImage({
                  prompt: node.prompt || '',
                  imageBase64: imageBase64,
                  imageModel: imageModel,
                  aspectRatio: aspectRatio,
                  resolution: resolution,
                  onTaskIdAssigned: (taskId) => {
                    if (!taskId) return;
                    acceptedTaskId = taskId;
                    updateNode(node.id, { taskId });
                  },
                });
                updateNode(node.id, {
                  status: NodeStatus.SUCCESS,
                  resultUrl: imageResult.resultUrl,
                  errorMessage: undefined,
                  taskId: imageResult.taskId ?? acceptedTaskId,
                });
              } catch (error: any) {
                if (acceptedTaskId) {
                  try {
                    const recovered = await recoverGeneration({ kind: 'image', taskId: acceptedTaskId });
                    if (recovered?.status === 'succeeded') {
                      updateNode(node.id, {
                        status: NodeStatus.SUCCESS,
                        resultUrl: recovered.resultUrl,
                        errorMessage: undefined,
                        taskId: acceptedTaskId,
                      });
                      return;
                    }
                    if (recovered?.status === 'pending') {
                      updateNode(node.id, {
                        status: NodeStatus.LOADING,
                        errorMessage: undefined,
                        taskId: acceptedTaskId,
                      });
                      return;
                    }
                    if (recovered?.status === 'failed') {
                      updateNode(node.id, {
                        status: NodeStatus.ERROR,
                        errorMessage: recovered.error || error.message,
                        taskId: acceptedTaskId,
                      });
                      return;
                    }
                  } catch (recoveryError) {
                    console.warn('Batch image recovery failed:', recoveryError);
                  }
                }

                const parsedError = parseGenerationError(error);
                updateNode(node.id, {
                  status: NodeStatus.ERROR,
                  errorMessage: parsedError.category === 'web_balance_insufficient'
                    ? generationAccess.insufficientCreditsMessage
                    : (parsedError.category !== 'unknown' ? parsedError.message : error.message),
                });
              }
            });
          }}
          onUpdate={updateNode}
        />
      )}

      {/* Storyboard Video Generation Modal */}
      {features.storyboard && (
        <StoryboardVideoModal
          isOpen={storyboardVideoModal.isOpen}
          onClose={() => setStoryboardVideoModal(prev => ({ ...prev, isOpen: false }))}
          scenes={storyboardVideoModal.nodes}
          storyContext={storyboardVideoModal.storyContext}
          onCreateVideos={handleGenerateStoryVideos}
        />
      )}

      {/* Video Editor Modal */}
      {features.videoEditor && (
        <VideoEditorModal
          isOpen={videoEditorModal.isOpen}
          nodeId={videoEditorModal.nodeId}
          videoUrl={videoEditorModal.videoUrl}
          initialTrimStart={nodes.find(n => n.id === videoEditorModal.nodeId)?.trimStart}
          initialTrimEnd={nodes.find(n => n.id === videoEditorModal.nodeId)?.trimEnd}
          onClose={handleCloseVideoEditor}
          onExport={handleExportTrimmedVideo}
        />
      )}

      {/* Fullscreen Media Preview Modal */}
      <ExpandedMediaModal
        mediaUrl={expandedImageUrl}
        onClose={handleCloseExpand}
      />
    </div >
  );
}
