/**
 * canvasPersistence.ts
 *
 * Central sanitisation layer between Canvas runtime state (nodes/groups) and
 * long-term persistence surfaces (cloud canvasProjectsByActorId, localStorage
 * drafts, iframe postMessage payloads).
 *
 * Three sanitiser flavours are exported:
 *
 *   1. stripCanvasRuntimeCacheBust(url)
 *        Low-level helper: removes the `?t=<ts>` cache-buster we add to local
 *        library URLs for in-memory reload.
 *
 *   2. sanitizePersistedCanvasString(value)
 *        Synchronous guard. Returns the input unchanged if it is a safe
 *        persisted-media shape (path-like or http(s)). Returns `null` for any
 *        of: `null`/empty; `[truncated:<N>chars]` snapshot marker; `data:` /
 *        `blob:` URL; non-URL garbage; absurdly long strings.
 *
 *   3. sanitizeCanvasNodesForPersistence(nodes) / ...Node(node)
 *        Backwards-compatible node-level helper used by BOTH pre-save and
 *        post-load paths. It now:
 *          - strips cache-busters on path-local URLs (existing behaviour)
 *          - drops poisoned values in resultUrl / lastFrame / editorBackgroundUrl
 *            / editorCanvasData / inputUrl to `null`
 *          - filters characterReferenceUrls[]
 *
 *        This means poisoned values from a legacy demo.sqlite snapshot will no
 *        longer be rendered as `<img src="[truncated:…]">` or as multi-MB
 *        `<img src="data:…">` that the browser would try to decode.
 *
 *   4. sanitizeCanvasNodesForCloudSave(nodes, groups, deps)
 *        Async preprocessor that runs BEFORE pushing canvasData to the cloud
 *        save endpoint. Uploads any in-memory data: URL (e.g. a freshly
 *        dropped image, a lastFrame just extracted from a <video>, or an
 *        editor composite that skipped the uploader fallback) to the canvas
 *        asset library so only path-style URLs ever reach the backend.
 *
 *        The uploader is injected (typically `uploadAsset` from
 *        ../services/assetService) so this module stays free of fetch wiring.
 *
 *   The Canvas "save" pipeline is now:
 *      sanitizeCanvasNodesForCloudSave()  // async — upload any data: URL
 *        → sanitizeCanvasNodesForPersistence()  // sync — drop anything left
 *        → POST /api/canvas-projects
 */

import { uploadAsset } from '../services/assetService';
import { NodeData, NodeGroup, NodeStatus, NodeType } from '../types';
import { isRetiredLegacyMediaUrl } from '../../lib/media-url-policy';

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const LOCAL_CANVAS_MEDIA_PREFIXES = [
  '/library/',
  '/canvas-library/',
  '/twitcanva-library/',
];

/**
 * Path prefixes that are safe to persist long-term. Retired local upload and
 * video-replace paths are filtered by isRetiredLegacyMediaUrl below.
 */
const PERSISTED_PATH_PREFIXES = [
  '/library/',
  '/canvas-library/',
  '/twitcanva-library/',
];

/** Matches the serialization placeholder that sqlite-store.js emits when a
 *  persisted string exceeded its value-size budget. */
const SNAPSHOT_TRUNCATED_MARKER = /^\[truncated:\d+chars\]$/;

/** Hard ceiling on any value we are willing to persist as a URL. Real path
 *  URLs are well under 1 KB; http URLs rarely exceed 2 KB. Anything longer is
 *  almost certainly base64 that leaked past the uploader. */
const PERSISTED_URL_MAX_LEN = 2048;

// ─────────────────────────────────────────────────────────────────────────────
// Low-level predicates
// ─────────────────────────────────────────────────────────────────────────────

