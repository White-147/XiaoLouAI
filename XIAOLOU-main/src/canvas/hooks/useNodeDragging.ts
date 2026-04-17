/**
 * useNodeDragging.ts
 *
 * Custom hook for managing node dragging functionality.
 * Uses requestAnimationFrame to batch position updates for smooth 60 fps.
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { NodeData, Viewport } from '../types';

interface DragNode {
    id: string;
}

export const useNodeDragging = () => {
    const dragNodeRef = useRef<DragNode | null>(null);
    const isPanning = useRef<boolean>(false);
    const [isDragging, setIsDragging] = useState<boolean>(false);

    // Accumulated deltas batched via rAF
    const pendingNodeDelta = useRef({ dx: 0, dy: 0 });
    const pendingPanDelta = useRef({ dx: 0, dy: 0 });
    const rafNodeId = useRef<number | null>(null);
    const rafPanId = useRef<number | null>(null);

    // Keep latest setter / state refs so the rAF callback never captures stale closures
    const nodeUpdaterRef = useRef<((updater: (prev: NodeData[]) => NodeData[]) => void) | null>(null);
    const viewportUpdaterRef = useRef<((updater: (prev: Viewport) => Viewport) => void) | null>(null);
    const selectedIdsRef = useRef<string[]>([]);

    useEffect(() => {
        return () => {
            if (rafNodeId.current !== null) cancelAnimationFrame(rafNodeId.current);
            if (rafPanId.current !== null) cancelAnimationFrame(rafPanId.current);
        };
    }, []);

    const flushNodeDrag = useCallback(() => {
        rafNodeId.current = null;
        const { dx, dy } = pendingNodeDelta.current;
        if (dx === 0 && dy === 0) return;
        pendingNodeDelta.current = { dx: 0, dy: 0 };

        const nodeId = dragNodeRef.current?.id;
        if (!nodeId || !nodeUpdaterRef.current) return;

        const ids = selectedIdsRef.current;
        const nodesToMove = ids.includes(nodeId) && ids.length > 1 ? ids : [nodeId];
        const moveSet = new Set(nodesToMove);

        nodeUpdaterRef.current(prev =>
            prev.map(n => moveSet.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n)
        );
    }, []);

    const flushPan = useCallback(() => {
        rafPanId.current = null;
        const { dx, dy } = pendingPanDelta.current;
        if (dx === 0 && dy === 0) return;
        pendingPanDelta.current = { dx: 0, dy: 0 };

        viewportUpdaterRef.current?.(prev => ({
            ...prev,
            x: prev.x + dx,
            y: prev.y + dy,
        }));
    }, []);

    const handleNodePointerDown = (
        e: React.PointerEvent,
        id: string,
        onSelect?: (id: string) => void,
    ) => {
        e.stopPropagation();
        dragNodeRef.current = { id };
        setIsDragging(true);
        onSelect?.(id);

        if (e.target instanceof HTMLElement) {
            e.target.setPointerCapture(e.pointerId);
        }
    };

    const updateNodeDrag = (
        e: React.PointerEvent,
        viewport: Viewport,
        onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void,
        selectedNodeIds: string[] = [],
    ): boolean => {
        if (!dragNodeRef.current) return false;

        nodeUpdaterRef.current = onUpdateNodes;
        selectedIdsRef.current = selectedNodeIds;

        pendingNodeDelta.current.dx += e.movementX / viewport.zoom;
        pendingNodeDelta.current.dy += e.movementY / viewport.zoom;

        if (rafNodeId.current === null) {
            rafNodeId.current = requestAnimationFrame(flushNodeDrag);
        }
        return true;
    };

    const endNodeDrag = () => {
        if (rafNodeId.current !== null) {
            cancelAnimationFrame(rafNodeId.current);
            rafNodeId.current = null;
            flushNodeDrag();
        }
        dragNodeRef.current = null;
        setIsDragging(false);
    };

    const startPanning = (e: React.PointerEvent) => {
        isPanning.current = true;
        if (e.target instanceof HTMLElement) {
            e.target.setPointerCapture(e.pointerId);
        }
    };

    const updatePanning = (
        e: React.PointerEvent,
        onUpdateViewport: (updater: (prev: Viewport) => Viewport) => void,
    ): boolean => {
        if (!isPanning.current) return false;

        viewportUpdaterRef.current = onUpdateViewport;

        pendingPanDelta.current.dx += e.movementX;
        pendingPanDelta.current.dy += e.movementY;

        if (rafPanId.current === null) {
            rafPanId.current = requestAnimationFrame(flushPan);
        }
        return true;
    };

    const endPanning = () => {
        if (rafPanId.current !== null) {
            cancelAnimationFrame(rafPanId.current);
            rafPanId.current = null;
            flushPan();
        }
        isPanning.current = false;
    };

    const releasePointerCapture = (e: React.PointerEvent) => {
        if (e.target instanceof HTMLElement && e.target.hasPointerCapture(e.pointerId)) {
            try {
                e.target.releasePointerCapture(e.pointerId);
            } catch {
                // Ignore errors
            }
        }
    };

    return {
        handleNodePointerDown,
        updateNodeDrag,
        endNodeDrag,
        startPanning,
        updatePanning,
        endPanning,
        isDragging,
        isPanning: isPanning.current,
        releasePointerCapture,
    };
};
