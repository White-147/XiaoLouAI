import type {
  CreditUsageMode,
  PermissionContext,
  Wallet,
  WalletOwnerType,
} from "./api";

export type WalletEntitlementKind =
  | "enterprise_admin"
  | "enterprise_member"
  | "personal"
  | "none";

export type WalletEntitlement = {
  kind: WalletEntitlementKind;
  ownerType: WalletOwnerType | null;
  ownerId: string | null;
  usageMode: CreditUsageMode | null;
  canRecharge: boolean;
  displayLabel: string;
  emptyRechargeMessage: string;
};

function resolveCurrentOrganizationId(context: PermissionContext) {
  return (
    context.currentOrganizationId ||
    context.actor.defaultOrganizationId ||
    context.organizations.find((organization) => organization.role === "enterprise_admin")?.id ||
    context.organizations.find((organization) => organization.role === "enterprise_member")?.id ||
    null
  );
}

export function resolveWalletEntitlement(context: PermissionContext | null): WalletEntitlement {
  if (!context || context.platformRole === "guest") {
    return {
      kind: "none",
      ownerType: null,
      ownerId: null,
      usageMode: null,
      canRecharge: false,
      displayLabel: "暂无钱包",
      emptyRechargeMessage: "当前身份下没有可充值的钱包。",
    };
  }

  if (context.currentOrganizationRole === "enterprise_admin") {
    const organizationId = resolveCurrentOrganizationId(context);
    return {
      kind: "enterprise_admin",
      ownerType: organizationId ? "organization" : null,
      ownerId: organizationId,
      usageMode: organizationId ? "organization" : null,
      canRecharge: Boolean(organizationId && context.permissions.canRecharge),
      displayLabel: "企业钱包",
      emptyRechargeMessage: "当前企业管理员身份下暂未找到企业钱包。",
    };
  }

  if (context.currentOrganizationRole === "enterprise_member") {
    const organizationId = resolveCurrentOrganizationId(context);
    return {
      kind: "enterprise_member",
      ownerType: organizationId ? "organization" : null,
      ownerId: organizationId,
      usageMode: organizationId ? "organization" : null,
      canRecharge: false,
      displayLabel: "企业钱包",
      emptyRechargeMessage: "企业成员不拥有个人钱包，企业钱包由企业管理员管理。",
    };
  }

  if (context.platformRole === "customer") {
    return {
      kind: "personal",
      ownerType: "user",
      ownerId: context.actor.id,
      usageMode: "personal",
      canRecharge: context.permissions.canRecharge,
      displayLabel: "个人钱包",
      emptyRechargeMessage: "当前账号下没有可充值的个人钱包。",
    };
  }

  return {
    kind: "none",
    ownerType: null,
    ownerId: null,
    usageMode: null,
    canRecharge: false,
    displayLabel: "暂无钱包",
    emptyRechargeMessage: "当前身份下没有可充值的钱包。",
  };
}

function walletOwnerType(wallet: Wallet) {
  return wallet.ownerType ?? wallet.walletOwnerType ?? null;
}

export function filterWalletsForEntitlement(
  wallets: Wallet[],
  entitlement: WalletEntitlement,
) {
  if (!entitlement.ownerType || !entitlement.ownerId) return [];
  return wallets.filter(
    (wallet) =>
      walletOwnerType(wallet) === entitlement.ownerType &&
      (!wallet.ownerId || wallet.ownerId === entitlement.ownerId),
  );
}

export function filterWalletsForRecharge(
  wallets: Wallet[],
  entitlement: WalletEntitlement,
) {
  if (!entitlement.canRecharge) return [];
  return filterWalletsForEntitlement(wallets, entitlement);
}

export function resolveWalletListRequest(context: PermissionContext | null) {
  const entitlement = resolveWalletEntitlement(context);
  if (!entitlement.ownerType || !entitlement.ownerId) return null;
  return {
    ownerType: entitlement.ownerType,
    ownerId: entitlement.ownerId,
  };
}

export function resolveWalletUsageRequest(context: PermissionContext | null) {
  const entitlement = resolveWalletEntitlement(context);
  if (!entitlement.usageMode || !entitlement.ownerId) return null;
  return {
    mode: entitlement.usageMode,
    ownerId: entitlement.ownerId,
  };
}
