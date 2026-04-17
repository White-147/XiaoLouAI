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
import { ContextMenuState, NodeData, NodeGroup, NodeStatus, NodeType, Viewport } from './types';
import { generateImage, generateVideo } from './services/generationService';
import { useCanvasNavigation } from './hooks/useCanvasNavigation';
import { useNodeManagement } from './hooks/useNodeManagement';
import { useConnectionDragging } from './hooks/useConnectionDragging';
import { useNodeDragging } from './hooks/useNodeDragging';
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
import { DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID, normalizeCanvasImageModelId } from './config/canvasImageModels';
import { getXiaolouCanvasDraftStorageKey } from './integrations/xiaolouCanvasSession';
import { canUseXiaolouAssetBridge, createXiaolouAsset } from './integrations/xiaolouAssetBridge';
import { sanitizeCanvasNodesForPersistence } from './utils/canvasPersistence';
import {
  hasCanvasHostServices,
  getCanvasHostServices,
  subscribeCanvasThemeChange,
  subscribeCanvasProjectLoad,
} from './integrations/canvasHostServices';

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

type CanvasDraftData = {
  workflowId: string | null;
  canvasTitle: string;
  nodes: NodeData[];
  groups: NodeGroup[];
  viewport: Viewport;
  savedAt: string;
};

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

