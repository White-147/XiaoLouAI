/**
 * xiaolouWorkflowBridge.ts
 *
 * Two-path workflow / canvas-project bridge:
 *   1. Direct mode  – delegates to CanvasHostServices when registered.
 *   2. iframe mode  – falls back to the original postMessage protocol.
 */

import { getRuntimeConfig } from '../runtimeConfig';
import { hasCanvasHostServices, getCanvasHostServices } from './canvasHostServices';
import type { HostProjectSummary, HostProjectFull } from './canvasHostServices';

const WORKFLOW_BRIDGE_CHANNEL = 'xiaolou.workflowBridge';
const REQUEST_TIMEOUT_MS = 10000;

// Re-export types under the original names so callers don't change.
export type CanvasProjectSummary = HostProjectSummary;
export type CanvasProjectFull = HostProjectFull;

// ─── iframe / postMessage plumbing ────────────────────────────────────────────

type BridgeAction = 'listProjects' | 'loadProject' | 'deleteProject';

type BridgeRequestMessage = {
  channel: typeof WORKFLOW_BRIDGE_CHANNEL;
  direction: 'request';
  requestId: string;
  action: BridgeAction;
  payload?: unknown;
};

type BridgeResponseMessage<T = unknown> = {
  channel: typeof WORKFLOW_BRIDGE_CHANNEL;
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

function isBridgeResponseMessage(data: unknown): data is BridgeResponseMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as Partial<BridgeResponseMessage>;
  return (
    m.channel === WORKFLOW_BRIDGE_CHANNEL &&
    m.direction === 'response' &&
    typeof m.requestId === 'string' &&
    typeof m.ok === 'boolean'
  );
}

function ensureListener() {
  if (isListening || typeof window === 'undefined') return;
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent) return;
    if (!isBridgeResponseMessage(event.data)) return;
    const pending = pendingRequests.get(event.data.requestId);
    if (!pending) return;
    window.clearTimeout(pending.timeoutId);
    pendingRequests.delete(event.data.requestId);
    if (event.data.ok) {
      pending.resolve(event.data.result);
    } else {
      pending.reject(new Error(event.data.error || 'Workflow bridge request failed.'));
    }
  });
  isListening = true;
}

function requestBridgeViaPostMessage<T>(action: BridgeAction, payload?: unknown): Promise<T> {
  ensureListener();
  return new Promise<T>((resolve, reject) => {
    const requestId = `xiaolou-wf-${Date.now()}-${requestCounter++}`;
    const timeoutId = window.setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Timed out while waiting for the host workflow bridge.'));
    }, REQUEST_TIMEOUT_MS);
    pendingRequests.set(requestId, { resolve: resolve as (v: unknown) => void, reject, timeoutId });
    const message: BridgeRequestMessage = {
      channel: WORKFLOW_BRIDGE_CHANNEL,
      direction: 'request',
      requestId,
      action,
      payload,
    };
    window.parent.postMessage(message, '*');
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function canUseXiaolouWorkflowBridge(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.parent === window) return true; // direct-embed (not in iframe)
  if (hasCanvasHostServices()) return true;
  const runtimeConfig = getRuntimeConfig();
  return runtimeConfig.isEmbedded && window.parent !== window;
}

export async function listXiaolouCanvasProjects(): Promise<{ items: CanvasProjectSummary[] }> {
  const services = getCanvasHostServices();
  if (services) return services.listProjects();
  return requestBridgeViaPostMessage<{ items: CanvasProjectSummary[] }>('listProjects');
}

export async function loadXiaolouCanvasProject(projectId: string): Promise<CanvasProjectFull> {
  const services = getCanvasHostServices();
  if (services) return services.loadProject(projectId);
  return requestBridgeViaPostMessage<CanvasProjectFull>('loadProject', { id: projectId });
}

export async function deleteXiaolouCanvasProject(projectId: string): Promise<{ deleted: boolean }> {
  const services = getCanvasHostServices();
  if (services) return services.deleteProject(projectId);
  return requestBridgeViaPostMessage<{ deleted: boolean }>('deleteProject', { id: projectId });
}
