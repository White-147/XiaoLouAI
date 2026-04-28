/**
 * vertex.js — Official Google Vertex AI provider
 *
 * Handles:
 *   1. Gemini image generation (gemini-3-pro-image-preview / gemini-3.1-flash-image-preview)
 *   2. Veo video generation (veo-3.1-generate-001, veo-3.1-fast-generate-001, veo-3.1-lite-generate-001)
 *   3. Gemini chat (gemini-3-flash-preview, gemini-3.1-pro-preview)
 *
 * Model ID convention in this project:
 *   internalId  : "vertex:<rawModelId>"  (e.g. "vertex:gemini-3-pro-image-preview")
 *   rawModelId  : what actually gets sent to the Vertex API  (e.g. "gemini-3-pro-image-preview")
 *   label       : ends with "+" to distinguish from Yunwu-routed variants
 *
 * Excluded models (do NOT add):
 *   - gemini-3-pro-preview       → discontinued by Google 2026-03-26
 *   - veo-3.1-generate-preview   → removed by Google 2026-04-02
 *   - veo-3.1-fast-generate-preview → removed by Google 2026-04-02
 *   - "Veo 3.1 4K" as a model   → 4K is a resolution parameter on existing models, not a separate model
 *
 * Auth priority (checked at call time, not at startup):
 *   1. VERTEX_API_KEY env var  — Vertex AI API key (Cloud Console → APIs → Vertex AI → Credentials)
 *   2. GOOGLE_APPLICATION_CREDENTIALS env var — path to service-account JSON
 *   If neither is set the call throws with a descriptive error.
 *
 * Env vars:
 *   VERTEX_PROJECT_ID       — GCP project id (e.g. "xldm-test-01")
 *   VERTEX_GEMINI_LOCATION  — Gemini location (default: "global")
 *   VERTEX_VEO_LOCATION     — Veo location (default: "us-central1")
 *   VERTEX_GCS_BUCKET       — GCS bucket for Veo output (e.g. "gs://my-xiaolou-veo-output")
 *   VERTEX_API_KEY          — API key for Vertex AI (preferred auth method)
 *   GOOGLE_APPLICATION_CREDENTIALS — path to service-account JSON (alternative auth)
 */

require("./env").loadEnvFiles();

const { createSign } = require("node:crypto");
const { readFileSync, writeFileSync, mkdirSync } = require("node:fs");
const { resolve: resolvePath } = require("node:path");
const { randomUUID } = require("node:crypto");
const { createUploadFromBuffer } = require("./uploads");

// ─── Constants ───────────────────────────────────────────────────────────────

/** Strip "vertex:" prefix to get the raw model ID for the API. */
function stripVertexPrefix(modelId) {
  return String(modelId || "").replace(/^vertex:/, "");
}

/** All internal IDs that route to this provider. */
const VERTEX_IMAGE_MODEL_IDS = new Set([
  "vertex:gemini-3-pro-image-preview",
  "vertex:gemini-3.1-flash-image-preview",
]);

const VERTEX_VIDEO_MODEL_IDS = new Set([
  "vertex:veo-3.1-generate-001",
  "vertex:veo-3.1-fast-generate-001",
  "vertex:veo-3.1-lite-generate-001",
]);

const VERTEX_CHAT_MODEL_IDS = new Set([
  "vertex:gemini-3-flash-preview",
  "vertex:gemini-3.1-pro-preview",
]);

function isVertexModel(modelId) {
  return String(modelId || "").startsWith("vertex:");
}

function isVertexImageModel(modelId) {
  return VERTEX_IMAGE_MODEL_IDS.has(String(modelId || ""));
}

function isVertexVideoModel(modelId) {
  return VERTEX_VIDEO_MODEL_IDS.has(String(modelId || ""));
}

