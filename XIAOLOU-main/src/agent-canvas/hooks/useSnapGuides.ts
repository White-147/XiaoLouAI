/**
 * useSnapGuides.ts
 *
 * Lovart/Figma-style alignment snapping for node drag. Given a dragged node
 * and the other nodes in the canvas, returns:
 *   - a corrected (dx, dy) delta that snaps the node to nearby targets
 *   - a list of visible alignment guides to draw while the drag is in flight
 *
 * Snap targets (matches what the user asked for):
 *   A) Other nodes' left/right/top/bottom edges
 *   B) Other nodes' horizontal/vertical center lines
 *   C) Equal spacing between the dragged node and pairs of other nodes
 *      (classic "two pink arrows" smart guide)
 *   D) The viewport center (so users can center content on screen)
 *
 * The snap threshold is expressed in *screen* pixels so behaviour stays
 * consistent regardless of zoom level, then converted to world px before
 * being compared against positions.
 */

import { NodeData, Viewport } from '../types';
import { getNodeRect, NodeRect } from '../utils/nodeGeometry';

// Distance in *screen* pixels within which a candidate becomes a snap.
//   - DRAG uses a generous 6 px (same feel as Figma/Lovart on drag).
//   - RESIZE uses a tighter 3 px because corner-resize generates many more
//     candidate widths per frame (3 features × every other rect, per axis),
//     so a wide capture window makes clusters feel like "can't pull the
//     handle" — the cursor keeps getting re-captured by the next nearby
//     target one pixel over.
const SNAP_THRESHOLD_SCREEN_PX = 6;
const RESIZE_SNAP_THRESHOLD_SCREEN_PX = 3;
// Once a resize width is locked to a snap target, the user has to pull the
// width at least this many *screen* pixels past that target before we
// consider evaluating other candidates. Prevents the classic "sticky
// magnet chain" where clusters of nearby targets form a continuous trap.
const RESIZE_SNAP_ESCAPE_SCREEN_PX = RESIZE_SNAP_THRESHOLD_SCREEN_PX * 2.5;

export type GuideOrientation = 'vertical' | 'horizontal';

export interface AlignmentGuide {
  id: string;
  orientation: GuideOrientation;
  // For vertical guides: x in world space, and [y1, y2] span to draw.
  // For horizontal guides: y in world space, and [x1, x2] span to draw.
  position: number;
  start: number;
  end: number;
  kind: 'edge' | 'center' | 'canvas-center' | 'equal-spacing';
  // Optional label — used for equal-spacing pair distance display
  label?: string;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: AlignmentGuide[];
}

interface SnapOpts {
  draggedRect: NodeRect; // rect BEFORE applying dx/dy (i.e. at last committed position)
  proposedDx: number;
  proposedDy: number;
  otherRects: NodeRect[];
  viewport: Viewport;
  viewportSize?: { width: number; height: number } | null;
}

interface Candidate {
  // the proposed position (in world coords) for the chosen edge
  proposed: number;
  // the target value we want to snap to
  target: number;
  // which feature of the dragged rect this edge represents
  feature: 'left' | 'right' | 'centerX' | 'top' | 'bottom' | 'centerY';
  // span of the guide line in the OPPOSITE axis
  span: [number, number];
  kind: AlignmentGuide['kind'];
  targetNodeId?: string;
}

function axisFeatures(rect: NodeRect) {
  return {
    vertical: [
      { feature: 'left' as const, value: rect.x },
      { feature: 'centerX' as const, value: rect.centerX },
      { feature: 'right' as const, value: rect.right },
    ],
    horizontal: [
      { feature: 'top' as const, value: rect.y },
      { feature: 'centerY' as const, value: rect.centerY },
      { feature: 'bottom' as const, value: rect.bottom },
    ],
  };
}

/**
 * Compute snapped dx/dy and the set of guide lines to render for the
 * current drag frame.
 */
