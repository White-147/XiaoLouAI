import { API_BASE_URL } from '../../lib/api';

export type JaazModelInfo = {
  provider: string;
  model: string;
  display_name?: string | null;
  url: string;
  type?: 'text' | 'image' | 'tool' | 'video';
};

export type JaazToolInfo = {
  provider: string;
  id: string;
  display_name?: string | null;
  type?: 'image' | 'tool' | 'video';
};

type JaazMessageContent =
  | string
  | Array<
      | { type: 'text'; text: string }
      | { type: 'image_url'; image_url: { url: string } }
    >;

type JaazMessage = {
  role: 'user' | 'assistant' | 'tool';
  content?: JaazMessageContent;
  tool_call_id?: string;
};

export type JaazAgentAttachment = {
  type: 'image' | 'video' | 'audio';
  url: string;
  nodeId?: string;
  base64?: string;
};

export type JaazAgentPriorMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type JaazAgentCanvasSnapshot = {
  title?: string;
  nodes?: unknown[];
  groups?: unknown[];
  selectedNodeIds?: string[];
};

export type JaazAgentGeneratedMedia = {
  type: 'image' | 'video';
  url: string;
  width?: number;
  height?: number;
  canvasId?: string;
  sessionId?: string;
};

type JaazSessionEvent = {
  type?: string;
  session_id?: string;
  canvas_id?: string;
  text?: unknown;
  error?: unknown;
  name?: string;
  id?: string;
  update?: string;
  image_url?: string;
  video_url?: string;
  element?: {
    width?: number;
    height?: number;
    x?: number;
    y?: number;
  };
  file?: {
    dataURL?: string;
    mimeType?: string;
  };
  message?: unknown;
  messages?: unknown;
};

export type JaazAgentCallbacks = {
  onDelta?: (text: string) => void;
  onStatus?: (text: string) => void;
  onGeneratedMedia?: (media: JaazAgentGeneratedMedia) => void;
};

export type SendJaazAgentMessageInput = {
  sessionId: string;
  canvasId?: string;
  content: string;
  priorMessages: JaazAgentPriorMessage[];
  media?: JaazAgentAttachment[];
  model?: string;
  toolId?: string;
  toolType?: 'image' | 'video';
  preferredImageToolId?: string;
  preferredVideoToolId?: string;
  canvas?: JaazAgentCanvasSnapshot;
  callbacks?: JaazAgentCallbacks;
};

export type SendJaazAgentMessageResult = {
  response: string;
  generatedMedia: JaazAgentGeneratedMedia[];
  model?: string;
};

const JAAZ_AGENT_SYSTEM_PROMPT = [
  'You are running inside XiaoLou Agent Canvas.',
  'Default to Simplified Chinese for every user-facing reply. Only use another language when the user explicitly asks for it.',
  'Use Planner Agent first for multi-step creative work.',
  'When the request asks for image or video generation, use the available image/video creator tools immediately.',
  'When a generated image or video is produced, it will be inserted into the XiaoLou canvas automatically by the host.',
].join('\n');

const AGENT_TIMEOUT_MS = 10 * 60 * 1000;

function getSafeDefaultTools(
  tools: JaazToolInfo[],
  preferredToolId?: string,
  preferredToolType?: 'image' | 'video',
  preferredImageToolId?: string,
  preferredVideoToolId?: string,
): JaazToolInfo[] {
  if (!tools.length || tools.some((tool) => tool.provider !== 'xiaolou')) {
    if (preferredToolId) {
      const exact = tools.find((tool) => tool.id === preferredToolId);
      if (exact) return [exact];
    }
    if (preferredToolType) {
      const typed = tools.find((tool) => tool.type === preferredToolType);
      return typed ? [typed] : tools;
    }
    return tools;
  }

  if (preferredToolId) {
    const exact = tools.find((tool) => tool.id === preferredToolId);
    if (exact) return [exact];
  }

  if (preferredToolType) {
    const preferredByType = tools.find((tool) => tool.type === preferredToolType);
    if (preferredByType) return [preferredByType];
  }

  const preferredImage =
    tools.find((tool) => tool.id === preferredImageToolId) ||
    tools.find((tool) => tool.id === 'xiaolou_image_doubao_seedream_5_0_260128') ||
    tools.find((tool) => tool.id === 'xiaolou_image_vertex_gemini_3_pro_image_preview') ||
    tools.find((tool) => tool.type === 'image');
  const preferredVideo =
    tools.find((tool) => tool.id === preferredVideoToolId) ||
    tools.find((tool) => tool.id === 'xiaolou_video_doubao_seedance_2_0_260128') ||
    tools.find((tool) => tool.id === 'xiaolou_video_vertex_veo_3_1_generate_001') ||
    tools.find((tool) => tool.type === 'video');

  return [preferredImage, preferredVideo].filter(Boolean) as JaazToolInfo[];
}

