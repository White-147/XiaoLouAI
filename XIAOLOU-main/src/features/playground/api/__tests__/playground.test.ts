import { afterEach, describe, expect, it, vi } from "vitest";
import type { ControlOwnerScope } from "../../../../lib/control-owner-scope";
import { createPlaygroundService } from "../playground";
import {
  parseJsonBody,
  SYNTHETIC_ACTOR_ID,
  SYNTHETIC_CREATED_AT,
  SYNTHETIC_UPDATED_AT,
  type RequestCall,
  type RequestHandler,
} from "../../../../lib/api/__tests__/synthetic-fixtures";

type PlaygroundServiceDeps = Parameters<typeof createPlaygroundService>[0];
type StreamHandler = (path: string, init?: RequestInit) => Promise<Response> | Response;

function createSyntheticOwnerScope(
  overrides: Partial<ControlOwnerScope> = {},
): ControlOwnerScope {
  return {
    accountOwnerType: "user",
    accountOwnerId: SYNTHETIC_ACTOR_ID,
    organizationId: null,
    organizationRole: null,
    source: "personal-default",
    ...overrides,
  };
}

function createSyntheticOrganizationOwnerScope(
  organizationId = "synthetic-org/one",
): ControlOwnerScope {
  return createSyntheticOwnerScope({
    accountOwnerType: "organization",
    accountOwnerId: organizationId,
    organizationId,
    organizationRole: "enterprise_admin",
    source: "current-organization",
  });
}

function createSyntheticConversation(overrides: Record<string, unknown> = {}) {
  return {
    id: "synthetic-conversation",
    actorId: SYNTHETIC_ACTOR_ID,
    title: "Synthetic conversation",
    model: "qwen-plus",
    createdAt: SYNTHETIC_CREATED_AT,
    updatedAt: SYNTHETIC_UPDATED_AT,
    ...overrides,
  };
}

function createSyntheticMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "synthetic-message",
    conversationId: "synthetic-conversation",
    actorId: SYNTHETIC_ACTOR_ID,
    role: "assistant",
    content: "Synthetic answer",
    createdAt: "2026-05-05T00:02:00.000Z",
    metadata: {},
    ...overrides,
  };
}

function createSyntheticChatJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "synthetic-chat-job",
    actorId: "synthetic-actor",
    conversationId: "synthetic-conversation",
    userMessageId: "synthetic-user-message",
    assistantMessageId: "synthetic-assistant-message",
    status: "queued",
    model: "qwen-plus",
    prompt: "Synthetic prompt",
    error: null,
    startedAt: null,
    completedAt: null,
    createdAt: "2026-05-05T00:03:00.000Z",
    updatedAt: "2026-05-05T00:03:30.000Z",
    ...overrides,
  };
}

function createSyntheticSseEvent(type: string, data: Record<string, unknown>) {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
}

function createSyntheticSseResponse(chunks: string[], status = 200) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/event-stream",
    },
  });
}

