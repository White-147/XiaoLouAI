import { describe, expect, it } from 'vitest';
import { NodeStatus, NodeType, type NodeData } from '../types';
import {
  sanitizeCanvasNodeForPersistence,
  sanitizePersistedCanvasString,
  toStableLocalObjectContentUrl,
} from './canvasPersistence';

const signedFrontendObjectUrl =
  'http://127.0.0.1:4100/xiaolou-staging/media%2Ffrontend%2Fsynthetic-actor%2Freference.png?xiaolou_purpose=read&expires=1';

const stableFrontendObjectUrl =
  '/api/media/object-content/xiaolou-staging/media/frontend/synthetic-actor/reference.png';

describe('canvasPersistence media URL sanitising', () => {
  it('rewrites local object-storage signed read URLs to stable object-content URLs', () => {
    expect(toStableLocalObjectContentUrl(signedFrontendObjectUrl)).toBe(stableFrontendObjectUrl);
    expect(sanitizePersistedCanvasString(signedFrontendObjectUrl)).toBe(stableFrontendObjectUrl);
  });

  it('keeps image nodes successful when only the persisted URL shape changes', () => {
    const node: NodeData = {
      id: 'image-1',
      type: NodeType.IMAGE,
      x: 0,
      y: 0,
      prompt: '',
      status: NodeStatus.SUCCESS,
      resultUrl: signedFrontendObjectUrl,
      model: 'gemini',
      aspectRatio: '1:1',
      resolution: '1024',
    };

    const sanitized = sanitizeCanvasNodeForPersistence(node);

    expect(sanitized.resultUrl).toBe(stableFrontendObjectUrl);
    expect(sanitized.status).toBe(NodeStatus.SUCCESS);
  });

  it('does not rewrite non-media signed object URLs', () => {
    const signedPrivateUrl =
      'http://127.0.0.1:4100/xiaolou-staging/private%2Fsecret.png?xiaolou_purpose=read&expires=1';

    expect(toStableLocalObjectContentUrl(signedPrivateUrl)).toBeNull();
    expect(sanitizePersistedCanvasString(signedPrivateUrl)).toBe(signedPrivateUrl);
  });
});
