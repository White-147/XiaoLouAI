import { DEFAULT_XIAOLOU_IMAGE_TO_VIDEO_MODEL_ID } from './config/canvasVideoModels';
import {
  DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID,
  normalizeCanvasImageModelId,
} from './config/canvasImageModels';
import type { CanvasProjectAssetSyncDraft } from './components/modals/ProjectAssetSyncModal';
import {
  NodeStatus,
  NodeType,
  type CanvasNodeUploadSource,
  type NodeData,
  type NodeGroup,
  type Viewport,
} from './types';
import type { PermissionContext, WalletRechargeCapabilities } from '../../../../lib/api';

export type CanvasMediaImportKind = 'image' | 'video';

export type CanvasDraftData = {
  workflowId: string | null;
  canvasTitle: string;
  nodes: NodeData[];
  groups: NodeGroup[];
  viewport: Viewport;
  canvasProjectId?: string | null;
  hasUnsavedChanges?: boolean;
  savedAt: string;
};

export type CanvasGenerationAccess = {
  canGenerate: boolean;
  deniedMessage: string;
  insufficientCreditsMessage: string;
};

type ScreenBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
};

type RectLike = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export const CANVAS_MEDIA_IMPORT_MAX_BYTES = 100 * 1024 * 1024;
export const DEFAULT_CANVAS_TITLE = 'Untitled';

const DEFAULT_CANVAS_TITLES = new Set([
  '',
  'untitled',
  'untitled canvas',
  '未命名画布',
]);
DEFAULT_CANVAS_TITLES.add('未命名画布');

export const urlToBase64 = async (url: string): Promise<string> => {
  if (url.startsWith('data:image')) return url;

  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.error('Error converting URL to base64:', e);
    return '';
  }
};

export function isCanvasFileUploadSource(value: CanvasNodeUploadSource): value is File {
  return typeof File !== 'undefined' && value instanceof File;
}

export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image file.'));
    reader.readAsDataURL(file);
  });
}

export function getFileStem(file: File) {
  return file.name.replace(/\.[^.]+$/, '').trim() || file.name || 'Imported media';
}

export function getCanvasMediaImportKind(file: File): CanvasMediaImportKind | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';

  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension && ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'].includes(extension)) return 'image';
  if (extension && ['mp4', 'mov', 'webm', 'm4v'].includes(extension)) return 'video';

  return null;
}

