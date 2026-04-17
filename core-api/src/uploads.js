require("./env").loadEnvFiles();

const { randomUUID } = require("node:crypto");
const { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { basename, extname, resolve } = require("node:path");
const sharp = require("sharp");
const { corsHeaders, readRawBody } = require("./http");

const UPLOAD_DIR = resolve(process.env.CORE_API_UPLOAD_DIR || resolve(__dirname, "..", "uploads"));

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".opus": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

const CONVERTIBLE_IMAGE_EXTENSIONS = new Set([".png", ".webp", ".bmp"]);
const CONVERTIBLE_IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/webp",
  "image/bmp",
  "image/x-ms-bmp",
]);

function ensureUploadDir() {
  mkdirSync(UPLOAD_DIR, { recursive: true });
}

function sanitizeFilename(fileName) {
  const fallback = "upload.bin";
  const normalized = basename(fileName || fallback)
    .replace(/[^\w.\-()\u4e00-\u9fa5]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || fallback;
}

function uploadError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function guessContentType(storedName, fallback = "application/octet-stream") {
  return MIME_BY_EXT[extname(storedName).toLowerCase()] || fallback;
}

function normalizeContentType(contentType) {
  return String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
}

function extensionFromContentType(contentType, fallback = ".bin") {
  const normalizedContentType = normalizeContentType(contentType);
  for (const [extension, mime] of Object.entries(MIME_BY_EXT)) {
    if (mime === normalizedContentType) {
      return extension;
    }
  }
  return fallback;
}

function shouldConvertImageToJpeg(originalName, contentType) {
  const extension = extname(originalName).toLowerCase();
  const normalizedContentType = normalizeContentType(contentType);
  return (
    CONVERTIBLE_IMAGE_EXTENSIONS.has(extension) ||
    CONVERTIBLE_IMAGE_MIME_TYPES.has(normalizedContentType)
  );
}

function resolveEffectiveContentType(originalName, contentType) {
  const normalizedContentType = normalizeContentType(contentType);
  if (!normalizedContentType || normalizedContentType === "application/octet-stream") {
    return guessContentType(originalName, normalizedContentType || undefined);
  }
  return normalizedContentType;
}

async function normalizeUploadPayload({ buffer, originalName, contentType }) {
  const safeOriginalName = sanitizeFilename(originalName);
  const normalizedContentType = resolveEffectiveContentType(safeOriginalName, contentType);
  const originalExtension =
    extname(safeOriginalName).toLowerCase() || extensionFromContentType(normalizedContentType);
  const sourceLooksPng =
    originalExtension === ".png" || normalizeContentType(normalizedContentType) === "image/png";

  if (!shouldConvertImageToJpeg(safeOriginalName, normalizedContentType)) {
    return {
      buffer,
      originalName: safeOriginalName,
      storedExtension: originalExtension || ".bin",
      contentType: normalizedContentType || guessContentType(safeOriginalName),
    };
  }

  let image;
  let metadata;
  try {
    image = sharp(buffer, { failOn: "error" });
    metadata = await image.metadata();
  } catch {
    throw uploadError(
      400,
      "UNSUPPORTED_IMAGE_FILE",
      "Image decoding failed. Please verify the file and try again."
    );
  }

  if (sourceLooksPng && metadata.hasAlpha) {
    throw uploadError(
      400,
      "PNG_ALPHA_NOT_SUPPORTED",
      "Transparent PNG is not supported. Please remove the alpha channel and upload again."
    );
  }

  const convertedBuffer = await image
    .rotate()
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 92, mozjpeg: true })
    .toBuffer();

  return {
    buffer: convertedBuffer,
    originalName: safeOriginalName,
    storedExtension: ".jpg",
    contentType: "image/jpeg",
  };
}

function getPublicUploadUrl(req, urlPath) {
  const publicBaseUrl = String(process.env.CORE_API_PUBLIC_BASE_URL || "")
    .trim()
    .replace(/\/+$/g, "");
  if (publicBaseUrl) {
    return `${publicBaseUrl}${urlPath}`;
  }
  const protocolHeader = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(protocolHeader)
    ? protocolHeader[0]
    : protocolHeader || "http";
  const host = req.headers.host || "localhost:4100";
  return `${protocol}://${host}${urlPath}`;
}

