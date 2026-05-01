/**
 * video-replace-native.js
 *
 * Native Node.js implementation of all video-replace HTTP routes and static
 * file serving.  Replaces the old 4200 HTTP sidecar: there is NO port 4200.
 *
 * Architecture:
 *   browser → 3000 (Vite) → 4100 (core-api, this file) → Python subprocesses
 *
 * Python is invoked as on-demand CLI subprocesses (no HTTP listener):
 *   vr_probe_cli.py    — video metadata + thumbnail (sync, fast)
 *   vr_detect_cli.py   — YOLO detection (sync, ~5–15 s)
 *   vr_pipeline_cli.py — SAM2+VACE pipeline (async, 30–90 min)
 *
 * All VR files live under VR_SERVICE_DIR/data/. Job metadata is stored in
 * PostgreSQL only; legacy tasks.sqlite files are migration inputs/backup.
 */

"use strict";

const { randomUUID } = require("node:crypto");
const {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  statSync,
  readdirSync,
} = require("node:fs");
const http = require("node:http");
const { platform, tmpdir } = require("node:os");
const { basename, extname, join, resolve } = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const { corsHeaders } = require("./http");
const { killProcessTree, isProcessAlive } = require("./process-tree");
const { decodeAuthToken } = require("./store");

// ---------------------------------------------------------------------------
// Configuration (env-overridable)
// ---------------------------------------------------------------------------

function resolveDefaultVrServiceDir() {
  const embeddedDir = resolve(__dirname, "..", "video-replace-service");
  const legacyDir = resolve(__dirname, "..", "..", "video-replace-service");

  if (existsSync(join(embeddedDir, "vr_probe_cli.py"))) {
    return embeddedDir;
  }

  return legacyDir;
}

const VR_SERVICE_DIR = resolve(process.env.VR_SERVICE_DIR || resolveDefaultVrServiceDir());
const VR_DATA_DIR = resolve(
  process.env.VR_DATA_ROOT || join(VR_SERVICE_DIR, "data")
);
const DEFAULT_DATABASE_URL = "postgres://root:root@127.0.0.1:5432/xiaolou";

// Venv Python — used for all subprocess spawns.
const VENV_PYTHON =
  process.env.VR_VENV_PYTHON ||
  (platform() === "win32"
    ? join(VR_SERVICE_DIR, ".venv", "Scripts", "python.exe")
    : join(VR_SERVICE_DIR, ".venv", "bin", "python"));

const MAX_UPLOAD_MB = Number(process.env.VR_MAX_UPLOAD_MB || "200");
const MAX_VIDEO_SECONDS = Number(process.env.VR_MAX_VIDEO_SECONDS || "15");

// Hard wall-clock that the outer vr_pipeline_cli.py subprocess is allowed
// to run before we tear its whole tree down from the Node side. 0 disables
// (not recommended — the whole point is to prevent orphan GPU processes).
const PIPELINE_TIMEOUT_MS = Number(process.env.VR_PIPELINE_TIMEOUT_MS || "10800000"); // 3h

// ---------------------------------------------------------------------------
// Hardware-safety clamp — keeps the 4070-12GB class cards from OOM-deathing.
//
// VACE-1.3B peaks at ~11GB VRAM at 832×480 + 30 steps. On a 12GB card that
// spills into shared memory (CPU↔GPU swap) which hangs the process for
// tens of minutes and ultimately trips the idle watchdog. We clamp the
// dangerous combinations back down to values the card can actually finish.
//
// Set VR_ENFORCE_12GB_SAFE=0 to opt out on higher-end hardware.
// ---------------------------------------------------------------------------
const ENFORCE_12GB_SAFE =
  (process.env.VR_ENFORCE_12GB_SAFE ?? "1") !== "0";

// Wan2.1 vace-1.3B only supports these two sizes. 624*352 / 352*624 are NOT
// valid Wan2.1 resolutions and cause generate.py to exit with returncode=2.
// RTX 4070 12GB + --offload_model True + --t5_cpu can handle both of these.
const SAFE_SAMPLE_SIZES = new Set(["832*480", "480*832"]);
const MAX_SAFE_SAMPLE_STEPS = 30;
const DEFAULT_SAFE_SAMPLE_STEPS = 12;
const SAFE_INFERENCE_FPS = new Set([15, 30, 60]);
const DEFAULT_INFERENCE_FPS = 15;
const MAX_SAFE_FRAME_NUM = 21;
const LONG_VIDEO_SECONDS = 8;
const LONG_VIDEO_SAFE_FRAME_NUM = 21;
const PORTRAIT_SAFE_FRAME_NUM = 21;
const DEFAULT_SAFE_SAM2_SIZE = "tiny";

function snapWanFrameNum(value) {
  const n = Math.max(5, Math.floor(Number(value) || 0));
  return n - ((n - 1) % 4);
}

/**
 * Clamp user-submitted advanced knobs for 12GB-class hardware.
 * Returns { advanced, notes } — notes is an array of human-readable changes
 * (empty if nothing was clamped).
 */
function clampAdvancedForHardware(advanced, mediaMeta = {}) {
  const notes = [];
  const out = { ...advanced };

  if (!ENFORCE_12GB_SAFE) return { advanced: out, notes };

  // 1. sample_size — reject unsupported values, fall back to 832*480
  const requestedSize = String(out.sample_size || "");
  if (requestedSize && !SAFE_SAMPLE_SIZES.has(requestedSize)) {
    const fallback = "832*480";
    notes.push(
      `分辨率 ${requestedSize} 不被 Wan2.1 vace-1.3B 支持（仅允许 832*480 / 480*832），已回退为 ${fallback}。`
    );
    out.sample_size = fallback;
  }

  // 2. sample_steps
  const requestedSteps = Number(out.sample_steps);
  if (Number.isFinite(requestedSteps) && requestedSteps > MAX_SAFE_SAMPLE_STEPS) {
    notes.push(
      `采样步数 ${requestedSteps} 在 12GB 硬件上单次耗时过长，已夹到 ${MAX_SAFE_SAMPLE_STEPS}；` +
      `如需放开请设置 VR_ENFORCE_12GB_SAFE=0。`
    );
    out.sample_steps = MAX_SAFE_SAMPLE_STEPS;
  }

  // 3. inference_fps
  const requestedFps = Number(out.inference_fps);
  if (!SAFE_INFERENCE_FPS.has(requestedFps)) {
    notes.push(`推理帧率仅支持 15 / 30 / 60 FPS，已回退为 ${DEFAULT_INFERENCE_FPS} FPS。`);
    out.inference_fps = DEFAULT_INFERENCE_FPS;
  } else {
    out.inference_fps = requestedFps;
  }

  const durationSeconds = Number(mediaMeta.duration_seconds || 0);
  const videoWidth = Number(mediaMeta.width || 0);
  const videoHeight = Number(mediaMeta.height || 0);
  const isPortrait = videoWidth > 0 && videoHeight > videoWidth;
  const isLongVideo = durationSeconds > LONG_VIDEO_SECONDS;
  const frameLimit = isPortrait
    ? PORTRAIT_SAFE_FRAME_NUM
    : (isLongVideo ? LONG_VIDEO_SAFE_FRAME_NUM : MAX_SAFE_FRAME_NUM);

  if ((isPortrait || isLongVideo) && out.sam2_size !== DEFAULT_SAFE_SAM2_SIZE) {
    const reason = isPortrait ? "竖屏视频" : `超过 ${LONG_VIDEO_SECONDS}s 的视频`;
    notes.push(`${reason} 在 12GB 显卡上更容易触发 VACE 首步卡死，分割模型已自动改为 ${DEFAULT_SAFE_SAM2_SIZE}。`);
    out.sam2_size = DEFAULT_SAFE_SAM2_SIZE;
  }

  if (Number(out.max_frame_num) > frameLimit) {
    const reason = isPortrait
      ? "竖屏视频"
      : `超过 ${LONG_VIDEO_SECONDS}s 的视频`;
    notes.push(`${reason} 在 12GB 显卡上已将最大推理帧数限制为 ${frameLimit}。`);
  }

  // 4. max_frame_num. Wan temporal lengths should be 4n+1.
  const requestedFrameNum = Number(out.max_frame_num);
  if (!Number.isFinite(requestedFrameNum) || requestedFrameNum < 5) {
    notes.push(`最大推理帧数无效，已回退为 ${MAX_SAFE_FRAME_NUM} 帧。`);
    out.max_frame_num = frameLimit;
  } else {
    const capped = Math.min(requestedFrameNum, frameLimit);
    const snapped = snapWanFrameNum(capped);
    if (snapped !== requestedFrameNum) {
      notes.push(`最大推理帧数 ${requestedFrameNum} 已调整为 Wan 可用的 ${snapped} 帧。`);
    }
    out.max_frame_num = snapped;
  }

  return { advanced: out, notes };
}

// Stages that represent "work in progress". A non-terminal job lingering
// in one of these after a server restart is a zombie from a previous run.
const IN_FLIGHT_STAGES = new Set([
  "queued", "tracking", "mask_ready", "replacing", "detecting",
]);

// ---------------------------------------------------------------------------
// Static directory mapping  /vr-<type>/<name> → VR_DATA_DIR/<type>/<name>
// ---------------------------------------------------------------------------

