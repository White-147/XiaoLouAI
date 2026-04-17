const { EventEmitter } = require("node:events");
const { randomUUID, createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const {
  createUploadFromBuffer,
  readUploadByUrlPath,
} = require("./uploads");
const {
  assertMediaGenerationModelConfigured,
  createAliyunVideoTask,
  extractAssetsWithAliyun,
  generateImagesWithAliyun,
  getMediaGenerationProvider,
  hasAliyunApiKey,
  hasMediaGenerationApiKey,
  hasVolcengineArkApiKey,
  hasYunwuApiKey,
  isSeedanceVideoModel,
  normalizeModelId,
  normalizeVoicePreset,
  parseAliyunVideoResult,
  parsePixverseVideoResult,
  parseSeedanceVideoResult,
  rewriteScriptWithAliyun,
  splitStoryboardsWithAliyun,
  synthesizeSpeechWithAliyun,
  testAliyunConnection,
  waitForAliyunTask,
  enhancePromptWithWebSearch,
} = require("./aliyun");
const { setEnvValue, unsetEnvValue } = require("./env");
const { createSeedData } = require("./mock-data");

function clone(value) {
  return structuredClone(value);
}

const DEFAULT_API_CENTER_VENDOR_CATALOG = (() => {
  const seedState = createSeedData();
  return Array.isArray(seedState?.apiCenterConfig?.vendors) ? clone(seedState.apiCenterConfig.vendors) : [];
})();

function apiError(statusCode, code, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function normalizeEmail(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || null;
}

function normalizePhone(value) {
  const normalized = String(value || "").trim();
  return normalized || null;
}

function requireText(value, fieldName, label) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw apiError(400, "BAD_REQUEST", `${label || fieldName} is required.`);
  }
  return normalized;
}

function sameCalendarDay(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function sameCalendarMonth(left, right) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}

