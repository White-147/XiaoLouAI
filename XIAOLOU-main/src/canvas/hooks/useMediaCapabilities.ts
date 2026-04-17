import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  BridgeMediaModelCapability,
  BridgeMediaCapabilitiesResponse,
} from '../types';
import {
  canUseXiaolouImageGenerationBridge,
  getImageCapabilitiesFromXiaolou,
  getVideoCapabilitiesFromXiaolou,
} from '../integrations/xiaolouGenerationBridge';
import { buildFallbackImageCapabilities } from '../config/canvasImageModels';
import { buildFallbackVideoCapabilities } from '../config/canvasVideoModels';
import { normalizeCanvasImageModelId } from '../config/canvasImageModels';
import { normalizeCanvasVideoModelId } from '../config/canvasVideoModels';

type CapabilitiesSource = 'bridge' | 'fallback' | 'loading';

type CapabilitiesState = {
  capabilities: BridgeMediaModelCapability[];
  defaultModel: string | null;
  loading: boolean;
  error: string | null;
  source: CapabilitiesSource;
};

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  data: BridgeMediaCapabilitiesResponse;
  ts: number;
};

const imageCache = new Map<string, CacheEntry>();
const videoCache = new Map<string, CacheEntry>();

function getCached(cache: Map<string, CacheEntry>, key: string): BridgeMediaCapabilitiesResponse | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL_MS) {
    return entry.data;
  }
  cache.delete(key);
  return null;
}

export function useImageCapabilities(mode?: string): CapabilitiesState {
  const cacheKey = mode || '__all__';
  const [state, setState] = useState<CapabilitiesState>(() => {
    const cached = getCached(imageCache, cacheKey);
    if (cached) {
      return {
        capabilities: cached.items,
        defaultModel: cached.defaultModel || null,
        loading: false,
        error: null,
        source: 'bridge',
      };
    }
    return {
      capabilities: buildFallbackImageCapabilities(),
      defaultModel: 'gemini-3-pro-image-preview',
      loading: true,
      error: null,
      source: 'loading',
    };
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const cached = getCached(imageCache, cacheKey);
      if (cached) {
        setState({
          capabilities: cached.items,
          defaultModel: cached.defaultModel || null,
          loading: false,
          error: null,
          source: 'bridge',
        });
        return;
      }

      if (!canUseXiaolouImageGenerationBridge()) {
        setState({
          capabilities: buildFallbackImageCapabilities(),
          defaultModel: 'gemini-3-pro-image-preview',
          loading: false,
          error: null,
          source: 'fallback',
        });
        return;
      }

      try {
        const resp = await getImageCapabilitiesFromXiaolou(mode);
        if (cancelled) return;
        imageCache.set(cacheKey, { data: resp, ts: Date.now() });
        setState({
          capabilities: resp.items,
          defaultModel: resp.defaultModel || null,
          loading: false,
          error: null,
          source: 'bridge',
        });
      } catch (err) {
        if (cancelled) return;
        console.warn('[useImageCapabilities] Bridge failed, using fallback:', err);
        setState({
          capabilities: buildFallbackImageCapabilities(),
          defaultModel: 'gemini-3-pro-image-preview',
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load image capabilities',
          source: 'fallback',
        });
      }
    }

    load();
    return () => { cancelled = true; };
  }, [cacheKey, mode]);

  return state;
}

export function useVideoCapabilities(mode?: string): CapabilitiesState {
  const cacheKey = mode || '__all__';
  const [state, setState] = useState<CapabilitiesState>(() => {
    const cached = getCached(videoCache, cacheKey);
    if (cached) {
      return {
        capabilities: cached.items,
        defaultModel: cached.defaultModel || null,
        loading: false,
        error: null,
        source: 'bridge',
      };
    }
      return {
        capabilities: buildFallbackVideoCapabilities(),
        defaultModel: 'doubao-seedance-2-0-260128',
        loading: true,
        error: null,
        source: 'loading',
      };
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const cached = getCached(videoCache, cacheKey);
      if (cached) {
        setState({
          capabilities: cached.items,
          defaultModel: cached.defaultModel || null,
          loading: false,
          error: null,
          source: 'bridge',
        });
        return;
      }

        if (!canUseXiaolouImageGenerationBridge()) {
          setState({
            capabilities: buildFallbackVideoCapabilities(),
            defaultModel: 'doubao-seedance-2-0-260128',
            loading: false,
            error: null,
            source: 'fallback',
          });
        return;
      }

      try {
        const resp = await getVideoCapabilitiesFromXiaolou(mode);
        if (cancelled) return;
        videoCache.set(cacheKey, { data: resp, ts: Date.now() });
        setState({
          capabilities: resp.items,
          defaultModel: resp.defaultModel || null,
          loading: false,
          error: null,
          source: 'bridge',
        });
      } catch (err) {
        if (cancelled) return;
          console.warn('[useVideoCapabilities] Bridge failed, using fallback:', err);
          setState({
            capabilities: buildFallbackVideoCapabilities(),
            defaultModel: 'doubao-seedance-2-0-260128',
            loading: false,
            error: err instanceof Error ? err.message : 'Failed to load video capabilities',
            source: 'fallback',
          });
      }
    }

    load();
    return () => { cancelled = true; };
  }, [cacheKey, mode]);

  return state;
}

/**
 * Resolve a model ID against capability list, with fallback to default.
 * Handles legacy aliases via normalizeCanvasImageModelId / normalizeCanvasVideoModelId.
 */
export function resolveModelFromCapabilities(
  modelId: string | null | undefined,
  capabilities: BridgeMediaModelCapability[],
  defaultModelId: string,
  kind: 'image' | 'video',
): BridgeMediaModelCapability | null {
  const normalized = kind === 'image'
    ? normalizeCanvasImageModelId(modelId)
    : normalizeCanvasVideoModelId(modelId);

  const found = capabilities.find((c) => c.id === normalized);
  if (found) return found;

  const fallback = capabilities.find((c) => c.id === defaultModelId);
  return fallback || capabilities[0] || null;
}
