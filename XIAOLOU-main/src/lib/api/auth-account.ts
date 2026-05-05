import type {
  ApiCenterConfig,
  ApiVendor,
  ApiVendorConnectionTestResult,
  ApiVendorModel,
  AuthProvidersResponse,
  CreateOrganizationMemberInput,
  LoginInput,
  LoginResult,
  OrganizationMember,
  PermissionContext,
  RegisterEnterpriseAdminInput,
  RegisterPersonalInput,
  RegistrationResult,
  Wallet,
  WalletOwnerType,
} from "../api";

type ControlApiJsonRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

export type AuthAccountServiceDeps = {
  controlApiJsonRequest: ControlApiJsonRequest;
  buildControlScopeQuery: (actorId?: string) => string;
  getWallet: (ownerType: WalletOwnerType, ownerId: string) => Promise<Wallet>;
  createEmptyWallet: (ownerType: WalletOwnerType, ownerId: string) => Wallet;
  isRouteNotFoundError: (error: unknown) => boolean;
};

export function createAuthAccountService({
  controlApiJsonRequest,
  buildControlScopeQuery,
  getWallet,
  createEmptyWallet,
  isRouteNotFoundError,
}: AuthAccountServiceDeps) {
  return {
    getMe() {
      return controlApiJsonRequest<PermissionContext>("/api/me");
    },

    updateMe(data: { displayName?: string; avatar?: string | null }) {
      return controlApiJsonRequest<PermissionContext>("/api/me", {
        method: "PUT",
        body: JSON.stringify(data),
      });
    },

    getApiCenterConfig() {
      return controlApiJsonRequest<ApiCenterConfig>(`/api/api-center?${buildControlScopeQuery()}`);
    },

    updateApiCenterDefaults(input: Partial<ApiCenterConfig["defaults"]>) {
      return controlApiJsonRequest<ApiCenterConfig["defaults"]>(
        `/api/api-center/defaults?${buildControlScopeQuery()}`,
        {
          method: "PUT",
          body: JSON.stringify(input),
        },
      );
    },

    saveApiCenterVendorApiKey(vendorId: string, apiKey: string) {
      return controlApiJsonRequest<ApiVendor>(
        `/api/api-center/vendors/${encodeURIComponent(vendorId)}/api-key?${buildControlScopeQuery()}`,
        {
          method: "PUT",
          body: JSON.stringify({ apiKey }),
        },
      );
    },

    testApiCenterVendorConnection(vendorId: string) {
      return controlApiJsonRequest<ApiVendorConnectionTestResult>(
        `/api/api-center/vendors/${encodeURIComponent(vendorId)}/test?${buildControlScopeQuery()}`,
        { method: "POST" },
      );
    },

    updateApiVendorModel(
      vendorId: string,
      modelId: string,
      input: Partial<Pick<ApiVendorModel, "enabled">>,
    ) {
      return controlApiJsonRequest<ApiVendorModel>(
        `/api/api-center/vendors/${encodeURIComponent(vendorId)}/models/${encodeURIComponent(modelId)}?${buildControlScopeQuery()}`,
        {
          method: "PUT",
          body: JSON.stringify(input),
        },
      );
    },

    listOrganizationMembers(organizationId: string) {
      return controlApiJsonRequest<{ items: OrganizationMember[] }>(
        `/api/organizations/${encodeURIComponent(organizationId)}/members`,
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
