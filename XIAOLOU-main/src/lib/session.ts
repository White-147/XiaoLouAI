import { useEffect, useMemo, useState } from "react";
import { getCurrentActorId, useActorId } from "./actor-session";
import { createProject, getMe, listProjects } from "./api";

export const DEFAULT_PROJECT_ID = "proj_demo_001";
const LEGACY_STORAGE_KEY = "xiaolou-current-project-id";
const PROJECT_CONTEXT_STORAGE_KEY = "xiaolou-current-project-context";
const SCRIPT_DRAFT_KEY_PREFIX = "xiaolou-script-draft:";
const DEMO_FALLBACK_ACTOR_IDS = new Set([
  "guest",
  "user_demo_001",
  "user_member_001",
  "ops_demo_001",
  "root_demo_001",
]);

type StoredProjectContext = {
  actorId: string;
  projectId: string;
};

export type CurrentProjectContext = {
  actorId: string;
  isReady: boolean;
};

function normalizeProjectId(projectId: string | null | undefined) {
  const normalizedProjectId = typeof projectId === "string" ? projectId.trim() : "";
  return normalizedProjectId || DEFAULT_PROJECT_ID;
}

function normalizeActorId(actorId: string | null | undefined) {
  const normalizedActorId = typeof actorId === "string" ? actorId.trim() : "";
  return normalizedActorId || "guest";
}

function getActorProjectStorageKey(actorId: string | null | undefined) {
  return `${LEGACY_STORAGE_KEY}:${normalizeActorId(actorId)}`;
}

function readStoredProjectContext(): StoredProjectContext | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(PROJECT_CONTEXT_STORAGE_KEY);
    if (!rawValue) return null;
    const parsed = JSON.parse(rawValue) as Partial<StoredProjectContext>;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      actorId: normalizeActorId(parsed.actorId),
      projectId: normalizeProjectId(parsed.projectId),
    };
  } catch {
    return null;
  }
}

function writeStoredProjectContext(projectId: string, actorId: string) {
  if (typeof window === "undefined") {
    return;
  }

  const payload: StoredProjectContext = {
    actorId: normalizeActorId(actorId),
    projectId: normalizeProjectId(projectId),
  };
  window.localStorage.setItem(PROJECT_CONTEXT_STORAGE_KEY, JSON.stringify(payload));
}

export function getCurrentProjectId(actorId = getCurrentActorId()) {
  if (typeof window === "undefined") {
    return DEFAULT_PROJECT_ID;
  }

  const normalizedActorId = normalizeActorId(actorId);
  const actorScopedValue = window.localStorage.getItem(getActorProjectStorageKey(normalizedActorId));
  if (actorScopedValue) {
    return normalizeProjectId(actorScopedValue);
  }

  const storedContext = readStoredProjectContext();
  if (storedContext?.actorId === normalizedActorId) {
    return normalizeProjectId(storedContext.projectId);
  }

  return DEFAULT_PROJECT_ID;
}

export function setCurrentProjectId(projectId: string, actorId = getCurrentActorId()) {
  if (typeof window === "undefined") return;
  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedActorId = normalizeActorId(actorId);
  window.localStorage.setItem(getActorProjectStorageKey(normalizedActorId), normalizedProjectId);
  writeStoredProjectContext(normalizedProjectId, normalizedActorId);
  window.localStorage.removeItem(LEGACY_STORAGE_KEY);
}

function getScriptDraftStorageKey(projectId: string) {
  return `${SCRIPT_DRAFT_KEY_PREFIX}${projectId}`;
}

export function getScriptDraft(projectId: string) {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(getScriptDraftStorageKey(projectId));
}

export function setScriptDraft(projectId: string, content: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(getScriptDraftStorageKey(projectId), content);
}

export function clearScriptDraft(projectId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(getScriptDraftStorageKey(projectId));
}

export function useCurrentProjectId() {
  const actorId = useActorId();
  const normalizedActorId = useMemo(() => normalizeActorId(actorId), [actorId]);
  const [projectId, setProjectIdState] = useState(() => getCurrentProjectId(normalizedActorId));
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let active = true;
    const storedProjectId = getCurrentProjectId(normalizedActorId);
    setProjectIdState(storedProjectId);
    setIsReady(false);

    const syncProjectId = async () => {
      try {
        const projectResponse = await listProjects();
        if (!active) return;

        const availableProjects = projectResponse.items;
        const availableProjectIds = availableProjects.map((item) => item.id);

        if (!availableProjectIds.length) {
          if (DEMO_FALLBACK_ACTOR_IDS.has(normalizedActorId)) {
            if (!active) return;
            setCurrentProjectId(DEFAULT_PROJECT_ID, normalizedActorId);
            setProjectIdState(DEFAULT_PROJECT_ID);
            setIsReady(true);
            return;
          }

          const me = await getMe();
          if (!active) return;

          if (!me.permissions.canCreateProject) {
            setProjectIdState(storedProjectId);
            setIsReady(true);
            return;
          }

          const timestamp = new Date().toLocaleString("zh-CN", {
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          });
          const shouldCreateOrganizationProject = Boolean(me.currentOrganizationId);
          const createdProject = await createProject({
            title: shouldCreateOrganizationProject
              ? `浼佷笟璧勪骇椤圭洰 ${timestamp}`
              : `涓汉璧勪骇椤圭洰 ${timestamp}`,
            summary: shouldCreateOrganizationProject
              ? "涓哄綋鍓嶄紒涓氭垚鍛樿嚜鍔ㄥ垵濮嬪寲鐨勫叡浜祫浜ч」鐩€?"
              : "涓哄綋鍓嶈处鍙疯嚜鍔ㄥ垵濮嬪寲鐨勪釜浜鸿祫浜ч」鐩€?",
            ownerType: shouldCreateOrganizationProject ? "organization" : "personal",
            organizationId: shouldCreateOrganizationProject ? me.currentOrganizationId || undefined : undefined,
          });

          if (!active) return;

          setCurrentProjectId(createdProject.id, normalizedActorId);
          setProjectIdState(createdProject.id);
          setIsReady(true);
          return;
        }

        const nextProjectId =
          availableProjectIds.find((item) => item === storedProjectId) ||
          availableProjectIds[0] ||
          DEFAULT_PROJECT_ID;

        if (!active) return;

        setCurrentProjectId(nextProjectId, normalizedActorId);
        setProjectIdState(nextProjectId);
        setIsReady(true);
      } catch {
        if (active) {
          setProjectIdState(storedProjectId);
          setIsReady(true);
        }
      }
    };

    void syncProjectId();

    return () => {
      active = false;
    };
  }, [normalizedActorId]);

  const update = (nextProjectId: string) => {
    const normalizedProjectId = normalizeProjectId(nextProjectId);
    setCurrentProjectId(normalizedProjectId, normalizedActorId);
    setProjectIdState(normalizedProjectId);
    setIsReady(true);
  };

  return [projectId, update, { actorId: normalizedActorId, isReady } satisfies CurrentProjectContext] as const;
}
