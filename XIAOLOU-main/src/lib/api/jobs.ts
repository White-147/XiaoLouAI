import type { Task } from "./jobs-types";
import type { ControlOwnerScope } from "../control-owner-scope";

type ControlApiJsonRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

type ControlMediaRequestScope = {
  accountOwnerType: NonNullable<ControlOwnerScope["accountOwnerType"]>;
  accountOwnerId: string;
  regionCode: "CN";
  currency: "CNY";
};

type ControlJobRecord = Record<string, unknown>;

export type CanonicalJobInput = {
  jobType: string;
  domain: string;
  payload?: Record<string, unknown>;
  lane?: "account-control" | "account-media" | "account-finance";
  providerRoute?: string | null;
  idempotencyKey?: string | null;
  inputSummary?: string | null;
  actionCode?: string | null;
};

export type TaskAccepted = {
  taskId: string;
  status: string;
  task: Task;
};

export type JobsServiceDeps = {
  controlApiJsonRequest: ControlApiJsonRequest;
  getCurrentActorId: () => string;
  resolveCurrentOwnerScope: () => ControlOwnerScope;
  createClientId: (prefix: string) => string;
  isNotFoundError: (error: unknown) => boolean;
};

function buildControlMediaScope(
  actorId: string,
  ownerScope: ControlOwnerScope,
): ControlMediaRequestScope {
  return {
    accountOwnerType: ownerScope.accountOwnerType ?? "user",
    accountOwnerId: ownerScope.accountOwnerId ?? actorId,
    regionCode: "CN",
    currency: "CNY",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

function readString(record: Record<string, unknown>, ...keys: string[]) {
  const value = readField(record, ...keys);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function readNumber(record: Record<string, unknown>, ...keys: string[]) {
  const value = readField(record, ...keys);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readRecord(record: Record<string, unknown>, ...keys: string[]) {
  const value = readField(record, ...keys);
  return isRecord(value) ? value : null;
}

function progressForJobStatus(status: string) {
  switch (status) {
    case "succeeded":
      return 100;
    case "failed":
    case "cancelled":
    case "canceled":
      return 100;
    case "running":
      return 60;
    case "leased":
    case "processing":
      return 35;
    case "retry_waiting":
      return 20;
    default:
      return 0;
  }
}

function isCancellableJobTask(task: Pick<Task, "status">) {
  return new Set(["queued", "leased", "running", "retry_waiting", "pending", "processing"]).has(
    String(task.status || "").toLowerCase(),
  );
}

function mergeControlJobMetadata(
  job: ControlJobRecord,
  payload: Record<string, unknown>,
  result: Record<string, unknown>,
) {
  const payloadMetadata = readRecord(payload, "metadata") ?? {};
  const resultMetadata = readRecord(result, "metadata") ?? {};
  return {
    ...payload,
    ...payloadMetadata,
    ...resultMetadata,
    controlJob: {
      accountId: readString(job, "account_id", "accountId"),
      lane: readString(job, "lane"),
      providerRoute: readString(job, "provider_route", "providerRoute"),
      idempotencyKey: readString(job, "idempotency_key", "idempotencyKey"),
      attemptCount: readNumber(job, "attempt_count", "attemptCount"),
      maxAttempts: readNumber(job, "max_attempts", "maxAttempts"),
      leaseOwner: readString(job, "lease_owner", "leaseOwner"),
      leaseUntil: readString(job, "lease_until", "leaseUntil"),
      runAfter: readString(job, "run_after", "runAfter"),
      completedAt: readString(job, "completed_at", "completedAt"),
      cancelledAt: readString(job, "cancelled_at", "cancelledAt"),
      result,
    },
  };
}

function mapControlJobToTask(job: ControlJobRecord): Task {
  const payload = readRecord(job, "payload") ?? {};
  const result = readRecord(job, "result") ?? {};
  const metadata = mergeControlJobMetadata(job, payload, result);
  const status = (readString(job, "status") ?? "queued").toLowerCase();
  const taskType =
    readString(job, "job_type", "jobType") ??
    readString(payload, "type", "jobType", "job_type") ??
    "generic";
  const projectId =
    readString(payload, "projectId", "project_id") ??
    readString(result, "projectId", "project_id");
  const storyboardId =
    readString(payload, "storyboardId", "storyboard_id") ??
    readString(result, "storyboardId", "storyboard_id");
  const lastError = readString(job, "last_error", "lastError");
  const outputSummary =
    readString(result, "outputSummary", "output_summary", "summary", "message") ??
    (status === "failed" || status === "cancelled" ? lastError : null);

  return {
    id: readString(job, "id") ?? "",
    type: taskType,
    domain: readString(payload, "domain") ?? readString(job, "lane") ?? "jobs",
    projectId,
    storyboardId,
    actorId: readString(job, "created_by_user_id", "createdByUserId") ?? undefined,
    actionCode: readString(payload, "actionCode", "action_code") ?? taskType,
    walletId: readString(payload, "walletId", "wallet_id"),
    status,
    progressPercent: readNumber(payload, "progressPercent", "progress_percent") ?? progressForJobStatus(status),
    currentStage: readString(payload, "currentStage", "current_stage") ?? lastError ?? status,
    etaSeconds: readNumber(payload, "etaSeconds", "eta_seconds") ?? 0,
    inputSummary:
      readString(payload, "inputSummary", "input_summary", "prompt", "text") ??
      readString(job, "idempotency_key", "idempotencyKey"),
    outputSummary,
    quotedCredits: readNumber(payload, "quotedCredits", "quoted_credits") ?? undefined,
    frozenCredits: readNumber(payload, "frozenCredits", "frozen_credits") ?? undefined,
    settledCredits: readNumber(payload, "settledCredits", "settled_credits") ?? undefined,
    billingStatus: readString(payload, "billingStatus", "billing_status") ?? undefined,
    metadata,
    createdAt: readString(job, "created_at", "createdAt") ?? new Date().toISOString(),
    updatedAt: readString(job, "updated_at", "updatedAt") ?? new Date().toISOString(),
  };
}

function matchesTaskFilters(task: Task, projectId?: string, type?: string) {
  if (projectId && task.projectId !== projectId && task.metadata?.projectId !== projectId) {
    return false;
  }
  if (type && task.type !== type && task.metadata?.type !== type && task.metadata?.jobType !== type) {
    return false;
  }
  return true;
}

export function createJobsService({
  controlApiJsonRequest,
  getCurrentActorId,
  resolveCurrentOwnerScope,
  createClientId,
  isNotFoundError,
}: JobsServiceDeps) {
  const cancelTask = (taskId: string, reason: string) => {
    return controlApiJsonRequest<ControlJobRecord>(`/api/jobs/${encodeURIComponent(taskId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    });
  };

  const createCanonicalJob = async (input: CanonicalJobInput): Promise<TaskAccepted> => {
    const actorId = getCurrentActorId();
    const scope = buildControlMediaScope(actorId, resolveCurrentOwnerScope());
    const payload = {
      ...(input.payload ?? {}),
      type: input.jobType,
      jobType: input.jobType,
      domain: input.domain,
      actionCode: input.actionCode || input.jobType,
      inputSummary:
        input.inputSummary ||
        readString(input.payload ?? {}, "prompt", "text", "title", "target", "note") ||
        input.jobType,
    };
    const job = await controlApiJsonRequest<ControlJobRecord>("/api/jobs", {
      method: "POST",
      body: JSON.stringify({
        ...scope,
        lane: input.lane || "account-control",
        jobType: input.jobType,
        providerRoute: input.providerRoute || "closed-api",
        idempotencyKey: input.idempotencyKey || `frontend:${actorId}:${input.jobType}:${createClientId("job")}`,
        createdByUserId: actorId,
        payload,
      }),
    });
    const task = mapControlJobToTask(job);
    return { taskId: task.id, status: task.status, task };
  };

  const listTasks = async (projectId?: string, type?: string) => {
    const params = new URLSearchParams();
    const actorId = getCurrentActorId();
    const scope = buildControlMediaScope(actorId, resolveCurrentOwnerScope());
    params.set("accountOwnerType", scope.accountOwnerType);
    params.set("accountOwnerId", scope.accountOwnerId);
    params.set("limit", "200");
    const jobs = await controlApiJsonRequest<ControlJobRecord[]>(`/api/jobs?${params.toString()}`);
    return {
      items: jobs.map(mapControlJobToTask).filter((task) => matchesTaskFilters(task, projectId, type)),
    };
  };

  const getTask = async (taskId: string) => {
    const job = await controlApiJsonRequest<ControlJobRecord>(`/api/jobs/${encodeURIComponent(taskId)}`);
    return mapControlJobToTask(job);
  };

  const dismissTask = async (taskId: string) => {
    let task: Task;
    try {
      task = await getTask(taskId);
    } catch (error) {
      if (isNotFoundError(error)) {
        return { deleted: false, taskId };
      }
      throw error;
    }

    if (isCancellableJobTask(task)) {
      // Dismiss is a public facade; active jobs are cancelled through the stable backend route.
      await cancelTask(taskId, "frontend task dismissed");
    }

    return { deleted: false, taskId };
  };

  const clearTasks = async (projectId?: string, type?: string) => {
    const response = await listTasks(projectId, type);
    const cancellable = response.items.filter(isCancellableJobTask);
    await Promise.all(cancellable.map((task) => cancelTask(task.id, "frontend clear active tasks")));
    return { removedCount: response.items.length };
  };

  return {
    mapControlJobToTask,
    createCanonicalJob,
    listTasks,
    getTask,
    dismissTask,
    deleteTask: dismissTask,
    clearTasks,
  };
}
