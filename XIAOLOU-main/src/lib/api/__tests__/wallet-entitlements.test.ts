import { describe, expect, it } from "vitest";
import type { PermissionContext, Wallet } from "../../api";
import {
  filterWalletsForEntitlement,
  filterWalletsForRecharge,
  resolveWalletEntitlement,
  resolveWalletListRequest,
  resolveWalletUsageRequest,
} from "../../wallet-entitlements";

type PermissionContextOverrides = Partial<Omit<PermissionContext, "actor" | "permissions">> & {
  actor?: Partial<PermissionContext["actor"]>;
  permissions?: Partial<PermissionContext["permissions"]>;
};

function createContext(overrides: PermissionContextOverrides = {}): PermissionContext {
  const base: PermissionContext = {
    actor: {
      id: "synthetic-user",
      displayName: "Synthetic user",
      email: "synthetic@example.test",
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

  return {
    ...base,
    ...overrides,
    actor: {
      ...base.actor,
      ...overrides.actor,
    },
    permissions: {
      ...base.permissions,
      ...overrides.permissions,
    },
  };
}

function createWallet(overrides: Partial<Wallet>): Wallet {
  return {
    id: "synthetic-wallet",
    ownerType: "user",
    walletOwnerType: "user",
    ownerId: "synthetic-user",
    displayName: "Synthetic Wallet",
    availableCredits: 100,
    frozenCredits: 0,
    creditsAvailable: 100,
    creditsFrozen: 0,
    currency: "CNY",
    updatedAt: "2026-05-06T00:00:00.000Z",
    ...overrides,
  };
}

const enterpriseOrganization = {
  id: "synthetic-org",
  name: "Synthetic Org",
  role: "enterprise_admin" as const,
  membershipRole: "admin" as const,
  status: "active",
};

describe("wallet entitlements", () => {
  it("routes enterprise admins to the enterprise wallet", () => {
    const context = createContext({
      organizations: [enterpriseOrganization],
      currentOrganizationId: enterpriseOrganization.id,
      currentOrganizationRole: "enterprise_admin",
      permissions: {
        canUseEnterprise: true,
        canManageOrganization: true,
      },
    });
    const wallets = [
      createWallet({ id: "personal-wallet", ownerType: "user", ownerId: context.actor.id }),
      createWallet({ id: "org-wallet", ownerType: "organization", ownerId: enterpriseOrganization.id }),
    ];

    const entitlement = resolveWalletEntitlement(context);

    expect(entitlement).toMatchObject({
      kind: "enterprise_admin",
      ownerType: "organization",
      ownerId: enterpriseOrganization.id,
      usageMode: "organization",
      canRecharge: true,
    });
    expect(resolveWalletListRequest(context)).toEqual({
      ownerType: "organization",
      ownerId: enterpriseOrganization.id,
    });
    expect(resolveWalletUsageRequest(context)).toEqual({
      mode: "organization",
      ownerId: enterpriseOrganization.id,
    });
    expect(filterWalletsForEntitlement(wallets, entitlement).map((wallet) => wallet.id)).toEqual(["org-wallet"]);
    expect(filterWalletsForRecharge(wallets, entitlement).map((wallet) => wallet.id)).toEqual(["org-wallet"]);
  });

  it("keeps enterprise members off personal and recharge wallets", () => {
    const context = createContext({
      organizations: [{ ...enterpriseOrganization, role: "enterprise_member", membershipRole: "member" }],
      currentOrganizationId: enterpriseOrganization.id,
      currentOrganizationRole: "enterprise_member",
      permissions: {
        canRecharge: true,
        canUseEnterprise: true,
      },
    });
    const wallets = [
      createWallet({ id: "personal-wallet", ownerType: "user", ownerId: context.actor.id }),
      createWallet({ id: "org-wallet", ownerType: "organization", ownerId: enterpriseOrganization.id }),
    ];

    const entitlement = resolveWalletEntitlement(context);

    expect(entitlement).toMatchObject({
      kind: "enterprise_member",
      ownerType: "organization",
      ownerId: enterpriseOrganization.id,
      usageMode: "organization",
      canRecharge: false,
    });
    expect(filterWalletsForEntitlement(wallets, entitlement).map((wallet) => wallet.id)).toEqual(["org-wallet"]);
    expect(filterWalletsForRecharge(wallets, entitlement)).toEqual([]);
  });

  it("keeps personal accounts on personal wallets only", () => {
    const context = createContext();
    const wallets = [
      createWallet({ id: "personal-wallet", ownerType: "user", ownerId: context.actor.id }),
      createWallet({ id: "org-wallet", ownerType: "organization", ownerId: "synthetic-org" }),
    ];

    const entitlement = resolveWalletEntitlement(context);

    expect(entitlement).toMatchObject({
      kind: "personal",
      ownerType: "user",
      ownerId: context.actor.id,
      usageMode: "personal",
      canRecharge: true,
    });
    expect(resolveWalletListRequest(context)).toEqual({
      ownerType: "user",
      ownerId: context.actor.id,
    });
    expect(resolveWalletUsageRequest(context)).toEqual({
      mode: "personal",
      ownerId: context.actor.id,
    });
    expect(filterWalletsForEntitlement(wallets, entitlement).map((wallet) => wallet.id)).toEqual(["personal-wallet"]);
    expect(filterWalletsForRecharge(wallets, entitlement).map((wallet) => wallet.id)).toEqual(["personal-wallet"]);
  });
});
