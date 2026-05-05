import type {
  PlaygroundChatEvent,
  PlaygroundChatInput,
  PlaygroundChatJob,
  PlaygroundChatJobStartResult,
  PlaygroundConversation,
  PlaygroundMemory,
  PlaygroundMemoryPreference,
  PlaygroundMessage,
  PlaygroundModel,
} from "../api";

type ControlApiJsonRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

type ApiRequestErrorOptions = {
  code?: string;
  status?: number;
};

type ControlMediaRequestScope = {
  accountOwnerType: "user";
  accountOwnerId: string;
  regionCode: "CN";
  currency: "CNY";
};

const WINDOWS_NATIVE_PLAYGROUND_MODELS: PlaygroundModel[] = [
  {
    id: "qwen-plus",
    name: "Qwen Plus",
    provider: "canonical-control-api",
    configured: true,
    default: true,
  },
  {
    id: "doubao-pro",
    name: "Doubao Pro",
    provider: "canonical-control-api",
    configured: true,
  },
];

export type PlaygroundServiceDeps = {
  controlApiJsonRequest: ControlApiJsonRequest;
  getCurrentActorId: () => string;
  buildControlScopeQuery: (actorId?: string) => string;
  buildControlMediaScope: (actorId: string) => ControlMediaRequestScope;
  createApiRequestError: (message: string, options?: ApiRequestErrorOptions) => Error;
};

function playgroundDefaultModel() {
  return WINDOWS_NATIVE_PLAYGROUND_MODELS.find((item) => item.default)?.id || WINDOWS_NATIVE_PLAYGROUND_MODELS[0]?.id || "qwen-plus";
}

