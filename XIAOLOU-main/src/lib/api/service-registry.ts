import {
  getCurrentActorId,
  hasSessionCredentials,
} from "../actor-session";
import { isLocalLoopbackAccess, SUPER_ADMIN_DEMO_ACTOR_ID } from "../local-loopback";
import { WINDOWS_NATIVE_TOOLBOX_CAPABILITIES } from "../../features/toolbox/api/toolbox-fallback-capabilities";
import { createToolboxFacade } from "../../features/toolbox/api/toolbox-facade";
import { createToolboxService } from "../../features/toolbox/api/toolbox";
import { createPlaygroundService } from "../../features/playground/api/playground";
import { createAdminEnterpriseFacade } from "./admin-enterprise-facade";
import { createAdminEnterpriseService } from "./admin-enterprise";
import { createAuthAccountService } from "./auth-account";
import { createAuthAccountFacade } from "./auth-account-facade";
import { createAuthCurrentOrganizationBridge } from "./auth-current-organization-bridge";
import { createCurrentControlOwnerScopeResolver } from "./auth-owner-scope";
import { createClientId } from "./client-id";
import {
  ApiRequestError,
  controlApiJsonRequest,
  controlApiStreamRequest,
} from "./control-api-client";
import { createJobsFacade } from "./jobs-facade";
import { createJobsService } from "./jobs";
import { createMediaFacade } from "./media-facade";
import { createMediaService } from "./media";
import { createPlaygroundFacade } from "./playground-facade";
import { createProjectsCanvasCreateFacade } from "./projects-canvas-create-facade";
import { createProjectsCanvasCreateService } from "./projects-canvas-create";
import { readRecord, readString } from "./record-readers";
import {
  createEmptyWallet,
  normalizeWalletRecord,
  retiredRechargeError,
} from "./wallet-local-helpers";
import { createWalletPaymentFacade } from "./wallet-payment-facade";
import { createWalletPaymentService } from "./wallet-payment";

function isRouteNotFoundError(error: unknown) {
  return (
    (error instanceof ApiRequestError && error.status === 404) ||
    (error instanceof Error && /route not found/i.test(error.message))
  );
}

const resolveCurrentControlOwnerScope = createCurrentControlOwnerScopeResolver({
  getCurrentActorId,
});

const walletPaymentService = createWalletPaymentService({
  controlApiJsonRequest,
  getCurrentActorId,
  resolveCurrentOwnerScope: resolveCurrentControlOwnerScope,
  isRouteNotFoundError,
  isLocalLoopbackAccess,
  superAdminDemoActorId: SUPER_ADMIN_DEMO_ACTOR_ID,
  createEmptyWallet,
  normalizeWalletRecord,
  retiredRechargeError,
});

const walletPaymentFacade = createWalletPaymentFacade(walletPaymentService);

const authAccountService = createAuthAccountService({
  controlApiJsonRequest,
  resolveCurrentOwnerScope: resolveCurrentControlOwnerScope,
  getWallet: walletPaymentFacade.getWallet,
  createEmptyWallet,
  isRouteNotFoundError,
});

const authCurrentOrganizationBridge =
  createAuthCurrentOrganizationBridge(authAccountService);
const authAccountFacade = createAuthAccountFacade(authAccountService);

const mediaService = createMediaService({
  controlApiJsonRequest,
  getCurrentActorId,
  resolveCurrentOwnerScope: resolveCurrentControlOwnerScope,
  createClientId,
  createApiRequestError: (message, options) => new ApiRequestError(message, options),
});

const mediaFacade = createMediaFacade(mediaService);

const playgroundService = createPlaygroundService({
  controlApiJsonRequest,
  controlApiStreamRequest,
  getCurrentActorId,
  resolveCurrentOwnerScope: resolveCurrentControlOwnerScope,
  createApiRequestError: (message, options) => new ApiRequestError(message, options),
  hasSessionCredentials,
  isAuthBoundaryError: (error) =>
    error instanceof ApiRequestError && (error.status === 401 || error.status === 403),
});

const playgroundFacade = createPlaygroundFacade(playgroundService);

const jobsService = createJobsService({
  controlApiJsonRequest,
  getCurrentActorId,
  resolveCurrentOwnerScope: resolveCurrentControlOwnerScope,
  createClientId,
  isNotFoundError: (error) => error instanceof ApiRequestError && error.status === 404,
});

const jobsFacade = createJobsFacade(jobsService);

const projectsCanvasCreateService = createProjectsCanvasCreateService({
  controlApiJsonRequest,
  getCurrentActorId,
  resolveCurrentOwnerScope: resolveCurrentControlOwnerScope,
  createCanonicalJob: jobsService.createCanonicalJob,
});

const projectsCanvasCreateFacade = createProjectsCanvasCreateFacade(
  projectsCanvasCreateService,
);

const toolboxService = createToolboxService({
  controlApiJsonRequest,
  getCurrentActorId,
  resolveCurrentOwnerScope: resolveCurrentControlOwnerScope,
  createClientId,
  createApiRequestError: (message, options) => new ApiRequestError(message, options),
  readString,
  readRecord,
  mapControlJobToTask: jobsService.mapControlJobToTask,
  getFallbackToolboxCapabilities: () => WINDOWS_NATIVE_TOOLBOX_CAPABILITIES,
});

const toolboxFacade = createToolboxFacade(toolboxService);

const adminEnterpriseService = createAdminEnterpriseService({
  controlApiJsonRequest,
  retiredRechargeError,
});

const adminEnterpriseFacade = createAdminEnterpriseFacade(adminEnterpriseService);

export const apiServiceRegistry = {
  adminEnterpriseFacade,
  authAccountFacade,
  authCurrentOrganizationBridge,
  jobsFacade,
  mediaFacade,
  playgroundFacade,
  projectsCanvasCreateFacade,
  toolboxFacade,
  walletPaymentFacade,
} as const;
