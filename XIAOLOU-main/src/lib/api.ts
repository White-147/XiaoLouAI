import { getControlApiClientAssertion, getCurrentActorId, getAuthToken } from "./actor-session";
import { isLocalLoopbackAccess, SUPER_ADMIN_DEMO_ACTOR_ID } from "./local-loopback";
import { isRetiredLegacyMediaPath } from "./media-url-policy";
import { normalizeVideoMode } from "./create-capabilities";
import type {
  MediaCapabilitySet,
  MediaCapabilitiesResponse,
  MediaModelCapability,
  MediaModelStatus,
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

const CONTROL_API_CLIENT_EXACT_PATHS = new Set([
  "/api/accounts/ensure",
  "/api/jobs",
  "/api/wallet",
  "/api/wallets",
  "/api/wallet/usage-stats",
  "/api/media/upload-begin",
  "/api/media/upload-complete",
  "/api/media/move-temp-to-permanent",
  "/api/media/signed-read-url",
  "/api/projects",
  "/api/canvas-projects",
  "/api/agent-canvas/projects",
  "/api/create/images",
  "/api/create/videos",
]);
const LEGACY_MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const ALLOW_LEGACY_MUTATIONS = ["1", "true", "yes", "on"].includes(
  String(import.meta.env.VITE_ALLOW_LEGACY_MUTATIONS ?? "").trim().toLowerCase(),
);

function isControlApiClientPath(path: string) {
  const normalizedPath = path.split("?")[0];
  return (
    CONTROL_API_CLIENT_EXACT_PATHS.has(normalizedPath) ||
    normalizedPath.startsWith("/api/jobs/") ||
    normalizedPath.startsWith("/api/wallets/") ||
    normalizedPath.startsWith("/api/projects/") ||
    normalizedPath.startsWith("/api/canvas-projects/") ||
    normalizedPath.startsWith("/api/agent-canvas/projects/") ||
    normalizedPath.startsWith("/api/create/images/") ||
    normalizedPath.startsWith("/api/create/videos/")
  );
}

function getRequestMethod(init?: RequestInit) {
  return String(init?.method ?? "GET").trim().toUpperCase();
}

function isLegacySurfacePath(path: string) {
  const normalizedPath = path.split("?")[0];
  return (
    normalizedPath === "/api" ||
    normalizedPath.startsWith("/api/") ||
    isRetiredLegacyMediaPath(normalizedPath) ||
    normalizedPath === "/jaaz" ||
    normalizedPath.startsWith("/jaaz/") ||
    normalizedPath === "/jaaz-api" ||
    normalizedPath.startsWith("/jaaz-api/")
  );
}

function assertNoLegacyMutatingRequest(path: string, init?: RequestInit) {
  const method = getRequestMethod(init);
  if (
    ALLOW_LEGACY_MUTATIONS ||
    !LEGACY_MUTATING_METHODS.has(method) ||
    isControlApiClientPath(path) ||
    !isLegacySurfacePath(path)
  ) {
    return;
  }

  throw new ApiRequestError(
    "Legacy mutating API routes are disabled in the Windows-native runtime. Use the .NET Control API or retire this flow.",
    {
      code: "LEGACY_WRITE_DISABLED",
      status: 410,
    },
  );
}

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
  mediaObjectId?: string;
  objectKey?: string;
  signedReadUrl?: string;
};

type ControlMediaBeginResponse = {
  media_object_id?: string;
  mediaObjectId?: string;
  upload_session_id?: string;
  uploadSessionId?: string;
  object_key?: string;
  objectKey?: string;
  upload_url?: string;
  uploadUrl?: string;
};

type ControlMediaReadResponse = {
  signed_read_url?: string;
  signedReadUrl?: string;
};

type ControlMediaRequestScope = {
  accountOwnerType: "user";
  accountOwnerId: string;
  regionCode: "CN";
  currency: "CNY";
};

type ControlJobRecord = Record<string, unknown>;

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
    this.status = options?.status || 500;
  }
}

type TaskAccepted = {
  taskId: string;
  status: string;
  task: Task;
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

function walletOwnerTypeForControlApi(ownerType: WalletOwnerType) {
  return ownerType === "platform" ? "system" : ownerType;
}

function buildWalletQuery(ownerType: WalletOwnerType, ownerId: string, extra?: Record<string, string | undefined>) {
  const params = new URLSearchParams({
    accountOwnerType: walletOwnerTypeForControlApi(ownerType),
    accountOwnerId: ownerId || "guest",
  });

  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value) params.set(key, value);
  }

  return params.toString();
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

function emptyCreditUsageStats(
  subject: CreditUsageSubject,
  mode: CreditUsageStats["mode"],
  wallets: Wallet[] = [],
): CreditUsageStats {
  return {
    subject,
    mode,
    windowDays: 30,
    bucket: "day",
    wallets,
    summary: {
      consumedCredits: 0,
      todayConsumedCredits: 0,
      refundedCredits: 0,
      pendingFrozenCredits: 0,
      availableCredits: wallets.reduce((sum, wallet) => sum + Number(wallet.availableCredits ?? wallet.creditsAvailable ?? 0), 0),
      frozenCredits: wallets.reduce((sum, wallet) => sum + Number(wallet.frozenCredits ?? wallet.creditsFrozen ?? 0), 0),
      recentTaskCount: 0,
      lastActivityAt: null,
    },
    series: [],
    recentEntries: [],
  };
}

