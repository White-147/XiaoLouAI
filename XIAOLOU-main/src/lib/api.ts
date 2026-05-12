import { apiServiceRegistry } from "./api/service-registry";

// Shared public types and utilities.
export type {
  ImageInputMode,
  MediaCapabilitiesResponse,
  MediaCapabilitySet,
  MediaInputMode,
  MediaKind,
  MediaModelCapability,
  MediaModelProvider,
  MediaModelStatus,
  VideoGenerationMode,
  VideoInputMode,
} from "./create-capabilities";
export { normalizeVideoMode, VIDEO_MODE_ALIASES } from "./create-capabilities";
export { API_BASE_URL, ApiRequestError } from "./api/control-api-client";
export { newIdempotencyKey } from "./api/client-id";
export { mapStepToComicPath } from "./api/projects-canvas-create-paths";
export * from "./api/runtime-environment";
export * from "./api/video-replace";

// Domain public types.
export type {
  AdminOrderReviewInput,
  AdminRechargeOrder,
  PlatformAccount,
  PricingRule,
  UpdatePlatformAccountInput,
} from "./api/admin-enterprise-types";
export type {
  AdminResetPasswordInput,
  ApiCenterConfig,
  ApiVendor,
  ApiVendorConnectionTestResult,
  ApiVendorModel,
  AuthProvidersResponse,
  BootstrapPlatformPasswordInput,
  ChangePasswordInput,
  CompletePasswordResetInput,
  CreateOrganizationMemberInput,
  EnterpriseRole,
  LoginInput,
  LoginResult,
  MemberUsageSummary,
  NodeModelAssignment,
  OrganizationMember,
  OrganizationMemberPasswordResetInput,
  OrganizationSummary,
  PasswordConfiguredResult,
  PasswordResetRequestResult,
  PermissionContext,
  PlatformRole,
  ProviderHealthEvidence,
  RegisterEnterpriseAdminInput,
  RegisterPersonalInput,
  RegistrationResult,
  RequestPasswordResetInput,
  UpdateMeInput,
  UpdateOrganizationMemberAccountInput,
  User,
} from "./api/auth-account-types";
export type { Task } from "./api/jobs-types";
export type { UploadedFile } from "./api/media-types";
export type {
  PlaygroundChatEvent,
  PlaygroundChatInput,
  PlaygroundChatJob,
  PlaygroundChatJobStartResult,
  PlaygroundConversation,
  PlaygroundMemory,
  PlaygroundMemoryPreference,
  PlaygroundMessage,
  PlaygroundModel,
} from "./api/playground-types";
export type {
  AgentCanvasProject,
  AgentCanvasProjectSummary,
  AgentStudioAssetSyncInput,
  AgentStudioCanvasProjectSyncInput,
  Asset,
  AssetImageGenerateInput,
  AssetSourceModule,
  CanvasProject,
  CanvasProjectSummary,
  CreateAssetInput,
  CreateImageResult,
  CreateVideoResult,
  CreditQuote,
  CreditQuoteRequestInput,
  Dubbing,
  Project,
  ProjectBillingPolicy,
  ProjectOverview,
  ProjectStep,
  Script,
  Settings,
  Storyboard,
  Timeline,
  TimelineClip,
  TimelineTrack,
  VideoItem,
  VideoMultiReferenceImages,
  VideoMultiReferenceKey,
  VideoMultiReferenceValue,
} from "./api/projects-canvas-create-types";
export type {
  QwenOmniModel,
  StoryboardGrid25Reference,
  ToolboxCapability,
} from "../features/toolbox/api/toolbox-types";
export type {
  BankTransferAccount,
  CreateWalletRechargeOrderInput,
  CreditUsageMode,
  CreditUsageSeriesPoint,
  CreditUsageStats,
  CreditUsageSubject,
  Wallet,
  WalletLedgerEntry,
  WalletOwnerType,
  WalletRechargeCapabilities,
  WalletRechargeMethodCapability,
  WalletRechargeMode,
  WalletRechargeOrder,
  WalletRechargePaymentMethod,
  WalletRechargeScene,
  WalletRechargeTransferProofInput,
} from "./api/wallet-types";

