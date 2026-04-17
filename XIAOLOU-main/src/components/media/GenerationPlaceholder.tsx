import { Image as ImageIcon, Video } from "lucide-react";
import { API_BASE_URL } from "../../lib/api";
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

export function getGeneratedMediaUrl(url?: string | null) {
  const normalized = String(url || "").trim();
  if (!normalized || normalized.includes("mock.assets.local")) {
    return null;
  }

  if (/^(?:data:|blob:)/i.test(normalized)) {
    return normalized;
  }

  if (/^https?:\/\//i.test(normalized)) {
    try {
      const parsed = new URL(normalized);
      if (parsed.pathname.startsWith("/uploads/")) {
        return parsed.pathname;
      }
    } catch {
      // fall through
    }
    return normalized;
  }

  const apiBaseUrl = API_BASE_URL.replace(/\/+$/, "");
  if (normalized.startsWith("/")) {
    return `${apiBaseUrl}${normalized}`;
  }

  return `${apiBaseUrl}/${normalized.replace(/^\/+/, "")}`;
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
