/**
 * xiaolouAssetBridge.ts
 *
 * Two-path asset bridge:
 *   1. Direct mode  – delegates to CanvasHostServices when registered.
 *   2. iframe mode  – falls back to the original postMessage protocol.
 */

import { getRuntimeConfig } from '../runtimeConfig';
import { hasCanvasHostServices, getCanvasHostServices } from './canvasHostServices';
import type { HostAssetItem } from './canvasHostServices';

const ASSET_BRIDGE_CHANNEL = 'xiaolou.assetBridge';
const REQUEST_TIMEOUT_MS = 30000;

// Re-export the item type under the original name so callers don't change.
export type XiaolouAssetLibraryItem = HostAssetItem;

// ─── iframe / postMessage plumbing ────────────────────────────────────────────

type AssetBridgeAction = 'getContext' | 'listAssets' | 'createAsset' | 'deleteAsset';

type AssetBridgeRequestMessage = {
  channel: typeof ASSET_BRIDGE_CHANNEL;
  direction: 'request';
  requestId: string;
  action: AssetBridgeAction;
  payload?: unknown;
};

type AssetBridgeResponseMessage<T = unknown> = {
  channel: typeof ASSET_BRIDGE_CHANNEL;
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

function isAssetBridgeResponseMessage(data: unknown): data is AssetBridgeResponseMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as Partial<AssetBridgeResponseMessage>;
  return (
    m.channel === ASSET_BRIDGE_CHANNEL &&
    m.direction === 'response' &&
    typeof m.requestId === 'string' &&
    typeof m.ok === 'boolean'
  );
}

function ensureListener() {
  if (isListening || typeof window === 'undefined') return;
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    if (!isAssetBridgeResponseMessage(event.data)) return;
    const pending = pendingRequests.get(event.data.requestId);
    if (!pending) return;
    window.clearTimeout(pending.timeoutId);
    pendingRequests.delete(event.data.requestId);
    if (event.data.ok) {
      pending.resolve(event.data.result);
    } else {
      pending.reject(new Error(event.data.error || 'Asset bridge request failed.'));
    }
  });
  isListening = true;
}

function requestBridgeViaPostMessage<T>(action: AssetBridgeAction, payload?: unknown): Promise<T> {
  ensureListener();
  return new Promise<T>((resolve, reject) => {
    const requestId = `xiaolou-asset-${Date.now()}-${requestCounter++}`;
    const timeoutId = window.setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Timed out waiting for the host asset bridge.'));
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timeoutId });
    const message: AssetBridgeRequestMessage = {
      channel: ASSET_BRIDGE_CHANNEL,
      direction: 'request',
      requestId,
      action,
      payload,
    };
    window.parent.postMessage(message, '*');
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function canUseXiaolouAssetBridge(): boolean {
  if (typeof window === 'undefined') return false;
  if (hasCanvasHostServices()) return true;
  const runtimeConfig = getRuntimeConfig();
  return runtimeConfig.isEmbedded && window.parent !== window;
}

type AssetBridgeContext = { available: boolean; projectId?: string; source?: string };
type ListAssetsResult = { projectId?: string; items: XiaolouAssetLibraryItem[] };

export async function getXiaolouAssetContext(): Promise<AssetBridgeContext> {
  const services = getCanvasHostServices();
  if (services) return services.getAssetContext();
  return requestBridgeViaPostMessage<AssetBridgeContext>('getContext');
}

export async function listXiaolouAssets(): Promise<XiaolouAssetLibraryItem[]> {
  const services = getCanvasHostServices();
  if (services) {
    const result = await services.listAssets();
    return result.items || [];
  }
  const result = await requestBridgeViaPostMessage<ListAssetsResult>('listAssets');
  return result.items || [];
}

export async function createXiaolouAsset(payload: unknown): Promise<XiaolouAssetLibraryItem | null> {
  const services = getCanvasHostServices();
  if (services) return services.createAsset(payload);
  return requestBridgeViaPostMessage<XiaolouAssetLibraryItem | null>('createAsset', payload);
}

export async function deleteXiaolouAsset(id: string): Promise<void> {
  const services = getCanvasHostServices();
  if (services) return services.deleteAsset(id);
  await requestBridgeViaPostMessage<unknown>('deleteAsset', { id });
}