export default function App() {
  // ============================================================================
  // STATE
  // ============================================================================

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
    updateNodeDrag,
    endNodeDrag,
    startPanning,
    updatePanning,
    endPanning,
    isDragging,
    releasePointerCapture
  } = useNodeDragging();

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
  const draftStorageKey = React.useMemo(() => getXiaolouCanvasDraftStorageKey(), []);
  const hasHydratedDraftRef = React.useRef(false);

  // Mark as dirty when nodes or title change
  const isInitialMount = React.useRef(true);
  const lastLoadingCountRef = React.useRef(0);
  const ignoreNextChange = React.useRef(false);

  React.useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    if (ignoreNextChange.current) {
      ignoreNextChange.current = false;
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
        hasHydratedDraftRef.current = true;
        return;
      }

      const draft = JSON.parse(rawDraft) as Partial<CanvasDraftData>;
      if (!draft || typeof draft !== 'object') {
        return;
      }

      ignoreNextChange.current = true;
      setCanvasTitle(typeof draft.canvasTitle === 'string' && draft.canvasTitle.trim() ? draft.canvasTitle : '未命名画布');
      setEditingTitleValue(typeof draft.canvasTitle === 'string' && draft.canvasTitle.trim() ? draft.canvasTitle : '未命名画布');
      setNodes(Array.isArray(draft.nodes) ? sanitizeCanvasNodesForPersistence(draft.nodes as NodeData[]) : []);
      setGroups(Array.isArray(draft.groups) ? draft.groups : []);
      setViewport(draft.viewport || { x: 0, y: 0, zoom: 1 });
      setSelectedNodeIds([]);
      hydrateWorkflowId(typeof draft.workflowId === 'string' ? draft.workflowId : null);
      setIsDirty(false);
    } catch (error) {
      console.warn('[Canvas] Failed to restore XiaoLou canvas draft:', error);
    } finally {
      hasHydratedDraftRef.current = true;
    }
  }, [draftStorageKey, hydrateWorkflowId, setCanvasTitle, setEditingTitleValue, setGroups, setNodes, setSelectedNodeIds, setViewport]);

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
          savedAt: new Date().toISOString(),
        };
        window.localStorage.setItem(draftStorageKey, JSON.stringify(draft));
      } catch (error) {
        console.warn('[Canvas] Failed to persist XiaoLou canvas draft:', error);
      }
    }, 500);
    return () => window.clearTimeout(handle);
  }, [canvasTitle, draftStorageKey, groups, nodes, viewport, workflowId]);

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

      setCanvasTitle(project.title || '未命名画布');
      setEditingTitleValue(project.title || '未命名画布');
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
    return subscribeCanvasProjectLoad((project) => {
      ignoreNextChange.current = true; // suppress the dirty flag triggered by setNodes below
      setCanvasTitle(project.title || '未命名画布');
      setEditingTitleValue(project.title || '未命名画布');
      setNodes(Array.isArray(project.nodes) ? sanitizeCanvasNodesForPersistence(project.nodes as NodeData[]) : []);
      setGroups(Array.isArray(project.groups) ? project.groups as NodeGroup[] : []);
      if (project.viewport) setViewport(project.viewport);
      setSelectedNodeIds([]);
      setIsDirty(false);
    });
  }, [setCanvasTitle, setEditingTitleValue, setNodes, setGroups, setViewport, setSelectedNodeIds]);

  const { handleGenerate } = useGeneration({
    nodes,
    updateNode
  });

  // Keep a ref to handleGenerate so setTimeout callbacks can access the latest version
  const handleGenerateRef = React.useRef(handleGenerate);
  React.useEffect(() => {
    handleGenerateRef.current = handleGenerate;
  }, [handleGenerate]);

  // Create new canvas
  const handleNewCanvas = () => {
    ignoreNextChange.current = true;
    setNodes([]);
    setGroups([]);
    setSelectedNodeIds([]);
    setCanvasTitle('未命名画布');
    setEditingTitleValue('未命名画布');
    resetWorkflowId();
    setIsDirty(false);
    try {
      window.localStorage.removeItem(draftStorageKey);
    } catch {}
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

  const handleToolbarQuickAdd = React.useCallback((type: NodeType) => {
    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    addNode(type, cx, cy, undefined, viewport);
  }, [addNode, viewport]);

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
  const { lastSaveTime: lastAutoSaveTime } = useAutoSave({
    isDirty,
    nodes,
    onSave: handleSaveWithTracking,
    interval: 60000 // Save every 60 seconds
  });

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
      resolution: data.resolution || '1K',
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
        resolution: isVideo ? 'Auto' : '1K'
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

  const handleLibrarySelect = (url: string, type: 'image' | 'video') => {
    handleSelectAsset(type === 'image' ? 'images' : 'videos', url, '素材库资源');
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
        resolution: isVideo ? 'Auto' : '1K',
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
      resolution: '1K',
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

  const handleGlobalPointerUp = (e: React.PointerEvent) => {
    // 1. Handle Selection Box End
    if (isSelecting) {
      const selectedIds = endSelection(nodes, viewport);
      setSelectedNodeIds(selectedIds);
      releasePointerCapture(e);
      return;
    }

    // 2. Handle Connection Drop
    if (completeConnectionDrag(handleAddNext, setNodes, nodes, handleConnectionMade)) {
      releasePointerCapture(e);
      return;
    }

    // 3. Stop Panning
    endPanning();

    // 4. Stop Node Dragging
    endNodeDrag();

    // 5. Release capture
    releasePointerCapture(e);
  };

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

  return (
    <div className={`w-screen h-screen ${canvasTheme === 'dark' ? 'bg-[#100f09] text-[#f5f4ef]' : 'bg-[#f9f8f6] text-[#100f09]'} overflow-hidden select-none font-sans transition-colors duration-300`}>
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
            onClose={closeAssetLibrary}
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
          onSave={handleSaveWithTracking}
          onNew={handleNewCanvas}
          hasUnsavedChanges={hasUnsavedChanges}
          isChatOpen={features.chat ? isChatOpen : false}
          canvasTheme={canvasTheme}
          onToggleTheme={() => setCanvasTheme(prev => prev === 'dark' ? 'light' : 'dark')}
          lastAutoSaveTime={lastAutoSaveTime}
        />
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
          {/* Background Grid */}
          <div
            className="absolute -top-[10000px] -left-[10000px] w-[20000px] h-[20000px]"
            style={{
              backgroundImage: canvasTheme === 'dark'
                ? 'radial-gradient(#666 1px, transparent 1px)'
                : 'radial-gradient(#ccc 1px, transparent 1px)',
              backgroundSize: '20px 20px',
              opacity: canvasTheme === 'dark' ? 0.5 : 0.8
            }}
          />

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
                }}
                onContextMenu={handleNodeContextMenu}
                onSelect={(id) => setSelectedNodeIds([id])}
                onConnectorDown={handleConnectorPointerDown}
                isHoveredForConnection={connectionHoveredNodeId === node.id}
                onOpenEditor={handleOpenEditor}
                onUpload={handleUpload}
                onSyncToProjectAssets={handleOpenProjectAssetSyncForNode}
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
          initialAspectRatio={nodes.find(n => n.id === editorModal.nodeId)?.aspectRatio || 'Auto'}
          initialResolution={nodes.find(n => n.id === editorModal.nodeId)?.resolution || '1K'}
          initialElements={nodes.find(n => n.id === editorModal.nodeId)?.editorElements as any}
          initialCanvasData={nodes.find(n => n.id === editorModal.nodeId)?.editorCanvasData}
          initialCanvasSize={nodes.find(n => n.id === editorModal.nodeId)?.editorCanvasSize}
          initialBackgroundUrl={nodes.find(n => n.id === editorModal.nodeId)?.editorBackgroundUrl}
          onClose={handleCloseImageEditor}
          onGenerate={async (sourceId, prompt, count) => {
            handleCloseImageEditor();

            const sourceNode = nodes.find(n => n.id === sourceId);
            if (!sourceNode) return;

            // Get settings from source node (which were updated by the modal)
            const imageModel = normalizeCanvasImageModelId(sourceNode.imageModel || DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID);
            const aspectRatio = sourceNode.aspectRatio || 'Auto';
            const resolution = sourceNode.resolution || '1K';

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
              try {
                const resultUrl = await generateImage({
                  prompt: node.prompt || '',
                  imageBase64: imageBase64,
                  imageModel: imageModel,
                  aspectRatio: aspectRatio,
                  resolution: resolution
                });
                updateNode(node.id, { status: NodeStatus.SUCCESS, resultUrl });
              } catch (error: any) {
                updateNode(node.id, { status: NodeStatus.ERROR, errorMessage: error.message });
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