function isVertexChatModel(modelId) {
  return VERTEX_CHAT_MODEL_IDS.has(String(modelId || ""));
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function hasVertexApiKey() {
  return Boolean(process.env.VERTEX_API_KEY);
}

function hasVertexServiceAccount() {
  return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

function hasVertexCredentials() {
  return hasVertexApiKey() || hasVertexServiceAccount();
}

function getVertexApiKey() {
  return process.env.VERTEX_API_KEY || "";
}

function getVertexProjectId() {
  return process.env.VERTEX_PROJECT_ID || "";
}

function getVertexGeminiLocation() {
  return process.env.VERTEX_GEMINI_LOCATION || "global";
}

function getVertexVeoLocation() {
  return process.env.VERTEX_VEO_LOCATION || "us-central1";
}

function getVertexGcsBucket() {
  return (process.env.VERTEX_GCS_BUCKET || "").replace(/\/$/, "");
}

const VERTEX_PROMPT_POLICY_REJECTION_CODE = "PROMPT_REJECTED_BY_PROVIDER";

function extractVertexSupportCode(message) {
  const match = String(message || "").match(/Support codes?:\s*([A-Za-z0-9_-]+)/i);
  return match ? match[1] : "";
}

function isVertexPromptPolicyRejection(message) {
  const text = String(message || "").toLowerCase();
  if (!text) return false;
  return (
    text.includes("prompt could not be submitted") ||
    (text.includes("sensitive words") && text.includes("responsible ai")) ||
    (text.includes("responsible ai") && (text.includes("violat") || text.includes("allowlisting")))
  );
}

function toVertexPromptPolicyError(message, details = {}) {
  const providerMessage = String(message || "").trim();
  const supportCode = extractVertexSupportCode(providerMessage);
  const userMessage = [
    "Google Vertex Veo refused this prompt before generation because it matched Google's Responsible AI safety policy.",
    "Please rephrase the prompt with more neutral wording and try again.",
    supportCode ? `Support code: ${supportCode}` : "",
  ].filter(Boolean).join(" ");

  const wrapped = new Error(userMessage);
  wrapped.name = "VertexPromptRejectedError";
  wrapped.code = VERTEX_PROMPT_POLICY_REJECTION_CODE;
  wrapped.failureReason = VERTEX_PROMPT_POLICY_REJECTION_CODE;
  wrapped.status = Number(details.status || 400);
  wrapped.statusCode = wrapped.status;
  wrapped.provider = "google-vertex";
  wrapped.providerMessage = providerMessage;
  wrapped.supportCode = supportCode || null;
  wrapped.userMessage = userMessage;
  wrapped.isProviderPolicyRejection = true;
  if (details.providerCode) wrapped.providerCode = details.providerCode;
  if (details.cause) wrapped.cause = details.cause;
  return wrapped;
}

function unwrapVertexApiError(error) {
  const rawMessage =
    typeof error?.message === "string" && error.message.trim()
      ? error.message.trim()
      : String(error ?? "Vertex request failed");

  const rawStatus = error?.statusCode ?? error?.status;
  let status = Number(rawStatus);
  if (!Number.isFinite(status)) status = 0;

  let code = typeof error?.code === "string" ? error.code.trim() : "";
  if (!code && typeof error?.status === "string" && error.status.trim()) {
    code = error.status.trim();
  }
  let message = rawMessage || "Vertex request failed";

  if (rawMessage.startsWith("{")) {
    try {
      const parsed = JSON.parse(rawMessage);
      const embedded = parsed?.error;
      if (embedded && typeof embedded === "object") {
        if (!status) {
          if (typeof embedded.statusCode === "number") status = embedded.statusCode;
          else if (typeof embedded.code === "number") status = embedded.code;
        }

        if (!code) {
          if (typeof embedded.status === "string" && embedded.status.trim()) {
            code = embedded.status.trim();
          } else if (typeof embedded.code === "string" && embedded.code.trim()) {
            code = embedded.code.trim();
          }
        }

        if (typeof embedded.message === "string" && embedded.message.trim()) {
          message = embedded.message.trim();
        }
      }
    } catch {
      // Keep the original SDK message when it is not JSON.
    }
  }

  return {
    status,
    code: code ? String(code).toUpperCase() : "",
    message: message || "Vertex request failed",
  };
}

function toVertexApiError(error) {
  const normalized = unwrapVertexApiError(error);
  if (isVertexPromptPolicyRejection(normalized.message)) {
    return toVertexPromptPolicyError(normalized.message, {
      status: normalized.status,
      providerCode: normalized.code,
      cause: error,
    });
  }

  const wrapped = new Error(normalized.message || "Vertex request failed");

  wrapped.name =
    typeof error?.name === "string" && error.name.trim()
      ? error.name.trim()
      : "VertexApiError";

  if (normalized.status) {
    wrapped.status = normalized.status;
    wrapped.statusCode = normalized.status;
  }
  if (normalized.code) {
    wrapped.code = normalized.code;
  }

  return wrapped;
}

/**
 * Assert credentials are present for Gemini image models.
 * Per API doc, the publishers endpoint (aiplatform.googleapis.com/v1/publishers/...)
 * only needs an API key — no project ID required.
 */
function assertVertexGeminiConfigured() {
  if (!hasVertexCredentials()) {
    throw new Error(
      "Vertex AI: 未找到认证凭据。请在 .env.local 中设置 VERTEX_API_KEY=your-api-key"
    );
  }
}

/**
 * Assert full Vertex config for Veo video models.
 * These use the projects/{project}/... endpoint and need project ID + GCS bucket.
 */
function assertVertexConfigured() {
  if (!getVertexProjectId()) {
    throw new Error("Vertex AI: VERTEX_PROJECT_ID 未配置。请在 .env.local 中设置 VERTEX_PROJECT_ID=your-gcp-project-id");
  }
  if (!hasVertexCredentials()) {
    throw new Error(
      "Vertex AI: 未找到认证凭据。请设置以下之一：\n" +
      "  VERTEX_API_KEY=your-vertex-api-key  （推荐，从 Google Cloud Console 创建）\n" +
      "  GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json"
    );
  }
}

/** Cache for OAuth2 access tokens from service account. */
let _cachedToken = null;
let _tokenExpiry = 0;

/** Get an access token for the Vertex REST API (service account path). */
async function getServiceAccountAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_cachedToken && _tokenExpiry > now + 60) {
    return _cachedToken;
  }

  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!credPath) throw new Error("GOOGLE_APPLICATION_CREDENTIALS not set");

  const creds = JSON.parse(readFileSync(credPath, "utf-8"));
  if (!creds.private_key || !creds.client_email) {
    throw new Error("Service account JSON is missing private_key or client_email");
  }

  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claim = Buffer.from(JSON.stringify({
    iss: creds.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now,
  })).toString("base64url");

  const unsigned = `${header}.${claim}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const sig = sign.sign(creds.private_key, "base64url");
  const jwt = `${unsigned}.${sig}`;

  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Service account token exchange failed: ${body}`);
  }

  const data = await resp.json();
  _cachedToken = data.access_token;
  _tokenExpiry = now + (data.expires_in || 3600);
  return _cachedToken;
}

