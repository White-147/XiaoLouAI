import { ApiRequestError } from "./control-api-client";
import type { ApiCenterConfig } from "./auth-account-types";

const LOCAL_API_CENTER_CONFIG_STORAGE_PREFIX =
  "xiaolou.windows-native.api-center-config.v1";

export const DEFAULT_API_CENTER_CONFIG: ApiCenterConfig = {
  vendors: [
    {
      id: "dashscope",
      name: "Alibaba Cloud DashScope",
      connected: false,
      apiKeyConfigured: false,
      lastCheckedAt: null,
      supportedDomains: ["text", "vision", "audio"],
      models: [
        {
          id: "qwen-plus",
          name: "Qwen Plus",
          domain: "text",
          inputPrice: "local",
          outputPrice: "local",
          enabled: true,
        },
        {
          id: "qwen-vl-plus",
          name: "Qwen VL Plus",
          domain: "vision",
          inputPrice: "local",
          outputPrice: "local",
          enabled: true,
        },
        {
          id: "qwen3.5-omni-flash",
          name: "Qwen Omni Flash",
          domain: "audio",
          inputPrice: "local",
          outputPrice: "local",
          enabled: true,
        },
      ],
    },
    {
      id: "bytedance",
      name: "ByteDance Volcano Engine",
      connected: false,
      apiKeyConfigured: false,
      lastCheckedAt: null,
      supportedDomains: ["image", "video"],
      models: [
        {
          id: "doubao-seedream-5-0-260128",
          name: "Seedream 5.0",
          domain: "image",
          inputPrice: "local",
          outputPrice: "local",
          enabled: true,
        },
        {
          id: "doubao-seedance-2-0-260128",
          name: "Seedance 2.0",
          domain: "video",
          inputPrice: "local",
          outputPrice: "local",
          enabled: true,
        },
      ],
    },
    {
      id: "google-vertex",
      name: "Google Vertex AI",
      connected: false,
      apiKeyConfigured: false,
      lastCheckedAt: null,
      supportedDomains: ["text", "vision", "image", "video"],
      models: [
        {
          id: "vertex:gemini-3-flash-preview",
          name: "Gemini 3 Flash (Vertex)",
          domain: "text",
          inputPrice: "local",
          outputPrice: "local",
          enabled: true,
        },
        {
          id: "vertex:gemini-3.1-pro-preview",
          name: "Gemini 3.1 Pro (Vertex)",
          domain: "text",
          inputPrice: "local",
          outputPrice: "local",
          enabled: true,
        },
        {
          id: "vertex:gemini-3-pro-image-preview",
          name: "Gemini 3 Pro Image+",
          domain: "image",
          inputPrice: "local",
          outputPrice: "local",
          enabled: true,
        },
        {
          id: "vertex:gemini-3.1-flash-image-preview",
          name: "Gemini 3.1 Flash Image+",
          domain: "image",
          inputPrice: "local",
          outputPrice: "local",
          enabled: true,
        },
        {
          id: "vertex:veo-3.1-generate-001",
          name: "Veo 3.1+",
          domain: "video",
          inputPrice: "local",
          outputPrice: "local",
          enabled: true,
        },
        {
          id: "vertex:veo-3.1-fast-generate-001",
          name: "Veo 3.1 Fast+",
          domain: "video",
          inputPrice: "local",
          outputPrice: "local",
          enabled: true,
        },
        {
          id: "vertex:veo-3.1-lite-generate-001",
          name: "Veo 3.1 Lite+",
          domain: "video",
          inputPrice: "local",
          outputPrice: "local",
          enabled: true,
        },
      ],
    },
    {
      id: "kling",
      name: "Kling",
      connected: false,
      apiKeyConfigured: false,
      lastCheckedAt: null,
      supportedDomains: ["video"],
      models: [
        {
          id: "kling-video",
          name: "Kling Video",
          domain: "video",
          inputPrice: "local",
          outputPrice: "local",
          enabled: true,
        },
      ],
    },
  ],
  defaults: {
    textModelId: "qwen-plus",
    visionModelId: "qwen-vl-plus",
    imageModelId: "vertex:gemini-3-pro-image-preview",
    videoModelId: "vertex:veo-3.1-generate-001",
    audioModelId: "qwen3.5-omni-flash",
  },
  strategies: {
    "windows-native":
      "Provider configuration is a local draft until the .NET canonical secret/config store lands.",
  },
  nodeAssignments: [
    {
      nodeCode: "playground_chat",
      nodeName: "Playground chat",
      primaryModelId: "qwen-plus",
      fallbackModelIds: ["qwen-vl-plus"],
    },
    {
      nodeCode: "create_image_generate",
      nodeName: "Create image",
      primaryModelId: "vertex:gemini-3-pro-image-preview",
      fallbackModelIds: ["doubao-seedream-5-0-260128"],
    },
    {
      nodeCode: "create_video_generate",
      nodeName: "Create video",
      primaryModelId: "vertex:veo-3.1-generate-001",
      fallbackModelIds: ["doubao-seedance-2-0-260128", "kling-video"],
    },
  ],
  toolboxAssignments: [
    {
      nodeCode: "storyboard_grid25_generate",
      nodeName: "25-grid storyboard",
      primaryModelId: "vertex:gemini-3-pro-image-preview",
      fallbackModelIds: ["doubao-seedream-5-0-260128"],
    },
  ],
};

function localStorageGetJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function localStorageSetJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function cloneApiCenterConfig(
  config: ApiCenterConfig = DEFAULT_API_CENTER_CONFIG,
): ApiCenterConfig {
  return JSON.parse(JSON.stringify(config)) as ApiCenterConfig;
}

function mergeApiCenterConfigDefaults(config: ApiCenterConfig): ApiCenterConfig {
  const fallback = cloneApiCenterConfig();
  const vendors = config.vendors.map((vendor) => {
    const fallbackVendor = fallback.vendors.find((item) => item.id === vendor.id);
    if (!fallbackVendor) {
      return vendor;
    }

    const models = vendor.models.map((model) => {
      const fallbackModel = fallbackVendor.models.find((item) => item.id === model.id);
      return fallbackModel ? { ...fallbackModel, ...model } : model;
    });
    for (const fallbackModel of fallbackVendor.models) {
      if (!models.some((model) => model.id === fallbackModel.id)) {
        models.push(fallbackModel);
      }
    }

    return {
      ...fallbackVendor,
      ...vendor,
      supportedDomains: Array.from(
        new Set([...fallbackVendor.supportedDomains, ...vendor.supportedDomains]),
      ),
      models,
    };
  });
  for (const fallbackVendor of fallback.vendors) {
    if (!vendors.some((vendor) => vendor.id === fallbackVendor.id)) {
      vendors.push(fallbackVendor);
    }
  }

  return {
    ...fallback,
    ...config,
    vendors,
    defaults: { ...fallback.defaults, ...config.defaults },
    strategies: { ...fallback.strategies, ...config.strategies },
    nodeAssignments: config.nodeAssignments?.length
      ? config.nodeAssignments
      : fallback.nodeAssignments,
    toolboxAssignments: config.toolboxAssignments?.length
      ? config.toolboxAssignments
      : fallback.toolboxAssignments,
  };
}

export function readLocalApiCenterConfig() {
  return mergeApiCenterConfigDefaults(
    localStorageGetJson<ApiCenterConfig>(
      LOCAL_API_CENTER_CONFIG_STORAGE_PREFIX,
      cloneApiCenterConfig(),
    ),
  );
}

export function writeLocalApiCenterConfig(config: ApiCenterConfig) {
  localStorageSetJson(LOCAL_API_CENTER_CONFIG_STORAGE_PREFIX, config);
  return config;
}

export function findApiVendor(config: ApiCenterConfig, vendorId: string) {
  const vendor = config.vendors.find((item) => item.id === vendorId);
  if (!vendor) {
    throw new ApiRequestError(
      "API vendor is not available in the Windows-native local config draft.",
      {
        code: "API_VENDOR_NOT_FOUND",
        status: 404,
      },
    );
  }
  return vendor;
}
