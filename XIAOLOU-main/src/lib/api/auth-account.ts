import type {
  ApiCenterConfig,
  ApiVendor,
  ApiVendorConnectionTestResult,
  ApiVendorModel,
  AdminResetPasswordInput,
  AuthProvidersResponse,
  BootstrapPlatformPasswordInput,
  ChangePasswordInput,
  CompletePasswordResetInput,
  CreateOrganizationMemberInput,
  LoginInput,
  LoginResult,
  OrganizationMember,
  OrganizationMemberPasswordResetInput,
  PasswordConfiguredResult,
  PasswordResetRequestResult,
  PermissionContext,
  RegisterEnterpriseAdminInput,
  RegisterPersonalInput,
  RegistrationResult,
  RequestPasswordResetInput,
  UpdateOrganizationMemberAccountInput,
  UpdateMeInput,
  Wallet,
  WalletOwnerType,
} from "../api";
import type { ControlOwnerScope } from "../control-owner-scope";

type ControlApiJsonRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export type AuthAccountServiceDeps = {
  controlApiJsonRequest: ControlApiJsonRequest;
  resolveCurrentOwnerScope: () => ControlOwnerScope;
  getWallet: (ownerType: WalletOwnerType, ownerId: string) => Promise<Wallet>;
  createEmptyWallet: (ownerType: WalletOwnerType, ownerId: string) => Wallet;
  isRouteNotFoundError: (error: unknown) => boolean;
};

function buildControlScopeQuery(ownerScope: ControlOwnerScope) {
  const accountOwnerType = ownerScope.accountOwnerType ?? "user";
  const accountOwnerId = ownerScope.accountOwnerId ?? "guest";
  return `accountOwnerType=${encodeURIComponent(accountOwnerType)}&accountOwnerId=${encodeURIComponent(accountOwnerId)}`;
}

export function createAuthAccountService({
  controlApiJsonRequest,
  resolveCurrentOwnerScope,
  getWallet,
  createEmptyWallet,
  isRouteNotFoundError,
}: AuthAccountServiceDeps) {
  const buildApiCenterScopeQuery = () => buildControlScopeQuery(resolveCurrentOwnerScope());

  return {
    getMe() {
      return controlApiJsonRequest<PermissionContext>("/api/me");
    },

    updateMe(data: UpdateMeInput) {
      return controlApiJsonRequest<PermissionContext>("/api/me", {
        method: "PUT",
        body: JSON.stringify(data),
      });
    },

    getApiCenterConfig() {
      return controlApiJsonRequest<ApiCenterConfig>(`/api/api-center?${buildApiCenterScopeQuery()}`);
    },

    updateApiCenterDefaults(input: Partial<ApiCenterConfig["defaults"]>) {
      return controlApiJsonRequest<ApiCenterConfig["defaults"]>(
        `/api/api-center/defaults?${buildApiCenterScopeQuery()}`,
        {
          method: "PUT",
          body: JSON.stringify(input),
        },
      );
    },

    saveApiCenterVendorApiKey(vendorId: string, apiKey: string) {
      return controlApiJsonRequest<ApiVendor>(
        `/api/api-center/vendors/${encodeURIComponent(vendorId)}/api-key?${buildApiCenterScopeQuery()}`,
        {
          method: "PUT",
          body: JSON.stringify({ apiKey }),
        },
      );
    },

    testApiCenterVendorConnection(vendorId: string) {
      return controlApiJsonRequest<ApiVendorConnectionTestResult>(
        `/api/api-center/vendors/${encodeURIComponent(vendorId)}/test?${buildApiCenterScopeQuery()}`,
        { method: "POST" },
      );
    },

    updateApiVendorModel(
      vendorId: string,
      modelId: string,
      input: Partial<Pick<ApiVendorModel, "enabled">>,
    ) {
      return controlApiJsonRequest<ApiVendorModel>(
        `/api/api-center/vendors/${encodeURIComponent(vendorId)}/models/${encodeURIComponent(modelId)}?${buildApiCenterScopeQuery()}`,
        {
          method: "PUT",
          body: JSON.stringify(input),
        },
      );
    },

    listOrganizationMembers(organizationId: string, query?: string) {
      const queryText = query?.trim();
      const queryString = queryText ? `?query=${encodeURIComponent(queryText)}` : "";
      return controlApiJsonRequest<{ items: OrganizationMember[] }>(
        `/api/organizations/${encodeURIComponent(organizationId)}/members${queryString}`,
      );
    },

    createOrganizationMember(organizationId: string, input: CreateOrganizationMemberInput) {
      return controlApiJsonRequest<RegistrationResult>(
        `/api/organizations/${encodeURIComponent(organizationId)}/members`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },

    resetOrganizationMemberPassword(
      organizationId: string,
      userId: string,
      input: OrganizationMemberPasswordResetInput,
    ) {
      return controlApiJsonRequest<PasswordConfiguredResult>(
        `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}/password`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },

    updateOrganizationMemberAccount(
      organizationId: string,
      userId: string,
      input: UpdateOrganizationMemberAccountInput,
    ) {
      return controlApiJsonRequest<OrganizationMember>(
        `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}/account`,
        {
          method: "PUT",
          body: JSON.stringify(input),
        },
      );
    },

    deleteOrganizationMemberAccount(organizationId: string, userId: string) {
      return controlApiJsonRequest<{ deleted: boolean; organizationId: string; userId: string }>(
        `/api/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      );
    },

    async getOrganizationWallet(organizationId: string) {
      try {
        return await getWallet("organization", organizationId);
      } catch (error) {
        if (!isRouteNotFoundError(error)) throw error;
        return createEmptyWallet("organization", organizationId);
      }
    },

    loginWithEmail(input: LoginInput) {
      return controlApiJsonRequest<LoginResult>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    loginAdminWithEmail(input: LoginInput) {
      return controlApiJsonRequest<LoginResult>("/api/auth/admin/login", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    bootstrapPlatformPassword(input: BootstrapPlatformPasswordInput) {
      return controlApiJsonRequest<PasswordConfiguredResult>(
        "/api/auth/password/bootstrap-admin",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },

    changePassword(input: ChangePasswordInput) {
      return controlApiJsonRequest<PasswordConfiguredResult>(
        "/api/auth/password/change",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },

    adminResetPassword(input: AdminResetPasswordInput) {
      return controlApiJsonRequest<PasswordConfiguredResult>(
        "/api/auth/password/admin-reset",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },

    requestPasswordReset(input: RequestPasswordResetInput) {
      return controlApiJsonRequest<PasswordResetRequestResult>(
        "/api/auth/password/reset/request",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },

    completePasswordReset(input: CompletePasswordResetInput) {
      return controlApiJsonRequest<PasswordConfiguredResult>(
        "/api/auth/password/reset/complete",
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      );
    },

    startDemoSession(actorId: string) {
      return controlApiJsonRequest<LoginResult>("/api/auth/demo-session", {
        method: "POST",
        body: JSON.stringify({ actorId }),
      });
    },

    getAuthProviders() {
      return controlApiJsonRequest<AuthProvidersResponse>("/api/auth/providers");
    },

    exchangeGoogleLogin(code: string): Promise<LoginResult> {
      return controlApiJsonRequest<LoginResult>("/api/auth/google/exchange", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
    },

    registerPersonalUser(input: RegisterPersonalInput) {
      return controlApiJsonRequest<RegistrationResult>("/api/auth/register/personal", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },

    registerEnterpriseAdmin(input: RegisterEnterpriseAdminInput) {
      return controlApiJsonRequest<RegistrationResult>("/api/auth/register/enterprise-admin", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
  };
}
