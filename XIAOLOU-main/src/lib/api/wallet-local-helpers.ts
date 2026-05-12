import { ApiRequestError } from "./control-api-client";
import { buildFallbackPermissionContext } from "./auth-owner-scope";
import type { Wallet, WalletOwnerType } from "./wallet-types";

export function normalizeWalletRecord(wallet: Wallet, actorId: string): Wallet {
  const fallbackContext = buildFallbackPermissionContext(actorId);
  const currentOrganization = fallbackContext.organizations.find(
    (item) => item.id === fallbackContext.currentOrganizationId,
  );
  const ownerType: WalletOwnerType =
    wallet.ownerType ??
    wallet.walletOwnerType ??
    (currentOrganization ? "organization" : "user");

  return {
    ...wallet,
    ownerType,
    displayName:
      wallet.displayName ??
      (ownerType === "organization"
        ? `${currentOrganization?.name || "\u4f01\u4e1a"}\u94b1\u5305`
        : `${fallbackContext.actor.displayName}\u94b1\u5305`),
    availableCredits: wallet.availableCredits ?? wallet.creditsAvailable ?? 0,
    frozenCredits: wallet.frozenCredits ?? wallet.creditsFrozen ?? 0,
    creditsAvailable: wallet.creditsAvailable ?? wallet.availableCredits ?? 0,
    creditsFrozen: wallet.creditsFrozen ?? wallet.frozenCredits ?? 0,
    status: wallet.status ?? "active",
    allowNegative: wallet.allowNegative ?? false,
  };
}

export function createEmptyWallet(ownerType: WalletOwnerType, ownerId: string): Wallet {
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

export function retiredRechargeError(flow: string): never {
  throw new ApiRequestError(
    `${flow} is retired during the Windows-native cutover; use canonical payment callback evidence for production payment validation.`,
    {
      code: "RECHARGE_FLOW_RETIRED",
      status: 410,
    },
  );
}
