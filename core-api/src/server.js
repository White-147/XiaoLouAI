require("./env").loadEnvFiles();

const http = require("node:http");
const { error, json, matchPath, noContent } = require("./http");
const { buildRoutes } = require("./routes");
const { SqliteStore } = require("./sqlite-store");
const { serveCanvasLibrary } = require("./canvas-library");
const {
  handleVideoReplaceRequest,
  shutdownPipelines,
  reconcileOnStartup: reconcileVideoReplaceOnStartup,
} = require("./video-replace-native");
const { collectNetworkAccessInfo } = require("./network-access");
const { startJaazKeepAlive } = require("./jaaz-services");

async function dispatch(req, res, url, routes, store) {
  for (const route of routes) {
    if (route.method !== req.method) continue;

    const params = matchPath(url.pathname, route.path);
    if (!params) continue;

    try {
      const result = await route.handler({ req, res, url, params, store });

      if (res.writableEnded) return true;
      if (result === undefined) {
        return true;
      }
      if (result && result.error) {
        const { statusCode, code, message } = result.error;
        error(res, statusCode, code, message);
        return true;
      }

      json(res, route.statusCode || 200, result);
      return true;
    } catch (caughtError) {
      if (caughtError?.statusCode && caughtError?.code) {
        error(res, caughtError.statusCode, caughtError.code, caughtError.message);
        return true;
      }

      console.error("core-api request failed", {
        method: req.method,
        path: url.pathname,
        error: caughtError
      });
      error(res, 500, "INTERNAL_ERROR", "unexpected server error");
      return true;
    }
  }

  return false;
}

function createServer() {
  const store = new SqliteStore();

  // Reap create_image/video tasks left non-terminal by a previous crash or an
  // abandoned Vertex/Veo poll. Without this any navigation back to
  // /create/canvas would show the node stuck in 正在生成… forever.
  try {
    if (typeof store.reconcileStaleCreateTasks === "function") {
      const staleAfterMs = Number(process.env.CREATE_TASK_STALE_MS || 10 * 60 * 1000);
      const { scanned, reaped } = store.reconcileStaleCreateTasks(staleAfterMs);
      if (reaped > 0) {
        console.log(
          `[server] create-task startup reconcile: scanned=${scanned} reaped=${reaped} threshold=${staleAfterMs}ms`
        );
      }
    }
  } catch (err) {
    console.error("[server] create-task startup reconcile failed:", err?.message);
  }

  try {
    if (typeof store.reconcileStalePlaygroundChatJobs === "function") {
      const { scanned, reaped } = store.reconcileStalePlaygroundChatJobs(0);
      if (reaped > 0) {
        console.log(`[server] playground chat-job startup reconcile: scanned=${scanned} reaped=${reaped}`);
      }
    }
  } catch (err) {
    console.error("[server] playground chat-job startup reconcile failed:", err?.message);
  }

  const routes = buildRoutes(store);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");

    // Video-replace native handler — checked first so it takes priority over
    // core-api's own /api/* routes and handles its own OPTIONS pre-flight.
    // No port 4200; Python is called as on-demand subprocesses only.
    if (await handleVideoReplaceRequest(req, res, url, store)) {
      return;
    }

    if (req.method === "OPTIONS") {
      noContent(res);
      return;
    }

    if (req.method === "GET" && serveCanvasLibrary(req, res, url.pathname)) {
      return;
    }

    const handled = await dispatch(req, res, url, routes, store);
    if (!handled) {
      error(res, 404, "NOT_FOUND", "route not found");
    }
  });

  server.on("close", () => {
    if (typeof store.close === "function") {
      store.close();
    }
  });

  return server;
}

function formatListenUrl(host, port) {
  const h = (host || "127.0.0.1").trim();
  if (h === "0.0.0.0") {
    return `http://0.0.0.0:${port}`;
  }
  if (h.includes(":")) {
    const inner = h.replace(/^\[|\]$/g, "");
    return `http://[${inner}]:${port}`;
  }
  return `http://${h}:${port}`;
}

if (require.main === module) {
  const port = Number(process.env.PORT || "4100");
  const host = (process.env.HOST || "127.0.0.1").trim();
  const frontendPort = Number(process.env.FRONTEND_PORT || "3000");

  // Reap any VR jobs left in a non-terminal state by a previous crash
  // BEFORE we start accepting new traffic. Kills orphan pipeline / VACE
  // subprocess trees recorded in tasks.sqlite's jobs.data.pipeline_pid /
  // subprocess_pid so they don't keep eating VRAM.
  try {
    const { scanned, reaped } = reconcileVideoReplaceOnStartup();
    if (scanned > 0) {
      console.log(
        `[server] video-replace startup reconcile: scanned=${scanned} reaped=${reaped}`
      );
    }
  } catch (err) {
    console.error("[server] video-replace startup reconcile failed:", err?.message);
  }

  const server = createServer();
  server.listen(port, host, () => {
    console.log(`core-api listening on ${formatListenUrl(host, port)} (video-replace: native, no sidecar)`);
    startJaazKeepAlive();
    try {
      const accessInfo = collectNetworkAccessInfo(frontendPort, port);
      if (accessInfo.recommendedEntries.length) {
        console.log("[server] recommended LAN access:");
        for (const entry of accessInfo.recommendedEntries) {
          console.log(
            `  ${entry.interfaceName}: home=${entry.homeUrl} canvas=${entry.canvasUrl} video=${entry.videoUrl} api=${entry.apiBaseUrl}`,
          );
        }
      }
      console.log(
        `[server] hostname access (may depend on LAN name resolution): ${accessInfo.hostnameEntry.homeUrl}`,
      );
    } catch (err) {
      console.error("[server] failed to collect LAN access info:", err?.message);
    }
  });

  const gracefulShutdown = (signal) => {
    const killPipelinesOnShutdown =
      (process.env.VR_KILL_PIPELINES_ON_SHUTDOWN || "0") === "1";
    if (killPipelinesOnShutdown) {
      console.log(`[server] received ${signal}; killing in-flight VR pipelines`);
      try { shutdownPipelines(`${signal} received`); }
      catch (err) { console.error("[server] shutdownPipelines raised:", err?.message); }
    } else {
      console.log(
        `[server] received ${signal}; leaving detached VR pipelines running for startup reconcile`
      );
    }
    server.close(() => process.exit(0));
    // Hard-exit fallback in case server.close is blocked by sockets.
    setTimeout(() => process.exit(0), 5_000).unref();
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  // On Windows there's no SIGHUP / SIGBREAK default; Node delivers
  // SIGBREAK when the console receives Ctrl+Break.
  process.on("SIGBREAK", () => gracefulShutdown("SIGBREAK"));
}

module.exports = {
  createServer
};
