require("./env").loadEnvFiles();

const { randomUUID, createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const { basename, extname } = require("node:path");
const WebSocket = require("ws");
const { createUploadFromBuffer, readUploadByUrlPath } = require("./uploads");

const DEFAULT_BASE_URL = process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com";
const DEFAULT_WS_URL =
  process.env.DASHSCOPE_WS_URL || "wss://dashscope.aliyuncs.com/api-ws/v1/inference";
const DEFAULT_YUNWU_BASE_URL = process.env.YUNWU_BASE_URL || "https://yunwu.ai";
const DEFAULT_PIXVERSE_BASE_URL =
  process.env.PIXVERSE_BASE_URL || "https://app-api.pixverse.ai/openapi/v2";
const VOLCENGINE_ARK_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";
const YUNWU_IMAGE_PROXY_UPLOAD_URL = "https://imageproxy.zhongzhuan.chat/api/upload";
const YUNWU_IMAGE_PROXY_CACHE = new Map();
const YUNWU_IMAGE_MODELS = new Set([
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
  "gemini-2.5-flash-image",
  "kling-v1-5",
  "kling-v2-1",
]);
const YUNWU_GEMINI_IMAGE_MODELS = new Set([
  "gemini-3-pro-image-preview",
  "gemini-3.1-flash-image-preview",
  "gemini-2.5-flash-image",
]);
const YUNWU_KLING_IMAGE_MODELS = new Set([
  "kling-v1-5",
  "kling-v2-1",
]);
const YUNWU_VIDEO_MODELS = new Set([
  "kling-video",
  "kling-omni-video",
  "kling-v3-omni",
  "kling-multi-image2video",
  "kling-multi-elements",
  "veo3.1",
  "veo3.1-pro",
  "veo_3_1-4K",
  "veo_3_1-fast-4K",
  "veo3.1-fast",
  "grok-video-3",
  "veo3.1-components",
  "veo_3_1-components",
  "veo_3_1-components-4K",
  "veo3.1-fast-components",
]);

const SEEDANCE_VIDEO_MODELS = new Set([
  "doubao-seedance-2-0-260128",
  "doubao-seedance-2-0-fast-260128",
]);

const PIXVERSE_VIDEO_MODELS = new Set([
  "pixverse-c1",
  "pixverse-v6",
]);

const SEEDREAM_IMAGE_MODELS = new Set([
  "doubao-seedream-5-0-260128",
]);

// Size map: "${resolution}:${aspectRatio}" => "WxH"
const SEEDREAM_SIZE_MAP = {
  "1K:1:1": "1024x1024", "1K:4:3": "1152x864", "1K:3:4": "864x1152",
  "1K:16:9": "1280x720", "1K:9:16": "720x1280", "1K:3:2": "1248x832",
  "1K:2:3": "832x1248", "1K:21:9": "1512x648",
  "2K:1:1": "2048x2048", "2K:4:3": "2304x1728", "2K:3:4": "1728x2304",
  "2K:16:9": "2848x1600", "2K:9:16": "1600x2848", "2K:3:2": "2496x1664",
  "2K:2:3": "1664x2496", "2K:21:9": "3136x1344",
  "3K:1:1": "3072x3072", "3K:4:3": "3456x2592", "3K:3:4": "2592x3456",
  "3K:16:9": "4096x2304", "3K:9:16": "2304x4096", "3K:3:2": "3744x2496",
  "3K:2:3": "2496x3744", "3K:21:9": "4704x2016",
};

const MODEL_ID_MAP = {
  "Qwen Plus": "qwen-plus",
  "Qwen Max": "qwen-max",
  "Qwen VL Plus": "qwen-vl-plus",
  "Wan 2.6 Image": "wan2.6-image",
  "Wan 2.6 T2I": "wan2.6-t2i",
  "Wan 2.6 T2V": "wan2.6-t2v",
  "Wan 2.6 I2V Flash": "wan2.6-i2v-flash",
  "WanX 2.1 Image Edit": "wanx2.1-imageedit",
  "WanX 2.1 I2V Turbo": "wanx2.1-i2v-turbo",
  "WanX 2.1 I2V Plus": "wanx2.1-i2v-plus",
  "Wan 2.2 KF2V Flash": "wan2.2-kf2v-flash",
  "WanX 2.1 KF2V Plus": "wanx2.1-kf2v-plus",
  "Wan 2.2 S2V Detect": "wan2.2-s2v-detect",
  "Wan 2.2 S2V": "wan2.2-s2v",
  "CosyVoice V3 Flash": "cosyvoice-v3-flash",
  "veo-3.1": "veo3.1",
  "veo3-pro-frames": "pixverse-v6",
  "veo3.1-pro-frames": "pixverse-v6",
  "veo-3.1-pro-frames": "pixverse-v6",
};

function hasAliyunApiKey() {
  return Boolean(process.env.DASHSCOPE_API_KEY);
}

function hasPixverseApiKey() {
  return Boolean(process.env.PIXVERSE_API_KEY);
}

function getPixverseApiKey() {
  return process.env.PIXVERSE_API_KEY || "";
}

function getPixverseBaseUrl() {
  return String(DEFAULT_PIXVERSE_BASE_URL || "https://app-api.pixverse.ai/openapi/v2").replace(/\/+$/, "");
}

function hasVolcengineArkApiKey() {
  return Boolean(process.env.VOLCENGINE_ARK_API_KEY);
}

function getVolcengineArkApiKey() {
  return process.env.VOLCENGINE_ARK_API_KEY || "";
}

function isSeedanceVideoModel(model) {
  return SEEDANCE_VIDEO_MODELS.has(normalizeModelId(model));
}

function isPixverseVideoModel(model) {
  return PIXVERSE_VIDEO_MODELS.has(normalizeModelId(model));
}

function isSeedreamImageModel(model) {
  return SEEDREAM_IMAGE_MODELS.has(normalizeModelId(model));
}

function hasYunwuApiKey() {
  return Boolean(process.env.YUNWU_API_KEY);
}

function hasMediaGenerationApiKey() {
  return hasYunwuApiKey() || hasAliyunApiKey();
}

function normalizeModelId(model) {
  if (!model) return model;
  return MODEL_ID_MAP[model] || model;
}

function isYunwuImageModel(model) {
  return YUNWU_IMAGE_MODELS.has(normalizeModelId(model));
}

function isYunwuGeminiImageModel(model) {
  return YUNWU_GEMINI_IMAGE_MODELS.has(normalizeModelId(model));
}

function isYunwuKlingImageModel(model) {
  return YUNWU_KLING_IMAGE_MODELS.has(normalizeModelId(model));
}

function isYunwuVideoModel(model) {
  return YUNWU_VIDEO_MODELS.has(normalizeModelId(model));
}

function mapPixverseVideoModelName(model) {
  const normalized = normalizeModelId(model);
  if (normalized === "pixverse-c1") return "c1";
  if (normalized === "pixverse-v6") return "v6";
  return normalized;
}

function mapPixverseDuration(duration = "5s") {
  const parsed = mapVideoDuration(duration);
  return Math.max(1, Math.min(15, parsed));
}

function mapPixverseQuality(resolution = "720p") {
  const normalized = String(resolution || "").trim().toLowerCase();
  if (normalized.includes("360")) return "360p";
  if (normalized.includes("540")) return "540p";
  if (normalized.includes("1080")) return "1080p";
  return "720p";
}

function mapPixverseAspectRatio(aspectRatio = "16:9") {
  const normalized = String(aspectRatio || "").trim().toLowerCase();
  const allowed = new Set(["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9", "adaptive"]);
  return allowed.has(normalized) ? normalized : "16:9";
}

function getMediaGenerationProvider(kind, model) {
  const normalizedKind = String(kind || "").trim().toLowerCase();
  const normalizedModel = String(model || "").trim();

  // Vertex models are prefixed with "vertex:" and always route to the Vertex provider.
  // Never fall through to Yunwu/Aliyun for vertex: IDs.
  if (normalizedModel.startsWith("vertex:")) return "vertex";

  if (normalizedKind === "image") {
    if (isSeedreamImageModel(model)) return "ark";
    return isYunwuImageModel(model) ? "yunwu" : "dashscope";
  }
  if (normalizedKind === "video") {
    if (isSeedanceVideoModel(model)) return "ark";
    if (isPixverseVideoModel(model)) return "pixverse";
    return isYunwuVideoModel(model) ? "yunwu" : "dashscope";
  }
  return null;
}

function isMediaGenerationModelConfigured(kind, model) {
  const provider = getMediaGenerationProvider(kind, model);
  if (provider === "vertex") {
    const vertex = require("./vertex");
    if (!vertex.hasVertexCredentials()) return false;
    // Veo video also requires project ID and GCS bucket (both in the REST URL)
    if (String(kind || "").trim().toLowerCase() === "video") {
      return Boolean(vertex.getVertexProjectId()) && Boolean(vertex.getVertexGcsBucket());
    }
    // Gemini image only needs the API key / credentials; project is optional
    return true;
  }
  if (provider === "ark") return hasVolcengineArkApiKey();
  if (provider === "pixverse") return hasPixverseApiKey();
  if (provider === "yunwu") return hasYunwuApiKey();
  if (provider === "dashscope") return hasAliyunApiKey();
  return false;
}

function buildMediaGenerationConfigError(kind, model) {
  const provider = getMediaGenerationProvider(kind, model);
  const normalizedKind = String(kind || "media").trim().toLowerCase() || "media";
  const normalizedModel = normalizeModelId(model || "") || "unknown";

  if (provider === "ark") {
    return providerError(
      `VOLCENGINE_ARK_API_KEY is not configured for ${normalizedKind} generation model ${normalizedModel}. Please add it to core-api/.env.local.`,
      503,
      "PROVIDER_NOT_CONFIGURED",
    );
  }

  if (provider === "vertex") {
    const vertex = require("./vertex");
    const isVideoKind = normalizedKind === "video";
    const missingParts = [];
    if (!vertex.hasVertexCredentials()) missingParts.push("VERTEX_API_KEY");
    if (isVideoKind) {
      if (!vertex.getVertexProjectId()) missingParts.push("VERTEX_PROJECT_ID");
      if (!vertex.getVertexGcsBucket()) missingParts.push("VERTEX_GCS_BUCKET");
    }
    const hint = isVideoKind
      ? "Veo 视频生成需要 VERTEX_PROJECT_ID、VERTEX_GCS_BUCKET 及 VERTEX_API_KEY（或 GOOGLE_APPLICATION_CREDENTIALS）。"
      : "Gemini 图片生成仅需 VERTEX_API_KEY。";
    return providerError(
      `Vertex AI 未配置（${normalizedKind} 模型 ${normalizedModel}）：缺少 ${missingParts.join(", ")}。${hint} 请在 core-api/.env.local 中补充。`,
      503,
      "PROVIDER_NOT_CONFIGURED",
    );
  }

  if (provider === "yunwu") {
    return providerError(
      `YUNWU_API_KEY is not configured for ${normalizedKind} generation model ${normalizedModel}.`,
      503,
      "PROVIDER_NOT_CONFIGURED",
    );
  }

  if (provider === "pixverse") {
    return providerError(
      `PIXVERSE_API_KEY is not configured for ${normalizedKind} generation model ${normalizedModel}. Please add it to core-api/.env.local.`,
      503,
      "PROVIDER_NOT_CONFIGURED",
    );
  }

  return providerError(
    `DASHSCOPE_API_KEY is not configured for ${normalizedKind} generation model ${normalizedModel}.`,
    503,
    "PROVIDER_NOT_CONFIGURED",
  );
}

function assertMediaGenerationModelConfigured(kind, model) {
  const provider = getMediaGenerationProvider(kind, model);
  if (!provider) {
    throw providerError("Unknown media generation provider.", 500, "ALIYUN_PROVIDER_ERROR");
  }
  if (!isMediaGenerationModelConfigured(kind, model)) {
    throw buildMediaGenerationConfigError(kind, model);
  }
  return provider;
}

const VOICE_PRESET_ALIASES = {
  female_story_01: "longanyang",
  female_calm_01: "longanyang",
  male_story_01: "longanyang",
  narrator_01: "longanyang",
};

function normalizeVoicePreset(voicePreset) {
  if (!voicePreset) return "longanyang";
  if (voicePreset.startsWith("long")) return voicePreset;
  return VOICE_PRESET_ALIASES[voicePreset] || "longanyang";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerError(message, statusCode = 502, code = "ALIYUN_PROVIDER_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function getYunwuPayloadError(payload) {
  if (payload != null && payload.code != null) {
    const numericCode = Number(payload.code);
    if (Number.isFinite(numericCode) && numericCode !== 0) {
      return {
        code: payload.code,
        message: payload?.message || payload?.msg || "Yunwu request failed",
      };
    }
  }

  const responseError = payload?.Response?.Error;
  if (responseError) {
    return {
      code: responseError.Code || responseError.code || null,
      message: responseError.Message || responseError.message || null,
    };
  }

  if (typeof payload?.error === "string" && payload.error.trim()) {
    return {
      code: payload?.code || null,
      message: payload.error.trim(),
    };
  }

  if (payload?.error && typeof payload.error === "object") {
    return {
      code: payload.error.code || payload.error.Code || null,
      message: payload.error.message || payload.error.Message || null,
    };
  }

  if (String(payload?.status || "").toLowerCase() === "error") {
    return {
      code: payload?.code || null,
      message: payload?.message || null,
    };
  }

  return null;
}

function isRetryableAliyunFailure(statusCode, message = "") {
  const normalizedMessage = String(message || "").toLowerCase();
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(Number(statusCode))) {
    return true;
  }
  return (
    normalizedMessage.includes("rate limit") ||
    normalizedMessage.includes("throttle") ||
    normalizedMessage.includes("too many requests") ||
    normalizedMessage.includes("temporarily unavailable")
  );
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function isOssUrl(value) {
  return typeof value === "string" && value.startsWith("oss://");
}

function isPublicHttpUrl(value) {
  if (!isHttpUrl(value)) return false;

  try {
    const parsed = new URL(value);
    return !["127.0.0.1", "localhost"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function sanitizeUploadFileName(fileName = "reference.png") {
  return basename(fileName)
    .replace(/[^\w.\-()\u4e00-\u9fa5]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "") || "reference.png";
}

function guessExtensionFromContentType(contentType = "") {
  if (contentType.includes("image/jpeg")) return ".jpg";
  if (contentType.includes("image/webp")) return ".webp";
  if (contentType.includes("image/bmp")) return ".bmp";
  return ".png";
}

function parseDataUrl(value) {
  if (typeof value !== "string" || !value.startsWith("data:")) return null;
  const match = value.match(/^data:([^;,]+)?;base64,(.+)$/);
  if (!match) return null;

  return {
    contentType: match[1] || "application/octet-stream",
    buffer: Buffer.from(match[2], "base64"),
  };
}

const WAN26_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const WAN26_IMAGE_MIN_DIMENSION = 240;
const WAN26_IMAGE_MAX_DIMENSION = 8000;

function detectImageKind(buffer, contentType = "", fileName = "") {
  const normalizedContentType = String(contentType || "").toLowerCase();
  if (normalizedContentType.includes("image/jpeg")) return "jpeg";
  if (normalizedContentType.includes("image/png")) return "png";
  if (normalizedContentType.includes("image/webp")) return "webp";
  if (normalizedContentType.includes("image/bmp")) return "bmp";
  if (normalizedContentType.includes("image/gif")) return "gif";

  const extension = extname(String(fileName || "")).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "jpeg";
  if (extension === ".png") return "png";
  if (extension === ".webp") return "webp";
  if (extension === ".bmp") return "bmp";
  if (extension === ".gif") return "gif";

  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) return "jpeg";
  if (buffer.toString("ascii", 0, 6) === "GIF87a" || buffer.toString("ascii", 0, 6) === "GIF89a") {
    return "gif";
  }
  if (buffer.toString("ascii", 0, 2) === "BM") return "bmp";
  if (
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

function parsePngMetadata(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 33) return null;
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer[25];
  let hasTransparencyChannel = colorType === 4 || colorType === 6;
  let offset = 8;

  while (offset + 12 <= buffer.length) {
    const chunkLength = buffer.readUInt32BE(offset);
    const chunkType = buffer.toString("ascii", offset + 4, offset + 8);
    const nextOffset = offset + 12 + chunkLength;
    if (nextOffset > buffer.length) break;
    if (chunkType === "tRNS") {
      hasTransparencyChannel = true;
      break;
    }
    if (chunkType === "IEND") break;
    offset = nextOffset;
  }

  return {
    width,
    height,
    hasTransparencyChannel,
  };
}

function parseJpegMetadata(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  let offset = 2;

  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd8 || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (marker >= 0xd0 && marker <= 0xd9) {
      offset += 2;
      continue;
    }
    if (offset + 4 > buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset + 2);
    if (segmentLength < 2 || offset + 2 + segmentLength > buffer.length) break;
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (offset + 9 > buffer.length) break;
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
        hasTransparencyChannel: false,
      };
    }
    offset += 2 + segmentLength;
  }

  return null;
}

function readUInt24LE(buffer, offset) {
  if (offset + 3 > buffer.length) return null;
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function parseWebpMetadata(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 30) return null;
  const chunkType = buffer.toString("ascii", 12, 16);

  if (chunkType === "VP8X") {
    const widthMinusOne = readUInt24LE(buffer, 24);
    const heightMinusOne = readUInt24LE(buffer, 27);
    if (widthMinusOne == null || heightMinusOne == null) return null;
    return {
      width: widthMinusOne + 1,
      height: heightMinusOne + 1,
      hasTransparencyChannel: false,
    };
  }

  if (chunkType === "VP8L") {
    if (buffer[20] !== 0x2f || buffer.length < 25) return null;
    const b0 = buffer[21];
    const b1 = buffer[22];
    const b2 = buffer[23];
    const b3 = buffer[24];
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      hasTransparencyChannel: false,
    };
  }

  if (chunkType === "VP8 ") {
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null;
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
      hasTransparencyChannel: false,
    };
  }

  return null;
}

function parseBmpMetadata(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 26) return null;
  const dibHeaderSize = buffer.readUInt32LE(14);
  if (dibHeaderSize === 12) {
    return {
      width: buffer.readUInt16LE(18),
      height: buffer.readUInt16LE(20),
      hasTransparencyChannel: false,
    };
  }
  if (buffer.length < 26) return null;
  return {
    width: Math.abs(buffer.readInt32LE(18)),
    height: Math.abs(buffer.readInt32LE(22)),
    hasTransparencyChannel: false,
  };
}

