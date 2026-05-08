import { Building2, Camera, KeyRound, LoaderCircle, Mail, Phone, User as UserIcon, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { changePassword, uploadFile, type PermissionContext, updateMe } from "../../lib/api";
import { mergeProfileUpdateContext, resolveAvatarUploadUrl } from "../../lib/api/profile-avatar";
import { cn } from "../../lib/utils";

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  context: PermissionContext | null;
  onUpdateContext: (context: PermissionContext) => void;
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
  const canEditAccountFields =
    context?.currentOrganizationRole !== "enterprise_member" ||
    context?.permissions.canManageOrganization === true;
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [defaultOrganizationId, setDefaultOrganizationId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPasswordOpen, setIsPasswordOpen] = useState(false);
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && context) {
      setDisplayName(context.actor.displayName || "");
      setAvatar(context.actor.avatar || null);
      setPhone(context.actor.phone || "");
      setDefaultOrganizationId(
        context.actor.defaultOrganizationId ||
          context.currentOrganizationId ||
          enterpriseOrganizations[0]?.id ||
          "",
      );
      setError(null);
      setIsPasswordOpen(false);
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordError(null);
      setPasswordMessage(null);
    }
  }, [enterpriseOrganizations, isOpen, context]);

  if (!isOpen || !context) return null;

  const handleSave = async () => {
    const username = canEditAccountFields ? displayName.trim() : context.actor.displayName || "";
    if ((canEditAccountFields && !username) || isUploading) return;
    setIsSaving(true);
    setError(null);
    try {
      const profilePatch = canEditAccountFields
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
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "账号资料保存失败，请稍后重试。");
    } finally {
      setIsSaving(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setError(null);
    const localPreview = URL.createObjectURL(file);
    setAvatar(localPreview);

    try {
      const uploaded = await uploadFile(file, "avatar");
      setAvatar(resolveAvatarUploadUrl(uploaded));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "头像上传失败，请重试。");
      setAvatar(context.actor.avatar || null);
    } finally {
      URL.revokeObjectURL(localPreview);
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handlePasswordChange = async () => {
    setPasswordError(null);
    setPasswordMessage(null);

    if (!passwordForm.currentPassword.trim() || !passwordForm.newPassword.trim()) {
      setPasswordError("请填写当前密码和新密码。");
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("两次输入的新密码不一致。");
      return;
    }

    setIsPasswordSaving(true);
    try {
      await changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setPasswordMessage("密码已更新。");
      setIsPasswordOpen(false);
    } catch (caught) {
      setPasswordError(caught instanceof Error ? caught.message : "密码修改失败，请稍后重试。");
    } finally {
      setIsPasswordSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/80 px-4 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <button
          type="button"
          aria-label="关闭弹窗"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="pr-10">
          <h2 className="text-xl font-semibold text-foreground">账号与个人资料</h2>
          <p className="mt-1 text-sm text-muted-foreground">头像、用户名和联系方式会用于站内身份展示。</p>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-[180px_1fr]">
          <div className="flex flex-col items-center gap-4 rounded-xl border border-border/70 bg-background/40 p-5">
            <div className="relative group">
              <div className="relative flex h-24 w-24 overflow-hidden rounded-full border-4 border-background bg-muted shadow-sm">
                {avatar ? (
                  <img src={avatar} alt="Avatar" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-primary/10 text-primary">
                    <UserIcon className="h-10 w-10" />
                  </div>
                )}

                {isUploading ? (
                  <div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-sm">
                    <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                aria-label="上传头像"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploading}
                className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground shadow-sm transition-transform hover:scale-105 disabled:opacity-60"
              >
                <Camera className="h-4 w-4" />
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/png, image/jpeg, image/webp"
                className="hidden"
              />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-foreground">{context.actor.displayName}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {context.currentOrganizationRole === "enterprise_admin"
                  ? "企业管理员"
                  : context.currentOrganizationRole === "enterprise_member"
                    ? "企业成员"
                    : context.platformRole === "ops_admin"
                      ? "运营管理员"
                      : context.platformRole === "super_admin"
                        ? "超级管理员"
                        : "个人账号"}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="displayName" className="text-sm font-medium text-foreground">
                用户名
              </label>
              {canEditAccountFields ? (
                <input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/30"
                  placeholder="输入用户名"
                  maxLength={30}
                />
              ) : (
                <div className="flex min-h-10 items-center rounded-lg border border-border/50 bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                  {context.actor.displayName || context.actor.id}
                </div>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-foreground">邮箱</label>
                <div
                  className={cn(
                    "flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm",
                    context.actor.email
                      ? "border-border/50 bg-muted/50 text-muted-foreground"
                      : "border-destructive/30 bg-destructive/5 text-destructive",
                  )}
                >
                  <Mail className="h-4 w-4 shrink-0" />
                  <span className="min-w-0 truncate">{context.actor.email || "未绑定邮箱"}</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="phone" className="text-sm font-medium text-foreground">
                  手机号
                </label>
                {canEditAccountFields ? (
                  <div className="relative">
                    <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      id="phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/30"
                      placeholder="可选"
                    />
                  </div>
                ) : (
                  <div className="flex min-h-10 items-center gap-2 rounded-lg border border-border/50 bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                    <Phone className="h-4 w-4 shrink-0" />
                    <span>{context.actor.phone || "未绑定手机号"}</span>
                  </div>
                )}
              </div>
            </div>

            {canEditAccountFields && canEditDefaultOrganization ? (
              <div className="space-y-1.5">
                <label htmlFor="defaultOrganization" className="text-sm font-medium text-foreground">
                  默认组织
                </label>
                <div className="relative">
                  <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <select
                    id="defaultOrganization"
                    value={defaultOrganizationId}
                    onChange={(event) => setDefaultOrganizationId(event.target.value)}
                    className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/30"
                  >
                    {enterpriseOrganizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ) : null}

            {canEditAccountFields ? (
            <div className="rounded-xl border border-border/70 bg-background/35 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <KeyRound className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">修改密码</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">更新当前账号的登录密码</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsPasswordOpen((open) => !open);
                    setPasswordError(null);
                    setPasswordMessage(null);
                  }}
                  className="rounded-lg border border-border/70 bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                >
                  {isPasswordOpen ? "收起" : "修改"}
                </button>
              </div>

              {isPasswordOpen ? (
                <div className="mt-4 grid grid-cols-1 gap-3">
                  <input
                    type="password"
                    value={passwordForm.currentPassword}
                    onChange={(event) =>
                      setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))
                    }
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/30"
                    placeholder="当前密码"
                  />
                  <input
                    type="password"
                    value={passwordForm.newPassword}
                    onChange={(event) =>
                      setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))
                    }
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/30"
                    placeholder="新密码"
                  />
                  <input
                    type="password"
                    value={passwordForm.confirmPassword}
                    onChange={(event) =>
                      setPasswordForm((current) => ({ ...current, confirmPassword: event.target.value }))
                    }
                    className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary/30"
                    placeholder="确认新密码"
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handlePasswordChange()}
                      disabled={isPasswordSaving}
                      className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      {isPasswordSaving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                      保存新密码
                    </button>
                  </div>
                </div>
              ) : null}

              {passwordError ? (
                <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  {passwordError}
                </div>
              ) : null}
              {passwordMessage ? (
                <div className="mt-3 rounded-lg border border-primary/20 bg-primary/8 px-3 py-2 text-xs text-primary">
                  {passwordMessage}
                </div>
              ) : null}
            </div>
            ) : null}

            {error ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-8 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving || isUploading || (canEditAccountFields && !displayName.trim())}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            {canEditAccountFields ? "保存修改" : "保存头像"}
          </button>
        </div>
      </div>
    </div>
  );
}
