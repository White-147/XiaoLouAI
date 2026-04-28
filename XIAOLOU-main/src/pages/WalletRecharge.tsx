import {
  ArrowLeft,
  Check,
  CreditCard,
  LoaderCircle,
  QrCode,
  RefreshCw,
  Upload,
  Wallet,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  API_BASE_URL,
  confirmWalletRechargeOrder,
  createWalletRechargeOrder,
  getMe,
  getWalletRechargeCapabilities,
  getWalletRechargeOrder,
  listWalletLedger,
  listWallets,
  refreshWalletRechargeOrderStatus,
  submitWalletRechargeTransferProof,
  uploadFile,
  type PermissionContext,
  type UploadedFile,
  type Wallet as WalletInfo,
  type WalletLedgerEntry,
  type WalletRechargeCapabilities,
  type WalletRechargeMethodCapability,
  type WalletRechargeMode,
  type WalletRechargeOrder,
  type WalletRechargePaymentMethod,
  type WalletRechargeScene,
} from "../lib/api";
import { cn } from "../lib/utils";

type BillingCycle = "monthly" | "annual" | "oneTime";
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
  { id: "annual" as const, label: "年付", tag: "省 25%" },
  { id: "oneTime" as const, label: "积分包" },
];

const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    badge: "入门",
    price: { monthly: 39, annual: 29, oneTime: 59 },
    credits: { monthly: 78, annual: 58, oneTime: 118 },
    features: ["标准队列", "基础出图", "适合单人尝试"],
  },
  {
    id: "creator",
    name: "Creator",
    badge: "常用",
    price: { monthly: 89, annual: 67, oneTime: 129 },
    credits: { monthly: 178, annual: 134, oneTime: 258 },
    features: ["优先队列", "批量分镜", "失败返还"],
  },
  {
    id: "studio",
    name: "Studio",
    badge: "推荐",
    recommended: true,
    price: { monthly: 189, annual: 142, oneTime: 269 },
    credits: { monthly: 378, annual: 284, oneTime: 538 },
    features: ["高优先级", "多项目并行", "工具箱直连"],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    badge: "企业",
    price: { monthly: 499, annual: 374, oneTime: 699 },
    credits: { monthly: 998, annual: 748, oneTime: 1398 },
    features: ["团队协作", "企业资产库", "专属支持"],
  },
];

const FAQS = [
  ["真实支付已经接通了吗？", "页面已经支持真实微信、支付宝和对公转账能力；若商户凭证还未配置，页面会显示“待配置”。"],
  ["为什么还保留演示支付？", "演示支付面向所有访问者展示，方便微信和支付宝在未配置商户凭证时也能走通 mock 充值链路。"],
  ["对公转账怎么入账？", "企业财务转账后上传凭证，平台运营审核通过后再执行一次且仅一次的钱包入账。"],
];

