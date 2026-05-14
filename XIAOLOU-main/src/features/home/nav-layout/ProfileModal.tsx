import {
  ChevronDown,
  CircleUserRound,
  CreditCard,
  ReceiptText,
  User as UserIcon,
  X,
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
import { BillingPanel } from "./BillingPanel";
import { ProfilePanel, type PasswordFormState } from "./ProfilePanel";
import { SubscriptionPanel } from "./SubscriptionPanel";
import {
  getWalletBalance,
  getWalletFrozen,
  getWalletName,
  isConsumptionEntry,
  isSameLocalDay,
} from "./WalletLedgerTable";

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

function getRoleLabel(context: PermissionContext) {
  if (context.platformRole === "super_admin") return "超级管理员";
  if (context.platformRole === "ops_admin") return "运营管理员";
  if (context.currentOrganizationRole === "enterprise_admin") return "企业管理员";
  if (context.currentOrganizationRole === "enterprise_member") return "企业成员";
  return "个人账号";
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
  const canShowAccountBilling =
    context?.platformRole === "customer" && context.currentOrganizationRole !== "enterprise_admin";
  const visibleAccountNavItems = useMemo(
    () =>
      accountNavItems.filter((item) => item.id !== "billing" || canShowAccountBilling),
    [canShowAccountBilling],
  );

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
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>({
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
    if (!canShowAccountBilling && activePanel === "billing") {
      setActivePanel("profile");
    }
  }, [activePanel, canShowAccountBilling]);

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

  const walletSwitcher = renderWalletSwitcher();

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
            {visibleAccountNavItems.map((item) => {
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
            {visibleAccountNavItems.map((item) => {
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
            <ProfilePanel
              context={context}
              avatar={avatar}
              roleLabel={roleLabel}
              fileInputRef={fileInputRef}
              isUploading={isUploading}
              handleFileChange={handleFileChange}
              canEditAccountFields={canEditAccountFields}
              displayName={displayName}
              setDisplayName={setDisplayName}
              phone={phone}
              setPhone={setPhone}
              canEditDefaultOrganization={canEditDefaultOrganization}
              defaultOrganizationId={defaultOrganizationId}
              setDefaultOrganizationId={setDefaultOrganizationId}
              enterpriseOrganizations={enterpriseOrganizations}
              setProfileMessage={setProfileMessage}
              isPasswordOpen={isPasswordOpen}
              setIsPasswordOpen={setIsPasswordOpen}
              isPasswordSaving={isPasswordSaving}
              passwordForm={passwordForm}
              setPasswordForm={setPasswordForm}
              passwordError={passwordError}
              setPasswordError={setPasswordError}
              passwordMessage={passwordMessage}
              setPasswordMessage={setPasswordMessage}
              handlePasswordChange={handlePasswordChange}
              profileError={profileError}
              profileMessage={profileMessage}
              onClose={onClose}
              handleSave={handleSave}
              isSaving={isSaving}
            />
          ) : null}

          {activePanel === "subscription" ? (
            <SubscriptionPanel
              activeWallet={activeWallet}
              walletBalance={walletBalance}
              walletFrozen={walletFrozen}
              todayConsumption={todayConsumption}
              totalConsumption={totalConsumption}
              consumptionEntries={consumptionEntries}
              walletLoading={walletLoading}
              ledgerLoading={ledgerLoading}
              walletError={walletError}
              walletSwitcher={walletSwitcher}
            />
          ) : null}

          {activePanel === "billing" && canShowAccountBilling ? (
            <BillingPanel
              activeWallet={activeWallet}
              ledgerEntries={ledgerEntries}
              walletLoading={walletLoading}
              ledgerLoading={ledgerLoading}
              walletError={walletError}
              walletSwitcher={walletSwitcher}
            />
          ) : null}
        </main>
      </section>
    </div>
  );
}
