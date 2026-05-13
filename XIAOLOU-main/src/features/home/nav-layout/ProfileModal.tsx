import {
  Building2,
  Camera,
  ChevronDown,
  CircleUserRound,
  CreditCard,
  FileText,
  KeyRound,
  LoaderCircle,
  Mail,
  Phone,
  ReceiptText,
  ShieldCheck,
  User as UserIcon,
  X,
  Zap,
} from "lucide-react";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  changePassword,
  listWalletLedger,
  listWallets,
  uploadFile,
  type PermissionContext,
  type UpdateMeInput,
  updateMe,
  type Wallet,
  type WalletLedgerEntry,
} from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { mergeProfileUpdateContext, resolveAvatarUploadUrl } from "./api/profile-avatar";

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  context: PermissionContext | null;
  onUpdateContext: (context: PermissionContext) => void;
}

type AccountPanel = "profile" | "subscription" | "billing";

const accountNavItems: Array<{
  id: AccountPanel;
  label: string;
  icon: typeof CircleUserRound;
}> = [
  { id: "profile", label: "个人主页", icon: CircleUserRound },
  { id: "subscription", label: "订阅", icon: CreditCard },
  { id: "billing", label: "账单", icon: ReceiptText },
];

const ledgerActionLabels: Record<string, string> = {
  script_rewrite: "剧本改写",
  asset_extract: "资产提取",
  asset_image_generate: "资产出图",
  storyboard_auto_generate: "自动拆分分镜",
  storyboard_image_generate: "分镜出图",
  video_generate: "视频生成",
  dubbing_generate: "配音生成",
  lipsync_generate: "对口型",
  project_export: "成片导出",
  character_replace: "人物替换",
  motion_transfer: "动作迁移",
  upscale_restore: "超清修复",
  storyboard_grid25_generate: "25 格分镜",
  toolbox_image_generate: "工具箱出图",
  create_image_generate: "独立出图",
  create_video_generate: "独立视频生成",
};

function getRoleLabel(context: PermissionContext) {
  if (context.platformRole === "super_admin") return "超级管理员";
  if (context.platformRole === "ops_admin") return "运营管理员";
  if (context.currentOrganizationRole === "enterprise_admin") return "企业管理员";
  if (context.currentOrganizationRole === "enterprise_member") return "企业成员";
  return "个人账号";
}

function formatCredits(value: number | undefined, unlimited?: boolean) {
  if (unlimited) return "无限";
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 2,
  }).format(value ?? 0);
}

function formatLedgerDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(/\//g, "-");
}

function getWalletBalance(wallet: Wallet | null | undefined) {
  if (!wallet) return 0;
  return wallet.availableCredits ?? wallet.creditsAvailable ?? 0;
}

function getWalletFrozen(wallet: Wallet | null | undefined) {
  if (!wallet) return 0;
  return wallet.frozenCredits ?? wallet.creditsFrozen ?? 0;
}

function getWalletName(wallet: Wallet | null | undefined) {
  if (!wallet) return "当前钱包";
  if (wallet.displayName) return wallet.displayName;
  if (wallet.ownerType === "organization" || wallet.walletOwnerType === "organization") return "企业钱包";
  if (wallet.ownerType === "platform" || wallet.walletOwnerType === "platform") return "平台钱包";
  return "个人钱包";
}

function isConsumptionEntry(entry: WalletLedgerEntry) {
  const entryType = String(entry.entryType || "").toLowerCase();
  if (entryType === "freeze") return false;
  if (entryType === "settle") return true;
  return entry.amount < 0;
}