function parseGifMetadata(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 10) return null;
  return {
    width: buffer.readUInt16LE(6),
    height: buffer.readUInt16LE(8),
    hasTransparencyChannel: false,
  };
}

function readLocalImageMetadata({ buffer, contentType, fileName }) {
  const kind = detectImageKind(buffer, contentType, fileName);
  if (!kind) return null;
  let metadata = null;
  if (kind === "png") metadata = parsePngMetadata(buffer);
  else if (kind === "jpeg") metadata = parseJpegMetadata(buffer);
  else if (kind === "webp") metadata = parseWebpMetadata(buffer);
  else if (kind === "bmp") metadata = parseBmpMetadata(buffer);
  else if (kind === "gif") metadata = parseGifMetadata(buffer);
  return metadata ? { kind, ...metadata } : null;
}

function validateWan26ReferenceSource(source, index) {
  if (!source?.buffer) return;
  const label = `Reference image ${index + 1}`;

  if (source.buffer.length > WAN26_IMAGE_MAX_BYTES) {
    throw providerError(`${label} exceeds the 10MB limit for Wan 2.6 Image.`, 400, "BAD_REQUEST");
  }

  const metadata = readLocalImageMetadata(source);
  if (!metadata?.width || !metadata?.height) {
    throw providerError(
      `${label} must be a JPG/JPEG/PNG/BMP/WEBP file with readable dimensions.`,
      400,
      "BAD_REQUEST"
    );
  }

  if (metadata.kind === "gif") {
    throw providerError(
      `${label} uses GIF format, which Wan 2.6 Image does not support.`,
      400,
      "BAD_REQUEST"
    );
  }

  if (metadata.kind === "png" && metadata.hasTransparencyChannel) {
    throw providerError(
      `${label} is a PNG with transparency, which Wan 2.6 Image does not support.`,
      400,
      "BAD_REQUEST"
    );
  }

  if (
    metadata.width < WAN26_IMAGE_MIN_DIMENSION ||
    metadata.width > WAN26_IMAGE_MAX_DIMENSION ||
    metadata.height < WAN26_IMAGE_MIN_DIMENSION ||
    metadata.height > WAN26_IMAGE_MAX_DIMENSION
  ) {
    throw providerError(
      `${label} dimensions ${metadata.width}x${metadata.height} are outside the supported range 240-8000 px.`,
      400,
      "BAD_REQUEST"
    );
  }
}

function buildWan26ImageContent(prompt, referenceImageUrls) {
  return [{ text: prompt }, ...referenceImageUrls.map((url) => ({ image: url }))];
}

function buildYunwuStartEndVideoPrompt(userPrompt, hasEndFrame) {
  const promptText = String(userPrompt || "").trim();
  return [
    promptText || "Generated video prompt",
    hasEndFrame
      ? "Use image 1 as the starting frame and image 2 as the ending frame. Keep the same subject and scene continuity, and generate a smooth transition from image 1 to image 2."
      : "Use image 1 as the starting frame. Keep the same subject identity, scene, and style while generating natural motion.",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatAliyunErrorMessage(payload, statusCode) {
  const parts = [];
  if (payload?.code) parts.push(String(payload.code));
  if (payload?.message) parts.push(String(payload.message));
  if (payload?.request_id) parts.push(`request_id=${payload.request_id}`);
  return parts.length ? parts.join(" | ") : `Aliyun request failed with ${statusCode}`;
}

function readLocalReferenceSource(value) {
  const dataUrl = parseDataUrl(value);
  if (dataUrl) {
    return {
      buffer: dataUrl.buffer,
      contentType: dataUrl.contentType,
      fileName: `reference${guessExtensionFromContentType(dataUrl.contentType)}`,
    };
  }

  if (typeof value !== "string") return null;

  const uploadPath = value.startsWith("/uploads/")
    ? value
    : (() => {
        try {
          const parsed = new URL(value);
          return parsed.pathname.startsWith("/uploads/") ? parsed.pathname : null;
        } catch {
          return null;
        }
      })();

  if (!uploadPath) return null;

  const upload = readUploadByUrlPath(uploadPath);
  if (!upload) return null;

  return {
    buffer: readFileSync(upload.absolutePath),
    contentType: upload.contentType || "application/octet-stream",
    fileName: upload.safeName || `reference${extname(upload.absolutePath) || ".png"}`,
  };
}

async function loadYunwuVideoReferenceSource(value) {
  const localSource = readLocalReferenceSource(value);
  if (localSource) {
    return localSource;
  }
  return fetchRemoteReferenceSource(value);
}

async function fetchRemoteReferenceSource(value) {
  if (!isHttpUrl(value)) return null;

  let response = null;
  try {
    response = await fetch(value);
  } catch (error) {
    throw providerError(
      `Failed to load remote reference image: ${error?.message || "unknown error"}`,
      400,
      "BAD_REQUEST"
    );
  }

  if (!response.ok) {
    throw providerError(
      `Failed to load remote reference image: HTTP ${response.status}`,
      400,
      "BAD_REQUEST"
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const safePathName = (() => {
    try {
      const parsed = new URL(value);
      return basename(parsed.pathname || "") || "";
    } catch {
      return "";
    }
  })();

  return {
    buffer,
    contentType,
    fileName: safePathName || `reference${guessExtensionFromContentType(contentType)}`,
  };
}

async function loadGeminiReferenceSource(value) {
  const localSource = readLocalReferenceSource(value);
  if (localSource) return localSource;
  return fetchRemoteReferenceSource(value);
}

async function buildYunwuGeminiImageParts({
  prompt,
  negativePrompt,
  referenceImageUrl,
  referenceImageUrls,
}) {
  const mergedPrompt = [
    String(prompt || "").trim() || "Generated image prompt",
    negativePrompt?.trim() ? `Avoid: ${negativePrompt.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const parts = [{ text: mergedPrompt }];
  const referenceList = Array.isArray(referenceImageUrls)
    ? referenceImageUrls.filter(Boolean)
    : [];
  const uniqueReferenceInputs = Array.from(
    new Set(referenceList.length ? referenceList : referenceImageUrl ? [referenceImageUrl] : [])
  );

  for (const value of uniqueReferenceInputs) {
    const source = await loadGeminiReferenceSource(value);
    if (!source?.buffer?.length) {
      throw providerError(
        "Reference image could not be converted to Gemini inline_data input.",
        400,
        "BAD_REQUEST"
      );
    }
    parts.push({
      inline_data: {
        mime_type: source.contentType || "application/octet-stream",
        data: source.buffer.toString("base64"),
      },
    });
  }

  return parts;
}

function buildYunwuImageProxyCacheKey(value, localSource) {
  if (typeof value === "string" && isPublicHttpUrl(value)) {
    return `public:${value.trim()}`;
  }
  if (!localSource?.buffer) {
    return typeof value === "string" ? `raw:${value.slice(0, 256)}` : null;
  }
  const digest = createHash("sha1").update(localSource.buffer).digest("hex");
  return `buffer:${localSource.contentType || "application/octet-stream"}:${digest}`;
}

async function uploadBufferToYunwuImageProxy({ buffer, contentType, fileName }) {
  const apiKey = getYunwuApiKey();
  if (!apiKey) {
    throw providerError("YUNWU_API_KEY is not configured", 503, "PROVIDER_NOT_CONFIGURED");
  }

  const safeFileName = sanitizeUploadFileName(fileName || `reference${guessExtensionFromContentType(contentType)}`);
  const formData = new FormData();
  formData.set(
    "file",
    new Blob([buffer], { type: contentType || "application/octet-stream" }),
    safeFileName
  );

  const response = await fetch(YUNWU_IMAGE_PROXY_UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });
  const raw = await response.text();
  let payload = null;
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { message: raw };
  }

  if (!response.ok) {
    throw providerError(
      payload?.message || `Yunwu image proxy upload failed with ${response.status}`,
      response.status || 502,
      "YUNWU_IMAGE_PROXY_UPLOAD_FAILED"
    );
  }

  const uploadedUrl =
    payload?.url ||
    payload?.data?.url ||
    payload?.image_url ||
    payload?.data?.image_url ||
    payload?.proxy_url ||
    payload?.data?.proxy_url ||
    null;

  if (!uploadedUrl) {
    throw providerError(
      "Yunwu image proxy upload response did not include a URL",
      502,
      "YUNWU_IMAGE_PROXY_EMPTY"
    );
  }

  return uploadedUrl;
}

async function prepareYunwuVideoImageUrl(value) {
  if (!value) return null;
  if (isPublicHttpUrl(value)) return value;

  const localSource = readLocalReferenceSource(value);
  if (!localSource) {
    return value;
  }

  const cacheKey = buildYunwuImageProxyCacheKey(value, localSource);
  if (cacheKey && YUNWU_IMAGE_PROXY_CACHE.has(cacheKey)) {
    return YUNWU_IMAGE_PROXY_CACHE.get(cacheKey);
  }

  const uploadedUrl = await uploadBufferToYunwuImageProxy(localSource);
  if (cacheKey) {
    YUNWU_IMAGE_PROXY_CACHE.set(cacheKey, uploadedUrl);
  }
  return uploadedUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Volcengine Ark / Seedance 2.0
// ─────────────────────────────────────────────────────────────────────────────

async function requestVolcengineArk(path, init = {}) {
  const apiKey = getVolcengineArkApiKey();
  if (!apiKey) {
    throw providerError("VOLCENGINE_ARK_API_KEY is not configured", 503, "PROVIDER_NOT_CONFIGURED");
  }

  const url = `${VOLCENGINE_ARK_BASE_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
    ...(init.headers || {}),
  };
  delete headers["Content-Type"]; // let fetch set it when body is FormData
  if (typeof init.body === "string") {
    headers["Content-Type"] = "application/json";
  }

  const maxAttempts = Number(init.maxAttempts) > 0 ? Number(init.maxAttempts) : 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, headers });
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        let errorBody = null;
        try { errorBody = JSON.parse(errorText); } catch {}
        const errorMessage =
          errorBody?.error?.message ||
          errorBody?.message ||
          errorText ||
          `HTTP ${response.status}`;
        const statusCode = response.status >= 500 ? 502 : response.status;
        const err = providerError(`Volcengine Ark error: ${errorMessage}`, statusCode, "ARK_API_ERROR");
        if (response.status < 500) throw err;
        lastError = err;
        if (attempt < maxAttempts) { await sleep(2000 * attempt); continue; }
        throw err;
      }
      return await response.json();
    } catch (error) {
      if (error?.code === "ARK_API_ERROR" && Number(error?.statusCode) < 500) throw error;
      lastError = error;
      if (attempt < maxAttempts) { await sleep(2000 * attempt); continue; }
    }
  }

  throw lastError || providerError("Volcengine Ark request failed", 502, "ARK_API_ERROR");
}

function mapSeedanceDuration(duration) {
  const parsed = parseInt(String(duration || "").replace(/[^0-9]/g, ""), 10);
  if (Number.isFinite(parsed) && parsed >= 4 && parsed <= 15) return parsed;
  return 5;
}

function mapSeedanceResolution(resolution) {
  const r = String(resolution || "").toLowerCase();
  if (r.includes("720")) return "720p";
  if (r.includes("480")) return "480p";
  return "720p";
}

function mapSeedanceRatio(aspectRatio) {
  const validRatios = ["16:9", "9:16", "4:3", "3:4", "21:9", "1:1", "adaptive"];
  return validRatios.includes(aspectRatio) ? aspectRatio : "16:9";
}

async function prepareSeedanceImageUrl(value) {
  if (!value) return null;
  if (isPublicHttpUrl(value)) return value;
  const localSource = readLocalReferenceSource(value);
  if (!localSource) return null;
  try {
    return await uploadBufferToYunwuImageProxy(localSource);
  } catch {
    return null;
  }
}

async function createSeedanceVideoTask({
  model,
  prompt,
  referenceImageUrl,
  referenceImageUrls,
  firstFrameUrl,
  lastFrameUrl,
  referenceVideoUrls,
  referenceAudioUrls,
  motionReferenceVideoUrl,
  characterReferenceImageUrl,
  aspectRatio,
  resolution,
  duration,
  videoMode,
  editMode,
  generateAudio,
}) {
  const normalizedModel = normalizeModelId(model) || "doubao-seedance-2-0-260128";
  const content = [
    { type: "text", text: String(prompt || "Generated video").trim() || "Generated video" },
  ];

  const isMultiParam = videoMode === "multi_param" && Array.isArray(referenceImageUrls) && referenceImageUrls.length > 0;

  if (isMultiParam) {
    for (const refUrl of referenceImageUrls) {
      const url = String(refUrl || "").trim();
      if (!url) continue;
      const publicUrl = await prepareSeedanceImageUrl(url);
      if (publicUrl) {
        content.push({ type: "image_url", image_url: { url: publicUrl }, role: "reference_image" });
      }
    }
  } else {
    const firstImage = firstFrameUrl || referenceImageUrl;
    if (firstImage) {
      const publicUrl = await prepareSeedanceImageUrl(firstImage);
      if (publicUrl) {
        const role = (videoMode === "start_end_frame" && lastFrameUrl) ? "first_frame" : "first_frame";
        content.push({ type: "image_url", image_url: { url: publicUrl }, role });
      }
    }

    if (lastFrameUrl && videoMode === "start_end_frame") {
      const publicLastUrl = await prepareSeedanceImageUrl(lastFrameUrl);
      if (publicLastUrl) {
        content.push({ type: "image_url", image_url: { url: publicLastUrl }, role: "last_frame" });
      }
    }
  }

  const characterImage = characterReferenceImageUrl && characterReferenceImageUrl !== referenceImageUrl
    ? await prepareSeedanceImageUrl(characterReferenceImageUrl)
    : null;
  if (characterImage) {
    content.push({ type: "image_url", image_url: { url: characterImage }, role: "character_reference" });
  }

  const videoRefs = Array.from(new Set([
    motionReferenceVideoUrl,
    ...(Array.isArray(referenceVideoUrls) ? referenceVideoUrls : []),
  ].map((url) => String(url || "").trim()).filter(Boolean))).slice(0, 3);
  for (const url of videoRefs) {
    content.push({ type: "video_url", video_url: { url }, role: videoMode === "motion_control" ? "motion_reference" : "reference_video" });
  }

  const audioRefs = Array.from(new Set(
    (Array.isArray(referenceAudioUrls) ? referenceAudioUrls : [])
      .map((url) => String(url || "").trim())
      .filter(Boolean)
  )).slice(0, 3);
  for (const url of audioRefs) {
    content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" });
  }

  const hasImageInput = content.some((c) => c.type === "image_url");

  const payload = {
    model: normalizedModel,
    content,
    ratio: mapSeedanceRatio(aspectRatio),
    duration: mapSeedanceDuration(duration),
    watermark: false,
    resolution: mapSeedanceResolution(resolution),
    ...(editMode ? { edit_mode: editMode } : {}),
    ...(typeof generateAudio === 'boolean' ? { generate_audio: generateAudio } : {}),
  };

  const response = await requestVolcengineArk("/contents/generations/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });

  const taskId = response?.id;
  if (!taskId) {
    throw providerError("Seedance task creation failed: no task ID returned", 502, "ARK_API_ERROR");
  }

  return `seedance:${taskId}`;
}

async function waitForSeedanceTask(rawTaskId, options = {}) {
  const providerTaskId = String(rawTaskId).slice("seedance:".length);
  const timeoutMs = options.timeoutMs || 10 * 60 * 1000;
  const intervalMs = options.intervalMs || 10000;
  const startedAt = Date.now();
  let lastTransientError = null;

  while (Date.now() - startedAt < timeoutMs) {
    let payload = null;
    try {
      payload = await requestVolcengineArk(
        `/contents/generations/tasks/${encodeURIComponent(providerTaskId)}`,
        { method: "GET", maxAttempts: 3 }
      );
      lastTransientError = null;
    } catch (error) {
      if (isRetryableYunwuFailure(error?.statusCode, error?.message, error?.cause?.code || error?.code)) {
        lastTransientError = error;
        await sleep(intervalMs);
        continue;
      }
      throw error;
    }

    const status = String(payload?.status || "").trim().toLowerCase();
    if (status === "succeeded") {
      return payload;
    }
    if (["failed", "expired", "cancelled"].includes(status)) {
      const failureDetail = payload?.error?.message || payload?.message || "";
      throw providerError(
        failureDetail
          ? `Seedance task ${providerTaskId} failed: ${status} | ${failureDetail}`
          : `Seedance task ${providerTaskId} failed: ${status}`,
        502,
        "SEEDANCE_TASK_FAILED"
      );
    }
    await sleep(intervalMs);
  }

  const timeoutMessage = lastTransientError?.message
    ? `Seedance task ${providerTaskId} timed out after transient errors: ${lastTransientError.message}`
    : `Seedance task ${providerTaskId} timed out`;
  throw providerError(timeoutMessage, 504, "SEEDANCE_TASK_TIMEOUT");
}

function parseSeedanceVideoResult(payload) {
  return {
    videoUrl: payload?.content?.video_url || null,
    thumbnailUrl: payload?.content?.cover_image_url || null,
  };
}

async function requestAliyun(path, init = {}) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw providerError("DASHSCOPE_API_KEY is not configured", 503, "PROVIDER_NOT_CONFIGURED");
  }
  const maxAttempts = Number(init.maxAttempts) > 0 ? Number(init.maxAttempts) : 4;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(`${DEFAULT_BASE_URL}${path}`, {
        method: init.method || "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          ...(init.headers || {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
      });

      const raw = await response.text();
      let payload = null;

      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        payload = { message: raw };
      }

      if (!response.ok) {
        const message = formatAliyunErrorMessage(payload, response.status);
        console.error("[aliyun] request failed", {
          path,
          status: response.status,
          payload,
        });
        if (attempt < maxAttempts && isRetryableAliyunFailure(response.status, message)) {
          await sleep(Math.min(12000, 1200 * 2 ** (attempt - 1)));
          continue;
        }
        throw providerError(message, response.status || 502, "ALIYUN_API_ERROR");
      }

      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts && isRetryableAliyunFailure(error?.statusCode, error?.message)) {
        await sleep(Math.min(12000, 1200 * 2 ** (attempt - 1)));
        continue;
      }
      throw error;
    }
  }

  throw lastError || providerError("Aliyun request failed");
}