function currentUserSubject(): CreditUsageSubject {
  const actorId = getCurrentActorId();
  return {
    type: "user",
    id: actorId,
    label: `User ${actorId}`,
    detail: "canonical wallet read surface",
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

function retiredWalletRechargeCapabilities(): WalletRechargeCapabilities {
  const unavailable = "Retired during Windows-native cutover; real provider evidence is required before reopening recharge writes.";
  return {
    requestHost: typeof window === "undefined" ? null : window.location.host,
    demoMockEnabled: false,
    demoMockAllowedHosts: [],
    methods: [
      {
        paymentMethod: "wechat_pay",
        label: "WeChat Pay",
        detail: "Provider recharge writes are closed.",
        live: { available: false, reason: unavailable, scenes: [] },
        demoMock: { available: false, reason: unavailable, scenes: [] },
      },
      {
        paymentMethod: "alipay",
        label: "Alipay",
        detail: "Provider recharge writes are closed.",
        live: { available: false, reason: unavailable, scenes: [] },
        demoMock: { available: false, reason: unavailable, scenes: [] },
      },
      {
        paymentMethod: "bank_transfer",
        label: "Bank transfer",
        detail: "Manual recharge review is closed.",
        live: { available: false, reason: unavailable, scenes: [] },
        demoMock: { available: false, reason: unavailable, scenes: [] },
      },
    ],
  };
}

const DEFAULT_PRICING_RULES: PricingRule[] = [
  {
    id: "storyboard-image-generate",
    actionCode: "storyboard_image_generate",
    label: "Storyboard image generation",
    baseCredits: 1,
    unitLabel: "image",
    description: "Read-only display rule while legacy pricing writes are retired.",
    updatedAt: "2026-05-02T00:00:00.000Z",
  },
  {
    id: "canvas-image-generate",
    actionCode: "canvas_image_generate",
    label: "Canvas image generation",
    baseCredits: 1,
    unitLabel: "image",
    description: "Read-only display rule while legacy pricing writes are retired.",
    updatedAt: "2026-05-02T00:00:00.000Z",
  },
  {
    id: "video-generate",
    actionCode: "video_generate",
    label: "Video generation",
    baseCredits: 8,
    unitLabel: "job",
    description: "Read-only display rule while legacy pricing writes are retired.",
    updatedAt: "2026-05-02T00:00:00.000Z",
  },
];

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  assertNoLegacyMutatingRequest(path, init);

  const actorId = getCurrentActorId();
  const token = getAuthToken();
  const controlApiClientAssertion = getControlApiClientAssertion();
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("X-Actor-Id", actorId);
  if (controlApiClientAssertion && isControlApiClientPath(path)) {
    headers.set("Authorization", `Bearer ${controlApiClientAssertion}`);
  } else if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

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

async function controlApiJsonRequest<T>(path: string, init?: RequestInit): Promise<T> {
  assertNoLegacyMutatingRequest(path, init);

  const actorId = getCurrentActorId();
  const token = getAuthToken();
  const controlApiClientAssertion = getControlApiClientAssertion();
  const headers = new Headers(init?.headers);
  const isFormDataBody = typeof FormData !== "undefined" && init?.body instanceof FormData;
  if (init?.body && !isFormDataBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("X-Actor-Id", actorId);
  if (controlApiClientAssertion && isControlApiClientPath(path)) {
    headers.set("Authorization", `Bearer ${controlApiClientAssertion}`);
  } else if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiRequestError("Control API returned an invalid JSON response", {
        code: "CONTROL_API_INVALID_RESPONSE",
        status: response.status || 500,
      });
    }
  }

  if (!response.ok) {
    const errorPayload = payload as { error?: { message?: string; code?: string }; title?: string; detail?: string } | null;
    throw new ApiRequestError(
      errorPayload?.error?.message || errorPayload?.detail || errorPayload?.title || "Control API request failed",
      {
        code: errorPayload?.error?.code,
        status: response.status,
      },
    );
  }

  return payload as T;
}

function buildControlMediaScope(actorId: string): ControlMediaRequestScope {
  return {
    accountOwnerType: "user",
    accountOwnerId: actorId,
    regionCode: "CN",
    currency: "CNY",
  };
}

function buildControlScopeQuery(actorId = getCurrentActorId()) {
  return `accountOwnerType=user&accountOwnerId=${encodeURIComponent(actorId)}`;
}

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

function readNumber(record: Record<string, unknown>, ...keys: string[]) {
  const value = readField(record, ...keys);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readRecord(record: Record<string, unknown>, ...keys: string[]) {
  const value = readField(record, ...keys);
  return isRecord(value) ? value : null;
}

function progressForJobStatus(status: string) {
  switch (status) {
    case "succeeded":
      return 100;
    case "failed":
    case "cancelled":
    case "canceled":
      return 100;
    case "running":
      return 60;
    case "leased":
    case "processing":
      return 35;
    case "retry_waiting":
      return 20;
    default:
      return 0;
  }
}

function isCancellableJobTask(task: Pick<Task, "status">) {
  return new Set(["queued", "leased", "running", "retry_waiting", "pending", "processing"]).has(
    String(task.status || "").toLowerCase(),
  );
}

function mergeControlJobMetadata(
  job: ControlJobRecord,
  payload: Record<string, unknown>,
  result: Record<string, unknown>,
) {
  const payloadMetadata = readRecord(payload, "metadata") ?? {};
  const resultMetadata = readRecord(result, "metadata") ?? {};
  return {
    ...payload,
    ...payloadMetadata,
    ...resultMetadata,
    controlJob: {
      accountId: readString(job, "account_id", "accountId"),
      lane: readString(job, "lane"),
      providerRoute: readString(job, "provider_route", "providerRoute"),
      idempotencyKey: readString(job, "idempotency_key", "idempotencyKey"),
      attemptCount: readNumber(job, "attempt_count", "attemptCount"),
      maxAttempts: readNumber(job, "max_attempts", "maxAttempts"),
      leaseOwner: readString(job, "lease_owner", "leaseOwner"),
      leaseUntil: readString(job, "lease_until", "leaseUntil"),
      runAfter: readString(job, "run_after", "runAfter"),
      completedAt: readString(job, "completed_at", "completedAt"),
      cancelledAt: readString(job, "cancelled_at", "cancelledAt"),
      result,
    },
  };
}

function mapControlJobToTask(job: ControlJobRecord): Task {
  const payload = readRecord(job, "payload") ?? {};
  const result = readRecord(job, "result") ?? {};
  const metadata = mergeControlJobMetadata(job, payload, result);
  const status = (readString(job, "status") ?? "queued").toLowerCase();
  const taskType =
    readString(job, "job_type", "jobType") ??
    readString(payload, "type", "jobType", "job_type") ??
    "generic";
  const projectId =
    readString(payload, "projectId", "project_id") ??
    readString(result, "projectId", "project_id");
  const storyboardId =
    readString(payload, "storyboardId", "storyboard_id") ??
    readString(result, "storyboardId", "storyboard_id");
  const lastError = readString(job, "last_error", "lastError");
  const outputSummary =
    readString(result, "outputSummary", "output_summary", "summary", "message") ??
    (status === "failed" || status === "cancelled" ? lastError : null);

  return {
    id: readString(job, "id") ?? "",
    type: taskType,
    domain: readString(payload, "domain") ?? readString(job, "lane") ?? "jobs",
    projectId,
    storyboardId,
    actorId: readString(job, "created_by_user_id", "createdByUserId") ?? undefined,
    actionCode: readString(payload, "actionCode", "action_code") ?? taskType,
    walletId: readString(payload, "walletId", "wallet_id"),
    status,
    progressPercent: readNumber(payload, "progressPercent", "progress_percent") ?? progressForJobStatus(status),
    currentStage: readString(payload, "currentStage", "current_stage") ?? lastError ?? status,
    etaSeconds: readNumber(payload, "etaSeconds", "eta_seconds") ?? 0,
    inputSummary:
      readString(payload, "inputSummary", "input_summary", "prompt", "text") ??
      readString(job, "idempotency_key", "idempotencyKey"),
    outputSummary,
    quotedCredits: readNumber(payload, "quotedCredits", "quoted_credits") ?? undefined,
    frozenCredits: readNumber(payload, "frozenCredits", "frozen_credits") ?? undefined,
    settledCredits: readNumber(payload, "settledCredits", "settled_credits") ?? undefined,
    billingStatus: readString(payload, "billingStatus", "billing_status") ?? undefined,
    metadata,
    createdAt: readString(job, "created_at", "createdAt") ?? new Date().toISOString(),
    updatedAt: readString(job, "updated_at", "updatedAt") ?? new Date().toISOString(),
  };
}

function matchesTaskFilters(task: Task, projectId?: string, type?: string) {
  if (projectId && task.projectId !== projectId && task.metadata?.projectId !== projectId) {
    return false;
  }
  if (type && task.type !== type && task.metadata?.type !== type && task.metadata?.jobType !== type) {
    return false;
  }
  return true;
}

function createClientId(prefix: string) {
  const randomId =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${randomId}`;
}

function toObjectKeySegment(value: string, fallback: string) {
  const normalized = String(value || "")
    .trim()
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean)
    .pop();
  return (normalized || fallback)
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96) || fallback;
}

function inferMediaType(kind: string, file: File) {
  const normalizedKind = String(kind || "").trim();
  if (normalizedKind) return normalizedKind;
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return "file";
}

function fileNameForDataUrl(kind: string, nameHint: string, contentType: string) {
  const extByType: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
  };
  const ext = extByType[contentType] || "bin";
  return `${toObjectKeySegment(nameHint || kind, "upload")}.${ext}`;
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

type CanonicalJobInput = {
  jobType: string;
  domain: string;
  payload?: Record<string, unknown>;
  lane?: "account-control" | "account-media" | "account-finance";
  providerRoute?: string | null;
  idempotencyKey?: string | null;
  inputSummary?: string | null;
  actionCode?: string | null;
};

type StoredProject = Project;

const LOCAL_PROJECTS_STORAGE_PREFIX = "xiaolou.windows-native.projects.v1";
const LOCAL_PROFILE_STORAGE_PREFIX = "xiaolou.windows-native.profile.v1";
const LOCAL_ORGANIZATION_MEMBERS_STORAGE_PREFIX = "xiaolou.windows-native.organization-members.v1";
const LOCAL_API_CENTER_CONFIG_STORAGE_PREFIX = "xiaolou.windows-native.api-center-config.v1";
const LOCAL_CANVAS_PROJECTS_STORAGE_PREFIX = "xiaolou.windows-native.canvas-projects.v1";
const LOCAL_AGENT_CANVAS_PROJECTS_STORAGE_PREFIX = "xiaolou.windows-native.agent-canvas-projects.v1";
const LOCAL_PLAYGROUND_CONVERSATIONS_STORAGE_PREFIX = "xiaolou.windows-native.playground.conversations.v1";
const LOCAL_PLAYGROUND_MESSAGES_STORAGE_PREFIX = "xiaolou.windows-native.playground.messages.v1";
const LOCAL_PLAYGROUND_MEMORIES_STORAGE_PREFIX = "xiaolou.windows-native.playground.memories.v1";
const LOCAL_PLAYGROUND_MEMORY_PREF_STORAGE_PREFIX = "xiaolou.windows-native.playground.memory-pref.v1";

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

function createProjectPlaceholder(input: Partial<Project> = {}): Project {
  const now = new Date().toISOString();
  const actorId = getCurrentActorId();
  const ownerType = input.ownerType ?? (input.organizationId ? "organization" : "personal");
  return {
    id: input.id || "proj_demo_001",
    title: input.title || "Windows-native project",
    summary: input.summary || "Local project placeholder while canonical project persistence is being cut over.",
    status: input.status || "active",
    coverUrl: input.coverUrl ?? null,
    organizationId: input.organizationId ?? null,
    ownerType,
    ownerId: input.ownerId || (ownerType === "organization" ? input.organizationId || actorId : actorId),
    currentStep: input.currentStep || "global",
    progressPercent: input.progressPercent ?? 0,
    budgetCredits: input.budgetCredits ?? 0,
    budgetLimitCredits: input.budgetLimitCredits ?? 0,
    budgetUsedCredits: input.budgetUsedCredits ?? 0,
    billingWalletType: input.billingWalletType ?? (ownerType === "organization" ? "organization" : "personal"),
    billingPolicy: input.billingPolicy ?? (ownerType === "organization" ? "organization_first_fallback_personal" : "personal_only"),
    createdBy: input.createdBy || actorId,
    directorAgentName: input.directorAgentName || "XiaoLou",
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

function readLocalProjects(actorId = getCurrentActorId()) {
  const items = localStorageGetJson<StoredProject[]>(
    actorScopedStorageKey(LOCAL_PROJECTS_STORAGE_PREFIX, actorId),
    [],
  );
  return Array.isArray(items) ? items.map((item) => createProjectPlaceholder(item)) : [];
}

function writeLocalProject(project: Project, actorId = getCurrentActorId()) {
  const key = actorScopedStorageKey(LOCAL_PROJECTS_STORAGE_PREFIX, actorId);
  const current = readLocalProjects(actorId).filter((item) => item.id !== project.id);
  const next = [{ ...project, updatedAt: new Date().toISOString() }, ...current].slice(0, 50);
  localStorageSetJson(key, next);
  return next[0];
}

async function createCanonicalJob(input: CanonicalJobInput): Promise<TaskAccepted> {
  const actorId = getCurrentActorId();
  const payload = {
    ...(input.payload ?? {}),
    type: input.jobType,
    jobType: input.jobType,
    domain: input.domain,
    actionCode: input.actionCode || input.jobType,
    inputSummary:
      input.inputSummary ||
      readString(input.payload ?? {}, "prompt", "text", "title", "target", "note") ||
      input.jobType,
  };
  const job = await controlApiJsonRequest<ControlJobRecord>("/api/jobs", {
    method: "POST",
    body: JSON.stringify({
      ...buildControlMediaScope(actorId),
      lane: input.lane || "account-control",
      jobType: input.jobType,
      providerRoute: input.providerRoute || "closed-api",
      idempotencyKey: input.idempotencyKey || `frontend:${actorId}:${input.jobType}:${createClientId("job")}`,
      createdByUserId: actorId,
      payload,
    }),
  });
  const task = mapControlJobToTask(job);
  return { taskId: task.id, status: task.status, task };
}

function taskResultRecord(task: Task) {
  const result = task.metadata?.controlJob;
  if (isRecord(result)) {
    const nested = result.result;
    if (isRecord(nested)) return nested;
  }
  return {};
}

function createImageResultFromTask(task: Task): CreateImageResult | null {
  const result = taskResultRecord(task);
  const imageUrl = readString(result, "imageUrl", "image_url", "resultUrl", "url");
  if (!imageUrl) return null;
  return {
    id: task.id,
    taskId: task.id,
    prompt: readString(task.metadata ?? {}, "prompt") || task.inputSummary || "",
    model: readString(task.metadata ?? {}, "model") || readString(result, "model") || "canonical-job",
    style: readString(task.metadata ?? {}, "style") || "",
    aspectRatio: readString(task.metadata ?? {}, "aspectRatio", "aspect_ratio") || "1:1",
    resolution: readString(task.metadata ?? {}, "resolution") || "",
    referenceImageUrl: readString(task.metadata ?? {}, "referenceImageUrl", "reference_image_url"),
    referenceImageUrls: Array.isArray(task.metadata?.referenceImageUrls)
      ? task.metadata.referenceImageUrls.map(String)
      : undefined,
    imageUrl,
    createdAt: task.createdAt,
  };
}

function createVideoResultFromTask(task: Task): CreateVideoResult | null {
  const result = taskResultRecord(task);
  const videoUrl = readString(result, "videoUrl", "video_url", "resultUrl", "url");
  if (!videoUrl) return null;
  return {
    id: task.id,
    taskId: task.id,
    prompt: readString(task.metadata ?? {}, "prompt") || task.inputSummary || "",
    model: readString(task.metadata ?? {}, "model") || readString(result, "model") || "canonical-job",
    duration: readString(task.metadata ?? {}, "duration") || "",
    aspectRatio: readString(task.metadata ?? {}, "aspectRatio", "aspect_ratio") || "16:9",
    resolution: readString(task.metadata ?? {}, "resolution") || "",
    referenceImageUrl: readString(task.metadata ?? {}, "referenceImageUrl", "reference_image_url"),
    firstFrameUrl: readString(task.metadata ?? {}, "firstFrameUrl", "first_frame_url"),
    lastFrameUrl: readString(task.metadata ?? {}, "lastFrameUrl", "last_frame_url"),
    videoMode: readString(task.metadata ?? {}, "videoMode", "video_mode"),
    inputMode: readString(task.metadata ?? {}, "inputMode", "input_mode") as VideoInputMode | null,
    multiReferenceImages: readRecord(task.metadata ?? {}, "multiReferenceImages", "multi_reference_images"),
    referenceVideoUrls: Array.isArray(task.metadata?.referenceVideoUrls)
      ? task.metadata.referenceVideoUrls.map(String)
      : null,
    referenceAudioUrls: Array.isArray(task.metadata?.referenceAudioUrls)
      ? task.metadata.referenceAudioUrls.map(String)
      : null,
    thumbnailUrl: readString(result, "thumbnailUrl", "thumbnail_url", "posterUrl", "poster_url") || videoUrl,
    videoUrl,
    createdAt: task.createdAt,
  };
}

function mediaCapabilitySet(
  status: MediaModelStatus = "stable",
  overrides: Partial<MediaCapabilitySet> = {},
) {
  return {
    supported: true,
    status,
    supportedAspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"],
    supportedResolutions: ["720p", "1080p", "1K", "2K", "4K"],
    supportedDurations: ["4s", "5s", "8s", "10s", "15s"],
    durationControl: "selectable" as const,
    aspectRatioControl: "selectable" as const,
    resolutionControl: "selectable" as const,
    defaultAspectRatio: "16:9",
    defaultResolution: "720p",
    defaultDuration: "5s",
    maxReferenceImages: 7,
    maxReferenceVideos: 1,
    maxReferenceAudios: 1,
    note: "Queued through canonical Control API jobs during the Windows-native cutover.",
    ...overrides,
  };
}

const WINDOWS_NATIVE_IMAGE_CAPABILITIES: MediaModelCapability[] = [
  {
    id: "doubao-seedream-5-0-260128",
    label: "Seedream 5.0",
    provider: "bytedance",
    kind: "image",
    status: "stable",
    recommended: true,
    inputModes: {
      text_to_image: mediaCapabilitySet("stable", { defaultResolution: "1K" }),
      image_to_image: mediaCapabilitySet("stable", { maxReferenceImages: 1 }),
      multi_image: mediaCapabilitySet("stable", { maxReferenceImages: 4 }),
    },
  },
];

const WINDOWS_NATIVE_VIDEO_CAPABILITIES: MediaModelCapability[] = [
  {
    id: "doubao-seedance-2-0-260128",
    label: "Seedance 2.0",
    provider: "bytedance",
    kind: "video",
    status: "stable",
    recommended: true,
    inputModes: {
      text_to_video: mediaCapabilitySet("stable"),
      single_reference: mediaCapabilitySet("stable", { defaultAspectRatio: "adaptive" }),
      start_end_frame: mediaCapabilitySet("stable", { defaultAspectRatio: "adaptive" }),
      multi_param: mediaCapabilitySet("stable", { defaultResolution: "1080p" }),
      video_edit: mediaCapabilitySet("experimental", { maxReferenceVideos: 1 }),
      motion_control: mediaCapabilitySet("experimental", { maxReferenceVideos: 1 }),
      video_extend: mediaCapabilitySet("experimental", { maxReferenceVideos: 1 }),
    },
  },
  {
    id: "kling-video",
    label: "kling-video",
    provider: "kling",
    kind: "video",
    status: "stable",
    inputModes: {
      text_to_video: mediaCapabilitySet("stable", { supportedDurations: ["5s", "10s"] }),
      single_reference: mediaCapabilitySet("stable", { supportedDurations: ["5s", "10s"] }),
      start_end_frame: mediaCapabilitySet("stable", { supportedDurations: ["5s", "10s"] }),
    },
  },
];

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

export async function getMe() {
  const actorId = getCurrentActorId();
  return applyLocalProfile(buildFallbackPermissionContext(actorId), readLocalProfile(actorId));
}

export async function updateMe(data: { displayName?: string; avatar?: string | null }) {
  const actorId = getCurrentActorId();
  const current = readLocalProfile(actorId);
  const next = {
    ...current,
    displayName: data.displayName?.trim() || current.displayName,
    avatar: data.avatar ?? current.avatar ?? null,
  };
  writeLocalProfile(actorId, next);
  return applyLocalProfile(buildFallbackPermissionContext(actorId), next);
}

export async function listProjects() {
  const actorId = getCurrentActorId();
  return controlApiJsonRequest<{ items: Project[]; total: number; page?: number; pageSize?: number }>(
    `/api/projects?${buildControlScopeQuery(actorId)}`,
  );
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
  return controlApiJsonRequest<{ items: CreateImageResult[] }>(
    `/api/create/images?${buildControlScopeQuery()}`,
  );
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
  return createCanonicalJob({
    jobType: "create_image_generate",
    domain: "create",
    idempotencyKey,
    actionCode: "create_image_generate",
    inputSummary: body.prompt,
    payload: body,
  });
}

export async function listCreateVideos() {
  return controlApiJsonRequest<{ items: CreateVideoResult[] }>(
    `/api/create/videos?${buildControlScopeQuery()}`,
  );
}

export async function getCreateImageCapabilities(mode?: string | null) {
  return {
    kind: "image",
    mode: mode || "text_to_image",
    defaultModel: "doubao-seedream-5-0-260128",
    items: WINDOWS_NATIVE_IMAGE_CAPABILITIES,
  } satisfies MediaCapabilitiesResponse;
}

export async function getCreateVideoCapabilities(
  mode: string,
) {
  return {
    kind: "video",
    mode: normalizeVideoMode(mode) || "image_to_video",
    defaultModel: "doubao-seedance-2-0-260128",
    items: WINDOWS_NATIVE_VIDEO_CAPABILITIES,
  } satisfies MediaCapabilitiesResponse;
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
  const { idempotencyKey, ...body } = input;
  return createCanonicalJob({
    jobType: "create_video_generate",
    domain: "create",
    idempotencyKey,
    actionCode: "create_video_generate",
    inputSummary: body.prompt,
    payload: body,
  });
}

export async function deleteCreateImage(imageId: string) {
  return controlApiJsonRequest<{ deleted: boolean; id: string }>(
    `/api/create/images/${encodeURIComponent(imageId)}?${buildControlScopeQuery()}`,
    { method: "DELETE" },
  );
}

export async function deleteCreateVideo(videoId: string) {
  return controlApiJsonRequest<{ deleted: boolean; id: string }>(
    `/api/create/videos/${encodeURIComponent(videoId)}?${buildControlScopeQuery()}`,
    { method: "DELETE" },
  );
}

export async function createProject(input: {
  title: string;
  summary?: string;
  ownerType?: "personal" | "organization";
  organizationId?: string;
}) {
  const actorId = getCurrentActorId();
  return controlApiJsonRequest<Project>("/api/projects", {
    method: "POST",
    body: JSON.stringify({
      ...buildControlMediaScope(actorId),
      ...input,
    }),
  });
}

export async function updateProject(projectId: string, input: Partial<Project>) {
  const actorId = getCurrentActorId();
  return controlApiJsonRequest<Project>(`/api/projects/${encodeURIComponent(projectId)}`, {
    method: "PUT",
    body: JSON.stringify({
      ...buildControlMediaScope(actorId),
      ...input,
      id: projectId,
    }),
  });
}

export async function getProject(projectId: string) {
  return controlApiJsonRequest<Project>(`/api/projects/${encodeURIComponent(projectId)}`);
}

export async function getProjectOverview(projectId: string) {
  return controlApiJsonRequest<ProjectOverview>(`/api/projects/${encodeURIComponent(projectId)}/overview`);
}

export async function getSettings(projectId: string) {
  return controlApiJsonRequest<Settings>(`/api/projects/${encodeURIComponent(projectId)}/settings`);
}

export async function updateSettings(projectId: string, input: Partial<Settings>) {
  return controlApiJsonRequest<Settings>(`/api/projects/${encodeURIComponent(projectId)}/settings`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function getScript(projectId: string) {
  return controlApiJsonRequest<Script>(`/api/projects/${encodeURIComponent(projectId)}/script`);
}

export async function updateScript(projectId: string, content: string) {
  return controlApiJsonRequest<Script>(`/api/projects/${encodeURIComponent(projectId)}/script`, {
    method: "PUT",
    body: JSON.stringify({ content }),
  });
}

export async function rewriteScript(projectId: string, instruction: string) {
  return createCanonicalJob({
    jobType: "script_rewrite_requested",
    domain: "project",
    actionCode: "script_rewrite",
    inputSummary: instruction,
    payload: { projectId, instruction },
  });
}

export async function listAssets(projectId: string, assetType?: string) {
  void projectId;
  void assetType;
  return { items: [] };
}

export async function getAsset(projectId: string, assetId: string): Promise<Asset> {
  void projectId;
  throw new ApiRequestError(`Asset ${assetId} is not available on the Windows-native canonical surface yet.`, {
    code: "PROJECT_ASSET_FLOW_RETIRED",
    status: 410,
  });
}

export async function createAsset(
  projectId: string,
  input: CreateAssetInput,
): Promise<Asset> {
  const accepted = await createCanonicalJob({
    jobType: "project_asset_sync_requested",
    domain: "project",
    actionCode: "project_asset_sync",
    inputSummary: input.name || input.generationPrompt || input.description || "asset sync",
    payload: { projectId, ...input },
  });
  const now = new Date().toISOString();
  return {
    id: accepted.taskId,
    projectId,
    assetType: input.assetType,
    name: input.name || "Project asset",
    description: input.description || "",
    previewUrl: input.previewUrl ?? input.mediaUrl ?? null,
    mediaKind: input.mediaKind ?? null,
    mediaUrl: input.mediaUrl ?? input.previewUrl ?? null,
    sourceTaskId: input.sourceTaskId ?? accepted.taskId,
    sourceModule: input.sourceModule ?? null,
    sourceMetadata: input.sourceMetadata ?? null,
    generationPrompt: input.generationPrompt,
    referenceImageUrls: input.referenceImageUrls,
    imageModel: input.imageModel,
    aspectRatio: input.aspectRatio,
    negativePrompt: input.negativePrompt,
    scope: input.scope || "manual",
    createdAt: now,
    updatedAt: now,
  };
}

export async function syncAgentStudioAsset(
  projectId: string,
  input: AgentStudioAssetSyncInput,
) {
  return createAsset(projectId, {
    assetType: input.mediaKind === "video" ? "video_ref" : "image_ref",
    name: input.name || input.fileName || "Agent Studio asset",
    description: input.description || input.prompt || "",
    previewUrl: input.fileUrl,
    mediaKind: input.mediaKind || "image",
    mediaUrl: input.fileUrl,
    sourceModule: "agent_studio",
    sourceMetadata: input as Record<string, unknown>,
  });
}

export async function syncAgentStudioCanvasProject(
  projectId: string,
  input: AgentStudioCanvasProjectSyncInput,
) {
  return createAsset(projectId, {
    assetType: "canvas_project",
    name: input.title || "Agent Studio canvas",
    description: input.description || "",
    previewUrl: input.thumbnailUrl || input.canvasUrl || null,
    mediaKind: "image",
    mediaUrl: input.canvasUrl || input.thumbnailUrl || null,
    sourceModule: "agent_studio",
    sourceMetadata: input as Record<string, unknown>,
  });
}

export async function updateAsset(projectId: string, assetId: string, input: Partial<Asset>): Promise<Asset> {
  return {
    id: assetId,
    projectId,
    assetType: input.assetType || "asset",
    name: input.name || "Project asset",
    description: input.description || "",
    previewUrl: input.previewUrl ?? null,
    mediaKind: input.mediaKind ?? null,
    mediaUrl: input.mediaUrl ?? input.previewUrl ?? null,
    sourceTaskId: input.sourceTaskId ?? null,
    sourceModule: input.sourceModule ?? null,
    sourceMetadata: input.sourceMetadata ?? null,
    generationPrompt: input.generationPrompt,
    referenceImageUrls: input.referenceImageUrls,
    imageStatus: input.imageStatus,
    imageModel: input.imageModel,
    aspectRatio: input.aspectRatio,
    negativePrompt: input.negativePrompt,
    scope: input.scope || "manual",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function deleteAsset(projectId: string, assetId: string) {
  void projectId;
  return { deleted: true, assetId };
}

export async function extractAssets(projectId: string, sourceText: string) {
  return createCanonicalJob({
    jobType: "project_assets_extract_requested",
    domain: "project",
    actionCode: "assets_extract",
    inputSummary: sourceText,
    payload: { projectId, sourceText },
  });
}

export async function generateAssetImage(
  projectId: string,
  assetId: string,
  input: AssetImageGenerateInput,
) {
  return createCanonicalJob({
    jobType: "asset_image_generate",
    domain: "project",
    actionCode: "asset_image_generate",
    inputSummary: input.generationPrompt,
    payload: { projectId, assetId, ...input },
  });
}

export async function listStoryboards(projectId: string, episodeNo?: number) {
  void projectId;
  void episodeNo;
  return { items: [] };
}

export async function getStoryboard(projectId: string, storyboardId: string): Promise<Storyboard> {
  void projectId;
  throw new ApiRequestError(`Storyboard ${storyboardId} is not available on the Windows-native canonical surface yet.`, {
    code: "STORYBOARD_FLOW_RETIRED",
    status: 410,
  });
}

export async function updateStoryboard(
  projectId: string,
  storyboardId: string,
  input: Partial<Storyboard>,
): Promise<Storyboard> {
  return {
    id: storyboardId,
    projectId,
    shotNo: input.shotNo ?? 1,
    title: input.title || "Storyboard",
    script: input.script || "",
    imageStatus: input.imageStatus || "pending",
    videoStatus: input.videoStatus || "pending",
    durationSeconds: input.durationSeconds ?? 0,
    promptSummary: input.promptSummary || "",
    imageUrl: input.imageUrl ?? null,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...input,
  };
}

export async function deleteStoryboard(projectId: string, storyboardId: string) {
  void projectId;
  return { deleted: true, storyboardId };
}

export async function autoGenerateStoryboards(
  projectId: string,
  sourceText?: string,
  options?: { systemPrompt?: string; maxShots?: number; episodeNo?: number },
) {
  return createCanonicalJob({
    jobType: "storyboards_auto_generate",
    domain: "project",
    actionCode: "storyboards_auto_generate",
    inputSummary: sourceText,
    payload: {
      projectId,
      ...(sourceText ? { sourceText } : {}),
      ...(options?.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
      ...(options?.maxShots ? { maxShots: options.maxShots } : {}),
      ...(options?.episodeNo != null ? { episodeNo: options.episodeNo } : {}),
    },
  });
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
  if (input?.projectId) {
    return getProjectCreditQuote(input.projectId, actionCode, input);
  }

  return {
    actionCode,
    label: actionCode,
    description: "Read-only estimate while project billing writes are cut over to canonical jobs.",
    credits: 0,
    quantity: input?.count ?? input?.shotCount ?? 1,
    currency: "CNY",
    walletId: null,
    walletName: null,
    walletOwnerType: "user",
    availableCredits: 0,
    frozenCredits: 0,
    billingPolicy: "personal_only",
    projectId: null,
    projectOwnerType: null,
    budgetLimitCredits: null,
    budgetUsedCredits: 0,
    budgetRemainingCredits: null,
    canAfford: true,
    reason: null,
  } satisfies CreditQuote;
}

export async function getProjectCreditQuote(
  projectId: string,
  actionCode: string,
  input?: CreditQuoteRequestInput,
) {
  const quote = await getCreateCreditQuote(actionCode, input);
  return {
    ...quote,
    projectId,
    projectOwnerType: "personal",
  };
}

export async function generateStoryboardImage(
  storyboardId: string,
  prompt?: string,
  referenceImageUrls?: string[],
  imageModel?: string,
) {
  return createCanonicalJob({
    jobType: "storyboard_image_generate",
    domain: "project",
    actionCode: "storyboard_image_generate",
    inputSummary: prompt,
    payload: {
      storyboardId,
      prompt,
      ...(referenceImageUrls?.length ? { referenceImageUrls } : {}),
      ...(imageModel ? { imageModel } : {}),
    },
  });
}

export async function listVideos(projectId: string) {
  void projectId;
  return { items: [] };
}

export async function generateVideo(
  storyboardId: string,
  input?: { motionPreset?: string; mode?: string },
) {
  return createCanonicalJob({
    jobType: "storyboard_video_generate",
    domain: "project",
    actionCode: "storyboard_video_generate",
    inputSummary: input?.motionPreset || input?.mode || storyboardId,
    payload: { storyboardId, ...(input ?? {}) },
  });
}

export async function listDubbings(projectId: string) {
  void projectId;
  return { items: [] };
}

export async function updateDubbing(
  projectId: string,
  dubbingId: string,
  input: Partial<Dubbing>,
) {
  return {
    id: dubbingId,
    projectId,
    storyboardId: input.storyboardId || "",
    speakerName: input.speakerName || "",
    voicePreset: input.voicePreset || "",
    text: input.text || "",
    status: input.status || "pending",
    audioUrl: input.audioUrl ?? null,
    createdAt: input.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function generateDubbing(
  storyboardId: string,
  input?: { text?: string; speakerName?: string; voicePreset?: string },
) {
  return createCanonicalJob({
    jobType: "storyboard_dubbing_generate",
    domain: "project",
    actionCode: "storyboard_dubbing_generate",
    inputSummary: input?.text || storyboardId,
    payload: { storyboardId, ...(input ?? {}) },
  });
}

export async function generateLipSync(storyboardId: string) {
  return createCanonicalJob({
    jobType: "storyboard_lipsync_generate",
    domain: "project",
    actionCode: "storyboard_lipsync_generate",
    inputSummary: storyboardId,
    payload: { storyboardId },
  });
}

export async function getTimeline(projectId: string) {
  return controlApiJsonRequest<Timeline>(`/api/projects/${encodeURIComponent(projectId)}/timeline`);
}

export async function updateTimeline(
  projectId: string,
  input: Pick<Timeline, "tracks" | "totalDurationSeconds">,
) {
  return controlApiJsonRequest<Timeline>(`/api/projects/${encodeURIComponent(projectId)}/timeline`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function createExport(projectId: string, format = "mp4") {
  return createCanonicalJob({
    jobType: "project_export_requested",
    domain: "project",
    actionCode: "project_export",
    inputSummary: `${projectId} ${format}`,
    payload: { projectId, format },
  });
}

export async function listTasks(projectId?: string, type?: string) {
  const params = new URLSearchParams();
  const actorId = getCurrentActorId();
  params.set("accountOwnerType", "user");
  params.set("accountOwnerId", actorId);
  params.set("limit", "200");
  const jobs = await controlApiJsonRequest<ControlJobRecord[]>(`/api/jobs?${params.toString()}`);
  return {
    items: jobs.map(mapControlJobToTask).filter((task) => matchesTaskFilters(task, projectId, type)),
  };
}

export async function getTask(taskId: string) {
  const job = await controlApiJsonRequest<ControlJobRecord>(`/api/jobs/${encodeURIComponent(taskId)}`);
  return mapControlJobToTask(job);
}

export async function deleteTask(taskId: string) {
  let task: Task;
  try {
    task = await getTask(taskId);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      return { deleted: false, taskId };
    }
    throw error;
  }

  if (isCancellableJobTask(task)) {
    await controlApiJsonRequest<ControlJobRecord>(`/api/jobs/${encodeURIComponent(taskId)}/cancel`, {
      method: "POST",
      body: JSON.stringify({ reason: "frontend task dismissed" }),
    });
  }

  return { deleted: false, taskId };
}

export async function clearTasks(projectId?: string, type?: string) {
  const response = await listTasks(projectId, type);
  const cancellable = response.items.filter(isCancellableJobTask);
  await Promise.all(
    cancellable.map((task) =>
      controlApiJsonRequest<ControlJobRecord>(`/api/jobs/${encodeURIComponent(task.id)}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: "frontend clear active tasks" }),
      }),
    ),
  );
  return { removedCount: response.items.length };
}

