import type { Task } from "./api";

const FAILED_STATUSES = new Set(["failed", "cancelled", "canceled", "error"]);
const ACTIVE_STATUSES = new Set(["queued", "leased", "running", "retry_waiting", "pending", "processing"]);

export function isTaskFailed(task: Pick<Task, "status">): boolean {
  return FAILED_STATUSES.has(String(task.status || "").toLowerCase());
}

export function isTaskActive(task: Pick<Task, "status">): boolean {
  return ACTIVE_STATUSES.has(String(task.status || "").toLowerCase());
}

/**
 * Pretty-label for status pills (Chinese UI).
 */
export function formatTaskStatusLabel(task: Pick<Task, "status">): string {
  const status = String(task.status || "").toLowerCase();
  switch (status) {
    case "queued":
    case "retry_waiting":
      return "排队中";
    case "leased":
    case "running":
    case "processing":
      return "生成中";
    case "succeeded":
    case "success":
    case "completed":
      return "已完成";
    case "failed":
    case "error":
      return "失败";
    case "cancelled":
    case "canceled":
      return "已取消";
    default:
      return status || "未知";
  }
}

/**
 * Tailwind class-string for the status pill. Failed tasks get a red tint so
 * the problem is immediately visible; active tasks get an amber tint; success
 * gets emerald. Anything else falls back to the neutral secondary pill.
 */
export function getTaskStatusPillClass(task: Pick<Task, "status">): string {
  const status = String(task.status || "").toLowerCase();
  if (FAILED_STATUSES.has(status)) {
    return "rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-600/40 dark:bg-rose-500/15 dark:text-rose-300 dark:ring-rose-500/30";
  }
  if (ACTIVE_STATUSES.has(status)) {
    return "rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/40 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30";
  }
  if (status === "succeeded" || status === "success" || status === "completed") {
    return "rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/40 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-500/30";
  }
  return "rounded-full bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground";
}

/**
 * Pull the human-readable failure reason out of a task. Prefers the explicit
 * ``outputSummary`` set by ``core-api`` on terminal failure; falls back to
 * ``currentStage`` (which occasionally carries shorter provider codes) then
 * to a safe default message. Returns null when the task is NOT in a failed
 * state so callers can conditionally render the detail row.
 */
export function getTaskFailureReason(
  task: Pick<Task, "status" | "outputSummary" | "currentStage">,
): string | null {
  if (!isTaskFailed(task)) return null;
  const reason =
    String(task.outputSummary || "").trim() ||
    String(task.currentStage || "").trim() ||
    "";
  return reason || "任务失败，但未记录具体原因。请查看服务器日志。";
}
