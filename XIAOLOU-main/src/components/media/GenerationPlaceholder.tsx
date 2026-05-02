import { Image as ImageIcon, Video } from "lucide-react";
import { API_BASE_URL } from "../../lib/api";
import { isRetiredLegacyMediaUrl } from "../../lib/media-url-policy";
import { cn } from "../../lib/utils";

type GeneratedMediaPlaceholderProps = {
  kind?: "image" | "video";
  label?: string;
  description?: string;
  compact?: boolean;
  className?: string;
};

export function isGeneratedMediaUrl(url?: string | null) {
  return Boolean(getGeneratedMediaUrl(url));
}

// Matches the snapshot-truncation sentinel produced by core-api's
// sqlite-store.js when a string exceeds SNAPSHOT_MAX_STRING_BYTES. Older
// records in demo.sqlite still carry these placeholders in display URL
// fields; without this guard the <img> renders a broken icon.
const SNAPSHOT_TRUNCATED_RE = /^\[truncated:\d+chars\]$/;

export function getGeneratedMediaUrl(url?: string | null) {
  const normalized = String(url || "").trim();
  if (!normalized || normalized.includes("mock.assets.local")) {
    return null;
  }

  // Belt-and-braces defenses — the root-cause fix lives server-side in
  // core-api/src/store.js (sanitizeDisplayUrlForPersist +
  // sanitizeInlineReferenceImages + sanitizePersistedDisplayUrls at
  // load-time migration). These client-side checks additionally protect
  // against anything else slipping through.
  if (SNAPSHOT_TRUNCATED_RE.test(normalized)) {
    return null;
  }

  if (/^(?:data:|blob:)/i.test(normalized)) {
    return normalized;
  }

  if (isRetiredLegacyMediaUrl(normalized)) {
    return null;
  }

  // A real upload path / http URL is almost always < 512 chars. Any
  // "non-data" string this long is very likely a bare base64 payload that
  // slipped through, and rendering it as <img src> would either crash the
  // parser or inflate the DOM. Drop it.
  if (normalized.length > 2048) {
    return null;
  }

  if (/^https?:\/\//i.test(normalized)) return normalized;

  const apiBaseUrl = API_BASE_URL.replace(/\/+$/, "");
  if (normalized.startsWith("/")) {
    return `${apiBaseUrl}${normalized}`;
  }

  // Anything else (no scheme, no leading slash, not data/blob) is not a
  // valid URL we know how to resolve. Refuse rather than pretending it's
  // a relative upload path and triggering a broken image icon.
  return null;
}

export function GeneratedMediaPlaceholder({
  kind = "image",
  label = "未生成",
  description,
  compact = false,
  className,
}: GeneratedMediaPlaceholderProps) {
  const Icon = kind === "video" ? Video : ImageIcon;

  return (
    <div
      className={cn(
        "flex items-center justify-center bg-muted/40 text-muted-foreground",
        className,
      )}
    >
      <div className="flex max-w-[16rem] flex-col items-center gap-2 px-4 text-center">
        <Icon className={compact ? "h-5 w-5" : "h-9 w-9"} />
        <div className={compact ? "text-xs font-medium" : "text-sm font-medium"}>{label}</div>
        {description ? (
          <div className="text-[11px] leading-5 text-muted-foreground/80">{description}</div>
        ) : null}
      </div>
    </div>
  );
}
