import { BadgeCheck, Building2, CreditCard, ReceiptText, ShieldCheck, Users, Wallet } from "lucide-react";
import type { OrganizationMember, PermissionContext, Wallet as WalletInfo } from "./api/enterprise-console";

type EnterpriseUsageSummary = {
  today: number;
  month: number;
  pending: number;
  total: number;
};

type EnterpriseSummaryProps = {
  organization: PermissionContext["organizations"][number];
  context: PermissionContext;
  wallet: WalletInfo | null;
  membersCount: number;
  usageSummary: EnterpriseUsageSummary;
  roleLabel: (role: PermissionContext["currentOrganizationRole"] | OrganizationMember["role"]) => string;
  formatCredits: (value: number | null | undefined) => string;
  onOpenRecharge: () => void;
  onOpenBilling: () => void;
};

export function EnterpriseSummary({
  organization,
  context,
  wallet,
  membersCount,
  usageSummary,
  roleLabel,
  formatCredits,
  onOpenRecharge,
  onOpenBilling,
}: EnterpriseSummaryProps) {
  return (
    <section className="glass-panel rounded-[32px] p-8 sm:p-10">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_360px]">
        <div>
          <span className="dashboard-pill inline-flex bg-primary/12 text-primary">企业控制台</span>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
            {organization.name}
          </h1>
          <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground">
            这里集中处理企业成员创建、企业积分监管、共享权限与企业钱包扣费。企业成员由企业管理员统一创建，不走公开注册入口。
          </p>

          <div className="mt-8 grid gap-4 md:grid-cols-4">
            <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
              <Building2 className="h-5 w-5 text-primary" />
              <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">当前角色</p>
              <p className="mt-2 text-sm font-medium text-foreground">
                {roleLabel(context.currentOrganizationRole)}
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
              <Users className="h-5 w-5 text-primary" />
              <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">成员总数</p>
              <p className="mt-2 text-sm font-medium text-foreground">{membersCount} 人</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
              <CreditCard className="h-5 w-5 text-primary" />
              <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">今日消耗</p>
              <p className="mt-2 text-sm font-medium text-foreground">{formatCredits(usageSummary.today)}</p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">资产库状态</p>
              <p className="mt-2 text-sm font-medium text-foreground">
                {organization.assetLibraryStatus === "approved" ? "已批准" : "待审核"}
              </p>
            </div>
          </div>

          <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs text-primary">
            <BadgeCheck className="h-4 w-4" />
            {context.permissions.canManageOrganization
              ? "当前身份可创建员工账号、查看全员积分使用与企业钱包扣费。"
              : "当前身份可参与企业项目，但成员创建与积分监管仅开放给企业管理员。"}
          </div>
        </div>

        <aside className="rounded-[28px] border border-border/70 bg-background/35 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">企业钱包</p>
              <p className="text-sm font-medium text-foreground">{wallet?.displayName || "企业钱包"}</p>
            </div>
          </div>

          <div className="mt-6 text-3xl font-semibold tracking-tight text-foreground">
            {formatCredits(wallet?.availableCredits ?? wallet?.creditsAvailable)}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            冻结 {formatCredits(wallet?.frozenCredits ?? wallet?.creditsFrozen)}
          </p>

          <div className="mt-6 space-y-3 rounded-2xl border border-border/70 bg-background/30 p-4 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">本月累计消耗</span>
              <span className="font-medium text-foreground">{formatCredits(usageSummary.month)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">待结算冻结</span>
              <span className="font-medium text-foreground">{formatCredits(usageSummary.pending)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">累计企业消耗</span>
              <span className="font-medium text-foreground">{formatCredits(usageSummary.total)}</span>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onOpenRecharge}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
            >
              <CreditCard className="h-4 w-4" />
              进入充值页
            </button>
            <button
              type="button"
              onClick={onOpenBilling}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border/70 bg-background/55 px-4 py-3 text-sm font-medium text-foreground transition hover:bg-secondary/70"
            >
              <ReceiptText className="h-4 w-4" />
              查看账单
            </button>
          </div>
        </aside>
      </div>
    </section>
  );
}
