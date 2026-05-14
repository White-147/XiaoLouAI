import { Activity, CreditCard, LoaderCircle, ReceiptText, RefreshCw, Search, Wallet as WalletIcon } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { CreditUsageStats, CreditUsageSubject } from "./api/super-admin-console";
import { SubjectButton } from "./UsageOverviewPanel";
import { cn } from "../../../lib/utils";

function MetricTile(props: { icon: typeof Activity; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/70 bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        <props.icon className="h-4 w-4" />
        <span>{props.label}</span>
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-foreground">{props.value}</div>
      {props.hint ? <div className="mt-2 text-xs text-muted-foreground">{props.hint}</div> : null}
    </div>
  );
}

type BillingTotals = {
  income: number;
  expense: number;
};

type BillingEntry = CreditUsageStats["recentEntries"][number];

type PlatformBillingPanelProps = {
  stats: CreditUsageStats | null;
  subjects: CreditUsageSubject[];
  selectedSubject: CreditUsageSubject | null;
  setSelectedSubject: Dispatch<SetStateAction<CreditUsageSubject | null>>;
  subjectSearch: string;
  setSubjectSearch: Dispatch<SetStateAction<string>>;
  loadingUsage: boolean;
  loadingSubjects: boolean;
  walletDescription: string;
  billingEntries: BillingEntry[];
  billingTotals: BillingTotals;
  onRefreshUsage: () => void;
  formatCredits: (value: number | null | undefined) => string;
  formatTime: (value?: string | null) => string;
  formatSignedCredits: (value: number) => string;
  ledgerEntryLabel: (entry: BillingEntry) => string;
  ledgerReference: (entry: BillingEntry) => string;
};

export function PlatformBillingPanel({
  stats,
  subjects,
  selectedSubject,
  setSelectedSubject,
  subjectSearch,
  setSubjectSearch,
  loadingUsage,
  loadingSubjects,
  walletDescription,
  billingEntries,
  billingTotals,
  onRefreshUsage,
  formatCredits,
  formatTime,
  formatSignedCredits,
  ledgerEntryLabel,
  ledgerReference,
}: PlatformBillingPanelProps) {
  return (
    <section className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-lg border border-border/70 bg-card p-4">
          <label className="text-sm font-medium text-foreground">账单对象</label>
          <div className="mt-3 flex min-h-10 items-center gap-2 rounded-lg border border-border/70 bg-background px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={subjectSearch}
              onChange={(event) => setSubjectSearch(event.target.value)}
              placeholder="搜索用户、企业或平台"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            {loadingSubjects ? <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>
          <div className="mt-4 flex max-h-[320px] flex-col gap-2 overflow-y-auto pr-1 custom-scrollbar">
            {subjects.length ? (
              subjects.map((subject) => (
                <SubjectButton
                  key={`${subject.type}:${subject.id}`}
                  subject={subject}
                  active={selectedSubject?.type === subject.type && selectedSubject?.id === subject.id}
                  onClick={() => setSelectedSubject(subject)}
                />
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                暂无匹配对象
              </div>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-border/70 bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ReceiptText className="h-4 w-4" />
                <span>平台账单与钱包流水</span>
              </div>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
                {stats?.subject.label || "全平台"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {stats?.subject.detail || "汇总平台、企业和个人钱包流水。"}
              </p>
              <p className="mt-3 text-sm text-muted-foreground">
                当前账单：{walletDescription} · 最近 {stats?.windowDays || 30} 天
              </p>
            </div>
            <button
              type="button"
              onClick={onRefreshUsage}
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-border/70 bg-background px-3 text-xs font-medium text-foreground transition hover:bg-accent"
            >
              <RefreshCw className={cn("h-4 w-4", loadingUsage && "animate-spin")} />
              刷新
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricTile icon={CreditCard} label="可用余额" value={formatCredits(stats?.summary.availableCredits)} hint={walletDescription} />
        <MetricTile icon={WalletIcon} label="冻结余额" value={formatCredits(stats?.summary.frozenCredits)} />
        <MetricTile icon={ReceiptText} label="流水入账" value={formatCredits(billingTotals.income)} />
        <MetricTile icon={Activity} label="流水支出" value={formatCredits(billingTotals.expense)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.12fr)]">
        <section className="rounded-lg border border-border/70 bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-foreground">钱包列表</h3>
              <p className="mt-1 text-sm text-muted-foreground">{stats?.wallets.length || 0} 个钱包纳入当前账单</p>
            </div>
            {loadingUsage ? <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>
          <div className="mt-4 space-y-3">
            {stats?.wallets.length ? (
              stats.wallets.map((wallet) => (
                <div key={wallet.id || `${wallet.ownerType}:${wallet.ownerId}`} className="rounded-lg border border-border/70 bg-background/50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">
                        {wallet.displayName || wallet.id || wallet.ownerId}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {wallet.ownerType || wallet.walletOwnerType || "wallet"} · {wallet.ownerId}
                      </p>
                    </div>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
                      {wallet.status || "active"}
                    </span>
                  </div>
                  <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                    <p>可用：{formatCredits(wallet.availableCredits ?? wallet.creditsAvailable)}</p>
                    <p>冻结：{formatCredits(wallet.frozenCredits ?? wallet.creditsFrozen)}</p>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">
                {loadingUsage ? "正在加载钱包..." : "暂无可查看钱包。"}
              </div>
            )}
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-border/70 bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
            <div>
              <h3 className="text-base font-semibold text-foreground">最近流水</h3>
              <p className="mt-1 text-sm text-muted-foreground">{billingEntries.length} 条记录</p>
            </div>
            {loadingUsage ? (
              <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                正在加载
              </span>
            ) : null}
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-border/70">
              <thead className="bg-background/55 text-left text-xs font-medium text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">项目</th>
                  <th className="px-4 py-3">来源</th>
                  <th className="px-4 py-3">时间</th>
                  <th className="px-4 py-3 text-right">积分</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {billingEntries.length ? (
                  billingEntries.map((entry) => (
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
                        {formatTime(entry.createdAt)}
                      </td>
                      <td
                        className={cn(
                          "whitespace-nowrap px-4 py-3 text-right font-semibold",
                          entry.amount > 0 ? "text-emerald-600 dark:text-emerald-300" : "text-foreground",
                        )}
                      >
                        {formatSignedCredits(entry.amount)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      {loadingUsage ? "正在加载钱包流水..." : "暂无钱包流水。"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </section>
  );
}
