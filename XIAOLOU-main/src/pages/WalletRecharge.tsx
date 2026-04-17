import { ArrowLeft, ArrowRight, Check, ChevronDown, CreditCard, QrCode, ShieldCheck, Sparkles, Wallet, Zap } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  confirmWalletRechargeOrder,
  createWalletRechargeOrder,
  getMe,
  listWalletLedger,
  listWallets,
  type PermissionContext,
  type Wallet as WalletInfo,
  type WalletLedgerEntry,
  type WalletRechargeOrder,
} from "../lib/api";
import { cn } from "../lib/utils";

type BillingCycle = "monthly" | "annual" | "oneTime";
type PaymentMethod = "wechat_pay" | "alipay" | "bank_transfer";
type Plan = {
  id: string;
  name: string;
  badge?: string;
  recommended?: boolean;
  price: Record<BillingCycle, number>;
  credits: Record<BillingCycle, number>;
  features: string[];
};

const BILLING_OPTIONS = [
  { id: "monthly" as const, label: "月付" },
  { id: "annual" as const, label: "年付", tag: "省25%" },
  { id: "oneTime" as const, label: "积分包" },
];

const PAYMENT_METHODS: Array<{ id: PaymentMethod; label: string; detail: string; available: boolean }> = [
  { id: "wechat_pay", label: "微信支付", detail: "扫码支付", available: true },
  { id: "alipay", label: "支付宝", detail: "即将接入", available: false },
  { id: "bank_transfer", label: "对公转账", detail: "企业采购", available: false },
];

const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    badge: "入门",
    price: { monthly: 39, annual: 29, oneTime: 59 },
    credits: { monthly: 800, annual: 9600, oneTime: 900 },
    features: ["无水印导出", "标准队列", "基础出图"],
  },
  {
    id: "creator",
    name: "Creator",
    badge: "常用",
    price: { monthly: 89, annual: 67, oneTime: 129 },
    credits: { monthly: 2500, annual: 30000, oneTime: 2800 },
    features: ["优先队列", "批量分镜", "失败退回"],
  },
  {
    id: "studio",
    name: "Studio",
    badge: "推荐",
    recommended: true,
    price: { monthly: 189, annual: 142, oneTime: 269 },
    credits: { monthly: 7500, annual: 90000, oneTime: 8500 },
    features: ["高优先级", "多项目并行", "工具箱直连"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    badge: "企业",
    price: { monthly: 499, annual: 374, oneTime: 699 },
    credits: { monthly: 25000, annual: 300000, oneTime: 30000 },
    features: ["团队协作", "企业资产库", "专属支持"],
  },
];

const FAQS = [
  ["现在是正式微信支付吗？", "当前是可走通的 mock 支付链路，后续只需要替换商户接口即可。"],
  ["积分包会过期吗？", "不会。积分包适合冲刺期和临时加量，购买后永久有效。"],
  ["失败任务会退积分吗？", "会。任务已支持冻结、结算和失败退款机制。"],
];

function formatCurrency(value: number) {
  return `¥${value.toLocaleString("zh-CN")}`;
}

function formatCredits(value: number | null | undefined, unlimited?: boolean) {
  if (unlimited) return "无限";
  if (typeof value !== "number") return "--";
  return `${value.toLocaleString("zh-CN")} 积分`;
}

function formatRole(me: PermissionContext | null) {
  if (!me) return "--";
  if (me.currentOrganizationRole === "enterprise_admin") return "企业管理员";
  if (me.currentOrganizationRole === "enterprise_member") return "企业成员";
  if (me.platformRole === "ops_admin") return "运营管理员";
  if (me.platformRole === "super_admin") return "超级管理员";
  return "注册用户";
}

function formatLedger(entry: WalletLedgerEntry) {
  const labelMap: Record<string, string> = {
    recharge: "充值入账",
    freeze: "任务冻结",
    settle: "任务结算",
    refund: "积分退回",
  };
  return labelMap[entry.entryType] || entry.entryType;
}

function buildQrPattern(seed: string) {
  return Array.from({ length: 169 }, (_, index) => {
    const row = Math.floor(index / 13);
    const col = index % 13;
    if ((row < 5 && col < 5) || (row < 5 && col > 7) || (row > 7 && col < 5)) {
      return row % 4 === 0 || col % 4 === 0 || (row % 4 === 2 && col % 4 === 2);
    }
    const code = seed.charCodeAt(index % seed.length) || 87;
    return (code + row * 11 + col * 7) % 3 !== 0;
  });
}

