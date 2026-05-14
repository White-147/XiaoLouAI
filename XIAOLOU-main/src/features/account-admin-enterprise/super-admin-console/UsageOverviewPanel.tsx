import { Activity, Clock, CreditCard, LoaderCircle, RefreshCw, Search, ShieldCheck, UserRound, Users, Wallet as WalletIcon } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { CreditUsageSeriesPoint, CreditUsageStats, CreditUsageSubject } from "./api/super-admin-console";
import { cn } from "../../../lib/utils";

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

function UsageChart(props: {
  series: CreditUsageSeriesPoint[];
  loading?: boolean;
  formatCredits: (value: number | null | undefined) => string;
}) {
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
    <div className="relative h-[260px] w-full rounded-lg border border-border/70 bg-background p-4">
      {props.loading ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60">
          <LoaderCircle className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : null}
      <svg viewBox="0 0 760 220" className="h-full w-full" role="img" aria-label="最近 30 天积分消耗">
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
          {props.formatCredits(maxValue)}
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

function subjectIcon(subject: CreditUsageSubject | null) {
  if (subject?.type === "organization") return Users;
  if (subject?.type === "platform") return ShieldCheck;
  return UserRound;
}

export function SubjectButton(props: { subject: CreditUsageSubject; active: boolean; onClick: () => void }) {
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

type UsageOverviewPanelProps = {
  stats: CreditUsageStats | null;
  subjects: CreditUsageSubject[];
  selectedSubject: CreditUsageSubject | null;
  setSelectedSubject: Dispatch<SetStateAction<CreditUsageSubject | null>>;
  subjectSearch: string;
  setSubjectSearch: Dispatch<SetStateAction<string>>;
  loadingUsage: boolean;
  loadingSubjects: boolean;
  walletDescription: string;
  onRefreshUsage: () => void;
  formatCredits: (value: number | null | undefined) => string;
};

export function UsageOverviewPanel({
  stats,
  subjects,
  selectedSubject,
  setSelectedSubject,
  subjectSearch,
  setSubjectSearch,
  loadingUsage,
  loadingSubjects,
  walletDescription,
  onRefreshUsage,
  formatCredits,
}: UsageOverviewPanelProps) {
  return (
    <>
      <section className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="rounded-lg border border-border/70 bg-card p-4">
          <label className="text-sm font-medium text-foreground">统计对象</label>
          <div className="mt-3 flex min-h-10 items-center gap-2 rounded-lg border border-border/70 bg-background px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={subjectSearch}
              onChange={(event) => setSubjectSearch(event.target.value)}
              placeholder="搜索姓名、邮箱、手机号或企业"
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
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">{stats?.subject.label || "全平台"}</p>
              <p className="mt-1 text-xs text-muted-foreground">{stats?.subject.detail || "所有钱包总消耗"}</p>
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
          <div className="mt-4 text-sm text-muted-foreground">
            当前统计：{walletDescription} · 最近 {stats?.windowDays || 30} 天
          </div>
        </div>
      </section>

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
        </div>
        <UsageChart series={stats?.series || []} loading={loadingUsage} formatCredits={formatCredits} />
      </section>
    </>
  );
}