function isSameLocalDay(value: string, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function getMetadataText(entry: WalletLedgerEntry, keys: string[]) {
  for (const key of keys) {
    const value = entry.metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function getLedgerTitle(entry: WalletLedgerEntry) {
  const actionCode = getMetadataText(entry, ["actionCode", "sourceTaskType"]);
  if (actionCode) return ledgerActionLabels[actionCode] ?? actionCode.replace(/_/g, " ");

  return (
    getMetadataText(entry, ["label", "title", "actionLabel", "actionName", "description", "taskType"]) ||
    entry.sourceType ||
    entry.entryType ||
    "积分变动"
  );
}

function getLedgerStatus(entry: WalletLedgerEntry) {
  const entryType = String(entry.entryType || "").toLowerCase();
  if (entryType === "freeze") return "冻结中";
  if (entryType === "settle") return "已消耗";
  if (entryType === "refund") return "已退回";
  if (entryType === "recharge" || entryType === "grant") return "已入账";
  if (entry.amount < 0) return "已消耗";
  if (entry.amount > 0) return "已入账";
  return "已记录";
}

export function ProfileModal({ isOpen, onClose, context, onUpdateContext }: ProfileModalProps) {
  const enterpriseOrganizations = useMemo(
    () =>
      context?.organizations.filter(
        (organization) =>
          organization.role === "enterprise_admin" || organization.role === "enterprise_member",
      ) ?? [],
    [context],
  );
  const canEditDefaultOrganization =
    context?.platformRole === "customer" && enterpriseOrganizations.length > 0;
  const canEditAccountFields = context
    ? context.currentOrganizationRole !== "enterprise_member" ||
      context.permissions.canManageOrganization === true
    : false;

  const [activePanel, setActivePanel] = useState<AccountPanel>("profile");
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [defaultOrganizationId, setDefaultOrganizationId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [isPasswordOpen, setIsPasswordOpen] = useState(false);
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [activeWalletId, setActiveWalletId] = useState("");
  const [ledgerEntries, setLedgerEntries] = useState<WalletLedgerEntry[]>([]);
  const [walletLoading, setWalletLoading] = useState(false);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [walletError, setWalletError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || !context) return;

    setActivePanel("profile");
    setDisplayName(context.actor.displayName || "");
    setAvatar(context.actor.avatar || null);
    setPhone(context.actor.phone || "");
    setDefaultOrganizationId(
      context.actor.defaultOrganizationId ||
        context.currentOrganizationId ||
        enterpriseOrganizations[0]?.id ||
        "",
    );
    setProfileError(null);
    setProfileMessage(null);
    setIsPasswordOpen(false);
    setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    setPasswordError(null);
    setPasswordMessage(null);
  }, [enterpriseOrganizations, isOpen, context]);

  useEffect(() => {
    if (!isOpen || !context || context.platformRole === "guest") return;

    let cancelled = false;
    setWalletLoading(true);
    setWalletError(null);

    listWallets()
      .then(({ items }) => {
        if (cancelled) return;
        setWallets(items);
        setActiveWalletId((currentId) => {
          if (currentId && items.some((wallet) => wallet.id === currentId)) return currentId;
          return items.find((wallet) => wallet.id)?.id ?? "";
        });
        if (!items.length) setLedgerEntries([]);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to load wallets:", error);
        setWallets([]);
        setLedgerEntries([]);
        setActiveWalletId("");
        setWalletError("积分信息加载失败，请稍后重试");
      })
      .finally(() => {
        if (!cancelled) setWalletLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, context]);

  useEffect(() => {
    if (!isOpen || !activeWalletId) {
      setLedgerEntries([]);
      return;
    }

    let cancelled = false;
    setLedgerLoading(true);
    setWalletError(null);

    listWalletLedger(activeWalletId)
      .then(({ items }) => {
        if (cancelled) return;
        setLedgerEntries(
          [...items].sort(
            (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
          ),
        );
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to load wallet ledger:", error);
        setLedgerEntries([]);
        setWalletError("积分消耗记录加载失败，请稍后重试");
      })
      .finally(() => {
        if (!cancelled) setLedgerLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeWalletId, isOpen]);

  const activeWallet = useMemo(
    () => wallets.find((wallet) => wallet.id === activeWalletId) ?? wallets[0] ?? null,
    [activeWalletId, wallets],
  );
  const consumptionEntries = useMemo(() => ledgerEntries.filter(isConsumptionEntry), [ledgerEntries]);
  const todayConsumption = useMemo(
    () =>
      consumptionEntries.reduce(
        (sum, entry) => sum + (isSameLocalDay(entry.createdAt) ? Math.abs(entry.amount) : 0),
        0,
      ),
    [consumptionEntries],
  );
  const totalConsumption = useMemo(
    () => consumptionEntries.reduce((sum, entry) => sum + Math.abs(entry.amount), 0),
    [consumptionEntries],
  );

  if (!isOpen || !context) return null;

  const roleLabel = getRoleLabel(context);
  const walletBalance = getWalletBalance(activeWallet);
  const walletFrozen = getWalletFrozen(activeWallet);

  const handleSave = async () => {
    const username = canEditAccountFields ? displayName.trim() : context.actor.displayName || "";
    if ((canEditAccountFields && !username) || isUploading) return;

    setIsSaving(true);
    setProfileError(null);
    setProfileMessage(null);

    try {
      const profilePatch: UpdateMeInput = canEditAccountFields
        ? {
            displayName: username,
            avatar,
            phone: phone.trim() || null,
            ...(canEditDefaultOrganization
              ? { defaultOrganizationId: defaultOrganizationId || null }
              : {}),
          }
        : { avatar };
      const updatedContext = await updateMe(profilePatch);
      onUpdateContext(mergeProfileUpdateContext(updatedContext, profilePatch));
      setProfileMessage("资料已保存");
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "账号资料保存失败，请稍后重试");
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setProfileError(null);
    setProfileMessage(null);
    const localPreview = URL.createObjectURL(file);
    setAvatar(localPreview);

    try {
      const uploaded = await uploadFile(file, "avatar");
      setAvatar(resolveAvatarUploadUrl(uploaded));
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "头像上传失败，请重试");
      setAvatar(context.actor.avatar || null);
    } finally {
      URL.revokeObjectURL(localPreview);
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handlePasswordChange = async () => {
    setPasswordError(null);
    setPasswordMessage(null);

    if (!passwordForm.currentPassword.trim() || !passwordForm.newPassword.trim()) {
      setPasswordError("请填写当前密码和新密码");
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("两次输入的新密码不一致");
      return;
    }

    setIsPasswordSaving(true);
    try {
      await changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordMessage("密码已更新");
      setIsPasswordOpen(false);
    } catch (error) {
      setPasswordError(error instanceof Error ? error.message : "密码修改失败，请稍后重试");
    } finally {
      setIsPasswordSaving(false);
    }
  };

  const renderWalletSwitcher = () => {
    if (wallets.length <= 1) return null;

    return (
      <label className="relative inline-flex items-center">
        <span className="sr-only">选择钱包</span>
        <select
          value={activeWalletId}
          onChange={(event) => setActiveWalletId(event.currentTarget.value)}
          className="h-9 appearance-none rounded-lg border border-neutral-200 bg-white py-0 pl-3 pr-8 text-sm font-medium text-neutral-800 outline-none transition hover:bg-neutral-50 focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
        >
          {wallets.map((wallet) => (
            <option key={wallet.id || wallet.ownerId} value={wallet.id || ""}>
              {getWalletName(wallet)}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4 text-neutral-400" />
      </label>
    );
  };

  const renderLedgerRows = (entries: WalletLedgerEntry[], emptyText: string) => {
    if (walletLoading || ledgerLoading) {
      return (
        <tr>
          <td colSpan={4} className="h-32 text-center">
            <span className="inline-flex items-center gap-2 text-sm text-neutral-500">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              正在加载积分记录
            </span>
          </td>
        </tr>
      );
    }

    if (walletError) {
      return (
        <tr>
          <td colSpan={4} className="h-32 text-center text-sm text-red-500">
            {walletError}
          </td>
        </tr>
      );
    }

    if (!activeWallet) {
      return (
        <tr>
          <td colSpan={4} className="h-32 text-center text-sm text-neutral-500">
            暂无可用钱包
          </td>
        </tr>
      );
    }

    if (!entries.length) {
      return (
        <tr>
          <td colSpan={4} className="h-32 text-center text-sm text-neutral-500">
            {emptyText}
          </td>
        </tr>
      );
    }

    return entries.map((entry) => (
      <tr key={entry.id} className="border-t border-neutral-100">
        <td className="max-w-[250px] truncate px-3 py-4 text-sm text-neutral-800" title={getLedgerTitle(entry)}>
          {getLedgerTitle(entry)}
        </td>
        <td className="px-3 py-4 text-sm text-neutral-700">{getLedgerStatus(entry)}</td>
        <td className="whitespace-nowrap px-3 py-4 text-sm text-neutral-700">
          {formatLedgerDate(entry.createdAt)}
        </td>
        <td
          className={cn(
            "whitespace-nowrap px-3 py-4 text-sm font-medium tabular-nums",
            entry.amount < 0 ? "text-neutral-950" : "text-emerald-600",
          )}
        >
          {entry.amount > 0 ? "+" : ""}
          {formatCredits(entry.amount)}
        </td>
      </tr>
    ));
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-4 text-neutral-950 backdrop-blur-sm">
      <section className="relative flex h-[min(720px,calc(100vh-32px))] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-[0_32px_120px_rgba(15,23,42,0.28)]">
        <button
          type="button"
          aria-label="关闭账号中心"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950"
        >
          <X className="h-5 w-5" />
        </button>

        <aside className="hidden w-64 shrink-0 border-r border-neutral-200 bg-neutral-50/90 p-5 md:block">
          <div className="flex items-center gap-3">
            <div className="relative flex h-12 w-12 overflow-hidden rounded-full bg-neutral-200 text-neutral-700">
              {avatar ? (
                <img src={avatar} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <UserIcon className="h-6 w-6" />
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-neutral-950">
                {context.actor.displayName || context.actor.id}
              </div>
              <div className="mt-0.5 text-xs text-neutral-500">{roleLabel}</div>
            </div>
          </div>

          <nav className="mt-8 space-y-1">
            {accountNavItems.map((item) => {
              const Icon = item.icon;
              const active = activePanel === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActivePanel(item.id)}
                  className={cn(
                    "flex h-10 w-full items-center gap-2 rounded-lg px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300",
                    active
                      ? "bg-neutral-200/80 font-medium text-neutral-950"
                      : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-950",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto px-5 py-6 md:px-9">
          <div className="mb-6 flex gap-2 overflow-x-auto pr-12 md:hidden">
            {accountNavItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActivePanel(item.id)}
                  className={cn(
                    "inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3 text-sm",
                    activePanel === item.id
                      ? "border-neutral-950 bg-neutral-950 text-white"
                      : "border-neutral-200 bg-white text-neutral-700",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </div>

          {activePanel === "profile" ? (
            <div>
              <header>
                <p className="text-sm font-medium text-neutral-500">账号中心</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-normal text-neutral-950">
                  账号与个人资料
                </h2>
              </header>

              <section className="mt-7 flex flex-col gap-5 lg:flex-row">
                <div className="flex w-full shrink-0 flex-col items-center rounded-2xl border border-neutral-200 bg-neutral-50 p-5 lg:w-56">
                  <div className="relative">
                    <div className="relative flex h-24 w-24 overflow-hidden rounded-full bg-neutral-200 text-neutral-700">
                      {avatar ? (
                        <img src={avatar} alt="Avatar" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <UserIcon className="h-10 w-10" />
                        </div>
                      )}

                      {isUploading ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-white/70 backdrop-blur-sm">
                          <LoaderCircle className="h-6 w-6 animate-spin text-neutral-700" />
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      aria-label="上传头像"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-neutral-950 text-white shadow-sm transition-transform hover:scale-105 disabled:opacity-60"
                    >
                      <Camera className="h-4 w-4" />
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/png, image/jpeg, image/webp"
                      className="hidden"
                      onChange={handleFileChange}
                    />
                  </div>
                  <div className="mt-4 text-center">
                    <div className="text-sm font-semibold text-neutral-950">
                      {context.actor.displayName || context.actor.id}
                    </div>
                    <div className="mt-1 text-xs text-neutral-500">{roleLabel}</div>
                  </div>
                </div>

                <div className="min-w-0 flex-1 space-y-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-neutral-800">用户名</span>
                      {canEditAccountFields ? (
                        <input
                          type="text"
                          value={displayName}
                          onChange={(event) => {
                            setDisplayName(event.currentTarget.value);
                            setProfileMessage(null);
                          }}
                          maxLength={30}
                          className="h-11 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-950 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
                          placeholder="输入用户名"
                        />
                      ) : (
                        <div className="flex h-11 items-center rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-600">
                          {context.actor.displayName || context.actor.id}
                        </div>
                      )}
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-neutral-800">邮箱</span>
                      <div className="flex h-11 items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-600">
                        <Mail className="h-4 w-4 shrink-0" />
                        <span className="min-w-0 truncate">{context.actor.email || "未绑定邮箱"}</span>
                      </div>
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-neutral-800">手机号</span>
                      {canEditAccountFields ? (
                        <div className="relative">
                          <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                          <input
                            type="tel"
                            value={phone}
                            onChange={(event) => {
                              setPhone(event.currentTarget.value);
                              setProfileMessage(null);
                            }}
                            className="h-11 w-full rounded-lg border border-neutral-200 bg-white py-0 pl-9 pr-3 text-sm text-neutral-950 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
                            placeholder="可选"
                          />
                        </div>
                      ) : (
                        <div className="flex h-11 items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-600">
                          <Phone className="h-4 w-4 shrink-0" />
                          <span>{context.actor.phone || "未绑定手机号"}</span>
                        </div>
                      )}
                    </label>

                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-neutral-800">身份</span>
                      <div className="flex h-11 items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm text-neutral-600">
                        <ShieldCheck className="h-4 w-4 shrink-0" />
                        {roleLabel}
                      </div>
                    </label>
                  </div>

                  {canEditAccountFields && canEditDefaultOrganization ? (
                    <label className="block">
                      <span className="mb-1.5 block text-sm font-medium text-neutral-800">默认组织</span>
                      <div className="relative">
                        <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                        <select
                          value={defaultOrganizationId}
                          onChange={(event) => {
                            setDefaultOrganizationId(event.currentTarget.value);
                            setProfileMessage(null);
                          }}
                          className="h-11 w-full appearance-none rounded-lg border border-neutral-200 bg-white py-0 pl-9 pr-9 text-sm text-neutral-950 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
                        >
                          <option value="">不默认进入企业</option>
                          {enterpriseOrganizations.map((organization) => (
                            <option key={organization.id} value={organization.id}>
                              {organization.name}
                            </option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
                      </div>
                    </label>
                  ) : null}

                  {canEditAccountFields ? (
                    <section className="rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-neutral-700 shadow-sm">
                            <KeyRound className="h-5 w-5" />
                          </div>
                          <div>
                            <h3 className="text-sm font-semibold text-neutral-950">登录密码</h3>
                            <p className="mt-0.5 text-xs text-neutral-500">
                              修改当前账号的登录密码。
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setIsPasswordOpen((open) => !open);
                            setPasswordError(null);
                            setPasswordMessage(null);
                          }}
                          className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 transition-colors hover:bg-neutral-100"
                        >
                          {isPasswordOpen ? "收起" : "修改密码"}
                        </button>
                      </div>

                      {isPasswordOpen ? (
                        <div className="mt-4 grid gap-3">
                          <input
                            type="password"
                            value={passwordForm.currentPassword}
                            onChange={(event) =>
                              setPasswordForm((current) => ({
                                ...current,
                                currentPassword: event.currentTarget.value,
                              }))
                            }
                            className="h-10 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-950 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
                            placeholder="当前密码"
                          />
                          <div className="grid gap-3 sm:grid-cols-2">
                            <input
                              type="password"
                              value={passwordForm.newPassword}
                              onChange={(event) =>
                                setPasswordForm((current) => ({
                                  ...current,
                                  newPassword: event.currentTarget.value,
                                }))
                              }
                              className="h-10 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-950 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
                              placeholder="新密码"
                            />
                            <input
                              type="password"
                              value={passwordForm.confirmPassword}
                              onChange={(event) =>
                                setPasswordForm((current) => ({
                                  ...current,
                                  confirmPassword: event.currentTarget.value,
                                }))
                              }
                              className="h-10 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-950 outline-none transition focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
                              placeholder="确认新密码"
                            />
                          </div>
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => void handlePasswordChange()}
                              disabled={isPasswordSaving}
                              className="inline-flex h-9 items-center gap-2 rounded-lg bg-neutral-950 px-4 text-xs font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-50"
                            >
                              {isPasswordSaving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                              保存新密码
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {passwordError ? (
                        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
                          {passwordError}
                        </div>
                      ) : null}
                      {passwordMessage ? (
                        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                          {passwordMessage}
                        </div>
                      ) : null}
                    </section>
                  ) : null}

                  {profileError ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                      {profileError}
                    </div>
                  ) : null}
                  {profileMessage ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                      {profileMessage}
                    </div>
                  ) : null}

                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={onClose}
                      className="rounded-lg px-4 py-2 text-sm font-medium text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-950"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSave()}
                      disabled={isSaving || isUploading || (canEditAccountFields && !displayName.trim())}
                      className="inline-flex h-10 items-center gap-2 rounded-lg bg-neutral-950 px-4 text-sm font-medium text-white transition-colors hover:bg-neutral-800 disabled:opacity-50"
                    >
                      {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                      {canEditAccountFields ? "保存修改" : "保存头像"}
                    </button>
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {activePanel === "subscription" ? (
            <div>
              <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-neutral-500">账户额度</p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-normal text-neutral-950">订阅</h2>
                </div>
                {renderWalletSwitcher()}
              </header>

              <section className="mt-8 rounded-2xl border border-neutral-200 bg-neutral-50 p-6">
                <div className="flex flex-wrap items-start justify-between gap-6">
                  <div>
                    <div className="text-2xl font-semibold tracking-normal text-neutral-950">Free</div>
                    <div className="mt-8 flex items-center gap-2 text-3xl font-semibold text-neutral-950">
                      <Zap className="h-7 w-7 fill-neutral-950 text-neutral-950" />
                      <span className="tabular-nums">
                        {walletLoading ? "..." : formatCredits(walletBalance, activeWallet?.unlimitedCredits)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-neutral-500">{getWalletName(activeWallet)}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => window.location.assign("/wallet/recharge")}
                      className="rounded-lg bg-neutral-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800"
                    >
                      充值积分
                    </button>
                    <button
                      type="button"
                      onClick={() => window.location.assign("/wallet/usage")}
                      className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 transition hover:bg-neutral-100"
                    >
                      查看用量
                    </button>
                  </div>
                </div>

                <div className="mt-7 grid gap-3 md:grid-cols-3">
                  <div className="rounded-xl border border-neutral-200 bg-white p-4">
                    <div className="text-xs font-medium text-neutral-500">可用积分</div>
                    <div className="mt-2 text-xl font-semibold tabular-nums text-neutral-950">
                      {formatCredits(walletBalance, activeWallet?.unlimitedCredits)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-neutral-200 bg-white p-4">
                    <div className="text-xs font-medium text-neutral-500">冻结积分</div>
                    <div className="mt-2 text-xl font-semibold tabular-nums text-neutral-950">
                      {formatCredits(walletFrozen)}
                    </div>
                  </div>
                  <div className="rounded-xl border border-neutral-200 bg-white p-4">
                    <div className="text-xs font-medium text-neutral-500">今日消耗</div>
                    <div className="mt-2 text-xl font-semibold tabular-nums text-neutral-950">
                      {formatCredits(todayConsumption)}
                    </div>
                  </div>
                </div>
              </section>

              <section className="mt-6 rounded-2xl border border-neutral-200 bg-white">
                <div className="flex items-center justify-between border-b border-neutral-100 px-5 py-4">
                  <div>
                    <h3 className="text-sm font-semibold text-neutral-950">最近消耗</h3>
                    <p className="mt-1 text-xs text-neutral-500">
                      累计消耗 {formatCredits(totalConsumption)} 积分
                    </p>
                  </div>
                  <FileText className="h-5 w-5 text-neutral-400" />
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-neutral-100">
                    <thead className="bg-neutral-50 text-left text-xs font-medium text-neutral-500">
                      <tr>
                        <th className="px-3 py-3">项目</th>
                        <th className="px-3 py-3">状态</th>
                        <th className="px-3 py-3">时间</th>
                        <th className="px-3 py-3">积分</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white">
                      {renderLedgerRows(consumptionEntries.slice(0, 5), "暂无消耗记录")}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : null}

          {activePanel === "billing" ? (
            <div>
              <header className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-neutral-500">钱包流水</p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-normal text-neutral-950">账单</h2>
                </div>
                {renderWalletSwitcher()}
              </header>

              <section className="mt-8 rounded-2xl border border-neutral-200 bg-neutral-50/70 p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-neutral-700 shadow-sm">
                    <ReceiptText className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-neutral-950">{getWalletName(activeWallet)}</div>
                    <div className="mt-1 text-sm text-neutral-500">
                      记录积分充值、冻结、结算、退款和系统发放。
                    </div>
                  </div>
                </div>

                <div className="mt-5 overflow-hidden rounded-xl border border-neutral-200 bg-white">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-neutral-100">
                      <thead className="bg-neutral-50 text-left text-xs font-medium text-neutral-500">
                        <tr>
                          <th className="px-3 py-3">项目</th>
                          <th className="px-3 py-3">状态</th>
                          <th className="px-3 py-3">时间</th>
                          <th className="px-3 py-3">积分</th>
                        </tr>
                      </thead>
                      <tbody className="bg-white">{renderLedgerRows(ledgerEntries, "暂无账单记录")}</tbody>
                    </table>
                  </div>
                </div>
              </section>
            </div>
          ) : null}
        </main>
      </section>
    </div>
  );
}
