import { NodeData } from '../types';

const LOCAL_CANVAS_MEDIA_PREFIXES = [
  '/uploads/',
  '/library/',
  '/canvas-library/',
  '/twitcanva-library/',
];

function isLocalCanvasMediaUrl(value: string): boolean {
  if (!value || value.startsWith('data:')) {
    return false;
  }

  try {
    const parsed = new URL(value, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    return LOCAL_CANVAS_MEDIA_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix));
  } catch {
    return LOCAL_CANVAS_MEDIA_PREFIXES.some((prefix) => value.startsWith(prefix));
  }
}

export function stripCanvasRuntimeCacheBust(url?: string | null): string | undefined {
  if (!url || !isLocalCanvasMediaUrl(url)) {
    return url ?? undefined;
  }

  try {
    const baseOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const parsed = new URL(url, baseOrigin);
    if (!parsed.searchParams.has('t')) {
      return url;
    }

    parsed.searchParams.delete('t');
    const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    if (url.startsWith('http://') || url.startsWith('https://')) {
      return `${parsed.origin}${normalized}`;
    }
    return normalized;
  } catch {
    return url;
  }
}

export function sanitizeCanvasNodeForPersistence<T extends NodeData>(node: T): T {
  return {
    ...node,
    resultUrl: stripCanvasRuntimeCacheBust(node.resultUrl),
    lastFrame: stripCanvasRuntimeCacheBust(node.lastFrame),
    editorBackgroundUrl: stripCanvasRuntimeCacheBust(node.editorBackgroundUrl),
  };
}

export function sanitizeCanvasNodesForPersistence<T extends NodeData>(nodes: T[]): T[] {
  if (!Array.isArray(nodes)) {
    return [];
  }
  return nodes.map((node) => sanitizeCanvasNodeForPersistence(node));
}
