import {
  saveAgentCanvasProject,
  uploadFile,
} from "./api/agent-canvas";
import { generateGridThumbnail } from "../../../lib/grid-thumbnail";
import type {
  CanvasHostServices,
  HostSaveWorkflow,
} from "./runtime/integrations/canvasHostServices";
import {
  defaultCanvasUploadDeps,
  sanitizeCanvasGroupsForPersistence,
  sanitizeCanvasNodesForCloudSave,
  sanitizeCanvasNodesForPersistence,
  sanitizePersistedCanvasString,
} from "./runtime/utils/canvasPersistence";
import { resolveAbsoluteAssetUrl } from "./canvasBridgeMedia";
import {
  writeAgentCanvasProjectIdToSearch,
  writeCanvasSessionProjectId,
} from "./canvasProjectSession";

type Ref<T> = { current: T };

type AgentCanvasSaveServices = Pick<CanvasHostServices, "saveCanvas">;

type AgentCanvasSaveServiceRefs = {
  actorIdRef: Ref<string | null>;
  canvasProjectIdRef: Ref<string | null>;
  canvasProjectUpdatedAtRef: Ref<string | null>;
  canvasProjectBaseTitleRef: Ref<string | null>;
  canvasProjectBaseDataRef: Ref<unknown>;
  canvasSaveQueueRef: Ref<Promise<void>>;
  canvasSaveBlockedRef: Ref<boolean>;
  canvasSaveConflictAlertedRef: Ref<boolean>;
};

export function createAgentCanvasHostSaveService(
  refs: AgentCanvasSaveServiceRefs,
): AgentCanvasSaveServices {
  return {
    saveCanvas(workflow: HostSaveWorkflow, thumbnailImageUrls: string[]) {
      refs.canvasSaveQueueRef.current = refs.canvasSaveQueueRef.current.then(async () => {
        if (refs.canvasSaveBlockedRef.current) return;
        try {
          let thumbnailUrl: string | undefined;
          const thumbUrls = thumbnailImageUrls
            .map(u => resolveAbsoluteAssetUrl(u))
            .filter(Boolean) as string[];
          if (thumbUrls.length > 0) {
            try {
              const blob = await generateGridThumbnail(thumbUrls);
              if (blob) {
                const file = new File([blob], `canvas-thumb-${Date.now()}.jpg`, { type: "image/jpeg" });
                const uploaded = await uploadFile(file, "canvas-thumbnail");
                thumbnailUrl = uploaded.url || uploaded.urlPath;
              }
            } catch (thumbErr) {
              console.warn("[AgentCanvasCreate] Thumbnail generation failed:", thumbErr);
            }
          }
          // Pre-save sanitisation. Step 1: async - upload any still-in-memory
          // data:/blob: URL in node fields so the snapshot never contains
          // multi-MB base64 strings. Step 2: sync - drop any poisoned value
          // that the uploader could not normalise (e.g. [truncated:...]).
          // See canvas/utils/canvasPersistence.ts for field coverage.
          const uploadDeps = await defaultCanvasUploadDeps();
          const asyncCleaned = await sanitizeCanvasNodesForCloudSave(
            (workflow.nodes as any) || [],
            (workflow.groups as any) || [],
            uploadDeps,
          );
          const persistNodes = sanitizeCanvasNodesForPersistence(asyncCleaned.nodes);
          const persistGroups = sanitizeCanvasGroupsForPersistence(asyncCleaned.groups);
          const persistThumbnailUrl = sanitizePersistedCanvasString(thumbnailUrl) ?? undefined;
          const saved = await saveAgentCanvasProject({
            id: refs.canvasProjectIdRef.current || undefined,
            expectedUpdatedAt: refs.canvasProjectUpdatedAtRef.current || undefined,
            baseTitle: refs.canvasProjectBaseTitleRef.current || undefined,
            baseCanvasData: refs.canvasProjectBaseDataRef.current ?? undefined,
            title: workflow.title || "未命名智能画布项目",
            thumbnailUrl: persistThumbnailUrl,
            canvasData: {
              nodes: persistNodes,
              groups: persistGroups,
              viewport: workflow.viewport,
            },
            agentContext: workflow.agentContext ?? null,
          });
          refs.canvasProjectIdRef.current = saved.id;
          refs.canvasProjectUpdatedAtRef.current = saved.updatedAt || null;
          refs.canvasProjectBaseTitleRef.current = saved.title || null;
          refs.canvasProjectBaseDataRef.current = saved.canvasData ?? null;
          refs.canvasSaveBlockedRef.current = false;
          refs.canvasSaveConflictAlertedRef.current = false;
          // Persist so next mount re-uses the same project (no duplicate creation)
          writeCanvasSessionProjectId(refs.actorIdRef.current, saved.id);
          writeAgentCanvasProjectIdToSearch(saved.id);
          console.log("[AgentCanvasCreate] Canvas project saved:", saved.id);
        } catch (err) {
          if (err instanceof Error && /409|CONFLICT|updated elsewhere/i.test(err.message)) {
            refs.canvasSaveBlockedRef.current = true;
            if (!refs.canvasSaveConflictAlertedRef.current) {
              refs.canvasSaveConflictAlertedRef.current = true;
              window.alert(
                "当前画布项目已在其他页面更新，且本地修改无法安全自动合并。为避免覆盖最新内容，已暂停自动保存。请刷新后再继续操作。",
              );
            }
            return;
          }
          console.warn("[AgentCanvasCreate] Failed to save canvas project:", err);
        }
      });
      return refs.canvasSaveQueueRef.current;
    },
  };
}