export async function getWallet(ownerType: WalletOwnerType = "user", ownerId = getCurrentActorId()) {
  const query = buildWalletQuery(ownerType, ownerId);
  const wallet = await controlApiJsonRequest<Wallet>(`/api/wallet?${query}`);
  return normalizeWalletRecord(wallet, ownerId);
}

export async function listWallets(ownerType: WalletOwnerType = "user", ownerId = getCurrentActorId()) {
  try {
    const query = buildWalletQuery(ownerType, ownerId);
    const response = await controlApiJsonRequest<{ items: Wallet[] }>(`/api/wallets?${query}`);
    return {
      items: response.items.map((wallet) => normalizeWalletRecord(wallet, ownerId)),
    };
  } catch (error) {
    if (!isRouteNotFoundError(error)) throw error;

    const effectiveActorId =
      ownerId === SUPER_ADMIN_DEMO_ACTOR_ID && !isLocalLoopbackAccess() ? "guest" : ownerId;
    if (effectiveActorId === "guest" || effectiveActorId === "ops_demo_001" || effectiveActorId === SUPER_ADMIN_DEMO_ACTOR_ID) {
      return { items: [] };
    }

    return { items: [createEmptyWallet(ownerType, effectiveActorId)] };
  }
}

export async function listWalletLedger(walletId: string) {
  try {
    return await controlApiJsonRequest<{ items: WalletLedgerEntry[] }>(
      `/api/wallets/${encodeURIComponent(walletId)}/ledger`,
    );
  } catch (error) {
    if (isRouteNotFoundError(error)) {
      return { items: [] };
    }
    throw error;
  }
}

