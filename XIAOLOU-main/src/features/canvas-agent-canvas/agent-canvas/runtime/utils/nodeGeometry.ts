/**
 * nodeGeometry.ts
 *
 * Shared helpers that compute a node's rendered width/height/bounding-box in
 * canvas world coordinates. Used by:
 *   - CanvasNode.tsx            (style.width, resize handle positions)
 *   - useNodeResizing.ts        (drag-to-resize)
 *   - useSnapGuides.ts          (snap target rectangles)
 *   - SelectionBoundingBox.tsx  (multi-select bounding box)
 *   - ConnectionsLayer.tsx      (anchor points for edges)
 *
 * Height is ALWAYS derived from width + the node's effective aspect ratio, so
 * when a user drags a corner handle the aspect ratio is never broken. A single
 * stored `width` field on NodeData is enough to describe any rendered size.
 */

import { NodeData, NodeType } from '../types';

// ─── Default content widths (in world px) ────────────────────────────────────
// Match the legacy tailwind classes that used to be hard-coded in CanvasNode:
//   VIDEO            -> w-[385px]
//   IMAGE / LOCAL    -> w-[365px]
//   IMAGE_EDITOR/VE  -> w-[340px] placeholder, "auto"/500 with content
//   CAMERA_ANGLE     -> w-[340px]
//   TEXT             -> fits content, treat as 340px for bounds
export const DEFAULT_NODE_WIDTH: Record<string, number> = {
  [NodeType.VIDEO]: 385,
  [NodeType.LOCAL_VIDEO_MODEL]: 385,
  [NodeType.IMAGE]: 365,
  [NodeType.LOCAL_IMAGE_MODEL]: 365,
  [NodeType.IMAGE_EDITOR]: 340,
  [NodeType.VIDEO_EDITOR]: 340,
  [NodeType.CAMERA_ANGLE]: 340,
  [NodeType.TEXT]: 340,
  [NodeType.AUDIO]: 340,
  [NodeType.STORYBOARD]: 340,
};

export const MIN_NODE_WIDTH = 160;
export const MAX_NODE_WIDTH = 2400;

// Node types whose width is user-resizable via corner handles. The rest
// (TEXT, IMAGE_EDITOR, VIDEO_EDITOR, ...) still auto-layout the same way.
const RESIZABLE_TYPES: ReadonlySet<NodeType> = new Set([
  NodeType.IMAGE,
  NodeType.VIDEO,
  NodeType.LOCAL_IMAGE_MODEL,
  NodeType.LOCAL_VIDEO_MODEL,
]);

export function isResizableNode(node: Pick<NodeData, 'type'>): boolean {
  return RESIZABLE_TYPES.has(node.type);
}

/**
 * Effective aspect ratio (width / height) used for rendered content.
 * Priority:
 *   1. resultAspectRatio (actual dimensions of the generated media)
 *   2. user-selected aspectRatio (e.g. "16:9" / "9:16" / "1:1")
 *   3. sensible defaults (video -> 16/9, image -> 4/3)
 */
export function getNodeAspectRatio(node: NodeData): number {
  const fallback = node.type === NodeType.VIDEO || node.type === NodeType.LOCAL_VIDEO_MODEL
    ? 16 / 9
    : 4 / 3;

  if (node.resultAspectRatio) {
    const parts = node.resultAspectRatio.split(/[/:x×]/);
    if (parts.length === 2) {
      const w = parseFloat(parts[0]);
      const h = parseFloat(parts[1]);
      if (isFinite(w) && isFinite(h) && w > 0 && h > 0) {
        return w / h;
      }
    }
  }

  if (node.aspectRatio && node.aspectRatio !== 'Auto') {
    const parts = node.aspectRatio.split(/[/:x×]/);
    if (parts.length === 2) {
      const w = parseFloat(parts[0]);
      const h = parseFloat(parts[1]);
      if (isFinite(w) && isFinite(h) && w > 0 && h > 0) {
        return w / h;
      }
    }
  }

  return fallback;
}

/**
 * Effective content width in world px. Uses the user override
 * (`node.width` set by the corner resize handles) when present, otherwise
 * falls back to the type default.
 */
export function getNodeWidth(node: NodeData): number {
  if (typeof node.width === 'number' && isFinite(node.width) && node.width > 0) {
    return Math.max(MIN_NODE_WIDTH, Math.min(MAX_NODE_WIDTH, node.width));
  }
  return DEFAULT_NODE_WIDTH[node.type] ?? 365;
}

/**
 * Height of just the media/content area (the image/video box — NOT the
 * floating title bar). Used for snap/boundingbox math so the guides align
 * with what the user visually sees.
 */
export function getNodeContentHeight(node: NodeData): number {
  const width = getNodeWidth(node);
  const ratio = getNodeAspectRatio(node);
  if (!isFinite(ratio) || ratio <= 0) return width;
  return width / ratio;
}

export interface NodeRect {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  right: number;
  bottom: number;
}

/**
 * World-space bounding rectangle of a node's rendered content area. Used by
 * the snap engine — we deliberately ignore floating titles and connector
 * bumps here because Lovart/Figma snap to the visible content edges, not
 * the chrome around them.
 */
export function getNodeRect(node: NodeData): NodeRect {
  const width = getNodeWidth(node);
  const height = getNodeContentHeight(node);
  return {
    x: node.x,
    y: node.y,
    width,
    height,
    centerX: node.x + width / 2,
    centerY: node.y + height / 2,
    right: node.x + width,
    bottom: node.y + height,
  };
}
