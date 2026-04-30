const { EventEmitter } = require("node:events");
const { randomUUID, createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const {
  createUploadFromBuffer,
  readUploadByUrlPath,
} = require("./uploads");
const vertex = require("./vertex");
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
  isMediaGenerationModelConfigured,
  isSeedanceVideoModel,
  normalizeModelId,
  normalizeVoicePreset,
  parseAliyunVideoResult,
  parsePixverseVideoResult,
  parseSeedanceVideoResult,
  rewriteScriptWithAliyun,
  splitStoryboardsWithAliyun,
  synthesizeSpeechWithAliyun,
  testYunwuConnection,
  waitForAliyunTask,
  enhancePromptWithWebSearch,
} = require("./aliyun");
const { setEnvValue, unsetEnvValue } = require("./env");
const { createSeedData } = require("./mock-data");
const {
  calculateRechargeCredits,
  normalizeRechargeAmount,
} = require("./payments/recharge-pricing");

function clone(value) {
  return structuredClone(value);
}

function normalizePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    return structuredClone(value);
  } catch {
    return { ...value };
  }
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

function buildTaskFailurePatch(error) {
  const outputSummary =
    String(error?.userMessage || error?.message || "provider call failed").trim() ||
    "provider call failed";
  const failureReason =
    String(error?.failureReason || error?.code || error?.name || "PROVIDER_CALL_FAILED").trim() ||
    "PROVIDER_CALL_FAILED";

  const patch = {
    outputSummary,
    failureReason,
    error: outputSummary,
  };

  const providerStatusCode = Number(error?.statusCode ?? error?.status);
  if (Number.isFinite(providerStatusCode) && providerStatusCode > 0) {
    patch.providerStatusCode = providerStatusCode;
  }
  if (error?.provider) {
    patch.provider = String(error.provider);
  }
  if (error?.providerCode) {
    patch.providerCode = String(error.providerCode);
  }
  if (error?.supportCode) {
    patch.providerSupportCode = String(error.supportCode);
  }
  if (error?.providerMessage) {
    patch.providerMessage = String(error.providerMessage).slice(0, 1000);
  }

  return patch;
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

const RECHARGE_PAYMENT_METHODS = new Set(["wechat_pay", "alipay", "bank_transfer"]);
const RECHARGE_MODES = new Set(["live", "demo_mock"]);
const TERMINAL_RECHARGE_STATUSES = new Set(["paid", "failed", "expired", "closed"]);

function normalizeRechargePaymentMethod(value) {
  const normalized = String(value || "wechat_pay").trim();
  if (!RECHARGE_PAYMENT_METHODS.has(normalized)) {
    throw apiError(400, "BAD_REQUEST", `Unsupported paymentMethod: ${normalized}`);
  }
  return normalized;
}

function normalizeRechargeMode(value) {
  const normalized = String(value || "live").trim();
  if (!RECHARGE_MODES.has(normalized)) {
    throw apiError(400, "BAD_REQUEST", `Unsupported recharge mode: ${normalized}`);
  }
  return normalized;
}

function getDefaultRechargeScene(paymentMethod, mode) {
  if (mode === "demo_mock") {
    return "desktop_qr";
  }
  if (paymentMethod === "wechat_pay") {
    return "desktop_qr";
  }
  if (paymentMethod === "alipay") {
    return "pc_page";
  }
  return "bank_transfer";
}

function normalizeRechargeScene(paymentMethod, scene, mode) {
  const normalizedMethod = normalizeRechargePaymentMethod(paymentMethod);
  const normalizedMode = normalizeRechargeMode(mode);
  const resolvedScene = String(scene || getDefaultRechargeScene(normalizedMethod, normalizedMode)).trim();
  const validScenes = {
    wechat_pay: new Set(["desktop_qr", "mobile_h5"]),
    alipay: new Set(["pc_page", "mobile_wap"]),
    bank_transfer: new Set(["bank_transfer"]),
  };

  if (normalizedMode === "demo_mock") {
    return "desktop_qr";
  }

  if (!validScenes[normalizedMethod].has(resolvedScene)) {
    throw apiError(400, "BAD_REQUEST", `Unsupported scene ${resolvedScene} for ${normalizedMethod}`);
  }
  return resolvedScene;
}

function rechargeProviderFromMethod(paymentMethod, mode) {
  if (mode === "demo_mock") return "demo_mock";
  if (paymentMethod === "wechat_pay") return "wechat";
  if (paymentMethod === "alipay") return "alipay";
  return "bank_transfer";
}

function createDemoRechargeQrPayload(paymentMethod) {
  const suffix = randomUUID().slice(0, 12);
  if (paymentMethod === "alipay") {
    return `alipay://platformapi/startapp?appId=20000067&url=${encodeURIComponent(
      `https://mock.xiaolouai.cn/alipay/${suffix}`,
    )}`;
  }
  return `weixin://wxpay/bizpayurl/mock-${suffix}`;
}

function getDemoRechargeQrHint(paymentMethod) {
  if (paymentMethod === "alipay") {
    return "Demo Alipay payment only. Use the mock confirmation button to simulate success.";
  }
  return "Demo WeChat payment only. Use the mock confirmation button to simulate success.";
}

function normalizeRechargeVoucherFiles(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function cloneBankAccount(value) {
  if (!value || typeof value !== "object") return null;
  const accountName = String(value.accountName || "").trim();
  const bankName = String(value.bankName || "").trim();
  const accountNo = String(value.accountNo || "").trim();
  const branchName = String(value.branchName || "").trim();
  const remarkTemplate = String(value.remarkTemplate || "").trim();
  const instructions = String(value.instructions || "").trim();

  if (!accountName || !bankName || !accountNo) {
    return null;
  }

  return {
    accountName,
    bankName,
    accountNo,
    branchName: branchName || null,
    remarkTemplate: remarkTemplate || null,
    instructions: instructions || null,
  };
}

function maybeExpireWalletRechargeOrder(order) {
  if (!order || order.status !== "pending") return false;
  const expiresAt = Date.parse(order.expiredAt || order.expiresAt || "");
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) return false;

  const nextTs = new Date(expiresAt).toISOString();
  order.status = "expired";
  order.failureReason = order.failureReason || "Payment order expired before completion.";
  order.updatedAt = nextTs;
  order.expiredAt = nextTs;
  order.expiresAt = nextTs;
  return true;
}

function mergeWalletRechargePatch(order, patch) {
  if (!order || !patch || typeof patch !== "object") return false;

  const keys = [
    "provider",
    "scene",
    "mode",
    "status",
    "providerTradeNo",
    "codeUrl",
    "h5Url",
    "redirectUrl",
    "notifyPayload",
    "paidAt",
    "expiredAt",
    "expiresAt",
    "failureReason",
    "reviewStatus",
    "reviewedAt",
    "reviewedBy",
    "reviewNote",
    "qrCodePayload",
    "qrCodeHint",
    "transferReference",
    "transferNote",
  ];

  let changed = false;

  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    const nextValue = patch[key];
    if (nextValue === undefined) continue;
    if (order[key] !== nextValue) {
      order[key] = nextValue;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, "voucherFiles")) {
    const nextVoucherFiles = normalizeRechargeVoucherFiles(patch.voucherFiles);
    if (JSON.stringify(order.voucherFiles || []) !== JSON.stringify(nextVoucherFiles)) {
      order.voucherFiles = nextVoucherFiles;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, "bankAccount")) {
    const nextBankAccount = cloneBankAccount(patch.bankAccount);
    if (JSON.stringify(order.bankAccount || null) !== JSON.stringify(nextBankAccount)) {
      order.bankAccount = nextBankAccount;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, "expiredAt") && !Object.prototype.hasOwnProperty.call(patch, "expiresAt")) {
    if (order.expiresAt !== patch.expiredAt) {
      order.expiresAt = patch.expiredAt;
      changed = true;
    }
  }

  if (Object.prototype.hasOwnProperty.call(patch, "expiresAt") && !Object.prototype.hasOwnProperty.call(patch, "expiredAt")) {
    if (order.expiredAt !== patch.expiresAt) {
      order.expiredAt = patch.expiresAt;
      changed = true;
    }
  }

  return changed;
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

function startOfLocalDay(value) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addLocalDays(value, days) {
  const date = startOfLocalDay(value);
  date.setDate(date.getDate() + days);
  return date;
}

function formatLocalDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeCreditUsageSearch(value) {
  return String(value || "").trim().toLowerCase();
}

function creditUsageMatchesSearch(query, ...values) {
  if (!query) return true;
  return values.some((value) => String(value || "").toLowerCase().includes(query));
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

function getBootstrapSuperAdminConfig() {
  const email = normalizeEmail(process.env.SUPER_ADMIN_EMAIL || process.env.ADMIN_EMAIL);
  const password = String(process.env.SUPER_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || "").trim();
  if (!email || !password) return null;
  return {
    id: String(process.env.SUPER_ADMIN_ID || "super_admin_primary").trim() || "super_admin_primary",
    displayName:
      String(process.env.SUPER_ADMIN_DISPLAY_NAME || process.env.ADMIN_DISPLAY_NAME || "").trim() ||
      "正式超级管理员",
    email,
    password,
  };
}

function isApiCenterRuntimeProvider(vendorId) {
  return vendorId === "aliyun-bailian";
}

function hasApiCenterRuntimeProviderApiKey(vendorId) {
  if (vendorId === "aliyun-bailian") {
    return hasYunwuApiKey();
  }
  return false;
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

    const apiKeyConfigured = hasApiCenterRuntimeProviderApiKey(vendor.id);
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
  "video-extend": "video_extend",
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
      supportedDurations: ["4s", "6s", "8s"],
      supportedAspectRatios: ["16:9"],
      supportedResolutions: ["720p"],
    },
    "veo_3_1-components": {
      duration: "8s",
      aspectRatio: "16:9",
      resolution: "720p",
      supportedDurations: ["4s", "6s", "8s"],
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
    maxReferenceImages: Number.isFinite(Number(overrides.maxReferenceImages))
      ? Number(overrides.maxReferenceImages)
      : undefined,
    maxReferenceVideos: Number.isFinite(Number(overrides.maxReferenceVideos))
      ? Number(overrides.maxReferenceVideos)
      : undefined,
    maxReferenceAudios: Number.isFinite(Number(overrides.maxReferenceAudios))
      ? Number(overrides.maxReferenceAudios)
      : undefined,
    supportsGenerateAudio: overrides.supportsGenerateAudio === true ? true : undefined,
    qualityModes: Array.isArray(overrides.qualityModes)
      ? overrides.qualityModes.map((value) => String(value)).filter(Boolean)
      : undefined,
    editModes: Array.isArray(overrides.editModes)
      ? overrides.editModes.map((value) => String(value)).filter(Boolean)
      : undefined,
    requires: Array.isArray(overrides.requires)
      ? overrides.requires.map((value) => String(value)).filter(Boolean)
      : undefined,
    note: overrides.note || null,
  };
}