const VR_STATIC_MAP = {
  "/vr-uploads": join(VR_DATA_DIR, "uploads"),
  "/vr-thumbnails": join(VR_DATA_DIR, "thumbnails"),
  "/vr-candidates": join(VR_DATA_DIR, "candidates"),
  "/vr-keyframes": join(VR_DATA_DIR, "keyframes"),
  "/vr-references": join(VR_DATA_DIR, "references"),
  "/vr-masks": join(VR_DATA_DIR, "masks"),
  "/vr-results": join(VR_DATA_DIR, "results"),
  "/vr-finals": join(VR_DATA_DIR, "finals"),
};

const VR_PATH_PREFIXES = ["/api/video-replace", ...Object.keys(VR_STATIC_MAP)];

const VIDEO_EXTS = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp"]);
const TERMINAL_STAGES = new Set(["succeeded", "failed", "cancelled"]);
let projectAssetStore = null;

// Tracks in-flight pipeline subprocesses.
//   jobId → { child, pipelinePid, startedAt, timeoutTimer }
// This is a soft cache over the authoritative record in PostgreSQL. If the
// Node process crashes, the next boot rehydrates from video_replace_jobs.
const _runningPipelines = new Map();
const _queuedPipelineJobs = [];
const _queuedPipelineSet = new Set();

function _pipelineQueueAhead(jobId) {
  const idx = _queuedPipelineJobs.indexOf(jobId);
  if (idx < 0) return null;
  return idx + (_runningPipelines.size > 0 ? 1 : 0);
}

function _pipelineQueueMessage(jobId) {
  const ahead = _pipelineQueueAhead(jobId);
  if (ahead === null) return null;
  if (ahead <= 0) return "GPU 队列已轮到当前任务，正在启动人物替换...";
  return `GPU 正在处理其他人物替换任务，前方排队 ${ahead} 位`;
}

function _refreshPipelineQueueMessages() {
  for (const queuedJobId of _queuedPipelineJobs) {
    const job = dbGet(queuedJobId);
    if (!job || TERMINAL_STAGES.has(job.stage)) continue;
    const message = _pipelineQueueMessage(queuedJobId);
    if (message) dbUpdate(queuedJobId, { message });
  }
}

// ---------------------------------------------------------------------------
// PostgreSQL VR job database
// ---------------------------------------------------------------------------

let _pgPool = null;
let _pgListenClient = null;
let _pgJobs = new Map();
let _pgWriteQueue = Promise.resolve();
let _pgWriteError = null;
let _storageInitialized = false;
let _pgClosePromise = null;

function parseJobData(value) {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value || "{}");
    } catch {
      return {};
    }
  }
  if (typeof value === "object") {
    return structuredClone(value);
  }
  return {};
}

function normalizeJobRow(row) {
  if (!row) return null;
  return {
    ...row,
    progress: Number(row.progress) || 0,
    data: parseJobData(row.data),
  };
}

function cloneJob(row) {
  if (!row) return null;
  return {
    ...row,
    data: structuredClone(row.data || {}),
  };
}

function vrDatabaseUrl() {
  return process.env.VR_DATABASE_URL || process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
}

function pythonSubprocessEnv() {
  const databaseUrl = vrDatabaseUrl();
  return {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL || databaseUrl,
    VR_DATABASE_URL: databaseUrl,
    PYTHONUNBUFFERED: "1",
    PYTHONIOENCODING: "utf-8",
  };
}

async function loadPgJob(jobId) {
  if (!_pgPool || !jobId) return null;
  const result = await _pgPool.query(
    `SELECT job_id, stage, progress, message, error, data, created_at, updated_at
     FROM video_replace_jobs
     WHERE job_id = $1`,
    [jobId],
  );
  const row = normalizeJobRow(result.rows[0]);
  if (row) {
    _pgJobs.set(row.job_id, row);
  } else {
    _pgJobs.delete(jobId);
  }
  return row;
}

async function initializeVideoReplaceStorage() {
  if (_storageInitialized) return;

  const { Pool } = require("pg");
  const { ensurePostgresSchema } = require("./postgres-schema");
  _pgPool = new Pool({
    connectionString: vrDatabaseUrl(),
    max: Number(process.env.PGPOOL_MAX || 10),
  });

  const client = await _pgPool.connect();
  try {
    await ensurePostgresSchema(client);
    const result = await client.query(
      `SELECT job_id, stage, progress, message, error, data, created_at, updated_at
       FROM video_replace_jobs
       ORDER BY updated_at DESC`,
    );
    _pgJobs = new Map(result.rows.map((row) => {
      const normalized = normalizeJobRow(row);
      return [normalized.job_id, normalized];
    }));

    _pgListenClient = await _pgPool.connect();
    _pgListenClient.on("notification", (message) => {
      const jobId = String(message.payload || "").trim();
      if (!jobId) return;
      loadPgJob(jobId).catch((error) => {
        console.error("[vr-native] postgres job refresh failed:", error?.message || error);
      });
    });
    _pgListenClient.on("error", (error) => {
      console.error("[vr-native] postgres LISTEN client error:", error?.message || error);
    });
    await _pgListenClient.query("LISTEN video_replace_job_changed");
    _storageInitialized = true;
  } finally {
    client.release();
  }
}

function assertStorageReady() {
  if (_storageInitialized) return;
  throw new Error("video-replace PostgreSQL storage is not initialized");
}

function queuePgJobWrite(job) {
  if (!_pgPool) return;
  const snapshot = cloneJob(job);
  _pgWriteQueue = _pgWriteQueue
    .then(async () => {
      await _pgPool.query(
        `INSERT INTO video_replace_jobs
           (job_id, stage, progress, message, error, data, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
         ON CONFLICT (job_id) DO UPDATE SET
           stage = excluded.stage,
           progress = excluded.progress,
           message = excluded.message,
           error = excluded.error,
           data = excluded.data,
           updated_at = excluded.updated_at`,
        [
          snapshot.job_id,
          snapshot.stage,
          Number(snapshot.progress) || 0,
          snapshot.message || null,
          snapshot.error || null,
          JSON.stringify(snapshot.data || {}),
          snapshot.created_at,
          snapshot.updated_at,
        ],
      );
      await _pgPool.query("SELECT pg_notify('video_replace_job_changed', $1)", [snapshot.job_id]);
    })
    .then(() => {
      _pgWriteError = null;
    })
    .catch((error) => {
      _pgWriteError = error;
      console.error("[vr-native] postgres job write failed:", error?.message || error);
    });
}

async function flushVideoReplaceStorage() {
  await _pgWriteQueue;
  if (_pgWriteError) throw _pgWriteError;
}

async function closeVideoReplaceStorage() {
  if (_pgClosePromise) return _pgClosePromise;
  _pgClosePromise = (async () => {
    await flushVideoReplaceStorage();
    if (_pgListenClient) {
      try { await _pgListenClient.query("UNLISTEN *"); } catch { /* ignore */ }
      _pgListenClient.release();
      _pgListenClient = null;
    }
    if (_pgPool) {
      await _pgPool.end();
      _pgPool = null;
    }
    _storageInitialized = false;
  })().finally(() => {
    _pgClosePromise = null;
  });
  return _pgClosePromise;
}

function dbCreate(jobId, data, stage = "uploaded") {
  const now = new Date().toISOString();
  assertStorageReady();
  const row = {
    job_id: jobId,
    stage,
    progress: 0,
    message: null,
    error: null,
    data: structuredClone(data || {}),
    created_at: now,
    updated_at: now,
  };
  _pgJobs.set(jobId, row);
  queuePgJobWrite(row);
}

function dbGet(jobId) {
  assertStorageReady();
  return cloneJob(_pgJobs.get(jobId) || null);
}

function dbUpdate(jobId, { stage, progress, message, error: errMsg, dataPatch } = {}) {
  const job = dbGet(jobId);
  if (!job) return false;
  const newData = dataPatch ? { ...job.data, ...dataPatch } : job.data;
  const now = new Date().toISOString();

  const nextJob = {
    ...job,
    stage: stage || job.stage,
    progress: progress ?? job.progress,
    message: message || job.message,
    error: errMsg || job.error,
    data: newData,
    updated_at: now,
  };
  _pgJobs.set(jobId, nextJob);
  queuePgJobWrite(nextJob);
  return true;
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

function newStoredName(ext) {
  return `${randomUUID().replace(/-/g, "")}${ext.startsWith(".") ? ext : `.${ext}`}`;
}

function vrUrl(prefix, name) {
  return `${prefix}/${name}`;
}

// ---------------------------------------------------------------------------
// Multipart parser (single-file, field name = "file")
// ---------------------------------------------------------------------------

function parseMultipart(body, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^\s;]+))/i.exec(contentType);
  if (!boundaryMatch) return null;
  const boundary = boundaryMatch[1] || boundaryMatch[2];

  const parts = [];
  const delimBuf = Buffer.from(`\r\n--${boundary}`);
  // Prepend \r\n so the first boundary matches the same pattern
  const data = Buffer.concat([Buffer.from("\r\n"), body]);

  let pos = 0;
  while (pos < data.length) {
    const delimPos = data.indexOf(delimBuf, pos);
    if (delimPos === -1) break;

    const afterDelim = delimPos + delimBuf.length;
    // "--" means final terminator
    if (data[afterDelim] === 45 && data[afterDelim + 1] === 45) break;
    // Skip \r\n after boundary line
    const headerStart = afterDelim + 2;

    const headerSep = Buffer.from("\r\n\r\n");
    const headerEnd = data.indexOf(headerSep, headerStart);
    if (headerEnd === -1) break;

    const headers = data.slice(headerStart, headerEnd).toString("latin1");
    const bodyStart = headerEnd + 4;

    // Find next boundary to determine body end
    const nextDelim = data.indexOf(delimBuf, bodyStart);
    const bodyEnd = nextDelim === -1 ? data.length : nextDelim;

    const nameMatch = /name="([^"]+)"/i.exec(headers);
    const filenameMatch = /filename\*?=(?:UTF-8'')?(?:"([^"]+)"|([^\s;]+))/i.exec(headers);
    const ctMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headers);

    if (nameMatch) {
      let filename = filenameMatch ? (filenameMatch[1] || filenameMatch[2]) : undefined;
      if (filename) {
        try { filename = decodeURIComponent(filename); } catch { /* keep raw */ }
      }
      parts.push({
        name: nameMatch[1],
        filename,
        contentType: ctMatch?.[1]?.trim(),
        data: data.slice(bodyStart, bodyEnd),
      });
    }

    pos = afterDelim;
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Static file serving (Range-aware, for video playback)
// ---------------------------------------------------------------------------

