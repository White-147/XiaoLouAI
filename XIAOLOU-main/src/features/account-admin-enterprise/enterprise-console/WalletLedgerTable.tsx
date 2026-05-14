import { LoaderCircle } from "lucide-react";
import type { WalletLedgerEntry } from "./api/enterprise-console";

type WalletLedgerTableProps = {
  walletName: string;
  entryCount: number;
  entries: WalletLedgerEntry[];
  loading: boolean;
  error: string | null;
  formatCredits: (value: number | null | undefined) => string;
  formatShortDate: (value: string | null | undefined) => string;
  formatSignedCredits: (value: number) => string;
  ledgerEntryLabel: (entry: WalletLedgerEntry) => string;
  ledgerReference: (entry: WalletLedgerEntry) => string;
};

export function WalletLedgerTable({
  walletName,
  entryCount,
  entries,
  loading,
  error,
  formatCredits,
  formatShortDate,
  formatSignedCredits,
  ledgerEntryLabel,
  ledgerReference,
}: WalletLedgerTableProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-background/35">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">企业钱包流水</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {walletName} · {entryCount} 条记录
          </p>
        </div>
        {loading ? (
          <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            正在加载
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="border-b border-border/70 bg-rose-500/10 px-4 py-3 text-sm text-rose-600 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-border/70">
          <thead className="bg-background/45 text-left text-xs font-medium text-muted-foreground">
            <tr>
              <th className="px-4 py-3">项目</th>
              <th className="px-4 py-3">来源</th>
              <th className="px-4 py-3">时间</th>
              <th className="px-4 py-3 text-right">积分</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {entries.length ? (
              entries.map((entry) => (
                <tr key={entry.id} className="text-sm">
                  <td className="max-w-[240px] px-4 py-3">
                    <div className="truncate font-medium text-foreground" title={ledgerEntryLabel(entry)}>
                      {ledgerEntryLabel(entry)}
                    </div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      余额 {formatCredits(entry.balanceAfter)}
                      {entry.frozenBalanceAfter ? ` · 冻结 ${formatCredits(entry.frozenBalanceAfter)}` : ""}
                    </div>
                  </td>
                  <td className="max-w-[260px] px-4 py-3 text-muted-foreground">
                    <span className="block truncate" title={ledgerReference(entry)}>
                      {ledgerReference(entry)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                    {formatShortDate(entry.createdAt)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-3 text-right font-semibold ${
                      entry.amount > 0 ? "text-emerald-600 dark:text-emerald-300" : "text-foreground"
                    }`}
                  >
                    {formatSignedCredits(entry.amount)}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {loading ? "正在加载企业钱包流水..." : "暂无企业钱包流水。"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
