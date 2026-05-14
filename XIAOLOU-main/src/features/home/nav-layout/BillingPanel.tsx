import { ReceiptText } from "lucide-react";
import type { ReactNode } from "react";
import type { Wallet, WalletLedgerEntry } from "../../../lib/api";
import { getWalletName, WalletLedgerTable } from "./WalletLedgerTable";

type BillingPanelProps = {
  activeWallet: Wallet | null;
  ledgerEntries: WalletLedgerEntry[];
  walletLoading: boolean;
  ledgerLoading: boolean;
  walletError: string | null;
  walletSwitcher: ReactNode;
};

export function BillingPanel({
  activeWallet,
  ledgerEntries,
  walletLoading,
  ledgerLoading,
  walletError,
  walletSwitcher,
}: BillingPanelProps) {
  return (
    <div>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-neutral-500">钱包流水</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-normal text-neutral-950">账单</h2>
        </div>
        {walletSwitcher}
      </header>

      <section className="mt-8 rounded-2xl border border-neutral-200 bg-neutral-50/70 p-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-neutral-700 shadow-sm">
            <ReceiptText className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-neutral-950">{getWalletName(activeWallet)}</div>
            <div className="mt-1 text-sm text-neutral-500">
              记录积分充值、冻结、结算、退款和系统发放。
            </div>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-xl border border-neutral-200 bg-white">
          <WalletLedgerTable
            entries={ledgerEntries}
            emptyText="暂无账单记录"
            walletLoading={walletLoading}
            ledgerLoading={ledgerLoading}
            walletError={walletError}
            activeWallet={activeWallet}
          />
        </div>
      </section>
    </div>
  );
}
