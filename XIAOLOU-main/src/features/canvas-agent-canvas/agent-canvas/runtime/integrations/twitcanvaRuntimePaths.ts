import { getRuntimeConfig, getRuntimeEnvValue } from '../runtimeConfig';

// Legacy canvas backend writes are retired in the Windows-native runtime.
// Direct-embed agent canvas now uses host services for generation, media upload,
// and local draft persistence unless an operator explicitly configures a base URL.
const API_BASE_URL = '/canvas-runtime-api-retired';
const LIBRARY_BASE_URL = '/canvas-library';

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function ensureLeadingSlash(value: string) {
  return value.startsWith('/') ? value : `/${value}`;
}

function normalizeApiPath(path: string) {
  const normalized = String(path || '').trim();
  if (!normalized) {
    return '/';
  }

  if (/^(?:https?:\/\/|data:|blob:)/i.test(normalized)) {
    return normalized;
  }

  return ensureLeadingSlash(normalized);
}

function normalizeLibraryPath(path: string) {
  const normalized = String(path || '').trim();
  if (!normalized) {
    return '/';
  }

  if (/^(?:https?:\/\/|data:|blob:)/i.test(normalized)) {
    return normalized;
  }

  const direct = ensureLeadingSlash(normalized);
  return direct.startsWith('/library/') ? direct.slice('/library'.length) : direct;
}

function isLocalCanvasHost(hostname: string) {
  const normalized = hostname.toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function readEnvWithFallback(canonical: string, legacy: string): string {
  return getRuntimeEnvValue(canonical).trim() || getRuntimeEnvValue(legacy).trim();
}

// ---------------------------------------------------------------------------
// Canonical exports (preferred names)
// ---------------------------------------------------------------------------

export function getCanvasApiBaseUrl() {
  const configured = trimTrailingSlash(readEnvWithFallback('VITE_CANVAS_API_BASE_URL', 'VITE_TWITCANVA_API_BASE_URL'));
  return configured || API_BASE_URL;
}

export function getCanvasLibraryBaseUrl() {
  const configured = trimTrailingSlash(readEnvWithFallback('VITE_CANVAS_LIBRARY_BASE_URL', 'VITE_TWITCANVA_LIBRARY_BASE_URL'));
  return configured || LIBRARY_BASE_URL;
}

export function buildCanvasApiUrl(path: string) {
  const normalized = normalizeApiPath(path);
  if (/^(?:https?:\/\/|data:|blob:)/i.test(normalized)) {
    return normalized;
  }

  return `${getCanvasApiBaseUrl()}${ensureLeadingSlash(normalized)}`;
}

export function buildCanvasLibraryUrl(path: string) {
  const normalized = normalizeLibraryPath(path);
  if (/^(?:https?:\/\/|data:|blob:)/i.test(normalized)) {
    return normalized;
  }

  return `${getCanvasLibraryBaseUrl()}${ensureLeadingSlash(normalized)}`;
}

export function resolveCanvasMediaUrl(path?: string | null) {
  const normalized = String(path || '').trim();
  if (!normalized) {
    return '';
  }

  if (/^(?:data:|blob:)/i.test(normalized)) {
    return normalized;
  }

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized);
      if (isLocalCanvasHost(parsed.hostname) && parsed.pathname.startsWith('/library/')) {
        return buildCanvasLibraryUrl(parsed.pathname);
      }
    } catch {
      return normalized;
    }
    return normalized;
  }

  if (normalized.startsWith('/library/')) {
    return buildCanvasLibraryUrl(normalized);
  }

  // Legacy alias paths — pass through as-is
  if (normalized.startsWith('/twitcanva-library/') || normalized.startsWith('/canvas-library/')) {
    return normalized;
  }

  if (typeof window === 'undefined') {
    return normalized;
  }

  try {
    return new URL(normalized, window.location.origin).toString();
  } catch {
    return normalized;
  }
}

export function toCanvasBackendLibraryPath(path?: string | null) {
  const normalized = String(path || '').trim();
  if (!normalized) {
    return '';
  }

  if (normalized.startsWith('/library/')) {
    return normalized;
  }

  if (normalized.startsWith('/twitcanva-library/')) {
    return normalized.replace('/twitcanva-library/', '/library/');
  }

  if (normalized.startsWith('/canvas-library/')) {
    return normalized.replace('/canvas-library/', '/library/');
  }

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized);
      if (parsed.pathname.startsWith('/library/')) {
        return parsed.pathname;
      }
      if (parsed.pathname.startsWith('/twitcanva-library/')) {
        return parsed.pathname.replace('/twitcanva-library/', '/library/');
      }
      if (parsed.pathname.startsWith('/canvas-library/')) {
        return parsed.pathname.replace('/canvas-library/', '/library/');
      }
    } catch {
      return normalized;
    }
  }

  return normalized;
}

// ---------------------------------------------------------------------------
// Legacy aliases — re-exported for backward compat with existing source callers.
// New code should use the canonical names above.
// ---------------------------------------------------------------------------

export const getTwitCanvaApiBaseUrl = getCanvasApiBaseUrl;
export const getTwitCanvaLibraryBaseUrl = getCanvasLibraryBaseUrl;
export const buildTwitCanvaApiUrl = buildCanvasApiUrl;
export const buildTwitCanvaLibraryUrl = buildCanvasLibraryUrl;
export const resolveTwitCanvaMediaUrl = resolveCanvasMediaUrl;
export const toTwitCanvaBackendLibraryPath = toCanvasBackendLibraryPath;
