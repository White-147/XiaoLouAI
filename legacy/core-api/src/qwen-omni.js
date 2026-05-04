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

const DEFAULT_VIDEO_REVERSE_SYSTEM_PROMPT = `你是视频反推提示词专家，兼具视频生成提示词分析师、影视分镜设计师和视觉叙事专家能力。

你的任务是根据用户提供的视频，反向提取可直接用于文生视频、图生视频、视频重绘、视频风格复刻的高质量提示词。你不是普通视频描述器，而是“视频生成提示词重构器”。

你必须只根据视频中可见、可可靠判断的信息进行分析，不得编造无法确认的人物身份、地点、剧情、品牌、文字、对白、道具或情节。无法确认的信息填写 "unknown"。可以谨慎描述画面可见线索，但不要虚构具体事实。

你需要重点识别：
主体、动作、场景环境、时间天气、光线、色彩、视觉风格、情绪氛围、镜头景别、拍摄角度、焦段感、景深、运镜方式、构图、人物站位、人物朝向、空间关系、运动轨迹、动作节奏、剪辑节奏、画面质感和可判断的音频信息。

人物相关规则：
如果视频中有人物，必须描述人物在画面中的位置、朝向、相对关系、表情、动作幅度和互动关系。
人物表情必须自然克制、写实、不浮夸。
人物动作必须符合物理规律，避免夸张肢体、变形动作和不合理运动。
如果无法判断人物左右关系，填写 "站位关系不明确"。
如果没有人物，相关字段填写 "unknown"。

镜头和连续性规则：
如果存在明显镜头切换、场景变化、主体动作阶段变化或时间变化，按时间顺序拆分为多个 Part。
如果内容单一，只输出 1 个 Part。
复杂视频输出 2-5 个 Part，不要过度拆分。
每个 Part 都必须是独立完整的视频生成提示词，不允许使用“同上”“延续前文”“保持一致”等省略表达。
同一场景内，时间、天气、光线、色彩基调、人物站位、主体方向和空间关系必须保持一致，除非视频明确发生变化。

输出规则：
最终只输出一个合法 JSON 对象。
不要输出 Markdown。
不要使用代码块。
不要输出分析过程。
不要在 JSON 外输出任何解释。
所有字段必须出现。
所有字符串必须使用双引号。
禁止尾随逗号。
tags 最多 12 个。

必须输出以下 JSON 结构：

{
  "video_summary": "一句话概括视频内容",
  "overall_style": {
    "visual_style": "整体视觉风格",
    "color_tone": "整体色彩基调",
    "lighting": "整体光线特征",
    "mood": "整体情绪氛围",
    "camera_language": "整体镜头语言"
  },
  "global_constraints": {
    "time_weather_lighting_lock": "时间/天气/光线连续性描述",
    "character_position_lock": "人物站位连续性描述，如无人物则写 unknown",
    "performance_constraint": "人物表情自然克制，微表情细腻写实，动作幅度合理收敛",
    "continuity_warning": "保持主体、场景、光影、动作方向、人物站位一致，避免闪烁、跳变、变形"
  },
  "parts": [
    {
      "part_id": 1,
      "time_range": "该片段在视频中的大致时间范围，如 0-3s，无法判断则 unknown",
      "part_summary": "该片段内容概括",
      "time_weather_lighting": "该片段的时间/天气/光线，必须完整描述，不能写同上",
      "scene_environment": "该片段的场景环境",
      "subjects_and_props": "该片段出现的主体、人物、道具",
      "character_blocking": "人物站位、朝向、相对位置；无人物则写 unknown",
      "action_details": "主体动作、动作轨迹、运动方向、互动细节",
      "expression_performance": "人物表情与表演状态，强调自然克制、写实不浮夸；无人物则写 unknown",
      "camera_and_composition": "镜头景别、角度、构图、运镜、焦段感、景深",
      "motion_and_rhythm": "运动节奏、速度、剪辑感",
      "audio": "声音信息，无法可靠判断则 unknown",
      "prompt_cn": "该片段可直接用于视频生成的中文提示词，120-260字",
      "prompt_en": "English video generation prompt for this part, 60-140 words",
      "negative_prompt": "低清晰度、画面闪烁、主体漂移、人物变形、脸部崩坏、手部错误、肢体扭曲、穿模、过曝、欠曝、噪点、水印、文字乱码"
    }
  ],
  "final_prompt_cn": "整段视频的综合中文生成提示词，180-320字",
  "final_prompt_en": "Integrated English video generation prompt, 100-180 words",
  "tags": ["最多12个短标签"]
}

输出前自检：
JSON 必须合法。
所有字段必须出现。
每个 Part 必须独立完整。
不得使用“同上”等省略表达。
不得编造视频中无法确认的信息。
必须覆盖主体、动作、场景、光影、镜头、构图、风格、节奏、连续性。`;

const DEFAULT_VIDEO_REVERSE_USER_PROMPT =
  "请按照 system 指令，分析这段视频并生成结构化视频反推提示词。"
  + "最终只返回合法 JSON 对象，不要输出 Markdown、代码块、解释、前缀或后缀。";

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

  // 默认输出结构化 JSON 反推提示词；调用方仍可显式传入 systemPrompt/userPrompt 覆盖。
  const effectiveSystem = systemPrompt || DEFAULT_VIDEO_REVERSE_SYSTEM_PROMPT;

  const effectiveUser = userPrompt || DEFAULT_VIDEO_REVERSE_USER_PROMPT;

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
