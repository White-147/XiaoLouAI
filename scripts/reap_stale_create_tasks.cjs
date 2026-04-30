#!/usr/bin/env node
/**
 * One-shot: reap create_image_generate / create_video_generate tasks that have
 * been stuck in a non-terminal state longer than the configured threshold.
 *
 * This mirrors what `store.reconcileStaleCreateTasks` does on startup, but runs
 * directly against demo.sqlite so the user does not need to bounce core-api.
 *
 * Usage:   node scripts/reap_stale_create_tasks.cjs [--staleMs=600000] [--dry]
 */

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_STALE_MS = 10 * 60 * 1000;
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const staleMsArg = args.find((a) => a.startsWith("--staleMs="));
const staleAfterMs = staleMsArg ? Number(staleMsArg.split("=")[1]) : DEFAULT_STALE_MS;

const dbPath = path.resolve(__dirname, "..", "core-api", "data", "demo.sqlite");
const db = new DatabaseSync(dbPath);

const row = db
  .prepare("SELECT state_value FROM app_state WHERE state_key = 'snapshot'")
  .get();
if (!row?.state_value) {
  console.error("snapshot row not found");
  process.exit(1);
}
const state = JSON.parse(row.state_value);

const createTypes = new Set([
  "create_image_generate",
  "create_video_generate",
]);
const nonTerminal = new Set(["queued", "pending", "running"]);
const now = Date.now();

const tasks = Array.isArray(state.tasks) ? state.tasks : [];
const reaped = [];
for (const t of tasks) {
  if (!t || !createTypes.has(t.type) || !nonTerminal.has(t.status)) continue;
  const updatedAt = Date.parse(t.updatedAt || t.createdAt || "");
  if (!Number.isFinite(updatedAt)) continue;
  const ageMs = now - updatedAt;
  if (ageMs < staleAfterMs) continue;

  reaped.push({ id: t.id, type: t.type, ageSec: Math.round(ageMs / 1000) });
  if (!dry) {
    t.status = "failed";
    t.updatedAt = new Date().toISOString();
    t.error =
      t.error ||
      "任务在 core-api 重启前被中断（未收到结果）。请重新发起，本次不会产生扣费。";
    t.failureReason = t.failureReason || "STARTUP_RECONCILE_STALE_NON_TERMINAL";
  }
}

console.log(JSON.stringify({ scanned: tasks.length, reaped: reaped.length, dry, staleAfterMs, reapedIds: reaped }, null, 2));

if (!dry && reaped.length > 0) {
  db.prepare(
    "UPDATE app_state SET state_value = ?, updated_at = ? WHERE state_key = 'snapshot'"
  ).run(JSON.stringify(state), new Date().toISOString());
  console.log("snapshot updated");
}
db.close();