/** Get Authorization header value for Vertex REST calls. */
/**
 * Returns the auth header for Vertex REST calls.
 *
 * Veo uses project-scoped endpoints (https://{location}-aiplatform.googleapis.com/v1/projects/...)
 * which require OAuth2 Bearer Token, not an API key.
 * Prefer service account Bearer Token when available; fall back to API key only for
 * publisher-scoped Gemini endpoints (no project in URL).
 *
 * @param {boolean} [preferServiceAccount=false] - Force Bearer token even if API key is set
 */
async function getVertexAuthHeader(preferServiceAccount = false) {
  if (hasVertexServiceAccount() && (preferServiceAccount || !hasVertexApiKey())) {
    const token = await getServiceAccountAccessToken();
    return `Bearer ${token}`;
  }
  // API key — appended as query param in the URL via buildVertexUrl(), not a header
  return null;
}

/**
 * Build a Vertex REST URL.
 * For project-scoped Veo endpoints, we use Bearer token auth (no key in URL).
 * For publisher-scoped Gemini endpoints, we append ?key= if API key is set.
 *
 * @param {string} url
 * @param {boolean} [useServiceAccount=false] - If true, don't append API key (use Bearer instead)
 */
function buildVertexUrl(url, useServiceAccount = false) {
  if (!useServiceAccount && hasVertexApiKey()) {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}key=${encodeURIComponent(getVertexApiKey())}`;
  }
  return url;
}

// ─── Gemini Image Generation via @google/genai SDK ───────────────────────────

let _vertexGenAI = null;

function getVertexGenAI() {
  if (_vertexGenAI) return _vertexGenAI;
  const { GoogleGenAI } = require("@google/genai");

  const location = getVertexGeminiLocation() || "global";

  if (hasVertexApiKey()) {
    // API-key auth: per @google/genai SDK, project/location must NOT be passed
    // alongside apiKey when vertexai: true (they are mutually exclusive).
    // The SDK will use the publishers endpoint automatically.
    _vertexGenAI = new GoogleGenAI({ vertexai: true, apiKey: getVertexApiKey() });
  } else {
    // Service-account auth: project is required.
    _vertexGenAI = new GoogleGenAI({
      vertexai: true,
      project: getVertexProjectId(),
      location,
    });
  }

  return _vertexGenAI;
}

/**
 * Generate images with Vertex Gemini image models.
 *
 * @param {object} params
 * @param {string} params.internalModelId  - e.g. "vertex:gemini-3-pro-image-preview"
 * @param {string} params.prompt
 * @param {number} [params.count=1]
 * @param {string} [params.aspectRatio]
 * @param {string} [params.resolution]
 * @param {string|null} [params.referenceImageUrl]      - single base64 data-url or http url
 * @param {string[]} [params.referenceImageUrls]        - multiple refs (multi-image mode)
 * @param {string} [params.negativePrompt]
 * @returns {Promise<string[]>}  Array of image data-URLs (data:image/...;base64,...)
 */
async function generateVertexGeminiImages({
  internalModelId,
  prompt,
  count = 1,
  aspectRatio,
  resolution,
  referenceImageUrl,
  referenceImageUrls = [],
  negativePrompt,
}) {
  assertVertexGeminiConfigured();
  const rawModelId = stripVertexPrefix(internalModelId);
  const ai = getVertexGenAI();

  // Build the list of reference images (deduplicated, first image wins for single-ref)
  const allRefs = referenceImageUrls.length
    ? referenceImageUrls
    : referenceImageUrl
      ? [referenceImageUrl]
      : [];

  const results = [];

  for (let i = 0; i < Math.max(1, count); i++) {
    const parts = [];

    // Text prompt
    let fullPrompt = String(prompt || "").trim();
    if (negativePrompt?.trim()) {
      fullPrompt += `\n\nNegative prompt: ${negativePrompt.trim()}`;
    }
    parts.push({ text: fullPrompt });

    // Reference images
    for (const ref of allRefs.slice(0, 16)) {
      const normalized = String(ref || "").trim();
      if (!normalized) continue;

      if (/^data:/i.test(normalized)) {
        // Inline data URL
        const m = normalized.match(/^data:([^;]+);base64,(.+)$/i);
        if (m) {
          parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
        }
      } else if (/^https?:\/\//i.test(normalized)) {
        // Remote URL — fetch and inline
        try {
          const resp = await fetch(normalized);
          if (resp.ok) {
            const buf = await resp.arrayBuffer();
            const ct = resp.headers.get("content-type") || "image/jpeg";
            const b64 = Buffer.from(buf).toString("base64");
            parts.push({ inlineData: { mimeType: ct.split(";")[0].trim(), data: b64 } });
          }
        } catch (e) {
          console.warn("[vertex] Failed to fetch reference image:", e?.message);
        }
      }
      // Only first image for true single-reference requests (callers pass one URL)
    }

    const imageConfig = {};
    if (aspectRatio) {
      imageConfig.aspectRatio = aspectRatio;
    }
    if (resolution) {
      imageConfig.imageSize = resolution;
    }

    let response;
    try {
      response = await ai.models.generateContent({
        model: rawModelId,
        contents: [{ role: "user", parts }],
        config: {
          responseModalities: ["IMAGE"],
          ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
        },
      });
    } catch (error) {
      throw toVertexApiError(error);
    }

    // Extract image parts from response
    const candidates = response.candidates || [];
    for (const candidate of candidates) {
      const contentParts = candidate?.content?.parts || [];
      for (const part of contentParts) {
        if (part.inlineData?.data) {
          const mimeType = part.inlineData.mimeType || "image/png";
          results.push(`data:${mimeType};base64,${part.inlineData.data}`);
        }
      }
    }

    if (results.length >= count) break;
  }

  if (!results.length) {
    throw new Error(`Vertex Gemini image generation returned no images for model ${rawModelId}`);
  }
  return results.slice(0, count);
}

// ─── Veo Video Generation via REST API ───────────────────────────────────────

/**
 * Start a Veo video generation operation (async long-running).
 *
 * @param {object} params
 * @param {string} params.internalModelId  - e.g. "vertex:veo-3.1-generate-001"
 * @param {string} params.prompt
 * @param {string} [params.referenceImageBase64]  - base64 image for image-to-video
 * @param {string} [params.lastFrameBase64]       - base64 image for the last frame (start-end frame mode); mapped to instance.lastFrame in the Veo API
 * @param {string} [params.aspectRatio]           - "16:9" | "9:16"
 * @param {number} [params.durationSeconds]
 * @param {string} [params.resolution]            - "720p" | "1080p"
 * @param {number} [params.seed]
 * @param {boolean} [params.generateAudio]
 * @param {string[]} [params.referenceImages]     - array of base64 images for multi-ref
 * @returns {Promise<string>}  Operation name (e.g. "projects/.../operations/...")
 */
async function startVertexVeoTask({
  internalModelId,
  prompt,
  referenceImageBase64,
  lastFrameBase64,
  aspectRatio = "16:9",
  durationSeconds = 8,
  resolution,
  seed,
  generateAudio = false,
  referenceImages = [],
}) {
  assertVertexConfigured();
  const rawModelId = stripVertexPrefix(internalModelId);
  const project = getVertexProjectId();
  const location = getVertexVeoLocation();
  const gcsBucket = getVertexGcsBucket();

  if (!gcsBucket) {
    throw new Error("Vertex Veo: VERTEX_GCS_BUCKET 未配置。请设置 VERTEX_GCS_BUCKET=gs://your-bucket");
  }

  const outputPrefix = `${gcsBucket}/veo/${randomUUID()}`;
  const normalizedAspectRatio = ["16:9", "9:16"].includes(String(aspectRatio || "").trim())
    ? String(aspectRatio).trim()
    : "16:9";

  // Build instance
  const instance = { prompt: String(prompt || "").trim() };

  // Single-reference image (image-to-video)
  if (referenceImageBase64) {
    instance.image = {
      bytesBase64Encoded: referenceImageBase64,
      mimeType: "image/jpeg",
    };
  }

  // Last frame (first+last frame mode).
  // The Veo REST API field is "lastFrame" — NOT "lastImage". Using the wrong
  // name causes the API to silently ignore the last frame and fall back to
  // plain image-to-video using only the first frame/reference image.
  // Reference: https://cloud.google.com/vertex-ai/generative-ai/docs/video/generate-videos-from-first-and-last-frames
  if (lastFrameBase64) {
    instance.lastFrame = {
      bytesBase64Encoded: lastFrameBase64,
      mimeType: "image/jpeg",
    };
  }

  // Multi-reference images (style/subject references)
  if (referenceImages.length > 0) {
    instance.referenceImages = referenceImages.slice(0, 3).map((b64, idx) => ({
      referenceType: "asset",
      referenceId: idx,
      image: { bytesBase64Encoded: b64, mimeType: "image/jpeg" },
    }));
  }

  const parameters = {
    aspectRatio: normalizedAspectRatio,
    sampleCount: 1,
    durationSeconds: Number(durationSeconds) || 8,
    enhancePrompt: true,
    generateAudio: Boolean(generateAudio),
    storageUri: outputPrefix,
  };
  if (resolution) {
    parameters.resolution = String(resolution);
  }
  if (seed != null) {
    parameters.seed = Number(seed);
  }

  // Veo uses project-scoped endpoint — must use service account Bearer token, not API key
  const useServiceAccount = hasVertexServiceAccount();
  const url = buildVertexUrl(
    `https://${location}-aiplatform.googleapis.com/v1/projects/${project}/locations/${location}/publishers/google/models/${rawModelId}:predictLongRunning`,
    useServiceAccount
  );

  const headers = { "Content-Type": "application/json" };
  const authHeader = await getVertexAuthHeader(/* preferServiceAccount= */ true);
  if (authHeader) headers["Authorization"] = authHeader;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ instances: [instance], parameters }),
  });

  const body = await resp.text();
  if (!resp.ok) {
    const normalizedError = toVertexApiError({ message: body, status: resp.status });
    if (normalizedError.code === VERTEX_PROMPT_POLICY_REJECTION_CODE) {
      throw normalizedError;
    }
    normalizedError.message = `Vertex Veo operation start failed (${resp.status}): ${normalizedError.message || body.slice(0, 800)}`;
    throw normalizedError;
  }

  const data = JSON.parse(body);
  const operationName = data.name;
  if (!operationName) {
    throw new Error(`Vertex Veo: response has no operation name: ${body.slice(0, 400)}`);
  }

  return operationName;
}

