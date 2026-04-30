import { NodeData, NodeGroup, NodeStatus, Viewport } from '../types';

export type CanvasProjectSnapshot = {
  title: string;
  nodes: NodeData[];
  groups: NodeGroup[];
  viewport: Viewport;
};

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

const LOCAL_FIRST_FIELDS = new Set([
  'title',
  'prompt',
  'x',
  'y',
  'width',
  'aspectRatio',
  'resolution',
  'model',
  'imageModel',
  'videoModel',
  'videoDuration',
  'videoMode',
  'batchCount',
  'isPromptExpanded',
  'textMode',
  'networkSearch',
  'generateAudio',
]);

const OUTPUT_FIELDS = new Set([
  'status',
  'resultUrl',
  'lastFrame',
  'resultAspectRatio',
  'errorMessage',
  'taskId',
  'generationStartTime',
  'loadingKind',
]);

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // Fall back to JSON clone below.
    }
  }
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

function valuesEqual(left: unknown, right: unknown) {
  try {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  } catch {
    return Object.is(left, right);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPrimitiveArray(value: unknown): value is Array<string | number | boolean> {
  return Array.isArray(value) && value.every((item) => {
    const type = typeof item;
    return type === 'string' || type === 'number' || type === 'boolean';
  });
}

function unionPrimitiveArrays(localValue: unknown, remoteValue: unknown) {
  if (!isPrimitiveArray(localValue) || !isPrimitiveArray(remoteValue)) return null;
  const seen = new Set<string>();
  const merged: Array<string | number | boolean> = [];
  for (const value of [...localValue, ...remoteValue]) {
    const key = `${typeof value}:${String(value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(value);
  }
  return merged;
}

function statusRank(value: unknown) {
  switch (value) {
    case NodeStatus.SUCCESS:
    case 'success':
      return 4;
    case NodeStatus.LOADING:
    case 'loading':
      return 3;
    case NodeStatus.ERROR:
    case 'error':
      return 2;
    case NodeStatus.IDLE:
    case 'idle':
      return 1;
    default:
      return 0;
  }
}

function chooseOutputValue(key: string, localValue: unknown, remoteValue: unknown) {
  if (key === 'status') {
    return statusRank(remoteValue) > statusRank(localValue) ? remoteValue : localValue;
  }

  const localStatus = isRecord(localValue) ? localValue.status : undefined;
  const remoteStatus = isRecord(remoteValue) ? remoteValue.status : undefined;
  if (statusRank(remoteStatus) > statusRank(localStatus)) return remoteValue;

  if (remoteValue != null && localValue == null) return remoteValue;
  return localValue;
}

function mergeValue(baseValue: unknown, localValue: unknown, remoteValue: unknown, key = ''): unknown {
  const localChanged = !valuesEqual(baseValue, localValue);
  const remoteChanged = !valuesEqual(baseValue, remoteValue);

  if (valuesEqual(localValue, remoteValue)) return cloneValue(localValue);
  if (localChanged && !remoteChanged) return cloneValue(localValue);
  if (!localChanged && remoteChanged) return cloneValue(remoteValue);
  if (!localChanged && !remoteChanged) return cloneValue(remoteValue);

  if (key === 'parentIds' || key === 'nodeIds') {
    const union = unionPrimitiveArrays(localValue, remoteValue);
    if (union) return union;
  }

  if (OUTPUT_FIELDS.has(key)) {
    return cloneValue(chooseOutputValue(key, localValue, remoteValue));
  }

  if (LOCAL_FIRST_FIELDS.has(key)) {
    return cloneValue(localValue);
  }

  if (isRecord(baseValue) || isRecord(localValue) || isRecord(remoteValue)) {
    return mergeRecord(
      isRecord(baseValue) ? baseValue : {},
      isRecord(localValue) ? localValue : {},
      isRecord(remoteValue) ? remoteValue : {},
    );
  }

  const union = unionPrimitiveArrays(localValue, remoteValue);
  if (union) return union;

  return cloneValue(localValue);
}

function mergeRecord(
  baseValue: Record<string, unknown>,
  localValue: Record<string, unknown>,
  remoteValue: Record<string, unknown>,
) {
  const keys = new Set([
    ...Object.keys(baseValue),
    ...Object.keys(localValue),
    ...Object.keys(remoteValue),
  ]);
  const merged: Record<string, unknown> = {};

  for (const key of keys) {
    const value = mergeValue(baseValue[key], localValue[key], remoteValue[key], key);
    if (typeof value !== 'undefined') merged[key] = value;
  }

  return merged;
}

function mapById<T extends { id?: string }>(items: T[]) {
  const map = new Map<string, T>();
  for (const item of items) {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    if (id) map.set(id, item);
  }
  return map;
}

function mergeCollection<T extends { id?: string }>(baseItems: T[], localItems: T[], remoteItems: T[]): T[] {
  const baseMap = mapById(baseItems);
  const localMap = mapById(localItems);
  const remoteMap = mapById(remoteItems);
  const orderedIds: string[] = [];
  const seen = new Set<string>();

  for (const item of localItems) {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    if (id && !seen.has(id)) {
      seen.add(id);
      orderedIds.push(id);
    }
  }
  for (const item of remoteItems) {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    if (id && !seen.has(id)) {
      seen.add(id);
      orderedIds.push(id);
    }
  }

  const merged: T[] = [];
  for (const id of orderedIds) {
    const base = baseMap.get(id);
    const local = localMap.get(id);
    const remote = remoteMap.get(id);

    if (!base) {
      if (local && remote && !valuesEqual(local, remote)) {
        merged.push(mergeRecord(
          {},
          local as Record<string, unknown>,
          remote as Record<string, unknown>,
        ) as T);
        continue;
      }
      merged.push(cloneValue((local || remote) as T));
      continue;
    }

    if (!local) {
      continue;
    }
    if (!remote) {
      merged.push(cloneValue(local));
      continue;
    }

    if (valuesEqual(local, remote)) {
      merged.push(cloneValue(local));
      continue;
    }

    merged.push(mergeRecord(
      base as Record<string, unknown>,
      local as Record<string, unknown>,
      remote as Record<string, unknown>,
    ) as T);
  }

  return merged;
}

export function buildCanvasProjectSnapshot(input: {
  title?: string | null;
  nodes?: unknown[] | null;
  groups?: unknown[] | null;
  viewport?: Partial<Viewport> | null;
}): CanvasProjectSnapshot {
  const viewport = input.viewport && typeof input.viewport === 'object'
    ? {
        x: Number(input.viewport.x) || 0,
        y: Number(input.viewport.y) || 0,
        zoom: Number(input.viewport.zoom) || 1,
      }
    : DEFAULT_VIEWPORT;

  return {
    title: String(input.title || 'Untitled'),
    nodes: Array.isArray(input.nodes) ? cloneValue(input.nodes) as NodeData[] : [],
    groups: Array.isArray(input.groups) ? cloneValue(input.groups) as NodeGroup[] : [],
    viewport,
  };
}

export function mergeCanvasProjectSnapshots(
  base: CanvasProjectSnapshot,
  local: CanvasProjectSnapshot,
  remote: CanvasProjectSnapshot,
): CanvasProjectSnapshot {
  return {
    title: mergeValue(base.title, local.title, remote.title, 'title') as string,
    nodes: mergeCollection(base.nodes, local.nodes, remote.nodes),
    groups: mergeCollection(base.groups, local.groups, remote.groups),
    viewport: mergeRecord(base.viewport as unknown as Record<string, unknown>, local.viewport as unknown as Record<string, unknown>, remote.viewport as unknown as Record<string, unknown>) as unknown as Viewport,
  };
}

export function isRemoteCanvasVersionNewer(remoteUpdatedAt?: string | null, localUpdatedAt?: string | null) {
  const remoteTime = Date.parse(remoteUpdatedAt || '');
  const localTime = Date.parse(localUpdatedAt || '');
  return Number.isFinite(remoteTime) && (!Number.isFinite(localTime) || remoteTime > localTime);
}
