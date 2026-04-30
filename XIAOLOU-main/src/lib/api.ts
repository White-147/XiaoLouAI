import { getCurrentActorId, getAuthToken } from "./actor-session";
import { isLocalLoopbackAccess, SUPER_ADMIN_DEMO_ACTOR_ID } from "./local-loopback";
import type {
  MediaCapabilitiesResponse,
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

export const API_BASE_URL =
  import.meta.env.VITE_CORE_API_BASE_URL ?? "";

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
export type CreditUsageSubjectType = "user" | "organization" | "platform";

export type CreditUsageSubject = {
  type: CreditUsageSubjectType;
  id: string | null;
  label: string;
  detail?: string | null;
  role?: string | null;
};

export type CreditUsageSeriesPoint = {
  bucketStart: string;
  bucketLabel: string;
  consumedCredits: number;
  refundedCredits: number;
};

export type CreditUsageStats = {
  subject: CreditUsageSubject;
  mode: CreditUsageMode | "admin" | null;
  windowDays: number;
  bucket: "day";
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

export type LoginResult = {
  actorId: string;
  token: string;
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

export type ApiVendorConnectionTestResult = {
  vendor: ApiVendor;
  checkedAt: string;
  modelCount: number;
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

export class ApiRequestError extends Error {
  code: string;
  status: number;

  constructor(message: string, options?: { code?: string; status?: number }) {
    super(message);
    this.name = "ApiRequestError";
    this.code = options?.code || "API_REQUEST_FAILED";
    this.status = options?.status ?? 500;
  }
}

type TaskAccepted = {
  taskId: string;
  status: string;
  task: Task;
};

function isRouteNotFoundError(error: unknown) {
  return error instanceof Error && /route not found/i.test(error.message);
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
    status: wallet.status ?? "active",
    allowNegative: wallet.allowNegative ?? false,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const actorId = getCurrentActorId();
  const token = getAuthToken();
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("X-Actor-Id", actorId);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
    });
  } catch (error) {
    throw new ApiRequestError("无法连接到本地创作服务，请确认 core-api 正在运行后重试。", {
      code: "NETWORK_ERROR",
      status: 0,
    });
  }

  const responseText = await response.text();
  let payload: ApiEnvelope<T> | null = null;

  if (responseText) {
    try {
      payload = JSON.parse(responseText) as ApiEnvelope<T>;
    } catch {
      throw new ApiRequestError(
        response.ok
          ? "接口返回格式无效"
          : `接口请求失败（${response.status || "NETWORK"}）`,
        {
          code: "INVALID_API_RESPONSE",
          status: response.status || 500,
        },
      );
    }
  }

  if (!payload) {
    throw new ApiRequestError(
      response.ok
        ? "接口返回为空"
        : `接口请求失败（${response.status || "NETWORK"}）`,
      {
        code: "EMPTY_API_RESPONSE",
        status: response.status || 500,
      },
    );
  }

  if (!response.ok || !payload.success) {
    throw new ApiRequestError(payload.error?.message ?? "接口请求失败", {
      code: payload.error?.code,
      status: response.status,
    });
  }

  return payload.data;
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

export async function getMe() {
  try {
    return await request<PermissionContext>("/api/me");
  } catch (error) {
    if (isRouteNotFoundError(error)) {
      return buildFallbackPermissionContext(getCurrentActorId());
    }
    throw error;
  }
}

export async function updateMe(data: { displayName?: string; avatar?: string | null }) {
  return await request<PermissionContext>("/api/me", {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function listProjects() {
  return request<{ items: Project[]; total: number }>("/api/projects");
}

export async function getNetworkAccessInfo() {
  return request<NetworkAccessInfo>("/api/system/network-access");
}

export async function ensureJaazServices() {
  return request<JaazServiceStatus>("/api/jaaz/ensure", {
    method: "POST",
  });
}

export async function listCreateImages() {
  return request<{ items: CreateImageResult[] }>("/api/create/images");
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
  const { idempotencyKey, ...body } = input;
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return request<TaskAccepted>("/api/create/images/generate", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export async function listCreateVideos() {
  return request<{ items: CreateVideoResult[] }>("/api/create/videos");
}

export async function getCreateImageCapabilities(mode?: string | null) {
  const params = mode ? `?mode=${encodeURIComponent(mode)}` : "";
  return request<MediaCapabilitiesResponse>(`/api/create/images/capabilities${params}`);
}

export async function getCreateVideoCapabilities(
  mode: string,
) {
  return request<MediaCapabilitiesResponse>(`/api/create/videos/capabilities?mode=${encodeURIComponent(mode)}`);
}

function appendCreditQuoteInput(search: URLSearchParams, input?: CreditQuoteRequestInput) {
  if (input?.projectId) search.set("projectId", input.projectId);
  if (input?.sourceText) search.set("sourceText", input.sourceText);
  if (input?.text) search.set("text", input.text);
  if (input?.count) search.set("count", String(input.count));
  if (input?.shotCount) search.set("shotCount", String(input.shotCount));
  if (input?.storyboardId) search.set("storyboardId", input.storyboardId);
  if (input?.model) search.set("model", input.model);
  if (input?.aspectRatio) search.set("aspectRatio", input.aspectRatio);
  if (input?.resolution) search.set("resolution", input.resolution);
}

export async function getCreateCreditQuote(actionCode: string, input?: CreditQuoteRequestInput) {
  const search = new URLSearchParams({ action: actionCode });
  appendCreditQuoteInput(search, input);
  return request<CreditQuote>(`/api/create/credit-quote?${search.toString()}`);
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
  videoMode?: VideoGenerationMode;
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
  const { idempotencyKey, ...body } = input;
  const headers: Record<string, string> = {};
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  return request<TaskAccepted>("/api/create/videos/generate", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

export async function deleteCreateImage(imageId: string) {
  return request<CreateImageResult>(`/api/create/images/${imageId}`, {
    method: "DELETE",
  });
}

export async function deleteCreateVideo(videoId: string) {
  return request<CreateVideoResult>(`/api/create/videos/${videoId}`, {
    method: "DELETE",
  });
}

export async function createProject(input: {
  title: string;
  summary?: string;
  ownerType?: "personal" | "organization";
  organizationId?: string;
}) {
  return request<Project>("/api/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateProject(projectId: string, input: Partial<Project>) {
  return request<Project>(`/api/projects/${projectId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function getProject(projectId: string) {
  return request<Project>(`/api/projects/${projectId}`);
}

export async function getProjectOverview(projectId: string) {
  return request<ProjectOverview>(`/api/projects/${projectId}/overview`);
}

export async function getSettings(projectId: string) {
  return request<Settings>(`/api/projects/${projectId}/settings`);
}

export async function updateSettings(projectId: string, input: Partial<Settings>) {
  return request<Settings>(`/api/projects/${projectId}/settings`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function getScript(projectId: string) {
  return request<Script>(`/api/projects/${projectId}/script`);
}

export async function updateScript(projectId: string, content: string) {
  return request<Script>(`/api/projects/${projectId}/script`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
}

export async function rewriteScript(projectId: string, instruction: string) {
  return request<TaskAccepted>(`/api/projects/${projectId}/script/rewrite`, {
    method: "POST",
    body: JSON.stringify({ instruction }),
  });
}

export async function listAssets(projectId: string, assetType?: string) {
  const search = assetType ? `?assetType=${encodeURIComponent(assetType)}` : "";
  return request<{ items: Asset[] }>(`/api/projects/${projectId}/assets${search}`);
}

export async function getAsset(projectId: string, assetId: string) {
  return request<Asset>(
    `/api/projects/${projectId}/assets/${encodeURIComponent(assetId)}`,
  );
}

export async function createAsset(
  projectId: string,
  input: CreateAssetInput,
) {
  return request<Asset>(`/api/projects/${projectId}/assets`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function syncAgentStudioAsset(
  projectId: string,
  input: AgentStudioAssetSyncInput,
) {
  return request<Asset>(`/api/projects/${projectId}/assets/agent-studio/sync`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function syncAgentStudioCanvasProject(
  projectId: string,
  input: AgentStudioCanvasProjectSyncInput,
) {
  return request<Asset>(`/api/projects/${projectId}/assets/agent-studio/projects/sync`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateAsset(projectId: string, assetId: string, input: Partial<Asset>) {
  return request<Asset>(`/api/projects/${projectId}/assets/${assetId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteAsset(projectId: string, assetId: string) {
  return request<{ deleted: boolean; assetId: string }>(
    `/api/projects/${projectId}/assets/${assetId}`,
    {
      method: "DELETE",
    },
  );
}

export async function extractAssets(projectId: string, sourceText: string) {
  return request<TaskAccepted>(`/api/projects/${projectId}/assets/extract`, {
    method: "POST",
    body: JSON.stringify({ sourceText }),
  });
}

export async function generateAssetImage(
  projectId: string,
  assetId: string,
  input: AssetImageGenerateInput,
) {
  return request<TaskAccepted>(`/api/projects/${projectId}/assets/${assetId}/images/generate`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listStoryboards(projectId: string, episodeNo?: number) {
  const qs = episodeNo != null ? `?episodeNo=${episodeNo}` : "";
  return request<{ items: Storyboard[] }>(`/api/projects/${projectId}/storyboards${qs}`);
}

export async function getStoryboard(projectId: string, storyboardId: string) {
  return request<Storyboard>(`/api/projects/${projectId}/storyboards/${storyboardId}`);
}

export async function updateStoryboard(
  projectId: string,
  storyboardId: string,
  input: Partial<Storyboard>,
) {
  return request<Storyboard>(`/api/projects/${projectId}/storyboards/${storyboardId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteStoryboard(projectId: string, storyboardId: string) {
  return request<{ deleted: boolean; storyboardId: string }>(
    `/api/projects/${projectId}/storyboards/${storyboardId}`,
    {
      method: "DELETE",
    },
  );
}

export async function autoGenerateStoryboards(
  projectId: string,
  sourceText?: string,
  options?: { systemPrompt?: string; maxShots?: number; episodeNo?: number },
) {
  return request<TaskAccepted>(`/api/projects/${projectId}/storyboards/auto-generate`, {
    method: "POST",
    body: JSON.stringify({
      ...(sourceText ? { sourceText } : {}),
      ...(options?.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
      ...(options?.maxShots ? { maxShots: options.maxShots } : {}),
      ...(options?.episodeNo != null ? { episodeNo: options.episodeNo } : {}),
    }),
  });
}

export async function getProjectCreditQuote(
  projectId: string,
  actionCode: string,
  input?: CreditQuoteRequestInput,
) {
  const search = new URLSearchParams({ action: actionCode });
  appendCreditQuoteInput(search, input);

  return request<CreditQuote>(`/api/projects/${projectId}/credit-quote?${search.toString()}`);
}

export async function generateStoryboardImage(
  storyboardId: string,
  prompt?: string,
  referenceImageUrls?: string[],
  imageModel?: string,
) {
  return request<TaskAccepted>(`/api/storyboards/${storyboardId}/images/generate`, {
    method: "POST",
    body: JSON.stringify({
      prompt,
      ...(referenceImageUrls?.length ? { referenceImageUrls } : {}),
      ...(imageModel ? { imageModel } : {}),
    }),
  });
}

export async function listVideos(projectId: string) {
  return request<{ items: VideoItem[] }>(`/api/projects/${projectId}/videos`);
}

export async function generateVideo(
  storyboardId: string,
  input?: { motionPreset?: string; mode?: string },
) {
  return request<TaskAccepted>(`/api/storyboards/${storyboardId}/videos/generate`, {
    method: "POST",
    body: JSON.stringify(input ?? {}),
  });
}

export async function listDubbings(projectId: string) {
  return request<{ items: Dubbing[] }>(`/api/projects/${projectId}/dubbings`);
}

export async function updateDubbing(
  projectId: string,
  dubbingId: string,
  input: Partial<Dubbing>,
) {
  return request<Dubbing>(`/api/projects/${projectId}/dubbings/${dubbingId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function generateDubbing(
  storyboardId: string,
  input?: { text?: string; speakerName?: string; voicePreset?: string },
) {
  return request<TaskAccepted>(`/api/storyboards/${storyboardId}/dubbings/generate`, {
    method: "POST",
    body: JSON.stringify(input ?? {}),
  });
}

export async function generateLipSync(storyboardId: string) {
  return request<TaskAccepted>(`/api/storyboards/${storyboardId}/lipsync/generate`, {
    method: "POST",
  });
}

export async function getTimeline(projectId: string) {
  return request<Timeline>(`/api/projects/${projectId}/timeline`);
}

export async function updateTimeline(
  projectId: string,
  input: Pick<Timeline, "tracks" | "totalDurationSeconds">,
) {
  return request<Timeline>(`/api/projects/${projectId}/timeline`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function createExport(projectId: string, format = "mp4") {
  return request<TaskAccepted>(`/api/projects/${projectId}/exports`, {
    method: "POST",
    body: JSON.stringify({ format }),
  });
}

export async function listTasks(projectId?: string, type?: string) {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (type) params.set("type", type);
  const search = params.toString() ? `?${params.toString()}` : "";
  return request<{ items: Task[] }>(`/api/tasks${search}`);
}

export async function getTask(taskId: string) {
  return request<Task>(`/api/tasks/${taskId}`);
}

export async function deleteTask(taskId: string) {
  return request<{ deleted: boolean; taskId: string }>(`/api/tasks/${taskId}`, {
    method: "DELETE",
  });
}

export async function clearTasks(projectId?: string, type?: string) {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (type) params.set("type", type);
  const search = params.toString() ? `?${params.toString()}` : "";
  return request<{ removedCount: number }>(`/api/tasks${search}`, {
    method: "DELETE",
  });
}

export async function getWallet() {
  return request<Wallet>("/api/wallet");
}

export async function listWallets() {
  try {
    return await request<{ items: Wallet[] }>("/api/wallets");
  } catch (error) {
    if (!isRouteNotFoundError(error)) throw error;

    const actorId = getCurrentActorId();
    const effectiveActorId =
      actorId === SUPER_ADMIN_DEMO_ACTOR_ID && !isLocalLoopbackAccess() ? "guest" : actorId;
    if (effectiveActorId === "guest" || effectiveActorId === "ops_demo_001" || effectiveActorId === SUPER_ADMIN_DEMO_ACTOR_ID) {
      return { items: [] };
    }

    const wallet = await getWallet();
    return { items: [normalizeWalletRecord(wallet, effectiveActorId)] };
  }
}

export async function listWalletLedger(walletId: string) {
  try {
    return await request<{ items: WalletLedgerEntry[] }>(`/api/wallets/${walletId}/ledger`);
  } catch (error) {
    if (isRouteNotFoundError(error)) {
      return { items: [] };
    }
    throw error;
  }
}

export async function getWalletUsageStats(mode: CreditUsageMode = "personal") {
  const search = new URLSearchParams({ mode });
  return request<CreditUsageStats>(`/api/wallet/usage-stats?${search.toString()}`);
}

export async function searchCreditUsageSubjects(search?: string) {
  const params = new URLSearchParams();
  if (search?.trim()) params.set("search", search.trim());
  const query = params.toString();
  return request<{ items: CreditUsageSubject[] }>(
    `/api/admin/credit-usage-subjects${query ? `?${query}` : ""}`,
  );
}

export async function getAdminCreditUsageStats(input: {
  subjectType?: CreditUsageSubjectType;
  subjectId?: string | null;
}) {
  const params = new URLSearchParams({
    subjectType: input.subjectType || "platform",
  });
  if (input.subjectId) params.set("subjectId", input.subjectId);
  return request<CreditUsageStats>(`/api/admin/credit-usage-stats?${params.toString()}`);
}

export async function createWalletRechargeOrder(input: CreateWalletRechargeOrderInput) {
  return request<WalletRechargeOrder>("/api/wallet/recharge-orders", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getWalletRechargeCapabilities() {
  return request<WalletRechargeCapabilities>("/api/wallet/recharge-capabilities");
}

export async function getWalletRechargeOrder(orderId: string) {
  return request<WalletRechargeOrder>(`/api/wallet/recharge-orders/${orderId}`);
}

export async function refreshWalletRechargeOrderStatus(orderId: string) {
  return request<WalletRechargeOrder>(`/api/wallet/recharge-orders/${orderId}/refresh-status`, {
    method: "POST",
  });
}

export async function submitWalletRechargeTransferProof(
  orderId: string,
  input: {
    voucherFiles: string[];
    note?: string;
    transferReference?: string;
  },
) {
  return request<WalletRechargeOrder>(`/api/wallet/recharge-orders/${orderId}/bank-transfer-proof`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function confirmWalletRechargeOrder(orderId: string) {
  return request<WalletRechargeOrder>(`/api/wallet/recharge-orders/${orderId}/confirm`, {
    method: "POST",
  });
}

export async function getToolboxCapabilities() {
  return request<{ items: ToolboxCapability[]; stagingArea: string[] }>(
    "/api/toolbox/capabilities",
  );
}

export async function getCapabilities() {
  return request<{
    service: string;
    mode: string;
    implementedDomains: string[];
    toolbox: ToolboxCapability[];
  }>("/api/capabilities");
}

export async function getApiCenterConfig() {
  return request<ApiCenterConfig>("/api/api-center");
}

export async function updateApiCenterDefaults(input: Partial<ApiCenterConfig["defaults"]>) {
  return request<ApiCenterConfig["defaults"]>("/api/api-center/defaults", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function saveApiCenterVendorApiKey(vendorId: string, apiKey: string) {
  return request<ApiVendor>(`/api/api-center/vendors/${vendorId}/api-key`, {
    method: "PUT",
    body: JSON.stringify({ apiKey }),
  });
}

export async function testApiCenterVendorConnection(vendorId: string) {
  return request<ApiVendorConnectionTestResult>(`/api/api-center/vendors/${vendorId}/test`, {
    method: "POST",
  });
}

export async function updateApiVendorModel(
  vendorId: string,
  modelId: string,
  input: Partial<Pick<ApiVendorModel, "enabled">>,
) {
  return request<ApiVendorModel>(`/api/api-center/vendors/${vendorId}/models/${modelId}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** Bidirectional text translation via Qwen-Plus. targetLang: 'en' | 'zh' */
export async function translateText(text: string, targetLang: "en" | "zh") {
  return request<{ text: string; targetLang: string }>("/api/toolbox/translate-text", {
    method: "POST",
    body: JSON.stringify({ text, targetLang }),
  });
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
  return request<{ imageUrl: string; model: string; taskId?: string }>(
    "/api/toolbox/storyboard-grid25",
    {
      method: "POST",
      body: JSON.stringify({
        plotText,
        references: options?.references,
        model: options?.model,
      }),
    },
  );
}

/** Qwen3.5-Omni video-to-prompt reverse analysis. */
export async function reverseVideoPrompt(
  videoUrl: string,
  options?: { prompt?: string; model?: QwenOmniModel },
) {
  const body: Record<string, string> = { videoUrl };
  if (options?.prompt) body.prompt = options.prompt;
  if (options?.model) body.model = options.model;
  return request<{ prompt: string; model: string }>(
    "/api/toolbox/video-reverse-prompt",
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function uploadFile(file: File, kind = "file") {
  const actorId = getCurrentActorId();
  const token = getAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": file.type || "application/octet-stream",
    "X-Upload-Filename": encodeURIComponent(file.name),
    "X-Actor-Id": actorId,
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  const response = await fetch(
    `${API_BASE_URL}/api/uploads?kind=${encodeURIComponent(kind)}`,
    {
      method: "POST",
      headers,
      body: file,
    },
  );

  const payload = (await response.json()) as ApiEnvelope<UploadedFile>;
  if (!response.ok || !payload.success) {
    throw new ApiRequestError(payload.error?.message ?? "File upload failed", {
      code: payload.error?.code,
      status: response.status,
    });
  }

  return payload.data;
}

export async function listPricingRules() {
  return request<{ items: PricingRule[] }>("/api/admin/pricing-rules");
}

export async function listAdminOrders() {
  return request<{ items: AdminRechargeOrder[] }>("/api/admin/orders");
}

export async function reviewAdminOrder(
  orderId: string,
  input: { decision: "approve" | "reject"; note?: string },
) {
  return request<WalletRechargeOrder>(`/api/admin/orders/${orderId}/review`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listOrganizationMembers(organizationId: string) {
  return request<{ items: OrganizationMember[] }>(`/api/organizations/${organizationId}/members`);
}

export async function createOrganizationMember(
  organizationId: string,
  input: CreateOrganizationMemberInput,
) {
  return request<RegistrationResult>(`/api/organizations/${organizationId}/members`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getOrganizationWallet(organizationId: string) {
  return request<Wallet>(`/api/organizations/${organizationId}/wallet`);
}

export async function loginWithEmail(input: LoginInput) {
  return request<LoginResult>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function loginAdminWithEmail(input: LoginInput) {
  return request<LoginResult>("/api/auth/admin/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getAuthProviders() {
  return request<AuthProvidersResponse>("/api/auth/providers");
}

export async function exchangeGoogleLogin(code: string) {
  return request<LoginResult>("/api/auth/google/exchange", {
    method: "POST",
    body: JSON.stringify({ code }),
  });
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
  return request<{
    defaultModel: string;
    memory: PlaygroundMemoryPreference;
  }>("/api/playground/config");
}

export async function listPlaygroundModels() {
  return request<{ defaultModel: string; items: PlaygroundModel[] }>("/api/playground/models");
}

export async function listPlaygroundConversations(search?: string) {
  const params = new URLSearchParams();
  if (search?.trim()) params.set("search", search.trim());
  const query = params.toString() ? `?${params.toString()}` : "";
  return request<{ items: PlaygroundConversation[] }>(`/api/playground/conversations${query}`);
}

export async function createPlaygroundConversation(input: { title?: string; model?: string } = {}) {
  return request<PlaygroundConversation>("/api/playground/conversations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updatePlaygroundConversation(
  conversationId: string,
  input: Partial<Pick<PlaygroundConversation, "title" | "model">>,
) {
  return request<PlaygroundConversation>(
    `/api/playground/conversations/${encodeURIComponent(conversationId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(input),
    },
  );
}

export async function deletePlaygroundConversation(conversationId: string) {
  return request<{ deleted: boolean; conversationId: string }>(
    `/api/playground/conversations/${encodeURIComponent(conversationId)}`,
    { method: "DELETE" },
  );
}

export async function getPlaygroundConversation(conversationId: string) {
  return request<PlaygroundConversation>(
    `/api/playground/conversations/${encodeURIComponent(conversationId)}`,
  );
}

export async function listPlaygroundMessages(conversationId: string) {
  return request<{ items: PlaygroundMessage[] }>(
    `/api/playground/conversations/${encodeURIComponent(conversationId)}/messages`,
  );
}

export async function listPlaygroundChatJobs(options: {
  conversationId?: string;
  activeOnly?: boolean;
  status?: string;
  limit?: number;
} = {}) {
  const params = new URLSearchParams();
  if (options.conversationId) params.set("conversationId", options.conversationId);
  if (options.activeOnly) params.set("activeOnly", "true");
  if (options.status) params.set("status", options.status);
  if (options.limit) params.set("limit", String(options.limit));
  const query = params.toString() ? `?${params.toString()}` : "";
  return request<{ items: PlaygroundChatJob[] }>(`/api/playground/chat-jobs${query}`);
}

export async function getPlaygroundChatJob(jobId: string) {
  return request<{ job: PlaygroundChatJob }>(`/api/playground/chat-jobs/${encodeURIComponent(jobId)}`);
}

export async function startPlaygroundChatJob(input: PlaygroundChatInput) {
  return request<PlaygroundChatJobStartResult>("/api/playground/chat-jobs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listPlaygroundMemories() {
  return request<{ preference: PlaygroundMemoryPreference; items: PlaygroundMemory[] }>(
    "/api/playground/memories",
  );
}

export async function updatePlaygroundMemoryPreference(input: Partial<PlaygroundMemoryPreference>) {
  return request<PlaygroundMemoryPreference>("/api/playground/memories/preferences", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function updatePlaygroundMemory(
  key: string,
  input: Partial<Pick<PlaygroundMemory, "key" | "value" | "enabled">>,
) {
  return request<PlaygroundMemory>(`/api/playground/memories/${encodeURIComponent(key)}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export async function deletePlaygroundMemory(key: string) {
  return request<{ deleted: boolean; key: string }>(
    `/api/playground/memories/${encodeURIComponent(key)}`,
    { method: "DELETE" },
  );
}

function parsePlaygroundSseBlock(block: string): PlaygroundChatEvent | null {
  const lines = block.split(/\r?\n/);
  let type = "";
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      type = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    }
  }
  if (!type || !dataLines.length) return null;
  try {
    return { type, ...JSON.parse(dataLines.join("\n")) } as PlaygroundChatEvent;
  } catch {
    return null;
  }
}

export async function streamPlaygroundChat(
  input: PlaygroundChatInput,
  onEvent: (event: PlaygroundChatEvent) => void,
  signal?: AbortSignal,
) {
  const actorId = getCurrentActorId();
  const token = getAuthToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Actor-Id": actorId,
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`${API_BASE_URL}/api/playground/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
    signal,
  });

  if (!response.ok || !response.body) {
    let message = "Playground chat request failed";
    try {
      const payload = (await response.json()) as ApiEnvelope<unknown>;
      message = payload.error?.message || message;
    } catch {}
    throw new ApiRequestError(message, { status: response.status });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split(/\n\n/);
    buffer = parts.pop() || "";
    for (const part of parts) {
      const event = parsePlaygroundSseBlock(part);
      if (event) onEvent(event);
    }
  }
  if (buffer.trim()) {
    const event = parsePlaygroundSseBlock(buffer);
    if (event) onEvent(event);
  }
}

export async function registerPersonalUser(input: RegisterPersonalInput) {
  return request<RegistrationResult>("/api/auth/register/personal", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function registerEnterpriseAdmin(input: RegisterEnterpriseAdminInput) {
  return request<RegistrationResult>("/api/auth/register/enterprise-admin", {
    method: "POST",
    body: JSON.stringify(input),
  });
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

function canvasProjectSummaryTime(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function dedupeCanvasProjectSummaries(items: CanvasProjectSummary[]) {
  const byId = new Map<string, CanvasProjectSummary>();
  for (const item of items) {
    const normalizedId = typeof item?.id === "string" ? item.id.trim() : "";
    if (!normalizedId) continue;
    const candidate = item.id === normalizedId ? item : { ...item, id: normalizedId };
    const existing = byId.get(normalizedId);
    if (
      !existing ||
      canvasProjectSummaryTime(candidate.updatedAt) > canvasProjectSummaryTime(existing.updatedAt) ||
      (canvasProjectSummaryTime(candidate.updatedAt) === canvasProjectSummaryTime(existing.updatedAt) &&
        canvasProjectSummaryTime(candidate.createdAt) > canvasProjectSummaryTime(existing.createdAt))
    ) {
      byId.set(normalizedId, candidate);
    }
  }
  return Array.from(byId.values()).sort(
    (left, right) =>
      canvasProjectSummaryTime(right.updatedAt) - canvasProjectSummaryTime(left.updatedAt) ||
      canvasProjectSummaryTime(right.createdAt) - canvasProjectSummaryTime(left.createdAt),
  );
}

export async function listCanvasProjects() {
  const response = await request<{ items: CanvasProjectSummary[] }>("/api/canvas-projects");
  return {
    ...response,
    items: dedupeCanvasProjectSummaries(Array.isArray(response.items) ? response.items : []),
  };
}

export async function getCanvasProject(projectId: string) {
  return request<CanvasProject>(`/api/canvas-projects/${projectId}`);
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
  if (input.id) {
    return request<CanvasProject>(`/api/canvas-projects/${input.id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    });
  }
  return request<CanvasProject>("/api/canvas-projects", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteCanvasProject(projectId: string) {
  return request<{ deleted: boolean; projectId: string }>(`/api/canvas-projects/${projectId}`, {
    method: "DELETE",
  });
}

export async function runToolboxCapability(
  type: "character_replace" | "motion_transfer" | "upscale_restore",
  input: { projectId?: string; note?: string; target?: string; storyboardId?: string },
) {
  const endpointMap = {
    character_replace: "/api/toolbox/character-replace",
    motion_transfer: "/api/toolbox/motion-transfer",
    upscale_restore: "/api/toolbox/upscale-restore",
  };

  return request<TaskAccepted>(endpointMap[type], {
    method: "POST",
    body: JSON.stringify(input),
  });
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

export async function listVideoReplaceJobs(limit = 30) {
  return videoReplaceRequest<{ items: VideoReplaceJobStatus[] }>(
    `/jobs?limit=${encodeURIComponent(String(limit))}`,
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
  return `${VIDEO_REPLACE_BASE}/jobs/${encodeURIComponent(jobId)}/stream`;
}
