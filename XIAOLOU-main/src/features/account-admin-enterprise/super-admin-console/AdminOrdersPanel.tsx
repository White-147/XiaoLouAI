import { CheckCircle2, LoaderCircle, RefreshCw, ShieldX } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { AdminRechargeOrder } from "./api/super-admin-console";
import { cn } from "../../../lib/utils";

type AdminOrdersPanelProps = {
  orders: AdminRechargeOrder[];
  pendingOrdersCount: number;
  loadingOrders: boolean;
  reviewingOrderId: string | null;
  reviewNotes: Record<string, string>;
  setReviewNotes: Dispatch<SetStateAction<Record<string, string>>>;
  onLoadOrders: () => void | Promise<void>;
  onReview: (orderId: string, decision: "approve" | "reject") => void | Promise<void>;
  paymentMethodLabel: (value: string) => string;
  orderStatusLabel: (order: AdminRechargeOrder) => string;
  formatMoney: (value: number | null | undefined) => string;
  formatTime: (value?: string | null) => string;
};

export function AdminOrdersPanel({
  orders,
  pendingOrdersCount,
  loadingOrders,
  reviewingOrderId,
  reviewNotes,
  setReviewNotes,
  onLoadOrders,
  onReview,
  paymentMethodLabel,
  orderStatusLabel,
  formatMoney,
  formatTime,
}: AdminOrdersPanelProps) {
  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border border-border/70 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">订单审核</h2>
          <p className="mt-1 text-sm text-muted-foreground">待审核对公转账：{pendingOrdersCount}</p>
        </div>
        <button
          type="button"
          onClick={() => void onLoadOrders()}
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
                        onClick={() => void onReview(order.id, "approve")}
                        className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isReviewing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                        通过
                      </button>
                      <button
                        type="button"
                        disabled={!canReview}
                        onClick={() => void onReview(order.id, "reject")}
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
  );
}