async function ensureJaazApi() {
  await fetch(`${API_BASE_URL}/api/jaaz/ensure`, {
    method: 'POST',
  }).catch(() => {
    // The bridge can still work if Jaaz is already running and ensure is unavailable.
  });
}

async function fetchJaazJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(
      typeof payload?.detail === 'string'
        ? payload.detail
        : typeof payload?.error === 'string'
          ? payload.error
          : `${url} 返回 ${response.status}`,
    );
  }
  return payload as T;
}

export async function fetchJaazModelsAndTools() {
  await ensureJaazApi();

  const [models, tools] = await Promise.all([
    fetchJaazJson<JaazModelInfo[]>('/jaaz-api/api/list_models'),
    fetchJaazJson<JaazToolInfo[]>('/jaaz-api/api/list_tools'),
  ]);

  return {
    models: Array.isArray(models) ? models : [],
    tools: Array.isArray(tools) ? tools : [],
  };
}

function selectJaazTextModel(models: JaazModelInfo[], selectedModel?: string): JaazModelInfo {
  const textModels = models.filter((model) => !model.type || model.type === 'text');
  if (!textModels.length) {
    throw new Error('Jaaz 文本模型尚未配置');
  }

  if (selectedModel && selectedModel !== 'auto') {
    const exact = textModels.find(
      (model) =>
        model.model === selectedModel ||
        `${model.provider}:${model.model}` === selectedModel,
    );
    if (exact) return exact;
  }

  return (
    textModels.find((model) => model.model === 'qwen-plus') ||
    textModels.find((model) => model.model.includes('gemini')) ||
    textModels[0]
  );
}

