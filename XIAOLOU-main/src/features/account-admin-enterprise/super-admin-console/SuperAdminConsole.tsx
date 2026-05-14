import {
  LoaderCircle,
  ShieldCheck,
  ShieldX,
  Trash2,
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
  type CreditUsageStats,
  type CreditUsageSubject,
  type PermissionContext,
  type PlatformAccount,
  type PlatformRole,
} from "./api/super-admin-console";
import { AdminOrdersPanel } from "./AdminOrdersPanel";
import { PlatformAccountsPanel, type PlatformAccountForm } from "./PlatformAccountsPanel";
import { PlatformBillingPanel } from "./PlatformBillingPanel";
import { UsageOverviewPanel } from "./UsageOverviewPanel";
import { cn } from "../../../lib/utils";

type AdminModule = "usage" | "billing" | "orders" | "accounts";

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

function ledgerEntryLabel(entry: CreditUsageStats["recentEntries"][number]) {
  const labelMap: Record<string, string> = {
    recharge: "充值入账",
    grant: "额度发放",
    freeze: "任务冻结",
    settle: "任务结算",
    refund: "积分退回",
  };
  return labelMap[entry.entryType] || entry.entryType.replace(/_/g, " ");
}

function ledgerReference(entry: CreditUsageStats["recentEntries"][number]) {
  if (entry.orderId) return `订单 ${entry.orderId}`;
  if (entry.projectId) return `项目 ${entry.projectId}`;
  if (entry.sourceId) return `${entry.sourceType || "来源"} ${entry.sourceId}`;
  return entry.sourceType || "--";
}

function formatSignedCredits(value: number) {
  return `${value > 0 ? "+" : ""}${formatCredits(value)}`;
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
  const billingEntries = stats?.recentEntries ?? [];
  const billingTotals = useMemo(
    () =>
      billingEntries.reduce(
        (summary, entry) => {
          if (entry.amount > 0) summary.income += entry.amount;
          if (entry.amount < 0) summary.expense += Math.abs(entry.amount);
          return summary;
        },
        { income: 0, expense: 0 },
      ),
    [billingEntries],
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
            当前账号没有超级管理员权限，无法查看平台级积分、账单、订单和账号管理。
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
          <div className="flex min-h-10 flex-wrap items-center rounded-lg border border-border/70 bg-background/40 p-1">
            {[
              ["usage", "积分统计"],
              ["billing", "账单与流水"],
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
          <UsageOverviewPanel
            stats={stats}
            subjects={subjects}
            selectedSubject={selectedSubject}
            setSelectedSubject={setSelectedSubject}
            subjectSearch={subjectSearch}
            setSubjectSearch={setSubjectSearch}
            loadingUsage={loadingUsage}
            loadingSubjects={loadingSubjects}
            walletDescription={walletDescription}
            onRefreshUsage={() => setUsageRefreshKey((value) => value + 1)}
            formatCredits={formatCredits}
          />
        ) : null}

        {module === "billing" ? (
          <PlatformBillingPanel
            stats={stats}
            subjects={subjects}
            selectedSubject={selectedSubject}
            setSelectedSubject={setSelectedSubject}
            subjectSearch={subjectSearch}
            setSubjectSearch={setSubjectSearch}
            loadingUsage={loadingUsage}
            loadingSubjects={loadingSubjects}
            walletDescription={walletDescription}
            billingEntries={billingEntries}
            billingTotals={billingTotals}
            onRefreshUsage={() => setUsageRefreshKey((value) => value + 1)}
            formatCredits={formatCredits}
            formatTime={formatTime}
            formatSignedCredits={formatSignedCredits}
            ledgerEntryLabel={ledgerEntryLabel}
            ledgerReference={ledgerReference}
          />
        ) : null}

        {module === "orders" ? (
          <AdminOrdersPanel
            orders={orders}
            pendingOrdersCount={pendingOrders.length}
            loadingOrders={loadingOrders}
            reviewingOrderId={reviewingOrderId}
            reviewNotes={reviewNotes}
            setReviewNotes={setReviewNotes}
            onLoadOrders={loadOrders}
            onReview={handleReview}
            paymentMethodLabel={paymentMethodLabel}
            orderStatusLabel={orderStatusLabel}
            formatMoney={formatMoney}
            formatTime={formatTime}
          />
        ) : null}

        {module === "accounts" ? (
          <PlatformAccountsPanel
            accounts={accounts}
            accountSearch={accountSearch}
            setAccountSearch={setAccountSearch}
            loadingAccounts={loadingAccounts}
            accountForms={accountForms}
            currentActorId={me?.actor.id}
            savingAccountId={savingAccountId}
            deletingAccountId={deletingAccountId}
            roleLabels={roleLabels}
            setDeleteTarget={setDeleteTarget}
            onLoadAccounts={() => loadAccounts()}
            getAccountForm={accountFormFrom}
            updateAccountForm={updateAccountForm}
            onSaveAccount={handleSaveAccount}
            formatTime={formatTime}
          />
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
