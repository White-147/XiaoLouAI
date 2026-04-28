const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const WORKSPACE_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_JAAZ_API_PORT = 57988;
const DEFAULT_JAAZ_UI_PORT = 5174;
const DEFAULT_KEEPALIVE_MS = 30_000;
const DEFAULT_START_TIMEOUT_MS = 15_000;

let ensureInFlight = null;
let keepAliveTimer = null;

function readNumberEnv(name, fallback) {
  const value = Number(process.env[name] || "");
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isAutoStartEnabled() {
  return String(process.env.JAAZ_AUTO_START ?? "1") !== "0";
}

function resolveWorkspacePath(configuredValue, fallback) {
  const value = String(configuredValue || "").trim();
  if (!value) return fallback;
  return path.isAbsolute(value) ? value : path.resolve(WORKSPACE_ROOT, value);
}

function resolveCommandOrPath(configuredValue, fallback) {
  const value = String(configuredValue || "").trim();
  if (!value) return fallback;
  if (!value.includes("/") && !value.includes("\\")) return value;
  return resolveWorkspacePath(value, fallback);
}

function resolveServiceConfig() {
  const jaazRoot = resolveWorkspacePath(process.env.JAAZ_ROOT, path.join(WORKSPACE_ROOT, "jaaz"));
  const apiPort = readNumberEnv("JAAZ_API_PORT", DEFAULT_JAAZ_API_PORT);
  const uiPort = readNumberEnv("JAAZ_UI_PORT", DEFAULT_JAAZ_UI_PORT);
  const pythonExecutable = resolveCommandOrPath(
    process.env.JAAZ_PYTHON,
    path.join(jaazRoot, ".venv", "Scripts", "python.exe"),
  );

  return {
    jaazRoot,
    apiPort,
    uiPort,
    pythonExecutable,
    apiDir: path.join(jaazRoot, "server"),
    uiDir: path.join(jaazRoot, "react"),
    apiOutLog: path.join(jaazRoot, `jaaz-server-${apiPort}.out.log`),
    apiErrLog: path.join(jaazRoot, `jaaz-server-${apiPort}.err.log`),
    uiOutLog: path.join(jaazRoot, "react", "vite-dev.log"),
    uiErrLog: path.join(jaazRoot, "react", "vite-dev.err.log"),
  };
}

function isDirectory(dirPath) {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

function openAppendLog(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return fs.openSync(filePath, "a");
}

function spawnDetached(command, args, options) {
  let outFd = null;
  let errFd = null;
  try {
    outFd = openAppendLog(options.outLog);
    errFd = openAppendLog(options.errLog);
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: true,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
      shell: false,
      stdio: ["ignore", outFd, errFd],
      windowsHide: true,
    });
    child.once("error", (error) => {
      console.error("[jaaz] detached process failed:", error?.message || error);
    });
    child.unref();
    return child;
  } finally {
    if (outFd !== null) {
      try { fs.closeSync(outFd); } catch {}
    }
    if (errFd !== null) {
      try { fs.closeSync(errFd); } catch {}
    }
  }
}

function isPortListening(port, host = "127.0.0.1", timeoutMs = 1_200) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (listening) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };

    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

async function waitForPort(port, timeoutMs = DEFAULT_START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortListening(port, "127.0.0.1", 800)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return isPortListening(port, "127.0.0.1", 800);
}

async function ensureApi(config) {
  if (await isPortListening(config.apiPort)) {
    return {
      name: "api",
      port: config.apiPort,
      listening: true,
      started: false,
    };
  }

  if (!isDirectory(config.apiDir)) {
    return {
      name: "api",
      port: config.apiPort,
      listening: false,
      started: false,
      error: `Jaaz API directory not found: ${config.apiDir}`,
    };
  }

  const pythonCommand = fs.existsSync(config.pythonExecutable)
    ? config.pythonExecutable
    : "python";

  let pid = null;
  try {
    const child = spawnDetached(
      pythonCommand,
      ["main.py", "--port", String(config.apiPort)],
      {
        cwd: config.apiDir,
        outLog: config.apiOutLog,
        errLog: config.apiErrLog,
      },
    );
    pid = child.pid || null;
  } catch (error) {
    return {
      name: "api",
      port: config.apiPort,
      listening: false,
      started: false,
      error: error?.message || "failed to start Jaaz API",
    };
  }

  return {
    name: "api",
    port: config.apiPort,
    listening: await waitForPort(config.apiPort),
    started: true,
    pid,
  };
}

