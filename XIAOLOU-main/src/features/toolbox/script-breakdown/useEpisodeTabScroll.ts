import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";

export function useEpisodeTabScroll(activeEpisode: number, episodes: number[]) {
  const episodeTabsRef = useRef<HTMLDivElement | null>(null);
  const episodeTabDragRef = useRef({
    pointerId: -1,
    startX: 0,
    startScrollLeft: 0,
    railWidth: 1,
  });
  const [isEpisodeTabDragging, setIsEpisodeTabDragging] = useState(false);
  const [episodeScrollMetrics, setEpisodeScrollMetrics] = useState({
    scrollLeft: 0,
    scrollWidth: 0,
    clientWidth: 0,
  });

  const scrollEpisodeTabs = (direction: -1 | 1) => {
    const container = episodeTabsRef.current;
    if (!container) return;
    container.scrollBy({
      left: direction * Math.max(180, container.clientWidth * 0.7),
      behavior: "smooth",
    });
  };

  const syncEpisodeScrollMetrics = () => {
    const container = episodeTabsRef.current;
    if (!container) return;
    const nextMetrics = {
      scrollLeft: container.scrollLeft,
      scrollWidth: container.scrollWidth,
      clientWidth: container.clientWidth,
    };
    setEpisodeScrollMetrics((current) =>
      current.scrollLeft === nextMetrics.scrollLeft &&
      current.scrollWidth === nextMetrics.scrollWidth &&
      current.clientWidth === nextMetrics.clientWidth
        ? current
        : nextMetrics,
    );
  };

  const updateEpisodeScrollFromRailPointer = (clientX: number) => {
    const container = episodeTabsRef.current;
    if (!container || container.scrollWidth <= container.clientWidth) return;
    const drag = episodeTabDragRef.current;
    const scrollRange = container.scrollWidth - container.clientWidth;
    const thumbWidth = Math.max(12, (container.clientWidth / container.scrollWidth) * drag.railWidth);
    const trackRange = Math.max(drag.railWidth - thumbWidth, 1);
    const scrollDelta = (clientX - drag.startX) * (scrollRange / trackRange);
    container.scrollLeft = Math.min(Math.max(drag.startScrollLeft + scrollDelta, 0), scrollRange);
    syncEpisodeScrollMetrics();
  };

  const handleEpisodeScrollRailPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const container = episodeTabsRef.current;
    if (!container || container.scrollWidth <= container.clientWidth) return;
    const rail = event.currentTarget;
    const rect = rail.getBoundingClientRect();
    episodeTabDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: container.scrollLeft,
      railWidth: Math.max(rect.width, 1),
    };
    container.style.scrollBehavior = "auto";
    rail.setPointerCapture(event.pointerId);
    setIsEpisodeTabDragging(true);
    event.preventDefault();
  };

  const handleEpisodeScrollRailPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = episodeTabDragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    updateEpisodeScrollFromRailPointer(event.clientX);
    event.preventDefault();
  };

  const finishEpisodeScrollRailDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = episodeTabDragRef.current;
    if (drag.pointerId !== event.pointerId) return;
    const rail = event.currentTarget;
    if (rail.hasPointerCapture(event.pointerId)) {
      rail.releasePointerCapture(event.pointerId);
    }
    episodeTabDragRef.current = {
      pointerId: -1,
      startX: 0,
      startScrollLeft: 0,
      railWidth: 1,
    };
    const container = episodeTabsRef.current;
    if (container) {
      container.style.scrollBehavior = "";
    }
    setIsEpisodeTabDragging(false);
  };

  useEffect(() => {
    const container = episodeTabsRef.current;
    const activeTab = container?.querySelector<HTMLElement>(`[data-episode-tab="${activeEpisode}"]`);
    activeTab?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
    const frame = window.requestAnimationFrame(syncEpisodeScrollMetrics);
    return () => window.cancelAnimationFrame(frame);
  }, [activeEpisode, episodes]);

  useEffect(() => {
    const container = episodeTabsRef.current;
    if (!container) return;
    syncEpisodeScrollMetrics();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(syncEpisodeScrollMetrics);
    observer.observe(container);
    return () => observer.disconnect();
  }, [episodes.length]);

  const canScrollEpisodes = episodeScrollMetrics.scrollWidth > episodeScrollMetrics.clientWidth + 1;
  const episodeScrollThumbWidth = canScrollEpisodes && episodeScrollMetrics.scrollWidth > 0
    ? Math.max(12, (episodeScrollMetrics.clientWidth / episodeScrollMetrics.scrollWidth) * 100)
    : 100;
  const episodeScrollThumbLeft = canScrollEpisodes
    ? (episodeScrollMetrics.scrollLeft /
        Math.max(episodeScrollMetrics.scrollWidth - episodeScrollMetrics.clientWidth, 1)) *
      (100 - episodeScrollThumbWidth)
    : 0;

  return {
    episodeTabsRef,
    canScrollEpisodes,
    episodeScrollThumbLeft,
    episodeScrollThumbWidth,
    isEpisodeTabDragging,
    scrollEpisodeTabs,
    syncEpisodeScrollMetrics,
    handleEpisodeScrollRailPointerDown,
    handleEpisodeScrollRailPointerMove,
    finishEpisodeScrollRailDrag,
  };
}
