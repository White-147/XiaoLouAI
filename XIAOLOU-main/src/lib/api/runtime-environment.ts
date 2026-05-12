import { API_BASE_URL } from "./control-api-client";

export type NetworkAccessEntry = {
  interfaceName: string;
  address: string;
  recommended: boolean;
  frontendBaseUrl: string;
  apiBaseUrl: string;
  homeUrl: string;
  canvasUrl: string;
  videoUrl: string;
};

export type NetworkAccessInfo = {
  hostname: string;
  frontendPort: number;
  apiPort: number;
  recommendedEntries: NetworkAccessEntry[];
  additionalEntries: NetworkAccessEntry[];
  hostnameEntry: {
    hostname: string;
    frontendBaseUrl: string;
    apiBaseUrl: string;
    homeUrl: string;
    canvasUrl: string;
    videoUrl: string;
  };
  note: string;
};

export type JaazServiceProbe = {
  name: "api" | "ui";
  port: number;
  listening: boolean;
  started?: boolean;
  pid?: number | null;
  error?: string;
};

export type JaazServiceStatus = {
  enabled: boolean;
  ensured?: boolean;
  reason?: string;
  root: string;
  api: JaazServiceProbe;
  ui: JaazServiceProbe;
};

function buildLocalNetworkAccessInfo(): NetworkAccessInfo {
  const frontendBaseUrl =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://127.0.0.1:3000";
  const apiBaseUrl = API_BASE_URL || frontendBaseUrl;
  let hostname = "127.0.0.1";
  let frontendPort = 3000;
  let apiPort = 4100;
  try {
    const frontendUrl = new URL(frontendBaseUrl);
    const apiUrl = new URL(apiBaseUrl, frontendBaseUrl);
    hostname = frontendUrl.hostname || hostname;
    frontendPort = Number(frontendUrl.port || (frontendUrl.protocol === "https:" ? 443 : 80));
    apiPort = Number(apiUrl.port || (apiUrl.protocol === "https:" ? 443 : 80));
  } catch {
    /* keep defaults */
  }
  const entry: NetworkAccessEntry = {
    interfaceName: "loopback",
    address: hostname,
    recommended: true,
    frontendBaseUrl,
    apiBaseUrl,
    homeUrl: `${frontendBaseUrl}/home`,
    canvasUrl: `${frontendBaseUrl}/canvas`,
    videoUrl: `${frontendBaseUrl}/video-replace`,
  };
  return {
    hostname,
    frontendPort,
    apiPort,
    recommendedEntries: [entry],
    additionalEntries: [],
    hostnameEntry: {
      hostname,
      frontendBaseUrl,
      apiBaseUrl,
      homeUrl: entry.homeUrl,
      canvasUrl: entry.canvasUrl,
      videoUrl: entry.videoUrl,
    },
    note: "Computed locally by the Windows-native frontend; legacy network discovery writes are retired.",
  };
}

export async function getNetworkAccessInfo() {
  return buildLocalNetworkAccessInfo();
}

export async function ensureJaazServices(): Promise<JaazServiceStatus> {
  return {
    enabled: false,
    ensured: false,
    reason: "Legacy Jaaz service startup is retired in the Windows-native runtime.",
    root: "",
    api: { name: "api", port: 0, listening: false, started: false, pid: null },
    ui: { name: "ui", port: 0, listening: false, started: false, pid: null },
  };
}