/**
 * Poll a Veo long-running operation.
 *
 * @param {string} operationName - full operation resource name
 * @returns {Promise<{done: boolean, videoGcsUri?: string, error?: string}>}
 */
/**
 * Poll a Veo long-running operation using the :fetchPredictOperation endpoint.
 *
 * Per API doc: POST /v1/projects/{PROJECT_ID}/locations/{LOCATION_ID}/publishers/google/models/{MODEL_ID}:fetchPredictOperation
 * with body { "operationName": "<full operation name>" }
 *
 * @param {string} operationName - full operation resource name returned by :predictLongRunning
 * @returns {Promise<{done: boolean, videoGcsUri?: string, error?: string}>}
 */
async function pollVertexVeoTask(operationName) {
  // Extract model path prefix from operation name:
  // e.g. "projects/proj/locations/us-central1/publishers/google/models/veo-3.1-generate-001/operations/123"
  // → model path: "projects/proj/locations/us-central1/publishers/google/models/veo-3.1-generate-001"
  const modelPathMatch = operationName.match(
    /^(projects\/[^/]+\/locations\/[^/]+\/publishers\/google\/models\/[^/]+)/
  );
  if (!modelPathMatch) {
    throw new Error(`Vertex Veo: cannot parse operation name: ${operationName}`);
  }
  const modelPath = modelPathMatch[1];

  // Extract location for the regional hostname
  const locationMatch = operationName.match(/locations\/([^/]+)/);
  const location = locationMatch ? locationMatch[1] : getVertexVeoLocation();

  // Veo poll also uses project-scoped endpoint — prefer service account Bearer token
  const useServiceAccount = hasVertexServiceAccount();
  const url = buildVertexUrl(
    `https://${location}-aiplatform.googleapis.com/v1/${modelPath}:fetchPredictOperation`,
    useServiceAccount
  );

  const headers = { "Content-Type": "application/json" };
  const authHeader = await getVertexAuthHeader(/* preferServiceAccount= */ true);
  if (authHeader) headers["Authorization"] = authHeader;

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ operationName }),
  });

  const body = await resp.text();

  if (!resp.ok) {
    const normalizedError = toVertexApiError({ message: body, status: resp.status });
    if (normalizedError.code === VERTEX_PROMPT_POLICY_REJECTION_CODE) {
      throw normalizedError;
    }
    normalizedError.message = `Vertex Veo poll failed (${resp.status}): ${normalizedError.message || body.slice(0, 400)}`;
    throw normalizedError;
  }

  const data = JSON.parse(body);

  if (!data.done) {
    return { done: false };
  }

  if (data.error) {
    return { done: true, error: toVertexApiError(data.error) };
  }

  // Extract GCS URI — handle both response shapes from the API
  const samples = data.response?.generateVideoResponse?.generatedSamples
    || data.response?.videos
    || [];

  const firstSample = samples[0];
  const gcsUri = firstSample?.video?.uri || firstSample?.gcsUri || null;

  if (!gcsUri) {
    return {
      done: true,
      error: `Veo operation completed but no video URI found: ${JSON.stringify(data.response).slice(0, 400)}`,
    };
  }

  return { done: true, videoGcsUri: gcsUri };
}