function getYunwuApiKey() {
  return process.env.YUNWU_API_KEY || "";
}

function getYunwuBaseUrl() {
  return String(DEFAULT_YUNWU_BASE_URL || "https://yunwu.ai").replace(/\/+$/, "");
}

function isRetryableYunwuFailure(statusCode, message = "", errorCode = "") {
  const normalizedMessage = String(message || "").toLowerCase();
  const normalizedCode = String(errorCode || "").toLowerCase();
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(Number(statusCode))) {
    return true;
  }
  return (
    normalizedMessage.includes("rate limit") ||
    normalizedMessage.includes("throttle") ||
    normalizedMessage.includes("too many requests") ||
    normalizedMessage.includes("temporarily unavailable") ||
    normalizedMessage.includes("fetch failed") ||
    normalizedMessage.includes("socket hang up") ||
    normalizedMessage.includes("network") ||
    normalizedMessage.includes("disconnected") ||
    normalizedMessage.includes("timed out") ||
    normalizedMessage.includes("tls") ||
    ["econnreset", "etimedout", "econnrefused", "ehostunreach", "enotfound", "und_err_connect_timeout"].includes(
      normalizedCode
    )
  );
}

async function requestYunwu(path, init = {}) {
  const apiKey = getYunwuApiKey();
  if (!apiKey) {
    throw providerError("YUNWU_API_KEY is not configured", 503, "PROVIDER_NOT_CONFIGURED");
  }
  const maxAttempts = Number(init.maxAttempts) > 0 ? Number(init.maxAttempts) : 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const method = String(init.method || "GET").toUpperCase();
      const hasJsonBody = init.body != null && method !== "GET" && method !== "HEAD";
      const isFormDataBody =
        hasJsonBody &&
        typeof FormData !== "undefined" &&
        init.body instanceof FormData;
      const isRawBody =
        hasJsonBody &&
        !isFormDataBody &&
        (typeof init.body === "string" ||
          init.body instanceof Uint8Array ||
          init.body instanceof ArrayBuffer ||
          (typeof Blob !== "undefined" && init.body instanceof Blob));
      const outgoingBody =
        hasJsonBody && !isFormDataBody && !isRawBody && init.body && typeof init.body === "object"
          ? { ...init.body }
          : hasJsonBody
            ? init.body
            : undefined;
      const response = await fetch(`${getYunwuBaseUrl()}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "x-api-key": apiKey,
          ...(hasJsonBody && !isFormDataBody && !isRawBody ? { "Content-Type": "application/json" } : {}),
          ...(init.headers || {}),
        },
        body:
          outgoingBody == null
            ? undefined
            : isFormDataBody || isRawBody
              ? outgoingBody
              : JSON.stringify(outgoingBody),
      });
      const raw = await response.text();
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        payload = { message: raw };
      }
      if (!response.ok) {
        const message = payload?.message || payload?.error?.message || `Yunwu request failed with ${response.status}`;
        if (attempt < maxAttempts && isRetryableYunwuFailure(response.status, message)) {
          await sleep(Math.min(8000, 1000 * 2 ** (attempt - 1)));
          continue;
        }
        throw providerError(message, response.status || 502, "YUNWU_API_ERROR");
      }
      const payloadError = getYunwuPayloadError(payload);
      if (payloadError?.message) {
        const message = [payloadError.code, payloadError.message].filter(Boolean).join(": ");
        if (attempt < maxAttempts && isRetryableYunwuFailure(response.status, message)) {
          await sleep(Math.min(8000, 1000 * 2 ** (attempt - 1)));
          continue;
        }
        throw providerError(message, response.status || 502, "YUNWU_API_ERROR");
      }
      return payload;
    } catch (error) {
      lastError = error;
        if (
          attempt < maxAttempts &&
          isRetryableYunwuFailure(error?.statusCode, error?.message, error?.cause?.code || error?.code)
        ) {
          await sleep(Math.min(8000, 1000 * 2 ** (attempt - 1)));
          continue;
        }
        throw error;
      }
  }

  throw lastError || providerError("Yunwu request failed");
}

function getPixversePayloadError(payload) {
  const errCode = payload?.ErrCode ?? payload?.err_code ?? payload?.code ?? null;
  const errMessage =
    payload?.ErrMsg ||
    payload?.err_msg ||
    payload?.message ||
    payload?.error?.message ||
    null;

  if (errCode != null && String(errCode) !== "0" && String(errCode).toUpperCase() !== "SUCCESS") {
    return {
      code: errCode,
      message: errMessage || "PixVerse request failed",
    };
  }

  if (payload?.error && typeof payload.error === "object") {
    return {
      code: payload.error.code || payload.error.Code || null,
      message: payload.error.message || payload.error.Message || "PixVerse request failed",
    };
  }

  return null;
}

function isRetryablePixverseFailure(statusCode, message = "", errorCode = "") {
  const normalizedMessage = String(message || "").toLowerCase();
  const normalizedCode = String(errorCode || "").toLowerCase();
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(Number(statusCode))) {
    return true;
  }
  return (
    normalizedMessage.includes("rate limit") ||
    normalizedMessage.includes("too many requests") ||
    normalizedMessage.includes("temporarily unavailable") ||
    normalizedMessage.includes("timed out") ||
    normalizedMessage.includes("network") ||
    normalizedMessage.includes("fetch failed") ||
    normalizedMessage.includes("socket hang up") ||
    ["econnreset", "etimedout", "econnrefused", "ehostunreach", "enotfound", "und_err_connect_timeout"].includes(
      normalizedCode
    )
  );
}

async function requestPixverse(path, init = {}) {
  const apiKey = getPixverseApiKey();
  if (!apiKey) {
    throw providerError("PIXVERSE_API_KEY is not configured", 503, "PROVIDER_NOT_CONFIGURED");
  }

  const maxAttempts = Number(init.maxAttempts) > 0 ? Number(init.maxAttempts) : 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const method = String(init.method || "GET").toUpperCase();
      const hasBody = init.body != null && method !== "GET" && method !== "HEAD";
      const isFormDataBody =
        hasBody &&
        typeof FormData !== "undefined" &&
        init.body instanceof FormData;
      const isRawBody =
        hasBody &&
        !isFormDataBody &&
        (typeof init.body === "string" ||
          init.body instanceof Uint8Array ||
          init.body instanceof ArrayBuffer ||
          (typeof Blob !== "undefined" && init.body instanceof Blob));
      const outgoingBody =
        hasBody && !isFormDataBody && !isRawBody && init.body && typeof init.body === "object"
          ? { ...init.body }
          : hasBody
            ? init.body
            : undefined;

      const response = await fetch(`${getPixverseBaseUrl()}${path}`, {
        method,
        headers: {
          "API-KEY": apiKey,
          "Ai-trace-id": randomUUID(),
          ...(hasBody && !isFormDataBody && !isRawBody ? { "Content-Type": "application/json" } : {}),
          ...(init.headers || {}),
        },
        body:
          outgoingBody == null
            ? undefined
            : isFormDataBody || isRawBody
              ? outgoingBody
              : JSON.stringify(outgoingBody),
      });

      const raw = await response.text();
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : {};
      } catch {
        payload = { message: raw };
      }

      if (!response.ok) {
        const message =
          payload?.ErrMsg ||
          payload?.message ||
          payload?.error?.message ||
          `PixVerse request failed with ${response.status}`;
        if (attempt < maxAttempts && isRetryablePixverseFailure(response.status, message)) {
          await sleep(Math.min(12000, 1200 * 2 ** (attempt - 1)));
          continue;
        }
        throw providerError(message, response.status || 502, "PIXVERSE_API_ERROR");
      }

      const payloadError = getPixversePayloadError(payload);
      if (payloadError?.message) {
        const message = [payloadError.code, payloadError.message].filter(Boolean).join(": ");
        if (attempt < maxAttempts && isRetryablePixverseFailure(response.status, message)) {
          await sleep(Math.min(12000, 1200 * 2 ** (attempt - 1)));
          continue;
        }
        throw providerError(message, response.status || 502, "PIXVERSE_API_ERROR");
      }

      return payload;
    } catch (error) {
      lastError = error;
      if (
        attempt < maxAttempts &&
        isRetryablePixverseFailure(error?.statusCode, error?.message, error?.cause?.code || error?.code)
      ) {
        await sleep(Math.min(12000, 1200 * 2 ** (attempt - 1)));
        continue;
      }
      throw error;
    }
  }

  throw lastError || providerError("PixVerse request failed", 502, "PIXVERSE_API_ERROR");
}

async function uploadImageToPixverse(value) {
  const source = readLocalReferenceSource(value) || (await fetchRemoteReferenceSource(value));
  if (!source?.buffer) {
    throw providerError("PixVerse image upload requires a readable local or remote image source", 400, "MISSING_REFERENCE_IMAGE");
  }

  const form = new FormData();
  const blob = new Blob([source.buffer], {
    type: source.contentType || "application/octet-stream",
  });
  form.append(
    "image",
    blob,
    source.fileName || `reference${guessExtensionFromContentType(source.contentType)}`
  );

  const payload = await requestPixverse("/image/upload", {
    method: "POST",
    body: form,
    maxAttempts: 1,
  });

  const resp = payload?.Resp || payload?.resp || {};
  const imgId = resp?.img_id ?? resp?.imgId ?? null;
  if (!imgId) {
    throw providerError("PixVerse image upload did not return img_id", 502, "PIXVERSE_UPLOAD_EMPTY");
  }
  return {
    imgId,
    imgUrl: resp?.img_url || resp?.imgUrl || null,
  };
}

async function uploadVideoToPixverse(value) {
  const source = readLocalReferenceSource(value) || (await fetchRemoteReferenceSource(value));
  if (!source?.buffer) {
    throw providerError("PixVerse video upload requires a readable local or remote video source", 400, "MISSING_REFERENCE_VIDEO");
  }

  const form = new FormData();
  const blob = new Blob([source.buffer], {
    type: source.contentType || "application/octet-stream",
  });
  form.append(
    "video",
    blob,
    source.fileName || `reference${guessExtensionFromContentType(source.contentType)}`
  );

  const payload = await requestPixverse("/video/upload", {
    method: "POST",
    body: form,
    maxAttempts: 1,
  });

  const resp = payload?.Resp || payload?.resp || payload?.data || payload || {};
  const videoId =
    resp?.video_id ??
    resp?.videoId ??
    resp?.media_id ??
    resp?.mediaId ??
    resp?.id ??
    null;
  if (!videoId) {
    throw providerError("PixVerse video upload did not return video_id", 502, "PIXVERSE_VIDEO_UPLOAD_EMPTY");
  }
  return {
    videoId,
    videoUrl: resp?.video_url || resp?.videoUrl || resp?.url || null,
  };
}

function buildPixverseFusionReferences(multiReferenceImages, maxReferenceImages = 3) {
  const refs = [];
  const roleCounts = {};
  for (const [slot, urls] of Object.entries(multiReferenceImages || {})) {
    if (!Array.isArray(urls)) continue;
    for (const rawUrl of urls) {
      const value = String(rawUrl || "").trim();
      if (!value) continue;
      const normalizedSlot = String(slot || "").trim().toLowerCase();
      const type = normalizedSlot === "scene" ? "background" : "subject";
      roleCounts[normalizedSlot] = (roleCounts[normalizedSlot] || 0) + 1;
      refs.push({
        slot: normalizedSlot,
        type,
        refName: `${normalizedSlot}_${roleCounts[normalizedSlot]}`,
        sourceUrl: value,
      });
    }
  }

  if (refs.length > maxReferenceImages) {
    throw providerError(
      `PixVerse Fusion currently allows at most ${maxReferenceImages} reference images, but received ${refs.length}.`,
      400,
      "PIXVERSE_REFERENCE_LIMIT"
    );
  }
  return refs;
}

function buildPixverseFusionPrompt(prompt, refs) {
  const basePrompt = String(prompt || "").trim();
  const injectedRefs = refs.map((item) => `@${item.refName}`).join(" ");
  if (!injectedRefs) return basePrompt || "Generate a video";
  if (!basePrompt) return `${injectedRefs} animate together`;
  const missing = refs.filter((item) => !basePrompt.includes(`@${item.refName}`)).map((item) => `@${item.refName}`);
  return missing.length ? `${missing.join(" ")} ${basePrompt}` : basePrompt;
}

async function createPixverseVideoTask({
  model,
  prompt,
  referenceImageUrl,
  firstFrameUrl,
  lastFrameUrl,
  aspectRatio,
  resolution,
  duration,
  videoMode,
  multiReferenceImages,
  generateAudio,
  referenceVideoUrl,
  referenceVideoUrls,
  motionReferenceVideoUrl,
  characterReferenceImageUrl,
  editMode,
  editPresetId,
  qualityMode,
}) {
  const normalizedModel = mapPixverseVideoModelName(model);
  const normalizedVideoMode = String(videoMode || "").trim().toLowerCase();
  const quality = mapPixverseQuality(resolution);
  const normalizedDuration = mapPixverseDuration(duration);
  const normalizedAspectRatio = mapPixverseAspectRatio(aspectRatio);
  const payloadBase = {
    model: normalizedModel,
    prompt: String(prompt || "").trim() || "Generate a video",
    duration: normalizedDuration,
    quality,
    ...(generateAudio != null ? { generate_audio_switch: !!generateAudio } : {}),
  };

  if (normalizedVideoMode === "text_to_video") {
    const payload = await requestPixverse("/video/text/generate", {
      method: "POST",
      body: {
        ...payloadBase,
        aspect_ratio: normalizedAspectRatio === "adaptive" ? "16:9" : normalizedAspectRatio,
      },
      maxAttempts: 1,
    });
    const videoId = payload?.Resp?.video_id ?? payload?.resp?.video_id ?? null;
    if (!videoId) throw providerError("PixVerse text-to-video did not return video_id", 502, "PIXVERSE_VIDEO_EMPTY");
    return `pixverse:${videoId}`;
  }

  if (normalizedVideoMode === "image_to_video") {
    if (!referenceImageUrl) {
      throw providerError("PixVerse image-to-video requires a reference image", 400, "MISSING_REFERENCE_IMAGE");
    }
    const { imgId } = await uploadImageToPixverse(referenceImageUrl);
    const payload = await requestPixverse("/video/img/generate", {
      method: "POST",
      body: {
        ...payloadBase,
        img_id: imgId,
      },
      maxAttempts: 1,
    });
    const videoId = payload?.Resp?.video_id ?? payload?.resp?.video_id ?? null;
    if (!videoId) throw providerError("PixVerse image-to-video did not return video_id", 502, "PIXVERSE_VIDEO_EMPTY");
    return `pixverse:${videoId}`;
  }

  if (normalizedVideoMode === "start_end_frame") {
    if (!firstFrameUrl || !lastFrameUrl) {
      throw providerError("PixVerse start_end_frame requires both first and last frame", 400, "MISSING_START_END_FRAME");
    }
    const [{ imgId: firstImgId }, { imgId: lastImgId }] = await Promise.all([
      uploadImageToPixverse(firstFrameUrl),
      uploadImageToPixverse(lastFrameUrl),
    ]);
    const payload = await requestPixverse("/video/transition/generate", {
      method: "POST",
      body: {
        ...payloadBase,
        first_frame_img: firstImgId,
        last_frame_img: lastImgId,
      },
      maxAttempts: 1,
    });
    const videoId = payload?.Resp?.video_id ?? payload?.resp?.video_id ?? null;
    if (!videoId) throw providerError("PixVerse transition did not return video_id", 502, "PIXVERSE_VIDEO_EMPTY");
    return `pixverse:${videoId}`;
  }

  if (normalizedVideoMode === "multi_param") {
    if (normalizedModel !== "c1") {
      throw providerError("Only pixverse-c1 supports Fusion / multi_param in phase 1", 400, "PIXVERSE_FUSION_UNSUPPORTED");
    }
    const refs = buildPixverseFusionReferences(multiReferenceImages, 3);
    if (!refs.length) {
      throw providerError("PixVerse Fusion requires reference images", 400, "MISSING_REFERENCE_IMAGE");
    }
    const uploadedRefs = [];
    for (const ref of refs) {
      const uploaded = await uploadImageToPixverse(ref.sourceUrl);
      uploadedRefs.push({
        type: ref.type,
        img_id: uploaded.imgId,
        ref_name: ref.refName,
      });
    }

    const payload = await requestPixverse("/video/fusion/generate", {
      method: "POST",
      body: {
        ...payloadBase,
        image_references: uploadedRefs,
        prompt: buildPixverseFusionPrompt(prompt, refs),
        aspect_ratio: normalizedAspectRatio === "adaptive" ? "16:9" : normalizedAspectRatio,
      },
      maxAttempts: 1,
    });
    const videoId = payload?.Resp?.video_id ?? payload?.resp?.video_id ?? null;
    if (!videoId) throw providerError("PixVerse fusion did not return video_id", 502, "PIXVERSE_VIDEO_EMPTY");
    return `pixverse:${videoId}`;
  }

  if (normalizedVideoMode === "motion_control") {
    const sourceVideoUrl = motionReferenceVideoUrl || referenceVideoUrl || (Array.isArray(referenceVideoUrls) ? referenceVideoUrls[0] : null);
    if (!sourceVideoUrl) {
      throw providerError("PixVerse mimic requires a motion reference video", 400, "MISSING_REFERENCE_VIDEO");
    }
    if (!characterReferenceImageUrl) {
      throw providerError("PixVerse mimic requires a character reference image", 400, "MISSING_REFERENCE_IMAGE");
    }
    const [{ videoId }, { imgId }] = await Promise.all([
      uploadVideoToPixverse(sourceVideoUrl),
      uploadImageToPixverse(characterReferenceImageUrl),
    ]);
    const payload = await requestPixverse("/video/mimic/generate", {
      method: "POST",
      body: {
        ...payloadBase,
        video_id: videoId,
        img_id: imgId,
        mode: String(qualityMode || "std").trim().toLowerCase() === "pro" ? "pro" : "std",
      },
      maxAttempts: 1,
    });
    const outputVideoId = payload?.Resp?.video_id ?? payload?.resp?.video_id ?? null;
    if (!outputVideoId) throw providerError("PixVerse mimic did not return video_id", 502, "PIXVERSE_VIDEO_EMPTY");
    return `pixverse:${outputVideoId}`;
  }

  if (normalizedVideoMode === "video_edit") {
    const sourceVideoUrl = referenceVideoUrl || (Array.isArray(referenceVideoUrls) ? referenceVideoUrls[0] : null);
    if (!sourceVideoUrl) {
      throw providerError("PixVerse video edit requires a reference video", 400, "MISSING_REFERENCE_VIDEO");
    }
    const { videoId } = await uploadVideoToPixverse(sourceVideoUrl);
    const normalizedEditMode = String(editMode || (editPresetId ? "restyle" : "modify")).trim().toLowerCase();
    const path = normalizedEditMode === "restyle" ? "/video/restyle/generate" : "/video/modify/generate";
    const body = normalizedEditMode === "restyle"
      ? {
          ...payloadBase,
          video_id: videoId,
          ...(editPresetId ? { effect_id: editPresetId, style_id: editPresetId } : {}),
        }
      : {
          ...payloadBase,
          video_id: videoId,
        };
    const payload = await requestPixverse(path, {
      method: "POST",
      body,
      maxAttempts: 1,
    });
    const outputVideoId = payload?.Resp?.video_id ?? payload?.resp?.video_id ?? null;
    if (!outputVideoId) throw providerError("PixVerse video edit did not return video_id", 502, "PIXVERSE_VIDEO_EMPTY");
    return `pixverse:${outputVideoId}`;
  }

  if (normalizedVideoMode === "video_extend") {
    const sourceVideoUrl = referenceVideoUrl || (Array.isArray(referenceVideoUrls) ? referenceVideoUrls[0] : null);
    if (!sourceVideoUrl) {
      throw providerError("PixVerse extend requires a reference video", 400, "MISSING_REFERENCE_VIDEO");
    }
    const { videoId } = await uploadVideoToPixverse(sourceVideoUrl);
    const payload = await requestPixverse("/video/extend/generate", {
      method: "POST",
      body: {
        ...payloadBase,
        video_id: videoId,
      },
      maxAttempts: 1,
    });
    const outputVideoId = payload?.Resp?.video_id ?? payload?.resp?.video_id ?? null;
    if (!outputVideoId) throw providerError("PixVerse extend did not return video_id", 502, "PIXVERSE_VIDEO_EMPTY");
    return `pixverse:${outputVideoId}`;
  }

  throw providerError(`Unsupported PixVerse video mode: ${normalizedVideoMode}`, 400, "PIXVERSE_UNSUPPORTED_MODE");
}

function parsePixverseVideoResult(payload) {
  const resp = payload?.Resp || payload?.resp || payload || {};
  const width = Number(resp?.outputWidth || 0);
  const height = Number(resp?.outputHeight || 0);
  const longer = Math.max(width, height);
  const outputResolution =
    longer >= 1900 ? "1080p" :
    longer >= 1200 ? "720p" :
    longer >= 900 ? "540p" :
    longer >= 600 ? "360p" :
    longer > 0 ? `${width}x${height}` : null;
  const knownRatios = [
    { label: "16:9", value: 16 / 9 },
    { label: "4:3", value: 4 / 3 },
    { label: "1:1", value: 1 },
    { label: "3:4", value: 3 / 4 },
    { label: "9:16", value: 9 / 16 },
    { label: "2:3", value: 2 / 3 },
    { label: "3:2", value: 3 / 2 },
    { label: "21:9", value: 21 / 9 },
  ];
  let outputAspectRatio = null;
  if (width > 0 && height > 0) {
    const ratio = width / height;
    let best = null;
    let dist = Infinity;
    for (const item of knownRatios) {
      const d = Math.abs(ratio - item.value);
      if (d < dist) {
        dist = d;
        best = item.label;
      }
    }
    outputAspectRatio = best && dist <= 0.06 ? best : `${width}:${height}`;
  }

  const rawDuration =
    resp?.duration ??
    resp?.video_duration ??
    resp?.videoDuration ??
    resp?.outputDuration ??
    null;
  const parsedDurationSeconds = Number(rawDuration);
  const durationSeconds =
    Number.isFinite(parsedDurationSeconds) && parsedDurationSeconds > 0
      ? parsedDurationSeconds
      : null;

  return {
    videoUrl: resp?.url || null,
    thumbnailUrl: null,
    durationSeconds,
    outputDuration: durationSeconds ? `${durationSeconds}s` : null,
    outputAspectRatio,
    outputResolution,
  };
}

async function testYunwuConnection() {
  if (!getYunwuApiKey()) {
    throw providerError("YUNWU_API_KEY is not configured", 503, "PROVIDER_NOT_CONFIGURED");
  }
  const payload = await requestYunwu("/v1/models", { method: "GET" });
  const models =
    Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.models) ? payload.models : [];
  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    modelCount: models.length,
    provider: "yunwu",
  };
}

async function testAliyunConnection(apiKey = process.env.DASHSCOPE_API_KEY) {
  if (getYunwuApiKey()) {
    return testYunwuConnection();
  }
  if (!apiKey) {
    throw providerError("DASHSCOPE_API_KEY is not configured", 503, "PROVIDER_NOT_CONFIGURED");
  }

  const response = await fetch(`${DEFAULT_BASE_URL}/compatible-mode/v1/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  const raw = await response.text();
  let payload = null;

  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { message: raw };
  }

  if (!response.ok) {
    throw providerError(
      payload?.message || payload?.code || `Aliyun request failed with ${response.status}`,
      502,
      "ALIYUN_API_ERROR",
    );
  }

  return {
    ok: true,
    checkedAt: new Date().toISOString(),
    modelCount: Array.isArray(payload?.data) ? payload.data.length : 0,
  };
}