function hashPassword(password) {
  const salt = randomUUID().slice(0, 16);
  const hash = createHash("sha256").update(salt + password).digest("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":", 2);
  const computed = createHash("sha256").update(salt + password).digest("hex");
  return computed === hash;
}

function generateAuthToken(userId) {
  const payload = `${userId}:${Date.now()}:${randomUUID()}`;
  return Buffer.from(payload).toString("base64url");
}

function decodeAuthToken(token) {
  if (!token) return null;
  try {
    const decoded = Buffer.from(token, "base64url").toString();
    const [userId] = decoded.split(":", 2);
    return userId || null;
  } catch {
    return null;
  }
}

function buildTempPassword() {
  return `XL-${randomUUID().slice(0, 4).toUpperCase()}-${randomUUID().slice(5, 9).toUpperCase()}`;
}

function isApiCenterRuntimeProvider(vendorId) {
  return vendorId === "aliyun-bailian";
}

function syncApiCenterRuntimeVendorState(config) {
  if (!config || !Array.isArray(config.vendors)) {
    return false;
  }

  let changed = false;

  for (const vendor of config.vendors) {
    if (!isApiCenterRuntimeProvider(vendor.id)) {
      continue;
    }

    const apiKeyConfigured = hasAliyunApiKey() || hasYunwuApiKey();
    if (vendor.apiKeyConfigured !== apiKeyConfigured) {
      vendor.apiKeyConfigured = apiKeyConfigured;
      changed = true;
    }

    if (!apiKeyConfigured && vendor.connected) {
      vendor.connected = false;
      changed = true;
    }
  }

  return changed;
}

function ensureApiCenterVendorCatalog(config) {
  if (!config || !Array.isArray(config.vendors)) {
    return false;
  }

  let changed = false;

  for (const defaultVendor of DEFAULT_API_CENTER_VENDOR_CATALOG) {
    let vendor = config.vendors.find((item) => item.id === defaultVendor.id);
    if (!vendor) {
      config.vendors.push(clone(defaultVendor));
      changed = true;
      continue;
    }

    const existingDomainSet = new Set(Array.isArray(vendor.supportedDomains) ? vendor.supportedDomains : []);
    for (const domain of defaultVendor.supportedDomains || []) {
      if (!existingDomainSet.has(domain)) {
        vendor.supportedDomains = [...existingDomainSet, domain];
        existingDomainSet.add(domain);
        changed = true;
      }
    }

    const existingModels = Array.isArray(vendor.models) ? vendor.models : [];
    if (!Array.isArray(vendor.models)) {
      vendor.models = existingModels;
      changed = true;
    }

    for (const defaultModel of defaultVendor.models || []) {
      if (!existingModels.some((item) => item.id === defaultModel.id)) {
        existingModels.push(clone(defaultModel));
        changed = true;
      }
    }
  }

  return changed;
}

const API_CENTER_MODEL_ASSIGNMENT_MAP = {
  textModelId: ["global", "script", "assets", "storyboard_script"],
  imageModelId: ["storyboard_image", "character_replace", "upscale_restore"],
  videoModelId: ["video_i2v", "video_kf2v", "motion_transfer"],
  audioModelId: ["dubbing_tts"],
  visionModelId: [],
};

const API_CENTER_DEFAULT_DOMAIN_MAP = {
  textModelId: "text",
  visionModelId: "vision",
  imageModelId: "image",
  videoModelId: "video",
  audioModelId: "audio",
};

function listApiCenterAssignments(config) {
  const nodeAssignments = Array.isArray(config?.nodeAssignments) ? config.nodeAssignments : [];
  const toolboxAssignments = Array.isArray(config?.toolboxAssignments) ? config.toolboxAssignments : [];
  return [...nodeAssignments, ...toolboxAssignments];
}

function applyPrimaryModelToAssignments(config, assignmentCodes, modelId) {
  const assignments = listApiCenterAssignments(config);
  let changed = false;

  for (const assignmentCode of assignmentCodes) {
    const assignment = assignments.find((item) => item.nodeCode === assignmentCode);
    if (!assignment || assignment.primaryModelId === modelId) {
      continue;
    }

    assignment.primaryModelId = modelId;
    changed = true;
  }

  return changed;
}

function isApiCenterModelReferenced(config, modelId) {
  if (!modelId || !config) {
    return false;
  }

  const defaults = config.defaults || {};
  if (Object.values(defaults).some((value) => value === modelId)) {
    return true;
  }

  return listApiCenterAssignments(config).some(
    (assignment) =>
      assignment?.primaryModelId === modelId ||
      (Array.isArray(assignment?.fallbackModelIds) && assignment.fallbackModelIds.includes(modelId))
  );
}

function normalizeStoredVideoResolution(model, resolution) {
  const normalizedModel = normalizeModelId(model || "");
  const normalizedResolution = String(resolution || "").trim().toLowerCase();

  if (normalizedModel === "wanx2.1-i2v-turbo") {
    return normalizedResolution === "480p" ? "480p" : "720p";
  }

  if (normalizedModel === "wan2.6-i2v-flash" || normalizedModel === "wan2.6-i2v") {
    return normalizedResolution === "720p" ? "720p" : "1080p";
  }

  if (normalizedModel.startsWith("doubao-seedance")) {
    return normalizedResolution === "480p" ? "480p" : "720p";
  }

  if (normalizedResolution === "1080p" || normalizedResolution === "480p") {
    return normalizedResolution;
  }

  return "720p";
}

// ─── Video mode normalization (canvas alias → backend canonical name) ────────

const VIDEO_MODE_ALIASES = {
  "frame-to-frame": "start_end_frame",
  "multi-reference": "multi_param",
  "image-to-video": "image_to_video",
  "text-to-video": "text_to_video",
  "motion-control": "motion_control",
  "video-edit": "video_edit",
};

function normalizeVideoMode(mode) {
  const trimmed = String(mode || "").trim().toLowerCase();
  return VIDEO_MODE_ALIASES[trimmed] || trimmed;
}

const FIXED_CREATE_VIDEO_CAPABILITIES = {
  image_to_video: {
    "veo3.1-pro": {
      duration: "8s",
      aspectRatio: "16:9",
      resolution: "1080p",
      supportedDurations: ["8s"],
      supportedAspectRatios: ["16:9"],
      supportedResolutions: ["1080p"],
    },
  },
  start_end_frame: {},
  multi_param: {
    "veo3.1-components": {
      duration: "8s",
      aspectRatio: "16:9",
      resolution: "720p",
      supportedDurations: ["8s"],
      supportedAspectRatios: ["16:9"],
      supportedResolutions: ["720p"],
    },
    "veo_3_1-components": {
      duration: "8s",
      aspectRatio: "16:9",
      resolution: "720p",
      supportedDurations: ["8s"],
      supportedAspectRatios: ["16:9"],
      supportedResolutions: ["720p"],
    },
    "doubao-seedance-2-0-260128": {
      duration: "5s",
      aspectRatio: "16:9",
      resolution: "720p",
      supportedDurations: ["4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
      supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"],
      supportedResolutions: ["720p", "480p"],
    },
    "doubao-seedance-2-0-fast-260128": {
      duration: "5s",
      aspectRatio: "16:9",
      resolution: "720p",
      supportedDurations: ["4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
      supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"],
      supportedResolutions: ["720p", "480p"],
    },
  },
};

function createVideoCapabilitySet(overrides = {}) {
  const supportedDurations = Array.isArray(overrides.supportedDurations)
    ? overrides.supportedDurations.map((value) => String(value)).filter(Boolean)
    : ["8s"];
  const supportedAspectRatios = Array.isArray(overrides.supportedAspectRatios)
    ? overrides.supportedAspectRatios.map((value) => String(value)).filter(Boolean)
    : ["16:9"];
  const supportedResolutions = Array.isArray(overrides.supportedResolutions)
    ? overrides.supportedResolutions.map((value) => String(value)).filter(Boolean)
    : ["1080p"];

  return {
    supported: overrides.supported !== false,
    status: overrides.status || "experimental",
    supportedDurations,
    supportedAspectRatios,
    supportedResolutions,
    durationControl: overrides.durationControl || (supportedDurations.length > 1 ? "selectable" : "fixed"),
    aspectRatioControl:
      overrides.aspectRatioControl || (supportedAspectRatios.length > 1 ? "selectable" : "fixed"),
    resolutionControl:
      overrides.resolutionControl || (supportedResolutions.length > 1 ? "selectable" : "fixed"),
    defaultDuration: overrides.defaultDuration || supportedDurations[0] || null,
    defaultAspectRatio: overrides.defaultAspectRatio || supportedAspectRatios[0] || null,
    defaultResolution: overrides.defaultResolution || supportedResolutions[0] || null,
    note: overrides.note || null,
  };
}

const DEFAULT_IMAGE_TO_VIDEO_TEXT_CAPABILITY = createVideoCapabilitySet({
  status: "experimental",
  supportedDurations: ["8s"],
  supportedAspectRatios: ["16:9", "1:1", "9:16"],
  supportedResolutions: ["1080p", "720p"],
  durationControl: "fixed",
  aspectRatioControl: "selectable",
  resolutionControl: "selectable",
  note: "按 Yunwu 官方创建视频文档接入，优先开放已确认存在的 size / aspect_ratio 能力。",
});

const DEFAULT_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY = createVideoCapabilitySet({
  status: "experimental",
  supportedDurations: ["8s"],
  supportedAspectRatios: ["16:9", "1:1", "9:16"],
  supportedResolutions: ["1080p"],
  durationControl: "fixed",
  aspectRatioControl: "selectable",
  resolutionControl: "fixed",
  note: "按 Yunwu 官方参考图视频文档接入，优先保持当前单参考图生成体验。",
});

const CREATE_VIDEO_IMAGE_TO_VIDEO_MODELS = [
  {
    id: "pixverse-c1",
    label: "PixVerse C1",
    status: "experimental",
    note: "PixVerse C1 统一视频模型。支持文生视频与单图视频；单图视频按官方要求使用 adaptive 固定画幅。",
    supportsTextToVideo: true,
    supportsSingleReference: true,
    inputModes: {
      text_to_video: createVideoCapabilitySet({
        status: "experimental",
        supportedDurations: ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
        supportedAspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9"],
        supportedResolutions: ["360p", "540p", "720p", "1080p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "5s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
      }),
      single_reference: createVideoCapabilitySet({
        status: "experimental",
        supportedDurations: ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
        supportedAspectRatios: ["adaptive"],
        supportedResolutions: ["360p", "540p", "720p", "1080p"],
        durationControl: "selectable",
        aspectRatioControl: "fixed",
        resolutionControl: "selectable",
        defaultDuration: "5s",
        defaultAspectRatio: "adaptive",
        defaultResolution: "720p",
      }),
    },
  },
  {
    id: "pixverse-v6",
    label: "PixVerse V6",
    status: "experimental",
    note: "PixVerse V6 统一视频模型。支持文生视频与单图视频；单图视频按官方要求使用 adaptive 固定画幅。",
    supportsTextToVideo: true,
    supportsSingleReference: true,
    inputModes: {
      text_to_video: createVideoCapabilitySet({
        status: "experimental",
        supportedDurations: ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
        supportedAspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9"],
        supportedResolutions: ["360p", "540p", "720p", "1080p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "5s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
      }),
      single_reference: createVideoCapabilitySet({
        status: "experimental",
        supportedDurations: ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
        supportedAspectRatios: ["adaptive"],
        supportedResolutions: ["360p", "540p", "720p", "1080p"],
        durationControl: "selectable",
        aspectRatioControl: "fixed",
        resolutionControl: "selectable",
        defaultDuration: "5s",
        defaultAspectRatio: "adaptive",
        defaultResolution: "720p",
      }),
    },
  },
  {
    id: "kling-video",
    label: "kling-video（推荐文生视频）",
    status: "experimental",
    note: "已按 Yunwu 官方模型目录接入，待继续验证纯文本与单参考图的真实效果。",
    supportsTextToVideo: true,
    supportsSingleReference: true,
    inputModes: {
      text_to_video: createVideoCapabilitySet(DEFAULT_IMAGE_TO_VIDEO_TEXT_CAPABILITY),
      single_reference: createVideoCapabilitySet(DEFAULT_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY),
    },
  },
  {
    id: "veo3.1",
    label: "veo3.1（仅图生）",
    status: "experimental",
    note: "已按 Yunwu 官方模型目录接入，待继续验证纯文本与单参考图的真实效果。",
    supportsTextToVideo: true,
    supportsSingleReference: true,
    inputModes: {
      text_to_video: createVideoCapabilitySet(DEFAULT_IMAGE_TO_VIDEO_TEXT_CAPABILITY),
      single_reference: createVideoCapabilitySet(DEFAULT_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY),
    },
  },
  {
    id: "veo3.1-pro",
    label: "veo3.1-pro",
    status: "stable",
    note: "当前已验证稳定的 Yunwu 图生视频基线模型。",
    supportsTextToVideo: true,
    supportsSingleReference: true,
    inputModes: {
      text_to_video: createVideoCapabilitySet({
        ...DEFAULT_IMAGE_TO_VIDEO_TEXT_CAPABILITY,
        status: "experimental",
        note: "已接入共享模型选择器；纯文本视频能力将继续按真实任务结果细化。",
      }),
      single_reference: createVideoCapabilitySet({
        ...DEFAULT_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY,
        status: "stable",
        note: "当前已验证稳定的单参考图视频链路。",
      }),
    },
  },
  {
    id: "veo_3_1-4K",
    label: "veo_3_1-4K",
    status: "experimental",
    note: "已按 Yunwu 官方模型目录接入，待继续验证更高分辨率输出是否稳定可用。",
    supportsTextToVideo: true,
    supportsSingleReference: true,
    inputModes: {
      text_to_video: createVideoCapabilitySet(DEFAULT_IMAGE_TO_VIDEO_TEXT_CAPABILITY),
      single_reference: createVideoCapabilitySet(DEFAULT_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY),
    },
  },
  {
    id: "veo_3_1-fast-4K",
    label: "veo_3_1-fast-4K",
    status: "experimental",
    note: "已按 Yunwu 官方模型目录接入，待继续验证速度优先模型的真实效果。",
    supportsTextToVideo: true,
    supportsSingleReference: true,
    inputModes: {
      text_to_video: createVideoCapabilitySet(DEFAULT_IMAGE_TO_VIDEO_TEXT_CAPABILITY),
      single_reference: createVideoCapabilitySet(DEFAULT_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY),
    },
  },
  {
    id: "veo3.1-fast",
    label: "veo3.1-fast",
    status: "experimental",
    note: "已按 Yunwu 官方模型目录接入，待继续验证速度优先模型的真实效果。",
    supportsTextToVideo: true,
    supportsSingleReference: true,
    inputModes: {
      text_to_video: createVideoCapabilitySet(DEFAULT_IMAGE_TO_VIDEO_TEXT_CAPABILITY),
      single_reference: createVideoCapabilitySet(DEFAULT_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY),
    },
  },
  {
    id: "grok-video-3",
    label: "grok-video-3",
    status: "experimental",
    note: "已按 Yunwu 官方模型目录接入，待继续验证纯文本与单参考图的真实效果。",
    supportsTextToVideo: true,
    supportsSingleReference: true,
    inputModes: {
      text_to_video: createVideoCapabilitySet(DEFAULT_IMAGE_TO_VIDEO_TEXT_CAPABILITY),
      single_reference: createVideoCapabilitySet(DEFAULT_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY),
    },
  },
  {
    id: "doubao-seedance-2-0-260128",
    label: "Seedance 2.0",
    status: "stable",
    note: "字节跳动 Seedance 2.0，通过火山引擎 Ark 平台调用，需配置 VOLCENGINE_ARK_API_KEY。支持文生视频、图生视频，分辨率 720p/480p，时长 4-15s。",
    supportsTextToVideo: true,
    supportsSingleReference: true,
    inputModes: {
      text_to_video: createVideoCapabilitySet({
        supported: true,
        status: "stable",
        supportedDurations: ["4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
        supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        supportedResolutions: ["720p", "480p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "5s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        note: "Seedance 2.0 文生视频，通过火山引擎 Ark 接口调用。仅支持 720p/480p，不支持 1080p。时长范围 4-15 秒连续可选。",
      }),
      single_reference: createVideoCapabilitySet({
        supported: true,
        status: "stable",
        supportedDurations: ["4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
        supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"],
        supportedResolutions: ["720p", "480p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "5s",
        defaultAspectRatio: "adaptive",
        defaultResolution: "720p",
        note: "Seedance 2.0 图生视频，参考图作为首帧，比例设为 adaptive 可自动适配原图尺寸。仅支持 720p/480p。",
      }),
    },
  },
  {
    id: "doubao-seedance-2-0-fast-260128",
    label: "Seedance 2.0 Fast",
    status: "stable",
    note: "字节跳动 Seedance 2.0 快速版，生成速度更快但质量略低于标准版，适合快速预览，需配置 VOLCENGINE_ARK_API_KEY。",
    supportsTextToVideo: true,
    supportsSingleReference: true,
    inputModes: {
      text_to_video: createVideoCapabilitySet({
        supported: true,
        status: "stable",
        supportedDurations: ["4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
        supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
        supportedResolutions: ["720p", "480p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "5s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        note: "Seedance 2.0 Fast 文生视频，速度优先版本。仅支持 720p/480p。",
      }),
      single_reference: createVideoCapabilitySet({
        supported: true,
        status: "stable",
        supportedDurations: ["4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
        supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"],
        supportedResolutions: ["720p", "480p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "5s",
        defaultAspectRatio: "adaptive",
        defaultResolution: "720p",
        note: "Seedance 2.0 Fast 图生视频，速度优先版本。仅支持 720p/480p。",
      }),
    },
  },
];

const DEFAULT_START_END_FRAME_CAPABILITY = createVideoCapabilitySet({
  status: "experimental",
  supportedDurations: ["8s"],
  supportedAspectRatios: ["16:9"],
  supportedResolutions: ["720p"],
  durationControl: "fixed",
  aspectRatioControl: "fixed",
  resolutionControl: "fixed",
  defaultDuration: "8s",
  defaultAspectRatio: "16:9",
  defaultResolution: "720p",
  note: "当前按 Yunwu 首尾帧实验链路接入；若官方文档未明确支持，将以真实任务验证结果决定是实验性还是不可用。",
});

const CREATE_VIDEO_START_END_MODELS = [
  {
    id: "pixverse-c1",
    label: "PixVerse C1",
    status: "experimental",
    note: "PixVerse C1 首尾帧（transition）模式。官方不支持显式自由画幅选择，统一按 adaptive 固定画幅表达。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsStartEndFrame: true,
    inputModes: {
      start_end_frame: createVideoCapabilitySet({
        status: "experimental",
        supportedDurations: ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
        supportedAspectRatios: ["adaptive"],
        supportedResolutions: ["360p", "540p", "720p", "1080p"],
        durationControl: "selectable",
        aspectRatioControl: "fixed",
        resolutionControl: "selectable",
        defaultDuration: "5s",
        defaultAspectRatio: "adaptive",
        defaultResolution: "720p",
      }),
    },
  },
  {
    id: "pixverse-v6",
    label: "PixVerse V6",
    status: "experimental",
    note: "PixVerse V6 首尾帧（transition）模式。官方不支持显式自由画幅选择，统一按 adaptive 固定画幅表达。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsStartEndFrame: true,
    inputModes: {
      start_end_frame: createVideoCapabilitySet({
        status: "experimental",
        supportedDurations: ["1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
        supportedAspectRatios: ["adaptive"],
        supportedResolutions: ["360p", "540p", "720p", "1080p"],
        durationControl: "selectable",
        aspectRatioControl: "fixed",
        resolutionControl: "selectable",
        defaultDuration: "5s",
        defaultAspectRatio: "adaptive",
        defaultResolution: "720p",
      }),
    },
  },
  {
    id: "kling-video",
    label: "kling-video",
    status: "stable",
    note: "Yunwu Kling image2video + image_tail 首尾帧；当前已用真实任务复测通过，并作为 PixVerse 之外的稳定备选模型。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsStartEndFrame: true,
    inputModes: {
      start_end_frame: createVideoCapabilitySet({
        status: "stable",
        supportedDurations: ["5s", "10s"],
        supportedAspectRatios: ["16:9"],
        supportedResolutions: ["自动"],
        durationControl: "selectable",
        aspectRatioControl: "fixed",
        resolutionControl: "fixed",
        defaultDuration: "5s",
        defaultAspectRatio: "16:9",
        defaultResolution: "自动",
        note: "已通过真实首尾帧任务验证；当前先开放官方接口中已确认可用的 5s / 10s 与 16:9。",
      }),
    },
  },
  {
    id: "veo3.1-pro",
    label: "veo3.1-pro",
    status: "failing",
    note: "当前按 Yunwu 通用视频首尾帧链路的真实任务已失败，暂标记为不可用，待后续专项排查后再恢复。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsStartEndFrame: false,
    inputModes: {
      start_end_frame: createVideoCapabilitySet({
        ...DEFAULT_START_END_FRAME_CAPABILITY,
        supported: false,
        status: "failing",
        note: "真实首尾帧任务已失败，当前请改用 kling-video。",
      }),
    },
  },
  {
    id: "veo_3_1-4K",
    label: "veo_3_1-4K",
    status: "failing",
    note: "当前按 Yunwu 通用视频首尾帧链路的真实任务已失败，暂标记为不可用。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsStartEndFrame: false,
    inputModes: {
      start_end_frame: createVideoCapabilitySet({
        ...DEFAULT_START_END_FRAME_CAPABILITY,
        supported: false,
        status: "failing",
        note: "真实首尾帧任务已失败，当前请改用已验证可用的模型。",
      }),
    },
  },
  {
    id: "veo_3_1-fast-4K",
    label: "veo_3_1-fast-4K",
    status: "failing",
    note: "当前按 Yunwu 通用视频首尾帧链路的真实任务已失败，暂标记为不可用。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsStartEndFrame: false,
    inputModes: {
      start_end_frame: createVideoCapabilitySet({
        ...DEFAULT_START_END_FRAME_CAPABILITY,
        supported: false,
        status: "failing",
        note: "真实首尾帧任务已失败，当前请改用已验证可用的模型。",
      }),
    },
  },
  {
    id: "veo3.1-fast",
    label: "veo3.1-fast",
    status: "failing",
    note: "当前按 Yunwu 通用视频首尾帧链路的真实任务已失败，暂标记为不可用。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsStartEndFrame: false,
    inputModes: {
      start_end_frame: createVideoCapabilitySet({
        ...DEFAULT_START_END_FRAME_CAPABILITY,
        supported: false,
        status: "failing",
        note: "真实首尾帧任务已失败，当前请改用已验证可用的模型。",
      }),
    },
  },
  {
    id: "doubao-seedance-2-0-260128",
    label: "Seedance 2.0",
    status: "stable",
    note: "字节跳动 Seedance 2.0 首尾帧模式，需配置 VOLCENGINE_ARK_API_KEY。供给首帧+尾帧图片，由模型生成中间动态过渡。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsStartEndFrame: true,
    inputModes: {
      start_end_frame: createVideoCapabilitySet({
        supported: true,
        status: "stable",
        supportedDurations: ["4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
        supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"],
        supportedResolutions: ["720p", "480p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "5s",
        defaultAspectRatio: "adaptive",
        defaultResolution: "720p",
        note: "Seedance 2.0 首尾帧模式，首帧+尾帧图片，adaptive 比例自动适配。仅支持 720p/480p，时长 4-15 秒。",
      }),
    },
  },
];

const DEFAULT_MULTI_PARAM_CAPABILITY = createVideoCapabilitySet({
  status: "experimental",
  supportedDurations: ["8s"],
  supportedAspectRatios: ["16:9"],
  supportedResolutions: ["720p"],
  durationControl: "fixed",
  aspectRatioControl: "fixed",
  resolutionControl: "fixed",
  defaultDuration: "8s",
  defaultAspectRatio: "16:9",
  defaultResolution: "720p",
  note: "当前多参生成页面接入上限为 7 张参考图；官方文档未明确最大张数时，前端按当前接入上限展示。",
});

const CREATE_VIDEO_MULTI_PARAM_MODELS = [
  {
    id: "pixverse-c1",
    label: "PixVerse C1 Fusion",
    status: "experimental",
    note: "PixVerse Fusion(reference-to-video)。当前严格按官方保守上限 3 张参考图接入，前端继续沿用 multiReferenceImages，后端自动映射 image_references。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsMultiReference: true,
    maxReferenceImages: 3,
    maxReferenceImagesSource: "official",
    inputModes: {
      multi_param: createVideoCapabilitySet({
        status: "experimental",
        supportedDurations: ["5s", "8s"],
        supportedAspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9"],
        supportedResolutions: ["360p", "540p", "720p", "1080p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "5s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        maxReferenceImages: 3,
        note: "PixVerse C1 Fusion 严格按官方 reference-to-video 能力接入：最多 3 张参考图，支持 5s / 8s，支持显式画幅与 360p/540p/720p/1080p。",
      }),
    },
  },
  {
    id: "veo3.1-components",
    label: "veo3.1-components",
    status: "stable",
    note: "当前已验证稳定的 Yunwu components 多参考视频基线模型；现阶段稳定验证通过的是 3 张参考图组合。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsMultiReference: true,
    maxReferenceImages: 3,
    maxReferenceImagesSource: "integrated",
    inputModes: {
      multi_param: createVideoCapabilitySet({
        ...DEFAULT_MULTI_PARAM_CAPABILITY,
        status: "stable",
        note: "当前固定走 Yunwu /v1/video/create；现阶段稳定验证通过的是 3 张参考图，并优先保留 scene / character / prop。4 张及以上提交当前更容易被 provider 策略拦截。",
      }),
    },
  },
  {
    id: "veo_3_1-components",
    label: "veo_3_1-components",
    status: "experimental",
    note: "已按 Yunwu 官方 components 多参考视频模型接入，待继续验证真实效果。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsMultiReference: true,
    maxReferenceImages: 7,
    maxReferenceImagesSource: "integrated",
    inputModes: {
      multi_param: createVideoCapabilitySet(DEFAULT_MULTI_PARAM_CAPABILITY),
    },
  },
  {
    id: "veo_3_1-components-4K",
    label: "veo_3_1-components-4K",
    status: "experimental",
    note: "已按 Yunwu 官方 components 4K 多参考视频模型接入，待继续验证真实效果。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsMultiReference: true,
    maxReferenceImages: 7,
    maxReferenceImagesSource: "integrated",
    inputModes: {
      multi_param: createVideoCapabilitySet(DEFAULT_MULTI_PARAM_CAPABILITY),
    },
  },
  {
    id: "veo3.1-fast-components",
    label: "veo3.1-fast-components",
    status: "experimental",
    note: "已按 Yunwu 官方 fast components 多参考视频模型接入，待继续验证真实效果。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsMultiReference: true,
    maxReferenceImages: 7,
    maxReferenceImagesSource: "integrated",
    inputModes: {
      multi_param: createVideoCapabilitySet(DEFAULT_MULTI_PARAM_CAPABILITY),
    },
  },
  {
    id: "kling-multi-image2video",
    label: "kling-multi-image2video",
    status: "experimental",
    note: "已按 Yunwu 官方 /kling/v1/videos/multi-image2video 接入，待继续验证多图参考视频的真实效果。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsMultiReference: true,
    maxReferenceImages: 7,
    maxReferenceImagesSource: "integrated",
    inputModes: {
      multi_param: createVideoCapabilitySet({
        ...DEFAULT_MULTI_PARAM_CAPABILITY,
        supportedDurations: ["5s", "10s"],
        durationControl: "selectable",
        defaultDuration: "5s",
      }),
    },
  },
  {
    id: "kling-multi-elements",
    label: "kling-multi-elements",
    status: "experimental",
    note: "已按 Yunwu 官方 /kling/v1/videos/multi-elements 接入，待继续验证多模态多图视频的真实效果。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsMultiReference: true,
    maxReferenceImages: 7,
    maxReferenceImagesSource: "integrated",
    inputModes: {
      multi_param: createVideoCapabilitySet({
        ...DEFAULT_MULTI_PARAM_CAPABILITY,
        supportedDurations: ["5s", "10s"],
        durationControl: "selectable",
        defaultDuration: "5s",
      }),
    },
  },
  {
    id: "doubao-seedance-2-0-260128",
    label: "Seedance 2.0",
    status: "stable",
    note: "字节跳动 Seedance 2.0 多参考图模式，通过火山引擎 Ark 多图输入接口，最多支持 9 张参考图。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsMultiReference: true,
    maxReferenceImages: 9,
    maxReferenceImagesSource: "integrated",
    inputModes: {
      multi_param: createVideoCapabilitySet({
        ...DEFAULT_MULTI_PARAM_CAPABILITY,
        status: "stable",
        supportedDurations: ["4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
        supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"],
        supportedResolutions: ["720p", "480p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "5s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        note: "Seedance 2.0 多参考图模式，最多 9 张参考图。仅支持 720p/480p，时长 4-15 秒。",
      }),
    },
  },
  {
    id: "doubao-seedance-2-0-fast-260128",
    label: "Seedance 2.0 Fast",
    status: "stable",
    note: "字节跳动 Seedance 2.0 快速版多参考图模式，速度更快，最多支持 9 张参考图。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsMultiReference: true,
    maxReferenceImages: 9,
    maxReferenceImagesSource: "integrated",
    inputModes: {
      multi_param: createVideoCapabilitySet({
        ...DEFAULT_MULTI_PARAM_CAPABILITY,
        status: "stable",
        supportedDurations: ["4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
        supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"],
        supportedResolutions: ["720p", "480p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "5s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        note: "Seedance 2.0 Fast 多参考图模式，速度更快。仅支持 720p/480p，时长 4-15 秒。",
      }),
    },
  },
];

const veo31ProImageToVideoCapability = CREATE_VIDEO_IMAGE_TO_VIDEO_MODELS.find(
  (item) => item.id === "veo3.1-pro"
);
if (veo31ProImageToVideoCapability) {
  veo31ProImageToVideoCapability.note =
    "当前已验证稳定的 Yunwu 单参考图视频基线模型；纯文生视频仍待单独路由验证。";
  veo31ProImageToVideoCapability.supportsTextToVideo = false;
  veo31ProImageToVideoCapability.inputModes.text_to_video = createVideoCapabilitySet({
    supported: false,
    status: "failing",
    supportedDurations: ["8s"],
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    supportedResolutions: ["1080p", "720p"],
    durationControl: "fixed",
    aspectRatioControl: "selectable",
    resolutionControl: "selectable",
    note: "实测在 Yunwu 当前 /v1/video/create 纯文生视频链路下，veo3.1-pro 的 1080p 与 720p 请求都会返回 FAILED。请上传参考图，或切换到已验证可用的 grok-video-3 进行纯文生视频。",
  });
  veo31ProImageToVideoCapability.inputModes.single_reference = createVideoCapabilitySet({
    ...DEFAULT_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY,
    status: "stable",
    note: "当前已验证稳定的单参考图视频链路。",
  });
}

const veo31ImageToVideoCapability = CREATE_VIDEO_IMAGE_TO_VIDEO_MODELS.find(
  (item) => item.id === "veo3.1"
);
if (veo31ImageToVideoCapability) {
  veo31ImageToVideoCapability.note =
    "veo3.1 的 Yunwu 纯文生视频已按 1080p 与 720p 实测，都会在 provider 侧返回 FAILED；请上传参考图，或切换到 grok-video-3 / veo_3_1-fast-4K。";
  veo31ImageToVideoCapability.supportsTextToVideo = false;
  veo31ImageToVideoCapability.inputModes.text_to_video = createVideoCapabilitySet({
    supported: false,
    status: "failing",
    supportedDurations: ["8s"],
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    supportedResolutions: ["1080p", "720p"],
    durationControl: "fixed",
    aspectRatioControl: "selectable",
    resolutionControl: "selectable",
    note: "实测 veo3.1 纯文生视频在 1080p 与 720p 下都会返回 FAILED，当前请改用单参考图视频，或切换到 grok-video-3 / veo_3_1-fast-4K。",
  });
}

if (veo31ImageToVideoCapability) {
  veo31ImageToVideoCapability.note =
    "veo3.1 的 Yunwu 纯文生视频在当前通用链路下不可用，但单参考图视频已切到官方 OpenAI 视频接口并通过本地真实任务验证。";
  veo31ImageToVideoCapability.inputModes.single_reference = createVideoCapabilitySet({
    supported: true,
    status: "stable",
    supportedDurations: ["5s", "8s"],
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    supportedResolutions: ["自动"],
    durationControl: "selectable",
    aspectRatioControl: "selectable",
    resolutionControl: "fixed",
    defaultDuration: "8s",
    defaultAspectRatio: "16:9",
    defaultResolution: "自动",
    note: "已切到 Yunwu 官方 /v1/videos 单参考图接口，并通过本地真实任务验证：当前可用参数为 5s/8s 与 16:9/1:1/9:16；该接口没有独立清晰度参数，因此前端固定显示为自动。",
  });
}

if (veo31ProImageToVideoCapability) {
  veo31ProImageToVideoCapability.note =
    "2026-04-02 已按 Yunwu 官方 /v1/videos 与当前项目现用链路，对 veo3.1-pro 单参考图视频做了 3s/5s/8s、16:9/1:1 的最小实测；当前都会在 provider 侧失败，因此先标记为不可用。";
  veo31ProImageToVideoCapability.status = "failing";
  veo31ProImageToVideoCapability.supportsTextToVideo = false;
  veo31ProImageToVideoCapability.supportsSingleReference = false;
  veo31ProImageToVideoCapability.inputModes.text_to_video = createVideoCapabilitySet({
    supported: false,
    status: "failing",
    supportedDurations: ["8s"],
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    supportedResolutions: ["1080p", "720p"],
    durationControl: "fixed",
    aspectRatioControl: "selectable",
    resolutionControl: "selectable",
    note: "实测在 Yunwu 当前 /v1/video/create 纯文生视频链路下，veo3.1-pro 的 1080p 与 720p 请求都会返回 FAILED。请上传参考图，或切换到已验证可用的 grok-video-3 进行纯文生视频。",
  });
  veo31ProImageToVideoCapability.inputModes.single_reference = createVideoCapabilitySet({
    supported: false,
    status: "failing",
    supportedDurations: ["3s", "5s", "8s"],
    supportedAspectRatios: ["16:9", "1:1"],
    supportedResolutions: ["1080p"],
    durationControl: "selectable",
    aspectRatioControl: "selectable",
    resolutionControl: "fixed",
    defaultDuration: "8s",
    defaultAspectRatio: "16:9",
    defaultResolution: "1080p",
    note: "2026-04-02 已按 Yunwu 官方 /v1/videos 与当前项目现用链路，对 veo3.1-pro 单参考图视频做了 3s/5s/8s、16:9/1:1 的最小实测；当前都会在 provider 侧失败，请先改用 veo3.1 或 kling-video。",
  });
}

const veo314KImageToVideoCapability = CREATE_VIDEO_IMAGE_TO_VIDEO_MODELS.find(
  (item) => item.id === "veo_3_1-4K"
);
if (veo314KImageToVideoCapability) {
  veo314KImageToVideoCapability.note =
    "veo_3_1-4K 当前只完成了纯文生视频失败验证；单参考图没有像 veo3.1 一样接入官方 /v1/videos 稳定链路，现阶段请不要在图生视频里使用。";
  veo314KImageToVideoCapability.status = "failing";
  veo314KImageToVideoCapability.supportsTextToVideo = false;
  veo314KImageToVideoCapability.supportsSingleReference = false;
  veo314KImageToVideoCapability.inputModes.text_to_video = createVideoCapabilitySet({
    supported: false,
    status: "failing",
    supportedDurations: ["8s"],
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    supportedResolutions: ["1080p", "720p"],
    durationControl: "fixed",
    aspectRatioControl: "selectable",
    resolutionControl: "selectable",
    note: "实测 veo_3_1-4K 纯文生视频在 1080p 下会失败，在 720p 下会超时，当前请不要用于纯文生视频。",
  });
  veo314KImageToVideoCapability.inputModes.single_reference = createVideoCapabilitySet({
    supported: false,
    status: "failing",
    supportedDurations: ["8s"],
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    supportedResolutions: ["1080p"],
    durationControl: "fixed",
    aspectRatioControl: "selectable",
    resolutionControl: "fixed",
    defaultDuration: "8s",
    defaultAspectRatio: "16:9",
    defaultResolution: "1080p",
    note: "当前代码没有像 veo3.1 那样把 veo_3_1-4K 单参考图接到 Yunwu 官方 /v1/videos 稳定接口；现有任务会走通用链路且已出现失败，先标记为不可用。",
  });
}

const veo31Fast4KImageToVideoCapability = CREATE_VIDEO_IMAGE_TO_VIDEO_MODELS.find(
  (item) => item.id === "veo_3_1-fast-4K"
);
if (veo31Fast4KImageToVideoCapability) {
  veo31Fast4KImageToVideoCapability.note =
    "veo_3_1-fast-4K 的 Yunwu 纯文生视频已通过本地真实任务验证；当前稳定验证的是 8s / 16:9 / 1080p，单参考图链路仍待继续验证。";
  veo31Fast4KImageToVideoCapability.inputModes.text_to_video = createVideoCapabilitySet({
    supported: true,
    status: "stable",
    supportedDurations: ["8s"],
    supportedAspectRatios: ["16:9"],
    supportedResolutions: ["1080p"],
    durationControl: "fixed",
    aspectRatioControl: "fixed",
    resolutionControl: "fixed",
    defaultDuration: "8s",
    defaultAspectRatio: "16:9",
    defaultResolution: "1080p",
    note: "已通过本地真实任务验证，veo_3_1-fast-4K 纯文生视频当前稳定可用的组合为 8s / 16:9 / 1080p。",
  });
}

const veo31FastImageToVideoCapability = CREATE_VIDEO_IMAGE_TO_VIDEO_MODELS.find(
  (item) => item.id === "veo3.1-fast"
);
if (veo31FastImageToVideoCapability) {
  veo31FastImageToVideoCapability.note =
    "veo3.1-fast 的 Yunwu 纯文生视频已按 1080p 与 720p 实测，都会在 provider 侧返回 FAILED；请上传参考图，或切换到 grok-video-3 / veo_3_1-fast-4K。";
  veo31FastImageToVideoCapability.supportsTextToVideo = false;
  veo31FastImageToVideoCapability.inputModes.text_to_video = createVideoCapabilitySet({
    supported: false,
    status: "failing",
    supportedDurations: ["8s"],
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    supportedResolutions: ["1080p", "720p"],
    durationControl: "fixed",
    aspectRatioControl: "selectable",
    resolutionControl: "selectable",
    note: "实测 veo3.1-fast 纯文生视频在 1080p 与 720p 下都会返回 FAILED，当前请不要用于纯文生视频。",
  });
}

if (veo31FastImageToVideoCapability) {
  veo31FastImageToVideoCapability.supportsSingleReference = false;
  veo31FastImageToVideoCapability.inputModes.single_reference = createVideoCapabilitySet({
    supported: false,
    status: "failing",
    supportedDurations: ["5s", "8s"],
    supportedAspectRatios: ["16:9"],
    supportedResolutions: ["自动"],
    durationControl: "selectable",
    aspectRatioControl: "fixed",
    resolutionControl: "fixed",
    defaultDuration: "8s",
    defaultAspectRatio: "16:9",
    defaultResolution: "自动",
    note: "2026-04-02 已同时按 Yunwu 官方 /v1/video/create 与 /v1/videos 两条单参考图路径实测 veo3.1-fast；当前都能入队，但最终都会在 provider 侧失败，请先改用 veo3.1 或 kling-video。",
  });
}

const grokVideo3ImageToVideoCapability = CREATE_VIDEO_IMAGE_TO_VIDEO_MODELS.find(
  (item) => item.id === "grok-video-3"
);
if (grokVideo3ImageToVideoCapability) {
  grokVideo3ImageToVideoCapability.note =
    "已按 Yunwu 官方模型目录接入；纯文生视频已验证可用，单参考图仍待继续验证。";
  grokVideo3ImageToVideoCapability.inputModes.text_to_video = createVideoCapabilitySet({
    ...DEFAULT_IMAGE_TO_VIDEO_TEXT_CAPABILITY,
    status: "stable",
    note: "已通过本地真实任务验证，可用于当前纯文生视频。",
  });
}

const klingVideoImageToVideoCapability = CREATE_VIDEO_IMAGE_TO_VIDEO_MODELS.find(
  (item) => item.id === "kling-video"
);
if (grokVideo3ImageToVideoCapability) {
  grokVideo3ImageToVideoCapability.note =
    "已接入 Yunwu 官方 grok-video-3 统一视频接口；纯文生视频已验证可用，单参考图当前改为显式下发 size + aspect_ratio，优先按前端所选画幅生成。";
  grokVideo3ImageToVideoCapability.inputModes.text_to_video = createVideoCapabilitySet({
    ...DEFAULT_IMAGE_TO_VIDEO_TEXT_CAPABILITY,
    status: "stable",
    supportedDurations: ["6s"],
    durationControl: "fixed",
    defaultDuration: "6s",
    note: "已通过本地真实任务验证：纯文生视频的 16:9、1:1、9:16 画幅都能生效；当前真实输出时长固定约 6s，清晰度参数仍待继续验证。",
  });
  grokVideo3ImageToVideoCapability.inputModes.single_reference = createVideoCapabilitySet({
    supported: true,
    status: "stable",
    supportedDurations: ["6s"],
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
    supportedResolutions: ["1080p", "720p"],
    durationControl: "fixed",
    aspectRatioControl: "selectable",
    resolutionControl: "selectable",
    defaultDuration: "6s",
    defaultAspectRatio: "16:9",
    defaultResolution: "1080p",
    note: "已针对单参考图链路补充 size 参数，当前优先按前端选择的 16:9 / 1:1 / 9:16 与 1080p / 720p 发给 Yunwu；真实输出仍以复测结果为准。",
  });
}

if (klingVideoImageToVideoCapability) {
  klingVideoImageToVideoCapability.note =
    "已切换到 Yunwu 官方 Kling 专用接口；纯文生视频与单参考图视频都已通过本地真实任务验证。";
  klingVideoImageToVideoCapability.inputModes.text_to_video = createVideoCapabilitySet({
    ...DEFAULT_IMAGE_TO_VIDEO_TEXT_CAPABILITY,
    status: "stable",
    supportedDurations: ["5s", "10s"],
    durationControl: "selectable",
    defaultDuration: "5s",
    note: "已通过本地真实任务验证，当前走 Yunwu 官方 /kling/v1/videos/text2video。实测 provider 仅接受 5s 或 10s；画幅比例可控，清晰度能力仍待继续验证。",
  });
  klingVideoImageToVideoCapability.inputModes.single_reference = createVideoCapabilitySet({
    ...DEFAULT_IMAGE_TO_VIDEO_SINGLE_REFERENCE_CAPABILITY,
    status: "stable",
    supportedDurations: ["5s", "10s"],
    supportedAspectRatios: ["约 2.09:1"],
    supportedResolutions: ["1472x704"],
    durationControl: "selectable",
    aspectRatioControl: "fixed",
    resolutionControl: "fixed",
    defaultDuration: "5s",
    defaultAspectRatio: "约 2.09:1",
    defaultResolution: "1472x704",
    note: "已通过本地真实任务验证，当前走 Yunwu 官方 /kling/v1/videos/image2video。16:9、1:1、9:16 三种请求都能成功，但实际输出目前固定为约 1472x704（约 2.09:1）；时长仅确认可用 5s / 10s。",
  });
}

// ─── Image Capabilities (unified, single source of truth) ───────────────────

function createImageCapabilitySet(overrides = {}) {
  const supportedAspectRatios = Array.isArray(overrides.supportedAspectRatios)
    ? overrides.supportedAspectRatios.map((v) => String(v)).filter(Boolean)
    : ["1:1", "16:9", "9:16"];
  const supportedResolutions = Array.isArray(overrides.supportedResolutions)
    ? overrides.supportedResolutions.map((v) => String(v)).filter(Boolean)
    : ["2K"];

  return {
    supported: overrides.supported !== false,
    status: overrides.status || "stable",
    supportedAspectRatios,
    supportedResolutions,
    aspectRatioControl: overrides.aspectRatioControl || (supportedAspectRatios.length > 1 ? "selectable" : "fixed"),
    resolutionControl: overrides.resolutionControl || (supportedResolutions.length > 1 ? "selectable" : "fixed"),
    defaultAspectRatio: overrides.defaultAspectRatio || supportedAspectRatios[0] || null,
    defaultResolution: overrides.defaultResolution || supportedResolutions[0] || null,
    maxReferenceImages: overrides.maxReferenceImages || null,
    note: overrides.note || null,
  };
}

const CREATE_IMAGE_MODELS = [
  {
    id: "doubao-seedream-5-0-260128",
    label: "Seedream 5.0",
    provider: "volcengine",
    kind: "image",
    status: "stable",
    recommended: true,
    note: "字节跳动 Seedream 5.0，通过火山引擎 Ark 平台调用。支持文生图、图生图、多参考图。",
    inputModes: {
      text_to_image: createImageCapabilitySet({
        supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
        supportedResolutions: ["2K", "3K"],
      }),
      image_to_image: createImageCapabilitySet({
        supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
        supportedResolutions: ["2K", "3K"],
        maxReferenceImages: 1,
      }),
      multi_image: createImageCapabilitySet({
        supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
        supportedResolutions: ["2K", "3K"],
        maxReferenceImages: 4,
      }),
    },
  },
  {
    id: "gemini-3-pro-image-preview",
    label: "Gemini 3 Pro",
    provider: "google",
    kind: "image",
    status: "stable",
    recommended: false,
    note: "Google Gemini 3 Pro 图片生成，支持文生图、图生图、多参考图。",
    inputModes: {
      text_to_image: createImageCapabilitySet({
        supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"],
        supportedResolutions: ["1K", "2K", "4K"],
      }),
      image_to_image: createImageCapabilitySet({
        supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"],
        supportedResolutions: ["1K", "2K", "4K"],
        maxReferenceImages: 14,
      }),
      multi_image: createImageCapabilitySet({
        supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"],
        supportedResolutions: ["1K", "2K", "4K"],
        maxReferenceImages: 14,
      }),
    },
  },
  {
    id: "gemini-3.1-flash-image-preview",
    label: "Gemini 3.1 Flash",
    provider: "google",
    kind: "image",
    status: "stable",
    recommended: false,
    note: "Google Gemini 3.1 Flash 图片生成，速度快。",
    inputModes: {
      text_to_image: createImageCapabilitySet({
        supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"],
        supportedResolutions: ["1K", "2K", "4K"],
      }),
      image_to_image: createImageCapabilitySet({
        supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"],
        supportedResolutions: ["1K", "2K", "4K"],
        maxReferenceImages: 14,
      }),
      multi_image: createImageCapabilitySet({
        supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"],
        supportedResolutions: ["1K", "2K", "4K"],
        maxReferenceImages: 14,
      }),
    },
  },
  {
    id: "gemini-2.5-flash-image",
    label: "Gemini 2.5 Flash",
    provider: "google",
    kind: "image",
    status: "stable",
    recommended: false,
    note: "Google Gemini 2.5 Flash 图片生成。",
    inputModes: {
      text_to_image: createImageCapabilitySet({
        supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"],
        supportedResolutions: ["1K", "2K"],
      }),
      image_to_image: createImageCapabilitySet({
        supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"],
        supportedResolutions: ["1K", "2K"],
        maxReferenceImages: 14,
      }),
      multi_image: createImageCapabilitySet({
        supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "5:4", "4:5", "21:9"],
        supportedResolutions: ["1K", "2K"],
        maxReferenceImages: 14,
      }),
    },
  },
  {
    id: "gpt-image-1.5",
    label: "GPT Image 1.5",
    provider: "openai",
    kind: "image",
    status: "stable",
    recommended: true,
    note: "OpenAI GPT Image 1.5，使用固定像素尺寸。",
    inputModes: {
      text_to_image: createImageCapabilitySet({
        supportedAspectRatios: ["1024x1024", "1536x1024", "1024x1536"],
        supportedResolutions: [],
      }),
      image_to_image: createImageCapabilitySet({
        supportedAspectRatios: ["1024x1024", "1536x1024", "1024x1536"],
        supportedResolutions: [],
        maxReferenceImages: 1,
      }),
      multi_image: createImageCapabilitySet({
        supportedAspectRatios: ["1024x1024", "1536x1024", "1024x1536"],
        supportedResolutions: [],
        maxReferenceImages: 4,
      }),
    },
  },
  {
    id: "kling-v1-5",
    label: "Kling V1.5",
    provider: "kling",
    kind: "image",
    status: "stable",
    recommended: false,
    note: "Kling V1.5 图片生成，支持图生图（含人脸参考）。",
    inputModes: {
      text_to_image: createImageCapabilitySet({
        supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
        supportedResolutions: ["1K", "2K"],
      }),
      image_to_image: createImageCapabilitySet({
        supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
        supportedResolutions: ["1K", "2K"],
        maxReferenceImages: 1,
      }),
    },
  },
  {
    id: "kling-v2-1",
    label: "Kling V2.1",
    provider: "kling",
    kind: "image",
    status: "stable",
    recommended: true,
    note: "Kling V2.1 图片生成，支持多图参考。",
    inputModes: {
      text_to_image: createImageCapabilitySet({
        supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
        supportedResolutions: ["1K", "2K"],
      }),
      multi_image: createImageCapabilitySet({
        supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
        supportedResolutions: ["1K", "2K"],
        maxReferenceImages: 4,
      }),
    },
  },
];

function listCreateImageCapabilities(mode) {
  const normalizedMode = String(mode || "").trim().toLowerCase();
  if (!normalizedMode) {
    return CREATE_IMAGE_MODELS.map((item) => clone(item));
  }
  return CREATE_IMAGE_MODELS.filter((item) => {
    return item.inputModes && item.inputModes[normalizedMode];
  }).map((item) => clone(item));
}

// ─── Video Capabilities (existing) ─────────────────────────────────────────

function inferVideoProvider(id) {
  if (!id) return "other";
  const lower = id.toLowerCase();
  if (lower.startsWith("veo")) return "google";
  if (lower.startsWith("kling")) return "kling";
  if (lower.startsWith("hailuo")) return "hailuo";
  if (lower.startsWith("grok")) return "grok";
  if (lower.startsWith("doubao") || lower.startsWith("seedance")) return "bytedance";
  if (lower.startsWith("pixverse")) return "pixverse";
  return "other";
}

function enrichVideoModel(item) {
  const c = clone(item);
  if (!c.kind) c.kind = "video";
  if (!c.provider) c.provider = inferVideoProvider(c.id);
  return c;
}

function listCreateVideoImageToVideoCapabilities() {
  return CREATE_VIDEO_IMAGE_TO_VIDEO_MODELS.map(enrichVideoModel);
}

function getCreateVideoImageToVideoModel(model) {
  const normalizedModel = normalizeModelId(model || "");
  return CREATE_VIDEO_IMAGE_TO_VIDEO_MODELS.find((item) => item.id === normalizedModel) || null;
}

function getCreateVideoImageToVideoCapabilitySet(model, inputMode) {
  const capability = getCreateVideoImageToVideoModel(model);
  if (!capability) return null;
  const modeKey = inputMode === "single_reference" ? "single_reference" : "text_to_video";
  return capability.inputModes?.[modeKey] || null;
}

function getFallbackSupportedImageToVideoCapabilitySet(model) {
  const capability = getCreateVideoImageToVideoModel(model);
  if (!capability?.inputModes) return null;
  if (capability.inputModes.single_reference?.supported) {
    return capability.inputModes.single_reference;
  }
  if (capability.inputModes.text_to_video?.supported) {
    return capability.inputModes.text_to_video;
  }
  return null;
}

function listCreateVideoStartEndCapabilities() {
  return CREATE_VIDEO_START_END_MODELS.filter((item) => {
    const se = item.inputModes?.start_end_frame;
    return item.supportsStartEndFrame !== false && se && se.supported !== false;
  }).map(enrichVideoModel);
}

function getCreateVideoStartEndModel(model) {
  const normalizedModel = normalizeModelId(model || "");
  return CREATE_VIDEO_START_END_MODELS.find((item) => item.id === normalizedModel) || null;
}

function getCreateVideoStartEndCapabilitySet(model) {
  const capability = getCreateVideoStartEndModel(model);
  return capability?.inputModes?.start_end_frame || null;
}

function listCreateVideoMultiParamCapabilities() {
  return CREATE_VIDEO_MULTI_PARAM_MODELS.map(enrichVideoModel);
}

function getCreateVideoMultiParamModel(model) {
  const normalizedModel = normalizeModelId(model || "");
  return CREATE_VIDEO_MULTI_PARAM_MODELS.find((item) => item.id === normalizedModel) || null;
}

function getCreateVideoMultiParamCapabilitySet(model) {
  const capability = getCreateVideoMultiParamModel(model);
  return capability?.inputModes?.multi_param || null;
}

function getCreateVideoCapabilitySetForMode(model, videoMode, inputMode) {
  if (videoMode === "image_to_video") {
    return (
      getCreateVideoImageToVideoCapabilitySet(model, inputMode) ||
      getFallbackSupportedImageToVideoCapabilitySet(model)
    );
  }
  if (videoMode === "start_end_frame") {
    return getCreateVideoStartEndCapabilitySet(model);
  }
  if (videoMode === "multi_param") {
    return getCreateVideoMultiParamCapabilitySet(model);
  }
  return null;
}

function assertCreateVideoInputModeSupported(model, videoMode, inputMode) {
  if (videoMode === "image_to_video") {
    const capability = getCreateVideoImageToVideoCapabilitySet(model, inputMode);
    if (!capability?.supported) {
      if (inputMode === "single_reference") {
        throw apiError(400, "UNSUPPORTED_VIDEO_INPUT_MODE", `${normalizeModelId(model || "")} does not support single-reference video in this page.`);
      }
      throw apiError(400, "UNSUPPORTED_VIDEO_INPUT_MODE", `${normalizeModelId(model || "")} requires a reference image in this page.`);
    }
    return;
  }
  if (videoMode === "start_end_frame") {
    const capability = getCreateVideoStartEndCapabilitySet(model);
    if (!capability?.supported) {
      throw apiError(
        400,
        "UNSUPPORTED_VIDEO_INPUT_MODE",
        `${normalizeModelId(model || "")} does not support start-end-frame video in this page.`
      );
    }
    return;
  }
  if (videoMode === "multi_param") {
    const capability = getCreateVideoMultiParamCapabilitySet(model);
    if (!capability?.supported) {
      throw apiError(
        400,
        "UNSUPPORTED_VIDEO_INPUT_MODE",
        `${normalizeModelId(model || "")} does not support multi-reference video in this page.`
      );
    }
  }
}

function getFixedCreateVideoCapabilities(model, videoMode) {
  const normalizedMode = String(videoMode || "").trim().toLowerCase();
  const normalizedModel = normalizeModelId(model || "");
  return FIXED_CREATE_VIDEO_CAPABILITIES[normalizedMode]?.[normalizedModel] || null;
}

function normalizeStoredVideoDuration(duration) {
  const parsed = Number.parseInt(String(duration || "").replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return "3s";
  }
  return `${parsed}s`;
}

function resolveSelectableCapabilityValue(requestedValue, supportedValues, defaultValue) {
  const normalizedRequestedValue = String(requestedValue ?? "").trim();
  const normalizedSupportedValues = Array.isArray(supportedValues)
    ? supportedValues.map((value) => String(value).trim()).filter(Boolean)
    : [];
  if (normalizedRequestedValue && normalizedSupportedValues.includes(normalizedRequestedValue)) {
    return normalizedRequestedValue;
  }
  const normalizedDefaultValue = String(defaultValue ?? "").trim();
  if (normalizedDefaultValue) {
    return normalizedDefaultValue;
  }
  if (normalizedSupportedValues.length) {
    return normalizedSupportedValues[0];
  }
  return normalizedRequestedValue;
}

function normalizeStoredVideoAspectRatio(aspectRatio) {
  const normalizedAspectRatio = String(aspectRatio || "").trim();
  return ["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9", "adaptive"].includes(normalizedAspectRatio)
    ? normalizedAspectRatio
    : "16:9";
}

function resolveCreateVideoDuration(model, duration, videoMode, inputMode = null) {
  const requestedDuration = normalizeStoredVideoDuration(duration);
  const inputModeCapability = getCreateVideoCapabilitySetForMode(model, videoMode, inputMode);
  if (inputModeCapability?.supported) {
    return {
      requestedDuration,
      normalizedDuration: resolveSelectableCapabilityValue(
        requestedDuration,
        inputModeCapability.supportedDurations,
        inputModeCapability.defaultDuration
      ),
      durationControl: inputModeCapability.durationControl,
      supportedDurations: inputModeCapability.supportedDurations,
    };
  }
  const fixedCapabilities = getFixedCreateVideoCapabilities(model, videoMode);

  if (fixedCapabilities) {
    return {
      requestedDuration,
      normalizedDuration: fixedCapabilities.duration,
      durationControl: "fixed",
      supportedDurations: fixedCapabilities.supportedDurations,
    };
  }

  return {
    requestedDuration,
    normalizedDuration: requestedDuration,
    durationControl: "selectable",
    supportedDurations: ["3s", "5s"],
  };
}

function resolveCreateVideoAspectRatio(model, aspectRatio, videoMode, inputMode = null) {
  const requestedAspectRatio = normalizeStoredVideoAspectRatio(aspectRatio);
  const inputModeCapability = getCreateVideoCapabilitySetForMode(model, videoMode, inputMode);
  if (inputModeCapability?.supported) {
    return {
      requestedAspectRatio,
      normalizedAspectRatio: resolveSelectableCapabilityValue(
        requestedAspectRatio,
        inputModeCapability.supportedAspectRatios,
        inputModeCapability.defaultAspectRatio
      ),
      aspectRatioControl: inputModeCapability.aspectRatioControl,
      supportedAspectRatios: inputModeCapability.supportedAspectRatios,
    };
  }
  const fixedCapabilities = getFixedCreateVideoCapabilities(model, videoMode);

  if (fixedCapabilities) {
    return {
      requestedAspectRatio,
      normalizedAspectRatio: fixedCapabilities.aspectRatio,
      aspectRatioControl: "fixed",
      supportedAspectRatios: fixedCapabilities.supportedAspectRatios,
    };
  }

  return {
    requestedAspectRatio,
    normalizedAspectRatio: requestedAspectRatio,
    aspectRatioControl: "selectable",
    supportedAspectRatios: ["16:9", "1:1", "9:16"],
  };
}

function resolveCreateVideoResolution(model, resolution, videoMode, inputMode = null) {
  const normalizedModelForDefault = normalizeModelId(model || "");
  const isSeedance = normalizedModelForDefault.startsWith("doubao-seedance");
  const isPixverse = normalizedModelForDefault.startsWith("pixverse");
  const defaultResolution = isSeedance || isPixverse ? "720p" : (videoMode === "start_end_frame" ? "720p" : "1080p");
  const requestedResolution = String(
    resolution || defaultResolution
  )
    .trim()
    .toLowerCase();
  const normalizedModel = normalizeModelId(model || "");
  const inputModeCapability = getCreateVideoCapabilitySetForMode(model, videoMode, inputMode);
  if (inputModeCapability?.supported) {
    return {
      requestedResolution,
      normalizedResolution: resolveSelectableCapabilityValue(
        requestedResolution,
        inputModeCapability.supportedResolutions,
        inputModeCapability.defaultResolution
      ).toLowerCase(),
      resolutionControl: inputModeCapability.resolutionControl,
      supportedResolutions: inputModeCapability.supportedResolutions,
    };
  }
  const fixedCapabilities = getFixedCreateVideoCapabilities(model, videoMode);

  if (fixedCapabilities) {
    return {
      requestedResolution,
      normalizedResolution: fixedCapabilities.resolution,
      resolutionControl: "fixed",
      supportedResolutions: fixedCapabilities.supportedResolutions,
    };
  }

  if (videoMode === "image_to_video" && getMediaGenerationProvider("video", normalizedModel) === "yunwu") {
    return {
      requestedResolution,
      normalizedResolution: "1080p",
      resolutionControl: "fixed",
      supportedResolutions: ["1080p"],
    };
  }

  return {
    requestedResolution,
    normalizedResolution: normalizeStoredVideoResolution(model, requestedResolution),
    resolutionControl: "selectable",
    supportedResolutions: ["1080p", "720p"],
  };
}

function isCreateVideoTextModel(model) {
  const normalized = normalizeModelId(model || "");
  return [
    "pixverse-c1",
    "pixverse-v6",
    "kling-video",
    "veo3.1",
    "veo3.1-pro",
    "veo3.1-fast",
    "veo_3_1-4K",
    "veo_3_1-fast-4K",
    "grok-video-3",
  ].includes(normalized);
}

function sanitizeReferenceImageUrls(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

const MULTI_VIDEO_REF_ORDER = [
  "scene",
  "character",
  "prop",
  "pose",
  "expression",
  "effect",
  "sketch",
];

const MULTI_VIDEO_REF_LABELS = {
  scene: "场景",
  character: "角色",
  prop: "道具",
  pose: "姿态",
  expression: "表情",
  effect: "特效",
  sketch: "手绘稿",
};

function sanitizeMultiReferenceImages(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of MULTI_VIDEO_REF_ORDER) {
    const value = raw[key];
    if (Array.isArray(value)) {
      const urls = value
        .map((item) => String(item || "").trim())
        .filter(Boolean);
      if (urls.length) {
        out[key] = urls;
      }
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      out[key] = [value.trim()];
    }
  }
  return out;
}

function pickPrimaryMultiReferenceUrl(multiRef) {
  for (const key of MULTI_VIDEO_REF_ORDER) {
    const urls = Array.isArray(multiRef[key]) ? multiRef[key] : [];
    if (urls[0]) return urls[0];
  }
  return null;
}

function buildMultiParamVideoProviderPrompt(userPrompt, multiRef) {
  const labels = [];
  for (const key of MULTI_VIDEO_REF_ORDER) {
    if (Array.isArray(multiRef[key]) && multiRef[key].length) labels.push(MULTI_VIDEO_REF_LABELS[key]);
  }
  if (!labels.length) return String(userPrompt || "").trim();
  const header = `【多参参考】已提供以下类型的参考图：${labels.join(
    "、",
  )}。当前接口以「场景→角色→道具→姿态→表情→特效→手绘稿」优先级选取一张作为视频首帧；其余类型请结合提示词综合理解。\n\n`;
  return header + String(userPrompt || "").trim();
}

function buildComponentsMultiParamVideoProviderPrompt(userPrompt, multiRef) {
  const presentKeys = MULTI_VIDEO_REF_ORDER.filter((key) => Array.isArray(multiRef[key]) && multiRef[key].length);
  const roleLines = presentKeys.map((key, index) => {
    const label = MULTI_VIDEO_REF_LABELS[key] || key;
    return `Image ${index + 1}: ${label} reference.`;
  });
  const promptText = String(userPrompt || "").trim();

  return [
    "[Multi-reference components video]",
    "Use every provided reference image together in one coherent video shot.",
    ...roleLines,
    Array.isArray(multiRef.scene) && multiRef.scene.length
      ? "Keep the scene/environment reference as the location and spatial backdrop for the shot."
      : "",
    Array.isArray(multiRef.character) && multiRef.character.length
      ? "Keep the character reference consistent in identity, facial features, hairstyle, body shape, and clothing."
      : "",
    Array.isArray(multiRef.prop) && multiRef.prop.length
      ? "The prop reference must stay clearly visible in the video and must not be omitted, replaced, or reduced to an unrecognizable background detail."
      : "",
    Array.isArray(multiRef.pose) && multiRef.pose.length
      ? "Use the pose reference to guide body action and motion staging when compatible with the prompt."
      : "",
    Array.isArray(multiRef.expression) && multiRef.expression.length
      ? "Use the expression reference to guide facial emotion when compatible with the prompt."
      : "",
    Array.isArray(multiRef.effect) && multiRef.effect.length
      ? "Use the effect reference to guide lighting, atmosphere, or stylization without dropping the required subjects or prop."
      : "",
    Array.isArray(multiRef.sketch) && multiRef.sketch.length
      ? "Use the sketch reference only as a composition cue while keeping the other reference identities and objects intact."
      : "",
    "Do not ignore later images. Do not collapse the result back to only the first one or two references.",
    promptText ? `User prompt: ${promptText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildMultiParamVideoKeyframePrompt(userPrompt, multiRef) {
  const labels = [];
  for (const key of MULTI_VIDEO_REF_ORDER) {
    if (Array.isArray(multiRef[key]) && multiRef[key].length) labels.push(MULTI_VIDEO_REF_LABELS[key] || key);
  }
  const promptText = String(userPrompt || "").trim();
  return [
    "Create one new cinematic first frame for a video shot.",
    "Combine all provided reference elements into the same single frame so the generated video can preserve them together.",
    labels.length ? `Reference categories provided: ${labels.join(", ")}.` : "",
    "Use scene references for environment, character references for identity, prop references for objects, pose references for body action, expression references for facial emotion, effect references for lighting/style, and sketch references for composition cues when available.",
    "All required referenced elements must appear together in one coherent scene at the same time.",
    "Do not return a collage, split screen, contact sheet, or an unchanged copy of any one reference image.",
    "Make the shot video-ready with natural staging, readable motion intent, coherent lighting, and consistent scale.",
    promptText ? `User prompt: ${promptText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildMultiReferenceImagePrompt(userPrompt, referenceCount) {
  const promptText = String(userPrompt || "").trim();
  if (referenceCount <= 1) return promptText;
  const orderHint = Array.from({ length: referenceCount }, (_, i) => `第${i + 1}张输入图即「参考图${["一", "二", "三", "四"][i] || String(i + 1)}」`).join("；");
  return [
    `你将同时收到 ${referenceCount} 张参考图，按上传顺序依次对应：${orderHint}。用户说的「参考图一」「图1」均指第 1 张，「参考图二」「图2」指第 2 张，以此类推。`,
    "请生成一张**新的合成图**：把多张参考图里需要出现的人物/主体画进**同一场景、同一画面**中，完成用户描述的动作或关系（例如一起吃饭、对话、并肩站立）。",
    "必须同时体现至少两张参考图中各自的人物外貌特征，不能只画其中一张图里的人而忽略另一张；也不要直接输出某一张参考图的未修改副本。",
    "各人物五官、发型、体型、服装尽量分别贴近其对应参考图；场景与光影可融合或按提示词重新布置。",
    promptText ? `用户提示词：${promptText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function resolveCreateImageModel(requestedModel, referenceCount, fallbackModel) {
  if (requestedModel) return requestedModel;
  if (referenceCount >= 1) return fallbackModel || "gemini-3-pro-image-preview";
  return fallbackModel || "gemini-3-pro-image-preview";
}

function resolveCreateVideoModel(
  requestedModel,
  referenceImageUrl,
  fallbackModel,
  hasFirstFrameUrl,
  videoMode,
  hasMultiReferenceImages
) {
  // Seedance 2.0 is the primary product baseline for all video modes.
  const seedanceDefault = "doubao-seedance-2-0-260128";
  const multiParamFallbackModel = fallbackModel || seedanceDefault;
  const preferredModel =
    requestedModel ||
    fallbackModel ||
    seedanceDefault;
  if (requestedModel) return requestedModel;
  if (videoMode === "multi_param") {
    return multiParamFallbackModel;
  }
  if (hasFirstFrameUrl) return fallbackModel || seedanceDefault;
  if (referenceImageUrl) return preferredModel || seedanceDefault;
  return preferredModel || seedanceDefault;
}

function formatCreateVideoModelLabel(model) {
  const normalizedModel = normalizeModelId(model || "");
  return model || normalizedModel || "unknown-video-model";
}

function resolveStableCreateVideoModeModel(requestedModel, videoMode) {
  // Seedance 2.0 is the primary product baseline for all video modes.
  const seedanceDefault = "doubao-seedance-2-0-260128";
  if (videoMode === "start_end_frame") {
    const normalizedRequestedModel = normalizeModelId(requestedModel || "");
    if (!normalizedRequestedModel) {
      return seedanceDefault;
    }
    return requestedModel;
  }

  if (videoMode === "multi_param") {
    return requestedModel || seedanceDefault;
  }

  return requestedModel;
}

function isUnsupportedYunwuModelError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    message.includes("model not found") ||
    message.includes("unsupported model") ||
    message.includes("not supported") ||
    message.includes("unsupported") ||
    message.includes("invalid model") ||
    message.includes("no such model") ||
    message.includes("does not exist")
  );
}

function getStartEndProviderModelCandidates(model, videoMode) {
  if (videoMode !== "start_end_frame") {
    return [model];
  }

  const normalizedModel = normalizeModelId(model || "");
  return [normalizedModel];
}

function getMultiParamProviderModelCandidates(model, videoMode) {
  const normalizedModel = normalizeModelId(model || "");
  if (videoMode !== "multi_param") {
    return [normalizedModel];
  }
  if (normalizedModel === "kling-multi-image2video") {
    return ["kling-multi-image2video"];
  }
  if (normalizedModel === "kling-multi-elements") {
    return ["kling-multi-elements"];
  }
  if (normalizedModel === "veo_3_1-components") {
    return ["veo_3_1-components"];
  }
  if (normalizedModel === "veo3.1-components") {
    return ["veo3.1-components", "veo_3_1-components"];
  }
  return [normalizedModel || "veo3.1-components"];
}

function deriveStoryboardVideoStatus({ storyboard, latestTask, latestVideo }) {
  if (latestTask?.status === "failed") return "failed";
  if (latestTask?.status === "running") return "running";
  if (latestTask?.status === "queued") return "queued";
  if (latestVideo) return "ready";
  if (storyboard.videoStatus === "ready") return "draft";
  if (storyboard.videoStatus === "failed") return "failed";
  if (storyboard.videoStatus === "running") return "running";
  return "draft";
}

function roundTimelineSeconds(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(Math.max(0, numeric) * 100) / 100;
}

function clampTimelineValue(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  return Math.min(max, Math.max(min, numeric));
}

function sortTimelineClips(a, b) {
  if (a.startTimeSeconds !== b.startTimeSeconds) {
    return a.startTimeSeconds - b.startTimeSeconds;
  }
  return String(a.id).localeCompare(String(b.id));
}

function hasPlayableVideoTimelineClips(timeline) {
  if (!timeline || !Array.isArray(timeline.tracks)) return false;

  const videoTrack = timeline.tracks.find((track) => track?.type === "video");
  if (!videoTrack || !Array.isArray(videoTrack.clips)) return false;

  return videoTrack.clips.some((clip) => clip?.enabled !== false && clip?.url);
}

function withTimeout(promise, timeoutMs, fallbackErrorMessage = "Operation timed out.") {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(fallbackErrorMessage)), timeoutMs);
    }),
  ]);
}

function cleanStoryboardText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^△\s*/gm, "")
    .trim();
}

function inferStoryboardDuration(text) {
  const length = cleanStoryboardText(text).length;
  if (length <= 24) return 3;
  if (length <= 60) return 4;
  if (length <= 110) return 5;
  return 6;
}

function summarizeStoryboardText(text, limit = 28) {
  const cleaned = cleanStoryboardText(text);
  if (!cleaned) return "自动拆分镜头";
  const summary = cleaned.split(/[。！？\n]/).find(Boolean) || cleaned;
  return summary.length > limit ? `${summary.slice(0, limit)}…` : summary;
}

function titleFromStoryboardText(text, index) {
  const cleaned = summarizeStoryboardText(text, 12).replace(/[：:，,。！？!?\s]+$/g, "");
  return cleaned || `镜头 ${index + 1}`;
}

function inferShotType(text) {
  const value = cleanStoryboardText(text);
  if (/特写|眼神|眼睛|瞳孔|嘴角|手指|手部|表情|脸部/.test(value)) return "特写";
  if (/群山|全景|天空|远处|城外|整片|全貌|山间|圣地/.test(value)) return "远景";
  if (/两人|人物|半身|对视|站在|来到|走到/.test(value)) return "中景";
  return "近景";
}

function inferComposition(text) {
  const value = cleanStoryboardText(text);
  if (/对视|并肩|追逐|冲向|交错/.test(value)) return "对角线构图";
  if (/穿过|拨开|门口|窗外|前景|崖边/.test(value)) return "前景遮挡";
  if (/孤身|空旷|回音|天空|远处/.test(value)) return "留白构图";
  return "居中构图";
}

function inferColorTone(text) {
  const value = cleanStoryboardText(text);
  if (/霓虹|紫色|雨夜|蓝色|夜色/.test(value)) return "霓虹";
  if (/金光|阳光|暖黄|火光/.test(value)) return "暖色";
  if (/冷|寒|雾气|清晨/.test(value)) return "冷色";
  return "低饱和";
}

function inferLighting(text) {
  const value = cleanStoryboardText(text);
  if (/雨夜|霓虹|夜色/.test(value)) return "雨夜霓虹";
  if (/阳光|太阳|金光/.test(value)) return "顶光";
  if (/逆光|剪影/.test(value)) return "逆光";
  return "柔光";
}

function inferTechnique(text) {
  const value = cleanStoryboardText(text);
  if (/飞快|踉跄|巨响|摔倒|冲天而起|惨叫/.test(value)) return "手持感";
  if (/倒影|眼神|抚摸|特写|细节/.test(value)) return "浅景深";
  if (/纪录|真实|街头|白描/.test(value)) return "写实摄影";
  return "电影感";
}

function inferFocalLength(shotType) {
  if (shotType === "远景") return "24mm";
  if (shotType === "特写") return "85mm";
  if (shotType === "近景") return "50mm";
  return "35mm";
}

function splitStoryboardTextHeuristically(content) {
  const cleaned = cleanStoryboardText(content);
  if (!cleaned) return [];

  const lines = cleaned
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const scenes = [];
  let currentScene = null;

  for (const line of lines) {
    if (/^第.+(集|话|章)$/.test(line) || /^EP\s*\d+/i.test(line)) {
      continue;
    }

    if (/^场[\d一二三四五六七八九十百千万\-]+/.test(line) || /^第.+场/.test(line)) {
      if (currentScene) scenes.push(currentScene);
      currentScene = {
        heading: line,
        lines: [],
      };
      continue;
    }

    if (!currentScene) {
      currentScene = {
        heading: "",
        lines: [],
      };
    }

    if (/^(景|人物)[:：]/.test(line)) {
      continue;
    }

    currentScene.lines.push(line.replace(/^△\s*/, ""));
  }

  if (currentScene) scenes.push(currentScene);

  const beats = [];
  for (const scene of scenes) {
    const fragments = [];
    for (const line of scene.lines) {
      const normalizedLine = line.replace(/\s+/g, " ").trim();
      if (!normalizedLine) continue;

      if (normalizedLine.length > 80 && /[。！？]/.test(normalizedLine)) {
        const sentences = normalizedLine
          .split(/(?<=[。！？])/)
          .map((item) => item.trim())
          .filter(Boolean);
        fragments.push(...sentences);
      } else {
        fragments.push(normalizedLine);
      }
    }

    let bucket = [];
    let bucketLength = 0;
    for (const fragment of fragments) {
      const nextLength = bucketLength + fragment.length;
      if (bucket.length && (bucket.length >= 2 || nextLength > 70)) {
        beats.push(bucket.join(" "));
        bucket = [];
        bucketLength = 0;
      }
      bucket.push(fragment);
      bucketLength += fragment.length;
    }

    if (bucket.length) {
      beats.push(bucket.join(" "));
    }
  }

  const normalizedBeats = beats
    .map((item) => cleanStoryboardText(item))
    .filter(Boolean)
    .slice(0, 12);

  if (normalizedBeats.length) {
    return normalizedBeats;
  }

  return cleaned
    .split(/(?<=[。！？])/)
    .map((item) => cleanStoryboardText(item))
    .filter(Boolean)
    .slice(0, 8);
}

class MockStore {
  constructor() {
    this.events = new EventEmitter();
    this.reset();
  }

  reset() {
    this.state = createSeedData();
    this.normalizeState();
  }

  normalizeState() {
    const config = this.state?.apiCenterConfig;
    let changed = false;

    if (this.ensureIdentityAndBillingState()) {
      changed = true;
    }

    if (config) {
      if (ensureApiCenterVendorCatalog(config)) {
        changed = true;
      }

      if (syncApiCenterRuntimeVendorState(config)) {
        changed = true;
      }

      const defaults = config.defaults || {};
      const textModelId = defaults.textModelId || "qwen-plus";
      const visionModelId = defaults.visionModelId || "qwen-vl-plus";
      const nodeAssignments = Array.isArray(config.nodeAssignments)
        ? config.nodeAssignments
        : [];
      const assetsNode = nodeAssignments.find((item) => item.nodeCode === "assets");

      if (assetsNode) {
        const previousPrimaryModelId = assetsNode.primaryModelId || null;

        if (!previousPrimaryModelId || previousPrimaryModelId === visionModelId) {
          assetsNode.primaryModelId = textModelId;
          changed = true;
        }

        const previousFallbacks = Array.isArray(assetsNode.fallbackModelIds)
          ? assetsNode.fallbackModelIds.filter(Boolean)
          : [];
        const normalizedFallbacks = previousFallbacks.filter(
          (item) => item !== assetsNode.primaryModelId && item !== visionModelId
        );
        if (
          normalizedFallbacks.length !== previousFallbacks.length ||
          normalizedFallbacks.some((item, index) => item !== previousFallbacks[index])
        ) {
          assetsNode.fallbackModelIds = normalizedFallbacks;
          changed = true;
        }

        const expectedNote = "Extract characters, scenes, and props from script text only.";
        if (assetsNode.notes !== expectedNote) {
          assetsNode.notes = expectedNote;
          changed = true;
        }
      }
    }

    for (const items of Object.values(this.state.assetsByProjectId || {})) {
      if (!Array.isArray(items)) continue;

      for (const asset of items) {
        const nextScope =
          asset.scope ||
          (["asset_char_001", "asset_char_002", "asset_scene_001"].includes(asset.id)
            ? "seed"
            : "manual");
        const referenceImageUrls = Array.isArray(asset.referenceImageUrls)
          ? asset.referenceImageUrls.filter(Boolean)
          : [];
        const nextGenerationPrompt =
          typeof asset.generationPrompt === "string" && asset.generationPrompt.trim()
            ? asset.generationPrompt.trim()
            : this.buildAssetGenerationPrompt(asset);
        const nextImageStatus =
          asset.imageStatus || (asset.previewUrl ? "ready" : "draft");
        const nextImageModel =
          asset.imageModel ||
          (referenceImageUrls.length
            ? "gemini-3-pro-image-preview"
            : "gemini-3-pro-image-preview");
        const nextAspectRatio = asset.aspectRatio || "1:1";
        const nextNegativePrompt =
          typeof asset.negativePrompt === "string" ? asset.negativePrompt : "";

        if (
          asset.generationPrompt !== nextGenerationPrompt ||
          asset.imageStatus !== nextImageStatus ||
          asset.imageModel !== nextImageModel ||
          asset.aspectRatio !== nextAspectRatio ||
          asset.negativePrompt !== nextNegativePrompt ||
          asset.scope !== nextScope ||
          !Array.isArray(asset.referenceImageUrls) ||
          asset.referenceImageUrls.length !== referenceImageUrls.length ||
          asset.referenceImageUrls.some((item, index) => item !== referenceImageUrls[index])
        ) {
          Object.assign(asset, {
            generationPrompt: nextGenerationPrompt,
            referenceImageUrls,
            imageStatus: nextImageStatus,
            imageModel: nextImageModel,
            aspectRatio: nextAspectRatio,
            negativePrompt: nextNegativePrompt,
            scope: nextScope,
          });
          changed = true;
        }
      }
    }

    const latestVideoTaskByStoryboardId = new Map();
    for (const task of this.state.tasks || []) {
      if (task?.type !== "video_generate" || !task.storyboardId) continue;
      if (!latestVideoTaskByStoryboardId.has(task.storyboardId)) {
        latestVideoTaskByStoryboardId.set(task.storyboardId, task);
      }
    }

    for (const [projectId, storyboards] of Object.entries(this.state.storyboardsByProjectId || {})) {
      if (!Array.isArray(storyboards)) continue;

      const projectVideos = Array.isArray(this.state.videosByProjectId?.[projectId])
        ? this.state.videosByProjectId[projectId]
        : [];

      for (const storyboard of storyboards) {
        const isStartEndMode = storyboard.videoMode === "start_end_frame";
        const videoModel =
          storyboard.videoModel ||
          this.getNodePrimaryModel(
            isStartEndMode ? "video_kf2v" : "video_i2v",
            this.getDefaultModelId("videoModelId", "veo3.1-pro")
          );
        const nextVideoResolution = normalizeStoredVideoResolution(
          videoModel,
          storyboard.videoResolution || "720p"
        );
        const latestVideoTask = latestVideoTaskByStoryboardId.get(storyboard.id) || null;
        const latestVideo = projectVideos.find((item) => item.storyboardId === storyboard.id) || null;
        const nextVideoStatus = deriveStoryboardVideoStatus({
          storyboard,
          latestTask: latestVideoTask,
          latestVideo,
        });

        if (
          storyboard.videoResolution !== nextVideoResolution ||
          storyboard.videoStatus !== nextVideoStatus
        ) {
          Object.assign(storyboard, {
            videoResolution: nextVideoResolution,
            videoStatus: nextVideoStatus,
          });
          changed = true;
        }
      }
    }

    for (const project of this.state.projects || []) {
      const timeline = this.state.timelinesByProjectId?.[project.id] || null;
      const hasReadyVideos = Array.isArray(this.state.videosByProjectId?.[project.id])
        ? this.state.videosByProjectId[project.id].some(
            (video) => video?.status === "ready" && video?.videoUrl
          )
        : false;
      const needsDetailedTimeline =
        !timeline ||
        !Array.isArray(timeline.tracks) ||
        timeline.tracks.some((track) => !Array.isArray(track?.clips)) ||
        (hasReadyVideos && !hasPlayableVideoTimelineClips(timeline));

      const nextTimeline = needsDetailedTimeline
        ? this.buildDefaultTimeline(project.id, timeline)
        : this.normalizeTimelinePayload(project.id, timeline, {
            incrementVersion: false,
            updatedAt: timeline.updatedAt,
          });

      if (JSON.stringify(nextTimeline) !== JSON.stringify(timeline)) {
        this.state.timelinesByProjectId[project.id] = nextTimeline;
        changed = true;
      }
    }

    if (this.syncLegacyWalletState()) {
      changed = true;
    }

    return changed;
  }

  getDefaultModelId(key, fallback = null) {
    return this.state.apiCenterConfig?.defaults?.[key] || fallback;
  }

  getNodePrimaryModel(nodeCode, fallback = null) {
    const match = (this.state.apiCenterConfig?.nodeAssignments || []).find(
      (item) => item.nodeCode === nodeCode
    );
    return match?.primaryModelId || fallback;
  }

  getPublicBaseUrl() {
    return process.env.CORE_API_PUBLIC_BASE_URL || "http://localhost:4100";
  }

  buildDefaultTimeline(projectId, existingTimeline = null) {
    const storyboards = [...(this.state.storyboardsByProjectId?.[projectId] || [])].sort(
      (left, right) => left.shotNo - right.shotNo
    );
    const videos = Array.isArray(this.state.videosByProjectId?.[projectId])
      ? this.state.videosByProjectId[projectId]
      : [];
    const dubbings = Array.isArray(this.state.dubbingsByProjectId?.[projectId])
      ? this.state.dubbingsByProjectId[projectId]
      : [];
    const existingTracks = Array.isArray(existingTimeline?.tracks) ? existingTimeline.tracks : [];
    const existingVideoTrack = existingTracks.find((track) => track?.type === "video") || null;
    const existingAudioTrack = existingTracks.find((track) => track?.type === "audio") || null;

    let playhead = 0;
    const videoClips = [];
    for (const storyboard of storyboards) {
      const latestVideo = videos.find(
        (item) => item.storyboardId === storyboard.id && item.status === "ready" && item.videoUrl
      );
      if (!latestVideo) continue;

      const existingClip =
        existingVideoTrack?.clips?.find(
          (clip) => clip?.sourceId === latestVideo.id || clip?.storyboardId === storyboard.id
        ) || null;
      const sourceDuration = Math.max(
        0.5,
        roundTimelineSeconds(latestVideo.durationSeconds || storyboard.durationSeconds || 3)
      );
      const trimStartSeconds = clampTimelineValue(existingClip?.trimStartSeconds || 0, 0, sourceDuration - 0.5);
      const durationSeconds = clampTimelineValue(
        existingClip?.durationSeconds || sourceDuration,
        0.5,
        Math.max(0.5, sourceDuration - trimStartSeconds)
      );

      videoClips.push({
        id: existingClip?.id || `track_video_${storyboard.id}`,
        type: "video",
        sourceType: "storyboard_video",
        sourceId: latestVideo.id,
        storyboardId: storyboard.id,
        title: `S${String(storyboard.shotNo).padStart(2, "0")} ${storyboard.title}`,
        startTimeSeconds: roundTimelineSeconds(playhead),
        durationSeconds,
        trimStartSeconds,
        enabled: existingClip?.enabled !== false,
        muted: existingClip?.muted === true,
        url: latestVideo.videoUrl || null,
        thumbnailUrl: latestVideo.thumbnailUrl || storyboard.imageUrl || null,
        text: storyboard.script || "",
      });

      playhead += durationSeconds;
    }

    const videoTrackDuration = roundTimelineSeconds(playhead);
    const videoClipByStoryboardId = new Map(videoClips.map((clip) => [clip.storyboardId, clip]));
    const audioClips = [];
    for (const dubbing of dubbings) {
      if (dubbing.status !== "ready" || !dubbing.audioUrl) continue;
      const videoClip = videoClipByStoryboardId.get(dubbing.storyboardId);
      if (!videoClip) continue;

      const existingClip =
        existingAudioTrack?.clips?.find(
          (clip) => clip?.sourceId === dubbing.id || clip?.storyboardId === dubbing.storyboardId
        ) || null;
      const durationSeconds = clampTimelineValue(
        existingClip?.durationSeconds || videoClip.durationSeconds,
        0.5,
        Math.max(0.5, videoClip.durationSeconds)
      );
      const startTimeSeconds = clampTimelineValue(
        existingClip?.startTimeSeconds ?? videoClip.startTimeSeconds,
        0,
        Math.max(videoTrackDuration, 0)
      );

      audioClips.push({
        id: existingClip?.id || `track_audio_${dubbing.id}`,
        type: "audio",
        sourceType: "dubbing_audio",
        sourceId: dubbing.id,
        storyboardId: dubbing.storyboardId,
        title: dubbing.speakerName || videoClip.title,
        startTimeSeconds: roundTimelineSeconds(startTimeSeconds),
        durationSeconds,
        trimStartSeconds: roundTimelineSeconds(existingClip?.trimStartSeconds || 0),
        enabled: existingClip?.enabled !== false,
        muted: existingClip?.muted === true,
        url: dubbing.audioUrl || null,
        thumbnailUrl: videoClip.thumbnailUrl || null,
        text: dubbing.text || "",
      });
    }

    return this.normalizeTimelinePayload(
      projectId,
      {
        version: existingTimeline?.version || 1,
        tracks: [
          {
            id: "track_video",
            type: "video",
            label: "Video Track",
            enabled: existingVideoTrack?.enabled !== false,
            muted: existingVideoTrack?.muted === true,
            volume: existingVideoTrack?.volume ?? 1,
            clips: videoClips,
          },
          {
            id: "track_audio",
            type: "audio",
            label: "Audio Track",
            enabled: existingAudioTrack?.enabled !== false,
            muted: existingAudioTrack?.muted === true,
            volume: existingAudioTrack?.volume ?? 1,
            clips: audioClips,
          },
        ],
      },
      {
        incrementVersion: false,
        updatedAt: existingTimeline?.updatedAt,
      }
    );
  }

  normalizeTimelinePayload(projectId, input, options = {}) {
    const existingTimeline = this.state.timelinesByProjectId?.[projectId] || null;
    const rawTracks = Array.isArray(input?.tracks) ? input.tracks : [];
    const tracks = rawTracks
      .map((track, trackIndex) => {
        const type = String(track?.type || (trackIndex === 0 ? "video" : "audio")).toLowerCase() === "audio"
          ? "audio"
          : "video";
        const trackId = String(track?.id || `track_${type}`);
        const rawClips = Array.isArray(track?.clips) ? track.clips : [];
        const clips = rawClips
          .map((clip, clipIndex) => ({
            id: String(clip?.id || `${trackId}_clip_${clipIndex + 1}`),
            type,
            sourceType: String(
              clip?.sourceType || (type === "audio" ? "dubbing_audio" : "storyboard_video")
            ),
            sourceId: clip?.sourceId ? String(clip.sourceId) : null,
            storyboardId: clip?.storyboardId ? String(clip.storyboardId) : null,
            title: String(clip?.title || `Clip ${clipIndex + 1}`),
            startTimeSeconds: roundTimelineSeconds(clip?.startTimeSeconds || 0),
            durationSeconds: Math.max(0.5, roundTimelineSeconds(clip?.durationSeconds || 0.5)),
            trimStartSeconds: roundTimelineSeconds(clip?.trimStartSeconds || 0),
            enabled: clip?.enabled !== false,
            muted: clip?.muted === true,
            url: clip?.url ? String(clip.url) : null,
            thumbnailUrl: clip?.thumbnailUrl ? String(clip.thumbnailUrl) : null,
            text: clip?.text ? String(clip.text) : "",
          }))
          .sort(sortTimelineClips);

        return {
          id: trackId,
          type,
          label: String(track?.label || (type === "audio" ? "Audio Track" : "Video Track")),
          enabled: track?.enabled !== false,
          muted: track?.muted === true,
          volume: clampTimelineValue(track?.volume ?? 1, 0, 1),
          itemCount: clips.length,
          clips,
        };
      })
      .filter(Boolean);

    const totalDurationSeconds = roundTimelineSeconds(
      tracks.reduce((maxDuration, track) => {
        const trackDuration = track.clips.reduce((clipMax, clip) => {
          if (!clip.enabled || !track.enabled) return clipMax;
          return Math.max(clipMax, clip.startTimeSeconds + clip.durationSeconds);
        }, 0);
        return Math.max(maxDuration, trackDuration);
      }, 0)
    );

    return {
      projectId,
      version: options.incrementVersion
        ? (Number(existingTimeline?.version || 1) + 1)
        : Number(input?.version || existingTimeline?.version || 1),
      totalDurationSeconds,
      tracks,
      updatedAt: options.updatedAt || new Date().toISOString(),
    };
  }

  buildStoryboardShotsFallback(content) {
    return splitStoryboardTextHeuristically(content).map((script, index) => {
      const shotType = inferShotType(script);
      return {
        title: titleFromStoryboardText(script, index),
        script,
        durationSeconds: inferStoryboardDuration(script),
        promptSummary: summarizeStoryboardText(script, 32),
        shotType,
        composition: inferComposition(script),
        focalLength: inferFocalLength(shotType),
        colorTone: inferColorTone(script),
        lighting: inferLighting(script),
        technique: inferTechnique(script),
        assetNames: [],
      };
    });
  }

  matchStoryboardAssetIds(projectId, scriptText, assetNames = []) {
    const items = Array.isArray(this.state.assetsByProjectId?.[projectId])
      ? this.state.assetsByProjectId[projectId]
      : [];
    if (!items.length) return [];

    const explicitNames = Array.isArray(assetNames)
      ? assetNames.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const haystack = cleanStoryboardText(scriptText);
    const matched = [];

    for (const asset of items) {
      const assetName = String(asset?.name || "").trim();
      if (!assetName) continue;
      if (explicitNames.includes(assetName) || haystack.includes(assetName)) {
        matched.push(asset.id);
      }
    }

    return [...new Set(matched)];
  }

  createStoryboardRecord(projectId, shot, shotNo) {
    const settings = this.state.settingsByProjectId?.[projectId] || {};
    const aspectRatio = settings.aspectRatio || "16:9";
    const durationSeconds = Math.max(
      2,
      Math.min(8, Number.parseInt(String(shot?.durationSeconds || 4), 10) || 4)
    );
    const script = cleanStoryboardText(shot?.script || "");
    const shotType = shot?.shotType || inferShotType(script);

    return {
      id: `sb_${randomUUID().slice(0, 8)}`,
      projectId,
      shotNo,
      title: String(shot?.title || "").trim() || titleFromStoryboardText(script, shotNo - 1),
      script,
      imageStatus: "draft",
      videoStatus: "draft",
      durationSeconds,
      promptSummary:
        String(shot?.promptSummary || "").trim() || summarizeStoryboardText(script, 32),
      imageUrl: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      assetIds: this.matchStoryboardAssetIds(projectId, script, shot?.assetNames),
      composition: shot?.composition || inferComposition(script),
      shotType,
      focalLength: shot?.focalLength || inferFocalLength(shotType),
      colorTone: shot?.colorTone || inferColorTone(script),
      lighting: shot?.lighting || inferLighting(script),
      technique: shot?.technique || inferTechnique(script),
      modelName: "gemini-3-pro-image-preview",
      aspectRatio,
      imageQuality: "2K",
      videoMode: "image_to_video",
      videoPrompt: script,
      motionPreset: "智能运镜",
      motionDescription: "",
      videoModel: this.getNodePrimaryModel(
        "video_i2v",
        this.getDefaultModelId("videoModelId", "veo3.1-pro")
      ),
      videoAspectRatio: aspectRatio,
      videoResolution: "720p",
      videoDuration: `${durationSeconds}s`,
      referenceImageUrls: [],
      startFrameUrl: null,
      endFrameUrl: null,
    };
  }

  buildStoryboardAssetSummary(state, storyboard) {
    const selectedAssetIds = Array.isArray(storyboard?.assetIds) ? storyboard.assetIds : [];
    if (!selectedAssetIds.length) return "";

    const items = Array.isArray(state.assetsByProjectId?.[storyboard.projectId])
      ? state.assetsByProjectId[storyboard.projectId]
      : [];
    const selectedAssets = items.filter((item) => selectedAssetIds.includes(item.id));
    if (!selectedAssets.length) return "";

    const grouped = {
      character: [],
      scene: [],
      prop: [],
    };

    for (const asset of selectedAssets) {
      if (!grouped[asset.assetType]) continue;
      grouped[asset.assetType].push(asset.name);
    }

    const summaryParts = [];
    if (grouped.character.length) summaryParts.push(`角色：${grouped.character.join("、")}`);
    if (grouped.scene.length) summaryParts.push(`场景：${grouped.scene.join("、")}`);
    if (grouped.prop.length) summaryParts.push(`道具：${grouped.prop.join("、")}`);

    return summaryParts.join("；");
  }

  buildVideoRhythmHint(duration) {
    const parsed = Number.parseInt(String(duration || "").replace(/[^\d]/g, ""), 10);
    if (parsed <= 3) {
      return "短促明确，聚焦一个核心动作点，起势和收束都要干净利落。";
    }
    if (parsed <= 5) {
      return "节奏舒缓连贯，允许轻微铺垫与收束，但不要拖沓。";
    }
    return "节奏从容稳定，镜头变化要平滑，主体动作层次要完整。";
  }

  buildMotionDirective(storyboard) {
    const motionPreset = String(storyboard?.motionPreset || "智能运镜").trim() || "智能运镜";
    const motionDescription = String(storyboard?.motionDescription || "").trim();

    const baseByPreset = {
      "智能运镜": "根据主体动作自动安排轻微运镜，以稳定叙事和突出主体为优先。",
      "平移": "采用稳定平移或跟拍，让主体在画面中持续保持关注点。",
      "推进": "镜头缓慢向主体推进，逐步强化情绪与视觉焦点。",
      "拉远": "镜头从主体平滑后拉，逐步交代环境与人物关系。",
      "环绕": "围绕主体做小幅环绕，保持运动平稳，不要夸张旋转。",
      "静止": "固定机位，不做明显相机位移，只保留主体动作和环境变化。",
    };

    const base = baseByPreset[motionPreset] || `镜头运动以“${motionPreset}”为主，运动方向要明确且平滑。`;
    return motionDescription ? `${base} 额外要求：${motionDescription}` : base;
  }

  buildStoryboardVideoPrompt(state, storyboard, input = {}) {
    const storyScript = String(storyboard?.script || "").trim();
    const contentDescription = String(storyboard?.videoPrompt || "").trim();
    const videoMode = String(storyboard?.videoMode || input?.mode || "image_to_video").trim();
    const aspectRatio = String(storyboard?.videoAspectRatio || storyboard?.aspectRatio || "16:9").trim();
    const duration = String(storyboard?.videoDuration || `${storyboard?.durationSeconds || 3}s`).trim();
    const composition = [storyboard?.shotType, storyboard?.composition, storyboard?.focalLength]
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join("，");
    const style = [storyboard?.colorTone, storyboard?.lighting, storyboard?.technique]
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join("，");
    const assetSummary = this.buildStoryboardAssetSummary(state, storyboard);
    const rhythmHint = this.buildVideoRhythmHint(duration);
    const motionDirective = this.buildMotionDirective(storyboard);
    const modeDirective =
      videoMode === "start_end_frame"
        ? "根据首帧和尾帧完成单镜头连续过渡，保证中间变化自然衔接。"
        : "以参考图或当前分镜图为基础生成单镜头连续视频，保持主体造型与场景一致。";

    return [
      "任务：生成漫画分镜短视频。",
      `模式：${modeDirective}`,
      `剧情动作：${storyScript || contentDescription || "保持当前镜头内容的连续表演。"}`,
      contentDescription && contentDescription !== storyScript
        ? `画面补充：${contentDescription}`
        : null,
      assetSummary ? `关键资产：${assetSummary}` : null,
      `镜头运动：${motionDirective}`,
      `节奏控制：${duration}。${rhythmHint}`,
      composition ? `构图要求：${composition}。` : null,
      `画幅比例：${aspectRatio}。`,
      style ? `风格要求：${style}。` : null,
      "一致性要求：保持角色外观、服装、场景、道具与参考图一致，不新增无关主体，不切换成多镜头，不出现突兀跳变。",
      "输出要求：镜头运动明确、平滑、自然，适合漫剧分镜视频制作。",
    ]
      .filter(Boolean)
      .join("\n");
  }

  buildAssetGenerationPrompt(input = {}) {
    const labelByType = {
      character: "角色设定图",
      scene: "场景设定图",
      prop: "道具设定图",
    };
    const label = labelByType[input.assetType] || "资产设定图";
    const subject = String(input.name || "").trim() || "目标资产";
    const description = String(input.description || "").trim();

    return `${label}，主体是${subject}${description ? `，${description}` : ""}。高细节，构图清晰，适合作为漫剧制作资产库设定图。`;
  }

  getExtensionByContentType(contentType, fallback = ".bin") {
    if (typeof contentType !== "string") return fallback;
    if (contentType.includes("video/mp4")) return ".mp4";
    if (contentType.includes("video/webm")) return ".webm";
    if (contentType.includes("image/png")) return ".png";
    if (contentType.includes("image/jpeg")) return ".jpg";
    if (contentType.includes("image/webp")) return ".webp";
    if (contentType.includes("image/bmp") || contentType.includes("image/x-ms-bmp")) return ".bmp";
    if (contentType.includes("audio/mpeg")) return ".mp3";
    if (contentType.includes("audio/wav")) return ".wav";
    return fallback;
  }

  async mirrorRemoteAssetToUpload({ url, kind, fallbackBaseName, fallbackContentType }) {
    if (!url) return null;

    const response = await fetch(url);
    if (!response.ok) {
      const error = new Error(`failed to fetch remote asset: ${response.status}`);
      error.statusCode = 502;
      error.code = "REMOTE_ASSET_FETCH_FAILED";
      throw error;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get("content-type") || fallbackContentType || "application/octet-stream";
    const extension = this.getExtensionByContentType(contentType, ".bin");
    const upload = await createUploadFromBuffer({
      buffer,
      kind,
      originalName: `${fallbackBaseName}${extension}`,
      contentType,
    });

    return `${this.getPublicBaseUrl()}${upload.urlPath}`;
  }

  shouldNormalizeLocalUploadUrl(url, isVideo = false) {
    if (isVideo || url == null || typeof url !== "string") return false;
    const uploadPath = this.toUploadPath(url);
    if (!uploadPath) return false;
    return /\.(png|webp|bmp)$/i.test(uploadPath);
  }

  async normalizeLocalUploadAssetToUpload({ url, kind, fallbackBaseName, fallbackContentType }) {
    const uploadPath = this.toUploadPath(url);
    if (!uploadPath) return null;

    const upload = readUploadByUrlPath(uploadPath);
    if (!upload) return null;

    const contentType = upload.contentType || fallbackContentType || "application/octet-stream";
    const extension = this.getExtensionByContentType(contentType, ".bin");
    const normalized = await createUploadFromBuffer({
      buffer: readFileSync(upload.absolutePath),
      kind,
      originalName: `${fallbackBaseName}${extension}`,
      contentType,
    });

    return `${this.getPublicBaseUrl()}${normalized.urlPath}`;
  }

  /**
   * 第三方返回的图片/视频 URL（如阿里云 OSS 带签名链接）会过期。
   * 已落在本服务 /uploads/ 下的地址视为已持久化，不再镜像。
   */
  shouldMirrorRemoteAssetUrl(url) {
    if (url == null || typeof url !== "string") return false;
    const t = url.trim();
    if (!t) return false;
    if (t.startsWith("data:") || t.startsWith("blob:")) return false;
    if (t.startsWith("/uploads/")) return false;
    if (!/^https?:\/\//i.test(t)) return false;
    try {
      const u = new URL(t);
      const b = new URL(this.getPublicBaseUrl());
      if (u.origin === b.origin && u.pathname.startsWith("/uploads/")) return false;
    } catch {
      return true;
    }
    return true;
  }

  shouldPersistAssetUrl(url, isVideo = false) {
    return this.shouldMirrorRemoteAssetUrl(url) || this.shouldNormalizeLocalUploadUrl(url, isVideo);
  }

  /**
   * 创建/更新资产前：将可能过期的远程 media/preview 拉取并写入本地 uploads，
   * 数据库中只保存本服务可长期访问的 URL（与用户删除资产前一致可用）。
   */
  async persistEphemeralAssetMedia(input) {
    const out = { ...input };
    const nameSlug =
      String(input.name || "asset")
        .replace(/[^\w\u4e00-\u9fff.-]+/g, "_")
        .slice(0, 64) || "asset";
    const isVideo = input.mediaKind === "video";
    const kind = isVideo ? "asset-video" : "asset-image";
    const fallbackContentType = isVideo ? "video/mp4" : "image/png";

    const p = typeof out.previewUrl === "string" ? out.previewUrl.trim() : "";
    const m = typeof out.mediaUrl === "string" ? out.mediaUrl.trim() : "";
    const refs = Array.isArray(out.referenceImageUrls)
      ? out.referenceImageUrls
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [];

    const persistOne = async (url, suffix) => {
      if (!this.shouldPersistAssetUrl(url, isVideo)) return url;
      try {
        if (this.shouldNormalizeLocalUploadUrl(url, isVideo)) {
          const normalized = await this.normalizeLocalUploadAssetToUpload({
            url,
            kind,
            fallbackBaseName: `${nameSlug}-${suffix}`,
            fallbackContentType,
          });
          return normalized || url;
        }

        const next = await this.mirrorRemoteAssetToUpload({
          url,
          kind,
          fallbackBaseName: `${nameSlug}-${suffix}`,
          fallbackContentType,
        });
        return next || url;
      } catch (err) {
        console.warn("[persistEphemeralAssetMedia] mirror failed", suffix, err?.message || err);
        return url;
      }
    };

    if (p && m && p === m && this.shouldPersistAssetUrl(p, isVideo)) {
      const mirrored = await persistOne(p, "media");
      out.previewUrl = mirrored;
      out.mediaUrl = mirrored;
    } else {
      if (p) out.previewUrl = await persistOne(p, "preview");
      if (m) out.mediaUrl = await persistOne(m, "media");
    }

    if (!isVideo && refs.length) {
      out.referenceImageUrls = await Promise.all(
        refs.map((url, index) => persistOne(url, `reference_${index + 1}`))
      );
    }

    return out;
  }

  createAssetRecord(projectId, input) {
    return this.normalizeAssetRecord({
      id: `asset_${randomUUID().slice(0, 8)}`,
      projectId,
      assetType: input.assetType,
      name: input.name,
      description: input.description || "",
      previewUrl: input.previewUrl || null,
      mediaKind: input.mediaKind || null,
      mediaUrl: input.mediaUrl || null,
      sourceTaskId: input.sourceTaskId || null,
      generationPrompt: input.generationPrompt || "",
      referenceImageUrls: Array.isArray(input.referenceImageUrls) ? input.referenceImageUrls : [],
      imageStatus: input.imageStatus || null,
      imageModel: input.imageModel || null,
      aspectRatio: input.aspectRatio || null,
      negativePrompt: input.negativePrompt || "",
      scope: input.scope || "manual",
      createdAt: new Date().toISOString(),
      updatedAt: input.updatedAt,
    });
  }

  normalizeAssetRecord(asset) {
    if (!asset) return asset;

    const referenceImageUrls = Array.isArray(asset.referenceImageUrls)
      ? asset.referenceImageUrls.filter(Boolean)
      : [];

    return {
      ...asset,
      mediaKind: typeof asset.mediaKind === "string" ? asset.mediaKind : null,
      mediaUrl: typeof asset.mediaUrl === "string" ? asset.mediaUrl : null,
      sourceTaskId: typeof asset.sourceTaskId === "string" ? asset.sourceTaskId : null,
      generationPrompt:
        typeof asset.generationPrompt === "string" && asset.generationPrompt.trim()
          ? asset.generationPrompt.trim()
          : this.buildAssetGenerationPrompt(asset),
      referenceImageUrls,
      imageStatus: asset.imageStatus || (asset.previewUrl ? "ready" : "draft"),
      imageModel:
        asset.imageModel ||
        (referenceImageUrls.length
          ? "gemini-3-pro-image-preview"
          : "gemini-3-pro-image-preview"),
      aspectRatio: asset.aspectRatio || "1:1",
      negativePrompt: typeof asset.negativePrompt === "string" ? asset.negativePrompt : "",
      scope: asset.scope || "manual",
    };
  }

  upsertProjectAsset(state, projectId, input) {
    const items = state.assetsByProjectId[projectId];
    if (!items) return null;

    const normalizedType = String(input.assetType || "").trim().toLowerCase();
    const normalizedName = String(input.name || "").trim();
    const normalizedSourceTaskId = String(input.sourceTaskId || "").trim();
    const normalizedMediaUrl = String(input.mediaUrl || "").trim();
    if (!normalizedType || !normalizedName) return null;

    const matchesExistingAsset = (item) =>
      (normalizedSourceTaskId &&
        String(item.sourceTaskId || "").trim() === normalizedSourceTaskId) ||
      (!normalizedSourceTaskId &&
        normalizedMediaUrl &&
        String(item.assetType || "").trim().toLowerCase() === normalizedType &&
        String(item.mediaUrl || "").trim() === normalizedMediaUrl) ||
      (!normalizedSourceTaskId &&
        !normalizedMediaUrl &&
        String(item.assetType || "").trim().toLowerCase() === normalizedType &&
        String(item.name || "").trim() === normalizedName);

    const existingItems = items.filter(
      (item) => matchesExistingAsset(item)
    );

    const nextAsset =
      existingItems.length > 0
        ? this.normalizeAssetRecord({
            ...existingItems[0],
            description: input.description || existingItems[0].description || "",
            previewUrl: input.previewUrl ?? existingItems[0].previewUrl ?? null,
            mediaKind: input.mediaKind ?? existingItems[0].mediaKind ?? null,
            mediaUrl: input.mediaUrl ?? existingItems[0].mediaUrl ?? null,
            sourceTaskId: input.sourceTaskId ?? existingItems[0].sourceTaskId ?? null,
            generationPrompt:
              input.generationPrompt || existingItems[0].generationPrompt || "",
            referenceImageUrls:
              input.referenceImageUrls ?? existingItems[0].referenceImageUrls ?? [],
            imageStatus: input.imageStatus || existingItems[0].imageStatus || null,
            imageModel: input.imageModel || existingItems[0].imageModel || null,
            aspectRatio: input.aspectRatio || existingItems[0].aspectRatio || null,
            negativePrompt:
              input.negativePrompt ?? existingItems[0].negativePrompt ?? "",
            scope: input.scope || existingItems[0].scope || "manual",
            updatedAt: new Date().toISOString(),
          })
        : this.createAssetRecord(projectId, {
            assetType: normalizedType,
            name: normalizedName,
            description: input.description || "",
            previewUrl: input.previewUrl ?? null,
            mediaKind: input.mediaKind ?? null,
            mediaUrl: input.mediaUrl ?? null,
            sourceTaskId: input.sourceTaskId ?? null,
            generationPrompt: input.generationPrompt || "",
            referenceImageUrls: input.referenceImageUrls ?? [],
            imageStatus: input.imageStatus || null,
            imageModel: input.imageModel || null,
            aspectRatio: input.aspectRatio || null,
            negativePrompt: input.negativePrompt || "",
            scope: input.scope || "manual",
          });

    const removeIndices = [];
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (matchesExistingAsset(item)) {
        removeIndices.push(i);
      }
    }
    const insertAt = removeIndices.length ? Math.min(...removeIndices) : -1;
    for (let i = removeIndices.length - 1; i >= 0; i -= 1) {
      items.splice(removeIndices[i], 1);
    }
    if (insertAt === -1) {
      items.push(nextAsset);
    } else {
      items.splice(insertAt, 0, nextAsset);
    }

    return nextAsset;
  }

  syncGeneratedResultToProjectAsset(state, projectId, input) {
    if (String(input?.assetSyncMode || "").trim().toLowerCase() === "manual") {
      return null;
    }

    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId || !state.assetsByProjectId[normalizedProjectId]) {
      return null;
    }

    const asset = this.upsertProjectAsset(state, normalizedProjectId, {
      ...input,
      scope: input.scope || "generated",
    });

    if (asset) {
      this.touchProject(normalizedProjectId, {
        currentStep: "assets",
        progressPercent: 36,
      });
    }

    return asset;
  }

  isProviderAccessibleUrl(value) {
    if (!value || typeof value !== "string") return false;

    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return false;
      }

      const host = parsed.hostname.toLowerCase();
      if (
        host === "127.0.0.1" ||
        host === "localhost" ||
        host === "::1" ||
        host.startsWith("10.") ||
        host.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
      ) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  isDataUrl(value) {
    return typeof value === "string" && value.startsWith("data:");
  }

  toUploadPath(value) {
    if (!value || typeof value !== "string") return null;
    if (value.startsWith("/uploads/")) {
      return value;
    }

    try {
      const parsed = new URL(value);
      if (parsed.pathname.startsWith("/uploads/")) {
        return parsed.pathname;
      }
    } catch {}

    return null;
  }

  createDataUrlFromUpload(value) {
    const uploadPath = this.toUploadPath(value);
    if (!uploadPath) return null;

    const upload = readUploadByUrlPath(uploadPath);
    if (!upload) return null;

    const buffer = readFileSync(upload.absolutePath);
    return `data:${upload.contentType};base64,${buffer.toString("base64")}`;
  }

  resolveProviderImageSource(...candidates) {
    for (const value of candidates) {
      if (this.isDataUrl(value) || this.isProviderAccessibleUrl(value)) {
        return value;
      }

      const dataUrl = this.createDataUrlFromUpload(value);
      if (dataUrl) return dataUrl;
    }

    const error = new Error(
      "当前参考图不可用。请使用公网图片 URL，或先上传首帧/尾帧图片后再发起生成。"
    );
    error.statusCode = 400;
    error.code = "PROVIDER_IMAGE_NOT_ACCESSIBLE";
    throw error;
  }

  touchProject(projectId, patch = {}) {
    const project = this.state.projects.find((item) => item.id === projectId);
    if (!project) return null;

    const nextProgress =
      typeof patch.progressPercent === "number"
        ? Math.max(project.progressPercent || 0, patch.progressPercent)
        : project.progressPercent;

    Object.assign(project, patch, {
      progressPercent: nextProgress,
      updatedAt: new Date().toISOString()
    });

    return project;
  }

  listProjects(page = 1, pageSize = 20, actorId) {
    const actor = this.resolveActor(actorId);
    const visibleProjects = (this.state.projects || []).filter((project) => {
      if (actor.platformRole === "super_admin") return true;
      if (actor.platformRole !== "customer") return false;
      if (project.ownerType === "organization") {
        return Boolean(this.getMembership(actor.id, project.organizationId || project.ownerId));
      }
      return project.ownerId === actor.id || project.createdBy === actor.id;
    });
    const items = visibleProjects.slice((page - 1) * pageSize, page * pageSize);
    return {
      items: clone(items),
      page,
      pageSize,
      total: visibleProjects.length
    };
  }

  createProject(input, actorId) {
    const actor = this.resolveActor(actorId);
    if (actor.platformRole !== "customer" && actor.platformRole !== "super_admin") {
      throw apiError(
        403,
        "FORBIDDEN",
        "Only signed-in customer or super-admin accounts can create projects.",
      );
    }

    const timestamp = new Date().toISOString();
    const ownerType =
      input.ownerType === "organization" && input.organizationId ? "organization" : "personal";

    if (ownerType === "organization") {
      this.assertOrganizationAccess(input.organizationId, actor.id);
    }

    const project = {
      id: `proj_${randomUUID().slice(0, 8)}`,
      title: input.title,
      summary: input.summary || "New project waiting for settings and script input.",
      status: "draft",
      coverUrl: null,
      organizationId: ownerType === "organization" ? input.organizationId : null,
      ownerType,
      ownerId: ownerType === "organization" ? input.organizationId : actor.id,
      createdBy: actor.id,
      currentStep: "global",
      progressPercent: 0,
      budgetCredits: Number(input.budgetLimitCredits || 600),
      budgetLimitCredits: Number(input.budgetLimitCredits || 600),
      budgetUsedCredits: 0,
      billingWalletType: ownerType === "organization" ? "organization" : "personal",
      billingPolicy: ownerType === "organization" ? "organization_only" : "personal_only",
      directorAgentName: "Unassigned",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.state.projects.unshift(project);
    this.state.settingsByProjectId[project.id] = {
      projectId: project.id,
      tone: "",
      genre: "",
      targetDurationSeconds: 60,
      aspectRatio: "9:16",
      visualStyle: "",
      audience: "",
      modelProfile: "standard",
      language: "zh-CN",
      updatedAt: timestamp
    };
    this.state.scriptsByProjectId[project.id] = {
      id: `script_${randomUUID().slice(0, 8)}`,
      projectId: project.id,
      version: 1,
      title: `${project.title} Draft`,
      content: "",
      updatedAt: timestamp
    };
    this.state.assetsByProjectId[project.id] = [];
    this.state.storyboardsByProjectId[project.id] = [];
    this.state.videosByProjectId[project.id] = [];
    this.state.dubbingsByProjectId[project.id] = [];
    this.state.timelinesByProjectId[project.id] = {
      projectId: project.id,
      version: 1,
      totalDurationSeconds: 0,
      tracks: [],
      updatedAt: timestamp
    };

    return clone(project);
  }

  getProject(projectId, actorId) {
    const project = this.assertProjectAccess(projectId, actorId);

    return clone({
      ...project,
      settings: this.state.settingsByProjectId[projectId],
      script: this.state.scriptsByProjectId[projectId],
      assetCount: this.state.assetsByProjectId[projectId]?.length || 0,
      storyboardCount: this.state.storyboardsByProjectId[projectId]?.length || 0,
      videoCount: this.state.videosByProjectId[projectId]?.length || 0,
      dubbingCount: this.state.dubbingsByProjectId[projectId]?.length || 0
    });
  }

  ensureDefaultProjectForActor(actorId) {
    const actor = this.resolveActor(actorId);
    if (actor.platformRole !== "customer") {
      return null;
    }

    const visibleProjects = this.listProjects(1, 1_000, actor.id).items;
    if (visibleProjects.length) {
      return visibleProjects[0];
    }

    const memberships = this.listMembershipsForUser(actor.id);
    const organizationId =
      (actor.defaultOrganizationId && this.getMembership(actor.id, actor.defaultOrganizationId)
        ? actor.defaultOrganizationId
        : memberships[0]?.organizationId) || null;

    const timestamp = new Date().toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });

    if (organizationId) {
      return this.createProject(
        {
          title: `企业资产项目 ${timestamp}`,
          summary: "系统为当前组织自动初始化的共享资产项目。",
          ownerType: "organization",
          organizationId,
          budgetLimitCredits: 2400,
        },
        actor.id
      );
    }

    return this.createProject(
      {
        title: `个人资产项目 ${timestamp}`,
        summary: "系统为当前账号自动初始化的个人资产项目。",
        ownerType: "personal",
        budgetLimitCredits: 600,
      },
      actor.id
    );
  }

  updateProject(projectId, input, actorId) {
    const needsOrgAdmin =
      Object.prototype.hasOwnProperty.call(input, "budgetLimitCredits") ||
      Object.prototype.hasOwnProperty.call(input, "billingPolicy") ||
      Object.prototype.hasOwnProperty.call(input, "billingWalletType");
    const project = this.assertProjectAccess(projectId, actorId, {
      requireOrgAdmin: needsOrgAdmin,
    });

    Object.assign(project, {
      ...input,
      budgetCredits:
        input.budgetLimitCredits != null
          ? Number(input.budgetLimitCredits)
          : project.budgetCredits,
      updatedAt: new Date().toISOString()
    });

    return clone(project);
  }

  getProjectOverview(projectId, actorId) {
    const project = this.getProject(projectId, actorId);
    if (!project) return null;

    return clone({
      project,
      settings: this.getSettings(projectId),
      script: this.getScript(projectId),
      assets: this.listAssets(projectId),
      storyboards: this.listStoryboards(projectId),
      videos: this.listVideos(projectId),
      dubbings: this.listDubbings(projectId),
      timeline: this.getTimeline(projectId),
      tasks: this.listTasks(projectId, actorId)
    });
  }

  getSettings(projectId) {
    return clone(this.state.settingsByProjectId[projectId] || null);
  }

  updateSettings(projectId, input) {
    if (!this.state.settingsByProjectId[projectId]) return null;

    this.state.settingsByProjectId[projectId] = {
      ...this.state.settingsByProjectId[projectId],
      ...input,
      updatedAt: new Date().toISOString()
    };

    this.touchProject(projectId, {
      currentStep: "global",
      progressPercent: 12
    });

    return clone(this.state.settingsByProjectId[projectId]);
  }

  getScript(projectId) {
    return clone(this.state.scriptsByProjectId[projectId] || null);
  }

  updateScript(projectId, content) {
    const script = this.state.scriptsByProjectId[projectId];
    if (!script) return null;

    script.content = content;
    script.version += 1;
    script.updatedAt = new Date().toISOString();

    this.touchProject(projectId, {
      currentStep: "script",
      progressPercent: 24
    });

    return clone(script);
  }

  listAssets(projectId, assetType) {
    const items = this.state.assetsByProjectId[projectId] || [];
    return clone(assetType ? items.filter((item) => item.assetType === assetType) : items);
  }

  getAsset(projectId, assetId) {
    const items = this.state.assetsByProjectId[projectId] || [];
    const asset = items.find((item) => item.id === assetId);
    return clone(asset || null);
  }

  createAsset(projectId, input) {
    if (!this.state.assetsByProjectId[projectId]) return null;

    const asset = this.createAssetRecord(projectId, input);

    this.state.assetsByProjectId[projectId].unshift(asset);
    this.touchProject(projectId, {
      currentStep: "assets",
      progressPercent: 36
    });

    return clone(asset);
  }

  updateAsset(projectId, assetId, input) {
    const items = this.state.assetsByProjectId[projectId];
    if (!items) return null;

    const asset = items.find((item) => item.id === assetId);
    if (!asset) return null;

    Object.assign(asset, {
      ...input,
      updatedAt: new Date().toISOString()
    });

    const normalized = this.normalizeAssetRecord(asset);
    Object.assign(asset, normalized);

    return clone(asset);
  }

  deleteAsset(projectId, assetId) {
    const items = this.state.assetsByProjectId[projectId];
    if (!items) return false;

    const nextItems = items.filter((item) => item.id !== assetId);
    if (nextItems.length === items.length) return false;

    this.state.assetsByProjectId[projectId] = nextItems;
    return true;
  }

  listStoryboards(projectId) {
    return clone(this.state.storyboardsByProjectId[projectId] || []);
  }

  getStoryboard(projectId, storyboardId) {
    const items = this.state.storyboardsByProjectId[projectId] || [];
    const storyboard = items.find((item) => item.id === storyboardId);
    return clone(storyboard || null);
  }

  updateStoryboard(projectId, storyboardId, input) {
    const items = this.state.storyboardsByProjectId[projectId];
    if (!items) return null;

    const storyboard = items.find((item) => item.id === storyboardId);
    if (!storyboard) return null;

    Object.assign(storyboard, {
      ...input,
      updatedAt: new Date().toISOString()
    });

    return clone(storyboard);
  }

  deleteStoryboard(projectId, storyboardId) {
    const items = this.state.storyboardsByProjectId[projectId];
    if (!items) return false;

    const nextItems = items.filter((item) => item.id !== storyboardId);
    if (nextItems.length === items.length) return false;

    this.state.storyboardsByProjectId[projectId] = nextItems;
    return true;
  }

  listVideos(projectId) {
    return clone(this.state.videosByProjectId[projectId] || []);
  }

  getVideo(projectId, videoId) {
    const items = this.state.videosByProjectId[projectId] || [];
    const video = items.find((item) => item.id === videoId);
    return clone(video || null);
  }

  listDubbings(projectId) {
    return clone(this.state.dubbingsByProjectId[projectId] || []);
  }

  getDubbing(projectId, dubbingId) {
    const items = this.state.dubbingsByProjectId[projectId] || [];
    const dubbing = items.find((item) => item.id === dubbingId);
    return clone(dubbing || null);
  }

  updateDubbing(projectId, dubbingId, input) {
    const items = this.state.dubbingsByProjectId[projectId];
    if (!items) return null;

    const dubbing = items.find((item) => item.id === dubbingId);
    if (!dubbing) return null;

    Object.assign(dubbing, {
      ...input,
      updatedAt: new Date().toISOString()
    });

    return clone(dubbing);
  }

  getTimeline(projectId) {
    const timeline = this.state.timelinesByProjectId[projectId] || null;
    const hasReadyVideos = Array.isArray(this.state.videosByProjectId?.[projectId])
      ? this.state.videosByProjectId[projectId].some(
          (video) => video?.status === "ready" && video?.videoUrl
        )
      : false;

    if (hasReadyVideos && !hasPlayableVideoTimelineClips(timeline)) {
      const nextTimeline = this.buildDefaultTimeline(projectId, timeline);
      this.state.timelinesByProjectId[projectId] = nextTimeline;
      return clone(nextTimeline);
    }

    return clone(timeline);
  }

  updateTimeline(projectId, input) {
    if (!this.state.timelinesByProjectId[projectId]) return null;

    const nextTimeline = this.normalizeTimelinePayload(projectId, input, {
      incrementVersion: true,
    });
    this.state.timelinesByProjectId[projectId] = nextTimeline;
    this.touchProject(projectId, {
      currentStep: "preview",
      progressPercent: 100,
    });
    return clone(nextTimeline);
  }

  getWallet(actorId) {
    return this.toPublicWallet(this.getPrimaryWalletForActor(actorId));
  }

  createWalletRechargeOrder(input) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
    const order = {
      id: `recharge_${randomUUID().slice(0, 8)}`,
      planId: String(input.planId || "custom"),
      planName: String(input.planName || "Wallet Recharge"),
      billingCycle: String(input.billingCycle || "oneTime"),
      paymentMethod: String(input.paymentMethod || "wechat_pay"),
      amount: Number(input.amount || 0),
      credits: Number(input.credits || 0),
      currency: "CNY",
      status: "pending",
      qrCodePayload: `weixin://wxpay/bizpayurl/mock-${randomUUID().slice(0, 12)}`,
      qrCodeHint: "使用微信扫一扫完成支付",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    if (!Array.isArray(this.state.walletRechargeOrders)) {
      this.state.walletRechargeOrders = [];
    }

    this.state.walletRechargeOrders.unshift(order);
    return clone(order);
  }

  getWalletRechargeOrder(orderId) {
    const order = (this.state.walletRechargeOrders || []).find((item) => item.id === orderId);
    return clone(order || null);
  }

  confirmWalletRechargeOrder(orderId) {
    const order = (this.state.walletRechargeOrders || []).find((item) => item.id === orderId);
    if (!order) return null;

    if (order.status !== "paid") {
      order.status = "paid";
      order.updatedAt = new Date().toISOString();
      this.state.wallet.creditsAvailable += Number(order.credits || 0);
      this.state.wallet.updatedAt = order.updatedAt;

      this.emit("wallet_recharge_paid", {
        orderId: order.id,
        amount: order.amount,
        credits: order.credits,
        paymentMethod: order.paymentMethod,
      });
    }

    return clone(order);
  }

  listEnterpriseApplications() {
    return clone(this.state.enterpriseApplications);
  }

  createEnterpriseApplication(input) {
    const application = {
      id: `ent_app_${randomUUID().slice(0, 8)}`,
      companyName: input.companyName,
      contactName: input.contactName,
      contactPhone: input.contactPhone,
      status: "submitted",
      createdAt: new Date().toISOString()
    };

    this.state.enterpriseApplications.unshift(application);
    return clone(application);
  }

  listTasks(projectId) {
    const items = projectId
      ? this.state.tasks.filter((task) => task.projectId === projectId)
      : this.state.tasks;
    return clone(items);
  }

  getTask(taskId) {
    const task = this.state.tasks.find((item) => item.id === taskId);
    return clone(task || null);
  }

  deleteTask(taskId) {
    const index = (this.state.tasks || []).findIndex((item) => item.id === taskId);
    if (index === -1) return null;
    const [removed] = this.state.tasks.splice(index, 1);
    return clone(removed);
  }

  clearTasks(projectId, type) {
    const tasks = this.state.tasks || [];
    const removed = [];
    this.state.tasks = tasks.filter((task) => {
      const matchProject = projectId ? task.projectId === projectId : true;
      const matchType = type ? task.type === type : true;
      const shouldRemove = matchProject && matchType;
      if (shouldRemove) removed.push(task);
      return !shouldRemove;
    });
    return { removedCount: removed.length };
  }

  getToolboxCapabilities() {
    return clone(this.state.toolboxCapabilities);
  }

  listCreateImages(actorId) {
    const actor = this.resolveActor(actorId);
    return clone(
      (this.state.createStudioImages || []).filter((item) =>
        actor.platformRole === "super_admin"
          ? true
          : this.getCreateStudioResultActorId(item) === actor.id
      )
    );
  }

  listCreateVideos(actorId) {
    const actor = this.resolveActor(actorId);
    return clone(
      (this.state.createStudioVideos || []).filter((item) =>
        actor.platformRole === "super_admin"
          ? true
          : this.getCreateStudioResultActorId(item) === actor.id
      )
    );
  }

  getCreateImageCapabilities(mode) {
    const normalizedMode = String(mode || "").trim().toLowerCase();
    const defaultModel =
      normalizedMode === "image_to_image" || normalizedMode === "multi_image"
        ? "doubao-seedream-5-0-260128"
        : "gemini-3-pro-image-preview";
    return {
      kind: "image",
      mode: normalizedMode || "text_to_image",
      defaultModel,
      items: listCreateImageCapabilities(normalizedMode),
    };
  }

  getCreateVideoCapabilities(mode) {
    const normalizedMode = normalizeVideoMode(mode);
    if (normalizedMode === "image_to_video" || normalizedMode === "text_to_video") {
      return {
        kind: "video",
        mode: normalizedMode,
        defaultModel: "doubao-seedance-2-0-260128",
        items: listCreateVideoImageToVideoCapabilities(),
      };
    }
    if (normalizedMode === "start_end_frame") {
      return {
        kind: "video",
        mode: "start_end_frame",
        defaultModel: "doubao-seedance-2-0-260128",
        items: listCreateVideoStartEndCapabilities(),
      };
    }
    if (normalizedMode === "multi_param") {
      return {
        kind: "video",
        mode: "multi_param",
        defaultModel: "doubao-seedance-2-0-260128",
        items: listCreateVideoMultiParamCapabilities(),
      };
    }

    return {
      kind: "video",
      mode: normalizedMode || "image_to_video",
      defaultModel: null,
      items: [],
    };
  }

  deleteCreateImage(id, actorId) {
    const actor = this.resolveActor(actorId);
    const index = (this.state.createStudioImages || []).findIndex((item) => item.id === id);
    if (index === -1) return null;
    const target = this.state.createStudioImages[index];
    if (
      actor.platformRole !== "super_admin" &&
      this.getCreateStudioResultActorId(target) !== actor.id
    ) {
      throw apiError(403, "FORBIDDEN", "You do not have access to this image.");
    }
    const [removed] = this.state.createStudioImages.splice(index, 1);
    return clone(removed);
  }

  deleteCreateVideo(id, actorId) {
    const actor = this.resolveActor(actorId);
    const index = (this.state.createStudioVideos || []).findIndex((item) => item.id === id);
    if (index === -1) return null;
    const target = this.state.createStudioVideos[index];
    if (
      actor.platformRole !== "super_admin" &&
      this.getCreateStudioResultActorId(target) !== actor.id
    ) {
      throw apiError(403, "FORBIDDEN", "You do not have access to this video.");
    }
    const [removed] = this.state.createStudioVideos.splice(index, 1);
    return clone(removed);
  }

  createTask(params) {
    const task = {
      id: `task_${randomUUID().slice(0, 8)}`,
      type: params.type,
      domain: params.domain,
      projectId: params.projectId || null,
      storyboardId: params.storyboardId || null,
      status: "queued",
      progressPercent: 0,
      currentStage: "queued",
      etaSeconds: 90,
      inputSummary: params.inputSummary || null,
      outputSummary: null,
      metadata: params.metadata || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.state.tasks.unshift(task);
    this.emit("task.created", task);
    this.scheduleTaskLifecycle(task.id, params.effect);
    return clone(task);
  }

  updateTask(taskId, patch) {
    const task = this.state.tasks.find((item) => item.id === taskId);
    if (!task) return null;

    Object.assign(task, patch, { updatedAt: new Date().toISOString() });
    const eventName = task.status === "succeeded" ? "task.completed" : "task.updated";
    this.emit(eventName, task);
    return clone(task);
  }

  emit(eventName, payload) {
    this.events.emit("event", {
      id: randomUUID(),
      type: eventName,
      occurredAt: new Date().toISOString(),
      payload: clone(payload)
    });
  }

  scheduleTaskLifecycle(taskId, effect) {
    setTimeout(() => {
      this.updateTask(taskId, {
        status: "running",
        progressPercent: 35,
        currentStage: "processing",
        etaSeconds: 45
      });
    }, 350);

    setTimeout(() => {
      this.updateTask(taskId, {
        status: "running",
        progressPercent: 72,
        currentStage: "rendering",
        etaSeconds: 18
      });
    }, 900);

    setTimeout(async () => {
      try {
        let outputSummary = "mock result ready";

        if (typeof effect === "function") {
          const result = await effect(this.state);
          if (typeof result === "string" && result.trim()) {
            outputSummary = result.trim();
          }
        }

        this.updateTask(taskId, {
          status: "succeeded",
          progressPercent: 100,
          currentStage: "completed",
          etaSeconds: 0,
          outputSummary
        });
      } catch (error) {
        this.updateTask(taskId, {
          status: "failed",
          progressPercent: 100,
          currentStage: "failed",
          etaSeconds: 0,
          outputSummary: error?.message || "provider call failed"
        });
      }
    }, 1600);
  }

  makeScriptRewriteTask(projectId, input) {
    return this.createTask({
      type: "script_rewrite",
      domain: "scripts",
      projectId,
      inputSummary: input.instruction,
      metadata: input,
      effect: async (state) => {
        const script = state.scriptsByProjectId[projectId];
        if (!script) return;

        if (hasMediaGenerationApiKey()) {
          script.content = await rewriteScriptWithAliyun({
            content: script.content,
            instruction: input.instruction,
            model: this.getNodePrimaryModel("script", this.getDefaultModelId("textModelId", "qwen-plus")),
          });
        } else {
          script.content = `${script.content}\n\n[AI rewrite] ${input.instruction}`;
        }
        script.version += 1;
        script.updatedAt = new Date().toISOString();

        this.touchProject(projectId, {
          currentStep: "script",
          progressPercent: 28
        });

        return hasAliyunApiKey() ? "aliyun script rewrite completed" : "mock script rewrite completed";
      }
    });
  }

  makeAssetExtractTask(projectId, input) {
    const sourceText = String(
      input?.sourceText || this.state.scriptsByProjectId[projectId]?.content || ""
    );

    return this.createTask({
      type: "asset_extract",
      domain: "assets",
      projectId,
      inputSummary: sourceText || "Extract assets from script",
      metadata: {
        ...input,
        sourceText,
      },
      effect: async (state) => {
        if (!state.assetsByProjectId[projectId]) return;
        if (!sourceText.trim()) {
          const error = new Error("Script content is empty.");
          error.statusCode = 400;
          error.code = "BAD_REQUEST";
          throw error;
        }

        const script = state.scriptsByProjectId[projectId];
        if (script && script.content !== sourceText) {
          script.content = sourceText;
          script.version += 1;
          script.updatedAt = new Date().toISOString();
        }

        if (hasAliyunApiKey()) {
          state.assetsByProjectId[projectId] = state.assetsByProjectId[projectId].filter(
            (asset) => asset.scope !== "extracted"
          );

          const extractedAssets = await extractAssetsWithAliyun({
            content: sourceText,
            model: this.getNodePrimaryModel("assets", this.getDefaultModelId("textModelId", "qwen-plus")),
          });

          for (const asset of extractedAssets.slice(0, 12)) {
            if (!asset?.assetType || !asset?.name) continue;
            this.upsertProjectAsset(state, projectId, {
              assetType: asset.assetType,
              name: asset.name,
              description: asset.description || "",
              generationPrompt: asset.generationPrompt || "",
              referenceImageUrls: [],
              imageStatus: "draft",
              imageModel: asset.imageModel || null,
              aspectRatio: asset.aspectRatio || "1:1",
              negativePrompt: asset.negativePrompt || "",
              previewUrl: null,
              scope: "extracted",
            });
          }
        } else {
          const error = new Error("Real asset extraction requires DASHSCOPE_API_KEY.");
          error.statusCode = 503;
          error.code = "PROVIDER_NOT_CONFIGURED";
          throw error;
        }

        this.touchProject(projectId, {
          currentStep: "assets",
          progressPercent: 40
        });

        return "aliyun asset extraction completed";
      }
    });
  }

  makeAssetImageGenerateTask(projectId, assetId, input = {}) {
    const asset = this.state.assetsByProjectId[projectId]?.find((item) => item.id === assetId);
    if (asset) {
      Object.assign(asset, {
        generationPrompt: input.generationPrompt || asset.generationPrompt || "",
        referenceImageUrls:
          input.referenceImageUrls ?? asset.referenceImageUrls ?? [],
        aspectRatio: input.aspectRatio || asset.aspectRatio || "1:1",
        imageModel: input.imageModel || asset.imageModel || null,
        negativePrompt: input.negativePrompt ?? asset.negativePrompt ?? "",
        imageStatus: "queued",
        updatedAt: new Date().toISOString(),
      });
      Object.assign(asset, this.normalizeAssetRecord(asset));
    }

    return this.createTask({
      type: "asset_image_generate",
      domain: "assets",
      projectId,
      inputSummary: input.generationPrompt || asset?.generationPrompt || asset?.name || "Generate asset image",
      metadata: {
        assetId,
        ...input,
      },
      effect: async (state) => {
        const match = state.assetsByProjectId[projectId]?.find((item) => item.id === assetId);
        if (!match) return;

        Object.assign(match, this.normalizeAssetRecord(match));

        const generationPrompt =
          String(input.generationPrompt || match.generationPrompt || "").trim() ||
          this.buildAssetGenerationPrompt(match);
        const referenceImageUrls = sanitizeReferenceImageUrls(
          input.referenceImageUrls || match.referenceImageUrls || [],
        );
        const aspectRatio = input.aspectRatio || match.aspectRatio || "1:1";
        const negativePrompt =
          typeof input.negativePrompt === "string"
            ? input.negativePrompt
            : match.negativePrompt || "";
        const imageModel =
          input.imageModel ||
          match.imageModel ||
          (referenceImageUrls.length
            ? "gemini-3-pro-image-preview"
            : "gemini-3-pro-image-preview");

        match.imageStatus = "queued";
        match.updatedAt = new Date().toISOString();

        try {
          let previewUrl = `https://mock.assets.local/assets/${assetId}_${Date.now()}.jpg`;

          if (hasAliyunApiKey()) {
            const resolvedReferenceImageUrls = referenceImageUrls
              .map((url) => this.resolveProviderImageSource(url))
              .filter(Boolean);
            const primaryResolved = resolvedReferenceImageUrls[0] || null;
            let imageUrl = null;

            try {
              [imageUrl] = await generateImagesWithAliyun({
                prompt: generationPrompt,
                model: imageModel,
                aspectRatio,
                count: 1,
                negativePrompt,
                referenceImageUrl: primaryResolved,
                referenceImageUrls: resolvedReferenceImageUrls,
              });
            } catch {
              [imageUrl] = await generateImagesWithAliyun({
                prompt: generationPrompt,
                model: imageModel,
                aspectRatio,
                count: 1,
                negativePrompt,
                referenceImageUrl: null,
                referenceImageUrls: [],
              });
            }

            previewUrl =
              (await this.mirrorRemoteAssetToUpload({
                url: imageUrl,
                kind: "asset-image",
                fallbackBaseName: assetId,
                fallbackContentType: "image/png",
              })) || imageUrl;
          }

          Object.assign(match, {
            generationPrompt,
            referenceImageUrls,
            aspectRatio,
            negativePrompt,
            imageModel,
            previewUrl,
            imageStatus: "ready",
            updatedAt: new Date().toISOString(),
          });

          this.touchProject(projectId, {
            currentStep: "assets",
            progressPercent: 48,
          });

          return hasAliyunApiKey()
            ? "aliyun asset image completed"
            : "mock asset image completed";
        } catch (error) {
          match.imageStatus = "failed";
          match.updatedAt = new Date().toISOString();
          throw error;
        }
      },
    });
  }

  makeStoryboardGenerateTask(projectId, input) {
    const sourceText = String(
      input?.sourceText || this.state.scriptsByProjectId[projectId]?.content || ""
    );

    return this.createTask({
      type: "storyboard_auto_generate",
      domain: "storyboards",
      projectId,
      inputSummary: sourceText ? summarizeStoryboardText(sourceText, 48) : "Auto split script into storyboards",
      metadata: {
        ...input,
        sourceText,
      },
      effect: async (state) => {
        if (!state.storyboardsByProjectId[projectId]) return;
        if (!sourceText.trim()) {
          const error = new Error("Script content is empty.");
          error.statusCode = 400;
          error.code = "BAD_REQUEST";
          throw error;
        }

        const script = state.scriptsByProjectId[projectId];
        if (script && script.content !== sourceText) {
          script.content = sourceText;
          script.version += 1;
          script.updatedAt = new Date().toISOString();
        }

        let storyboardShots = [];
        let outputSource = "heuristic";

        if (hasAliyunApiKey()) {
          try {
            storyboardShots = await withTimeout(
              splitStoryboardsWithAliyun({
                content: sourceText,
                model: this.getNodePrimaryModel(
                  "storyboard_script",
                  this.getDefaultModelId("textModelId", "qwen-plus")
                ),
              }),
              20000,
              "Storyboard split provider timeout."
            );
            outputSource = "aliyun";
          } catch (error) {
            storyboardShots = [];
          }
        }

        if (!storyboardShots.length) {
          storyboardShots = this.buildStoryboardShotsFallback(sourceText);
        }

        if (!storyboardShots.length) {
          const error = new Error("Failed to split script into storyboard shots.");
          error.statusCode = 422;
          error.code = "STORYBOARD_SPLIT_FAILED";
          throw error;
        }

        const nextStoryboards = storyboardShots
          .slice(0, 12)
          .map((shot, index) => this.createStoryboardRecord(projectId, shot, index + 1));

        state.storyboardsByProjectId[projectId] = nextStoryboards;
        state.videosByProjectId[projectId] = [];
        state.dubbingsByProjectId[projectId] = [];
        state.timelinesByProjectId[projectId] = this.buildDefaultTimeline(projectId, null);

        this.touchProject(projectId, {
          currentStep: "storyboards",
          progressPercent: 52
        });

        return `${outputSource} storyboard split completed (${nextStoryboards.length} shots)`;
      }
    });
  }

  makeImageGenerateTask(storyboardId, input) {
    const storyboard = this.findStoryboard(storyboardId);
    if (storyboard) {
      storyboard.imageStatus = "queued";
      storyboard.updatedAt = new Date().toISOString();
    }

    return this.createTask({
      type: "storyboard_image_generate",
      domain: "storyboards",
      projectId: storyboard?.projectId || null,
      storyboardId,
      inputSummary: input?.prompt || "Generate storyboard image",
      metadata: input,
      effect: async (state) => {
        const match = this.findStoryboardInState(state, storyboardId);
        if (!match) return;

        match.imageStatus = "ready";
        if (hasAliyunApiKey()) {
          const [imageUrl] = await generateImagesWithAliyun({
            prompt: input?.prompt || match.script || match.promptSummary,
            model: normalizeModelId(
              match.modelName ||
                this.getNodePrimaryModel(
                  "storyboard_image",
                  this.getDefaultModelId("imageModelId", "gemini-3-pro-image-preview")
                )
            ),
            aspectRatio: match.aspectRatio || "16:9",
            count: 1,
          });
          match.imageUrl = imageUrl;
        } else {
          match.imageUrl = `https://mock.assets.local/storyboards/${storyboardId}_${Date.now()}.jpg`;
        }
        match.updatedAt = new Date().toISOString();

        this.touchProject(match.projectId, {
          currentStep: "storyboards",
          progressPercent: 60
        });

        return hasAliyunApiKey() ? "aliyun storyboard image completed" : "mock storyboard image completed";
      }
    });
  }

  makeVideoGenerateTask(storyboardId, input) {
    const storyboard = this.findStoryboard(storyboardId);
    if (storyboard) {
      const isStartEndMode = (storyboard.videoMode || input?.mode) === "start_end_frame";
      const videoModel =
        storyboard.videoModel ||
        this.getNodePrimaryModel(
          isStartEndMode ? "video_kf2v" : "video_i2v",
          this.getDefaultModelId("videoModelId", "veo3.1-pro")
        );
      storyboard.videoStatus = "queued";
      storyboard.videoResolution = normalizeStoredVideoResolution(
        videoModel,
        storyboard.videoResolution || input?.resolution || "720p"
      );
      storyboard.updatedAt = new Date().toISOString();
    }

    let taskId = null;
    const task = this.createTask({
      type: "video_generate",
      domain: "videos",
      projectId: storyboard?.projectId || null,
      storyboardId,
      inputSummary: input?.motionPreset || "Generate shot video",
      metadata: input,
      effect: async (state) => {
        if (!storyboard) return;

        const match = this.findStoryboardInState(state, storyboardId);
        if (!match) return;

        let videoUrl = `https://mock.assets.local/videos/${storyboardId}_${Date.now()}.mp4`;
        let thumbnailUrl = `https://mock.assets.local/videos/${storyboardId}_${Date.now()}.jpg`;
        let durationSeconds = storyboard.durationSeconds;

        try {
          const isStartEndMode = (match.videoMode || input?.mode) === "start_end_frame";
          const videoModel = normalizeModelId(
            match.videoModel ||
              this.getNodePrimaryModel(
                isStartEndMode ? "video_kf2v" : "video_i2v",
                this.getDefaultModelId("videoModelId", "veo3.1-pro")
              )
          );
          const normalizedResolution = normalizeStoredVideoResolution(
            videoModel,
            match.videoResolution || input?.resolution || "720p"
          );
          const resolvedPrompt = this.buildStoryboardVideoPrompt(state, match, input);

          if (taskId) {
            this.updateTask(taskId, {
              metadata: {
                ...(input || {}),
                resolvedPrompt,
              },
            });
          }

          match.videoStatus = "running";
          match.videoResolution = normalizedResolution;
          match.updatedAt = new Date().toISOString();

          if (hasAliyunApiKey()) {
            const referenceImageUrl = !isStartEndMode
              ? this.resolveProviderImageSource(match.referenceImageUrls?.[0], match.imageUrl)
              : null;
            const firstFrameUrl = isStartEndMode
              ? this.resolveProviderImageSource(match.startFrameUrl, match.imageUrl)
              : null;
            const lastFrameUrl = isStartEndMode && match.endFrameUrl
              ? this.resolveProviderImageSource(match.endFrameUrl)
              : null;
            const taskId = await createAliyunVideoTask({
              model: videoModel,
              prompt: resolvedPrompt,
              referenceImageUrl,
              firstFrameUrl,
              lastFrameUrl,
              resolution: normalizedResolution,
              duration: match.videoDuration || `${storyboard.durationSeconds}s`,
            });
            const result = await waitForAliyunTask(taskId);
            const parsedResult = getMediaGenerationProvider("video", videoModel) === "pixverse"
              ? parsePixverseVideoResult(result)
              : parseAliyunVideoResult(result);
            videoUrl = parsedResult.videoUrl || videoUrl;
            if (parsedResult.videoUrl) {
              videoUrl =
                (await this.mirrorRemoteAssetToUpload({
                  url: parsedResult.videoUrl,
                  kind: "generated-video",
                  fallbackBaseName: storyboardId,
                  fallbackContentType: "video/mp4",
                })) || videoUrl;
            }
            thumbnailUrl =
              parsedResult.thumbnailUrl ||
              (isStartEndMode
                ? match.startFrameUrl || match.endFrameUrl
                : match.referenceImageUrls?.[0] || match.imageUrl) ||
              thumbnailUrl;
            durationSeconds = parsedResult.durationSeconds || durationSeconds;
          }

          state.videosByProjectId[storyboard.projectId].unshift({
            id: `video_${randomUUID().slice(0, 8)}`,
            projectId: storyboard.projectId,
            storyboardId,
            version: 1,
            status: "ready",
            durationSeconds,
            videoUrl,
            thumbnailUrl,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          });

          match.videoStatus = "ready";
          match.updatedAt = new Date().toISOString();

          this.touchProject(storyboard.projectId, {
            currentStep: "videos",
            progressPercent: 72
          });

          return hasAliyunApiKey() ? "aliyun storyboard video completed" : "mock storyboard video completed";
        } catch (error) {
          match.videoStatus = "failed";
          match.updatedAt = new Date().toISOString();
          throw error;
        }
      }
    });
    taskId = task.id;
    return task;
  }

  makeDubbingGenerateTask(storyboardId, input) {
    const storyboard = this.findStoryboard(storyboardId);
    return this.createTask({
      type: "dubbing_generate",
      domain: "dubbings",
      projectId: storyboard?.projectId || null,
      storyboardId,
      inputSummary: input?.text || "Generate dubbing",
      metadata: input,
      effect: async (state) => {
        if (!storyboard) return;

        let audioUrl = `https://mock.assets.local/audio/${storyboardId}_${Date.now()}.mp3`;
        const normalizedVoicePreset = normalizeVoicePreset(input?.voicePreset || "longanyang");

        if (hasAliyunApiKey()) {
          const model = this.getNodePrimaryModel(
            "dubbing_tts",
            this.getDefaultModelId("audioModelId", "kling-audio")
          );
          const audio = await synthesizeSpeechWithAliyun({
            text: input?.text || "New dubbing generated for demo purposes.",
            model,
            voice: normalizedVoicePreset,
            format: "mp3",
          });
          const upload = await createUploadFromBuffer({
            buffer: audio.buffer,
            kind: "tts",
            originalName: `${storyboardId}.mp3`,
            contentType: "audio/mpeg",
          });
          audioUrl = `${this.getPublicBaseUrl()}${upload.urlPath}`;
        }

        state.dubbingsByProjectId[storyboard.projectId].unshift({
          id: `dub_${randomUUID().slice(0, 8)}`,
          projectId: storyboard.projectId,
          storyboardId,
          speakerName: input?.speakerName || "Narrator",
          voicePreset: normalizedVoicePreset,
          text: input?.text || "New dubbing generated for demo purposes.",
          status: "ready",
          audioUrl,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });

        this.touchProject(storyboard.projectId, {
          currentStep: "dubbing",
          progressPercent: 82
        });

        return hasAliyunApiKey() ? "aliyun dubbing completed" : "mock dubbing completed";
      }
    });
  }

  makeLipSyncTask(storyboardId) {
    const storyboard = this.findStoryboard(storyboardId);
    return this.createTask({
      type: "lipsync_generate",
      domain: "lipsync",
      projectId: storyboard?.projectId || null,
      storyboardId,
      inputSummary: "Generate lip sync",
      effect: () => {
        if (!storyboard) return;

        this.touchProject(storyboard.projectId, {
          currentStep: "dubbing",
          progressPercent: 88
        });
      }
    });
  }

  makeExportTask(projectId, input) {
    return this.createTask({
      type: "project_export",
      domain: "exports",
      projectId,
      inputSummary: input?.format || "Export final cut",
      metadata: input,
      effect: (state) => {
        const timeline = state.timelinesByProjectId[projectId];
        if (!timeline) return;

        timeline.version += 1;
        timeline.updatedAt = new Date().toISOString();

        this.touchProject(projectId, {
          currentStep: "preview",
          progressPercent: 100,
          status: "published"
        });
      }
    });
  }

  makeToolboxTask(type, input) {
    return this.createTask({
      type,
      domain: "toolbox",
      projectId: input?.projectId || null,
      storyboardId: input?.storyboardId || null,
      inputSummary: input?.note || input?.target || type,
      metadata: input,
      effect: () => {
        if (!input?.projectId) return;

        this.touchProject(input.projectId, {
          progressPercent: 92
        });
      }
    });
  }

  makeCreateImageTask(input) {
    const resultActorId = this.resolveActorId(input?.actorId);
    let taskId = null;
    const task = this.createTask({
      type: "create_image_generate",
      domain: "create",
      inputSummary: input?.prompt || "Generate standalone image",
      metadata: input,
      effect: async (state) => {
        const count = Math.max(1, Math.min(Number(input?.count) || 1, 4));
        const referenceImageUrls = sanitizeReferenceImageUrls(
          input?.referenceImageUrls || (input?.referenceImageUrl ? [input.referenceImageUrl] : []),
        );
        const primaryReference = referenceImageUrls[0] || null;
        const defaultImageModel = this.getDefaultModelId("imageModelId", "gemini-3-pro-image-preview");
        const resolvedPrompt =
          String(input?.prompt || "Generated image prompt").trim() || "Generated image prompt";
        const timestamp = new Date().toISOString();
        let imageUrls = null;
        let resolvedModel = resolveCreateImageModel(
          input?.model,
          referenceImageUrls.length,
          defaultImageModel,
        );
        if (assertMediaGenerationModelConfigured("image", resolvedModel)) {
          const resolvedReferenceImageUrls = [];
          for (const url of referenceImageUrls) {
            const rawUrl = String(url || "").trim();
            if (!rawUrl) continue;
            let candidate = rawUrl;
            try {
              const parsed = new URL(rawUrl);
              const expires = Number(parsed.searchParams.get("Expires") || parsed.searchParams.get("expires"));
              const isLikelyExpiringRemoteRef =
                Number.isFinite(expires) ||
                parsed.searchParams.has("Signature") ||
                parsed.searchParams.has("OSSAccessKeyId") ||
                /dashscope|aliyuncs/i.test(parsed.hostname || "");
              if (isLikelyExpiringRemoteRef) {
                try {
                  const mirrored = await this.mirrorRemoteAssetToUpload({
                    url: rawUrl,
                    kind: "create-image-reference",
                    fallbackBaseName: `create_ref_${Date.now()}`,
                    fallbackContentType: "image/png",
                  });
                  if (mirrored) {
                    candidate = mirrored;
                  }
                } catch (mirrorError) {
                  const err = new Error(`参考图链接已失效或不可访问，请重新上传参考图后再试。原始原因：${mirrorError?.message || "unknown"}`);
                  err.statusCode = 400;
                  err.code = "REFERENCE_IMAGE_EXPIRED";
                  throw err;
                }
              }
            } catch (error) {
              if (error?.code === "REFERENCE_IMAGE_EXPIRED") {
                throw error;
              }
              // keep rawUrl
            }

            const providerUrl = this.resolveProviderImageSource(candidate);
            if (providerUrl) {
              resolvedReferenceImageUrls.push(providerUrl);
            }
          }
          const primaryResolved = resolvedReferenceImageUrls[0] || null;
          const multiRefResolvedCount = resolvedReferenceImageUrls.length;

          resolvedModel = resolveCreateImageModel(
            input?.model,
            multiRefResolvedCount,
            defaultImageModel,
          );
          assertMediaGenerationModelConfigured("image", resolvedModel);

          const providerPrompt = buildMultiReferenceImagePrompt(
            resolvedPrompt,
            multiRefResolvedCount,
          );

          const isReferenceDriven = multiRefResolvedCount >= 1;
          const providerReferenceImageUrl = isReferenceDriven ? primaryResolved : null;
          const providerReferenceImageUrls = isReferenceDriven ? resolvedReferenceImageUrls : [];
          const userAskedMultiRef = referenceImageUrls.length >= 2;
          const multiRefNegativeExtra =
            "禁止只绘制或只保留第一张参考图中的人物，禁止忽略其他参考图中需要出现的人物；禁止不做场景融合就原样输出任意一张输入参考图。";
          const negativeForMultiRef = [String(input?.negativePrompt || "").trim(), multiRefNegativeExtra]
            .filter(Boolean)
            .join("\n");

          const runPrimary = () =>
            generateImagesWithAliyun({
              prompt: providerPrompt,
              model: normalizeModelId(resolvedModel),
              aspectRatio: input?.aspectRatio || "16:9",
              resolution: input?.resolution || "2K",
              count,
              negativePrompt:
                multiRefResolvedCount >= 2 ? negativeForMultiRef : input?.negativePrompt || "",
              referenceImageUrl: providerReferenceImageUrl,
              referenceImageUrls: providerReferenceImageUrls,
            });

          const shouldRetryPureTextWithGemini = (error) => {
            if (resolvedReferenceImageUrls.length > 0) {
              return false;
            }

            if (normalizeModelId(resolvedModel) !== "doubao-seedream-5-0-260128") {
              return false;
            }

            const message = String(error?.message || "");
            return (
              error?.code === "ARK_API_ERROR" &&
              /may violate platform rules|input text may violate|内容安全|审核|违规|safety/i.test(message)
            );
          };

          try {
            imageUrls = await runPrimary();
          } catch (primaryError) {
            console.error("[makeCreateImageTask] primary generation failed:", primaryError?.message || primaryError);

            if (userAskedMultiRef && multiRefResolvedCount >= 2) {
              const deterministicInputError =
                primaryError?.statusCode === 400 ||
                primaryError?.code === "BAD_REQUEST" ||
                /Only \d+ valid references remain|PNG with transparency|链接已失效|REFERENCE_IMAGE_EXPIRED/i.test(
                  String(primaryError?.message || "")
                );
              if (deterministicInputError) {
                throw primaryError;
              }
              try {
                console.log("[makeCreateImageTask] retry multi-reference generation once");
                imageUrls = await runPrimary();
              } catch (retryErr) {
                console.error("[makeCreateImageTask] multi-ref retry failed:", retryErr?.message || retryErr);
                // 用户明确要求「多图失败时任务直接 failed，不要兜底为文生图」
                throw retryErr;
              }
            } else if (multiRefResolvedCount === 1 && primaryResolved) {
              try {
                console.log("[makeCreateImageTask] fallback → single-reference gemini-3.1-flash-image-preview");
                imageUrls = await generateImagesWithAliyun({
                  prompt: resolvedPrompt,
                  model: "gemini-3.1-flash-image-preview",
                  aspectRatio: input?.aspectRatio || "16:9",
                  count,
                  negativePrompt: input?.negativePrompt || "",
                  referenceImageUrl: primaryResolved,
                  referenceImageUrls: [],
                });
                resolvedModel = "gemini-3.1-flash-image-preview";
              } catch (singleRefError) {
                console.error("[makeCreateImageTask] single-ref fallback failed:", singleRefError?.message || singleRefError);
                console.log("[makeCreateImageTask] fallback → pure text-to-image gemini-3.1-flash-image-preview");
                imageUrls = await generateImagesWithAliyun({
                  prompt: resolvedPrompt,
                  model: "gemini-3.1-flash-image-preview",
                  aspectRatio: input?.aspectRatio || "16:9",
                  count,
                  negativePrompt: input?.negativePrompt || "",
                  referenceImageUrl: null,
                  referenceImageUrls: [],
                });
                resolvedModel = "gemini-3.1-flash-image-preview";
              }
            } else if (resolvedReferenceImageUrls.length) {
              console.log("[makeCreateImageTask] fallback → pure text-to-image gemini-3.1-flash-image-preview");
              imageUrls = await generateImagesWithAliyun({
                prompt: resolvedPrompt,
                model: "gemini-3.1-flash-image-preview",
                aspectRatio: input?.aspectRatio || "16:9",
                count,
                negativePrompt: input?.negativePrompt || "",
                referenceImageUrl: null,
                referenceImageUrls: [],
              });
              resolvedModel = "gemini-3.1-flash-image-preview";
            } else if (shouldRetryPureTextWithGemini(primaryError)) {
              console.log("[makeCreateImageTask] fallback -> pure text-to-image gemini-3-pro-image-preview after Seedream policy rejection");
              imageUrls = await generateImagesWithAliyun({
                prompt: resolvedPrompt,
                model: "gemini-3-pro-image-preview",
                aspectRatio: input?.aspectRatio || "16:9",
                resolution: input?.resolution || "2K",
                count,
                negativePrompt: input?.negativePrompt || "",
                referenceImageUrl: null,
                referenceImageUrls: [],
              });
              resolvedModel = "gemini-3-pro-image-preview";
            } else {
              throw primaryError;
            }
          }
        }

        const mirroredImageUrls = [];
        for (let index = 0; index < count; index += 1) {
          let finalUrl = imageUrls?.[index] || `https://mock.assets.local/create/images/${Date.now()}_${index}.jpg`;
          if (/^https?:\/\//i.test(finalUrl)) {
            try {
              const mirrored = await this.mirrorRemoteAssetToUpload({
                url: finalUrl,
                kind: "create-image",
                fallbackBaseName: `create_img_${Date.now()}_${index}`,
                fallbackContentType: "image/jpeg",
              });
              if (mirrored) finalUrl = mirrored;
            } catch (mirrorErr) {
              console.warn("[makeCreateImageTask] mirror failed, keeping remote URL:", mirrorErr?.message);
            }
          }
          mirroredImageUrls.push(finalUrl);
        }

        for (let index = 0; index < count; index += 1) {
          const createdImage = {
            id: `create_img_${randomUUID().slice(0, 8)}`,
            actorId: resultActorId,
            taskId,
            prompt: resolvedPrompt,
            model: resolvedModel,
            style: input?.style || "default",
            aspectRatio: input?.aspectRatio || "16:9",
            resolution: input?.resolution || "2K",
            referenceImageUrl: primaryReference || null,
            referenceImageUrls,
            imageUrl: mirroredImageUrls[index] || imageUrls?.[index] || `https://mock.assets.local/create/images/${Date.now()}_${index}.jpg`,
            createdAt: timestamp
          };
          state.createStudioImages.unshift(createdImage);

          this.syncGeneratedResultToProjectAsset(state, input?.projectId, {
            assetType: "scene",
            name:
              count > 1
                ? `画布生成图片 ${index + 1}`
                : "画布生成图片",
            description: [
              "自动同步自画布生成结果",
              resolvedPrompt ? `Prompt: ${resolvedPrompt}` : "",
              resolvedModel ? `Model: ${resolvedModel}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
            previewUrl: createdImage.imageUrl,
            mediaKind: "image",
            mediaUrl: createdImage.imageUrl,
            sourceTaskId: `${taskId}:${index}`,
            generationPrompt: resolvedPrompt,
            referenceImageUrls,
            imageStatus: "ready",
            imageModel: resolvedModel,
            aspectRatio: input?.aspectRatio || "16:9",
            negativePrompt: input?.negativePrompt || "",
          });
        }

        return "provider create image completed";
      }
    });
    taskId = task.id;
    return task;
  }

  makeCreateVideoTask(input) {
    if (input?.videoMode) {
      input = { ...input, videoMode: normalizeVideoMode(input.videoMode) };
    }
    const resultActorId = this.resolveActorId(input?.actorId);
    const preflightMultiRef = sanitizeMultiReferenceImages(input?.multiReferenceImages);
    const preflightMultiRefCount = Object.keys(preflightMultiRef).length;
    const preflightDirectReferenceSource =
      typeof input?.referenceImageUrl === "string" ? String(input.referenceImageUrl).trim() || null : null;
    const preflightReferenceSource = pickPrimaryMultiReferenceUrl(preflightMultiRef) || preflightDirectReferenceSource;
    const preflightInputMode =
      input?.videoMode === "image_to_video"
        ? preflightDirectReferenceSource
          ? "single_reference"
          : "text_to_video"
        : input?.videoMode || null;
    if (input?.videoMode === "start_end_frame") {
      if (!String(input?.firstFrameUrl || "").trim()) {
        throw apiError(400, "MISSING_FIRST_FRAME", "首尾帧模式缺少首帧。");
      }
      if (!String(input?.lastFrameUrl || "").trim()) {
        throw apiError(400, "MISSING_LAST_FRAME", "首尾帧模式缺少尾帧。");
      }
    }
    // Seedance 2.0 is the product baseline for all video modes.
    const defaultVideoModel = this.getDefaultModelId("videoModelId", "doubao-seedance-2-0-260128");
    let preflightVideoModelChoice = input?.model || defaultVideoModel;
    preflightVideoModelChoice = resolveStableCreateVideoModeModel(preflightVideoModelChoice, input?.videoMode || null);
    const preflightResolvedModel = resolveCreateVideoModel(
      preflightVideoModelChoice,
      preflightReferenceSource,
      defaultVideoModel,
      Boolean(String(input?.firstFrameUrl || "").trim()),
      input?.videoMode || null,
      Boolean(preflightMultiRefCount)
    );
    assertCreateVideoInputModeSupported(preflightResolvedModel, input?.videoMode || null, preflightInputMode);

    let taskId = null;
    const task = this.createTask({
      type: "create_video_generate",
      domain: "create",
      inputSummary: input?.prompt || "Generate standalone video",
      metadata: input,
      effect: async (state) => {
        const timestamp = new Date().toISOString();
        let thumbnailUrl = `https://mock.assets.local/create/videos/${Date.now()}.jpg`;
        let videoUrl = `https://mock.assets.local/create/videos/${Date.now()}.mp4`;
        const firstFrameResolved = input?.firstFrameUrl
          ? this.resolveProviderImageSource(input.firstFrameUrl)
          : null;
        const lastFrameResolved = input?.lastFrameUrl
          ? this.resolveProviderImageSource(input.lastFrameUrl)
          : null;

        const multiRef = sanitizeMultiReferenceImages(input?.multiReferenceImages);
        const userFacingPrompt = input?.prompt || "Generated video prompt";
        const isMultiParam = input?.videoMode === "multi_param";
        const multiRefCount = Object.keys(multiRef).length;
        const primaryMultiUrl = pickPrimaryMultiReferenceUrl(multiRef);
        let resolvedMultiReferenceImageUrls = [];
        const directReferenceSource =
          typeof input?.referenceImageUrl === "string" ? String(input.referenceImageUrl).trim() || null : null;
        const currentCreateVideoInputMode =
          input?.videoMode === "image_to_video"
            ? directReferenceSource
              ? "single_reference"
              : "text_to_video"
            : input?.videoMode || null;
        if (input?.videoMode === "start_end_frame") {
          if (!firstFrameResolved) {
            throw apiError(400, "MISSING_FIRST_FRAME", "首尾帧模式缺少首帧。");
          }
          if (!lastFrameResolved) {
            throw apiError(400, "MISSING_LAST_FRAME", "首尾帧模式缺少尾帧。");
          }
        }
        // Seedance 2.0 is the product baseline for all video modes.
        const defaultVideoModel = this.getDefaultModelId("videoModelId", "doubao-seedance-2-0-260128");
        let videoModelChoice =
          input?.model || defaultVideoModel;
        videoModelChoice = resolveStableCreateVideoModeModel(videoModelChoice, input?.videoMode || null);
        let promptForProvider =
          isMultiParam && multiRefCount
            ? buildComponentsMultiParamVideoProviderPrompt(userFacingPrompt, multiRef)
            : userFacingPrompt;
        let referenceSource = primaryMultiUrl || directReferenceSource;
        let displayReferenceImageUrl = referenceSource || input?.firstFrameUrl || null;
        let resolvedReferenceImageUrl = referenceSource
          ? this.resolveProviderImageSource(referenceSource)
          : null;

        if (isMultiParam && multiRefCount) {
          for (const key of MULTI_VIDEO_REF_ORDER) {
            const rawUrlList = Array.isArray(multiRef[key]) ? multiRef[key] : [];
            for (const rawUrlValue of rawUrlList) {
              const rawUrl = String(rawUrlValue || "").trim();
              if (!rawUrl) continue;

            let candidate = rawUrl;
            try {
              const parsed = new URL(rawUrl);
              const expires = Number(parsed.searchParams.get("Expires") || parsed.searchParams.get("expires"));
              const isLikelyExpiringRemoteRef =
                Number.isFinite(expires) ||
                parsed.searchParams.has("Signature") ||
                parsed.searchParams.has("OSSAccessKeyId") ||
                /dashscope|aliyuncs/i.test(parsed.hostname || "");
              if (isLikelyExpiringRemoteRef) {
                try {
                  const mirrored = await this.mirrorRemoteAssetToUpload({
                    url: rawUrl,
                    kind: "create-video-reference",
                    fallbackBaseName: `create_video_ref_${Date.now()}`,
                    fallbackContentType: "image/png",
                  });
                  if (mirrored) {
                    candidate = mirrored;
                  }
                } catch (mirrorError) {
                  const error = new Error(
                    `视频参考图链接已失效或不可访问，请重新上传后再试。原始原因：${mirrorError?.message || "unknown"}`
                  );
                  error.statusCode = 400;
                  error.code = "REFERENCE_IMAGE_EXPIRED";
                  throw error;
                }
              }
            } catch (error) {
              if (error?.code === "REFERENCE_IMAGE_EXPIRED") {
                throw error;
              }
              // keep rawUrl
            }

            const providerUrl = this.resolveProviderImageSource(candidate);
            if (providerUrl) {
              resolvedMultiReferenceImageUrls.push(providerUrl);
            }
            }
          }

          const primaryResolvedMultiRef = resolvedMultiReferenceImageUrls[0] || null;

          if (primaryMultiUrl || directReferenceSource) {
            referenceSource = primaryMultiUrl || directReferenceSource;
            displayReferenceImageUrl = referenceSource;
            resolvedReferenceImageUrl = null;
          } else {
            referenceSource = null;
            displayReferenceImageUrl = input?.firstFrameUrl || null;
            resolvedReferenceImageUrl = null;
            promptForProvider = userFacingPrompt;
          }
        }

        const resolvedModel = resolveCreateVideoModel(
          videoModelChoice,
          referenceSource,
          defaultVideoModel,
          Boolean(firstFrameResolved),
          input?.videoMode || null,
          Boolean(multiRefCount)
        );
        assertCreateVideoInputModeSupported(resolvedModel, input?.videoMode || null, currentCreateVideoInputMode);
        const { requestedDuration, normalizedDuration } = resolveCreateVideoDuration(
          resolvedModel,
          input?.duration,
          input?.videoMode || null,
          currentCreateVideoInputMode,
        );
        const { requestedAspectRatio, normalizedAspectRatio } = resolveCreateVideoAspectRatio(
          resolvedModel,
          input?.aspectRatio,
          input?.videoMode || null,
          currentCreateVideoInputMode,
        );
        const { requestedResolution, normalizedResolution } = resolveCreateVideoResolution(
          resolvedModel,
          input?.resolution,
          input?.videoMode || null,
          currentCreateVideoInputMode,
        );
        assertMediaGenerationModelConfigured("video", resolvedModel);

        if (taskId) {
          this.updateTask(taskId, {
            metadata: {
              ...(input || {}),
              model: formatCreateVideoModelLabel(resolvedModel),
              inputMode: currentCreateVideoInputMode,
              requestedDuration,
              requestedAspectRatio,
              duration: normalizedDuration,
              aspectRatio: normalizedAspectRatio,
              requestedResolution,
              resolution: normalizedResolution,
            },
          });
        }

        if (isMultiParam && taskId) {
          this.updateTask(taskId, {
            metadata: {
              ...(input || {}),
              multiReferenceImages: multiRefCount ? multiRef : null,
              resolvedReferenceImageUrl: null,
              inputMode: currentCreateVideoInputMode,
              requestedDuration,
              requestedAspectRatio,
              duration: normalizedDuration,
              aspectRatio: normalizedAspectRatio,
              requestedResolution,
              resolution: normalizedResolution,
              model: formatCreateVideoModelLabel(resolvedModel),
            },
          });
        }

        if (assertMediaGenerationModelConfigured("video", resolvedModel)) {
          if (input?.networkSearch) {
            try {
              promptForProvider = await enhancePromptWithWebSearch(promptForProvider);
            } catch (e) {
              console.warn("[makeCreateVideoTask] networkSearch enhancement failed, using original prompt:", e?.message);
            }
          }
          const providerModel = normalizeModelId(resolvedModel);
          const startEndFallbackCandidates = getStartEndProviderModelCandidates(
            providerModel,
            input?.videoMode || null
          );
          const providerModelCandidates =
            input?.videoMode === "start_end_frame"
              ? startEndFallbackCandidates
              : getMultiParamProviderModelCandidates(providerModel, input?.videoMode || null);
          const baseProviderInput = {
            model: providerModelCandidates[0] || providerModel,
            prompt: promptForProvider,
            referenceImageUrl: resolvedReferenceImageUrl,
            referenceImageUrls: resolvedMultiReferenceImageUrls,
            firstFrameUrl: firstFrameResolved,
            lastFrameUrl: lastFrameResolved,
            aspectRatio: normalizedAspectRatio,
            resolution: normalizedResolution,
            duration: normalizedDuration,
            videoMode: input?.videoMode || null,
            inputMode: currentCreateVideoInputMode,
            maxReferenceImages: isMultiParam
              ? getCreateVideoMultiParamModel(resolvedModel)?.maxReferenceImages || 7
              : null,
            generateAudio: input?.generateAudio,
            networkSearch: input?.networkSearch,
          };
          const shouldRetrySingleReferenceYunwuVideo =
            getMediaGenerationProvider("video", providerModel) === "yunwu" &&
            input?.videoMode === "image_to_video" &&
            Boolean(resolvedReferenceImageUrl) &&
            !firstFrameResolved &&
            !resolvedMultiReferenceImageUrls.length;
          const shouldRetryStartEndYunwuVideo =
            getMediaGenerationProvider("video", providerModel) === "yunwu" &&
            input?.videoMode === "start_end_frame" &&
            false;
          const shouldRetryMultiParamYunwuVideo =
            getMediaGenerationProvider("video", providerModel) === "yunwu" &&
            input?.videoMode === "multi_param" &&
            resolvedMultiReferenceImageUrls.length > 0;
          const yunwuAttemptModes = shouldRetrySingleReferenceYunwuVideo
            ? ["auto", "first_frame", "reference_images", "images"]
            : shouldRetryMultiParamYunwuVideo
              ? ["images", "images", "images"]
            : shouldRetryStartEndYunwuVideo
              ? ["auto", "auto", "auto"]
                : ["auto"];
            let result = null;
            let lastProviderError = null;
            let executedProviderModel = providerModelCandidates[0] || providerModel;

            outer: for (let providerIndex = 0; providerIndex < providerModelCandidates.length; providerIndex += 1) {
              const providerModelCandidate = providerModelCandidates[providerIndex];
              let candidateError = null;

              for (const yunwuImageInputMode of yunwuAttemptModes) {
                try {
                  const providerTaskId = await createAliyunVideoTask({
                    ...baseProviderInput,
                    model: providerModelCandidate,
                    yunwuImageInputMode,
                  });
                  result = await waitForAliyunTask(providerTaskId);
                  executedProviderModel = providerModelCandidate;
                  break outer;
                } catch (error) {
                  lastProviderError = error;
                  candidateError = error;

                  if (
                    input?.videoMode === "multi_param" &&
                    isUnsupportedYunwuModelError(error) &&
                    providerIndex < providerModelCandidates.length - 1
                  ) {
                    continue outer;
                  }

                  const shouldRetryCurrentFailure =
                    shouldRetrySingleReferenceYunwuVideo ||
                    shouldRetryMultiParamYunwuVideo ||
                    (shouldRetryStartEndYunwuVideo &&
                      (Number(error?.statusCode) >= 500 ||
                        [
                          "YUNWU_TASK_FAILED",
                          "YUNWU_TASK_TIMEOUT",
                          "YUNWU_API_ERROR",
                          "ALIYUN_PROVIDER_ERROR",
                        ].includes(String(error?.code || ""))));
                  if (!shouldRetryCurrentFailure) {
                    throw error;
                  }
                }
              }

              if (
                input?.videoMode === "start_end_frame" &&
                providerIndex < providerModelCandidates.length - 1 &&
                candidateError
              ) {
                console.warn(
                  "[makeCreateVideoTask] start_end_frame fallback ->",
                  providerModelCandidates[providerIndex + 1],
                  "after",
                  providerModelCandidate,
                  "failed:",
                  candidateError?.message || candidateError,
                );
                continue outer;
              }

              if (candidateError) {
                throw candidateError;
              }
            }

            if (!result) {
              throw lastProviderError || new Error("Video generation failed");
            }
          const provider = getMediaGenerationProvider("video", executedProviderModel);
          const parsedResult = provider === "pixverse"
            ? parsePixverseVideoResult(result)
            : isSeedanceVideoModel(executedProviderModel)
              ? parseSeedanceVideoResult(result)
              : parseAliyunVideoResult(result);
          const outputDuration = parsedResult.outputDuration || normalizedDuration;
          const outputAspectRatio = parsedResult.outputAspectRatio || normalizedAspectRatio;
          const outputResolution = parsedResult.outputResolution || normalizedResolution;
          thumbnailUrl =
            parsedResult.thumbnailUrl ||
            displayReferenceImageUrl ||
            input.firstFrameUrl ||
            thumbnailUrl;
          videoUrl = parsedResult.videoUrl || videoUrl;
          if (parsedResult.videoUrl) {
            videoUrl =
              (await this.mirrorRemoteAssetToUpload({
                url: parsedResult.videoUrl,
                kind: "create-video",
                fallbackBaseName: taskId || `create-video-${Date.now()}`,
                fallbackContentType: "video/mp4",
              })) || videoUrl;
          }
          if (taskId) {
            const taskRecord = Array.isArray(state.tasks)
              ? state.tasks.find((entry) => entry.id === taskId) || null
              : null;
            this.updateTask(taskId, {
              metadata: {
                ...(taskRecord?.metadata || {}),
                model: formatCreateVideoModelLabel(executedProviderModel),
                inputMode: currentCreateVideoInputMode,
                outputDuration,
                outputAspectRatio,
                outputResolution,
              },
            });
          }
          const createdVideo = {
            id: `create_vid_${randomUUID().slice(0, 8)}`,
            actorId: resultActorId,
            taskId,
            prompt: userFacingPrompt,
            model: formatCreateVideoModelLabel(executedProviderModel),
            duration: requestedDuration,
            aspectRatio: requestedAspectRatio,
            resolution: normalizedResolution,
            outputDuration,
            outputAspectRatio,
            requestedResolution,
            outputResolution,
            referenceImageUrl: displayReferenceImageUrl || null,
            resolvedReferenceImageUrl: isMultiParam ? null : displayReferenceImageUrl || null,
            firstFrameUrl: input?.firstFrameUrl || null,
            lastFrameUrl: input?.lastFrameUrl || null,
            videoMode: input?.videoMode || null,
            inputMode: currentCreateVideoInputMode,
            multiReferenceImages: multiRefCount ? multiRef : null,
            thumbnailUrl,
            videoUrl,
            createdAt: timestamp
          };
          state.createStudioVideos.unshift(createdVideo);

          this.syncGeneratedResultToProjectAsset(state, input?.projectId, {
            assetType: "video_ref",
            name: "画布生成视频",
            description: [
              "自动同步自画布生成结果",
              userFacingPrompt ? `Prompt: ${userFacingPrompt}` : "",
              executedProviderModel ? `Model: ${formatCreateVideoModelLabel(executedProviderModel)}` : "",
              input?.videoMode ? `Mode: ${input.videoMode}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
            previewUrl: createdVideo.thumbnailUrl,
            mediaKind: "video",
            mediaUrl: createdVideo.videoUrl,
            sourceTaskId: taskId,
            generationPrompt: userFacingPrompt,
            referenceImageUrls: [
              createdVideo.referenceImageUrl,
              createdVideo.firstFrameUrl,
              createdVideo.lastFrameUrl,
            ].filter(Boolean),
            imageStatus: "ready",
            imageModel: formatCreateVideoModelLabel(executedProviderModel),
            aspectRatio: outputAspectRatio || requestedAspectRatio || normalizedAspectRatio,
          });

          return "provider create video completed";
        }

        const createdVideo = {
          id: `create_vid_${randomUUID().slice(0, 8)}`,
          actorId: resultActorId,
          taskId,
          prompt: userFacingPrompt,
          model: formatCreateVideoModelLabel(resolvedModel),
          duration: requestedDuration,
          aspectRatio: requestedAspectRatio,
          resolution: normalizedResolution,
          outputDuration: normalizedDuration,
          outputAspectRatio: normalizedAspectRatio,
          requestedResolution,
          outputResolution: normalizedResolution,
          referenceImageUrl: displayReferenceImageUrl || null,
          resolvedReferenceImageUrl: isMultiParam ? null : displayReferenceImageUrl || null,
          firstFrameUrl: input?.firstFrameUrl || null,
          lastFrameUrl: input?.lastFrameUrl || null,
          videoMode: input?.videoMode || null,
          inputMode: currentCreateVideoInputMode,
          multiReferenceImages: multiRefCount ? multiRef : null,
          thumbnailUrl,
          videoUrl,
          createdAt: timestamp
        };
        state.createStudioVideos.unshift(createdVideo);

        this.syncGeneratedResultToProjectAsset(state, input?.projectId, {
          assetType: "video_ref",
          name: "画布生成视频",
          description: [
            "自动同步自画布生成结果",
            userFacingPrompt ? `Prompt: ${userFacingPrompt}` : "",
            resolvedModel ? `Model: ${formatCreateVideoModelLabel(resolvedModel)}` : "",
            input?.videoMode ? `Mode: ${input.videoMode}` : "",
          ]
            .filter(Boolean)
            .join("\n"),
          previewUrl: createdVideo.thumbnailUrl,
          mediaKind: "video",
          mediaUrl: createdVideo.videoUrl,
          sourceTaskId: taskId,
          generationPrompt: userFacingPrompt,
          referenceImageUrls: [
            createdVideo.referenceImageUrl,
            createdVideo.firstFrameUrl,
            createdVideo.lastFrameUrl,
          ].filter(Boolean),
          imageStatus: "ready",
          imageModel: formatCreateVideoModelLabel(resolvedModel),
          aspectRatio: createdVideo.outputAspectRatio || requestedAspectRatio || normalizedAspectRatio,
        });

        return "provider create video completed";
      }
    });
    taskId = task.id;
    return task;
  }

  findStoryboard(storyboardId) {
    return this.findStoryboardInState(this.state, storyboardId);
  }

  findStoryboardInState(state, storyboardId) {
    for (const storyboards of Object.values(state.storyboardsByProjectId)) {
      const match = storyboards.find((item) => item.id === storyboardId);
      if (match) return match;
    }
    return null;
  }
}

MockStore.prototype.buildDefaultUsers = function buildDefaultUsers(timestamp) {
  return [
    {
      id: "user_demo_001",
      displayName: "阿宁",
      email: "aning@xiaolou.demo",
      platformRole: "customer",
      status: "active",
      defaultOrganizationId: "org_demo_001",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "user_member_001",
      displayName: "周叙",
      email: "zhouxu@xiaolou.demo",
      platformRole: "customer",
      status: "active",
      defaultOrganizationId: "org_demo_001",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "user_personal_001",
      displayName: "独立创作者",
      email: "creator@xiaolou.demo",
      platformRole: "customer",
      status: "active",
      defaultOrganizationId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "ops_demo_001",
      displayName: "运营管理员",
      email: "ops@xiaolou.demo",
      platformRole: "ops_admin",
      status: "active",
      defaultOrganizationId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "root_demo_001",
      displayName: "超级管理员",
      email: "root@xiaolou.demo",
      platformRole: "super_admin",
      status: "active",
      defaultOrganizationId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
};

MockStore.prototype.buildDefaultOrganizations = function buildDefaultOrganizations(timestamp) {
  return [
    {
      id: "org_demo_001",
      name: "小楼影像工作室",
      status: "active",
      assetLibraryStatus: "approved",
      defaultBillingPolicy: "organization_only",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
};

MockStore.prototype.buildDefaultMemberships = function buildDefaultMemberships(timestamp) {
  return [
    {
      id: "membership_demo_admin",
      organizationId: "org_demo_001",
      userId: "user_demo_001",
      role: "admin",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "membership_demo_member",
      organizationId: "org_demo_001",
      userId: "user_member_001",
      role: "member",
      status: "active",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
};

MockStore.prototype.buildDefaultUsers = function buildDefaultUsers(timestamp) {
  return [
    {
      id: "user_demo_001",
      displayName: "企业管理员演示账号",
      email: "aning@xiaolou.demo",
      phone: "13800000001",
      platformRole: "customer",
      status: "active",
      defaultOrganizationId: "org_demo_001",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "user_member_001",
      displayName: "企业成员演示账号",
      email: "zhouxu@xiaolou.demo",
      phone: "13800000002",
      platformRole: "customer",
      status: "active",
      defaultOrganizationId: "org_demo_001",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "user_personal_001",
      displayName: "个人版演示账号",
      email: "creator@xiaolou.demo",
      phone: "13800000003",
      platformRole: "customer",
      status: "active",
      defaultOrganizationId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "ops_demo_001",
      displayName: "运营管理员",
      email: "ops@xiaolou.demo",
      phone: null,
      platformRole: "ops_admin",
      status: "active",
      defaultOrganizationId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "root_demo_001",
      displayName: "超级管理员",
      email: "root@xiaolou.demo",
      phone: null,
      platformRole: "super_admin",
      status: "active",
      defaultOrganizationId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
};

MockStore.prototype.buildDefaultOrganizations = function buildDefaultOrganizations(timestamp) {
  return [
    {
      id: "org_demo_001",
      name: "小楼影像工作室",
      status: "active",
      assetLibraryStatus: "approved",
      defaultBillingPolicy: "organization_only",
      licenseNo: "91310000XLDEMO001",
      industry: "影视内容",
      teamSize: "11-50",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
};

MockStore.prototype.buildDefaultMemberships = function buildDefaultMemberships(timestamp) {
  return [
    {
      id: "membership_demo_admin",
      organizationId: "org_demo_001",
      userId: "user_demo_001",
      role: "admin",
      status: "active",
      department: "管理层",
      canUseOrganizationWallet: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "membership_demo_member",
      organizationId: "org_demo_001",
      userId: "user_member_001",
      role: "member",
      status: "active",
      department: "内容制作",
      canUseOrganizationWallet: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
};

MockStore.prototype.buildDefaultPricingRules = function buildDefaultPricingRules(timestamp) {
  return [
    {
      id: "price_script_rewrite",
      actionCode: "script_rewrite",
      label: "剧本改写",
      baseCredits: 8,
      unitLabel: "次",
      description: "按次计费的脚本润色与改写。",
      updatedAt: timestamp,
    },
    {
      id: "price_asset_extract",
      actionCode: "asset_extract",
      label: "资产提取",
      baseCredits: 12,
      unitLabel: "次",
      description: "从剧本中抽取角色、场景和道具。",
      updatedAt: timestamp,
    },
    {
      id: "price_asset_image_generate",
      actionCode: "asset_image_generate",
      label: "资产出图",
      baseCredits: 18,
      unitLabel: "张",
      description: "单个资产设定图生成。",
      updatedAt: timestamp,
    },
    {
      id: "price_storyboard_auto_generate",
      actionCode: "storyboard_auto_generate",
      label: "自动拆分分镜",
      baseCredits: 14,
      unitLabel: "次",
      description: "整段剧本的分镜拆分预估。",
      updatedAt: timestamp,
    },
    {
      id: "price_storyboard_image_generate",
      actionCode: "storyboard_image_generate",
      label: "分镜出图",
      baseCredits: 12,
      unitLabel: "张",
      description: "单镜头分镜图生成。",
      updatedAt: timestamp,
    },
    {
      id: "price_video_generate",
      actionCode: "video_generate",
      label: "视频生成",
      baseCredits: 80,
      unitLabel: "镜头",
      description: "按镜头计费的视频生成。",
      updatedAt: timestamp,
    },
    {
      id: "price_dubbing_generate",
      actionCode: "dubbing_generate",
      label: "配音生成",
      baseCredits: 10,
      unitLabel: "条",
      description: "单条台词配音生成。",
      updatedAt: timestamp,
    },
    {
      id: "price_lipsync_generate",
      actionCode: "lipsync_generate",
      label: "对口型",
      baseCredits: 28,
      unitLabel: "条",
      description: "单条镜头口型同步。",
      updatedAt: timestamp,
    },
    {
      id: "price_project_export",
      actionCode: "project_export",
      label: "成片导出",
      baseCredits: 16,
      unitLabel: "次",
      description: "项目导出与成片合成。",
      updatedAt: timestamp,
    },
    {
      id: "price_character_replace",
      actionCode: "character_replace",
      label: "人物替换",
      baseCredits: 26,
      unitLabel: "次",
      description: "工具箱人物替换能力。",
      updatedAt: timestamp,
    },
    {
      id: "price_motion_transfer",
      actionCode: "motion_transfer",
      label: "动作迁移",
      baseCredits: 46,
      unitLabel: "次",
      description: "工具箱动作迁移能力。",
      updatedAt: timestamp,
    },
    {
      id: "price_upscale_restore",
      actionCode: "upscale_restore",
      label: "超清修复",
      baseCredits: 14,
      unitLabel: "次",
      description: "工具箱超清修复能力。",
      updatedAt: timestamp,
    },
    {
      id: "price_create_image_generate",
      actionCode: "create_image_generate",
      label: "独立出图",
      baseCredits: 6,
      unitLabel: "张",
      description: "创作中心单次图像生成。",
      updatedAt: timestamp,
    },
    {
      id: "price_create_video_generate",
      actionCode: "create_video_generate",
      label: "独立视频生成",
      baseCredits: 28,
      unitLabel: "次",
      description: "创作中心单次视频生成。",
      updatedAt: timestamp,
    },
  ];
};

MockStore.prototype.mapTaskTypeToActionCode = function mapTaskTypeToActionCode(type) {
  const mapping = {
    script_rewrite: "script_rewrite",
    asset_extract: "asset_extract",
    asset_image_generate: "asset_image_generate",
    storyboard_auto_generate: "storyboard_auto_generate",
    storyboard_image_generate: "storyboard_image_generate",
    video_generate: "video_generate",
    dubbing_generate: "dubbing_generate",
    lipsync_generate: "lipsync_generate",
    project_export: "project_export",
    character_replace: "character_replace",
    motion_transfer: "motion_transfer",
    upscale_restore: "upscale_restore",
    create_image_generate: "create_image_generate",
    create_video_generate: "create_video_generate",
  };
  return mapping[type] || type || "generic_task";
};

MockStore.prototype.resolveActorId = function resolveActorId(actorId) {
  if (typeof actorId === "string" && actorId.trim()) {
    return actorId.trim();
  }
  return this.state.defaultActorId || "user_demo_001";
};

MockStore.prototype.getCreateStudioResultActorId = function getCreateStudioResultActorId(item) {
  const explicitActorId =
    typeof item?.actorId === "string" && item.actorId.trim() ? item.actorId.trim() : null;
  if (explicitActorId) {
    return explicitActorId;
  }

  const taskId = typeof item?.taskId === "string" && item.taskId.trim() ? item.taskId.trim() : null;
  if (taskId) {
    const linkedTask = (this.state.tasks || []).find((task) => task.id === taskId);
    if (linkedTask?.actorId) {
      return linkedTask.actorId;
    }
  }

  return this.state.defaultActorId || "user_demo_001";
};

MockStore.prototype.getUser = function getUser(userId) {
  return (this.state.users || []).find((item) => item.id === userId) || null;
};

MockStore.prototype.resolveActor = function resolveActor(actorId) {
  const resolvedActorId = this.resolveActorId(actorId);
  if (resolvedActorId === "guest") {
    return {
      id: "guest",
      displayName: "游客",
      platformRole: "guest",
      status: "active",
      defaultOrganizationId: null,
    };
  }

  return (
    this.getUser(resolvedActorId) || {
      id: resolvedActorId,
      displayName: "游客",
      platformRole: "guest",
      status: "active",
      defaultOrganizationId: null,
    }
  );
};

MockStore.prototype.getOrganizationById = function getOrganizationById(organizationId) {
  return (this.state.organizations || []).find((item) => item.id === organizationId) || null;
};

MockStore.prototype.listMembershipsForUser = function listMembershipsForUser(userId) {
  return (this.state.organizationMemberships || []).filter(
    (item) => item.userId === userId && item.status !== "disabled"
  );
};

MockStore.prototype.getMembership = function getMembership(userId, organizationId) {
  return (
    (this.state.organizationMemberships || []).find(
      (item) =>
        item.userId === userId &&
        item.organizationId === organizationId &&
        item.status !== "disabled"
    ) || null
  );
};

MockStore.prototype.findUserByEmail = function findUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  return (this.state.users || []).find((item) => normalizeEmail(item.email) === normalizedEmail) || null;
};

MockStore.prototype.loginWithEmail = function loginWithEmail(input = {}) {
  const email = normalizeEmail(requireText(input.email, "email", "email"));
  const password = requireText(input.password, "password", "password");

  const user = this.findUserByEmail(email);
  if (!user) {
    throw apiError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确");
  }

  if (!user.passwordHash) {
    throw apiError(401, "INVALID_CREDENTIALS", "该账号为演示账号，请先通过注册创建新账号");
  }

  if (!verifyPassword(password, user.passwordHash)) {
    throw apiError(401, "INVALID_CREDENTIALS", "邮箱或密码不正确");
  }

  this.ensureDefaultProjectForActor(user.id);
  return clone({
    actorId: user.id,
    token: generateAuthToken(user.id),
    displayName: user.displayName,
    email: user.email,
    permissionContext: this.getPermissionContext(user.id),
  });
};

MockStore.prototype.ensureWalletForOwner = function ensureWalletForOwner(ownerType, ownerId, options = {}) {
  if (!Array.isArray(this.state.wallets)) {
    this.state.wallets = [];
  }

  const existing = this.getWalletByOwner(ownerType, ownerId);
  if (existing) {
    return existing;
  }

  const wallet = {
    id: `wallet_${ownerType}_${randomUUID().slice(0, 8)}`,
    ownerType,
    ownerId,
    displayName:
      options.displayName ||
      (ownerType === "organization" ? "企业钱包" : "个人钱包"),
    availableCredits: Number(options.availableCredits || 0),
    frozenCredits: Number(options.frozenCredits || 0),
    currency: "credits",
    status: "active",
    allowNegative: false,
    updatedAt: options.updatedAt || new Date().toISOString(),
  };

  this.state.wallets.push(wallet);

  const initialCredits = Number(wallet.availableCredits || 0) + Number(wallet.frozenCredits || 0);
  if (initialCredits > 0) {
    this.recordWalletEntry({
      wallet,
      entryType: "grant",
      amount: initialCredits,
      sourceType: "manual",
      sourceId: `seed_${wallet.id}`,
      createdBy: options.createdBy || "root_demo_001",
      metadata: {
        registration: Boolean(options.registration),
        ownerType,
      },
    });
  }

  if (Number(wallet.frozenCredits || 0) > 0) {
    this.recordWalletEntry({
      wallet,
      entryType: "freeze",
      amount: -Number(wallet.frozenCredits || 0),
      sourceType: "manual",
      sourceId: `seed_freeze_${wallet.id}`,
      createdBy: options.createdBy || "root_demo_001",
      metadata: {
        registration: Boolean(options.registration),
        ownerType,
      },
    });
  }

  return wallet;
};

MockStore.prototype.buildOrganizationMemberUsage = function buildOrganizationMemberUsage(
  organizationId,
  userId
) {
  const organizationWallet = this.getWalletByOwner("organization", organizationId);
  const emptySummary = {
    todayUsedCredits: 0,
    monthUsedCredits: 0,
    totalUsedCredits: 0,
    refundedCredits: 0,
    pendingFrozenCredits: 0,
    recentTaskCount: 0,
    lastActivityAt: null,
  };

  if (!organizationWallet) {
    return emptySummary;
  }

  const now = new Date();
  let todayUsedCredits = 0;
  let monthUsedCredits = 0;
  let totalUsedCredits = 0;
  let refundedCredits = 0;
  let lastActivityAt = null;
  const recentTaskIds = new Set();

  for (const entry of this.state.walletLedgerEntries || []) {
    if (entry.walletId !== organizationWallet.id || entry.createdBy !== userId) {
      continue;
    }

    const createdAt = new Date(entry.createdAt || now.toISOString());
    if (!lastActivityAt || createdAt.getTime() > new Date(lastActivityAt).getTime()) {
      lastActivityAt = entry.createdAt;
    }

    if (entry.entryType === "settle") {
      const usedCredits = Math.abs(Number(entry.amount || 0));
      totalUsedCredits += usedCredits;
      if (sameCalendarMonth(createdAt, now)) {
        monthUsedCredits += usedCredits;
      }
      if (sameCalendarDay(createdAt, now)) {
        todayUsedCredits += usedCredits;
      }
      if (entry.sourceType === "task" && entry.sourceId) {
        recentTaskIds.add(entry.sourceId);
      }
    }

    if (entry.entryType === "refund") {
      refundedCredits += Math.abs(Number(entry.amount || 0));
    }
  }

  const pendingFrozenCredits = (this.state.tasks || [])
    .filter(
      (task) =>
        task.walletId === organizationWallet.id &&
        task.actorId === userId &&
        Number(task.frozenCredits || 0) > 0 &&
        task.status !== "failed"
    )
    .reduce((sum, task) => sum + Number(task.frozenCredits || 0), 0);

  return {
    todayUsedCredits,
    monthUsedCredits,
    totalUsedCredits,
    refundedCredits,
    pendingFrozenCredits,
    recentTaskCount: recentTaskIds.size,
    lastActivityAt,
  };
};

MockStore.prototype.toPublicOrganizationMember = function toPublicOrganizationMember(
  membership,
  options = {}
) {
  const user = this.getUser(membership.userId);
  const includeUsage =
    typeof options.includeUsage === "boolean" ? options.includeUsage : true;
  return {
    id: membership.id,
    organizationId: membership.organizationId,
    userId: membership.userId,
    displayName: user?.displayName || membership.userId,
    email: user?.email || null,
    phone: user?.phone || null,
    platformRole: user?.platformRole || "customer",
    role: membership.role === "admin" ? "enterprise_admin" : "enterprise_member",
    membershipRole: membership.role,
    department: membership.department || "",
    canUseOrganizationWallet: membership.canUseOrganizationWallet !== false,
    status: membership.status,
    createdAt: membership.createdAt,
    updatedAt: membership.updatedAt,
    usageSummary: includeUsage
      ? this.buildOrganizationMemberUsage(membership.organizationId, membership.userId)
      : null,
  };
};

MockStore.prototype.getWalletById = function getWalletById(walletId) {
  return (this.state.wallets || []).find((item) => item.id === walletId) || null;
};

MockStore.prototype.getWalletByOwner = function getWalletByOwner(ownerType, ownerId) {
  return (
    (this.state.wallets || []).find(
      (item) => item.ownerType === ownerType && item.ownerId === ownerId
    ) || null
  );
};

MockStore.prototype.toPublicWallet = function toPublicWallet(wallet) {
  if (!wallet) return null;
  return clone({
    id: wallet.id,
    ownerType: wallet.ownerType,
    walletOwnerType: wallet.ownerType,
    ownerId: wallet.ownerId,
    displayName: wallet.displayName,
    availableCredits: Number(wallet.availableCredits || 0),
    frozenCredits: Number(wallet.frozenCredits || 0),
    creditsAvailable: Number(wallet.availableCredits || 0),
    creditsFrozen: Number(wallet.frozenCredits || 0),
    currency: wallet.currency || "credits",
    status: wallet.status || "active",
    allowNegative: Boolean(wallet.allowNegative),
    updatedAt: wallet.updatedAt || new Date().toISOString(),
  });
};

MockStore.prototype.toPublicLedgerEntry = function toPublicLedgerEntry(entry) {
  if (!entry) return null;
  return clone({
    id: entry.id,
    walletId: entry.walletId,
    entryType: entry.entryType,
    amount: Number(entry.amount || 0),
    balanceAfter: Number(entry.balanceAfter || 0),
    frozenBalanceAfter: Number(entry.frozenBalanceAfter || 0),
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    projectId: entry.projectId || null,
    orderId: entry.orderId || null,
    createdBy: entry.createdBy || null,
    metadata: entry.metadata || {},
    createdAt: entry.createdAt,
  });
};

MockStore.prototype.ensureIdentityAndBillingState = function ensureIdentityAndBillingState() {
  let changed = false;
  const timestamp =
    this.state.projects?.[0]?.updatedAt ||
    this.state.wallet?.updatedAt ||
    new Date().toISOString();

  if (!Array.isArray(this.state.users) || this.state.users.length === 0) {
    this.state.users = this.buildDefaultUsers(timestamp);
    changed = true;
  }

  if (!Array.isArray(this.state.organizations) || this.state.organizations.length === 0) {
    this.state.organizations = this.buildDefaultOrganizations(timestamp);
    changed = true;
  }

  if (
    !Array.isArray(this.state.organizationMemberships) ||
    this.state.organizationMemberships.length === 0
  ) {
    this.state.organizationMemberships = this.buildDefaultMemberships(timestamp);
    changed = true;
  }

  for (const user of this.state.users || []) {
    const nextUser = {
      ...user,
      displayName: String(user.displayName || "注册用户").trim() || "注册用户",
      email: normalizeEmail(user.email),
      phone: normalizePhone(user.phone),
      platformRole: user.platformRole || "customer",
      status: user.status || "active",
      defaultOrganizationId: user.defaultOrganizationId || null,
      createdAt: user.createdAt || timestamp,
      updatedAt: user.updatedAt || timestamp,
    };

    if (JSON.stringify(nextUser) !== JSON.stringify(user)) {
      Object.assign(user, nextUser);
      changed = true;
    }
  }

  for (const organization of this.state.organizations || []) {
    const nextOrganization = {
      ...organization,
      name: String(organization.name || "企业组织").trim() || "企业组织",
      status: organization.status || "active",
      assetLibraryStatus: organization.assetLibraryStatus || "pending_review",
      defaultBillingPolicy: organization.defaultBillingPolicy || "organization_only",
      licenseNo: organization.licenseNo || null,
      industry: organization.industry || null,
      teamSize: organization.teamSize || null,
      createdAt: organization.createdAt || timestamp,
      updatedAt: organization.updatedAt || timestamp,
    };

    if (JSON.stringify(nextOrganization) !== JSON.stringify(organization)) {
      Object.assign(organization, nextOrganization);
      changed = true;
    }
  }

  for (const membership of this.state.organizationMemberships || []) {
    const nextMembership = {
      ...membership,
      role: membership.role === "admin" ? "admin" : "member",
      status: membership.status || "active",
      department: membership.department || "",
      canUseOrganizationWallet: membership.canUseOrganizationWallet !== false,
      createdAt: membership.createdAt || timestamp,
      updatedAt: membership.updatedAt || timestamp,
    };

    if (JSON.stringify(nextMembership) !== JSON.stringify(membership)) {
      Object.assign(membership, nextMembership);
      changed = true;
    }
  }

  if (!Array.isArray(this.state.pricingRules) || this.state.pricingRules.length === 0) {
    this.state.pricingRules = this.buildDefaultPricingRules(timestamp);
    changed = true;
  }

  if (!Array.isArray(this.state.wallets) || this.state.wallets.length === 0) {
    const legacyWallet = this.state.wallet || {};
    const personalAvailable = Number(
      legacyWallet.creditsAvailable ?? legacyWallet.availableCredits ?? 5820
    );
    const personalFrozen = Number(
      legacyWallet.creditsFrozen ?? legacyWallet.frozenCredits ?? 320
    );
    this.state.wallets = [
      {
        id: "wallet_user_demo_001",
        ownerType: "user",
        ownerId: legacyWallet.ownerId || "user_demo_001",
        displayName: "个人钱包",
        availableCredits: personalAvailable,
        frozenCredits: personalFrozen,
        currency: "credits",
        status: "active",
        allowNegative: false,
        updatedAt: legacyWallet.updatedAt || timestamp,
      },
      {
        id: "wallet_org_demo_001",
        ownerType: "organization",
        ownerId: "org_demo_001",
        displayName: "企业钱包",
        availableCredits: 32000,
        frozenCredits: 640,
        currency: "credits",
        status: "active",
        allowNegative: false,
        updatedAt: timestamp,
      },
      {
        id: "wallet_user_member_001",
        ownerType: "user",
        ownerId: "user_member_001",
        displayName: "成员个人钱包",
        availableCredits: 2400,
        frozenCredits: 0,
        currency: "credits",
        status: "active",
        allowNegative: false,
        updatedAt: timestamp,
      },
      {
        id: "wallet_user_personal_001",
        ownerType: "user",
        ownerId: "user_personal_001",
        displayName: "个人钱包",
        availableCredits: 1600,
        frozenCredits: 0,
        currency: "credits",
        status: "active",
        allowNegative: false,
        updatedAt: timestamp,
      },
    ];
    changed = true;
  } else {
    for (const wallet of this.state.wallets) {
      const nextWallet = {
        id:
          wallet.id ||
          `wallet_${wallet.ownerType || wallet.walletOwnerType || "user"}_${
            wallet.ownerId || randomUUID().slice(0, 8)
          }`,
        ownerType: wallet.ownerType || wallet.walletOwnerType || "user",
        ownerId: wallet.ownerId || "user_demo_001",
        displayName:
          wallet.displayName ||
          ((wallet.ownerType || wallet.walletOwnerType) === "organization"
            ? "企业钱包"
            : "个人钱包"),
        availableCredits: Number(wallet.availableCredits ?? wallet.creditsAvailable ?? 0),
        frozenCredits: Number(wallet.frozenCredits ?? wallet.creditsFrozen ?? 0),
        currency: wallet.currency || "credits",
        status: wallet.status || "active",
        allowNegative: Boolean(wallet.allowNegative),
        updatedAt: wallet.updatedAt || timestamp,
      };

      if (JSON.stringify(nextWallet) !== JSON.stringify(wallet)) {
        Object.assign(wallet, nextWallet);
        changed = true;
      }
    }
  }

  if (!Array.isArray(this.state.walletLedgerEntries)) {
    this.state.walletLedgerEntries = [];

    for (const wallet of this.state.wallets) {
      const totalCredits = Number(wallet.availableCredits || 0) + Number(wallet.frozenCredits || 0);
      if (totalCredits > 0) {
        this.state.walletLedgerEntries.push({
          id: `ledger_seed_${wallet.id}`,
          walletId: wallet.id,
          entryType: "grant",
          amount: totalCredits,
          balanceAfter: totalCredits,
          frozenBalanceAfter: 0,
          sourceType: "manual",
          sourceId: `seed_${wallet.id}`,
          projectId: null,
          orderId: null,
          createdBy: "root_demo_001",
          metadata: { seed: true },
          createdAt: wallet.updatedAt || timestamp,
        });
      }

      if (Number(wallet.frozenCredits || 0) > 0) {
        this.state.walletLedgerEntries.push({
          id: `ledger_seed_freeze_${wallet.id}`,
          walletId: wallet.id,
          entryType: "freeze",
          amount: -Number(wallet.frozenCredits || 0),
          balanceAfter: Number(wallet.availableCredits || 0),
          frozenBalanceAfter: Number(wallet.frozenCredits || 0),
          sourceType: "task",
          sourceId: `seed_task_${wallet.id}`,
          projectId: null,
          orderId: null,
          createdBy: "root_demo_001",
          metadata: { seed: true },
          createdAt: wallet.updatedAt || timestamp,
        });
      }
    }

    changed = true;
  }

  if (!Array.isArray(this.state.walletRechargeOrders)) {
    this.state.walletRechargeOrders = [];
    changed = true;
  }

  if (!this.state.defaultActorId) {
    this.state.defaultActorId = "user_demo_001";
    changed = true;
  }

  for (const project of this.state.projects || []) {
    const nextOwnerType = project.ownerType || (project.organizationId ? "organization" : "personal");
    const nextOwnerId =
      project.ownerId ||
      (project.organizationId ? project.organizationId : project.createdBy || "user_demo_001");
    const nextBillingWalletType =
      project.billingWalletType || (project.organizationId ? "organization" : "personal");
    const nextBillingPolicy =
      project.billingPolicy || (project.organizationId ? "organization_only" : "personal_only");
    const nextBudgetLimitCredits =
      Number(project.budgetLimitCredits ?? project.budgetCredits) ||
      (project.organizationId ? 1280 : 600);
    const nextBudgetUsedCredits = Math.max(
      0,
      Number(project.budgetUsedCredits ?? Math.min(360, nextBudgetLimitCredits))
    );
    const nextCreatedBy = project.createdBy || "user_demo_001";

    if (
      project.ownerType !== nextOwnerType ||
      project.ownerId !== nextOwnerId ||
      project.billingWalletType !== nextBillingWalletType ||
      project.billingPolicy !== nextBillingPolicy ||
      project.budgetLimitCredits !== nextBudgetLimitCredits ||
      project.budgetUsedCredits !== nextBudgetUsedCredits ||
      project.createdBy !== nextCreatedBy ||
      project.budgetCredits !== nextBudgetLimitCredits
    ) {
      Object.assign(project, {
        ownerType: nextOwnerType,
        ownerId: nextOwnerId,
        billingWalletType: nextBillingWalletType,
        billingPolicy: nextBillingPolicy,
        budgetLimitCredits: nextBudgetLimitCredits,
        budgetUsedCredits: nextBudgetUsedCredits,
        budgetCredits: nextBudgetLimitCredits,
        createdBy: nextCreatedBy,
      });
      changed = true;
    }
  }

  for (const task of this.state.tasks || []) {
    const nextActionCode = task.actionCode || this.mapTaskTypeToActionCode(task.type);
    const nextBillingStatus =
      task.billingStatus || (Number(task.quotedCredits || 0) > 0 ? "frozen" : "unbilled");

    if (
      task.actorId !== (task.actorId || "user_demo_001") ||
      task.actionCode !== nextActionCode ||
      task.quotedCredits == null ||
      task.frozenCredits == null ||
      task.settledCredits == null ||
      task.billingStatus !== nextBillingStatus
    ) {
      Object.assign(task, {
        actorId: task.actorId || "user_demo_001",
        actionCode: nextActionCode,
        walletId: task.walletId || null,
        quotedCredits: Number(task.quotedCredits || 0),
        frozenCredits: Number(task.frozenCredits || 0),
        settledCredits: Number(task.settledCredits || 0),
        billingStatus: nextBillingStatus,
      });
      changed = true;
    }
  }

  return changed;
};

MockStore.prototype.getVisibleWalletsForActor = function getVisibleWalletsForActor(actorId) {
  const actor = this.resolveActor(actorId);

  if (actor.platformRole === "super_admin") {
    return [...(this.state.wallets || [])];
  }

  if (actor.platformRole !== "customer") {
    return [];
  }

  const visibleWallets = [];
  const personalWallet = this.getWalletByOwner("user", actor.id);
  if (personalWallet) visibleWallets.push(personalWallet);

  for (const membership of this.listMembershipsForUser(actor.id)) {
    const organizationWallet = this.getWalletByOwner("organization", membership.organizationId);
    if (organizationWallet) {
      visibleWallets.push(organizationWallet);
    }
  }

  return visibleWallets;
};

MockStore.prototype.getPrimaryWalletForActor = function getPrimaryWalletForActor(actorId) {
  const actor = this.resolveActor(actorId);
  if (actor.platformRole === "customer" && actor.defaultOrganizationId) {
    const organizationWallet = this.getWalletByOwner("organization", actor.defaultOrganizationId);
    if (organizationWallet) return organizationWallet;
  }

  if (actor.platformRole === "customer") {
    return this.getWalletByOwner("user", actor.id) || null;
  }

  if (actor.platformRole === "super_admin") {
    return this.state.wallets?.[0] || null;
  }

  return null;
};

MockStore.prototype.syncLegacyWalletState = function syncLegacyWalletState() {
  const actorId = this.state.defaultActorId;
  const actor = this.resolveActor(actorId);
  const nextWallet =
    actor.platformRole === "super_admin"
      ? clone(this.getSuperAdminPublicWallet(actor))
      : this.toPublicWallet(this.getPrimaryWalletForActor(actorId));
  if (JSON.stringify(this.state.wallet || null) !== JSON.stringify(nextWallet)) {
    this.state.wallet = nextWallet;
    return true;
  }
  return false;
};

MockStore.prototype.updateMe = function updateMe(actorId, updates) {
  const actor = this.resolveActor(actorId);
  if (updates.displayName !== undefined) {
    actor.displayName = String(updates.displayName).trim() || actor.displayName;
  }
  if (updates.avatar !== undefined) {
    actor.avatar = updates.avatar ? String(updates.avatar).trim() : null;
  }
  actor.updatedAt = new Date().toISOString();
  return this.getPermissionContext(actorId);
};

MockStore.prototype.getPermissionContext = function getPermissionContext(actorId) {
  const actor = this.resolveActor(actorId);
  const memberships = actor.platformRole === "customer" ? this.listMembershipsForUser(actor.id) : [];
  const organizations = memberships
    .map((membership) => {
      const organization = this.getOrganizationById(membership.organizationId);
      if (!organization) return null;
      return {
        id: organization.id,
        name: organization.name,
        role: membership.role === "admin" ? "enterprise_admin" : "enterprise_member",
        membershipRole: membership.role,
        status: organization.status,
        assetLibraryStatus: organization.assetLibraryStatus || "pending_review",
      };
    })
    .filter(Boolean);
  const currentOrganization =
    organizations.find((item) => item.id === actor.defaultOrganizationId) || organizations[0] || null;

  return clone({
    actor: {
      id: actor.id,
      displayName: actor.displayName,
      email: actor.email || null,
      phone: actor.phone || null,
      avatar: actor.avatar || null,
      platformRole: actor.platformRole,
      status: actor.status || "active",
      defaultOrganizationId: actor.defaultOrganizationId || null,
    },
    platformRole: actor.platformRole,
    organizations,
    currentOrganizationId: currentOrganization?.id || null,
    currentOrganizationRole: currentOrganization?.role || null,
    permissions: {
      canCreateProject: actor.platformRole === "customer" || actor.platformRole === "super_admin",
      canRecharge: actor.platformRole === "customer",
      canUseEnterprise: organizations.length > 0,
      canManageOrganization: currentOrganization?.role === "enterprise_admin",
      canManageOps: actor.platformRole === "ops_admin" || actor.platformRole === "super_admin",
      canManageSystem: actor.platformRole === "super_admin",
    },
  });
};

MockStore.prototype.assertPlatformAdmin = function assertPlatformAdmin(actorId) {
  const actor = this.resolveActor(actorId);
  if (actor.platformRole === "ops_admin" || actor.platformRole === "super_admin") {
    return actor;
  }
  throw apiError(403, "FORBIDDEN", "This endpoint requires platform admin access.");
};

MockStore.prototype.assertOrganizationAccess = function assertOrganizationAccess(
  organizationId,
  actorId,
  options = {}
) {
  const actor = this.resolveActor(actorId);
  const organization = this.getOrganizationById(organizationId);
  if (!organization) {
    throw apiError(404, "NOT_FOUND", "organization not found");
  }

  if (actor.platformRole === "super_admin") {
    return { actor, organization, membership: null };
  }

  if (actor.platformRole !== "customer") {
    throw apiError(403, "FORBIDDEN", "You do not have access to this organization.");
  }

  const membership = this.getMembership(actor.id, organizationId);
  if (!membership) {
    throw apiError(403, "FORBIDDEN", "You do not belong to this organization.");
  }

  if (options.requireAdmin && membership.role !== "admin") {
    throw apiError(403, "FORBIDDEN", "Organization admin permission is required.");
  }

  return { actor, organization, membership };
};

MockStore.prototype.assertWalletAccess = function assertWalletAccess(walletId, actorId) {
  const actor = this.resolveActor(actorId);
  if (actor.platformRole === "super_admin" && walletId === "wallet_super_unlimited") {
    return this.getSuperAdminPublicWallet(actor);
  }

  const wallet = this.getWalletById(walletId);
  if (!wallet) {
    throw apiError(404, "NOT_FOUND", "wallet not found");
  }

  if (actor.platformRole === "super_admin") {
    return wallet;
  }

  if (actor.platformRole !== "customer") {
    throw apiError(403, "FORBIDDEN", "You do not have access to this wallet.");
  }

  if (wallet.ownerType === "user" && wallet.ownerId === actor.id) {
    return wallet;
  }

  if (wallet.ownerType === "organization" && this.getMembership(actor.id, wallet.ownerId)) {
    return wallet;
  }

  throw apiError(403, "FORBIDDEN", "You do not have access to this wallet.");
};

MockStore.prototype.assertProjectAccess = function assertProjectAccess(projectId, actorId, options = {}) {
  const project = this.state.projects.find((item) => item.id === projectId);
  if (!project) {
    throw apiError(404, "NOT_FOUND", "project not found");
  }

  const actor = this.resolveActor(actorId);
  if (actor.platformRole === "super_admin") {
    return project;
  }

  if (actor.platformRole !== "customer") {
    throw apiError(403, "FORBIDDEN", "You do not have access to this project.");
  }

  if (project.ownerType === "organization") {
    const membership = this.getMembership(actor.id, project.organizationId || project.ownerId);
    if (!membership) {
      throw apiError(403, "FORBIDDEN", "You do not belong to the project organization.");
    }

    if (options.requireOrgAdmin && membership.role !== "admin") {
      throw apiError(403, "FORBIDDEN", "Organization admin permission is required.");
    }

    return project;
  }

  if (project.ownerId !== actor.id && project.createdBy !== actor.id) {
    throw apiError(403, "FORBIDDEN", "You do not own this project.");
  }

  return project;
};

MockStore.prototype.getPricingRule = function getPricingRule(actionCode) {
  return (this.state.pricingRules || []).find((item) => item.actionCode === actionCode) || null;
};

MockStore.prototype.estimateActionCredits = function estimateActionCredits(actionCode, input = {}) {
  const rule = this.getPricingRule(actionCode);
  if (!rule) {
    return { credits: 0, quantity: 1, rule: null };
  }

  let quantity = 1;
  let credits = Number(rule.baseCredits || 0);

  if (
    actionCode === "asset_image_generate" ||
    actionCode === "storyboard_image_generate" ||
    actionCode === "create_image_generate"
  ) {
    quantity = Math.max(1, Number(input.count || 1));
    credits = Number(rule.baseCredits || 0) * quantity;
  } else if (actionCode === "video_generate") {
    quantity = Math.max(1, Number(input.shotCount || 1));
    credits = Number(rule.baseCredits || 0) * quantity;
  } else if (actionCode === "dubbing_generate") {
    const textLength = String(input.text || "").trim().length;
    quantity = Math.max(1, Math.ceil((textLength || 1) / 90));
    credits = Number(rule.baseCredits || 0) + Math.max(0, quantity - 1) * 3;
  } else if (actionCode === "storyboard_auto_generate") {
    const textLength = String(input.sourceText || "").trim().length;
    quantity = Math.max(1, Math.ceil((textLength || 1) / 500));
    credits = Number(rule.baseCredits || 0) + Math.max(0, quantity - 1) * 2;
  }

  return {
    credits: Math.max(0, Math.round(credits)),
    quantity,
    rule,
  };
};

MockStore.prototype.resolveBillingWalletForProject = function resolveBillingWalletForProject(
  project,
  actorId,
  credits = 0
) {
  const actor = this.resolveActor(actorId);
  if (actor.platformRole !== "customer") {
    return null;
  }

  const personalWallet = this.getWalletByOwner("user", actor.id);
  if (!project) {
    return personalWallet;
  }

  if (project.ownerType !== "organization") {
    return personalWallet;
  }

  const organizationWallet = this.getWalletByOwner("organization", project.organizationId || project.ownerId);
  const policy =
    project.billingPolicy ||
    (project.billingWalletType === "organization" ? "organization_only" : "personal_only");

  if (policy === "personal_only") {
    return personalWallet;
  }

  if (policy === "organization_first_fallback_personal") {
    if (organizationWallet && Number(organizationWallet.availableCredits || 0) >= Number(credits || 0)) {
      return organizationWallet;
    }
    return personalWallet || organizationWallet;
  }

  return organizationWallet;
};

MockStore.prototype.buildCreditQuote = function buildCreditQuote({
  projectId = null,
  actionCode,
  input = {},
  actorId,
}) {
  const actor = this.resolveActor(actorId);
  const project = projectId ? this.assertProjectAccess(projectId, actor.id) : null;
  const { credits, quantity, rule } = this.estimateActionCredits(actionCode, input);
  const wallet = this.resolveBillingWalletForProject(project, actor.id, credits);
  const budgetLimitCredits = project ? Number(project.budgetLimitCredits || 0) : null;
  const budgetUsedCredits = project ? Number(project.budgetUsedCredits || 0) : 0;
  const budgetRemainingCredits =
    budgetLimitCredits != null ? Math.max(0, budgetLimitCredits - budgetUsedCredits) : null;

  let reason = null;
  if (!wallet && credits > 0) {
    reason = "No available wallet for this action.";
  } else if (
    project &&
    budgetLimitCredits != null &&
    budgetLimitCredits > 0 &&
    budgetUsedCredits + credits > budgetLimitCredits
  ) {
    reason = "Project budget limit would be exceeded.";
  } else if (wallet && Number(wallet.availableCredits || 0) < credits) {
    reason = "Insufficient credits.";
  }

  return clone({
    actionCode,
    label: rule?.label || actionCode,
    description: rule?.description || "",
    credits,
    quantity,
    currency: "credits",
    walletId: wallet?.id || null,
    walletName: wallet?.displayName || null,
    walletOwnerType: wallet?.ownerType || null,
    availableCredits: Number(wallet?.availableCredits || 0),
    frozenCredits: Number(wallet?.frozenCredits || 0),
    billingPolicy: project?.billingPolicy || "personal_only",
    projectId,
    projectOwnerType: project?.ownerType || null,
    budgetLimitCredits,
    budgetUsedCredits,
    budgetRemainingCredits,
    canAfford: !reason,
    reason,
  });
};

MockStore.prototype.getProjectCreditQuote = function getProjectCreditQuote(
  projectId,
  actionCode,
  input = {},
  actorId
) {
  return this.buildCreditQuote({ projectId, actionCode, input, actorId });
};

MockStore.prototype.calculateSettledCredits = function calculateSettledCredits(task) {
  const quotedCredits = Number(task?.quotedCredits || 0);
  if (quotedCredits <= 0) return 0;

  if (task?.actionCode === "storyboard_auto_generate") {
    return Math.max(quotedCredits - 2, 1);
  }

  if (task?.actionCode === "dubbing_generate") {
    return Math.max(quotedCredits - 1, 1);
  }

  return quotedCredits;
};

MockStore.prototype.recordWalletEntry = function recordWalletEntry({
  wallet,
  entryType,
  amount,
  sourceType,
  sourceId,
  projectId = null,
  orderId = null,
  createdBy = null,
  metadata = {},
}) {
  const entry = {
    id: `ledger_${randomUUID().slice(0, 10)}`,
    walletId: wallet.id,
    entryType,
    amount,
    balanceAfter: Number(wallet.availableCredits || 0),
    frozenBalanceAfter: Number(wallet.frozenCredits || 0),
    sourceType,
    sourceId,
    projectId,
    orderId,
    createdBy,
    metadata,
    createdAt: new Date().toISOString(),
  };

  this.state.walletLedgerEntries.unshift(entry);
  return entry;
};

MockStore.prototype.freezeWalletCredits = function freezeWalletCredits({
  walletId,
  credits,
  sourceType,
  sourceId,
  projectId = null,
  createdBy = null,
  metadata = {},
}) {
  const wallet = this.getWalletById(walletId);
  if (!wallet) {
    throw apiError(404, "NOT_FOUND", "wallet not found");
  }

  if (!wallet.allowNegative && Number(wallet.availableCredits || 0) < Number(credits || 0)) {
    throw apiError(409, "INSUFFICIENT_CREDITS", "Wallet balance is insufficient.");
  }

  wallet.availableCredits = Number(wallet.availableCredits || 0) - Number(credits || 0);
  wallet.frozenCredits = Number(wallet.frozenCredits || 0) + Number(credits || 0);
  wallet.updatedAt = new Date().toISOString();

  this.recordWalletEntry({
    wallet,
    entryType: "freeze",
    amount: -Number(credits || 0),
    sourceType,
    sourceId,
    projectId,
    createdBy,
    metadata,
  });
};

MockStore.prototype.settleTaskBilling = function settleTaskBilling(taskId, actualCredits) {
  const task = this.state.tasks.find((item) => item.id === taskId);
  if (!task || !task.walletId || Number(task.frozenCredits || 0) <= 0) {
    return;
  }

  const wallet = this.getWalletById(task.walletId);
  if (!wallet) return;

  const quotedCredits = Number(task.frozenCredits || task.quotedCredits || 0);
  const settledCredits = Math.max(0, Number(actualCredits || 0));
  const refundCredits = Math.max(0, quotedCredits - settledCredits);
  const extraCredits = Math.max(0, settledCredits - quotedCredits);

  if (extraCredits > 0) {
    if (!wallet.allowNegative && Number(wallet.availableCredits || 0) < extraCredits) {
      throw apiError(409, "INSUFFICIENT_CREDITS", "Wallet balance is insufficient for settlement.");
    }
    wallet.availableCredits = Number(wallet.availableCredits || 0) - extraCredits;
  }

  wallet.frozenCredits = Math.max(0, Number(wallet.frozenCredits || 0) - quotedCredits);
  wallet.updatedAt = new Date().toISOString();

  this.recordWalletEntry({
    wallet,
    entryType: "settle",
    amount: -settledCredits,
    sourceType: "task",
    sourceId: task.id,
    projectId: task.projectId || null,
    createdBy: task.actorId || null,
    metadata: {
      actionCode: task.actionCode,
      quotedCredits,
      settledCredits,
    },
  });

  if (refundCredits > 0) {
    wallet.availableCredits = Number(wallet.availableCredits || 0) + refundCredits;
    wallet.updatedAt = new Date().toISOString();
    this.recordWalletEntry({
      wallet,
      entryType: "refund",
      amount: refundCredits,
      sourceType: "task",
      sourceId: task.id,
      projectId: task.projectId || null,
      createdBy: task.actorId || null,
      metadata: {
        actionCode: task.actionCode,
        refundCredits,
      },
    });
  }

  task.settledCredits = settledCredits;
  task.frozenCredits = 0;
  task.billingStatus = refundCredits > 0 ? "settled_with_refund" : "settled";

  if (task.projectId) {
    const project = this.state.projects.find((item) => item.id === task.projectId);
    if (project) {
      project.budgetUsedCredits = Number(project.budgetUsedCredits || 0) + settledCredits;
      project.updatedAt = new Date().toISOString();
    }
  }
};

MockStore.prototype.refundTaskBilling = function refundTaskBilling(taskId, reason = "Task failed") {
  const task = this.state.tasks.find((item) => item.id === taskId);
  if (!task || !task.walletId || Number(task.frozenCredits || 0) <= 0) {
    return;
  }

  const wallet = this.getWalletById(task.walletId);
  if (!wallet) return;

  const refundCredits = Number(task.frozenCredits || 0);
  wallet.availableCredits = Number(wallet.availableCredits || 0) + refundCredits;
  wallet.frozenCredits = Math.max(0, Number(wallet.frozenCredits || 0) - refundCredits);
  wallet.updatedAt = new Date().toISOString();

  this.recordWalletEntry({
    wallet,
    entryType: "refund",
    amount: refundCredits,
    sourceType: "task",
    sourceId: task.id,
    projectId: task.projectId || null,
    createdBy: task.actorId || null,
    metadata: {
      actionCode: task.actionCode,
      reason,
    },
  });

  task.settledCredits = 0;
  task.frozenCredits = 0;
  task.billingStatus = "refunded";
};

MockStore.prototype.listWallets = function listWallets(actorId) {
  const actor = this.resolveActor(actorId);
  if (actor.platformRole === "super_admin") {
    return [clone(this.getSuperAdminPublicWallet(actor))];
  }
  return this.getVisibleWalletsForActor(actorId).map((wallet) => this.toPublicWallet(wallet));
};

MockStore.prototype.listWalletLedger = function listWalletLedger(walletId, actorId) {
  const actor = this.resolveActor(actorId);
  if (walletId === "wallet_super_unlimited" && actor.platformRole === "super_admin") {
    return [];
  }
  this.assertWalletAccess(walletId, actorId);
  return (this.state.walletLedgerEntries || [])
    .filter((item) => item.walletId === walletId)
    .map((entry) => this.toPublicLedgerEntry(entry));
};

MockStore.prototype.assertApiCenterAccess = function assertApiCenterAccess(actorId) {
  const actor = this.resolveActor(actorId);
  if (actor.platformRole === "guest") {
    throw apiError(403, "FORBIDDEN", "Please sign in before configuring API providers.");
  }
  return actor;
};

MockStore.prototype.requireApiCenterConfig = function requireApiCenterConfig() {
  if (!this.state.apiCenterConfig) {
    throw apiError(404, "NOT_FOUND", "API center configuration is not initialized.");
  }
  return this.state.apiCenterConfig;
};

MockStore.prototype.requireApiCenterVendor = function requireApiCenterVendor(vendorId) {
  const config = this.requireApiCenterConfig();
  const vendor = (config.vendors || []).find((item) => item.id === vendorId);
  if (!vendor) {
    throw apiError(404, "NOT_FOUND", "API provider not found.");
  }
  return vendor;
};

MockStore.prototype.requireApiCenterVendorModel = function requireApiCenterVendorModel(vendorId, modelId) {
  const vendor = this.requireApiCenterVendor(vendorId);
  const model = (vendor.models || []).find((item) => item.id === modelId);
  if (!model) {
    throw apiError(404, "NOT_FOUND", "Provider model not found.");
  }
  return { vendor, model };
};

MockStore.prototype.getApiCenterConfig = function getApiCenterConfig(actorId) {
  this.assertApiCenterAccess(actorId);
  const config = this.requireApiCenterConfig();
  syncApiCenterRuntimeVendorState(config);
  return clone(config);
};

MockStore.prototype.saveApiCenterVendorApiKey = function saveApiCenterVendorApiKey(
  vendorId,
  apiKey,
  actorId
) {
  this.assertApiCenterAccess(actorId);
  const vendor = this.requireApiCenterVendor(vendorId);

  if (!isApiCenterRuntimeProvider(vendor.id)) {
    throw apiError(422, "PROVIDER_NOT_SUPPORTED", "This provider is not wired to the runtime yet.");
  }

  const normalizedApiKey = String(apiKey || "").trim();
  if (normalizedApiKey) {
    setEnvValue("YUNWU_API_KEY", normalizedApiKey);
    setEnvValue("YUNWU_BASE_URL", "https://yunwu.ai");
  } else {
    unsetEnvValue("YUNWU_API_KEY");
  }

  vendor.connected = false;
  vendor.apiKeyConfigured = Boolean(normalizedApiKey);
  vendor.lastCheckedAt = null;
  vendor.testedAt = null;
  syncApiCenterRuntimeVendorState(this.requireApiCenterConfig());

  return clone(vendor);
};

MockStore.prototype.testApiCenterVendorConnection = async function testApiCenterVendorConnection(
  vendorId,
  actorId
) {
  this.assertApiCenterAccess(actorId);
  const vendor = this.requireApiCenterVendor(vendorId);

  if (!isApiCenterRuntimeProvider(vendor.id)) {
    throw apiError(422, "PROVIDER_NOT_SUPPORTED", "This provider is not wired to the runtime yet.");
  }

  const apiKeyConfigured = hasAliyunApiKey() || hasYunwuApiKey();
  if (!apiKeyConfigured) {
    throw apiError(503, "PROVIDER_NOT_CONFIGURED", "YUNWU_API_KEY is not configured.");
  }

  let checkedAt = new Date().toISOString();
  let modelCount = Array.isArray(vendor.models)
    ? vendor.models.filter((model) => model?.enabled !== false).length
    : 0;
  const result = await testAliyunConnection();
  checkedAt = result?.checkedAt || checkedAt;
  modelCount = Number(result?.modelCount || modelCount);

  vendor.apiKeyConfigured = apiKeyConfigured;
  vendor.connected = true;
  vendor.lastCheckedAt = checkedAt;
  vendor.testedAt = checkedAt;

  return clone({
    vendor,
    checkedAt,
    modelCount,
  });
};

MockStore.prototype.updateApiVendorModel = function updateApiVendorModel(
  vendorId,
  modelId,
  patch,
  actorId
) {
  this.assertApiCenterAccess(actorId);
  const config = this.requireApiCenterConfig();
  const { model } = this.requireApiCenterVendorModel(vendorId, modelId);
  const nextEnabled =
    typeof patch?.enabled === "boolean" ? patch.enabled : Boolean(model.enabled);

  if (nextEnabled !== model.enabled && !nextEnabled && isApiCenterModelReferenced(config, model.id)) {
    throw apiError(
      409,
      "MODEL_IN_USE",
      "This model is still referenced by the current defaults or pipeline assignments."
    );
  }

  model.enabled = nextEnabled;
  return clone(model);
};

MockStore.prototype.updateApiCenterDefaults = function updateApiCenterDefaults(input, actorId) {
  this.assertApiCenterAccess(actorId);
  const config = this.requireApiCenterConfig();
  const nextDefaults = { ...(config.defaults || {}) };
  const enabledModels = (config.vendors || [])
    .flatMap((vendor) => vendor.models || [])
    .filter((model) => model?.enabled);
  const enabledModelIds = new Set(enabledModels.map((model) => model.id));
  let changed = false;

  for (const [key, assignmentCodes] of Object.entries(API_CENTER_MODEL_ASSIGNMENT_MAP)) {
    if (!(key in (input || {}))) {
      continue;
    }

    const requestedModelId = String(input[key] || "").trim();
    if (!requestedModelId) {
      throw apiError(400, "BAD_REQUEST", `${key} is required.`);
    }

    if (!enabledModelIds.has(requestedModelId)) {
      throw apiError(
        400,
        "MODEL_NOT_AVAILABLE",
        `${requestedModelId} is not enabled in the current provider pool.`
      );
    }

    const expectedDomain = API_CENTER_DEFAULT_DOMAIN_MAP[key] || null;
    const targetModel = enabledModels.find((model) => model.id === requestedModelId) || null;
    if (expectedDomain && targetModel?.domain !== expectedDomain) {
      throw apiError(
        400,
        "MODEL_DOMAIN_MISMATCH",
        `${requestedModelId} does not match the ${expectedDomain} slot.`
      );
    }

    if (nextDefaults[key] !== requestedModelId) {
      nextDefaults[key] = requestedModelId;
      changed = true;
    }

    if (assignmentCodes.length && applyPrimaryModelToAssignments(config, assignmentCodes, requestedModelId)) {
      changed = true;
    }
  }

  if (changed) {
    config.defaults = nextDefaults;
    this.normalizeState();
  }

  return clone(config.defaults);
};

MockStore.prototype.listPricingRules = function listPricingRules(actorId) {
  this.assertPlatformAdmin(actorId);
  return clone(this.state.pricingRules || []);
};

MockStore.prototype.listAdminOrders = function listAdminOrders(actorId) {
  this.assertPlatformAdmin(actorId);
  return clone(
    (this.state.walletRechargeOrders || []).map((order) => ({
      ...order,
      wallet: this.toPublicWallet(this.getWalletById(order.walletId)),
    }))
  );
};

MockStore.prototype.listOrganizationMembers = function listOrganizationMembers(organizationId, actorId) {
  const { actor, membership } = this.assertOrganizationAccess(organizationId, actorId);
  const isAdminView = actor.platformRole === "super_admin" || membership?.role === "admin";

  return clone(
    (this.state.organizationMemberships || [])
      .filter((item) => item.organizationId === organizationId && item.status !== "disabled")
      .map((item) =>
        this.toPublicOrganizationMember(item, {
          includeUsage: isAdminView || item.userId === actor.id,
        })
      )
  );
};

MockStore.prototype.getOrganizationWallet = function getOrganizationWallet(organizationId, actorId) {
  this.assertOrganizationAccess(organizationId, actorId);
  return this.toPublicWallet(this.getWalletByOwner("organization", organizationId));
};

MockStore.prototype.getWalletRechargeOrder = function getWalletRechargeOrder(orderId, actorId) {
  const order = (this.state.walletRechargeOrders || []).find((item) => item.id === orderId);
  if (!order) return null;

  const actor = this.resolveActor(actorId || order.actorId);
  if (actor.platformRole !== "super_admin") {
    this.assertWalletAccess(order.walletId, actor.id);
  }

  return clone(order);
};

MockStore.prototype.listEnterpriseApplications = function listEnterpriseApplications(actorId) {
  this.assertPlatformAdmin(actorId);
  return clone(this.state.enterpriseApplications || []);
};

MockStore.prototype.getSuperAdminPublicWallet = function getSuperAdminPublicWallet(actor) {
  if (!actor || actor.platformRole !== "super_admin") {
    return null;
  }
  const ts = new Date().toISOString();
  return {
    id: "wallet_super_unlimited",
    ownerType: "platform",
    walletOwnerType: "platform",
    ownerId: actor.id,
    displayName: "超级管理员 · 无限额度",
    availableCredits: Number.MAX_SAFE_INTEGER,
    frozenCredits: 0,
    creditsAvailable: Number.MAX_SAFE_INTEGER,
    creditsFrozen: 0,
    currency: "credits",
    status: "active",
    allowNegative: true,
    unlimitedCredits: true,
    updatedAt: ts,
  };
};

MockStore.prototype.getWallet = function getWallet(actorId) {
  const actor = this.resolveActor(actorId);
  if (actor.platformRole === "super_admin") {
    return clone(this.getSuperAdminPublicWallet(actor));
  }
  return this.toPublicWallet(this.getPrimaryWalletForActor(actorId));
};

MockStore.prototype.registerPersonalUser = function registerPersonalUser(input = {}) {
  const displayName = requireText(input.displayName, "displayName", "displayName");
  const email = normalizeEmail(requireText(input.email, "email", "email"));
  const password = requireText(input.password, "password", "password");

  if (this.findUserByEmail(email)) {
    throw apiError(409, "EMAIL_ALREADY_EXISTS", "This email is already registered.");
  }

  const now = new Date().toISOString();
  const user = {
    id: `user_${randomUUID().slice(0, 8)}`,
    displayName,
    email,
    phone: normalizePhone(input.phone),
    passwordHash: hashPassword(password),
    platformRole: "customer",
    status: "active",
    defaultOrganizationId: null,
    createdAt: now,
    updatedAt: now,
  };

  this.state.users.unshift(user);
  const personalWallet = this.ensureWalletForOwner("user", user.id, {
    displayName: `${displayName}的钱包`,
    availableCredits: 5000,
    createdBy: "root_demo_001",
    registration: true,
    updatedAt: now,
  });
  this.syncLegacyWalletState();
  this.ensureDefaultProjectForActor(user.id);

  return clone({
    actorId: user.id,
    token: generateAuthToken(user.id),
    permissionContext: this.getPermissionContext(user.id),
    wallets: this.listWallets(user.id),
    wallet: this.toPublicWallet(personalWallet),
    organization: null,
    onboarding: {
      mode: "personal",
      title: "个人版账号已创建",
      detail: "已为新账号开通个人钱包和个人创作权限。",
      tempPassword: null,
    },
  });
};

MockStore.prototype.registerEnterpriseAdmin = function registerEnterpriseAdmin(input = {}) {
  const companyName = requireText(input.companyName, "companyName", "companyName");
  const adminName = requireText(input.adminName || input.displayName, "adminName", "adminName");
  const email = normalizeEmail(requireText(input.email, "email", "email"));
  const password = requireText(input.password, "password", "password");

  if (this.findUserByEmail(email)) {
    throw apiError(409, "EMAIL_ALREADY_EXISTS", "This email is already registered.");
  }

  const now = new Date().toISOString();
  const organization = {
    id: `org_${randomUUID().slice(0, 8)}`,
    name: companyName,
    status: "active",
    assetLibraryStatus: "pending_review",
    defaultBillingPolicy: "organization_only",
    licenseNo: String(input.licenseNo || "").trim() || null,
    industry: String(input.industry || "").trim() || null,
    teamSize: String(input.teamSize || "").trim() || null,
    createdAt: now,
    updatedAt: now,
  };

  const user = {
    id: `user_${randomUUID().slice(0, 8)}`,
    displayName: adminName,
    email,
    phone: normalizePhone(input.phone),
    passwordHash: hashPassword(password),
    platformRole: "customer",
    status: "active",
    defaultOrganizationId: organization.id,
    createdAt: now,
    updatedAt: now,
  };

  const membership = {
    id: `membership_${randomUUID().slice(0, 8)}`,
    organizationId: organization.id,
    userId: user.id,
    role: "admin",
    status: "active",
    department: "管理层",
    canUseOrganizationWallet: true,
    createdAt: now,
    updatedAt: now,
  };

  this.state.organizations.unshift(organization);
  this.state.users.unshift(user);
  this.state.organizationMemberships.unshift(membership);
  const organizationWallet = this.ensureWalletForOwner("organization", organization.id, {
    displayName: `${companyName}企业钱包`,
    availableCredits: 10000,
    createdBy: "root_demo_001",
    registration: true,
    updatedAt: now,
  });
  this.ensureWalletForOwner("user", user.id, {
    displayName: `${adminName}的钱包`,
    availableCredits: 5000,
    createdBy: "root_demo_001",
    registration: true,
    updatedAt: now,
  });

  if (!Array.isArray(this.state.enterpriseApplications)) {
    this.state.enterpriseApplications = [];
  }
  this.state.enterpriseApplications.unshift({
    id: `ent_app_${randomUUID().slice(0, 8)}`,
    companyName,
    contactName: adminName,
    contactPhone: user.phone,
    status: "submitted",
    createdAt: now,
    source: "enterprise_register",
  });

  this.syncLegacyWalletState();
  this.ensureDefaultProjectForActor(user.id);

  return clone({
    actorId: user.id,
    token: generateAuthToken(user.id),
    permissionContext: this.getPermissionContext(user.id),
    wallets: this.listWallets(user.id),
    wallet: this.toPublicWallet(organizationWallet),
    organization: {
      id: organization.id,
      name: organization.name,
      status: organization.status,
      assetLibraryStatus: organization.assetLibraryStatus,
    },
    onboarding: {
      mode: "enterprise_admin",
      title: "企业管理员账号已创建",
      detail: "企业组织、企业钱包和管理员身份已同步开通，企业资产库审批状态为待审核。",
      tempPassword: null,
    },
  });
};

MockStore.prototype.createOrganizationMember = function createOrganizationMember(
  organizationId,
  input = {},
  actorId
) {
  const { actor, organization } = this.assertOrganizationAccess(organizationId, actorId, {
    requireAdmin: true,
  });
  const displayName = requireText(input.displayName, "displayName", "displayName");
  const email = normalizeEmail(requireText(input.email, "email", "email"));
  const membershipRole = input.membershipRole === "admin" ? "admin" : "member";
  const department = String(input.department || "").trim();
  const requestedPassword = String(input.password || "").trim();
  const tempPassword = requestedPassword || buildTempPassword();
  const now = new Date().toISOString();

  let user = this.findUserByEmail(email);
  let isNewUser = false;
  if (user && user.platformRole !== "customer") {
    throw apiError(
      409,
      "ACCOUNT_ROLE_CONFLICT",
      "This email is already bound to a platform admin account and cannot join the organization."
    );
  }

  if (!user) {
    user = {
      id: `user_${randomUUID().slice(0, 8)}`,
      displayName,
      email,
      phone: normalizePhone(input.phone),
      passwordHash: tempPassword ? hashPassword(tempPassword) : null,
      platformRole: "customer",
      status: "active",
      defaultOrganizationId: organizationId,
      createdAt: now,
      updatedAt: now,
    };
    this.state.users.unshift(user);
    isNewUser = true;
  } else {
    if (this.getMembership(user.id, organizationId)) {
      throw apiError(409, "MEMBER_ALREADY_EXISTS", "This user already belongs to the organization.");
    }

    user.displayName = displayName || user.displayName;
    user.phone = normalizePhone(input.phone) || user.phone || null;
    user.defaultOrganizationId = user.defaultOrganizationId || organizationId;
    user.updatedAt = now;
  }

  this.ensureWalletForOwner("user", user.id, {
    displayName: `${user.displayName}的钱包`,
    availableCredits: isNewUser ? 60 : 0,
    createdBy: actor.id,
    registration: isNewUser,
    updatedAt: now,
  });

  const membership = {
    id: `membership_${randomUUID().slice(0, 8)}`,
    organizationId,
    userId: user.id,
    role: membershipRole,
    status: "active",
    department,
    canUseOrganizationWallet: input.canUseOrganizationWallet !== false,
    createdAt: now,
    updatedAt: now,
  };

  this.state.organizationMemberships.unshift(membership);
  organization.updatedAt = now;
  this.syncLegacyWalletState();
  this.ensureDefaultProjectForActor(user.id);

  return clone({
    actorId: user.id,
    member: this.toPublicOrganizationMember(membership, { includeUsage: true }),
    onboarding: {
      mode: membershipRole === "admin" ? "enterprise_admin" : "enterprise_member",
      title: membershipRole === "admin" ? "企业管理员已创建" : "企业成员已创建",
      detail: isNewUser
        ? "账号已创建并自动加入企业，已分配默认组织上下文。"
        : "已将现有个人账号加入当前企业组织。",
      tempPassword,
      generatedPassword: !requestedPassword,
    },
  });
};

MockStore.prototype.createWalletRechargeOrder = function createWalletRechargeOrder(input, actorId) {
  const actor = this.resolveActor(actorId || input?.actorId);
  if (actor.platformRole !== "customer") {
    throw apiError(403, "FORBIDDEN", "Only customer accounts can create recharge orders.");
  }

  const targetWallet =
    (input.walletId ? this.assertWalletAccess(input.walletId, actor.id) : null) ||
    this.getPrimaryWalletForActor(actor.id);
  if (!targetWallet) {
    throw apiError(404, "NOT_FOUND", "target wallet not found");
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000);
  const order = {
    id: `recharge_${randomUUID().slice(0, 8)}`,
    planId: String(input.planId || "custom"),
    planName: String(input.planName || "Wallet Recharge"),
    billingCycle: String(input.billingCycle || "oneTime"),
    paymentMethod: String(input.paymentMethod || "wechat_pay"),
    amount: Number(input.amount || 0),
    credits: Number(input.credits || 0),
    currency: "CNY",
    status: "pending",
    actorId: actor.id,
    walletId: targetWallet.id,
    walletOwnerType: targetWallet.ownerType,
    walletOwnerId: targetWallet.ownerId,
    payerType: targetWallet.ownerType,
    qrCodePayload: `weixin://wxpay/bizpayurl/mock-${randomUUID().slice(0, 12)}`,
    qrCodeHint: "Use WeChat to scan and complete payment.",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  if (!Array.isArray(this.state.walletRechargeOrders)) {
    this.state.walletRechargeOrders = [];
  }

  this.state.walletRechargeOrders.unshift(order);
  return clone(order);
};

MockStore.prototype.confirmWalletRechargeOrder = function confirmWalletRechargeOrder(orderId, actorId) {
  const order = (this.state.walletRechargeOrders || []).find((item) => item.id === orderId);
  if (!order) return null;

  const actor = this.resolveActor(actorId || order.actorId);
  const wallet = this.assertWalletAccess(order.walletId, actor.id);

  if (order.status !== "paid") {
    order.status = "paid";
    order.updatedAt = new Date().toISOString();
    wallet.availableCredits = Number(wallet.availableCredits || 0) + Number(order.credits || 0);
    wallet.updatedAt = order.updatedAt;
    this.recordWalletEntry({
      wallet,
      entryType: "recharge",
      amount: Number(order.credits || 0),
      sourceType: "order",
      sourceId: order.id,
      orderId: order.id,
      createdBy: actor.id,
      metadata: {
        planId: order.planId,
        planName: order.planName,
        amount: order.amount,
        paymentMethod: order.paymentMethod,
      },
    });
    this.syncLegacyWalletState();

    this.emit("wallet_recharge_paid", {
      orderId: order.id,
      amount: order.amount,
      credits: order.credits,
      paymentMethod: order.paymentMethod,
      walletId: order.walletId,
    });
  }

  return clone(order);
};

MockStore.prototype.listTasks = function listTasks(projectId, actorId) {
  const actor = this.resolveActor(actorId);
  const items = (this.state.tasks || []).filter((task) => {
    if (projectId && task.projectId !== projectId) {
      return false;
    }

    if (actor.platformRole === "super_admin") {
      return true;
    }

    if (actor.platformRole !== "customer") {
      return !task.projectId && task.actorId === actor.id;
    }

    if (!task.projectId) {
      return task.actorId === actor.id;
    }

    try {
      this.assertProjectAccess(task.projectId, actor.id);
      return true;
    } catch {
      return false;
    }
  });
  return clone(items);
};

MockStore.prototype.getTask = function getTask(taskId, actorId) {
  const task = (this.state.tasks || []).find((item) => item.id === taskId);
  if (!task) return null;

  if (task.projectId) {
    this.assertProjectAccess(task.projectId, actorId);
  } else {
    const actor = this.resolveActor(actorId);
    if (actor.platformRole !== "super_admin" && task.actorId !== actor.id) {
      throw apiError(403, "FORBIDDEN", "You do not have access to this task.");
    }
  }

  return clone(task);
};

MockStore.prototype.deleteTask = function deleteTask(taskId, actorId) {
  const task = (this.state.tasks || []).find((item) => item.id === taskId);
  if (!task) return null;

  if (task.projectId) {
    this.assertProjectAccess(task.projectId, actorId);
  } else {
    const actor = this.resolveActor(actorId);
    if (actor.platformRole !== "super_admin" && task.actorId !== actor.id) {
      throw apiError(403, "FORBIDDEN", "You do not have access to this task.");
    }
  }

  const index = this.state.tasks.findIndex((item) => item.id === taskId);
  if (index === -1) return null;
  const [removed] = this.state.tasks.splice(index, 1);
  return clone(removed);
};

MockStore.prototype.clearTasks = function clearTasks(projectId, actorId, type) {
  const actor = this.resolveActor(actorId);
  const before = this.state.tasks || [];

  this.state.tasks = before.filter((task) => {
    if (projectId && task.projectId !== projectId) {
      return true;
    }
    if (type && task.type !== type) {
      return true;
    }
    if (actor.platformRole === "super_admin") {
      return false;
    }
    if (task.projectId) {
      try {
        this.assertProjectAccess(task.projectId, actor.id);
        return false;
      } catch {
        return true;
      }
    }
    return task.actorId !== actor.id;
  });

  return { removedCount: before.length - this.state.tasks.length };
};

MockStore.prototype.createTask = function createTask(params) {
  const actorId = this.resolveActorId(params.actorId || params.metadata?.actorId);
  const actor = this.resolveActor(actorId);

  const isContentConsumer =
    actor.platformRole === "customer" || actor.platformRole === "super_admin";
  if (
    !isContentConsumer &&
    (params.projectId || params.storyboardId || params.domain === "create" || params.domain === "toolbox")
  ) {
    throw apiError(
      403,
      "FORBIDDEN",
      "Only customer or super-admin accounts can launch content tasks.",
    );
  }

  const projectId = params.projectId || this.findStoryboard(params.storyboardId)?.projectId || null;
  if (projectId) {
    this.assertProjectAccess(projectId, actor.id);
  }

  const actionCode = params.actionCode || this.mapTaskTypeToActionCode(params.type);
  const quoteInput = params.quoteInput || params.metadata || {};
  const creditQuote =
    isContentConsumer && actor.platformRole === "customer"
      ? this.buildCreditQuote({ projectId, actionCode, input: quoteInput, actorId: actor.id })
      : {
          credits: 0,
          walletId: null,
          canAfford: true,
        };

  if (Number(creditQuote.credits || 0) > 0 && !creditQuote.canAfford) {
    const code =
      typeof creditQuote.reason === "string" && creditQuote.reason.includes("budget")
        ? "PROJECT_BUDGET_EXCEEDED"
        : "INSUFFICIENT_CREDITS";
    throw apiError(409, code, creditQuote.reason || "Unable to freeze credits.");
  }

  const taskId = `task_${randomUUID().slice(0, 8)}`;

  if (Number(creditQuote.credits || 0) > 0) {
    this.freezeWalletCredits({
      walletId: creditQuote.walletId,
      credits: creditQuote.credits,
      sourceType: "task",
      sourceId: taskId,
      projectId,
      createdBy: actor.id,
      metadata: {
        actionCode,
        quote: creditQuote,
      },
    });
    this.syncLegacyWalletState();
  }

  const task = {
    id: taskId,
    type: params.type,
    domain: params.domain,
    projectId,
    storyboardId: params.storyboardId || null,
    actorId: actor.id,
    actionCode,
    walletId: creditQuote.walletId || null,
    status: "queued",
    progressPercent: 0,
    currentStage: "queued",
    etaSeconds: 90,
    inputSummary: params.inputSummary || null,
    outputSummary: null,
    quotedCredits: Number(creditQuote.credits || 0),
    frozenCredits: Number(creditQuote.credits || 0),
    settledCredits: 0,
    billingStatus: Number(creditQuote.credits || 0) > 0 ? "frozen" : "unbilled",
    metadata: {
      ...(params.metadata || {}),
      creditQuote,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  this.state.tasks.unshift(task);
  this.emit("task.created", task);
  this.scheduleTaskLifecycle(task.id, params.effect);
  return clone(task);
};

MockStore.prototype.scheduleTaskLifecycle = function scheduleTaskLifecycle(taskId, effect) {
  setTimeout(() => {
    this.updateTask(taskId, {
      status: "running",
      progressPercent: 35,
      currentStage: "processing",
      etaSeconds: 45,
    });
  }, 350);

  setTimeout(() => {
    this.updateTask(taskId, {
      status: "running",
      progressPercent: 72,
      currentStage: "rendering",
      etaSeconds: 18,
    });
  }, 900);

  setTimeout(async () => {
    try {
      let outputSummary = "mock result ready";

      if (typeof effect === "function") {
        const result = await effect(this.state);
        if (typeof result === "string" && result.trim()) {
          outputSummary = result.trim();
        }
      }

      const settledTask = this.state.tasks.find((item) => item.id === taskId);
      this.settleTaskBilling(taskId, this.calculateSettledCredits(settledTask));
      this.syncLegacyWalletState();

      const latestTask = this.state.tasks.find((item) => item.id === taskId);
      this.updateTask(taskId, {
        status: "succeeded",
        progressPercent: 100,
        currentStage: "completed",
        etaSeconds: 0,
        outputSummary,
        settledCredits: Number(latestTask?.settledCredits || 0),
        frozenCredits: Number(latestTask?.frozenCredits || 0),
        billingStatus: latestTask?.billingStatus || "settled",
      });
    } catch (error) {
      this.refundTaskBilling(taskId, error?.message || "provider call failed");
      this.syncLegacyWalletState();
      const latestTask = this.state.tasks.find((item) => item.id === taskId);
      this.updateTask(taskId, {
        status: "failed",
        progressPercent: 100,
        currentStage: "failed",
        etaSeconds: 0,
        outputSummary: error?.message || "provider call failed",
        settledCredits: Number(latestTask?.settledCredits || 0),
        frozenCredits: Number(latestTask?.frozenCredits || 0),
        billingStatus: latestTask?.billingStatus || "refunded",
      });
    }
  }, 1600);
};

MockStore.prototype.makeLipSyncTask = function makeLipSyncTask(storyboardId, input = {}) {
  const storyboard = this.findStoryboard(storyboardId);
  return this.createTask({
    type: "lipsync_generate",
    domain: "lipsync",
    projectId: storyboard?.projectId || null,
    storyboardId,
    inputSummary: "Generate lip sync",
    metadata: input,
    effect: () => {
      if (!storyboard) return;

      this.touchProject(storyboard.projectId, {
        currentStep: "dubbing",
        progressPercent: 88,
      });
    },
  });
};

function areCanvasMergeValuesEqual(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function mergeCanvasField(baseValue, localValue, remoteValue, label, options = {}) {
  const { allowDivergentAutoResolve = false, prefer = "local" } = options;
  const localChanged = !areCanvasMergeValuesEqual(baseValue, localValue);
  const remoteChanged = !areCanvasMergeValuesEqual(baseValue, remoteValue);

  if (localChanged && remoteChanged && !areCanvasMergeValuesEqual(localValue, remoteValue)) {
    if (allowDivergentAutoResolve) {
      return {
        ok: true,
        value: prefer === "remote" ? remoteValue : localValue,
      };
    }

    return {
      ok: false,
      conflict: label,
    };
  }

  if (localChanged) return { ok: true, value: localValue };
  if (remoteChanged) return { ok: true, value: remoteValue };
  return { ok: true, value: remoteValue };
}

function mergeCanvasObjectFields(baseValue, localValue, remoteValue, label) {
  const base = baseValue && typeof baseValue === "object" ? baseValue : {};
  const local = localValue && typeof localValue === "object" ? localValue : {};
  const remote = remoteValue && typeof remoteValue === "object" ? remoteValue : {};
  const keys = new Set([
    ...Object.keys(base),
    ...Object.keys(local),
    ...Object.keys(remote),
  ]);

  const merged = {};
  for (const key of keys) {
    const result = mergeCanvasField(
      base[key],
      local[key],
      remote[key],
      `${label}.${key}`,
    );
    if (!result.ok) return result;
    if (result.value !== undefined) {
      merged[key] = result.value;
    }
  }

  return { ok: true, value: merged };
}

function mergeCanvasCollection(baseItems, localItems, remoteItems, label) {
  if (!Array.isArray(baseItems) || !Array.isArray(localItems) || !Array.isArray(remoteItems)) {
    return { ok: false, conflict: label };
  }

  const toMap = (items) => {
    const map = new Map();
    for (const item of items) {
      if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id.trim()) {
        return null;
      }
      map.set(item.id, item);
    }
    return map;
  };

  const baseMap = toMap(baseItems);
  const localMap = toMap(localItems);
  const remoteMap = toMap(remoteItems);
  if (!baseMap || !localMap || !remoteMap) {
    return { ok: false, conflict: label };
  }

  const orderedIds = [];
  const seen = new Set();
  for (const item of remoteItems) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      orderedIds.push(item.id);
    }
  }
  for (const item of localItems) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      orderedIds.push(item.id);
    }
  }

  const mergedItems = [];
  for (const id of orderedIds) {
    const base = baseMap.get(id);
    const local = localMap.get(id);
    const remote = remoteMap.get(id);

    if (!base) {
      if (local && remote) {
        if (!areCanvasMergeValuesEqual(local, remote)) {
          return { ok: false, conflict: `${label}:${id}` };
        }
        mergedItems.push(local);
      } else if (local) {
        mergedItems.push(local);
      } else if (remote) {
        mergedItems.push(remote);
      }
      continue;
    }

    if (!local || !remote) {
      return { ok: false, conflict: `${label}:${id}:delete` };
    }

    if (areCanvasMergeValuesEqual(local, remote)) {
      mergedItems.push(local);
      continue;
    }

    const keys = new Set([
      ...Object.keys(base),
      ...Object.keys(local),
      ...Object.keys(remote),
    ]);

    const merged = {};
    for (const key of keys) {
      const result = mergeCanvasField(
        base[key],
        local[key],
        remote[key],
        `${label}:${id}.${key}`,
      );
      if (!result.ok) return result;
      if (result.value !== undefined) {
        merged[key] = result.value;
      }
    }

    mergedItems.push(merged);
  }

  return { ok: true, value: mergedItems };
}

function tryMergeCanvasProject(existing, input) {
  const baseTitle = typeof input.baseTitle === "string" ? input.baseTitle : existing.title;
  const baseCanvasData =
    input.baseCanvasData && typeof input.baseCanvasData === "object"
      ? input.baseCanvasData
      : null;
  const localCanvasData =
    input.canvasData && typeof input.canvasData === "object"
      ? input.canvasData
      : null;
  const remoteCanvasData =
    existing.canvasData && typeof existing.canvasData === "object"
      ? existing.canvasData
      : null;

  if (!baseCanvasData || !localCanvasData || !remoteCanvasData) {
    return {
      ok: false,
      conflict: "canvasData",
    };
  }

  const mergedTitle = mergeCanvasField(
    baseTitle,
    input.title || existing.title,
    existing.title,
    "title",
  );
  if (!mergedTitle.ok) return mergedTitle;

  const mergedViewport = mergeCanvasObjectFields(
    baseCanvasData.viewport || { x: 0, y: 0, zoom: 1 },
    localCanvasData.viewport || { x: 0, y: 0, zoom: 1 },
    remoteCanvasData.viewport || { x: 0, y: 0, zoom: 1 },
    "viewport",
  );
  if (!mergedViewport.ok) return mergedViewport;

  const mergedNodes = mergeCanvasCollection(
    Array.isArray(baseCanvasData.nodes) ? baseCanvasData.nodes : [],
    Array.isArray(localCanvasData.nodes) ? localCanvasData.nodes : [],
    Array.isArray(remoteCanvasData.nodes) ? remoteCanvasData.nodes : [],
    "nodes",
  );
  if (!mergedNodes.ok) return mergedNodes;

  const mergedGroups = mergeCanvasCollection(
    Array.isArray(baseCanvasData.groups) ? baseCanvasData.groups : [],
    Array.isArray(localCanvasData.groups) ? localCanvasData.groups : [],
    Array.isArray(remoteCanvasData.groups) ? remoteCanvasData.groups : [],
    "groups",
  );
  if (!mergedGroups.ok) return mergedGroups;

  const mergedThumbnail = mergeCanvasField(
    existing.thumbnailUrl ?? null,
    input.thumbnailUrl ?? existing.thumbnailUrl ?? null,
    existing.thumbnailUrl ?? null,
    "thumbnailUrl",
    { allowDivergentAutoResolve: true, prefer: "local" },
  );
  if (!mergedThumbnail.ok) return mergedThumbnail;

  return {
    ok: true,
    value: {
      title: mergedTitle.value || existing.title,
      thumbnailUrl: mergedThumbnail.value ?? existing.thumbnailUrl ?? null,
      canvasData: {
        nodes: mergedNodes.value,
        groups: mergedGroups.value,
        viewport: mergedViewport.value,
      },
    },
  };
}

MockStore.prototype.listCanvasProjects = function listCanvasProjects(actorId) {
  if (!this.state.canvasProjectsByActorId) {
    this.state.canvasProjectsByActorId = {};
  }
  return clone(this.state.canvasProjectsByActorId[actorId] || []);
};

MockStore.prototype.listCanvasProjectSummaries = function listCanvasProjectSummaries(actorId) {
  if (!this.state.canvasProjectsByActorId) {
    this.state.canvasProjectsByActorId = {};
  }

  const items = this.state.canvasProjectsByActorId[actorId] || [];
  return clone(
    items.map((item) => ({
      id: item.id,
      actorId: item.actorId,
      title: item.title,
      thumbnailUrl: item.thumbnailUrl,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  );
};

MockStore.prototype.getCanvasProject = function getCanvasProject(actorId, projectId) {
  const items = (this.state.canvasProjectsByActorId || {})[actorId] || [];
  const project = items.find((item) => item.id === projectId);
  return clone(project || null);
};

MockStore.prototype.saveCanvasProject = function saveCanvasProject(actorId, input) {
  if (!this.state.canvasProjectsByActorId) {
    this.state.canvasProjectsByActorId = {};
  }
  if (!this.state.canvasProjectsByActorId[actorId]) {
    this.state.canvasProjectsByActorId[actorId] = [];
  }

  const items = this.state.canvasProjectsByActorId[actorId];
  const now = new Date().toISOString();

  if (input.id) {
    const existing = items.find((item) => item.id === input.id);
    if (existing) {
      const expectedUpdatedAt =
        typeof input.expectedUpdatedAt === "string" && input.expectedUpdatedAt.trim()
          ? input.expectedUpdatedAt.trim()
          : null;
      if (expectedUpdatedAt && existing.updatedAt && existing.updatedAt !== expectedUpdatedAt) {
        const merged = tryMergeCanvasProject(existing, input);
        if (!merged.ok) {
          const reason = merged.conflict || "canvasData";
          throw apiError(
            409,
            "CONFLICT",
            `Canvas project was updated elsewhere and could not be auto-merged safely (${reason}). Please reload the latest version before saving again.`,
          );
        }

        Object.assign(existing, {
          title: merged.value.title || existing.title,
          thumbnailUrl:
            merged.value.thumbnailUrl !== undefined
              ? merged.value.thumbnailUrl
              : existing.thumbnailUrl,
          canvasData: merged.value.canvasData,
          updatedAt: now,
        });
        return clone(existing);
      }
      Object.assign(existing, {
        title: input.title || existing.title,
        thumbnailUrl: input.thumbnailUrl !== undefined ? input.thumbnailUrl : existing.thumbnailUrl,
        canvasData: input.canvasData || existing.canvasData,
        updatedAt: now,
      });
      return clone(existing);
    }
  }

  const project = {
    id: input.id || `canvas_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    actorId,
    title: input.title || "未命名画布项目",
    thumbnailUrl: input.thumbnailUrl || null,
    canvasData: input.canvasData || null,
    createdAt: now,
    updatedAt: now,
  };

  items.unshift(project);
  return clone(project);
};

MockStore.prototype.deleteCanvasProject = function deleteCanvasProject(actorId, projectId) {
  const items = (this.state.canvasProjectsByActorId || {})[actorId];
  if (!items) return false;

  const next = items.filter((item) => item.id !== projectId);
  if (next.length === items.length) return false;

  this.state.canvasProjectsByActorId[actorId] = next;
  return true;
};

module.exports = {
  MockStore,
  decodeAuthToken,
};
