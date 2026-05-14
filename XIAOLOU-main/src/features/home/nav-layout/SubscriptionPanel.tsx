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
          <p className="text-sm font-medium text-neutral-500">账户额度</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-normal text-neutral-950">订阅</h2>
        </div>
        {walletSwitcher}
      </header>

      <section className="mt-8 rounded-2xl border border-neutral-200 bg-neutral-50 p-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <div className="text-2xl font-semibold tracking-normal text-neutral-950">Free</div>
            <div className="mt-8 flex items-center gap-2 text-3xl font-semibold text-neutral-950">
              <Zap className="h-7 w-7 fill-neutral-950 text-neutral-950" />
              <span className="tabular-nums">
                {walletLoading ? "..." : formatCredits(walletBalance, activeWallet?.unlimitedCredits)}
              </span>
            </div>
            <p className="mt-2 text-sm text-neutral-500">{getWalletName(activeWallet)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => window.location.assign("/wallet/recharge")}
              className="rounded-lg bg-neutral-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800"
            >
              充值积分
            </button>
            <button
              type="button"
              onClick={() => window.location.assign("/wallet/usage")}
              className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 transition hover:bg-neutral-100"
            >
              查看用量
            </button>
          </div>
        </div>

        <div className="mt-7 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="text-xs font-medium text-neutral-500">可用积分</div>
            <div className="mt-2 text-xl font-semibold tabular-nums text-neutral-950">
              {formatCredits(walletBalance, activeWallet?.unlimitedCredits)}
            </div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="text-xs font-medium text-neutral-500">冻结积分</div>
            <div className="mt-2 text-xl font-semibold tabular-nums text-neutral-950">
              {formatCredits(walletFrozen)}
            </div>
          </div>
          <div className="rounded-xl border border-neutral-200 bg-white p-4">
            <div className="text-xs font-medium text-neutral-500">今日消耗</div>
            <div className="mt-2 text-xl font-semibold tabular-nums text-neutral-950">
              {formatCredits(todayConsumption)}
            </div>
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-2xl border border-neutral-200 bg-white">
        <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-neutral-950">最近消耗</h3>
            <p className="mt-1 text-xs text-neutral-500">
              累计消耗 {formatCredits(totalConsumption)} 积分
            </p>
          </div>
          <FileText className="h-5 w-5 text-neutral-400" />
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
