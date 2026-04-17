/**
 * canvasHostServices.ts
 *
 * Direct-embedding service registry for the canvas runtime.
 * When XIAOLOU-main renders the canvas component directly (no iframe),
 * it registers a CanvasHostServices object here. The bridge files check
 * `hasCanvasHostServices()` first and call these services directly,
 * bypassing the postMessage protocol entirely.
 *
 * This keeps full backward-compatibility: the existing postMessage bridges
 * still work when `hasCanvasHostServices()` returns false (iframe mode).
 */

import type { BridgeMediaCapabilitiesResponse } from '../types';

// ─── Service types ────────────────────────────────────────────────────────────

export type HostGenerateImagePayload = {
  prompt: string;
  model: string;
  aspectRatio?: string;
  resolution?: string;
  referenceImageUrls?: string[];
};

export type HostGenerateVideoPayload = {
  prompt: string;
  model: string;
  aspectRatio?: string;
  resolution?: string;
  duration?: number;
  referenceImageUrl?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  multiReferenceImageUrls?: string[];
  videoMode?: string;
  generateAudio?: boolean;
  networkSearch?: boolean;
};

export type HostAssetItem = {
  id: string;
  name: string;
  category: string;
  url: string;
  previewUrl?: string;
  type: 'image' | 'video';
  description?: string;
  sourceTaskId?: string;
  generationPrompt?: string;
  model?: string;
  aspectRatio?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type HostProjectSummary = {
  id: string;
  title: string;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type HostProjectFull = HostProjectSummary & {
  canvasData: {
    nodes: unknown[];
    groups: unknown[];
    viewport: { x: number; y: number; zoom: number };
  } | null;
};

export type HostSaveWorkflow = {
  id: string | null;
  title: string;
  nodes: unknown[];
  groups: unknown[];
  viewport: { x: number; y: number; zoom: number };
};

export type CanvasHostServices = {
  // Identity (getters so they always return the latest value)
  readonly actorId: string | null;
  readonly projectId: string | null;

  // Theme
  readonly initialTheme: 'light' | 'dark';

  // Generation
  generateImage(payload: HostGenerateImagePayload): Promise<{ resultUrl: string; model?: string }>;
  generateVideo(payload: HostGenerateVideoPayload): Promise<{ resultUrl: string; previewUrl?: string; model?: string }>;
  getImageCapabilities(mode?: string | null): Promise<BridgeMediaCapabilitiesResponse>;
  getVideoCapabilities(mode?: string): Promise<BridgeMediaCapabilitiesResponse>;

  // Assets
  getAssetContext(): Promise<{ available: boolean; projectId?: string; source?: string }>;
  listAssets(): Promise<{ projectId?: string; items: HostAssetItem[] }>;
  createAsset(payload: unknown): Promise<HostAssetItem | null>;
  deleteAsset(id: string): Promise<void>;

  // Canvas projects
  listProjects(): Promise<{ items: HostProjectSummary[] }>;
  loadProject(id: string): Promise<HostProjectFull>;
  deleteProject(id: string): Promise<{ deleted: boolean }>;

  // Save
  saveCanvas(workflow: HostSaveWorkflow, thumbnailImageUrls: string[]): Promise<void>;

  // Reset — called when the user starts a brand-new canvas (clears the saved project ID)
  resetProject(): void;
};

// ─── Service registry ─────────────────────────────────────────────────────────

let _services: CanvasHostServices | null = null;

export function setCanvasHostServices(services: CanvasHostServices): void {
  _services = services;
}

export function getCanvasHostServices(): CanvasHostServices | null {
  return _services;
}

export function hasCanvasHostServices(): boolean {
  return _services !== null;
}

export function clearCanvasHostServices(): void {
  _services = null;
}

// ─── Theme event bus ──────────────────────────────────────────────────────────

type ThemeListener = (theme: 'light' | 'dark') => void;
const _themeListeners: Set<ThemeListener> = new Set();

/** Called by CanvasCreate.tsx when the user switches theme. */
export function notifyCanvasThemeChange(theme: 'light' | 'dark'): void {
  _themeListeners.forEach(l => l(theme));
}

/** Called by App.tsx to stay in sync with the host's theme. */
export function subscribeCanvasThemeChange(listener: ThemeListener): () => void {
  _themeListeners.add(listener);
  return () => { _themeListeners.delete(listener); };
}

// ─── Project load event bus ───────────────────────────────────────────────────

export type HostProjectLoadData = {
  id?: string;
  title?: string;
  nodes: unknown[];
  groups: unknown[];
  viewport?: { x: number; y: number; zoom: number };
};

type ProjectListener = (project: HostProjectLoadData) => void;
const _projectListeners: Set<ProjectListener> = new Set();

/** Called by CanvasCreate.tsx when a canvas project should be loaded. */
export function notifyCanvasProjectLoad(project: HostProjectLoadData): void {
  _projectListeners.forEach(l => l(project));
}

/** Called by App.tsx to listen for project load requests from the host. */
export function subscribeCanvasProjectLoad(listener: ProjectListener): () => void {
  _projectListeners.add(listener);
  return () => { _projectListeners.delete(listener); };
}
