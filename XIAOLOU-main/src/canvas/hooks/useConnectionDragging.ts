/**
 * useConnectionDragging.ts
 * 
 * Custom hook for managing connection dragging between nodes.
 * Handles drag-to-connect functionality with visual feedback.
 */

import React, { useState, useRef } from 'react';
import { NodeData, NodeType, Viewport } from '../types';
import { getNodeRect } from '../utils/nodeGeometry';

interface ConnectionStart {
    nodeId: string;
    handle: 'left' | 'right';
}

export interface SameTypeMediaConnectionChoice {
    sourceId: string;
    targetId: string;
    mediaType: NodeType.IMAGE | NodeType.VIDEO;
}

export const useConnectionDragging = () => {
    // ============================================================================
    // STATE
    // ============================================================================

    const [isDraggingConnection, setIsDraggingConnection] = useState(false);
    const [connectionStart, setConnectionStart] = useState<ConnectionStart | null>(null);
    const [tempConnectionEnd, setTempConnectionEnd] = useState<{ x: number; y: number } | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [hoveredSide, setHoveredSide] = useState<'left' | 'right' | null>(null);
    const [selectedConnection, setSelectedConnection] = useState<{ parentId: string; childId: string } | null>(null);
    const dragStartTime = useRef<number>(0);

    // ============================================================================
    // HELPERS
    // ============================================================================

    /**
     * Checks if mouse is hovering over a node (for connection target)
     * Also determines which side (left or right connector) is being hovered
     * @param mouseX - Screen X coordinate
     * @param mouseY - Screen Y coordinate
     * @param nodes - Array of all nodes
     * @param viewport - Current viewport
     */
    const checkHoveredNode = (
        mouseX: number,
        mouseY: number,
        nodes: NodeData[],
        viewport: Viewport
    ) => {
        const canvasX = (mouseX - viewport.x) / viewport.zoom;
        const canvasY = (mouseY - viewport.y) / viewport.zoom;

        const found = nodes.find(n => {
            if (n.id === connectionStart?.nodeId) return false;
            const rect = getNodeRect(n);
            return (
                canvasX >= rect.x && canvasX <= rect.right &&
                canvasY >= rect.y && canvasY <= rect.bottom
            );
        });

        if (found) {
            setHoveredNodeId(found.id);

            const rect = getNodeRect(found);
            setHoveredSide(canvasX < rect.centerX ? 'left' : 'right');
        } else {
            setHoveredNodeId(null);
            setHoveredSide(null);
        }
    };

    // ============================================================================
    // EVENT HANDLERS
    // ============================================================================

    /**
     * Starts connection dragging from a connector button
     */
    const handleConnectorPointerDown = (
        e: React.PointerEvent,
        nodeId: string,
        side: 'left' | 'right'
    ) => {
        e.stopPropagation();
        e.preventDefault();
        dragStartTime.current = Date.now();
        setIsDraggingConnection(true);
        setConnectionStart({ nodeId, handle: side });
        setTempConnectionEnd({ x: e.clientX, y: e.clientY });
    };

    /**
     * Updates temporary connection end point during drag
     */
    const updateConnectionDrag = (
        e: React.PointerEvent,
        nodes: NodeData[],
        viewport: Viewport
    ) => {
        if (!isDraggingConnection) return false;

        setTempConnectionEnd({ x: e.clientX, y: e.clientY });
        checkHoveredNode(e.clientX, e.clientY, nodes, viewport);
        return true;
    };

    /**
     * Completes connection drag and creates connection if valid
     * Returns true if connection was handled, false otherwise
     * @param nodes - All nodes for validation
     * @param onConnectionMade - Optional callback called with (parentId, childId) when connection is created
     */
    const completeConnectionDrag = (
        onAddNext: (nodeId: string, direction: 'left' | 'right') => void,
        onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void,
        nodes: NodeData[],
        onConnectionMade?: (parentId: string, childId: string) => void,
        onSameTypeMediaConnection?: (choice: SameTypeMediaConnectionChoice) => void
    ): boolean => {
        if (!isDraggingConnection || !connectionStart) return false;

        const dragDuration = Date.now() - dragStartTime.current;

        const resetConnectionState = () => {
            setIsDraggingConnection(false);
            setConnectionStart(null);
            setTempConnectionEnd(null);
            setHoveredNodeId(null);
            setHoveredSide(null);
        };

        const isImageNode = (node?: NodeData) => node?.type === NodeType.IMAGE;
        const isVideoNode = (node?: NodeData) => node?.type === NodeType.VIDEO;
        const isMediaNode = (node?: NodeData) => isImageNode(node) || isVideoNode(node);

        const addParentToChild = (
            parentId: string,
            childId: string,
            childUpdates?: Partial<NodeData>
        ) => {
            onUpdateNodes(prev => prev.map(n => {
                if (n.id !== childId) return n;

                const existingParents = n.parentIds || [];
                const parentIds = existingParents.includes(parentId)
                    ? existingParents
                    : [...existingParents, parentId];

                return { ...n, ...childUpdates, parentIds };
            }));
            onConnectionMade?.(parentId, childId);
        };

        /**
         * Check if a connection is valid based on node types
         * Rules:
         * - IMAGE → IMAGE, VIDEO, IMAGE_EDITOR: ✅ (image as input)
         * - VIDEO → VIDEO: ✅ (video chaining via lastFrame)
         * - VIDEO → IMAGE, IMAGE_EDITOR: ❌ (can't generate image from video)
         * - TEXT → IMAGE, VIDEO: ✅ (text provides prompt)
         * - TEXT → TEXT, IMAGE_EDITOR: ❌ (no text chaining, no text editing)
         * - Any → TEXT: ❌ (text nodes can't receive input)
         * - AUDIO: ❌ (not supported yet)
         */
        const isValidConnection = (parentId: string, childId: string): boolean => {
            const parentNode = nodes.find(n => n.id === parentId);
            const childNode = nodes.find(n => n.id === childId);

            if (!parentNode || !childNode) return false;

            // AUDIO nodes not supported yet
            if (parentNode.type === NodeType.AUDIO || childNode.type === NodeType.AUDIO) {
                return false;
            }

            // STORYBOARD nodes - allow connections to/from for now (future feature)
            // Can be restricted later when storyboard logic is implemented

            // TEXT nodes can't receive input (can only be parents)
            if (childNode.type === NodeType.TEXT) {
                return false;
            }

            // TEXT nodes can only connect to IMAGE or VIDEO (to provide prompts)
            if (parentNode.type === NodeType.TEXT) {
                return childNode.type === NodeType.IMAGE || childNode.type === NodeType.VIDEO;
            }

            // VIDEO nodes can only connect to other VIDEO nodes (via lastFrame)
            // Cannot connect to IMAGE or IMAGE_EDITOR
            if (parentNode.type === NodeType.VIDEO) {
                return childNode.type === NodeType.VIDEO ||
                    childNode.type === NodeType.VIDEO_EDITOR;
            }

            // IMAGE nodes can connect to IMAGE, VIDEO, or IMAGE_EDITOR
            if (parentNode.type === NodeType.IMAGE) {
                return childNode.type === NodeType.IMAGE ||
                    childNode.type === NodeType.VIDEO ||
                    childNode.type === NodeType.IMAGE_EDITOR;
            }

            // IMAGE_EDITOR can connect to IMAGE, VIDEO, or IMAGE_EDITOR
            if (parentNode.type === NodeType.IMAGE_EDITOR) {
                return childNode.type === NodeType.IMAGE ||
                    childNode.type === NodeType.VIDEO ||
                    childNode.type === NodeType.IMAGE_EDITOR;
            }

            // VIDEO_EDITOR can only connect to VIDEO (to feed trimmed video for generation)
            // No chaining VIDEO_EDITOR → VIDEO_EDITOR
            if (parentNode.type === NodeType.VIDEO_EDITOR) {
                return childNode.type === NodeType.VIDEO;
            }

            return true;
        };

        // Short click - open menu
        if (dragDuration < 200 && !hoveredNodeId) {
            onAddNext(connectionStart.nodeId, connectionStart.handle);
        }
        // Drag to node - media nodes use type-based rules, not target-side rules.
        else if (hoveredNodeId) {
            const sourceNode = nodes.find(n => n.id === connectionStart.nodeId);
            const targetNode = nodes.find(n => n.id === hoveredNodeId);

            if (!sourceNode || !targetNode) {
                resetConnectionState();
                return true;
            }

            if (isMediaNode(sourceNode) && isMediaNode(targetNode)) {
                if (sourceNode.type === targetNode.type) {
                    if (sourceNode.type === NodeType.IMAGE || sourceNode.type === NodeType.VIDEO) {
                        onSameTypeMediaConnection?.({
                            sourceId: sourceNode.id,
                            targetId: targetNode.id,
                            mediaType: sourceNode.type,
                        });
                    }
                } else {
                    const imageNode = isImageNode(sourceNode) ? sourceNode : targetNode;
                    const videoNode = isVideoNode(sourceNode) ? sourceNode : targetNode;

                    if (imageNode && videoNode) {
                        addParentToChild(imageNode.id, videoNode.id, {
                            videoMode: 'standard',
                            frameInputs: undefined,
                        });
                    }
                }
            } else {
                const parentId = connectionStart.handle === 'right'
                    ? connectionStart.nodeId
                    : hoveredNodeId;
                const childId = connectionStart.handle === 'right'
                    ? hoveredNodeId
                    : connectionStart.nodeId;

                if (isValidConnection(parentId, childId)) {
                    addParentToChild(parentId, childId);
                }
            }
        }

        // Reset state
        resetConnectionState();
        return true;
    };

    /**
     * Handles clicking on a connection line to select it
     */
    const handleEdgeClick = (e: React.MouseEvent, parentId: string, childId: string) => {
        e.stopPropagation();
        setSelectedConnection({ parentId, childId });
    };

    /**
     * Deletes the currently selected connection
     */
    const deleteSelectedConnection = (onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void) => {
        if (!selectedConnection) return false;

        onUpdateNodes(prev => prev.map(n => {
            if (n.id === selectedConnection.childId) {
                const existingParents = n.parentIds || [];
                return { ...n, parentIds: existingParents.filter(pid => pid !== selectedConnection.parentId) };
            }
            return n;
        }));
        setSelectedConnection(null);
        return true;
    };

    // ============================================================================
    // RETURN
    // ============================================================================

    return {
        isDraggingConnection,
        connectionStart,
        tempConnectionEnd,
        hoveredNodeId,
        selectedConnection,
        setSelectedConnection,
        handleConnectorPointerDown,
        updateConnectionDrag,
        completeConnectionDrag,
        handleEdgeClick,
        deleteSelectedConnection
    };
};