const MIME_MAP = {
  ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".gif": "image/gif",
};

function serveVrStatic(req, res, pathname) {
  // Find which prefix matches
  let dirBase = null;
  let relName = null;
  for (const [prefix, dir] of Object.entries(VR_STATIC_MAP)) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      relName = pathname.slice(prefix.length + 1); // strip leading /
      dirBase = dir;
      break;
    }
  }
  if (!dirBase || !relName) return false;

  // Security: basename only (no path traversal)
  const safeName = basename(relName);
  if (!safeName || safeName !== relName.split("/").pop()) return false;

  // For masks subdirectory (job-id sub-folders), allow one level deep
  // e.g. /vr-masks/vr_abc123/frame_000001.png
  let absPath;
  if (relName.includes("/")) {
    const parts = relName.split("/");
    if (parts.length !== 2) return false;
    const subDir = basename(parts[0]);
    const fileName = basename(parts[1]);
    absPath = join(dirBase, subDir, fileName);
  } else {
    absPath = join(dirBase, safeName);
  }

  if (!absPath.startsWith(dirBase)) return false; // path traversal guard
  if (!existsSync(absPath)) {
    res.writeHead(404, corsHeaders({ "Content-Type": "text/plain" }));
    res.end("Not Found");
    return true;
  }

  const stat = statSync(absPath);
  if (stat.isDirectory()) return false;

  const ext = extname(absPath).toLowerCase();
  const contentType = MIME_MAP[ext] || "application/octet-stream";
  const size = stat.size;

  const rangeHeader = req.headers["range"];
  if (rangeHeader) {
    const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader);
    if (match) {
      const start = parseInt(match[1], 10);
      const end = match[2] ? parseInt(match[2], 10) : size - 1;
      if (start >= size || end >= size || start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${size}`, ...corsHeaders() });
        res.end();
        return true;
      }
      res.writeHead(206, {
        "Content-Type": contentType,
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
        ...corsHeaders(),
      });
      createReadStream(absPath, { start, end }).pipe(res);
      return true;
    }
  }

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": size,
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=3600",
    ...corsHeaders(),
  });
  createReadStream(absPath).pipe(res);
  return true;
}

// ---------------------------------------------------------------------------
// JSON response helpers (match Python FastAPI envelope)
// ---------------------------------------------------------------------------

function vrOk(res, data, statusCode = 200) {
  const body = JSON.stringify({ success: true, data });
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...corsHeaders(),
  });
  res.end(body);
}

function vrFail(res, code, message, statusCode = 400) {
  const body = JSON.stringify({
    success: false,
    data: null,
    error: { code, message, status: statusCode },
  });
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    ...corsHeaders(),
  });
  res.end(body);
}

// ---------------------------------------------------------------------------
// Python subprocess helpers
// ---------------------------------------------------------------------------

/**
 * Run a Python CLI script *without* blocking the Node event loop.
 *
 * Previously this used ``spawnSync`` — which on every detect call would
 * freeze all 4100 traffic for up to 120 s because the JS thread cannot
 * even accept a new HTTP request while spawnSync is blocked. This async
 * variant streams stdout/stderr and returns a promise, leaving the event
 * loop free to serve other requests (SSE polling, status GETs, etc.).
 */
function runPythonAsync(scriptPath, args, timeoutMs = 30_000) {
  return new Promise((resolvePromise) => {
    if (!existsSync(VENV_PYTHON)) {
      return resolvePromise({ ok: false, error: `venv Python not found: ${VENV_PYTHON}` });
    }
    const child = spawn(VENV_PYTHON, [scriptPath, ...args], {
      cwd: VR_SERVICE_DIR,
      env: pythonSubprocessEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(payload);
    };

    const timer = setTimeout(() => {
      console.error(
        `[vr-native] python CLI timeout after ${timeoutMs}ms — killing tree pid=${child.pid}`
      );
      try { killProcessTree(child.pid, { reason: `python CLI timeout ${scriptPath}` }); }
      catch { /* ignore */ }
      finish({ ok: false, error: `python CLI timeout after ${timeoutMs}ms` });
    }, timeoutMs);

    child.stdout.on("data", (d) => { stdout += d.toString("utf8"); });
    child.stderr.on("data", (d) => { stderr += d.toString("utf8"); });
    child.on("error", (err) => finish({ ok: false, error: err.message, stderr }));
    child.on("close", (status) => {
      const trimmedOut = stdout.trim();
      const trimmedErr = stderr.trim();
      if (status !== 0) {
        const lastLine = trimmedOut.split("\n").pop() || trimmedErr.split("\n").pop() || "";
        let parsed = null;
        try { parsed = JSON.parse(lastLine); } catch { /* ignore */ }
        return finish({
          ok: false,
          error: parsed?.error || lastLine || `exit ${status}`,
          stderr: trimmedErr,
        });
      }
      const lastLine = trimmedOut.split("\n").filter(Boolean).pop() || "{}";
      try { finish({ ok: true, ...JSON.parse(lastLine) }); }
      catch { finish({ ok: true }); }
    });
  });
}

// Backwards-compat sync shim — kept only for any startup-time utilities
// that legitimately want to block. Hot paths must use runPythonAsync.
function runPythonSync(scriptPath, args, timeoutMs = 30_000) {
  if (!existsSync(VENV_PYTHON)) {
    return { ok: false, error: `venv Python not found: ${VENV_PYTHON}` };
  }
  const result = spawnSync(VENV_PYTHON, [scriptPath, ...args], {
    cwd: VR_SERVICE_DIR,
    encoding: "utf8",
    timeout: timeoutMs,
    env: pythonSubprocessEnv(),
    windowsHide: true,
  });
  if (result.error) return { ok: false, error: result.error.message };

  const stdout = (result.stdout || "").trim();
  const stderr = (result.stderr || "").trim();
  if (result.status !== 0) {
    const lastLine = stdout.split("\n").pop() || stderr.split("\n").pop() || "";
    let parsed = null;
    try { parsed = JSON.parse(lastLine); } catch { /* ignore */ }
    return { ok: false, error: parsed?.error || lastLine || `exit ${result.status}`, stderr };
  }
  const lastLine = stdout.split("\n").filter(Boolean).pop() || "{}";
  try { return { ok: true, ...JSON.parse(lastLine) }; }
  catch { return { ok: true }; }
}

function _tryKillPipeline(jobId, reason) {
  if (_queuedPipelineSet.has(jobId)) {
    _queuedPipelineSet.delete(jobId);
    const idx = _queuedPipelineJobs.indexOf(jobId);
    if (idx >= 0) _queuedPipelineJobs.splice(idx, 1);
    _refreshPipelineQueueMessages();
  }
  const entry = _runningPipelines.get(jobId);
  if (entry) {
    try { clearTimeout(entry.timeoutTimer); } catch { /* ignore */ }
    try { killProcessTree(entry.pipelinePid, { reason: `pipeline ${reason}` }); }
    catch (err) {
      console.error(`[vr-native] kill pipeline pid failed for ${jobId}:`, err?.message);
    }
  }
  // Also reap any inner VACE subprocess recorded by Python side.
  const job = dbGet(jobId);
  const subPid = job?.data?.subprocess_pid;
  if (subPid) {
    try { killProcessTree(subPid, { reason: `vace subprocess ${reason}` }); }
    catch (err) {
      console.error(`[vr-native] kill subprocess_pid failed for ${jobId}:`, err?.message);
    }
  }
  _runningPipelines.delete(jobId);
}

function _drainPipelineQueue() {
  if (_runningPipelines.size > 0) return;
  while (_queuedPipelineJobs.length > 0) {
    const nextJobId = _queuedPipelineJobs.shift();
    _queuedPipelineSet.delete(nextJobId);

    const job = dbGet(nextJobId);
    if (!job || TERMINAL_STAGES.has(job.stage)) continue;

    dbUpdate(nextJobId, {
      message: "GPU 队列已轮到当前任务，正在启动人物替换...",
    });
    _refreshPipelineQueueMessages();
    spawnPipelineAsync(nextJobId);
    return;
  }
}

function enqueuePipelineAsync(jobId) {
  if (_runningPipelines.has(jobId) || _queuedPipelineSet.has(jobId)) return;
  _queuedPipelineJobs.push(jobId);
  _queuedPipelineSet.add(jobId);
  const message = _pipelineQueueMessage(jobId);
  if (message) dbUpdate(jobId, { message });
  _refreshPipelineQueueMessages();
  _drainPipelineQueue();
}

function spawnPipelineAsync(jobId) {
  if (_runningPipelines.has(jobId)) return;
  if (!existsSync(VENV_PYTHON)) {
    console.error(`[vr-native] cannot spawn pipeline: venv Python not found: ${VENV_PYTHON}`);
    dbUpdate(jobId, {
      stage: "failed",
      error: `venv Python not found at ${VENV_PYTHON}`,
    });
    return;
  }
  const cliScript = join(VR_SERVICE_DIR, "vr_pipeline_cli.py");

  // Keep the pipeline alive across core-api restarts so reconcileOnStartup()
  // can re-adopt it on the next boot. On Windows this requires detached:true
  // plus fully detached stdio — otherwise the child can still die together
  // with the parent console / pipe handles.
  const fullyDetached = process.platform === "win32";
  const childStdio = fullyDetached
    ? ["ignore", "ignore", "ignore"]
    : ["ignore", "pipe", "pipe"];
  const child = spawn(VENV_PYTHON, [cliScript, jobId], {
    cwd: VR_SERVICE_DIR,
    detached: true,
    env: pythonSubprocessEnv(),
    stdio: childStdio,
    windowsHide: true,
  });

  const pipelinePid = child.pid;
  const startedAt = Date.now();
  const timeoutTimer = PIPELINE_TIMEOUT_MS > 0 ? setTimeout(() => {
    console.error(
      `[vr-native] pipeline hard timeout (${PIPELINE_TIMEOUT_MS}ms) for job ${jobId} — reaping tree`
    );
    _tryKillPipeline(jobId, "hard timeout");
    dbUpdate(jobId, {
      stage: "failed",
      error: `pipeline 超过硬性超时 ${Math.round(PIPELINE_TIMEOUT_MS / 1000)}s，已强制终止`,
      message: "pipeline hard timeout",
      dataPatch: { pipeline_pid: null, subprocess_pid: null },
    });
  }, PIPELINE_TIMEOUT_MS) : null;

  _runningPipelines.set(jobId, { child, pipelinePid, startedAt, timeoutTimer });

  // Persist pipeline PID immediately so a core-api crash before the first
  // VACE subprocess spawn still reap-able on the next boot.
  dbUpdate(jobId, {
    dataPatch: { pipeline_pid: pipelinePid, subprocess_pid: null },
    message: `pipeline 子进程已启动 (pid=${pipelinePid})`,
  });

  child.stdout?.on("data", (d) => {
    const text = d.toString("utf8").trim();
    if (!text) return;
    console.log(`[vr-pipeline:${jobId}]`, text);
    // The CLI emits a "pipeline_ready" JSON line as its first output. We
    // don't need to parse anything else; PID is already known from
    // child.pid. Parsing is best-effort; plain progress prints are ignored.
  });
  child.stderr?.on("data", (d) => {
    const text = d.toString("utf8").trim();
    if (text) console.error(`[vr-pipeline:${jobId}:err]`, text);
  });
  if (fullyDetached && typeof child.unref === "function") {
    child.unref();
  }

  child.on("exit", (code) => {
    const entry = _runningPipelines.get(jobId);
    if (entry) {
      try { clearTimeout(entry.timeoutTimer); } catch { /* ignore */ }
    }
    _runningPipelines.delete(jobId);
    // Clear the PID markers so a future reconcile doesn't try to re-kill
    // an OS-recycled PID.
    dbUpdate(jobId, { dataPatch: { pipeline_pid: null, subprocess_pid: null } });
    if (code !== 0 && code !== null) {
      console.error(
        `[vr-native] pipeline subprocess exited with code ${code} for job ${jobId}`
      );
      // If Python exited non-zero without writing a final stage, fail the job.
      const job = dbGet(jobId);
      if (job && !TERMINAL_STAGES.has(job.stage)) {
        dbUpdate(jobId, {
          stage: "failed",
          error: `pipeline subprocess exited with code ${code}`,
          message: "pipeline subprocess 异常退出",
        });
      }
    }
  });
  child.on("close", () => {
    try {
      const finishedJob = dbGet(jobId);
      const projectId = finishedJob?.data?.project_id || null;
      if (projectId) {
        syncVideoReplaceJobToProjectAsset(jobId, projectId);
      }
    } catch (err) {
      console.warn("[vr-native] could not sync finished job to project asset:", err?.message || err);
    }
    setTimeout(_drainPipelineQueue, 500);
  });
  child.on("error", (err) => {
    _runningPipelines.delete(jobId);
    console.error(`[vr-native] pipeline spawn error for job ${jobId}:`, err.message);
    dbUpdate(jobId, {
      stage: "failed",
      error: `pipeline spawn error: ${err.message}`,
      dataPatch: { pipeline_pid: null, subprocess_pid: null },
    });
    setTimeout(_drainPipelineQueue, 500);
  });
}

// ---------------------------------------------------------------------------
// Job status → response shape (matches Python's JobStatus.model_dump())
// ---------------------------------------------------------------------------

function makeVrAccessError(statusCode, code, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  return err;
}

function firstHeaderValue(req, name) {
  const value = req?.headers?.[name];
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value[0] || "";
  return "";
}

function getRequestActorId(req, url = null) {
  let resolved = null;
  let tokenActorId = null;
  let headerActorId = null;

  const authHeader = firstHeaderValue(req, "authorization");
  if (authHeader.startsWith("Bearer ")) {
    const userId = decodeAuthToken(authHeader.slice(7));
    if (userId) {
      tokenActorId = userId;
      resolved = userId;
    }
  }

  const headerValue = firstHeaderValue(req, "x-actor-id").trim();
  if (headerValue) headerActorId = headerValue;

  if (headerActorId && tokenActorId && headerActorId !== tokenActorId) {
    console.warn("[vr-native] actor mismatch on authenticated request, preferring Authorization actor", {
      tokenActorId,
      headerActorId,
      path: url?.pathname || "",
    });
    resolved = tokenActorId;
  } else if (!resolved && headerActorId) {
    resolved = headerActorId;
  }

  if (!resolved && url?.searchParams) {
    const queryActorId =
      url.searchParams.get("actorId") || url.searchParams.get("actor_id");
    if (queryActorId && queryActorId.trim()) {
      resolved = queryActorId.trim();
    }
  }

  return resolved || null;
}

function resolveRequestActor(req, url, store, options = {}) {
  return resolveActorAccessById(getRequestActorId(req, url), store, options);
}

function resolveActorAccessById(rawActorId, store, options = {}) {
  if (!rawActorId) {
    if (options.optional) return { actorId: null, actor: null };
    throw makeVrAccessError(401, "UNAUTHORIZED", "Login required");
  }

  if (!store?.resolveActor) {
    return { actorId: rawActorId, actor: { id: rawActorId, platformRole: "customer" } };
  }

  const actor = store.resolveActor(rawActorId);
  if (!actor || actor.platformRole === "guest") {
    if (options.optional) return { actorId: rawActorId, actor };
    throw makeVrAccessError(403, "FORBIDDEN", "You do not have access to video replace jobs.");
  }

  return { actorId: actor.id || rawActorId, actor };
}

function getActorAccessForFiltering(actorId, store) {
  try {
    const access = resolveActorAccessById(actorId, store, { optional: true });
    return access.actorId && access.actor && access.actor.platformRole !== "guest"
      ? access
      : null;
  } catch {
    return null;
  }
}

function getJobActorId(job) {
  const value = job?.data?.actor_id || job?.data?.actorId || job?.data?.created_by;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getJobProjectId(job) {
  const value = job?.data?.project_id || job?.data?.projectId;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function canActorAccessProject(projectId, actorId, store) {
  if (!projectId || !actorId || !store?.assertProjectAccess) return false;
  try {
    store.assertProjectAccess(projectId, actorId);
    return true;
  } catch {
    return false;
  }
}

function isJobVisibleToActor(job, access, store, projectId = null) {
  if (!job || !access?.actorId || !access?.actor) return false;
  const actor = access.actor;
  const jobActorId = getJobActorId(job);
  const jobProjectId = getJobProjectId(job);

  if (projectId) {
    if (jobProjectId !== projectId) return false;
    if (actor.platformRole === "super_admin") return true;
    if (!jobActorId || jobActorId !== access.actorId) return false;
    return canActorAccessProject(projectId, access.actorId, store);
  }

  if (actor.platformRole === "super_admin") return true;
  return Boolean(jobActorId && jobActorId === access.actorId);
}

function assertVideoReplaceJobAccess(job, req, url, store) {
  const access = resolveRequestActor(req, url, store);
  if (isJobVisibleToActor(job, access, store)) return access;
  throw makeVrAccessError(403, "FORBIDDEN", "You do not have access to this video replace job.");
}

function assertVideoReplaceJobSyncAccess(job, projectId, req, url, store) {
  const access = assertVideoReplaceJobAccess(job, req, url, store);
  if (store?.assertProjectAccess) {
    store.assertProjectAccess(projectId, access.actorId);
  }

  const jobActorId = getJobActorId(job);
  const jobProjectId = getJobProjectId(job);
  const canSync =
    access.actor?.platformRole === "super_admin" ||
    (jobActorId === access.actorId && (jobProjectId === projectId || !jobProjectId));

  if (!canSync) {
    throw makeVrAccessError(
      403,
      "FORBIDDEN",
      "This video replace job cannot be synced to the selected project.",
    );
  }

  return access;
}

function parseJobRow(row) {
  return normalizeJobRow(row);
}

function filterVisibleVideoReplaceAssets(assets, actorId, projectId, store = projectAssetStore) {
  if (!Array.isArray(assets)) return [];
  const access = getActorAccessForFiltering(actorId, store);
  return assets.filter((asset) => {
    if (asset?.sourceModule !== "video_replace" || !asset?.sourceTaskId) return true;
    if (!access) return false;
    try {
      const job = dbGet(asset.sourceTaskId);
      return isJobVisibleToActor(job, access, store, projectId || null);
    } catch {
      return false;
    }
  });
}

function jobToStatus(job) {
  const d = job.data || {};
  const queueAhead = _pipelineQueueAhead(job.job_id);
  const queueMessage = _pipelineQueueMessage(job.job_id);
  return {
    job_id: job.job_id,
    stage: job.stage,
    progress: Number(job.progress) || 0,
    message: queueMessage || job.message || null,
    error: job.error || null,
    queue_ahead: queueAhead,
    queue_position: queueAhead === null ? null : queueAhead + 1,
    created_at: job.created_at,
    updated_at: job.updated_at,
    source_video_url: d.video_url || null,
    thumbnail_url: d.thumbnail_url || null,
    meta: d.meta || null,
    detection: d.detection || null,
    source_person_id: d.source_person_id || null,
    target_reference_url: d.target_reference_url || null,
    advanced: d.advanced || null,
    mask_preview_url: d.mask_preview_url || null,
    result_video_url: d.result_video_url || null,
    result_download_url: d.result_download_url || null,
    raw_result_video_url: d.raw_result_video_url || null,
    final_result_video_url: d.final_result_video_url || null,
    final_result_download_url: d.final_result_download_url || null,
    mode: d.mode || null,
    tracker_backend: d.tracker_backend || null,
    replacer_backend: d.replacer_backend || null,
    actor_id: getJobActorId(job),
    project_id: getJobProjectId(job),
    project_asset_id: d.project_asset_id || null,
  };
}

function listJobs(limit = 30, options = {}) {
  assertStorageReady();
  const cappedLimit = Math.max(1, Math.min(100, Number(limit) || 30));
  const access = options.access || null;
  const projectId = options.projectId || null;
  const store = options.store || null;

  const rows = [..._pgJobs.values()]
    .sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));

  return rows
    .filter((job) => isJobVisibleToActor(job, access, store, projectId))
    .slice(0, cappedLimit)
    .map(jobToStatus);
}

function buildVideoReplaceAssetInput(job) {
  const status = jobToStatus(job);
  const finalUrl =
    status.final_result_video_url ||
    status.result_video_url ||
    status.source_video_url ||
    null;
  const previewUrl = status.thumbnail_url || status.mask_preview_url || null;
  const updated = status.updated_at ? new Date(status.updated_at) : new Date();
  const stamp = Number.isFinite(updated.getTime())
    ? updated.toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : status.job_id;
  return {
    assetType: "video_ref",
    name: `人物替换 ${stamp}`,
    description: [
      `状态：${status.stage}`,
      `进度：${Math.round((Number(status.progress) || 0) * 100)}%`,
      status.error ? `错误：${status.error}` : "",
      `job_id: ${status.job_id}`,
    ].filter(Boolean).join("\n"),
    previewUrl,
    mediaKind: "video",
    mediaUrl: finalUrl,
    sourceTaskId: status.job_id,
    sourceModule: "video_replace",
    sourceMetadata: {
      jobId: status.job_id,
      stage: status.stage,
      progress: status.progress,
      message: status.message,
      error: status.error,
      sourceVideoUrl: status.source_video_url,
      resultVideoUrl: status.final_result_video_url || status.result_video_url || null,
      referenceUrl: status.target_reference_url,
      advanced: status.advanced,
      updatedAt: status.updated_at,
      actorId: status.actor_id,
      projectId: status.project_id,
    },
    scope: "generated",
  };
}

function syncVideoReplaceJobToProjectAsset(jobId, projectId, store = projectAssetStore, options = {}) {
  if (!store || !projectId) return null;
  const job = dbGet(jobId);
  if (!job) return null;
  const actorId = getJobActorId(job) || options.actorId || null;
  const assetJob = {
    ...job,
    data: {
      ...(job.data || {}),
      actor_id: actorId,
      project_id: projectId,
    },
  };
  const asset = store.saveProjectAsset(projectId, buildVideoReplaceAssetInput(assetJob));
  if (asset) {
    dbUpdate(jobId, {
      dataPatch: {
        actor_id: actorId,
        project_id: projectId,
        project_asset_id: asset.id,
      },
    });
  }
  return asset;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleUpload(req, res, store) {
  const actorContext = resolveRequestActor(req, null, store, { optional: true });
  const ct = req.headers["content-type"] || "";
  if (!ct.includes("multipart/form-data")) {
    return vrFail(res, "BAD_CONTENT_TYPE", "Expected multipart/form-data", 400);
  }

  // Stream the request body to a temp file with a hard size cap. Previously
  // we accumulated chunks in-memory and ran Buffer.concat() at the end —
  // that peaks at 2× the upload size in RAM (200 MB upload → 400 MB heap
  // spike). Streaming to disk keeps steady RAM near zero and makes the
  // MAX_UPLOAD_MB enforcement deterministic.
  const tmpDir = ensureDir(join(VR_DATA_DIR, "_tmp"));
  const tmpPath = join(tmpDir, `upload_${randomUUID().replace(/-/g, "")}`);
  const tmpStream = createWriteStream(tmpPath);
  const maxBytes = (MAX_UPLOAD_MB + 1) * 1024 * 1024;

  let totalBytes = 0;
  let rejected = null;
  try {
    for await (const chunk of req) {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        rejected = `视频不能超过 ${MAX_UPLOAD_MB}MB`;
        break;
      }
      if (!tmpStream.write(chunk)) {
        await new Promise((resolveDrain) => tmpStream.once("drain", resolveDrain));
      }
    }
  } catch (err) {
    rejected = `读取请求体失败: ${err?.message || "unknown"}`;
  }
  await new Promise((done) => tmpStream.end(done));

  if (rejected) {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    const code = rejected.startsWith("视频") ? "UPLOAD_TOO_LARGE" : "UPLOAD_READ_FAILED";
    const status = code === "UPLOAD_TOO_LARGE" ? 413 : 400;
    return vrFail(res, code, rejected, status);
  }

  // Read the (now bounded) file once. For 200 MB this is a single
  // allocation instead of two (old concat path) and the temp file is
  // removed before we return success.
  let body;
  try {
    body = readFileSync(tmpPath);
  } catch (err) {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
    return vrFail(res, "UPLOAD_READ_FAILED", err?.message || "cannot read uploaded body", 500);
  } finally {
    // Don't leave the tmp behind. If readFileSync succeeded we no longer
    // need it; if it failed we already errored out above.
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }

  const parts = parseMultipart(body, ct);
  const filePart = parts?.find((p) => p.name === "file");
  if (!filePart?.data?.length) {
    return vrFail(res, "MISSING_FILE", "multipart field 'file' is required", 400);
  }

  const originalName = filePart.filename || "upload.mp4";
  const ext = extname(originalName).toLowerCase();
  if (!VIDEO_EXTS.has(ext)) {
    return vrFail(res, "UNSUPPORTED_VIDEO_FORMAT",
      `仅支持 ${[...VIDEO_EXTS].sort().join(", ")}，收到 ${ext || "未知"}`, 400);
  }

  // Save to disk
  const uploadDir = ensureDir(join(VR_DATA_DIR, "uploads"));
  const storedName = newStoredName(ext);
  const storedPath = join(uploadDir, storedName);
  writeFileSync(storedPath, filePart.data);

  // Probe via Python CLI
  const thumbDir = ensureDir(join(VR_DATA_DIR, "thumbnails"));
  const thumbName = newStoredName(".jpg");
  const thumbPath = join(thumbDir, thumbName);
  const probeResult = await runPythonAsync(join(VR_SERVICE_DIR, "vr_probe_cli.py"),
    [storedPath, thumbPath], 30_000);

  if (!probeResult.ok) {
    try { unlinkSync(storedPath); } catch { /* ignore */ }
    return vrFail(res, "PROBE_FAILED", probeResult.error || "video probe failed", 400);
  }

  const meta = probeResult.meta;
  if (meta?.duration_seconds > MAX_VIDEO_SECONDS) {
    try { unlinkSync(storedPath); } catch { /* ignore */ }
    return vrFail(res, "VIDEO_TOO_LONG",
      `当前 MVP 支持不超过 ${MAX_VIDEO_SECONDS} 秒视频，实际 ${meta.duration_seconds.toFixed(1)} 秒`, 400);
  }

  const thumbUrl = probeResult.thumb_ok ? vrUrl("/vr-thumbnails", thumbName) : null;
  const videoUrl = vrUrl("/vr-uploads", storedName);
  const jobId = `vr_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

  dbCreate(jobId, {
    actor_id: actorContext.actorId,
    video_url: videoUrl,
    video_abs_path: storedPath,
    video_stored_name: storedName,
    thumbnail_url: thumbUrl,
    meta,
    original_filename: originalName,
  });

  vrOk(res, { job_id: jobId, video_url: videoUrl, thumbnail_url: thumbUrl, meta }, 200);
}

async function handleReferenceUpload(req, res) {
  const ct = req.headers["content-type"] || "";
  if (!ct.includes("multipart/form-data")) {
    return vrFail(res, "BAD_CONTENT_TYPE", "Expected multipart/form-data", 400);
  }

  const chunks = [];
  let totalBytes = 0;
  const maxRef = 25 * 1024 * 1024;
  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > maxRef) return vrFail(res, "UPLOAD_TOO_LARGE", "参考图不能超过 25MB", 413);
    chunks.push(chunk);
  }
  const body = Buffer.concat(chunks);

  const parts = parseMultipart(body, ct);
  const filePart = parts?.find((p) => p.name === "file");
  if (!filePart?.data?.length) return vrFail(res, "MISSING_FILE", "multipart field 'file' is required", 400);

  const originalName = filePart.filename || "ref.jpg";
  const ext = extname(originalName).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) {
    return vrFail(res, "UNSUPPORTED_IMAGE_FORMAT",
      `参考图仅支持 ${[...IMAGE_EXTS].sort().join(", ")}`, 400);
  }

  const refDir = ensureDir(join(VR_DATA_DIR, "references"));
  const storedName = newStoredName(ext);
  writeFileSync(join(refDir, storedName), filePart.data);

  vrOk(res, {
    url: vrUrl("/vr-references", storedName),
    filename: originalName,
    content_type: filePart.contentType || `image/${ext.slice(1)}`,
    size_bytes: filePart.data.length,
  });
}