export function computeSnap(opts: SnapOpts): SnapResult {
  const { draggedRect, proposedDx, proposedDy, otherRects, viewport, viewportSize } = opts;

  // Candidate rect at the proposed position (before snap correction).
  const cand: NodeRect = {
    x: draggedRect.x + proposedDx,
    y: draggedRect.y + proposedDy,
    width: draggedRect.width,
    height: draggedRect.height,
    centerX: draggedRect.centerX + proposedDx,
    centerY: draggedRect.centerY + proposedDy,
    right: draggedRect.right + proposedDx,
    bottom: draggedRect.bottom + proposedDy,
  };

  const thresholdWorld = SNAP_THRESHOLD_SCREEN_PX / Math.max(viewport.zoom, 0.05);

  const vCandidates: Candidate[] = [];
  const hCandidates: Candidate[] = [];

  const candFeatures = axisFeatures(cand);

  // A) + B) edge + center alignment to other nodes
  for (const other of otherRects) {
    const otherFeatures = axisFeatures(other);

    // vertical alignment
    for (const c of candFeatures.vertical) {
      for (const o of otherFeatures.vertical) {
        const distance = Math.abs(c.value - o.value);
        if (distance <= thresholdWorld) {
          const span: [number, number] = [
            Math.min(cand.y, other.y) - 8,
            Math.max(cand.bottom, other.bottom) + 8,
          ];
          const kind: Candidate['kind'] =
            c.feature === 'centerX' && o.feature === 'centerX' ? 'center' : 'edge';
          vCandidates.push({
            proposed: c.value,
            target: o.value,
            feature: c.feature,
            span,
            kind,
          });
        }
      }
    }

    // horizontal alignment
    for (const c of candFeatures.horizontal) {
      for (const o of otherFeatures.horizontal) {
        const distance = Math.abs(c.value - o.value);
        if (distance <= thresholdWorld) {
          const span: [number, number] = [
            Math.min(cand.x, other.x) - 8,
            Math.max(cand.right, other.right) + 8,
          ];
          const kind: Candidate['kind'] =
            c.feature === 'centerY' && o.feature === 'centerY' ? 'center' : 'edge';
          hCandidates.push({
            proposed: c.value,
            target: o.value,
            feature: c.feature,
            span,
            kind,
          });
        }
      }
    }
  }

  // D) canvas viewport center (only when we know the viewport dimensions)
  if (viewportSize && viewportSize.width > 0 && viewportSize.height > 0) {
    const worldCenterX =
      (viewportSize.width / 2 - viewport.x) / Math.max(viewport.zoom, 0.05);
    const worldCenterY =
      (viewportSize.height / 2 - viewport.y) / Math.max(viewport.zoom, 0.05);

    if (Math.abs(cand.centerX - worldCenterX) <= thresholdWorld) {
      vCandidates.push({
        proposed: cand.centerX,
        target: worldCenterX,
        feature: 'centerX',
        span: [cand.y - 200, cand.bottom + 200],
        kind: 'canvas-center',
      });
    }
    if (Math.abs(cand.centerY - worldCenterY) <= thresholdWorld) {
      hCandidates.push({
        proposed: cand.centerY,
        target: worldCenterY,
        feature: 'centerY',
        span: [cand.x - 200, cand.right + 200],
        kind: 'canvas-center',
      });
    }
  }

  // C) equal spacing: for every pair (a, b) of other rects on the same
  // horizontal row, if gap(dragged, a) ≈ gap(a, b) -> snap the dragged to
  // equalize. Same for vertical columns.
  const equalSpacing = computeEqualSpacingCandidates(
    cand,
    otherRects,
    thresholdWorld,
  );
  vCandidates.push(...equalSpacing.vertical);
  hCandidates.push(...equalSpacing.horizontal);

  // Pick the closest candidate per axis (prefer center > edge > equal > canvas)
  const pickBest = (cands: Candidate[]): Candidate | null => {
    if (cands.length === 0) return null;
    const kindRank: Record<Candidate['kind'], number> = {
      center: 3,
      edge: 2,
      'equal-spacing': 1,
      'canvas-center': 0,
    };
    return cands
      .slice()
      .sort((a, b) => {
        const rk = kindRank[b.kind] - kindRank[a.kind];
        if (rk !== 0) return rk;
        return Math.abs(a.proposed - a.target) - Math.abs(b.proposed - b.target);
      })[0];
  };

  const bestV = pickBest(vCandidates);
  const bestH = pickBest(hCandidates);

  const correctedDx = bestV ? proposedDx + (bestV.target - bestV.proposed) : proposedDx;
  const correctedDy = bestH ? proposedDy + (bestH.target - bestH.proposed) : proposedDy;

  // Gather all guides that match the winning value (so "aligned with three
  // things" draws three pink lines, like Figma).
  const guides: AlignmentGuide[] = [];
  if (bestV) {
    for (const c of vCandidates) {
      if (Math.abs(c.target - bestV.target) < 0.5) {
        guides.push({
          id: `v-${guides.length}`,
          orientation: 'vertical',
          position: c.target,
          start: c.span[0],
          end: c.span[1],
          kind: c.kind,
        });
      }
    }
  }
  if (bestH) {
    for (const c of hCandidates) {
      if (Math.abs(c.target - bestH.target) < 0.5) {
        guides.push({
          id: `h-${guides.length}`,
          orientation: 'horizontal',
          position: c.target,
          start: c.span[0],
          end: c.span[1],
          kind: c.kind,
        });
      }
    }
  }

  return { dx: correctedDx, dy: correctedDy, guides };
}

