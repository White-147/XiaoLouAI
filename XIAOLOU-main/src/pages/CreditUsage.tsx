import {
  Activity,
  Clock,
  CreditCard,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  Users,
  Wallet as WalletIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  getAdminCreditUsageStats,
  getMe,
  getWalletUsageStats,
  searchCreditUsageSubjects,
  type CreditUsageMode,
  type CreditUsageSeriesPoint,
  type CreditUsageStats,
  type CreditUsageSubject,
  type PermissionContext,
  type WalletLedgerEntry,
} from "../lib/api";
import { cn } from "../lib/utils";

function formatCredits(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString("zh-CN")} 积分`;
}

function formatShortTime(value?: string | null) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function formatLedger(entry: WalletLedgerEntry) {
  const labelMap: Record<string, string> = {
    recharge: "充值入账",
    grant: "额度发放",
    freeze: "任务冻结",
    settle: "任务结算",
    refund: "积分退回",
  };
  return labelMap[entry.entryType] || entry.entryType;
}

function subjectIcon(subject: CreditUsageSubject | null) {
  if (subject?.type === "organization") return Users;
  if (subject?.type === "platform") return ShieldCheck;
  return UserRound;
}

function seriesPoints(series: CreditUsageSeriesPoint[]) {
  const width = 760;
  const height = 220;
  const paddingX = 28;
  const paddingY = 24;
  const maxValue = Math.max(...series.map((item) => item.consumedCredits), 1);
  const lastIndex = Math.max(series.length - 1, 1);
  return series.map((item, index) => {
    const x = paddingX + (index / lastIndex) * (width - paddingX * 2);
    const y = height - paddingY - (item.consumedCredits / maxValue) * (height - paddingY * 2);
    return { x, y, item };
  });
}

function UsageChart(props: { series: CreditUsageSeriesPoint[] }) {
  const points = seriesPoints(props.series);
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");
  const area =
    points.length > 0
      ? `${points[0].x},196 ${points.map((point) => `${point.x},${point.y}`).join(" ")} ${
          points[points.length - 1].x
        },196`
      : "";
  const maxValue = Math.max(...props.series.map((item) => item.consumedCredits), 0);

  return (
    <div className="h-[260px] w-full rounded-lg border border-border/70 bg-background p-4">
      <svg viewBox="0 0 760 220" className="h-full w-full" role="img" aria-label="最近30天积分消耗折线图">
        <line x1="28" y1="196" x2="732" y2="196" className="stroke-border" strokeWidth="1" />
        <line x1="28" y1="24" x2="28" y2="196" className="stroke-border" strokeWidth="1" />
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1="28"
            y1={196 - ratio * 172}
            x2="732"
            y2={196 - ratio * 172}
            className="stroke-border/60"
            strokeDasharray="4 6"
            strokeWidth="1"
          />
        ))}
        {area ? <polygon points={area} className="fill-primary/10" /> : null}
        {polyline ? (
          <polyline points={polyline} fill="none" className="stroke-primary" strokeWidth="3" strokeLinejoin="round" />
        ) : null}
        {points.map((point, index) =>
          index === 0 || index === points.length - 1 || point.item.consumedCredits > 0 ? (
            <circle key={`${point.item.bucketLabel}-${index}`} cx={point.x} cy={point.y} r="3.5" className="fill-primary" />
          ) : null,
        )}
        <text x="32" y="18" className="fill-muted-foreground text-[11px]">
          {formatCredits(maxValue)}
        </text>
        <text x="32" y="214" className="fill-muted-foreground text-[11px]">
          {props.series[0]?.bucketLabel || "--"}
        </text>
        <text x="696" y="214" className="fill-muted-foreground text-[11px]">
          {props.series[props.series.length - 1]?.bucketLabel || "--"}
        </text>
      </svg>
    </div>
  );
}

function MetricTile(props: {
  icon: typeof Activity;
  label: string;
  value: string;
  hint?: string;
}) {
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

function SubjectButton(props: {
  subject: CreditUsageSubject;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = subjectIcon(props.subject);
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "flex min-h-12 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition",
        props.active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border/70 bg-background text-foreground hover:border-primary/30 hover:bg-accent/50",
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{props.subject.label}</span>
        <span className="block truncate text-xs text-muted-foreground">{props.subject.detail || props.subject.id}</span>
      </span>
    </button>
  );
}

export default function CreditUsage() {
  const [me, setMe] = useState<PermissionContext | null>(null);
  const [mode, setMode] = useState<CreditUsageMode>("personal");
  const [stats, setStats] = useState<CreditUsageStats | null>(null);
  const [subjects, setSubjects] = useState<CreditUsageSubject[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<CreditUsageSubject | null>(null);
  const [search, setSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [subjectLoading, setSubjectLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void getMe()
      .then((response) => {
        if (active) setMe(response);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "加载账号信息失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const isPlatformAdmin = me?.platformRole === "ops_admin" || me?.platformRole === "super_admin";
  const isEnterpriseAdmin = me?.currentOrganizationRole === "enterprise_admin";
  const canUseOrganizationMode = Boolean(isEnterpriseAdmin && !isPlatformAdmin);

  useEffect(() => {
    if (!me || isPlatformAdmin) return;
    if (!canUseOrganizationMode && mode === "organization") {
      setMode("personal");
    }
  }, [canUseOrganizationMode, isPlatformAdmin, me, mode]);

  useEffect(() => {
    if (!me || !isPlatformAdmin) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setSubjectLoading(true);
      void searchCreditUsageSubjects(search)
        .then((response) => {
          if (!active) return;
          setSubjects(response.items);
          setSelectedSubject((current) => current || response.items[0] || null);
        })
        .catch((caught) => {
          if (active) setError(caught instanceof Error ? caught.message : "搜索统计对象失败");
        })
        .finally(() => {
          if (active) setSubjectLoading(false);
        });
    }, 220);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [isPlatformAdmin, me, search]);

  useEffect(() => {
    if (!me) return;
    let active = true;
    setLoading(true);
    setError(null);

    const request = isPlatformAdmin
      ? getAdminCreditUsageStats({
          subjectType: selectedSubject?.type || "platform",
          subjectId: selectedSubject?.type === "platform" ? null : selectedSubject?.id || null,
        })
      : getWalletUsageStats(mode);

    void request
      .then((response) => {
        if (active) setStats(response);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : "加载积分统计失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isPlatformAdmin, me, mode, refreshKey, selectedSubject]);

  const walletDescription = useMemo(() => {
    if (!stats?.wallets.length) return "暂无可统计钱包";
    if (stats.wallets.length === 1) return stats.wallets[0]?.displayName || stats.wallets[0]?.id || "钱包";
    return `${stats.wallets.length} 个钱包合计`;
  }, [stats]);

  const titleDetail = isPlatformAdmin
    ? "搜索账号或企业，查看真实结算后的积分消耗。"
    : canUseOrganizationMode
      ? "企业管理员可切换企业总消耗和个人消耗。"
      : "当前账号的个人积分消耗。";

  return (
    <main className="h-full overflow-y-auto bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-border/70 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CreditCard className="h-4 w-4" />
              <span>钱包与账本</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">积分统计</h1>
            <p className="mt-2 text-sm text-muted-foreground">{titleDetail}</p>
          </div>
          <button
            type="button"
            onClick={() => setRefreshKey((value) => value + 1)}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border/70 bg-card px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            刷新
          </button>
        </header>

        {error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}

        {isPlatformAdmin ? (
          <section className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="rounded-lg border border-border/70 bg-card p-4">
              <label className="text-sm font-medium text-foreground">统计对象</label>
              <div className="mt-3 flex min-h-10 items-center gap-2 rounded-lg border border-border/70 bg-background px-3">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索姓名、邮箱、手机号或企业"
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
                />
                {subjectLoading ? <LoaderCircle className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
              </div>
              <div className="mt-4 flex max-h-[320px] flex-col gap-2 overflow-y-auto pr-1">
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
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">{stats?.subject.label || "全平台"}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{stats?.subject.detail || "所有钱包总消耗"}</p>
                </div>
                <span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
                  管理员视图
                </span>
              </div>
              <div className="mt-4 text-sm text-muted-foreground">
                当前统计：{walletDescription} · 最近 {stats?.windowDays || 30} 天
              </div>
            </div>
          </section>
        ) : canUseOrganizationMode ? (
          <section className="flex flex-wrap items-center gap-2">
            {[
              { value: "organization" as const, label: "企业总消耗", icon: Users },
              { value: "personal" as const, label: "个人消耗", icon: UserRound },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setMode(item.value)}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition",
                  mode === item.value
                    ? "border-primary/50 bg-primary/10 text-primary"
                    : "border-border/70 bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </button>
            ))}
          </section>
        ) : null}

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricTile
            icon={Activity}
            label="本期消耗"
            value={formatCredits(stats?.summary.consumedCredits)}
            hint={`最近 ${stats?.windowDays || 30} 天`}
          />
          <MetricTile icon={Clock} label="今日消耗" value={formatCredits(stats?.summary.todayConsumedCredits)} />
          <MetricTile icon={RefreshCw} label="退款积分" value={formatCredits(stats?.summary.refundedCredits)} />
          <MetricTile icon={WalletIcon} label="冻结中" value={formatCredits(stats?.summary.pendingFrozenCredits)} />
          <MetricTile icon={CreditCard} label="可用余额" value={formatCredits(stats?.summary.availableCredits)} hint={walletDescription} />
        </section>

        <section className="rounded-lg border border-border/70 bg-card p-4">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">分时消耗</h2>
              <p className="mt-1 text-sm text-muted-foreground">按天聚合最近 30 天实际结算消耗。</p>
            </div>
            {loading ? <LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" /> : null}
          </div>
          <UsageChart series={stats?.series || []} />
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div className="rounded-lg border border-border/70 bg-card p-4">
            <h2 className="text-base font-semibold text-foreground">钱包范围</h2>
            <div className="mt-4 flex flex-col gap-3">
              {stats?.wallets.length ? (
                stats.wallets.map((wallet) => (
                  <div key={wallet.id} className="rounded-lg border border-border/70 bg-background px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{wallet.displayName || wallet.id}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {wallet.ownerType === "organization" ? "企业钱包" : "个人钱包"}
                        </p>
                      </div>
                      <div className="text-right text-sm font-medium text-foreground">
                        {formatCredits(wallet.availableCredits ?? wallet.creditsAvailable)}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                  暂无可统计钱包
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border/70 bg-card p-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-foreground">最近流水</h2>
              <span className="text-xs text-muted-foreground">
                最近活动：{formatShortTime(stats?.summary.lastActivityAt)}
              </span>
            </div>
            <div className="mt-4 divide-y divide-border/70">
              {stats?.recentEntries.length ? (
                stats.recentEntries.map((entry) => (
                  <div key={entry.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{formatLedger(entry)}</p>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {formatShortTime(entry.createdAt)} · {entry.sourceType}
                      </p>
                    </div>
                    <div
                      className={cn(
                        "shrink-0 text-sm font-semibold",
                        entry.amount < 0 ? "text-foreground" : "text-emerald-600",
                      )}
                    >
                      {entry.amount > 0 ? "+" : ""}
                      {formatCredits(entry.amount)}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-border px-3 py-8 text-center text-sm text-muted-foreground">
                  暂无流水记录
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
