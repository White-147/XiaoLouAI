import {
  deleteCanvasProject,
  getCanvasProject,
  listCanvasProjects,
} from "./api/canvas";
import type {
  CanvasHostServices,
  HostCanvasProjectVersionInput,
} from "./runtime/integrations/canvasHostServices";
import {
  sanitizeCanvasGroupsForPersistence,
  sanitizeCanvasNodesForPersistence,
  sanitizePersistedCanvasString,
} from "./runtime/utils/canvasPersistence";
import { writeCanvasSessionProjectId } from "./canvasProjectSession";
import { normalizeCanvasDataForVersion } from "./canvasProjectSaveHelpers";

type Ref<T> = { current: T };

type CanvasProjectServices = Pick<
  CanvasHostServices,
  | "listProjects"
  | "loadProject"
  | "deleteProject"
  | "getCanvasProjectVersion"
  | "adoptCanvasProjectVersion"
  | "resetProject"
>;

type CanvasProjectServiceRefs = {
  actorIdRef: Ref<string | null>;
  canvasProjectIdRef: Ref<string | null>;
  canvasProjectUpdatedAtRef: Ref<string | null>;
  canvasProjectBaseTitleRef: Ref<string | null>;
  canvasProjectBaseDataRef: Ref<unknown>;
  canvasSaveBlockedRef: Ref<boolean>;
  canvasSaveConflictAlertedRef: Ref<boolean>;
  canvasProjectLoadPendingRef: Ref<boolean>;
  pendingCanvasProjectLoadIdRef: Ref<string | null>;
  lastLoadedProjectRequestKeyRef: Ref<string | null>;
};

function normalizeProjectForHost(project: Awaited<ReturnType<typeof getCanvasProject>>) {
  const raw = project.canvasData as
    | { nodes?: unknown[]; groups?: unknown[]; viewport?: { x: number; y: number; zoom: number } }
    | null;
  const sanitizedNodes = sanitizeCanvasNodesForPersistence((raw?.nodes as any) || []);
  const sanitizedGroups = sanitizeCanvasGroupsForPersistence((raw?.groups as any) || []);
  const sanitizedThumbnail = sanitizePersistedCanvasString(project.thumbnailUrl) ?? null;
  return {
    id: project.id,
    title: project.title,
    thumbnailUrl: sanitizedThumbnail,
    createdAt: project.createdAt || "",
    updatedAt: project.updatedAt || "",
    canvasData: raw
      ? ({
          nodes: sanitizedNodes,
          groups: sanitizedGroups,
          viewport: raw.viewport,
        } as {
          nodes: unknown[];
          groups: unknown[];
          viewport: { x: number; y: number; zoom: number };
        })
      : null,
  };
}

export function createCanvasHostProjectService(
  refs: CanvasProjectServiceRefs,
): CanvasProjectServices {
  const adoptCanvasProjectVersion = (project: HostCanvasProjectVersionInput) => {
    const canvasData = project.canvasData
      ? normalizeCanvasDataForVersion(project.canvasData)
      : (
          Array.isArray(project.nodes) ||
          Array.isArray(project.groups) ||
          project.viewport
        )
        ? normalizeCanvasDataForVersion({
            nodes: project.nodes,
            groups: project.groups,
            viewport: project.viewport,
          })
        : null;

    if (project.id) {
      refs.canvasProjectIdRef.current = project.id;
      writeCanvasSessionProjectId(refs.actorIdRef.current, project.id);
    }
    if (typeof project.updatedAt === "string") {
      refs.canvasProjectUpdatedAtRef.current = project.updatedAt || null;
    }
    if (typeof project.title === "string") {
      refs.canvasProjectBaseTitleRef.current = project.title || null;
    }
    if (canvasData) {
      refs.canvasProjectBaseDataRef.current = canvasData;
    }
    refs.canvasSaveBlockedRef.current = false;
    refs.canvasSaveConflictAlertedRef.current = false;
  };

  return {
    async listProjects() {
      const response = await listCanvasProjects();
      return { items: response.items };
    },

    async loadProject(id) {
      const project = await getCanvasProject(id);
      return normalizeProjectForHost(project);
    },

    async deleteProject(id) {
      await deleteCanvasProject(id);
      return { deleted: true };
    },

    getCanvasProjectVersion() {
      return {
        id: refs.canvasProjectIdRef.current,
        title: refs.canvasProjectBaseTitleRef.current,
        updatedAt: refs.canvasProjectUpdatedAtRef.current,
        canvasData: (refs.canvasProjectBaseDataRef.current as any) || null,
      };
    },

    adoptCanvasProjectVersion(project) {
      adoptCanvasProjectVersion(project);
    },

    resetProject() {
      refs.canvasProjectIdRef.current = null;
      refs.canvasProjectUpdatedAtRef.current = null;
      refs.canvasProjectBaseTitleRef.current = null;
      refs.canvasProjectBaseDataRef.current = null;
      refs.canvasSaveBlockedRef.current = false;
      refs.canvasSaveConflictAlertedRef.current = false;
      refs.canvasProjectLoadPendingRef.current = false;
      refs.pendingCanvasProjectLoadIdRef.current = null;
      refs.lastLoadedProjectRequestKeyRef.current = null;
      writeCanvasSessionProjectId(refs.actorIdRef.current, null);
      console.log("[CanvasCreate] Canvas project reset (new canvas)");
    },
  };
}
