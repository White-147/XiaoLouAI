const fs = require("node:fs");
const path = require("node:path");
const { createUploadFromBuffer } = require("./uploads");

const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..");

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]);
const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov"]);

function syncError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function resolveWorkspacePath(configuredValue, fallback) {
  const value = String(configuredValue || "").trim();
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(WORKSPACE_ROOT, value);
}

function resolveJaazFilesDir() {
  if (process.env.JAAZ_FILES_DIR) {
    return resolveWorkspacePath(process.env.JAAZ_FILES_DIR, "");
  }

  const userDataDir = resolveWorkspacePath(
    process.env.JAAZ_USER_DATA_DIR || process.env.USER_DATA_DIR,
    path.join(WORKSPACE_ROOT, "jaaz", "server", "user_data"),
  );
  return path.join(userDataDir, "files");
}

function inferMimeType(fileName, fallback = "application/octet-stream") {
  return MIME_BY_EXT[path.extname(fileName || "").toLowerCase()] || fallback;
}

function inferMediaKind({ fileName, mimeType, mediaKind }) {
  const requested = String(mediaKind || "").trim().toLowerCase();
  if (requested === "image" || requested === "video") return requested;

  const normalizedMime = String(mimeType || "").trim().toLowerCase();
  if (normalizedMime.startsWith("video/")) return "video";
  if (normalizedMime.startsWith("image/")) return "image";

  const ext = path.extname(fileName || "").toLowerCase();
  if (VIDEO_EXTS.has(ext)) return "video";
  if (IMAGE_EXTS.has(ext)) return "image";
  return "unknown";
}

