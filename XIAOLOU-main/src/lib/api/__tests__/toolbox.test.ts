import { describe, expect, it } from "vitest";
import type { PermissionContext, Task, ToolboxCapability } from "../../api";
import { resolveCurrentOwnerScope, type ControlOwnerScope } from "../../control-owner-scope";
import { createToolboxService } from "../../../features/toolbox/api/toolbox";
import {
  parseJsonBody,
  SYNTHETIC_ACTOR_ID,
  SYNTHETIC_CREATED_AT,
  SYNTHETIC_UPDATED_AT,
  type RequestCall,
  type RequestHandler,
} from "./synthetic-fixtures";

type ToolboxServiceDeps = Parameters<typeof createToolboxService>[0];

type RunType = "character_replace" | "motion_transfer" | "upscale_restore";

function createSyntheticCapability(overrides: Partial<ToolboxCapability> = {}): ToolboxCapability {
  return {
    code: "synthetic_toolbox_capability",
    name: "Synthetic toolbox capability",
    status: "local",
    queue: "canonical-jobs",
    description: "Synthetic fixture only.",
    ...overrides,
  };
}

function createSyntheticTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "synthetic-task",
    type: "toolbox.synthetic",
    domain: "toolbox",
    projectId: "synthetic-project",
    storyboardId: "synthetic-storyboard",
    actorId: SYNTHETIC_ACTOR_ID,
    actionCode: "synthetic_toolbox_action",
    walletId: null,
    status: "queued",
    progressPercent: 0,
    currentStage: "queued",
    etaSeconds: 0,
    inputSummary: "Synthetic toolbox input",
    outputSummary: null,
    metadata: {},
    createdAt: SYNTHETIC_CREATED_AT,
    updatedAt: SYNTHETIC_UPDATED_AT,
    ...overrides,
  };
}

function createPersonalPermissionContext(actorId = SYNTHETIC_ACTOR_ID): PermissionContext {
  return {
    actor: {
      id: actorId,
      displayName: "Synthetic User",
      email: "synthetic.user@example.test",
      avatar: null,
      platformRole: "customer",
      status: "active",
      defaultOrganizationId: null,
    },
    platformRole: "customer",
    organizations: [],
    currentOrganizationId: null,
    currentOrganizationRole: null,
    permissions: {
      canCreateProject: true,
      canRecharge: true,
      canUseEnterprise: false,
      canManageOrganization: false,
      canManageOps: false,
      canManageSystem: false,
    },
  };
}

function createOrganizationPermissionContext(organizationId = "synthetic-organization"): PermissionContext {
  const context = createPersonalPermissionContext();
  return {
    ...context,
    actor: {
      ...context.actor,
      defaultOrganizationId: organizationId,
    },
    organizations: [
      {
        id: organizationId,
        name: "Synthetic Organization",
        role: "enterprise_admin",
        membershipRole: "admin",
        status: "active",
      },
    ],
    currentOrganizationId: organizationId,
    currentOrganizationRole: "enterprise_admin",
    permissions: {
      ...context.permissions,
      canUseEnterprise: true,
      canManageOrganization: true,
    },
  };
}