async function handleImportJob(req, res, store) {
  const actorContext = resolveRequestActor(req, null, store, { optional: true });
  const body = await readJsonBodyLocal(req);
  const videoUrl = (body.video_url || "").trim();
  if (!videoUrl) return vrFail(res, "INVALID_URL", "video_url is required", 400);
  const projectId = String(body.project_id || body.projectId || "").trim() || null;
  if (projectId && store?.assertProjectAccess && actorContext.actorId) {
    try {
      store.assertProjectAccess(projectId, actorContext.actorId);
    } catch (err) {
      return vrFail(res, err?.code || "FORBIDDEN", err?.message || "You do not have access to this project.", err?.statusCode || 403);
    }
  }

  const absUrl = resolveExternalUrl(videoUrl);
  if (!absUrl) return vrFail(res, "INVALID_URL", `不支持的资产地址: ${videoUrl}`, 400);

  let bytes;
  try {
    bytes = await fetchRemoteBytes(absUrl, MAX_UPLOAD_MB * 1024 * 1024);
  } catch (err) {
    return vrFail(res, "IMPORT_FETCH_FAILED", err.message, 502);
  }

  const guessedExt = guessExt(absUrl, body.original_filename);
  if (!VIDEO_EXTS.has(guessedExt)) {
    return vrFail(res, "UNSUPPORTED_VIDEO_FORMAT",
      `资产扩展名 ${guessedExt || "未知"} 不在受支持列表`, 400);
  }

  const uploadDir = ensureDir(join(VR_DATA_DIR, "uploads"));
  const storedName = newStoredName(guessedExt);
  const storedPath = join(uploadDir, storedName);
  writeFileSync(storedPath, bytes);

  const thumbDir = ensureDir(join(VR_DATA_DIR, "thumbnails"));
  const thumbName = newStoredName(".jpg");
  const thumbPath = join(thumbDir, thumbName);
  const probeResult = await runPythonAsync(join(VR_SERVICE_DIR, "vr_probe_cli.py"),
    [storedPath, thumbPath], 30_000);

  if (!probeResult.ok) {
    try { unlinkSync(storedPath); } catch { /* ignore */ }
    return vrFail(res, "PROBE_FAILED", probeResult.error || "video probe failed", 400);
  }

  const meta = probeResult.meta;
  if (meta?.duration_seconds > MAX_VIDEO_SECONDS) {
    try { unlinkSync(storedPath); } catch { /* ignore */ }
    return vrFail(res, "VIDEO_TOO_LONG",
      `当前 MVP 支持不超过 ${MAX_VIDEO_SECONDS} 秒，实际 ${meta.duration_seconds?.toFixed(1)} 秒`, 400);
  }

  const thumbUrl = probeResult.thumb_ok ? vrUrl("/vr-thumbnails", thumbName) : null;
  const storedVideoUrl = vrUrl("/vr-uploads", storedName);
  const jobId = `vr_${randomUUID().replace(/-/g, "").slice(0, 10)}`;

  dbCreate(jobId, {
    actor_id: actorContext.actorId,
    project_id: projectId,
    video_url: storedVideoUrl,
    video_abs_path: storedPath,
    video_stored_name: storedName,
    thumbnail_url: thumbUrl,
    meta,
    original_filename: body.original_filename || basename(absUrl),
    source_origin: "asset-import",
    source_original_url: videoUrl,
  });

  vrOk(res, { job_id: jobId, video_url: storedVideoUrl, thumbnail_url: thumbUrl, meta });
}

