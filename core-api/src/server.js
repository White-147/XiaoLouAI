require("./env").loadEnvFiles();

const http = require("node:http");
const { error, json, matchPath, noContent } = require("./http");
const { buildRoutes } = require("./routes");
const { createStore } = require("./store-factory");
const { serveCanvasLibrary } = require("./canvas-library");
const {
  closeVideoReplaceStorage,
  handleVideoReplaceRequest,
  initializeVideoReplaceStorage,
  shutdownPipelines,
  reconcileOnStartup: reconcileVideoReplaceOnStartup,
} = require("./video-replace-native");
const { collectNetworkAccessInfo } = require("./network-access");
const { handleJaazGatewayRequest, handleJaazGatewayUpgrade } = require("./jaaz-gateway");
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

async function createServer() {
  const store = await createStore();
  await initializeVideoReplaceStorage();

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

    if (await handleJaazGatewayRequest(req, res, url)) {
      return;
    }

    const handled = await dispatch(req, res, url, routes, store);
    if (!handled) {
      error(res, 404, "NOT_FOUND", "route not found");
    }
  });

  server.on("close", () => {
    if (typeof store.close === "function") {
      Promise.resolve(store.close()).catch((err) => {
        console.error("[server] store close failed:", err?.message || err);
      });
    }
    Promise.resolve(closeVideoReplaceStorage()).catch((err) => {
      console.error("[server] video-replace storage close failed:", err?.message || err);
    });
  });

  server.on("upgrade", (req, socket, head) => {
    if (handleJaazGatewayUpgrade(req, socket, head)) {
      return;
    }
    socket.destroy();
  });

  server.store = store;
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

(async function main() {
  if (require.main !== module) return;

  const port = Number(process.env.PORT || "4100");
  const host = (process.env.HOST || "127.0.0.1").trim();
  const frontendPort = Number(process.env.FRONTEND_PORT || "3000");

  const server = await createServer();
  // Reap any VR jobs left in a non-terminal state by a previous crash
  // BEFORE we start accepting new traffic. In PostgreSQL cutover mode the
  // authoritative records are video_replace_jobs in PostgreSQL.
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
    server.close(async () => {
      try {
        if (typeof server.store?.close === "function") {
          await server.store.close();
        }
        await closeVideoReplaceStorage();
      } catch (err) {
        console.error("[server] shutdown persistence close failed:", err?.message || err);
      } finally {
        process.exit(0);
      }
    });
    // Hard-exit fallback in case server.close is blocked by sockets.
    setTimeout(() => process.exit(0), 5_000).unref();
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  // On Windows there's no SIGHUP / SIGBREAK default; Node delivers
  // SIGBREAK when the console receives Ctrl+Break.
  process.on("SIGBREAK", () => gracefulShutdown("SIGBREAK"));
})().catch((err) => {
  console.error("[server] startup failed:", err?.message || err);
  process.exit(1);
});

module.exports = {
  createServer
};
