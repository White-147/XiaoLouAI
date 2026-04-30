const os = require("node:os");

function isIpv4Family(family) {
  return family === "IPv4" || family === 4;
}

function isBenchmarkAddress(address) {
  return /^198\.(18|19)\./.test(address);
}

function isApipaAddress(address) {
  return /^169\.254\./.test(address);
}

function isLikelyVirtualInterface(name) {
  return /loopback|vethernet|virtual|vmware|docker|wsl|hyper-v|tailscale|zerotier|clash|flclash|tap|tun|vpn|bridge/i.test(
    String(name || ""),
  );
}

function buildFrontendBaseUrl(address, frontendPort) {
  return `http://${address}:${frontendPort}`;
}

function buildApiBaseUrl(address, apiPort) {
  return `http://${address}:${apiPort}`;
}

function toAccessEntry(interfaceName, address, frontendPort, apiPort, recommended) {
  const frontendBaseUrl = buildFrontendBaseUrl(address, frontendPort);
  return {
    interfaceName,
    address,
    recommended,
    frontendBaseUrl,
    apiBaseUrl: buildApiBaseUrl(address, apiPort),
    homeUrl: `${frontendBaseUrl}/home`,
    canvasUrl: `${frontendBaseUrl}/create/canvas`,
    videoUrl: `${frontendBaseUrl}/create/video`,
  };
}

function collectNetworkAccessInfo(frontendPort = 3000, apiPort = 4100) {
  const interfaces = os.networkInterfaces();
  const seen = new Set();
  const entries = [];

  for (const [interfaceName, records] of Object.entries(interfaces)) {
    for (const record of records || []) {
      if (!record || !isIpv4Family(record.family) || record.internal) continue;
      const address = String(record.address || "").trim();
      if (!address || seen.has(address)) continue;
      seen.add(address);

      const virtual =
        isLikelyVirtualInterface(interfaceName) ||
        isBenchmarkAddress(address) ||
        isApipaAddress(address);

      entries.push(
        toAccessEntry(interfaceName, address, frontendPort, apiPort, !virtual),
      );
    }
  }

  const recommendedEntries = entries
    .filter((entry) => entry.recommended)
    .sort((a, b) => a.address.localeCompare(b.address, "en"));
  const additionalEntries = entries
    .filter((entry) => !entry.recommended)
    .sort((a, b) => a.address.localeCompare(b.address, "en"));

  const hostname = os.hostname();
  const hostnameEntry = {
    hostname,
    frontendBaseUrl: buildFrontendBaseUrl(hostname, frontendPort),
    apiBaseUrl: buildApiBaseUrl(hostname, apiPort),
    homeUrl: `http://${hostname}:${frontendPort}/home`,
    canvasUrl: `http://${hostname}:${frontendPort}/create/canvas`,
    videoUrl: `http://${hostname}:${frontendPort}/create/video`,
  };

  return {
    hostname,
    frontendPort,
    apiPort,
    recommendedEntries,
    additionalEntries,
    hostnameEntry,
    note:
      "推荐优先使用 IP 地址访问；主机名入口依赖局域网 DNS 或 NetBIOS 解析，可能不可用。",
  };
}

module.exports = {
  collectNetworkAccessInfo,
};