export function getCanvasMediaFiles(dataTransfer: DataTransfer | null | undefined) {
  if (!dataTransfer) return [];

  const filesFromList = Array.from(dataTransfer.files || []);
  const filesFromItems = Array.from(dataTransfer.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));

  const seen = new Set<string>();
  return [...filesFromList, ...filesFromItems].filter((file) => {
    if (!getCanvasMediaImportKind(file)) return false;
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function hasFilesInDataTransfer(dataTransfer: DataTransfer | null | undefined) {
  return Boolean(dataTransfer && Array.from(dataTransfer.types || []).includes('Files'));
}

export function isCanvasEditableEventTarget(target: EventTarget | null) {
  const element = target instanceof Element ? target : document.activeElement;
  if (!(element instanceof Element)) return false;
  if (element.closest('input, textarea, select, [role="textbox"]')) return true;
  const contentEditable = element.closest('[contenteditable]');
  return contentEditable instanceof HTMLElement && contentEditable.isContentEditable;
}

export function isDefaultCanvasTitle(title?: string | null) {
  return DEFAULT_CANVAS_TITLES.has(String(title || '').trim().toLowerCase());
}

export function hasMeaningfulCanvasContent(options: {
  nodes?: ArrayLike<unknown> | null;
  groups?: ArrayLike<unknown> | null;
  title?: string | null;
}) {
  const nodeCount = typeof options.nodes?.length === 'number' ? options.nodes.length : 0;
  const groupCount = typeof options.groups?.length === 'number' ? options.groups.length : 0;
  return (
    nodeCount > 0 ||
    groupCount > 0 ||
    !isDefaultCanvasTitle(options.title)
  );
}

export function getCanvasSafeBounds(rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>): ScreenBounds {
  const left = rect.left + 28;
  const right = rect.right - 28;
  const top = rect.top + 96;
  const bottom = rect.bottom - 112;
  return {
    left,
    top,
    right,
    bottom,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

export function unionScreenRects(rects: RectLike[]): RectLike | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

export function rectIntersectsBounds(rect: RectLike, bounds: ScreenBounds) {
  return rect.right > bounds.left && rect.left < bounds.right && rect.bottom > bounds.top && rect.top < bounds.bottom;
}

export function getBoundsNudge(rect: RectLike, bounds: ScreenBounds) {
  let dx = 0;
  let dy = 0;

  if (rect.width > bounds.right - bounds.left) {
    dx = bounds.centerX - (rect.left + rect.right) / 2;
  } else if (rect.left < bounds.left) {
    dx = bounds.left - rect.left;
  } else if (rect.right > bounds.right) {
    dx = bounds.right - rect.right;
  }

  if (rect.height > bounds.bottom - bounds.top) {
    dy = bounds.centerY - (rect.top + rect.bottom) / 2;
  } else if (rect.top < bounds.top) {
    dy = bounds.top - rect.top;
  } else if (rect.bottom > bounds.bottom) {
    dy = bounds.bottom - rect.bottom;
  }

  return { dx, dy };
}

export function getFallbackCreatePermission(actorId: string) {
  const normalized = String(actorId || '').trim();
  return normalized !== '' && normalized !== 'guest';
}

export function buildGenerationDeniedMessage(options: {
  actorId: string;
  isLoopback: boolean;
  permissionContext: PermissionContext | null;
}) {
  const { actorId, isLoopback, permissionContext } = options;
  if (permissionContext?.permissions.canCreateProject) {
    return '';
  }

  const platformRole = permissionContext?.platformRole || (actorId === 'guest' ? 'guest' : '');
  if (platformRole === 'guest') {
    return isLoopback
      ? '当前是游客模式，请先切换到演示账号或登录后再生成。'
      : '当前账号暂无创作权限，请先登录或切换到可创建账号后再试。';
  }

  return '当前账号暂无创作权限，请联系管理员开通创作权限后再试。';
}

export function buildInsufficientCreditsMessage(options: {
  permissionContext: PermissionContext | null;
  rechargeCapabilities: WalletRechargeCapabilities | null;
}) {
  const { permissionContext, rechargeCapabilities } = options;
  const canRecharge = permissionContext?.permissions.canRecharge === true;
  const hasDemoRecharge = rechargeCapabilities?.methods?.some((method) => method.demoMock.available) === true;
  const hasLiveRecharge = rechargeCapabilities?.methods?.some((method) => method.live.available) === true;

  if (!canRecharge) {
    return '当前账号余额不足，请联系管理员充值后重试。';
  }

  if (hasDemoRecharge && hasLiveRecharge) {
    return '当前账号余额不足，请前往充值页补充额度后重试。当前环境同时支持演示充值和真实支付。';
  }

  if (hasDemoRecharge) {
    return '当前账号余额不足，请前往充值页继续演示充值后重试。';
  }

  if (hasLiveRecharge) {
    return '当前账号余额不足，请前往充值页完成充值后重试。';
  }

  return '当前账号余额不足，请前往充值页补充额度后重试。';
}

function getDefaultProjectAssetType(node: NodeData): string {
  return node.type === NodeType.VIDEO ? 'video_ref' : 'style';
}

function buildProjectAssetDraftName(node: NodeData): string {
  const source = String(node.title || node.prompt || '').trim();
  if (!source) {
    return node.type === NodeType.VIDEO ? '画布视频结果' : '画布图片结果';
  }
  return source.length > 40 ? `${source.slice(0, 40)}...` : source;
}

export function buildProjectAssetSyncDraft(node: NodeData): CanvasProjectAssetSyncDraft | null {
  if (
    (node.type !== NodeType.IMAGE && node.type !== NodeType.VIDEO) ||
    node.status !== NodeStatus.SUCCESS ||
    !node.resultUrl
  ) {
    return null;
  }

  return {
    id: node.id,
    mediaKind: node.type === NodeType.VIDEO ? 'video' : 'image',
    previewUrl: node.type === NodeType.VIDEO ? (node.lastFrame || node.resultUrl) : node.resultUrl,
    mediaUrl: node.resultUrl,
    prompt: node.prompt || '',
    model: node.type === NodeType.VIDEO
      ? (node.videoModel || node.model || DEFAULT_XIAOLOU_IMAGE_TO_VIDEO_MODEL_ID)
      : normalizeCanvasImageModelId(node.imageModel || node.model || DEFAULT_XIAOLOU_TEXT_TO_IMAGE_MODEL_ID),
    aspectRatio: node.aspectRatio || 'Auto',
    sourceTaskId: null,
    defaultAssetType: getDefaultProjectAssetType(node),
    defaultName: buildProjectAssetDraftName(node),
    defaultDescription: node.prompt || '',
  };
}