/**
 * Download a GCS file and save it as a local upload, returning the upload path.
 *
 * @param {string} gcsUri   - "gs://bucket/path/to/file.mp4"
 * @returns {Promise<{urlPath: string, absolutePath: string}>}
 */
async function downloadGCSVideoToUpload(gcsUri) {
  // Parse gs://bucket/path
  const m = gcsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) throw new Error(`Invalid GCS URI: ${gcsUri}`);
  const bucket = m[1];
  const object = m[2];

  // Build download URL
  const encodedObject = encodeURIComponent(object);
  let downloadUrl = `https://storage.googleapis.com/download/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodedObject}?alt=media`;

  const headers = {};
  // GCS downloads require OAuth2 Bearer token — Vertex API key is not accepted by Cloud Storage.
  // Prefer service account auth; fall back to API key only if no SA is configured.
  if (hasVertexServiceAccount()) {
    const token = await getServiceAccountAccessToken();
    headers["Authorization"] = `Bearer ${token}`;
  } else if (hasVertexApiKey()) {
    downloadUrl += `&key=${encodeURIComponent(getVertexApiKey())}`;
  }

  const resp = await fetch(downloadUrl, { headers });
  if (!resp.ok) {
    const errBody = await resp.text().catch(() => "");
    throw new Error(`GCS download failed (${resp.status}): ${gcsUri} — ${errBody.slice(0, 200)}`);
  }

  const buffer = Buffer.from(await resp.arrayBuffer());
  const originalName = object.split("/").pop() || "veo_output.mp4";

  const upload = await createUploadFromBuffer({
    buffer,
    originalName,
    kind: "generated-video",
    contentType: "video/mp4",
  });

  return upload;
}