async function handleReferenceImport(req, res) {
  const body = await readJsonBodyLocal(req);
  const imageUrl = (body.image_url || "").trim();
  if (!imageUrl) return vrFail(res, "INVALID_URL", "image_url is required", 400);

  const absUrl = resolveExternalUrl(imageUrl);
  if (!absUrl) return vrFail(res, "INVALID_URL", `不支持的资产地址: ${imageUrl}`, 400);

  let bytes;
  try {
    bytes = await fetchRemoteBytes(absUrl, 25 * 1024 * 1024);
  } catch (err) {
    return vrFail(res, "IMPORT_FETCH_FAILED", err.message, 502);
  }

  const guessedExt = guessExt(absUrl, body.original_filename);
  if (!IMAGE_EXTS.has(guessedExt)) {
    return vrFail(res, "UNSUPPORTED_IMAGE_FORMAT",
      `资产扩展名 ${guessedExt || "未知"} 不在受支持列表`, 400);
  }

  const refDir = ensureDir(join(VR_DATA_DIR, "references"));
  const storedName = newStoredName(guessedExt);
  writeFileSync(join(refDir, storedName), bytes);

  vrOk(res, {
    url: vrUrl("/vr-references", storedName),
    filename: body.original_filename || basename(absUrl) || storedName,
    content_type: `image/${guessedExt.slice(1)}`,
    size_bytes: bytes.length,
  });
}

