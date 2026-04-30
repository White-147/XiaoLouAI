const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { ensureJaazServices, resolveServiceConfig } = require("./jaaz-services");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(message);
}

function resolveJaazStaticFile(pathname) {
  const { uiDistDir } = resolveServiceConfig();
  const indexPath = path.join(uiDistDir, "index.html");
  const rawRelative = pathname.replace(/^\/jaaz\/?/, "");
  const relativePath = rawRelative ? decodeURIComponent(rawRelative) : "";
  const hasExtension = Boolean(path.extname(relativePath));
  const candidate = hasExtension
    ? path.resolve(uiDistDir, relativePath)
    : indexPath;
  const distRoot = path.resolve(uiDistDir);
  const distRootWithSep = distRoot.endsWith(path.sep) ? distRoot : `${distRoot}${path.sep}`;

  if (candidate !== distRoot && !candidate.startsWith(distRootWithSep)) {
    return { uiDistDir, filePath: null, indexPath };
  }

  if (hasExtension && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
    return { uiDistDir, filePath: candidate, indexPath };
  }

  return { uiDistDir, filePath: indexPath, indexPath };
}

function serveJaazStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "method not allowed");
    return true;
  }

  if (url.pathname === "/jaaz") {
    res.writeHead(308, { Location: "/jaaz/" });
    res.end();
    return true;
  }

  const { uiDistDir, filePath, indexPath } = resolveJaazStaticFile(url.pathname);
  if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    sendText(res, 503, `Jaaz UI dist not found. Expected ${indexPath || uiDistDir}.`);
    return true;
  }

  const extension = path.extname(filePath).toLowerCase();
  const headers = {
    "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
    "Cache-Control": "no-store",
  };
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function buildJaazApiPath(url) {
  if (url.pathname === "/jaaz-api") {
    return `/${url.search}`;
  }
  if (url.pathname.startsWith("/jaaz-api/")) {
    return `${url.pathname.replace(/^\/jaaz-api(?=\/|$)/, "") || "/"}${url.search}`;
  }
  return `${url.pathname}${url.search}`;
}

async function proxyJaazApiRequest(req, res, url) {
  try {
    await ensureJaazServices({ reason: "proxy" });
  } catch (error) {
    sendText(res, 503, error?.message || "failed to start Jaaz API");
    return true;
  }

  const { apiPort } = resolveServiceConfig();
  const targetPath = buildJaazApiPath(url);
  const headers = {
    ...req.headers,
    host: `127.0.0.1:${apiPort}`,
  };

  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port: apiPort,
      method: req.method,
      path: targetPath,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );

  proxyReq.on("error", (error) => {
    if (!res.headersSent) {
      sendText(res, 502, error?.message || "Jaaz API proxy failed");
    } else {
      res.destroy(error);
    }
  });

  req.pipe(proxyReq);
  return true;
}

function shouldHandleJaazHttp(pathname) {
  return (
    pathname === "/jaaz" ||
    pathname.startsWith("/jaaz/") ||
    pathname === "/jaaz-api" ||
    pathname.startsWith("/jaaz-api/") ||
    pathname === "/socket.io" ||
    pathname.startsWith("/socket.io/")
  );
}

async function handleJaazGatewayRequest(req, res, url) {
  if (!shouldHandleJaazHttp(url.pathname)) return false;
  if (url.pathname === "/jaaz" || url.pathname.startsWith("/jaaz/")) {
    return serveJaazStatic(req, res, url);
  }
  return proxyJaazApiRequest(req, res, url);
}

function writeUpgradeResponse(socket, proxyRes) {
  const lines = [`HTTP/1.1 ${proxyRes.statusCode} ${proxyRes.statusMessage}`];
  for (let index = 0; index < proxyRes.rawHeaders.length; index += 2) {
    lines.push(`${proxyRes.rawHeaders[index]}: ${proxyRes.rawHeaders[index + 1]}`);
  }
  socket.write(`${lines.join("\r\n")}\r\n\r\n`);
}

function proxyJaazUpgrade(req, socket, head, url) {
  ensureJaazServices({ reason: "upgrade" })
    .then(() => {
      const { apiPort } = resolveServiceConfig();
      const targetPath = buildJaazApiPath(url);
      const proxyReq = http.request({
        hostname: "127.0.0.1",
        port: apiPort,
        method: req.method,
        path: targetPath,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${apiPort}`,
        },
      });

      proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
        writeUpgradeResponse(socket, proxyRes);
        if (proxyHead?.length) socket.write(proxyHead);
        if (head?.length) proxySocket.write(head);
        proxySocket.pipe(socket).pipe(proxySocket);
      });

      proxyReq.on("error", () => {
        try {
          socket.write("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
        } catch {}
        socket.destroy();
      });

      proxyReq.end();
    })
    .catch(() => {
      try {
        socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      } catch {}
      socket.destroy();
    });
}

function handleJaazGatewayUpgrade(req, socket, head) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  const pathname = url.pathname;
  if (
    pathname !== "/socket.io" &&
    !pathname.startsWith("/socket.io/") &&
    pathname !== "/jaaz-api/socket.io" &&
    !pathname.startsWith("/jaaz-api/socket.io/")
  ) {
    return false;
  }

  proxyJaazUpgrade(req, socket, head, url);
  return true;
}

module.exports = {
  handleJaazGatewayRequest,
  handleJaazGatewayUpgrade,
};