// ─── Veo polling with timeout ─────────────────────────────────────────────────

/**
 * Wait for a Veo operation to complete.
 * Returns {videoGcsUri} on success or throws on timeout/error.
 *
 * @param {string} operationName
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs=600000]   - 10 minutes default
 * @param {number} [opts.intervalMs=8000]    - poll every 8s
 * @param {function} [opts.onProgress]       - callback(fraction, message)
 */
async function waitForVertexVeoOperation(operationName, opts = {}) {
  const timeoutMs = opts.timeoutMs || 10 * 60 * 1000;
  const intervalMs = opts.intervalMs || 8000;
  const onProgress = opts.onProgress || null;
  const start = Date.now();

  let attempt = 0;
  while (true) {
    attempt++;
    const elapsed = Date.now() - start;

    if (elapsed > timeoutMs) {
      throw new Error(
        `Vertex Veo operation timed out after ${Math.round(elapsed / 1000)}s: ${operationName}`
      );
    }

    const result = await pollVertexVeoTask(operationName);

    if (result.done) {
      if (result.error) {
        if (result.error instanceof Error) {
          throw result.error;
        }
        const normalizedError = toVertexApiError(new Error(`Vertex Veo failed: ${result.error}`));
        throw normalizedError;
      }
      return result;
    }

    const fraction = Math.min(0.9, elapsed / timeoutMs);
    if (onProgress) {
      onProgress(fraction, `Veo 生成中… (${Math.round(elapsed / 1000)}s)`);
    }

    await new Promise((res) => setTimeout(res, intervalMs));
  }
}

