/**
 * canvasHostServices.ts
 *
 * Direct-embed service registry for the canvas runtime.
 * In Vite dev, HMR can load multiple copies of the same module under
 * timestamped URLs. Keep the registry on `globalThis` so CanvasCreate,
 * App, and bridge helpers all see the same host services and event buses.
 */

import type { BridgeMediaCapabilitiesResponse } from '../types';

export type HostGenerateImagePayload = {
  prompt: string;
  model: string;
  aspectRatio?: string;
  resolution?: string;
  count?: number;
  referenceImageUrls?: string[];
  onTaskIdAssigned?: (taskId: string) => void;
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
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  editMode?: string;
  editPresetId?: string;
  motionReferenceVideoUrl?: string;
  characterReferenceImageUrl?: string;
  qualityMode?: string;
  videoMode?: string;
  generateAudio?: boolean;
  networkSearch?: boolean;
  onTaskIdAssigned?: (taskId: string) => void;
};

export type HostRecoverGenerationRequest =
  | { kind: 'image'; taskId: string }
  | { kind: 'video'; taskId: string; projectId?: string | null };

export type HostRecoverGenerationResult =
  | { status: 'pending' }
  | { status: 'succeeded'; resultUrl: string; resultUrls?: string[]; previewUrl?: string; model?: string }
  | { status: 'failed'; error?: string };

export type HostFindStrayGenerationRequest = {
  kind: 'image' | 'video';
  prompt?: string | null;
  createdAfter?: number | null;
  projectId?: string | null;
  excludeTaskIds?: string[];
};

export type HostAssetItem = {
  id: string;
  name: string;
  category: string;
  url: string;
  previewUrl?: string;
  type: 'image' | 'video' | 'audio';
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
  agentContext?: unknown | null;
};

export type HostSaveWorkflow = {
  id: string | null;
  title: string;
  nodes: unknown[];
  groups: unknown[];
  viewport: { x: number; y: number; zoom: number };
  agentContext?: unknown | null;
};

export type HostProjectLoadData = {
  id?: string;
  title?: string;
  updatedAt?: string;
  nodes: unknown[];
  groups: unknown[];
  viewport?: { x: number; y: number; zoom: number };
  agentContext?: unknown | null;
};

export type HostCanvasProjectVersion = {
  id: string | null;
  title: string | null;
  updatedAt: string | null;
  canvasData: HostProjectFull['canvasData'];
};

export type HostCanvasProjectVersionInput = {
  id?: string | null;
  title?: string | null;
  updatedAt?: string | null;
  canvasData?: HostProjectFull['canvasData'];
  nodes?: unknown[];
  groups?: unknown[];
  viewport?: { x: number; y: number; zoom: number };
};

export type CanvasHostServices = {
  readonly actorId: string | null;
  readonly projectId: string | null;
  readonly initialTheme: 'light' | 'dark';
  generateImage(payload: HostGenerateImagePayload): Promise<{ resultUrl: string; resultUrls?: string[]; model?: string; taskId?: string }>;
  generateVideo(payload: HostGenerateVideoPayload): Promise<{ resultUrl: string; previewUrl?: string; model?: string; taskId?: string }>;
  getImageCapabilities(mode?: string | null): Promise<BridgeMediaCapabilitiesResponse>;
  getVideoCapabilities(mode?: string): Promise<BridgeMediaCapabilitiesResponse>;
  recoverGeneration?(request: HostRecoverGenerationRequest): Promise<HostRecoverGenerationResult>;
  findStrayGeneration?(request: HostFindStrayGenerationRequest): Promise<
    | null
    | {
        resultUrl: string;
        previewUrl?: string;
        model?: string;
        taskId?: string;
        createdAt?: string;
      }
  >;
  getAssetContext(): Promise<{ available: boolean; projectId?: string; source?: string }>;
  listAssets(): Promise<{ projectId?: string; items: HostAssetItem[] }>;
  createAsset(payload: unknown): Promise<HostAssetItem | null>;
  deleteAsset(id: string): Promise<void>;
  listProjects(): Promise<{ items: HostProjectSummary[] }>;
  loadProject(id: string): Promise<HostProjectFull>;
  deleteProject(id: string): Promise<{ deleted: boolean }>;
  saveCanvas(workflow: HostSaveWorkflow, thumbnailImageUrls: string[]): Promise<void>;
  getCanvasProjectVersion?(): HostCanvasProjectVersion | null;
  adoptCanvasProjectVersion?(project: HostCanvasProjectVersionInput): void;
  resetProject(): void;
};

type ThemeListener = (theme: 'light' | 'dark') => void;
type ProjectListener = (project: HostProjectLoadData) => void;

type CanvasHostSharedState = {
  services: CanvasHostServices | null;
  themeListeners: Set<ThemeListener>;
  projectListeners: Set<ProjectListener>;
  latestProjectLoad: HostProjectLoadData | null;
};

type CanvasHostGlobal = typeof globalThis & {
  __XIAOLOU_CANVAS_HOST_STATE__?: CanvasHostSharedState;
};

function getCanvasHostSharedState(): CanvasHostSharedState {
  const root = globalThis as CanvasHostGlobal;
  if (!root.__XIAOLOU_CANVAS_HOST_STATE__) {
    root.__XIAOLOU_CANVAS_HOST_STATE__ = {
      services: null,
      themeListeners: new Set<ThemeListener>(),
      projectListeners: new Set<ProjectListener>(),
      latestProjectLoad: null,
    };
  }
  return root.__XIAOLOU_CANVAS_HOST_STATE__;
}

export function setCanvasHostServices(services: CanvasHostServices): void {
  getCanvasHostSharedState().services = services;
}

export function getCanvasHostServices(): CanvasHostServices | null {
  return getCanvasHostSharedState().services;
}

export function hasCanvasHostServices(): boolean {
  return getCanvasHostSharedState().services !== null;
}

export function clearCanvasHostServices(expectedServices?: CanvasHostServices | null): void {
  const state = getCanvasHostSharedState();
  if (expectedServices && state.services !== expectedServices) {
    return;
  }
  state.services = null;
}

export function notifyCanvasThemeChange(theme: 'light' | 'dark'): void {
  getCanvasHostSharedState().themeListeners.forEach((listener) => listener(theme));
}

export function subscribeCanvasThemeChange(listener: ThemeListener): () => void {
  const state = getCanvasHostSharedState();
  state.themeListeners.add(listener);
  return () => {
    state.themeListeners.delete(listener);
  };
}

export function notifyCanvasProjectLoad(project: HostProjectLoadData): void {
  const state = getCanvasHostSharedState();
  state.latestProjectLoad = project;
  state.projectListeners.forEach((listener) => listener(project));
}

export function clearCanvasProjectLoad(): void {
  getCanvasHostSharedState().latestProjectLoad = null;
}

export function subscribeCanvasProjectLoad(
  listener: ProjectListener,
  options?: { replayLatest?: boolean; replayProjectId?: string },
): () => void {
  const state = getCanvasHostSharedState();
  state.projectListeners.add(listener);
  const expectedProjectId = options?.replayProjectId;
  if (
    options?.replayLatest !== false &&
    state.latestProjectLoad &&
    (typeof expectedProjectId === 'undefined' || state.latestProjectLoad.id === expectedProjectId)
  ) {
    listener(state.latestProjectLoad);
  }
  return () => {
    state.projectListeners.delete(listener);
  };
}