function normalizeJaazMediaUrl(url: string): string {
  const value = String(url || '').trim();
  if (!value || value.startsWith('data:') || value.startsWith('/jaaz-api/')) {
    return value;
  }

  try {
    const parsed = new URL(value, window.location.origin);
    const match = parsed.pathname.match(/\/api\/file\/([^/?#]+)/);
    if (match?.[1]) {
      return `/jaaz-api/api/file/${encodeURIComponent(decodeURIComponent(match[1]))}`;
    }
  } catch {
    // Fall through to relative path handling.
  }

  const relativeMatch = value.match(/\/api\/file\/([^/?#]+)/);
  if (relativeMatch?.[1]) {
    return `/jaaz-api/api/file/${encodeURIComponent(decodeURIComponent(relativeMatch[1]))}`;
  }

  return value;
}

function getJaazSocketUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/socket.io/?EIO=4&transport=websocket`;
}

function parseSocketIoEvent(packet: string): [string, unknown] | null {
  if (!packet.startsWith('42')) return null;
  const payload = packet.slice(2);
  try {
    const parsed = JSON.parse(payload);
    if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
      return [parsed[0], parsed[1]];
    }
  } catch {
    return null;
  }
  return null;
}

class MinimalJaazSocket {
  private socket: WebSocket | null = null;
  private connectResolve: (() => void) | null = null;
  private connectReject: ((error: Error) => void) | null = null;
  private connectTimer: number | null = null;

  constructor(
    private readonly sessionId: string,
    private readonly onSessionEvent: (event: JaazSessionEvent) => void,
  ) {}

  connect(): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      this.connectResolve = resolve;
      this.connectReject = reject;
      this.connectTimer = window.setTimeout(() => {
        this.connectReject?.(new Error('连接 Jaaz Agent 流超时'));
        this.disconnect();
      }, 10_000);

      this.socket = new WebSocket(getJaazSocketUrl());

      this.socket.onmessage = (event) => {
        this.handlePacket(String(event.data || ''));
      };

      this.socket.onerror = () => {
        this.connectReject?.(new Error('无法连接 Jaaz Agent 流'));
      };

      this.socket.onclose = () => {
        this.connectReject?.(new Error('Jaaz Agent 流在就绪前关闭'));
      };
    });
  }

  disconnect() {
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.connectResolve = null;
    this.connectReject = null;
    if (this.socket) {
      this.socket.onmessage = null;
      this.socket.onerror = null;
      this.socket.onclose = null;
      if (
        this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING
      ) {
        this.socket.close();
      }
      this.socket = null;
    }
  }

  private markConnected() {
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    this.connectResolve?.();
    this.connectResolve = null;
    this.connectReject = null;
  }

  private handlePacket(packet: string) {
    if (!packet) return;

    if (packet.startsWith('0')) {
      this.socket?.send('40');
      return;
    }

    if (packet.startsWith('40')) {
      this.markConnected();
      return;
    }

    if (packet === '2') {
      this.socket?.send('3');
      return;
    }

    const socketEvent = parseSocketIoEvent(packet);
    if (!socketEvent) return;

    const [eventName, rawEvent] = socketEvent;
    if (eventName !== 'session_update' || !rawEvent || typeof rawEvent !== 'object') {
      return;
    }

    const sessionEvent = rawEvent as JaazSessionEvent;
    if (sessionEvent.session_id !== this.sessionId) {
      return;
    }

    this.onSessionEvent(sessionEvent);
  }
}

function compactCanvasSnapshot(canvas?: JaazAgentCanvasSnapshot) {
  if (!canvas) return null;
  const nodes = Array.isArray(canvas.nodes) ? canvas.nodes.slice(0, 30) : [];
  return {
    title: canvas.title,
    selectedNodeIds: canvas.selectedNodeIds,
    groups: Array.isArray(canvas.groups) ? canvas.groups.slice(0, 12) : [],
    nodes,
  };
}

function buildUserText(
  content: string,
  canvas?: JaazAgentCanvasSnapshot,
  uploadedImages?: Array<{ file_id: string; width: number; height: number }>,
): string {
  let text = content.trim() || '请继续基于当前画布和附件进行创作。';
  text = `请默认使用简体中文回复；除非我明确要求其他语言。\n\n${text}`;
  const compactCanvas = compactCanvasSnapshot(canvas);

  if (compactCanvas) {
    text += `\n\n<xiaolou_canvas_context>\n${JSON.stringify(compactCanvas, null, 2)}\n</xiaolou_canvas_context>`;
  }

  if (uploadedImages?.length) {
    text += `\n\n<input_images count="${uploadedImages.length}">`;
    uploadedImages.forEach((image, index) => {
      text += `\n<image index="${index + 1}" file_id="${image.file_id}" width="${image.width}" height="${image.height}" />`;
    });
    text += '\n</input_images>';
  }

  return text;
}

function base64ToBlob(base64: string, mimeType = 'image/png'): Blob {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType });
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, encoded] = dataUrl.split(',');
  const mimeMatch = header.match(/^data:([^;]+);base64$/);
  return base64ToBlob(encoded || '', mimeMatch?.[1] || 'image/png');
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image attachment'));
    reader.readAsDataURL(blob);
  });
}

async function attachmentToBlob(attachment: JaazAgentAttachment): Promise<Blob | null> {
  if (attachment.type !== 'image') return null;

  if (attachment.base64) {
    return base64ToBlob(attachment.base64);
  }

  if (attachment.url.startsWith('data:image/')) {
    return dataUrlToBlob(attachment.url);
  }

  const response = await fetch(attachment.url);
  if (!response.ok) {
    throw new Error(`Failed to load image attachment: ${response.statusText}`);
  }
  return response.blob();
}

async function uploadImageAttachment(attachment: JaazAgentAttachment) {
  const blob = await attachmentToBlob(attachment);
  if (!blob) return null;

  const fileName = `${attachment.nodeId || 'xiaolou-reference'}.png`;
  const file = new File([blob], fileName, { type: blob.type || 'image/png' });
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch('/jaaz-api/api/upload_image', {
    method: 'POST',
    body: formData,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.file_id) {
    throw new Error(payload?.detail || response.statusText || '上传图片到 Jaaz 失败');
  }

  return {
    file_id: String(payload.file_id),
    width: Number(payload.width) || 0,
    height: Number(payload.height) || 0,
    dataUrl: await blobToDataUrl(blob),
  };
}

async function buildJaazMessages(input: SendJaazAgentMessageInput): Promise<JaazMessage[]> {
  const uploadedImages = (
    await Promise.all((input.media || []).map((attachment) => uploadImageAttachment(attachment)))
  ).filter(Boolean) as Array<{ file_id: string; width: number; height: number; dataUrl: string }>;

  const previousMessages = input.priorMessages.slice(-16).map((message): JaazMessage => ({
    role: message.role,
    content: message.content,
  }));

  const userText = buildUserText(input.content, input.canvas, uploadedImages);
  const userContent: JaazMessageContent = [
    { type: 'text', text: userText },
    ...uploadedImages.map((image) => ({
      type: 'image_url' as const,
      image_url: {
        url: image.dataUrl,
      },
    })),
  ];

  return previousMessages.concat({
    role: 'user',
    content: userContent,
  });
}

function getGeneratedUrl(event: JaazSessionEvent, mediaType: 'image' | 'video'): string {
  const value =
    mediaType === 'image'
      ? event.image_url || event.file?.dataURL || ''
      : event.video_url || event.file?.dataURL || '';
  return normalizeJaazMediaUrl(String(value || ''));
}

export async function sendJaazAgentMessage(
  input: SendJaazAgentMessageInput,
): Promise<SendJaazAgentMessageResult> {
  await ensureJaazApi();

  const [{ models, tools }, jaazMessages] = await Promise.all([
    fetchJaazModelsAndTools(),
    buildJaazMessages(input),
  ]);

  const textModel = selectJaazTextModel(models, input.model);
  const selectedTools = getSafeDefaultTools(
    tools,
    input.toolId,
    input.toolType,
    input.preferredImageToolId,
    input.preferredVideoToolId,
  );
  if (!selectedTools.length) {
    throw new Error('Jaaz 图片/视频工具尚未配置');
  }

  let responseText = '';
  const generatedMedia: JaazAgentGeneratedMedia[] = [];
  let settled = false;
  let settleSuccess: ((result: SendJaazAgentMessageResult) => void) | null = null;
  let settleFailure: ((error: Error) => void) | null = null;
  let timeoutHandle: number | null = null;

  const finishSuccess = () => {
    if (settled) return;
    settled = true;
    if (timeoutHandle !== null) {
      window.clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    socket.disconnect();
    settleSuccess?.({
      response: responseText.trim(),
      generatedMedia,
      model: textModel.model,
    });
  };

  const finishFailure = (error: Error) => {
    if (settled) return;
    settled = true;
    if (timeoutHandle !== null) {
      window.clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    socket.disconnect();
    settleFailure?.(error);
  };

  const socket = new MinimalJaazSocket(input.sessionId, (event) => {
    const type = String(event.type || '');

    if (type === 'delta') {
      const delta = String(event.text || '');
      if (delta) {
        responseText += delta;
        input.callbacks?.onDelta?.(delta);
      }
      return;
    }

    if (type === 'tool_call') {
      input.callbacks?.onStatus?.(`正在调用工具：${event.name || 'tool'}`);
      return;
    }

    if (type === 'tool_call_progress' && event.update) {
      input.callbacks?.onStatus?.(event.update);
      return;
    }

    if (type === 'tool_call_result') {
      input.callbacks?.onStatus?.('工具调用完成');
      return;
    }

    if (type === 'image_generated' || type === 'video_generated') {
      const mediaType = type === 'image_generated' ? 'image' : 'video';
      const url = getGeneratedUrl(event, mediaType);
      if (!url) return;

      const media: JaazAgentGeneratedMedia = {
        type: mediaType,
        url,
        width: event.element?.width,
        height: event.element?.height,
        canvasId: event.canvas_id,
        sessionId: event.session_id,
      };
      generatedMedia.push(media);
      input.callbacks?.onGeneratedMedia?.(media);
      return;
    }

    if (type === 'error') {
      finishFailure(new Error(String(event.error || 'Jaaz Agent 调用失败')));
      return;
    }

    if (type === 'done') {
      finishSuccess();
    }
  });

  await socket.connect();

  const completion = new Promise<SendJaazAgentMessageResult>((resolve, reject) => {
    settleSuccess = resolve;
    settleFailure = reject;
    timeoutHandle = window.setTimeout(() => {
      if (settled) return;
      finishFailure(new Error('Jaaz Agent 请求超时'));
    }, AGENT_TIMEOUT_MS);
  });

  const response = await fetch('/jaaz-api/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: jaazMessages,
      canvas_id: input.canvasId || `xiaolou-${input.sessionId}`,
      session_id: input.sessionId,
      text_model: textModel,
      tool_list: selectedTools,
      system_prompt: JAAZ_AGENT_SYSTEM_PROMPT,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.status === 'error') {
    if (timeoutHandle !== null) {
      window.clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
    settled = true;
    socket.disconnect();
    throw new Error(payload?.error || response.statusText || '启动 Jaaz Agent 失败');
  }

  return completion;
}

export function createGeneratedMediaAction(
  media: JaazAgentGeneratedMedia,
  index = 0,
): Record<string, unknown> {
  const mediaWidth = Number(media.width) || 360;
  const width = Math.max(240, Math.min(mediaWidth, 520));
  return {
    type: 'create_node',
    node: {
      type: media.type === 'video' ? 'Video' : 'Image',
      title: media.type === 'video' ? 'Jaaz 视频' : 'Jaaz 图片',
      prompt: '由 Jaaz Agent 生成',
      resultUrl: media.url,
      status: 'success',
      width,
      x: undefined,
      y: undefined,
      model: media.type === 'video' ? 'jaaz-agent-video' : 'jaaz-agent-image',
      aspectRatio: 'Auto',
      resolution: 'Auto',
      source: 'jaaz-agent',
      sourceIndex: index,
    },
  };
}
