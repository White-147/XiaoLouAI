/**
 * AlignmentGuides.tsx
 *
 * Renders the Figma/Lovart-style pink snap guide lines while a node is
 * being dragged. The lines live inside the already-scaled canvas content
 * layer, so their x/y positions are in world coordinates.
 *
 * We use SVG with `vector-effect="non-scaling-stroke"` so the stroke width
 * stays at ~1 screen pixel regardless of canvas zoom level — otherwise the
 * lines would get cartoon-thick at high zoom or vanish at low zoom.
 */

import React from 'react';
import type { AlignmentGuide } from '../../hooks/useSnapGuides';

interface AlignmentGuidesProps {
  guides: AlignmentGuide[];
}

export const AlignmentGuides: React.FC<AlignmentGuidesProps> = ({ guides }) => {
  if (!guides || guides.length === 0) return null;

  return (
    <svg
      className="absolute top-0 left-0 overflow-visible pointer-events-none"
      style={{ width: 1, height: 1, zIndex: 60 }}
      aria-hidden
    >
      {guides.map((g) => {
        const stroke = g.kind === 'canvas-center' ? '#a78bfa' : '#ff3d9a';
        if (g.orientation === 'vertical') {
          return (
            <line
              key={g.id}
              x1={g.position}
              y1={g.start}
              x2={g.position}
              y2={g.end}
              stroke={stroke}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              strokeDasharray={g.kind === 'equal-spacing' ? '4 3' : undefined}
            />
          );
        }
        return (
          <line
            key={g.id}
            x1={g.start}
            y1={g.position}
            x2={g.end}
            y2={g.position}
            stroke={stroke}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            strokeDasharray={g.kind === 'equal-spacing' ? '4 3' : undefined}
          />
        );
      })}
    </svg>
  );
};
