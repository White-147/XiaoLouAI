import { ArrowLeft, Building2, CheckCircle2, CreditCard, LoaderCircle, LogIn, ShieldX } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getMe,
  listAdminOrders,
  reviewAdminOrder,
  type AdminRechargeOrder,
  type PermissionContext,
} from "../lib/api";
import { cn } from "../lib/utils";

function formatMoney(value: number) {
  return `¥${Number(value || 0).toLocaleString("zh-CN")}`;
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

function statusLabel(order: AdminRechargeOrder) {
  if (order.reviewStatus === "submitted") return "待审核";
  if (order.reviewStatus === "approved") return "已审核";
  if (order.reviewStatus === "rejected") return "已拒绝";
  if (order.status === "paid") return "已支付";
  if (order.status === "failed") return "失败";
  if (order.status === "expired") return "已过期";
  if (order.status === "closed") return "已关闭";
  return "待支付";
}

export default function AdminOrders() {
  const navigate = useNavigate();
  const [me, setMe] = useState<PermissionContext | null>(null);
  const [orders, setOrders] = useState<AdminRechargeOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [reviewingOrderId, setReviewingOrderId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});

  const loadOrders = async () => {
    setLoading(true);
    try {
      const [meResponse, orderResponse] = await Promise.all([getMe(), listAdminOrders()]);
      setMe(meResponse);
      setOrders(orderResponse.items);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "加载订单失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadOrders();
  }, []);

  const pendingBankTransfers = useMemo(
    () =>
      orders.filter(
        (order) => order.paymentMethod === "bank_transfer" && order.status === "pending_review",
      ),
    [orders],
  );

  const handleReview = async (orderId: string, decision: "approve" | "reject") => {
    setReviewingOrderId(orderId);
    setNotice(null);
    try {
      await reviewAdminOrder(orderId, {
        decision,
        note: reviewNotes[orderId] || undefined,
      });
      await loadOrders();
      setNotice(decision === "approve" ? "已审核通过并入账" : "已拒绝该对公转账订单");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "审核失败");
    } finally {
      setReviewingOrderId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!me?.permissions.canManageOps && !me?.permissions.canManageSystem) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-8 custom-scrollbar sm:px-8">
        <div className="mx-auto max-w-4xl rounded-[32px] border border-border/70 bg-card/55 p-8">
          <h1 className="text-2xl font-semibold text-foreground">订单审核</h1>
          <p className="mt-3 text-sm leading-7 text-muted-foreground">
            当前账号没有平台审核权限，无法查看或处理充值订单。
          </p>
          <button
            type="button"
            onClick={() => navigate("/admin/login", { state: { from: "/admin/orders" } })}
            className="mt-6 inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
          >
            <LogIn className="h-4 w-4" />
            管理员登录
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 custom-scrollbar sm:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate("/home")}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-background/50 text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">订单审核</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                处理对公转账凭证，并查看钱包充值订单状态。
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">
            待审核对公转账：{pendingBankTransfers.length}
          </div>
        </div>

        {notice ? (
          <div className="rounded-2xl border border-primary/20 bg-primary/8 px-4 py-3 text-sm text-primary">
            {notice}
          </div>
        ) : null}

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-3xl border border-border/70 bg-card/55 p-6">
            <div className="flex items-center gap-3">
              <Building2 className="h-5 w-5 text-primary" />
              <div>
                <h2 className="text-base font-semibold text-foreground">待审核订单</h2>
                <p className="text-xs text-muted-foreground">仅显示对公转账且已提交凭证的订单</p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {pendingBankTransfers.length ? (
                pendingBankTransfers.map((order) => (
                  <div key={order.id} className="rounded-2xl border border-border/70 bg-background/35 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-foreground">{order.planName}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {order.wallet?.displayName || order.walletId}
                        </p>
                      </div>
                      <span className="rounded-full bg-amber-500/12 px-2.5 py-1 text-xs text-amber-300">
                        待审核
                      </span>
                    </div>

                    <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                      <p>订单号：{order.id}</p>
                      <p>金额：{formatMoney(order.amount)}</p>
                      <p>凭证：{order.voucherFiles?.length || 0} 个</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
                  当前没有待审核的对公转账订单。
                </div>
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-border/70 bg-card/55 p-6 lg:col-span-2">
            <div className="flex items-center gap-3">
              <CreditCard className="h-5 w-5 text-primary" />
              <div>
                <h2 className="text-base font-semibold text-foreground">充值订单列表</h2>
                <p className="text-xs text-muted-foreground">按支付方式、状态和凭证信息查看订单详情</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              {orders.map((order) => {
                const canReview =
                  order.paymentMethod === "bank_transfer" &&
                  order.status === "pending_review" &&
                  reviewingOrderId !== order.id;
                const isReviewing = reviewingOrderId === order.id;

                return (
                  <article
                    key={order.id}
                    className="rounded-3xl border border-border/70 bg-background/35 p-5"
                  >
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                      <div className="space-y-2">
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
                            {statusLabel(order)}
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

                        {order.failureReason ? (
                          <p className="rounded-2xl border border-rose-500/20 bg-rose-500/8 px-3 py-2 text-xs text-rose-200">
                            {order.failureReason}
                          </p>
                        ) : null}

                        {order.voucherFiles?.length ? (
                          <div className="flex flex-wrap gap-2 pt-1">
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
                        <div className="w-full max-w-sm space-y-3 rounded-2xl border border-border/70 bg-card/50 p-4">
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
                              className="mt-2 w-full rounded-2xl border border-border/70 bg-background/60 px-3 py-2 text-sm text-foreground outline-none transition focus:border-primary/40"
                              placeholder="可选：填写审核意见或拒绝原因"
                            />
                          </label>

                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={!canReview}
                              onClick={() => void handleReview(order.id, "approve")}
                              className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              {isReviewing ? (
                                <LoaderCircle className="h-4 w-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-4 w-4" />
                              )}
                              审核通过
                            </button>
                            <button
                              type="button"
                              disabled={!canReview}
                              onClick={() => void handleReview(order.id, "reject")}
                              className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-border/70 bg-background/60 px-4 py-2.5 text-sm font-medium text-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
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
              })}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
