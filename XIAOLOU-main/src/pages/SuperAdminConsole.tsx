import {
  Activity,
  CheckCircle2,
  Clock,
  CreditCard,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldX,
  Trash2,
  UserRound,
  Users,
  Wallet as WalletIcon,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  deletePlatformAccount,
  getAdminCreditUsageStats,
  getMe,
  listAdminOrders,
  listPlatformAccounts,
  reviewAdminOrder,
  searchCreditUsageSubjects,
  updatePlatformAccount,
  type AdminRechargeOrder,
  type CreditUsageSeriesPoint,
  type CreditUsageStats,
  type CreditUsageSubject,
  type PermissionContext,
  type PlatformAccount,
  type PlatformRole,
} from "../lib/api";
import { cn } from "../lib/utils";

type AdminModule = "usage" | "orders" | "accounts";

type PlatformAccountForm = {
  displayName: string;
  email: string;
  phone: string;
  platformRole: PlatformRole;
  newPassword: string;
  confirmPassword: string;
};

const roleLabels: Record<PlatformRole, string> = {
  guest: "游客",
  customer: "个人用户",
  ops_admin: "运营管理员",
  super_admin: "超级管理员",
};

function formatCredits(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString("zh-CN")} 积分`;
}

function formatMoney(value: number | null | undefined) {
  return `楼${Number(value || 0).toLocaleString("zh-CN")}`;
}

function formatTime(value?: string | null) {
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

function paymentMethodLabel(value: string) {
  if (value === "wechat_pay") return "微信支付";
  if (value === "alipay") return "支付宝";
  if (value === "bank_transfer") return "对公转账";
  return value;
}

function orderStatusLabel(order: AdminRechargeOrder) {
  if (order.reviewStatus === "submitted") return "待审核";
  if (order.reviewStatus === "approved") return "已审核";
  if (order.reviewStatus === "rejected") return "已拒绝";
  if (order.status === "paid") return "已支付";
  if (order.status === "failed") return "失败";
  if (order.status === "expired") return "已过期";
  if (order.status === "closed") return "已关闭";
  return "待支付";
}

function accountFormFrom(account: PlatformAccount): PlatformAccountForm {
  return {
    displayName: account.displayName || "",
    email: account.email || "",
    phone: account.phone || "",
    platformRole: account.platformRole || "customer",
    newPassword: "",
    confirmPassword: "",
  };
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

function UsageChart(props: { series: CreditUsageSeriesPoint[]; loading?: boolean }) {
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

function SubjectButton(props: { subject: CreditUsageSubject; active: boolean; onClick: () => void }) {
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

export default function SuperAdminConsole() {
  const navigate = useNavigate();
  const [me, setMe] = useState<PermissionContext | null>(null);
  const [module, setModule] = useState<AdminModule>("usage");
  const [loadingMe, setLoadingMe] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const [stats, setStats] = useState<CreditUsageStats | null>(null);
  const [subjects, setSubjects] = useState<CreditUsageSubject[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<CreditUsageSubject | null>(null);
  const [subjectSearch, setSubjectSearch] = useState("");
  const [usageRefreshKey, setUsageRefreshKey] = useState(0);
  const [loadingUsage, setLoadingUsage] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(false);

  const [orders, setOrders] = useState<AdminRechargeOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [reviewingOrderId, setReviewingOrderId] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const [accounts, setAccounts] = useState<PlatformAccount[]>([]);
  const [accountSearch, setAccountSearch] = useState("");
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [accountForms, setAccountForms] = useState<Record<string, PlatformAccountForm>>({});
  const [savingAccountId, setSavingAccountId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlatformAccount | null>(null);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(null);

  const isSuperAdmin = me?.platformRole === "super_admin" || me?.permissions.canManageSystem;
  const walletDescription = useMemo(() => {
    if (!stats?.wallets.length) return "暂无可统计钱包";
    if (stats.wallets.length === 1) return stats.wallets[0]?.displayName || stats.wallets[0]?.id || "钱包";
    return `${stats.wallets.length} 个钱包合计`;
  }, [stats]);
  const pendingOrders = useMemo(
    () => orders.filter((order) => order.paymentMethod === "bank_transfer" && order.status === "pending_review"),
    [orders],
  );

  useEffect(() => {
    let active = true;
    setLoadingMe(true);
    void getMe()
      .then((response) => {
        if (active) setMe(response);
      })
      .catch((error) => {
        if (active) setNotice(error instanceof Error ? error.message : "加载账号信息失败。");
      })
      .finally(() => {
        if (active) setLoadingMe(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoadingSubjects(true);
      void searchCreditUsageSubjects(subjectSearch)
        .then((response) => {
          if (!active) return;
          setSubjects(response.items);
          setSelectedSubject((current) => current || response.items[0] || null);
        })
        .catch((error) => {
          if (active) setNotice(error instanceof Error ? error.message : "加载统计对象失败。");
        })
        .finally(() => {
          if (active) setLoadingSubjects(false);
        });
    }, 200);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [isSuperAdmin, subjectSearch]);

  useEffect(() => {
    if (!isSuperAdmin) return;
    let active = true;
    setLoadingUsage(true);
    void getAdminCreditUsageStats({
      subjectType: selectedSubject?.type || "platform",
      subjectId: selectedSubject?.type === "platform" ? null : selectedSubject?.id || null,
    })
      .then((response) => {
        if (active) setStats(response);
      })
      .catch((error) => {
        if (active) setNotice(error instanceof Error ? error.message : "加载积分统计失败。");
      })
      .finally(() => {
        if (active) setLoadingUsage(false);
      });
    return () => {
      active = false;
    };
  }, [isSuperAdmin, selectedSubject, usageRefreshKey]);

  const loadOrders = async () => {
    if (!isSuperAdmin) return;
    setLoadingOrders(true);
    setNotice(null);
    try {
      const response = await listAdminOrders();
      setOrders(response.items);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "加载订单失败。");
    } finally {
      setLoadingOrders(false);
    }
  };

  const loadAccounts = async (query = accountSearch) => {
    if (!isSuperAdmin) return;
    setLoadingAccounts(true);
    setNotice(null);
    try {
      const response = await listPlatformAccounts(query);
      setAccounts(response.items);
      setAccountForms((current) => {
        const next = { ...current };
        for (const account of response.items) {
          next[account.userId] ??= accountFormFrom(account);
        }
        return next;
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "加载账号失败。");
    } finally {
      setLoadingAccounts(false);
    }
  };

  useEffect(() => {
    if (!isSuperAdmin) return;
    void loadOrders();
    void loadAccounts("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin]);

  const updateAccountForm = (account: PlatformAccount, patch: Partial<PlatformAccountForm>) => {
    setAccountForms((current) => ({
      ...current,
      [account.userId]: {
        ...(current[account.userId] ?? accountFormFrom(account)),
        ...patch,
      },
    }));
  };

  const handleSaveAccount = async (account: PlatformAccount) => {
    const form = accountForms[account.userId] ?? accountFormFrom(account);
    if (!form.displayName.trim()) {
      setNotice("请填写用户名。");
      return;
    }
    if (!form.email.trim()) {
      setNotice("请填写邮箱。");
      return;
    }
    if (form.newPassword.trim() && form.newPassword !== form.confirmPassword) {
      setNotice("两次输入的新密码不一致。");
      return;
    }

    setSavingAccountId(account.userId);
    setNotice(null);
    try {
      const updated = await updatePlatformAccount(account.userId, {
        displayName: form.displayName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        platformRole: form.platformRole,
        newPassword: form.newPassword.trim() || undefined,
      });
      setAccounts((current) => current.map((item) => (item.userId === updated.userId ? updated : item)));
      setAccountForms((current) => ({
        ...current,
        [updated.userId]: accountFormFrom(updated),
      }));
      setNotice(`已保存 ${updated.displayName || updated.userId} 的账号信息。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "保存账号失败。");
    } finally {
      setSavingAccountId(null);
    }
  };

  const handleDeleteAccount = async () => {
    if (!deleteTarget) return;
    setDeletingAccountId(deleteTarget.userId);
    setNotice(null);
    try {
      const deleted = await deletePlatformAccount(deleteTarget.userId);
      setAccounts((current) => current.map((item) => (item.userId === deleted.userId ? deleted : item)));
      setAccountForms((current) => {
        const next = { ...current };
        next[deleted.userId] = accountFormFrom(deleted);
        return next;
      });
      setNotice(`已删除 ${deleteTarget.displayName || deleteTarget.userId} 的账号。`);
      setDeleteTarget(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "删除账号失败。");
    } finally {
      setDeletingAccountId(null);
    }
  };

  const handleReview = async (orderId: string, decision: "approve" | "reject") => {
    setReviewingOrderId(orderId);
    setNotice(null);
    try {
      await reviewAdminOrder(orderId, { decision, note: reviewNotes[orderId] || undefined });
      await loadOrders();
      setNotice(decision === "approve" ? "订单已审核通过。" : "订单已拒绝。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "审核订单失败。");
    } finally {
      setReviewingOrderId(null);
    }
  };

  if (loadingMe) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <main className="flex-1 overflow-y-auto px-6 py-8 custom-scrollbar sm:px-8">
        <div className="mx-auto max-w-4xl rounded-lg border border-border/70 bg-card p-8">
          <ShieldX className="h-8 w-8 text-muted-foreground" />
          <h1 className="mt-4 text-2xl font-semibold text-foreground">管理平台不可用</h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            当前账号没有超级管理员权限，无法查看平台级积分、订单和账号管理。
          </p>
          <button
            type="button"
            onClick={() => navigate("/home")}
            className="mt-6 inline-flex min-h-10 items-center justify-center rounded-lg border border-border/70 bg-background px-4 text-sm font-medium text-foreground transition hover:bg-accent"
          >
            返回首页
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="h-full overflow-y-auto bg-background custom-scrollbar">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-5 py-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-border/70 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <ShieldCheck className="h-4 w-4" />
              <span>超级管理员</span>
            </div>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">管理平台</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {me?.actor.displayName || me?.actor.id}
            </p>
          </div>
          <div className="flex h-10 items-center rounded-lg border border-border/70 bg-background/40 p-1">
            {[
              ["usage", "积分统计"],
              ["orders", "订单审核"],
              ["accounts", "账号管理"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setModule(value as AdminModule)}
                className={cn(
                  "inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium transition",
                  module === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {notice ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/8 px-4 py-3 text-sm text-primary">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-primary/70 hover:text-primary">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : null}

        {module === "usage" ? (
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
                    onClick={() => setUsageRefreshKey((value) => value + 1)}
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
              <UsageChart series={stats?.series || []} loading={loadingUsage} />
            </section>
          </>
        ) : null}

        {module === "orders" ? (
          <section className="space-y-4">
            <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">订单审核</h2>
                <p className="mt-1 text-sm text-muted-foreground">待审核对公转账：{pendingOrders.length}</p>
              </div>
              <button
                type="button"
                onClick={() => void loadOrders()}
                className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-border/70 bg-background px-4 text-sm font-medium text-foreground transition hover:bg-accent"
              >
                <RefreshCw className={cn("h-4 w-4", loadingOrders && "animate-spin")} />
                刷新
              </button>
            </div>

            {orders.length ? (
              orders.map((order) => {
                const canReview =
                  order.paymentMethod === "bank_transfer" &&
                  order.status === "pending_review" &&
                  reviewingOrderId !== order.id;
                const isReviewing = reviewingOrderId === order.id;
                return (
                  <article key={order.id} className="rounded-lg border border-border/70 bg-card p-4">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-foreground">{order.planName}</h3>
                          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
                            {paymentMethodLabel(order.paymentMethod)}
                          </span>
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-1 text-xs",
                              order.status === "paid"
                                ? "bg-emerald-500/12 text-emerald-300"
                                : order.status === "pending_review"
                                  ? "bg-amber-500/12 text-amber-300"
                                  : "bg-secondary text-muted-foreground",
                            )}
                          >
                            {orderStatusLabel(order)}
                          </span>
                        </div>
                        <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2 xl:grid-cols-4">
                          <p>订单号：{order.id}</p>
                          <p>钱包：{order.wallet?.displayName || order.walletId || "--"}</p>
                          <p>金额：{formatMoney(order.amount)}</p>
                          <p>积分：{Number(order.credits || 0).toLocaleString("zh-CN")}</p>
                          <p>模式：{order.mode === "demo_mock" ? "演示 Mock" : "真实支付"}</p>
                          <p>场景：{order.scene || "--"}</p>
                          <p>创建时间：{formatTime(order.createdAt)}</p>
                          <p>支付时间：{formatTime(order.paidAt)}</p>
                        </div>
                        {order.voucherFiles?.length ? (
                          <div className="flex flex-wrap gap-2">
                            {order.voucherFiles.map((fileUrl) => (
                              <a
                                key={fileUrl}
                                href={fileUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-full border border-border/70 px-3 py-1 text-xs text-primary transition hover:border-primary/40"
                              >
                                查看凭证
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      {order.paymentMethod === "bank_transfer" ? (
                        <div className="w-full max-w-sm space-y-3 rounded-lg border border-border/70 bg-background/50 p-4">
                          <label className="block text-xs font-medium text-muted-foreground">
                            审核备注
                            <textarea
                              value={reviewNotes[order.id] || ""}
                              onChange={(event) =>
                                setReviewNotes((current) => ({
                                  ...current,
                                  [order.id]: event.target.value,
                                }))
                              }
                              rows={3}
                              className="mt-2 w-full rounded-lg border border-border/70 bg-background px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/40"
                              placeholder="可选"
                            />
                          </label>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={!canReview}
                              onClick={() => void handleReview(order.id, "approve")}
                              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isReviewing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                              通过
                            </button>
                            <button
                              type="button"
                              disabled={!canReview}
                              onClick={() => void handleReview(order.id, "reject")}
                              className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg border border-border/70 bg-background px-4 py-2.5 text-sm font-medium text-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <ShieldX className="h-4 w-4" />
                              拒绝
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="rounded-lg border border-dashed border-border/70 bg-card p-8 text-center text-sm text-muted-foreground">
                {loadingOrders ? "正在加载订单..." : "暂无订单。"}
              </div>
            )}
          </section>
        ) : null}

        {module === "accounts" ? (
          <section className="space-y-4">
            <div className="rounded-lg border border-border/70 bg-card p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-foreground">账号管理</h2>
                  <p className="mt-1 text-sm text-muted-foreground">可按用户名、userId、手机号、邮箱查询。</p>
                </div>
                <div className="flex w-full gap-2 lg:w-[520px]">
                  <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="search"
                      value={accountSearch}
                      onChange={(event) => setAccountSearch(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void loadAccounts();
                        }
                      }}
                      className="h-10 w-full rounded-lg border border-border/70 bg-background pl-9 pr-3 text-sm text-foreground outline-none transition focus:border-primary/35"
                      placeholder="用户名 / userId / 手机号 / 邮箱"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadAccounts()}
                    className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
                  >
                    {loadingAccounts ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "查询"}
                  </button>
                </div>
              </div>
            </div>

            {accounts.length ? (
              accounts.map((account) => {
                const form = accountForms[account.userId] ?? accountFormFrom(account);
                const disabled = Boolean(account.deleted) || account.status === "disabled" || account.accountStatus === "disabled";
                const isCurrentAdmin = account.userId === me?.actor.id;
                const isSaving = savingAccountId === account.userId;
                const isDeleting = deletingAccountId === account.userId;

                return (
                  <article key={account.userId} className="rounded-lg border border-border/70 bg-card p-4">
                    <div className="flex flex-col gap-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-base font-semibold text-foreground">
                              {disabled ? "已删除账号" : account.displayName || account.userId}
                            </h3>
                            <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
                              {account.userId}
                            </span>
                            <span
                              className={cn(
                                "rounded-full px-2.5 py-1 text-xs",
                                disabled ? "bg-rose-500/12 text-rose-300" : "bg-emerald-500/12 text-emerald-300",
                              )}
                            >
                              {disabled ? "已删除" : "可用"}
                            </span>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {disabled ? `删除时间：${formatTime(account.deletedAt)}` : roleLabels[account.platformRole]}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(account)}
                          disabled={disabled || isCurrentAdmin || isSaving || isDeleting}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 text-sm font-medium text-rose-200 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isDeleting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                          删除
                        </button>
                      </div>

                      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                        <input
                          value={form.displayName}
                          onChange={(event) => updateAccountForm(account, { displayName: event.target.value })}
                          disabled={disabled}
                          className="h-10 rounded-lg border border-border/70 bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary/35 disabled:opacity-60"
                          placeholder="用户名"
                        />
                        <input
                          value={form.email}
                          onChange={(event) => updateAccountForm(account, { email: event.target.value })}
                          disabled={disabled}
                          className="h-10 rounded-lg border border-border/70 bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary/35 disabled:opacity-60"
                          placeholder="邮箱"
                        />
                        <input
                          value={form.phone}
                          onChange={(event) => updateAccountForm(account, { phone: event.target.value })}
                          disabled={disabled}
                          className="h-10 rounded-lg border border-border/70 bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary/35 disabled:opacity-60"
                          placeholder="手机号"
                        />
                        <select
                          value={form.platformRole}
                          onChange={(event) => updateAccountForm(account, { platformRole: event.target.value as PlatformRole })}
                          disabled={disabled}
                          className="h-10 rounded-lg border border-border/70 bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary/35 disabled:opacity-60"
                        >
                          {(["customer", "ops_admin", "super_admin"] as PlatformRole[]).map((role) => (
                            <option key={role} value={role}>
                              {roleLabels[role]}
                            </option>
                          ))}
                        </select>
                        <div className="relative xl:col-span-2">
                          <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <input
                            type="password"
                            value={form.newPassword}
                            onChange={(event) => updateAccountForm(account, { newPassword: event.target.value })}
                            disabled={disabled}
                            className="h-10 w-full rounded-lg border border-border/70 bg-background pl-9 pr-3 text-sm text-foreground outline-none transition focus:border-primary/35 disabled:opacity-60"
                            placeholder="新密码（不填则不修改）"
                          />
                        </div>
                        <input
                          type="password"
                          value={form.confirmPassword}
                          onChange={(event) => updateAccountForm(account, { confirmPassword: event.target.value })}
                          disabled={disabled}
                          className="h-10 rounded-lg border border-border/70 bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary/35 disabled:opacity-60"
                          placeholder="确认新密码"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSaveAccount(account)}
                          disabled={disabled || isSaving || isDeleting}
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                          保存
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })
            ) : (
              <div className="rounded-lg border border-dashed border-border/70 bg-card p-8 text-center text-sm text-muted-foreground">
                {loadingAccounts ? "正在加载账号..." : "暂无匹配账号。"}
              </div>
            )}
          </section>
        ) : null}
      </div>

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-lg border border-border/70 bg-card p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">确认删除账号</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  删除后会禁用账号、清空邮箱和手机号绑定，并释放这些唯一字段。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 rounded-lg border border-border/70 bg-background px-3 py-3 text-sm text-foreground">
              <p>{deleteTarget.displayName || "未命名账号"}</p>
              <p className="mt-1 text-xs text-muted-foreground">{deleteTarget.userId}</p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={Boolean(deletingAccountId)}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-border/70 bg-background px-4 text-sm font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteAccount()}
                disabled={Boolean(deletingAccountId)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-medium text-white transition hover:bg-rose-500 disabled:opacity-50"
              >
                {deletingAccountId ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
