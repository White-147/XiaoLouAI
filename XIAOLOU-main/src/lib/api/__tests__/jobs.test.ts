import { describe, expect, it } from "vitest";
import { createJobsService } from "../jobs";
import type { ControlOwnerScope } from "../../control-owner-scope";
import {
  parseJsonBody,
  SYNTHETIC_ACTOR_ID,
  SYNTHETIC_CREATED_AT,
  SYNTHETIC_UPDATED_AT,
  type RequestCall,
  type RequestHandler,
} from "./synthetic-fixtures";

type JobsServiceDeps = Parameters<typeof createJobsService>[0];

function createSyntheticJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "synthetic-job",
    job_type: "synthetic.job",
    status: "queued",
    created_by_user_id: SYNTHETIC_ACTOR_ID,
    created_at: SYNTHETIC_CREATED_AT,
    updated_at: SYNTHETIC_UPDATED_AT,
    payload: {
      domain: "synthetic-domain",
      inputSummary: "Synthetic input",
    },
    result: {},
    ...overrides,
  };
}

function createServiceHarness({
  handler = () => createSyntheticJob(),
  notFoundError,
  ownerScope = createSyntheticOwnerScope(),
}: {
  handler?: RequestHandler;
  notFoundError?: unknown;
  ownerScope?: ControlOwnerScope;
} = {}) {
  const calls: RequestCall[] = [];
  const clientIdPrefixes: string[] = [];
  const ownerScopeCalls: ControlOwnerScope[] = [];

  const deps: JobsServiceDeps = {
    controlApiJsonRequest: async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, init });
      return (await handler(path, init)) as T;
    },
    getCurrentActorId: () => SYNTHETIC_ACTOR_ID,
    resolveCurrentOwnerScope: () => {
      ownerScopeCalls.push(ownerScope);
      return ownerScope;
    },
    createClientId: (prefix) => {
      clientIdPrefixes.push(prefix);
      return `synthetic-${prefix}-client`;
    },
    isNotFoundError: (error) => error === notFoundError,
  };

  return {
    calls,
    clientIdPrefixes,
    ownerScopeCalls,
    service: createJobsService(deps),
  };
}

function createSyntheticOwnerScope(
  overrides: Partial<ControlOwnerScope> = {},
): ControlOwnerScope {
  return {
    accountOwnerType: "user",
    accountOwnerId: SYNTHETIC_ACTOR_ID,
    organizationId: null,
    organizationRole: null,
    source: "personal-default",
    ...overrides,
  };
}

