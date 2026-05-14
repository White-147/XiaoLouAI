export type CanvasProjectLoadState =
  | { status: "idle" }
  | { status: "syncing" }
  | { status: "loading" }
  | { status: "error"; message: string };

export function describeRequestError(error: unknown, fallback: string) {
  const anyError = error as { code?: string; status?: number; message?: string } | null | undefined;
  const code = String(anyError?.code || "").trim().toUpperCase();
  const status = typeof anyError?.status === "number" ? anyError.status : 0;
  const message = String(anyError?.message || "").trim();

  if (message && code && !message.toUpperCase().includes(code)) {
    return `[${code}] ${message}`;
  }
  if (message) {
    return message;
  }
  if (code) {
    return `[${code}] ${fallback}`;
  }
  if (status > 0) {
    return `[HTTP ${status}] ${fallback}`;
  }
  return fallback;
}