async function uploadBufferToAliyunOss({ buffer, contentType, fileName, model }) {
  const policyPayload = await requestAliyun(
    `/api/v1/uploads?action=getPolicy&model=${encodeURIComponent(normalizeModelId(model))}`
  );
  const policy = policyPayload?.data || policyPayload;

  if (!policy?.upload_host || !policy?.upload_dir || !policy?.oss_access_key_id) {
    throw providerError("Aliyun upload policy is incomplete");
  }

  const safeFileName = sanitizeUploadFileName(fileName);
  const key = `${policy.upload_dir}/${safeFileName}`;
  const formData = new FormData();
  formData.set("OSSAccessKeyId", policy.oss_access_key_id);
  formData.set("Signature", policy.signature);
  formData.set("policy", policy.policy);
  formData.set("x-oss-object-acl", policy.x_oss_object_acl);
  formData.set("x-oss-forbid-overwrite", policy.x_oss_forbid_overwrite);
  formData.set("key", key);
  formData.set("success_action_status", "200");
  formData.set(
    "file",
    new Blob([buffer], { type: contentType || "application/octet-stream" }),
    safeFileName
  );

  const response = await fetch(policy.upload_host, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    throw providerError(`Aliyun temporary OSS upload failed with ${response.status}`);
  }

  return `oss://${key}`;
}

async function prepareAliyunImageUrl(value, model) {
  if (!value) return null;
  if (isOssUrl(value) || isPublicHttpUrl(value) || parseDataUrl(value)) return value;

  const localSource = readLocalReferenceSource(value);
  if (!localSource) {
    throw providerError("Reference image is not accessible for Aliyun image editing", 400);
  }

  return `data:${localSource.contentType};base64,${localSource.buffer.toString("base64")}`;
}

function parseTextResponse(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) {
    return content.trim();
  }

  throw providerError("Aliyun text response is empty");
}

async function generateTextWithAliyun({
  messages,
  model = "qwen-plus",
  temperature = 0.2,
  max_tokens = 4096,
}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw providerError("messages array is required", 400, "BAD_REQUEST");
  }

  const payload = await requestAliyun("/compatible-mode/v1/chat/completions", {
    method: "POST",
    body: {
      model: normalizeModelId(model),
      temperature,
      max_tokens,
      messages: messages.map((message) => ({
        role: message?.role || "user",
        content: String(message?.content || ""),
      })),
    },
  });

  return parseTextResponse(payload);
}

async function summarizeReferenceImagesWithAliyun({
  referenceImageUrls,
  userPrompt = "",
  model = "qwen-vl-plus",
}) {
  const preparedReferenceList = await Promise.all(
    (Array.isArray(referenceImageUrls) ? referenceImageUrls : [])
      .filter(Boolean)
      .slice(0, 4)
      .map((url) => prepareAliyunImageUrl(url, model))
  );

  if (!preparedReferenceList.length) {
    return "";
  }

  const content = [
    {
      type: "text",
      text: [
        "Analyze this reference set for image generation.",
        "Reference image 1 is the primary identity anchor.",
        "References 2-4 are supporting images for outfit, props, scene, palette, composition, and style.",
        "Return one compact plain-text brief only.",
        "Focus on the exact traits the generator must preserve so the output stays visually close to the references.",
        "Mention identity, face, hair, outfit, props, environment, lighting, color palette, framing, and style.",
        "When the references conflict, prioritize image 1 for identity and keep the dominant shared traits.",
        "Keep the brief under 180 words.",
        userPrompt ? `User prompt: ${String(userPrompt).trim()}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  preparedReferenceList.forEach((url, index) => {
    content.push({
      type: "text",
      text: `Reference image ${index + 1}`,
    });
    content.push({
      type: "image_url",
      image_url: { url },
    });
  });

  const payload = await requestAliyun("/compatible-mode/v1/chat/completions", {
    method: "POST",
    body: {
      model: normalizeModelId(model),
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content,
        },
      ],
    },
  });

  return parseTextResponse(payload);
}

function extractJsonBlock(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch?.[0]) {
    return arrayMatch[0];
  }

  const objectMatch = text.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) {
    return objectMatch[0];
  }

  return text;
}

function normalizeExtractedAssets(rawItems) {
  if (!Array.isArray(rawItems)) return [];

  const allowedTypes = new Set(["character", "scene", "prop"]);
  const seen = new Set();
  const normalized = [];

  for (const item of rawItems) {
    const assetType = String(item?.assetType || "").trim().toLowerCase();
    const name = String(item?.name || "").trim();
    if (!allowedTypes.has(assetType) || !name) continue;

    const dedupeKey = `${assetType}:${name}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    normalized.push({
      assetType,
      name,
      description: String(item?.description || "").trim(),
      generationPrompt: String(item?.generationPrompt || "").trim(),
      imageModel: String(item?.imageModel || "").trim(),
      aspectRatio: String(item?.aspectRatio || "").trim(),
      negativePrompt: String(item?.negativePrompt || "").trim(),
    });
  }

  return normalized;
}

function normalizeStoryboardShots(rawItems) {
  if (!Array.isArray(rawItems)) return [];

  const allowedShotTypes = new Set(["特写", "近景", "中景", "远景"]);
  const allowedCompositions = new Set(["居中构图", "对角线构图", "前景遮挡", "留白构图"]);
  const allowedFocalLengths = new Set(["24mm", "35mm", "50mm", "85mm"]);
  const allowedColorTones = new Set(["暖色", "冷色", "霓虹", "低饱和"]);
  const allowedLightings = new Set(["柔光", "逆光", "雨夜霓虹", "顶光"]);
  const allowedTechniques = new Set(["手持感", "电影感", "写实摄影", "浅景深"]);
  const normalized = [];

  for (const [index, item] of rawItems.entries()) {
    const script = String(item?.script || item?.action || item?.description || "")
      .replace(/\s+/g, " ")
      .replace(/^△\s*/g, "")
      .trim();
    if (!script) continue;

    // Support both integer (legacy) and float (expert mode) durations
    const rawDuration = item?.durationSeconds || item?.duration;
    const durationFloat = parseFloat(String(rawDuration || "").replace(/[^\d.]/g, ""));
    const durationSeconds = Number.isFinite(durationFloat) && durationFloat > 0
      ? Math.round(Math.min(15, Math.max(1, durationFloat)) * 10) / 10
      : 4;

    const assetNames = Array.isArray(item?.assetNames)
      ? item.assetNames
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      : Array.isArray(item?.characters)
        ? item.characters.map((v) => String(v || "").trim()).filter(Boolean)
        : [];

    normalized.push({
      title: String(item?.title || "").trim() || `镜头 ${index + 1}`,
      script,
      durationSeconds,
      promptSummary:
        String(item?.promptSummary || item?.visualSummary || "").trim() || script.slice(0, 32),
      // Expert-mode extended fields (stored but not required by base schema)
      partNo: typeof item?.partNo === "number" ? item.partNo : null,
      partTitle: String(item?.partTitle || "").trim() || null,
      weather: String(item?.weather || "").trim() || null,
      camera: String(item?.camera || "").trim() || null,
      blocking: String(item?.blocking || "").trim() || null,
      // Legacy classification fields
      shotType: allowedShotTypes.has(String(item?.shotType || "").trim())
        ? String(item.shotType).trim()
        : "",
      composition: allowedCompositions.has(String(item?.composition || "").trim())
        ? String(item.composition).trim()
        : "",
      focalLength: allowedFocalLengths.has(String(item?.focalLength || "").trim())
        ? String(item.focalLength).trim()
        : "",
      colorTone: allowedColorTones.has(String(item?.colorTone || "").trim())
        ? String(item.colorTone).trim()
        : "",
      lighting: allowedLightings.has(String(item?.lighting || "").trim())
        ? String(item.lighting).trim()
        : "",
      technique: allowedTechniques.has(String(item?.technique || "").trim())
        ? String(item.technique).trim()
        : "",
      assetNames,
    });
  }

  return normalized;
}

async function translateTextWithAliyun({ text, targetLang = "en", model = "qwen-plus" }) {
  const systemPrompt = targetLang === "zh"
    ? "你是专业翻译。请将输入的英文文本翻译为流畅自然的中文。只输出翻译结果，不要加任何前缀、括号或解释。"
    : "You are a professional translator. Translate the input Chinese text into fluent English. Output the translation only, with no prefix, parentheses, or explanation.";
  const userPrompt = targetLang === "zh"
    ? `请将以下英文翻译为中文：\n\n${text}`
    : `Please translate the following Chinese text to English:\n\n${text}`;

  const payload = await requestAliyun("/compatible-mode/v1/chat/completions", {
    method: "POST",
    body: {
      model: normalizeModelId(model),
      temperature: 0.3,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    },
  });
  return parseTextResponse(payload);
}

async function rewriteScriptWithAliyun({ content, instruction, model = "qwen-plus" }) {
  const payload = await requestAliyun("/compatible-mode/v1/chat/completions", {
    method: "POST",
    body: {
      model: normalizeModelId(model),
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content:
            "你是漫剧编剧助理。请严格根据用户要求改写原剧本，只输出改写后的完整中文剧本文本，不要解释。",
        },
        {
          role: "user",
          content: `改写要求：${instruction}\n\n原剧本：\n${content}`,
        },
      ],
    },
  });

  return parseTextResponse(payload);
}

async function extractAssetsWithAliyun({ content, model = "qwen-plus" }) {
  const payload = await requestAliyun("/compatible-mode/v1/chat/completions", {
    method: "POST",
    body: {
      model: normalizeModelId(model),
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            [
              "You extract production assets from screenplay text.",
              "Return a strict JSON array only. Do not include markdown or explanations.",
              'Each item must contain these keys: "assetType", "name", "description", "generationPrompt".',
              'assetType must be exactly one of: "character", "scene", "prop".',
              "Only include assets explicitly mentioned in the text. Never invent people, places, or props.",
              "description must be a short factual Chinese description, not plot expansion.",
              "generationPrompt must be a concise Chinese image prompt for generating a clean concept sheet of this exact asset.",
            ].join(" "),
        },
        {
          role: "user",
          content:
            [
              "Extract up to 12 useful assets from the following screenplay text.",
              "Rules:",
              "1. Keep names as they appear in the text, or apply only the minimum necessary normalization.",
              "2. Do not output generic implied objects that are not explicitly present in the text.",
              "3. generationPrompt should focus on a single asset design image suitable for comic production.",
              "4. Return JSON only.",
              "",
              "Text:",
              content,
            ].join("\n"),
        },
      ],
    },
  });

  const text = parseTextResponse(payload);
  const jsonBlock = extractJsonBlock(text);
  const parsed = JSON.parse(jsonBlock);
  if (!Array.isArray(parsed)) {
    throw providerError("Aliyun asset extraction did not return an array");
  }
  return normalizeExtractedAssets(parsed);
}

const DEFAULT_STORYBOARD_SYSTEM_PROMPT = [
  "You split screenplay text into production-ready storyboard shots.",
  "Return a strict JSON array only. Do not include markdown or explanations.",
  'Each item must contain these keys: "title", "script", "durationSeconds", "promptSummary", "shotType", "composition", "focalLength", "colorTone", "lighting", "technique", "assetNames".',
  'shotType must be exactly one of: "特写", "近景", "中景", "远景".',
  'composition must be exactly one of: "居中构图", "对角线构图", "前景遮挡", "留白构图".',
  'focalLength must be exactly one of: "24mm", "35mm", "50mm", "85mm".',
  'colorTone must be exactly one of: "暖色", "冷色", "霓虹", "低饱和".',
  'lighting must be exactly one of: "柔光", "逆光", "雨夜霓虹", "顶光".',
  'technique must be exactly one of: "手持感", "电影感", "写实摄影", "浅景深".',
  "title, script, and promptSummary must be concise Chinese text.",
  "script must describe exactly one visual beat in chronological order and stay faithful to the source screenplay.",
  "durationSeconds must be a number between 1 and 15, precise to one decimal place.",
  "assetNames must be a JSON array of exact names explicitly appearing in the screenplay when obvious, otherwise [].",
].join(" ");

const DEFAULT_STORYBOARD_USER_PREFIX = [
  "Split the following screenplay into 4 to 12 storyboard shots for comic production.",
  "Rules:",
  "1. Keep the original chronology.",
  "2. One shot should cover one clear visual beat.",
  "3. Do not invent characters, locations, props, or plot.",
  "4. Keep the language concrete and production-oriented.",
  "5. Return JSON only.",
  "",
  "Screenplay:",
].join("\n");

