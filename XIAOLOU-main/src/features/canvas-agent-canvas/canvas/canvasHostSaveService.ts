import {
  getCanvasProject,
  saveCanvasProject,
  uploadFile,
} from "./api/canvas";
import { generateGridThumbnail } from "../../../lib/grid-thumbnail";
import {
  notifyCanvasProjectLoad,
  type CanvasHostServices,
  type HostSaveWorkflow,
} from "./runtime/integrations/canvasHostServices";
import {
  defaultCanvasUploadDeps,
  sanitizeCanvasGroupsForPersistence,
  sanitizeCanvasNodesForCloudSave,
  sanitizeCanvasNodesForPersistence,
  sanitizePersistedCanvasString,
} from "./runtime/utils/canvasPersistence";
import {
  buildCanvasProjectSnapshot,
  mergeCanvasProjectSnapshots,
} from "./runtime/utils/canvasProjectMerge";
import { resolveAbsoluteAssetUrl } from "./canvasBridgeMedia";
import { writeCanvasSessionProjectId } from "./canvasProjectSession";
import {
  isCanvasSaveConflictError,
  normalizeCanvasDataForVersion,
} from "./canvasProjectSaveHelpers";

type Ref<T> = { current: T };

type CanvasSaveServices = Pick<CanvasHostServices, "saveCanvas">;

type CanvasSaveServiceRefs = {
  actorIdRef: Ref<string | null>;
  canvasProjectIdRef: Ref<string | null>;
  canvasProjectUpdatedAtRef: Ref<string | null>;
  canvasProjectBaseTitleRef: Ref<string | null>;
  canvasProjectBaseDataRef: Ref<unknown>;
  canvasSaveQueueRef: Ref<Promise<void>>;
  canvasSaveBlockedRef: Ref<boolean>;
  canvasSaveConflictAlertedRef: Ref<boolean>;
  canvasProjectLoadPendingRef: Ref<boolean>;
  pendingCanvasProjectLoadIdRef: Ref<string | null>;
};

export function createCanvasHostSaveService(refs: CanvasSaveServiceRefs): CanvasSaveServices {
  return {
    saveCanvas(workflow: HostSaveWorkflow, thumbnailImageUrls: string[]) {
      refs.canvasSaveQueueRef.current = refs.canvasSaveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (refs.canvasSaveBlockedRef.current) return;
          const targetCanvasProjectId =
            refs.pendingCanvasProjectLoadIdRef.current || refs.canvasProjectIdRef.current;
          if (refs.canvasProjectLoadPendingRef.current && targetCanvasProjectId) {
            console.log(
              "[CanvasCreate] Skip canvas save while target project is loading:",
              targetCanvasProjectId,
            );
            return;
          }
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
                console.warn("[CanvasCreate] Thumbnail generation failed:", thumbErr);
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
            const localCanvasData = {
              nodes: persistNodes,
              groups: persistGroups,
              viewport: workflow.viewport,
            };
            let saved;
            let shouldNotifyMergedCanvas = false;
            try {
              saved = await saveCanvasProject({
                id: targetCanvasProjectId || undefined,
                expectedUpdatedAt: refs.canvasProjectUpdatedAtRef.current || undefined,
                baseTitle: refs.canvasProjectBaseTitleRef.current || undefined,
                baseCanvasData: refs.canvasProjectBaseDataRef.current ?? undefined,
                title: workflow.title || "未命名画布项目",
                thumbnailUrl: persistThumbnailUrl,
                canvasData: localCanvasData,
              });
            } catch (saveErr) {
              if (!targetCanvasProjectId || !isCanvasSaveConflictError(saveErr)) {
                throw saveErr;
              }

              const remoteProject = await getCanvasProject(targetCanvasProjectId);
              const remoteCanvasData = normalizeCanvasDataForVersion(remoteProject.canvasData);
              const baseCanvasData = normalizeCanvasDataForVersion(refs.canvasProjectBaseDataRef.current);
              const mergedSnapshot = mergeCanvasProjectSnapshots(
                buildCanvasProjectSnapshot({
                  title: refs.canvasProjectBaseTitleRef.current || remoteProject.title,
                  nodes: baseCanvasData.nodes,
                  groups: baseCanvasData.groups,
                  viewport: baseCanvasData.viewport,
                }),
                buildCanvasProjectSnapshot({
                  title: workflow.title || "Untitled",
                  nodes: persistNodes,
                  groups: persistGroups,
                  viewport: workflow.viewport,
                }),
                buildCanvasProjectSnapshot({
                  title: remoteProject.title,
                  nodes: remoteCanvasData.nodes,
                  groups: remoteCanvasData.groups,
                  viewport: remoteCanvasData.viewport,
                }),
              );

              localCanvasData.nodes = mergedSnapshot.nodes;
              localCanvasData.groups = mergedSnapshot.groups;
              localCanvasData.viewport = mergedSnapshot.viewport;
              shouldNotifyMergedCanvas = true;

              saved = await saveCanvasProject({
                id: targetCanvasProjectId,
                expectedUpdatedAt: remoteProject.updatedAt || undefined,
                baseTitle: remoteProject.title || undefined,
                baseCanvasData: remoteCanvasData,
                title: mergedSnapshot.title || "Untitled",
                thumbnailUrl: persistThumbnailUrl,
                canvasData: localCanvasData,
              });
            }
            refs.canvasProjectIdRef.current = saved.id;
            refs.canvasProjectUpdatedAtRef.current = saved.updatedAt || null;
            refs.canvasProjectBaseTitleRef.current = saved.title || null;
            refs.canvasProjectBaseDataRef.current = saved.canvasData ?? null;
            refs.canvasSaveBlockedRef.current = false;
            refs.canvasSaveConflictAlertedRef.current = false;
            // Persist so next mount re-uses the same project (no duplicate creation)
            writeCanvasSessionProjectId(refs.actorIdRef.current, saved.id);
            if (shouldNotifyMergedCanvas) {
              const savedCanvasData = normalizeCanvasDataForVersion(saved.canvasData || localCanvasData);
              notifyCanvasProjectLoad({
                id: saved.id,
                title: saved.title,
                updatedAt: saved.updatedAt || undefined,
                nodes: savedCanvasData.nodes,
                groups: savedCanvasData.groups,
                viewport: savedCanvasData.viewport,
              });
            }
            console.log("[CanvasCreate] Canvas project saved:", saved.id);
          } catch (err) {
            if (isCanvasSaveConflictError(err)) {
              refs.canvasSaveBlockedRef.current = true;
              if (!refs.canvasSaveConflictAlertedRef.current) {
                refs.canvasSaveConflictAlertedRef.current = true;
                window.alert(
                  "当前画布项目已在其他页面更新，且本地修改无法安全自动合并。为避免覆盖最新内容，已暂停自动保存。请刷新后再继续操作。",
                );
              }
              throw err;
            }
            console.warn("[CanvasCreate] Failed to save canvas project:", err);
            throw err;
          }
        });
      return refs.canvasSaveQueueRef.current;
    },
  };
}