function isLocalCanvasMediaUrl(value: string): boolean {
  if (!value || value.startsWith('data:') || value.startsWith('blob:')) {
    return false;
  }

  try {
    const parsed = new URL(
      value,
      typeof window !== 'undefined' ? window.location.origin : 'http://localhost',
    );
    return LOCAL_CANVAS_MEDIA_PREFIXES.some((prefix) => parsed.pathname.startsWith(prefix));
  } catch {
    return LOCAL_CANVAS_MEDIA_PREFIXES.some((prefix) => value.startsWith(prefix));
  }
}

/**
 * Strip the `?t=<ts>` cache-busting query our runtime adds to local
 * library URLs. Non-local (remote http)
 * URLs are returned unchanged because their query strings are often the
 * signing data (e.g. OSS/CDN tokens) and must be preserved.
 */
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

/**
 * Classify a string so we can log/assert on what a sanitiser decided to do.
 * Not exported — it is a thin wrapper around the predicates below used for
 * readability.
 */
type CanvasUrlClass =
  | 'empty'
  | 'path-persisted'
  | 'path-other'
  | 'http'
  | 'data'
  | 'blob'
  | 'retired-legacy'
  | 'truncated'
  | 'oversized'
  | 'garbage';

export function classifyCanvasPersistedUrl(value: unknown): CanvasUrlClass {
  if (value == null) return 'empty';
  if (typeof value !== 'string') return 'garbage';
  const trimmed = value.trim();
  if (!trimmed) return 'empty';
  if (SNAPSHOT_TRUNCATED_MARKER.test(trimmed)) return 'truncated';
  if (trimmed.startsWith('data:')) return 'data';
  if (trimmed.startsWith('blob:')) return 'blob';
  if (trimmed.length > PERSISTED_URL_MAX_LEN) return 'oversized';
  if (isRetiredLegacyMediaUrl(trimmed)) return 'retired-legacy';
  if (/^https?:\/\//i.test(trimmed)) return 'http';
  if (PERSISTED_PATH_PREFIXES.some((p) => trimmed.startsWith(p))) {
    return 'path-persisted';
  }
  if (trimmed.startsWith('/')) return 'path-other';
  return 'garbage';
}

/**
 * Synchronous guard: returns the string unchanged if it is safe to persist,
 * otherwise returns `null`. Callers should use `?? undefined` when assigning
 * to fields typed as optional string.
 */
export function sanitizePersistedCanvasString(value: unknown): string | null {
  const cls = classifyCanvasPersistedUrl(value);
  if (cls === 'path-persisted' || cls === 'path-other' || cls === 'http') {
    // Apply cache-bust strip to keep snapshots stable; safe for other classes
    // too, stripCanvasRuntimeCacheBust is a no-op for non-local URLs.
    const stripped = stripCanvasRuntimeCacheBust(value as string);
    return stripped ?? null;
  }
  return null;
}

/**
 * Decide whether a field's in-memory value must be removed from the save
 * payload. Returns the sanitised value (possibly unchanged) OR the input
 * itself for classes we expect the async uploader to have handled but that
 * slipped through (`data`, `blob`). Those cases are then caught by
 * ``sanitizeCanvasNodesForPersistence`` in a final sync pass and dropped to
 * null with a warning.
 *
 * Kept out of the public API — callers use ``sanitizePersistedCanvasString``
 * (strict drop) or ``sanitizeCanvasNodeForPersistence`` (node-level wrapper).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Backwards-compatible node-level helper (now strict)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Recursively sanitise a single node before persistence (cloud save,
 * localStorage draft, iframe postMessage). Any poisoned media string is
 * dropped to `undefined`. The function is pure — the input node is not
 * mutated.
 *
 * This helper now covers:
 *   - resultUrl
 *   - lastFrame
 *   - editorBackgroundUrl
 *   - editorCanvasData
 *   - inputUrl
 *   - characterReferenceUrls[]
 *   - (title/prompt/other primitives are untouched)
 */
export function sanitizeCanvasNodeForPersistence<T extends NodeData>(node: T): T {
  if (!node || typeof node !== 'object') return node;

  const scrub = (value: unknown): string | undefined => {
    if (value == null) return undefined;
    const cleaned = sanitizePersistedCanvasString(value);
    return cleaned ?? undefined;
  };

  const nextResultUrl = scrub(node.resultUrl);
  const nextLastFrame = scrub(node.lastFrame);
  const nextEditorBackgroundUrl = scrub(node.editorBackgroundUrl);
  const nextEditorCanvasData = scrub(node.editorCanvasData);
  const nextInputUrl = scrub(node.inputUrl);

  let nextCharacterRefs: string[] | undefined;
  if (Array.isArray(node.characterReferenceUrls)) {
    nextCharacterRefs = node.characterReferenceUrls
      .map((v) => sanitizePersistedCanvasString(v))
      .filter((v): v is string => typeof v === 'string' && v.length > 0);
  }

  // Graceful status downgrade: if the primary resultUrl we were going to
  // display is gone AND the node was SUCCESS, flip it to IDLE so the UI does
  // not attempt to render an <img> pointing at `undefined`.
  let nextStatus = node.status;
  const lostResult = node.resultUrl && !nextResultUrl;
  if (
    lostResult &&
    (node.type === NodeType.IMAGE ||
      node.type === NodeType.VIDEO ||
      node.type === NodeType.IMAGE_EDITOR ||
      node.type === NodeType.CAMERA_ANGLE ||
      node.type === NodeType.LOCAL_IMAGE_MODEL ||
      node.type === NodeType.LOCAL_VIDEO_MODEL) &&
    node.status === NodeStatus.SUCCESS
  ) {
    nextStatus = NodeStatus.IDLE;
  }

  return {
    ...node,
    resultUrl: nextResultUrl,
    lastFrame: nextLastFrame,
    editorBackgroundUrl: nextEditorBackgroundUrl,
    editorCanvasData: nextEditorCanvasData,
    inputUrl: nextInputUrl,
    characterReferenceUrls: nextCharacterRefs,
    status: nextStatus,
  };
}

export function sanitizeCanvasNodesForPersistence<T extends NodeData>(nodes: T[]): T[] {
  if (!Array.isArray(nodes)) {
    return [];
  }
  return nodes.map((node) => sanitizeCanvasNodeForPersistence(node));
}

/**
 * Pure sanitiser for NodeGroup[]. Today this only strips any poisoned
 * `storyContext.compositeImageUrl` to null — groups themselves carry no other
 * persistent media URL fields. Kept as a separate helper so callers are
 * symmetric with the node sanitiser.
 */
export function sanitizeCanvasGroupsForPersistence(groups: NodeGroup[]): NodeGroup[] {
  if (!Array.isArray(groups)) return [];
  return groups.map((group) => {
    if (!group || !group.storyContext) return group;
    const composite = (group.storyContext as any).compositeImageUrl;
    if (typeof composite === 'string') {
      const cleaned = sanitizePersistedCanvasString(composite);
      if (cleaned !== composite) {
        return {
          ...group,
          storyContext: {
            ...group.storyContext,
            compositeImageUrl: cleaned ?? undefined,
          } as any,
        };
      }
    }
    return group;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Async upload-first sanitiser (cloud save entry point)
// ─────────────────────────────────────────────────────────────────────────────

export interface CanvasSaveUploaderDeps {
  /**
   * Upload a `data:` URL and return a Control API media URL. Must NOT return the
   * input data URL unchanged; implementations should throw on failure so this
   * module can decide whether to drop the field to null.
   */
  uploadDataUrl: (
    dataUrl: string,
    options: { kind: 'image' | 'video'; purpose: string },
  ) => Promise<string>;
  /**
   * Optional: try to resolve a `blob:` URL to a data URL so the uploader can
   * run. If not provided (or rejected), blob URLs are dropped to null.
   */
  resolveBlobToDataUrl?: (blobUrl: string) => Promise<string>;
  /** Fires on every field we rewrote. Used by verification scripts/tests. */
  onFieldRewritten?: (info: {
    nodeId: string;
    field: string;
    beforeClass: CanvasUrlClass;
    after: string | null;
  }) => void;
}

async function uploadIfData(
  value: string,
  kind: 'image' | 'video',
  purpose: string,
  deps: CanvasSaveUploaderDeps,
): Promise<string | null> {
  try {
    const uploaded = await deps.uploadDataUrl(value, { kind, purpose });
    // Defence in depth: a broken uploader that echoes its input would re-poison
    // the snapshot. Refuse anything that still looks like a data URL.
    if (!uploaded || uploaded.startsWith('data:')) {
      return null;
    }
    return sanitizePersistedCanvasString(uploaded) ?? null;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[canvasPersistence] uploadDataUrl failed for ${purpose}:`, err);
    return null;
  }
}

async function normaliseBlob(
  value: string,
  kind: 'image' | 'video',
  purpose: string,
  deps: CanvasSaveUploaderDeps,
): Promise<string | null> {
  if (!deps.resolveBlobToDataUrl) return null;
  try {
    const dataUrl = await deps.resolveBlobToDataUrl(value);
    if (!dataUrl || !dataUrl.startsWith('data:')) return null;
    return uploadIfData(dataUrl, kind, purpose, deps);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[canvasPersistence] resolveBlobToDataUrl failed for ${purpose}:`, err);
    return null;
  }
}

async function persistFieldForSave(
  nodeId: string,
  fieldName: string,
  value: unknown,
  kind: 'image' | 'video',
  deps: CanvasSaveUploaderDeps,
): Promise<string | null> {
  const cls = classifyCanvasPersistedUrl(value);
  let next: string | null;
  switch (cls) {
    case 'path-persisted':
    case 'path-other':
    case 'http':
      next = sanitizePersistedCanvasString(value) ?? null;
      break;
    case 'data':
      next = await uploadIfData(value as string, kind, `${fieldName}:${nodeId}`, deps);
      break;
    case 'blob':
      next = await normaliseBlob(value as string, kind, `${fieldName}:${nodeId}`, deps);
      break;
    case 'empty':
      next = null;
      break;
    case 'truncated':
    case 'oversized':
    case 'garbage':
    default:
      next = null;
      break;
  }
  if (deps.onFieldRewritten) {
    deps.onFieldRewritten({ nodeId, field: fieldName, beforeClass: cls, after: next });
  }
  return next;
}

/**
 * Async pre-save sanitiser. Given a snapshot of canvas nodes and groups,
 * returns a copy where every in-memory data: URL has been uploaded to a
 * server-side storage location, blob URLs are resolved+uploaded when
 * possible, and any still-poisoned string is dropped to null.
 *
 * Typical wiring (see XIAOLOU-main/src/canvas/hooks/useWorkflow.ts):
 *
 *   const sanitized = await sanitizeCanvasNodesForCloudSave(nodes, groups, {
 *     uploadDataUrl: (v, { kind }) => uploadAsset(v, kind, 'canvas-node'),
 *     resolveBlobToDataUrl: (url) => fetch(url).then(r => r.blob()).then(b =>
 *       new Promise((ok, err) => {
 *         const reader = new FileReader();
 *         reader.onloadend = () => ok(reader.result as string);
 *         reader.onerror = err;
 *         reader.readAsDataURL(b);
 *       }),
 *     ),
 *   });
 */
export async function sanitizeCanvasNodesForCloudSave(
  nodes: NodeData[],
  groups: NodeGroup[],
  deps: CanvasSaveUploaderDeps,
): Promise<{ nodes: NodeData[]; groups: NodeGroup[] }> {
  const nextNodes: NodeData[] = [];
  for (const original of nodes || []) {
    if (!original || typeof original !== 'object') {
      nextNodes.push(original);
      continue;
    }
    const id = original.id || 'unknown';
    const isVideoKind =
      original.type === NodeType.VIDEO || original.type === NodeType.LOCAL_VIDEO_MODEL;
    const resultKind: 'image' | 'video' = isVideoKind ? 'video' : 'image';

    const [
      resultUrl,
      lastFrame,
      editorBackgroundUrl,
      editorCanvasData,
      inputUrl,
    ] = await Promise.all([
      persistFieldForSave(id, 'resultUrl', original.resultUrl, resultKind, deps),
      persistFieldForSave(id, 'lastFrame', original.lastFrame, 'image', deps),
      persistFieldForSave(id, 'editorBackgroundUrl', original.editorBackgroundUrl, 'image', deps),
      persistFieldForSave(id, 'editorCanvasData', original.editorCanvasData, 'image', deps),
      persistFieldForSave(id, 'inputUrl', original.inputUrl, 'image', deps),
    ]);

    let characterReferenceUrls: string[] | undefined;
    if (Array.isArray(original.characterReferenceUrls)) {
      const cleaned = await Promise.all(
        original.characterReferenceUrls.map((v, idx) =>
          persistFieldForSave(id, `characterReferenceUrls[${idx}]`, v, 'image', deps),
        ),
      );
      characterReferenceUrls = cleaned.filter((v): v is string => typeof v === 'string' && v.length > 0);
    }

    // Preserve graceful status downgrade when the async uploader also fails.
    let nextStatus = original.status;
    if (
      original.resultUrl &&
      !resultUrl &&
      original.status === NodeStatus.SUCCESS &&
      (original.type === NodeType.IMAGE ||
        original.type === NodeType.VIDEO ||
        original.type === NodeType.IMAGE_EDITOR ||
        original.type === NodeType.CAMERA_ANGLE ||
        original.type === NodeType.LOCAL_IMAGE_MODEL ||
        original.type === NodeType.LOCAL_VIDEO_MODEL)
    ) {
      nextStatus = NodeStatus.IDLE;
    }

    nextNodes.push({
      ...original,
      resultUrl: resultUrl ?? undefined,
      lastFrame: lastFrame ?? undefined,
      editorBackgroundUrl: editorBackgroundUrl ?? undefined,
      editorCanvasData: editorCanvasData ?? undefined,
      inputUrl: inputUrl ?? undefined,
      characterReferenceUrls,
      status: nextStatus,
    });
  }

  const nextGroups: NodeGroup[] = [];
  for (const group of groups || []) {
    if (!group || !group.storyContext) {
      nextGroups.push(group);
      continue;
    }
    const composite = (group.storyContext as any).compositeImageUrl;
    if (typeof composite !== 'string') {
      nextGroups.push(group);
      continue;
    }
    const next = await persistFieldForSave(
      group.id || 'group',
      'storyContext.compositeImageUrl',
      composite,
      'image',
      deps,
    );
    nextGroups.push({
      ...group,
      storyContext: {
        ...group.storyContext,
        compositeImageUrl: next ?? undefined,
      } as any,
    });
  }

  return { nodes: nextNodes, groups: nextGroups };
}

// ─────────────────────────────────────────────────────────────────────────────
// Default uploader adapter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default implementation of ``CanvasSaveUploaderDeps`` built on top of
 * ``uploadAsset`` from the asset service. Importers who need to stub the
 * uploader in tests should import this file and pass their own deps instead.
 */
export async function defaultCanvasUploadDeps(): Promise<CanvasSaveUploaderDeps> {
  return {
    uploadDataUrl: async (dataUrl, { kind, purpose }) => uploadAsset(dataUrl, kind, purpose),
    resolveBlobToDataUrl: async (blobUrl) => {
      const response = await fetch(blobUrl);
      const blob = await response.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    },
  };
}
