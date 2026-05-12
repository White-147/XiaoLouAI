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
} from "./playground-types";

export type PlaygroundChatJobsQuery = {
  conversationId?: string;
  activeOnly?: boolean;
  status?: string;
  limit?: number;
};

export type PlaygroundServiceContract = {
  getPlaygroundConfig: () => Promise<{
    defaultModel: string;
    models: PlaygroundModel[];
    memory: PlaygroundMemoryPreference;
  }>;
  listPlaygroundModels: () => Promise<{ defaultModel: string; items: PlaygroundModel[] }>;
  listPlaygroundConversations: (search?: string) => Promise<{ items: PlaygroundConversation[] }>;
  createPlaygroundConversation: (input?: { title?: string; model?: string }) => Promise<PlaygroundConversation>;
  updatePlaygroundConversation: (
    conversationId: string,
    input: Partial<Pick<PlaygroundConversation, "title" | "model">>,
  ) => Promise<PlaygroundConversation>;
  deletePlaygroundConversation: (conversationId: string) => Promise<{ deleted: boolean; conversationId: string }>;
  getPlaygroundConversation: (conversationId: string) => Promise<PlaygroundConversation>;
  listPlaygroundMessages: (conversationId: string) => Promise<{ items: PlaygroundMessage[] }>;
  listPlaygroundChatJobs: (options?: PlaygroundChatJobsQuery) => Promise<{ items: PlaygroundChatJob[] }>;
  getPlaygroundChatJob: (jobId: string) => Promise<{ job: PlaygroundChatJob }>;
  startPlaygroundChatJob: (input: PlaygroundChatInput) => Promise<PlaygroundChatJobStartResult>;
  listPlaygroundMemories: () => Promise<{
    preference: PlaygroundMemoryPreference;
    items: PlaygroundMemory[];
  }>;
  updatePlaygroundMemoryPreference: (
    input: Partial<PlaygroundMemoryPreference>,
  ) => Promise<PlaygroundMemoryPreference>;
  updatePlaygroundMemory: (
    key: string,
    input: Partial<Pick<PlaygroundMemory, "key" | "value" | "enabled">>,
  ) => Promise<PlaygroundMemory>;
  deletePlaygroundMemory: (key: string) => Promise<{ deleted: boolean; key: string }>;
  runPlaygroundChatFacade: (
    input: PlaygroundChatInput,
    onEvent: (event: PlaygroundChatEvent) => void,
    signal?: AbortSignal,
  ) => Promise<void>;
  streamPlaygroundChat: (
    input: PlaygroundChatInput,
    onEvent: (event: PlaygroundChatEvent) => void,
    signal?: AbortSignal,
  ) => Promise<void>;
};

export function createPlaygroundFacade(playgroundService: PlaygroundServiceContract) {
  return {
    getPlaygroundConfig() {
      return playgroundService.getPlaygroundConfig();
    },
    listPlaygroundModels() {
      return playgroundService.listPlaygroundModels();
    },
    listPlaygroundConversations(search?: string) {
      return playgroundService.listPlaygroundConversations(search);
    },
    createPlaygroundConversation(input: { title?: string; model?: string } = {}) {
      return playgroundService.createPlaygroundConversation(input);
    },
    updatePlaygroundConversation(
      conversationId: string,
      input: Partial<Pick<PlaygroundConversation, "title" | "model">>,
    ) {
      return playgroundService.updatePlaygroundConversation(conversationId, input);
    },
    deletePlaygroundConversation(conversationId: string) {
      return playgroundService.deletePlaygroundConversation(conversationId);
    },
    getPlaygroundConversation(conversationId: string) {
      return playgroundService.getPlaygroundConversation(conversationId);
    },
    listPlaygroundMessages(conversationId: string) {
      return playgroundService.listPlaygroundMessages(conversationId);
    },
    listPlaygroundChatJobs(options: PlaygroundChatJobsQuery = {}) {
      return playgroundService.listPlaygroundChatJobs(options);
    },
    getPlaygroundChatJob(jobId: string) {
      return playgroundService.getPlaygroundChatJob(jobId);
    },
    startPlaygroundChatJob(input: PlaygroundChatInput) {
      return playgroundService.startPlaygroundChatJob(input);
    },
    listPlaygroundMemories() {
      return playgroundService.listPlaygroundMemories();
    },
    updatePlaygroundMemoryPreference(input: Partial<PlaygroundMemoryPreference>) {
      return playgroundService.updatePlaygroundMemoryPreference(input);
    },
    updatePlaygroundMemory(
      key: string,
      input: Partial<Pick<PlaygroundMemory, "key" | "value" | "enabled">>,
    ) {
      return playgroundService.updatePlaygroundMemory(key, input);
    },
    deletePlaygroundMemory(key: string) {
      return playgroundService.deletePlaygroundMemory(key);
    },
    runPlaygroundChatFacade(
      input: PlaygroundChatInput,
      onEvent: (event: PlaygroundChatEvent) => void,
      signal?: AbortSignal,
    ) {
      return playgroundService.runPlaygroundChatFacade(input, onEvent, signal);
    },
    streamPlaygroundChat(
      input: PlaygroundChatInput,
      onEvent: (event: PlaygroundChatEvent) => void,
      signal?: AbortSignal,
    ) {
      return playgroundService.streamPlaygroundChat(input, onEvent, signal);
    },
  };
}