async function handleDetect(req, res, jobId, store, url) {
  const job = dbGet(jobId);
  if (!job) return vrFail(res, "JOB_NOT_FOUND", "任务不存在", 404);
  try {
    assertVideoReplaceJobAccess(job, req, url, store);
  } catch (err) {
    return vrFail(res, err?.code || "FORBIDDEN", err?.message || "Forbidden", err?.statusCode || 403);
  }
  if (job.stage === "detecting") {
    return vrFail(res, "DETECTION_ALREADY_RUNNING", "检测正在进行中", 409);
  }

  let conf = 0.4;
  try {
    const body = await readJsonBodyLocal(req);
    if (body.yolo_conf != null) conf = Number(body.yolo_conf);
  } catch { /* body optional */ }

  const cliScript = join(VR_SERVICE_DIR, "vr_detect_cli.py");
  // Async: doesn't block the 4100 event loop. Other requests (status GETs,
  // SSE polling, unrelated core-api traffic) continue to be served while
  // YOLO runs in the detached Python subprocess.
  const result = await runPythonAsync(cliScript, [jobId, "--conf", String(conf)], 120_000);

  if (!result.ok) {
    return vrFail(res, "DETECTION_FAILED", result.error || "detection failed", 500);
  }

  const updated = dbGet(jobId);
  vrOk(res, jobToStatus(updated));
}

async function handleGenerate(req, res, jobId, store, url) {
  const job = dbGet(jobId);
  if (!job) return vrFail(res, "JOB_NOT_FOUND", "任务不存在", 404);

  let access;
  try {
    access = assertVideoReplaceJobAccess(job, req, url, store);
  } catch (err) {
    return vrFail(res, err?.code || "FORBIDDEN", err?.message || "Forbidden", err?.statusCode || 403);
  }

  if (job.stage !== "detected") {
    return vrFail(res, "INVALID_STAGE",
      `只有 detected 状态的任务才能提交生成，当前 ${job.stage}`, 400);
  }

  let payload;
  try { payload = await readJsonBodyLocal(req); }
  catch { return vrFail(res, "BAD_JSON", "request body must be valid JSON", 400); }

  const { source_person_id, target_reference_url } = payload;
  const projectId = String(payload.project_id || payload.projectId || "").trim() || null;
  const existingProjectId = getJobProjectId(job);
  if (projectId && store?.assertProjectAccess) {
    try {
      store.assertProjectAccess(projectId, access.actorId);
    } catch (err) {
      return vrFail(res, err?.code || "FORBIDDEN", err?.message || "You do not have access to this project.", err?.statusCode || 403);
    }
  }
  if (
    existingProjectId &&
    projectId &&
    existingProjectId !== projectId &&
    access.actor?.platformRole !== "super_admin"
  ) {
    return vrFail(res, "FORBIDDEN", "This video replace job belongs to another project.", 403);
  }
  const candidates = job.data?.detection?.candidates || [];
  const validIds = new Set(candidates.map((c) => c.person_id));
  if (!validIds.has(source_person_id)) {
    return vrFail(res, "INVALID_SOURCE_PERSON", "source_person_id 不在候选列表中", 400);
  }
  if (!target_reference_url) {
    return vrFail(res, "MISSING_REFERENCE", "必须先上传 replacement character 参考图", 400);
  }

  const rawAdvanced = {
    yolo_conf: payload.yolo_conf ?? 0.4,
    sam2_size: payload.sam2_size ?? "tiny",
    mask_dilation_px: payload.mask_dilation_px ?? 5,
    mask_blur_px: payload.mask_blur_px ?? 4,
    sample_steps: payload.sample_steps ?? DEFAULT_SAFE_SAMPLE_STEPS,
    sample_size: payload.sample_size ?? "832*480",
    inference_fps: payload.inference_fps ?? DEFAULT_INFERENCE_FPS,
    max_frame_num: payload.max_frame_num ?? MAX_SAFE_FRAME_NUM,
    base_seed: payload.base_seed ?? null,
  };
  const { advanced: safeAdvanced, notes: clampNotes } =
    clampAdvancedForHardware(rawAdvanced, job.data?.meta || {});

  const queueMessage = clampNotes.length
    ? `任务参数已保存，正在入队等待执行…（${clampNotes.join(" ")}）`
    : "任务参数已保存，正在入队等待执行…";

  dbUpdate(jobId, {
    stage: "queued",
    progress: 0.0,
    message: queueMessage,
    dataPatch: {
      source_person_id,
      target_reference_url,
      advanced: safeAdvanced,
      advanced_requested: rawAdvanced,
      advanced_clamp_notes: clampNotes,
      prompt: payload.prompt || null,
      actor_id: getJobActorId(job) || access.actorId,
      project_id: projectId,
    },
  });

  if (projectId && projectAssetStore) {
    try {
      projectAssetStore.assertProjectAccess(projectId, access.actorId);
      syncVideoReplaceJobToProjectAsset(jobId, projectId, projectAssetStore, {
        actorId: access.actorId,
      });
    } catch (err) {
      console.warn("[vr-native] could not sync queued job to project asset:", err?.message || err);
    }
  }

  // Queue pipeline subprocess (non-blocking). A single 12GB GPU cannot run
  // multiple VACE/Wan2.1 jobs safely at the same time.
  enqueuePipelineAsync(jobId);

  const updated = dbGet(jobId);
  vrOk(res, jobToStatus(updated));
}

