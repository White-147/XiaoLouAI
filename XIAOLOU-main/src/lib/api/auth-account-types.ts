import type { CreditUsageSeriesPoint, Wallet } from "./wallet-types";

export type PlatformRole = "guest" | "customer" | "ops_admin" | "super_admin";
export type EnterpriseRole = "enterprise_member" | "enterprise_admin";

export type User = {
  id: string;
  displayName: string;
  email: string | null;
  phone?: string | null;
  avatar?: string | null;
  platformRole: PlatformRole;
  status: string;
  defaultOrganizationId: string | null;
};

export type OrganizationSummary = {
  id: string;
  name: string;
  role: EnterpriseRole;
  membershipRole: "member" | "admin";
  status: string;
  assetLibraryStatus?: string;
};

export type MemberUsageSummary = {
  todayUsedCredits: number;
  monthUsedCredits: number;
  totalUsedCredits: number;
  refundedCredits: number;
  pendingFrozenCredits: number;
  recentTaskCount: number;
  lastActivityAt: string | null;
  series?: CreditUsageSeriesPoint[];
};

export type PermissionContext = {
  actor: User;
  platformRole: PlatformRole;
  organizations: OrganizationSummary[];
  currentOrganizationId: string | null;
  currentOrganizationRole: EnterpriseRole | null;
  permissions: {
    canCreateProject: boolean;
    canRecharge: boolean;
    canUseEnterprise: boolean;
    canManageOrganization: boolean;
    canManageOps: boolean;
    canManageSystem: boolean;
  };
};

export type OrganizationMember = {
  id: string;
  organizationId: string;
  userId: string;
  displayName: string;
  email: string | null;
  phone?: string | null;
  platformRole: PlatformRole;
  role: EnterpriseRole;
  membershipRole: "member" | "admin";
  department?: string;
  canUseOrganizationWallet?: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
  usageSummary?: MemberUsageSummary | null;
};

export type RegisterPersonalInput = {
  displayName: string;
  email: string;
  phone?: string;
  password: string;
};

export type RegisterEnterpriseAdminInput = {
  companyName: string;
  adminName: string;
  email: string;
  phone?: string;
  password: string;
  licenseNo?: string;
  industry?: string;
  teamSize?: string;
};

export type CreateOrganizationMemberInput = {
  displayName: string;
  email: string;
  phone?: string;
  department?: string;
  password?: string;
  membershipRole?: "member" | "admin";
  canUseOrganizationWallet?: boolean;
};

export type OrganizationMemberPasswordResetInput = {
  newPassword: string;
};

export type UpdateOrganizationMemberAccountInput = {
  displayName?: string;
  email?: string;
  phone?: string | null;
  department?: string | null;
  membershipRole?: "member" | "admin";
  canUseOrganizationWallet?: boolean;
  newPassword?: string;
};

export type RegistrationResult = {
  actorId: string;
  token?: string;
  controlApiClientAssertion?: string | null;
  permissionContext: PermissionContext;
  wallets?: Wallet[];
  wallet?: Wallet | null;
  organization?: {
    id: string;
    name: string;
    status: string;
    assetLibraryStatus?: string | null;
  } | null;
  member?: OrganizationMember;
  onboarding: {
    mode: string;
    title: string;
    detail: string;
    tempPassword: string | null;
    generatedPassword?: boolean;
  };
};

export type LoginInput = {
  email: string;
  password: string;
};

export type BootstrapPlatformPasswordInput = {
  email: string;
  password: string;
};

export type ChangePasswordInput = {
  currentPassword: string;
  newPassword: string;
};

export type AdminResetPasswordInput = {
  email: string;
  newPassword: string;
};

export type RequestPasswordResetInput = {
  email: string;
};

export type CompletePasswordResetInput = {
  resetToken: string;
  newPassword: string;
};

export type PasswordConfiguredResult = {
  actorId: string;
  email: string | null;
  platformRole: PlatformRole;
  passwordConfigured: boolean;
  passwordUpdated: boolean;
};

export type PasswordResetRequestResult = {
  email: string;
  accepted: boolean;
  delivery: "email_unconfigured" | "local_token";
  resetToken?: string | null;
  expiresAt?: string | null;
};

export type LoginResult = {
  actorId: string;
  token: string;
  controlApiClientAssertion?: string | null;
  displayName: string;
  email: string;
  permissionContext: PermissionContext;
};

export type AuthProvidersResponse = {
  google: {
    configured: boolean;
  };
};

export type UpdateMeInput = {
  displayName?: string;
  avatar?: string | null;
  phone?: string | null;
  defaultOrganizationId?: string | null;
};

export type ApiVendorModel = {
  id: string;
  name: string;
  domain: "text" | "vision" | "image" | "video" | "audio" | string;
  inputPrice: string;
  outputPrice: string;
  enabled: boolean;
};

export type ApiVendor = {
  id: string;
  name: string;
  connected: boolean;
  apiKeyConfigured?: boolean;
  lastCheckedAt: string | null;
  testedAt?: string | null;
  region?: string | null;
  supportedDomains: string[];
  models: ApiVendorModel[];
};

export type NodeModelAssignment = {
  nodeCode: string;
  nodeName: string;
  primaryModelId: string | null;
  fallbackModelIds?: string[];
  notes?: string;
};

export type ApiCenterConfig = {
  vendors: ApiVendor[];
  defaults: {
    textModelId: string;
    visionModelId: string;
    imageModelId: string;
    videoModelId: string;
    audioModelId: string;
  };
  strategies: Record<string, string>;
  nodeAssignments: NodeModelAssignment[];
  toolboxAssignments?: NodeModelAssignment[];
};

export type ProviderHealthEvidence = {
  provider?: string;
  region_code?: string;
  regionCode?: string;
  model_family?: string;
  modelFamily?: string;
  status?: string;
  evidenceKind?: "staged_evidence" | "real_provider_health" | string;
  isStagedEvidence?: boolean;
  isRealProviderHealth?: boolean;
  acceptanceEvidenceRequired?: boolean;
  providerHealthSemantics?: string;
  [key: string]: unknown;
};

export type ApiVendorConnectionTestResult = {
  vendor: ApiVendor;
  checkedAt: string;
  modelCount: number;
  providerHealth?: ProviderHealthEvidence | null;
};