// ─── Expert Markdown parser ───────────────────────────────────────────────
// Converts the rich Markdown output (as specified in 整本拆分1.3.md) into
// an array of normalised shot objects that the rest of the pipeline accepts.
const CN_NUM = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'十一':11,'十二':12,'十三':13,'十四':14 };
const PART_RE = /^第([一二三四五六七八九十\d]+)部分[：:]\s*(.*)/;
const SHOT_RE = /^镜头\s*(\d+)\s*:?\s*$/;
const DUR_RE  = /^时长[：:]\s*\[?([0-9.]+)\]?\s*秒?/;
const SEP_RE  = /^-{3,}/;

function isPartOrShotHeader(s) {
  return PART_RE.test(s) || SHOT_RE.test(s);
}

function firstAfterColon(line) {
  const idx = line.search(/[：:]/);
  return idx >= 0 ? line.slice(idx + 1).trim() : line.trim();
}

function parseExpertStoryboardMarkdown(text) {
  const shots = [];

  let partNo = 0;
  let partTitle = "";
  let weather = "";
  let camera = "";
  let blocking = "";

  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // ── Part header ──────────────────────────────────────────────────────
    const partM = trimmed.match(PART_RE);
    if (partM) {
      const pnStr = partM[1];
      partNo = parseInt(pnStr, 10) || CN_NUM[pnStr] || (partNo + 1);
      partTitle = partM[2].trim();
      weather = "";
      camera = "";
      blocking = "";
      i++;
      // Read part-level metadata until separator or next header
      while (i < lines.length) {
        const ml = lines[i].trim();
        if (!ml || SEP_RE.test(ml)) { i++; continue; }
        if (isPartOrShotHeader(ml)) break;
        if (ml.startsWith("时间/天气/光线")) {
          weather = firstAfterColon(ml);
        } else if (ml.startsWith("核心摄影机")) {
          camera = firstAfterColon(ml);
        } else if (ml.startsWith("绝对人物站位")) {
          blocking = firstAfterColon(ml);
        }
        i++;
      }
      continue;
    }

    // ── Shot header ───────────────────────────────────────────────────────
    const shotM = trimmed.match(SHOT_RE);
    if (shotM) {
      const shotNum = parseInt(shotM[1], 10);
      const scriptLines = [];
      let durationSeconds = 3.0;
      i++;

      while (i < lines.length) {
        const sl = lines[i];
        const st = sl.trim();
        if (isPartOrShotHeader(st)) break;
        if (SEP_RE.test(st)) { i++; continue; }

        const durM = st.match(DUR_RE);
        if (durM) {
          durationSeconds = parseFloat(durM[1]) || 3.0;
        } else {
          // Keep all other labelled lines (环境描写, 时间切片, 镜头景别, 音效, etc.)
          // even if they are empty – preserves paragraph structure
          scriptLines.push(sl.trimEnd());
        }
        i++;
      }

      // Drop trailing blank lines
      while (scriptLines.length && !scriptLines[scriptLines.length - 1].trim()) {
        scriptLines.pop();
      }

      const script = scriptLines.join("\n").trim();
      if (!script) continue; // skip empty shots

      shots.push({
        title: `镜头 ${shotNum}`,
        script,
        durationSeconds: Math.round(Math.min(15, Math.max(1, durationSeconds)) * 10) / 10,
        promptSummary: script.replace(/[\n\r]+/g, " ").slice(0, 30),
        partNo: partNo || null,
        partTitle: partTitle || null,
        weather: weather || null,
        camera: camera || null,
        blocking: blocking || null,
        assetNames: [],
      });
      continue;
    }

    i++;
  }

  return shots;
}
// ─────────────────────────────────────────────────────────────────────────────

