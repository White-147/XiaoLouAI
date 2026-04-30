/**
 * useNodeManagement.ts
 * 
 * Custom hook for managing node state and operations.
 * Handles node creation, updates, selection, and deletion.
 */

import { useState } from 'react';
import { NodeData, NodeType, NodeStatus, Viewport } from '../types';
import { DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID } from '../config/canvasImageModels';
import { generateUUID } from '../utils/secureContextPolyfills';

/** 右键/工具栏新建节点标题（节点头展示） */
function getDefaultNodeTitleZh(type: NodeType): string | undefined {
  switch (type) {
    case NodeType.TEXT:
      return '文本';
    case NodeType.IMAGE:
      return '图片';
    case NodeType.VIDEO:
      return '视频';
    case NodeType.AUDIO:
      return '音频';
    case NodeType.IMAGE_EDITOR:
      return '图片编辑';
    case NodeType.VIDEO_EDITOR:
      return '视频编辑';
    case NodeType.STORYBOARD:
      return '分镜管理';
    case NodeType.CAMERA_ANGLE:
      return '多角度';
    case NodeType.LOCAL_IMAGE_MODEL:
      return '本地图片模型';
    case NodeType.LOCAL_VIDEO_MODEL:
      return '本地视频模型';
    default:
      return undefined;
  }
}

export const useNodeManagement = () => {
    // ============================================================================
    // STATE
    // ============================================================================

    const [nodes, setNodes] = useState<NodeData[]>([]);
    const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);

    // ============================================================================
    // NODE OPERATIONS
    // ============================================================================

    /**
     * Adds a new node to the canvas
     * @param type - Type of node to create
     * @param x - Screen X coordinate
     * @param y - Screen Y coordinate
     * @param parentId - Optional parent node ID for connections
     * @param viewport - Current viewport for coordinate conversion
     */
    const addNode = (
        type: NodeType,
        x: number,
        y: number,
        parentId: string | undefined,
        viewport: Viewport
    ) => {
        const canvasX = (x - viewport.x) / viewport.zoom;
        const canvasY = (y - viewport.y) / viewport.zoom;

        const titleZh = getDefaultNodeTitleZh(type);
        const newNode: NodeData = {
            id: generateUUID(),
            type,
            x: parentId ? canvasX : canvasX - 170,
            y: parentId ? canvasY : canvasY - 100,
            prompt: '',
            status: NodeStatus.IDLE,
            model: type === NodeType.IMAGE || type === NodeType.IMAGE_EDITOR
                ? DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID
                : 'Banana Pro',
            imageModel: type === NodeType.IMAGE || type === NodeType.IMAGE_EDITOR
                ? DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID
                : undefined,
            aspectRatio: 'Auto',
            resolution: 'Auto',
            parentIds: parentId ? [parentId] : [],
            ...(titleZh ? { title: titleZh } : {}),
        };

        setNodes(prev => [...prev, newNode]);
        setSelectedNodeIds([newNode.id]);

        return newNode.id;
    };

    /**
     * Updates a node with partial data
     * @param id - Node ID to update
     * @param updates - Partial node data to merge
     */
    const updateNode = (id: string, updates: Partial<NodeData>) => {
        setNodes(prev => prev.map(n => n.id === id ? { ...n, ...updates } : n));
    };

    /**
     * Deletes a node by ID
     * @param id - Node ID to delete
     */
    const deleteNode = (id: string) => {
        setNodes(prev => prev.filter(n => n.id !== id));
        setSelectedNodeIds(prev => prev.filter(nodeId => nodeId !== id));
    };

    /**
     * Deletes multiple nodes by IDs
     * @param ids - Array of node IDs to delete
     */
    const deleteNodes = (ids: string[]) => {
        setNodes(prev => prev.filter(n => !ids.includes(n.id)));
        setSelectedNodeIds([]);
    };

    /**
     * Clears all node selections
     */
    const clearSelection = () => {
        setSelectedNodeIds([]);
    };

    /**
     * Handles node type selection from context menu
     * Creates new node or deletes existing node
     */
    const handleSelectTypeFromMenu = (
        type: NodeType | 'DELETE',
        contextMenu: any,
        viewport: Viewport,
        onCloseMenu: () => void
    ) => {
        // Handle Delete Action
        if (type === 'DELETE') {
            if (contextMenu.sourceNodeId) {
                deleteNode(contextMenu.sourceNodeId);
            }
            onCloseMenu();
            return;
        }

        if (contextMenu.type === 'node-connector' && contextMenu.sourceNodeId) {
            const sourceNode = nodes.find(n => n.id === contextMenu.sourceNodeId);
            if (sourceNode) {
                const direction = contextMenu.connectorSide || 'right';
                const newNodeId = generateUUID();
                const GAP = 100;
                const NODE_WIDTH = 340;
                const titleZh = getDefaultNodeTitleZh(type);

                let newNode: NodeData;

                if (direction === 'right') {
                    // Append: Source -> New
                    newNode = {
                        id: newNodeId,
                        type,
                        x: sourceNode.x + NODE_WIDTH + GAP,
                        y: sourceNode.y,
                        prompt: '',
                        status: NodeStatus.IDLE,
                        model: type === NodeType.IMAGE || type === NodeType.IMAGE_EDITOR
                            ? DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID
                            : 'Banana Pro',
                        imageModel: type === NodeType.IMAGE || type === NodeType.IMAGE_EDITOR
                            ? DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID
                            : undefined,
                        aspectRatio: 'Auto',
                        resolution: 'Auto',
                        parentIds: contextMenu.sourceNodeId ? [contextMenu.sourceNodeId] : [],
                        ...(titleZh ? { title: titleZh } : {}),
                    };
                } else {
                    // Prepend: New -> Source
                    newNode = {
                        id: newNodeId,
                        type,
                        x: sourceNode.x - NODE_WIDTH - GAP,
                        y: sourceNode.y,
                        prompt: '',
                        status: NodeStatus.IDLE,
                        model: type === NodeType.IMAGE || type === NodeType.IMAGE_EDITOR
                            ? DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID
                            : 'Banana Pro',
                        imageModel: type === NodeType.IMAGE || type === NodeType.IMAGE_EDITOR
                            ? DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID
                            : undefined,
                        aspectRatio: 'Auto',
                        resolution: 'Auto',
                        parentIds: [],
                        ...(titleZh ? { title: titleZh } : {}),
                    };
                    // Update source to add new node as parent
                    const existingParentIds = sourceNode.parentIds || [];
                    updateNode(contextMenu.sourceNodeId, { parentIds: [...existingParentIds, newNodeId] });
                }

                setNodes(prev => [...prev, newNode]);
                setSelectedNodeIds([newNodeId]);
            }
        } else {
            // Global menu - add at click position
            addNode(type, contextMenu.x, contextMenu.y, undefined, viewport);
        }

        onCloseMenu();
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
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
    };
};