function createServiceHarness({
  actorId = SYNTHETIC_ACTOR_ID,
  clientId = "synthetic-toolbox-client",
  fallbackCapabilities = [createSyntheticCapability({ code: "synthetic_fallback_capability" })],
  handler = () => ({}),
  permissionContext = createPersonalPermissionContext(actorId),
}: {
  actorId?: string;
  clientId?: string;
  fallbackCapabilities?: ToolboxCapability[];
  handler?: RequestHandler;
  permissionContext?: PermissionContext;
} = {}) {
  const calls: RequestCall[] = [];
  const clientIdPrefixes: string[] = [];
  const errors: Array<{ message: string; options?: { code?: string; status?: number } }> = [];
  const fallbackCalls: string[] = [];
  const mappedJobs: Record<string, unknown>[] = [];
  const ownerScopeCalls: ControlOwnerScope[] = [];
  const readRecordCalls: string[][] = [];
  const readStringCalls: string[][] = [];

  const deps: ToolboxServiceDeps = {
    controlApiJsonRequest: async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      return (await handler(path, init)) as T;
    },
    getCurrentActorId: () => actorId,
    resolveCurrentOwnerScope: () => {
      const ownerScope = resolveCurrentOwnerScope(permissionContext);
      ownerScopeCalls.push(ownerScope);
      return ownerScope;
    },
    createClientId: (prefix) => {
      clientIdPrefixes.push(prefix);
      return clientId;
    },
    createApiRequestError: (message, options) => {
      errors.push({ message, options });
      return new Error(`${options?.code ?? "TOOLBOX_ERROR"}:${message}`);
    },
    readString: (record, ...keys) => {
      readStringCalls.push(keys);
      for (const key of keys) {
        const value = record[key];
        if (typeof value === "string") {
          return value;
        }
      }
      return null;
    },
    readRecord: (record, ...keys) => {
      readRecordCalls.push(keys);
      for (const key of keys) {
        const value = record[key];
        if (value && typeof value === "object" && !Array.isArray(value)) {
          return value as Record<string, unknown>;
        }
      }
      return null;
    },
    mapControlJobToTask: (job) => {
      mappedJobs.push(job);
      return createSyntheticTask({
        id: typeof job.id === "string" ? job.id : "synthetic-mapped-task",
        status: typeof job.status === "string" ? job.status : "queued",
        metadata: {
          controlJob: job,
        },
      });
    },
    getFallbackToolboxCapabilities: () => {
      fallbackCalls.push("toolbox");
      return fallbackCapabilities;
    },
  };

  return {
    calls,
    clientIdPrefixes,
    errors,
    fallbackCalls,
    mappedJobs,
    ownerScopeCalls,
    readRecordCalls,
    readStringCalls,
    service: createToolboxService(deps),
  };
}

