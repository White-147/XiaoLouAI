/**
 * process-tree.js
 *
 * Cross-platform "kill a process tree" helper for core-api.
 *
 * Why this exists:
 *   The default 4100-native video-replace path spawns ``vr_pipeline_cli.py``
 *   (outer pipeline) which in turn spawns Wan2.1 ``generate.py`` (inner
 *   GPU-heavy subprocess). On Windows, the venv redirector adds a third
 *   layer: Scripts/python.exe → base python.exe. Killing only the direct
 *   child (``ChildProcess.kill('SIGTERM')`` = TerminateProcess) leaves the
 *   grandchildren pinning ~11 GB of VRAM until someone runs taskkill.
 *
 *   This module exposes a single primitive — ``killProcessTree(pid)`` —
 *   that will:
 *     - on Windows: ``taskkill /PID <pid> /T /F`` (walks the PPID tree)
 *     - on POSIX:  ``kill -KILL -pgid`` when we have a process group,
 *                  ``pkill -KILL -P pid`` as a descendant-walker fallback
 *
 *   Safe to call with a stale / missing PID — it's a no-op in that case
 *   and never throws. Never blocks for more than ~10 s.
 */

"use strict";

const { spawnSync } = require("node:child_process");

function isProcessAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we lack privilege — still alive.
    return err && err.code === "EPERM";
  }
}

function killProcessTreeWindows(pid) {
  // /T = also terminate child processes; /F = force (no polite SIGTERM).
  const result = spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
    timeout: 10_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout || "").toString("utf8").trim(),
    stderr: (result.stderr || "").toString("utf8").trim(),
  };
}

function killProcessTreePosix(pid) {
  // 1. Try killing the whole process group (works when the child was
  //    spawned with `detached: true` which sets pgid = pid).
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    /* no group or no such process */
  }
  // 2. Walk and kill descendants via pkill -P (ppid walker).
  try {
    spawnSync("pkill", ["-KILL", "-P", String(pid)], {
      timeout: 10_000,
      stdio: ["ignore", "ignore", "ignore"],
    });
  } catch {
    /* pkill not installed? ignore */
  }
  // 3. Finally the top-level pid itself.
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* already gone */
  }
  return { ok: true };
}

/**
 * Kill the process identified by ``pid`` together with every descendant.
 * Returns ``{ ok, reason?, detail? }``; never throws.
 *
 * @param {number|null|undefined} pid
 * @param {{ reason?: string }} [options]
 */
function killProcessTree(pid, options = {}) {
  const reason = options.reason || "unspecified";
  if (!pid || pid <= 0) {
    return { ok: true, reason: "no-pid" };
  }
  if (!isProcessAlive(pid)) {
    return { ok: true, reason: "already-gone", pid };
  }
  try {
    if (process.platform === "win32") {
      const res = killProcessTreeWindows(pid);
      console.warn(
        `[process-tree] killed Windows tree pid=${pid} (${reason})`,
        res.ok ? "" : `status=${res.status} stderr=${res.stderr}`
      );
      return res;
    }
    const res = killProcessTreePosix(pid);
    console.warn(`[process-tree] killed POSIX tree pid=${pid} (${reason})`);
    return res;
  } catch (err) {
    console.error(
      `[process-tree] killProcessTree(${pid}) raised:`,
      err && err.message ? err.message : err
    );
    return { ok: false, error: err && err.message };
  }
}

/**
 * Kill several trees; best-effort.
 * @param {Array<number|null|undefined>} pids
 * @param {{ reason?: string }} [options]
 */
function killProcessTrees(pids, options = {}) {
  const out = [];
  for (const pid of pids || []) {
    out.push({ pid, ...killProcessTree(pid, options) });
  }
  return out;
}

module.exports = { killProcessTree, killProcessTrees, isProcessAlive };