/**
 * Equal-spacing snap: find pairs of other nodes that share a row (or
 * column) with the dragged candidate, and where the horizontal (or
 * vertical) gap between them equals the gap between the candidate and
 * the nearest of the two. When that happens, snap the candidate so the
 * two gaps become *exactly* equal and draw two inline guide segments.
 */
function computeEqualSpacingCandidates(
  cand: NodeRect,
  others: NodeRect[],
  thresholdWorld: number,
): { vertical: Candidate[]; horizontal: Candidate[] } {
  const vertical: Candidate[] = [];
  const horizontal: Candidate[] = [];

  // Horizontal equal spacing: pick pairs of rects whose vertical ranges
  // overlap the dragged candidate.
  const horizontallyAligned = others.filter(
    (r) => !(r.bottom < cand.y - 4 || r.y > cand.bottom + 4),
  );
  // Sort left-to-right once so we can iterate pairs cheaply.
  const byX = horizontallyAligned.slice().sort((a, b) => a.x - b.x);

  for (let i = 0; i < byX.length; i++) {
    const a = byX[i];
    // Case 1: dragged is on the RIGHT of both a, b (a .. b .. cand)
    for (let j = 0; j < byX.length; j++) {
      if (i === j) continue;
      const b = byX[j];
      if (b.x <= a.right) continue; // must be clearly to the right of a

      // pattern: a-gap-b-gap-cand
      const gap1 = b.x - a.right;
      const candTargetX = b.right + gap1;
      if (cand.x > b.right && Math.abs(cand.x - candTargetX) <= thresholdWorld) {
        const midY = Math.min(cand.y, a.y, b.y) - 10;
        vertical.push({
          proposed: cand.x,
          target: candTargetX,
          feature: 'left',
          span: [midY, Math.max(cand.bottom, a.bottom, b.bottom) + 10],
          kind: 'equal-spacing',
        });
      }
    }
    // Case 2: pattern cand-gap-a-gap-b (dragged to the LEFT of both)
    for (let j = 0; j < byX.length; j++) {
      if (i === j) continue;
      const b = byX[j];
      if (b.x <= a.right) continue;
      const gap1 = b.x - a.right;
      const candTargetRight = a.x - gap1;
      if (cand.right < a.x && Math.abs(cand.right - candTargetRight) <= thresholdWorld) {
        vertical.push({
          proposed: cand.right,
          target: candTargetRight,
          feature: 'right',
          span: [
            Math.min(cand.y, a.y, b.y) - 10,
            Math.max(cand.bottom, a.bottom, b.bottom) + 10,
          ],
          kind: 'equal-spacing',
        });
      }
    }
    // Case 3: dragged sits BETWEEN a and b (a .. cand .. b) — equalise.
    for (let j = i + 1; j < byX.length; j++) {
      const b = byX[j];
      if (cand.x > a.right && cand.right < b.x) {
        const desiredCenterX = (a.right + b.x) / 2;
        if (Math.abs(cand.centerX - desiredCenterX) <= thresholdWorld) {
          vertical.push({
            proposed: cand.centerX,
            target: desiredCenterX,
            feature: 'centerX',
            span: [
              Math.min(cand.y, a.y, b.y) - 10,
              Math.max(cand.bottom, a.bottom, b.bottom) + 10,
            ],
            kind: 'equal-spacing',
          });
        }
      }
    }
  }

  // Vertical equal spacing: same but swap axes.
  const verticallyAligned = others.filter(
    (r) => !(r.right < cand.x - 4 || r.x > cand.right + 4),
  );
  const byY = verticallyAligned.slice().sort((a, b) => a.y - b.y);

  for (let i = 0; i < byY.length; i++) {
    const a = byY[i];
    for (let j = 0; j < byY.length; j++) {
      if (i === j) continue;
      const b = byY[j];
      if (b.y <= a.bottom) continue;

      const gap1 = b.y - a.bottom;
      const candTargetY = b.bottom + gap1;
      if (cand.y > b.bottom && Math.abs(cand.y - candTargetY) <= thresholdWorld) {
        horizontal.push({
          proposed: cand.y,
          target: candTargetY,
          feature: 'top',
          span: [
            Math.min(cand.x, a.x, b.x) - 10,
            Math.max(cand.right, a.right, b.right) + 10,
          ],
          kind: 'equal-spacing',
        });
      }
    }
    for (let j = 0; j < byY.length; j++) {
      if (i === j) continue;
      const b = byY[j];
      if (b.y <= a.bottom) continue;
      const gap1 = b.y - a.bottom;
      const candTargetBottom = a.y - gap1;
      if (cand.bottom < a.y && Math.abs(cand.bottom - candTargetBottom) <= thresholdWorld) {
        horizontal.push({
          proposed: cand.bottom,
          target: candTargetBottom,
          feature: 'bottom',
          span: [
            Math.min(cand.x, a.x, b.x) - 10,
            Math.max(cand.right, a.right, b.right) + 10,
          ],
          kind: 'equal-spacing',
        });
      }
    }
    for (let j = i + 1; j < byY.length; j++) {
      const b = byY[j];
      if (cand.y > a.bottom && cand.bottom < b.y) {
        const desiredCenterY = (a.bottom + b.y) / 2;
        if (Math.abs(cand.centerY - desiredCenterY) <= thresholdWorld) {
          horizontal.push({
            proposed: cand.centerY,
            target: desiredCenterY,
            feature: 'centerY',
            span: [
              Math.min(cand.x, a.x, b.x) - 10,
              Math.max(cand.right, a.right, b.right) + 10,
            ],
            kind: 'equal-spacing',
          });
        }
      }
    }
  }

  return { vertical, horizontal };
}

