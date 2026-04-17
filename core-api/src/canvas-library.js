/**
 * Canvas Library – consolidated from TwitCanva into core-api.
 *
 * Provides workflows, library assets, asset history, Gemini helpers,
 * and video trimming that the canvas iframe requires.
 *
 * Data directory defaults to XIAOLOU-main/internal/twitcanva-runtime/library.
 * Override with CANVAS_LIBRARY_DIR env var if needed.
 */

require("./env").loadEnvFiles();

const { randomUUID } = require("node:crypto");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { corsHeaders } = require("./http");
const { isLocalLoopbackClientHint, SUPER_ADMIN_DEMO_ACTOR_ID } = require("./local-loopback-request");

// ---------------------------------------------------------------------------
// Data directories
// ---------------------------------------------------------------------------

const CANVAS_LIBRARY_DIR = path.resolve(
  process.env.CANVAS_LIBRARY_DIR ||
    path.resolve(__dirname, "..", "data", "canvas-library")
);
const WORKFLOWS_DIR = path.join(CANVAS_LIBRARY_DIR, "workflows");
const IMAGES_DIR = path.join(CANVAS_LIBRARY_DIR, "images");
const VIDEOS_DIR = path.join(CANVAS_LIBRARY_DIR, "videos");
const CHATS_DIR = path.join(CANVAS_LIBRARY_DIR, "chats");
const LIBRARY_ASSETS_DIR = path.join(CANVAS_LIBRARY_DIR, "assets");
const PUBLIC_WORKFLOWS_DIR = path.resolve(
  process.env.CANVAS_PUBLIC_WORKFLOWS_DIR ||
    path.resolve(__dirname, "..", "data", "canvas-public-workflows")
);