describe("createToolboxService", () => {
  it("reads toolbox capabilities through stable routes and synthetic fallback capabilities", async () => {
    const capability = createSyntheticCapability({
      code: "synthetic_storyboard",
      name: "Synthetic storyboard",
    });
    const aggregateCapabilities = {
      service: "control-api",
      mode: "windows-native",
      implementedDomains: ["toolbox"],
      toolbox: [capability],
    };
    const harness = createServiceHarness({
      handler: (path) => {
        if (path === "/api/toolbox/capabilities") {
          return {
            items: [capability],
            stagingArea: ["synthetic-stage"],
          };
        }
        if (path === "/api/capabilities") {
          return aggregateCapabilities;
        }

        return {};
      },
    });

    await expect(harness.service.getToolboxCapabilities()).resolves.toEqual({
      items: [capability],
      stagingArea: ["synthetic-stage"],
    });
    await expect(harness.service.getCapabilities()).resolves.toBe(aggregateCapabilities);
    expect(harness.calls).toEqual([
      {
        path: "/api/toolbox/capabilities",
        init: undefined,
      },
      {
        path: "/api/capabilities",
        init: undefined,
      },
    ]);
    expect(harness.fallbackCalls).toEqual([]);

    const fallbackCapability = createSyntheticCapability({ code: "synthetic_fallback" });
    const fallbackHarness = createServiceHarness({
      fallbackCapabilities: [fallbackCapability],
      handler: () => ({
        stagingArea: "not-an-array",
      }),
    });

    await expect(fallbackHarness.service.getToolboxCapabilities()).resolves.toEqual({
      items: [fallbackCapability],
      stagingArea: [],
    });
    expect(fallbackHarness.fallbackCalls).toEqual(["toolbox"]);
    expect(fallbackHarness.calls).toEqual([
      {
        path: "/api/toolbox/capabilities",
        init: undefined,
      },
    ]);
  });

  it("queues text translation with default personal owner scope body idempotency", async () => {
    const { calls, clientIdPrefixes, ownerScopeCalls, readStringCalls, service } = createServiceHarness({
      handler: (path) => {
        expect(path).toBe("/api/toolbox/translate-text");
        return {
          text: "Synthetic translated text",
          target_lang: "en",
          taskId: "synthetic-translate-task",
        };
      },
    });

    await expect(service.translateText("Synthetic source text", "zh")).resolves.toEqual({
      text: "Synthetic translated text",
      targetLang: "en",
      taskId: "synthetic-translate-task",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/api/toolbox/translate-text");
    expect(calls[0].init?.method).toBe("POST");
    expect(parseJsonBody(calls[0])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-actor",
      regionCode: "CN",
      currency: "CNY",
      text: "Synthetic source text",
      targetLang: "zh",
      idempotencyKey: "frontend:synthetic-actor:translate-text:synthetic-toolbox-client",
    });
    expect(clientIdPrefixes).toEqual(["toolbox"]);
    expect(ownerScopeCalls).toEqual([
      {
        accountOwnerType: "user",
        accountOwnerId: "synthetic-actor",
        organizationId: null,
        organizationRole: null,
        source: "personal-default",
      },
    ]);
    expect(readStringCalls).toContainEqual(["targetLang", "target_lang"]);
  });

  it("queues storyboard grid generation and falls back to the requested model", async () => {
    const references = [
      {
        name: "synthetic-reference",
        url: "https://synthetic.example/media/reference.png",
      },
    ];
    const { calls, service } = createServiceHarness({
      actorId: "synthetic-storyboard-actor",
      clientId: "synthetic-storyboard-client",
      handler: (path) => {
        expect(path).toBe("/api/toolbox/storyboard-grid25");
        return {
          image_url: "https://synthetic.example/output/storyboard-grid.png",
          taskId: "synthetic-storyboard-task",
        };
      },
    });

    await expect(
      service.generateStoryboardGrid25("Synthetic plot text", {
        references,
        model: "synthetic-storyboard-model",
      }),
    ).resolves.toEqual({
      imageUrl: "https://synthetic.example/output/storyboard-grid.png",
      model: "synthetic-storyboard-model",
      taskId: "synthetic-storyboard-task",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/api/toolbox/storyboard-grid25");
    expect(calls[0].init?.method).toBe("POST");
    expect(parseJsonBody(calls[0])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-storyboard-actor",
      regionCode: "CN",
      currency: "CNY",
      plotText: "Synthetic plot text",
      references,
      model: "synthetic-storyboard-model",
      idempotencyKey: "frontend:synthetic-storyboard-actor:storyboard-grid25:synthetic-storyboard-client",
    });
  });

  it("queues reverse video prompt runs with organization owner scope and local fallback behavior", async () => {
    const { calls, ownerScopeCalls, service } = createServiceHarness({
      clientId: "synthetic-video-client",
      permissionContext: createOrganizationPermissionContext(),
      handler: (path) => {
        expect(path).toBe("/api/toolbox/video-reverse-prompt");
        return {
          taskId: "synthetic-video-task",
        };
      },
    });

    await expect(
      service.reverseVideoPrompt("https://synthetic.example/media/video.mp4", {
        prompt: "Synthetic requested prompt",
        model: "qwen3.5-omni-plus",
      }),
    ).resolves.toEqual({
      prompt: "Synthetic requested prompt",
      model: "qwen3.5-omni-plus",
      taskId: "synthetic-video-task",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/api/toolbox/video-reverse-prompt");
    expect(calls[0].init?.method).toBe("POST");
    expect(parseJsonBody(calls[0])).toEqual({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-organization",
      regionCode: "CN",
      currency: "CNY",
      videoUrl: "https://synthetic.example/media/video.mp4",
      prompt: "Synthetic requested prompt",
      model: "qwen3.5-omni-plus",
      idempotencyKey: "frontend:synthetic-actor:video-reverse-prompt:synthetic-video-client",
    });
    expect(ownerScopeCalls).toEqual([
      {
        accountOwnerType: "organization",
        accountOwnerId: "synthetic-organization",
        organizationId: "synthetic-organization",
        organizationRole: "enterprise_admin",
        source: "current-organization",
      },
    ]);

    const defaultHarness = createServiceHarness({
      handler: () => ({
        taskId: "synthetic-default-video-task",
      }),
    });
    await expect(
      defaultHarness.service.reverseVideoPrompt("https://synthetic.example/media/default-video.mp4"),
    ).resolves.toEqual({
      prompt: "Reverse prompt job queued: synthetic-default-video-task",
      model: "canonical-job",
      taskId: "synthetic-default-video-task",
    });
  });

  it("runs toolbox capability routes and maps canonical jobs into TaskAccepted", async () => {
    const routeByType: Record<RunType, string> = {
      character_replace: "/api/toolbox/character-replace",
      motion_transfer: "/api/toolbox/motion-transfer",
      upscale_restore: "/api/toolbox/upscale-restore",
    };
    const { calls, clientIdPrefixes, mappedJobs, ownerScopeCalls, readRecordCalls, service } = createServiceHarness({
      permissionContext: createOrganizationPermissionContext(),
      handler: (path) => {
        const runType = (Object.entries(routeByType).find(([, route]) => route === path)?.[0] ?? "unknown") as RunType;
        return {
          taskId: `synthetic-${runType}-task`,
          status: "accepted",
          job: {
            id: `synthetic-${runType}-job`,
            status: "running",
            job_type: "toolbox.run",
            payload: {
              type: runType,
            },
          },
        };
      },
    });

    const character = await service.runToolboxCapability("character_replace", {
      projectId: "synthetic-project",
      note: "Synthetic character replacement",
      target: "synthetic-target",
    });
    const motion = await service.runToolboxCapability("motion_transfer", {
      projectId: "synthetic-project",
      storyboardId: "synthetic-storyboard",
    });
    const upscale = await service.runToolboxCapability("upscale_restore", {
      projectId: "synthetic-project",
      target: "synthetic-upscale-target",
    });

    expect(character).toMatchObject({
      taskId: "synthetic-character_replace-task",
      status: "accepted",
      task: {
        id: "synthetic-character_replace-job",
        status: "running",
      },
    });
    expect(motion).toMatchObject({
      taskId: "synthetic-motion_transfer-task",
      status: "accepted",
      task: {
        id: "synthetic-motion_transfer-job",
        status: "running",
      },
    });
    expect(upscale).toMatchObject({
      taskId: "synthetic-upscale_restore-task",
      status: "accepted",
      task: {
        id: "synthetic-upscale_restore-job",
        status: "running",
      },
    });

    expect(calls.map((call) => call.path)).toEqual([
      "/api/toolbox/character-replace",
      "/api/toolbox/motion-transfer",
      "/api/toolbox/upscale-restore",
    ]);
    expect(calls.every((call) => call.init?.method === "POST")).toBe(true);
    expect(parseJsonBody(calls[0])).toEqual({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-organization",
      regionCode: "CN",
      currency: "CNY",
      projectId: "synthetic-project",
      note: "Synthetic character replacement",
      target: "synthetic-target",
      idempotencyKey: "frontend:synthetic-actor:character_replace:synthetic-toolbox-client",
    });
    expect(parseJsonBody(calls[1])).toEqual({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-organization",
      regionCode: "CN",
      currency: "CNY",
      projectId: "synthetic-project",
      storyboardId: "synthetic-storyboard",
      idempotencyKey: "frontend:synthetic-actor:motion_transfer:synthetic-toolbox-client",
    });
    expect(parseJsonBody(calls[2])).toEqual({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-organization",
      regionCode: "CN",
      currency: "CNY",
      projectId: "synthetic-project",
      target: "synthetic-upscale-target",
      idempotencyKey: "frontend:synthetic-actor:upscale_restore:synthetic-toolbox-client",
    });
    expect(clientIdPrefixes).toEqual(["toolbox", "toolbox", "toolbox"]);
    expect(ownerScopeCalls).toEqual([
      {
        accountOwnerType: "organization",
        accountOwnerId: "synthetic-organization",
        organizationId: "synthetic-organization",
        organizationRole: "enterprise_admin",
        source: "current-organization",
      },
      {
        accountOwnerType: "organization",
        accountOwnerId: "synthetic-organization",
        organizationId: "synthetic-organization",
        organizationRole: "enterprise_admin",
        source: "current-organization",
      },
      {
        accountOwnerType: "organization",
        accountOwnerId: "synthetic-organization",
        organizationId: "synthetic-organization",
        organizationRole: "enterprise_admin",
        source: "current-organization",
      },
    ]);
    expect(readRecordCalls).toEqual([["job"], ["job"], ["job"]]);
    expect(mappedJobs).toHaveLength(3);
  });

  it("reports missing canonical jobs through the synthetic error boundary", async () => {
    const { calls, errors, mappedJobs, service } = createServiceHarness({
      handler: () => ({
        taskId: "synthetic-missing-job-task",
        status: "accepted",
      }),
    });

    await expect(
      service.runToolboxCapability("character_replace", {
        projectId: "synthetic-project",
      }),
    ).rejects.toThrow("TOOLBOX_JOB_MISSING:Toolbox Control API did not return a canonical job");

    expect(calls).toHaveLength(1);
    expect(mappedJobs).toEqual([]);
    expect(errors).toEqual([
      {
        message: "Toolbox Control API did not return a canonical job",
        options: {
          code: "TOOLBOX_JOB_MISSING",
          status: 502,
        },
      },
    ]);
  });
});
