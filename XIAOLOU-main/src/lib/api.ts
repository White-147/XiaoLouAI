import {
  getAuthToken,
  getCurrentActorId,
  hasSessionCredentials,
} from "./actor-session";
import { isLocalLoopbackAccess, SUPER_ADMIN_DEMO_ACTOR_ID } from "./local-loopback";
import { createAdminEnterpriseService } from "./api/admin-enterprise";
import {
  API_BASE_URL,
  ApiRequestError,
  assertNoLegacyMutatingRequest,
  controlApiJsonRequest,
  controlApiStreamRequest,
} from "./api/control-api-client";
import { createAuthAccountService } from "./api/auth-account";
import { createJobsService } from "./api/jobs";
import { createMediaService } from "./api/media";
import { createPlaygroundService } from "./api/playground";
import { createProjectsCanvasCreateService } from "./api/projects-canvas-create";
import { createToolboxService } from "./api/toolbox";
import { createWalletPaymentService } from "./api/wallet-payment";
import {
  resolveCurrentOwnerScope,
  type ControlOwnerScope,
} from "./control-owner-scope";
import {
  applyCurrentOrganizationSelection,
  getStoredCurrentOrganizationOwnerScope,
} from "./current-organization-context";
import type {
  VideoInputMode,
  VideoGenerationMode,
} from "./create-capabilities";

export type {
  MediaKind,
  MediaModelProvider,
  MediaModelStatus,
  ImageInputMode,
  VideoInputMode,
  VideoGenerationMode,
  MediaInputMode,
  MediaCapabilitySet,
  MediaModelCapability,
  MediaCapabilitiesResponse,
} from "./create-capabilities";
export { normalizeVideoMode, VIDEO_MODE_ALIASES } from "./create-capabilities";
export { API_BASE_URL, ApiRequestError } from "./api/control-api-client";

export type ProjectStep =
  | "global"
  | "script"
  | "assets"
  | "storyboards"
  | "videos"
  | "dubbing"
  | "preview";

export type PlatformRole = "guest" | "customer" | "ops_admin" | "super_admin";
export type EnterpriseRole = "enterprise_member" | "enterprise_admin";
export type WalletOwnerType = "user" | "organization" | "platform";
export type ProjectBillingPolicy =
  | "personal_only"
  | "organization_only"
  | "organization_first_fallback_personal";

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

export type NetworkAccessEntry = {
  interfaceName: string;
  address: string;
  recommended: boolean;
  frontendBaseUrl: string;
  apiBaseUrl: string;
  homeUrl: string;
  canvasUrl: string;
  videoUrl: string;
};

export type NetworkAccessInfo = {
  hostname: string;
  frontendPort: number;
  apiPort: number;
  recommendedEntries: NetworkAccessEntry[];
  additionalEntries: NetworkAccessEntry[];
  hostnameEntry: {
    hostname: string;
    frontendBaseUrl: string;
    apiBaseUrl: string;
    homeUrl: string;
    canvasUrl: string;
    videoUrl: string;
  };
  note: string;
};

export type JaazServiceProbe = {
  name: "api" | "ui";
  port: number;
  listening: boolean;
  started?: boolean;
  pid?: number | null;
  error?: string;
};

export type JaazServiceStatus = {
  enabled: boolean;
  ensured?: boolean;
  reason?: string;
  root: string;
  api: JaazServiceProbe;
  ui: JaazServiceProbe;
};

export type Project = {
  id: string;
  title: string;
  summary: string;
  status: string;
  coverUrl: string | null;
  organizationId: string | null;
  ownerType?: "personal" | "organization";
  ownerId?: string;
  currentStep: ProjectStep | string;
  progressPercent: number;
  budgetCredits: number;
  budgetLimitCredits?: number;
  budgetUsedCredits?: number;
  billingWalletType?: "personal" | "organization";
  billingPolicy?: ProjectBillingPolicy;
  createdBy?: string;
  directorAgentName: string;
  createdAt: string;
  updatedAt: string;
};

export type Settings = {
  projectId: string;
  tone: string;
  genre: string;
  targetDurationSeconds: number;
  aspectRatio: string;
  visualStyle: string;
  audience: string;
  modelProfile: string;
  language: string;
  updatedAt: string;
};

export type Script = {
  id: string;
  projectId: string;
  version: number;
  title: string;
  content: string;
  updatedAt: string;
};

/** Which product surface the asset originated from. Persisted on the server
 *  so /assets can group video assets by real module without string heuristics. */
export type AssetSourceModule =
  | "image_create"
  | "video_create"
  | "canvas"
  | "video_replace"
  | "agent_studio";

export type Asset = {
  id: string;
  projectId: string;
  assetType: string;
  name: string;
  description: string;
  previewUrl: string | null;
  mediaKind?: string | null;
  mediaUrl?: string | null;
  sourceTaskId?: string | null;
  sourceModule?: AssetSourceModule | string | null;
  sourceMetadata?: Record<string, unknown> | null;
  generationPrompt?: string;
  referenceImageUrls?: string[];
  imageStatus?: string | null;
  imageModel?: string | null;
  aspectRatio?: string | null;
  negativePrompt?: string;
  scope: string;
  createdAt: string;
  updatedAt?: string;
};

export type AssetImageGenerateInput = {
  generationPrompt?: string;
  referenceImageUrls?: string[];
  imageModel?: string;
  aspectRatio?: string;
  negativePrompt?: string;
};

export type CreateAssetInput = {
  assetType: string;
  name: string;
  description?: string;
  previewUrl?: string | null;
  mediaKind?: string | null;
  mediaUrl?: string | null;
  sourceTaskId?: string | null;
  sourceModule?: AssetSourceModule | null;
  sourceMetadata?: Record<string, unknown> | null;
  generationPrompt?: string;
  referenceImageUrls?: string[];
  imageModel?: string;
  aspectRatio?: string;
  negativePrompt?: string;
  scope?: string;
};

export type AgentStudioAssetSyncInput = {
  fileUrl: string;
  fileName?: string;
  name?: string;
  mediaKind?: "image" | "video" | string;
  mimeType?: string;
  width?: number;
  height?: number;
  canvasId?: string;
  sessionId?: string;
  source?: string;
  prompt?: string;
  description?: string;
};

export type AgentStudioCanvasProjectSyncInput = {
  canvasId: string;
  sessionId?: string;
  title?: string;
  thumbnailUrl?: string | null;
  canvasUrl?: string;
  source?: string;
  savedAt?: string;
  description?: string;
};

export type Storyboard = {
  id: string;
  projectId: string;
  shotNo: number;
  title: string;
  script: string;
  imageStatus: string;
  videoStatus: string;
  durationSeconds: number;
  promptSummary: string;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
  assetIds?: string[];
  episodeNo?: number | null;
  composition?: string;
  // Expert-mode extended fields (populated when using the storyboard breakdown prompt)
  partNo?: number | null;
  partTitle?: string | null;
  weather?: string | null;
  camera?: string | null;
  blocking?: string | null;
  shotType?: string;
  focalLength?: string;
  colorTone?: string;
  lighting?: string;
  technique?: string;
  modelName?: string;
  aspectRatio?: string;
  imageQuality?: string;
  videoMode?: string;
  videoPrompt?: string;
  motionPreset?: string;
  motionDescription?: string;
  videoModel?: string;
  videoAspectRatio?: string;
  videoResolution?: string;
  videoDuration?: string;
  referenceImageUrls?: string[];
  startFrameUrl?: string | null;
  endFrameUrl?: string | null;
};