const DEFAULT_CREATE_VIDEO_MODEL_ID = "vertex:veo-3.1-generate-001";

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
    id: "kling-omni-video",
    label: "Kling V3 Omni",
    provider: "kling",
    status: "experimental",
    note: "Yunwu Kling Omni Video. Uses /kling/v1/videos/omni-video with model_name kling-v3-omni for image-to-video.",
    supportsTextToVideo: false,
    supportsSingleReference: true,
    supportsGenerateAudio: true,
    inputModes: {
      single_reference: createVideoCapabilitySet({
        supported: true,
        status: "experimental",
        supportedDurations: ["3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
        supportedAspectRatios: ["16:9", "9:16"],
        supportedResolutions: ["Auto"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "fixed",
        defaultDuration: "5s",
        defaultAspectRatio: "16:9",
        defaultResolution: "Auto",
        supportsGenerateAudio: true,
        note: "Routes to Yunwu /kling/v1/videos/omni-video. The API controls output resolution automatically.",
      }),
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
    supportsGenerateAudio: true,
    maxReferenceVideos: 3,
    maxReferenceAudios: 3,
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
        maxReferenceVideos: 3,
        maxReferenceAudios: 3,
        supportsGenerateAudio: true,
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
        maxReferenceVideos: 3,
        maxReferenceAudios: 3,
        supportsGenerateAudio: true,
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
    supportsGenerateAudio: true,
    maxReferenceVideos: 3,
    maxReferenceAudios: 3,
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
        maxReferenceVideos: 3,
        maxReferenceAudios: 3,
        supportsGenerateAudio: true,
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
        maxReferenceVideos: 3,
        maxReferenceAudios: 3,
        supportsGenerateAudio: true,
        note: "Seedance 2.0 Fast 图生视频，速度优先版本。仅支持 720p/480p。",
      }),
    },
  },

  // ── Official Vertex AI Veo models ─────────────────────────────────────────
  // id = "vertex:<rawModelId>"; label ends with "+" per naming convention.
  // Excluded: veo-3.1-generate-preview (removed 2026-04-02)
  // Excluded: veo-3.1-fast-generate-preview (removed 2026-04-02)
  // Excluded: "Veo 3.1 4K" as model (4K is a resolution parameter, not a separate model)
  {
    id: "vertex:veo-3.1-generate-001",
    label: "Veo 3.1+",
    provider: "google-vertex",
    status: "stable",
    note: "Veo 3.1 正式版，直接调用 Vertex AI。需配置 VERTEX_PROJECT_ID、VERTEX_GCS_BUCKET 及认证凭据。",
    supportsTextToVideo: true,
    supportsSingleReference: true,
    supportsStartEndFrame: true,
    supportsMultiImage: false,
    supportsGenerateAudio: true,
    inputModes: {
      text_to_video: createVideoCapabilitySet({
        supported: true,
        status: "stable",
        supportedDurations: ["4s", "6s", "8s"],
        supportedAspectRatios: ["16:9", "9:16"],
        supportedResolutions: ["1080p", "720p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "8s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        supportsGenerateAudio: true,
      }),
      single_reference: createVideoCapabilitySet({
        supported: true,
        status: "stable",
        supportedDurations: ["4s", "6s", "8s"],
        supportedAspectRatios: ["16:9", "9:16"],
        supportedResolutions: ["1080p", "720p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "8s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        supportsGenerateAudio: true,
      }),
    },
  },
  {
    id: "vertex:veo-3.1-fast-generate-001",
    label: "Veo 3.1 Fast+",
    provider: "google-vertex",
    status: "stable",
    note: "Veo 3.1 Fast 正式版，速度更快，直接调用 Vertex AI。",
    supportsTextToVideo: true,
    supportsSingleReference: true,
    supportsStartEndFrame: true,
    supportsMultiImage: false,
    supportsGenerateAudio: true,
    inputModes: {
      text_to_video: createVideoCapabilitySet({
        supported: true,
        status: "stable",
        supportedDurations: ["4s", "6s", "8s"],
        supportedAspectRatios: ["16:9", "9:16"],
        supportedResolutions: ["1080p", "720p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "8s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        supportsGenerateAudio: true,
      }),
      single_reference: createVideoCapabilitySet({
        supported: true,
        status: "stable",
        supportedDurations: ["4s", "6s", "8s"],
        supportedAspectRatios: ["16:9", "9:16"],
        supportedResolutions: ["1080p", "720p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "8s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        supportsGenerateAudio: true,
      }),
    },
  },
  {
    id: "vertex:veo-3.1-lite-generate-001",
    label: "Veo 3.1 Lite+",
    provider: "google-vertex",
    status: "preview",
    note: "Veo 3.1 Lite，Preview 阶段。轻量模型，支持文生视频、单参考图视频与首尾帧视频；多参考图暂不开放。",
    supportsTextToVideo: true,
    supportsSingleReference: true,
    supportsStartEndFrame: true,
    supportsMultiImage: false,
    supportsGenerateAudio: true,
    inputModes: {
      text_to_video: createVideoCapabilitySet({
        supported: true,
        status: "preview",
        supportedDurations: ["4s", "6s", "8s"],
        supportedAspectRatios: ["16:9", "9:16"],
        supportedResolutions: ["1080p", "720p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "8s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        supportsGenerateAudio: true,
      }),
      single_reference: createVideoCapabilitySet({
        supported: true,
        status: "preview",
        supportedDurations: ["4s", "6s", "8s"],
        supportedAspectRatios: ["16:9", "9:16"],
        supportedResolutions: ["1080p", "720p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "8s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        supportsGenerateAudio: true,
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
    supportsGenerateAudio: true,
    maxReferenceVideos: 3,
    maxReferenceAudios: 3,
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
        maxReferenceVideos: 3,
        maxReferenceAudios: 3,
        supportsGenerateAudio: true,
        note: "Seedance 2.0 首尾帧模式，首帧+尾帧图片，adaptive 比例自动适配。仅支持 720p/480p，时长 4-15 秒。",
      }),
    },
  },
  // Vertex Veo models also support start_end_frame; entries mirror those in CREATE_VIDEO_IMAGE_TO_VIDEO_MODELS.
  {
    id: "vertex:veo-3.1-generate-001",
    label: "Veo 3.1+",
    provider: "google-vertex",
    status: "stable",
    supportsStartEndFrame: true,
    supportsGenerateAudio: true,
    inputModes: {
      start_end_frame: createVideoCapabilitySet({
        supported: true,
        status: "stable",
        supportedDurations: ["5s", "8s"],
        supportedAspectRatios: ["16:9", "9:16"],
        supportedResolutions: ["1080p", "720p", "480p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "8s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        supportsGenerateAudio: true,
      }),
    },
  },
  {
    id: "vertex:veo-3.1-fast-generate-001",
    label: "Veo 3.1 Fast+",
    provider: "google-vertex",
    status: "stable",
    supportsStartEndFrame: true,
    supportsGenerateAudio: true,
    inputModes: {
      start_end_frame: createVideoCapabilitySet({
        supported: true,
        status: "stable",
        supportedDurations: ["5s", "8s"],
        supportedAspectRatios: ["16:9", "9:16"],
        supportedResolutions: ["1080p", "720p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "8s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        supportsGenerateAudio: true,
      }),
    },
  },
  {
    id: "vertex:veo-3.1-lite-generate-001",
    label: "Veo 3.1 Lite+",
    provider: "google-vertex",
    status: "preview",
    note: "Veo 3.1 Lite，Preview 阶段。支持首尾帧视频；多参考图暂不开放。",
    supportsStartEndFrame: true,
    supportsGenerateAudio: true,
    inputModes: {
      start_end_frame: createVideoCapabilitySet({
        supported: true,
        status: "preview",
        supportedDurations: ["5s", "8s"],
        supportedAspectRatios: ["16:9", "9:16"],
        supportedResolutions: ["1080p", "720p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "8s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        supportsGenerateAudio: true,
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
    maxReferenceVideos: 3,
    maxReferenceAudios: 3,
    supportsGenerateAudio: true,
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
        maxReferenceVideos: 3,
        maxReferenceAudios: 3,
        supportsGenerateAudio: true,
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
    maxReferenceVideos: 3,
    maxReferenceAudios: 3,
    supportsGenerateAudio: true,
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
        maxReferenceVideos: 3,
        maxReferenceAudios: 3,
        supportsGenerateAudio: true,
        note: "Seedance 2.0 Fast 多参考图模式，速度更快。仅支持 720p/480p，时长 4-15 秒。",
      }),
    },
  },
  {
    id: "vertex:veo-3.1-generate-001",
    label: "Veo 3.1+",
    provider: "google-vertex",
    status: "stable",
    note: "Veo 3.1 正式版已按 Vertex AI 官方 referenceImages 能力接入多参考图视频。当前严格按官方上限开放 3 张参考图，并仅开放 16:9 / 9:16、720p / 1080p。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsMultiReference: true,
    maxReferenceImages: 3,
    supportsGenerateAudio: true,
    maxReferenceImagesSource: "official",
    inputModes: {
      multi_param: createVideoCapabilitySet({
        status: "stable",
        supportedDurations: ["4s", "6s", "8s"],
        supportedAspectRatios: ["16:9", "9:16"],
        supportedResolutions: ["1080p", "720p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "8s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        maxReferenceImages: 3,
        supportsGenerateAudio: true,
        note: "按 Google Vertex AI 官方多参考图视频能力接入：最多 3 张参考图。当前保守开放 16:9 / 9:16 与 720p / 1080p。",
      }),
    },
  },
  {
    id: "vertex:veo-3.1-fast-generate-001",
    label: "Veo 3.1 Fast+",
    provider: "google-vertex",
    status: "stable",
    note: "Veo 3.1 Fast 正式版已按 Vertex AI 官方 referenceImages 能力接入多参考图视频。当前严格按官方上限开放 3 张参考图，并仅开放 16:9 / 9:16、720p / 1080p。",
    supportsTextToVideo: false,
    supportsSingleReference: false,
    supportsMultiReference: true,
    maxReferenceImages: 3,
    supportsGenerateAudio: true,
    maxReferenceImagesSource: "official",
    inputModes: {
      multi_param: createVideoCapabilitySet({
        status: "stable",
        supportedDurations: ["4s", "6s", "8s"],
        supportedAspectRatios: ["16:9", "9:16"],
        supportedResolutions: ["1080p", "720p"],
        durationControl: "selectable",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "8s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        maxReferenceImages: 3,
        supportsGenerateAudio: true,
        note: "按 Google Vertex AI 官方多参考图视频能力接入：最多 3 张参考图。当前保守开放 16:9 / 9:16 与 720p / 1080p。",
      }),
    },
  },
];

const DEFAULT_VIDEO_REFERENCE_EDIT_CAPABILITY = createVideoCapabilitySet({
  status: "untested",
  supportedDurations: ["4s", "5s", "6s", "7s", "8s", "9s", "10s", "11s", "12s", "13s", "14s", "15s"],
  supportedAspectRatios: ["Auto", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"],
  supportedResolutions: ["720p", "1080p"],
  durationControl: "selectable",
  aspectRatioControl: "selectable",
  resolutionControl: "selectable",
  defaultDuration: "5s",
  defaultAspectRatio: "16:9",
  defaultResolution: "720p",
  maxReferenceVideos: 1,
  maxReferenceImages: 1,
  note: "Officially documented by the upstream provider, wired through this integration path, and pending real-task validation.",
});

const CREATE_VIDEO_EDIT_MODELS = [
  {
    id: "pixverse-c1",
    label: "PixVerse C1 Edit",
    provider: "pixverse",
    status: "untested",
    note: "PixVerse official Restyle / Modify video edit APIs. Requires a source video; optional edit preset is used for Restyle.",
    supportsVideoEdit: true,
    maxReferenceVideos: 1,
    maxReferenceImages: 4,
    inputModes: {
      video_edit: createVideoCapabilitySet({
        ...DEFAULT_VIDEO_REFERENCE_EDIT_CAPABILITY,
        supportedAspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "Auto"],
        supportedResolutions: ["360p", "540p", "720p", "1080p"],
        editModes: ["modify", "restyle"],
        requires: ["reference_video"],
      }),
    },
  },
  {
    id: "pixverse-v6",
    label: "PixVerse V6 Edit",
    provider: "pixverse",
    status: "untested",
    note: "PixVerse official Restyle / Modify video edit APIs. Requires a source video; optional edit preset is used for Restyle.",
    supportsVideoEdit: true,
    maxReferenceVideos: 1,
    maxReferenceImages: 4,
    inputModes: {
      video_edit: createVideoCapabilitySet({
        ...DEFAULT_VIDEO_REFERENCE_EDIT_CAPABILITY,
        supportedAspectRatios: ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "Auto"],
        supportedResolutions: ["360p", "540p", "720p", "1080p"],
        editModes: ["modify", "restyle"],
        requires: ["reference_video"],
      }),
    },
  },
  {
    id: "doubao-seedance-2-0-260128",
    label: "Seedance 2.0 Edit",
    provider: "bytedance",
    status: "untested",
    note: "Seedance 2.0 official multimodal reference/edit capability. Routed through Ark content generation payload and pending real-task validation.",
    supportsVideoEdit: true,
    maxReferenceVideos: 3,
    maxReferenceImages: 9,
    maxReferenceAudios: 3,
    supportsGenerateAudio: true,
    inputModes: {
      video_edit: createVideoCapabilitySet({
        ...DEFAULT_VIDEO_REFERENCE_EDIT_CAPABILITY,
        supportedResolutions: ["720p", "480p"],
        supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"],
        editModes: ["modify", "restyle"],
        maxReferenceVideos: 3,
        maxReferenceImages: 9,
        maxReferenceAudios: 3,
        supportsGenerateAudio: true,
        requires: ["reference_video"],
      }),
    },
  },
  {
    id: "doubao-seedance-2-0-fast-260128",
    label: "Seedance 2.0 Fast Edit",
    provider: "bytedance",
    status: "untested",
    note: "Seedance 2.0 Fast multimodal reference/edit capability. Routed through Ark content generation payload and pending real-task validation.",
    supportsVideoEdit: true,
    maxReferenceVideos: 3,
    maxReferenceImages: 9,
    maxReferenceAudios: 3,
    supportsGenerateAudio: true,
    inputModes: {
      video_edit: createVideoCapabilitySet({
        ...DEFAULT_VIDEO_REFERENCE_EDIT_CAPABILITY,
        supportedResolutions: ["720p", "480p"],
        supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"],
        editModes: ["modify", "restyle"],
        maxReferenceVideos: 3,
        maxReferenceImages: 9,
        maxReferenceAudios: 3,
        supportsGenerateAudio: true,
        requires: ["reference_video"],
      }),
    },
  },
];

const CREATE_VIDEO_MOTION_CONTROL_MODELS = [
  {
    id: "pixverse-c1",
    label: "PixVerse C1 Mimic",
    provider: "pixverse",
    status: "untested",
    note: "PixVerse official Mimic API. Requires a motion reference video and a character reference image.",
    supportsMotionControl: true,
    maxReferenceVideos: 1,
    maxReferenceImages: 1,
    inputModes: {
      motion_control: createVideoCapabilitySet({
        ...DEFAULT_VIDEO_REFERENCE_EDIT_CAPABILITY,
        supportedAspectRatios: ["16:9", "9:16", "1:1", "Auto"],
        supportedResolutions: ["720p", "1080p"],
        qualityModes: ["std", "pro"],
        requires: ["motion_reference_video", "character_reference_image"],
      }),
    },
  },
  {
    id: "pixverse-v6",
    label: "PixVerse V6 Mimic",
    provider: "pixverse",
    status: "untested",
    note: "PixVerse official Mimic API. Requires a motion reference video and a character reference image.",
    supportsMotionControl: true,
    maxReferenceVideos: 1,
    maxReferenceImages: 1,
    inputModes: {
      motion_control: createVideoCapabilitySet({
        ...DEFAULT_VIDEO_REFERENCE_EDIT_CAPABILITY,
        supportedAspectRatios: ["16:9", "9:16", "1:1", "Auto"],
        supportedResolutions: ["720p", "1080p"],
        qualityModes: ["std", "pro"],
        requires: ["motion_reference_video", "character_reference_image"],
      }),
    },
  },
  {
    id: "kling-multi-elements",
    label: "Kling Multi Elements Motion",
    provider: "kling",
    status: "experimental",
    note: "Kling multi-elements / reference capability is exposed as motion-control when the model is configured. It uses image references through the existing Yunwu adapter.",
    supportsMotionControl: true,
    maxReferenceImages: 7,
    inputModes: {
      motion_control: createVideoCapabilitySet({
        ...DEFAULT_MULTI_PARAM_CAPABILITY,
        status: "experimental",
        supportedDurations: ["5s", "10s"],
        durationControl: "selectable",
        defaultDuration: "5s",
        maxReferenceImages: 7,
        requires: ["character_reference_image"],
      }),
    },
  },
  {
    id: "doubao-seedance-2-0-260128",
    label: "Seedance 2.0 Motion",
    provider: "bytedance",
    status: "untested",
    note: "Seedance 2.0 official multimodal video reference capability exposed as motion control, pending real-task validation.",
    supportsMotionControl: true,
    maxReferenceVideos: 3,
    maxReferenceImages: 9,
    maxReferenceAudios: 3,
    supportsGenerateAudio: true,
    inputModes: {
      motion_control: createVideoCapabilitySet({
        ...DEFAULT_VIDEO_REFERENCE_EDIT_CAPABILITY,
        supportedResolutions: ["720p", "480p"],
        supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"],
        maxReferenceVideos: 3,
        maxReferenceImages: 9,
        maxReferenceAudios: 3,
        supportsGenerateAudio: true,
        qualityModes: ["std", "pro"],
        requires: ["motion_reference_video"],
      }),
    },
  },
];

const CREATE_VIDEO_EXTEND_MODELS = [
  {
    id: "vertex:veo-3.1-generate-001",
    label: "Veo 3.1+ Extend",
    provider: "google-vertex",
    status: "untested",
    note: "Vertex AI Veo 3.1 official video extension. Requires one MP4 reference video; this project routes it directly through Vertex and marks the path untested until real tasks pass.",
    supportsVideoExtend: true,
    maxReferenceVideos: 1,
    inputModes: {
      video_extend: createVideoCapabilitySet({
        supported: true,
        status: "untested",
        supportedDurations: ["7s"],
        supportedAspectRatios: ["16:9", "9:16"],
        supportedResolutions: ["720p", "1080p"],
        durationControl: "fixed",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "7s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        maxReferenceVideos: 1,
        editModes: ["extend"],
        requires: ["reference_video"],
        note: "Official Vertex Veo extend support. Input video must be MP4, 1-30s, 24fps, 16:9 or 9:16.",
      }),
    },
  },
  {
    id: "vertex:veo-3.1-fast-generate-001",
    label: "Veo 3.1 Fast+ Extend",
    provider: "google-vertex",
    status: "untested",
    note: "Vertex AI Veo 3.1 Fast official video extension. Requires one MP4 reference video; marked untested until real tasks pass.",
    supportsVideoExtend: true,
    maxReferenceVideos: 1,
    inputModes: {
      video_extend: createVideoCapabilitySet({
        supported: true,
        status: "untested",
        supportedDurations: ["7s"],
        supportedAspectRatios: ["16:9", "9:16"],
        supportedResolutions: ["720p", "1080p"],
        durationControl: "fixed",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "7s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        maxReferenceVideos: 1,
        editModes: ["extend"],
        requires: ["reference_video"],
        note: "Official Vertex Veo extend support. Input video must be MP4, 1-30s, 24fps, 16:9 or 9:16.",
      }),
    },
  },
  {
    id: "vertex:veo-3.1-lite-generate-001",
    label: "Veo 3.1 Lite+ Extend",
    provider: "google-vertex",
    status: "untested",
    note: "Vertex AI Veo 3.1 Lite official video extension. Preview model; marked untested until real tasks pass.",
    supportsVideoExtend: true,
    maxReferenceVideos: 1,
    inputModes: {
      video_extend: createVideoCapabilitySet({
        supported: true,
        status: "untested",
        supportedDurations: ["7s"],
        supportedAspectRatios: ["16:9", "9:16"],
        supportedResolutions: ["720p", "1080p"],
        durationControl: "fixed",
        aspectRatioControl: "selectable",
        resolutionControl: "selectable",
        defaultDuration: "7s",
        defaultAspectRatio: "16:9",
        defaultResolution: "720p",
        maxReferenceVideos: 1,
        editModes: ["extend"],
        requires: ["reference_video"],
        note: "Official Vertex Veo extend support. Input video must be MP4, 1-30s, 24fps, 16:9 or 9:16.",
      }),
    },
  },
  {
    id: "pixverse-c1",
    label: "PixVerse C1 Extend",
    provider: "pixverse",
    status: "untested",
    note: "PixVerse official Extend API. Requires a source video and prompt.",
    supportsVideoExtend: true,
    maxReferenceVideos: 1,
    inputModes: {
      video_extend: createVideoCapabilitySet({
        ...DEFAULT_VIDEO_REFERENCE_EDIT_CAPABILITY,
        editModes: ["extend"],
        requires: ["reference_video"],
      }),
    },
  },
  {
    id: "pixverse-v6",
    label: "PixVerse V6 Extend",
    provider: "pixverse",
    status: "untested",
    note: "PixVerse official Extend API. Requires a source video and prompt.",
    supportsVideoExtend: true,
    maxReferenceVideos: 1,
    inputModes: {
      video_extend: createVideoCapabilitySet({
        ...DEFAULT_VIDEO_REFERENCE_EDIT_CAPABILITY,
        editModes: ["extend"],
        requires: ["reference_video"],
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
  const supportedQualities = Array.isArray(overrides.supportedQualities)
    ? overrides.supportedQualities.map((v) => String(v)).filter(Boolean)
    : [];
  const resolutionControl =
    overrides.resolutionControl ||
    (supportedResolutions.length > 0 ? (supportedResolutions.length > 1 ? "selectable" : "fixed") : "none");
  const qualityControl =
    overrides.qualityControl ||
    (supportedQualities.length > 0 ? (supportedQualities.length > 1 ? "selectable" : "fixed") : "none");
  const supportsNativeOutputCount = overrides.supportsNativeOutputCount === true;
  const maxOutputImages = supportsNativeOutputCount
    ? Math.max(1, Math.min(Number(overrides.maxOutputImages) || 1, 4))
    : 1;

  return {
    supported: overrides.supported !== false,
    status: overrides.status || "stable",
    supportedAspectRatios,
    supportedResolutions,
    supportedQualities,
    aspectRatioControl: overrides.aspectRatioControl || (supportedAspectRatios.length > 1 ? "selectable" : "fixed"),
    resolutionControl,
    qualityControl,
    outputCountControl: supportsNativeOutputCount ? "selectable" : "fixed",
    defaultAspectRatio: overrides.defaultAspectRatio || supportedAspectRatios[0] || null,
    defaultResolution: resolutionControl === "none" ? null : (overrides.defaultResolution || supportedResolutions[0] || null),
    defaultQuality: overrides.defaultQuality || supportedQualities[0] || null,
    defaultOutputCount: Math.max(1, Math.min(Number(overrides.defaultOutputCount) || 1, maxOutputImages)),
    maxOutputImages,
    supportsNativeOutputCount,
    maxReferenceImages: overrides.maxReferenceImages || null,
    note: overrides.note || null,
  };
}

const GEMINI_STANDARD_IMAGE_ASPECT_RATIOS = ["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9"];
const GEMINI_31_FLASH_IMAGE_ASPECT_RATIOS = [
  ...GEMINI_STANDARD_IMAGE_ASPECT_RATIOS,
  "1:4",
  "1:8",
  "4:1",
  "8:1",
];
const GEMINI_3_PRO_IMAGE_RESOLUTIONS = ["1K", "2K", "4K"];
const GEMINI_3_1_FLASH_IMAGE_RESOLUTIONS = ["512", "1K", "2K", "4K"];
const VERTEX_GEMINI_IMAGE_RESOLUTIONS = ["1K", "2K", "4K"];
const KLING_IMAGE_ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"];
const KLING_IMAGE_RESOLUTIONS = ["1K", "2K"];

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
        supportsNativeOutputCount: true,
        maxOutputImages: 4,
      }),
      image_to_image: createImageCapabilitySet({
        supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
        supportedResolutions: ["2K", "3K"],
        supportsNativeOutputCount: true,
        maxOutputImages: 4,
        maxReferenceImages: 1,
      }),
      multi_image: createImageCapabilitySet({
        supportedAspectRatios: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"],
        supportedResolutions: ["2K", "3K"],
        supportsNativeOutputCount: true,
        maxOutputImages: 4,
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
        supportedAspectRatios: GEMINI_STANDARD_IMAGE_ASPECT_RATIOS,
        supportedResolutions: GEMINI_3_PRO_IMAGE_RESOLUTIONS,
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
      }),
      image_to_image: createImageCapabilitySet({
        supportedAspectRatios: GEMINI_STANDARD_IMAGE_ASPECT_RATIOS,
        supportedResolutions: GEMINI_3_PRO_IMAGE_RESOLUTIONS,
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
        maxReferenceImages: 14,
      }),
      multi_image: createImageCapabilitySet({
        supportedAspectRatios: GEMINI_STANDARD_IMAGE_ASPECT_RATIOS,
        supportedResolutions: GEMINI_3_PRO_IMAGE_RESOLUTIONS,
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
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
        supportedAspectRatios: GEMINI_31_FLASH_IMAGE_ASPECT_RATIOS,
        supportedResolutions: GEMINI_3_1_FLASH_IMAGE_RESOLUTIONS,
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
      }),
      image_to_image: createImageCapabilitySet({
        supportedAspectRatios: GEMINI_31_FLASH_IMAGE_ASPECT_RATIOS,
        supportedResolutions: GEMINI_3_1_FLASH_IMAGE_RESOLUTIONS,
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
        maxReferenceImages: 14,
      }),
      multi_image: createImageCapabilitySet({
        supportedAspectRatios: GEMINI_31_FLASH_IMAGE_ASPECT_RATIOS,
        supportedResolutions: GEMINI_3_1_FLASH_IMAGE_RESOLUTIONS,
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
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
        supportedAspectRatios: GEMINI_STANDARD_IMAGE_ASPECT_RATIOS,
        supportedResolutions: [],
        resolutionControl: "none",
        defaultAspectRatio: "1:1",
      }),
      image_to_image: createImageCapabilitySet({
        supportedAspectRatios: GEMINI_STANDARD_IMAGE_ASPECT_RATIOS,
        supportedResolutions: [],
        resolutionControl: "none",
        defaultAspectRatio: "1:1",
        maxReferenceImages: 14,
      }),
      multi_image: createImageCapabilitySet({
        supportedAspectRatios: GEMINI_STANDARD_IMAGE_ASPECT_RATIOS,
        supportedResolutions: [],
        resolutionControl: "none",
        defaultAspectRatio: "1:1",
        maxReferenceImages: 14,
      }),
    },
  },
  // ── Vertex AI (Official Google) Image Models ──────────────────────────────
  // These use the "vertex:" prefix to distinguish from Yunwu-routed Gemini models.
  // label ends with "+" per naming convention; rawModelId is what goes to the API.
  //
  // NOT included:
  //   Removed invalid legacy image model IDs that had no real provider path.
  {
    id: "vertex:gemini-3-pro-image-preview",
    label: "Gemini 3 Pro Image+",
    provider: "google-vertex",
    kind: "image",
    status: "preview",
    recommended: false,
    note: "Gemini 3 Pro Image — Preview。直接调用 Vertex AI API，需配置 VERTEX_PROJECT_ID 和 VERTEX_API_KEY（或 GOOGLE_APPLICATION_CREDENTIALS）。",
    inputModes: {
      text_to_image: createImageCapabilitySet({
        supportedAspectRatios: GEMINI_STANDARD_IMAGE_ASPECT_RATIOS,
        supportedResolutions: VERTEX_GEMINI_IMAGE_RESOLUTIONS,
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
      }),
      image_to_image: createImageCapabilitySet({
        supportedAspectRatios: GEMINI_STANDARD_IMAGE_ASPECT_RATIOS,
        supportedResolutions: VERTEX_GEMINI_IMAGE_RESOLUTIONS,
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
        maxReferenceImages: 14,
      }),
      multi_image: createImageCapabilitySet({
        supportedAspectRatios: GEMINI_STANDARD_IMAGE_ASPECT_RATIOS,
        supportedResolutions: VERTEX_GEMINI_IMAGE_RESOLUTIONS,
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
        maxReferenceImages: 14,
      }),
    },
  },
  {
    id: "vertex:gemini-3.1-flash-image-preview",
    label: "Gemini 3.1 Flash Image+",
    provider: "google-vertex",
    kind: "image",
    status: "preview",
    recommended: false,
    note: "Gemini 3.1 Flash Image — Preview。直接调用 Vertex AI API，速度更快。",
    inputModes: {
      text_to_image: createImageCapabilitySet({
        supportedAspectRatios: GEMINI_31_FLASH_IMAGE_ASPECT_RATIOS,
        supportedResolutions: VERTEX_GEMINI_IMAGE_RESOLUTIONS,
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
      }),
      image_to_image: createImageCapabilitySet({
        supportedAspectRatios: GEMINI_31_FLASH_IMAGE_ASPECT_RATIOS,
        supportedResolutions: VERTEX_GEMINI_IMAGE_RESOLUTIONS,
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
        maxReferenceImages: 14,
      }),
      multi_image: createImageCapabilitySet({
        supportedAspectRatios: GEMINI_31_FLASH_IMAGE_ASPECT_RATIOS,
        supportedResolutions: VERTEX_GEMINI_IMAGE_RESOLUTIONS,
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
        maxReferenceImages: 14,
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
        supportedAspectRatios: KLING_IMAGE_ASPECT_RATIOS,
        supportedResolutions: KLING_IMAGE_RESOLUTIONS,
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
        supportsNativeOutputCount: true,
        maxOutputImages: 4,
      }),
      image_to_image: createImageCapabilitySet({
        supportedAspectRatios: KLING_IMAGE_ASPECT_RATIOS,
        supportedResolutions: KLING_IMAGE_RESOLUTIONS,
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
        supportsNativeOutputCount: true,
        maxOutputImages: 4,
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
        supportedAspectRatios: KLING_IMAGE_ASPECT_RATIOS,
        supportedResolutions: KLING_IMAGE_RESOLUTIONS,
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
        supportsNativeOutputCount: true,
        maxOutputImages: 4,
      }),
      image_to_image: createImageCapabilitySet({
        supportedAspectRatios: KLING_IMAGE_ASPECT_RATIOS,
        supportedResolutions: KLING_IMAGE_RESOLUTIONS,
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
        supportsNativeOutputCount: true,
        maxOutputImages: 4,
        maxReferenceImages: 1,
      }),
      multi_image: createImageCapabilitySet({
        supportedAspectRatios: KLING_IMAGE_ASPECT_RATIOS,
        supportedResolutions: KLING_IMAGE_RESOLUTIONS,
        defaultAspectRatio: "1:1",
        defaultResolution: "1K",
        supportsNativeOutputCount: true,
        maxOutputImages: 4,
        maxReferenceImages: 4,
      }),
    },
  },
];

function listCreateImageCapabilities(mode) {
  const normalizedMode = String(mode || "").trim().toLowerCase();
  const configured = CREATE_IMAGE_MODELS.filter((item) =>
    isMediaGenerationModelConfigured("image", item.id)
  );
  if (!normalizedMode) {
    return configured.map((item) => clone(item));
  }
  return configured.filter((item) => {
    return item.inputModes && item.inputModes[normalizedMode];
  }).map((item) => clone(item));
}

function getCreateImageModel(model) {
  const normalizedModel = normalizeModelId(model || "");
  return CREATE_IMAGE_MODELS.find((item) => item.id === normalizedModel) || null;
}

function getCreateImageInputMode(referenceCount) {
  const normalizedReferenceCount = Math.max(0, Number(referenceCount) || 0);
  if (normalizedReferenceCount >= 2) return "multi_image";
  if (normalizedReferenceCount === 1) return "image_to_image";
  return "text_to_image";
}

function getCreateImageCapabilitySetForMode(model, referenceCount) {
  const capability = getCreateImageModel(model);
  if (!capability?.inputModes) return null;
  const preferredMode = getCreateImageInputMode(referenceCount);
  if (capability.inputModes[preferredMode]?.supported) {
    return capability.inputModes[preferredMode];
  }
  if (preferredMode === "image_to_image" && capability.inputModes.multi_image?.supported) {
    return capability.inputModes.multi_image;
  }
  if (capability.inputModes.text_to_image?.supported) {
    return capability.inputModes.text_to_image;
  }
  return null;
}

function resolveCreateImageAspectRatio(model, aspectRatio, referenceCount) {
  const requestedAspectRatio = String(aspectRatio || "").trim();
  const inputModeCapability = getCreateImageCapabilitySetForMode(model, referenceCount);
  if (inputModeCapability?.supported) {
    return {
      requestedAspectRatio,
      normalizedAspectRatio: resolveSelectableCapabilityValue(
        requestedAspectRatio,
        inputModeCapability.supportedAspectRatios,
        inputModeCapability.defaultAspectRatio || "1:1"
      ),
      aspectRatioControl: inputModeCapability.aspectRatioControl,
      supportedAspectRatios: inputModeCapability.supportedAspectRatios,
    };
  }
  return {
    requestedAspectRatio,
    normalizedAspectRatio: requestedAspectRatio || "1:1",
    aspectRatioControl: "selectable",
    supportedAspectRatios: ["1:1", "16:9", "9:16"],
  };
}

function resolveCreateImageResolution(model, resolution, referenceCount) {
  const requestedResolution = String(resolution || "").trim().toUpperCase();
  const inputModeCapability = getCreateImageCapabilitySetForMode(model, referenceCount);
  if (inputModeCapability?.supported) {
    if (inputModeCapability.resolutionControl === "none") {
      return {
        requestedResolution,
        normalizedResolution: "",
        resolutionControl: "none",
        supportedResolutions: [],
      };
    }
    return {
      requestedResolution,
      normalizedResolution: resolveSelectableCapabilityValue(
        requestedResolution,
        inputModeCapability.supportedResolutions,
        inputModeCapability.defaultResolution || inputModeCapability.supportedResolutions?.[0] || ""
      ),
      resolutionControl: inputModeCapability.resolutionControl,
      supportedResolutions: inputModeCapability.supportedResolutions,
    };
  }
  return {
    requestedResolution,
    normalizedResolution: requestedResolution,
    resolutionControl: "selectable",
    supportedResolutions: [],
  };
}

function resolveCreateImageOutputCount(model, count, referenceCount) {
  const requestedCount = Math.max(1, Math.floor(Number(count) || 1));
  const inputModeCapability = getCreateImageCapabilitySetForMode(model, referenceCount);
  if (!inputModeCapability?.supportsNativeOutputCount) {
    return {
      requestedCount,
      normalizedCount: 1,
      maxOutputImages: 1,
      outputCountControl: "fixed",
    };
  }
  const maxOutputImages = Math.max(1, Math.min(Number(inputModeCapability.maxOutputImages) || 1, 4));
  return {
    requestedCount,
    normalizedCount: Math.max(1, Math.min(requestedCount, maxOutputImages)),
    maxOutputImages,
    outputCountControl: maxOutputImages > 1 ? "selectable" : "fixed",
  };
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
  return CREATE_VIDEO_IMAGE_TO_VIDEO_MODELS.filter((item) =>
    isMediaGenerationModelConfigured("video", item.id)
  ).map(enrichVideoModel);
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
    return (
      item.supportsStartEndFrame !== false &&
      se && se.supported !== false &&
      isMediaGenerationModelConfigured("video", item.id)
    );
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
  return CREATE_VIDEO_MULTI_PARAM_MODELS.filter((item) =>
    isMediaGenerationModelConfigured("video", item.id)
  ).map(enrichVideoModel);
}

function listCreateVideoEditCapabilities() {
  return CREATE_VIDEO_EDIT_MODELS.filter((item) =>
    isMediaGenerationModelConfigured("video", item.id)
  ).map(enrichVideoModel);
}

function listCreateVideoMotionControlCapabilities() {
  return CREATE_VIDEO_MOTION_CONTROL_MODELS.filter((item) =>
    isMediaGenerationModelConfigured("video", item.id)
  ).map(enrichVideoModel);
}

function listCreateVideoExtendCapabilities() {
  return CREATE_VIDEO_EXTEND_MODELS.filter((item) =>
    isMediaGenerationModelConfigured("video", item.id)
  ).map(enrichVideoModel);
}

function resolveCreateVideoDefaultModelFromItems(
  items,
  preferredModel = DEFAULT_CREATE_VIDEO_MODEL_ID
) {
  const availableItems = Array.isArray(items) ? items : [];
  if (availableItems.some((item) => item?.id === preferredModel)) {
    return preferredModel;
  }
  return availableItems[0]?.id || null;
}

function listCreateVideoCapabilitiesForMode(videoMode) {
  if (videoMode === "start_end_frame") return listCreateVideoStartEndCapabilities();
  if (videoMode === "multi_param") return listCreateVideoMultiParamCapabilities();
  if (videoMode === "video_edit") return listCreateVideoEditCapabilities();
  if (videoMode === "motion_control") return listCreateVideoMotionControlCapabilities();
  if (videoMode === "video_extend") return listCreateVideoExtendCapabilities();
  return listCreateVideoImageToVideoCapabilities();
}

function resolveCreateVideoDefaultModelForMode(videoMode) {
  return resolveCreateVideoDefaultModelFromItems(
    listCreateVideoCapabilitiesForMode(videoMode)
  );
}

function getCreateVideoMultiParamModel(model) {
  const normalizedModel = normalizeModelId(model || "");
  return CREATE_VIDEO_MULTI_PARAM_MODELS.find((item) => item.id === normalizedModel) || null;
}

function getCreateVideoMultiParamCapabilitySet(model) {
  const capability = getCreateVideoMultiParamModel(model);
  return capability?.inputModes?.multi_param || null;
}

function getCreateVideoModeModel(model, items) {
  const normalizedModel = normalizeModelId(model || "");
  return items.find((item) => item.id === normalizedModel) || null;
}

function getCreateVideoEditCapabilitySet(model) {
  const capability = getCreateVideoModeModel(model, CREATE_VIDEO_EDIT_MODELS);
  return capability?.inputModes?.video_edit || null;
}

function getCreateVideoMotionControlCapabilitySet(model) {
  const capability = getCreateVideoModeModel(model, CREATE_VIDEO_MOTION_CONTROL_MODELS);
  return capability?.inputModes?.motion_control || null;
}

function getCreateVideoExtendCapabilitySet(model) {
  const capability = getCreateVideoModeModel(model, CREATE_VIDEO_EXTEND_MODELS);
  return capability?.inputModes?.video_extend || null;
}

function getCreateVideoCapabilitySetForMode(model, videoMode, inputMode) {
  if (videoMode === "image_to_video") {
    return (
      getCreateVideoImageToVideoCapabilitySet(model, inputMode) ||
      getFallbackSupportedImageToVideoCapabilitySet(model)
    );
  }
  if (videoMode === "text_to_video") {
    // text_to_video (pure text prompt, no reference image) uses the same
    // inputModes.text_to_video capability set as image_to_video without a reference.
    return getCreateVideoImageToVideoCapabilitySet(model, "text_to_video");
  }
  if (videoMode === "start_end_frame") {
    return getCreateVideoStartEndCapabilitySet(model);
  }
  if (videoMode === "multi_param") {
    return getCreateVideoMultiParamCapabilitySet(model);
  }
  if (videoMode === "video_edit") {
    return getCreateVideoEditCapabilitySet(model);
  }
  if (videoMode === "motion_control") {
    return getCreateVideoMotionControlCapabilitySet(model);
  }
  if (videoMode === "video_extend") {
    return getCreateVideoExtendCapabilitySet(model);
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
    return;
  }
  if (videoMode === "video_edit") {
    const capability = getCreateVideoEditCapabilitySet(model);
    if (!capability?.supported) {
      throw apiError(400, "UNSUPPORTED_VIDEO_INPUT_MODE", `${normalizeModelId(model || "")} does not support video edit mode in this page.`);
    }
    return;
  }
  if (videoMode === "motion_control") {
    const capability = getCreateVideoMotionControlCapabilitySet(model);
    if (!capability?.supported) {
      throw apiError(400, "UNSUPPORTED_VIDEO_INPUT_MODE", `${normalizeModelId(model || "")} does not support motion-control video in this page.`);
    }
    return;
  }
  if (videoMode === "video_extend") {
    const capability = getCreateVideoExtendCapabilitySet(model);
    if (!capability?.supported) {
      throw apiError(400, "UNSUPPORTED_VIDEO_INPUT_MODE", `${normalizeModelId(model || "")} does not support video extension in this page.`);
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
  return ["16:9", "4:3", "1:1", "3:4", "9:16", "2:3", "3:2", "21:9", "adaptive", "Auto"].includes(normalizedAspectRatio)
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

function sanitizeReferenceImageUrls(raw, maxItems = 14) {
  if (!Array.isArray(raw)) return [];
  const limit = Math.max(0, Math.floor(Number(maxItems) || 14));
  return raw
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(0, limit);
}

function sanitizeReferenceMediaUrls(raw, maxItems = 3) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .slice(0, Math.max(1, Number(maxItems) || 3));
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
  const defaultVideoModel =
    resolveCreateVideoDefaultModelForMode(videoMode) || DEFAULT_CREATE_VIDEO_MODEL_ID;
  const multiParamFallbackModel = fallbackModel || defaultVideoModel;
  const preferredModel =
    requestedModel ||
    fallbackModel ||
    defaultVideoModel;
  if (requestedModel) return requestedModel;
  if (["multi_param", "video_edit", "motion_control", "video_extend"].includes(videoMode)) {
    return multiParamFallbackModel;
  }
  if (hasFirstFrameUrl) return fallbackModel || defaultVideoModel;
  if (referenceImageUrl) return preferredModel || defaultVideoModel;
  return preferredModel || defaultVideoModel;
}

function formatCreateVideoModelLabel(model) {
  const normalizedModel = normalizeModelId(model || "");
  return model || normalizedModel || "unknown-video-model";
}

function resolveStableCreateVideoModeModel(requestedModel, videoMode) {
  const defaultVideoModel =
    resolveCreateVideoDefaultModelForMode(videoMode) || DEFAULT_CREATE_VIDEO_MODEL_ID;

  if (videoMode === "start_end_frame") {
    const normalizedRequestedModel = normalizeModelId(requestedModel || "");
    if (!normalizedRequestedModel) {
      return defaultVideoModel;
    }
    return requestedModel;
  }

  if (["multi_param", "video_edit", "motion_control", "video_extend"].includes(videoMode)) {
    return requestedModel || defaultVideoModel;
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

// ─── Idempotency & content-dedup helpers ─────────────────────────────────
// Shared across the Store instance lifetime. Keys live briefly; a rolling
// purge on each lookup keeps the map bounded without a timer.
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CONTENT_DEDUP_WINDOW_MS = 4000; // 4 seconds

function _pruneIdempotencyMap(map, now) {
  // Keep map from growing unbounded if the service never restarts.
  if (map.size <= 2000) return;
  for (const [key, entry] of map) {
    if (!entry || entry.expiresAt <= now) map.delete(key);
  }
}

function _stableStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => _stableStringify(v)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${_stableStringify(value[k])}`)
    .join(",")}}`;
}

function _fingerprintCreateImageInput(input) {
  return _stableStringify({
    t: "image",
    m: String(input?.model || "").trim(),
    p: String(input?.prompt || "").trim(),
    n: String(input?.negativePrompt || "").trim(),
    s: String(input?.style || "").trim(),
    ar: String(input?.aspectRatio || "").trim(),
    r: String(input?.resolution || "").trim(),
    c: Number(input?.count) || 1,
    ref: Array.isArray(input?.referenceImageUrls)
      ? input.referenceImageUrls.map((u) => String(u || "").trim()).filter(Boolean).sort()
      : input?.referenceImageUrl
        ? [String(input.referenceImageUrl).trim()]
        : [],
  });
}

function _fingerprintCreateVideoInput(input) {
  return _stableStringify({
    t: "video",
    m: String(input?.model || "").trim(),
    p: String(input?.prompt || "").trim(),
    vm: String(input?.videoMode || "").trim(),
    d: String(input?.duration || input?.durationSeconds || "").trim(),
    ar: String(input?.aspectRatio || "").trim(),
    r: String(input?.resolution || "").trim(),
    ref: String(input?.referenceImageUrl || "").trim(),
    ff: String(input?.firstFrameUrl || "").trim(),
    lf: String(input?.lastFrameUrl || "").trim(),
    mr: input?.multiReferenceImages || null,
    rv: Array.isArray(input?.referenceVideoUrls)
      ? input.referenceVideoUrls.map((u) => String(u || "").trim()).filter(Boolean).sort()
      : [],
    ra: Array.isArray(input?.referenceAudioUrls)
      ? input.referenceAudioUrls.map((u) => String(u || "").trim()).filter(Boolean).sort()
      : [],
    em: String(input?.editMode || "").trim(),
    ep: String(input?.editPresetId || "").trim(),
    mv: String(input?.motionReferenceVideoUrl || "").trim(),
    ci: String(input?.characterReferenceImageUrl || "").trim(),
    qm: String(input?.qualityMode || "").trim(),
    ga: Boolean(input?.generateAudio),
    ns: Boolean(input?.networkSearch),
  });
}

class MockStore {
  constructor() {
    this.events = new EventEmitter();
    // Map<`${actorId}|${idempotencyKey}`, { taskId, expiresAt }>
    this._idempotencyCache = new Map();
    // Map<fingerprint, { taskId, expiresAt, actorId }>
    this._recentCreateFingerprints = new Map();
    this.reset();
  }

  /**
   * Look up a previously accepted task for the same actor+idempotency key.
   * Returns null if absent or expired. Prunes the cache opportunistically.
   */
  _lookupIdempotentTask(actorId, idempotencyKey) {
    if (!idempotencyKey) return null;
    const now = Date.now();
    const key = `${actorId || "anon"}|${idempotencyKey}`;
    const entry = this._idempotencyCache.get(key);
    _pruneIdempotencyMap(this._idempotencyCache, now);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this._idempotencyCache.delete(key);
      return null;
    }
    const task = (this.state.tasks || []).find((t) => t.id === entry.taskId);
    return task || null;
  }

  _rememberIdempotentTask(actorId, idempotencyKey, taskId) {
    if (!idempotencyKey || !taskId) return;
    const key = `${actorId || "anon"}|${idempotencyKey}`;
    this._idempotencyCache.set(key, {
      taskId,
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
    });
  }

  /**
   * Returns an existing task id if the same actor submitted structurally
   * identical content within CONTENT_DEDUP_WINDOW_MS. Prevents rapid
   * double-clicks from producing two provider-billed jobs even when the
   * client does not include an idempotency key.
   */
  _lookupRecentContentDup(actorId, fingerprint) {
    if (!fingerprint) return null;
    const now = Date.now();
    const key = `${actorId || "anon"}|${fingerprint}`;
    const entry = this._recentCreateFingerprints.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now) {
      this._recentCreateFingerprints.delete(key);
      return null;
    }
    const task = (this.state.tasks || []).find((t) => t.id === entry.taskId);
    return task || null;
  }

  _rememberRecentContent(actorId, fingerprint, taskId) {
    if (!fingerprint || !taskId) return;
    const key = `${actorId || "anon"}|${fingerprint}`;
    this._recentCreateFingerprints.set(key, {
      taskId,
      expiresAt: Date.now() + CONTENT_DEDUP_WINDOW_MS,
    });
    // Opportunistic pruning.
    if (this._recentCreateFingerprints.size > 2000) {
      const now = Date.now();
      for (const [k, v] of this._recentCreateFingerprints) {
        if (!v || v.expiresAt <= now) this._recentCreateFingerprints.delete(k);
      }
    }
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

    if (this.ensurePlaygroundState()) {
      changed = true;
    }

    // ── Migrate historically poisoned display URLs ────────────────────
    // Pre-fix records persisted base64 data URLs into display fields; the
    // SQLite snapshot serializer then turned them into ``[truncated:…]``
    // on the next restart. Left alone these poisoned strings render as
    // broken images on /create/video. Scrub them at load time: try to
    // recover from adjacent fields, otherwise set to null so the frontend
    // can fall back to a videoUrl-derived poster.
    if (this.sanitizePersistedDisplayUrls()) {
      changed = true;
    }

    if (!Array.isArray(this.state.toolboxCapabilities)) {
      this.state.toolboxCapabilities = [];
      changed = true;
    }
    const hasVideoReplace = this.state.toolboxCapabilities.some(t => t.code === "video_character_replace");
    if (!hasVideoReplace) {
      this.state.toolboxCapabilities.unshift({
        code: "video_character_replace",
        name: "视频人物替换",
        status: "mock_ready",
        queue: "video-gpu",
        description: "利用行业领先的 AI 模型，在保持原始动作和光影的同时，无缝替换视频中的特定人物角色。",
      });
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

  /**
   * Scrub display URLs in `createStudioVideos`, `createStudioImages`,
   * create_video_generate / create_image_generate tasks' metadata, and
   * assets that were persisted with base64 data URLs by a previous
   * version of the server.  After the next snapshot these fields will
   * only ever hold `null`, `/uploads/*`, `/vr-*`, or a real URL.
   *
   * Recovery strategy, in order:
   *   1. If the field is already safe (null / uploads / http) → leave it.
   *   2. If poisoned (truncated marker / data: URL / unreasonable string)
   *      → try to recover from a clean sibling field:
   *         - createStudioVideos.referenceImageUrl
   *             ← firstFrameUrl / primary multiReferenceImages / videoMode-specific
   *         - thumbnailUrl ← null  (frontend falls back to videoUrl-derived poster)
   *   3. Otherwise set to null.
   *
   * Returns true iff any record was mutated so the caller knows to save
   * a fresh snapshot.
   */
  sanitizePersistedDisplayUrls() {
    let mutated = false;

    const pickClean = (...candidates) => {
      for (const c of candidates) {
        const safe = this.sanitizeDisplayUrlForPersist(c);
        if (safe) return safe;
      }
      return null;
    };

    const scrubRefFields = (record, { recoverCandidates = [] } = {}) => {
      let localChanged = false;
      // Display-URL fields that MAY attempt recovery from neighbouring
      // clean URLs — referenceImageUrl et al.
      const recoverableFields = ["referenceImageUrl", "resolvedReferenceImageUrl"];
      // Fields that must only be cleaned to null when poisoned (we don't
      // want to invent a fake firstFrame / lastFrame / thumbnail).
      const nullableFields = ["thumbnailUrl", "firstFrameUrl", "lastFrameUrl"];

      for (const f of recoverableFields) {
        if (!(f in record)) continue;
        const current = record[f];
        if (current == null) continue;
        const safe = this.sanitizeDisplayUrlForPersist(current);
        if (safe === current) continue;
        record[f] = safe !== null ? safe : pickClean(...recoverCandidates);
        localChanged = true;
      }

      for (const f of nullableFields) {
        if (!(f in record)) continue;
        const current = record[f];
        if (current == null) continue;
        const safe = this.sanitizeDisplayUrlForPersist(current);
        if (safe === current) continue;
        record[f] = safe;
        localChanged = true;
      }

      // multiReferenceImages: { slot: [url, ...] | url }
      if (record.multiReferenceImages && typeof record.multiReferenceImages === "object") {
        let slotMutated = false;
        const out = {};
        for (const [slot, value] of Object.entries(record.multiReferenceImages)) {
          const list = Array.isArray(value) ? value : (value ? [value] : []);
          const cleanedList = list
            .map((x) => this.sanitizeDisplayUrlForPersist(x))
            .filter(Boolean);
          if (cleanedList.length) out[slot] = cleanedList;
          if (cleanedList.length !== list.length) slotMutated = true;
        }
        if (slotMutated ||
            Object.keys(out).length !== Object.keys(record.multiReferenceImages).length) {
          record.multiReferenceImages = Object.keys(out).length ? out : null;
          localChanged = true;
        }
      }

      return localChanged;
    };

    // 1. createStudioVideos
    const videos = Array.isArray(this.state.createStudioVideos)
      ? this.state.createStudioVideos
      : [];
    for (const v of videos) {
      if (!v || typeof v !== "object") continue;
      const multiPrimary = (() => {
        const m = v.multiReferenceImages;
        if (!m || typeof m !== "object") return null;
        for (const slot of Object.values(m)) {
          const list = Array.isArray(slot) ? slot : (slot ? [slot] : []);
          for (const url of list) {
            const safe = this.sanitizeDisplayUrlForPersist(url);
            if (safe) return safe;
          }
        }
        return null;
      })();
      const recoverCandidates = [v.firstFrameUrl, multiPrimary];
      if (scrubRefFields(v, { recoverCandidates })) {
        mutated = true;
      }
    }

    // 2. createStudioImages (image-create has the same shape of reference fields)
    const images = Array.isArray(this.state.createStudioImages)
      ? this.state.createStudioImages
      : [];
    for (const img of images) {
      if (!img || typeof img !== "object") continue;
      const recoverCandidates = [img.imageUrl, img.referenceImageUrl];
      if (scrubRefFields(img, { recoverCandidates })) {
        mutated = true;
      }
      // Array shape
      if (Array.isArray(img.referenceImageUrls)) {
        const cleaned = img.referenceImageUrls
          .map((x) => this.sanitizeDisplayUrlForPersist(x))
          .filter(Boolean);
        if (cleaned.length !== img.referenceImageUrls.length ||
            cleaned.some((x, i) => x !== img.referenceImageUrls[i])) {
          img.referenceImageUrls = cleaned;
          mutated = true;
        }
      }
    }

    // 3. tasks.metadata for create_video_generate / create_image_generate
    const tasks = Array.isArray(this.state.tasks) ? this.state.tasks : [];
    for (const task of tasks) {
      if (!task || typeof task !== "object") continue;
      if (task.type !== "create_video_generate" && task.type !== "create_image_generate") {
        continue;
      }
      const md = task.metadata;
      if (!md || typeof md !== "object") continue;
      const recoverCandidates = [md.firstFrameUrl, md.lastFrameUrl];
      if (scrubRefFields(md, { recoverCandidates })) {
        mutated = true;
      }
      if (Array.isArray(md.referenceImageUrls)) {
        const cleaned = md.referenceImageUrls
          .map((x) => this.sanitizeDisplayUrlForPersist(x))
          .filter(Boolean);
        if (cleaned.length !== md.referenceImageUrls.length ||
            cleaned.some((x, i) => x !== md.referenceImageUrls[i])) {
          md.referenceImageUrls = cleaned;
          mutated = true;
        }
      }
      if (md.multiReferenceImages && typeof md.multiReferenceImages === "object") {
        let slotMutated = false;
        const out = {};
        for (const [slot, value] of Object.entries(md.multiReferenceImages)) {
          const list = Array.isArray(value) ? value : (value ? [value] : []);
          const cleanedList = list
            .map((x) => this.sanitizeDisplayUrlForPersist(x))
            .filter(Boolean);
          if (cleanedList.length) {
            out[slot] = cleanedList;
          }
          if (cleanedList.length !== list.length) slotMutated = true;
        }
        if (slotMutated || Object.keys(out).length !== Object.keys(md.multiReferenceImages).length) {
          md.multiReferenceImages = Object.keys(out).length ? out : null;
          mutated = true;
        }
      }
    }

    // 4. assetsByProjectId — single-preview display fields
    const assetsByProject = this.state.assetsByProjectId || {};
    for (const list of Object.values(assetsByProject)) {
      if (!Array.isArray(list)) continue;
      for (const asset of list) {
        if (!asset || typeof asset !== "object") continue;
        for (const field of ["previewUrl", "mediaUrl", "imageUrl", "thumbnailUrl"]) {
          if (!(field in asset)) continue;
          const safe = this.sanitizeDisplayUrlForPersist(asset[field]);
          if (safe !== asset[field]) {
            asset[field] = safe;
            mutated = true;
          }
        }
        if (Array.isArray(asset.referenceImageUrls)) {
          const cleaned = asset.referenceImageUrls
            .map((x) => this.sanitizeDisplayUrlForPersist(x))
            .filter(Boolean);
          if (cleaned.length !== asset.referenceImageUrls.length ||
              cleaned.some((x, i) => x !== asset.referenceImageUrls[i])) {
            asset.referenceImageUrls = cleaned;
            mutated = true;
          }
        }
      }
    }

    // 5. canvasProjectsByActorId — Canvas node / group media fields
    //    See user request §B: the save path used to pipe `data:base64` URLs,
    //    `canvas.toDataURL('image/png')` frame extracts, ImageEditor composite
    //    fallbacks, and CameraAngle outputs straight into node.resultUrl /
    //    node.lastFrame. After the sqlite snapshot serializer trimmed the
    //    giant strings, the snapshot came back as `[truncated:1.9M chars]`.
    //
    //    Recovery policy (conservative — no invented URLs):
    //      - lastFrame poisoned, resultUrl clean (video)
    //            → lastFrame = null (FE auto-extraction repopulates it)
    //      - resultUrl poisoned
    //            → try inputUrl → editorBackgroundUrl
    //            → otherwise null, and downgrade node.status SUCCESS → idle
    //      - editorCanvasData poisoned → null (editor tolerates missing layer)
    //      - editorBackgroundUrl poisoned → try resultUrl → null
    //      - inputUrl poisoned → null
    //      - characterReferenceUrls[] → filter
    //      - group.storyContext.compositeImageUrl → null when poisoned
    const canvasByActor = this.state.canvasProjectsByActorId || {};
    const SUCCESS_STATUS = "success";
    for (const [actorId, projects] of Object.entries(canvasByActor)) {
      if (!Array.isArray(projects)) continue;
      for (const project of projects) {
        if (!project || typeof project !== "object") continue;

        // project.thumbnailUrl
        if ("thumbnailUrl" in project) {
          const current = project.thumbnailUrl;
          if (current != null) {
            const safe = this.sanitizeDisplayUrlForPersist(current);
            if (safe !== current) {
              project.thumbnailUrl = safe;
              mutated = true;
            }
          }
        }

        const canvasData = project.canvasData;
        if (!canvasData || typeof canvasData !== "object") continue;

        // nodes[*]
        const nodes = Array.isArray(canvasData.nodes) ? canvasData.nodes : [];
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;

          const before = {
            resultUrl: node.resultUrl,
            lastFrame: node.lastFrame,
            editorBackgroundUrl: node.editorBackgroundUrl,
            editorCanvasData: node.editorCanvasData,
            inputUrl: node.inputUrl,
          };

          const safeResult = "resultUrl" in node
            ? this.sanitizeDisplayUrlForPersist(node.resultUrl)
            : undefined;
          const safeLastFrame = "lastFrame" in node
            ? this.sanitizeDisplayUrlForPersist(node.lastFrame)
            : undefined;
          const safeEditorBg = "editorBackgroundUrl" in node
            ? this.sanitizeDisplayUrlForPersist(node.editorBackgroundUrl)
            : undefined;
          const safeEditorCanvas = "editorCanvasData" in node
            ? this.sanitizeDisplayUrlForPersist(node.editorCanvasData)
            : undefined;
          const safeInputUrl = "inputUrl" in node
            ? this.sanitizeDisplayUrlForPersist(node.inputUrl)
            : undefined;

          // Recover resultUrl from inputUrl/editorBackgroundUrl when possible.
          let resolvedResult = safeResult;
          if ("resultUrl" in node && before.resultUrl != null && safeResult === null) {
            resolvedResult = safeInputUrl ?? safeEditorBg ?? null;
          }

          if ("resultUrl" in node && resolvedResult !== before.resultUrl) {
            node.resultUrl = resolvedResult ?? null;
            mutated = true;
          }
          if ("lastFrame" in node && safeLastFrame !== before.lastFrame) {
            node.lastFrame = safeLastFrame ?? null;
            mutated = true;
          }
          if ("editorBackgroundUrl" in node && safeEditorBg !== before.editorBackgroundUrl) {
            node.editorBackgroundUrl = safeEditorBg ?? null;
            mutated = true;
          }
          if ("editorCanvasData" in node && safeEditorCanvas !== before.editorCanvasData) {
            node.editorCanvasData = safeEditorCanvas ?? null;
            mutated = true;
          }
          if ("inputUrl" in node && safeInputUrl !== before.inputUrl) {
            node.inputUrl = safeInputUrl ?? null;
            mutated = true;
          }

          // Graceful status downgrade: SUCCESS nodes with no resolvable
          // resultUrl would render as broken images. Flip to idle so the
          // user sees the upload/generate placeholder and can retry.
          if (
            node.status === SUCCESS_STATUS &&
            before.resultUrl != null &&
            (resolvedResult == null)
          ) {
            node.status = "idle";
            mutated = true;
          }

          if (Array.isArray(node.characterReferenceUrls)) {
            const cleaned = node.characterReferenceUrls
              .map((x) => this.sanitizeDisplayUrlForPersist(x))
              .filter(Boolean);
            if (
              cleaned.length !== node.characterReferenceUrls.length ||
              cleaned.some((x, i) => x !== node.characterReferenceUrls[i])
            ) {
              node.characterReferenceUrls = cleaned;
              mutated = true;
            }
          }
        }

        // groups[*].storyContext.compositeImageUrl
        const groups = Array.isArray(canvasData.groups) ? canvasData.groups : [];
        for (const group of groups) {
          if (!group || typeof group !== "object") continue;
          const sc = group.storyContext;
          if (!sc || typeof sc !== "object") continue;
          if ("compositeImageUrl" in sc) {
            const before = sc.compositeImageUrl;
            if (before != null) {
              const safe = this.sanitizeDisplayUrlForPersist(before);
              if (safe !== before) {
                sc.compositeImageUrl = safe;
                mutated = true;
              }
            }
          }
        }
      }

      // Silence the linter about the unused destructure in strict mode.
      void actorId;
    }

    return mutated;
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
    const rawDur = parseFloat(String(shot?.durationSeconds || 4));
    const durationSeconds = Number.isFinite(rawDur) && rawDur > 0
      ? Math.round(Math.min(15, Math.max(1, rawDur)) * 10) / 10
      : 4;
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
      // Episode tracking – which episode this storyboard belongs to
      episodeNo: null, // set by makeStoryboardGenerateTask after creation
      // Expert-mode fields from storyboard breakdown prompt
      partNo: typeof shot?.partNo === "number" ? shot.partNo : null,
      partTitle: String(shot?.partTitle || "").trim() || null,
      weather: String(shot?.weather || "").trim() || null,
      camera: String(shot?.camera || "").trim() || null,
      blocking: String(shot?.blocking || "").trim() || null,
      // Legacy classification fields
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

  /**
   * Synchronous guard used at record-construction time. Returns ``value``
   * only if it is a shape that is safe to persist as a **display URL**:
   * ``null``, ``/uploads/*``, ``/vr-*``, or ``http(s)://...``. Base64 data
   * URLs, ``blob:`` URLs, ``[truncated:…]`` markers from an older snapshot,
   * or anything crazy-long is dropped to ``null`` so the UI can fall back
   * to a videoUrl-derived poster instead of rendering a broken image.
   *
   * This is belt-and-braces — the canonical sink is
   * ``sanitizeInlineReferenceImages`` run on input BEFORE we construct a
   * record — but any future refactor that forgets to call that sanitiser
   * will still be caught here.
   */
  sanitizeDisplayUrlForPersist(value) {
    if (value == null) return null;
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\[truncated:\d+chars\]$/.test(trimmed)) return null;
    if (trimmed.startsWith("data:")) return null;
    if (trimmed.startsWith("blob:")) return null;
    // Guardrail: if someone smuggles in a stringified buffer or very long
    // raw base64 without the ``data:`` prefix, refuse. Real /uploads/ URLs
    // are well under 512 chars.
    if (trimmed.length > 2048) return null;
    if (
      !trimmed.startsWith("/") &&
      !/^https?:\/\//i.test(trimmed)
    ) {
      return null;
    }
    return trimmed;
  }

  /**
   * Convert a `data:<mime>;base64,...` URL to a real file under /uploads/.
   *
   * Returns the **public `/uploads/<name>`-style URL** that is safe to persist
   * in `createStudioVideos`, task.metadata, and asset records without
   * bloating the SQLite snapshot. For any input that is not a data URL the
   * value is returned unchanged (caller can then decide whether it's already
   * safe).
   *
   * This is the canonical sink used by ``persistReferenceImageCandidates``
   * below — do NOT let a base64 data URL flow into persisted display state.
   */
  async persistDataUrlAsUpload(value, { kind, fallbackBaseName, fallbackContentType } = {}) {
    if (value == null || typeof value !== "string") return value;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const match = /^data:([^;,]+)(?:;charset=[^;,]+)?(;base64)?,(.*)$/is.exec(trimmed);
    if (!match) return trimmed; // not a data URL — pass through unchanged

    const mime = match[1] || fallbackContentType || "application/octet-stream";
    const isBase64 = Boolean(match[2]);
    const payload = match[3] || "";
    let buffer;
    try {
      buffer = isBase64
        ? Buffer.from(payload, "base64")
        : Buffer.from(decodeURIComponent(payload), "utf8");
    } catch (err) {
      console.warn(
        "[persistDataUrlAsUpload] failed to decode data URL (returning null):",
        err?.message || err,
      );
      return null;
    }
    if (!buffer.length) return null;

    const extension = this.getExtensionByContentType(mime, ".bin");
    const safeKind = kind || "inline-ref";
    const safeBaseName = fallbackBaseName || `${safeKind}_${Date.now()}`;
    try {
      const upload = await createUploadFromBuffer({
        buffer,
        kind: safeKind,
        originalName: `${safeBaseName}${extension}`,
        contentType: mime,
      });
      return `${this.getPublicBaseUrl()}${upload.urlPath}`;
    } catch (err) {
      console.warn(
        "[persistDataUrlAsUpload] createUploadFromBuffer failed (returning null):",
        err?.message || err,
      );
      return null;
    }
  }

  /**
   * Walk a group of candidate reference-image fields on a user-supplied
   * input and replace every inline ``data:`` URL with a real ``/uploads/``
   * URL.  This guarantees that neither ``task.metadata`` nor
   * ``createStudioVideos[...]`` ever get a base64 blob written into their
   * display fields — the exact failure mode that filled the demo DB with
   * ``[truncated:...chars]`` placeholders after a snapshot restore.
   *
   * Called at the top of the ``effect`` body of makeCreateVideoTask (and by
   * the load-time migration) so the sanitisation is uniform across both
   * the seed/reset path and the live-submit path.
   *
   * Mutates ``input`` in place AND returns it so callers can use either
   * style. Never throws: if a decode fails we leave the field ``null`` so
   * the UI can fall back to videoUrl-derived posters.
   */
  async sanitizeInlineReferenceImages(input, { taskLabel = "create-video" } = {}) {
    if (!input || typeof input !== "object") return input;

    const safeKind = `${taskLabel}-inline-ref`;
    const rewriteField = async (key, fallbackBaseName) => {
      const current = input[key];
      if (typeof current !== "string") return;
      const trimmed = current.trim();
      if (!trimmed) return;
      if (!trimmed.startsWith("data:")) return;
      const next = await this.persistDataUrlAsUpload(trimmed, {
        kind: safeKind,
        fallbackBaseName,
        fallbackContentType: "image/png",
      });
      input[key] = next || null;
    };

    await rewriteField("referenceImageUrl", `${taskLabel}_ref_${Date.now()}`);
    await rewriteField("firstFrameUrl", `${taskLabel}_first_${Date.now()}`);
    await rewriteField("lastFrameUrl", `${taskLabel}_last_${Date.now()}`);
    await rewriteField("thumbnailUrl", `${taskLabel}_thumb_${Date.now()}`);

    // referenceImageUrls: [url, ...] (used by image-create)
    if (Array.isArray(input.referenceImageUrls)) {
      const rewritten = [];
      for (let i = 0; i < input.referenceImageUrls.length; i += 1) {
        const candidate = input.referenceImageUrls[i];
        if (typeof candidate !== "string") continue;
        const trimmed = candidate.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith("data:")) {
          const next = await this.persistDataUrlAsUpload(trimmed, {
            kind: safeKind,
            fallbackBaseName: `${taskLabel}_ref_${i}_${Date.now()}`,
            fallbackContentType: "image/png",
          });
          if (next) rewritten.push(next);
        } else {
          rewritten.push(trimmed);
        }
      }
      input.referenceImageUrls = rewritten;
    }

    // multiReferenceImages: { slot: [url, ...] | url }
    if (input.multiReferenceImages && typeof input.multiReferenceImages === "object") {
      const out = {};
      for (const [slot, value] of Object.entries(input.multiReferenceImages)) {
        const list = Array.isArray(value) ? value : (value ? [value] : []);
        const rewritten = [];
        for (let i = 0; i < list.length; i += 1) {
          const candidate = list[i];
          if (typeof candidate !== "string") continue;
          const trimmed = candidate.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith("data:")) {
            const next = await this.persistDataUrlAsUpload(trimmed, {
              kind: safeKind,
              fallbackBaseName: `${taskLabel}_${slot}_${i}_${Date.now()}`,
              fallbackContentType: "image/png",
            });
            if (next) rewritten.push(next);
          } else {
            rewritten.push(trimmed);
          }
        }
        if (rewritten.length) out[slot] = rewritten;
      }
      input.multiReferenceImages = Object.keys(out).length ? out : null;
    }

    return input;
  }

  shouldNormalizeLocalUploadUrl(url, isVideo = false) {
    if (isVideo || url == null || typeof url !== "string") return false;
    const uploadPath = this.toUploadPath(url);
    if (!uploadPath) return false;
    // Include jpg/jpeg so that JPEG images uploaded via the manual "新增资产"
    // flow (or synced from create-image results) are properly rebranded to the
    // asset-image kind rather than keeping their original create-image prefix.
    return /\.(png|webp|bmp|jpe?g)$/i.test(uploadPath);
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
      if (!url || typeof url !== "string") return url;
      const t = url.trim();

      // blob: URLs are client-side-only object URLs that the server cannot
      // fetch. Storing them would produce permanently broken asset previews.
      if (t.startsWith("blob:")) {
        console.warn("[persistEphemeralAssetMedia] dropping client-only blob: URL —", suffix);
        return null;
      }

      // data: URLs (e.g. canvas.toDataURL() lastFrame, ImageEditor composite)
      // must be converted to real /uploads/ files before persisting. If we
      // store them as-is, sanitizePersistedDisplayUrls() will null them out on
      // the next core-api restart, causing asset previews to disappear.
      // For previewUrl on a video asset the data URL is always an image frame,
      // so use "asset-image" / "image/png" regardless of the outer mediaKind.
      if (t.startsWith("data:")) {
        const imagePreviewSuffix = suffix === "preview" || !isVideo;
        try {
          const uploaded = await this.persistDataUrlAsUpload(t, {
            kind: imagePreviewSuffix ? "asset-image" : kind,
            fallbackBaseName: `${nameSlug}-${suffix}`,
            fallbackContentType: imagePreviewSuffix ? "image/png" : fallbackContentType,
          });
          if (uploaded) return uploaded;
        } catch (err) {
          console.warn(
            "[persistEphemeralAssetMedia] data URL upload failed —",
            suffix,
            err?.message || err,
          );
        }
        return null; // drop rather than store raw base64 in the snapshot
      }

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
      // sourceModule: which product surface created this asset. Values:
      // "image_create" | "video_create" | "canvas" | "video_replace" | "agent_studio" | null
      sourceModule: input.sourceModule || null,
      sourceMetadata: normalizePlainObject(input.sourceMetadata),
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
      sourceModule: typeof asset.sourceModule === "string" ? asset.sourceModule : null,
      sourceMetadata: normalizePlainObject(asset.sourceMetadata),
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
            sourceModule: input.sourceModule ?? existingItems[0].sourceModule ?? null,
            sourceMetadata: input.sourceMetadata ?? existingItems[0].sourceMetadata ?? null,
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
            sourceModule: input.sourceModule ?? null,
            sourceMetadata: input.sourceMetadata ?? null,
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
      if (this.isDataUrl(value)) {
        return value;
      }

      // Prefer local file even for public-domain URLs — the file may live on this
      // server under a different origin (e.g. aitianmu.cn vs 127.0.0.1:4100).
      const dataUrl = this.createDataUrlFromUpload(value);
      if (dataUrl) return dataUrl;

      if (this.isProviderAccessibleUrl(value)) {
        return value;
      }
    }

    const error = new Error(
      "当前参考图不可用。请使用公网图片 URL，或先上传首帧/尾帧图片后再发起生成。"
    );
    error.statusCode = 400;
    error.code = "PROVIDER_IMAGE_NOT_ACCESSIBLE";
    throw error;
  }

  /**
   * Resolve any image URL (data:, /uploads/, public http) to a raw base64 string
   * (without the data: prefix) for Vertex API calls.
   */
  async resolveImageToBase64(url) {
    if (!url) return null;
    const normalized = String(url).trim();
    if (!normalized) return null;

    // Already a data URL — extract base64 part
    if (/^data:[^;]+;base64,/i.test(normalized)) {
      return normalized.split(",")[1];
    }

    // Local upload path or full URL pointing to local uploads
    const dataUrl = this.createDataUrlFromUpload(normalized);
    if (dataUrl && /^data:[^;]+;base64,/i.test(dataUrl)) {
      return dataUrl.split(",")[1];
    }

    // Public HTTP URL — fetch and convert
    if (/^https?:\/\//i.test(normalized)) {
      try {
        const resp = await fetch(normalized);
        if (!resp.ok) return null;
        const buf = await resp.arrayBuffer();
        return Buffer.from(buf).toString("base64");
      } catch {
        return null;
      }
    }

    return null;
  }

  inferVideoMimeType(value, fallback = null) {
    const normalized = String(value || "").split(";")[0].trim().toLowerCase();
    if (normalized === "video/mp4" || normalized === "video/mpeg" || normalized === "video/mpg") return normalized;
    if (normalized === "video/quicktime" || normalized === "video/mov") return "video/mov";
    if (normalized === "video/avi" || normalized === "video/wmv" || normalized === "video/flv") return normalized;
    if (/\.mp4(?:[?#].*)?$/i.test(String(value || ""))) return "video/mp4";
    if (/\.mov(?:[?#].*)?$/i.test(String(value || ""))) return "video/mov";
    if (/\.mpe?g(?:[?#].*)?$/i.test(String(value || ""))) return "video/mpeg";
    return fallback;
  }

  assertVertexExtendVideoMimeType(mimeType) {
    const normalized = this.inferVideoMimeType(mimeType);
    if (normalized !== "video/mp4") {
      throw apiError(
        400,
        "UNSUPPORTED_VERTEX_VIDEO_REFERENCE",
        "Vertex Veo video extension currently requires an MP4 reference video."
      );
    }
    return normalized;
  }

  async resolveVertexVideoInput(url) {
    if (!url) return null;
    const normalized = String(url).trim();
    if (!normalized) return null;

    if (/^gs:\/\//i.test(normalized)) {
      return {
        gcsUri: normalized,
        mimeType: "video/mp4",
      };
    }

    const dataUrlMatch = /^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/is.exec(normalized);
    if (dataUrlMatch) {
      const mimeType = this.assertVertexExtendVideoMimeType(dataUrlMatch[1]);
      return {
        bytesBase64Encoded: dataUrlMatch[2],
        mimeType,
      };
    }

    const uploadPath = this.toUploadPath(normalized);
    if (uploadPath) {
      const upload = readUploadByUrlPath(uploadPath);
      if (!upload) {
        throw apiError(400, "REFERENCE_VIDEO_NOT_FOUND", "Reference video upload could not be found.");
      }
      const mimeType = this.assertVertexExtendVideoMimeType(upload.contentType || upload.safeName || uploadPath);
      const buffer = readFileSync(upload.absolutePath);
      return {
        bytesBase64Encoded: buffer.toString("base64"),
        mimeType,
      };
    }

    if (/^https?:\/\//i.test(normalized)) {
      const response = await fetch(normalized);
      if (!response.ok) {
        throw apiError(502, "REFERENCE_VIDEO_FETCH_FAILED", `Reference video fetch failed: ${response.status}`);
      }
      const responseContentType = response.headers.get("content-type");
      const contentType =
        responseContentType && responseContentType.split(";")[0].trim().toLowerCase() !== "application/octet-stream"
          ? responseContentType
          : this.inferVideoMimeType(normalized);
      const mimeType = this.assertVertexExtendVideoMimeType(contentType || normalized);
      const buffer = Buffer.from(await response.arrayBuffer());
      return {
        bytesBase64Encoded: buffer.toString("base64"),
        mimeType,
      };
    }

    throw apiError(
      400,
      "PROVIDER_VIDEO_NOT_ACCESSIBLE",
      "Reference video must be an MP4 upload, data URL, public URL, or gs:// Cloud Storage URI."
    );
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
      budgetCredits: 0,
      budgetLimitCredits: 0,
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
        },
        actor.id
      );
    }

    return this.createProject(
      {
        title: `个人资产项目 ${timestamp}`,
        summary: "系统为当前账号自动初始化的个人资产项目。",
        ownerType: "personal",
      },
      actor.id
    );
  }

  updateProject(projectId, input, actorId) {
    const projectPatch = { ...(input || {}) };
    delete projectPatch.budgetCredits;
    delete projectPatch.budgetLimitCredits;
    delete projectPatch.budgetUsedCredits;
    const needsOrgAdmin =
      Object.prototype.hasOwnProperty.call(projectPatch, "billingPolicy") ||
      Object.prototype.hasOwnProperty.call(projectPatch, "billingWalletType");
    const project = this.assertProjectAccess(projectId, actorId, {
      requireOrgAdmin: needsOrgAdmin,
    });

    Object.assign(project, {
      ...projectPatch,
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

  saveProjectAsset(projectId, input) {
    if (!this.state.assetsByProjectId[projectId]) return null;

    const asset = this.upsertProjectAsset(this.state, projectId, {
      ...input,
      scope: input?.scope || "manual",
    });
    if (!asset) return null;

    this.touchProject(projectId, {
      currentStep: "assets",
      progressPercent: 36,
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
      qrCodePayload: createDemoRechargeQrPayload(input.paymentMethod || "wechat_pay"),
      qrCodeHint: getDemoRechargeQrHint(input.paymentMethod || "wechat_pay"),
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
    return clone(
      (this.state.createStudioImages || []).filter((item) =>
        this.canActorAccessScopedResourceOwner(actorId, this.getCreateStudioResultActorId(item))
      )
    );
  }

  listCreateVideos(actorId) {
    return clone(
      (this.state.createStudioVideos || []).filter((item) =>
        this.canActorAccessScopedResourceOwner(actorId, this.getCreateStudioResultActorId(item))
      )
    );
  }

  recordCreateStudioImage(input = {}, state = this.state) {
    if (!state.createStudioImages) {
      state.createStudioImages = [];
    }

    const imageUrl = String(input.imageUrl || "").trim();
    if (!imageUrl) return null;

    const taskId = typeof input.taskId === "string" && input.taskId.trim()
      ? input.taskId.trim()
      : null;
    const existing = taskId
      ? state.createStudioImages.find((item) => item.taskId === taskId)
      : null;
    const referenceImageUrls = sanitizeReferenceImageUrls(
      input.referenceImageUrls || (input.referenceImageUrl ? [input.referenceImageUrl] : []),
    );
    const record = {
      id: existing?.id || `create_img_${randomUUID().slice(0, 8)}`,
      actorId: this.resolveActorId(input.actorId),
      taskId,
      projectId: input.projectId || null,
      storyboardId: input.storyboardId || null,
      sourceAssetId: input.sourceAssetId || null,
      sourceModule: input.sourceModule || null,
      sourceTaskType: input.sourceTaskType || null,
      prompt: String(input.prompt || input.inputSummary || "Toolbox generated image").trim(),
      model: String(input.model || input.imageModel || "unknown").trim(),
      style: String(input.style || input.sourceModule || "toolbox").trim(),
      aspectRatio: String(input.aspectRatio || "1:1").trim(),
      resolution: String(input.resolution || input.imageQuality || "").trim(),
      referenceImageUrl: referenceImageUrls[0] || null,
      referenceImageUrls,
      imageUrl,
      createdAt: existing?.createdAt || input.createdAt || new Date().toISOString(),
    };

    if (existing) {
      Object.assign(existing, record);
      return clone(existing);
    }

    state.createStudioImages.unshift(record);
    return clone(record);
  }

  recordCompletedImageTask(input = {}) {
    const actorId = this.resolveActorId(input.actorId);
    const projectId = input.projectId || null;
    if (projectId) {
      this.assertProjectAccess(projectId, actorId);
    }

    const now = new Date().toISOString();
    const type = input.type || "toolbox_image_generate";
    const actionCode = input.actionCode || this.mapTaskTypeToActionCode(type);
    const task = {
      id: input.id || `task_${randomUUID().slice(0, 8)}`,
      type,
      domain: input.domain || "toolbox",
      projectId,
      storyboardId: input.storyboardId || null,
      actorId,
      actionCode,
      walletId: null,
      status: "succeeded",
      progressPercent: 100,
      currentStage: "completed",
      etaSeconds: 0,
      inputSummary: input.inputSummary || input.metadata?.prompt || type,
      outputSummary: input.outputSummary || "toolbox image completed",
      quotedCredits: 0,
      frozenCredits: 0,
      settledCredits: 0,
      billingStatus: "unbilled",
      metadata: {
        ...(input.metadata || {}),
        creditQuote: {
          credits: 0,
          walletId: null,
          canAfford: true,
        },
      },
      createdAt: input.createdAt || now,
      updatedAt: now,
    };

    this.state.tasks.unshift(task);
    this.emit("task.created", task);
    this.emit("task.completed", task);
    return clone(task);
  }

  getCreateImageCapabilities(mode) {
    const normalizedMode = String(mode || "").trim().toLowerCase();
    const defaultModel = "vertex:gemini-3-pro-image-preview";
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
      const items = listCreateVideoImageToVideoCapabilities();
      return {
        kind: "video",
        mode: normalizedMode,
        defaultModel: resolveCreateVideoDefaultModelFromItems(items),
        items,
      };
    }
    if (normalizedMode === "start_end_frame") {
      const items = listCreateVideoStartEndCapabilities();
      return {
        kind: "video",
        mode: "start_end_frame",
        defaultModel: resolveCreateVideoDefaultModelFromItems(items),
        items,
      };
    }
    if (normalizedMode === "multi_param") {
      const items = listCreateVideoMultiParamCapabilities();
      return {
        kind: "video",
        mode: "multi_param",
        defaultModel: resolveCreateVideoDefaultModelFromItems(items),
        items,
      };
    }
    if (normalizedMode === "video_edit") {
      const items = listCreateVideoEditCapabilities();
      return {
        kind: "video",
        mode: "video_edit",
        defaultModel: resolveCreateVideoDefaultModelFromItems(items, "pixverse-c1"),
        items,
      };
    }
    if (normalizedMode === "motion_control") {
      const items = listCreateVideoMotionControlCapabilities();
      return {
        kind: "video",
        mode: "motion_control",
        defaultModel: resolveCreateVideoDefaultModelFromItems(items, "pixverse-c1"),
        items,
      };
    }
    if (normalizedMode === "video_extend") {
      const items = listCreateVideoExtendCapabilities();
      return {
        kind: "video",
        mode: "video_extend",
        defaultModel: resolveCreateVideoDefaultModelFromItems(items, DEFAULT_CREATE_VIDEO_MODEL_ID),
        items,
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
    const index = (this.state.createStudioImages || []).findIndex((item) => item.id === id);
    if (index === -1) return null;
    const target = this.state.createStudioImages[index];
    if (!this.canActorAccessScopedResourceOwner(actorId, this.getCreateStudioResultActorId(target))) {
      throw apiError(403, "FORBIDDEN", "You do not have access to this image.");
    }
    const [removed] = this.state.createStudioImages.splice(index, 1);
    return clone(removed);
  }

  deleteCreateVideo(id, actorId) {
    const index = (this.state.createStudioVideos || []).findIndex((item) => item.id === id);
    if (index === -1) return null;
    const target = this.state.createStudioVideos[index];
    if (!this.canActorAccessScopedResourceOwner(actorId, this.getCreateStudioResultActorId(target))) {
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

  /**
   * Startup reconcile: any ``create_image_generate`` / ``create_video_generate``
   * task left in a non-terminal state by a previous process crash (or an
   * abandoned Vertex/Veo operation that never heartbeated back) would stay
   * "running" forever and keep the corresponding canvas node spinning.
   *
   * Mark anything whose updatedAt is older than ``staleAfterMs`` as failed so
   * the frontend can surface an actionable error and the user can retry.
   */
  reconcileStaleCreateTasks(staleAfterMs = 10 * 60 * 1000) {
    const now = Date.now();
    const tasks = Array.isArray(this.state?.tasks) ? this.state.tasks : [];
    const createTypes = new Set([
      "create_image_generate",
      "create_video_generate",
    ]);
    const nonTerminal = new Set(["queued", "pending", "running"]);
    let reaped = 0;
    for (const task of tasks) {
      if (!task || !createTypes.has(task.type)) continue;
      if (!nonTerminal.has(task.status)) continue;
      const updatedAt = Date.parse(task.updatedAt || task.createdAt || "");
      if (!Number.isFinite(updatedAt)) continue;
      if (now - updatedAt < staleAfterMs) continue;
      task.status = "failed";
      task.updatedAt = new Date().toISOString();
      task.error =
        task.error ||
        "任务在 core-api 重启前被中断（未收到结果）。请重新发起，本次不会产生扣费。";
      task.failureReason =
        task.failureReason ||
        "STARTUP_RECONCILE_STALE_NON_TERMINAL";
      this.emit("task.updated", task);
      reaped++;
    }
    return { scanned: tasks.length, reaped };
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
        const failurePatch = buildTaskFailurePatch(error);
        this.updateTask(taskId, {
          status: "failed",
          progressPercent: 100,
          currentStage: "failed",
          etaSeconds: 0,
          ...failurePatch
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

    let taskId = null;
    const task = this.createTask({
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

          this.recordCreateStudioImage({
            actorId: input.actorId,
            taskId,
            projectId,
            sourceAssetId: assetId,
            sourceModule: "toolbox_asset_image",
            sourceTaskType: "asset_image_generate",
            prompt: generationPrompt,
            model: imageModel,
            style: "asset_image",
            aspectRatio,
            resolution: input.resolution || match.imageQuality || "",
            referenceImageUrls,
            imageUrl: previewUrl,
          }, state);

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
    taskId = task.id;
    return task;
  }

  makeStoryboardGenerateTask(projectId, input) {
    const episodeNo = typeof input?.episodeNo === "number" && input.episodeNo > 0
      ? input.episodeNo
      : 1;
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

        const customSystemPrompt = typeof input?.systemPrompt === "string" && input.systemPrompt.trim()
          ? input.systemPrompt
          : null;
        const maxShots = typeof input?.maxShots === "number" && input.maxShots > 0
          ? input.maxShots
          : 12;
        // Expert mode calls qwen-plus with 8000 max_tokens and can take 100-250s
        // for a full-length script. Give it plenty of headroom.
        const timeoutMs = customSystemPrompt ? 300000 : 20000;

        if (hasAliyunApiKey()) {
          try {
            storyboardShots = await withTimeout(
              splitStoryboardsWithAliyun({
                content: sourceText,
                model: this.getNodePrimaryModel(
                  "storyboard_script",
                  this.getDefaultModelId("textModelId", "qwen-plus")
                ),
                systemPrompt: customSystemPrompt,
              }),
              timeoutMs,
              "Storyboard split provider timeout."
            );
            outputSource = "aliyun";
          } catch (error) {
            console.error("[store] splitStoryboardsWithAliyun failed:", error?.message || error);
            if (customSystemPrompt) {
              // Expert mode: no fallback – surface the error directly
              const err = new Error(error?.message || "Expert AI breakdown failed.");
              err.statusCode = 422;
              err.code = "STORYBOARD_SPLIT_FAILED";
              throw err;
            }
            storyboardShots = [];
          }
        }

        if (!storyboardShots.length) {
          if (customSystemPrompt) {
            // Expert mode – empty result is also a hard failure
            const error = new Error("Expert storyboard breakdown returned no shots.");
            error.statusCode = 422;
            error.code = "STORYBOARD_SPLIT_FAILED";
            throw error;
          }
          // Standard mode – fall back to heuristic
          console.warn("[store] AI split returned empty – using heuristic fallback");
          storyboardShots = this.buildStoryboardShotsFallback(sourceText);
        }

        if (!storyboardShots.length) {
          const error = new Error("Failed to split script into storyboard shots.");
          error.statusCode = 422;
          error.code = "STORYBOARD_SPLIT_FAILED";
          throw error;
        }

        const nextStoryboards = storyboardShots
          .slice(0, maxShots)
          .map((shot, index) => {
            const record = this.createStoryboardRecord(projectId, shot, index + 1);
            record.episodeNo = episodeNo;
            return record;
          });

        // Only replace storyboards belonging to this episode; keep other episodes intact
        const existing = state.storyboardsByProjectId[projectId] || [];
        state.storyboardsByProjectId[projectId] = [
          ...existing.filter((s) => (s.episodeNo ?? 1) !== episodeNo),
          ...nextStoryboards,
        ];

        this.touchProject(projectId, {
          currentStep: "storyboards",
          progressPercent: 52
        });

        return `${outputSource} storyboard split completed (${nextStoryboards.length} shots, episode ${episodeNo})`;
      }
    });
  }

  makeImageGenerateTask(storyboardId, input) {
    const storyboard = this.findStoryboard(storyboardId);
    const initialReferenceImageUrls = sanitizeReferenceImageUrls(
      input?.referenceImageUrls || (input?.referenceImageUrl ? [input.referenceImageUrl] : []),
    );
    if (storyboard) {
      storyboard.imageStatus = "queued";
      if (initialReferenceImageUrls.length) {
        storyboard.referenceImageUrls = initialReferenceImageUrls;
      }
      if (input?.imageModel || input?.model) {
        storyboard.modelName = input.imageModel || input.model;
      }
      storyboard.updatedAt = new Date().toISOString();
    }

    let taskId = null;
    const task = this.createTask({
      type: "storyboard_image_generate",
      domain: "storyboards",
      projectId: storyboard?.projectId || null,
      storyboardId,
      inputSummary: input?.prompt || "Generate storyboard image",
      metadata: input,
      effect: async (state) => {
        if (input && typeof input === "object") {
          await this.sanitizeInlineReferenceImages(input, { taskLabel: "storyboard-image" });
        }
        const match = this.findStoryboardInState(state, storyboardId);
        if (!match) return;

        const prompt = String(input?.prompt || match.script || match.promptSummary || "").trim();
        const referenceImageUrls = sanitizeReferenceImageUrls(
          input?.referenceImageUrls ||
            (input?.referenceImageUrl ? [input.referenceImageUrl] : match.referenceImageUrls || []),
        );
        const defaultImageModel = this.getNodePrimaryModel(
          "storyboard_image",
          this.getDefaultModelId("imageModelId", "gemini-3-pro-image-preview"),
        );
        let resolvedModel = resolveCreateImageModel(
          input?.imageModel || input?.model || match.modelName,
          referenceImageUrls.length,
          defaultImageModel,
        );
        const aspectRatioInput = resolveCreateImageAspectRatio(
          resolvedModel,
          input?.aspectRatio || match.aspectRatio || "16:9",
          referenceImageUrls.length,
        );
        const resolutionInput = resolveCreateImageResolution(
          resolvedModel,
          input?.resolution || input?.imageQuality || match.imageQuality || "",
          referenceImageUrls.length,
        );
        const normalizedAspectRatio = aspectRatioInput.normalizedAspectRatio || "16:9";
        const normalizedResolution = resolutionInput.normalizedResolution || "";

        Object.assign(match, {
          imageStatus: "running",
          referenceImageUrls,
          modelName: resolvedModel,
          aspectRatio: normalizedAspectRatio,
          imageQuality: normalizedResolution || match.imageQuality || "",
          updatedAt: new Date().toISOString(),
        });

        const providerConfigured = isMediaGenerationModelConfigured("image", resolvedModel);
        if (providerConfigured) {
          const resolvedReferenceImageUrls = [];
          for (const url of referenceImageUrls) {
            const rawUrl = String(url || "").trim();
            if (!rawUrl) continue;
            const providerUrl = this.resolveProviderImageSource(rawUrl);
            if (providerUrl) {
              resolvedReferenceImageUrls.push(providerUrl);
            }
          }
          const referenceCount = resolvedReferenceImageUrls.length;
          resolvedModel = resolveCreateImageModel(
            input?.imageModel || input?.model || match.modelName,
            referenceCount,
            defaultImageModel,
          );
          assertMediaGenerationModelConfigured("image", resolvedModel);
          const providerPrompt = buildMultiReferenceImagePrompt(prompt, referenceCount);
          const providerReferenceImageUrl = referenceCount ? resolvedReferenceImageUrls[0] : null;
          const providerReferenceImageUrls = referenceCount ? resolvedReferenceImageUrls : [];
          const generate = () => {
            if (vertex.isVertexImageModel(resolvedModel)) {
              return vertex.generateVertexGeminiImages({
                internalModelId: resolvedModel,
                prompt: providerPrompt,
                count: 1,
                aspectRatio: normalizedAspectRatio,
                resolution: normalizedResolution,
                referenceImageUrl: providerReferenceImageUrl,
                referenceImageUrls: providerReferenceImageUrls,
                negativePrompt: input?.negativePrompt || "",
              });
            }
            return generateImagesWithAliyun({
              prompt: providerPrompt,
              model: normalizeModelId(resolvedModel),
              aspectRatio: normalizedAspectRatio,
              resolution: normalizedResolution,
              count: 1,
              negativePrompt: input?.negativePrompt || "",
              referenceImageUrl: providerReferenceImageUrl,
              referenceImageUrls: providerReferenceImageUrls,
            });
          };

          const [generatedImageUrl] = await generate();
          if (!generatedImageUrl) {
            throw apiError(502, "GENERATION_EMPTY", "Storyboard image provider returned no image.");
          }
          let finalImageUrl = generatedImageUrl;
          if (/^data:/i.test(finalImageUrl || "")) {
            const matchDataUrl = String(finalImageUrl).match(/^data:([^;]+);base64,(.+)$/i);
            if (matchDataUrl) {
              const upload = await createUploadFromBuffer({
                buffer: Buffer.from(matchDataUrl[2], "base64"),
                kind: "storyboard-image",
                originalName: `storyboard_${storyboardId}_${Date.now()}.${matchDataUrl[1].includes("png") ? "png" : "jpg"}`,
                contentType: matchDataUrl[1],
              });
              finalImageUrl = `${this.getPublicBaseUrl()}${upload.urlPath}`;
            }
          } else if (/^https?:\/\//i.test(finalImageUrl || "")) {
            finalImageUrl =
              (await this.mirrorRemoteAssetToUpload({
                url: finalImageUrl,
                kind: "storyboard-image",
                fallbackBaseName: storyboardId,
                fallbackContentType: "image/jpeg",
              })) || finalImageUrl;
          }
          match.imageUrl = finalImageUrl;
        } else {
          match.imageUrl = `https://mock.assets.local/storyboards/${storyboardId}_${Date.now()}.jpg`;
        }
        Object.assign(match, {
          imageStatus: "ready",
          referenceImageUrls,
          modelName: resolvedModel,
          aspectRatio: normalizedAspectRatio,
          imageQuality: normalizedResolution || match.imageQuality || "",
          updatedAt: new Date().toISOString(),
        });

        this.recordCreateStudioImage({
          actorId: input?.actorId,
          taskId,
          projectId: match.projectId,
          storyboardId,
          sourceModule: "toolbox_storyboard_image",
          sourceTaskType: "storyboard_image_generate",
          prompt,
          model: resolvedModel,
          style: "storyboard_image",
          aspectRatio: normalizedAspectRatio,
          resolution: normalizedResolution || match.imageQuality || "",
          referenceImageUrls,
          imageUrl: match.imageUrl,
        }, state);

        this.touchProject(match.projectId, {
          currentStep: "storyboards",
          progressPercent: 60
        });

        return providerConfigured ? "provider storyboard image completed" : "mock storyboard image completed";
      }
    });
    taskId = task.id;
    return task;
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
    // ── Idempotency / double-submit dedup ─────────────────────────────
    // Prefer an explicit idempotency key from the client. If absent, fall
    // back to a rolling content fingerprint so rapid double-clicks from the
    // same actor merge into the existing task instead of burning two
    // provider calls.
    const _idempotencyKey = input?.idempotencyKey ? String(input.idempotencyKey).trim() : "";
    if (_idempotencyKey) {
      const existing = this._lookupIdempotentTask(resultActorId, _idempotencyKey);
      if (existing) {
        console.log(
          `[makeCreateImageTask] idempotency hit actor=${resultActorId} key=${_idempotencyKey} -> ${existing.id}`,
        );
        return existing;
      }
    }
    const _fingerprint = _fingerprintCreateImageInput(input);
    const _contentDup = this._lookupRecentContentDup(resultActorId, _fingerprint);
    if (_contentDup) {
      console.log(
        `[makeCreateImageTask] content-dedup hit actor=${resultActorId} -> ${_contentDup.id}`,
      );
      if (_idempotencyKey) this._rememberIdempotentTask(resultActorId, _idempotencyKey, _contentDup.id);
      return _contentDup;
    }
    const preflightReferenceImageUrls = sanitizeReferenceImageUrls(
      input?.referenceImageUrls || (input?.referenceImageUrl ? [input.referenceImageUrl] : []),
    );
    const preflightDefaultImageModel = this.getDefaultModelId(
      "imageModelId",
      "gemini-3-pro-image-preview",
    );
    const preflightResolvedImageModel = resolveCreateImageModel(
      input?.model,
      preflightReferenceImageUrls.length,
      preflightDefaultImageModel,
    );
    assertMediaGenerationModelConfigured("image", preflightResolvedImageModel);
    let taskId = null;
    const task = this.createTask({
      type: "create_image_generate",
      domain: "create",
      projectId: input?.projectId || null,
      inputSummary: input?.prompt || "Generate standalone image",
      metadata: input,
      effect: async (state) => {
        // Sanitise inline data:base64 reference images BEFORE anything reads
        // them. Same rationale as makeCreateVideoTask: we must never persist
        // a megabyte-sized data URL into task.metadata / createStudioImages.
        await this.sanitizeInlineReferenceImages(input, { taskLabel: "create-image" });
        if (taskId) {
          this.updateTask(taskId, { metadata: input });
        }

        const requestedOutputCount = Math.max(1, Math.floor(Number(input?.count) || 1));
        let count = 1;
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
        let requestedAspectRatio = input?.aspectRatio;
        let requestedResolution = input?.resolution;
        let activeReferenceCount = referenceImageUrls.length;
        let resolveImageOptionsForModel = (
          _modelId,
          _referenceCountForModel = activeReferenceCount,
        ) => ({
          aspectRatio: input?.aspectRatio || "1:1",
          resolution: input?.resolution || "",
        });
        if (assertMediaGenerationModelConfigured("image", resolvedModel)) {
          const resolvedReferenceImageUrls = [];
          for (const url of referenceImageUrls) {
            const rawUrl = String(url || "").trim();
            if (!rawUrl) continue;
            let candidate = rawUrl;
            try {
              const parsed = new URL(rawUrl);
              const expiresRaw = parsed.searchParams.get("Expires") || parsed.searchParams.get("expires");
              const isLikelyExpiringRemoteRef =
                (expiresRaw != null && Number.isFinite(Number(expiresRaw))) ||
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
          resolvedModel = resolveCreateImageModel(
            input?.model,
            resolvedReferenceImageUrls.length,
            defaultImageModel,
          );
          assertMediaGenerationModelConfigured("image", resolvedModel);
          const referenceCapability = getCreateImageCapabilitySetForMode(
            resolvedModel,
            resolvedReferenceImageUrls.length,
          );
          const maxReferenceImages = Math.max(
            0,
            Math.floor(Number(referenceCapability?.maxReferenceImages) || 0),
          );
          const providerReferenceUrlsForModel = resolvedReferenceImageUrls.length
            ? maxReferenceImages > 0
              ? resolvedReferenceImageUrls.slice(0, maxReferenceImages)
              : []
            : [];
          const primaryResolved = providerReferenceUrlsForModel[0] || null;
          const multiRefResolvedCount = providerReferenceUrlsForModel.length;
          const resolvedAspectRatioInput = resolveCreateImageAspectRatio(
            resolvedModel,
            input?.aspectRatio,
            multiRefResolvedCount,
          );
          requestedAspectRatio = resolvedAspectRatioInput.requestedAspectRatio;
          const normalizedAspectRatio = resolvedAspectRatioInput.normalizedAspectRatio;
          const resolvedResolutionInput = resolveCreateImageResolution(
            resolvedModel,
            input?.resolution,
            multiRefResolvedCount,
          );
          requestedResolution = resolvedResolutionInput.requestedResolution;
          const normalizedResolution = resolvedResolutionInput.normalizedResolution;
          activeReferenceCount = multiRefResolvedCount;
          const resolvedOutputCountInput = resolveCreateImageOutputCount(
            resolvedModel,
            requestedOutputCount,
            activeReferenceCount,
          );
          count = resolvedOutputCountInput.normalizedCount;
          resolveImageOptionsForModel = (modelId, referenceCountForModel = activeReferenceCount) => ({
            aspectRatio: resolveCreateImageAspectRatio(
              modelId,
              requestedAspectRatio || normalizedAspectRatio,
              referenceCountForModel,
            ).normalizedAspectRatio || "1:1",
            resolution: resolveCreateImageResolution(
              modelId,
              requestedResolution || normalizedResolution,
              referenceCountForModel,
            ).normalizedResolution,
          });
          const currentProviderOptions = resolveImageOptionsForModel(resolvedModel);
          if (taskId) {
            this.updateTask(taskId, {
              metadata: {
                ...input,
                model: resolvedModel,
                aspectRatio: currentProviderOptions.aspectRatio,
                resolution: currentProviderOptions.resolution,
                count,
                requestedCount: requestedOutputCount,
                maxOutputImages: resolvedOutputCountInput.maxOutputImages,
                requestedAspectRatio,
                requestedResolution,
              },
            });
          }

          const providerPrompt = buildMultiReferenceImagePrompt(
            resolvedPrompt,
            multiRefResolvedCount,
          );

          const isReferenceDriven = multiRefResolvedCount >= 1;
          const providerReferenceImageUrl = isReferenceDriven ? primaryResolved : null;
          const providerReferenceImageUrls = isReferenceDriven ? providerReferenceUrlsForModel : [];
          const userAskedMultiRef = referenceImageUrls.length >= 2;
          const multiRefNegativeExtra =
            "禁止只绘制或只保留第一张参考图中的人物，禁止忽略其他参考图中需要出现的人物；禁止不做场景融合就原样输出任意一张输入参考图。";
          const negativeForMultiRef = [String(input?.negativePrompt || "").trim(), multiRefNegativeExtra]
            .filter(Boolean)
            .join("\n");

          // Route to Vertex provider for vertex:* models
          const isVertexImageModel = vertex.isVertexImageModel(resolvedModel);

          const runPrimary = () => {
            if (isVertexImageModel) {
              return vertex.generateVertexGeminiImages({
                internalModelId: resolvedModel,
                prompt: providerPrompt,
                count,
                aspectRatio: currentProviderOptions.aspectRatio,
                resolution: currentProviderOptions.resolution,
                referenceImageUrl: providerReferenceImageUrl,
                referenceImageUrls: providerReferenceImageUrls,
                negativePrompt:
                  multiRefResolvedCount >= 2 ? negativeForMultiRef : input?.negativePrompt || "",
              });
            }
            return generateImagesWithAliyun({
              prompt: providerPrompt,
              model: normalizeModelId(resolvedModel),
              aspectRatio: currentProviderOptions.aspectRatio,
              resolution: currentProviderOptions.resolution,
              count,
              negativePrompt:
                multiRefResolvedCount >= 2 ? negativeForMultiRef : input?.negativePrompt || "",
              referenceImageUrl: providerReferenceImageUrl,
              referenceImageUrls: providerReferenceImageUrls,
            });
          };

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
                const fallbackOptions = resolveImageOptionsForModel("gemini-3.1-flash-image-preview", 1);
                count = resolveCreateImageOutputCount("gemini-3.1-flash-image-preview", requestedOutputCount, 1).normalizedCount;
                imageUrls = await generateImagesWithAliyun({
                  prompt: resolvedPrompt,
                  model: "gemini-3.1-flash-image-preview",
                  aspectRatio: fallbackOptions.aspectRatio,
                  resolution: fallbackOptions.resolution,
                  count,
                  negativePrompt: input?.negativePrompt || "",
                  referenceImageUrl: primaryResolved,
                  referenceImageUrls: [],
                });
                resolvedModel = "gemini-3.1-flash-image-preview";
                activeReferenceCount = 1;
              } catch (singleRefError) {
                console.error("[makeCreateImageTask] single-ref fallback failed:", singleRefError?.message || singleRefError);
                console.log("[makeCreateImageTask] fallback → pure text-to-image gemini-3.1-flash-image-preview");
                const fallbackOptions = resolveImageOptionsForModel("gemini-3.1-flash-image-preview", 0);
                count = resolveCreateImageOutputCount("gemini-3.1-flash-image-preview", requestedOutputCount, 0).normalizedCount;
                imageUrls = await generateImagesWithAliyun({
                  prompt: resolvedPrompt,
                  model: "gemini-3.1-flash-image-preview",
                  aspectRatio: fallbackOptions.aspectRatio,
                  resolution: fallbackOptions.resolution,
                  count,
                  negativePrompt: input?.negativePrompt || "",
                  referenceImageUrl: null,
                  referenceImageUrls: [],
                });
                resolvedModel = "gemini-3.1-flash-image-preview";
                activeReferenceCount = 0;
              }
            } else if (resolvedReferenceImageUrls.length) {
              console.log("[makeCreateImageTask] fallback → pure text-to-image gemini-3.1-flash-image-preview");
              const fallbackOptions = resolveImageOptionsForModel("gemini-3.1-flash-image-preview", 0);
              count = resolveCreateImageOutputCount("gemini-3.1-flash-image-preview", requestedOutputCount, 0).normalizedCount;
              imageUrls = await generateImagesWithAliyun({
                prompt: resolvedPrompt,
                model: "gemini-3.1-flash-image-preview",
                aspectRatio: fallbackOptions.aspectRatio,
                resolution: fallbackOptions.resolution,
                count,
                negativePrompt: input?.negativePrompt || "",
                referenceImageUrl: null,
                referenceImageUrls: [],
              });
              resolvedModel = "gemini-3.1-flash-image-preview";
              activeReferenceCount = 0;
            } else if (shouldRetryPureTextWithGemini(primaryError)) {
              console.log("[makeCreateImageTask] fallback -> pure text-to-image gemini-3-pro-image-preview after Seedream policy rejection");
              const fallbackOptions = resolveImageOptionsForModel("gemini-3-pro-image-preview", 0);
              count = resolveCreateImageOutputCount("gemini-3-pro-image-preview", requestedOutputCount, 0).normalizedCount;
              imageUrls = await generateImagesWithAliyun({
                prompt: resolvedPrompt,
                model: "gemini-3-pro-image-preview",
                aspectRatio: fallbackOptions.aspectRatio,
                resolution: fallbackOptions.resolution,
                count,
                negativePrompt: input?.negativePrompt || "",
                referenceImageUrl: null,
                referenceImageUrls: [],
              });
              resolvedModel = "gemini-3-pro-image-preview";
              activeReferenceCount = 0;
            } else {
              throw primaryError;
            }
          }
        }

        const finalImageOptions = getCreateImageCapabilitySetForMode(resolvedModel, activeReferenceCount)?.supported
          ? resolveImageOptionsForModel(resolvedModel, activeReferenceCount)
          : { aspectRatio: input?.aspectRatio || "1:1", resolution: input?.resolution || "" };
        if (taskId) {
          this.updateTask(taskId, {
            metadata: {
              ...input,
              model: resolvedModel,
              aspectRatio: finalImageOptions.aspectRatio,
              resolution: finalImageOptions.resolution,
              count,
              requestedCount: requestedOutputCount,
              requestedAspectRatio,
              requestedResolution,
            },
          });
        }
        const mirroredImageUrls = [];
        for (let index = 0; index < count; index += 1) {
          let finalUrl = imageUrls?.[index] || `https://mock.assets.local/create/images/${Date.now()}_${index}.jpg`;
          // Vertex Gemini returns data: URLs — persist them as local uploads
          if (/^data:/i.test(finalUrl)) {
            try {
              const m = finalUrl.match(/^data:([^;]+);base64,(.+)$/i);
              if (m) {
                const buf = Buffer.from(m[2], "base64");
                const ext = m[1].includes("png") ? ".png" : ".jpg";
                const upload = await createUploadFromBuffer({
                  buffer: buf,
                  kind: "create-image",
                  originalName: `vertex_img_${Date.now()}_${index}${ext}`,
                  contentType: m[1],
                });
                finalUrl = `${this.getPublicBaseUrl()}${upload.urlPath}`;
              }
            } catch (dataUrlErr) {
              console.warn("[makeCreateImageTask] data URL upload failed:", dataUrlErr?.message);
            }
          } else if (/^https?:\/\//i.test(finalUrl)) {
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
            aspectRatio: finalImageOptions.aspectRatio,
            resolution: finalImageOptions.resolution,
            referenceImageUrl: primaryReference || null,
            referenceImageUrls,
            batchIndex: index,
            imageUrl: mirroredImageUrls[index] || imageUrls?.[index] || `https://mock.assets.local/create/images/${Date.now()}_${index}.jpg`,
            createdAt: timestamp
          };
          state.createStudioImages.unshift(createdImage);
          // NOTE: No auto-sync to project asset library. All three surfaces
          // (image-create, video-create, canvas) use manual user-triggered
          // sync via POST /api/projects/:projectId/assets instead.
        }

        return "provider create image completed";
      }
    });
    taskId = task.id;
    this._rememberRecentContent(resultActorId, _fingerprint, task.id);
    if (_idempotencyKey) this._rememberIdempotentTask(resultActorId, _idempotencyKey, task.id);
    return task;
  }

  makeCreateVideoTask(input) {
    if (input?.videoMode) {
      input = { ...input, videoMode: normalizeVideoMode(input.videoMode) };
    }
    // Normalize durationSeconds → duration so all downstream code reads the same field.
    // The REST API accepts both; durationSeconds (number) takes priority if duration is absent.
    if (input?.durationSeconds != null && !input?.duration) {
      input = { ...input, duration: `${Math.round(Number(input.durationSeconds))}s` };
    }
    const resultActorId = this.resolveActorId(input?.actorId);
    // ── Idempotency / double-submit dedup (same strategy as image path) ─
    const _idempotencyKey = input?.idempotencyKey ? String(input.idempotencyKey).trim() : "";
    if (_idempotencyKey) {
      const existing = this._lookupIdempotentTask(resultActorId, _idempotencyKey);
      if (existing) {
        console.log(
          `[makeCreateVideoTask] idempotency hit actor=${resultActorId} key=${_idempotencyKey} -> ${existing.id}`,
        );
        return existing;
      }
    }
    const _fingerprint = _fingerprintCreateVideoInput(input);
    const _contentDup = this._lookupRecentContentDup(resultActorId, _fingerprint);
    if (_contentDup) {
      console.log(
        `[makeCreateVideoTask] content-dedup hit actor=${resultActorId} -> ${_contentDup.id}`,
      );
      if (_idempotencyKey) this._rememberIdempotentTask(resultActorId, _idempotencyKey, _contentDup.id);
      return _contentDup;
    }
    const preflightMultiRef = sanitizeMultiReferenceImages(input?.multiReferenceImages);
    const preflightMultiRefCount = Object.keys(preflightMultiRef).length;
    const preflightDirectReferenceSource =
      typeof input?.referenceImageUrl === "string" ? String(input.referenceImageUrl).trim() || null : null;
    const preflightReferenceVideoUrls = sanitizeReferenceMediaUrls(input?.referenceVideoUrls, 3);
    const preflightMotionReferenceVideoUrl =
      String(input?.motionReferenceVideoUrl || preflightReferenceVideoUrls[0] || "").trim() || null;
    const preflightCharacterReferenceImageUrl =
      String(input?.characterReferenceImageUrl || "").trim() || null;
    const preflightReferenceSource =
      pickPrimaryMultiReferenceUrl(preflightMultiRef) ||
      preflightCharacterReferenceImageUrl ||
      preflightDirectReferenceSource ||
      preflightMotionReferenceVideoUrl;
    const preflightInputMode =
      input?.videoMode === "image_to_video"
        ? preflightDirectReferenceSource
          ? "single_reference"
          : "text_to_video"
        : input?.videoMode || null;
    if (input?.videoMode === "video_edit" || input?.videoMode === "video_extend") {
      if (!preflightMotionReferenceVideoUrl) {
        throw apiError(400, "MISSING_REFERENCE_VIDEO", "This video mode requires a reference video.");
      }
    }
    if (input?.videoMode === "motion_control") {
      if (!preflightCharacterReferenceImageUrl && !preflightDirectReferenceSource && !pickPrimaryMultiReferenceUrl(preflightMultiRef)) {
        throw apiError(400, "MISSING_CHARACTER_REFERENCE_IMAGE", "Motion-control mode requires a character reference image.");
      }
    }
    if (input?.videoMode === "start_end_frame") {
      if (!String(input?.firstFrameUrl || "").trim()) {
        throw apiError(400, "MISSING_FIRST_FRAME", "首尾帧模式缺少首帧。");
      }
      if (!String(input?.lastFrameUrl || "").trim()) {
        throw apiError(400, "MISSING_LAST_FRAME", "首尾帧模式缺少尾帧。");
      }
    }
    const defaultVideoModel =
      resolveCreateVideoDefaultModelForMode(input?.videoMode || null) ||
      DEFAULT_CREATE_VIDEO_MODEL_ID;
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
    assertMediaGenerationModelConfigured("video", preflightResolvedModel);

    let taskId = null;
    const task = this.createTask({
      type: "create_video_generate",
      domain: "create",
      projectId: input?.projectId || null,
      inputSummary: input?.prompt || "Generate standalone video",
      metadata: input,
      effect: async (state) => {
        const timestamp = new Date().toISOString();
        let thumbnailUrl = `https://mock.assets.local/create/videos/${Date.now()}.jpg`;
        let videoUrl = `https://mock.assets.local/create/videos/${Date.now()}.mp4`;

        // ── Sanitise inline data:base64 reference images FIRST. ─────────
        // Before this pass, frontend submits containing pasted/copied
        // screenshots could put a ~1 MB data URL into ``referenceImageUrl``
        // et al. That blob then flowed straight into task.metadata and
        // createStudioVideos[...], and the SQLite snapshot serializer
        // truncated it to ``[truncated:XXXchars]`` on restart. Persist the
        // blob to /uploads/ once and rewrite input in place so every
        // downstream consumer (metadata, display record, provider call)
        // sees the clean ``/uploads/*`` URL.
        await this.sanitizeInlineReferenceImages(input, { taskLabel: "create-video" });
        if (taskId) {
          this.updateTask(taskId, { metadata: input });
        }

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
        const referenceVideoUrls = sanitizeReferenceMediaUrls(input?.referenceVideoUrls, 3);
        const referenceAudioUrls = sanitizeReferenceMediaUrls(input?.referenceAudioUrls, 3);
        const motionReferenceVideoUrl =
          String(input?.motionReferenceVideoUrl || referenceVideoUrls[0] || "").trim() || null;
        const characterReferenceImageUrl =
          String(input?.characterReferenceImageUrl || directReferenceSource || primaryMultiUrl || "").trim() || null;
        const currentCreateVideoInputMode =
          input?.videoMode === "image_to_video"
            ? directReferenceSource
              ? "single_reference"
              : "text_to_video"
            : input?.videoMode || null;
        if ((input?.videoMode === "video_edit" || input?.videoMode === "video_extend") && !motionReferenceVideoUrl) {
          throw apiError(400, "MISSING_REFERENCE_VIDEO", "This video mode requires a reference video.");
        }
        if (input?.videoMode === "motion_control") {
          if (!characterReferenceImageUrl) {
            throw apiError(400, "MISSING_CHARACTER_REFERENCE_IMAGE", "Motion-control mode requires a character reference image.");
          }
        }
        if (input?.videoMode === "start_end_frame") {
          if (!firstFrameResolved) {
            throw apiError(400, "MISSING_FIRST_FRAME", "首尾帧模式缺少首帧。");
          }
          if (!lastFrameResolved) {
            throw apiError(400, "MISSING_LAST_FRAME", "首尾帧模式缺少尾帧。");
          }
        }
        const defaultVideoModel =
          resolveCreateVideoDefaultModelForMode(input?.videoMode || null) ||
          DEFAULT_CREATE_VIDEO_MODEL_ID;
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
        const resolvedCharacterReferenceImageUrl = characterReferenceImageUrl
          ? this.resolveProviderImageSource(characterReferenceImageUrl)
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
              const expiresRaw = parsed.searchParams.get("Expires") || parsed.searchParams.get("expires");
              const isLikelyExpiringRemoteRef =
                (expiresRaw != null && Number.isFinite(Number(expiresRaw))) ||
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
          // ── Vertex Veo path ────────────────────────────────────────────────
          if (vertex.isVertexVideoModel(resolvedModel)) {
            const VEO_SUPPORTED_SECONDS = [4, 6, 8];
            const isVertexVideoExtend = input?.videoMode === "video_extend";
            const rawDurationSeconds = parseInt(String(normalizedDuration || "8s")) || 8;
            const durationSeconds = VEO_SUPPORTED_SECONDS.includes(rawDurationSeconds)
              ? rawDurationSeconds
              : VEO_SUPPORTED_SECONDS.reduce((best, s) =>
                  Math.abs(s - rawDurationSeconds) < Math.abs(best - rawDurationSeconds) ? s : best
                );
            const vertexReferenceImages = !isVertexVideoExtend && isMultiParam
              ? await Promise.all(
                  resolvedMultiReferenceImageUrls
                    .filter(Boolean)
                    .slice(0, 3)
                    .map((url) => this.resolveImageToBase64(url))
                )
              : [];
            if (!isVertexVideoExtend && isMultiParam && !vertexReferenceImages.length) {
              throw apiError(400, "MISSING_REFERENCE_IMAGE", "Vertex 多参考图视频至少需要 1 张有效参考图。");
            }
            const referenceBase64 = !isVertexVideoExtend && resolvedReferenceImageUrl
              ? await this.resolveImageToBase64(resolvedReferenceImageUrl)
              : null;
            const lastFrameBase64 = !isVertexVideoExtend && lastFrameResolved
              ? await this.resolveImageToBase64(lastFrameResolved)
              : null;
            const firstFrameBase64 = !isVertexVideoExtend && firstFrameResolved
              ? await this.resolveImageToBase64(firstFrameResolved)
              : null;
            const vertexReferenceVideo = isVertexVideoExtend
              ? await this.resolveVertexVideoInput(motionReferenceVideoUrl || referenceVideoUrls[0])
              : null;
            if (isVertexVideoExtend && !vertexReferenceVideo) {
              throw apiError(400, "MISSING_REFERENCE_VIDEO", "Vertex video extension requires one MP4 reference video.");
            }

            const opName = await vertex.startVertexVeoTask({
              internalModelId: resolvedModel,
              prompt: promptForProvider,
              referenceImageBase64: referenceBase64 || firstFrameBase64,
              referenceImages: vertexReferenceImages,
              lastFrameBase64,
              referenceVideoBase64: vertexReferenceVideo?.bytesBase64Encoded,
              referenceVideoGcsUri: vertexReferenceVideo?.gcsUri,
              referenceVideoMimeType: vertexReferenceVideo?.mimeType,
              aspectRatio: normalizedAspectRatio || "16:9",
              durationSeconds: isVertexVideoExtend ? undefined : durationSeconds,
              resolution: normalizedResolution || "720p",
              generateAudio: input?.generateAudio || false,
              seed: input?.seed || undefined,
            });

            console.log("[makeCreateVideoTask:vertex] started operation", opName);
            const veoResult = await vertex.waitForVertexVeoOperation(opName, {
              timeoutMs: 12 * 60 * 1000,
              intervalMs: 10000,
              onProgress: (frac, msg) => console.log(`[makeCreateVideoTask:vertex] ${msg}`),
            });

            const upload = await vertex.downloadGCSVideoToUpload(veoResult.videoGcsUri);
            const publicVideoUrl = `${this.getPublicBaseUrl()}${upload.urlPath}`;

            const createdVideoId = `create_vid_${randomUUID().slice(0, 8)}`;
            state.createStudioVideos.unshift({
              id: createdVideoId,
              actorId: resultActorId,
              taskId,
              prompt: userFacingPrompt,
              model: formatCreateVideoModelLabel(resolvedModel),
              duration: requestedDuration,
              aspectRatio: requestedAspectRatio,
              resolution: requestedResolution || "720p",
              outputDuration: normalizedDuration,
              outputAspectRatio: normalizedAspectRatio,
              requestedResolution,
              outputResolution: normalizedResolution,
              referenceImageUrl: this.sanitizeDisplayUrlForPersist(displayReferenceImageUrl),
              firstFrameUrl: this.sanitizeDisplayUrlForPersist(input?.firstFrameUrl),
              lastFrameUrl: this.sanitizeDisplayUrlForPersist(input?.lastFrameUrl),
              videoMode: input?.videoMode || null,
              inputMode: currentCreateVideoInputMode,
              multiReferenceImages: multiRefCount ? multiRef : null,
              referenceVideoUrls,
              referenceAudioUrls,
              motionReferenceVideoUrl,
              characterReferenceImageUrl: this.sanitizeDisplayUrlForPersist(characterReferenceImageUrl),
              editMode: input?.editMode || null,
              editPresetId: input?.editPresetId || null,
              qualityMode: input?.qualityMode || null,
              thumbnailUrl: null,
              videoUrl: publicVideoUrl,
              createdAt: timestamp,
            });
            return "vertex veo completed";
          }

          // ── Existing Yunwu / Ark / Pixverse path ──────────────────────────
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
            multiReferenceImages: multiRef,
            referenceVideoUrl: motionReferenceVideoUrl || referenceVideoUrls[0] || null,
            referenceVideoUrls,
            referenceAudioUrls,
            motionReferenceVideoUrl,
            characterReferenceImageUrl: resolvedCharacterReferenceImageUrl,
            editMode: input?.editMode,
            editPresetId: input?.editPresetId,
            qualityMode: input?.qualityMode,
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
          const safeDisplayReference = this.sanitizeDisplayUrlForPersist(displayReferenceImageUrl);
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
            referenceImageUrl: safeDisplayReference,
            resolvedReferenceImageUrl: isMultiParam ? null : safeDisplayReference,
            firstFrameUrl: this.sanitizeDisplayUrlForPersist(input?.firstFrameUrl),
            lastFrameUrl: this.sanitizeDisplayUrlForPersist(input?.lastFrameUrl),
            videoMode: input?.videoMode || null,
            inputMode: currentCreateVideoInputMode,
            multiReferenceImages: multiRefCount ? multiRef : null,
            referenceVideoUrls,
            referenceAudioUrls,
            motionReferenceVideoUrl,
            characterReferenceImageUrl: this.sanitizeDisplayUrlForPersist(characterReferenceImageUrl),
            editMode: input?.editMode || null,
            editPresetId: input?.editPresetId || null,
            qualityMode: input?.qualityMode || null,
            thumbnailUrl: this.sanitizeDisplayUrlForPersist(thumbnailUrl),
            videoUrl,
            createdAt: timestamp
          };
          state.createStudioVideos.unshift(createdVideo);
          // NOTE: auto-sync removed. Users must manually sync from the
          // relevant surface (video-create / canvas / video-replace) via
          // POST /api/projects/:projectId/assets.

          return "provider create video completed";
        }

        const safeDisplayReferenceFallback = this.sanitizeDisplayUrlForPersist(displayReferenceImageUrl);
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
          referenceImageUrl: safeDisplayReferenceFallback,
          resolvedReferenceImageUrl: isMultiParam ? null : safeDisplayReferenceFallback,
          firstFrameUrl: this.sanitizeDisplayUrlForPersist(input?.firstFrameUrl),
          lastFrameUrl: this.sanitizeDisplayUrlForPersist(input?.lastFrameUrl),
          videoMode: input?.videoMode || null,
          inputMode: currentCreateVideoInputMode,
          multiReferenceImages: multiRefCount ? multiRef : null,
          referenceVideoUrls,
          referenceAudioUrls,
          motionReferenceVideoUrl,
          characterReferenceImageUrl: this.sanitizeDisplayUrlForPersist(characterReferenceImageUrl),
          editMode: input?.editMode || null,
          editPresetId: input?.editPresetId || null,
          qualityMode: input?.qualityMode || null,
          thumbnailUrl: this.sanitizeDisplayUrlForPersist(thumbnailUrl),
          videoUrl,
          createdAt: timestamp
        };
        state.createStudioVideos.unshift(createdVideo);
        // NOTE: auto-sync removed. Manual sync from UI triggers /api/projects/:id/assets.

        return "provider create video completed";
      }
    });
    taskId = task.id;
    this._rememberRecentContent(resultActorId, _fingerprint, task.id);
    if (_idempotencyKey) this._rememberIdempotentTask(resultActorId, _idempotencyKey, task.id);
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
    storyboard_grid25_generate: "storyboard_grid25_generate",
    toolbox_image_generate: "toolbox_image_generate",
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

MockStore.prototype.getScopedResourceVisibleActorIds = function getScopedResourceVisibleActorIds(actorId) {
  const actor = this.resolveActor(actorId);
  if (actor.platformRole === "super_admin") {
    return null;
  }

  // Personal users see their own scoped resources. Enterprise admins inherit
  // the scoped resources of members in the organizations they administer.
  const visibleActorIds = new Set([actor.id]);
  if (actor.platformRole !== "customer") {
    return visibleActorIds;
  }

  const adminOrganizationIds = new Set(
    this.listMembershipsForUser(actor.id)
      .filter((membership) => membership.role === "admin")
      .map((membership) => membership.organizationId)
      .filter(Boolean)
  );

  if (adminOrganizationIds.size === 0) {
    return visibleActorIds;
  }

  for (const membership of this.state.organizationMemberships || []) {
    if (!membership || membership.status === "disabled") continue;
    if (!adminOrganizationIds.has(membership.organizationId)) continue;
    if (typeof membership.userId === "string" && membership.userId.trim()) {
      visibleActorIds.add(membership.userId.trim());
    }
  }

  return visibleActorIds;
};

MockStore.prototype.canActorAccessScopedResourceOwner = function canActorAccessScopedResourceOwner(
  actorId,
  ownerActorId
) {
  const normalizedOwnerActorId =
    typeof ownerActorId === "string" && ownerActorId.trim() ? ownerActorId.trim() : null;
  if (!normalizedOwnerActorId) {
    return false;
  }

  const visibleActorIds = this.getScopedResourceVisibleActorIds(actorId);
  return visibleActorIds === null ? true : visibleActorIds.has(normalizedOwnerActorId);
};

function canvasProjectTimeValue(project, field) {
  const time = Date.parse(String(project?.[field] || ""));
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function compareCanvasProjectFreshness(left, right) {
  const updatedDiff =
    canvasProjectTimeValue(right, "updatedAt") - canvasProjectTimeValue(left, "updatedAt");
  if (updatedDiff !== 0) return updatedDiff;
  return canvasProjectTimeValue(right, "createdAt") - canvasProjectTimeValue(left, "createdAt");
}

MockStore.prototype.dedupeCanvasProjectBucket = function dedupeCanvasProjectBucket(bucketActorId) {
  if (!this.state.canvasProjectsByActorId) {
    this.state.canvasProjectsByActorId = {};
  }
  const items = this.state.canvasProjectsByActorId[bucketActorId];
  if (!Array.isArray(items) || items.length < 2) {
    return Array.isArray(items) ? items : [];
  }

  const byId = new Map();
  const withoutStableId = [];
  for (const item of items) {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    if (!id) {
      withoutStableId.push(item);
      continue;
    }
    if (item.id !== id) {
      item.id = id;
    }
    const existing = byId.get(id);
    if (!existing || compareCanvasProjectFreshness(item, existing) < 0) {
      byId.set(id, item);
    }
  }

  const next = [...withoutStableId, ...byId.values()].sort(compareCanvasProjectFreshness);
  const changed =
    next.length !== items.length || next.some((item, index) => item !== items[index]);
  if (changed) {
    this.state.canvasProjectsByActorId[bucketActorId] = next;
  }
  return this.state.canvasProjectsByActorId[bucketActorId];
};

MockStore.prototype.dedupeCanvasProjectsById = function dedupeCanvasProjectsById() {
  if (!this.state.canvasProjectsByActorId) {
    this.state.canvasProjectsByActorId = {};
  }
  for (const bucketActorId of Object.keys(this.state.canvasProjectsByActorId)) {
    this.dedupeCanvasProjectBucket(bucketActorId);
  }
};

MockStore.prototype.findCanvasProjectEntry = function findCanvasProjectEntry(projectId) {
  this.dedupeCanvasProjectsById();
  for (const [bucketActorId, items] of Object.entries(this.state.canvasProjectsByActorId || {})) {
    const entry = (items || []).find((item) => item.id === projectId);
    if (entry) {
      return { bucketActorId, items, project: entry };
    }
  }
  return null;
};

MockStore.prototype.findAccessibleCanvasProjectEntry = function findAccessibleCanvasProjectEntry(
  actorId,
  projectId
) {
  const entry = this.findCanvasProjectEntry(projectId);
  if (!entry) return null;
  return this.canActorAccessScopedResourceOwner(actorId, entry.bucketActorId) ? entry : null;
};

MockStore.prototype.listAccessibleCanvasProjects = function listAccessibleCanvasProjects(actorId) {
  if (!this.state.canvasProjectsByActorId) {
    this.state.canvasProjectsByActorId = {};
  }
  this.dedupeCanvasProjectsById();

  const visibleActorIds = this.getScopedResourceVisibleActorIds(actorId);
  const entries =
    visibleActorIds === null
      ? Object.entries(this.state.canvasProjectsByActorId || {})
      : Array.from(visibleActorIds).map((visibleActorId) => [
          visibleActorId,
          this.state.canvasProjectsByActorId[visibleActorId] || [],
        ]);

  return entries
    .flatMap(([bucketActorId, items]) =>
      (items || []).map((item) => ({
        bucketActorId,
        project: item,
      }))
    )
    .sort((left, right) =>
      String(right.project?.updatedAt || "").localeCompare(String(left.project?.updatedAt || ""))
    );
};

MockStore.prototype.findUserByEmail = function findUserByEmail(email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  return (this.state.users || []).find((item) => normalizeEmail(item.email) === normalizedEmail) || null;
};

MockStore.prototype.findUserByGoogleSub = function findUserByGoogleSub(googleSub) {
  const normalizedSub = String(googleSub || "").trim();
  if (!normalizedSub) return null;
  return (this.state.users || []).find((item) => String(item.googleSub || "").trim() === normalizedSub) || null;
};

function normalizeGoogleProfile(profile = {}) {
  const sub = requireText(profile.sub, "sub", "Google account id");
  const email = normalizeEmail(requireText(profile.email, "email", "email"));
  const emailVerified = profile.email_verified === true || profile.email_verified === "true";
  const displayName =
    String(profile.name || profile.given_name || "").trim() ||
    (email ? email.split("@")[0] : "Google User");
  const avatar = String(profile.picture || "").trim() || null;

  if (!emailVerified) {
    throw apiError(403, "GOOGLE_EMAIL_NOT_VERIFIED", "Google email is not verified.");
  }

  return {
    sub,
    email,
    displayName,
    avatar,
  };
}

MockStore.prototype.createLoginResultForUser = function createLoginResultForUser(user) {
  this.ensureDefaultProjectForActor(user.id);
  return clone({
    actorId: user.id,
    token: generateAuthToken(user.id),
    displayName: user.displayName,
    email: user.email,
    permissionContext: this.getPermissionContext(user.id),
  });
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

  return this.createLoginResultForUser(user);
};

MockStore.prototype.loginAdminWithEmail = function loginAdminWithEmail(input = {}) {
  const result = this.loginWithEmail(input);
  if (result.permissionContext?.platformRole !== "super_admin") {
    throw apiError(403, "SUPER_ADMIN_REQUIRED", "This login is only available to super administrators.");
  }
  return result;
};

MockStore.prototype.loginWithGoogle = function loginWithGoogle(profile = {}) {
  const googleProfile = normalizeGoogleProfile(profile);
  const now = new Date().toISOString();
  const userByGoogleSub = this.findUserByGoogleSub(googleProfile.sub);
  const userByEmail = this.findUserByEmail(googleProfile.email);

  if (userByGoogleSub && userByEmail && userByGoogleSub.id !== userByEmail.id) {
    throw apiError(409, "GOOGLE_ACCOUNT_CONFLICT", "This Google account is already linked to another user.");
  }

  let user = userByGoogleSub || userByEmail;
  if (user && user.googleSub && user.googleSub !== googleProfile.sub) {
    throw apiError(409, "GOOGLE_ACCOUNT_CONFLICT", "This email is already linked to another Google account.");
  }

  if (!user) {
    user = {
      id: `user_${randomUUID().slice(0, 8)}`,
      displayName: googleProfile.displayName,
      email: googleProfile.email,
      phone: null,
      passwordHash: null,
      platformRole: "customer",
      status: "active",
      defaultOrganizationId: null,
      authProvider: "google",
      googleSub: googleProfile.sub,
      googleEmailVerified: true,
      avatar: googleProfile.avatar,
      createdAt: now,
      updatedAt: now,
    };
    this.state.users.unshift(user);
    this.ensureWalletForOwner("user", user.id, {
      displayName: `${googleProfile.displayName}的钱包`,
      availableCredits: 5000,
      createdBy: "root_demo_001",
      registration: true,
      updatedAt: now,
    });
  } else {
    if (user.status && user.status !== "active") {
      throw apiError(403, "ACCOUNT_DISABLED", "This account is not active.");
    }

    user.googleSub = googleProfile.sub;
    user.googleEmailVerified = true;
    user.authProvider = user.authProvider || "google";
    if (googleProfile.avatar && !user.avatar) {
      user.avatar = googleProfile.avatar;
    }
    user.updatedAt = now;
  }

  this.syncLegacyWalletState();
  return this.createLoginResultForUser(user);
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

  const bootstrapSuperAdmin = getBootstrapSuperAdminConfig();
  if (bootstrapSuperAdmin) {
    const now = new Date().toISOString();
    let user =
      (this.state.users || []).find((item) => item.id === bootstrapSuperAdmin.id) ||
      this.findUserByEmail(bootstrapSuperAdmin.email);

    if (!user) {
      user = {
        id: bootstrapSuperAdmin.id,
        displayName: bootstrapSuperAdmin.displayName,
        email: bootstrapSuperAdmin.email,
        phone: null,
        passwordHash: hashPassword(bootstrapSuperAdmin.password),
        platformRole: "super_admin",
        status: "active",
        defaultOrganizationId: null,
        createdAt: now,
        updatedAt: now,
      };
      this.state.users.unshift(user);
      changed = true;
    } else {
      const nextUser = {
        ...user,
        id: user.id || bootstrapSuperAdmin.id,
        displayName: bootstrapSuperAdmin.displayName,
        email: bootstrapSuperAdmin.email,
        phone: normalizePhone(user.phone),
        passwordHash: verifyPassword(bootstrapSuperAdmin.password, user.passwordHash)
          ? user.passwordHash
          : hashPassword(bootstrapSuperAdmin.password),
        platformRole: "super_admin",
        status: "active",
        defaultOrganizationId: null,
        createdAt: user.createdAt || now,
        updatedAt: user.updatedAt || now,
      };

      if (JSON.stringify(nextUser) !== JSON.stringify(user)) {
        Object.assign(user, nextUser, { updatedAt: now });
        changed = true;
      }
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

  for (const order of this.state.walletRechargeOrders || []) {
  const paymentMethod = normalizeRechargePaymentMethod(order.paymentMethod || "wechat_pay");
  const mode = normalizeRechargeMode(order.mode || (order.paymentMethod === "wechat_pay" && order.qrCodePayload ? "demo_mock" : "live"));
  const scene = normalizeRechargeScene(paymentMethod, order.scene, mode);
  const provider = String(order.provider || rechargeProviderFromMethod(paymentMethod, mode));
    const expiredAt = String(order.expiredAt || order.expiresAt || order.updatedAt || new Date().toISOString());
    const voucherFiles = normalizeRechargeVoucherFiles(order.voucherFiles);
    const reviewStatus =
      order.reviewStatus ||
      (paymentMethod === "bank_transfer" && order.status === "paid" ? "approved" : null);
    const nextBankAccount = cloneBankAccount(order.bankAccount);
  const nextQrCodePayload =
    order.qrCodePayload || order.codeUrl || (mode === "demo_mock" ? createDemoRechargeQrPayload(paymentMethod) : null);
  const nextQrCodeHint =
    order.qrCodeHint ||
    (mode === "demo_mock"
      ? getDemoRechargeQrHint(paymentMethod)
      : paymentMethod === "wechat_pay"
        ? "Use WeChat to scan and complete payment."
        : paymentMethod === "bank_transfer"
            ? "Submit the transfer proof after payment so finance can review it."
            : "Complete payment in the redirected page and return to refresh the order.");

    if (
      order.paymentMethod !== paymentMethod ||
      order.mode !== mode ||
      order.scene !== scene ||
      order.provider !== provider ||
      order.expiredAt !== expiredAt ||
      order.expiresAt !== expiredAt ||
      JSON.stringify(order.voucherFiles || []) !== JSON.stringify(voucherFiles) ||
      order.reviewStatus !== reviewStatus ||
      JSON.stringify(order.bankAccount || null) !== JSON.stringify(nextBankAccount) ||
      order.qrCodePayload !== nextQrCodePayload ||
      order.qrCodeHint !== nextQrCodeHint
    ) {
      Object.assign(order, {
        paymentMethod,
        mode,
        scene,
        provider,
        expiredAt,
        expiresAt: expiredAt,
        voucherFiles,
        reviewStatus,
        bankAccount: nextBankAccount,
        qrCodePayload: nextQrCodePayload,
        qrCodeHint: nextQrCodeHint,
      });
      changed = true;
    }

    if (maybeExpireWalletRechargeOrder(order)) {
      changed = true;
    }
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
    const nextBudgetLimitCredits = 0;
    const nextBudgetUsedCredits = 0;
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

MockStore.prototype.assertSuperAdmin = function assertSuperAdmin(actorId) {
  const actor = this.resolveActor(actorId);
  if (actor.platformRole === "super_admin") {
    return actor;
  }
  throw apiError(403, "SUPER_ADMIN_REQUIRED", "This endpoint requires super administrator access.");
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
    if (actionCode === "create_image_generate") {
      const referenceCount = Array.isArray(input.referenceImageUrls)
        ? input.referenceImageUrls.filter(Boolean).length
        : (input.referenceImageUrl ? 1 : 0);
      const model = input.model || input.imageModel || "gemini-3-pro-image-preview";
      quantity = resolveCreateImageOutputCount(model, input.count || 1, referenceCount).normalizedCount;
    } else {
      quantity = Math.max(1, Number(input.count || 1));
    }
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

MockStore.prototype.resolveActorDefaultBillingWallet = function resolveActorDefaultBillingWallet(actorId) {
  const actor = this.resolveActor(actorId);
  if (actor.platformRole !== "customer") {
    return null;
  }

  const personalWallet = this.getWalletByOwner("user", actor.id);
  const memberships = this.listMembershipsForUser(actor.id);
  const preferredOrganizationId =
    (actor.defaultOrganizationId && this.getMembership(actor.id, actor.defaultOrganizationId)
      ? actor.defaultOrganizationId
      : memberships[0]?.organizationId) || null;

  if (!preferredOrganizationId) {
    return personalWallet;
  }

  const membership = this.getMembership(actor.id, preferredOrganizationId) || memberships[0] || null;
  if (membership && membership.canUseOrganizationWallet === false) {
    return personalWallet;
  }

  const organizationWallet = this.getWalletByOwner("organization", preferredOrganizationId);
  return organizationWallet || personalWallet;
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
  const defaultWallet = this.resolveActorDefaultBillingWallet(actor.id) || personalWallet;
  if (!project) {
    return defaultWallet;
  }

  if (project.ownerType !== "organization") {
    return personalWallet;
  }

  const organizationWallet = this.getWalletByOwner("organization", project.organizationId || project.ownerId);
  const policy =
    project.billingPolicy ||
    (project.billingWalletType === "organization" ? "organization_only" : "personal_only");

  if (policy === "personal_only") {
    return personalWallet || defaultWallet;
  }

  if (policy === "organization_first_fallback_personal") {
    if (organizationWallet && Number(organizationWallet.availableCredits || 0) >= Number(credits || 0)) {
      return organizationWallet;
    }
    return personalWallet || organizationWallet || defaultWallet;
  }

  return organizationWallet || defaultWallet || personalWallet;
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
  const budgetLimitCredits = null;
  const budgetUsedCredits = 0;
  const budgetRemainingCredits = null;

  let reason = null;
  if (!wallet && credits > 0) {
    reason = "No available wallet for this action.";
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

MockStore.prototype.getCreateCreditQuote = function getCreateCreditQuote(
  projectId,
  actionCode,
  input = {},
  actorId
) {
  const actor = this.resolveActor(actorId);
  const project = projectId ? this.assertProjectAccess(projectId, actor.id) : null;

  if (actor.platformRole === "customer") {
    return this.buildCreditQuote({ projectId, actionCode, input, actorId: actor.id });
  }

  const { quantity, rule } = this.estimateActionCredits(actionCode, input);
  return clone({
    actionCode,
    label: rule?.label || actionCode,
    description: rule?.description || "",
    credits: 0,
    quantity,
    currency: "credits",
    walletId: null,
    walletName: null,
    walletOwnerType: null,
    availableCredits: 0,
    frozenCredits: 0,
    billingPolicy: project?.billingPolicy || "personal_only",
    projectId: projectId || null,
    projectOwnerType: project?.ownerType || null,
    budgetLimitCredits: null,
    budgetUsedCredits: 0,
    budgetRemainingCredits: null,
    canAfford: true,
    reason: null,
  });
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

  const apiKeyConfigured = hasApiCenterRuntimeProviderApiKey(vendor.id);
  if (!apiKeyConfigured) {
    throw apiError(503, "PROVIDER_NOT_CONFIGURED", "YUNWU_API_KEY is not configured.");
  }

  let checkedAt = new Date().toISOString();
  let modelCount = Array.isArray(vendor.models)
    ? vendor.models.filter((model) => model?.enabled !== false).length
    : 0;
  const result = await testYunwuConnection();
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

MockStore.prototype.assertWalletRechargeOrderAccess = function assertWalletRechargeOrderAccess(
  orderOrId,
  actorId,
  options = {}
) {
  const order =
    typeof orderOrId === "string"
      ? (this.state.walletRechargeOrders || []).find((item) => item.id === orderOrId)
      : orderOrId;
  if (!order) {
    throw apiError(404, "NOT_FOUND", "recharge order not found");
  }

  if (!actorId) {
    return null;
  }

  const actor = this.resolveActor(actorId);
  if (actor.platformRole === "super_admin") {
    return actor;
  }

  if (options.allowPlatformAdmin && actor.platformRole === "ops_admin") {
    return actor;
  }

  this.assertWalletAccess(order.walletId, actor.id);
  return actor;
};

MockStore.prototype.listAdminOrders = function listAdminOrders(actorId) {
  this.assertPlatformAdmin(actorId);
  for (const order of this.state.walletRechargeOrders || []) {
    maybeExpireWalletRechargeOrder(order);
  }
  return clone(
    (this.state.walletRechargeOrders || []).map((order) => ({
      ...order,
      wallet: this.toPublicWallet(this.getWalletById(order.walletId)),
    }))
  );
};

MockStore.prototype.getCurrentOrganizationMembershipForActor = function getCurrentOrganizationMembershipForActor(actor) {
  if (!actor || actor.platformRole !== "customer") return null;
  const memberships = this.listMembershipsForUser(actor.id);
  if (!memberships.length) return null;
  return (
    (actor.defaultOrganizationId &&
      memberships.find((item) => item.organizationId === actor.defaultOrganizationId)) ||
    memberships[0] ||
    null
  );
};

MockStore.prototype.buildCreditUsageStats = function buildCreditUsageStats({
  subject,
  mode = null,
  wallets = [],
  actorFilter = null,
  includeAllWallets = false,
} = {}) {
  const now = new Date();
  const windowDays = 30;
  const firstDay = addLocalDays(now, -(windowDays - 1));
  const bucketMap = new Map();
  const publicWallets = wallets.filter(Boolean).map((wallet) => this.toPublicWallet(wallet)).filter(Boolean);
  const walletIds = new Set(publicWallets.map((wallet) => wallet.id).filter(Boolean));

  for (let index = 0; index < windowDays; index += 1) {
    const date = addLocalDays(firstDay, index);
    const key = formatLocalDateKey(date);
    bucketMap.set(key, {
      bucketStart: date.toISOString(),
      bucketLabel: key.slice(5),
      consumedCredits: 0,
      refundedCredits: 0,
    });
  }

  const inWalletScope = (walletId) => includeAllWallets || walletIds.has(walletId);
  const inActorScope = (createdBy) => !actorFilter || createdBy === actorFilter;
  const inScopeEntry = (entry) => inWalletScope(entry.walletId) && inActorScope(entry.createdBy || null);
  const nowKey = formatLocalDateKey(now);
  let consumedCredits = 0;
  let todayConsumedCredits = 0;
  let refundedCredits = 0;
  let recentTaskCount = 0;
  let lastActivityAt = null;
  const taskIds = new Set();
  const recentEntryTypes = new Set(["settle", "refund", "freeze", "recharge", "grant"]);

  for (const entry of this.state.walletLedgerEntries || []) {
    if (!inScopeEntry(entry)) continue;

    const createdAt = new Date(entry.createdAt || now.toISOString());
    if (Number.isNaN(createdAt.getTime())) continue;

    if (!lastActivityAt || createdAt.getTime() > new Date(lastActivityAt).getTime()) {
      lastActivityAt = entry.createdAt || createdAt.toISOString();
    }

    const key = formatLocalDateKey(createdAt);
    const bucket = bucketMap.get(key);

    if (entry.entryType === "settle") {
      const amount = Math.abs(Number(entry.amount || 0));
      consumedCredits += amount;
      if (key === nowKey) {
        todayConsumedCredits += amount;
      }
      if (bucket) {
        bucket.consumedCredits += amount;
      }
      if (entry.sourceType === "task" && entry.sourceId) {
        taskIds.add(entry.sourceId);
      }
    }

    if (entry.entryType === "refund") {
      const amount = Math.abs(Number(entry.amount || 0));
      refundedCredits += amount;
      if (bucket) {
        bucket.refundedCredits += amount;
      }
    }
  }

  recentTaskCount = taskIds.size;

  const pendingFrozenCredits = (this.state.tasks || [])
    .filter((task) => {
      if (!inWalletScope(task.walletId)) return false;
      if (actorFilter && task.actorId !== actorFilter) return false;
      return Number(task.frozenCredits || 0) > 0 && task.status !== "failed";
    })
    .reduce((sum, task) => sum + Number(task.frozenCredits || 0), 0);

  const recentEntries = (this.state.walletLedgerEntries || [])
    .filter((entry) => inScopeEntry(entry) && recentEntryTypes.has(entry.entryType))
    .slice(0, 20)
    .map((entry) => this.toPublicLedgerEntry(entry));

  const availableCredits = publicWallets.reduce(
    (sum, wallet) => sum + Number(wallet.availableCredits ?? wallet.creditsAvailable ?? 0),
    0
  );
  const frozenCredits = publicWallets.reduce(
    (sum, wallet) => sum + Number(wallet.frozenCredits ?? wallet.creditsFrozen ?? 0),
    0
  );

  return clone({
    subject: subject || {
      type: "unknown",
      id: null,
      label: "Unknown",
      detail: null,
    },
    mode,
    windowDays,
    bucket: "day",
    wallets: publicWallets,
    summary: {
      consumedCredits,
      todayConsumedCredits,
      refundedCredits,
      pendingFrozenCredits,
      availableCredits,
      frozenCredits,
      recentTaskCount,
      lastActivityAt,
    },
    series: Array.from(bucketMap.values()),
    recentEntries,
  });
};

MockStore.prototype.getWalletUsageStats = function getWalletUsageStats(actorId, mode = "personal") {
  const actor = this.resolveActor(actorId);
  if (actor.platformRole !== "customer") {
    throw apiError(403, "FORBIDDEN", "Only customer accounts can view wallet usage stats here.");
  }

  const normalizedMode = mode === "organization" ? "organization" : "personal";
  const membership = this.getCurrentOrganizationMembershipForActor(actor);

  if (normalizedMode === "organization") {
    if (!membership || membership.role !== "admin") {
      throw apiError(403, "FORBIDDEN", "Organization usage stats require enterprise admin permission.");
    }
    const organization = this.getOrganizationById(membership.organizationId);
    const organizationWallet = this.getWalletByOwner("organization", membership.organizationId);
    return this.buildCreditUsageStats({
      mode: "organization",
      subject: {
        type: "organization",
        id: organization?.id || membership.organizationId,
        label: organization?.name || "Enterprise",
        detail: "企业总消耗",
      },
      wallets: organizationWallet ? [organizationWallet] : [],
      actorFilter: null,
    });
  }

  const wallets = this.getVisibleWalletsForActor(actor.id);
  return this.buildCreditUsageStats({
    mode: "personal",
    subject: {
      type: "user",
      id: actor.id,
      label: actor.displayName || actor.id,
      detail: actor.email || actor.phone || null,
    },
    wallets,
    actorFilter: actor.id,
  });
};

MockStore.prototype.toCreditUsageSubjectForUser = function toCreditUsageSubjectForUser(user) {
  return {
    type: "user",
    id: user.id,
    label: user.displayName || user.id,
    detail: user.email || user.phone || user.platformRole || null,
    role: user.platformRole || "customer",
  };
};

MockStore.prototype.toCreditUsageSubjectForOrganization = function toCreditUsageSubjectForOrganization(organization) {
  return {
    type: "organization",
    id: organization.id,
    label: organization.name || organization.id,
    detail: organization.industry || organization.status || null,
    role: "organization",
  };
};

MockStore.prototype.searchCreditUsageSubjects = function searchCreditUsageSubjects(actorId, search = "") {
  this.assertPlatformAdmin(actorId);
  const query = normalizeCreditUsageSearch(search);
  const subjects = [];

  if (!query || creditUsageMatchesSearch(query, "platform", "全平台", "平台总消耗")) {
    subjects.push({
      type: "platform",
      id: "platform",
      label: "全平台",
      detail: "所有钱包总消耗",
      role: "platform",
    });
  }

  const matchedUsers = (this.state.users || [])
    .filter((user) =>
      creditUsageMatchesSearch(
        query,
        user.id,
        user.displayName,
        user.email,
        user.phone,
        user.platformRole
      )
    )
    .slice(0, query ? 20 : 10)
    .map((user) => this.toCreditUsageSubjectForUser(user));

  const matchedOrganizations = (this.state.organizations || [])
    .filter((organization) =>
      creditUsageMatchesSearch(
        query,
        organization.id,
        organization.name,
        organization.industry,
        organization.status
      )
    )
    .slice(0, query ? 20 : 10)
    .map((organization) => this.toCreditUsageSubjectForOrganization(organization));

  return clone([...subjects, ...matchedUsers, ...matchedOrganizations].slice(0, 40));
};

MockStore.prototype.getAdminCreditUsageStats = function getAdminCreditUsageStats(
  actorId,
  { subjectType = "platform", subjectId = null } = {}
) {
  this.assertPlatformAdmin(actorId);
  const normalizedType =
    subjectType === "user" || subjectType === "organization" || subjectType === "platform"
      ? subjectType
      : "platform";

  if (normalizedType === "user") {
    const user = this.getUser(subjectId);
    if (!user) {
      throw apiError(404, "NOT_FOUND", "usage subject user not found");
    }
    const wallets =
      user.platformRole === "customer" ? this.getVisibleWalletsForActor(user.id) : [];
    return this.buildCreditUsageStats({
      mode: "admin",
      subject: this.toCreditUsageSubjectForUser(user),
      wallets,
      actorFilter: user.id,
    });
  }

  if (normalizedType === "organization") {
    const organization = this.getOrganizationById(subjectId);
    if (!organization) {
      throw apiError(404, "NOT_FOUND", "usage subject organization not found");
    }
    const wallet = this.getWalletByOwner("organization", organization.id);
    return this.buildCreditUsageStats({
      mode: "admin",
      subject: this.toCreditUsageSubjectForOrganization(organization),
      wallets: wallet ? [wallet] : [],
      actorFilter: null,
    });
  }

  return this.buildCreditUsageStats({
    mode: "admin",
    subject: {
      type: "platform",
      id: "platform",
      label: "全平台",
      detail: "所有钱包总消耗",
      role: "platform",
    },
    wallets: this.state.wallets || [],
    actorFilter: null,
    includeAllWallets: true,
  });
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

  this.assertWalletRechargeOrderAccess(order, actorId || order.actorId, {
    allowPlatformAdmin: true,
  });
  maybeExpireWalletRechargeOrder(order);

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

  const paymentMethod = normalizeRechargePaymentMethod(input.paymentMethod || "wechat_pay");
  const mode = normalizeRechargeMode(input.mode || "live");
  const scene = normalizeRechargeScene(paymentMethod, input.scene, mode);
  const amount = normalizeRechargeAmount(input.amount);
  const credits = calculateRechargeCredits(amount);
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(credits) || credits <= 0) {
    throw apiError(400, "BAD_REQUEST", "amount must resolve to a positive recharge value.");
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + (paymentMethod === "bank_transfer" ? 72 * 60 * 60 * 1000 : 15 * 60 * 1000));
  const order = {
    id: `recharge_${randomUUID().slice(0, 8)}`,
    planId: String(input.planId || "custom"),
    planName: String(input.planName || "Wallet Recharge"),
    billingCycle: String(input.billingCycle || "oneTime"),
    paymentMethod,
    provider: rechargeProviderFromMethod(paymentMethod, mode),
    scene,
    mode,
    amount,
    credits,
    currency: "CNY",
    status: "pending",
    actorId: actor.id,
    walletId: targetWallet.id,
    walletOwnerType: targetWallet.ownerType,
    walletOwnerId: targetWallet.ownerId,
    payerType: targetWallet.ownerType,
    providerTradeNo: null,
    codeUrl: null,
    h5Url: null,
    redirectUrl: null,
    notifyPayload: null,
    paidAt: null,
    expiredAt: expiresAt.toISOString(),
    failureReason: null,
    voucherFiles: [],
    reviewStatus: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: null,
    transferReference: null,
    transferNote: null,
    bankAccount: cloneBankAccount(input.bankAccount),
    qrCodePayload: mode === "demo_mock" ? createDemoRechargeQrPayload(paymentMethod) : null,
    qrCodeHint:
      mode === "demo_mock"
        ? getDemoRechargeQrHint(paymentMethod)
        : paymentMethod === "wechat_pay"
          ? "Use WeChat to scan and complete payment."
          : paymentMethod === "bank_transfer"
            ? "Submit transfer proof after payment for finance review."
            : "Complete payment in the redirected page and then refresh the order status.",
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

MockStore.prototype.updateWalletRechargeOrder = function updateWalletRechargeOrder(
  orderId,
  patch,
  actorId,
  options = {}
) {
  const order = (this.state.walletRechargeOrders || []).find((item) => item.id === orderId);
  if (!order) return null;
  this.assertWalletRechargeOrderAccess(order, actorId || order.actorId, {
    allowPlatformAdmin: Boolean(options.allowPlatformAdmin),
  });

  maybeExpireWalletRechargeOrder(order);
  const changed = mergeWalletRechargePatch(order, patch);
  if (changed) {
    order.updatedAt = new Date().toISOString();
  }
  return clone(order);
};

MockStore.prototype.markWalletRechargeOrderPaid = function markWalletRechargeOrderPaid(
  orderId,
  actorId,
  patch = {}
) {
  const order = (this.state.walletRechargeOrders || []).find((item) => item.id === orderId);
  if (!order) return null;

  const actor = this.assertWalletRechargeOrderAccess(order, actorId || order.actorId, {
    allowPlatformAdmin: true,
  });
  const wallet = this.getWalletById(order.walletId);
  if (!wallet) {
    throw apiError(404, "NOT_FOUND", "wallet not found");
  }

  maybeExpireWalletRechargeOrder(order);
  if (order.status === "closed") {
    throw apiError(409, "ORDER_NOT_PAYABLE", "Recharge order is no longer payable.");
  }

  mergeWalletRechargePatch(order, patch);
  if (!order.paidAt) {
    order.paidAt = String(patch.paidAt || new Date().toISOString());
  }

  if (order.status !== "paid") {
    order.status = "paid";
    order.updatedAt = new Date().toISOString();
    order.reviewStatus = order.paymentMethod === "bank_transfer" ? "approved" : order.reviewStatus;
    wallet.availableCredits = Number(wallet.availableCredits || 0) + Number(order.credits || 0);
    wallet.updatedAt = order.updatedAt;
    this.recordWalletEntry({
      wallet,
      entryType: "recharge",
      amount: Number(order.credits || 0),
      sourceType: "order",
      sourceId: order.id,
      orderId: order.id,
      createdBy: actor?.id || order.actorId,
      metadata: {
        planId: order.planId,
        planName: order.planName,
        amount: order.amount,
        paymentMethod: order.paymentMethod,
        provider: order.provider,
        scene: order.scene,
        mode: order.mode,
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
  } else {
    order.updatedAt = new Date().toISOString();
  }

  return clone(order);
};

MockStore.prototype.submitWalletRechargeTransferProof = function submitWalletRechargeTransferProof(
  orderId,
  input,
  actorId
) {
  const order = (this.state.walletRechargeOrders || []).find((item) => item.id === orderId);
  if (!order) return null;
  this.assertWalletRechargeOrderAccess(order, actorId || order.actorId, {
    allowPlatformAdmin: false,
  });

  if (order.paymentMethod !== "bank_transfer") {
    throw apiError(400, "BAD_REQUEST", "Only bank transfer orders accept transfer proof.");
  }

  maybeExpireWalletRechargeOrder(order);
  if (TERMINAL_RECHARGE_STATUSES.has(order.status) && order.status !== "failed") {
    throw apiError(409, "ORDER_NOT_EDITABLE", "Recharge order can no longer accept transfer proof.");
  }

  const voucherFiles = normalizeRechargeVoucherFiles(input?.voucherFiles);
  if (!voucherFiles.length) {
    throw apiError(400, "BAD_REQUEST", "At least one transfer proof file is required.");
  }

  mergeWalletRechargePatch(order, {
    voucherFiles,
    transferReference: String(input?.transferReference || "").trim() || null,
    transferNote: String(input?.note || "").trim() || null,
    reviewStatus: "submitted",
    status: "pending_review",
    failureReason: null,
  });
  order.updatedAt = new Date().toISOString();
  return clone(order);
};

MockStore.prototype.reviewWalletRechargeOrder = function reviewWalletRechargeOrder(
  orderId,
  input,
  actorId
) {
  const admin = this.assertPlatformAdmin(actorId);
  const order = (this.state.walletRechargeOrders || []).find((item) => item.id === orderId);
  if (!order) return null;

  if (order.paymentMethod !== "bank_transfer") {
    throw apiError(400, "BAD_REQUEST", "Only bank transfer orders can be reviewed.");
  }

  const decision = String(input?.decision || "").trim();
  const note = String(input?.note || "").trim() || null;
  if (decision !== "approve" && decision !== "reject") {
    throw apiError(400, "BAD_REQUEST", "decision must be approve or reject");
  }

  if (decision === "approve") {
    return this.markWalletRechargeOrderPaid(order.id, admin.id, {
      reviewStatus: "approved",
      reviewedAt: new Date().toISOString(),
      reviewedBy: admin.id,
      reviewNote: note,
      failureReason: null,
      providerTradeNo: order.providerTradeNo || `bank_${order.id}`,
    });
  }

  mergeWalletRechargePatch(order, {
    status: "failed",
    reviewStatus: "rejected",
    reviewedAt: new Date().toISOString(),
    reviewedBy: admin.id,
    reviewNote: note,
    failureReason: note || "Bank transfer proof was rejected.",
  });
  order.updatedAt = new Date().toISOString();
  return clone(order);
};

MockStore.prototype.confirmWalletRechargeOrder = function confirmWalletRechargeOrder(orderId, actorId) {
  const order = (this.state.walletRechargeOrders || []).find((item) => item.id === orderId);
  if (!order) return null;

  this.assertWalletRechargeOrderAccess(order, actorId || order.actorId, {
    allowPlatformAdmin: true,
  });

  if (order.mode !== "demo_mock") {
    throw apiError(
      409,
      "ORDER_CONFIRM_DISABLED",
      "Manual confirm is only available for demo mock orders.",
    );
  }

  return this.markWalletRechargeOrderPaid(orderId, actorId || order.actorId, {
    provider: "demo_mock",
    reviewStatus: null,
    providerTradeNo: order.providerTradeNo || `demo_${order.id}`,
  });
};

MockStore.prototype.listTasks = function listTasks(projectId, actorId, type) {
  const actor = this.resolveActor(actorId);
  const items = (this.state.tasks || []).filter((task) => {
    if (projectId && task.projectId !== projectId) {
      return false;
    }

    if (type && task.type !== type) {
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
    throw apiError(409, "INSUFFICIENT_CREDITS", creditQuote.reason || "Unable to freeze credits.");
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
      const failurePatch = buildTaskFailurePatch(error);
      this.updateTask(taskId, {
        status: "failed",
        progressPercent: 100,
        currentStage: "failed",
        etaSeconds: 0,
        ...failurePatch,
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
  return clone(this.listAccessibleCanvasProjects(actorId).map((entry) => entry.project));
};

MockStore.prototype.listCanvasProjectSummaries = function listCanvasProjectSummaries(actorId) {
  if (!this.state.canvasProjectsByActorId) {
    this.state.canvasProjectsByActorId = {};
  }

  const items = this.listAccessibleCanvasProjects(actorId).map((entry) => entry.project);
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
  const entry = this.findAccessibleCanvasProjectEntry(actorId, projectId);
  return clone(entry?.project || null);
};

MockStore.prototype.saveCanvasProject = function saveCanvasProject(actorId, input) {
  if (!this.state.canvasProjectsByActorId) {
    this.state.canvasProjectsByActorId = {};
  }
  const actor = this.resolveActor(actorId);
  if (!this.state.canvasProjectsByActorId[actor.id]) {
    this.state.canvasProjectsByActorId[actor.id] = [];
  }
  this.dedupeCanvasProjectsById();

  // Defence in depth: even though the frontend now pre-sanitises via
  // sanitizeCanvasNodesForCloudSave() and sanitizeCanvasNodesForPersistence(),
  // we re-apply a sync scrub here so a bad/old client can never poison the
  // snapshot. Covers the exact field set documented in sanitizePersistedDisplayUrls()
  // section 5.
  const sanitizeCanvasData = (cd) => {
    if (!cd || typeof cd !== "object") return cd;
    const self = this;
    const nodeFieldsNullable = [
      "resultUrl",
      "lastFrame",
      "editorBackgroundUrl",
      "editorCanvasData",
      "inputUrl",
    ];
    const nextNodes = Array.isArray(cd.nodes)
      ? cd.nodes.map((node) => {
          if (!node || typeof node !== "object") return node;
          const copy = { ...node };
          for (const f of nodeFieldsNullable) {
            if (!(f in copy)) continue;
            const original = copy[f];
            if (original == null) continue;
            const safe = self.sanitizeDisplayUrlForPersist(original);
            if (safe !== original) {
              copy[f] = safe;
            }
          }
          if (Array.isArray(copy.characterReferenceUrls)) {
            const cleaned = copy.characterReferenceUrls
              .map((x) => self.sanitizeDisplayUrlForPersist(x))
              .filter(Boolean);
            copy.characterReferenceUrls = cleaned;
          }
          // Downgrade status when we just stripped a resultUrl the node
          // previously advertised as SUCCESS; see sanitizePersistedDisplayUrls
          // for the rationale.
          if (
            node.status === "success" &&
            node.resultUrl != null &&
            copy.resultUrl == null
          ) {
            copy.status = "idle";
          }
          return copy;
        })
      : cd.nodes;
    const nextGroups = Array.isArray(cd.groups)
      ? cd.groups.map((group) => {
          if (!group || !group.storyContext || typeof group.storyContext !== "object") {
            return group;
          }
          if (!("compositeImageUrl" in group.storyContext)) return group;
          const original = group.storyContext.compositeImageUrl;
          if (original == null) return group;
          const safe = self.sanitizeDisplayUrlForPersist(original);
          if (safe === original) return group;
          return {
            ...group,
            storyContext: { ...group.storyContext, compositeImageUrl: safe },
          };
        })
      : cd.groups;
    return { ...cd, nodes: nextNodes, groups: nextGroups };
  };
  if (input && typeof input === "object") {
    input = {
      ...input,
      thumbnailUrl:
        input.thumbnailUrl != null
          ? this.sanitizeDisplayUrlForPersist(input.thumbnailUrl)
          : input.thumbnailUrl,
      canvasData: sanitizeCanvasData(input.canvasData),
      baseCanvasData: sanitizeCanvasData(input.baseCanvasData),
    };
  }

  let items = this.state.canvasProjectsByActorId[actor.id];
  const now = new Date().toISOString();

  if (input.id) {
    const accessibleEntry = this.findAccessibleCanvasProjectEntry(actorId, input.id);
    if (accessibleEntry) {
      items = accessibleEntry.items;
    } else {
      const existingEntry = this.findCanvasProjectEntry(input.id);
      if (existingEntry) {
        throw apiError(403, "FORBIDDEN", "You do not have access to this canvas project.");
      }
    }
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
        this.dedupeCanvasProjectBucket(accessibleEntry?.bucketActorId || actor.id);
        return clone(existing);
      }
      Object.assign(existing, {
        title: input.title || existing.title,
        thumbnailUrl: input.thumbnailUrl !== undefined ? input.thumbnailUrl : existing.thumbnailUrl,
        canvasData: input.canvasData || existing.canvasData,
        updatedAt: now,
      });
      this.dedupeCanvasProjectBucket(accessibleEntry?.bucketActorId || actor.id);
      return clone(existing);
    }
  }

  const project = {
    id: input.id || `canvas_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    actorId: actor.id,
    title: input.title || "未命名画布项目",
    thumbnailUrl: input.thumbnailUrl || null,
    canvasData: input.canvasData || null,
    createdAt: now,
    updatedAt: now,
  };

  items.unshift(project);
  this.dedupeCanvasProjectBucket(actor.id);
  return clone(project);
};

MockStore.prototype.deleteCanvasProject = function deleteCanvasProject(actorId, projectId) {
  const entry = this.findAccessibleCanvasProjectEntry(actorId, projectId);
  if (!entry) return false;

  const next = (entry.items || []).filter((item) => item.id !== projectId);
  if (next.length === (entry.items || []).length) return false;

  this.state.canvasProjectsByActorId[entry.bucketActorId] = next;
  return true;
};

function ensureAgentCanvasProjectBucket(state, actorId) {
  if (!state.agentCanvasProjectsByActorId || typeof state.agentCanvasProjectsByActorId !== "object") {
    state.agentCanvasProjectsByActorId = {};
  }
  if (!Array.isArray(state.agentCanvasProjectsByActorId[actorId])) {
    state.agentCanvasProjectsByActorId[actorId] = [];
  }
  return state.agentCanvasProjectsByActorId[actorId];
}

function normalizeAgentCanvasContext(value) {
  if (!value || typeof value !== "object") return null;
  try {
    return clone(value);
  } catch {
    return { ...value };
  }
}

MockStore.prototype.sanitizeAgentCanvasProjectData = function sanitizeAgentCanvasProjectData(canvasData) {
  if (!canvasData || typeof canvasData !== "object") return canvasData;

  const nodeFieldsNullable = [
    "resultUrl",
    "lastFrame",
    "editorBackgroundUrl",
    "editorCanvasData",
    "inputUrl",
  ];

  const nextNodes = Array.isArray(canvasData.nodes)
    ? canvasData.nodes.map((node) => {
        if (!node || typeof node !== "object") return node;
        const copy = { ...node };
        for (const field of nodeFieldsNullable) {
          if (!(field in copy)) continue;
          const original = copy[field];
          if (original == null) continue;
          const safe = this.sanitizeDisplayUrlForPersist(original);
          if (safe !== original) {
            copy[field] = safe;
          }
        }
        if (Array.isArray(copy.characterReferenceUrls)) {
          copy.characterReferenceUrls = copy.characterReferenceUrls
            .map((item) => this.sanitizeDisplayUrlForPersist(item))
            .filter(Boolean);
        }
        if (
          node.status === "success" &&
          node.resultUrl != null &&
          copy.resultUrl == null
        ) {
          copy.status = "idle";
        }
        return copy;
      })
    : canvasData.nodes;

  const nextGroups = Array.isArray(canvasData.groups)
    ? canvasData.groups.map((group) => {
        if (!group || !group.storyContext || typeof group.storyContext !== "object") {
          return group;
        }
        if (!("compositeImageUrl" in group.storyContext)) return group;
        const original = group.storyContext.compositeImageUrl;
        if (original == null) return group;
        const safe = this.sanitizeDisplayUrlForPersist(original);
        if (safe === original) return group;
        return {
          ...group,
          storyContext: { ...group.storyContext, compositeImageUrl: safe },
        };
      })
    : canvasData.groups;

  return { ...canvasData, nodes: nextNodes, groups: nextGroups };
};

MockStore.prototype.dedupeAgentCanvasProjectBucket = function dedupeAgentCanvasProjectBucket(actorId) {
  const items = ensureAgentCanvasProjectBucket(this.state, actorId);
  if (items.length < 2) return items;

  const byId = new Map();
  const withoutStableId = [];
  for (const item of items) {
    const id = typeof item?.id === "string" ? item.id.trim() : "";
    if (!id) {
      withoutStableId.push(item);
      continue;
    }
    if (item.id !== id) item.id = id;
    const existing = byId.get(id);
    if (!existing || compareCanvasProjectFreshness(item, existing) < 0) {
      byId.set(id, item);
    }
  }

  const next = [...withoutStableId, ...byId.values()].sort(compareCanvasProjectFreshness);
  const changed = next.length !== items.length || next.some((item, index) => item !== items[index]);
  if (changed) {
    this.state.agentCanvasProjectsByActorId[actorId] = next;
  }
  return this.state.agentCanvasProjectsByActorId[actorId];
};

MockStore.prototype.findAgentCanvasProjectEntry = function findAgentCanvasProjectEntry(projectId) {
  if (!this.state.agentCanvasProjectsByActorId || typeof this.state.agentCanvasProjectsByActorId !== "object") {
    this.state.agentCanvasProjectsByActorId = {};
  }
  for (const actorId of Object.keys(this.state.agentCanvasProjectsByActorId)) {
    this.dedupeAgentCanvasProjectBucket(actorId);
  }
  for (const [bucketActorId, items] of Object.entries(this.state.agentCanvasProjectsByActorId || {})) {
    const entry = (items || []).find((item) => item.id === projectId);
    if (entry) {
      return { bucketActorId, items, project: entry };
    }
  }
  return null;
};

MockStore.prototype.listAgentCanvasProjects = function listAgentCanvasProjects(actorId) {
  const actor = this.resolveActor(actorId);
  const items = ensureAgentCanvasProjectBucket(this.state, actor.id);
  this.dedupeAgentCanvasProjectBucket(actor.id);
  return clone(items);
};

MockStore.prototype.listAgentCanvasProjectSummaries = function listAgentCanvasProjectSummaries(actorId) {
  const actor = this.resolveActor(actorId);
  const items = ensureAgentCanvasProjectBucket(this.state, actor.id);
  this.dedupeAgentCanvasProjectBucket(actor.id);
  return clone(
    items.map((item) => ({
      id: item.id,
      actorId: item.actorId,
      title: item.title,
      thumbnailUrl: item.thumbnailUrl,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      kind: "agent_canvas",
    })),
  );
};

MockStore.prototype.getAgentCanvasProject = function getAgentCanvasProject(actorId, projectId) {
  const actor = this.resolveActor(actorId);
  const entry = this.findAgentCanvasProjectEntry(projectId);
  if (!entry || entry.bucketActorId !== actor.id) return null;
  return clone(entry.project);
};

MockStore.prototype.saveAgentCanvasProject = function saveAgentCanvasProject(actorId, input) {
  const actor = this.resolveActor(actorId);
  let items = ensureAgentCanvasProjectBucket(this.state, actor.id);
  this.dedupeAgentCanvasProjectBucket(actor.id);
  items = this.state.agentCanvasProjectsByActorId[actor.id];

  if (input && typeof input === "object") {
    input = {
      ...input,
      thumbnailUrl:
        input.thumbnailUrl != null
          ? this.sanitizeDisplayUrlForPersist(input.thumbnailUrl)
          : input.thumbnailUrl,
      canvasData: this.sanitizeAgentCanvasProjectData(input.canvasData),
      baseCanvasData: this.sanitizeAgentCanvasProjectData(input.baseCanvasData),
      agentContext: input.agentContext !== undefined
        ? normalizeAgentCanvasContext(input.agentContext)
        : input.agentContext,
    };
  } else {
    input = {};
  }

  const now = new Date().toISOString();
  const inputId = typeof input.id === "string" ? input.id.trim() : "";

  if (inputId) {
    const foreignEntry = this.findAgentCanvasProjectEntry(inputId);
    if (foreignEntry && foreignEntry.bucketActorId !== actor.id) {
      throw apiError(403, "FORBIDDEN", "You do not have access to this agent canvas project.");
    }

    const existing = items.find((item) => item.id === inputId);
    if (existing) {
      const expectedUpdatedAt =
        typeof input.expectedUpdatedAt === "string" && input.expectedUpdatedAt.trim()
          ? input.expectedUpdatedAt.trim()
          : null;

      if (expectedUpdatedAt && existing.updatedAt && existing.updatedAt !== expectedUpdatedAt && input.canvasData) {
        const merged = tryMergeCanvasProject(existing, input);
        if (!merged.ok) {
          const reason = merged.conflict || "canvasData";
          throw apiError(
            409,
            "CONFLICT",
            `Agent canvas project was updated elsewhere and could not be auto-merged safely (${reason}). Please reload the latest version before saving again.`,
          );
        }

        Object.assign(existing, {
          title: merged.value.title || existing.title,
          thumbnailUrl:
            merged.value.thumbnailUrl !== undefined
              ? merged.value.thumbnailUrl
              : existing.thumbnailUrl,
          canvasData: merged.value.canvasData,
          agentContext:
            input.agentContext !== undefined ? input.agentContext : existing.agentContext ?? null,
          updatedAt: now,
          kind: "agent_canvas",
        });
        this.dedupeAgentCanvasProjectBucket(actor.id);
        return clone(existing);
      }

      Object.assign(existing, {
        title: input.title || existing.title,
        thumbnailUrl: input.thumbnailUrl !== undefined ? input.thumbnailUrl : existing.thumbnailUrl,
        canvasData: input.canvasData !== undefined ? input.canvasData : existing.canvasData,
        agentContext: input.agentContext !== undefined ? input.agentContext : existing.agentContext ?? null,
        updatedAt: now,
        kind: "agent_canvas",
      });
      this.dedupeAgentCanvasProjectBucket(actor.id);
      return clone(existing);
    }
  }

  const project = {
    id: inputId || `agent_canvas_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
    actorId: actor.id,
    kind: "agent_canvas",
    title: input.title || "未命名智能画布项目",
    thumbnailUrl: input.thumbnailUrl || null,
    canvasData: input.canvasData || null,
    agentContext: input.agentContext !== undefined ? input.agentContext : null,
    createdAt: now,
    updatedAt: now,
  };

  items.unshift(project);
  this.dedupeAgentCanvasProjectBucket(actor.id);
  return clone(project);
};

MockStore.prototype.deleteAgentCanvasProject = function deleteAgentCanvasProject(actorId, projectId) {
  const actor = this.resolveActor(actorId);
  const items = ensureAgentCanvasProjectBucket(this.state, actor.id);
  const next = items.filter((item) => item.id !== projectId);
  if (next.length === items.length) return false;
  this.state.agentCanvasProjectsByActorId[actor.id] = next;
  return true;
};

function normalizePlaygroundString(value, maxLength = 12000) {
  return String(value || "").trim().slice(0, maxLength);
}

function normalizePlaygroundKey(value) {
  return normalizePlaygroundString(value, 80)
    .replace(/\s+/g, " ")
    .replace(/[\\/]+/g, "-");
}

function buildPlaygroundTitle(value) {
  const normalized = normalizePlaygroundString(value, 80).replace(/\s+/g, " ");
  if (!normalized) return "新对话";
  return normalized.length > 32 ? `${normalized.slice(0, 32)}...` : normalized;
}

const PLAYGROUND_CHAT_JOB_STATUSES = new Set(["queued", "running", "succeeded", "failed", "cancelled"]);
const PLAYGROUND_CHAT_JOB_TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

function normalizePlaygroundChatJobStatus(value, fallback = "queued") {
  const normalized = String(value || fallback).trim();
  return PLAYGROUND_CHAT_JOB_STATUSES.has(normalized) ? normalized : fallback;
}

MockStore.prototype.ensurePlaygroundState = function ensurePlaygroundState() {
  let changed = false;
  if (!this.state.playgroundConversationsByActorId || typeof this.state.playgroundConversationsByActorId !== "object") {
    this.state.playgroundConversationsByActorId = {};
    changed = true;
  }
  if (!this.state.playgroundMessagesByConversationId || typeof this.state.playgroundMessagesByConversationId !== "object") {
    this.state.playgroundMessagesByConversationId = {};
    changed = true;
  }
  if (!this.state.playgroundMemoriesByActorId || typeof this.state.playgroundMemoriesByActorId !== "object") {
    this.state.playgroundMemoriesByActorId = {};
    changed = true;
  }
  if (!this.state.playgroundMemoryPreferencesByActorId || typeof this.state.playgroundMemoryPreferencesByActorId !== "object") {
    this.state.playgroundMemoryPreferencesByActorId = {};
    changed = true;
  }
  if (!this.state.playgroundChatJobsByActorId || typeof this.state.playgroundChatJobsByActorId !== "object") {
    this.state.playgroundChatJobsByActorId = {};
    changed = true;
  }
  return changed;
};

MockStore.prototype.getPlaygroundActor = function getPlaygroundActor(actorId) {
  this.ensurePlaygroundState();
  return this.resolveActor(actorId || "guest");
};

MockStore.prototype.getPlaygroundConversationBucket = function getPlaygroundConversationBucket(actorId) {
  const actor = this.getPlaygroundActor(actorId);
  if (!Array.isArray(this.state.playgroundConversationsByActorId[actor.id])) {
    this.state.playgroundConversationsByActorId[actor.id] = [];
  }
  return { actor, items: this.state.playgroundConversationsByActorId[actor.id] };
};

MockStore.prototype.requirePlaygroundConversation = function requirePlaygroundConversation(actorId, conversationId) {
  const { actor, items } = this.getPlaygroundConversationBucket(actorId);
  const conversation = items.find((item) => item.id === conversationId);
  if (!conversation) {
    throw apiError(404, "NOT_FOUND", "Playground conversation not found.");
  }
  return { actor, conversation, items };
};

MockStore.prototype.listPlaygroundModels = function listPlaygroundModels() {
  const config = this.state.apiCenterConfig || {};
  const models = [];
  for (const vendor of config.vendors || []) {
    for (const model of vendor.models || []) {
      if (model.domain !== "text") continue;
      if (model.enabled === false) continue;
      models.push({
        id: model.id,
        name: model.name || model.id,
        provider: vendor.name || vendor.id,
        configured: vendor.connected !== false || vendor.apiKeyConfigured === true,
        default: config.defaults?.textModelId === model.id,
      });
    }
  }

  if (!models.some((item) => item.id === "qwen-plus")) {
    models.unshift({
      id: "qwen-plus",
      name: "Qwen Plus",
      provider: "DashScope",
      configured: hasAliyunApiKey(),
      default: !config.defaults?.textModelId,
    });
  }
  if (!models.some((item) => item.id === "vertex:gemini-3-flash-preview")) {
    models.push({
      id: "vertex:gemini-3-flash-preview",
      name: "Gemini 3 Flash",
      provider: "Vertex AI",
      configured:
        typeof vertex.hasVertexCredentials === "function"
          ? vertex.hasVertexCredentials()
          : false,
      default: false,
    });
  }

  return clone(models);
};

MockStore.prototype.createPlaygroundConversation = function createPlaygroundConversation(actorId, input = {}) {
  const { actor, items } = this.getPlaygroundConversationBucket(actorId);
  const now = new Date().toISOString();
  const model = normalizePlaygroundString(
    input.model || this.getDefaultModelId("textModelId", "qwen-plus"),
    120,
  ) || "qwen-plus";
  const conversation = {
    id: `pg_${randomUUID().replace(/-/g, "").slice(0, 14)}`,
    actorId: actor.id,
    title: buildPlaygroundTitle(input.title || input.firstMessage || ""),
    model,
    createdAt: now,
    updatedAt: now,
    lastMessageAt: null,
    messageCount: 0,
    archived: false,
  };
  items.unshift(conversation);
  this.state.playgroundMessagesByConversationId[conversation.id] = [];
  return clone(conversation);
};

MockStore.prototype.listPlaygroundConversations = function listPlaygroundConversations(actorId, options = {}) {
  const { items } = this.getPlaygroundConversationBucket(actorId);
  const search = normalizePlaygroundString(options.search || "", 80).toLowerCase();
  const limit = Math.min(Math.max(Number(options.limit || 80), 1), 200);
  const filtered = items
    .filter((item) => !search || String(item.title || "").toLowerCase().includes(search))
    .sort((left, right) => {
      const leftTime = Date.parse(left.lastMessageAt || left.updatedAt || left.createdAt || "");
      const rightTime = Date.parse(right.lastMessageAt || right.updatedAt || right.createdAt || "");
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    })
    .slice(0, limit);
  return clone(filtered);
};

MockStore.prototype.getPlaygroundConversation = function getPlaygroundConversation(actorId, conversationId) {
  const { conversation } = this.requirePlaygroundConversation(actorId, conversationId);
  return clone(conversation);
};

MockStore.prototype.updatePlaygroundConversation = function updatePlaygroundConversation(actorId, conversationId, input = {}) {
  const { conversation } = this.requirePlaygroundConversation(actorId, conversationId);
  const title = normalizePlaygroundString(input.title, 120);
  const model = normalizePlaygroundString(input.model, 120);
  if (title) conversation.title = title;
  if (model) conversation.model = model;
  conversation.updatedAt = new Date().toISOString();
  return clone(conversation);
};

MockStore.prototype.deletePlaygroundConversation = function deletePlaygroundConversation(actorId, conversationId) {
  const { actor, items } = this.getPlaygroundConversationBucket(actorId);
  const next = items.filter((item) => item.id !== conversationId);
  if (next.length === items.length) return false;
  this.state.playgroundConversationsByActorId[actor.id] = next;
  delete this.state.playgroundMessagesByConversationId[conversationId];
  const jobs = this.state.playgroundChatJobsByActorId?.[actor.id];
  if (Array.isArray(jobs)) {
    this.state.playgroundChatJobsByActorId[actor.id] = jobs.filter((item) => item.conversationId !== conversationId);
  }
  return true;
};

MockStore.prototype.listPlaygroundMessages = function listPlaygroundMessages(actorId, conversationId) {
  this.requirePlaygroundConversation(actorId, conversationId);
  const messages = Array.isArray(this.state.playgroundMessagesByConversationId[conversationId])
    ? this.state.playgroundMessagesByConversationId[conversationId]
    : [];
  return clone(messages);
};

MockStore.prototype.appendPlaygroundMessage = function appendPlaygroundMessage(actorId, conversationId, input = {}) {
  const { conversation } = this.requirePlaygroundConversation(actorId, conversationId);
  if (!Array.isArray(this.state.playgroundMessagesByConversationId[conversationId])) {
    this.state.playgroundMessagesByConversationId[conversationId] = [];
  }
  const now = new Date().toISOString();
  const role = ["system", "user", "assistant"].includes(input.role) ? input.role : "user";
  const message = {
    id: `pg_msg_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    conversationId,
    actorId: conversation.actorId,
    role,
    content: normalizePlaygroundString(input.content, 30000),
    model: normalizePlaygroundString(input.model || conversation.model || "", 120) || null,
    status: input.status || "complete",
    metadata: normalizePlainObject(input.metadata) || {},
    createdAt: now,
    updatedAt: now,
  };
  this.state.playgroundMessagesByConversationId[conversationId].push(message);
  conversation.updatedAt = now;
  conversation.lastMessageAt = now;
  conversation.messageCount = this.state.playgroundMessagesByConversationId[conversationId].length;
  if (role === "user" && (!conversation.title || conversation.title === "新对话")) {
    conversation.title = buildPlaygroundTitle(message.content);
  }
  return clone(message);
};

MockStore.prototype.replacePlaygroundMessage = function replacePlaygroundMessage(actorId, conversationId, messageId, patch = {}) {
  this.requirePlaygroundConversation(actorId, conversationId);
  const messages = this.state.playgroundMessagesByConversationId[conversationId] || [];
  const message = messages.find((item) => item.id === messageId);
  if (!message) return null;
  if (patch.content !== undefined) {
    message.content = normalizePlaygroundString(patch.content, 30000);
  }
  if (patch.status) {
    message.status = String(patch.status);
  }
  if (patch.metadata && typeof patch.metadata === "object") {
    message.metadata = {
      ...(message.metadata || {}),
      ...normalizePlainObject(patch.metadata),
    };
  }
  message.updatedAt = new Date().toISOString();
  return clone(message);
};

MockStore.prototype.getPlaygroundChatJobBucket = function getPlaygroundChatJobBucket(actorId) {
  const actor = this.getPlaygroundActor(actorId);
  if (!Array.isArray(this.state.playgroundChatJobsByActorId[actor.id])) {
    this.state.playgroundChatJobsByActorId[actor.id] = [];
  }
  return { actor, items: this.state.playgroundChatJobsByActorId[actor.id] };
};

MockStore.prototype.createPlaygroundChatJob = function createPlaygroundChatJob(actorId, input = {}) {
  const { actor, items } = this.getPlaygroundChatJobBucket(actorId);
  const { conversation } = this.requirePlaygroundConversation(actor.id, input.conversationId);
  const now = new Date().toISOString();
  const job = {
    id: `pg_job_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
    actorId: actor.id,
    conversationId: conversation.id,
    userMessageId: normalizePlaygroundString(input.userMessageId, 120) || null,
    assistantMessageId: normalizePlaygroundString(input.assistantMessageId, 120) || null,
    model: normalizePlaygroundString(input.model || conversation.model || "", 120) || null,
    status: normalizePlaygroundChatJobStatus(input.status, "queued"),
    progress: 0,
    request: normalizePlainObject(input.request) || {},
    result: normalizePlainObject(input.result) || null,
    error: normalizePlainObject(input.error) || null,
    createdAt: now,
    startedAt: null,
    finishedAt: null,
    updatedAt: now,
  };
  items.unshift(job);
  if (items.length > 200) {
    items.splice(200);
  }
  return clone(job);
};

MockStore.prototype.listPlaygroundChatJobs = function listPlaygroundChatJobs(actorId, options = {}) {
  const { items } = this.getPlaygroundChatJobBucket(actorId);
  const conversationId = normalizePlaygroundString(options.conversationId, 120);
  const limit = Math.min(Math.max(Number(options.limit || 40), 1), 200);
  const activeOnly = options.activeOnly === true || options.activeOnly === "true" || options.activeOnly === "1";
  const statuses = new Set(
    String(options.status || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const filtered = items
    .filter((item) => !conversationId || item.conversationId === conversationId)
    .filter((item) => !activeOnly || !PLAYGROUND_CHAT_JOB_TERMINAL_STATUSES.has(item.status))
    .filter((item) => statuses.size === 0 || statuses.has(item.status))
    .sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.createdAt || "");
      const rightTime = Date.parse(right.updatedAt || right.createdAt || "");
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    })
    .slice(0, limit);
  return clone(filtered);
};

MockStore.prototype.getPlaygroundChatJob = function getPlaygroundChatJob(actorId, jobId) {
  const { items } = this.getPlaygroundChatJobBucket(actorId);
  const job = items.find((item) => item.id === jobId);
  if (!job) {
    throw apiError(404, "NOT_FOUND", "Playground chat job not found.");
  }
  return clone(job);
};

MockStore.prototype.updatePlaygroundChatJob = function updatePlaygroundChatJob(actorId, jobId, patch = {}) {
  const { items } = this.getPlaygroundChatJobBucket(actorId);
  const job = items.find((item) => item.id === jobId);
  if (!job) return null;

  if (patch.status) {
    const nextStatus = normalizePlaygroundChatJobStatus(patch.status, job.status);
    if (nextStatus !== job.status) {
      job.status = nextStatus;
      if (nextStatus === "running" && !job.startedAt) {
        job.startedAt = new Date().toISOString();
      }
      if (PLAYGROUND_CHAT_JOB_TERMINAL_STATUSES.has(nextStatus) && !job.finishedAt) {
        job.finishedAt = new Date().toISOString();
      }
    }
  }
  if (patch.progress !== undefined) {
    const progress = Number(patch.progress);
    if (Number.isFinite(progress)) {
      job.progress = Math.max(0, Math.min(100, Math.round(progress)));
    }
  }
  if (patch.assistantMessageId !== undefined) {
    job.assistantMessageId = normalizePlaygroundString(patch.assistantMessageId, 120) || null;
  }
  if (patch.result !== undefined) {
    job.result = normalizePlainObject(patch.result) || null;
  }
  if (patch.error !== undefined) {
    job.error = normalizePlainObject(patch.error) || null;
  }
  if (patch.metadata && typeof patch.metadata === "object") {
    job.metadata = {
      ...(job.metadata || {}),
      ...normalizePlainObject(patch.metadata),
    };
  }
  job.updatedAt = new Date().toISOString();
  return clone(job);
};

MockStore.prototype.reconcileStalePlaygroundChatJobs = function reconcileStalePlaygroundChatJobs(staleAfterMs = 0) {
  this.ensurePlaygroundState();
  const cutoff = Date.now() - Math.max(Number(staleAfterMs) || 0, 0);
  let scanned = 0;
  let reaped = 0;
  for (const actorId of Object.keys(this.state.playgroundChatJobsByActorId || {})) {
    const jobs = Array.isArray(this.state.playgroundChatJobsByActorId[actorId])
      ? this.state.playgroundChatJobsByActorId[actorId]
      : [];
    for (const job of jobs) {
      if (PLAYGROUND_CHAT_JOB_TERMINAL_STATUSES.has(job.status)) continue;
      scanned += 1;
      const updatedAt = Date.parse(job.updatedAt || job.startedAt || job.createdAt || "");
      if (staleAfterMs > 0 && Number.isFinite(updatedAt) && updatedAt > cutoff) continue;
      const message = "Playground chat job was interrupted by a server restart.";
      this.updatePlaygroundChatJob(actorId, job.id, {
        status: "failed",
        progress: 100,
        error: { code: "SERVER_RESTARTED", message },
      });
      if (job.assistantMessageId && job.conversationId) {
        this.replacePlaygroundMessage(actorId, job.conversationId, job.assistantMessageId, {
          content: message,
          status: "error",
          metadata: { jobId: job.id, code: "SERVER_RESTARTED" },
        });
      }
      reaped += 1;
    }
  }
  return { scanned, reaped };
};

MockStore.prototype.getPlaygroundMemoryPreference = function getPlaygroundMemoryPreference(actorId) {
  const actor = this.getPlaygroundActor(actorId);
  const existing = this.state.playgroundMemoryPreferencesByActorId[actor.id];
  if (existing && typeof existing === "object") {
    return clone({
      enabled: existing.enabled !== false,
      updatedAt: existing.updatedAt || null,
    });
  }
  return { enabled: true, updatedAt: null };
};

MockStore.prototype.setPlaygroundMemoryPreference = function setPlaygroundMemoryPreference(actorId, input = {}) {
  const actor = this.getPlaygroundActor(actorId);
  const pref = {
    enabled: input.enabled !== false,
    updatedAt: new Date().toISOString(),
  };
  this.state.playgroundMemoryPreferencesByActorId[actor.id] = pref;
  return clone(pref);
};

MockStore.prototype.getPlaygroundMemoryBucket = function getPlaygroundMemoryBucket(actorId) {
  const actor = this.getPlaygroundActor(actorId);
  if (!Array.isArray(this.state.playgroundMemoriesByActorId[actor.id])) {
    this.state.playgroundMemoriesByActorId[actor.id] = [];
  }
  return { actor, items: this.state.playgroundMemoriesByActorId[actor.id] };
};

MockStore.prototype.listPlaygroundMemories = function listPlaygroundMemories(actorId) {
  const { items } = this.getPlaygroundMemoryBucket(actorId);
  return clone(
    [...items].sort((left, right) => {
      const leftTime = Date.parse(left.updatedAt || left.createdAt || "");
      const rightTime = Date.parse(right.updatedAt || right.createdAt || "");
      return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
    }),
  );
};

MockStore.prototype.upsertPlaygroundMemories = function upsertPlaygroundMemories(actorId, entries = [], source = {}) {
  const { items } = this.getPlaygroundMemoryBucket(actorId);
  const now = new Date().toISOString();
  const changed = [];
  for (const entry of Array.isArray(entries) ? entries.slice(0, 12) : []) {
    const key = normalizePlaygroundKey(entry?.key);
    const value = normalizePlaygroundString(entry?.value, 1200);
    if (!key || !value) continue;
    const existing = items.find((item) => item.key.toLowerCase() === key.toLowerCase());
    if (existing) {
      if (existing.value !== value) {
        existing.value = value;
      }
      existing.enabled = entry.enabled === false ? false : existing.enabled !== false;
      existing.confidence = Number.isFinite(Number(entry.confidence))
        ? Math.max(0, Math.min(1, Number(entry.confidence)))
        : existing.confidence ?? null;
      existing.sourceConversationId = source.conversationId || existing.sourceConversationId || null;
      existing.sourceMessageId = source.messageId || existing.sourceMessageId || null;
      existing.updatedAt = now;
      changed.push(clone(existing));
      continue;
    }
    const memory = {
      key,
      value,
      enabled: entry.enabled !== false,
      confidence: Number.isFinite(Number(entry.confidence))
        ? Math.max(0, Math.min(1, Number(entry.confidence)))
        : null,
      sourceConversationId: source.conversationId || null,
      sourceMessageId: source.messageId || null,
      createdAt: now,
      updatedAt: now,
    };
    items.unshift(memory);
    changed.push(clone(memory));
  }
  if (items.length > 120) {
    items.splice(120);
  }
  return changed;
};

MockStore.prototype.updatePlaygroundMemory = function updatePlaygroundMemory(actorId, key, input = {}) {
  const { items } = this.getPlaygroundMemoryBucket(actorId);
  const currentKey = normalizePlaygroundKey(key);
  const memory = items.find((item) => item.key === currentKey);
  if (!memory) {
    throw apiError(404, "NOT_FOUND", "Playground memory not found.");
  }
  const nextKey = normalizePlaygroundKey(input.key || currentKey);
  const nextValue = normalizePlaygroundString(input.value ?? memory.value, 1200);
  if (!nextKey || !nextValue) {
    throw apiError(400, "BAD_REQUEST", "Memory key and value are required.");
  }
  if (nextKey !== currentKey && items.some((item) => item.key === nextKey)) {
    throw apiError(409, "CONFLICT", "Memory key already exists.");
  }
  memory.key = nextKey;
  memory.value = nextValue;
  if (input.enabled !== undefined) {
    memory.enabled = input.enabled !== false;
  }
  memory.updatedAt = new Date().toISOString();
  return clone(memory);
};

MockStore.prototype.deletePlaygroundMemory = function deletePlaygroundMemory(actorId, key) {
  const { actor, items } = this.getPlaygroundMemoryBucket(actorId);
  const currentKey = normalizePlaygroundKey(key);
  const next = items.filter((item) => item.key !== currentKey);
  if (next.length === items.length) return false;
  this.state.playgroundMemoriesByActorId[actor.id] = next;
  return true;
};

module.exports = {
  MockStore,
  decodeAuthToken,
};
