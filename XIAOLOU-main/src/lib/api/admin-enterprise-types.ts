import type { Wallet, WalletRechargeOrder } from "./wallet-types";

type PlatformRole = "guest" | "customer" | "ops_admin" | "super_admin";

export type PricingRule = {
  id: string;
  actionCode: string;
  label: string;
  baseCredits: number;
  unitLabel: string;
  description: string;
  updatedAt: string;
};

export type PlatformAccount = {
  id: string;
  userId: string;
  displayName: string;
  email: string | null;
  phone?: string | null;
  avatar?: string | null;
  platformRole: PlatformRole;
  status: string;
  accountStatus?: string;
  deleted?: boolean;
  deletedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export type UpdatePlatformAccountInput = {
  displayName?: string;
  email?: string;
  phone?: string | null;
  platformRole?: PlatformRole;
  newPassword?: string;
};

export type AdminRechargeOrder = WalletRechargeOrder & {
  wallet?: Wallet | null;
};

export type AdminOrderReviewInput = {
  decision: "approve" | "reject";
  note?: string;
};
