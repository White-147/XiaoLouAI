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
import type { ControlOwnerScope } from "../control-owner-scope";

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
  resolveCurrentOwnerScope: () => ControlOwnerScope;
  createApiRequestError: (message: string, options?: ApiRequestErrorOptions) => Error;
  hasSessionCredentials: () => boolean;
  isAuthBoundaryError: (error: unknown) => boolean;
};

function playgroundDefaultModel() {
  return WINDOWS_NATIVE_PLAYGROUND_MODELS.find((item) => item.default)?.id || WINDOWS_NATIVE_PLAYGROUND_MODELS[0]?.id || "qwen-plus";
}

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

function buildControlScopeQuery(actorId: string, ownerScope: ControlOwnerScope) {
  const scope = buildControlMediaScope(actorId, ownerScope);
  const params = new URLSearchParams();
  params.set("accountOwnerType", scope.accountOwnerType);
  params.set("accountOwnerId", scope.accountOwnerId);
  return params.toString();
}

export function createPlaygroundService({
  controlApiJsonRequest,
  getCurrentActorId,
  resolveCurrentOwnerScope,
  createApiRequestError,
  hasSessionCredentials,
  isAuthBoundaryError,
}: PlaygroundServiceDeps) {
  const authRequiredError = () =>
    createApiRequestError("请先登录后使用 Playground。", {
      code: "PLAYGROUND_AUTH_REQUIRED",
      status: 401,
    });

  const readWithSignedOutFallback = async <T>(
    request: () => Promise<T>,
    fallback: () => T,
  ): Promise<T> => {
    if (!hasSessionCredentials()) {
      return fallback();
    }

    try {
      return await request();
    } catch (error) {
      if (isAuthBoundaryError(error) && !hasSessionCredentials()) {
        return fallback();
      }

      throw error;
    }
  };

  const listPlaygroundMemories = () => {
    const actorId = getCurrentActorId();
    const ownerScope = resolveCurrentOwnerScope();
    return readWithSignedOutFallback(
      () =>
        controlApiJsonRequest<{ preference: PlaygroundMemoryPreference; items: PlaygroundMemory[] }>(
          `/api/playground/memories?${buildControlScopeQuery(actorId, ownerScope)}`,
        ),
      () => ({ preference: { enabled: true, updatedAt: null }, items: [] }),
    );
  };

  const startPlaygroundChatJob = (input: PlaygroundChatInput) => {
    if (!hasSessionCredentials()) {
      throw authRequiredError();
    }

    const message = input.message.trim();
    if (!message) {
      throw createApiRequestError("Playground message is required", {
        code: "PLAYGROUND_MESSAGE_REQUIRED",
        status: 400,
      });
    }

    const model = input.model?.trim() || playgroundDefaultModel();
    const actorId = getCurrentActorId();
    const ownerScope = resolveCurrentOwnerScope();
    return controlApiJsonRequest<PlaygroundChatJobStartResult>("/api/playground/chat-jobs", {
      method: "POST",
      body: JSON.stringify({
        ...buildControlMediaScope(actorId, ownerScope),
        conversationId: input.conversationId,
        message,
        model,
      }),
    });
  };

  const runPlaygroundChatFacade = async (
    input: PlaygroundChatInput,
    onEvent: (event: PlaygroundChatEvent) => void,
    signal?: AbortSignal,
  ) => {
    if (signal?.aborted) {
      throw createApiRequestError("Playground chat request was aborted", {
        code: "PLAYGROUND_CHAT_ABORTED",
        status: 499,
      });
    }

    // Event facade over chat-job POST plus memory read; real streaming is a separate transport owner.
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
  };

  return {
    async getPlaygroundConfig() {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      const response = await readWithSignedOutFallback(
        () =>
          controlApiJsonRequest<{
            defaultModel: string;
            models?: PlaygroundModel[];
            memory?: PlaygroundMemoryPreference;
          }>(`/api/playground/config?${buildControlScopeQuery(actorId, ownerScope)}`),
        () => ({
          defaultModel: playgroundDefaultModel(),
          models: WINDOWS_NATIVE_PLAYGROUND_MODELS,
          memory: { enabled: true, updatedAt: null },
        }),
      );
      return {
        defaultModel: response.defaultModel || playgroundDefaultModel(),
        models: Array.isArray(response.models) ? response.models : WINDOWS_NATIVE_PLAYGROUND_MODELS,
        memory: response.memory ?? { enabled: true, updatedAt: null },
      };
    },

    async listPlaygroundModels() {
      const response = await readWithSignedOutFallback(
        () =>
          controlApiJsonRequest<{ defaultModel: string; items: PlaygroundModel[] }>(
            "/api/playground/models",
          ),
        () => ({ defaultModel: playgroundDefaultModel(), items: WINDOWS_NATIVE_PLAYGROUND_MODELS }),
      );
      return {
        defaultModel: response.defaultModel || playgroundDefaultModel(),
        items: Array.isArray(response.items) ? response.items : WINDOWS_NATIVE_PLAYGROUND_MODELS,
      };
    },

    listPlaygroundConversations(search?: string) {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      const params = new URLSearchParams(buildControlScopeQuery(actorId, ownerScope));
      const normalizedSearch = search?.trim();
      if (normalizedSearch) params.set("search", normalizedSearch);
      return readWithSignedOutFallback(
        () =>
          controlApiJsonRequest<{ items: PlaygroundConversation[] }>(
            `/api/playground/conversations?${params.toString()}`,
          ),
        () => ({ items: [] }),
      );
    },

    createPlaygroundConversation(input: { title?: string; model?: string } = {}) {
      if (!hasSessionCredentials()) {
        throw authRequiredError();
      }

      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      return controlApiJsonRequest<PlaygroundConversation>("/api/playground/conversations", {
        method: "POST",
        body: JSON.stringify({
          ...buildControlMediaScope(actorId, ownerScope),
          ...input,
        }),
      });
    },

    updatePlaygroundConversation(
      conversationId: string,
      input: Partial<Pick<PlaygroundConversation, "title" | "model">>,
    ) {
      if (!hasSessionCredentials()) {
        throw authRequiredError();
      }

      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      return controlApiJsonRequest<PlaygroundConversation>(
        `/api/playground/conversations/${encodeURIComponent(conversationId)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            ...buildControlMediaScope(actorId, ownerScope),
            ...input,
          }),
        },
      );
    },

    deletePlaygroundConversation(conversationId: string) {
      if (!hasSessionCredentials()) {
        throw authRequiredError();
      }

      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      return controlApiJsonRequest<{ deleted: boolean; conversationId: string }>(
        `/api/playground/conversations/${encodeURIComponent(conversationId)}?${buildControlScopeQuery(actorId, ownerScope)}`,
        { method: "DELETE" },
      );
    },

    getPlaygroundConversation(conversationId: string) {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      return readWithSignedOutFallback(
        () =>
          controlApiJsonRequest<PlaygroundConversation>(
            `/api/playground/conversations/${encodeURIComponent(conversationId)}?${buildControlScopeQuery(actorId, ownerScope)}`,
          ),
        () => {
          throw authRequiredError();
        },
      );
    },

    listPlaygroundMessages(conversationId: string) {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      return readWithSignedOutFallback(
        () =>
          controlApiJsonRequest<{ items: PlaygroundMessage[] }>(
            `/api/playground/conversations/${encodeURIComponent(conversationId)}/messages?${buildControlScopeQuery(actorId, ownerScope)}`,
          ),
        () => ({ items: [] }),
      );
    },

    listPlaygroundChatJobs(options: {
      conversationId?: string;
      activeOnly?: boolean;
      status?: string;
      limit?: number;
    } = {}) {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      const params = new URLSearchParams(buildControlScopeQuery(actorId, ownerScope));
      if (options.conversationId) params.set("conversationId", options.conversationId);
      if (options.activeOnly) params.set("activeOnly", "true");
      if (options.status) params.set("status", options.status);
      if (options.limit) params.set("limit", String(options.limit));
      return readWithSignedOutFallback(
        () =>
          controlApiJsonRequest<{ items: PlaygroundChatJob[] }>(
            `/api/playground/chat-jobs?${params.toString()}`,
          ),
        () => ({ items: [] }),
      );
    },

    getPlaygroundChatJob(jobId: string) {
      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      return readWithSignedOutFallback(
        () =>
          controlApiJsonRequest<{ job: PlaygroundChatJob }>(
            `/api/playground/chat-jobs/${encodeURIComponent(jobId)}?${buildControlScopeQuery(actorId, ownerScope)}`,
          ),
        () => {
          throw authRequiredError();
        },
      );
    },

    startPlaygroundChatJob,

    listPlaygroundMemories,

    updatePlaygroundMemoryPreference(input: Partial<PlaygroundMemoryPreference>) {
      if (!hasSessionCredentials()) {
        throw authRequiredError();
      }

      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      return controlApiJsonRequest<PlaygroundMemoryPreference>("/api/playground/memories/preference", {
        method: "PUT",
        body: JSON.stringify({
          ...buildControlMediaScope(actorId, ownerScope),
          ...input,
        }),
      });
    },

    updatePlaygroundMemory(
      key: string,
      input: Partial<Pick<PlaygroundMemory, "key" | "value" | "enabled">>,
    ) {
      if (!hasSessionCredentials()) {
        throw authRequiredError();
      }

      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      return controlApiJsonRequest<PlaygroundMemory>(`/api/playground/memories/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: JSON.stringify({
          ...buildControlMediaScope(actorId, ownerScope),
          ...input,
        }),
      });
    },

    deletePlaygroundMemory(key: string) {
      if (!hasSessionCredentials()) {
        throw authRequiredError();
      }

      const actorId = getCurrentActorId();
      const ownerScope = resolveCurrentOwnerScope();
      return controlApiJsonRequest<{ deleted: boolean; key: string }>(
        `/api/playground/memories/${encodeURIComponent(key)}?${buildControlScopeQuery(actorId, ownerScope)}`,
        { method: "DELETE" },
      );
    },

    runPlaygroundChatFacade,

    streamPlaygroundChat: runPlaygroundChatFacade,
  };
}
