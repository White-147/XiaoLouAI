import type { ControlOwnerScope } from "../../../lib/control-owner-scope";
import type { Task } from "../../../lib/api/jobs-types";
import type {
  QwenOmniModel,
  StoryboardGrid25Reference,
  ToolboxCapability,
  ToolboxCapabilityRunType,
} from "./toolbox-types";

type ControlApiJsonRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

type ApiRequestErrorOptions = {
  code?: string;
  status?: number;
};

type ControlMediaRequestScope = {
  accountOwnerType: NonNullable<ControlOwnerScope["accountOwnerType"]>;
  accountOwnerId: string;
  regionCode: "CN";
  currency: "CNY";
};

type ControlJobRecord = Record<string, unknown>;

type TaskAccepted = {
  taskId: string;
  status: string;
  task: Task;
};

type ToolboxRunResponse = Record<string, unknown> & {
  taskId?: string;
  status?: string;
  job?: ControlJobRecord;
};

export type ToolboxServiceDeps = {
  controlApiJsonRequest: ControlApiJsonRequest;
  getCurrentActorId: () => string;
  resolveCurrentOwnerScope: () => ControlOwnerScope;
  createClientId: (prefix: string) => string;
  createApiRequestError: (message: string, options?: ApiRequestErrorOptions) => Error;
  readString: (record: Record<string, unknown>, ...keys: string[]) => string | null;
  readRecord: (record: Record<string, unknown>, ...keys: string[]) => Record<string, unknown> | null;
  mapControlJobToTask: (job: ControlJobRecord) => Task;
  getFallbackToolboxCapabilities: () => ToolboxCapability[];
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

export function createToolboxService({
  controlApiJsonRequest,
  getCurrentActorId,
  resolveCurrentOwnerScope,
  createClientId,
  createApiRequestError,
  readString,
  readRecord,
  mapControlJobToTask,
  getFallbackToolboxCapabilities,
}: ToolboxServiceDeps) {
  const createToolboxRun = async (
    path: string,
    input: Record<string, unknown>,
  ): Promise<ToolboxRunResponse> => {
    const actorId = getCurrentActorId();
    const ownerScope = resolveCurrentOwnerScope();
    return controlApiJsonRequest<ToolboxRunResponse>(path, {
      method: "POST",
      body: JSON.stringify({
        ...buildControlMediaScope(actorId, ownerScope),
        ...input,
      }),
    });
  };

  const taskAcceptedFromToolboxRun = (response: ToolboxRunResponse): TaskAccepted => {
    const job = readRecord(response, "job") as ControlJobRecord | null;
    if (!job) {
      throw createApiRequestError("Toolbox Control API did not return a canonical job", {
        code: "TOOLBOX_JOB_MISSING",
        status: 502,
      });
    }

    const task = mapControlJobToTask(job);
    return {
      taskId: readString(response, "taskId") || task.id,
      status: readString(response, "status") || task.status,
      task,
    };
  };

  return {
    async getToolboxCapabilities() {
      const response = await controlApiJsonRequest<{
        items?: ToolboxCapability[];
        stagingArea?: string[];
      }>("/api/toolbox/capabilities");
      return {
        items: Array.isArray(response.items) ? response.items : getFallbackToolboxCapabilities(),
        stagingArea: Array.isArray(response.stagingArea) ? response.stagingArea : [],
      };
    },

    getCapabilities() {
      return controlApiJsonRequest<{
        service: string;
        mode: string;
        implementedDomains: string[];
        toolbox: ToolboxCapability[];
      }>("/api/capabilities");
    },

    async translateText(text: string, targetLang: "en" | "zh") {
      const actorId = getCurrentActorId();
      const response = await createToolboxRun("/api/toolbox/translate-text", {
        text,
        targetLang,
        idempotencyKey: `frontend:${actorId}:translate-text:${createClientId("toolbox")}`,
      });
      return {
        text: readString(response, "text") || text,
        targetLang: (readString(response, "targetLang", "target_lang") as "en" | "zh" | null) || targetLang,
        taskId: readString(response, "taskId"),
      };
    },

    async generateStoryboardGrid25(
      plotText: string,
      options?: {
        references?: StoryboardGrid25Reference[];
        model?: string;
      },
    ) {
      const actorId = getCurrentActorId();
      const response = await createToolboxRun("/api/toolbox/storyboard-grid25", {
        plotText,
        references: options?.references,
        model: options?.model,
        idempotencyKey: `frontend:${actorId}:storyboard-grid25:${createClientId("toolbox")}`,
      });
      return {
        imageUrl: readString(response, "imageUrl", "image_url") || "",
        model: readString(response, "model") || options?.model || "canonical-job",
        taskId: readString(response, "taskId") || "",
      };
    },

    async reverseVideoPrompt(
      videoUrl: string,
      options?: { prompt?: string; model?: QwenOmniModel },
    ) {
      const actorId = getCurrentActorId();
      const response = await createToolboxRun("/api/toolbox/video-reverse-prompt", {
        videoUrl,
        ...(options ?? {}),
        idempotencyKey: `frontend:${actorId}:video-reverse-prompt:${createClientId("toolbox")}`,
      });
      return {
        prompt:
          readString(response, "prompt") ||
          options?.prompt ||
          `Reverse prompt job queued: ${readString(response, "taskId") || ""}`,
        model: readString(response, "model") || options?.model || "canonical-job",
        taskId: readString(response, "taskId"),
      };
    },

    async runToolboxCapability(
      type: ToolboxCapabilityRunType,
      input: { projectId?: string; note?: string; target?: string; storyboardId?: string },
    ) {
      const routes: Record<ToolboxCapabilityRunType, string> = {
        character_replace: "/api/toolbox/character-replace",
        motion_transfer: "/api/toolbox/motion-transfer",
        upscale_restore: "/api/toolbox/upscale-restore",
      };
      const actorId = getCurrentActorId();
      const response = await createToolboxRun(routes[type], {
        ...input,
        idempotencyKey: `frontend:${actorId}:${type}:${createClientId("toolbox")}`,
      });
      return taskAcceptedFromToolboxRun(response);
    },
  };
}
