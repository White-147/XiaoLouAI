import { FileText, Zap } from "lucide-react";
import type { ReactNode } from "react";
import type { Wallet, WalletLedgerEntry } from "../../../lib/api";
import { formatCredits, getWalletName, WalletLedgerTable } from "./WalletLedgerTable";

type SubscriptionPanelProps = {
  activeWallet: Wallet | null;
  walletBalance: number;
  walletFrozen: number;
  todayConsumption: number;
  totalConsumption: number;
  consumptionEntries: WalletLedgerEntry[];
  walletLoading: boolean;
  ledgerLoading: boolean;
  walletError: string | null;
  walletSwitcher: ReactNode;
};

export function SubscriptionPanel({
  activeWallet,
  walletBalance,
  walletFrozen,
  todayConsumption,
  totalConsumption,
  consumptionEntries,
  walletLoading,
  ledgerLoading,
  walletError,
  walletSwitcher,
}: SubscriptionPanelProps) {
  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">账户额度</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-normal text-foreground">订阅</h2>
        </div>
        {walletSwitcher}
      </header>

      <section className="mt-8 rounded-2xl border border-border bg-muted/50 p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="text-2xl font-semibold tracking-normal text-foreground">Free</div>
            <div className="mt-8 flex items-center gap-2 text-3xl font-semibold text-foreground">
              <Zap className="h-7 w-7 fill-foreground text-foreground" />
              <span className="tabular-nums">
                {walletLoading ? "..." : formatCredits(walletBalance, activeWallet?.unlimitedCredits)}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">{getWalletName(activeWallet)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.location.assign("/wallet/recharge")}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              充值积分
            </button>
            <button
              type="button"
              onClick={() => window.location.assign("/wallet/usage")}
              className="rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent hover:text-accent-foreground"
            >
              查看用量
            </button>
          </div>
        </div>

        <div className="mt-7 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs font-medium text-muted-foreground">可用积分</div>
            <div className="mt-2 text-xl font-semibold tabular-nums text-foreground">
              {formatCredits(walletBalance, activeWallet?.unlimitedCredits)}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs font-medium text-muted-foreground">冻结积分</div>
            <div className="mt-2 text-xl font-semibold tabular-nums text-foreground">
              {formatCredits(walletFrozen)}
            </div>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="text-xs font-medium text-muted-foreground">今日消耗</div>
            <div className="mt-2 text-xl font-semibold tabular-nums text-foreground">
              {formatCredits(todayConsumption)}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">最近消耗</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              累计消耗 {formatCredits(totalConsumption)} 积分
            </p>
          </div>
          <FileText className="h-5 w-5 text-muted-foreground" />
        </div>
        <WalletLedgerTable
          entries={consumptionEntries.slice(0, 5)}
          emptyText="暂无消耗记录"
          walletLoading={walletLoading}
          ledgerLoading={ledgerLoading}
          walletError={walletError}
          activeWallet={activeWallet}
        />
      </section>
    </div>
  );
}
