import { listAssets, type AgentCanvasProjectSummary, type Asset, type CanvasProjectSummary } from "./api/assets";

export const UNKNOWN_DATE_LABEL = "未知日期";

export type DateGroup<T> = {
  dateKey: string;
  items: T[];
  sortTime: number;
};

export type ProjectAssetsCacheEntry = {
  items: Asset[];
  updatedAt: number;
};

export const ASSETS_CACHE_STALE_MS = 30_000;
export const ASSETS_BACKGROUND_REFRESH_MS = 60_000;
export const projectAssetsCache = new globalThis.Map<string, ProjectAssetsCacheEntry>();
export const projectAssetsInFlight = new globalThis.Map<string, Promise<Asset[]>>();
export const projectTitleCache = new globalThis.Map<string, string>();
export const syncedVideoReplaceProjects = new globalThis.Set<string>();

export function toLocalDateKey(value: string | null | undefined) {
  if (!value) return UNKNOWN_DATE_LABEL;
  const date = new Date(value);
  const time = date.getTime();
  if (!Number.isFinite(time)) return UNKNOWN_DATE_LABEL;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function toDateSortTime(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

export function groupByLocalDate<T>(
  items: T[],
  getDateValue: (item: T) => string | null | undefined,
): DateGroup<T>[] {
  const groups = new globalThis.Map<string, DateGroup<T>>();

  for (const item of items) {
    const dateValue = getDateValue(item);
    const dateKey = toLocalDateKey(dateValue);
    const sortTime = toDateSortTime(dateValue);
    const group = groups.get(dateKey);

    if (group) {
      group.items.push(item);
      group.sortTime = Math.max(group.sortTime, sortTime);
    } else {
      groups.set(dateKey, { dateKey, items: [item], sortTime });
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      items: [...group.items].sort(
        (left, right) => toDateSortTime(getDateValue(right)) - toDateSortTime(getDateValue(left)),
      ),
    }))
    .sort((left, right) => right.sortTime - left.sortTime);
}

export function normalizeCanvasProjectSummaries(items: CanvasProjectSummary[]): CanvasProjectSummary[] {
  const byId = new globalThis.Map<string, CanvasProjectSummary>();
  for (const item of items) {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    if (!id) continue;
    const candidate = item.id === id ? item : { ...item, id };
    const existing = byId.get(id);
    const candidateUpdatedAt = toDateSortTime(candidate.updatedAt);
    const existingUpdatedAt = toDateSortTime(existing?.updatedAt);
    const candidateCreatedAt = toDateSortTime(candidate.createdAt);
    const existingCreatedAt = toDateSortTime(existing?.createdAt);
    if (
      !existing ||
      candidateUpdatedAt > existingUpdatedAt ||
      (candidateUpdatedAt === existingUpdatedAt && candidateCreatedAt > existingCreatedAt)
    ) {
      byId.set(id, candidate);
    }
  }
  return Array.from(byId.values()).sort(
    (left, right) =>
      toDateSortTime(right.updatedAt) - toDateSortTime(left.updatedAt) ||
      toDateSortTime(right.createdAt) - toDateSortTime(left.createdAt),
  );
}

export function normalizeAgentCanvasProjectSummaries(items: AgentCanvasProjectSummary[]): AgentCanvasProjectSummary[] {
  const byId = new globalThis.Map<string, AgentCanvasProjectSummary>();
  for (const item of items) {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    if (!id) continue;
    const candidate = item.id === id ? item : { ...item, id };
    const existing = byId.get(id);
    const candidateUpdatedAt = toDateSortTime(candidate.updatedAt);
    const existingUpdatedAt = toDateSortTime(existing?.updatedAt);
    const candidateCreatedAt = toDateSortTime(candidate.createdAt);
    const existingCreatedAt = toDateSortTime(existing?.createdAt);
    if (
      !existing ||
      candidateUpdatedAt > existingUpdatedAt ||
      (candidateUpdatedAt === existingUpdatedAt && candidateCreatedAt > existingCreatedAt)
    ) {
      byId.set(id, candidate);
    }
  }
  return Array.from(byId.values()).sort(
    (left, right) =>
      toDateSortTime(right.updatedAt) - toDateSortTime(left.updatedAt) ||
      toDateSortTime(right.createdAt) - toDateSortTime(left.createdAt),
  );
}

export function getCachedProjectAssets(projectId: string) {
  return projectAssetsCache.get(projectId) || null;
}

export function setCachedProjectAssets(projectId: string, items: Asset[]) {
  projectAssetsCache.set(projectId, {
    items,
    updatedAt: Date.now(),
  });
}

export function shouldRefreshProjectAssets(projectId: string) {
  const cached = getCachedProjectAssets(projectId);
  return !cached || Date.now() - cached.updatedAt > ASSETS_CACHE_STALE_MS;
}

export function fetchProjectAssets(projectId: string) {
  const existing = projectAssetsInFlight.get(projectId);
  if (existing) return existing;

  const request = listAssets(projectId)
    .then((response) => response.items)
    .finally(() => {
      projectAssetsInFlight.delete(projectId);
    });
  projectAssetsInFlight.set(projectId, request);
  return request;
}
