import type { Storyboard } from "../../../lib/api";

export const DEFAULT_EPISODES = [1, 2] as const;
export const DEFAULT_EPISODE_ADD_SETTINGS = { start: 1, step: 1 };

export type EpisodeAddSettings = typeof DEFAULT_EPISODE_ADD_SETTINGS;

const EPISODE_SCRIPT_STORAGE_PREFIX = "xiaolou:script-breakdown:episode-scripts:v1";
const EPISODE_ADD_SETTINGS_STORAGE_PREFIX = "xiaolou:script-breakdown:episode-add-settings:v1";

function episodeScriptStorageKey(projectId: string) {
  return `${EPISODE_SCRIPT_STORAGE_PREFIX}:${projectId}`;
}

function episodeAddSettingsStorageKey(projectId: string) {
  return `${EPISODE_ADD_SETTINGS_STORAGE_PREFIX}:${projectId}`;
}

export function toEpisodeNumber(value: unknown) {
  const episodeNo = Number(value);
  return Number.isSafeInteger(episodeNo) && episodeNo > 0 ? episodeNo : null;
}

export function toPositiveInteger(value: unknown, fallback: number) {
  return toEpisodeNumber(value) ?? fallback;
}

export function hasEpisodeScript(scripts: Record<number, string>, episodeNo: number) {
  return Object.prototype.hasOwnProperty.call(scripts, episodeNo);
}

export function sortedEpisodes(values: Iterable<number>) {
  const episodes = Array.from(new Set(Array.from(values).filter((value) => toEpisodeNumber(value) != null))).sort(
    (a, b) => a - b,
  );
  return episodes.length > 0 ? [...episodes] : [...DEFAULT_EPISODES];
}

export function parseEpisodeScripts(value: unknown): Record<number, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.entries(value).reduce<Record<number, string>>((acc, [key, script]) => {
    const episodeNo = toEpisodeNumber(key);
    if (episodeNo != null && typeof script === "string") {
      acc[episodeNo] = script;
    }
    return acc;
  }, {});
}

export function serializeEpisodeScripts(scripts: Record<number, string>) {
  return Object.entries(scripts).reduce<Record<string, string>>((acc, [episodeNo, script]) => {
    const normalizedEpisodeNo = toEpisodeNumber(episodeNo);
    if (normalizedEpisodeNo != null && typeof script === "string") {
      acc[String(normalizedEpisodeNo)] = script;
    }
    return acc;
  }, {});
}

export function readStoredEpisodeScripts(projectId: string): Record<number, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(episodeScriptStorageKey(projectId));
    return raw ? parseEpisodeScripts(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function writeStoredEpisodeScripts(projectId: string, scripts: Record<number, string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      episodeScriptStorageKey(projectId),
      JSON.stringify(serializeEpisodeScripts(scripts)),
    );
  } catch {
    // Browser storage is a best-effort draft cache; server persistence still runs.
  }
}

export function readStoredEpisodeAddSettings(projectId: string) {
  if (typeof window === "undefined") return DEFAULT_EPISODE_ADD_SETTINGS;
  try {
    const raw = window.localStorage.getItem(episodeAddSettingsStorageKey(projectId));
    if (!raw) return DEFAULT_EPISODE_ADD_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<EpisodeAddSettings>;
    return {
      start: toPositiveInteger(parsed.start, DEFAULT_EPISODE_ADD_SETTINGS.start),
      step: toPositiveInteger(parsed.step, DEFAULT_EPISODE_ADD_SETTINGS.step),
    };
  } catch {
    return DEFAULT_EPISODE_ADD_SETTINGS;
  }
}

export function writeStoredEpisodeAddSettings(projectId: string, settings: EpisodeAddSettings) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(episodeAddSettingsStorageKey(projectId), JSON.stringify(settings));
  } catch {
    // Browser storage is best-effort; the controls still use in-memory settings.
  }
}

export function previewEpisodeNumbers(start: number, step: number, count = 3) {
  const preview: number[] = [];
  let next = start;
  while (preview.length < count && next <= Number.MAX_SAFE_INTEGER - step) {
    preview.push(next);
    next += step;
  }
  return preview;
}

export function previewFutureEpisodeNumbers(episodes: number[], start: number, step: number, count = 3) {
  const used = new Set(episodes);
  const preview: number[] = [];
  let next = episodes.length > 0 ? Math.max(...episodes) + step : start;
  while (preview.length < count && next <= Number.MAX_SAFE_INTEGER - step) {
    while (used.has(next)) {
      next += step;
    }
    preview.push(next);
    used.add(next);
    next += step;
  }
  return preview;
}

export function nextFutureEpisodeNumber(episodes: number[], start: number, step: number) {
  return previewFutureEpisodeNumbers(episodes, start, step, 1)[0] ?? start;
}

export function groupStoryboardsByEpisode(items: Storyboard[]) {
  return items.reduce<Record<number, Storyboard[]>>((acc, item) => {
    const episodeNo = toEpisodeNumber(item.episodeNo) ?? 1;
    (acc[episodeNo] ??= []).push(item);
    return acc;
  }, {});
}

export function createDraftPromptsByEpisode(groups: Record<number, Storyboard[]>) {
  return Object.entries(groups).reduce<Record<number, Record<string, string>>>(
    (acc, [episodeNo, items]) => {
      const normalizedEpisodeNo = toEpisodeNumber(episodeNo);
      if (normalizedEpisodeNo == null) return acc;
      acc[normalizedEpisodeNo] = items.reduce<Record<string, string>>((prompts, item) => {
        prompts[item.id] = item.script;
        return prompts;
      }, {});
      return acc;
    },
    {},
  );
}

export function projectScriptContentFromEpisodes(scripts: Record<number, string>, fallback: string) {
  if (hasEpisodeScript(scripts, 1)) {
    return scripts[1] ?? "";
  }

  const firstEpisodeNo = sortedEpisodes(Object.keys(scripts).map(Number))[0];
  return firstEpisodeNo != null && hasEpisodeScript(scripts, firstEpisodeNo)
    ? (scripts[firstEpisodeNo] ?? "")
    : fallback;
}