export type VideoItem = {
  id: string;
  projectId: string;
  storyboardId: string;
  version: number;
  status: string;
  durationSeconds: number;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Dubbing = {
  id: string;
  projectId: string;
  storyboardId: string;
  speakerName: string;
  voicePreset: string;
  text: string;
  status: string;
  audioUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TimelineClip = {
  id: string;
  type: string;
  sourceType: string;
  sourceId: string | null;
  storyboardId: string | null;
  title: string;
  startTimeSeconds: number;
  durationSeconds: number;
  trimStartSeconds: number;
  enabled: boolean;
  muted?: boolean;
  url: string | null;
  thumbnailUrl?: string | null;
  text?: string;
};

export type TimelineTrack = {
  id: string;
  type: string;
  label: string;
  enabled: boolean;
  muted?: boolean;
  volume?: number;
  itemCount: number;
  clips: TimelineClip[];
};

export type Timeline = {
  projectId: string;
  version: number;
  totalDurationSeconds: number;
  tracks: TimelineTrack[];
  updatedAt: string;
};

export type Task = {
  id: string;
  type: string;
  domain: string;
  projectId: string | null;
  storyboardId: string | null;
  actorId?: string;
  actionCode?: string;
  walletId?: string | null;
  status: string;
  progressPercent: number;
  currentStage: string;
  etaSeconds: number;
  inputSummary: string | null;
  outputSummary: string | null;
  quotedCredits?: number;
  frozenCredits?: number;
  settledCredits?: number;
  billingStatus?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type Wallet = {
  id?: string;
  ownerType?: WalletOwnerType;
  walletOwnerType?: WalletOwnerType;
  ownerId: string;
  displayName?: string;
  availableCredits?: number;
  frozenCredits?: number;
  creditsAvailable: number;
  creditsFrozen: number;
  currency: string;
  status?: string;
  allowNegative?: boolean;
  /** 超级管理员等：展示为无限额度，不参与扣费校验 */
  unlimitedCredits?: boolean;
  updatedAt: string;
};

export type WalletLedgerEntry = {
  id: string;
  walletId: string;
  entryType: string;
  amount: number;
  balanceAfter: number;
  frozenBalanceAfter: number;
  sourceType: string;
  sourceId: string;
  projectId: string | null;
  orderId: string | null;
  createdBy: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type CreditUsageMode = "personal" | "organization";

export type CreditUsageSeriesPoint = {
  bucketStart: string;
  bucketLabel: string;
  consumedCredits: number;
  refundedCredits: number;
};

export type CreditUsageSubject = {
  type: WalletOwnerType | "unknown";
  id: string | null;
  label: string;
  detail: string | null;
  role?: string;
};

export type CreditUsageStats = {
  subject: CreditUsageSubject;
  mode: CreditUsageMode | "admin" | null;
  windowDays: number;
  bucket: "day" | string;
  wallets: Wallet[];
  summary: {
    consumedCredits: number;
    todayConsumedCredits: number;
    refundedCredits: number;
    pendingFrozenCredits: number;
    availableCredits: number;
    frozenCredits: number;
    recentTaskCount: number;
    lastActivityAt: string | null;
  };
  series: CreditUsageSeriesPoint[];
  recentEntries: WalletLedgerEntry[];
};

export type CreditQuote = {
  actionCode: string;
  label: string;
  description: string;
  credits: number;
  quantity: number;
  currency: string;
  walletId: string | null;
  walletName: string | null;
  walletOwnerType: WalletOwnerType | null;
  availableCredits: number;
  frozenCredits: number;
  billingPolicy: ProjectBillingPolicy;
  projectId: string | null;
  projectOwnerType: "personal" | "organization" | null;
  budgetLimitCredits: number | null;
  budgetUsedCredits: number;
  budgetRemainingCredits: number | null;
  canAfford: boolean;
  reason: string | null;
};

export type CreditQuoteRequestInput = {
  projectId?: string | null;
  sourceText?: string;
  text?: string;
  count?: number;
  shotCount?: number;
  storyboardId?: string;
  model?: string;
  aspectRatio?: string;
  resolution?: string;
};

export type PricingRule = {
  id: string;
  actionCode: string;
  label: string;
  baseCredits: number;
  unitLabel: string;
  description: string;
  updatedAt: string;
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

export type AdminRechargeOrder = WalletRechargeOrder & {
  wallet?: Wallet | null;
};

export type WalletRechargePaymentMethod = "wechat_pay" | "alipay" | "bank_transfer";
export type WalletRechargeMode = "live" | "demo_mock";
export type WalletRechargeScene =
  | "desktop_qr"
  | "mobile_h5"
  | "pc_page"
  | "mobile_wap"
  | "bank_transfer";

export type BankTransferAccount = {
  accountName: string;
  bankName: string;
  accountNo: string;
  branchName?: string | null;
  remarkTemplate?: string | null;
  instructions?: string | null;
};

export type WalletRechargeOrder = {
  id: string;
  planId: string;
  planName: string;
  billingCycle: string;
  paymentMethod: WalletRechargePaymentMethod | string;
  provider?: string | null;
  scene?: WalletRechargeScene | string | null;
  mode?: WalletRechargeMode | string;
  amount: number;
  credits: number;
  currency: string;
  status: string;
  actorId?: string;
  walletId?: string;
  walletOwnerType?: WalletOwnerType;
  walletOwnerId?: string;
  payerType?: WalletOwnerType;
  providerTradeNo?: string | null;
  codeUrl?: string | null;
  h5Url?: string | null;
  redirectUrl?: string | null;
  notifyPayload?: Record<string, unknown> | null;
  paidAt?: string | null;
  expiredAt?: string | null;
  failureReason?: string | null;
  voucherFiles?: string[];
  reviewStatus?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  reviewNote?: string | null;
  qrCodePayload?: string | null;
  qrCodeHint?: string | null;
  bankAccount?: BankTransferAccount | null;
  transferReference?: string | null;
  transferNote?: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string | null;
};

export type CreateWalletRechargeOrderInput = {
  planId: string;
  planName: string;
  billingCycle: string;
  paymentMethod: WalletRechargePaymentMethod | string;
  mode?: WalletRechargeMode;
  scene?: WalletRechargeScene;
  amount: number;
  credits: number;
  walletId?: string;
};

export type WalletRechargeMethodCapability = {
  paymentMethod: WalletRechargePaymentMethod;
  label: string;
  detail: string;
  live: {
    available: boolean;
    reason?: string | null;
    scenes: WalletRechargeScene[];
  };
  demoMock: {
    available: boolean;
    reason?: string | null;
    scenes: WalletRechargeScene[];
  };
  bankAccount?: BankTransferAccount | null;
};

export type WalletRechargeCapabilities = {
  requestHost: string | null;
  demoMockEnabled: boolean;
  demoMockAllowedHosts: string[];
  methods: WalletRechargeMethodCapability[];
};

export type ToolboxCapability = {
  code: string;
  name: string;
  status: string;
  queue: string;
  description: string;
};

export type CreateImageResult = {
  id: string;
  taskId?: string | null;
  prompt: string;
  model: string;
  style: string;
  aspectRatio: string;
  resolution: string;
  referenceImageUrl?: string | null;
  referenceImageUrls?: string[];
  batchIndex?: number;
  imageUrl: string;
  createdAt: string;
};

export type VideoMultiReferenceKey =
  | "scene"
  | "character"
  | "prop"
  | "pose"
  | "expression"
  | "effect"
  | "sketch";

export type VideoMultiReferenceValue = string | string[];
export type VideoMultiReferenceImages = Partial<Record<VideoMultiReferenceKey, VideoMultiReferenceValue>>;

export type CreateVideoResult = {
  id: string;
  taskId?: string | null;
  prompt: string;
  model: string;
  duration: string;
  aspectRatio: string;
  resolution: string;
  outputDuration?: string | null;
  outputAspectRatio?: string | null;
  requestedResolution?: string | null;
  outputResolution?: string | null;
  referenceImageUrl?: string | null;
  resolvedReferenceImageUrl?: string | null;
  firstFrameUrl?: string | null;
  lastFrameUrl?: string | null;
  videoMode?: string | null;
  inputMode?: VideoInputMode | null;
  multiReferenceImages?: VideoMultiReferenceImages | null;
  referenceVideoUrls?: string[] | null;
  referenceAudioUrls?: string[] | null;
  editMode?: string | null;
  editPresetId?: string | null;
  motionReferenceVideoUrl?: string | null;
  characterReferenceImageUrl?: string | null;
  qualityMode?: string | null;
  thumbnailUrl: string;
  videoUrl: string;
  createdAt: string;
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

export type UploadedFile = {
  id: string;
  kind: string;
  originalName: string;
  storedName: string;
  sizeBytes: number;
  contentType: string;
  url: string;
  urlPath: string;
  mediaObjectId?: string;
  objectKey?: string;
  signedReadUrl?: string;
};

export type ProjectOverview = {
  project: Project & {
    settings: Settings;
    script: Script;
    assetCount: number;
    storyboardCount: number;
    videoCount: number;
    dubbingCount: number;
  };
  settings: Settings;
  script: Script;
  assets: Asset[];
  storyboards: Storyboard[];
  videos: VideoItem[];
  dubbings: Dubbing[];
  timeline: Timeline;
  tasks: Task[];
};

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  error?: {
    code: string;
    message: string;
  };
};

function isRouteNotFoundError(error: unknown) {
  return (
    (error instanceof ApiRequestError && error.status === 404) ||
    (error instanceof Error && /route not found/i.test(error.message))
  );
}

function buildFallbackPermissionContext(actorId: string): PermissionContext {
  if (actorId === SUPER_ADMIN_DEMO_ACTOR_ID && !isLocalLoopbackAccess()) {
    return buildFallbackPermissionContext("guest");
  }

  const organization: OrganizationSummary = {
    id: "org_demo_001",
    name: "小楼影业 Demo",
    role: "enterprise_member",
    membershipRole: "member",
    status: "active",
  };

  if (actorId === "guest") {
    return {
      actor: {
        id: "guest",
        displayName: "游客",
        email: null,
        platformRole: "guest",
        status: "active",
        defaultOrganizationId: null,
      },
      platformRole: "guest",
      organizations: [],
      currentOrganizationId: null,
      currentOrganizationRole: null,
      permissions: {
        canCreateProject: false,
        canRecharge: false,
        canUseEnterprise: false,
        canManageOrganization: false,
        canManageOps: false,
        canManageSystem: false,
      },
    };
  }

  if (actorId === "user_member_001") {
    return {
      actor: {
        id: actorId,
        displayName: "企业成员",
        email: "member@xiaolou.local",
        platformRole: "customer",
        status: "active",
        defaultOrganizationId: organization.id,
      },
      platformRole: "customer",
      organizations: [organization],
      currentOrganizationId: organization.id,
      currentOrganizationRole: "enterprise_member",
      permissions: {
        canCreateProject: true,
        canRecharge: true,
        canUseEnterprise: true,
        canManageOrganization: false,
        canManageOps: false,
        canManageSystem: false,
      },
    };
  }

  if (actorId === "user_demo_001") {
    return {
      actor: {
        id: actorId,
        displayName: "企业管理员",
        email: "admin@xiaolou.local",
        platformRole: "customer",
        status: "active",
        defaultOrganizationId: organization.id,
      },
      platformRole: "customer",
      organizations: [{ ...organization, role: "enterprise_admin", membershipRole: "admin" }],
      currentOrganizationId: organization.id,
      currentOrganizationRole: "enterprise_admin",
      permissions: {
        canCreateProject: true,
        canRecharge: true,
        canUseEnterprise: true,
        canManageOrganization: true,
        canManageOps: false,
        canManageSystem: false,
      },
    };
  }

  if (actorId === "ops_demo_001") {
    return {
      actor: {
        id: actorId,
        displayName: "运营管理员",
        email: "ops@xiaolou.local",
        platformRole: "ops_admin",
        status: "active",
        defaultOrganizationId: null,
      },
      platformRole: "ops_admin",
      organizations: [],
      currentOrganizationId: null,
      currentOrganizationRole: null,
      permissions: {
        canCreateProject: false,
        canRecharge: false,
        canUseEnterprise: false,
        canManageOrganization: false,
        canManageOps: true,
        canManageSystem: false,
      },
    };
  }

  if (actorId === SUPER_ADMIN_DEMO_ACTOR_ID) {
    return {
      actor: {
        id: actorId,
        displayName: "超级管理员",
        email: "root@xiaolou.local",
        platformRole: "super_admin",
        status: "active",
        defaultOrganizationId: null,
      },
      platformRole: "super_admin",
      organizations: [],
      currentOrganizationId: null,
      currentOrganizationRole: null,
      permissions: {
        canCreateProject: false,
        canRecharge: false,
        canUseEnterprise: false,
        canManageOrganization: false,
        canManageOps: true,
        canManageSystem: true,
      },
    };
  }

  return {
    actor: {
      id: actorId,
      displayName: "注册用户",
      email: "user@xiaolou.local",
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

function normalizeWalletRecord(wallet: Wallet, actorId: string): Wallet {
  const fallbackContext = buildFallbackPermissionContext(actorId);
  const currentOrganization = fallbackContext.organizations.find(
    (item) => item.id === fallbackContext.currentOrganizationId,
  );
  const ownerType: WalletOwnerType =
    wallet.ownerType ?? wallet.walletOwnerType ?? (currentOrganization ? "organization" : "user");

  return {
    ...wallet,
    ownerType,
    displayName:
      wallet.displayName ??
      (ownerType === "organization"
        ? `${currentOrganization?.name || "企业"}钱包`
        : `${fallbackContext.actor.displayName}钱包`),
    availableCredits: wallet.availableCredits ?? wallet.creditsAvailable ?? 0,
    frozenCredits: wallet.frozenCredits ?? wallet.creditsFrozen ?? 0,
    creditsAvailable: wallet.creditsAvailable ?? wallet.availableCredits ?? 0,
    creditsFrozen: wallet.creditsFrozen ?? wallet.frozenCredits ?? 0,
    status: wallet.status ?? "active",
    allowNegative: wallet.allowNegative ?? false,
  };
}

function createEmptyWallet(ownerType: WalletOwnerType, ownerId: string): Wallet {
  const now = new Date().toISOString();
  return {
    id: `${ownerType}-${ownerId || "guest"}`,
    ownerType,
    walletOwnerType: ownerType,
    ownerId: ownerId || "guest",
    displayName: ownerType === "organization" ? "Organization wallet" : "Personal wallet",
    availableCredits: 0,
    frozenCredits: 0,
    creditsAvailable: 0,
    creditsFrozen: 0,
    currency: "CNY",
    status: "active",
    allowNegative: false,
    unlimitedCredits: false,
    updatedAt: now,
  };
}

function retiredRechargeError(flow: string): never {
  throw new ApiRequestError(
    `${flow} is retired during the Windows-native cutover; use canonical payment callback evidence for production payment validation.`,
    {
      code: "RECHARGE_FLOW_RETIRED",
      status: 410,
    },
  );
}

function buildPersonalOwnerFallback(actorId: string): ControlOwnerScope {
  return {
    accountOwnerType: "user",
    accountOwnerId: actorId,
    organizationId: null,
    organizationRole: null,
    source: "explicit-fallback",
  };
}

function resolveCurrentControlOwnerScope() {
  const actorId = getCurrentActorId();
  const selectedOrganizationScope = getStoredCurrentOrganizationOwnerScope(actorId);
  if (selectedOrganizationScope) return selectedOrganizationScope;
  return resolveCurrentOwnerScope(
    applyCurrentOrganizationSelection(buildFallbackPermissionContext(actorId)),
    {
      explicitFallback: buildPersonalOwnerFallback(actorId),
    },
  );
}

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

const authAccountService = createAuthAccountService({
  controlApiJsonRequest,
  resolveCurrentOwnerScope: resolveCurrentControlOwnerScope,
  getWallet,
  createEmptyWallet,
  isRouteNotFoundError,
});

const mediaService = createMediaService({
  controlApiJsonRequest,
  getCurrentActorId,
  resolveCurrentOwnerScope: resolveCurrentControlOwnerScope,
  createClientId,
  createApiRequestError: (message, options) => new ApiRequestError(message, options),
});

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

const jobsService = createJobsService({
  controlApiJsonRequest,
  getCurrentActorId,
  resolveCurrentOwnerScope: resolveCurrentControlOwnerScope,
  createClientId,
  isNotFoundError: (error) => error instanceof ApiRequestError && error.status === 404,
});

const projectsCanvasCreateService = createProjectsCanvasCreateService({
  controlApiJsonRequest,
  getCurrentActorId,
  resolveCurrentOwnerScope: resolveCurrentControlOwnerScope,
  createCanonicalJob: jobsService.createCanonicalJob,
});

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

const adminEnterpriseService = createAdminEnterpriseService({
  controlApiJsonRequest,
  retiredRechargeError,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

function readString(record: Record<string, unknown>, ...keys: string[]) {
  const value = readField(record, ...keys);
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
}

function readRecord(record: Record<string, unknown>, ...keys: string[]) {
  const value = readField(record, ...keys);
  return isRecord(value) ? value : null;
}

function createClientId(prefix: string) {
  const randomId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${randomId}`;
}

// Produces a short random id usable as an Idempotency-Key for POST-based task
// creation. Prefers crypto.randomUUID when available, falls back to a
// timestamp+random combination in older environments.
export function newIdempotencyKey(): string {
  try {
    const g: any = globalThis as any;
    if (g?.crypto?.randomUUID) return g.crypto.randomUUID();
    if (g?.crypto?.getRandomValues) {
      const buf = new Uint8Array(16);
      g.crypto.getRandomValues(buf);
      return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    /* fall through */
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function mapStepToComicPath(step: ProjectStep | string) {
  const normalized =
    step === "storyboards"
      ? "storyboard"
      : step === "videos"
        ? "video"
        : step;

  return `/comic/${normalized}`;
}

const LOCAL_PROFILE_STORAGE_PREFIX = "xiaolou.windows-native.profile.v1";
const LOCAL_ORGANIZATION_MEMBERS_STORAGE_PREFIX = "xiaolou.windows-native.organization-members.v1";
const LOCAL_API_CENTER_CONFIG_STORAGE_PREFIX = "xiaolou.windows-native.api-center-config.v1";

function localStorageGetJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function localStorageSetJson(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}

function localStorageRemove(key: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}

function actorScopedStorageKey(prefix: string, actorId = getCurrentActorId()) {
  return `${prefix}:${actorId || "guest"}`;
}

const WINDOWS_NATIVE_TOOLBOX_CAPABILITIES: ToolboxCapability[] = [
  {
    code: "video_character_replace",
    name: "Script breakdown prompt",
    status: "local",
    queue: "canonical-jobs",
    description: "Frontend-only entry; no legacy toolbox write route is used.",
  },
  {
    code: "character_replace",
    name: "Character replace",
    status: "local",
    queue: "canonical-jobs",
    description: "Use the dedicated video replace surface; legacy toolbox write route is retired.",
  },
  {
    code: "motion_transfer",
    name: "Motion transfer",
    status: "coming_soon",
    queue: "canonical-jobs",
    description: "Queued as a canonical job only after worker/provider evidence is available.",
  },
  {
    code: "upscale_restore",
    name: "Video reverse prompt",
    status: "local",
    queue: "canonical-jobs",
    description: "Use the dedicated reverse prompt surface; legacy toolbox write route is retired.",
  },
  {
    code: "storyboard_25",
    name: "25-grid storyboard",
    status: "local",
    queue: "canonical-jobs",
    description: "Frontend entry retained; legacy direct toolbox write route is retired.",
  },
];

const DEFAULT_API_CENTER_CONFIG: ApiCenterConfig = {
  vendors: [
    {
      id: "dashscope",
      name: "Alibaba Cloud DashScope",
      connected: false,
      apiKeyConfigured: false,
      lastCheckedAt: null,
      supportedDomains: ["text", "vision", "audio"],
      models: [
        { id: "qwen-plus", name: "Qwen Plus", domain: "text", inputPrice: "local", outputPrice: "local", enabled: true },
        { id: "qwen-vl-plus", name: "Qwen VL Plus", domain: "vision", inputPrice: "local", outputPrice: "local", enabled: true },
        { id: "qwen3.5-omni-flash", name: "Qwen Omni Flash", domain: "audio", inputPrice: "local", outputPrice: "local", enabled: true },
      ],
    },
    {
      id: "bytedance",
      name: "ByteDance Volcano Engine",
      connected: false,
      apiKeyConfigured: false,
      lastCheckedAt: null,
      supportedDomains: ["image", "video"],
      models: [
        { id: "doubao-seedream-5-0-260128", name: "Seedream 5.0", domain: "image", inputPrice: "local", outputPrice: "local", enabled: true },
        { id: "doubao-seedance-2-0-260128", name: "Seedance 2.0", domain: "video", inputPrice: "local", outputPrice: "local", enabled: true },
      ],
    },
    {
      id: "kling",
      name: "Kling",
      connected: false,
      apiKeyConfigured: false,
      lastCheckedAt: null,
      supportedDomains: ["video"],
      models: [
        { id: "kling-video", name: "Kling Video", domain: "video", inputPrice: "local", outputPrice: "local", enabled: true },
      ],
    },
  ],
  defaults: {
    textModelId: "qwen-plus",
    visionModelId: "qwen-vl-plus",
    imageModelId: "doubao-seedream-5-0-260128",
    videoModelId: "doubao-seedance-2-0-260128",
    audioModelId: "qwen3.5-omni-flash",
  },
  strategies: {
    "windows-native": "Provider configuration is a local draft until the .NET canonical secret/config store lands.",
  },
  nodeAssignments: [
    {
      nodeCode: "playground_chat",
      nodeName: "Playground chat",
      primaryModelId: "qwen-plus",
      fallbackModelIds: ["qwen-vl-plus"],
    },
    {
      nodeCode: "create_image_generate",
      nodeName: "Create image",
      primaryModelId: "doubao-seedream-5-0-260128",
      fallbackModelIds: [],
    },
    {
      nodeCode: "create_video_generate",
      nodeName: "Create video",
      primaryModelId: "doubao-seedance-2-0-260128",
      fallbackModelIds: ["kling-video"],
    },
  ],
  toolboxAssignments: [
    {
      nodeCode: "storyboard_grid25_generate",
      nodeName: "25-grid storyboard",
      primaryModelId: "doubao-seedream-5-0-260128",
      fallbackModelIds: [],
    },
  ],
};

function cloneApiCenterConfig(config: ApiCenterConfig = DEFAULT_API_CENTER_CONFIG): ApiCenterConfig {
  return JSON.parse(JSON.stringify(config)) as ApiCenterConfig;
}

function readLocalApiCenterConfig() {
  return localStorageGetJson<ApiCenterConfig>(
    LOCAL_API_CENTER_CONFIG_STORAGE_PREFIX,
    cloneApiCenterConfig(),
  );
}

function writeLocalApiCenterConfig(config: ApiCenterConfig) {
  localStorageSetJson(LOCAL_API_CENTER_CONFIG_STORAGE_PREFIX, config);
  return config;
}

function findApiVendor(config: ApiCenterConfig, vendorId: string) {
  const vendor = config.vendors.find((item) => item.id === vendorId);
  if (!vendor) {
    throw new ApiRequestError("API vendor is not available in the Windows-native local config draft.", {
      code: "API_VENDOR_NOT_FOUND",
      status: 404,
    });
  }
  return vendor;
}

function localAuthToken(actorId: string) {
  const raw = `${actorId}:${Date.now()}`;
  try {
    if (typeof window !== "undefined" && typeof window.btoa === "function") {
      return window.btoa(raw);
    }
  } catch {
    /* fall through */
  }
  return raw;
}

function actorIdFromEmail(email: string, mode: "personal" | "enterprise_admin" | "ops_admin" = "personal") {
  const normalizedEmail = email.trim().toLowerCase();
  if (mode === "ops_admin" || normalizedEmail.includes("ops")) return "ops_demo_001";
  if (mode === "enterprise_admin" || normalizedEmail.includes("admin")) return "user_demo_001";
  if (normalizedEmail.includes("member")) return "user_member_001";
  const segment = normalizedEmail.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48);
  return segment ? `user_${segment}` : "user_demo_001";
}

type LocalProfile = {
  displayName?: string;
  email?: string | null;
  avatar?: string | null;
};

function readLocalProfile(actorId = getCurrentActorId()) {
  return localStorageGetJson<LocalProfile>(actorScopedStorageKey(LOCAL_PROFILE_STORAGE_PREFIX, actorId), {});
}

function writeLocalProfile(actorId: string, profile: LocalProfile) {
  localStorageSetJson(actorScopedStorageKey(LOCAL_PROFILE_STORAGE_PREFIX, actorId), profile);
}

function applyLocalProfile(context: PermissionContext, profile = readLocalProfile(context.actor.id)): PermissionContext {
  if (!profile.displayName && profile.email === undefined && profile.avatar === undefined) return context;
  return {
    ...context,
    actor: {
      ...context.actor,
      displayName: profile.displayName || context.actor.displayName,
      email: profile.email === undefined ? context.actor.email : profile.email,
      avatar: profile.avatar === undefined ? context.actor.avatar : profile.avatar,
    },
  };
}

function buildLocalLoginResult(input: LoginInput, mode: "personal" | "enterprise_admin" | "ops_admin" = "personal"): LoginResult {
  const actorId = actorIdFromEmail(input.email, mode);
  const profile: LocalProfile = {
    displayName:
      mode === "ops_admin"
        ? "Ops Admin"
        : mode === "enterprise_admin"
          ? "Enterprise Admin"
          : input.email.split("@")[0] || "Windows Native User",
    email: input.email.trim() || null,
  };
  writeLocalProfile(actorId, profile);
  const permissionContext = applyLocalProfile(buildFallbackPermissionContext(actorId), profile);
  return {
    actorId,
    token: localAuthToken(actorId),
    controlApiClientAssertion: null,
    displayName: permissionContext.actor.displayName,
    email: permissionContext.actor.email || input.email,
    permissionContext,
  };
}

function organizationMembersStorageKey(organizationId: string, actorId = getCurrentActorId()) {
  return `${actorScopedStorageKey(LOCAL_ORGANIZATION_MEMBERS_STORAGE_PREFIX, actorId)}:${organizationId}`;
}

function readLocalOrganizationMembers(organizationId: string, actorId = getCurrentActorId()) {
  const items = localStorageGetJson<OrganizationMember[]>(
    organizationMembersStorageKey(organizationId, actorId),
    [],
  );
  return Array.isArray(items) ? items : [];
}

function writeLocalOrganizationMembers(organizationId: string, items: OrganizationMember[], actorId = getCurrentActorId()) {
  localStorageSetJson(organizationMembersStorageKey(organizationId, actorId), items.slice(0, 200));
}

function createLocalOrganizationMember(organizationId: string, input: CreateOrganizationMemberInput): OrganizationMember {
  const now = new Date().toISOString();
  const membershipRole = input.membershipRole || "member";
  const role: EnterpriseRole = membershipRole === "admin" ? "enterprise_admin" : "enterprise_member";
  const actorId = actorIdFromEmail(input.email || input.displayName, role === "enterprise_admin" ? "enterprise_admin" : "personal");
  return {
    id: createClientId("org-member"),
    organizationId,
    userId: actorId,
    displayName: input.displayName || input.email || "Enterprise member",
    email: input.email || null,
    phone: input.phone,
    platformRole: "customer",
    role,
    membershipRole,
    department: input.department,
    canUseOrganizationWallet: input.canUseOrganizationWallet ?? true,
    status: "active",
    createdAt: now,
    updatedAt: now,
    usageSummary: {
      todayUsedCredits: 0,
      monthUsedCredits: 0,
      totalUsedCredits: 0,
      refundedCredits: 0,
      pendingFrozenCredits: 0,
      recentTaskCount: 0,
      lastActivityAt: null,
    },
  };
}

function buildRegistrationResult(
  actorId: string,
  permissionContext: PermissionContext,
  mode: "personal" | "enterprise_admin" | "enterprise_member",
  member?: OrganizationMember,
): RegistrationResult {
  const organization = permissionContext.organizations[0] ?? null;
  return {
    actorId,
    token: localAuthToken(actorId),
    controlApiClientAssertion: null,
    permissionContext,
    wallets: [],
    wallet: null,
    organization: organization
      ? {
          id: organization.id,
          name: organization.name,
          status: organization.status,
          assetLibraryStatus: organization.assetLibraryStatus,
        }
      : null,
    member,
    onboarding: {
      mode,
      title: mode === "personal" ? "Personal account ready" : "Enterprise account ready",
      detail: "Created in the Windows-native local account draft while canonical identity endpoints are being cut over.",
      tempPassword: null,
      generatedPassword: false,
    },
  };
}

function buildLocalNetworkAccessInfo(): NetworkAccessInfo {
  const frontendBaseUrl =
    typeof window !== "undefined" && window.location?.origin
      ? window.location.origin
      : "http://127.0.0.1:3000";
  const apiBaseUrl = API_BASE_URL || frontendBaseUrl;
  let hostname = "127.0.0.1";
  let frontendPort = 3000;
  let apiPort = 4100;
  try {
    const frontendUrl = new URL(frontendBaseUrl);
    const apiUrl = new URL(apiBaseUrl, frontendBaseUrl);
    hostname = frontendUrl.hostname || hostname;
    frontendPort = Number(frontendUrl.port || (frontendUrl.protocol === "https:" ? 443 : 80));
    apiPort = Number(apiUrl.port || (apiUrl.protocol === "https:" ? 443 : 80));
  } catch {
    /* keep defaults */
  }
  const entry: NetworkAccessEntry = {
    interfaceName: "loopback",
    address: hostname,
    recommended: true,
    frontendBaseUrl,
    apiBaseUrl,
    homeUrl: `${frontendBaseUrl}/home`,
    canvasUrl: `${frontendBaseUrl}/canvas`,
    videoUrl: `${frontendBaseUrl}/video-replace`,
  };
  return {
    hostname,
    frontendPort,
    apiPort,
    recommendedEntries: [entry],
    additionalEntries: [],
    hostnameEntry: {
      hostname,
      frontendBaseUrl,
      apiBaseUrl,
      homeUrl: entry.homeUrl,
      canvasUrl: entry.canvasUrl,
      videoUrl: entry.videoUrl,
    },
    note: "Computed locally by the Windows-native frontend; legacy network discovery writes are retired.",
  };
}

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

export async function getMe() {
  return withCurrentOrganizationSelection(await authAccountService.getMe());
}

export type UpdateMeInput = {
  displayName?: string;
  avatar?: string | null;
  phone?: string | null;
  defaultOrganizationId?: string | null;
};

export async function updateMe(data: UpdateMeInput) {
  return withCurrentOrganizationSelection(await authAccountService.updateMe(data));
}

export async function listProjects() {
  return projectsCanvasCreateService.listProjects();
}

export async function getNetworkAccessInfo() {
  return buildLocalNetworkAccessInfo();
}

export async function ensureJaazServices() {
  return {
    enabled: false,
    ensured: false,
    reason: "Legacy Jaaz service startup is retired in the Windows-native runtime.",
    root: "",
    api: { name: "api" as const, port: 0, listening: false, started: false, pid: null },
    ui: { name: "ui" as const, port: 0, listening: false, started: false, pid: null },
  };
}

export async function listCreateImages() {
  return projectsCanvasCreateService.listCreateImages();
}

export async function generateCreateImages(input: {
  projectId?: string;
  assetSyncMode?: "auto" | "manual";
  prompt: string;
  negativePrompt?: string;
  model?: string;
  style?: string;
  aspectRatio?: string;
  resolution?: string;
  count?: number;
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
  // When set, the server uses this key to de-duplicate rapid retries or
  // concurrent double-submits, returning the same task id for the same key.
  idempotencyKey?: string;
}) {
  return projectsCanvasCreateService.generateCreateImages(input);
}

export async function listCreateVideos() {
  return projectsCanvasCreateService.listCreateVideos();
}

export async function getCreateImageCapabilities(mode?: string | null) {
  return projectsCanvasCreateService.getCreateImageCapabilities(mode);
}

export async function getCreateVideoCapabilities(
  mode: string,
) {
  return projectsCanvasCreateService.getCreateVideoCapabilities(mode);
}

export async function generateCreateVideos(input: {
  projectId?: string;
  assetSyncMode?: "auto" | "manual";
  prompt: string;
  model?: string;
  duration?: string;
  aspectRatio?: string;
  resolution?: string;
  motionStrength?: number;
  keepConsistency?: boolean;
  referenceImageUrl?: string;
  firstFrameUrl?: string;
  lastFrameUrl?: string;
  videoMode?: VideoGenerationMode | "video_edit" | "motion_control" | "video_extend";
  multiReferenceImages?: VideoMultiReferenceImages;
  referenceVideoUrls?: string[];
  referenceAudioUrls?: string[];
  editMode?: string;
  editPresetId?: string;
  motionReferenceVideoUrl?: string;
  characterReferenceImageUrl?: string;
  qualityMode?: string;
  generateAudio?: boolean;
  networkSearch?: boolean;
  idempotencyKey?: string;
}) {
  return projectsCanvasCreateService.generateCreateVideos(input);
}

export async function deleteCreateImage(imageId: string) {
  return projectsCanvasCreateService.deleteCreateImage(imageId);
}

export async function deleteCreateVideo(videoId: string) {
  return projectsCanvasCreateService.deleteCreateVideo(videoId);
}

export async function createProject(input: {
  title: string;
  summary?: string;
  ownerType?: "personal" | "organization";
  organizationId?: string;
}) {
  return projectsCanvasCreateService.createProject(input);
}

export async function updateProject(projectId: string, input: Partial<Project>) {
  return projectsCanvasCreateService.updateProject(projectId, input);
}

export async function getProject(projectId: string) {
  return projectsCanvasCreateService.getProject(projectId);
}

export async function getProjectOverview(projectId: string) {
  return projectsCanvasCreateService.getProjectOverview(projectId);
}

export async function getSettings(projectId: string) {
  return projectsCanvasCreateService.getSettings(projectId);
}

export async function updateSettings(projectId: string, input: Partial<Settings>) {
  return projectsCanvasCreateService.updateSettings(projectId, input);
}

export async function getScript(projectId: string) {
  return projectsCanvasCreateService.getScript(projectId);
}

export async function updateScript(projectId: string, content: string) {
  return projectsCanvasCreateService.updateScript(projectId, content);
}

export async function rewriteScript(projectId: string, instruction: string) {
  return projectsCanvasCreateService.rewriteScript(projectId, instruction);
}

export async function listAssets(projectId: string, assetType?: string) {
  return projectsCanvasCreateService.listAssets(projectId, assetType);
}

export async function getAsset(projectId: string, assetId: string): Promise<Asset> {
  return projectsCanvasCreateService.getAsset(projectId, assetId);
}

export async function createAsset(
  projectId: string,
  input: CreateAssetInput,
): Promise<Asset> {
  return projectsCanvasCreateService.createAsset(projectId, input);
}

export async function syncAgentStudioAsset(
  projectId: string,
  input: AgentStudioAssetSyncInput,
) {
  return projectsCanvasCreateService.syncAgentStudioAsset(projectId, input);
}

export async function syncAgentStudioCanvasProject(
  projectId: string,
  input: AgentStudioCanvasProjectSyncInput,
) {
  return projectsCanvasCreateService.syncAgentStudioCanvasProject(projectId, input);
}

export async function updateAsset(projectId: string, assetId: string, input: Partial<Asset>): Promise<Asset> {
  return projectsCanvasCreateService.updateAsset(projectId, assetId, input);
}

export async function deleteAsset(projectId: string, assetId: string) {
  return projectsCanvasCreateService.deleteAsset(projectId, assetId);
}

export async function extractAssets(projectId: string, sourceText: string) {
  return projectsCanvasCreateService.extractAssets(projectId, sourceText);
}

export async function generateAssetImage(
  projectId: string,
  assetId: string,
  input: AssetImageGenerateInput,
) {
  return projectsCanvasCreateService.generateAssetImage(projectId, assetId, input);
}

export async function listStoryboards(projectId: string, episodeNo?: number) {
  return projectsCanvasCreateService.listStoryboards(projectId, episodeNo);
}

export async function getStoryboard(projectId: string, storyboardId: string): Promise<Storyboard> {
  return projectsCanvasCreateService.getStoryboard(projectId, storyboardId);
}

export async function updateStoryboard(
  projectId: string,
  storyboardId: string,
  input: Partial<Storyboard>,
): Promise<Storyboard> {
  return projectsCanvasCreateService.updateStoryboard(projectId, storyboardId, input);
}

export async function deleteStoryboard(projectId: string, storyboardId: string) {
  return projectsCanvasCreateService.deleteStoryboard(projectId, storyboardId);
}

export async function autoGenerateStoryboards(
  projectId: string,
  sourceText?: string,
  options?: { systemPrompt?: string; maxShots?: number; episodeNo?: number },
) {
  return projectsCanvasCreateService.autoGenerateStoryboards(projectId, sourceText, options);
}

export async function getCreateCreditQuote(actionCode: string, input?: CreditQuoteRequestInput) {
  return projectsCanvasCreateService.getCreateCreditQuote(actionCode, input);
}

export async function getProjectCreditQuote(
  projectId: string,
  actionCode: string,
  input?: CreditQuoteRequestInput,
) {
  return projectsCanvasCreateService.getProjectCreditQuote(projectId, actionCode, input);
}

export async function generateStoryboardImage(
  storyboardId: string,
  prompt?: string,
  referenceImageUrls?: string[],
  imageModel?: string,
) {
  return projectsCanvasCreateService.generateStoryboardImage(storyboardId, prompt, referenceImageUrls, imageModel);
}

export async function listVideos(projectId: string) {
  return projectsCanvasCreateService.listVideos(projectId);
}

export async function generateVideo(
  storyboardId: string,
  input?: { motionPreset?: string; mode?: string },
) {
  return projectsCanvasCreateService.generateVideo(storyboardId, input);
}

export async function listDubbings(projectId: string) {
  return projectsCanvasCreateService.listDubbings(projectId);
}

export async function updateDubbing(
  projectId: string,
  dubbingId: string,
  input: Partial<Dubbing>,
) {
  return projectsCanvasCreateService.updateDubbing(projectId, dubbingId, input);
}

export async function generateDubbing(
  storyboardId: string,
  input?: { text?: string; speakerName?: string; voicePreset?: string },
) {
  return projectsCanvasCreateService.generateDubbing(storyboardId, input);
}

export async function generateLipSync(storyboardId: string) {
  return projectsCanvasCreateService.generateLipSync(storyboardId);
}

export async function getTimeline(projectId: string) {
  return projectsCanvasCreateService.getTimeline(projectId);
}

export async function updateTimeline(
  projectId: string,
  input: Pick<Timeline, "tracks" | "totalDurationSeconds">,
) {
  return projectsCanvasCreateService.updateTimeline(projectId, input);
}

export async function createExport(projectId: string, format = "mp4") {
  return projectsCanvasCreateService.createExport(projectId, format);
}

export async function listTasks(projectId?: string, type?: string) {
  return jobsService.listTasks(projectId, type);
}

export async function getTask(taskId: string) {
  return jobsService.getTask(taskId);
}

export async function dismissTask(taskId: string) {
  return jobsService.dismissTask(taskId);
}

export async function deleteTask(taskId: string) {
  return dismissTask(taskId);
}

export async function clearTasks(projectId?: string, type?: string) {
  return jobsService.clearTasks(projectId, type);
}

export async function getWallet(ownerType?: WalletOwnerType, ownerId?: string) {
  return walletPaymentService.getWallet(ownerType, ownerId);
}

export async function listWallets(ownerType?: WalletOwnerType, ownerId?: string) {
  return walletPaymentService.listWallets(ownerType, ownerId);
}

export async function listWalletLedger(walletId: string) {
  return walletPaymentService.listWalletLedger(walletId);
}

export async function getWalletUsageStats(mode?: CreditUsageMode, ownerId?: string) {
  return walletPaymentService.getWalletUsageStats(mode, ownerId);
}

export async function searchCreditUsageSubjects(search?: string) {
  return walletPaymentService.searchCreditUsageSubjects(search);
}

export async function getAdminCreditUsageStats(input: {
  subjectType: CreditUsageSubject["type"];
  subjectId?: string | null;
}) {
  return walletPaymentService.getAdminCreditUsageStats(input);
}

export async function createWalletRechargeOrder(
  input: CreateWalletRechargeOrderInput,
): Promise<WalletRechargeOrder> {
  return walletPaymentService.createWalletRechargeOrder(input);
}

export async function getWalletRechargeCapabilities() {
  return walletPaymentService.getWalletRechargeCapabilities();
}

export async function getWalletRechargeOrder(orderId: string): Promise<WalletRechargeOrder> {
  return walletPaymentService.getWalletRechargeOrder(orderId);
}

export async function refreshWalletRechargeOrderStatus(orderId: string): Promise<WalletRechargeOrder> {
  return walletPaymentService.refreshWalletRechargeOrderStatus(orderId);
}

export async function submitWalletRechargeTransferProof(
  orderId: string,
  input: {
    voucherFiles: string[];
    note?: string;
    transferReference?: string;
  },
): Promise<WalletRechargeOrder> {
  return walletPaymentService.submitWalletRechargeTransferProof(orderId, input);
}

export async function confirmWalletRechargeOrder(orderId: string): Promise<WalletRechargeOrder> {
  return walletPaymentService.confirmWalletRechargeOrder(orderId);
}

export async function getToolboxCapabilities() {
  return toolboxService.getToolboxCapabilities();
}

export async function getCapabilities() {
  return toolboxService.getCapabilities();
}

export async function getApiCenterConfig() {
  return authAccountService.getApiCenterConfig();
}

export async function updateApiCenterDefaults(input: Partial<ApiCenterConfig["defaults"]>) {
  return authAccountService.updateApiCenterDefaults(input);
}

export async function saveApiCenterVendorApiKey(vendorId: string, apiKey: string) {
  return authAccountService.saveApiCenterVendorApiKey(vendorId, apiKey);
}

export async function testApiCenterVendorConnection(vendorId: string) {
  return authAccountService.testApiCenterVendorConnection(vendorId);
}

export async function updateApiVendorModel(
  vendorId: string,
  modelId: string,
  input: Partial<Pick<ApiVendorModel, "enabled">>,
) {
  return authAccountService.updateApiVendorModel(vendorId, modelId, input);
}

/** Bidirectional text translation via Qwen-Plus. targetLang: 'en' | 'zh' */
export async function translateText(text: string, targetLang: "en" | "zh") {
  return toolboxService.translateText(text, targetLang);
}

/** Whitelisted Qwen-Omni model IDs (must match core-api ALLOWED_QWEN_OMNI_MODELS). */
export type QwenOmniModel =
  | "qwen3.5-omni-plus"
  | "qwen3.5-omni-flash"
  | "qwen-omni-turbo";

export type StoryboardGrid25Reference = {
  name: string;   // The @-tag name, e.g. "小明", "背景", "宝剑"
  url: string;    // Uploaded image URL
};

/** Gemini 3 Pro — generate a 5×5 storyboard grid image from a plot description. */
export async function generateStoryboardGrid25(
  plotText: string,
  options?: {
    references?: StoryboardGrid25Reference[];
    model?: string;
  },
) {
  return toolboxService.generateStoryboardGrid25(plotText, options);
}

/** Qwen3.5-Omni video-to-prompt reverse analysis. */
export async function reverseVideoPrompt(
  videoUrl: string,
  options?: { prompt?: string; model?: QwenOmniModel },
) {
  return toolboxService.reverseVideoPrompt(videoUrl, options);
}

export async function uploadFile(file: File, kind = "file") {
  return mediaService.uploadFile(file, kind);
}

export async function uploadDataUrlAsFile(dataUrl: string, kind = "file", nameHint = "upload") {
  return mediaService.uploadDataUrlAsFile(dataUrl, kind, nameHint);
}

export async function listPricingRules() {
  return adminEnterpriseService.listPricingRules();
}

export async function listAdminOrders() {
  return adminEnterpriseService.listAdminOrders();
}

export async function reviewAdminOrder(
  orderId: string,
  input: { decision: "approve" | "reject"; note?: string },
): Promise<WalletRechargeOrder> {
  return adminEnterpriseService.reviewAdminOrder(orderId, input);
}

export async function listOrganizationMembers(organizationId: string) {
  return authAccountService.listOrganizationMembers(organizationId);
}

export async function createOrganizationMember(
  organizationId: string,
  input: CreateOrganizationMemberInput,
) {
  return authAccountService.createOrganizationMember(organizationId, input);
}

export async function getOrganizationWallet(organizationId: string) {
  return authAccountService.getOrganizationWallet(organizationId);
}

export async function loginWithEmail(input: LoginInput) {
  return withResultCurrentOrganizationSelection(
    await authAccountService.loginWithEmail(input),
  );
}

export async function loginAdminWithEmail(input: LoginInput) {
  return withResultCurrentOrganizationSelection(
    await authAccountService.loginAdminWithEmail(input),
  );
}

export async function bootstrapPlatformPassword(input: BootstrapPlatformPasswordInput) {
  return authAccountService.bootstrapPlatformPassword(input);
}

export async function changePassword(input: ChangePasswordInput) {
  return authAccountService.changePassword(input);
}

export async function adminResetPassword(input: AdminResetPasswordInput) {
  return authAccountService.adminResetPassword(input);
}

export async function requestPasswordReset(input: RequestPasswordResetInput) {
  return authAccountService.requestPasswordReset(input);
}

export async function completePasswordReset(input: CompletePasswordResetInput) {
  return authAccountService.completePasswordReset(input);
}

export async function startDemoSession(actorId: string): Promise<LoginResult> {
  return withResultCurrentOrganizationSelection(
    await authAccountService.startDemoSession(actorId),
  );
}

export async function getAuthProviders() {
  return authAccountService.getAuthProviders();
}

export async function exchangeGoogleLogin(code: string): Promise<LoginResult> {
  return withResultCurrentOrganizationSelection(
    await authAccountService.exchangeGoogleLogin(code),
  );
}

export type PlaygroundModel = {
  id: string;
  name: string;
  provider: string;
  configured: boolean;
  default?: boolean;
};

export type PlaygroundConversation = {
  id: string;
  actorId: string;
  title: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string | null;
  messageCount: number;
  archived?: boolean;
};

export type PlaygroundMessage = {
  id: string;
  conversationId: string;
  actorId: string;
  role: "system" | "user" | "assistant";
  content: string;
  model: string | null;
  status: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type PlaygroundMemory = {
  key: string;
  value: string;
  enabled: boolean;
  confidence: number | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PlaygroundMemoryPreference = {
  enabled: boolean;
  updatedAt: string | null;
};

export type PlaygroundChatInput = {
  conversationId?: string | null;
  message: string;
  model?: string;
};

export type PlaygroundChatJob = {
  id: string;
  actorId: string;
  conversationId: string;
  userMessageId: string | null;
  assistantMessageId: string | null;
  model: string | null;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  progress: number;
  request?: Record<string, unknown>;
  result?: Record<string, unknown> | null;
  error?: { code?: string; message?: string } | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
};

export type PlaygroundChatJobStartResult = {
  job: PlaygroundChatJob;
  conversation: PlaygroundConversation;
  userMessage: PlaygroundMessage;
  assistantMessage: PlaygroundMessage;
};

export type PlaygroundChatEvent =
  | { type: "conversation"; conversation: PlaygroundConversation }
  | { type: "user_message"; message: PlaygroundMessage }
  | { type: "assistant_message"; message: PlaygroundMessage }
  | { type: "job"; job: PlaygroundChatJob }
  | { type: "delta"; messageId: string; delta: string }
  | { type: "done"; conversation: PlaygroundConversation; message: PlaygroundMessage | null; memories: PlaygroundMemory[]; job?: PlaygroundChatJob }
  | { type: "error"; code: string; message: string; job?: PlaygroundChatJob };

export async function getPlaygroundConfig() {
  return playgroundService.getPlaygroundConfig();
}

export async function listPlaygroundModels() {
  return playgroundService.listPlaygroundModels();
}

export async function listPlaygroundConversations(search?: string) {
  return playgroundService.listPlaygroundConversations(search);
}

export async function createPlaygroundConversation(input: { title?: string; model?: string } = {}) {
  return playgroundService.createPlaygroundConversation(input);
}

export async function updatePlaygroundConversation(
  conversationId: string,
  input: Partial<Pick<PlaygroundConversation, "title" | "model">>,
) {
  return playgroundService.updatePlaygroundConversation(conversationId, input);
}

export async function deletePlaygroundConversation(conversationId: string) {
  return playgroundService.deletePlaygroundConversation(conversationId);
}

export async function getPlaygroundConversation(conversationId: string) {
  return playgroundService.getPlaygroundConversation(conversationId);
}

export async function listPlaygroundMessages(conversationId: string) {
  return playgroundService.listPlaygroundMessages(conversationId);
}

export async function listPlaygroundChatJobs(options: {
  conversationId?: string;
  activeOnly?: boolean;
  status?: string;
  limit?: number;
} = {}) {
  return playgroundService.listPlaygroundChatJobs(options);
}

export async function getPlaygroundChatJob(jobId: string) {
  return playgroundService.getPlaygroundChatJob(jobId);
}

export async function startPlaygroundChatJob(input: PlaygroundChatInput) {
  return playgroundService.startPlaygroundChatJob(input);
}

export async function listPlaygroundMemories() {
  return playgroundService.listPlaygroundMemories();
}

export async function updatePlaygroundMemoryPreference(input: Partial<PlaygroundMemoryPreference>) {
  return playgroundService.updatePlaygroundMemoryPreference(input);
}

export async function updatePlaygroundMemory(
  key: string,
  input: Partial<Pick<PlaygroundMemory, "key" | "value" | "enabled">>,
) {
  return playgroundService.updatePlaygroundMemory(key, input);
}

export async function deletePlaygroundMemory(key: string) {
  return playgroundService.deletePlaygroundMemory(key);
}

export async function runPlaygroundChatFacade(
  input: PlaygroundChatInput,
  onEvent: (event: PlaygroundChatEvent) => void,
  signal?: AbortSignal,
) {
  return playgroundService.runPlaygroundChatFacade(input, onEvent, signal);
}

export async function streamPlaygroundChat(
  input: PlaygroundChatInput,
  onEvent: (event: PlaygroundChatEvent) => void,
  signal?: AbortSignal,
) {
  return playgroundService.streamPlaygroundChat(input, onEvent, signal);
}

export async function registerPersonalUser(input: RegisterPersonalInput) {
  return withResultCurrentOrganizationSelection(
    await authAccountService.registerPersonalUser(input),
  );
}

export async function registerEnterpriseAdmin(input: RegisterEnterpriseAdminInput) {
  return withResultCurrentOrganizationSelection(
    await authAccountService.registerEnterpriseAdmin(input),
  );
}

export type CanvasProject = {
  id: string;
  actorId: string;
  title: string;
  thumbnailUrl: string | null;
  canvasData: unknown;
  createdAt: string;
  updatedAt: string;
};

export type CanvasProjectSummary = Omit<CanvasProject, "canvasData">;

export type AgentCanvasProject = CanvasProject & {
  kind?: "agent_canvas";
  agentContext?: unknown | null;
};

export type AgentCanvasProjectSummary = Omit<AgentCanvasProject, "canvasData" | "agentContext">;

export async function listCanvasProjects() {
  return projectsCanvasCreateService.listCanvasProjects();
}

export async function getCanvasProject(projectId: string) {
  return projectsCanvasCreateService.getCanvasProject(projectId);
}

export async function saveCanvasProject(input: {
  id?: string;
  title?: string;
  thumbnailUrl?: string | null;
  canvasData?: unknown;
  expectedUpdatedAt?: string | null;
  baseTitle?: string | null;
  baseCanvasData?: unknown;
}) {
  return projectsCanvasCreateService.saveCanvasProject(input);
}

export async function deleteCanvasProject(projectId: string) {
  return projectsCanvasCreateService.deleteCanvasProject(projectId);
}

export async function listAgentCanvasProjects() {
  return projectsCanvasCreateService.listAgentCanvasProjects();
}

export async function getAgentCanvasProject(projectId: string) {
  return projectsCanvasCreateService.getAgentCanvasProject(projectId);
}

export async function saveAgentCanvasProject(input: {
  id?: string;
  title?: string;
  thumbnailUrl?: string | null;
  canvasData?: unknown;
  agentContext?: unknown | null;
  expectedUpdatedAt?: string | null;
  baseTitle?: string | null;
  baseCanvasData?: unknown;
}) {
  return projectsCanvasCreateService.saveAgentCanvasProject(input);
}

export async function deleteAgentCanvasProject(projectId: string) {
  return projectsCanvasCreateService.deleteAgentCanvasProject(projectId);
}

export async function runToolboxCapability(
  type: "character_replace" | "motion_transfer" | "upscale_restore",
  input: { projectId?: string; note?: string; target?: string; storyboardId?: string },
) {
  return toolboxService.runToolboxCapability(type, input);
}

// ═══════════════════════════════════════════════════════════════════════
// Video Replace MVP
// Chain: browser → 3000 (Vite) → 4100 (core-api, native handler) → Python CLI
// There is NO port 4200 in the default architecture. core-api handles
// every /api/video-replace and /vr-* path itself and spawns Python
// subprocesses (vr_probe_cli.py / vr_detect_cli.py / vr_pipeline_cli.py)
// on demand.
// ═══════════════════════════════════════════════════════════════════════

const VIDEO_REPLACE_BASE = "/api/video-replace";

export type VideoReplaceStage =
  | "uploaded"
  | "detecting"
  | "detected"
  | "queued"
  | "tracking"
  | "mask_ready"
  | "replacing"
  | "succeeded"
  | "failed"
  | "cancelled";

export type VideoReplaceMeta = {
  duration_seconds: number;
  width: number;
  height: number;
  fps: number;
  frame_count: number;
  codec: string | null;
};

export type VideoReplaceUploadResult = {
  job_id: string;
  video_url: string;
  thumbnail_url: string | null;
  meta: VideoReplaceMeta;
};

export type VideoReplaceReferenceResult = {
  url: string;
  filename: string;
  content_type: string;
  size_bytes: number;
};

export type VideoReplacePersonCandidate = {
  person_id: string;
  bbox: number[];
  confidence: number;
  preview_url: string;
  mask_preview_url: string | null;
};

export type VideoReplaceDetection = {
  job_id: string;
  keyframe_index: number;
  keyframe_url: string;
  candidates: VideoReplacePersonCandidate[];
};

export type VideoReplaceAdvanced = {
  yolo_conf: number;
  sam2_size: "tiny" | "small" | "base_plus";
  mask_dilation_px: number;
  mask_blur_px: number;
  sample_steps: number;
  sample_size: "832*480" | "480*832";
  inference_fps?: 15 | 30 | 60;
  max_frame_num?: number;
  frame_num?: number;
  output_fps?: number;
  base_seed: number | null;
};

export type VideoReplaceMode = "full" | "lite";

export type VideoReplaceJobStatus = {
  job_id: string;
  stage: VideoReplaceStage;
  progress: number;
  message: string | null;
  error: string | null;
  queue_ahead?: number | null;
  queue_position?: number | null;
  created_at: string;
  updated_at: string;
  actor_id?: string | null;
  project_id?: string | null;
  project_asset_id?: string | null;
  source_video_url: string | null;
  thumbnail_url: string | null;
  meta: VideoReplaceMeta | null;
  detection: VideoReplaceDetection | null;
  source_person_id: string | null;
  target_reference_url: string | null;
  advanced: VideoReplaceAdvanced | null;
  mask_preview_url: string | null;
  // Legacy (aliases the final/browser-compat deliverable)
  result_video_url: string | null;
  result_download_url: string | null;
  // Dual-track results: `raw` is the pipeline artifact before postprocess,
  // `final` is the H.264/AAC mp4 with audio muxed back in — this is what
  // the UI must play and offer as a download.
  raw_result_video_url: string | null;
  final_result_video_url: string | null;
  final_result_download_url: string | null;
  // Which pipeline actually ran. "full" = SAM2 + VACE, "lite" = OpenCV fallback.
  mode: VideoReplaceMode | null;
  tracker_backend: string | null;
  replacer_backend: string | null;
};

export type VideoReplaceGenerateInput = {
  source_person_id: string;
  target_reference_url: string;
  project_id?: string | null;
  prompt?: string | null;
  yolo_conf?: number;
  sam2_size?: "tiny" | "small" | "base_plus";
  mask_dilation_px?: number;
  mask_blur_px?: number;
  sample_steps?: number;
  sample_size?: "832*480" | "480*832";
  inference_fps?: 15 | 30 | 60;
  max_frame_num?: number;
  base_seed?: number | null;
};

async function videoReplaceRequest<T>(path: string, init?: RequestInit): Promise<T> {
  assertNoLegacyMutatingRequest(`${VIDEO_REPLACE_BASE}${path}`, init);

  const actorId = getCurrentActorId();
  const token = getAuthToken();
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("X-Actor-Id", actorId);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${VIDEO_REPLACE_BASE}${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  let payload: ApiEnvelope<T> | null = null;
  if (text) {
    try {
      payload = JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      throw new ApiRequestError(
        response.ok ? "视频替换服务返回格式无效" : `视频替换接口错误（${response.status}）`,
        { code: "VR_INVALID_RESPONSE", status: response.status || 500 },
      );
    }
  }
  if (!payload) {
    throw new ApiRequestError(
      response.ok ? "视频替换服务返回为空" : `视频替换接口错误（${response.status}）`,
      { code: "VR_EMPTY_RESPONSE", status: response.status || 500 },
    );
  }
  if (!response.ok || !payload.success) {
    throw new ApiRequestError(
      payload.error?.message ?? "视频替换接口请求失败",
      { code: payload.error?.code, status: response.status },
    );
  }
  return payload.data;
}

export async function uploadVideoReplaceSource(file: File) {
  const form = new FormData();
  form.append("file", file);
  return videoReplaceRequest<VideoReplaceUploadResult>("/upload", {
    method: "POST",
    body: form,
  });
}

/**
 * Create a job from an already-hosted video URL (e.g. a project asset
 * served by core-api). The backend fetches and re-persists the video.
 */
export async function importVideoReplaceJob(input: {
  video_url: string;
  original_filename?: string;
  project_id?: string | null;
}) {
  return videoReplaceRequest<VideoReplaceUploadResult>("/jobs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function uploadVideoReplaceReference(file: File) {
  const form = new FormData();
  form.append("file", file);
  return videoReplaceRequest<VideoReplaceReferenceResult>("/reference", {
    method: "POST",
    body: form,
  });
}

/**
 * Pin an existing image asset (e.g. a project character reference) as
 * the replacement character. The backend downloads and re-hosts it so
 * subsequent pipeline stages can read from a stable local path.
 */
export async function importVideoReplaceReference(input: {
  image_url: string;
  original_filename?: string;
}) {
  return videoReplaceRequest<VideoReplaceReferenceResult>("/reference-import", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function detectVideoReplaceCandidates(
  jobId: string,
  opts: { yolo_conf?: number } = {},
) {
  return videoReplaceRequest<VideoReplaceJobStatus>(
    `/jobs/${encodeURIComponent(jobId)}/detect`,
    {
      method: "POST",
      body: JSON.stringify(
        opts.yolo_conf !== undefined ? { yolo_conf: opts.yolo_conf } : {},
      ),
    },
  );
}

export async function submitVideoReplaceGenerate(
  jobId: string,
  input: VideoReplaceGenerateInput,
) {
  return videoReplaceRequest<VideoReplaceJobStatus>(
    `/jobs/${encodeURIComponent(jobId)}/generate`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function getVideoReplaceJob(jobId: string) {
  return videoReplaceRequest<VideoReplaceJobStatus>(
    `/jobs/${encodeURIComponent(jobId)}`,
  );
}

export async function listVideoReplaceJobs(limit = 30, projectId?: string | null) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (projectId) params.set("project_id", projectId);
  return videoReplaceRequest<{ items: VideoReplaceJobStatus[] }>(
    `/jobs?${params.toString()}`,
  );
}

export async function syncVideoReplaceJobAsset(projectId: string, jobId: string) {
  return videoReplaceRequest<{ asset: Asset; job: VideoReplaceJobStatus }>(
    `/jobs/${encodeURIComponent(jobId)}/sync-asset`,
    {
      method: "POST",
      body: JSON.stringify({ project_id: projectId }),
    },
  );
}

export async function cancelVideoReplaceJob(jobId: string) {
  return videoReplaceRequest<VideoReplaceJobStatus>(
    `/jobs/${encodeURIComponent(jobId)}/cancel`,
    { method: "POST" },
  );
}

export function videoReplaceStreamUrl(jobId: string): string {
  const params = new URLSearchParams({ actorId: getCurrentActorId() });
  return `${VIDEO_REPLACE_BASE}/jobs/${encodeURIComponent(jobId)}/stream?${params.toString()}`;
}
