export type PlaygroundModel = {
  id: string;
  name: string;
  provider: string;
  configured: boolean;
  default?: boolean;
};

export type PlaygroundConversation = {
  id: string;
  actorId: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  messageCount: number;
  archived?: boolean;
};

export type PlaygroundMessage = {
  id: string;
  conversationId: string;
  actorId: string;
  role: "system" | "user" | "assistant";
  content: string;
  model: string | null;
  status: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type PlaygroundMemory = {
  key: string;
  value: string;
  enabled: boolean;
  confidence: number | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  data?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type PlaygroundMemoryPreference = {
  enabled: boolean;
  updatedAt: string | null;
};

export type PlaygroundMemoryListOptions = {
  search?: string;
  enabled?: boolean;
  limit?: number;
  offset?: number;
};

export type PlaygroundMemoryListResponse = {
  preference: PlaygroundMemoryPreference;
  items: PlaygroundMemory[];
  limit?: number;
  offset?: number;
  hasMore?: boolean;
  filter?: {
    search?: string | null;
    enabled?: boolean | null;
  };
};

export type PlaygroundMemoryWriteInput = Partial<
  Pick<
    PlaygroundMemory,
    | "key"
    | "value"
    | "enabled"
    | "confidence"
    | "sourceConversationId"
    | "sourceMessageId"
    | "data"
  >
>;

export type PlaygroundMemoryVectorIndex = {
  available: boolean;
  status: "not_configured" | "ready" | "building" | "stale";
  mode: "keyword_fallback" | "vector";
  embeddingProvider: string;
  dimensions: number | null;
  memoryCount: number;
  enabledMemoryCount: number;
  indexedCount: number;
  staleCount: number;
  lastMemoryUpdatedAt: string | null;
  lastIndexedAt: string | null;
  diagnostics?: Record<string, unknown>;
};

export type PlaygroundMemoryVectorRebuildResult = {
  accepted: boolean;
  status: string;
  mode: "keyword_fallback" | "vector";
  force?: boolean;
  rebuiltAt: string | null;
  indexedCount: number;
  skippedCount: number;
  diagnostics?: Record<string, unknown>;
  vectorIndex: PlaygroundMemoryVectorIndex;
};

export type PlaygroundMemoryRecallTestInput = {
  query: string;
  limit?: number;
  includeDisabled?: boolean;
};

export type PlaygroundMemoryRecallItem = {
  memory: PlaygroundMemory;
  score: number;
  reason: string;
};

export type PlaygroundMemoryRecallTestResult = {
  query: string;
  mode: "keyword_fallback" | "vector";
  vectorIndexStatus: string;
  embeddingProvider: string;
  limit: number;
  includeDisabled: boolean;
  items: PlaygroundMemoryRecallItem[];
  diagnostics?: Record<string, unknown>;
};

export type PlaygroundChatInput = {
  conversationId?: string | null;
  message: string;
  model?: string;
  webSearch?: boolean;
  thinkingMode?: boolean;
  context?: string;
  mode?: string;
  preferredImageToolId?: string;
  allowedImageToolIds?: string[];
  preferredImageAspectRatio?: string;
  attachments?: Array<{
    name: string;
    size?: number;
    type?: string;
    content?: string;
    contentTruncated?: boolean;
  }>;
};

export type PlaygroundChatJob = {
  id: string;
  actorId: string;
  conversationId: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
  model: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  request?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: { code?: string; message?: string } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type PlaygroundChatJobStartResult = {
  job: PlaygroundChatJob;
  conversation: PlaygroundConversation;
  userMessage: PlaygroundMessage;
  assistantMessage: PlaygroundMessage;
};

export type PlaygroundChatEvent =
  | { type: "conversation"; conversation: PlaygroundConversation }
  | { type: "user_message"; message: PlaygroundMessage }
  | { type: "assistant_message"; message: PlaygroundMessage }
  | { type: "job"; job: PlaygroundChatJob }
  | { type: "delta"; messageId: string; delta: string }
  | {
      type: "done";
      conversation: PlaygroundConversation;
      message: PlaygroundMessage | null;
      memories: PlaygroundMemory[];
      job?: PlaygroundChatJob;
    }
  | { type: "error"; code: string; message: string; job?: PlaygroundChatJob };
