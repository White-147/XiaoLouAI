import { applyCurrentOrganizationSelection } from "../current-organization-context";
import type {
  LoginInput,
  LoginResult,
  PermissionContext,
  RegisterEnterpriseAdminInput,
  RegisterPersonalInput,
  RegistrationResult,
  UpdateMeInput,
} from "./auth-account-types";

export type AuthCurrentOrganizationBridgeServiceContract = {
  getMe: () => Promise<PermissionContext>;
  updateMe: (data: UpdateMeInput) => Promise<PermissionContext>;
  loginWithEmail: (input: LoginInput) => Promise<LoginResult>;
  loginAdminWithEmail: (input: LoginInput) => Promise<LoginResult>;
  startDemoSession: (actorId: string) => Promise<LoginResult>;
  exchangeGoogleLogin: (code: string) => Promise<LoginResult>;
  registerPersonalUser: (input: RegisterPersonalInput) => Promise<RegistrationResult>;
  registerEnterpriseAdmin: (
    input: RegisterEnterpriseAdminInput,
  ) => Promise<RegistrationResult>;
};

function isPermissionContextValue(value: unknown): value is PermissionContext {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PermissionContext>;
  return (
    !!candidate.actor &&
    typeof candidate.actor === "object" &&
    Array.isArray(candidate.organizations) &&
    !!candidate.permissions &&
    typeof candidate.permissions === "object" &&
    typeof candidate.platformRole === "string"
  );
}

function withCurrentOrganizationSelection<T>(value: T): T {
  if (!isPermissionContextValue(value)) return value;
  return applyCurrentOrganizationSelection(value, {
    persistEffectiveSelection: true,
  }) as T;
}

function withResultCurrentOrganizationSelection<T>(value: T): T {
  if (!value || typeof value !== "object") return value;
  const candidate = value as { permissionContext?: unknown };
  if (!isPermissionContextValue(candidate.permissionContext)) return value;
  return {
    ...candidate,
    permissionContext: applyCurrentOrganizationSelection(candidate.permissionContext, {
      persistEffectiveSelection: true,
    }),
  } as T;
}

export function createAuthCurrentOrganizationBridge(
  authAccountService: AuthCurrentOrganizationBridgeServiceContract,
) {
  return {
    async getMe() {
      return withCurrentOrganizationSelection(await authAccountService.getMe());
    },
    async updateMe(data: UpdateMeInput) {
      return withCurrentOrganizationSelection(await authAccountService.updateMe(data));
    },
    async loginWithEmail(input: LoginInput) {
      return withResultCurrentOrganizationSelection(
        await authAccountService.loginWithEmail(input),
      );
    },
    async loginAdminWithEmail(input: LoginInput) {
      return withResultCurrentOrganizationSelection(
        await authAccountService.loginAdminWithEmail(input),
      );
    },
    async startDemoSession(actorId: string): Promise<LoginResult> {
      return withResultCurrentOrganizationSelection(
        await authAccountService.startDemoSession(actorId),
      );
    },
    async exchangeGoogleLogin(code: string): Promise<LoginResult> {
      return withResultCurrentOrganizationSelection(
        await authAccountService.exchangeGoogleLogin(code),
      );
    },
    async registerPersonalUser(input: RegisterPersonalInput) {
      return withResultCurrentOrganizationSelection(
        await authAccountService.registerPersonalUser(input),
      );
    },
    async registerEnterpriseAdmin(input: RegisterEnterpriseAdminInput) {
      return withResultCurrentOrganizationSelection(
        await authAccountService.registerEnterpriseAdmin(input),
      );
    },
  };
}