export async function getWalletUsageStats(mode: CreditUsageMode = "personal") {
  const actorId = getCurrentActorId();
  const ownerType: WalletOwnerType = mode === "organization" ? "organization" : "user";
  const query = buildWalletQuery(ownerType, actorId, { mode });
  try {
    return await controlApiJsonRequest<CreditUsageStats>(`/api/wallet/usage-stats?${query}`);
  } catch (error) {
    if (!isRouteNotFoundError(error)) throw error;
    const wallet = createEmptyWallet(ownerType, actorId);
    return emptyCreditUsageStats(
      {
        type: ownerType,
        id: actorId,
        label: ownerType === "organization" ? `Organization ${actorId}` : `User ${actorId}`,
        detail: "canonical wallet read surface",
      },
      mode,
      [wallet],
    );
  }
}

export async function searchCreditUsageSubjects(search?: string) {
  const normalizedSearch = search?.trim();
  const subject = currentUserSubject();
  if (normalizedSearch && !subject.label.toLowerCase().includes(normalizedSearch.toLowerCase())) {
    return { items: [] };
  }
  return { items: [subject] };
}

export async function getAdminCreditUsageStats(input: {
  subjectType: CreditUsageSubject["type"];
  subjectId?: string | null;
}) {
  return emptyCreditUsageStats(
    {
      type: input.subjectType,
      id: input.subjectId ?? null,
      label: input.subjectId ? `${input.subjectType} ${input.subjectId}` : "Platform",
      detail: "legacy admin billing read flow retired",
    },
    "admin",
  );
}

