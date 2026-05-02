const RETIRED_LEGACY_MEDIA_PATH_RE = /^\/(?:uploads(?:\/|$)|vr-)/;

export function isRetiredLegacyMediaPath(path?: string | null) {
  const normalized = String(path || "").trim().split(/[?#]/, 1)[0];
  return RETIRED_LEGACY_MEDIA_PATH_RE.test(normalized);
}

export function isRetiredLegacyMediaUrl(value?: string | null) {
  const normalized = String(value || "").trim();
  if (!normalized) return false;

  if (/^https?:\/\//i.test(normalized)) {
    try {
      return isRetiredLegacyMediaPath(new URL(normalized).pathname);
    } catch {
      return false;
    }
  }

  return isRetiredLegacyMediaPath(normalized);
}
