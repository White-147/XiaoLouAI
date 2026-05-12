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
  OrganizationMember,
  OrganizationMemberPasswordResetInput,
  PasswordConfiguredResult,
  PasswordResetRequestResult,
  RegistrationResult,
  RequestPasswordResetInput,
  UpdateOrganizationMemberAccountInput,
} from "./auth-account-types";
import type { Wallet } from "./wallet-types";

export type AuthAccountFacadeServiceContract = {
  getApiCenterConfig: () => Promise<ApiCenterConfig>;
  updateApiCenterDefaults: (
    input: Partial<ApiCenterConfig["defaults"]>,
  ) => Promise<ApiCenterConfig["defaults"]>;
  saveApiCenterVendorApiKey: (vendorId: string, apiKey: string) => Promise<ApiVendor>;
  testApiCenterVendorConnection: (
    vendorId: string,
  ) => Promise<ApiVendorConnectionTestResult>;
  updateApiVendorModel: (
    vendorId: string,
    modelId: string,
    input: Partial<Pick<ApiVendorModel, "enabled">>,
  ) => Promise<ApiVendorModel>;
  listOrganizationMembers: (
    organizationId: string,
    query?: string,
  ) => Promise<{ items: OrganizationMember[] }>;
  createOrganizationMember: (
    organizationId: string,
    input: CreateOrganizationMemberInput,
  ) => Promise<RegistrationResult>;
  resetOrganizationMemberPassword: (
    organizationId: string,
    userId: string,
    input: OrganizationMemberPasswordResetInput,
  ) => Promise<PasswordConfiguredResult>;
  updateOrganizationMemberAccount: (
    organizationId: string,
    userId: string,
    input: UpdateOrganizationMemberAccountInput,
  ) => Promise<OrganizationMember>;
  deleteOrganizationMemberAccount: (
    organizationId: string,
    userId: string,
  ) => Promise<{ deleted: boolean; organizationId: string; userId: string }>;
  getOrganizationWallet: (organizationId: string) => Promise<Wallet>;
  bootstrapPlatformPassword: (
    input: BootstrapPlatformPasswordInput,
  ) => Promise<PasswordConfiguredResult>;
  changePassword: (input: ChangePasswordInput) => Promise<PasswordConfiguredResult>;
  adminResetPassword: (
    input: AdminResetPasswordInput,
  ) => Promise<PasswordConfiguredResult>;
  requestPasswordReset: (
    input: RequestPasswordResetInput,
  ) => Promise<PasswordResetRequestResult>;
  completePasswordReset: (
    input: CompletePasswordResetInput,
  ) => Promise<PasswordConfiguredResult>;
  getAuthProviders: () => Promise<AuthProvidersResponse>;
};

export function createAuthAccountFacade(
  authAccountService: AuthAccountFacadeServiceContract,
) {
  return {
    getApiCenterConfig() {
      return authAccountService.getApiCenterConfig();
    },
    updateApiCenterDefaults(input: Partial<ApiCenterConfig["defaults"]>) {
      return authAccountService.updateApiCenterDefaults(input);
    },
    saveApiCenterVendorApiKey(vendorId: string, apiKey: string) {
      return authAccountService.saveApiCenterVendorApiKey(vendorId, apiKey);
    },
    testApiCenterVendorConnection(vendorId: string) {
      return authAccountService.testApiCenterVendorConnection(vendorId);
    },
    updateApiVendorModel(
      vendorId: string,
      modelId: string,
      input: Partial<Pick<ApiVendorModel, "enabled">>,
    ) {
      return authAccountService.updateApiVendorModel(vendorId, modelId, input);
    },
    listOrganizationMembers(organizationId: string, query?: string) {
      return authAccountService.listOrganizationMembers(organizationId, query);
    },
    createOrganizationMember(
      organizationId: string,
      input: CreateOrganizationMemberInput,
    ) {
      return authAccountService.createOrganizationMember(organizationId, input);
    },
    resetOrganizationMemberPassword(
      organizationId: string,
      userId: string,
      input: OrganizationMemberPasswordResetInput,
    ) {
      return authAccountService.resetOrganizationMemberPassword(
        organizationId,
        userId,
        input,
      );
    },
    updateOrganizationMemberAccount(
      organizationId: string,
      userId: string,
      input: UpdateOrganizationMemberAccountInput,
    ) {
      return authAccountService.updateOrganizationMemberAccount(
        organizationId,
        userId,
        input,
      );
    },
    deleteOrganizationMemberAccount(organizationId: string, userId: string) {
      return authAccountService.deleteOrganizationMemberAccount(organizationId, userId);
    },
    getOrganizationWallet(organizationId: string) {
      return authAccountService.getOrganizationWallet(organizationId);
    },
    bootstrapPlatformPassword(input: BootstrapPlatformPasswordInput) {
      return authAccountService.bootstrapPlatformPassword(input);
    },
    changePassword(input: ChangePasswordInput) {
      return authAccountService.changePassword(input);
    },
    adminResetPassword(input: AdminResetPasswordInput) {
      return authAccountService.adminResetPassword(input);
    },
    requestPasswordReset(input: RequestPasswordResetInput) {
      return authAccountService.requestPasswordReset(input);
    },
    completePasswordReset(input: CompletePasswordResetInput) {
      return authAccountService.completePasswordReset(input);
    },
    getAuthProviders() {
      return authAccountService.getAuthProviders();
    },
  };
}