async function ensureUi(config) {
  if (await isPortListening(config.uiPort)) {
    return {
      name: "ui",
      port: config.uiPort,
      listening: true,
      started: false,
    };
  }

  if (!isDirectory(config.uiDir)) {
    return {
      name: "ui",
      port: config.uiPort,
      listening: false,
      started: false,
      error: `Jaaz UI directory not found: ${config.uiDir}`,
    };
  }

  const npmCommand = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
  const npmArgs = process.platform === "win32"
    ? ["/d", "/s", "/c", "npm.cmd", "run", "dev"]
    : ["run", "dev"];
  let pid = null;
  try {
    const child = spawnDetached(
      npmCommand,
      npmArgs,
      {
        cwd: config.uiDir,
        outLog: config.uiOutLog,
        errLog: config.uiErrLog,
      },
    );
    pid = child.pid || null;
  } catch (error) {
    return {
      name: "ui",
      port: config.uiPort,
      listening: false,
      started: false,
      error: error?.message || "failed to start Jaaz UI",
    };
  }

  return {
    name: "ui",
    port: config.uiPort,
    listening: await waitForPort(config.uiPort),
    started: true,
    pid,
  };
}

async function getJaazServiceStatus() {
  const config = resolveServiceConfig();
  const [apiListening, uiListening] = await Promise.all([
    isPortListening(config.apiPort),
    isPortListening(config.uiPort),
  ]);

  return {
    enabled: isAutoStartEnabled(),
    root: config.jaazRoot,
    api: {
      name: "api",
      port: config.apiPort,
      listening: apiListening,
    },
    ui: {
      name: "ui",
      port: config.uiPort,
      listening: uiListening,
    },
  };
}

async function ensureJaazServices(options = {}) {
  if (!isAutoStartEnabled()) {
    const status = await getJaazServiceStatus();
    return {
      ...status,
      ensured: false,
      reason: options.reason || "manual",
    };
  }

  if (ensureInFlight) {
    return ensureInFlight;
  }

  ensureInFlight = (async () => {
    const config = resolveServiceConfig();
    const [api, ui] = await Promise.all([
      ensureApi(config),
      ensureUi(config),
    ]);

    const status = {
      enabled: true,
      ensured: true,
      reason: options.reason || "manual",
      root: config.jaazRoot,
      api,
      ui,
    };

    if (api.started || ui.started) {
      console.log("[jaaz] ensure", {
        reason: status.reason,
        api,
        ui,
      });
    }

    return status;
  })().finally(() => {
    ensureInFlight = null;
  });

  return ensureInFlight;
}

function startJaazKeepAlive() {
  if (!isAutoStartEnabled()) {
    return null;
  }

  void ensureJaazServices({ reason: "startup" }).catch((error) => {
    console.error("[jaaz] startup ensure failed:", error?.message || error);
  });

  if (keepAliveTimer) {
    return keepAliveTimer;
  }

  const intervalMs = readNumberEnv("JAAZ_KEEPALIVE_MS", DEFAULT_KEEPALIVE_MS);
  keepAliveTimer = setInterval(() => {
    void ensureJaazServices({ reason: "keepalive" }).catch((error) => {
      console.error("[jaaz] keepalive failed:", error?.message || error);
    });
  }, intervalMs);
  keepAliveTimer.unref?.();

  return keepAliveTimer;
}

module.exports = {
  ensureJaazServices,
  getJaazServiceStatus,
  startJaazKeepAlive,
};