// ─── Gemini Chat OpenAI-compatible proxy ─────────────────────────────────────

/**
 * Generate a chat completion using Vertex Gemini (OpenAI-compatible output format).
 *
 * @param {object} params
 * @param {string} params.internalModelId  - "vertex:gemini-3-flash-preview"
 * @param {Array}  params.messages         - OpenAI messages array
 * @param {number} [params.max_tokens]
 * @param {number} [params.temperature]
 */
async function generateVertexGeminiChat({
  internalModelId,
  messages,
  max_tokens,
  temperature,
  useGoogleSearch = false,
}) {
  assertVertexGeminiConfigured();
  const rawModelId = stripVertexPrefix(internalModelId);
  const ai = getVertexGenAI();

  // Convert OpenAI messages to Gemini contents
  const contents = [];
  let systemInstruction = null;

  for (const msg of messages || []) {
    if (msg.role === "system") {
      systemInstruction = String(msg.content || "");
      continue;
    }
    const role = msg.role === "assistant" ? "model" : "user";
    contents.push({ role, parts: [{ text: String(msg.content || "") }] });
  }

  const config = {};
  if (max_tokens) config.maxOutputTokens = max_tokens;
  if (temperature != null) config.temperature = temperature;
  if (systemInstruction) config.systemInstruction = systemInstruction;
  if (useGoogleSearch) {
    config.tools = [{ googleSearch: {} }];
  }

  let response;
  try {
    response = await ai.models.generateContent({
      model: rawModelId,
      contents,
      config,
    });
  } catch (error) {
    throw toVertexApiError(error);
  }

  const text =
    (typeof response.text === "function"
      ? response.text()
      : typeof response.text === "string"
        ? response.text
        : "") ||
    response.candidates?.[0]?.content?.parts?.[0]?.text ||
    "";
  const groundingMetadata = response.candidates?.[0]?.groundingMetadata || null;
  const groundingSources = Array.isArray(groundingMetadata?.groundingChunks)
    ? groundingMetadata.groundingChunks
        .map((chunk) => chunk?.web || chunk)
        .filter(Boolean)
        .map((item) => ({
          title: String(item?.title || item?.domain || item?.uri || "").slice(0, 160),
          uri: String(item?.uri || "").slice(0, 500),
        }))
        .filter((item) => item.title || item.uri)
        .slice(0, 8)
    : [];

  // Return in OpenAI-compatible format
  return {
    id: `chatcmpl-${randomUUID().slice(0, 8)}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: internalModelId,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: text },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
    },
    groundingMetadata,
    groundingSources,
  };
}

/**
 * Get the list of available Vertex Gemini chat models in OpenAI-compatible format.
 */
function getVertexChatModelList() {
  const models = [
    // Preview models — available but not GA
    {
      id: "vertex:gemini-3-flash-preview",
      label: "Gemini 3+",
      rawModelId: "gemini-3-flash-preview",
      note: "Gemini 3 Flash — Preview (Vertex AI)",
    },
    {
      id: "vertex:gemini-3.1-pro-preview",
      label: "Gemini 3.1+",
      rawModelId: "gemini-3.1-pro-preview",
      note: "Gemini 3.1 Pro — Preview (Vertex AI)",
    },
  ];

  return {
    object: "list",
    data: models.map((m) => ({
      id: m.id,
      object: "model",
      created: 1700000000,
      owned_by: "google-vertex",
      // extra metadata for the UI
      label: m.label,
      rawModelId: m.rawModelId,
      note: m.note,
    })),
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Model classification
  isVertexModel,
  isVertexImageModel,
  isVertexVideoModel,
  isVertexChatModel,
  stripVertexPrefix,
  VERTEX_IMAGE_MODEL_IDS,
  VERTEX_VIDEO_MODEL_IDS,
  VERTEX_CHAT_MODEL_IDS,

  // Auth checks
  hasVertexApiKey,
  hasVertexCredentials,
  getVertexProjectId,
  getVertexGcsBucket,

  // Image generation
  generateVertexGeminiImages,

  // Video generation
  startVertexVeoTask,
  pollVertexVeoTask,
  waitForVertexVeoOperation,
  downloadGCSVideoToUpload,

  // Chat
  generateVertexGeminiChat,
  getVertexChatModelList,
};
