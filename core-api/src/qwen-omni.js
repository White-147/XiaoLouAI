require("./env").loadEnvFiles();

const { readFileSync, statSync } = require("node:fs");
const { extname } = require("node:path");

const DEFAULT_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
// DashScope 2026 官方命名：Qwen3.5-Omni 系列 ID 带 `.5`。
// `qwen3-omni-plus`（无 .5）在 DashScope 上不存在，会直接 404。
// `qwen3.5-omni-flash` 为官方推荐的生产默认值，速度/质量/价格均衡。
// 若业务需要更高质量可改为 `qwen3.5-omni-plus`，或最低延迟 `qwen3.5-omni-light`；
// 若账号未开通 3.5 系列权限可回退到 `qwen-omni-turbo`。
const DEFAULT_MODEL = "qwen3.5-omni-flash";

// 允许前端按需切换的白名单。任何 body.model 不在白名单里的请求都会被 400
// 拒绝——避免前端传入任意字符串直接转发到 DashScope 导致 402/404/越权调用。
const ALLOWED_MODELS = Object.freeze([
  "qwen3.5-omni-plus",
  "qwen3.5-omni-flash",
  "qwen-omni-turbo",
]);

function isAllowedQwenOmniModel(value) {
  return typeof value === "string" && ALLOWED_MODELS.includes(value);
}

// Qwen-Omni accepts base64 data URIs for video; keep well below API limits.
const MAX_VIDEO_BYTES = 95 * 1024 * 1024; // 95 MiB

const VIDEO_MIME_BY_EXT = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
};

function getApiKey() {
  return process.env.QWEN_OMNI_API_KEY || process.env.DASHSCOPE_API_KEY || "";
}

function hasQwenOmniApiKey() {
  return Boolean(getApiKey());
}

function providerError(message, statusCode = 502, code = "QWEN_OMNI_ERROR") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function videoMimeFor(filePath) {
  const ext = (extname(filePath) || "").toLowerCase();
  return VIDEO_MIME_BY_EXT[ext] || "video/mp4";
}

function readVideoAsDataUri(absolutePath) {
  const stat = statSync(absolutePath);
  if (stat.size > MAX_VIDEO_BYTES) {
    throw providerError(
      `Video exceeds Qwen-Omni upload limit (${Math.round(stat.size / 1024 / 1024)} MiB > ${Math.round(
        MAX_VIDEO_BYTES / 1024 / 1024,
      )} MiB). 请上传更短或更小的视频。`,
      413,
      "VIDEO_TOO_LARGE",
    );
  }
  const buffer = readFileSync(absolutePath);
  return `data:${videoMimeFor(absolutePath)};base64,${buffer.toString("base64")}`;
}

/**
 * Parse a Server-Sent-Events stream coming back from Qwen-Omni's
 * chat-completions endpoint and accumulate the text content.
 */
async function consumeQwenOmniStream(response) {
  if (!response.body) {
    throw providerError("Qwen-Omni stream has no body", 502);
  }
  const decoder = new TextDecoder("utf-8");
  const reader = response.body.getReader();
  let buffered = "";
  let fullText = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += decoder.decode(value, { stream: true });
    // Split into SSE records ("data: ...\n\n")
    let idx;
    while ((idx = buffered.indexOf("\n\n")) !== -1) {
      const raw = buffered.slice(0, idx);
      buffered = buffered.slice(idx + 2);
      for (const rawLine of raw.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || !line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        const chunk = parsed?.choices?.[0]?.delta?.content;
        if (typeof chunk === "string") {
          fullText += chunk;
        } else if (Array.isArray(chunk)) {
          for (const part of chunk) {
            if (part && typeof part.text === "string") fullText += part.text;
          }
        }
        if (parsed?.error) {
          const msg = parsed.error?.message || "Qwen-Omni stream error";
          throw providerError(msg, 502, "QWEN_OMNI_STREAM_ERROR");
        }
      }
    }
  }
  return fullText.trim();
}

/**
 * Analyze a video with Qwen3.5-Omni and return a generated prompt describing it.
 *
 * Supply exactly one of `absolutePath` (local file) or `remoteUrl` (HTTP/HTTPS URL).
 * When a remote URL is provided it is passed directly to the Qwen-Omni API without
 * downloading, which is the most efficient path for externally-hosted assets.
 *
 * @param {Object} opts
 * @param {string} [opts.absolutePath] - local path to the video file (mutually exclusive with remoteUrl)
 * @param {string} [opts.remoteUrl]    - HTTP/HTTPS URL of the video (mutually exclusive with absolutePath)
 * @param {string} [opts.systemPrompt]
 * @param {string} [opts.userPrompt]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<string>} generated prompt text
 */