function formatCurrency(value: number) {
  return `¥${Number(value || 0).toLocaleString("zh-CN")}`;
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

function paymentMethodLabel(value: WalletRechargePaymentMethod | string) {
  if (value === "wechat_pay") return "微信支付";
  if (value === "alipay") return "支付宝";
  if (value === "bank_transfer") return "对公转账";
  return value;
}

function orderStatusLabel(order: WalletRechargeOrder | null) {
  if (!order) return "--";
  if (order.reviewStatus === "submitted") return "待审核";
  if (order.reviewStatus === "approved") return "已审核";
  if (order.reviewStatus === "rejected") return "已拒绝";
  if (order.status === "paid") return "已支付";
  if (order.status === "pending_review") return "待审核";
  if (order.status === "failed") return "支付失败";
  if (order.status === "expired") return "已过期";
  if (order.status === "closed") return "已关闭";
  return "待支付";
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

function isMobileViewport() {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(max-width: 768px)").matches || /Mobi|Android|iPhone/i.test(window.navigator.userAgent);
}

function resolveVisibleWallets(wallets: WalletInfo[], me: PermissionContext | null) {
  if (!me || !wallets.length) return wallets;
  const isEnterprise =
    me.currentOrganizationRole === "enterprise_admin" || me.currentOrganizationRole === "enterprise_member";
  if (isEnterprise) {
    const organizationWallets = wallets.filter((wallet) => wallet.ownerType === "organization");
    return organizationWallets.length ? organizationWallets : wallets;
  }
  return wallets.filter((wallet) => wallet.ownerType !== "organization");
}

function findMethodCapability(
  capabilities: WalletRechargeCapabilities | null,
  paymentMethod: WalletRechargePaymentMethod,
) {
  return capabilities?.methods.find((item) => item.paymentMethod === paymentMethod) ?? null;
}

function getDefaultSelection(capabilities: WalletRechargeCapabilities | null): {
  paymentMethod: WalletRechargePaymentMethod;
  mode: WalletRechargeMode;
} {
  const methods = capabilities?.methods || [];
  const livePreferred = methods.find((item) => item.live.available);
  if (livePreferred) {
    return { paymentMethod: livePreferred.paymentMethod, mode: "live" };
  }
  const demoPreferred = methods.find((item) => item.demoMock.available);
  if (demoPreferred) {
    return { paymentMethod: demoPreferred.paymentMethod, mode: "demo_mock" };
  }
  return { paymentMethod: "wechat_pay", mode: "live" };
}

function resolveScene(
  paymentMethod: WalletRechargePaymentMethod,
  mode: WalletRechargeMode,
): WalletRechargeScene {
  if (mode === "demo_mock") return "desktop_qr";
  if (paymentMethod === "wechat_pay") {
    return isMobileViewport() ? "mobile_h5" : "desktop_qr";
  }
  if (paymentMethod === "alipay") {
    return isMobileViewport() ? "mobile_wap" : "pc_page";
  }
  return "bank_transfer";
}

function resolveApiUrl(pathOrUrl?: string | null) {
  if (!pathOrUrl) return "";
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${API_BASE_URL}${pathOrUrl}`;
}

function buildQrImageUrl(codeUrl?: string | null) {
  if (!codeUrl) return "";
  return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(codeUrl)}`;
}

function firstAvailableCapability(
  methods: WalletRechargeMethodCapability[],
  mode: WalletRechargeMode,
) {
  return methods.find((method) => (mode === "demo_mock" ? method.demoMock.available : method.live.available)) ?? null;
}

export default function WalletRecharge() {
  const navigate = useNavigate();
  const location = useLocation();
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("annual");
  const [selectedPlanId, setSelectedPlanId] = useState("studio");
  const [paymentMethod, setPaymentMethod] = useState<WalletRechargePaymentMethod>("wechat_pay");
  const [paymentMode, setPaymentMode] = useState<WalletRechargeMode>("live");
  const [me, setMe] = useState<PermissionContext | null>(null);
  const [wallets, setWallets] = useState<WalletInfo[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);
  const [capabilities, setCapabilities] = useState<WalletRechargeCapabilities | null>(null);
  const [currentOrder, setCurrentOrder] = useState<WalletRechargeOrder | null>(null);
  const [proofFiles, setProofFiles] = useState<UploadedFile[]>([]);
  const [proofNote, setProofNote] = useState("");
  const [proofReference, setProofReference] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [submittingProof, setSubmittingProof] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedPlan = useMemo(() => PLANS.find((item) => item.id === selectedPlanId) ?? PLANS[0], [selectedPlanId]);
  const visibleWallets = useMemo(() => resolveVisibleWallets(wallets, me), [wallets, me]);
  const selectedWallet = useMemo(
    () => visibleWallets.find((wallet) => wallet.id === selectedWalletId) ?? visibleWallets[0] ?? null,
    [selectedWalletId, visibleWallets],
  );
  const currentCapability = useMemo(
    () => findMethodCapability(capabilities, paymentMethod),
    [capabilities, paymentMethod],
  );
  const qrPattern = useMemo(() => buildQrPattern(currentOrder?.id || "wechat-demo"), [currentOrder]);
  const returnOrderId = useMemo(
    () => new URLSearchParams(location.search).get("orderId"),
    [location.search],
  );

  const loadContext = async () => {
    setLoading(true);
    try {
      const [meResponse, walletResponse, capabilityResponse] = await Promise.all([
        getMe(),
        listWallets(),
        getWalletRechargeCapabilities(),
      ]);

      setMe(meResponse);
      setWallets(walletResponse.items);
      setCapabilities(capabilityResponse);

      const visible = resolveVisibleWallets(walletResponse.items, meResponse);
      setSelectedWalletId((current) => (visible.some((wallet) => wallet.id === current) ? current : visible[0]?.id ?? null));

      setPaymentMode((current) => {
        const selected = getDefaultSelection(capabilityResponse);
        return current === "demo_mock" && capabilityResponse.demoMockEnabled ? current : selected.mode;
      });

      setPaymentMethod((current) => {
        const methods = capabilityResponse.methods.map((method) => method.paymentMethod);
        if (methods.includes(current)) return current;
        return getDefaultSelection(capabilityResponse).paymentMethod;
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "加载充值上下文失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadContext();
  }, []);

  useEffect(() => {
    if (!selectedWallet?.id) return;
    void listWalletLedger(selectedWallet.id).then((response) => setLedger(response.items.slice(0, 5)));
  }, [selectedWallet?.id]);

  useEffect(() => {
    if (!capabilities) return;
    const available =
      paymentMode === "demo_mock"
        ? currentCapability?.demoMock.available
        : currentCapability?.live.available;
    if (available) return;

    const fallback = firstAvailableCapability(capabilities.methods, paymentMode);
    if (fallback) {
      setPaymentMethod(fallback.paymentMethod);
      return;
    }

    const alternateMode = paymentMode === "live" ? "demo_mock" : "live";
    const alternateFallback = firstAvailableCapability(capabilities.methods, alternateMode);
    if (alternateFallback) {
      setPaymentMode(alternateMode);
      setPaymentMethod(alternateFallback.paymentMethod);
    }
  }, [capabilities, currentCapability?.demoMock.available, currentCapability?.live.available, paymentMode]);

  useEffect(() => {
    if (!returnOrderId) return;
    void getWalletRechargeOrder(returnOrderId)
      .then((order) => {
        setCurrentOrder(order);
        setPaymentMethod((order.paymentMethod as WalletRechargePaymentMethod) || "wechat_pay");
        setPaymentMode((order.mode as WalletRechargeMode) || "live");
      })
      .catch(() => {
        setNotice("未能读取回跳订单，请稍后刷新。");
      });
  }, [returnOrderId]);

  useEffect(() => {
    setProofFiles([]);
    setProofNote("");
    setProofReference("");
  }, [currentOrder?.id]);

  useEffect(() => {
    if (
      !currentOrder ||
      currentOrder.mode !== "live" ||
      currentOrder.paymentMethod !== "wechat_pay" ||
      currentOrder.scene !== "desktop_qr" ||
      currentOrder.status !== "pending"
    ) {
      return;
    }

    let cancelled = false;
    let attempts = 0;

    const poll = async () => {
      attempts += 1;
      try {
        const refreshed = await refreshWalletRechargeOrderStatus(currentOrder.id);
        if (!cancelled) {
          setCurrentOrder(refreshed);
          if (refreshed.walletId) {
            const ledgerResponse = await listWalletLedger(refreshed.walletId);
            if (!cancelled) {
              setLedger(ledgerResponse.items.slice(0, 5));
            }
          }
        }
      } catch {
        // Poll failures should not block the rest of the page.
      }
    };

    void poll();
    const timer = window.setInterval(() => {
      if (attempts >= 30 || cancelled) {
        window.clearInterval(timer);
        return;
      }
      void poll();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [currentOrder?.id, currentOrder?.mode, currentOrder?.paymentMethod, currentOrder?.scene, currentOrder?.status]);

  const handleCreateOrder = async () => {
    if (!selectedWallet?.id) {
      setNotice("当前身份下没有可充值的钱包。");
      return;
    }

    if (!currentCapability) {
      setNotice("当前支付方式不可用。");
      return;
    }

    const capabilityState = paymentMode === "demo_mock" ? currentCapability.demoMock : currentCapability.live;
    if (!capabilityState.available) {
      setNotice(capabilityState.reason || "当前支付方式暂不可用。");
      return;
    }

    setCreating(true);
    setNotice(null);

    try {
      const order = await createWalletRechargeOrder({
        planId: selectedPlan.id,
        planName: selectedPlan.name,
        billingCycle,
        paymentMethod,
        mode: paymentMode,
        scene: resolveScene(paymentMethod, paymentMode),
        amount: selectedPlan.price[billingCycle],
        credits: selectedPlan.credits[billingCycle],
        walletId: selectedWallet.id,
      });

      setCurrentOrder(order);
      if (order.paymentMethod === "wechat_pay" && order.mode === "live" && order.scene === "mobile_h5" && order.h5Url) {
        window.location.assign(order.h5Url);
        return;
      }

      if (order.paymentMethod === "alipay" && order.mode === "live" && order.redirectUrl) {
        window.location.assign(resolveApiUrl(order.redirectUrl));
        return;
      }

      if (order.paymentMethod === "bank_transfer") {
        setNotice("订单已创建，请完成对公转账并上传打款凭证。");
        return;
      }

      if (order.mode === "demo_mock") {
        setNotice("演示支付订单已创建，可继续使用模拟确认流程。");
      } else {
        setNotice("真实支付订单已创建，请按页面提示完成支付。");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "创建订单失败");
    } finally {
      setCreating(false);
    }
  };

  const handleRefresh = async () => {
    if (!currentOrder) return;
    setRefreshing(true);
    setNotice(null);
    try {
      const refreshed = await refreshWalletRechargeOrderStatus(currentOrder.id);
      setCurrentOrder(refreshed);
      if (refreshed.walletId) {
        const ledgerResponse = await listWalletLedger(refreshed.walletId);
        setLedger(ledgerResponse.items.slice(0, 5));
      }
      setNotice(refreshed.status === "paid" ? "支付状态已更新，积分已入账。" : "订单状态已刷新。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "刷新订单状态失败");
    } finally {
      setRefreshing(false);
    }
  };

  const handleConfirmDemo = async () => {
    if (!currentOrder) return;
    setConfirming(true);
    setNotice(null);
    try {
      const paid = await confirmWalletRechargeOrder(currentOrder.id);
      setCurrentOrder(paid);
      await loadContext();
      if (paid.walletId) {
        const ledgerResponse = await listWalletLedger(paid.walletId);
        setLedger(ledgerResponse.items.slice(0, 5));
      }
      setNotice("演示支付已确认，积分已完成 mock 入账。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "确认演示支付失败");
    } finally {
      setConfirming(false);
    }
  };

  const handleUploadProofFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadingProof(true);
    setNotice(null);
    try {
      const uploads = await Promise.all(Array.from(files).map((file) => uploadFile(file, "payment-proof")));
      setProofFiles((current) => [...current, ...uploads]);
      setNotice(`已上传 ${uploads.length} 个凭证文件。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "上传凭证失败");
    } finally {
      setUploadingProof(false);
    }
  };

  const handleSubmitProof = async () => {
    if (!currentOrder) return;
    if (!proofFiles.length) {
      setNotice("请先上传打款凭证。");
      return;
    }
    setSubmittingProof(true);
    setNotice(null);
    try {
      const submitted = await submitWalletRechargeTransferProof(currentOrder.id, {
        voucherFiles: proofFiles.map((file) => file.url),
        note: proofNote || undefined,
        transferReference: proofReference || undefined,
      });
      setCurrentOrder(submitted);
      setNotice("对公转账凭证已提交，等待平台审核入账。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "提交对公凭证失败");
    } finally {
      setSubmittingProof(false);
    }
  };

  const realMethods = useMemo(
    () => capabilities?.methods.filter((method) => method.live.available || method.live.reason) ?? [],
    [capabilities],
  );
  const demoMethods = useMemo(
    () => capabilities?.methods.filter((method) => method.demoMock.available) ?? [],
    [capabilities],
  );

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 custom-scrollbar sm:px-8">
      <div className="mx-auto max-w-6xl space-y-8">
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
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">充值钱包</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                保留演示 Mock，同时支持真实支付能力接入。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-background/40 p-1">
            {BILLING_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setBillingCycle(option.id)}
                className={cn(
                  "relative rounded-lg px-4 py-2 text-sm font-medium transition",
                  billingCycle === option.id
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
                {"tag" in option && option.tag ? (
                  <span className="absolute -right-1 -top-2 rounded-full bg-indigo-500 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                    {option.tag}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>

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
                    {billingCycle === "annual" ? "/年" : billingCycle === "monthly" ? "/月" : ""}
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
                      <Check className={cn("h-4 w-4 shrink-0", isSelected ? "text-primary" : "text-muted-foreground/50")} />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="space-y-6">
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

              {visibleWallets.length ? (
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
                          <p className="text-sm font-medium text-foreground">{wallet.displayName || wallet.id}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{formatCredits(wallet.availableCredits)}</p>
                        </div>
                        {selectedWallet?.id === wallet.id ? (
                          <span className="rounded-full bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground">
                            已选
                          </span>
                        ) : null}
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
                  当前账号下没有可充值的钱包。
                </div>
              )}
            </div>

            <div className="glass-panel rounded-2xl p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/12 text-primary">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-foreground">支付方式</h3>
                  <p className="text-xs text-muted-foreground">
                    当前访问 host：{capabilities?.requestHost || "--"}
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-5">
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-foreground">真实支付</h4>
                    <span className="text-xs text-muted-foreground">真实通道配置完成后会自动可选</span>
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    {realMethods.map((method) => {
                      const active = paymentMode === "live" && paymentMethod === method.paymentMethod;
                      return (
                        <button
                          key={`live-${method.paymentMethod}`}
                          type="button"
                          disabled={!method.live.available}
                          onClick={() => {
                            setPaymentMode("live");
                            setPaymentMethod(method.paymentMethod);
                          }}
                          className={cn(
                            "rounded-2xl border px-4 py-4 text-left transition",
                            active
                              ? "border-primary/40 bg-primary/10"
                              : "border-border/70 bg-background/35 hover:border-primary/20 hover:bg-background/50",
                            !method.live.available && "cursor-not-allowed opacity-60",
                          )}
                        >
                          <p className="text-sm font-medium text-foreground">{method.label}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{method.detail}</p>
                          <p className="mt-3 text-xs text-muted-foreground">
                            {method.live.available
                              ? `支持：${method.live.scenes.join(" / ")}`
                              : method.live.reason || "待配置"}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {demoMethods.length ? (
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <h4 className="text-sm font-semibold text-foreground">演示支付</h4>
                      <span className="rounded-full bg-amber-500/12 px-2.5 py-1 text-[11px] text-amber-300">
                        所有访问者可见
                      </span>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      {demoMethods.map((method) => {
                        const active = paymentMode === "demo_mock" && paymentMethod === method.paymentMethod;
                        return (
                          <button
                            key={`demo-${method.paymentMethod}`}
                            type="button"
                            onClick={() => {
                              setPaymentMode("demo_mock");
                              setPaymentMethod(method.paymentMethod);
                            }}
                            className={cn(
                              "rounded-2xl border px-4 py-4 text-left transition",
                              active
                                ? "border-primary/40 bg-primary/10"
                                : "border-border/70 bg-background/35 hover:border-primary/20 hover:bg-background/50",
                            )}
                          >
                            <p className="text-sm font-medium text-foreground">{method.label}</p>
                            <p className="mt-1 text-xs text-muted-foreground">演示专用，不发起真实扣款</p>
                            <p className="mt-3 text-xs text-muted-foreground">
                              支持当前 mock 二维码与“我已完成支付”流程
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="glass-panel rounded-2xl p-6">
              <div className="flex items-center gap-3">
                <QrCode className="h-5 w-5 text-primary" />
                <div>
                  <h3 className="text-base font-semibold text-foreground">支付订单</h3>
                  <p className="text-xs text-muted-foreground">
                    {currentOrder ? `当前订单：${currentOrder.id}` : "创建订单后在这里继续支付或上传凭证"}
                  </p>
                </div>
              </div>

              {!currentOrder ? (
                <div className="mt-5 rounded-2xl border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
                  还没有创建充值订单。选择套餐、钱包和支付方式后点击右侧按钮即可开始。
                </div>
              ) : (
                <div className="mt-5 space-y-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
                      {paymentMethodLabel(currentOrder.paymentMethod)}
                    </span>
                    <span className="rounded-full bg-primary/12 px-2.5 py-1 text-xs text-primary">
                      {currentOrder.mode === "demo_mock" ? "演示 Mock" : "真实支付"}
                    </span>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
                      {orderStatusLabel(currentOrder)}
                    </span>
                  </div>

                  {currentOrder.mode === "demo_mock" ? (
                    <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
                      <div className="rounded-3xl border border-border/70 bg-background/50 p-4">
                        <div
                          className="grid gap-1 rounded-2xl bg-white p-4"
                          style={{ gridTemplateColumns: "repeat(13, minmax(0, 1fr))" }}
                        >
                          {qrPattern.map((active, index) => (
                            <div
                              key={`${currentOrder.id}-${index}`}
                              className={cn("h-4 w-4 rounded-[2px]", active ? "bg-slate-900" : "bg-transparent")}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          当前{paymentMethodLabel(currentOrder.paymentMethod)}二维码和支付成功都为演示 Mock，不会发起真实扣款。
                        </p>
                        <button
                          type="button"
                          disabled={confirming}
                          onClick={() => void handleConfirmDemo()}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {confirming ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          我已完成支付（演示）
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {currentOrder.mode === "live" &&
                  currentOrder.paymentMethod === "wechat_pay" &&
                  currentOrder.scene === "desktop_qr" ? (
                    <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
                      <div className="overflow-hidden rounded-3xl border border-border/70 bg-white p-4">
                        {currentOrder.codeUrl ? (
                          <img
                            src={buildQrImageUrl(currentOrder.codeUrl)}
                            alt="微信支付二维码"
                            className="h-full w-full rounded-2xl object-contain"
                          />
                        ) : (
                          <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
                            等待二维码
                          </div>
                        )}
                      </div>
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          请使用微信扫一扫完成支付。支付成功后页面会自动轮询，也可以手动刷新。
                        </p>
                        {currentOrder.codeUrl ? (
                          <div className="rounded-2xl border border-border/70 bg-background/40 px-3 py-2 text-xs text-muted-foreground break-all">
                            {currentOrder.codeUrl}
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={refreshing}
                            onClick={() => void handleRefresh()}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border/70 bg-background/60 px-5 py-3 text-sm font-medium text-foreground transition hover:bg-background/80 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {refreshing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                            刷新订单状态
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {currentOrder.mode === "live" &&
                  ((currentOrder.paymentMethod === "wechat_pay" && currentOrder.scene === "mobile_h5") ||
                    currentOrder.paymentMethod === "alipay") ? (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        {currentOrder.paymentMethod === "wechat_pay"
                          ? "移动端会跳转到微信 H5 支付；支付完成后回到本页，再点击刷新确认入账。"
                          : "支付宝支付已跳转到官方收银台；返回本页后请刷新订单状态。"}
                      </p>
                      {currentOrder.redirectUrl || currentOrder.h5Url ? (
                        <button
                          type="button"
                          onClick={() =>
                            window.location.assign(resolveApiUrl(currentOrder.redirectUrl) || currentOrder.h5Url || "")
                          }
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
                        >
                          继续前往支付
                        </button>
                      ) : null}
                      <button
                        type="button"
                        disabled={refreshing}
                        onClick={() => void handleRefresh()}
                        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border/70 bg-background/60 px-5 py-3 text-sm font-medium text-foreground transition hover:bg-background/80 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {refreshing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                        我已完成支付，刷新状态
                      </button>
                    </div>
                  ) : null}

                  {currentOrder.paymentMethod === "bank_transfer" ? (
                    <div className="space-y-4">
                      <div className="rounded-3xl border border-border/70 bg-background/35 p-4 text-sm text-muted-foreground">
                        <div className="grid gap-2 md:grid-cols-2">
                          <p>收款户名：{currentOrder.bankAccount?.accountName || currentCapability?.bankAccount?.accountName || "--"}</p>
                          <p>开户行：{currentOrder.bankAccount?.bankName || currentCapability?.bankAccount?.bankName || "--"}</p>
                          <p>账号：{currentOrder.bankAccount?.accountNo || currentCapability?.bankAccount?.accountNo || "--"}</p>
                          <p>支行：{currentOrder.bankAccount?.branchName || currentCapability?.bankAccount?.branchName || "--"}</p>
                          <p className="md:col-span-2">
                            打款备注：{currentOrder.bankAccount?.remarkTemplate || currentCapability?.bankAccount?.remarkTemplate || "--"}
                          </p>
                          <p className="md:col-span-2">
                            说明：{currentOrder.bankAccount?.instructions || currentCapability?.bankAccount?.instructions || "转账后请上传打款凭证并等待审核。"}
                          </p>
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2">
                        <label className="block text-sm text-muted-foreground">
                          打款流水号 / 备注
                          <input
                            value={proofReference}
                            onChange={(event) => setProofReference(event.target.value)}
                            className="mt-2 h-11 w-full rounded-2xl border border-border/70 bg-background/60 px-3 text-sm text-foreground outline-none transition focus:border-primary/40"
                            placeholder="可选：填写对公转账流水号"
                          />
                        </label>
                        <label className="block text-sm text-muted-foreground">
                          审核补充说明
                          <input
                            value={proofNote}
                            onChange={(event) => setProofNote(event.target.value)}
                            className="mt-2 h-11 w-full rounded-2xl border border-border/70 bg-background/60 px-3 text-sm text-foreground outline-none transition focus:border-primary/40"
                            placeholder="可选：补充说明"
                          />
                        </label>
                      </div>

                      <div className="rounded-3xl border border-dashed border-border/70 p-4">
                        <label className="flex cursor-pointer items-center gap-3 text-sm text-foreground">
                          <span className="inline-flex h-11 items-center justify-center rounded-2xl border border-border/70 bg-background/60 px-4">
                            {uploadingProof ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          </span>
                          <span>上传打款凭证</span>
                          <input
                            type="file"
                            multiple
                            className="hidden"
                            onChange={(event) => void handleUploadProofFiles(event.target.files)}
                          />
                        </label>

                        {proofFiles.length ? (
                          <div className="mt-4 flex flex-wrap gap-2">
                            {proofFiles.map((file) => (
                              <a
                                key={file.id}
                                href={file.url}
                                target="_blank"
                                rel="noreferrer"
                                className="rounded-full border border-border/70 px-3 py-1 text-xs text-primary transition hover:border-primary/40"
                              >
                                {file.originalName}
                              </a>
                            ))}
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={submittingProof}
                          onClick={() => void handleSubmitProof()}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {submittingProof ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                          提交凭证，进入审核
                        </button>
                        <button
                          type="button"
                          disabled={refreshing}
                          onClick={() => void handleRefresh()}
                          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-border/70 bg-background/60 px-5 py-3 text-sm font-medium text-foreground transition hover:bg-background/80 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {refreshing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          刷新审核状态
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            <div className="glass-panel rounded-2xl p-6">
              <h3 className="text-base font-semibold text-foreground">常见问题</h3>
              <div className="mt-5 space-y-3">
                {FAQS.map(([question, answer]) => (
                  <div key={question} className="rounded-2xl border border-border/70 bg-background/35 p-4">
                    <p className="text-sm font-medium text-foreground">{question}</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{answer}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-6">
            <div className="glass-panel rounded-2xl p-6">
              <div className="rounded-3xl border border-primary/25 bg-primary/6 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">订单摘要</p>
                    <h3 className="mt-2 text-3xl font-semibold tracking-tight text-foreground">{selectedPlan.name}</h3>
                  </div>
                  <span className="text-4xl font-bold tracking-tight text-foreground">
                    {formatCurrency(selectedPlan.price[billingCycle])}
                  </span>
                </div>
                <div className="mt-5 rounded-2xl bg-primary/10 px-4 py-3 text-sm font-medium text-primary">
                  {selectedPlan.credits[billingCycle].toLocaleString("zh-CN")} 积分到账
                </div>
              </div>

              <dl className="mt-5 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">当前身份</dt>
                  <dd className="font-medium text-foreground">{formatRole(me)}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">充值钱包</dt>
                  <dd className="font-medium text-foreground">{selectedWallet?.displayName || "--"}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">当前余额</dt>
                  <dd className="font-medium text-foreground">{formatCredits(selectedWallet?.availableCredits)}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">支付方式</dt>
                  <dd className="font-medium text-foreground">
                    {paymentMethodLabel(paymentMethod)} · {paymentMode === "demo_mock" ? "演示 Mock" : "真实支付"}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">订单状态</dt>
                  <dd className="font-medium text-foreground">{orderStatusLabel(currentOrder)}</dd>
                </div>
              </dl>

              {notice ? (
                <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/8 px-4 py-3 text-sm text-primary">
                  {notice}
                </div>
              ) : null}

              <button
                type="button"
                disabled={creating || loading}
                onClick={() => void handleCreateOrder()}
                className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {creating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                生成支付订单
              </button>
            </div>

            <div className="glass-panel rounded-2xl p-6">
              <h3 className="text-base font-semibold text-foreground">最近流水</h3>
              <div className="mt-5 space-y-3">
                {ledger.length ? (
                  ledger.map((entry) => (
                    <div key={entry.id} className="rounded-2xl border border-border/70 bg-background/35 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">{formatLedger(entry)}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatShortTime(entry.createdAt)} · 余额 {entry.balanceAfter.toLocaleString("zh-CN")}
                          </p>
                        </div>
                        <span className={cn("text-sm font-semibold", entry.amount >= 0 ? "text-primary" : "text-foreground")}>
                          {entry.amount >= 0 ? "+" : ""}
                          {entry.amount.toLocaleString("zh-CN")}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/70 px-4 py-5 text-sm text-muted-foreground">
                    暂无最近流水。
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