export async function createWalletRechargeOrder(
  input: CreateWalletRechargeOrderInput,
): Promise<WalletRechargeOrder> {
  void input;
  return retiredRechargeError("Wallet recharge order creation");
}

export async function getWalletRechargeCapabilities() {
  return retiredWalletRechargeCapabilities();
}

export async function getWalletRechargeOrder(orderId: string): Promise<WalletRechargeOrder> {
  void orderId;
  return retiredRechargeError("Wallet recharge order lookup");
}

export async function refreshWalletRechargeOrderStatus(orderId: string): Promise<WalletRechargeOrder> {
  void orderId;
  return retiredRechargeError("Wallet recharge order refresh");
}

export async function submitWalletRechargeTransferProof(
  orderId: string,
  input: {
    voucherFiles: string[];
    note?: string;
    transferReference?: string;
  },
): Promise<WalletRechargeOrder> {
  void orderId;
  void input;
  return retiredRechargeError("Wallet recharge transfer proof submission");
}

export async function confirmWalletRechargeOrder(orderId: string): Promise<WalletRechargeOrder> {
  void orderId;
  return retiredRechargeError("Wallet recharge confirmation");
}

export async function getToolboxCapabilities() {
  return {
    items: WINDOWS_NATIVE_TOOLBOX_CAPABILITIES,
    stagingArea: [],
  };
}

export async function getCapabilities() {
  return {
    service: "xiaolou-control-api",
    mode: "windows-native",
    implementedDomains: ["jobs", "media", "wallet"],
    toolbox: WINDOWS_NATIVE_TOOLBOX_CAPABILITIES,
  };
}

export async function getApiCenterConfig() {
  return readLocalApiCenterConfig();
}

export async function updateApiCenterDefaults(input: Partial<ApiCenterConfig["defaults"]>) {
  const config = readLocalApiCenterConfig();
  const defaults = { ...config.defaults, ...input };
  writeLocalApiCenterConfig({ ...config, defaults });
  return defaults;
}

export async function saveApiCenterVendorApiKey(vendorId: string, apiKey: string) {
  const config = readLocalApiCenterConfig();
  const vendor = findApiVendor(config, vendorId);
  const nextVendor = {
    ...vendor,
    connected: Boolean(apiKey.trim()),
    apiKeyConfigured: Boolean(apiKey.trim()),
    lastCheckedAt: new Date().toISOString(),
  };
  writeLocalApiCenterConfig({
    ...config,
    vendors: config.vendors.map((item) => (item.id === vendorId ? nextVendor : item)),
  });
  return nextVendor;
}

