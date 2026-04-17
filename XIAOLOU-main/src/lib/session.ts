import { useEffect, useState } from "react";
import { getCurrentActorId, useActorId } from "./actor-session";
import { createProject, getMe, listProjects } from "./api";

export const DEFAULT_PROJECT_ID = "proj_demo_001";
const STORAGE_KEY = "xiaolou-current-project-id";
const SCRIPT_DRAFT_KEY_PREFIX = "xiaolou-script-draft:";
const DEMO_FALLBACK_ACTOR_IDS = new Set([
  "guest",
  "user_demo_001",
  "user_member_001",
  "ops_demo_001",
  "root_demo_001",
]);

function normalizeProjectId(projectId: string | null | undefined) {
  const normalizedProjectId = typeof projectId === "string" ? projectId.trim() : "";
  return normalizedProjectId || DEFAULT_PROJECT_ID;
}

function getActorProjectStorageKey(actorId: string | null | undefined) {
  const normalizedActorId = typeof actorId === "string" ? actorId.trim() : "";
  return `${STORAGE_KEY}:${normalizedActorId || "guest"}`;
}

export function getCurrentProjectId(actorId = getCurrentActorId()) {
  if (typeof window === "undefined") {
    return DEFAULT_PROJECT_ID;
  }

  const actorScopedValue = window.localStorage.getItem(getActorProjectStorageKey(actorId));
  const legacyValue = window.localStorage.getItem(STORAGE_KEY);
  return normalizeProjectId(actorScopedValue || legacyValue);
}

export function setCurrentProjectId(projectId: string, actorId = getCurrentActorId()) {
  if (typeof window === "undefined") return;
  const normalizedProjectId = normalizeProjectId(projectId);
  window.localStorage.setItem(STORAGE_KEY, normalizedProjectId);
  window.localStorage.setItem(getActorProjectStorageKey(actorId), normalizedProjectId);
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
  const [projectId, setProjectIdState] = useState(() => getCurrentProjectId(actorId));

  useEffect(() => {
    let active = true;

    const syncProjectId = async () => {
      const storedProjectId = getCurrentProjectId(actorId);

      try {
        const projectResponse = await listProjects();
        const availableProjects = projectResponse.items;
        const availableProjectIds = availableProjects.map((item) => item.id);

        if (!availableProjectIds.length) {
          const currentActorId = getCurrentActorId();

          if (DEMO_FALLBACK_ACTOR_IDS.has(currentActorId)) {
            setCurrentProjectId(DEFAULT_PROJECT_ID, actorId);
            if (active) {
              setProjectIdState(DEFAULT_PROJECT_ID);
            }
            return;
          }

          const me = await getMe();
          if (!me.permissions.canCreateProject) {
            if (active) {
              setProjectIdState(storedProjectId);
            }
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
              ? `企业资产项目 ${timestamp}`
              : `个人资产项目 ${timestamp}`,
            summary: shouldCreateOrganizationProject
              ? "为当前企业成员自动初始化的共享资产项目。"
              : "为当前账号自动初始化的个人资产项目。",
            ownerType: shouldCreateOrganizationProject ? "organization" : "personal",
            organizationId: shouldCreateOrganizationProject ? me.currentOrganizationId || undefined : undefined,
            budgetLimitCredits: shouldCreateOrganizationProject ? 2400 : 600,
          });

          setCurrentProjectId(createdProject.id, actorId);
          if (active) {
            setProjectIdState(createdProject.id);
          }
          return;
        }

        const nextProjectId =
          availableProjectIds.find((item) => item === storedProjectId) ||
          availableProjectIds[0] ||
          DEFAULT_PROJECT_ID;

        setCurrentProjectId(nextProjectId, actorId);
        if (active) {
          setProjectIdState(nextProjectId);
        }
      } catch {
        if (active) {
          setProjectIdState(storedProjectId);
        }
      }
    };

    void syncProjectId();

    return () => {
      active = false;
    };
  }, [actorId]);

  const update = (nextProjectId: string) => {
    const normalizedProjectId = normalizeProjectId(nextProjectId);
    setCurrentProjectId(normalizedProjectId, actorId);
    setProjectIdState(normalizedProjectId);
  };

  return [projectId, update] as const;
}