function handleListJobs(req, res, url, store) {
  const limit = url.searchParams.get("limit") || 30;
  const projectId =
    String(url.searchParams.get("project_id") || url.searchParams.get("projectId") || "").trim() || null;
  try {
    const access = resolveRequestActor(req, url, store);
    if (projectId && store?.assertProjectAccess) {
      store.assertProjectAccess(projectId, access.actorId);
    }
    vrOk(res, { items: listJobs(limit, { access, projectId, store }) });
  } catch (err) {
    vrFail(res, err?.code || "FORBIDDEN", err?.message || "Forbidden", err?.statusCode || 403);
  }
}

async function handleSyncJobAsset(req, res, jobId, store, url) {
  const job = dbGet(jobId);
  if (!job) return vrFail(res, "JOB_NOT_FOUND", "任务不存在", 404);
  const body = await readJsonBodyLocal(req);
  const projectId = String(body.project_id || body.projectId || "").trim();
  if (!projectId) return vrFail(res, "MISSING_PROJECT", "project_id is required", 400);
  try {
    const access = assertVideoReplaceJobSyncAccess(job, projectId, req, url, store);
    const asset = syncVideoReplaceJobToProjectAsset(jobId, projectId, store, {
      actorId: access.actorId,
    });
    if (!asset) return vrFail(res, "SYNC_FAILED", "同步到项目资产失败", 500);
    vrOk(res, { asset, job: jobToStatus(dbGet(jobId)) });
  } catch (err) {
    vrFail(res, err?.code || "SYNC_FAILED", err?.message || "同步到项目资产失败", err?.statusCode || 500);
  }
}

function handleGetJob(req, res, jobId, store, url) {
  const job = dbGet(jobId);
  if (!job) return vrFail(res, "JOB_NOT_FOUND", "任务不存在", 404);
  try {
    assertVideoReplaceJobAccess(job, req, url, store);
  } catch (err) {
    return vrFail(res, err?.code || "FORBIDDEN", err?.message || "Forbidden", err?.statusCode || 403);
  }
  vrOk(res, jobToStatus(job));
}

function handleCancelJob(req, res, jobId, store, url) {
  const job = dbGet(jobId);
  if (!job) return vrFail(res, "JOB_NOT_FOUND", "任务不存在", 404);
  try {
    assertVideoReplaceJobAccess(job, req, url, store);
  } catch (err) {
    return vrFail(res, err?.code || "FORBIDDEN", err?.message || "Forbidden", err?.statusCode || 403);
  }
  if (TERMINAL_STAGES.has(job.stage)) {
    return vrFail(res, "ALREADY_TERMINAL", `任务已处于终止状态 (${job.stage})，无法取消`, 400);
  }
  // Kill the pipeline subprocess tree (pipeline process + any VACE grandchild).
  _tryKillPipeline(jobId, "user cancel");
  dbUpdate(jobId, {
    stage: "cancelled",
    message: "用户已取消生成",
    dataPatch: { pipeline_pid: null, subprocess_pid: null },
  });
  const updated = dbGet(jobId);
  vrOk(res, jobToStatus(updated));
}

async function handleStreamJob(req, res, jobId, store, url) {
  const initialJob = dbGet(jobId);
  if (!initialJob) return vrFail(res, "JOB_NOT_FOUND", "job not found", 404);
  try {
    assertVideoReplaceJobAccess(initialJob, req, url, store);
  } catch (err) {
    return vrFail(res, err?.code || "FORBIDDEN", err?.message || "Forbidden", err?.statusCode || 403);
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    ...corsHeaders(),
  });

  let lastSnapshot = null;
  let closed = false;
  req.on("close", () => { closed = true; });

  while (!closed) {
    const job = dbGet(jobId);
    if (!job) {
      if (!res.writableEnded) {
        res.write(`event: error\ndata: ${JSON.stringify({ message: "job not found" })}\n\n`);
      }
      break;
    }

    const status = jobToStatus(job);
    const serialized = JSON.stringify(status);
    if (serialized !== lastSnapshot) {
      if (!res.writableEnded) res.write(`event: status\ndata: ${serialized}\n\n`);
      lastSnapshot = serialized;
    }

    if (TERMINAL_STAGES.has(job.stage)) {
      if (!res.writableEnded) res.write(`event: complete\ndata: ${serialized}\n\n`);
      break;
    }

    await new Promise((r) => setTimeout(r, 1200));
  }

  if (!res.writableEnded) res.end();
}

// ---------------------------------------------------------------------------
// URL + fetch helpers
// ---------------------------------------------------------------------------

function resolveExternalUrl(raw) {
  const s = (raw || "").trim();
  if (!s) return null;
  if (s.startsWith("http://") || s.startsWith("https://")) return s;
  if (s.startsWith("/")) {
    const base = (process.env.CORE_API_PUBLIC_BASE_URL || "http://127.0.0.1:4100").replace(/\/+$/, "");
    return `${base}${s}`;
  }
  return null;
}

function guessExt(url, fallbackName) {
  for (const candidate of [url, fallbackName || ""]) {
    if (!candidate) continue;
    const path = candidate.split("?")[0].split("#")[0];
    const ext = extname(path).toLowerCase();
    if (ext) return ext;
  }
  return "";
}

async function fetchRemoteBytes(url, maxBytes) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https://") ? require("node:https") : http;
    mod.get(url, { headers: { "User-Agent": "xiaolou-vr/1.0" } }, (resp) => {
      if (resp.statusCode !== 200) {
        resp.resume();
        return reject(new Error(`远端资源返回 ${resp.statusCode}: ${url}`));
      }
      const chunks = [];
      let total = 0;
      resp.on("data", (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          resp.destroy();
          reject(new Error(`远端资源大小 ${total} 超过上限 ${maxBytes}: ${url}`));
        } else {
          chunks.push(chunk);
        }
      });
      resp.on("end", () => resolve(Buffer.concat(chunks)));
      resp.on("error", reject);
    }).on("error", reject);
  });
}

async function readJsonBodyLocal(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Main entry point — called from server.js
// ---------------------------------------------------------------------------

const VR_API_PREFIX = "/api/video-replace";

function isVideoReplaceRequest(pathname) {
  return VR_PATH_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?")
  );
}

/**
 * Handle a video-replace request natively.
 * Returns true if the request was handled (even if with an error response).
 */