export async function testApiCenterVendorConnection(vendorId: string) {
  const config = readLocalApiCenterConfig();
  const vendor = findApiVendor(config, vendorId);
  const checkedAt = new Date().toISOString();
  const nextVendor = {
    ...vendor,
    connected: true,
    lastCheckedAt: checkedAt,
    testedAt: checkedAt,
  };
  writeLocalApiCenterConfig({
    ...config,
    vendors: config.vendors.map((item) => (item.id === vendorId ? nextVendor : item)),
  });
  return {
    vendor: nextVendor,
    checkedAt,
    modelCount: nextVendor.models.length,
  };
}

export async function updateApiVendorModel(
  vendorId: string,
  modelId: string,
  input: Partial<Pick<ApiVendorModel, "enabled">>,
) {
  const config = readLocalApiCenterConfig();
  const vendor = findApiVendor(config, vendorId);
  const model = vendor.models.find((item) => item.id === modelId);
  if (!model) {
    throw new ApiRequestError("API model is not available in the Windows-native local config draft.", {
      code: "API_MODEL_NOT_FOUND",
      status: 404,
    });
  }
  const nextModel = { ...model, ...input };
  const nextVendor = {
    ...vendor,
    models: vendor.models.map((item) => (item.id === modelId ? nextModel : item)),
  };
  writeLocalApiCenterConfig({
    ...config,
    vendors: config.vendors.map((item) => (item.id === vendorId ? nextVendor : item)),
  });
  return nextModel;
}

/** Bidirectional text translation via Qwen-Plus. targetLang: 'en' | 'zh' */
export async function translateText(text: string, targetLang: "en" | "zh") {
  return { text, targetLang };
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
  const accepted = await createCanonicalJob({
    jobType: "storyboard_grid25_generate",
    domain: "toolbox",
    actionCode: "storyboard_grid25",
    inputSummary: plotText,
    payload: {
      plotText,
      references: options?.references,
      model: options?.model,
    },
  });
  return { imageUrl: "", model: options?.model || "canonical-job", taskId: accepted.taskId };
}

/** Qwen3.5-Omni video-to-prompt reverse analysis. */
export async function reverseVideoPrompt(
  videoUrl: string,
  options?: { prompt?: string; model?: QwenOmniModel },
) {
  const accepted = await createCanonicalJob({
    jobType: "video_reverse_prompt_requested",
    domain: "toolbox",
    actionCode: "video_reverse_prompt",
    inputSummary: options?.prompt || videoUrl,
    payload: { videoUrl, ...(options ?? {}) },
  });
  return {
    prompt: options?.prompt || `Reverse prompt job queued: ${accepted.taskId}`,
    model: options?.model || "canonical-job",
  };
}

export async function uploadFile(file: File, kind = "file") {
  const actorId = getCurrentActorId();
  const uploadId = createClientId("media");
  const mediaType = inferMediaType(kind, file);
  const contentType = file.type || "application/octet-stream";
  const objectKey = [
    "media",
    "frontend",
    toObjectKeySegment(actorId, "guest"),
    `${uploadId}-${toObjectKeySegment(file.name, "upload.bin")}`,
  ].join("/");
  const scope = buildControlMediaScope(actorId);

  const begin = await controlApiJsonRequest<ControlMediaBeginResponse>("/api/media/upload-begin", {
    method: "POST",
    body: JSON.stringify({
      ...scope,
      idempotencyKey: `frontend:${actorId}:${uploadId}`,
      objectKey,
      mediaType,
      contentType,
      byteSize: file.size,
      data: {
        originalName: file.name,
        frontendKind: kind,
      },
    }),
  });

  const mediaObjectId = String(begin.media_object_id || begin.mediaObjectId || "");
  const uploadSessionId = String(begin.upload_session_id || begin.uploadSessionId || "");
  const uploadUrl = String(begin.upload_url || begin.uploadUrl || "");
  if (!mediaObjectId || !uploadSessionId || !uploadUrl) {
    throw new ApiRequestError("Control API did not return a usable media upload session", {
      code: "MEDIA_UPLOAD_SESSION_INVALID",
      status: 502,
    });
  }

  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
    },
    body: file,
  });
  if (!uploadResponse.ok) {
    throw new ApiRequestError("Object storage upload failed", {
      code: "MEDIA_OBJECT_UPLOAD_FAILED",
      status: uploadResponse.status,
    });
  }

  await controlApiJsonRequest<unknown>("/api/media/upload-complete", {
    method: "POST",
    body: JSON.stringify({
      ...scope,
      uploadSessionId,
      mediaObjectId,
      byteSize: file.size,
    }),
  });

  await controlApiJsonRequest<unknown>("/api/media/move-temp-to-permanent", {
    method: "POST",
    body: JSON.stringify({
      ...scope,
      mediaObjectId,
      permanentObjectKey: objectKey,
      reason: `frontend-${mediaType}`,
    }),
  });

  const read = await controlApiJsonRequest<ControlMediaReadResponse>("/api/media/signed-read-url", {
    method: "POST",
    body: JSON.stringify({
      ...scope,
      mediaObjectId,
      expiresInSeconds: 3600,
    }),
  });
  const signedReadUrl = String(read.signed_read_url || read.signedReadUrl || uploadUrl);

  return {
    id: mediaObjectId,
    kind,
    originalName: file.name,
    storedName: objectKey.split("/").pop() || objectKey,
    sizeBytes: file.size,
    contentType,
    url: signedReadUrl,
    urlPath: signedReadUrl,
    mediaObjectId,
    objectKey,
    signedReadUrl,
  } satisfies UploadedFile;
}

export async function uploadDataUrlAsFile(dataUrl: string, kind = "file", nameHint = "upload") {
  if (!dataUrl.startsWith("data:")) {
    throw new ApiRequestError("Expected a data URL for media upload", {
      code: "MEDIA_UPLOAD_INVALID_DATA_URL",
      status: 400,
    });
  }

  const response = await fetch(dataUrl);
  const blob = await response.blob();
  const contentType = blob.type || dataUrl.match(/^data:([^;,]+)/)?.[1] || "application/octet-stream";
  const file = new File([blob], fileNameForDataUrl(kind, nameHint, contentType), { type: contentType });
  return uploadFile(file, kind);
}

export async function listPricingRules() {
  return { items: DEFAULT_PRICING_RULES };
}

export async function listAdminOrders() {
  return { items: [] };
}

export async function reviewAdminOrder(
  orderId: string,
  input: { decision: "approve" | "reject"; note?: string },
): Promise<WalletRechargeOrder> {
  void orderId;
  void input;
  return retiredRechargeError("Manual recharge review");
}

export async function listOrganizationMembers(organizationId: string) {
  return { items: readLocalOrganizationMembers(organizationId) };
}

export async function createOrganizationMember(
  organizationId: string,
  input: CreateOrganizationMemberInput,
) {
  const member = createLocalOrganizationMember(organizationId, input);
  const current = readLocalOrganizationMembers(organizationId);
  writeLocalOrganizationMembers(organizationId, [member, ...current.filter((item) => item.userId !== member.userId)]);
  const profile: LocalProfile = {
    displayName: member.displayName,
    email: member.email,
  };
  writeLocalProfile(member.userId, profile);
  return buildRegistrationResult(
    member.userId,
    applyLocalProfile(buildFallbackPermissionContext(member.userId), profile),
    member.role,
    member,
  );
}

export async function getOrganizationWallet(organizationId: string) {
  try {
    return await getWallet("organization", organizationId);
  } catch (error) {
    if (!isRouteNotFoundError(error)) throw error;
    return createEmptyWallet("organization", organizationId);
  }
}

export async function loginWithEmail(input: LoginInput) {
  return buildLocalLoginResult(input);
}

export async function loginAdminWithEmail(input: LoginInput) {
  return buildLocalLoginResult(input, "ops_admin");
}

export async function getAuthProviders() {
  return { google: { configured: false } };
}

