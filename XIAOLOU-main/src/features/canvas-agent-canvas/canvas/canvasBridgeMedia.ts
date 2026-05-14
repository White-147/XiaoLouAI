import { API_BASE_URL } from "./api/canvas";
import { isRetiredLegacyMediaUrl } from "../../../lib/media-url-policy";

export function resolveAbsoluteAssetUrl(url?: string | null) {
  const normalized = String(url || "").trim();
  if (!normalized || normalized.includes("mock.assets.local")) return null;
  if (/^(?:data:|blob:)/i.test(normalized)) return normalized;
  if (isRetiredLegacyMediaUrl(normalized)) return null;
  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }
  const apiBaseUrl = API_BASE_URL.replace(/\/+$/, "");
  const resolved = normalized.startsWith("/")
    ? `${apiBaseUrl}${normalized}`
    : `${apiBaseUrl}/${normalized.replace(/^\/+/, "")}`;
  return new URL(resolved, window.location.origin).toString();
}

function isPrivateOrLoopbackHostname(hostname: string) {
  const h = hostname.toLowerCase();
  return (
    h === "127.0.0.1" || h === "localhost" || h === "::1" ||
    h.startsWith("10.") || h.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)
  );
}

function shouldInlineReferenceImageUrl(url: string) {
  if (!url) return false;
  if (/^data:/i.test(url)) return true;
  if (/^blob:/i.test(url)) return true;
  if (isRetiredLegacyMediaUrl(url)) return false;
  try {
    const parsed = new URL(url);
    if (
      parsed.pathname.startsWith("/canvas-library/") ||
      parsed.pathname.startsWith("/twitcanva-library/") ||
      parsed.pathname.startsWith("/library/")
    ) return true;
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
    return isPrivateOrLoopbackHostname(parsed.hostname);
  } catch { return true; }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image."));
    reader.readAsDataURL(blob);
  });
}

async function convertPngBlobToJpeg(blob: Blob): Promise<string> {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const image = new Image();
      image.onload = () => res(image);
      image.onerror = () => rej(new Error("Failed to decode PNG."));
      image.src = objectUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not create canvas context.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const jpegBlob = await new Promise<Blob>((res, rej) =>
      canvas.toBlob((b) => b ? res(b) : rej(new Error("canvas.toBlob failed")), "image/jpeg", 0.92)
    );
    return blobToDataUrl(jpegBlob);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function inlineReferenceImageUrl(url: string): Promise<string> {
  const normalized = String(url || "").trim();
  if (!normalized || !shouldInlineReferenceImageUrl(normalized)) return normalized;
  try {
    const response = await fetch(normalized);
    if (!response.ok) throw new Error(`Unexpected status ${response.status}`);
    const blob = await response.blob();
    const type = (blob.type || "").toLowerCase();
    const isPng = type === "image/png" || normalized.toLowerCase().includes(".png");
    if (isPng) return convertPngBlobToJpeg(blob);
    return blobToDataUrl(blob);
  } catch (err) {
    console.warn("[CanvasCreate] Failed to inline reference image:", err);
    return normalized;
  }
}

export function normalizeBridgeVideoMode(mode?: string | null) {
  const normalized = String(mode || "").trim().toLowerCase();
  if (normalized === "frame-to-frame") return "start_end_frame";
  if (normalized === "multi-reference") return "multi_param";
  if (normalized === "image-to-video") return "image_to_video";
  if (normalized === "text-to-video") return "text_to_video";
  if (normalized === "motion-control") return "motion_control";
  if (normalized === "video-edit") return "video_edit";
  if (normalized === "video-extend") return "video_extend";
  return normalized;
}

export function normalizeBridgeVideoModeDuration(duration?: number) {
  if (!Number.isFinite(duration)) return undefined;
  return `${Math.max(1, Math.round(Number(duration)))}s`;
}

export function normalizeBridgeSelectableValue(value?: string) {
  const v = String(value || "").trim();
  if (!v || v.toLowerCase() === "auto") return undefined;
  return v;
}

export function getVideoCapabilityInputMode(videoMode: string) {
  if (videoMode === "image_to_video") return "single_reference";
  if (videoMode === "start_end_frame") return "start_end_frame";
  if (videoMode === "multi_param") return "multi_param";
  return "text_to_video";
}