describe("createJobsService", () => {
  it("normalizes Control API job records into stable Task fields", () => {
    const { service } = createServiceHarness();
    const task = service.mapControlJobToTask(
      createSyntheticJob({
        id: "synthetic-job-1",
        job_type: "image.render",
        status: "RUNNING",
        lane: "account-media",
        provider_route: "synthetic-provider",
        idempotency_key: "synthetic-idempotency-key",
        attempt_count: "2",
        max_attempts: 3,
        lease_owner: "synthetic-worker",
        created_by_user_id: "synthetic-actor-1",
        payload: {
          domain: "media",
          project_id: "synthetic-project",
          storyboardId: "synthetic-storyboard",
          action_code: "image.render",
          wallet_id: "synthetic-wallet",
          progress_percent: "42",
          current_stage: "rendering",
          eta_seconds: "12",
          prompt: "Synthetic prompt",
          quoted_credits: "5",
          frozen_credits: 2,
          settled_credits: "1",
          billing_status: "reserved",
          metadata: {
            payloadMarker: "payload",
          },
        },
        result: {
          output_summary: "Synthetic output",
          metadata: {
            resultMarker: "result",
          },
        },
      }),
    );

    expect(task).toMatchObject({
      id: "synthetic-job-1",
      type: "image.render",
      domain: "media",
      projectId: "synthetic-project",
      storyboardId: "synthetic-storyboard",
      actorId: "synthetic-actor-1",
      actionCode: "image.render",
      walletId: "synthetic-wallet",
      status: "running",
      progressPercent: 42,
      currentStage: "rendering",
      etaSeconds: 12,
      inputSummary: "Synthetic prompt",
      outputSummary: "Synthetic output",
      quotedCredits: 5,
      frozenCredits: 2,
      settledCredits: 1,
      billingStatus: "reserved",
      createdAt: "2026-05-05T00:00:00.000Z",
      updatedAt: "2026-05-05T00:01:00.000Z",
    });
    expect(task.metadata).toMatchObject({
      payloadMarker: "payload",
      resultMarker: "result",
      controlJob: {
        accountId: null,
        lane: "account-media",
        providerRoute: "synthetic-provider",
        idempotencyKey: "synthetic-idempotency-key",
        attemptCount: 2,
        maxAttempts: 3,
        leaseOwner: "synthetic-worker",
      },
    });
  });

  it("creates canonical jobs through the stable public route and body-owned idempotency key", async () => {
    const { calls, clientIdPrefixes, ownerScopeCalls, service } = createServiceHarness({
      handler: () =>
        createSyntheticJob({
          id: "synthetic-created-job",
          job_type: "image.render",
          status: "queued",
          payload: {
            domain: "media",
            prompt: "Synthetic prompt",
          },
        }),
    });

    await expect(
      service.createCanonicalJob({
        jobType: "image.render",
        domain: "media",
        lane: "account-media",
        providerRoute: null,
        idempotencyKey: null,
        payload: {
          prompt: "Synthetic prompt",
          projectId: "synthetic-project",
        },
      }),
    ).resolves.toMatchObject({
      taskId: "synthetic-created-job",
      status: "queued",
      task: {
        id: "synthetic-created-job",
        type: "image.render",
      },
    });

    expect(calls[0].path).toBe("/api/jobs");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.headers).toBeUndefined();
    expect(parseJsonBody(calls[0])).toEqual({
      accountOwnerType: "user",
      accountOwnerId: "synthetic-actor",
      regionCode: "CN",
      currency: "CNY",
      lane: "account-media",
      jobType: "image.render",
      providerRoute: "closed-api",
      idempotencyKey: "frontend:synthetic-actor:image.render:synthetic-job-client",
      createdByUserId: "synthetic-actor",
      payload: {
        prompt: "Synthetic prompt",
        projectId: "synthetic-project",
        type: "image.render",
        jobType: "image.render",
        domain: "media",
        actionCode: "image.render",
        inputSummary: "Synthetic prompt",
      },
    });
    expect(clientIdPrefixes).toEqual(["job"]);
    expect(ownerScopeCalls).toEqual([createSyntheticOwnerScope()]);
  });

  it("propagates organization owner scope through create and list job requests", async () => {
    const organizationScope = createSyntheticOwnerScope({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-organization",
      organizationId: "synthetic-organization",
      organizationRole: "enterprise_admin",
      source: "current-organization",
    });
    const { calls, service } = createServiceHarness({
      ownerScope: organizationScope,
      handler: (path) => {
        if (path.startsWith("/api/jobs?")) {
          return [
            createSyntheticJob({
              id: "synthetic-org-listed-job",
              job_type: "image.render",
              payload: {
                domain: "media",
                projectId: "synthetic-project",
              },
            }),
          ];
        }

        return createSyntheticJob({
          id: "synthetic-org-created-job",
          job_type: "image.render",
          status: "queued",
          payload: {
            domain: "media",
            projectId: "synthetic-project",
          },
        });
      },
    });

    await service.createCanonicalJob({
      jobType: "image.render",
      domain: "media",
      payload: {
        projectId: "synthetic-project",
      },
    });
    await service.listTasks("synthetic-project", "image.render");

    expect(calls[0].path).toBe("/api/jobs");
    expect(parseJsonBody(calls[0])).toMatchObject({
      accountOwnerType: "organization",
      accountOwnerId: "synthetic-organization",
      regionCode: "CN",
      currency: "CNY",
      createdByUserId: SYNTHETIC_ACTOR_ID,
    });
    expect(calls[1]).toEqual({
      path: "/api/jobs?accountOwnerType=organization&accountOwnerId=synthetic-organization&limit=200",
      init: undefined,
    });
  });

  it("lists tasks through account-scoped public jobs and applies project/type filters", async () => {
    const { calls, service } = createServiceHarness({
      handler: () => [
        createSyntheticJob({
          id: "synthetic-job-a",
          job_type: "image.render",
          payload: {
            domain: "media",
            projectId: "synthetic-project-a",
          },
        }),
        createSyntheticJob({
          id: "synthetic-job-b",
          job_type: "image.render",
          payload: {
            domain: "media",
            projectId: "synthetic-project-b",
          },
        }),
        createSyntheticJob({
          id: "synthetic-job-c",
          job_type: "video.render",
          payload: {
            domain: "media",
            projectId: "synthetic-project-a",
          },
        }),
      ],
    });

    await expect(service.listTasks("synthetic-project-a", "image.render")).resolves.toEqual({
      items: [
        expect.objectContaining({
          id: "synthetic-job-a",
          projectId: "synthetic-project-a",
          type: "image.render",
        }),
      ],
    });
    expect(calls).toEqual([
      {
        path: "/api/jobs?accountOwnerType=user&accountOwnerId=synthetic-actor&limit=200",
        init: undefined,
      },
    ]);
  });

  it("reads a single task through an encoded public jobs path", async () => {
    const { calls, service } = createServiceHarness({
      handler: () =>
        createSyntheticJob({
          id: "synthetic job/1",
          job_type: "image.render",
        }),
    });

    await expect(service.getTask("synthetic job/1")).resolves.toMatchObject({
      id: "synthetic job/1",
      type: "image.render",
    });
    expect(calls).toEqual([
      {
        path: "/api/jobs/synthetic%20job%2F1",
        init: undefined,
      },
    ]);
  });

  it("dismisses missing tasks without calling the cancel route", async () => {
    const notFound = new Error("synthetic not found");
    const notFoundHarness = createServiceHarness({
      handler: () => {
        throw notFound;
      },
      notFoundError: notFound,
    });

    await expect(notFoundHarness.service.dismissTask("missing job/1")).resolves.toEqual({
      deleted: false,
      taskId: "missing job/1",
    });
    expect(notFoundHarness.calls).toEqual([
      {
        path: "/api/jobs/missing%20job%2F1",
        init: undefined,
      },
    ]);
  });

  it("dismisses active tasks through the stable cancel route", async () => {
    const cancelHarness = createServiceHarness({
      handler: (path) => {
        if (path.endsWith("/cancel")) {
          return createSyntheticJob({
            id: "synthetic-running-job",
            status: "cancelled",
          });
        }

        return createSyntheticJob({
          id: "synthetic-running-job",
          status: "running",
        });
      },
    });

    await expect(cancelHarness.service.dismissTask("synthetic-running-job")).resolves.toEqual({
      deleted: false,
      taskId: "synthetic-running-job",
    });
    expect(cancelHarness.calls[0]).toEqual({
      path: "/api/jobs/synthetic-running-job",
      init: undefined,
    });
    expect(cancelHarness.calls[1].path).toBe("/api/jobs/synthetic-running-job/cancel");
    expect(cancelHarness.calls[1].init?.method).toBe("POST");
    expect(parseJsonBody(cancelHarness.calls[1])).toEqual({
      reason: "frontend task dismissed",
    });
  });

  it("dismisses completed tasks without canceling or deleting backend records", async () => {
    const { calls, service } = createServiceHarness({
      handler: () =>
        createSyntheticJob({
          id: "synthetic-complete-job",
          status: "succeeded",
        }),
    });

    await expect(service.dismissTask("synthetic-complete-job")).resolves.toEqual({
      deleted: false,
      taskId: "synthetic-complete-job",
    });
    expect(calls).toEqual([
      {
        path: "/api/jobs/synthetic-complete-job",
        init: undefined,
      },
    ]);
  });

  it("keeps deleteTask as a compatibility alias for dismissTask", () => {
    const { service } = createServiceHarness();

    expect(service.deleteTask).toBe(service.dismissTask);
  });

  it("clears filtered tasks by canceling only active public jobs", async () => {
    const { calls, service } = createServiceHarness({
      handler: (path) => {
        if (path.endsWith("/cancel")) {
          return createSyntheticJob({
            id: "synthetic-active-job",
            status: "cancelled",
          });
        }

        return [
          createSyntheticJob({
            id: "synthetic-active-job",
            job_type: "image.render",
            status: "queued",
            payload: {
              domain: "media",
              projectId: "synthetic-project",
            },
          }),
          createSyntheticJob({
            id: "synthetic-complete-job",
            job_type: "image.render",
            status: "succeeded",
            payload: {
              domain: "media",
              projectId: "synthetic-project",
            },
          }),
          createSyntheticJob({
            id: "synthetic-other-project-job",
            job_type: "image.render",
            status: "running",
            payload: {
              domain: "media",
              projectId: "other-project",
            },
          }),
        ];
      },
    });

    await expect(service.clearTasks("synthetic-project", "image.render")).resolves.toEqual({
      removedCount: 2,
    });
    expect(calls[0]).toEqual({
      path: "/api/jobs?accountOwnerType=user&accountOwnerId=synthetic-actor&limit=200",
      init: undefined,
    });
    expect(calls).toHaveLength(2);
    expect(calls[1].path).toBe("/api/jobs/synthetic-active-job/cancel");
    expect(calls[1].init?.method).toBe("POST");
    expect(parseJsonBody(calls[1])).toEqual({
      reason: "frontend clear active tasks",
    });
  });
});
