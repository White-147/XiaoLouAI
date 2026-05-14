import { CreditCard, ReceiptText, RefreshCw, ShieldCheck, Wallet } from "lucide-react";
import type { Wallet as WalletInfo, WalletLedgerEntry } from "./api/enterprise-console";
import { WalletLedgerTable } from "./WalletLedgerTable";

type WalletLedgerSummary = {
  income: number;
  expense: number;
};

type EnterpriseBillingPanelProps = {
  wallet: WalletInfo | null;
  walletLedgerEntries: WalletLedgerEntry[];
  recentWalletLedgerEntries: WalletLedgerEntry[];
  walletLedgerSummary: WalletLedgerSummary;
  walletLedgerLoading: boolean;
  walletLedgerError: string | null;
  onRefreshLedger: () => void;
  onOpenRecharge: () => void;
  formatCredits: (value: number | null | undefined) => string;
  formatShortDate: (value: string | null | undefined) => string;
  formatSignedCredits: (value: number) => string;
  ledgerEntryLabel: (entry: WalletLedgerEntry) => string;
  ledgerReference: (entry: WalletLedgerEntry) => string;
};

export function EnterpriseBillingPanel({
  wallet,
  walletLedgerEntries,
  recentWalletLedgerEntries,
  walletLedgerSummary,
  walletLedgerLoading,
  walletLedgerError,
  onRefreshLedger,
  onOpenRecharge,
  formatCredits,
  formatShortDate,
  formatSignedCredits,
  ledgerEntryLabel,
  ledgerReference,
}: EnterpriseBillingPanelProps) {
  return (
    <div id="enterprise-wallet-ledger" className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">企业钱包</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">账单与流水</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            企业管理员可在这里查看企业钱包的充值、冻结、结算和退款记录；账户中心账单暂时保留，确认管理台体验完整后再隐藏。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onRefreshLedger}
            disabled={!wallet?.id || walletLedgerLoading}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-border/70 bg-background/55 px-4 py-2 text-sm font-medium text-foreground transition hover:bg-secondary/70 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${walletLedgerLoading ? "animate-spin" : ""}`} />
            刷新流水
          </button>
          <button
            type="button"
            onClick={onOpenRecharge}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition hover:bg-primary/15"
          >
            <CreditCard className="h-4 w-4" />
            企业充值
          </button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
          <Wallet className="h-5 w-5 text-primary" />
          <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">可用余额</p>
          <p className="mt-2 text-sm font-medium text-foreground">
            {formatCredits(wallet?.availableCredits ?? wallet?.creditsAvailable)}
          </p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">冻结余额</p>
          <p className="mt-2 text-sm font-medium text-foreground">
            {formatCredits(wallet?.frozenCredits ?? wallet?.creditsFrozen)}
          </p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
          <ReceiptText className="h-5 w-5 text-primary" />
          <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">流水入账</p>
          <p className="mt-2 text-sm font-medium text-foreground">
            {formatCredits(walletLedgerSummary.income)}
          </p>
        </div>
        <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
          <CreditCard className="h-5 w-5 text-primary" />
          <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">流水支出</p>
          <p className="mt-2 text-sm font-medium text-foreground">
            {formatCredits(walletLedgerSummary.expense)}
          </p>
        </div>
      </div>

      <WalletLedgerTable
        walletName={wallet?.displayName || "企业钱包"}
        entryCount={walletLedgerEntries.length}
        entries={recentWalletLedgerEntries}
        loading={walletLedgerLoading}
        error={walletLedgerError}
        formatCredits={formatCredits}
        formatShortDate={formatShortDate}
        formatSignedCredits={formatSignedCredits}
        ledgerEntryLabel={ledgerEntryLabel}
        ledgerReference={ledgerReference}
      />
    </div>
  );
}
