/**
 * useNodeDragging.ts
 *
 * Custom hook for managing node dragging functionality.
 * Uses requestAnimationFrame to batch position updates for smooth 60 fps.
 *
 * Also runs Lovart/Figma-style alignment snapping on the primary dragged
 * node — it nudges the batched (dx, dy) to align with nearby edges /
 * centers / equal-spacing pairs / the viewport center and exposes the
 * resulting guide lines via `snapGuides` so AlignmentGuides.tsx can draw
 * them live. Multi-drag (shift-selected group) intentionally skips
 * snapping because Figma doesn't snap groups either.
 */

import React, { useRef, useState, useCallback, useEffect } from 'react';
import { NodeData, Viewport } from '../types';
import { getNodeRect, NodeRect } from '../utils/nodeGeometry';
import { AlignmentGuide, computeSnap } from './useSnapGuides';

interface DragNode {
  id: string;
}

export const useNodeDragging = () => {
    const dragNodeRef = useRef<DragNode | null>(null);
    const isPanning = useRef<boolean>(false);
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [snapGuides, setSnapGuides] = useState<AlignmentGuide[]>([]);

    // Accumulated deltas batched via rAF. These track the TOTAL un-committed
    // movement (so snap can kick in cleanly when a user pauses near a target
    // and then continues).
    const pendingNodeDelta = useRef({ dx: 0, dy: 0 });
    const pendingPanDelta = useRef({ dx: 0, dy: 0 });
    const rafNodeId = useRef<number | null>(null);
    const rafPanId = useRef<number | null>(null);

    // Snap context captured when the drag starts: the rect the dragged node
    // had before movement began, and the rects of every other node. We
    // deliberately freeze these at pointerdown so the dragged node isn't
    // affected by its own position updates while computing snap targets.
    const dragContextRef = useRef<{
      draggedStart: NodeRect | null;
      committedDx: number;
      committedDy: number;
      otherRects: NodeRect[];
      viewportSize: { width: number; height: number } | null;
    }>({
      draggedStart: null,
      committedDx: 0,
      committedDy: 0,
      otherRects: [],
      viewportSize: null,
    });

    // Keep latest setter / state refs so the rAF callback never captures stale closures
    const nodeUpdaterRef = useRef<((updater: (prev: NodeData[]) => NodeData[]) => void) | null>(null);
    const viewportUpdaterRef = useRef<((updater: (prev: Viewport) => Viewport) => void) | null>(null);
    const selectedIdsRef = useRef<string[]>([]);
    const viewportRef = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });

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
        const isMultiDrag = ids.includes(nodeId) && ids.length > 1;

        // Snap only applies to single-node drag (matches Figma behaviour).
        let finalDx = dx;
        let finalDy = dy;
        if (!isMultiDrag && dragContextRef.current.draggedStart) {
            const ctx = dragContextRef.current;
            const proposedDx = ctx.committedDx + dx;
            const proposedDy = ctx.committedDy + dy;
            const snap = computeSnap({
                draggedRect: ctx.draggedStart,
                proposedDx,
                proposedDy,
                otherRects: ctx.otherRects,
                viewport: viewportRef.current,
                viewportSize: ctx.viewportSize,
            });
            finalDx = snap.dx - ctx.committedDx;
            finalDy = snap.dy - ctx.committedDy;
            ctx.committedDx = snap.dx;
            ctx.committedDy = snap.dy;
            setSnapGuides(snap.guides);
        }

        const nodesToMove = isMultiDrag ? ids : [nodeId];
        const moveSet = new Set(nodesToMove);

        nodeUpdaterRef.current(prev =>
            prev.map(n => moveSet.has(n.id) ? { ...n, x: n.x + finalDx, y: n.y + finalDy } : n)
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

    /**
     * Optional second entrypoint: the caller can prime the snap context
     * with the current node list + viewport size at the moment the drag
     * begins. If it isn't called, we fall back to "no snapping" (the drag
     * still works, it just won't render guides).
     */
    const primeSnapContext = (
        nodes: NodeData[],
        viewportSize: { width: number; height: number } | null,
    ) => {
        const id = dragNodeRef.current?.id;
        if (!id) return;
        const dragged = nodes.find(n => n.id === id);
        if (!dragged) return;
        dragContextRef.current = {
            draggedStart: getNodeRect(dragged),
            committedDx: 0,
            committedDy: 0,
            otherRects: nodes.filter(n => n.id !== id).map(getNodeRect),
            viewportSize,
        };
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
        viewportRef.current = viewport;

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
        setSnapGuides([]);
        dragContextRef.current.draggedStart = null;
        dragContextRef.current.committedDx = 0;
        dragContextRef.current.committedDy = 0;
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
        primeSnapContext,
        updateNodeDrag,
        endNodeDrag,
        startPanning,
        updatePanning,
        endPanning,
        isDragging,
        isPanning: isPanning.current,
        releasePointerCapture,
        snapGuides,
    };
};