/** Convenience helper: project every node once to a NodeRect array. */
export function buildRects(nodes: NodeData[]): NodeRect[] {
  return nodes.map(getNodeRect);
}

// ─────────────────────────────────────────────────────────────────────────────
// RESIZE SNAP
// ─────────────────────────────────────────────────────────────────────────────

type ResizeHandleCode = 'tl' | 'tr' | 'bl' | 'br';

interface ResizeSnapOpts {
  handle: ResizeHandleCode;
  anchorX: number; // fixed corner, world coords
  anchorY: number;
  aspect: number; // width / height, locked
  unsnappedWidth: number; // candidate width before snap, world px
  otherRects: NodeRect[];
  viewport: Viewport;
  viewportSize?: { width: number; height: number } | null;
}

export interface ResizeSnapResult {
  width: number;
  guides: AlignmentGuide[];
}

/** Screen-space distance a resize must be pulled past a locked snap target
 * before hysteresis releases the lock and other candidates are considered. */
export function getResizeSnapEscapeWorldPx(zoom: number): number {
  return RESIZE_SNAP_ESCAPE_SCREEN_PX / Math.max(zoom, 0.05);
}

/**
 * Lovart-style snap while a node is being corner-resized with its aspect
 * ratio locked. Given the proposed width (how far the pointer has moved),
 * we test every candidate target and pick the one that requires the
 * smallest adjustment to the width. Aspect lock means the two moving
 * edges (e.g. LEFT + TOP for the 'tl' corner) are coupled — snapping one
 * axis automatically repositions the other, so we snap exactly one axis
 * per frame and then draw guides for every axis that incidentally aligns.
 */
