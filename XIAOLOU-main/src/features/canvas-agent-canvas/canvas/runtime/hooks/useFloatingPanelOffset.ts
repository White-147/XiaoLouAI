import React from 'react';

type FloatingPanelOffsetOptions = {
  localScale: number;
  deps?: ReadonlyArray<unknown>;
  padding?: {
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
  };
};

type FloatingPanelOffsetResult = {
  ref: React.RefObject<HTMLDivElement>;
  transform: string;
};

export function useFloatingPanelOffset(
  options: FloatingPanelOffsetOptions,
): FloatingPanelOffsetResult {
  const { localScale, deps = [], padding } = options;
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });

  const leftPadding = padding?.left ?? 96;
  const rightPadding = padding?.right ?? 24;
  const topPadding = padding?.top ?? 24;
  const bottomPadding = padding?.bottom ?? 120;

  React.useLayoutEffect(() => {
    let frameId = 0;

    const measure = () => {
      const element = panelRef.current;
      if (!element || typeof window === 'undefined') {
        return;
      }

      const rect = element.getBoundingClientRect();
      const maxRight = window.innerWidth - rightPadding;
      const maxBottom = window.innerHeight - bottomPadding;

      let nextX = 0;
      let nextY = 0;

      if (rect.left < leftPadding) {
        nextX = leftPadding - rect.left;
      } else if (rect.right > maxRight) {
        nextX = maxRight - rect.right;
      }

      if (rect.top < topPadding) {
        nextY = topPadding - rect.top;
      } else if (rect.bottom > maxBottom) {
        nextY = maxBottom - rect.bottom;
      }

      setOffset((previous) => {
        if (Math.abs(previous.x - nextX) < 0.5 && Math.abs(previous.y - nextY) < 0.5) {
          return previous;
        }
        return { x: nextX, y: nextY };
      });
    };

    setOffset({ x: 0, y: 0 });
    frameId = window.requestAnimationFrame(measure);

    const handleResize = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(measure);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
    };
  }, [
    localScale,
    leftPadding,
    rightPadding,
    topPadding,
    bottomPadding,
    ...deps,
  ]);

  const translate = offset.x !== 0 || offset.y !== 0
    ? `translate(${offset.x}px, ${offset.y}px) `
    : '';

  return {
    ref: panelRef,
    transform: `${translate}scale(${localScale})`,
  };
}