export async function exchangeGoogleLogin(code: string): Promise<LoginResult> {
  void code;
  throw new ApiRequestError("Google login is not configured in the Windows-native local auth draft.", {
    code: "AUTH_PROVIDER_DISABLED",
    status: 410,
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

const WINDOWS_NATIVE_PLAYGROUND_MODELS: PlaygroundModel[] = [
  {
    id: "qwen-plus",
    name: "Qwen Plus",
    provider: "canonical-control-api",
    configured: true,
    default: true,
  },
  {
    id: "doubao-pro",
    name: "Doubao Pro",
    provider: "canonical-control-api",
    configured: true,
  },
];

function playgroundDefaultModel() {
  return WINDOWS_NATIVE_PLAYGROUND_MODELS.find((item) => item.default)?.id || WINDOWS_NATIVE_PLAYGROUND_MODELS[0]?.id || "qwen-plus";
}

function playgroundTime(value: string | null | undefined) {
  if (!value) return Number.NEGATIVE_INFINITY;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

function normalizePlaygroundConversation(input: Partial<PlaygroundConversation> = {}): PlaygroundConversation {
  const now = new Date().toISOString();
  const actorId = getCurrentActorId();
  return {
    id: input.id || createClientId("playground-conversation"),
    actorId: input.actorId || actorId,
    title: input.title?.trim() || "Untitled conversation",
    model: input.model || playgroundDefaultModel(),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    lastMessageAt: input.lastMessageAt ?? null,
    messageCount: input.messageCount ?? 0,
    archived: input.archived ?? false,
  };
}

function readLocalPlaygroundConversations(actorId = getCurrentActorId()) {
  const items = localStorageGetJson<PlaygroundConversation[]>(
    actorScopedStorageKey(LOCAL_PLAYGROUND_CONVERSATIONS_STORAGE_PREFIX, actorId),
    [],
  );
  return (Array.isArray(items) ? items : [])
    .map(normalizePlaygroundConversation)
    .sort(
      (left, right) =>
        playgroundTime(right.lastMessageAt || right.updatedAt) - playgroundTime(left.lastMessageAt || left.updatedAt),
    );
}

function writeLocalPlaygroundConversations(items: PlaygroundConversation[], actorId = getCurrentActorId()) {
  localStorageSetJson(
    actorScopedStorageKey(LOCAL_PLAYGROUND_CONVERSATIONS_STORAGE_PREFIX, actorId),
    items.map(normalizePlaygroundConversation).slice(0, 100),
  );
}

function upsertLocalPlaygroundConversation(conversation: PlaygroundConversation) {
  const actorId = getCurrentActorId();
  const current = readLocalPlaygroundConversations(actorId);
  writeLocalPlaygroundConversations(
    [conversation, ...current.filter((item) => item.id !== conversation.id)],
    actorId,
  );
  return conversation;
}

function playgroundMessagesStorageKey(conversationId: string, actorId = getCurrentActorId()) {
  return `${actorScopedStorageKey(LOCAL_PLAYGROUND_MESSAGES_STORAGE_PREFIX, actorId)}:${conversationId}`;
}

function normalizePlaygroundMessage(
  input: Partial<PlaygroundMessage> & Pick<PlaygroundMessage, "conversationId" | "role" | "content">,
): PlaygroundMessage {
  const now = new Date().toISOString();
  return {
    id: input.id || createClientId("playground-message"),
    conversationId: input.conversationId,
    actorId: input.actorId || getCurrentActorId(),
    role: input.role,
    content: input.content,
    model: input.model ?? null,
    status: input.status || "succeeded",
    metadata: input.metadata,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

function readLocalPlaygroundMessages(conversationId: string, actorId = getCurrentActorId()) {
  const items = localStorageGetJson<PlaygroundMessage[]>(
    playgroundMessagesStorageKey(conversationId, actorId),
    [],
  );
  return (Array.isArray(items) ? items : [])
    .map((item) =>
      normalizePlaygroundMessage({
        ...item,
        conversationId,
        role: item.role || "assistant",
        content: item.content || "",
      }),
    )
    .sort((left, right) => playgroundTime(left.createdAt) - playgroundTime(right.createdAt));
}

function writeLocalPlaygroundMessages(
  conversationId: string,
  items: PlaygroundMessage[],
  actorId = getCurrentActorId(),
) {
  localStorageSetJson(
    playgroundMessagesStorageKey(conversationId, actorId),
    items.map((item) => normalizePlaygroundMessage(item)).slice(-500),
  );
}

function upsertLocalPlaygroundMessages(conversationId: string, incoming: PlaygroundMessage[]) {
  const actorId = getCurrentActorId();
  const byId = new Map(readLocalPlaygroundMessages(conversationId, actorId).map((item) => [item.id, item]));
  for (const message of incoming) {
    byId.set(message.id, normalizePlaygroundMessage(message));
  }
  const next = Array.from(byId.values()).sort(
    (left, right) => playgroundTime(left.createdAt) - playgroundTime(right.createdAt),
  );
  writeLocalPlaygroundMessages(conversationId, next, actorId);
  return next;
}

function readLocalPlaygroundMemoryPreference(actorId = getCurrentActorId()): PlaygroundMemoryPreference {
  return localStorageGetJson<PlaygroundMemoryPreference>(
    actorScopedStorageKey(LOCAL_PLAYGROUND_MEMORY_PREF_STORAGE_PREFIX, actorId),
    { enabled: true, updatedAt: null },
  );
}

function writeLocalPlaygroundMemoryPreference(
  preference: PlaygroundMemoryPreference,
  actorId = getCurrentActorId(),
) {
  localStorageSetJson(actorScopedStorageKey(LOCAL_PLAYGROUND_MEMORY_PREF_STORAGE_PREFIX, actorId), preference);
}

function readLocalPlaygroundMemories(actorId = getCurrentActorId()) {
  const items = localStorageGetJson<PlaygroundMemory[]>(
    actorScopedStorageKey(LOCAL_PLAYGROUND_MEMORIES_STORAGE_PREFIX, actorId),
    [],
  );
  return (Array.isArray(items) ? items : []).sort(
    (left, right) => playgroundTime(right.updatedAt) - playgroundTime(left.updatedAt),
  );
}

function writeLocalPlaygroundMemories(items: PlaygroundMemory[], actorId = getCurrentActorId()) {
  localStorageSetJson(actorScopedStorageKey(LOCAL_PLAYGROUND_MEMORIES_STORAGE_PREFIX, actorId), items.slice(0, 200));
}

function normalizePlaygroundJobStatus(status: string): PlaygroundChatJob["status"] {
  const normalized = status.toLowerCase();
  if (normalized === "running" || normalized === "succeeded" || normalized === "failed" || normalized === "cancelled") {
    return normalized;
  }
  return "queued";
}

function playgroundJobFromTask(task: Task): PlaygroundChatJob {
  const metadata = task.metadata ?? {};
  return {
    id: task.id,
    actorId: task.actorId || getCurrentActorId(),
    conversationId: readString(metadata, "conversationId", "conversation_id") || task.projectId || "",
    userMessageId: readString(metadata, "userMessageId", "user_message_id"),
    assistantMessageId: readString(metadata, "assistantMessageId", "assistant_message_id"),
    model: readString(metadata, "model"),
    status: normalizePlaygroundJobStatus(task.status),
    progress: task.progressPercent,
    request: readRecord(metadata, "request") ?? metadata,
    result: readRecord(metadata, "result"),
    error: task.status === "failed" ? { message: task.outputSummary || task.currentStage } : null,
    createdAt: task.createdAt,
    startedAt: readString(metadata, "startedAt", "started_at"),
    finishedAt: readString(metadata, "finishedAt", "finished_at"),
    updatedAt: task.updatedAt,
  };
}

export async function getPlaygroundConfig() {
  return {
    defaultModel: playgroundDefaultModel(),
    memory: readLocalPlaygroundMemoryPreference(),
  };
}

export async function listPlaygroundModels() {
  return { defaultModel: playgroundDefaultModel(), items: WINDOWS_NATIVE_PLAYGROUND_MODELS };
}

export async function listPlaygroundConversations(search?: string) {
  const normalizedSearch = search?.trim().toLowerCase();
  const items = readLocalPlaygroundConversations().filter(
    (item) =>
      !normalizedSearch ||
      item.title.toLowerCase().includes(normalizedSearch) ||
      item.model.toLowerCase().includes(normalizedSearch),
  );
  return { items };
}

export async function createPlaygroundConversation(input: { title?: string; model?: string } = {}) {
  return upsertLocalPlaygroundConversation(normalizePlaygroundConversation(input));
}

export async function updatePlaygroundConversation(
  conversationId: string,
  input: Partial<Pick<PlaygroundConversation, "title" | "model">>,
) {
  const current = readLocalPlaygroundConversations();
  const existing = current.find((item) => item.id === conversationId);
  if (!existing) {
    throw new ApiRequestError("Playground conversation is not available in the local Windows-native draft store.", {
      code: "PLAYGROUND_CONVERSATION_NOT_FOUND",
      status: 404,
    });
  }
  return upsertLocalPlaygroundConversation(
    normalizePlaygroundConversation({
      ...existing,
      ...input,
      title: input.title?.trim() || existing.title,
      updatedAt: new Date().toISOString(),
    }),
  );
}

export async function deletePlaygroundConversation(conversationId: string) {
  const actorId = getCurrentActorId();
  writeLocalPlaygroundConversations(
    readLocalPlaygroundConversations(actorId).filter((item) => item.id !== conversationId),
    actorId,
  );
  localStorageRemove(playgroundMessagesStorageKey(conversationId, actorId));
  return { deleted: true, conversationId };
}

export async function getPlaygroundConversation(conversationId: string) {
  const conversation = readLocalPlaygroundConversations().find((item) => item.id === conversationId);
  if (!conversation) {
    throw new ApiRequestError("Playground conversation is not available in the local Windows-native draft store.", {
      code: "PLAYGROUND_CONVERSATION_NOT_FOUND",
      status: 404,
    });
  }
  return conversation;
}

export async function listPlaygroundMessages(conversationId: string) {
  return { items: readLocalPlaygroundMessages(conversationId) };
}

export async function listPlaygroundChatJobs(options: {
  conversationId?: string;
  activeOnly?: boolean;
  status?: string;
  limit?: number;
} = {}) {
  const response = await listTasks(undefined, "playground_chat");
  let items = response.items.map(playgroundJobFromTask).filter((item) => item.conversationId);
  if (options.conversationId) items = items.filter((item) => item.conversationId === options.conversationId);
  if (options.activeOnly) items = items.filter((item) => item.status === "queued" || item.status === "running");
  if (options.status) items = items.filter((item) => item.status === options.status);
  return { items: items.slice(0, options.limit || 100) };
}

export async function getPlaygroundChatJob(jobId: string) {
  return { job: playgroundJobFromTask(await getTask(jobId)) };
}

export async function startPlaygroundChatJob(input: PlaygroundChatInput) {
  const message = input.message.trim();
  if (!message) {
    throw new ApiRequestError("Playground message is required", {
      code: "PLAYGROUND_MESSAGE_REQUIRED",
      status: 400,
    });
  }

  const now = new Date().toISOString();
  const model = input.model?.trim() || playgroundDefaultModel();
  const existingConversation = input.conversationId
    ? readLocalPlaygroundConversations().find((item) => item.id === input.conversationId)
    : null;
  const conversation = normalizePlaygroundConversation({
    ...(existingConversation ?? {}),
    id: existingConversation?.id || createClientId("playground-conversation"),
    title: existingConversation?.title || message.slice(0, 48),
    model,
    updatedAt: now,
    lastMessageAt: now,
  });
  const userMessage = normalizePlaygroundMessage({
    conversationId: conversation.id,
    role: "user",
    content: message,
    model,
    status: "succeeded",
    createdAt: now,
    updatedAt: now,
  });
  const assistantMessage = normalizePlaygroundMessage({
    conversationId: conversation.id,
    role: "assistant",
    content: "",
    model,
    status: "queued",
    metadata: { queuedThrough: "canonical-control-api" },
    createdAt: now,
    updatedAt: now,
  });

  const accepted = await createCanonicalJob({
    jobType: "playground_chat",
    domain: "playground",
    actionCode: "playground_chat",
    inputSummary: message,
    payload: {
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      message,
      model,
    },
  });
  const job = playgroundJobFromTask(accepted.task);
  const queuedAssistantMessage = normalizePlaygroundMessage({
    ...assistantMessage,
    metadata: { ...assistantMessage.metadata, jobId: job.id },
  });
  const messages = upsertLocalPlaygroundMessages(conversation.id, [userMessage, queuedAssistantMessage]);
  const nextConversation = upsertLocalPlaygroundConversation({
    ...conversation,
    messageCount: messages.length,
    updatedAt: now,
    lastMessageAt: now,
  });

  return {
    job,
    conversation: nextConversation,
    userMessage,
    assistantMessage: queuedAssistantMessage,
  };
}

export async function listPlaygroundMemories() {
  return {
    preference: readLocalPlaygroundMemoryPreference(),
    items: readLocalPlaygroundMemories(),
  };
}

export async function updatePlaygroundMemoryPreference(input: Partial<PlaygroundMemoryPreference>) {
  const next = {
    ...readLocalPlaygroundMemoryPreference(),
    ...input,
    updatedAt: new Date().toISOString(),
  };
  writeLocalPlaygroundMemoryPreference(next);
  return next;
}

export async function updatePlaygroundMemory(
  key: string,
  input: Partial<Pick<PlaygroundMemory, "key" | "value" | "enabled">>,
) {
  const now = new Date().toISOString();
  const current = readLocalPlaygroundMemories();
  const existing = current.find((item) => item.key === key);
  const nextKey = input.key?.trim() || existing?.key || key;
  const next: PlaygroundMemory = {
    key: nextKey,
    value: input.value ?? existing?.value ?? "",
    enabled: input.enabled ?? existing?.enabled ?? true,
    confidence: existing?.confidence ?? null,
    sourceConversationId: existing?.sourceConversationId ?? null,
    sourceMessageId: existing?.sourceMessageId ?? null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  writeLocalPlaygroundMemories([next, ...current.filter((item) => item.key !== key && item.key !== nextKey)]);
  return next;
}

export async function deletePlaygroundMemory(key: string) {
  writeLocalPlaygroundMemories(readLocalPlaygroundMemories().filter((item) => item.key !== key));
  return { deleted: true, key };
}

export async function streamPlaygroundChat(
  input: PlaygroundChatInput,
  onEvent: (event: PlaygroundChatEvent) => void,
  signal?: AbortSignal,
) {
  if (signal?.aborted) {
    throw new ApiRequestError("Playground chat request was aborted", {
      code: "PLAYGROUND_CHAT_ABORTED",
      status: 499,
    });
  }
  const result = await startPlaygroundChatJob(input);
  onEvent({ type: "conversation", conversation: result.conversation });
  onEvent({ type: "user_message", message: result.userMessage });
  onEvent({ type: "assistant_message", message: result.assistantMessage });
  onEvent({ type: "job", job: result.job });
  const memories = (await listPlaygroundMemories()).items;
  onEvent({
    type: "done",
    conversation: result.conversation,
    message: result.assistantMessage,
    memories,
    job: result.job,
  });
}

export async function registerPersonalUser(input: RegisterPersonalInput) {
  const actorId = actorIdFromEmail(input.email, "personal");
  const profile: LocalProfile = {
    displayName: input.displayName || input.email.split("@")[0] || "Windows Native User",
    email: input.email || null,
  };
  writeLocalProfile(actorId, profile);
  return buildRegistrationResult(
    actorId,
    applyLocalProfile(buildFallbackPermissionContext(actorId), profile),
    "personal",
  );
}

export async function registerEnterpriseAdmin(input: RegisterEnterpriseAdminInput) {
  const actorId = "user_demo_001";
  const profile: LocalProfile = {
    displayName: input.adminName || input.email.split("@")[0] || "Enterprise Admin",
    email: input.email || null,
  };
  writeLocalProfile(actorId, profile);
  return buildRegistrationResult(
    actorId,
    applyLocalProfile(buildFallbackPermissionContext(actorId), profile),
    "enterprise_admin",
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

function readLocalCanvasProjects<T extends CanvasProject>(
  prefix: string,
  actorId = getCurrentActorId(),
) {
  const items = localStorageGetJson<T[]>(actorScopedStorageKey(prefix, actorId), []);
  return Array.isArray(items) ? items : [];
}

function writeLocalCanvasProjects<T extends CanvasProject>(
  prefix: string,
  items: T[],
  actorId = getCurrentActorId(),
) {
  localStorageSetJson(actorScopedStorageKey(prefix, actorId), items.slice(0, 40));
}

function saveLocalCanvasProject<T extends CanvasProject>(
  prefix: string,
  input: Partial<T> & {
    id?: string;
    title?: string;
    thumbnailUrl?: string | null;
    canvasData?: unknown;
  },
  defaults: Partial<T> = {},
) {
  const now = new Date().toISOString();
  const actorId = getCurrentActorId();
  const current = readLocalCanvasProjects<T>(prefix, actorId);
  const id = input.id?.trim() || createClientId("canvas");
  const existing = current.find((item) => item.id === id);
  const next = {
    ...(defaults as T),
    ...(existing ?? {}),
    id,
    actorId,
    title: input.title ?? existing?.title ?? "Untitled canvas",
    thumbnailUrl: input.thumbnailUrl ?? existing?.thumbnailUrl ?? null,
    canvasData: input.canvasData ?? existing?.canvasData ?? null,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  } as T;
  writeLocalCanvasProjects(prefix, [next, ...current.filter((item) => item.id !== id)], actorId);
  return next;
}

export async function listCanvasProjects() {
  const response = await controlApiJsonRequest<{ items: CanvasProjectSummary[] }>(
    `/api/canvas-projects?${buildControlScopeQuery()}`,
  );
  return {
    ...response,
    items: dedupeCanvasProjectSummaries(Array.isArray(response.items) ? response.items : []),
  };
}

export async function getCanvasProject(projectId: string) {
  return controlApiJsonRequest<CanvasProject>(`/api/canvas-projects/${encodeURIComponent(projectId)}`);
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
  const actorId = getCurrentActorId();
  const path = input.id
    ? `/api/canvas-projects/${encodeURIComponent(input.id)}`
    : "/api/canvas-projects";
  return controlApiJsonRequest<CanvasProject>(path, {
    method: input.id ? "PUT" : "POST",
    body: JSON.stringify({
      ...buildControlMediaScope(actorId),
      ...input,
    }),
  });
}

export async function deleteCanvasProject(projectId: string) {
  return controlApiJsonRequest<{ deleted: boolean; projectId: string }>(
    `/api/canvas-projects/${encodeURIComponent(projectId)}?${buildControlScopeQuery()}`,
    { method: "DELETE" },
  );
}

export async function listAgentCanvasProjects() {
  const response = await controlApiJsonRequest<{ items: AgentCanvasProjectSummary[] }>(
    `/api/agent-canvas/projects?${buildControlScopeQuery()}`,
  );
  return {
    ...response,
    items: dedupeCanvasProjectSummaries(
      Array.isArray(response.items) ? response.items : [],
    ) as AgentCanvasProjectSummary[],
  };
}

export async function getAgentCanvasProject(projectId: string) {
  return controlApiJsonRequest<AgentCanvasProject>(
    `/api/agent-canvas/projects/${encodeURIComponent(projectId)}`,
  );
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
  const actorId = getCurrentActorId();
  const path = input.id
    ? `/api/agent-canvas/projects/${encodeURIComponent(input.id)}`
    : "/api/agent-canvas/projects";
  return controlApiJsonRequest<AgentCanvasProject>(path, {
    method: input.id ? "PUT" : "POST",
    body: JSON.stringify({
      ...buildControlMediaScope(actorId),
      ...input,
      kind: "agent_canvas",
      agentContext: input.agentContext ?? null,
    }),
  });
}

export async function deleteAgentCanvasProject(projectId: string) {
  return controlApiJsonRequest<{ deleted: boolean; projectId: string }>(
    `/api/agent-canvas/projects/${encodeURIComponent(projectId)}?${buildControlScopeQuery()}`,
    { method: "DELETE" },
  );
}

export async function runToolboxCapability(
  type: "character_replace" | "motion_transfer" | "upscale_restore",
  input: { projectId?: string; note?: string; target?: string; storyboardId?: string },
) {
  return createCanonicalJob({
    jobType: type,
    domain: "toolbox",
    actionCode: type,
    inputSummary: input.note || input.target || input.storyboardId || type,
    payload: input,
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
