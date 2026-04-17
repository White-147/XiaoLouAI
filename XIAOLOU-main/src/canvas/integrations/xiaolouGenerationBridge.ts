/**
 * xiaolouGenerationBridge.ts
 *
 * Two-path generation bridge:
 *   1. Direct mode  – when CanvasHostServices are registered (no iframe),
 *      calls services.generateImage / generateVideo directly.
 *   2. iframe mode  – falls back to the original postMessage protocol when
 *      the canvas is running inside an iframe (isEmbedded=true, parent≠window).
 */

import { getRuntimeConfig } from '../runtimeConfig';
import { hasCanvasHostServices, getCanvasHostServices } from './canvasHostServices';
import type {
  HostGenerateImagePayload,
  HostGenerateVideoPayload,
} from './canvasHostServices';
import type { BridgeMediaCapabilitiesResponse } from '../types';

const BRIDGE_DEBUG = import.meta.env.DEV;

const GENERATION_BRIDGE_CHANNEL = 'xiaolou.generationBridge';
/** 12 min — Seedance backend has a 10-min timeout, plus overhead */
const REQUEST_TIMEOUT_MS = 720000;

// Re-export payload types under the original names so existing callers don't change.
export type XiaolouGenerateImagePayload = HostGenerateImagePayload;
export type XiaolouGenerateVideoPayload = HostGenerateVideoPayload;

// ─── iframe / postMessage plumbing (unchanged from original) ─────────────────

type GenerationBridgeAction =
  | 'generateImage'
  | 'generateVideo'
  | 'getImageCapabilities'
  | 'getVideoCapabilities';

type GenerationBridgeRequestMessage = {
  channel: typeof GENERATION_BRIDGE_CHANNEL;
  direction: 'request';
  requestId: string;
  action: GenerationBridgeAction;
  payload?: unknown;
};

type GenerationBridgeResponseMessage<T = unknown> = {
  channel: typeof GENERATION_BRIDGE_CHANNEL;
  direction: 'response';
  requestId: string;
  ok: boolean;
  result?: T;
  error?: string;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeoutId: number;
};

const pendingRequests = new Map<string, PendingRequest>();
let isListening = false;
let requestCounter = 0;

function logBridgeDebug(message: string, details?: unknown) {
  if (!BRIDGE_DEBUG) return;
  details === undefined ? console.log(message) : console.log(message, details);
}

function warnBridgeDebug(message: string, details?: unknown) {
  if (!BRIDGE_DEBUG) return;
  details === undefined ? console.warn(message) : console.warn(message, details);
}

function isGenerationBridgeResponseMessage(data: unknown): data is GenerationBridgeResponseMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as Partial<GenerationBridgeResponseMessage>;
  return (
    m.channel === GENERATION_BRIDGE_CHANNEL &&
    m.direction === 'response' &&
    typeof m.requestId === 'string' &&
    typeof m.ok === 'boolean'
  );
}

function ensureListener() {
  if (isListening || typeof window === 'undefined') return;
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    if (!isGenerationBridgeResponseMessage(event.data)) return;
    logBridgeDebug('[GenerationBridge] Response received:', {
      requestId: event.data.requestId,
      ok: event.data.ok,
      hasResult: !!event.data.result,
      error: event.data.error,
    });
    const pending = pendingRequests.get(event.data.requestId);
    if (!pending) {
      warnBridgeDebug('[GenerationBridge] No pending request for:', event.data.requestId);
      return;
    }
    window.clearTimeout(pending.timeoutId);
    pendingRequests.delete(event.data.requestId);
    if (event.data.ok) {
      pending.resolve(event.data.result);
    } else {
      pending.reject(new Error(event.data.error || 'Host generation bridge request failed.'));
    }
  });
  isListening = true;
}

function requestBridgeViaPostMessage<T>(action: GenerationBridgeAction, payload?: unknown): Promise<T> {
  ensureListener();
  return new Promise<T>((resolve, reject) => {
    const requestId = `xiaolou-generation-${Date.now()}-${requestCounter++}`;
    logBridgeDebug('[GenerationBridge] Sending request:', { requestId, action });
    const timeoutId = window.setTimeout(() => {
      console.error('[GenerationBridge] Request timed out:', requestId);
      pendingRequests.delete(requestId);
      reject(new Error('Timed out while waiting for the host generation bridge.'));
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timeoutId });
    const message: GenerationBridgeRequestMessage = {
      channel: GENERATION_BRIDGE_CHANNEL,
      direction: 'request',
      requestId,
      action,
      payload,
    };
    window.parent.postMessage(message, '*');
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns true when either direct services or the iframe postMessage bridge is available. */
export function canUseXiaolouImageGenerationBridge(): boolean {
  if (typeof window === 'undefined') return false;
  // Direct-embed: not in an iframe, but always connected to XIAOLOU-main
  if (window.parent === window) return true;
  // iframe mode: check if services are registered or postMessage bridge is active
  if (hasCanvasHostServices()) return true;
  const runtimeConfig = getRuntimeConfig();
  return runtimeConfig.isEmbedded && window.parent !== window;
}

export async function generateImageWithXiaolou(
  payload: XiaolouGenerateImagePayload,
): Promise<{ resultUrl: string; model?: string }> {
  const services = getCanvasHostServices();
  if (services) return services.generateImage(payload);
  return requestBridgeViaPostMessage('generateImage', payload);
}

export async function generateVideoWithXiaolou(
  payload: XiaolouGenerateVideoPayload,
): Promise<{ resultUrl: string; previewUrl?: string; model?: string }> {
  const services = getCanvasHostServices();
  if (services) return services.generateVideo(payload);
  return requestBridgeViaPostMessage('generateVideo', payload);
}

export async function getImageCapabilitiesFromXiaolou(
  mode?: string,
): Promise<BridgeMediaCapabilitiesResponse> {
  const services = getCanvasHostServices();
  if (services) return services.getImageCapabilities(mode);
  return requestBridgeViaPostMessage('getImageCapabilities', { mode });
}

export async function getVideoCapabilitiesFromXiaolou(
  mode?: string,
): Promise<BridgeMediaCapabilitiesResponse> {
  const services = getCanvasHostServices();
  if (services) return services.getVideoCapabilities(mode);
  return requestBridgeViaPostMessage('getVideoCapabilities', { mode });
}
