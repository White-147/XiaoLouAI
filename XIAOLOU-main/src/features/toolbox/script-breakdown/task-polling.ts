import { getTask, type Task } from "../../../lib/api";

export async function waitForTask(taskId: string): Promise<Task | null> {
  // Expert-mode breakdown calls qwen-plus with a large token budget, which
  // can take 100-250 s for a full-length script. Backend timeout is 300 s,
  // so poll for up to 330 s (165 x 2000 ms) to stay safely above it.
  for (let i = 0; i < 165; i++) {
    const task = await getTask(taskId);
    if (task.status === "succeeded" || task.status === "failed") return task;
    await new Promise((resolve) => window.setTimeout(resolve, 2000));
  }
  return null;
}