function createServiceHarness({
  actorId = SYNTHETIC_ACTOR_ID,
  ownerScope,
  handler = () => ({ synthetic: true }),
  streamHandler = () => createSyntheticSseResponse([]),
  hasSessionCredentials = () => true,
  isAuthBoundaryError = () => false,
}: {
  actorId?: string;
  ownerScope?: ControlOwnerScope;
  handler?: RequestHandler;
  streamHandler?: StreamHandler;
  hasSessionCredentials?: () => boolean;
  isAuthBoundaryError?: (error: unknown) => boolean;
} = {}) {
  const calls: RequestCall[] = [];
  const streamCalls: RequestCall[] = [];
  const errors: Array<{ message: string; options?: { code?: string; status?: number } }> = [];
  const ownerScopeCalls: ControlOwnerScope[] = [];
  const resolvedOwnerScope =
    ownerScope ?? createSyntheticOwnerScope({ accountOwnerId: actorId });

  const deps: PlaygroundServiceDeps = {
    controlApiJsonRequest: async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      return (await handler(path, init)) as T;
    },
    controlApiStreamRequest: async (path: string, init?: RequestInit): Promise<Response> => {
      streamCalls.push({ path, init });
      return streamHandler(path, init);
    },
    getCurrentActorId: () => actorId,
    resolveCurrentOwnerScope: () => {
      ownerScopeCalls.push(resolvedOwnerScope);
      return resolvedOwnerScope;
    },
    createApiRequestError: (message, options) => {
      errors.push({ message, options });
      const error = new Error(`${options?.code ?? "PLAYGROUND_ERROR"}:${message}`);
      return error;
    },
    hasSessionCredentials,
    isAuthBoundaryError,
  };

  return {
    calls,
    streamCalls,
    errors,
    ownerScopeCalls,
    service: createPlaygroundService(deps),
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createPlaygroundService", () => {
  it("uses signed-out read fallbacks without calling protected routes", async () => {
    const { calls, errors, service } = createServiceHarness({
      hasSessionCredentials: () => false,
      handler: () => {
        throw new Error("signed-out reads should not call the Control API");
      },
    });

    await expect(service.getPlaygroundConfig()).resolves.toMatchObject({
      defaultModel: "qwen-plus",
      memory: {
        enabled: true,
        updatedAt: null,
      },
      models: [
        {
          id: "qwen-plus",
          default: true,
        },
        {
          id: "doubao-pro",
        },
      ],
    });
    await expect(service.listPlaygroundModels()).resolves.toMatchObject({
      defaultModel: "qwen-plus",
      items: [
        {
          id: "qwen-plus",
          default: true,
        },
        {
          id: "doubao-pro",
        },
      ],
    });
    await expect(service.listPlaygroundConversations()).resolves.toEqual({ items: [] });
    await expect(service.listPlaygroundMemories()).resolves.toEqual({
      preference: {
        enabled: true,
        updatedAt: null,
      },
      items: [],
    });
    await expect(service.listPlaygroundChatJobs({ activeOnly: true })).resolves.toEqual({ items: [] });
    expect(() => service.startPlaygroundChatJob({ message: "Synthetic prompt" })).toThrow(
      "PLAYGROUND_AUTH_REQUIRED:请先登录后使用 Playground。",
    );

    expect(calls).toEqual([]);
    expect(errors).toEqual([
      {
        message: "请先登录后使用 Playground。",
        options: {
          code: "PLAYGROUND_AUTH_REQUIRED",
          status: 401,
        },
      },
    ]);
  });

  it("normalizes config and model fallbacks through stable read routes", async () => {
    const { calls, ownerScopeCalls, service } = createServiceHarness({
      handler: (path) => {
        if (path.startsWith("/api/playground/config")) {
          return {
            defaultModel: "",
            models: "synthetic-invalid-models",
          };
        }

        return {
          defaultModel: "",
          items: null,
        };
      },
    });

    await expect(service.getPlaygroundConfig()).resolves.toMatchObject({
      defaultModel: "qwen-plus",
      memory: {
        enabled: true,
        updatedAt: null,
      },
      models: [
        {
          id: "qwen-plus",
          default: true,
        },
        {
          id: "doubao-pro",
        },
      ],
    });
    await expect(service.listPlaygroundModels()).resolves.toMatchObject({
      defaultModel: "qwen-plus",
      items: [
        {
          id: "qwen-plus",
          default: true,
        },
        {
          id: "doubao-pro",
        },
      ],
    });

    expect(calls).toEqual([
      {
        path: "/api/playground/config?accountOwnerType=user&accountOwnerId=synthetic-actor",
        init: undefined,
      },
      {
        path: "/api/playground/models",
        init: undefined,
      },
    ]);
    expect(ownerScopeCalls).toHaveLength(1);
  });

  it("uses scoped and encoded conversation routes with stable request bodies", async () => {
    const { calls, ownerScopeCalls, service } = createServiceHarness({
      handler: () => createSyntheticConversation(),
    });

    await expect(service.listPlaygroundConversations("  synthetic search  ")).resolves.toEqual(
      createSyntheticConversation(),
    );
    await expect(
      service.createPlaygroundConversation({
        title: "Synthetic conversation",
        model: "qwen-plus",
      }),
    ).resolves.toEqual(createSyntheticConversation());
    await expect(
      service.updatePlaygroundConversation("synthetic conversation/1", {
        title: "Synthetic updated conversation",
      }),
    ).resolves.toEqual(createSyntheticConversation());
    await expect(service.getPlaygroundConversation("synthetic conversation/1")).resolves.toEqual(
      createSyntheticConversation(),
    );
    await expect(service.deletePlaygroundConversation("synthetic conversation/1")).resolves.toEqual(
      createSyntheticConversation(),
    );

    expect(calls[0]).toEqual({
      path: "/api/playground/conversations?accountOwnerType=user&accountOwnerId=synthetic-actor&search=synthetic+search",
      init: undefined,
    });
    expect(calls[1].path).toBe("/api/playground/conversations");
    expect(calls[1].init?.method).toBe("POST");
    expect(parseJsonBody(calls[1])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-actor",
      regionCode: "CN",
      currency: "CNY",
      title: "Synthetic conversation",
      model: "qwen-plus",
    });
    expect(calls[2].path).toBe("/api/playground/conversations/synthetic%20conversation%2F1");
    expect(calls[2].init?.method).toBe("PUT");
    expect(parseJsonBody(calls[2])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-actor",
      regionCode: "CN",
      currency: "CNY",
      title: "Synthetic updated conversation",
    });
    expect(calls[3]).toEqual({
      path: "/api/playground/conversations/synthetic%20conversation%2F1?accountOwnerType=user&accountOwnerId=synthetic-actor",
      init: undefined,
    });
    expect(calls[4]).toEqual({
      path: "/api/playground/conversations/synthetic%20conversation%2F1?accountOwnerType=user&accountOwnerId=synthetic-actor",
      init: {
        method: "DELETE",
      },
    });
    expect(ownerScopeCalls).toHaveLength(5);
  });

  it("mirrors organization owner scope into conversation read, delete, and write requests", async () => {
    const organizationScope = createSyntheticOrganizationOwnerScope();
    const { calls, service } = createServiceHarness({
      actorId: "synthetic-org-actor",
      ownerScope: organizationScope,
      handler: () => createSyntheticConversation({ actorId: "synthetic-org-actor" }),
    });

    await service.listPlaygroundConversations("  synthetic org search  ");
    await service.createPlaygroundConversation({
      title: "Synthetic organization conversation",
      model: "qwen-plus",
    });
    await service.updatePlaygroundConversation("synthetic conversation/1", {
      title: "Synthetic organization update",
    });
    await service.getPlaygroundConversation("synthetic conversation/1");
    await service.deletePlaygroundConversation("synthetic conversation/1");

    expect(calls[0]).toEqual({
      path: "/api/playground/conversations?accountOwnerType=organization&accountOwnerId=synthetic-org%2Fone&search=synthetic+org+search",
      init: undefined,
    });
    expect(calls[1].path).toBe("/api/playground/conversations");
    expect(calls[1].init?.method).toBe("POST");
    expect(parseJsonBody(calls[1])).toEqual({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-org/one",
      regionCode: "CN",
      currency: "CNY",
      title: "Synthetic organization conversation",
      model: "qwen-plus",
    });
    expect(calls[2].path).toBe("/api/playground/conversations/synthetic%20conversation%2F1");
    expect(calls[2].init?.method).toBe("PUT");
    expect(parseJsonBody(calls[2])).toEqual({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-org/one",
      regionCode: "CN",
      currency: "CNY",
      title: "Synthetic organization update",
    });
    expect(calls[3]).toEqual({
      path: "/api/playground/conversations/synthetic%20conversation%2F1?accountOwnerType=organization&accountOwnerId=synthetic-org%2Fone",
      init: undefined,
    });
    expect(calls[4]).toEqual({
      path: "/api/playground/conversations/synthetic%20conversation%2F1?accountOwnerType=organization&accountOwnerId=synthetic-org%2Fone",
      init: {
        method: "DELETE",
      },
    });
  });

  it("uses scoped message and chat-job routes without polling or stream transport", async () => {
    const startResult = {
      job: createSyntheticChatJob(),
      conversation: createSyntheticConversation(),
      userMessage: createSyntheticMessage({
        id: "synthetic-user-message",
        role: "user",
        content: "Synthetic prompt",
      }),
      assistantMessage: createSyntheticMessage({
        id: "synthetic-assistant-message",
      }),
    };
    const { calls, errors, ownerScopeCalls, service } = createServiceHarness({
      handler: (path) => {
        if (path === "/api/playground/chat-jobs") {
          return startResult;
        }
        if (path.startsWith("/api/playground/conversations/")) {
          return {
            items: [createSyntheticMessage()],
          };
        }
        if (path.startsWith("/api/playground/chat-jobs/")) {
          return {
            job: createSyntheticChatJob({
              id: "synthetic job/1",
            }),
          };
        }

        return {
          items: [createSyntheticChatJob()],
        };
      },
    });

    await expect(service.listPlaygroundMessages("synthetic conversation/1")).resolves.toEqual({
      items: [createSyntheticMessage()],
    });
    await expect(
      service.listPlaygroundChatJobs({
        conversationId: "synthetic conversation/1",
        activeOnly: true,
        status: "running",
        limit: 25,
      }),
    ).resolves.toEqual({
      items: [createSyntheticChatJob()],
    });
    await expect(service.getPlaygroundChatJob("synthetic job/1")).resolves.toEqual({
      job: createSyntheticChatJob({
        id: "synthetic job/1",
      }),
    });
    await expect(
      service.startPlaygroundChatJob({
        conversationId: "synthetic conversation/1",
        message: "  Synthetic prompt  ",
        model: "  ",
      }),
    ).resolves.toBe(startResult);
    expect(() => service.startPlaygroundChatJob({ message: "   " })).toThrow(
      "PLAYGROUND_MESSAGE_REQUIRED:Playground message is required",
    );

    expect(calls[0]).toEqual({
      path: "/api/playground/conversations/synthetic%20conversation%2F1/messages?accountOwnerType=user&accountOwnerId=synthetic-actor",
      init: undefined,
    });
    expect(calls[1]).toEqual({
      path: "/api/playground/chat-jobs?accountOwnerType=user&accountOwnerId=synthetic-actor&conversationId=synthetic+conversation%2F1&activeOnly=true&status=running&limit=25",
      init: undefined,
    });
    expect(calls[2]).toEqual({
      path: "/api/playground/chat-jobs/synthetic%20job%2F1?accountOwnerType=user&accountOwnerId=synthetic-actor",
      init: undefined,
    });
    expect(calls[3].path).toBe("/api/playground/chat-jobs");
    expect(calls[3].init?.method).toBe("POST");
    expect(parseJsonBody(calls[3])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-actor",
      regionCode: "CN",
      currency: "CNY",
      conversationId: "synthetic conversation/1",
      message: "Synthetic prompt",
      model: "qwen-plus",
    });
    expect(calls).toHaveLength(4);
    expect(ownerScopeCalls).toHaveLength(4);
    expect(errors).toEqual([
      {
        message: "Playground message is required",
        options: {
          code: "PLAYGROUND_MESSAGE_REQUIRED",
          status: 400,
        },
      },
    ]);
  });

  it("mirrors organization owner scope into message and chat-job read/write requests", async () => {
    const organizationScope = createSyntheticOrganizationOwnerScope();
    const startResult = {
      job: createSyntheticChatJob({ actorId: "synthetic-org-actor" }),
      conversation: createSyntheticConversation({ actorId: "synthetic-org-actor" }),
      userMessage: createSyntheticMessage({
        id: "synthetic-user-message",
        actorId: "synthetic-org-actor",
        role: "user",
        content: "Synthetic organization prompt",
      }),
      assistantMessage: createSyntheticMessage({
        id: "synthetic-assistant-message",
        actorId: "synthetic-org-actor",
      }),
    };
    const { calls, service } = createServiceHarness({
      actorId: "synthetic-org-actor",
      ownerScope: organizationScope,
      handler: (path) => {
        if (path === "/api/playground/chat-jobs") {
          return startResult;
        }
        if (path.startsWith("/api/playground/conversations/")) {
          return {
            items: [createSyntheticMessage({ actorId: "synthetic-org-actor" })],
          };
        }
        if (path.startsWith("/api/playground/chat-jobs/")) {
          return {
            job: createSyntheticChatJob({
              id: "synthetic job/1",
              actorId: "synthetic-org-actor",
            }),
          };
        }

        return {
          items: [createSyntheticChatJob({ actorId: "synthetic-org-actor" })],
        };
      },
    });

    await service.listPlaygroundMessages("synthetic conversation/1");
    await service.listPlaygroundChatJobs({
      conversationId: "synthetic conversation/1",
      activeOnly: true,
      status: "running",
      limit: 25,
    });
    await service.getPlaygroundChatJob("synthetic job/1");
    await service.startPlaygroundChatJob({
      conversationId: "synthetic conversation/1",
      message: "  Synthetic organization prompt  ",
      model: "qwen-plus",
    });

    expect(calls[0]).toEqual({
      path: "/api/playground/conversations/synthetic%20conversation%2F1/messages?accountOwnerType=organization&accountOwnerId=synthetic-org%2Fone",
      init: undefined,
    });
    expect(calls[1]).toEqual({
      path: "/api/playground/chat-jobs?accountOwnerType=organization&accountOwnerId=synthetic-org%2Fone&conversationId=synthetic+conversation%2F1&activeOnly=true&status=running&limit=25",
      init: undefined,
    });
    expect(calls[2]).toEqual({
      path: "/api/playground/chat-jobs/synthetic%20job%2F1?accountOwnerType=organization&accountOwnerId=synthetic-org%2Fone",
      init: undefined,
    });
    expect(calls[3].path).toBe("/api/playground/chat-jobs");
    expect(calls[3].init?.method).toBe("POST");
    expect(parseJsonBody(calls[3])).toEqual({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-org/one",
      regionCode: "CN",
      currency: "CNY",
      conversationId: "synthetic conversation/1",
      message: "Synthetic organization prompt",
      model: "qwen-plus",
    });
  });

  it("keeps active chat-job list calls polling-adjacent without scheduling timers", async () => {
    vi.useFakeTimers();
    const activeJob = createSyntheticChatJob({
      id: "synthetic-active-chat-job",
      status: "running",
    });
    const { calls, service } = createServiceHarness({
      handler: () => ({
        items: [activeJob],
      }),
    });

    await expect(service.listPlaygroundChatJobs({ activeOnly: true, limit: 100 })).resolves.toEqual({
      items: [activeJob],
    });

    expect(calls).toEqual([
      {
        path: "/api/playground/chat-jobs?accountOwnerType=user&accountOwnerId=synthetic-actor&activeOnly=true&limit=100",
        init: undefined,
      },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("emits runPlaygroundChatFacade non-stream facade events in deterministic order", async () => {
    vi.useFakeTimers();
    const startResult = {
      job: createSyntheticChatJob({
        id: "synthetic-stream-chat-job",
        status: "succeeded",
      }),
      conversation: createSyntheticConversation({
        id: "synthetic-stream-conversation",
      }),
      userMessage: createSyntheticMessage({
        id: "synthetic-stream-user-message",
        role: "user",
        content: "Synthetic streaming prompt",
      }),
      assistantMessage: createSyntheticMessage({
        id: "synthetic-stream-assistant-message",
        content: "Synthetic streaming answer",
      }),
    };
    const memory = {
      key: "synthetic-memory",
      value: "Synthetic memory",
      enabled: true,
      confidence: 1,
      updatedAt: "2026-05-05T00:04:00.000Z",
      source: "synthetic",
    };
    const events: Array<{ type: string; [key: string]: unknown }> = [];
    const { calls, service } = createServiceHarness({
      handler: (path) => {
        if (path === "/api/playground/chat-jobs") {
          return startResult;
        }

        return {
          preference: {
            enabled: true,
            updatedAt: null,
          },
          items: [memory],
        };
      },
    });

    await expect(
      service.runPlaygroundChatFacade(
        {
          conversationId: "synthetic-stream-conversation",
          message: "  Synthetic streaming prompt  ",
          model: "qwen-plus",
        },
        (event) => {
          events.push(event);
        },
      ),
    ).resolves.toBeUndefined();

    expect(events.map((event) => event.type)).toEqual([
      "conversation",
      "user_message",
      "assistant_message",
      "job",
      "done",
    ]);
    expect(events[4]).toMatchObject({
      type: "done",
      conversation: startResult.conversation,
      message: startResult.assistantMessage,
      memories: [memory],
      job: startResult.job,
    });
    expect(calls[0].path).toBe("/api/playground/chat-jobs");
    expect(calls[0].init?.method).toBe("POST");
    expect(parseJsonBody(calls[0])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-actor",
      regionCode: "CN",
      currency: "CNY",
      conversationId: "synthetic-stream-conversation",
      message: "Synthetic streaming prompt",
      model: "qwen-plus",
    });
    expect(calls[1]).toEqual({
      path: "/api/playground/memories?accountOwnerType=user&accountOwnerId=synthetic-actor",
      init: undefined,
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("streams Playground chat events over the real transport endpoint", async () => {
    vi.useFakeTimers();
    const startResult = {
      job: createSyntheticChatJob({
        id: "synthetic-stream-chat-job",
        status: "queued",
      }),
      conversation: createSyntheticConversation({
        id: "synthetic-stream-conversation",
      }),
      userMessage: createSyntheticMessage({
        id: "synthetic-stream-user-message",
        role: "user",
        content: "Synthetic streaming prompt",
      }),
      assistantMessage: createSyntheticMessage({
        id: "synthetic-stream-assistant-message",
        content: "Synthetic streaming answer",
      }),
    };
    const memory = {
      key: "synthetic-memory",
      value: "Synthetic memory",
      enabled: true,
      confidence: 1,
      updatedAt: "2026-05-05T00:04:00.000Z",
      source: "synthetic",
    };
    const streamPayload = [
      createSyntheticSseEvent("conversation", { conversation: startResult.conversation }),
      createSyntheticSseEvent("user_message", { message: startResult.userMessage }),
      createSyntheticSseEvent("assistant_message", { message: startResult.assistantMessage }),
      createSyntheticSseEvent("job", { job: startResult.job }),
      createSyntheticSseEvent("done", {
        conversation: startResult.conversation,
        message: startResult.assistantMessage,
        memories: [memory],
        job: startResult.job,
      }),
    ].join("");
    const events: Array<{ type: string; [key: string]: unknown }> = [];
    const { calls, streamCalls, ownerScopeCalls, service } = createServiceHarness({
      handler: () => {
        throw new Error("streamPlaygroundChat should not use JSON chat-job requests");
      },
      streamHandler: () =>
        createSyntheticSseResponse([
          streamPayload.slice(0, 115),
          streamPayload.slice(115),
        ]),
    });

    await expect(
      service.streamPlaygroundChat(
        {
          conversationId: "synthetic-stream-conversation",
          message: "  Synthetic streaming prompt  ",
          model: "qwen-plus",
        },
        (event) => {
          events.push(event);
        },
      ),
    ).resolves.toBeUndefined();

    expect(events.map((event) => event.type)).toEqual([
      "conversation",
      "user_message",
      "assistant_message",
      "job",
      "done",
    ]);
    expect(events[4]).toMatchObject({
      type: "done",
      conversation: startResult.conversation,
      message: startResult.assistantMessage,
      memories: [memory],
      job: startResult.job,
    });
    expect(calls).toEqual([]);
    expect(streamCalls).toHaveLength(1);
    expect(streamCalls[0].path).toBe("/api/playground/chat");
    expect(streamCalls[0].init?.method).toBe("POST");
    expect(parseJsonBody(streamCalls[0])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-actor",
      regionCode: "CN",
      currency: "CNY",
      conversationId: "synthetic-stream-conversation",
      message: "Synthetic streaming prompt",
      model: "qwen-plus",
    });
    expect(ownerScopeCalls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("mirrors organization owner scope into stream request bodies", async () => {
    const organizationScope = createSyntheticOrganizationOwnerScope();
    const { streamCalls, service } = createServiceHarness({
      actorId: "synthetic-org-actor",
      ownerScope: organizationScope,
      streamHandler: () => createSyntheticSseResponse([]),
    });

    await service.streamPlaygroundChat(
      {
        conversationId: "synthetic conversation/1",
        message: "  Synthetic organization prompt  ",
        model: "doubao-pro",
      },
      () => undefined,
    );

    expect(streamCalls).toHaveLength(1);
    expect(streamCalls[0].path).toBe("/api/playground/chat");
    expect(streamCalls[0].init?.method).toBe("POST");
    expect(parseJsonBody(streamCalls[0])).toEqual({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-org/one",
      regionCode: "CN",
      currency: "CNY",
      conversationId: "synthetic conversation/1",
      message: "Synthetic organization prompt",
      model: "doubao-pro",
    });
  });

  it("maps stream HTTP errors through stable ApiRequestError options", async () => {
    const { errors, service } = createServiceHarness({
      streamHandler: () =>
        new Response(JSON.stringify({ error: "synthetic stream denied" }), {
          status: 403,
          headers: {
            "Content-Type": "application/json",
          },
        }),
    });

    await expect(
      service.streamPlaygroundChat(
        {
          message: "Synthetic prompt",
        },
        () => undefined,
      ),
    ).rejects.toThrow("PLAYGROUND_ERROR:synthetic stream denied");

    expect(errors).toContainEqual({
      message: "synthetic stream denied",
      options: {
        code: undefined,
        status: 403,
      },
    });
  });

  it("rejects pre-aborted streamPlaygroundChat before requests or timers are started", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    const events: Array<{ type: string }> = [];
    const { calls, streamCalls, errors, service } = createServiceHarness({
      handler: () => {
        throw new Error("streamPlaygroundChat should not request after a pre-aborted signal");
      },
      streamHandler: () => {
        throw new Error("streamPlaygroundChat should not stream after a pre-aborted signal");
      },
    });

    await expect(
      service.streamPlaygroundChat(
        {
          message: "Synthetic prompt",
        },
        (event) => {
          events.push(event);
        },
        controller.signal,
      ),
    ).rejects.toThrow("PLAYGROUND_CHAT_ABORTED:Playground chat request was aborted");

    expect(events).toEqual([]);
    expect(calls).toEqual([]);
    expect(streamCalls).toEqual([]);
    expect(errors).toEqual([
      {
        message: "Playground chat request was aborted",
        options: {
          code: "PLAYGROUND_CHAT_ABORTED",
          status: 499,
        },
      },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses scoped memory routes and stable preference/update bodies", async () => {
    const { calls, ownerScopeCalls, service } = createServiceHarness({
      handler: (path) => {
        if (path.includes("/preference")) {
          return {
            enabled: false,
            updatedAt: "2026-05-05T00:04:00.000Z",
          };
        }
        if (path.includes("/synthetic%20memory%2Fkey")) {
          return {
            key: "synthetic memory/key",
            value: "Synthetic memory",
            enabled: false,
            confidence: 0.8,
            updatedAt: "2026-05-05T00:05:00.000Z",
            source: "synthetic",
          };
        }

        return {
          preference: {
            enabled: true,
            updatedAt: null,
          },
          items: [],
        };
      },
    });

    await expect(service.listPlaygroundMemories()).resolves.toEqual({
      preference: {
        enabled: true,
        updatedAt: null,
      },
      items: [],
    });
    await expect(service.updatePlaygroundMemoryPreference({ enabled: false })).resolves.toEqual({
      enabled: false,
      updatedAt: "2026-05-05T00:04:00.000Z",
    });
    await expect(
      service.updatePlaygroundMemory("synthetic memory/key", {
        value: "Synthetic memory",
        enabled: false,
      }),
    ).resolves.toEqual({
      key: "synthetic memory/key",
      value: "Synthetic memory",
      enabled: false,
      confidence: 0.8,
      updatedAt: "2026-05-05T00:05:00.000Z",
      source: "synthetic",
    });
    await expect(service.deletePlaygroundMemory("synthetic memory/key")).resolves.toEqual({
      key: "synthetic memory/key",
      value: "Synthetic memory",
      enabled: false,
      confidence: 0.8,
      updatedAt: "2026-05-05T00:05:00.000Z",
      source: "synthetic",
    });

    expect(calls[0]).toEqual({
      path: "/api/playground/memories?accountOwnerType=user&accountOwnerId=synthetic-actor",
      init: undefined,
    });
    expect(calls[1].path).toBe("/api/playground/memories/preference");
    expect(calls[1].init?.method).toBe("PUT");
    expect(parseJsonBody(calls[1])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-actor",
      regionCode: "CN",
      currency: "CNY",
      enabled: false,
    });
    expect(calls[2].path).toBe("/api/playground/memories/synthetic%20memory%2Fkey");
    expect(calls[2].init?.method).toBe("PUT");
    expect(parseJsonBody(calls[2])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-actor",
      regionCode: "CN",
      currency: "CNY",
      value: "Synthetic memory",
      enabled: false,
    });
    expect(calls[3]).toEqual({
      path: "/api/playground/memories/synthetic%20memory%2Fkey?accountOwnerType=user&accountOwnerId=synthetic-actor",
      init: {
        method: "DELETE",
      },
    });
    expect(ownerScopeCalls).toHaveLength(4);
  });

  it("uses scoped .NET memory contract routes for filters, create, vector index, rebuild, and recall", async () => {
    const memory = {
      key: "food.preference",
      value: "Likes sushi",
      enabled: true,
      confidence: 0.72,
      sourceConversationId: "conversation/1",
      sourceMessageId: "message/1",
      data: { tags: ["food"] },
      createdAt: "2026-05-05T00:03:00.000Z",
      updatedAt: "2026-05-05T00:05:00.000Z",
    };
    const vectorIndex = {
      available: false,
      status: "not_configured",
      mode: "keyword_fallback",
      embeddingProvider: "none",
      dimensions: null,
      memoryCount: 1,
      enabledMemoryCount: 1,
      indexedCount: 0,
      staleCount: 1,
      lastMemoryUpdatedAt: "2026-05-05T00:05:00.000Z",
      lastIndexedAt: null,
      diagnostics: {
        code: "PLAYGROUND_MEMORY_VECTOR_INDEX_NOT_CONFIGURED",
        fallback: "keyword",
      },
    };
    const { calls, service } = createServiceHarness({
      handler: (path) => {
        if (path.startsWith("/api/playground/memories/vector-index?")) {
          return vectorIndex;
        }
        if (path === "/api/playground/memories/vector-index/rebuild") {
          return {
            accepted: false,
            status: "not_configured",
            mode: "keyword_fallback",
            force: true,
            rebuiltAt: null,
            indexedCount: 0,
            skippedCount: 1,
            diagnostics: vectorIndex.diagnostics,
            vectorIndex,
          };
        }
        if (path === "/api/playground/memories/recall-test") {
          return {
            query: "sushi",
            mode: "keyword_fallback",
            vectorIndexStatus: "not_configured",
            embeddingProvider: "none",
            limit: 3,
            includeDisabled: true,
            items: [{ memory, score: 0.85, reason: "keyword_match" }],
            diagnostics: vectorIndex.diagnostics,
          };
        }
        if (path === "/api/playground/memories") {
          return memory;
        }

        return {
          preference: { enabled: true, updatedAt: null },
          items: [memory],
          limit: 25,
          offset: 10,
          hasMore: false,
          filter: { search: "sushi", enabled: true },
        };
      },
    });

    await expect(
      service.listPlaygroundMemories({ search: "  sushi  ", enabled: true, limit: 25, offset: 10 }),
    ).resolves.toEqual({
      preference: { enabled: true, updatedAt: null },
      items: [memory],
      limit: 25,
      offset: 10,
      hasMore: false,
      filter: { search: "sushi", enabled: true },
    });
    await expect(
      service.createPlaygroundMemory({
        key: "food.preference",
        value: "Likes sushi",
        confidence: 0.72,
        sourceConversationId: "conversation/1",
        sourceMessageId: "message/1",
        data: { tags: ["food"] },
      }),
    ).resolves.toEqual(memory);
    await expect(service.getPlaygroundMemoryVectorIndex()).resolves.toEqual(vectorIndex);
    await expect(service.rebuildPlaygroundMemoryVectorIndex({ force: true })).resolves.toMatchObject({
      accepted: false,
      status: "not_configured",
      vectorIndex,
    });
    await expect(
      service.runPlaygroundMemoryRecallTest({ query: "sushi", limit: 3, includeDisabled: true }),
    ).resolves.toMatchObject({
      query: "sushi",
      mode: "keyword_fallback",
      items: [{ memory, score: 0.85, reason: "keyword_match" }],
    });

    expect(calls[0]).toEqual({
      path: "/api/playground/memories?accountOwnerType=user&accountOwnerId=synthetic-actor&search=sushi&enabled=true&limit=25&offset=10",
      init: undefined,
    });
    expect(calls[1].path).toBe("/api/playground/memories");
    expect(calls[1].init?.method).toBe("POST");
    expect(parseJsonBody(calls[1])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-actor",
      regionCode: "CN",
      currency: "CNY",
      key: "food.preference",
      value: "Likes sushi",
      confidence: 0.72,
      sourceConversationId: "conversation/1",
      sourceMessageId: "message/1",
      data: { tags: ["food"] },
    });
    expect(calls[2]).toEqual({
      path: "/api/playground/memories/vector-index?accountOwnerType=user&accountOwnerId=synthetic-actor",
      init: undefined,
    });
    expect(calls[3].path).toBe("/api/playground/memories/vector-index/rebuild");
    expect(calls[3].init?.method).toBe("POST");
    expect(parseJsonBody(calls[3])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-actor",
      regionCode: "CN",
      currency: "CNY",
      force: true,
    });
    expect(calls[4].path).toBe("/api/playground/memories/recall-test");
    expect(calls[4].init?.method).toBe("POST");
    expect(parseJsonBody(calls[4])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-actor",
      regionCode: "CN",
      currency: "CNY",
      query: "sushi",
      limit: 3,
      includeDisabled: true,
    });
  });

  it("mirrors organization owner scope into memory read, delete, and write requests", async () => {
    const organizationScope = createSyntheticOrganizationOwnerScope();
    const { calls, service } = createServiceHarness({
      actorId: "synthetic-org-actor",
      ownerScope: organizationScope,
      handler: (path) => {
        if (path.includes("/preference")) {
          return {
            enabled: false,
            updatedAt: "2026-05-05T00:04:00.000Z",
          };
        }
        if (path.includes("/synthetic%20memory%2Fkey")) {
          return {
            key: "synthetic memory/key",
            value: "Synthetic organization memory",
            enabled: false,
            confidence: 0.8,
            updatedAt: "2026-05-05T00:05:00.000Z",
            source: "synthetic",
          };
        }

        return {
          preference: {
            enabled: true,
            updatedAt: null,
          },
          items: [],
        };
      },
    });

    await service.listPlaygroundMemories();
    await service.updatePlaygroundMemoryPreference({ enabled: false });
    await service.updatePlaygroundMemory("synthetic memory/key", {
      value: "Synthetic organization memory",
      enabled: false,
    });
    await service.deletePlaygroundMemory("synthetic memory/key");

    expect(calls[0]).toEqual({
      path: "/api/playground/memories?accountOwnerType=organization&accountOwnerId=synthetic-org%2Fone",
      init: undefined,
    });
    expect(calls[1].path).toBe("/api/playground/memories/preference");
    expect(calls[1].init?.method).toBe("PUT");
    expect(parseJsonBody(calls[1])).toEqual({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-org/one",
      regionCode: "CN",
      currency: "CNY",
      enabled: false,
    });
    expect(calls[2].path).toBe("/api/playground/memories/synthetic%20memory%2Fkey");
    expect(calls[2].init?.method).toBe("PUT");
    expect(parseJsonBody(calls[2])).toEqual({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-org/one",
      regionCode: "CN",
      currency: "CNY",
      value: "Synthetic organization memory",
      enabled: false,
    });
    expect(calls[3]).toEqual({
      path: "/api/playground/memories/synthetic%20memory%2Fkey?accountOwnerType=organization&accountOwnerId=synthetic-org%2Fone",
      init: {
        method: "DELETE",
      },
    });
  });
});
