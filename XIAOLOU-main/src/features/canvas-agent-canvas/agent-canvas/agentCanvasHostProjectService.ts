import {
  deleteAgentCanvasProject,
  getAgentCanvasProject,
  listAgentCanvasProjects,
} from "./api/agent-canvas";
import type { CanvasHostServices } from "./runtime/integrations/canvasHostServices";
import {
  sanitizeCanvasGroupsForPersistence,
  sanitizeCanvasNodesForPersistence,
  sanitizePersistedCanvasString,
} from "./runtime/utils/canvasPersistence";
import { writeCanvasSessionProjectId } from "./canvasProjectSession";

type Ref<T> = { current: T };

type AgentCanvasProjectServices = Pick<
  CanvasHostServices,
  | "listProjects"
  | "loadProject"
  | "deleteProject"
  | "resetProject"
>;

type AgentCanvasProjectServiceRefs = {
  actorIdRef: Ref<string | null>;
  canvasProjectIdRef: Ref<string | null>;
  canvasProjectUpdatedAtRef: Ref<string | null>;
  canvasProjectBaseTitleRef: Ref<string | null>;
  canvasProjectBaseDataRef: Ref<unknown>;
  canvasSaveBlockedRef: Ref<boolean>;
  canvasSaveConflictAlertedRef: Ref<boolean>;
};

function normalizeProjectForHost(project: Awaited<ReturnType<typeof getAgentCanvasProject>>) {
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
    agentContext: project.agentContext ?? null,
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

export function createAgentCanvasHostProjectService(
  refs: AgentCanvasProjectServiceRefs,
): AgentCanvasProjectServices {
  return {
    async listProjects() {
      const response = await listAgentCanvasProjects();
      return { items: response.items };
    },

    async loadProject(id) {
      const project = await getAgentCanvasProject(id);
      return normalizeProjectForHost(project);
    },

    async deleteProject(id) {
      await deleteAgentCanvasProject(id);
      return { deleted: true };
    },

    resetProject() {
      refs.canvasProjectIdRef.current = null;
      refs.canvasProjectUpdatedAtRef.current = null;
      refs.canvasProjectBaseTitleRef.current = null;
      refs.canvasProjectBaseDataRef.current = null;
      refs.canvasSaveBlockedRef.current = false;
      refs.canvasSaveConflictAlertedRef.current = false;
      writeCanvasSessionProjectId(refs.actorIdRef.current, null);
      console.log("[AgentCanvasCreate] Canvas project reset (new canvas)");
    },
  };
}
