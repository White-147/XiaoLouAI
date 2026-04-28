const { randomUUID } = require("node:crypto");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Request-Id, X-Upload-Filename, X-Actor-Id"
};

function corsHeaders(extra = {}) {
  return {
    ...CORS_HEADERS,
    ...extra
  };
}

function json(res, statusCode, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...corsHeaders(extraHeaders)
  });
  res.end(body);
}

function noContent(res) {
  res.writeHead(204, corsHeaders());
  res.end();
}

function sendEvent(res, eventName, data) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};

  try {
    return JSON.parse(raw);
  } catch (error) {
    error.statusCode = 400;
    error.code = "BAD_JSON";
    error.message = "request body must be valid JSON";
    throw error;
  }
}

async function readRawBody(req, maxBytes = 50 * 1024 * 1024) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxBytes) {
      const uploadError = new Error("request body is too large");
      uploadError.statusCode = 413;
      uploadError.code = "PAYLOAD_TOO_LARGE";
      throw uploadError;
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function readTextBody(req, maxBytes = 50 * 1024 * 1024) {
  const raw = await readRawBody(req, maxBytes);
  return raw.toString("utf8");
}

function parsePagination(url) {
  const page = Number(url.searchParams.get("page") || "1");
  const pageSize = Number(url.searchParams.get("pageSize") || "20");
  return {
    page: Number.isFinite(page) && page > 0 ? page : 1,
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 20
  };
}

function ok(data, meta = {}) {
  return {
    success: true,
    data,
    meta: {
      requestId: randomUUID(),
      timestamp: new Date().toISOString(),
      ...meta
    }
  };
}

function accepted(task) {
  return ok(
    {
      taskId: task.id,
      status: task.status,
      task
    },
    { accepted: true }
  );
}

function error(res, statusCode, code, message) {
  json(res, statusCode, {
    success: false,
    error: { code, message },
    meta: {
      requestId: randomUUID(),
      timestamp: new Date().toISOString()
    }
  });
}

function matchPath(pathname, pattern) {
  const pathParts = pathname.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);
  if (pathParts.length !== patternParts.length) return null;

  const params = {};
  for (let index = 0; index < patternParts.length; index += 1) {
    const currentPattern = patternParts[index];
    const currentPath = pathParts[index];
    if (currentPattern.startsWith(":")) {
      params[currentPattern.slice(1)] = decodeURIComponent(currentPath);
      continue;
    }
    if (currentPattern !== currentPath) return null;
  }

  return params;
}

module.exports = {
  accepted,
  corsHeaders,
  error,
  json,
  matchPath,
  noContent,
  ok,
  parsePagination,
  readJsonBody,
  readTextBody,
  readRawBody,
  sendEvent
};