export function computeResizeSnap(opts: ResizeSnapOpts): ResizeSnapResult {
  const {
    handle,
    anchorX,
    anchorY,
    aspect,
    unsnappedWidth,
    otherRects,
    viewport,
    viewportSize,
  } = opts;

  if (unsnappedWidth <= 0 || !isFinite(aspect) || aspect <= 0) {
    return { width: unsnappedWidth, guides: [] };
  }

  const usesLeft = handle === 'tl' || handle === 'bl';
  const usesTop = handle === 'tl' || handle === 'tr';

  const thresholdWorld =
    RESIZE_SNAP_THRESHOLD_SCREEN_PX / Math.max(viewport.zoom, 0.05);

  // Each candidate tells us "snap X (or Y) moving edge to target T, which
  // would imply width = W_candidate". We then keep the candidate that's
  // closest to the unsnapped width in *world px* terms (equivalent to
  // screen px since we treat all candidates at the same zoom).
  interface Cand {
    widthAt: number; // implied width if we snap to this target
    axis: 'x' | 'y';
    targetValue: number;
    featureLabel: 'left' | 'right' | 'top' | 'bottom';
    kind: AlignmentGuide['kind'];
  }
  const candidates: Cand[] = [];

  // -- collect X-axis targets (movingLeft or movingRight snapped to value)
  const xTargets: { value: number; kind: AlignmentGuide['kind'] }[] = [];
  for (const r of otherRects) {
    xTargets.push(
      { value: r.x, kind: 'edge' },
      { value: r.right, kind: 'edge' },
      { value: r.centerX, kind: 'center' },
    );
  }
  if (viewportSize && viewportSize.width > 0) {
    const worldCenterX =
      (viewportSize.width / 2 - viewport.x) / Math.max(viewport.zoom, 0.05);
    xTargets.push({ value: worldCenterX, kind: 'canvas-center' });
  }

  // -- collect Y-axis targets
  const yTargets: { value: number; kind: AlignmentGuide['kind'] }[] = [];
  for (const r of otherRects) {
    yTargets.push(
      { value: r.y, kind: 'edge' },
      { value: r.bottom, kind: 'edge' },
      { value: r.centerY, kind: 'center' },
    );
  }
  if (viewportSize && viewportSize.height > 0) {
    const worldCenterY =
      (viewportSize.height / 2 - viewport.y) / Math.max(viewport.zoom, 0.05);
    yTargets.push({ value: worldCenterY, kind: 'canvas-center' });
  }

  // Evaluate X-axis candidates — width required to move the LEFT (or RIGHT)
  // edge onto each target.
  for (const t of xTargets) {
    let widthAt: number;
    if (usesLeft) {
      // anchorX - W = target  =>  W = anchorX - target
      widthAt = anchorX - t.value;
    } else {
      // anchorX + W = target  =>  W = target - anchorX
      widthAt = t.value - anchorX;
    }
    if (widthAt <= 0) continue;
    candidates.push({
      widthAt,
      axis: 'x',
      targetValue: t.value,
      featureLabel: usesLeft ? 'left' : 'right',
      kind: t.kind,
    });
  }

  // Evaluate Y-axis candidates — width required to move the TOP (or BOTTOM)
  // edge onto each target given the aspect ratio.
  for (const t of yTargets) {
    let heightAt: number;
    if (usesTop) {
      heightAt = anchorY - t.value;
    } else {
      heightAt = t.value - anchorY;
    }
    if (heightAt <= 0) continue;
    const widthAt = heightAt * aspect;
    if (widthAt <= 0) continue;
    candidates.push({
      widthAt,
      axis: 'y',
      targetValue: t.value,
      featureLabel: usesTop ? 'top' : 'bottom',
      kind: t.kind,
    });
  }

  // Keep only candidates within the width-delta threshold, then pick the
  // closest one (ties broken by kind rank so center > edge > canvas-center).
  const kindRank: Record<AlignmentGuide['kind'], number> = {
    center: 3,
    edge: 2,
    'equal-spacing': 1,
    'canvas-center': 0,
  };
  const viable = candidates.filter(
    (c) => Math.abs(c.widthAt - unsnappedWidth) <= thresholdWorld,
  );
  viable.sort((a, b) => {
    const da = Math.abs(a.widthAt - unsnappedWidth);
    const db = Math.abs(b.widthAt - unsnappedWidth);
    if (Math.abs(da - db) > 0.5) return da - db;
    return kindRank[b.kind] - kindRank[a.kind];
  });

  const best = viable[0] ?? null;
  const chosenWidth = best ? best.widthAt : unsnappedWidth;
  const chosenHeight = chosenWidth / aspect;

  // With the chosen width, compute the dragged rect and emit guides for
  // every target (x or y) that now aligns with a moving edge within 0.5 px.
  const rectX = usesLeft ? anchorX - chosenWidth : anchorX;
  const rectRight = usesLeft ? anchorX : anchorX + chosenWidth;
  const rectY = usesTop ? anchorY - chosenHeight : anchorY;
  const rectBottom = usesTop ? anchorY : anchorY + chosenHeight;

  const movingX = usesLeft ? rectX : rectRight;
  const movingY = usesTop ? rectY : rectBottom;

  const guides: AlignmentGuide[] = [];
  let gid = 0;

  // X-axis guides: any target whose value matches movingX within 0.5px.
  for (const t of xTargets) {
    if (Math.abs(t.value - movingX) > 0.5) continue;
    // Find the other rect whose feature matches, so we can scope the
    // guide span to that rect + the dragged rect (keeps lines short).
    const spanRect = otherRects.find(
      (r) =>
        Math.abs(r.x - t.value) < 0.5 ||
        Math.abs(r.right - t.value) < 0.5 ||
        Math.abs(r.centerX - t.value) < 0.5,
    );
    const yTop = spanRect
      ? Math.min(rectY, spanRect.y) - 8
      : rectY - 200;
    const yBot = spanRect
      ? Math.max(rectBottom, spanRect.bottom) + 8
      : rectBottom + 200;
    guides.push({
      id: `rv-${gid++}`,
      orientation: 'vertical',
      position: t.value,
      start: yTop,
      end: yBot,
      kind: t.kind,
    });
  }

  // Y-axis guides.
  for (const t of yTargets) {
    if (Math.abs(t.value - movingY) > 0.5) continue;
    const spanRect = otherRects.find(
      (r) =>
        Math.abs(r.y - t.value) < 0.5 ||
        Math.abs(r.bottom - t.value) < 0.5 ||
        Math.abs(r.centerY - t.value) < 0.5,
    );
    const xLeft = spanRect
      ? Math.min(rectX, spanRect.x) - 8
      : rectX - 200;
    const xRight = spanRect
      ? Math.max(rectRight, spanRect.right) + 8
      : rectRight + 200;
    guides.push({
      id: `rh-${gid++}`,
      orientation: 'horizontal',
      position: t.value,
      start: xLeft,
      end: xRight,
      kind: t.kind,
    });
  }

  return { width: chosenWidth, guides };
}