export function createPlaygroundService({
  controlApiJsonRequest,
  getCurrentActorId,
  buildControlScopeQuery,
  buildControlMediaScope,
  createApiRequestError,
}: PlaygroundServiceDeps) {
  const listPlaygroundMemories = () => {
    return controlApiJsonRequest<{ preference: PlaygroundMemoryPreference; items: PlaygroundMemory[] }>(
      `/api/playground/memories?${buildControlScopeQuery()}`,
    );
  };

  const startPlaygroundChatJob = (input: PlaygroundChatInput) => {
    const message = input.message.trim();
    if (!message) {
      throw createApiRequestError("Playground message is required", {
        code: "PLAYGROUND_MESSAGE_REQUIRED",
        status: 400,
      });
    }

    const model = input.model?.trim() || playgroundDefaultModel();
    const actorId = getCurrentActorId();
    return controlApiJsonRequest<PlaygroundChatJobStartResult>("/api/playground/chat-jobs", {
      method: "POST",
      body: JSON.stringify({
        ...buildControlMediaScope(actorId),
        conversationId: input.conversationId,
        message,
        model,
      }),
    });
  };

  return {
    async getPlaygroundConfig() {
      const response = await controlApiJsonRequest<{
        defaultModel: string;
        models?: PlaygroundModel[];
        memory?: PlaygroundMemoryPreference;
      }>(`/api/playground/config?${buildControlScopeQuery()}`);
      return {
        defaultModel: response.defaultModel || playgroundDefaultModel(),
        models: Array.isArray(response.models) ? response.models : WINDOWS_NATIVE_PLAYGROUND_MODELS,
        memory: response.memory ?? { enabled: true, updatedAt: null },
      };
    },

    async listPlaygroundModels() {
      const response = await controlApiJsonRequest<{ defaultModel: string; items: PlaygroundModel[] }>(
        "/api/playground/models",
      );
      return {
        defaultModel: response.defaultModel || playgroundDefaultModel(),
        items: Array.isArray(response.items) ? response.items : WINDOWS_NATIVE_PLAYGROUND_MODELS,
      };
    },

    listPlaygroundConversations(search?: string) {
      const params = new URLSearchParams(buildControlScopeQuery());
      const normalizedSearch = search?.trim();
      if (normalizedSearch) params.set("search", normalizedSearch);
      return controlApiJsonRequest<{ items: PlaygroundConversation[] }>(
        `/api/playground/conversations?${params.toString()}`,
      );
    },

    createPlaygroundConversation(input: { title?: string; model?: string } = {}) {
      const actorId = getCurrentActorId();
      return controlApiJsonRequest<PlaygroundConversation>("/api/playground/conversations", {
        method: "POST",
        body: JSON.stringify({
          ...buildControlMediaScope(actorId),
          ...input,
        }),
      });
    },

    updatePlaygroundConversation(
      conversationId: string,
      input: Partial<Pick<PlaygroundConversation, "title" | "model">>,
    ) {
      const actorId = getCurrentActorId();
      return controlApiJsonRequest<PlaygroundConversation>(
        `/api/playground/conversations/${encodeURIComponent(conversationId)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            ...buildControlMediaScope(actorId),
            ...input,
          }),
        },
      );
    },

    deletePlaygroundConversation(conversationId: string) {
      return controlApiJsonRequest<{ deleted: boolean; conversationId: string }>(
        `/api/playground/conversations/${encodeURIComponent(conversationId)}?${buildControlScopeQuery()}`,
        { method: "DELETE" },
      );
    },

    getPlaygroundConversation(conversationId: string) {
      return controlApiJsonRequest<PlaygroundConversation>(
        `/api/playground/conversations/${encodeURIComponent(conversationId)}?${buildControlScopeQuery()}`,
      );
    },

    listPlaygroundMessages(conversationId: string) {
      return controlApiJsonRequest<{ items: PlaygroundMessage[] }>(
        `/api/playground/conversations/${encodeURIComponent(conversationId)}/messages?${buildControlScopeQuery()}`,
      );
    },

    listPlaygroundChatJobs(options: {
      conversationId?: string;
      activeOnly?: boolean;
      status?: string;
      limit?: number;
    } = {}) {
      const params = new URLSearchParams(buildControlScopeQuery());
      if (options.conversationId) params.set("conversationId", options.conversationId);
      if (options.activeOnly) params.set("activeOnly", "true");
      if (options.status) params.set("status", options.status);
      if (options.limit) params.set("limit", String(options.limit));
      return controlApiJsonRequest<{ items: PlaygroundChatJob[] }>(
        `/api/playground/chat-jobs?${params.toString()}`,
      );
    },

    getPlaygroundChatJob(jobId: string) {
      return controlApiJsonRequest<{ job: PlaygroundChatJob }>(
        `/api/playground/chat-jobs/${encodeURIComponent(jobId)}?${buildControlScopeQuery()}`,
      );
    },

    startPlaygroundChatJob,

    listPlaygroundMemories,

    updatePlaygroundMemoryPreference(input: Partial<PlaygroundMemoryPreference>) {
      const actorId = getCurrentActorId();
      return controlApiJsonRequest<PlaygroundMemoryPreference>("/api/playground/memories/preference", {
        method: "PUT",
        body: JSON.stringify({
          ...buildControlMediaScope(actorId),
          ...input,
        }),
      });
    },

    updatePlaygroundMemory(
      key: string,
      input: Partial<Pick<PlaygroundMemory, "key" | "value" | "enabled">>,
    ) {
      const actorId = getCurrentActorId();
      return controlApiJsonRequest<PlaygroundMemory>(`/api/playground/memories/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({
          ...buildControlMediaScope(actorId),
          ...input,
        }),
      });
    },

    deletePlaygroundMemory(key: string) {
      return controlApiJsonRequest<{ deleted: boolean; key: string }>(
        `/api/playground/memories/${encodeURIComponent(key)}?${buildControlScopeQuery()}`,
        { method: "DELETE" },
      );
    },

    async streamPlaygroundChat(
      input: PlaygroundChatInput,
      onEvent: (event: PlaygroundChatEvent) => void,
      signal?: AbortSignal,
    ) {
      if (signal?.aborted) {
        throw createApiRequestError("Playground chat request was aborted", {
          code: "PLAYGROUND_CHAT_ABORTED",
          status: 499,
        });
      }
      const result = await startPlaygroundChatJob(input);
      onEvent({ type: "conversation", conversation: result.conversation });
      onEvent({ type: "user_message", message: result.userMessage });
      onEvent({ type: "assistant_message", message: result.assistantMessage });
      onEvent({ type: "job", job: result.job });
      const memories = (await listPlaygroundMemories()).items;
      onEvent({
        type: "done",
        conversation: result.conversation,
        message: result.assistantMessage,
        memories,
        job: result.job,
      });
    },
  };
}