[CANVAS_LIBRARY_DIR, WORKFLOWS_DIR, IMAGES_DIR, VIDEOS_DIR, CHATS_DIR, LIBRARY_ASSETS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ---------------------------------------------------------------------------
// Identity helpers (mirrored from TwitCanva server)
// ---------------------------------------------------------------------------

function normalizeXiaolouIdentity(value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  return normalized || null;
}

function resolveOwnerActorId(req, url) {
  const raw =
    req.headers["x-xiaolou-actor-id"] ||
    url.searchParams.get("xiaolouActorId") ||
    url.searchParams.get("actorId");
  const id = normalizeXiaolouIdentity(raw);
  if (id === SUPER_ADMIN_DEMO_ACTOR_ID && !isLocalLoopbackClientHint(req)) {
    return normalizeXiaolouIdentity("guest");
  }
  return id;
}

function resolveOwnerProjectId(req, url) {
  return normalizeXiaolouIdentity(
    req.headers["x-xiaolou-project-id"] ||
    url.searchParams.get("xiaolouProjectId") ||
    url.searchParams.get("projectId")
  );
}

function canAccessWorkflow(workflow, ownerActorId) {
  if (!ownerActorId) return true;
  return normalizeXiaolouIdentity(workflow?.ownerActorId) === ownerActorId;
}

// ---------------------------------------------------------------------------
// Workflow sanitisation (base64 → file)
// ---------------------------------------------------------------------------

function saveBase64ToFile(dataUrl) {
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:")) return null;
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) return null;
  const mimeType = matches[1];
  const base64Data = matches[2];
  try {
    const buffer = Buffer.from(base64Data, "base64");
    const id = `wf_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    let filename, targetDir, urlType;
    if (mimeType.startsWith("video/")) {
      filename = `${id}.mp4`;
      targetDir = VIDEOS_DIR;
      urlType = "videos";
    } else {
      const ext = mimeType === "image/jpeg" ? "jpg" : "png";
      filename = `${id}.${ext}`;
      targetDir = IMAGES_DIR;
      urlType = "images";
    }
    fs.writeFileSync(path.join(targetDir, filename), buffer);
    return { url: `/library/${urlType}/${filename}` };
  } catch {
    return null;
  }
}

function sanitizeWorkflowNodes(nodes) {
  if (!Array.isArray(nodes)) return nodes;
  return nodes.map(node => {
    const clean = { ...node };
    for (const field of ["resultUrl", "lastFrame", "editorCanvasData", "editorBackgroundUrl"]) {
      if (clean[field] && typeof clean[field] === "string" && clean[field].startsWith("data:")) {
        const saved = saveBase64ToFile(clean[field]);
        if (saved) clean[field] = saved.url;
      }
    }
    return clean;
  });
}

// ---------------------------------------------------------------------------
// Gemini client (lazy)
// ---------------------------------------------------------------------------

let _genaiClient = null;

function getGeminiClient() {
  if (_genaiClient) return _genaiClient;
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) return null;
  const { GoogleGenAI } = require("@google/genai");
  _genaiClient = new GoogleGenAI({ apiKey });
  return _genaiClient;
}

// ---------------------------------------------------------------------------
// FFmpeg helpers
// ---------------------------------------------------------------------------

function isFFmpegAvailable() {
  return new Promise(resolve => {
    const proc = spawn("ffmpeg", ["-version"], { shell: true });
    proc.on("close", code => resolve(code === 0));
    proc.on("error", () => resolve(false));
  });
}

function trimVideoWithFFmpeg(inputPath, outputPath, startTime, endTime) {
  return new Promise((resolve, reject) => {
    const duration = endTime - startTime;
    if (duration <= 0) { reject(new Error("Invalid trim range")); return; }
    const args = ["-y", "-i", inputPath, "-ss", String(startTime), "-t", String(duration),
      "-c:v", "libx264", "-c:a", "aac", "-preset", "fast", "-crf", "23", outputPath];
    const proc = spawn("ffmpeg", args, { shell: true });
    let stderr = "";
    proc.stderr.on("data", d => { stderr += d.toString(); });
    proc.on("close", code => code === 0 ? resolve() : reject(new Error(`FFmpeg failed (${code}): ${stderr.slice(-500)}`)));
    proc.on("error", err => reject(new Error(`FFmpeg error: ${err.message}`)));
  });
}

// ---------------------------------------------------------------------------
// Static file serving for /canvas-library/
// ---------------------------------------------------------------------------

const MIME_BY_EXT = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".json": "application/json", ".mp3": "audio/mpeg", ".wav": "audio/wav",
};

function guessContentType(filePath) {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

/**
 * Middleware-style handler for /canvas-library/* requests.
 * Returns true if handled, false otherwise.
 */
function serveCanvasLibrary(req, res, pathname) {
  const prefix = "/canvas-library/";
  if (!pathname.startsWith(prefix)) return false;

  const relativePath = decodeURIComponent(pathname.slice(prefix.length));
  if (!relativePath || relativePath.includes("..")) {
    res.writeHead(400, corsHeaders());
    res.end("Bad request");
    return true;
  }

  const filePath = path.resolve(CANVAS_LIBRARY_DIR, relativePath);
  if (!filePath.startsWith(CANVAS_LIBRARY_DIR)) {
    res.writeHead(403, corsHeaders());
    res.end("Forbidden");
    return true;
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    res.writeHead(404, corsHeaders());
    res.end("Not found");
    return true;
  }

  const contentType = guessContentType(filePath);
  const stat = fs.statSync(filePath);
  const headers = {
    "Content-Type": contentType,
    "Content-Length": stat.size,
    "Cache-Control": "public, max-age=3600",
    "Cross-Origin-Resource-Policy": "cross-origin",
    ...corsHeaders(),
  };

  const rangeHeader = req.headers.range;
  if (rangeHeader && contentType.startsWith("video/")) {
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
      if (start >= stat.size || end >= stat.size || start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${stat.size}`, ...corsHeaders() });
        res.end();
        return true;
      }
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${stat.size}`,
        "Content-Length": chunkSize,
        "Accept-Ranges": "bytes",
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return true;
    }
  }

  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// ---------------------------------------------------------------------------
// Route builders (core-api style)
// ---------------------------------------------------------------------------

function route(method, routePath, handler) {
  return { method, path: routePath, handler, statusCode: 200 };
}

function routeWithStatus(method, routePath, statusCode, handler) {
  return { method, path: routePath, handler, statusCode };
}

/**
 * Return raw data for TwitCanva-compatible responses.
 * core-api dispatch serialises whatever we return as JSON.
 * TwitCanva frontend expects the raw shape (array, object), NOT wrapped.
 */
function raw(data) { return data; }

function fail(statusCode, code, message) {
  return { error: { statusCode, code, message } };
}

function buildCanvasLibraryRoutes(/* store */) {
  const { readJsonBody } = require("./http");

  return [
    // ---- Workflows ----
    routeWithStatus("POST", "/api/canvas/workflows", 200, async ({ req, url }) => {
      const workflow = await readJsonBody(req);
      const ownerActorId = resolveOwnerActorId(req, url);
      const ownerProjectId = resolveOwnerProjectId(req, url);
      if (!workflow.id) workflow.id = randomUUID();
      workflow.updatedAt = new Date().toISOString();
      if (!workflow.createdAt) workflow.createdAt = workflow.updatedAt;
      if (ownerActorId) workflow.ownerActorId = ownerActorId;
      if (ownerProjectId) workflow.ownerProjectId = ownerProjectId;

      const filePath = path.join(WORKFLOWS_DIR, `${workflow.id}.json`);
      if (fs.existsSync(filePath)) {
        try {
          const existing = JSON.parse(fs.readFileSync(filePath, "utf8"));
          if (!canAccessWorkflow(existing, ownerActorId)) return fail(403, "FORBIDDEN", "Access denied");
          if (existing.coverUrl) workflow.coverUrl = existing.coverUrl;
        } catch { /* ignore */ }
      }
      if (workflow.nodes) workflow.nodes = sanitizeWorkflowNodes(workflow.nodes);
      fs.writeFileSync(filePath, JSON.stringify(workflow, null, 2));
      return raw({ success: true, id: workflow.id });
    }),

    route("GET", "/api/canvas/workflows", ({ req, url }) => {
      const ownerActorId = resolveOwnerActorId(req, url);
      const files = fs.existsSync(WORKFLOWS_DIR) ? fs.readdirSync(WORKFLOWS_DIR).filter(f => f.endsWith(".json")) : [];
      const workflows = files.map(file => {
        try {
          const wf = JSON.parse(fs.readFileSync(path.join(WORKFLOWS_DIR, file), "utf8"));
          if (!canAccessWorkflow(wf, ownerActorId)) return null;
          return { id: wf.id, title: wf.title, createdAt: wf.createdAt, updatedAt: wf.updatedAt, nodeCount: wf.nodes?.length || 0, coverUrl: wf.coverUrl };
        } catch { return null; }
      }).filter(Boolean);
      workflows.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
      return raw(workflows);
    }),

    route("GET", "/api/canvas/workflows/:id", ({ params, req, url }) => {
      const ownerActorId = resolveOwnerActorId(req, url);
      const filePath = path.join(WORKFLOWS_DIR, `${params.id}.json`);
      if (!fs.existsSync(filePath)) return fail(404, "NOT_FOUND", "Workflow not found");
      const wf = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!canAccessWorkflow(wf, ownerActorId)) return fail(404, "NOT_FOUND", "Workflow not found");
      return raw(wf);
    }),

    routeWithStatus("DELETE", "/api/canvas/workflows/:id", 200, ({ params, req, url }) => {
      const ownerActorId = resolveOwnerActorId(req, url);
      const filePath = path.join(WORKFLOWS_DIR, `${params.id}.json`);
      if (!fs.existsSync(filePath)) return fail(404, "NOT_FOUND", "Workflow not found");
      const wf = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!canAccessWorkflow(wf, ownerActorId)) return fail(404, "NOT_FOUND", "Workflow not found");
      fs.unlinkSync(filePath);
      return raw({ success: true });
    }),

    route("PUT", "/api/canvas/workflows/:id/cover", async ({ params, req, url }) => {
      const ownerActorId = resolveOwnerActorId(req, url);
      const { coverUrl } = await readJsonBody(req);
      const filePath = path.join(WORKFLOWS_DIR, `${params.id}.json`);
      if (!fs.existsSync(filePath)) return fail(404, "NOT_FOUND", "Workflow not found");
      const wf = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!canAccessWorkflow(wf, ownerActorId)) return fail(404, "NOT_FOUND", "Workflow not found");
      wf.coverUrl = coverUrl;
      fs.writeFileSync(filePath, JSON.stringify(wf, null, 2));
      return raw({ success: true, coverUrl });
    }),

    // ---- Public Workflows ----
    route("GET", "/api/canvas/public-workflows", () => {
      if (!fs.existsSync(PUBLIC_WORKFLOWS_DIR)) return raw([]);
      const files = fs.readdirSync(PUBLIC_WORKFLOWS_DIR).filter(f => f.endsWith(".json") && f !== "index.json");
      const workflows = files.map(file => {
        try {
          const wf = JSON.parse(fs.readFileSync(path.join(PUBLIC_WORKFLOWS_DIR, file), "utf8"));
          const nodeTypes = wf.nodes?.reduce((acc, n) => { acc[n.type] = (acc[n.type] || 0) + 1; return acc; }, {}) || {};
          const typesSummary = Object.entries(nodeTypes).map(([t, c]) => `${c} ${t}${c > 1 ? "s" : ""}`).join(", ");
          return {
            id: file.replace(".json", ""),
            title: wf.title || "Untitled Workflow",
            description: wf.description || (typesSummary ? `Workflow with ${typesSummary}` : "A public workflow template"),
            nodeCount: wf.nodes?.length || 0,
            coverUrl: wf.coverUrl || null,
          };
        } catch { return null; }
      }).filter(Boolean);
      workflows.sort((a, b) => a.title.localeCompare(b.title));
      return raw(workflows);
    }),

    route("GET", "/api/canvas/public-workflows/:id", ({ params }) => {
      const filePath = path.join(PUBLIC_WORKFLOWS_DIR, `${params.id}.json`);
      if (!fs.existsSync(filePath)) return fail(404, "NOT_FOUND", "Public workflow not found");
      return raw(JSON.parse(fs.readFileSync(filePath, "utf8")));
    }),

    // ---- Library Assets (curated) ----
    routeWithStatus("POST", "/api/canvas/library", 200, async ({ req }) => {
      const { sourceUrl, name, category, meta } = await readJsonBody(req);
      if (!sourceUrl || !name || !category) return fail(400, "BAD_REQUEST", "Missing required fields");

      const destDir = path.join(LIBRARY_ASSETS_DIR, category);
      if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
      const safeName = name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
      let destFilename, destPath;

      if (sourceUrl.startsWith("data:")) {
        const matches = sourceUrl.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
        if (!matches || matches.length !== 3) return fail(400, "BAD_REQUEST", "Invalid data URL");
        const mimeType = matches[1];
        const buffer = Buffer.from(matches[2], "base64");
        let ext = ".png";
        if (mimeType === "image/jpeg") ext = ".jpg";
        else if (mimeType === "video/mp4") ext = ".mp4";
        destFilename = `${safeName}${ext}`;
        destPath = path.join(destDir, destFilename);
        fs.writeFileSync(destPath, buffer);
      } else {
        let cleanUrl = sourceUrl;
        try { if (sourceUrl.startsWith("http")) cleanUrl = new URL(sourceUrl).pathname; } catch { /* noop */ }
        cleanUrl = cleanUrl.split("?")[0];
        if (!cleanUrl.startsWith("/")) cleanUrl = "/" + cleanUrl;
        cleanUrl = decodeURIComponent(cleanUrl);

        let sourcePath = null;
        if (cleanUrl.startsWith("/library/images/")) sourcePath = path.join(IMAGES_DIR, cleanUrl.replace("/library/images/", ""));
        else if (cleanUrl.startsWith("/library/videos/")) sourcePath = path.join(VIDEOS_DIR, cleanUrl.replace("/library/videos/", ""));
        else if (cleanUrl.startsWith("/twitcanva-library/images/")) sourcePath = path.join(IMAGES_DIR, cleanUrl.replace("/twitcanva-library/images/", ""));
        else if (cleanUrl.startsWith("/twitcanva-library/videos/")) sourcePath = path.join(VIDEOS_DIR, cleanUrl.replace("/twitcanva-library/videos/", ""));
        else if (cleanUrl.startsWith("/assets/images/")) sourcePath = path.join(IMAGES_DIR, cleanUrl.replace("/assets/images/", ""));
        else if (cleanUrl.startsWith("/assets/videos/")) sourcePath = path.join(VIDEOS_DIR, cleanUrl.replace("/assets/videos/", ""));

        if (!sourcePath || !fs.existsSync(sourcePath)) return fail(404, "NOT_FOUND", "Source file not found");
        const ext = path.extname(sourcePath);
        destFilename = `${safeName}${ext}`;
        destPath = path.join(destDir, destFilename);
        fs.copyFileSync(sourcePath, destPath);
      }

      const libraryJsonPath = path.join(LIBRARY_ASSETS_DIR, "assets.json");
      let libraryData = [];
      if (fs.existsSync(libraryJsonPath)) {
        try { libraryData = JSON.parse(fs.readFileSync(libraryJsonPath, "utf8")); } catch { /* noop */ }
      }
      const newEntry = {
        id: crypto.randomUUID(),
        name, category,
        url: `/library/assets/${category}/${destFilename}`,
        type: sourceUrl.includes("video") || sourceUrl.startsWith("data:video") ? "video" : "image",
        createdAt: new Date().toISOString(),
        ...meta,
      };
      libraryData.push(newEntry);
      fs.writeFileSync(libraryJsonPath, JSON.stringify(libraryData, null, 2));
      return raw({ success: true, asset: newEntry });
    }),

    route("GET", "/api/canvas/library", () => {
      const libraryJsonPath = path.join(LIBRARY_ASSETS_DIR, "assets.json");
      if (!fs.existsSync(libraryJsonPath)) return raw([]);
      let data = [];
      try { data = JSON.parse(fs.readFileSync(libraryJsonPath, "utf8")); } catch { /* noop */ }
      data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return raw(data);
    }),

    routeWithStatus("DELETE", "/api/canvas/library/:id", 200, ({ params }) => {
      const libraryJsonPath = path.join(LIBRARY_ASSETS_DIR, "assets.json");
      if (!fs.existsSync(libraryJsonPath)) return fail(404, "NOT_FOUND", "Library not found");
      let data = JSON.parse(fs.readFileSync(libraryJsonPath, "utf8"));
      const idx = data.findIndex(a => a.id === params.id);
      if (idx === -1) return fail(404, "NOT_FOUND", "Asset not found");
      const asset = data[idx];
      if (asset.url && asset.url.startsWith("/library/assets/")) {
        const rel = asset.url.replace("/library/assets/", "");
        const filePath = path.join(LIBRARY_ASSETS_DIR, rel);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
      data.splice(idx, 1);
      fs.writeFileSync(libraryJsonPath, JSON.stringify(data, null, 2));
      return raw({ success: true });
    }),

    // ---- Asset History (images/videos) ----
    routeWithStatus("POST", "/api/canvas/assets/:type", 200, async ({ params, req }) => {
      const { type } = params;
      if (!["images", "videos"].includes(type)) return fail(400, "BAD_REQUEST", "Invalid asset type");
      const { data, prompt } = await readJsonBody(req);
      const targetDir = type === "images" ? IMAGES_DIR : VIDEOS_DIR;
      const id = Date.now().toString();
      const ext = type === "images" ? "png" : "mp4";
      const filename = `${id}.${ext}`;
      const base64Data = data.replace(/^data:[^;]+;base64,/, "");
      fs.writeFileSync(path.join(targetDir, filename), base64Data, "base64");
      const metadata = { id, filename, prompt: prompt || "", createdAt: new Date().toISOString(), type };
      fs.writeFileSync(path.join(targetDir, `${id}.json`), JSON.stringify(metadata, null, 2));
      return raw({ success: true, id, filename, url: `/library/${type}/${filename}` });
    }),

    route("GET", "/api/canvas/assets/:type", ({ params, url }) => {
      const { type } = params;
      if (!["images", "videos"].includes(type)) return fail(400, "BAD_REQUEST", "Invalid asset type");
      const limit = parseInt(url.searchParams.get("limit") || "0");
      const offset = parseInt(url.searchParams.get("offset") || "0");
      const targetDir = type === "images" ? IMAGES_DIR : VIDEOS_DIR;
      if (!fs.existsSync(targetDir)) {
        return raw(limit > 0 ? { assets: [], total: 0, hasMore: false } : []);
      }
      const files = fs.readdirSync(targetDir);
      const assets = [];
      for (const file of files) {
        if (file.endsWith(".json")) {
          try {
            const meta = JSON.parse(fs.readFileSync(path.join(targetDir, file), "utf8"));
            meta.url = `/library/${type}/${meta.filename}`;
            assets.push(meta);
          } catch { /* skip */ }
        }
      }
      assets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      if (limit > 0) {
        const page = assets.slice(offset, offset + limit);
        return raw({ assets: page, total: assets.length, hasMore: offset + limit < assets.length });
      }
      return raw(assets);
    }),

    routeWithStatus("DELETE", "/api/canvas/assets/:type/:id", 200, ({ params }) => {
      const { type, id } = params;
      if (!["images", "videos"].includes(type)) return fail(400, "BAD_REQUEST", "Invalid asset type");
      const targetDir = type === "images" ? IMAGES_DIR : VIDEOS_DIR;
      const metaPath = path.join(targetDir, `${id}.json`);
      let assetFilename = null;
      if (fs.existsSync(metaPath)) {
        try { assetFilename = JSON.parse(fs.readFileSync(metaPath, "utf8")).filename; } catch { /* noop */ }
      }
      if (assetFilename) {
        const assetPath = path.join(targetDir, assetFilename);
        if (fs.existsSync(assetPath)) fs.unlinkSync(assetPath);
      }
      if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
      return raw({ success: true });
    }),

    // ---- Gemini Helpers ----
    routeWithStatus("POST", "/api/canvas/gemini/describe-image", 200, async ({ req }) => {
      const { imageUrl, prompt } = await readJsonBody(req);
      if (!imageUrl) return fail(400, "BAD_REQUEST", "Image URL is required");
      const client = getGeminiClient();
      if (!client) return fail(500, "CONFIG_ERROR", "GEMINI_API_KEY not configured");

      let imagePart;
      if (imageUrl.startsWith("data:")) {
        const matches = imageUrl.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          imagePart = { inlineData: { data: matches[2], mimeType: matches[1] } };
        }
      } else {
        let cleanUrl = imageUrl;
        try { if (imageUrl.startsWith("http")) cleanUrl = new URL(imageUrl).pathname; } catch { /* noop */ }
        if (cleanUrl.includes("?")) cleanUrl = cleanUrl.split("?")[0];
        if (cleanUrl.startsWith("/library/images/")) {
          const fullPath = path.join(IMAGES_DIR, cleanUrl.replace("/library/images/", ""));
          if (fs.existsSync(fullPath)) {
            const imageData = fs.readFileSync(fullPath);
            const mimeType = fullPath.endsWith(".png") ? "image/png" :
              (fullPath.endsWith(".jpg") || fullPath.endsWith(".jpeg")) ? "image/jpeg" : "image/webp";
            imagePart = { inlineData: { data: imageData.toString("base64"), mimeType } };
          }
        }
      }
      if (!imagePart) return fail(400, "BAD_REQUEST", "Could not process image");

      const result = await client.models.generateContent({
        model: "gemini-2.0-flash",
        contents: { parts: [{ text: prompt || "Describe this image in detail for video generation." }, imagePart] },
      });
      let text = "";
      if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
        text = result.candidates[0].content.parts[0].text;
      } else if (result.response && typeof result.response.text === "function") {
        text = result.response.text();
      }
      return raw({ description: text });
    }),

    routeWithStatus("POST", "/api/canvas/gemini/optimize-prompt", 200, async ({ req }) => {
      const { prompt } = await readJsonBody(req);
      if (!prompt) return fail(400, "BAD_REQUEST", "Prompt is required");
      const client = getGeminiClient();
      if (!client) return fail(500, "CONFIG_ERROR", "GEMINI_API_KEY not configured");

      const systemInstruction = "You are an expert video prompt engineer. Your goal is to rewrite the user's prompt to be descriptive, visual, and optimized for AI video generation models like Veo, Kling, and Hailuo. detailed, cinematic, and focused on motion and atmosphere. Keep it under 60 words. Output ONLY the rewritten prompt.";
      const result = await client.models.generateContent({
        model: "gemini-2.0-flash",
        contents: { parts: [{ text: `${systemInstruction}\n\nUser Prompt: ${prompt}` }] },
      });
      let text = "";
      if (result.candidates?.[0]?.content?.parts?.[0]?.text) {
        text = result.candidates[0].content.parts[0].text;
      } else if (result.response && typeof result.response.text === "function") {
        text = result.response.text();
      }
      if (!text) return fail(500, "GENERATION_ERROR", "Failed to optimize prompt");
      text = text.trim().replace(/^["']|["']$/g, "");
      return raw({ optimizedPrompt: text });
    }),

    // ---- Video Trim ----
    routeWithStatus("POST", "/api/canvas/trim-video", 200, async ({ req }) => {
      const { videoUrl, startTime, endTime } = await readJsonBody(req);
      if (!videoUrl || startTime === undefined || endTime === undefined)
        return fail(400, "BAD_REQUEST", "videoUrl, startTime, and endTime are required");

      const ffmpegOk = await isFFmpegAvailable();
      if (!ffmpegOk) return fail(500, "CONFIG_ERROR", "FFmpeg is not installed");

      const cleanUrl = videoUrl.split("?")[0];
      let inputPath;
      if (cleanUrl.startsWith("/library/videos/")) inputPath = path.join(VIDEOS_DIR, cleanUrl.replace("/library/videos/", ""));
      else if (cleanUrl.startsWith("/twitcanva-library/videos/")) inputPath = path.join(VIDEOS_DIR, cleanUrl.replace("/twitcanva-library/videos/", ""));
      else return fail(400, "BAD_REQUEST", "Only local library videos can be trimmed");
      if (!fs.existsSync(inputPath)) return fail(404, "NOT_FOUND", "Source video not found");

      const timestamp = Date.now();
      const hash = crypto.randomBytes(4).toString("hex");
      const outputFilename = `trimmed_${timestamp}_${hash}.mp4`;
      const outputPath = path.join(VIDEOS_DIR, outputFilename);
      await trimVideoWithFFmpeg(inputPath, outputPath, startTime, endTime);

      const id = `${timestamp}_${hash}`;
      const metadata = {
        id, filename: outputFilename,
        prompt: `Trimmed video (${startTime.toFixed(1)}s - ${endTime.toFixed(1)}s)`,
        model: "video-editor", sourceUrl: videoUrl, trimStart: startTime, trimEnd: endTime,
        createdAt: new Date().toISOString(), type: "videos",
      };
      fs.writeFileSync(path.join(VIDEOS_DIR, `${id}.json`), JSON.stringify(metadata, null, 2));
      const resultUrl = `/library/videos/${outputFilename}`;
      return raw({ success: true, url: resultUrl, filename: outputFilename, duration: endTime - startTime });
    }),
  ];
}

module.exports = {
  buildCanvasLibraryRoutes,
  serveCanvasLibrary,
  CANVAS_LIBRARY_DIR,
};