async function createUploadFromRequest(req, kind = "file") {
  ensureUploadDir();

  const rawNameHeader = req.headers["x-upload-filename"];
  const originalName = sanitizeFilename(
    typeof rawNameHeader === "string"
      ? decodeURIComponent(rawNameHeader)
      : `upload-${Date.now()}`
  );
  const body = await readRawBody(req);
  if (!body.length) {
    throw uploadError(400, "BAD_REQUEST", "upload body is empty");
  }

  const normalizedUpload = await normalizeUploadPayload({
    buffer: body,
    originalName,
    contentType: req.headers["content-type"] || undefined,
  });
  const storedName = `${kind}_${Date.now()}_${randomUUID().slice(0, 8)}${normalizedUpload.storedExtension}`;
  const absolutePath = resolve(UPLOAD_DIR, storedName);
  writeFileSync(absolutePath, normalizedUpload.buffer);

  return {
    id: `upload_${randomUUID().slice(0, 8)}`,
    kind,
    originalName: normalizedUpload.originalName,
    storedName,
    sizeBytes: normalizedUpload.buffer.length,
    contentType: normalizedUpload.contentType || guessContentType(storedName),
    urlPath: `/uploads/${storedName}`,
  };
}

async function createUploadFromBuffer({
  buffer,
  kind = "generated",
  originalName = "generated.bin",
  contentType,
}) {
  ensureUploadDir();

  const normalizedUpload = await normalizeUploadPayload({
    buffer,
    originalName,
    contentType,
  });
  const storedName = `${kind}_${Date.now()}_${randomUUID().slice(0, 8)}${normalizedUpload.storedExtension}`;
  const absolutePath = resolve(UPLOAD_DIR, storedName);
  writeFileSync(absolutePath, normalizedUpload.buffer);

  return {
    id: `upload_${randomUUID().slice(0, 8)}`,
    kind,
    originalName: normalizedUpload.originalName,
    storedName,
    sizeBytes: normalizedUpload.buffer.length,
    contentType: normalizedUpload.contentType || guessContentType(storedName),
    urlPath: `/uploads/${storedName}`,
  };
}

function readUpload(fileName) {
  ensureUploadDir();

  const safeName = basename(fileName || "");
  if (!safeName) return null;

  const absolutePath = resolve(UPLOAD_DIR, safeName);
  if (!absolutePath.startsWith(UPLOAD_DIR) || !existsSync(absolutePath)) {
    return null;
  }

  return {
    absolutePath,
    safeName,
    sizeBytes: statSync(absolutePath).size,
    contentType: guessContentType(safeName),
  };
}

function readUploadByUrlPath(urlPath) {
  if (!urlPath || typeof urlPath !== "string") return null;
  if (!urlPath.startsWith("/uploads/")) return null;
  return readUpload(urlPath.slice("/uploads/".length));
}

function sendUpload(res, fileName, req) {
  const upload = readUpload(fileName);
  if (!upload) return false;

  const { absolutePath, sizeBytes, contentType } = upload;
  const commonHeaders = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600",
    ...corsHeaders(),
  };

  const rangeHeader = req?.headers?.range;
  if (rangeHeader) {
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : sizeBytes - 1;
      if (start >= sizeBytes || end >= sizeBytes || start > end) {
        res.writeHead(416, {
          "Content-Range": `bytes */${sizeBytes}`,
          ...corsHeaders(),
        });
        res.end();
        return true;
      }
      const chunkSize = end - start + 1;
      const { createReadStream } = require("node:fs");
      res.writeHead(206, {
        ...commonHeaders,
        "Content-Range": `bytes ${start}-${end}/${sizeBytes}`,
        "Content-Length": chunkSize,
      });
      createReadStream(absolutePath, { start, end }).pipe(res);
      return true;
    }
  }

  const buffer = readFileSync(absolutePath);
  res.writeHead(200, {
    ...commonHeaders,
    "Content-Length": buffer.length,
  });
  res.end(buffer);
  return true;
}

module.exports = {
  createUploadFromRequest,
  createUploadFromBuffer,
  getPublicUploadUrl,
  readUploadByUrlPath,
  sendUpload,
};