async function analyzeVideoWithQwenOmni({
  absolutePath,
  remoteUrl,
  systemPrompt,
  userPrompt,
  signal,
  modelOverride,
}) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw providerError(
      "QWEN_OMNI_API_KEY is not configured. 请在 core-api/.env.local 设置 QWEN_OMNI_API_KEY。",
      503,
      "PROVIDER_NOT_CONFIGURED",
    );
  }

  if (!absolutePath && !remoteUrl) {
    throw providerError("analyzeVideoWithQwenOmni: supply absolutePath or remoteUrl", 400, "BAD_INPUT");
  }

  const baseUrl = (process.env.QWEN_OMNI_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");
  // Priority: per-request override (already whitelisted by route layer)
  //        -> env QWEN_OMNI_MODEL (operator override, not validated)
  //        -> hardcoded DEFAULT_MODEL.
  const model =
    (typeof modelOverride === "string" && modelOverride.trim()) ||
    process.env.QWEN_OMNI_MODEL ||
    DEFAULT_MODEL;

  // Build the video_url value: prefer remote URL (no size limit on our side),
  // fall back to base64 data URI for local uploads.
  let videoUrlValue;
  if (remoteUrl) {
    videoUrlValue = remoteUrl;
  } else {
    videoUrlValue = readVideoAsDataUri(absolutePath);
  }

  // 默认输出中文反推提示词——与 /create/video-reverse 页面的"提示词默认中文"
  // 产品约束保持一致；如需改成英文，可由调用方显式传入 systemPrompt/userPrompt。
  const effectiveSystem =
    systemPrompt ||
    "你是一名专业的视频反推提示词工程师。请仔细观看输入视频，输出一段用于 AI 视频模型复现同类镜头的"
    + "高质量中文提示词。要求：\n"
    + "1. 仅输出一段简体中文文本，用逗号分隔的短句串联；\n"
    + "2. 覆盖主体对象、动作、镜头运动、构图、景别、光影、色彩、氛围、环境与整体视觉风格；\n"
    + "3. 保持专业、凝练，不要编号、不要项目符号、不要任何解释或前后缀；\n"
    + "4. 不要出现英文专有名词之外的英文语句，全部使用中文表达。";

  const effectiveUser =
    userPrompt ||
    "请按照 system 指令，为这段视频生成一段高质量的中文反推提示词，用于 AI 视频模型复现类似镜头。"
    + "只返回最终的中文 prompt 文本，不要加任何前缀/后缀/解释。";

  const payload = {
    model,
    stream: true,
    stream_options: { include_usage: true },
    modalities: ["text"],
    messages: [
      { role: "system", content: [{ type: "text", text: effectiveSystem }] },
      {
        role: "user",
        content: [
          { type: "video_url", video_url: { url: videoUrlValue } },
          { type: "text", text: effectiveUser },
        ],
      },
    ],
  };

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    let detail = "";
    try {
      const raw = await response.text();
      detail = raw;
      try {
        const parsed = JSON.parse(raw);
        detail = parsed?.error?.message || parsed?.message || raw;
      } catch {
        /* keep raw */
      }
    } catch {
      /* ignore */
    }
    console.error("[qwen-omni] request failed", {
      status: response.status,
      model,
      detail: String(detail || "").slice(0, 500),
    });
    throw providerError(
      `Qwen-Omni request failed (${response.status}): ${String(detail || "").slice(0, 300)}`,
      response.status || 502,
      "QWEN_OMNI_API_ERROR",
    );
  }

  const text = await consumeQwenOmniStream(response);
  if (!text) {
    throw providerError("Qwen-Omni returned empty content.", 502, "QWEN_OMNI_EMPTY_OUTPUT");
  }
  // Return both the text and the actual model used so the route layer can
  // echo the real model back to the client (distinguishes cases where the
  // route fell back to default vs. honored an override).
  return { text, model };
}

module.exports = {
  analyzeVideoWithQwenOmni,
  hasQwenOmniApiKey,
  isAllowedQwenOmniModel,
  ALLOWED_QWEN_OMNI_MODELS: ALLOWED_MODELS,
};