async function handleVideoReplaceRequest(req, res, url, store = null) {
  if (!isVideoReplaceRequest(url.pathname)) return false;
  await initializeVideoReplaceStorage();
  if (store) projectAssetStore = store;

  // OPTIONS pre-flight
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return true;
  }

  const pathname = url.pathname;

  // --- Static file serving ---
  if (!pathname.startsWith(VR_API_PREFIX)) {
    return serveVrStatic(req, res, pathname);
  }

  // --- API routes ---
  const apiPath = pathname.slice(VR_API_PREFIX.length) || "/";

  try {
    // POST /api/video-replace/upload
    if (req.method === "POST" && apiPath === "/upload") {
      await handleUpload(req, res, store || projectAssetStore);
      return true;
    }

    // POST /api/video-replace/reference
    if (req.method === "POST" && apiPath === "/reference") {
      await handleReferenceUpload(req, res);
      return true;
    }

    // GET /api/video-replace/jobs  (recent history)
    if (req.method === "GET" && apiPath === "/jobs") {
      handleListJobs(req, res, url, store || projectAssetStore);
      return true;
    }

    // POST /api/video-replace/jobs  (import from URL)
    if (req.method === "POST" && apiPath === "/jobs") {
      await handleImportJob(req, res, store || projectAssetStore);
      return true;
    }

    // POST /api/video-replace/reference-import
    if (req.method === "POST" && apiPath === "/reference-import") {
      await handleReferenceImport(req, res);
      return true;
    }

    // /api/video-replace/jobs/:jobId routes
    const jobMatch = /^\/jobs\/([^/]+)(\/.*)?$/.exec(apiPath);
    if (jobMatch) {
      const jobId = decodeURIComponent(jobMatch[1]);
      const subPath = jobMatch[2] || "";

      // POST /jobs/:id/detect
      if (req.method === "POST" && subPath === "/detect") {
        await handleDetect(req, res, jobId, store || projectAssetStore, url);
        return true;
      }

      // POST /jobs/:id/generate
      if (req.method === "POST" && subPath === "/generate") {
        await handleGenerate(req, res, jobId, store || projectAssetStore, url);
        return true;
      }

      // POST /jobs/:id/cancel
      if (req.method === "POST" && subPath === "/cancel") {
        handleCancelJob(req, res, jobId, store || projectAssetStore, url);
        return true;
      }

      // POST /jobs/:id/sync-asset
      if (req.method === "POST" && subPath === "/sync-asset") {
        await handleSyncJobAsset(req, res, jobId, store || projectAssetStore, url);
        return true;
      }

      // GET /jobs/:id
      if (req.method === "GET" && subPath === "") {
        handleGetJob(req, res, jobId, store || projectAssetStore, url);
        return true;
      }

      // GET /jobs/:id/stream
      if (req.method === "GET" && subPath === "/stream") {
        await handleStreamJob(req, res, jobId, store || projectAssetStore, url);
        return true;
      }
    }

    vrFail(res, "NOT_FOUND", `video-replace route not found: ${req.method} ${pathname}`, 404);
    return true;
  } catch (err) {
    console.error("[vr-native] unhandled error:", err);
    if (!res.writableEnded) vrFail(res, "INTERNAL_ERROR", "unexpected server error", 500);
    return true;
  }
}

/**
 * Re-adopt an orphaned pipeline subprocess after a hot-reload or crash restart.
 *
 * We cannot get a real ChildProcess handle for a process we didn't spawn in
 * this Node session. Instead we:
 *   1. Store a synthetic entry in _runningPipelines so _tryKillPipeline works.
 *   2. Poll isProcessAlive() every 5 s. When the PID dies the Python side has
 *      already written its final stage to PostgreSQL; we just clean up markers.
 *   3. Install the hard-timeout timer so a stuck adopted job is still reaped.
 */
function _adoptOrphanPipeline(jobId, pipelinePid) {
  if (_runningPipelines.has(jobId)) return;

  const startedAt = Date.now();

  const timeoutTimer = PIPELINE_TIMEOUT_MS > 0 ? setTimeout(() => {
    console.error(
      `[vr-native] adopted pipeline hard timeout (${PIPELINE_TIMEOUT_MS}ms) job=${jobId} pid=${pipelinePid}`
    );
    _tryKillPipeline(jobId, "hard timeout (adopted)");
    dbUpdate(jobId, {
      stage: "failed",
      error: `pipeline 超过硬性超时 ${Math.round(PIPELINE_TIMEOUT_MS / 1000)}s（认领孤儿进程），已强制终止`,
      message: "pipeline hard timeout (adopted)",
      dataPatch: { pipeline_pid: null, subprocess_pid: null },
    });
  }, PIPELINE_TIMEOUT_MS) : null;

  // Synthetic child: no stdio pipes, kill still works via killProcessTree.
  const syntheticChild = {
    pid: pipelinePid,
    kill: (sig) => {
      try { killProcessTree(pipelinePid, { reason: `synthetic kill sig=${sig}` }); } catch { /* ignore */ }
    },
  };

  _runningPipelines.set(jobId, { child: syntheticChild, pipelinePid, startedAt, timeoutTimer, adopted: true });

  // Poll for process exit every 5 seconds.
  const pollTimer = setInterval(() => {
    if (isProcessAlive(pipelinePid)) return; // still running

    clearInterval(pollTimer);
    const entry = _runningPipelines.get(jobId);
    if (entry) {
      try { clearTimeout(entry.timeoutTimer); } catch { /* ignore */ }
    }
    _runningPipelines.delete(jobId);
    dbUpdate(jobId, { dataPatch: { pipeline_pid: null, subprocess_pid: null } });

    const finishedJob = dbGet(jobId);
    if (finishedJob && !TERMINAL_STAGES.has(finishedJob.stage)) {
      dbUpdate(jobId, {
        stage: "failed",
        error: "pipeline process 退出但未写入最终状态（认领孤儿进程）",
        message: "pipeline subprocess 异常退出（adopted orphan）",
        dataPatch: { pipeline_pid: null, subprocess_pid: null },
      });
    }
    console.log(
      `[vr-native] adopted pipeline exited: job=${jobId} pid=${pipelinePid} stage=${finishedJob?.stage}`
    );
    setTimeout(_drainPipelineQueue, 500);
  }, 5000);
}

/**
 * On every cold boot (including hot-reload restarts from `node --watch`):
 *
 * Strategy per job:
 *   • pipeline_pid still ALIVE  → re-adopt (do NOT kill). The Python process
 *     writes directly to PostgreSQL; Node just needs to poll for its exit.
 *     This handles the hot-reload case: VACE keeps running in Python.
 *   • pipeline_pid dead / absent → the process already exited. If the job
 *     is still non-terminal the Python side crashed → mark failed.
 *
 * Called once by server.js right after ``createServer`` returns.
 */
function reconcileOnStartup() {
  assertStorageReady();
  let jobs;
  try {
    const rows = [..._pgJobs.values()]
      .filter((job) => IN_FLIGHT_STAGES.has(job.stage))
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    jobs = rows.map((r) => ({ ...r, data: parseJobData(r.data) }));
  } catch (err) {
    console.error("[vr-native] reconcileOnStartup: DB scan failed:", err?.message);
    return { scanned: 0, reaped: 0 };
  }

  if (jobs.length === 0) {
    console.log("[vr-native] startup reconcile: no in-flight jobs");
    return { scanned: 0, reaped: 0 };
  }

  console.log(
    `[vr-native] startup reconcile: found ${jobs.length} in-flight job(s) — evaluating each`
  );

  let adopted = 0;
  let reaped = 0;
  let requeued = 0;
  for (const job of jobs) {
    const d = job.data || {};
    const pipelinePid = d.pipeline_pid;
    const subPid = d.subprocess_pid;

    // ── pipeline still alive → re-adopt, keep VACE running ──────────
    if (pipelinePid && isProcessAlive(pipelinePid)) {
      console.log(
        `[vr-native] startup reconcile: re-adopting live pipeline pid=${pipelinePid} job=${job.job_id} stage=${job.stage}`
      );
      _adoptOrphanPipeline(job.job_id, pipelinePid);
      adopted += 1;
      continue;
    }

    if (job.stage === "queued" && !pipelinePid) {
      console.log(`[vr-native] startup reconcile: re-queueing queued job=${job.job_id}`);
      enqueuePipelineAsync(job.job_id);
      requeued += 1;
      continue;
    }

    // ── pipeline dead / never recorded → clean up ───────────────────
    if (subPid && isProcessAlive(subPid)) {
      killProcessTree(subPid, { reason: `startup reap subprocess_pid job=${job.job_id}` });
    }
    dbUpdate(job.job_id, {
      stage: "failed",
      error:
        "core-api 重启时发现该任务处于未完成状态，且关联进程已不存在。" +
        "请在前端重新提交任务。",
      message: "startup reconcile: 进程已终止，标记失败",
      dataPatch: { pipeline_pid: null, subprocess_pid: null },
    });
    reaped += 1;
  }

  if (adopted > 0) {
    console.log(`[vr-native] startup reconcile: re-adopted ${adopted} live pipeline(s) — VACE keeps running`);
  }
  if (reaped > 0) {
    console.warn(`[vr-native] startup reconcile: reaped ${reaped} dead job(s)`);
  }
  if (requeued > 0) {
    console.log(`[vr-native] startup reconcile: re-queued ${requeued} queued job(s)`);
  }
  return { scanned: jobs.length, reaped, adopted, requeued };
}

/**
 * Stop every running pipeline tree when core-api itself is going away.
 *
 * Called on SIGINT / SIGTERM from server.js. Kills the full subprocess
 * tree (pipeline outer + any VACE grandchild) so we never leak a 11 GB
 * VRAM python.exe after Ctrl+C.
 */
function shutdownPipelines(reason = "core-api shutdown") {
  const inFlight = [..._runningPipelines.keys()];
  if (inFlight.length === 0) return;

  console.warn(
    `[vr-native] shutdown: killing ${inFlight.length} in-flight pipeline tree(s): ${inFlight.join(", ")}`
  );
  for (const jobId of inFlight) {
    _tryKillPipeline(jobId, reason);
    try {
      dbUpdate(jobId, {
        stage: "failed",
        error: `core-api 关闭时任务仍在执行；关联的 pipeline / GPU 子进程已被清理 (${reason})`,
        message: "shutdown reap",
        dataPatch: { pipeline_pid: null, subprocess_pid: null },
      });
    } catch { /* ignore */ }
  }
}

module.exports = {
  closeVideoReplaceStorage,
  filterVisibleVideoReplaceAssets,
  flushVideoReplaceStorage,
  handleVideoReplaceRequest,
  initializeVideoReplaceStorage,
  isVideoReplaceRequest,
  shutdownPipelines,
  reconcileOnStartup,
};
