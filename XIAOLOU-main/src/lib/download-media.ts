/** 将远程/同源媒体拉成 Blob 后触发浏览器下载，避免仅用 target=_blank 变成“网页预览”。 */
export function guessMediaFilename(url: string, id: string, kind: "image" | "video"): string {
  const short = id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 16) || "export";
  try {
    const path = new URL(url, "http://local.invalid").pathname;
    const match = /\.[a-z0-9]{1,8}$/i.exec(path);
    if (match) return `xiaolou-${kind}-${short}${match[0]}`;
  } catch {
    /* ignore */
  }
  return kind === "video" ? `xiaolou-video-${short}.mp4` : `xiaolou-image-${short}.png`;
}

export async function downloadMediaFile(resolvedUrl: string, filename: string): Promise<void> {
  const trimmed = String(resolvedUrl || "").trim();
  if (!trimmed) return;

  if (trimmed.startsWith("blob:") || trimmed.startsWith("data:")) {
    const a = document.createElement("a");
    a.href = trimmed;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }

  const triggerBlobDownload = (blob: Blob) => {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  };

  const attempts: string[] = [];
  try {
    const parsed = new URL(trimmed, window.location.origin);
    attempts.push(`${parsed.pathname}${parsed.search}`);
  } catch {
    attempts.push(trimmed.startsWith("/") ? trimmed : `/${trimmed.replace(/^\/+/, "")}`);
  }
  if (!attempts.includes(trimmed)) {
    attempts.push(trimmed);
  }
  const unique = [...new Set(attempts)];

  for (const href of unique) {
    const full =
      href.startsWith("http://") || href.startsWith("https://")
        ? href
        : `${window.location.origin}${href.startsWith("/") ? href : `/${href}`}`;
    try {
      const response = await fetch(full, { credentials: "include", mode: "cors" });
      if (!response.ok) continue;
      const blob = await response.blob();
      triggerBlobDownload(blob);
      return;
    } catch {
      /* try next */
    }
  }

  window.open(trimmed, "_blank", "noopener,noreferrer");
}