async function splitStoryboardsWithAliyun({ content, model = "qwen-plus", systemPrompt = null }) {
  const isExpertMode = typeof systemPrompt === "string" && systemPrompt.trim().length > 0;

  const systemContent = isExpertMode ? systemPrompt : DEFAULT_STORYBOARD_SYSTEM_PROMPT;
  const userContent = isExpertMode
    ? `请按照上述要求，将以下剧本拆解为专业的电影文字分镜头脚本：\n\n${content}`
    : `${DEFAULT_STORYBOARD_USER_PREFIX}\n${content}`;

  const payload = await requestAliyun("/compatible-mode/v1/chat/completions", {
    method: "POST",
    body: {
      model: normalizeModelId(model),
      temperature: isExpertMode ? 0.5 : 0.3,
      // qwen-plus max output is 8192 tokens; keep below that hard limit.
      // Expert mode yields ~25-30 rich shots within this budget.
      max_tokens: isExpertMode ? 8000 : 4096,
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: userContent },
      ],
    },
  });

  const text = parseTextResponse(payload);

  if (isExpertMode) {
    // Expert mode: parse the Markdown output directly — no JSON expected
    const shots = parseExpertStoryboardMarkdown(text);
    if (!shots.length) {
      console.error(
        "[aliyun] expert Markdown parse found 0 shots – first 1000 chars of response:",
        text.slice(0, 1000),
      );
      throw providerError("Expert storyboard breakdown returned no parseable shots from AI response");
    }
    console.log(`[aliyun] expert Markdown parsed ${shots.length} shots from ${text.length} chars`);
    return shots; // Already normalised by parseExpertStoryboardMarkdown
  }

  // Default mode: expect JSON array
  const jsonBlock = extractJsonBlock(text);
  let parsed;
  try {
    parsed = JSON.parse(jsonBlock);
  } catch (parseErr) {
    console.error(
      "[aliyun] storyboard JSON parse failed – raw text length:",
      text.length,
      "first 500 chars:",
      text.slice(0, 500),
    );
    throw providerError(`Aliyun storyboard split returned invalid JSON: ${parseErr.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw providerError("Aliyun storyboard split did not return an array");
  }
  return normalizeStoryboardShots(parsed);
}

function mapImageSize(aspectRatio = "16:9") {
  if (aspectRatio === "9:16") return "972*1728";
  if (aspectRatio === "1:1") return "1280*1280";
  return "1728*972";
}

function getSupportedVideoResolutions(model) {
  const normalizedModel = normalizeModelId(model);
  if (normalizedModel === "wanx2.1-i2v-turbo") {
    return ["720P", "480P"];
  }
  if (normalizedModel === "wan2.6-i2v-flash" || normalizedModel === "wan2.6-i2v") {
    return ["1080P", "720P"];
  }
  return ["1080P", "720P", "480P"];
}

function mapVideoResolution(resolution = "720p", model) {
  const normalized = String(resolution).toUpperCase();
  const supported = getSupportedVideoResolutions(model);
  if (supported.includes(normalized)) {
    return normalized;
  }
  if (normalized === "2K" && supported.includes("1080P")) {
    return "1080P";
  }
  return supported[0];
}

function mapVideoDuration(duration = "5s") {
  const parsed = Number.parseInt(String(duration).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

function mapYunwuVideoSize(resolution = "720p", model) {
  return mapVideoResolution(resolution, model);
}

function isKlingVideoModel(model) {
  return normalizeModelId(model) === "kling-video";
}

function isKlingOmniVideoModel(model) {
  const normalizedModel = normalizeModelId(model);
  return normalizedModel === "kling-omni-video" || normalizedModel === "kling-v3-omni";
}

function isKlingMultiImageToVideoModel(model) {
  return normalizeModelId(model) === "kling-multi-image2video";
}

function isKlingMultiElementsModel(model) {
  return normalizeModelId(model) === "kling-multi-elements";
}

function mapKlingVideoModelName(model) {
  const normalizedModel = normalizeModelId(model);
  if (
    normalizedModel === "kling-video" ||
    normalizedModel === "kling-multi-image2video" ||
    normalizedModel === "kling-multi-elements"
  ) {
    return "kling-v1";
  }
  return normalizedModel;
}

function mapKlingVideoDuration(duration = "5s") {
  const parsed = mapVideoDuration(duration);
  return parsed > 5 ? "10" : "5";
}

function mapKlingOmniVideoDuration(duration = "5s") {
  const parsed = mapVideoDuration(duration);
  return String(Math.max(3, Math.min(15, parsed)));
}

function isYunwuOpenAIVideoSingleReferenceModel(model) {
  return normalizeModelId(model) === "veo3.1";
}

function mapYunwuOpenAIVideoModelName(model) {
  const normalizedModel = normalizeModelId(model);
  if (normalizedModel === "veo3.1") {
    return "veo_3_1";
  }
  return normalizedModel || "veo_3_1";
}

function mapYunwuOpenAIVideoSeconds(duration = "8s") {
  const parsed = Number.parseInt(String(duration).replace(/[^\d]/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "8";
}

function mapYunwuOpenAIVideoSize(aspectRatio = "16:9") {
  const normalizedAspectRatio = String(aspectRatio || "").trim();
  if (normalizedAspectRatio === "1:1") return "1x1";
  if (normalizedAspectRatio === "9:16") return "9x16";
  return "16x9";
}

function buildKlingTextToVideoPayload({ model, prompt, aspectRatio, duration }) {
  return {
    model_name: mapKlingVideoModelName(model),
    prompt: prompt || "Generated video prompt",
    negative_prompt: "",
    cfg_scale: 0.5,
    mode: "std",
    sound: "off",
    aspect_ratio: aspectRatio || "16:9",
    duration: mapKlingVideoDuration(duration),
    external_task_id: "",
  };
}

function buildKlingImageToVideoPayload({
  model,
  prompt,
  referenceImageUrl,
  referenceTailImageUrl,
  aspectRatio,
  duration,
}) {
  const payload = {
    model_name: mapKlingVideoModelName(model),
    image: referenceImageUrl,
    prompt: prompt || "Generated video prompt",
    negative_prompt: "",
    cfg_scale: 0.5,
    mode: "std",
    duration: mapKlingVideoDuration(duration),
    external_task_id: "",
  };
  if (referenceTailImageUrl) {
    payload.image_tail = referenceTailImageUrl;
  }
  if (aspectRatio) {
    payload.aspect_ratio = aspectRatio;
  }
  return payload;
}

function buildKlingOmniVideoPayload({
  prompt,
  referenceImageUrl,
  referenceTailImageUrl,
  aspectRatio,
  duration,
  generateAudio,
}) {
  const imageList = [];
  if (referenceImageUrl) {
    imageList.push({ image_url: referenceImageUrl, type: "first_frame" });
  }
  if (referenceTailImageUrl) {
    imageList.push({ image_url: referenceTailImageUrl, type: "end_frame" });
  }

  return {
    model_name: "kling-v3-omni",
    prompt: prompt || "Generated video prompt",
    negative_prompt: "",
    image_list: imageList,
    mode: "std",
    aspect_ratio: aspectRatio || "16:9",
    duration: mapKlingOmniVideoDuration(duration),
    sound: generateAudio ? "on" : "off",
    callback_url: "",
    external_task_id: "",
  };
}

function buildKlingMultiImageToVideoPayload({ model, prompt, referenceImageUrls, aspectRatio, duration }) {
  return {
    model_name: mapKlingVideoModelName(model),
    image_list: (Array.isArray(referenceImageUrls) ? referenceImageUrls : []).map((image) => ({ image })),
    prompt: prompt || "Generated video prompt",
    negative_prompt: "",
    image_tail: "",
    aspect_ratio: aspectRatio || "16:9",
    mode: "std",
    duration: mapKlingVideoDuration(duration),
    external_task_id: "",
  };
}

function buildKlingMultiElementsPayload({ model, prompt, referenceImageUrls, duration }) {
  return {
    model_name: mapKlingVideoModelName(model),
    session_id: "",
    edit_mode: "",
    image_list: (Array.isArray(referenceImageUrls) ? referenceImageUrls : []).map((image) => ({ image })),
    prompt: prompt || "Generated video prompt",
    negative_prompt: "",
    mode: "std",
    duration: mapKlingVideoDuration(duration),
    callback_url: "",
    external_task_id: "",
  };
}

function buildYunwuOpenAIVideoPayload({ model, prompt, aspectRatio, duration }) {
  return {
    model: mapYunwuOpenAIVideoModelName(model),
    prompt: prompt || "Generated video prompt",
    seconds: mapYunwuOpenAIVideoSeconds(duration),
    size: mapYunwuOpenAIVideoSize(aspectRatio),
    watermark: "false",
  };
}

function isTextToVideoModel(model) {
  const normalizedModel = normalizeModelId(model);
  return normalizedModel === "wan2.6-t2v";
}

function mapTextToVideoSize(aspectRatio = "16:9", resolution = "720p", model) {
  const normalizedResolution = mapVideoResolution(resolution, model);
  const sizeMap = {
    "480P": {
      "16:9": "832*480",
      "9:16": "480*832",
      "1:1": "832*832",
    },
    "720P": {
      "16:9": "1280*720",
      "9:16": "720*1280",
      "1:1": "960*960",
    },
    "1080P": {
      "16:9": "1920*1080",
      "9:16": "1080*1920",
      "1:1": "1440*1440",
    },
  };

  const sizeGroup = sizeMap[normalizedResolution] || sizeMap["720P"];
  return sizeGroup[aspectRatio] || sizeGroup["16:9"];
}

function parseImageUrls(payload) {
  const choices = payload?.output?.choices || [];
  const urls = [];

  for (const choice of choices) {
    const content = choice?.message?.content || [];
    for (const item of content) {
      if (item?.type === "image" && item?.image) {
        urls.push(item.image);
      }
    }
  }

  const results = Array.isArray(payload?.output?.results) ? payload.output.results : [];
  for (const result of results) {
    if (typeof result?.url === "string" && result.url) {
      urls.push(result.url);
    }
    if (typeof result?.result_url === "string" && result.result_url) {
      urls.push(result.result_url);
    }
    if (typeof result?.image_url === "string" && result.image_url) {
      urls.push(result.image_url);
    }
  }

  if (typeof payload?.output?.result_url === "string" && payload.output.result_url) {
    urls.push(payload.output.result_url);
  }
  if (typeof payload?.output?.image_url === "string" && payload.output.image_url) {
    urls.push(payload.output.image_url);
  }

  if (!urls.length) {
    throw providerError("Aliyun image response did not include any image URLs");
  }

  return Array.from(new Set(urls));
}

async function parseYunwuImageUrls(payload) {
  const rawCandidates = [];
  const taskResultImages = [
    ...(Array.isArray(payload?.task_result?.images) ? payload.task_result.images : []),
    ...(Array.isArray(payload?.data?.task_result?.images) ? payload.data.task_result.images : []),
    ...(Array.isArray(payload?.images) ? payload.images : []),
    ...(Array.isArray(payload?.data?.images) ? payload.data.images : []),
  ];
  for (const item of taskResultImages) {
    if (typeof item?.url === "string" && item.url) rawCandidates.push(item.url);
    if (typeof item?.image_url === "string" && item.image_url) rawCandidates.push(item.image_url);
  }
  if (Array.isArray(payload?.data)) {
    for (const item of payload.data) {
      if (typeof item?.url === "string" && item.url) rawCandidates.push(item.url);
      if (typeof item?.image_url === "string" && item.image_url) rawCandidates.push(item.image_url);
      if (typeof item?.b64_json === "string" && item.b64_json) {
        rawCandidates.push(`data:image/png;base64,${item.b64_json}`);
      }
    }
  }
  if (typeof payload?.url === "string" && payload.url) {
    rawCandidates.push(payload.url);
  }
  if (Array.isArray(payload?.choices)) {
    for (const choice of payload.choices) {
      const content = choice?.message?.content;
      if (typeof content === "string" && content) {
        const markdownMatches = content.match(/!\[[^\]]*\]\(([^)]+)\)/g) || [];
        if (markdownMatches.length) {
          for (const match of markdownMatches) {
            const urlMatch = match.match(/!\[[^\]]*\]\(([^)]+)\)/);
            if (urlMatch?.[1]) rawCandidates.push(urlMatch[1]);
          }
        }
        const dataUrlMatches = content.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g) || [];
        rawCandidates.push(...dataUrlMatches);
      }
    }
  }
  if (Array.isArray(payload?.candidates)) {
    for (const candidate of payload.candidates) {
      const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
      for (const part of parts) {
        if (typeof part?.text === "string" && part.text) {
          const dataUrlMatches = part.text.match(/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g) || [];
          rawCandidates.push(...dataUrlMatches);
        }
        if (typeof part?.inlineData?.data === "string" && part.inlineData.data) {
          const mimeType = part.inlineData.mimeType || "image/png";
          rawCandidates.push(`data:${mimeType};base64,${part.inlineData.data}`);
        }
        if (typeof part?.inline_data?.data === "string" && part.inline_data.data) {
          const mimeType = part.inline_data.mime_type || "image/png";
          rawCandidates.push(`data:${mimeType};base64,${part.inline_data.data}`);
        }
      }
    }
  }

  const urls = [];
  const seen = new Set();
  for (const candidate of rawCandidates) {
    const normalized = String(candidate || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);

    const dataUrl = parseDataUrl(normalized);
    if (dataUrl) {
      const extension =
        dataUrl.contentType === "image/jpeg"
          ? ".jpg"
          : dataUrl.contentType === "image/webp"
            ? ".webp"
            : ".png";
      const upload = await createUploadFromBuffer({
        buffer: dataUrl.buffer,
        kind: "create-image",
        originalName: `yunwu_${Date.now()}${extension}`,
        contentType: dataUrl.contentType,
      });
      urls.push(upload.urlPath);
      continue;
    }

    urls.push(normalized);
  }

  if (!urls.length) {
    throw providerError("Yunwu image response did not include any image URLs", 502, "YUNWU_IMAGE_EMPTY");
  }
  return Array.from(new Set(urls));
}

function getSeedreamSize(aspectRatio, resolution) {
  const resRaw = String(resolution || "").trim().toUpperCase();
  // Seedream 5.0 only supports 2K and 3K; map 1K → 2K, 4K → 3K
  let tier;
  if (resRaw === "3K") tier = "3K";
  else if (resRaw === "4K") tier = "3K";
  else tier = "2K";

  const ar = String(aspectRatio || "").trim();
  const key = `${tier}:${ar}`;
  if (SEEDREAM_SIZE_MAP[key]) return SEEDREAM_SIZE_MAP[key];
  // Fallback: try without aspect ratio → 1:1
  return SEEDREAM_SIZE_MAP[`${tier}:1:1`] || "2048x2048";
}

async function prepareArkReferenceImageUrl(value) {
  if (!value) return null;
  if (isPublicHttpUrl(value)) return value;

  const localSource = readLocalReferenceSource(value);
  if (!localSource) return null;

  // Try Yunwu image proxy (requires YUNWU_API_KEY)
  if (hasYunwuApiKey()) {
    try {
      const cacheKey = buildYunwuImageProxyCacheKey(value, localSource);
      if (cacheKey && YUNWU_IMAGE_PROXY_CACHE.has(cacheKey)) {
        return YUNWU_IMAGE_PROXY_CACHE.get(cacheKey);
      }
      const uploadedUrl = await uploadBufferToYunwuImageProxy(localSource);
      if (cacheKey) YUNWU_IMAGE_PROXY_CACHE.set(cacheKey, uploadedUrl);
      return uploadedUrl;
    } catch (err) {
      console.warn("[prepareArkReferenceImageUrl] Yunwu upload failed:", err?.message);
    }
  }

  // Fallback: build public URL using CORE_API_PUBLIC_BASE_URL
  const publicBase = String(process.env.CORE_API_PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (publicBase) {
    // value may be a /uploads/ path or a data: URL already converted from a local file
    if (typeof value === "string" && value.startsWith("/uploads/")) {
      return `${publicBase}${value}`;
    }
  }

  // Last-resort fallback: pass the image as a base64 data URL directly to Ark.
  // The Volcengine Ark image-generation API accepts base64 images in the `image` field.
  if (localSource.buffer && localSource.contentType) {
    return `data:${localSource.contentType};base64,${localSource.buffer.toString("base64")}`;
  }

  return null;
}

async function generateSeedreamImages({
  prompt,
  negativePrompt = "",
  aspectRatio = "1:1",
  resolution = "2K",
  count = 1,
  referenceImageUrl = null,
  referenceImageUrls = [],
}) {
  const imageCount = Math.max(1, Math.min(Number(count) || 1, 4));
  const size = getSeedreamSize(aspectRatio, resolution);

  const referenceList = Array.isArray(referenceImageUrls) ? referenceImageUrls.filter(Boolean) : [];
  const effectiveRefs = referenceList.length ? referenceList : (referenceImageUrl ? [referenceImageUrl] : []);

  const preparedRefs = await Promise.all(effectiveRefs.map(prepareArkReferenceImageUrl));
  const validRefs = preparedRefs.filter(Boolean);

  let fullPrompt = String(prompt || "").trim() || "Generate an image";
  if (negativePrompt?.trim()) {
    fullPrompt += `\nNegative: ${negativePrompt.trim()}`;
  }

  const body = {
    model: "doubao-seedream-5-0-260128",
    prompt: fullPrompt,
    size,
    watermark: false,
    response_format: "url",
    sequential_image_generation: imageCount > 1 ? "auto" : "disabled",
    ...(imageCount > 1 ? { sequential_image_generation_options: { max_images: imageCount } } : {}),
    ...(validRefs.length ? { image: validRefs.length === 1 ? validRefs[0] : validRefs } : {}),
  };

  console.log(
    `[seedream] generating ${imageCount} image(s), size=${size}, refs=${validRefs.length}, prompt length=${fullPrompt.length}`
  );

  const payload = await requestVolcengineArk("/images/generations", {
    method: "POST",
    body: JSON.stringify(body),
    maxAttempts: 1,
  });

  const items = Array.isArray(payload?.data) ? payload.data : [];
  const urls = items.map((item) => item?.url || item?.b64_json).filter(Boolean);
  if (!urls.length) {
    throw providerError("Seedream image generation did not return any image URLs", 502, "SEEDREAM_IMAGE_EMPTY");
  }
  return urls.slice(0, imageCount);
}

function buildYunwuGeminiImageConfig(model, { aspectRatio = "1:1", resolution = "" } = {}) {
  const normalizedModel = normalizeModelId(model);
  const imageConfig = {
    aspectRatio: aspectRatio || "1:1",
  };
  if (normalizedModel !== "gemini-2.5-flash-image" && resolution) {
    imageConfig.imageSize = resolution;
  }
  return imageConfig;
}

async function waitForYunwuKlingImageTask(taskId, taskType = "generations", options = {}) {
  const providerTaskId = String(taskId || "").trim();
  if (!providerTaskId) {
    throw providerError("Yunwu Kling image task is missing task_id", 502, "YUNWU_TASK_EMPTY");
  }
  const timeoutMs = options.timeoutMs || 8 * 60 * 1000;
  const intervalMs = options.intervalMs || 8000;
  const startedAt = Date.now();
  let lastTransientError = null;
  const queryPath = `/kling/v1/images/${taskType}/${encodeURIComponent(providerTaskId)}`;

  while (Date.now() - startedAt < timeoutMs) {
    let payload = null;
    try {
      payload = await requestYunwu(queryPath, {
        method: "GET",
        maxAttempts: 5,
      });
      lastTransientError = null;
    } catch (error) {
      const retryableNetworkError = isRetryableYunwuFailure(
        error?.statusCode,
        error?.message,
        error?.cause?.code || error?.code
      );
      if (retryableNetworkError) {
        lastTransientError = error;
        await sleep(intervalMs);
        continue;
      }
      throw error;
    }

    const status = String(
      payload?.task_status ||
        payload?.data?.task_status ||
        payload?.status ||
        payload?.data?.status ||
        ""
    )
      .trim()
      .toUpperCase();

    if (["SUCCEED", "SUCCESS", "SUCCEEDED", "COMPLETED"].includes(status)) {
      return payload;
    }

    if (["FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED"].includes(status)) {
      throw providerError(
        payload?.task_status_msg ||
          payload?.data?.task_status_msg ||
          payload?.message ||
          payload?.error?.message ||
          `Yunwu Kling image task ${providerTaskId} failed: ${status}`,
        502,
        "YUNWU_TASK_FAILED"
      );
    }

    await sleep(intervalMs);
  }

  const timeoutMessage = lastTransientError?.message
    ? `Yunwu Kling image task ${providerTaskId} timed out after transient network errors: ${lastTransientError.message}`
    : `Yunwu Kling image task ${providerTaskId} timed out`;
  throw providerError(timeoutMessage, 504, "YUNWU_TASK_TIMEOUT");
}

async function submitYunwuKlingImageTask(path, body, taskType) {
  const payload = await requestYunwu(path, {
    method: "POST",
    body,
    maxAttempts: 1,
  });

  try {
    const immediateUrls = await parseYunwuImageUrls(payload);
    if (immediateUrls.length) {
      return immediateUrls;
    }
  } catch {
    // Continue into task polling when the submit response is task-based.
  }

  const taskId =
    payload?.task_id ||
    payload?.data?.task_id ||
    payload?.id ||
    payload?.data?.id;
  if (!taskId) {
    throw providerError("Yunwu Kling image submit response did not include task_id", 502, "YUNWU_TASK_EMPTY");
  }

  const resultPayload = await waitForYunwuKlingImageTask(taskId, taskType);
  return parseYunwuImageUrls(resultPayload);
}

async function generateYunwuKlingImages({
  prompt,
  model,
  aspectRatio = "1:1",
  resolution = "1K",
  count = 1,
  referenceImageUrl = null,
  referenceImageUrls = [],
}) {
  const normalizedModel = normalizeModelId(model);
  const imageCount = Math.max(1, Math.min(Number(count) || 1, 4));
  const rawReferenceInputs = Array.isArray(referenceImageUrls)
    ? referenceImageUrls.filter(Boolean)
    : referenceImageUrl
      ? [referenceImageUrl]
      : [];
  const preparedReferenceInputs = await Promise.all(
    Array.from(new Set(rawReferenceInputs)).map((value) => prepareYunwuVideoImageUrl(value))
  );
  const validReferenceInputs = preparedReferenceInputs.filter(Boolean);
  const normalizedPrompt = String(prompt || "").trim() || "Generate an image";

  if (validReferenceInputs.length >= 2) {
    if (normalizedModel !== "kling-v2-1") {
      throw providerError(
        `${normalizedModel} does not support multi-image-to-image generation on the Yunwu Kling interface.`,
        400,
        "BAD_REQUEST"
      );
    }

    const urls = [];
    for (let attempt = 0; attempt < imageCount && urls.length < imageCount; attempt += 1) {
      const payloadUrls = await submitYunwuKlingImageTask(
        "/kling/v1/images/multi-image2image",
        {
          model_name: normalizedModel,
          prompt: normalizedPrompt,
          aspect_ratio: aspectRatio || "1:1",
          ...(resolution ? { image_size: resolution } : {}),
          subject_image_list: validReferenceInputs.slice(0, 4).map((url) => ({
            subject_image: url,
          })),
        },
        "multi-image2image"
      );
      urls.push(...payloadUrls);
    }
    return Array.from(new Set(urls)).slice(0, imageCount);
  }

  return Array.from(
    new Set(
      await submitYunwuKlingImageTask(
        "/kling/v1/images/generations",
        {
          model_name: normalizedModel,
          prompt: normalizedPrompt,
          aspect_ratio: aspectRatio || "1:1",
          ...(resolution ? { image_size: resolution } : {}),
          n: imageCount,
          ...(validReferenceInputs[0]
            ? {
                image: validReferenceInputs[0],
                image_reference: "subject",
              }
            : {}),
        },
        "generations"
      )
    )
  ).slice(0, imageCount);
}

async function generateImagesWithAliyun({
  prompt,
  model = "wan2.6-t2i",
  aspectRatio = "16:9",
  resolution = "",
  count = 1,
  negativePrompt = "",
  referenceImageUrl = null,
  referenceImageUrls = [],
}) {
  const normalizedModel = normalizeModelId(model);
  const imageCount = Math.max(1, Math.min(Number(count) || 1, 4));
  if (isSeedreamImageModel(normalizedModel)) {
    return generateSeedreamImages({
      prompt,
      negativePrompt,
      aspectRatio,
      resolution,
      count,
      referenceImageUrl,
      referenceImageUrls,
    });
  }
  if (isYunwuImageModel(normalizedModel)) {
    if (isYunwuGeminiImageModel(normalizedModel)) {
      const parts = await buildYunwuGeminiImageParts({
        prompt,
        negativePrompt,
        referenceImageUrl,
        referenceImageUrls,
      });
      const generationConfig = {
        responseModalities: ["IMAGE"],
        imageConfig: buildYunwuGeminiImageConfig(normalizedModel, {
          aspectRatio: aspectRatio || "1:1",
          resolution,
        }),
      };
      const urls = [];
      for (let attempt = 0; attempt < imageCount && urls.length < imageCount; attempt += 1) {
        const payload = await requestYunwu(
          `/v1beta/models/${encodeURIComponent(normalizedModel)}:generateContent`,
          {
            method: "POST",
            body: {
              contents: [
                {
                  role: "user",
                  parts,
                },
              ],
              generationConfig,
            },
          }
        );
        urls.push(...(await parseYunwuImageUrls(payload)));
      }
      return Array.from(new Set(urls)).slice(0, imageCount);
    }

    if (isYunwuKlingImageModel(normalizedModel)) {
      return generateYunwuKlingImages({
        prompt: [String(prompt || "").trim(), negativePrompt?.trim() ? `Negative prompt: ${negativePrompt.trim()}` : ""]
          .filter(Boolean)
          .join("\n"),
        model: normalizedModel,
        aspectRatio: aspectRatio || "1:1",
        resolution,
        count: imageCount,
        referenceImageUrl,
        referenceImageUrls,
      });
    }

    throw providerError(`Unsupported Yunwu image model: ${normalizedModel}`, 400, "BAD_REQUEST");
  }

  const referenceList = Array.isArray(referenceImageUrls)
    ? referenceImageUrls.filter(Boolean)
    : [];

  if (normalizedModel === "wan2.6-image" && referenceList.length) {
    const cappedReferenceList = referenceList.slice(0, 4);
    const validReferenceInputs = [];
    const droppedReferences = [];

    cappedReferenceList.forEach((url, index) => {
      const localSource = readLocalReferenceSource(url);
      if (!localSource) {
        // 远程 URL 无法在本地读取像素信息时，交给阿里云侧校验
        validReferenceInputs.push(url);
        return;
      }

      try {
        validateWan26ReferenceSource(localSource, index);
        validReferenceInputs.push(url);
      } catch (error) {
        droppedReferences.push({
          index: index + 1,
          message: error?.message || "invalid reference image",
        });
      }
    });

    if (referenceList.length >= 2 && validReferenceInputs.length < 2) {
      throw providerError(
        `Only ${validReferenceInputs.length} valid references remain for multi-reference generation. ${droppedReferences.map((item) => `Ref#${item.index}: ${item.message}`).join(" | ")}`,
        400,
        "BAD_REQUEST"
      );
    }
    if (referenceList.length === 1 && !validReferenceInputs.length && droppedReferences.length) {
      throw providerError(droppedReferences[0].message, 400, "BAD_REQUEST");
    }

    const preparedReferenceList = await Promise.all(
      validReferenceInputs.map((url) => prepareAliyunImageUrl(url, normalizedModel))
    );
    const filteredRefs = preparedReferenceList.filter(Boolean);
    if (!filteredRefs.length) {
      throw providerError("No valid reference images after preparation", 400);
    }
    console.log(
      `[wan2.6-image] multi-ref generation: ${filteredRefs.length} image(s), model=${normalizedModel}, prompt length=${prompt?.length || 0}`
    );
    const sizeValue = String(resolution || "").toUpperCase() === "2K" ? "2K" : "1K";
    const params = {
      n: imageCount,
      size: sizeValue,
      enable_interleave: false,
      prompt_extend: true,
      watermark: false,
    };
    if (negativePrompt?.trim()) {
      params.negative_prompt = negativePrompt.trim();
    }
    const wan26Content = buildWan26ImageContent(prompt, filteredRefs);
    const payload = await requestAliyun("/api/v1/services/aigc/multimodal-generation/generation", {
      method: "POST",
      body: {
        model: normalizedModel,
        input: {
          messages: [
            {
              role: "user",
              content: wan26Content,
            },
          ],
        },
        parameters: params,
      },
    });

    return parseImageUrls(payload);
  }

  if (normalizedModel === "wanx2.1-imageedit" && (referenceImageUrl || referenceList[0])) {
    const baseImageUrl = referenceImageUrl || referenceList[0];
    const preparedReferenceImageUrl = await prepareAliyunImageUrl(baseImageUrl, normalizedModel);
    const editPrompt = negativePrompt?.trim()
      ? `${prompt}\nAvoid: ${negativePrompt.trim()}`
      : prompt;
    const taskPayload = await requestAliyun("/api/v1/services/aigc/image2image/image-synthesis", {
      method: "POST",
      headers: {
        "X-DashScope-Async": "enable",
        ...(isOssUrl(preparedReferenceImageUrl)
          ? { "X-DashScope-OssResourceResolve": "enable" }
          : {}),
      },
      body: {
        model: normalizedModel,
        input: {
          function: "description_edit",
          prompt: editPrompt,
          base_image_url: preparedReferenceImageUrl,
        },
        parameters: {
          n: imageCount,
        },
      },
    });

    const taskId = taskPayload?.output?.task_id;
    if (!taskId) {
      throw providerError("Aliyun image edit did not return a task id");
    }

    const result = await waitForAliyunTask(taskId, { intervalMs: 6000 });
    return parseImageUrls(result);
  }

  const payload = await requestAliyun("/api/v1/services/aigc/multimodal-generation/generation", {
    method: "POST",
    body: {
      model: normalizedModel,
      input: {
        messages: [
          {
            role: "user",
            content: [
              ...(prompt
                ? [
                    {
                      text: prompt,
                    },
                  ]
                : []),
              ...(
                referenceList.length
                  ? referenceList
                  : referenceImageUrl
                    ? [referenceImageUrl]
                    : []
              ).map((url) => ({
                image: url,
              })),
            ],
          },
        ],
      },
      parameters: {
        n: imageCount,
        size: mapImageSize(aspectRatio),
        prompt_extend: true,
        watermark: false,
        negative_prompt: negativePrompt,
      },
    },
  });

  return parseImageUrls(payload);
}

async function createAliyunVideoTask({
  model,
  prompt,
  referenceImageUrl,
  referenceImageUrls,
  firstFrameUrl,
  lastFrameUrl,
  aspectRatio,
  resolution,
  duration,
  videoMode,
  inputMode,
  yunwuImageInputMode = "auto",
  maxReferenceImages: inputMaxReferenceImages = null,
  generateAudio,
  multiReferenceImages,
  referenceVideoUrl,
  referenceVideoUrls,
  referenceAudioUrls,
  motionReferenceVideoUrl,
  characterReferenceImageUrl,
  editMode,
  editPresetId,
  qualityMode,
}) {
  const normalizedModel = normalizeModelId(model);

  if (isPixverseVideoModel(normalizedModel)) {
    return createPixverseVideoTask({
      model: normalizedModel,
      prompt,
      referenceImageUrl,
      firstFrameUrl,
      lastFrameUrl,
      aspectRatio,
      resolution,
      duration,
      videoMode,
      multiReferenceImages,
      generateAudio,
      referenceVideoUrl,
      referenceVideoUrls,
      motionReferenceVideoUrl,
      characterReferenceImageUrl,
      editMode,
      editPresetId,
      qualityMode,
    });
  }

  if (isSeedanceVideoModel(normalizedModel)) {
    return createSeedanceVideoTask({
      model: normalizedModel,
      prompt,
      referenceImageUrl,
      referenceImageUrls,
      firstFrameUrl,
      lastFrameUrl,
      referenceVideoUrls,
      referenceAudioUrls,
      motionReferenceVideoUrl,
      characterReferenceImageUrl,
      aspectRatio,
      resolution,
      duration,
      videoMode,
      editMode,
      generateAudio,
    });
  }

  if (isYunwuVideoModel(normalizedModel)) {
    const normalizedVideoMode = String(videoMode || "").trim().toLowerCase();
    const normalizedInputMode = String(inputMode || "").trim().toLowerCase();
    if (
      isYunwuOpenAIVideoSingleReferenceModel(normalizedModel) &&
      normalizedVideoMode === "image_to_video" &&
      normalizedInputMode === "single_reference"
    ) {
      const referenceSource = await loadYunwuVideoReferenceSource(referenceImageUrl);
      if (!referenceSource?.buffer) {
        throw providerError("veo3.1 image-to-video requires a reference image", 400, "MISSING_REFERENCE_IMAGE");
      }
      const form = new FormData();
      const payload = buildYunwuOpenAIVideoPayload({
        model: normalizedModel,
        prompt,
        aspectRatio,
        duration,
      });
      Object.entries(payload).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== "") {
          form.append(key, String(value));
        }
      });
      const referenceBlob = new Blob([referenceSource.buffer], {
        type: referenceSource.contentType || "application/octet-stream",
      });
      form.append(
        "input_reference",
        referenceBlob,
        referenceSource.fileName || `reference${guessExtensionFromContentType(referenceSource.contentType)}`
      );
      const openAiVideoPayload = await requestYunwu("/v1/videos", {
        method: "POST",
        body: form,
      });
      const openAiVideoTaskId = openAiVideoPayload?.id || openAiVideoPayload?.video_id || null;
      return openAiVideoTaskId ? `yunwu-openai-video:${openAiVideoTaskId}` : null;
    }
    // Kling text-to-video: must use /kling/v1/videos/text2video, NOT the generic /v1/video/create
    // (generic endpoint routes to Volcengine API which requires X-TC-Action header and fails)
    if (isKlingVideoModel(normalizedModel) && (normalizedVideoMode === "text_to_video" || !normalizedVideoMode)) {
      const klingPayload = await requestYunwu("/kling/v1/videos/text2video", {
        method: "POST",
        body: buildKlingTextToVideoPayload({
          model: normalizedModel,
          prompt,
          aspectRatio,
          duration,
        }),
      });
      const klingTaskId =
        klingPayload?.data?.task_id ||
        klingPayload?.task_id ||
        klingPayload?.id ||
        null;
      return klingTaskId ? `yunwu-kling:text2video:${klingTaskId}` : null;
    }

    if (
      isKlingVideoModel(normalizedModel) &&
      (normalizedVideoMode === "image_to_video" || normalizedVideoMode === "start_end_frame")
    ) {
      if (normalizedInputMode === "single_reference" || normalizedVideoMode === "start_end_frame") {
        const preparedKlingReferenceImageUrl = await prepareYunwuVideoImageUrl(
          normalizedVideoMode === "start_end_frame" ? firstFrameUrl || referenceImageUrl : referenceImageUrl
        );
        const preparedKlingTailImageUrl = await prepareYunwuVideoImageUrl(lastFrameUrl);
        if (!preparedKlingReferenceImageUrl) {
          throw providerError("Kling image-to-video requires a reference image", 400, "MISSING_REFERENCE_IMAGE");
        }
        const klingPayload = await requestYunwu("/kling/v1/videos/image2video", {
          method: "POST",
          body: buildKlingImageToVideoPayload({
            model: normalizedModel,
            prompt,
            referenceImageUrl: preparedKlingReferenceImageUrl,
            referenceTailImageUrl: preparedKlingTailImageUrl,
            aspectRatio,
            duration,
          }),
        });
        const klingTaskId =
          klingPayload?.data?.task_id ||
          klingPayload?.task_id ||
          klingPayload?.id ||
          null;
        return klingTaskId ? `yunwu-kling:image2video:${klingTaskId}` : null;
      }

      const klingPayload = await requestYunwu("/kling/v1/videos/text2video", {
        method: "POST",
        body: buildKlingTextToVideoPayload({
          model: normalizedModel,
          prompt,
          aspectRatio,
          duration,
        }),
      });
      const klingTaskId =
        klingPayload?.data?.task_id ||
        klingPayload?.task_id ||
        klingPayload?.id ||
        null;
      return klingTaskId ? `yunwu-kling:text2video:${klingTaskId}` : null;
    }

    if (
      isKlingOmniVideoModel(normalizedModel) &&
      (normalizedVideoMode === "image_to_video" || normalizedVideoMode === "start_end_frame")
    ) {
      const preparedKlingReferenceImageUrl = await prepareYunwuVideoImageUrl(
        normalizedVideoMode === "start_end_frame" ? firstFrameUrl || referenceImageUrl : referenceImageUrl
      );
      const preparedKlingTailImageUrl = await prepareYunwuVideoImageUrl(lastFrameUrl);
      if (!preparedKlingReferenceImageUrl) {
        throw providerError("Kling V3 Omni image-to-video requires a reference image", 400, "MISSING_REFERENCE_IMAGE");
      }
      const klingPayload = await requestYunwu("/kling/v1/videos/omni-video", {
        method: "POST",
        body: buildKlingOmniVideoPayload({
          prompt,
          referenceImageUrl: preparedKlingReferenceImageUrl,
          referenceTailImageUrl: preparedKlingTailImageUrl,
          aspectRatio,
          duration,
          generateAudio,
        }),
      });
      const klingTaskId =
        klingPayload?.data?.task_id ||
        klingPayload?.data?.id ||
        klingPayload?.task_id ||
        klingPayload?.id ||
        null;
      return klingTaskId ? `yunwu-kling:omni-video:${klingTaskId}` : null;
    }

    if (
      (isKlingMultiImageToVideoModel(normalizedModel) || isKlingMultiElementsModel(normalizedModel)) &&
      normalizedVideoMode === "multi_param"
    ) {
      const preparedKlingReferenceImageUrls = [];
      for (const url of Array.isArray(referenceImageUrls) ? referenceImageUrls : []) {
        const preparedUrl = await prepareYunwuVideoImageUrl(url);
        if (preparedUrl) {
          preparedKlingReferenceImageUrls.push(preparedUrl);
        }
      }
      const uniqueKlingReferenceImageUrls = Array.from(new Set(preparedKlingReferenceImageUrls)).slice(0, 7);
      if (!uniqueKlingReferenceImageUrls.length) {
        throw providerError("Kling multi-reference video requires reference images", 400, "MISSING_REFERENCE_IMAGE");
      }
      const klingPath = isKlingMultiElementsModel(normalizedModel)
        ? "/kling/v1/videos/multi-elements"
        : "/kling/v1/videos/multi-image2video";
      const klingPayload = await requestYunwu(klingPath, {
        method: "POST",
        body: isKlingMultiElementsModel(normalizedModel)
          ? buildKlingMultiElementsPayload({
              model: normalizedModel,
              prompt,
              referenceImageUrls: uniqueKlingReferenceImageUrls,
              duration,
            })
          : buildKlingMultiImageToVideoPayload({
              model: normalizedModel,
              prompt,
              referenceImageUrls: uniqueKlingReferenceImageUrls,
              aspectRatio,
              duration,
            }),
      });
      const klingTaskId =
        klingPayload?.data?.task_id ||
        klingPayload?.task_id ||
        klingPayload?.id ||
        null;
      const klingTaskType = isKlingMultiElementsModel(normalizedModel)
        ? "multi-elements"
        : "multi-image2video";
      return klingTaskId ? `yunwu-kling:${klingTaskType}:${klingTaskId}` : null;
    }

    if (isKlingMultiElementsModel(normalizedModel) && normalizedVideoMode === "motion_control") {
      const preparedKlingReferenceImageUrls = [];
      const candidateImages = [
        characterReferenceImageUrl,
        ...(Array.isArray(referenceImageUrls) ? referenceImageUrls : []),
      ];
      for (const url of candidateImages) {
        const preparedUrl = await prepareYunwuVideoImageUrl(url);
        if (preparedUrl) {
          preparedKlingReferenceImageUrls.push(preparedUrl);
        }
      }
      const uniqueKlingReferenceImageUrls = Array.from(new Set(preparedKlingReferenceImageUrls)).slice(0, 7);
      if (!uniqueKlingReferenceImageUrls.length) {
        throw providerError("Kling motion-control requires at least one character or element reference image", 400, "MISSING_REFERENCE_IMAGE");
      }
      const klingPayload = await requestYunwu("/kling/v1/videos/multi-elements", {
        method: "POST",
        body: buildKlingMultiElementsPayload({
          model: normalizedModel,
          prompt,
          referenceImageUrls: uniqueKlingReferenceImageUrls,
          duration,
        }),
      });
      const klingTaskId =
        klingPayload?.data?.task_id ||
        klingPayload?.task_id ||
        klingPayload?.id ||
        null;
      return klingTaskId ? `yunwu-kling:multi-elements:${klingTaskId}` : null;
    }

    const normalizedResolution = mapVideoResolution(resolution, normalizedModel);
    const preparedReferenceImageUrl = await prepareYunwuVideoImageUrl(referenceImageUrl);
    const preparedReferenceImageUrls = [];
    for (const url of Array.isArray(referenceImageUrls) ? referenceImageUrls : []) {
      const preparedUrl = await prepareYunwuVideoImageUrl(url);
      if (preparedUrl) {
        preparedReferenceImageUrls.push(preparedUrl);
      }
    }
    const preparedFirstFrameUrl = await prepareYunwuVideoImageUrl(firstFrameUrl);
    const preparedLastFrameUrl = await prepareYunwuVideoImageUrl(lastFrameUrl);
    const payloadBody = {
      model: normalizedModel,
      prompt: prompt || "Generated video prompt",
      aspect_ratio: aspectRatio || "16:9",
    };
    const filteredReferenceImages = preparedReferenceImageUrls.filter(Boolean);
    const candidateReferenceImages = preparedReferenceImageUrl
      ? [preparedReferenceImageUrl, ...filteredReferenceImages]
      : filteredReferenceImages;
    const maxReferenceImages =
      normalizedVideoMode === "multi_param"
        ? Math.max(1, Number(inputMaxReferenceImages) || 7)
        : 4;
    const uniqueReferenceImages = Array.from(new Set(candidateReferenceImages)).slice(0, maxReferenceImages);
    const isStartEndFramesModel = false;
    const isMultiReferenceMode =
      normalizedVideoMode === "multi_param" || uniqueReferenceImages.length > 1;
    const isImageConditionedMode =
      normalizedVideoMode === "multi_param" ||
      normalizedInputMode === "single_reference" ||
      (normalizedVideoMode === "image_to_video" && uniqueReferenceImages.length > 0);
    const usesFixedImageConditionedOutput =
      normalizedVideoMode === "image_to_video" ||
      normalizedVideoMode === "multi_param" ||
      isStartEndFramesModel;
    const primaryImageUrl =
      preparedFirstFrameUrl || (!isMultiReferenceMode ? preparedReferenceImageUrl : null);
    const normalizedImageInputMode = String(yunwuImageInputMode || "auto").trim().toLowerCase();

    if (isStartEndFramesModel) {
      payloadBody.prompt = buildYunwuStartEndVideoPrompt(prompt, Boolean(preparedLastFrameUrl));
      payloadBody.images = [preparedFirstFrameUrl, preparedLastFrameUrl].filter(Boolean);
      payloadBody.enhance_prompt = false;
      payloadBody.enable_upsample = false;
    } else if (!isImageConditionedMode) {
      payloadBody.size = mapYunwuVideoSize(normalizedResolution, normalizedModel);
    } else {
      payloadBody.enhance_prompt = false;
      payloadBody.enable_upsample = true;
      if (normalizedModel === "grok-video-3") {
        payloadBody.size = mapYunwuVideoSize(normalizedResolution, normalizedModel);
      }
    }

    if (isStartEndFramesModel) {
      if (!preparedFirstFrameUrl) {
        throw providerError("Start-end frame mode requires a first frame image", 400, "MISSING_FIRST_FRAME");
      }
    } else if (normalizedVideoMode === "multi_param") {
      if (uniqueReferenceImages.length) {
        payloadBody.images = uniqueReferenceImages;
      }
    } else if (normalizedVideoMode === "start_end_frame" && preparedFirstFrameUrl) {
      payloadBody.first_frame_url = preparedFirstFrameUrl;
    } else if (isImageConditionedMode && uniqueReferenceImages.length) {
      if (normalizedImageInputMode === "first_frame") {
        if (primaryImageUrl) payloadBody.first_frame_url = primaryImageUrl;
      } else if (normalizedImageInputMode === "reference_images") {
        payloadBody.reference_images = uniqueReferenceImages;
      } else if (normalizedImageInputMode === "images") {
        payloadBody.images = uniqueReferenceImages;
      } else {
        payloadBody.images = uniqueReferenceImages;
        if (!isMultiReferenceMode && primaryImageUrl) {
          payloadBody.first_frame_url = primaryImageUrl;
        }
      }
    }
    if (!isStartEndFramesModel && preparedLastFrameUrl) {
      payloadBody.last_frame_url = preparedLastFrameUrl;
    }

    const payload = await requestYunwu("/v1/video/create", {
      method: "POST",
      body: payloadBody,
    });
    const taskId =
      payload?.id ||
      payload?.task_id ||
      payload?.data?.id ||
      payload?.data?.task_id ||
      null;
    return taskId ? `yunwu:${taskId}` : null;
  }
  const normalizedResolution = mapVideoResolution(resolution, normalizedModel);

  if (normalizedModel === "wan2.2-kf2v-flash" || normalizedModel === "wanx2.1-kf2v-plus") {
    if (!firstFrameUrl) {
      throw providerError("首尾帧模式缺少首帧图片");
    }

    const payload = await requestAliyun("/api/v1/services/aigc/image2video/video-synthesis", {
      method: "POST",
      headers: { "X-DashScope-Async": "enable" },
      body: {
        model: normalizedModel,
        input: {
          first_frame_url: firstFrameUrl,
          ...(lastFrameUrl ? { last_frame_url: lastFrameUrl } : {}),
          ...(prompt ? { prompt } : {}),
        },
        parameters: {
          resolution: normalizedResolution,
          prompt_extend: true,
        },
      },
    });

    return payload?.output?.task_id;
  }

  if (isTextToVideoModel(normalizedModel)) {
    const payload = await requestAliyun("/api/v1/services/aigc/video-generation/video-synthesis", {
      method: "POST",
      headers: { "X-DashScope-Async": "enable" },
      body: {
        model: normalizedModel,
        input: {
          prompt: prompt || "Generated video prompt",
        },
        parameters: {
          size: mapTextToVideoSize(aspectRatio, normalizedResolution, normalizedModel),
          duration: mapVideoDuration(duration),
          prompt_extend: true,
          watermark: false,
        },
      },
    });

    return payload?.output?.task_id;
  }

  if (!referenceImageUrl) {
    throw providerError("图生视频模式缺少参考图");
  }

  const payload = await requestAliyun("/api/v1/services/aigc/video-generation/video-synthesis", {
    method: "POST",
    headers: { "X-DashScope-Async": "enable" },
    body: {
      model: normalizedModel,
      input: {
        img_url: referenceImageUrl,
        ...(prompt ? { prompt } : {}),
      },
      parameters: {
        resolution: normalizedResolution,
        duration: mapVideoDuration(duration),
        prompt_extend: true,
        watermark: false,
      },
    },
  });

  return payload?.output?.task_id;
}

async function waitForAliyunTask(taskId, options = {}) {
  if (String(taskId || "").startsWith("pixverse:")) {
    const providerTaskId = String(taskId).slice("pixverse:".length);
    const timeoutMs = options.timeoutMs || 8 * 60 * 1000;
    const intervalMs = options.intervalMs || 5000;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const payload = await requestPixverse(`/video/result/${encodeURIComponent(providerTaskId)}`, {
        method: "GET",
        maxAttempts: 3,
      });
      const resp = payload?.Resp || payload?.resp || {};
      const status = Number(resp?.status);
      if (status === 1) {
        return payload;
      }
      if (status === 7) {
        throw providerError("PixVerse moderation failed", 502, "PIXVERSE_TASK_MODERATION_FAILED");
      }
      if (status === 8) {
        throw providerError("PixVerse generation failed", 502, "PIXVERSE_TASK_FAILED");
      }
      if (status === 6) {
        throw providerError("PixVerse task was deleted", 502, "PIXVERSE_TASK_DELETED");
      }
      await sleep(intervalMs);
    }
    throw providerError(`PixVerse task ${providerTaskId} timed out`, 504, "PIXVERSE_TASK_TIMEOUT");
  }

  if (String(taskId || "").startsWith("seedance:")) {
    return waitForSeedanceTask(taskId, options);
  }

  if (String(taskId || "").startsWith("yunwu-openai-video:")) {
    const providerTaskId = String(taskId).slice("yunwu-openai-video:".length);
    const timeoutMs = options.timeoutMs || 8 * 60 * 1000;
    const intervalMs = options.intervalMs || 8000;
    const startedAt = Date.now();
    let lastTransientError = null;
    while (Date.now() - startedAt < timeoutMs) {
      let payload = null;
      try {
        payload = await requestYunwu(`/v1/videos/${encodeURIComponent(providerTaskId)}`, {
          method: "GET",
          maxAttempts: 5,
        });
        lastTransientError = null;
      } catch (error) {
        const retryableNetworkError = isRetryableYunwuFailure(
          error?.statusCode,
          error?.message,
          error?.cause?.code || error?.code
        );
        if (retryableNetworkError) {
          lastTransientError = error;
          await sleep(intervalMs);
          continue;
        }
        throw error;
      }

      const status = String(payload?.status || "").trim().toUpperCase();
      if (["COMPLETED", "SUCCEEDED", "SUCCESS"].includes(status)) {
        return payload;
      }
      if (["FAILED", "ERROR", "CANCELED", "CANCELLED"].includes(status)) {
        const failureDetail =
          payload?.error?.message ||
          payload?.message ||
          payload?.detail?.message ||
          "";
        throw providerError(
          failureDetail
            ? `Yunwu OpenAI video task ${providerTaskId} failed: ${status} | ${failureDetail}`
            : `Yunwu OpenAI video task ${providerTaskId} failed: ${status}`,
          502,
          "YUNWU_TASK_FAILED"
        );
      }

      await sleep(intervalMs);
    }

    const timeoutMessage = lastTransientError?.message
      ? `Yunwu OpenAI video task ${providerTaskId} timed out after transient network errors: ${lastTransientError.message}`
      : `Yunwu OpenAI video task ${providerTaskId} timed out`;
    throw providerError(timeoutMessage, 504, "YUNWU_TASK_TIMEOUT");
  }

  if (String(taskId || "").startsWith("yunwu-kling:")) {
    const rawTaskId = String(taskId).slice("yunwu-kling:".length);
    const separatorIndex = rawTaskId.indexOf(":");
    const klingTaskType = separatorIndex >= 0 ? rawTaskId.slice(0, separatorIndex) : "text2video";
    const providerTaskId = separatorIndex >= 0 ? rawTaskId.slice(separatorIndex + 1) : rawTaskId;
    const timeoutMs = options.timeoutMs || 8 * 60 * 1000;
    const intervalMs = options.intervalMs || 8000;
    const startedAt = Date.now();
    let lastTransientError = null;
    const queryPath =
      klingTaskType === "text2video"
        ? `/kling/v1/videos/text2video/${encodeURIComponent(providerTaskId)}`
        : klingTaskType === "omni-video"
          ? `/kling/v1/videos/omni-video/${encodeURIComponent(providerTaskId)}`
          : klingTaskType === "multi-image2video"
            ? `/kling/v1/videos/multi-image2video/${encodeURIComponent(providerTaskId)}`
            : klingTaskType === "multi-elements"
              ? `/kling/v1/videos/multi-elements/${encodeURIComponent(providerTaskId)}`
              : `/kling/v1/videos/image2video/${encodeURIComponent(providerTaskId)}`;

    while (Date.now() - startedAt < timeoutMs) {
      let payload = null;
      try {
        payload = await requestYunwu(queryPath, {
          method: "GET",
          maxAttempts: 5,
        });
        lastTransientError = null;
      } catch (error) {
        const retryableNetworkError = isRetryableYunwuFailure(
          error?.statusCode,
          error?.message,
          error?.cause?.code || error?.code
        );
        if (retryableNetworkError) {
          lastTransientError = error;
          await sleep(intervalMs);
          continue;
        }
        throw error;
      }

      const status = String(
        payload?.data?.task_status ||
          payload?.task_status ||
          payload?.data?.status ||
          payload?.status ||
          ""
      )
        .trim()
        .toUpperCase();

      if (["SUCCEED", "SUCCESS", "SUCCEEDED", "COMPLETED"].includes(status)) {
        return payload;
      }
      if (["FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED"].includes(status)) {
        let failureDetail =
          payload?.message ||
          payload?.msg ||
          payload?.error?.message ||
          payload?.data?.task_status_msg ||
          payload?.data?.task_info?.message ||
          "";
        if (!failureDetail) {
          try {
            const compactPayload = JSON.stringify(payload);
            failureDetail = compactPayload && compactPayload !== "{}" ? compactPayload.slice(0, 400) : "";
          } catch {}
        }
        throw providerError(
          failureDetail
            ? `Yunwu Kling task ${providerTaskId} failed: ${status} | ${failureDetail}`
            : `Yunwu Kling task ${providerTaskId} failed: ${status}`,
          502,
          "YUNWU_TASK_FAILED"
        );
      }

      await sleep(intervalMs);
    }

    const timeoutMessage = lastTransientError?.message
      ? `Yunwu Kling task ${providerTaskId} timed out after transient network errors: ${lastTransientError.message}`
      : `Yunwu Kling task ${providerTaskId} timed out`;
    throw providerError(timeoutMessage, 504, "YUNWU_TASK_TIMEOUT");
  }

  if (String(taskId || "").startsWith("yunwu:")) {
    const providerTaskId = String(taskId).slice("yunwu:".length);
    const timeoutMs = options.timeoutMs || 8 * 60 * 1000;
    const intervalMs = options.intervalMs || 8000;
    const startedAt = Date.now();
    let lastTransientError = null;
    while (Date.now() - startedAt < timeoutMs) {
      let payload = null;
      try {
        payload = await requestYunwu(`/v1/video/query?id=${encodeURIComponent(providerTaskId)}`, {
          method: "GET",
          maxAttempts: 5,
        });
        lastTransientError = null;
      } catch (error) {
        const retryableNetworkError = isRetryableYunwuFailure(
          error?.statusCode,
          error?.message,
          error?.cause?.code || error?.code
        );
        if (retryableNetworkError) {
          lastTransientError = error;
          await sleep(intervalMs);
          continue;
        }
        throw error;
      }
      const status = String(
        payload?.status ||
          payload?.task_status ||
          payload?.data?.status ||
          payload?.data?.task_status ||
          ""
      ).toUpperCase();
      if (status === "SUCCEEDED" || status === "SUCCESS" || status === "COMPLETED") {
        return payload;
      }
      if (status === "FAILED" || status === "CANCELED" || status === "ERROR") {
        let failureDetail = payload?.message || payload?.error?.message || payload?.detail?.error?.message || "";
        if (!failureDetail) {
          try {
            const compactPayload = JSON.stringify(payload);
            failureDetail = compactPayload && compactPayload !== "{}" ? compactPayload.slice(0, 400) : "";
          } catch {}
        }
        throw providerError(
          failureDetail
            ? `Yunwu task ${providerTaskId} failed: ${status} | ${failureDetail}`
            : `Yunwu task ${providerTaskId} failed: ${status}`,
          502,
          "YUNWU_TASK_FAILED"
        );
      }
      await sleep(intervalMs);
    }
    const timeoutMessage = lastTransientError?.message
      ? `Yunwu task ${providerTaskId} timed out after transient network errors: ${lastTransientError.message}`
      : `Yunwu task ${providerTaskId} timed out`;
    throw providerError(timeoutMessage, 504, "YUNWU_TASK_TIMEOUT");
  }
  const timeoutMs = options.timeoutMs || 8 * 60 * 1000;
  const intervalMs = options.intervalMs || 8000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const payload = await requestAliyun(`/api/v1/tasks/${taskId}`);
    const status = payload?.output?.task_status;

    if (status === "SUCCEEDED") {
      return payload;
    }

    if (status === "FAILED" || status === "CANCELED" || status === "UNKNOWN") {
      throw providerError(payload?.message || `Aliyun task ${taskId} failed: ${status}`);
    }

    await sleep(intervalMs);
  }

  throw providerError(`Aliyun task ${taskId} timed out`);
}

function parseAliyunVideoResult(payload) {
  function toPositiveNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function pickFirst(...values) {
    for (const value of values) {
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }
    return null;
  }

  function normalizeOutputDuration(value) {
    if (typeof value === "string" && value.trim()) {
      const normalized = value.trim();
      const parsedFloat = Number.parseFloat(normalized);
      if (Number.isFinite(parsedFloat) && parsedFloat > 0) {
        return `${Math.round(parsedFloat)}s`;
      }
      const parsed = Number.parseInt(normalized.replace(/[^\d]/g, ""), 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        return `${parsed}s`;
      }
    }
    const numeric = toPositiveNumber(value);
    if (numeric) {
      return `${Math.round(numeric)}s`;
    }
    return null;
  }

  function deriveResolutionFromDimensions(widthValue, heightValue) {
    const width = toPositiveNumber(widthValue);
    const height = toPositiveNumber(heightValue);
    if (!width || !height) return null;
    const longer = Math.max(width, height);
    if (longer >= 1900) return "1080p";
    if (longer >= 1200) return "720p";
    if (longer >= 800) return "480p";
    return `${width}x${height}`;
  }

  function deriveAspectRatioFromDimensions(widthValue, heightValue) {
    const width = toPositiveNumber(widthValue);
    const height = toPositiveNumber(heightValue);
    if (!width || !height) return null;
    const ratio = width / height;
    const knownRatios = [
      { label: "16:9", value: 16 / 9 },
      { label: "9:16", value: 9 / 16 },
      { label: "1:1", value: 1 },
      { label: "4:3", value: 4 / 3 },
      { label: "3:4", value: 3 / 4 },
      { label: "3:2", value: 3 / 2 },
      { label: "2:3", value: 2 / 3 },
    ];

    let bestMatch = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of knownRatios) {
      const distance = Math.abs(ratio - candidate.value);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = candidate.label;
      }
    }

    if (bestMatch && bestDistance <= 0.05) {
      return bestMatch;
    }

    return width >= height ? `${Math.round(width)}:${Math.round(height)}` : `${Math.round(width)}:${Math.round(height)}`;
  }

  function extractOutputResolution(data, resultItem = {}) {
    return (
      data?.resolution ||
      data?.video_resolution ||
      data?.task_result?.resolution ||
      data?.task_result?.video_resolution ||
      resultItem?.resolution ||
      resultItem?.video_resolution ||
      deriveResolutionFromDimensions(
        pickFirst(
          data?.width,
          data?.video_width,
          data?.detail?.width,
          data?.detail?.video_width,
          data?.detail?.pending_info?.width,
          data?.task_result?.width,
          data?.task_result?.video_width,
          resultItem?.width,
          resultItem?.video_width
        ),
        pickFirst(
          data?.height,
          data?.video_height,
          data?.detail?.height,
          data?.detail?.video_height,
          data?.detail?.pending_info?.height,
          data?.task_result?.height,
          data?.task_result?.video_height,
          resultItem?.height,
          resultItem?.video_height
        )
      ) ||
      null
    );
  }

  function extractOutputAspectRatio(data, resultItem = {}) {
    const openAiSize = pickFirst(
      data?.size,
      data?.video_size,
      data?.task_result?.size,
      data?.detail?.size,
      resultItem?.size
    );
    const normalizedOpenAiSize =
      typeof openAiSize === "string" && openAiSize.trim()
        ? openAiSize.trim().toLowerCase().replace("x", ":")
        : null;
    return (
      normalizedOpenAiSize ||
      data?.aspect_ratio ||
      data?.video_aspect_ratio ||
      data?.task_result?.aspect_ratio ||
      data?.task_result?.video_aspect_ratio ||
      data?.detail?.aspect_ratio ||
      data?.detail?.video_aspect_ratio ||
      resultItem?.aspect_ratio ||
      resultItem?.video_aspect_ratio ||
      deriveAspectRatioFromDimensions(
        pickFirst(
          data?.width,
          data?.video_width,
          data?.detail?.width,
          data?.detail?.video_width,
          data?.detail?.pending_info?.width,
          data?.task_result?.width,
          data?.task_result?.video_width,
          resultItem?.width,
          resultItem?.video_width
        ),
        pickFirst(
          data?.height,
          data?.video_height,
          data?.detail?.height,
          data?.detail?.video_height,
          data?.detail?.pending_info?.height,
          data?.task_result?.height,
          data?.task_result?.video_height,
          resultItem?.height,
          resultItem?.video_height
        )
      ) ||
      null
    );
  }

  function extractOutputDuration(data, resultItem = {}) {
    return (
      normalizeOutputDuration(
        pickFirst(
          data?.seconds,
          data?.duration,
          data?.video_duration,
          data?.task_result?.seconds,
          data?.task_result?.duration,
          data?.task_result?.video_duration,
          data?.detail?.duration,
          data?.detail?.video_duration,
          resultItem?.duration,
          resultItem?.video_duration
        )
      ) || null
    );
  }

  if (payload?.data || payload?.status || payload?.video_url) {
    const data = payload?.data || payload;
    const taskResult = data?.task_result || {};
    const taskResultVideo =
      Array.isArray(taskResult?.videos) && taskResult.videos.length
        ? taskResult.videos[0] || {}
        : Array.isArray(taskResult?.video_list) && taskResult.video_list.length
          ? taskResult.video_list[0] || {}
          : {};
    const resultItem = Array.isArray(data?.results) ? data.results[0] || {} : {};
    return {
      videoUrl:
        data?.video_url ||
        data?.url ||
        data?.result_url ||
        taskResult?.video_url ||
        taskResult?.url ||
        taskResultVideo?.url ||
        taskResultVideo?.video_url ||
        taskResultVideo?.resource ||
        (Array.isArray(data?.results) ? data.results[0]?.url || data.results[0]?.video_url : null) ||
        null,
      thumbnailUrl:
        data?.thumbnail_url ||
        data?.cover_url ||
        data?.cover_image_url ||
        taskResult?.thumbnail_url ||
        taskResult?.cover_url ||
        taskResult?.cover_image_url ||
        taskResultVideo?.cover_url ||
        taskResultVideo?.thumbnail_url ||
        taskResultVideo?.cover_image_url ||
        (Array.isArray(data?.results) ? data.results[0]?.cover_url || data.results[0]?.thumbnail_url : null) ||
        null,
      durationSeconds: data?.duration || data?.video_duration || taskResult?.duration || null,
      outputDuration: extractOutputDuration(data, taskResultVideo.url ? taskResultVideo : resultItem),
      outputAspectRatio: extractOutputAspectRatio(data, taskResultVideo.url ? taskResultVideo : resultItem),
      outputResolution: extractOutputResolution(data, taskResultVideo.url ? taskResultVideo : resultItem),
    };
  }
  const output = payload?.output || {};
  const resultItem = Array.isArray(output.results) ? output.results[0] || {} : {};
  return {
    videoUrl: output.video_url || resultItem.video_url || resultItem.url || null,
    thumbnailUrl:
      output.cover_url ||
      output.cover_image_url ||
      resultItem.cover_url ||
      resultItem.cover_image_url ||
      null,
    durationSeconds: output.video_duration || output.duration || resultItem.duration || null,
    outputDuration: extractOutputDuration(output, resultItem),
    outputAspectRatio: extractOutputAspectRatio(output, resultItem),
    outputResolution: extractOutputResolution(output, resultItem),
  };
}

async function synthesizeSpeechWithAliyun({
  text,
  model = "cosyvoice-v3-flash",
  voice = "longanyang",
  format = "mp3",
  sampleRate = 22050,
  volume = 50,
  rate = 1,
  pitch = 1,
}) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) {
    throw providerError("DASHSCOPE_API_KEY is not configured", 503, "PROVIDER_NOT_CONFIGURED");
  }

  const taskId = randomUUID();
  const chunks = [];

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = (socket) => {
      socket.removeAllListeners();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close();
      }
    };

    const finish = (socket, error, result) => {
      if (settled) return;
      settled = true;
      cleanup(socket);
      if (error) {
        reject(error);
        return;
      }
      resolve(result);
    };

    const socket = new WebSocket(DEFAULT_WS_URL, {
      headers: {
        Authorization: `bearer ${apiKey}`,
      },
    });

    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          header: {
            action: "run-task",
            task_id: taskId,
            streaming: "duplex",
          },
          payload: {
            task_group: "audio",
            task: "tts",
            function: "SpeechSynthesizer",
            model: normalizeModelId(model),
            parameters: {
              text_type: "PlainText",
              voice: normalizeVoicePreset(voice),
              format,
              sample_rate: sampleRate,
              volume,
              rate,
              pitch,
            },
            input: {},
          },
        })
      );
    });

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        chunks.push(Buffer.from(data));
        return;
      }

      let payload = null;
      try {
        payload = JSON.parse(Buffer.from(data).toString("utf8"));
      } catch {
        return;
      }

      const event = payload?.header?.event;

      if (event === "task-started") {
        socket.send(
          JSON.stringify({
            header: {
              action: "continue-task",
              task_id: taskId,
              streaming: "duplex",
            },
            payload: {
              input: {
                text,
              },
            },
          })
        );

        socket.send(
          JSON.stringify({
            header: {
              action: "finish-task",
              task_id: taskId,
              streaming: "duplex",
            },
            payload: {
              input: {},
            },
          })
        );
        return;
      }

      if (event === "task-finished") {
        finish(socket, null, {
          buffer: Buffer.concat(chunks),
          requestId: payload?.header?.attributes?.request_uuid || null,
          format,
        });
        return;
      }

      if (event === "task-failed") {
        finish(
          socket,
          providerError(payload?.header?.error_message || "Aliyun TTS task failed")
        );
      }
    });

    socket.on("error", (error) => {
      finish(socket, providerError(error.message || "Aliyun TTS websocket error"));
    });

    socket.on("close", (code, reason) => {
      if (!settled) {
        finish(
          socket,
          providerError(
            `Aliyun TTS websocket closed unexpectedly: ${code} ${String(reason || "")}`.trim()
          )
        );
      }
    });
  });
}

async function enhancePromptWithWebSearch(prompt) {
  const apiKey = getVolcengineArkApiKey();
  if (!apiKey || !prompt || typeof prompt !== "string" || !prompt.trim()) {
    return prompt;
  }

  const chatModel = "doubao-seed-2-0-mini-260215";
  const systemPrompt =
    "你是一个视频创意助手。用户会提供一段视频生成的提示词，请你使用网络搜索结果来丰富和优化这段提示词。" +
    "保持原始创意意图不变，但加入更生动的视觉细节、氛围描写或准确的场景参考。" +
    "直接输出优化后的提示词，不要添加任何解释或前缀。输出语言与用户输入语言保持一致。";

  try {
    const response = await fetch(`${VOLCENGINE_ARK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: chatModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `请优化以下视频生成提示词，结合网络搜索获取的相关信息来丰富细节：\n\n${prompt.trim()}` },
        ],
        stream: false,
        temperature: 0.7,
        max_tokens: 1024,
      }),
    });

    if (!response.ok) {
      console.warn(`[enhancePromptWithWebSearch] Ark chat returned ${response.status}, using original prompt`);
      return prompt;
    }

    const data = await response.json();
    const enhanced = data?.choices?.[0]?.message?.content?.trim();
    if (enhanced && enhanced.length > 0) {
      console.log(`[enhancePromptWithWebSearch] Enhanced: "${prompt.slice(0, 50)}..." → "${enhanced.slice(0, 50)}..."`);
      return enhanced;
    }
    return prompt;
  } catch (error) {
    console.warn(`[enhancePromptWithWebSearch] Failed: ${error?.message || "unknown"}, using original prompt`);
    return prompt;
  }
}

module.exports = {
  assertMediaGenerationModelConfigured,
  buildWan26ImageContent,
  synthesizeSpeechWithAliyun,
  testAliyunConnection,
  testYunwuConnection,
  extractAssetsWithAliyun,
  generateTextWithAliyun,
  generateImagesWithAliyun,
  hasAliyunApiKey,
  hasMediaGenerationApiKey,
  hasVolcengineArkApiKey,
  hasYunwuApiKey,
  getMediaGenerationProvider,
  isMediaGenerationModelConfigured,
  isSeedanceVideoModel,
  normalizeModelId,
  normalizeVoicePreset,
  parseAliyunVideoResult,
  parsePixverseVideoResult,
  parseSeedanceVideoResult,
  rewriteScriptWithAliyun,
  translateTextWithAliyun,
  summarizeReferenceImagesWithAliyun,
  splitStoryboardsWithAliyun,
  createAliyunVideoTask,
  validateWan26ReferenceSource,
  waitForAliyunTask,
  enhancePromptWithWebSearch,
};