function resolveVisibleWallets(wallets: WalletInfo[], me: PermissionContext | null) {
  if (!me || !wallets.length) return wallets;
  const isEnterprise = me.currentOrganizationRole === "enterprise_admin" || me.currentOrganizationRole === "enterprise_member";
  if (isEnterprise) {
    const orgWallets = wallets.filter((w) => w.ownerType === "organization");
    return orgWallets.length ? orgWallets : wallets;
  }
  return wallets.filter((w) => w.ownerType !== "organization");
}

export default function WalletRecharge() {
  const navigate = useNavigate();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("annual");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("wechat_pay");
  const [selectedPlanId, setSelectedPlanId] = useState("studio");
  const [me, setMe] = useState<PermissionContext | null>(null);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);
  const [currentOrder, setCurrentOrder] = useState<WalletRechargeOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedPlan = useMemo(() => PLANS.find((p) => p.id === selectedPlanId) ?? PLANS[0], [selectedPlanId]);
  const visibleWallets = useMemo(() => resolveVisibleWallets(wallets, me), [wallets, me]);
  const selectedWallet = useMemo(
    () => visibleWallets.find((w) => w.id === selectedWalletId) ?? visibleWallets[0] ?? null,
    [visibleWallets, selectedWalletId],
  );
  const qrPattern = useMemo(() => buildQrPattern(currentOrder?.id || "wechat"), [currentOrder]);

  const loadContext = async () => {
    setLoading(true);
    try {
      const [meRes, walletsRes] = await Promise.all([getMe(), listWallets()]);
      setMe(meRes);
      setWallets(walletsRes.items);
      const visible = resolveVisibleWallets(walletsRes.items, meRes);
      setSelectedWalletId((current) => (visible.some((w) => w.id === current) ? current : visible[0]?.id ?? null));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadContext();
  }, []);

  useEffect(() => {
    setCurrentOrder(null);
    setNotice(null);
  }, [billingCycle, paymentMethod, selectedPlanId, selectedWalletId]);

  useEffect(() => {
    if (selectedWallet?.id) {
      void listWalletLedger(selectedWallet.id).then((res) => setLedger(res.items.slice(0, 5)));
    }
  }, [selectedWallet?.id]);

  const handleCreateOrder = async () => {
    if (!selectedWallet?.id) return setNotice("当前身份下没有可充值的钱包。");
    if (paymentMethod !== "wechat_pay") return setNotice("当前只开放微信支付。");
    setCreating(true);
    setNotice(null);
    try {
      setCurrentOrder(
        await createWalletRechargeOrder({
          planId: selectedPlan.id,
          planName: selectedPlan.name,
          billingCycle,
          paymentMethod,
          amount: selectedPlan.price[billingCycle],
          credits: selectedPlan.credits[billingCycle],
          walletId: selectedWallet.id,
        }),
      );
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建订单失败。");
    } finally {
      setCreating(false);
    }
  };

  const handleConfirm = async () => {
    if (!currentOrder) return;
    setConfirming(true);
    setNotice(null);
    try {
      const paid = await confirmWalletRechargeOrder(currentOrder.id);
      setCurrentOrder(paid);
      await loadContext();
      if (paid.walletId) {
        const ledgerRes = await listWalletLedger(paid.walletId);
        setLedger(ledgerRes.items.slice(0, 5));
      }
      setNotice("支付已模拟完成，积分已入账。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "确认支付失败。");
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 custom-scrollbar sm:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Header */}
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate("/home")}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-border/70 bg-background/50 text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">积分充值</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                选择适合你的方案，积分到账后即可用于创作任务。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/40 p-1">
            {BILLING_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setBillingCycle(opt.id)}
                className={cn(
                  "relative rounded-lg px-4 py-2 text-sm font-medium transition",
                  billingCycle === opt.id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt.label}
                {"tag" in opt && opt.tag ? (
                  <span className="absolute -right-1 -top-2 rounded-full bg-indigo-500 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                    {opt.tag}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

        {/* Plan Cards */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan) => {
            const isSelected = selectedPlanId === plan.id;
            return (
              <button
                key={plan.id}
                type="button"
                onClick={() => setSelectedPlanId(plan.id)}
                className={cn(
                  "relative rounded-2xl border p-6 text-left transition-all duration-200",
                  isSelected
                    ? "border-primary/50 bg-primary/5 shadow-[0_0_24px_-6px] shadow-primary/20"
                    : "border-border/70 bg-card/50 hover:border-primary/25 hover:bg-card/80",
                )}
              >
                {plan.recommended ? (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground shadow-sm">
                    推荐
                  </div>
                ) : null}

                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
                  {plan.badge && !plan.recommended ? (
                    <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                      {plan.badge}
                    </span>
                  ) : null}
                </div>

                <div className="mt-5">
                  <span className="text-3xl font-bold tracking-tight text-foreground">
                    {formatCurrency(plan.price[billingCycle])}
                  </span>
                  <span className="ml-1 text-sm text-muted-foreground">
                    {billingCycle === "annual" ? "/月" : billingCycle === "monthly" ? "/月" : ""}
                  </span>
                </div>

                <div className="mt-2 flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                  <span className="text-sm font-medium text-primary">
                    {plan.credits[billingCycle].toLocaleString("zh-CN")} 积分
                  </span>
                </div>

                <ul className="mt-5 space-y-2.5">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Check
                        className={cn(
                          "h-4 w-4 shrink-0",
                          isSelected ? "text-primary" : "text-muted-foreground/50",
                        )}
                      />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <div
                  className={cn(
                    "mt-6 flex h-10 items-center justify-center rounded-xl text-sm font-medium transition",
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-secondary-foreground",
                  )}
                >
                  {isSelected ? "已选择" : "选择方案"}
                </div>
              </button>
            );
          })}
        </div>

        {/* Checkout + Wallet */}
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-6">
            {/* Wallet & Payment */}
            <div className="glass-panel rounded-2xl p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
                  <Wallet className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-foreground">充值钱包</h3>
                  <p className="text-xs text-muted-foreground">
                    {loading ? "加载中..." : `${formatRole(me)} · ${visibleWallets.length} 个可用钱包`}
                  </p>
                </div>
              </div>

              {visibleWallets.length > 0 ? (
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {visibleWallets.map((wallet) => (
                    <button
                      key={wallet.id}
                      type="button"
                      onClick={() => setSelectedWalletId(wallet.id ?? null)}
                      className={cn(
                        "rounded-xl border px-4 py-3.5 text-left transition-all",
                        selectedWallet?.id === wallet.id
                          ? "border-primary/40 bg-primary/8 shadow-sm"
                          : "border-border/60 bg-background/30 hover:border-primary/20 hover:bg-background/50",
                      )}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">{wallet.displayName || "钱包"}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            可用 {formatCredits(wallet.creditsAvailable, wallet.unlimitedCredits)}
                          </p>
                        </div>
                        {selectedWallet?.id === wallet.id ? (
                          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary">
                            <Check className="h-3.5 w-3.5 text-primary-foreground" />
                          </div>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-5 rounded-xl border border-dashed border-border/60 bg-background/20 p-4 text-sm text-muted-foreground">
                  当前身份下没有可充值的钱包。
                </div>
              )}

              <div className="mt-6">
                <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">支付方式</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {PAYMENT_METHODS.map((method) => (
                    <button
                      key={method.id}
                      type="button"
                      disabled={!method.available}
                      onClick={() => setPaymentMethod(method.id)}
                      className={cn(
                        "rounded-xl border px-4 py-3 text-left transition-all",
                        paymentMethod === method.id
                          ? "border-primary/40 bg-primary/8"
                          : "border-border/60 bg-background/30",
                        !method.available && "cursor-not-allowed opacity-50",
                      )}
                    >
                      <p className="text-sm font-medium text-foreground">{method.label}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{method.detail}</p>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Recent Ledger */}
            <div className="glass-panel rounded-2xl p-6">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">最近流水</p>
              <div className="mt-4 space-y-2">
                {ledger.length ? (
                  ledger.map((entry) => (
                    <div
                      key={entry.id}
                      className="flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-background/30 px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{formatLedger(entry)}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {new Date(entry.createdAt).toLocaleString("zh-CN", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {" · "}余额 {entry.balanceAfter.toLocaleString("zh-CN")}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "text-sm font-semibold tabular-nums",
                          entry.amount >= 0 ? "text-indigo-300" : "text-foreground",
                        )}
                      >
                        {entry.amount > 0 ? "+" : ""}
                        {entry.amount.toLocaleString("zh-CN")}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-border/50 bg-background/20 px-4 py-6 text-center text-sm text-muted-foreground">
                    当前钱包还没有流水记录。
                  </div>
                )}
              </div>
            </div>

            {/* FAQ */}
            <div className="glass-panel rounded-2xl p-6">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">常见问题</p>
              <div className="mt-4 space-y-2">
                {FAQS.map(([question, answer]) => (
                  <details
                    key={question}
                    className="group rounded-xl border border-border/50 bg-background/30 px-4 py-3.5"
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-foreground">
                      {question}
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition group-open:rotate-180" />
                    </summary>
                    <p className="mt-3 border-t border-border/40 pt-3 text-sm leading-relaxed text-muted-foreground">
                      {answer}
                    </p>
                  </details>
                ))}
              </div>
            </div>
          </div>

          {/* Order Sidebar */}
          <div className="xl:sticky xl:top-8 xl:self-start">
            <div className="glass-panel rounded-2xl p-6">
              <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">订单摘要</p>

              <div className="mt-5 rounded-xl border border-primary/25 bg-primary/8 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xl font-bold text-foreground">{selectedPlan.name}</h3>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {billingCycle === "monthly" ? "月付" : billingCycle === "annual" ? "年付" : "积分包"}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-foreground">
                      {formatCurrency(selectedPlan.price[billingCycle])}
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-primary/12 px-3 py-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span className="text-sm font-medium text-primary">
                    {selectedPlan.credits[billingCycle].toLocaleString("zh-CN")} 积分到账
                  </span>
                </div>
              </div>

              <div className="mt-5 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">当前身份</span>
                  <span className="font-medium text-foreground">{loading ? "..." : formatRole(me)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">充值钱包</span>
                  <span className="font-medium text-foreground">
                    {loading ? "..." : selectedWallet?.displayName || "--"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">当前余额</span>
                  <span className="font-medium text-foreground">
                    {loading
                      ? "..."
                      : formatCredits(selectedWallet?.creditsAvailable, selectedWallet?.unlimitedCredits)}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">冻结积分</span>
                  <span className="font-medium text-foreground">
                    {loading
                      ? "..."
                      : selectedWallet?.unlimitedCredits
                        ? "—"
                        : formatCredits(selectedWallet?.creditsFrozen)}
                  </span>
                </div>
              </div>

              {currentOrder ? (
                <div className="mt-6 rounded-xl border border-indigo-500/25 bg-indigo-500/8 p-5">
                  <div className="flex items-center gap-2">
                    <QrCode className="h-4 w-4 text-indigo-300" />
                    <p className="text-sm font-medium text-foreground">微信支付</p>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    订单 {currentOrder.id} · {currentOrder.status === "paid" ? "已支付" : "待支付"}
                  </p>
                  <div className="mt-4 flex justify-center">
                    <div className="grid grid-cols-[repeat(13,minmax(0,1fr))] gap-[3px] rounded-xl bg-white p-3 shadow-sm">
                      {qrPattern.map((active, index) => (
                        <div
                          key={index}
                          className={cn("h-2.5 w-2.5 rounded-[2px]", active ? "bg-black" : "bg-white")}
                        />
                      ))}
                    </div>
                  </div>
                  <p className="mt-3 text-center text-xs leading-5 text-muted-foreground">
                    使用微信扫一扫完成支付
                  </p>
                  <button
                    type="button"
                    onClick={() => void handleConfirm()}
                    disabled={confirming || currentOrder.status === "paid"}
                    className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
                  >
                    <CreditCard className="h-4 w-4" />
                    {currentOrder.status === "paid"
                      ? "支付已确认"
                      : confirming
                        ? "确认中..."
                        : "我已完成支付"}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => void handleCreateOrder()}
                  disabled={creating || !selectedWallet}
                  className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-foreground shadow-sm transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <ArrowRight className="h-4 w-4" />
                  {creating ? "生成订单中..." : "生成支付订单"}
                </button>
              )}

              {notice ? (
                <div className="mt-4 rounded-xl border border-primary/20 bg-primary/8 px-4 py-3 text-sm leading-relaxed text-primary">
                  {notice}
                </div>
              ) : null}

              <div className="mt-5 grid grid-cols-3 gap-3">
                <div className="rounded-lg border border-border/40 bg-background/30 p-3 text-center">
                  <Sparkles className="mx-auto h-4 w-4 text-primary" />
                  <p className="mt-2 text-[11px] leading-tight text-muted-foreground">即时到账</p>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/30 p-3 text-center">
                  <ShieldCheck className="mx-auto h-4 w-4 text-primary" />
                  <p className="mt-2 text-[11px] leading-tight text-muted-foreground">失败退回</p>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/30 p-3 text-center">
                  <Zap className="mx-auto h-4 w-4 text-primary" />
                  <p className="mt-2 text-[11px] leading-tight text-muted-foreground">永不过期</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