const {
  adminEnterpriseFacade,
  authAccountFacade,
  authCurrentOrganizationBridge,
  jobsFacade,
  mediaFacade,
  playgroundFacade,
  projectsCanvasCreateFacade,
  toolboxFacade,
  walletPaymentFacade,
} = apiServiceRegistry;

// Wallet and billing.
export const {
  confirmWalletRechargeOrder,
  createWalletRechargeOrder,
  getAdminCreditUsageStats,
  getWallet,
  getWalletRechargeCapabilities,
  getWalletRechargeOrder,
  getWalletUsageStats,
  listWalletLedger,
  listWallets,
  refreshWalletRechargeOrderStatus,
  searchCreditUsageSubjects,
  submitWalletRechargeTransferProof,
} = walletPaymentFacade;

// Account, organization, and API Center.
export const {
  adminResetPassword,
  bootstrapPlatformPassword,
  changePassword,
  completePasswordReset,
  createOrganizationMember,
  deleteOrganizationMemberAccount,
  getApiCenterConfig,
  getAuthProviders,
  getOrganizationWallet,
  listOrganizationMembers,
  requestPasswordReset,
  resetOrganizationMemberPassword,
  saveApiCenterVendorApiKey,
  testApiCenterVendorConnection,
  updateApiCenterDefaults,
  updateApiVendorModel,
  updateOrganizationMemberAccount,
} = authAccountFacade;

export const {
  exchangeGoogleLogin,
  getMe,
  loginAdminWithEmail,
  loginWithEmail,
  registerEnterpriseAdmin,
  registerPersonalUser,
  startDemoSession,
  updateMe,
} = authCurrentOrganizationBridge;

// Projects, creation assets, and canvas.
export const {
  autoGenerateStoryboards,
  createAsset,
  createExport,
  createProject,
  deleteAgentCanvasProject,
  deleteAsset,
  deleteCanvasProject,
  deleteCreateImage,
  deleteCreateVideo,
  deleteStoryboard,
  extractAssets,
  generateAssetImage,
  generateCreateImages,
  generateCreateVideos,
  generateDubbing,
  generateLipSync,
  generateStoryboardImage,
  generateVideo,
  getAgentCanvasProject,
  getAsset,
  getCanvasProject,
  getCreateCreditQuote,
  getCreateImageCapabilities,
  getCreateVideoCapabilities,
  getProject,
  getProjectCreditQuote,
  getProjectOverview,
  getScript,
  getSettings,
  getStoryboard,
  getTimeline,
  listAgentCanvasProjects,
  listAssets,
  listCanvasProjects,
  listCreateImages,
  listCreateVideos,
  listDubbings,
  listProjects,
  listStoryboards,
  listVideos,
  rewriteScript,
  saveAgentCanvasProject,
  saveCanvasProject,
  syncAgentStudioAsset,
  syncAgentStudioCanvasProject,
  updateAsset,
  updateDubbing,
  updateProject,
  updateScript,
  updateSettings,
  updateStoryboard,
  updateTimeline,
} = projectsCanvasCreateFacade;

// Jobs and media.
export const { clearTasks, deleteTask, dismissTask, getTask, listTasks } = jobsFacade;

export const { uploadDataUrlAsFile, uploadFile } = mediaFacade;

// Toolbox capabilities.
export const {
  generateStoryboardGrid25,
  getCapabilities,
  getToolboxCapabilities,
  reverseVideoPrompt,
  runToolboxCapability,
  translateText,
} = toolboxFacade;

// Admin and enterprise operations.
export const {
  deletePlatformAccount,
  listAdminOrders,
  listPlatformAccounts,
  listPricingRules,
  reviewAdminOrder,
  updatePlatformAccount,
} = adminEnterpriseFacade;

// Playground.
export const {
  createPlaygroundConversation,
  deletePlaygroundConversation,
  deletePlaygroundMemory,
  getPlaygroundChatJob,
  getPlaygroundConfig,
  getPlaygroundConversation,
  listPlaygroundChatJobs,
  listPlaygroundConversations,
  listPlaygroundMemories,
  listPlaygroundMessages,
  listPlaygroundModels,
  runPlaygroundChatFacade,
  startPlaygroundChatJob,
  streamPlaygroundChat,
  updatePlaygroundConversation,
  updatePlaygroundMemory,
  updatePlaygroundMemoryPreference,
} = playgroundFacade;
