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
  failureReason?: string | null;
  error?: string | null;
  errorStack?: string | null;
  errorCause?: string | null;
  errorDetails?: string | null;
  providerStatusCode?: string | null;
  provider?: string | null;
  providerCode?: string | null;
  providerSupportCode?: string | null;
  providerMessage?: string | null;
  quotedCredits?: number;
  frozenCredits?: number;
  settledCredits?: number;
  billingStatus?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ListTasksOptions = {
  limit?: number;
  offset?: number;
  types?: string[];
};