function extractFileNameFromUrl(fileUrl) {
  const raw = String(fileUrl || "").trim();
  if (!raw) return "";

  try {
    const parsed = new URL(raw, "http://xiaolou.local");
    const decodedPath = decodeURIComponent(parsed.pathname || "");
    const match = decodedPath.match(/\/(?:jaaz\/)?api\/file\/([^/]+)$/);
    return match?.[1] || "";
  } catch {
    const match = raw.match(/\/(?:jaaz\/)?api\/file\/([^/?#]+)(?:[?#].*)?$/);
    return match?.[1] ? decodeURIComponent(match[1]) : "";
  }
}

function resolveJaazAssetFile(body) {
  const fromUrl = extractFileNameFromUrl(body?.fileUrl);
  const fromName = String(body?.fileName || "").trim();
  const fileName = path.basename(fromUrl || fromName);

  if (!fileName || fileName === "." || fileName === "..") {
    throw syncError(400, "BAD_REQUEST", "Jaaz fileName or fileUrl is required");
  }

  const filesDir = path.resolve(resolveJaazFilesDir());
  const absolutePath = path.resolve(filesDir, fileName);
  const filesDirWithSep = filesDir.endsWith(path.sep) ? filesDir : `${filesDir}${path.sep}`;

  if (!absolutePath.startsWith(filesDirWithSep)) {
    throw syncError(403, "FORBIDDEN", "Jaaz asset path is outside the allowed files directory");
  }

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    throw syncError(404, "NOT_FOUND", "Jaaz asset file not found");
  }

  return { fileName, absolutePath };
}

function cleanAssetName(value, fallbackFileName) {
  const fallback = path.basename(fallbackFileName, path.extname(fallbackFileName)) || "Jaaz Asset";
  return String(value || fallback).trim().slice(0, 120) || fallback;
}

function cleanOptionalString(value) {
  const normalized = String(value || "").trim();
  return normalized || undefined;
}

function cleanOptionalNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function cleanPreviewUrl(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 2048) return undefined;
  // Avoid bloating the core state snapshot with inline thumbnails. Jaaz keeps
  // the full canvas data; XiaoLou only needs a lightweight project index.
  if (/^data:/i.test(normalized)) return undefined;
  return normalized;
}

function compactObject(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

async function syncJaazAssetToProject({ store, projectId, body }) {
  const { fileName, absolutePath } = resolveJaazAssetFile(body);
  const sourceTaskId = `jaaz:${fileName}`;
  const existing = (store.listAssets(projectId) || []).find(
    (asset) => asset?.sourceModule === "agent_studio" && asset?.sourceTaskId === sourceTaskId,
  );

  const mimeType = String(body?.mimeType || "").trim() || inferMimeType(fileName);
  const mediaKind = inferMediaKind({
    fileName,
    mimeType,
    mediaKind: body?.mediaKind,
  });

  if (mediaKind !== "image" && mediaKind !== "video") {
    throw syncError(400, "UNSUPPORTED_MEDIA_KIND", "Only Jaaz image and video assets can be synced");
  }

  let upload = null;
  let mediaUrl = existing?.mediaUrl || null;
  let previewUrl = existing?.previewUrl || null;

  if (!mediaUrl) {
    upload = await createUploadFromBuffer({
      buffer: fs.readFileSync(absolutePath),
      kind: mediaKind === "video" ? "agent-studio-video" : "agent-studio-image",
      originalName: fileName,
      contentType: mimeType,
    });
    mediaUrl = upload.urlPath;
    previewUrl = mediaKind === "image" ? mediaUrl : null;
  }
  if (mediaKind === "image" && !previewUrl && mediaUrl) {
    previewUrl = mediaUrl;
  }

  const sourceMetadata = compactObject({
    jaazFileName: fileName,
    originalFileName: cleanOptionalString(body?.fileName),
    fileUrl: cleanOptionalString(body?.fileUrl),
    mimeType,
    width: cleanOptionalNumber(body?.width),
    height: cleanOptionalNumber(body?.height),
    canvasId: cleanOptionalString(body?.canvasId),
    sessionId: cleanOptionalString(body?.sessionId),
    source: cleanOptionalString(body?.source),
  });

  const asset = store.saveProjectAsset(projectId, {
    assetType: mediaKind === "video" ? "video_ref" : "style",
    name: cleanAssetName(body?.name || body?.fileName, fileName),
    description: String(body?.description || existing?.description || "来自智能体画布").trim(),
    previewUrl,
    mediaKind,
    mediaUrl,
    sourceTaskId,
    sourceModule: "agent_studio",
    sourceMetadata,
    generationPrompt: String(body?.prompt || "").trim(),
    referenceImageUrls: [],
    imageStatus: mediaKind === "image" ? "ready" : null,
    scope: "manual",
  });

  if (!asset) {
    throw syncError(404, "NOT_FOUND", "project not found");
  }

  return {
    ...asset,
    syncedUpload: upload
      ? {
          url: mediaUrl,
          contentType: upload.contentType,
          sizeBytes: upload.sizeBytes,
          originalName: upload.originalName,
        }
      : undefined,
  };
}

function cleanCanvasTitle(value, canvasId) {
  const fallback = canvasId ? `智能体画布 ${String(canvasId).slice(0, 8)}` : "智能体画布项目";
  return String(value || fallback).trim().slice(0, 120) || fallback;
}

function buildCanvasProjectSourceTaskId(canvasId) {
  return `jaaz-canvas:${String(canvasId || "").trim()}`;
}

function findExistingCanvasProjectAsset(store, projectId, canvasId) {
  const sourceTaskId = buildCanvasProjectSourceTaskId(canvasId);
  return (store.listAssets(projectId) || []).find((asset) => {
    if (asset?.sourceModule !== "agent_studio") return false;
    if (asset?.assetType === "agent_canvas_project" && asset?.sourceTaskId === sourceTaskId) {
      return true;
    }
    const metadata = asset?.sourceMetadata || {};
    return asset?.assetType === "agent_canvas_project" && metadata.canvasId === canvasId;
  });
}

async function syncJaazCanvasProjectToProject({ store, projectId, body }) {
  const canvasId = cleanOptionalString(body?.canvasId);
  if (!canvasId) {
    throw syncError(400, "BAD_REQUEST", "Jaaz canvasId is required");
  }

  const existing = findExistingCanvasProjectAsset(store, projectId, canvasId);
  const title = cleanCanvasTitle(body?.title || existing?.name, canvasId);
  const sessionId = cleanOptionalString(body?.sessionId);
  const sourceTaskId = buildCanvasProjectSourceTaskId(canvasId);
  const editPath =
    `/create/agent-studio?canvasId=${encodeURIComponent(canvasId)}` +
    (sessionId ? `&sessionId=${encodeURIComponent(sessionId)}` : "");

  const previousMetadata =
    existing?.sourceMetadata && typeof existing.sourceMetadata === "object"
      ? existing.sourceMetadata
      : {};
  const sourceMetadata = compactObject({
    ...previousMetadata,
    canvasId,
    sessionId: sessionId || previousMetadata.sessionId,
    canvasUrl: cleanOptionalString(body?.canvasUrl) || previousMetadata.canvasUrl,
    editPath,
    source: cleanOptionalString(body?.source) || previousMetadata.source,
    savedAt: cleanOptionalString(body?.savedAt) || new Date().toISOString(),
  });

  const previewUrl = cleanPreviewUrl(body?.thumbnailUrl) || existing?.previewUrl || null;
  const asset = store.saveProjectAsset(projectId, {
    assetType: "agent_canvas_project",
    name: title,
    description: String(body?.description || existing?.description || "Jaaz 智能体画布可编辑工程").trim(),
    previewUrl,
    mediaKind: "agent_canvas_project",
    mediaUrl: null,
    sourceTaskId,
    sourceModule: "agent_studio",
    sourceMetadata,
    generationPrompt: "",
    referenceImageUrls: [],
    imageStatus: "ready",
    scope: "manual",
  });

  if (!asset) {
    throw syncError(404, "NOT_FOUND", "project not found");
  }

  return asset;
}

module.exports = {
  resolveJaazFilesDir,
  syncJaazAssetToProject,
  syncJaazCanvasProjectToProject,
};
