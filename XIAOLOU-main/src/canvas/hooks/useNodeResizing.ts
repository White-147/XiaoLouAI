/**
 * useNodeResizing.ts
 *
 * Corner-drag resize for image/video nodes. Aspect ratio is locked — users
 * can't skew nodes, mirroring Lovart/Figma's "hold shift" default when the
 * image is a real asset.
 *
 * Design notes:
 *   - We compute the new width directly from the distance from the pointer
 *     to the *anchor corner* (the one opposite the handle being dragged).
 *     That way fast cursor movements never lag behind.
 *   - Updates flow through a requestAnimationFrame so we coalesce dozens of
 *     pointermove events per tick into a single React state update, keeping
 *     the canvas at 60 fps under large-image re-layout cost.
 *   - We purposely do NOT touch the `y` coordinate when resizing from
 *     bottom/right handles so text/connection lines stay anchored.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { NodeData, Viewport } from '../types';
import {
  getNodeAspectRatio,
  getNodeRect,
  getNodeWidth,
  MAX_NODE_WIDTH,
  MIN_NODE_WIDTH,
  NodeRect,
} from '../utils/nodeGeometry';
import {
  AlignmentGuide,
  computeResizeSnap,
  getResizeSnapEscapeWorldPx,
} from './useSnapGuides';

export type ResizeHandle = 'tl' | 'tr' | 'bl' | 'br';

interface ResizeState {
  nodeId: string;
  handle: ResizeHandle;
  startPointerX: number;
  startPointerY: number;
  startWidth: number;
  startHeight: number;
  startX: number;
  startY: number;
  // anchor corner in world coords (the corner that stays fixed)
  anchorWorldX: number;
  anchorWorldY: number;
  aspect: number; // width / height
  zoom: number;
  // Snap context captured at beginResize so the snap engine doesn't
  // feed back on itself as the dragged node's own rect changes each frame.
  otherRects: NodeRect[];
  viewport: Viewport;
  viewportSize: { width: number; height: number } | null;
  // Hysteresis: remember the width we're currently locked to so clusters of
  // nearby snap candidates don't form a continuous "magnet trap". Set to
  // null when no snap is active, otherwise to the exact target width.
  lockedWidth: number | null;
  lockedGuides: AlignmentGuide[];
  // Velocity gate: last pointer position, so we can measure how far the
  // cursor moved since the previous frame and disable snap when the user
  // is clearly "sliding through" (fast drag). Figma / Lovart behave this
  // way — the snap is sticky when moving slowly, invisible when moving
  // fast.
  lastPointerX: number;
  lastPointerY: number;
}

// If the pointer moved more than this many *screen* pixels in a single
// move event, skip snap for this frame. At 60 fps a 4 px/frame threshold
// corresponds to ~240 screen px/s — i.e. an obviously intentional slide,
// well above the ~50 px/s of a user carefully seeking alignment.
const FAST_DRAG_SKIP_SNAP_SCREEN_PX = 4;

export const useNodeResizing = () => {
  const stateRef = useRef<ResizeState | null>(null);
  const setNodesRef = useRef<
    ((updater: (prev: NodeData[]) => NodeData[]) => void) | null
  >(null);
  const pendingFrame = useRef<number | null>(null);
  const pendingUpdate = useRef<
    { nodeId: string; x: number; y: number; width: number } | null
  >(null);

  const [isResizing, setIsResizing] = useState(false);
  const [resizingNodeId, setResizingNodeId] = useState<string | null>(null);
  const [snapGuides, setSnapGuides] = useState<AlignmentGuide[]>([]);

  useEffect(() => {
    return () => {
      if (pendingFrame.current !== null) {
        cancelAnimationFrame(pendingFrame.current);
      }
    };
  }, []);

  const flush = useCallback(() => {
    pendingFrame.current = null;
    const payload = pendingUpdate.current;
    pendingUpdate.current = null;
    if (!payload || !setNodesRef.current) return;
    setNodesRef.current((prev) =>
      prev.map((n) =>
        n.id === payload.nodeId
          ? { ...n, x: payload.x, y: payload.y, width: payload.width }
          : n,
      ),
    );
  }, []);

  const beginResize = useCallback(
    (
      e: React.PointerEvent,
      node: NodeData,
      handle: ResizeHandle,
      viewport: Viewport,
      allNodes: NodeData[],
      viewportSize: { width: number; height: number } | null,
    ) => {
      e.stopPropagation();
      e.preventDefault();

      const width = getNodeWidth(node);
      const aspect = getNodeAspectRatio(node);
      const height = width / aspect;

      // anchor corner = corner opposite the handle being dragged
      const anchorWorldX = handle === 'tl' || handle === 'bl'
        ? node.x + width
        : node.x;
      const anchorWorldY = handle === 'tl' || handle === 'tr'
        ? node.y + height
        : node.y;

      // Freeze the snap-target rects at drag-start so the dragged node's
      // own shrinking/growing doesn't perturb targets mid-frame.
      const otherRects = allNodes
        .filter((n) => n.id !== node.id)
        .map(getNodeRect);

      stateRef.current = {
        nodeId: node.id,
        handle,
        startPointerX: e.clientX,
        startPointerY: e.clientY,
        startWidth: width,
        startHeight: height,
        startX: node.x,
        startY: node.y,
        anchorWorldX,
        anchorWorldY,
        aspect,
        zoom: Math.max(viewport.zoom, 0.05),
        otherRects,
        viewport,
        viewportSize,
        lockedWidth: null,
        lockedGuides: [],
        lastPointerX: e.clientX,
        lastPointerY: e.clientY,
      };

      setIsResizing(true);
      setResizingNodeId(node.id);
      setSnapGuides([]);

      if (e.target instanceof HTMLElement) {
        try {
          e.target.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
    },
    [],
  );

  /**
   * Call on every pointermove while a resize is active. Returns `true` if
   * the event was consumed by the resize engine.
   */
  const updateResize = useCallback(
    (
      e: React.PointerEvent,
      onUpdateNodes: (updater: (prev: NodeData[]) => NodeData[]) => void,
    ): boolean => {
      const s = stateRef.current;
      if (!s) return false;

      setNodesRef.current = onUpdateNodes;

      // Convert pointer delta from screen -> world space
      const dxScreen = e.clientX - s.startPointerX;
      const dyScreen = e.clientY - s.startPointerY;
      const dx = dxScreen / s.zoom;
      const dy = dyScreen / s.zoom;

      // Sign of the width delta depending on which corner we grabbed
      const signX = s.handle === 'tr' || s.handle === 'br' ? 1 : -1;
      const signY = s.handle === 'bl' || s.handle === 'br' ? 1 : -1;

      // Candidate new width from each axis, pick the larger magnitude so
      // movement in either direction feels responsive (standard Figma-style
      // diagonal resize behaviour).
      const widthFromX = s.startWidth + signX * dx;
      const widthFromY = (s.startHeight + signY * dy) * s.aspect;

      let newWidth =
        Math.abs(widthFromX - s.startWidth) > Math.abs(widthFromY - s.startWidth)
          ? widthFromX
          : widthFromY;

      newWidth = Math.max(MIN_NODE_WIDTH, Math.min(MAX_NODE_WIDTH, newWidth));

      // Apply Lovart-style snap with three gates, layered in order:
      //   1. Velocity gate — if the cursor moved more than a few screen
      //      pixels since the last frame, the user is clearly sliding
      //      through, so we skip snap entirely this frame. This alone
      //      kills the "clusters of 2+ guide lines feel sticky" problem
      //      because fast pulls never get re-captured.
      //   2. Hysteresis — if we're already locked to a target width, keep
      //      that width until the pointer pulls past the escape distance
      //      (~7.5 screen px / zoom). Stops a single target from wobbling.
      //   3. Snap solve — only runs when the user is moving slowly AND
      //      has left the previous lock's hold zone.
      const dxScreenSinceLast = e.clientX - s.lastPointerX;
      const dyScreenSinceLast = e.clientY - s.lastPointerY;
      const pointerMovedScreen = Math.hypot(
        dxScreenSinceLast,
        dyScreenSinceLast,
      );
      s.lastPointerX = e.clientX;
      s.lastPointerY = e.clientY;
      const isFastDrag = pointerMovedScreen > FAST_DRAG_SKIP_SNAP_SCREEN_PX;

      let snapWidth = newWidth;
      let snapGuidesOut: AlignmentGuide[] = [];
      const escapeWorld = getResizeSnapEscapeWorldPx(s.viewport.zoom);

      if (isFastDrag) {
        // Fast drag: bypass snap, drop any previous lock so the next slow
        // frame can re-evaluate fresh instead of re-capturing on the same
        // old target.
        snapWidth = newWidth;
        snapGuidesOut = [];
        s.lockedWidth = null;
        s.lockedGuides = [];
      } else if (
        s.lockedWidth !== null &&
        Math.abs(newWidth - s.lockedWidth) <= escapeWorld
      ) {
        // Still within the hold range around the locked target — keep the
        // previous snap width and guides, don't re-solve.
        snapWidth = s.lockedWidth;
        snapGuidesOut = s.lockedGuides;
      } else {
        const solved = computeResizeSnap({
          handle: s.handle,
          anchorX: s.anchorWorldX,
          anchorY: s.anchorWorldY,
          aspect: s.aspect,
          unsnappedWidth: newWidth,
          otherRects: s.otherRects,
          viewport: s.viewport,
          viewportSize: s.viewportSize,
        });
        // If we snapped to something new, remember it as the hold target.
        // Otherwise clear the lock so the next close target is free to
        // grab us again.
        if (Math.abs(solved.width - newWidth) > 0.5) {
          snapWidth = solved.width;
          snapGuidesOut = solved.guides;
          s.lockedWidth = solved.width;
          s.lockedGuides = solved.guides;
        } else {
          snapWidth = newWidth;
          snapGuidesOut = [];
          s.lockedWidth = null;
          s.lockedGuides = [];
        }
      }

      const snappedWidth = Math.max(
        MIN_NODE_WIDTH,
        Math.min(MAX_NODE_WIDTH, snapWidth),
      );
      const newHeight = snappedWidth / s.aspect;

      // Re-anchor position so the opposite corner stays put.
      const newX = s.handle === 'tl' || s.handle === 'bl'
        ? s.anchorWorldX - snappedWidth
        : s.anchorWorldX;
      const newY = s.handle === 'tl' || s.handle === 'tr'
        ? s.anchorWorldY - newHeight
        : s.anchorWorldY;

      pendingUpdate.current = {
        nodeId: s.nodeId,
        x: newX,
        y: newY,
        width: snappedWidth,
      };

      // Guides can update on every move (they're cheap) so we don't need
      // to coalesce them into the rAF tick — keeps guide-lines responsive
      // even if React batches the node update.
      setSnapGuides(snapGuidesOut);

      if (pendingFrame.current === null) {
        pendingFrame.current = requestAnimationFrame(flush);
      }
      return true;
    },
    [flush],
  );

  const endResize = useCallback(() => {
    if (!stateRef.current) return;
    if (pendingFrame.current !== null) {
      cancelAnimationFrame(pendingFrame.current);
      pendingFrame.current = null;
      flush();
    }
    stateRef.current = null;
    setIsResizing(false);
    setResizingNodeId(null);
    setSnapGuides([]);
  }, [flush]);

  return {
    beginResize,
    updateResize,
    endResize,
    isResizing,
    resizingNodeId,
    snapGuides,
  };
};
