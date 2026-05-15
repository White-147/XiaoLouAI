import {
  Building2,
  Camera,
  ChevronDown,
  KeyRound,
  LoaderCircle,
  Mail,
  Phone,
  ShieldCheck,
  User as UserIcon,
} from "lucide-react";
import { type ChangeEvent, type Dispatch, type RefObject, type SetStateAction } from "react";
import type { PermissionContext } from "../../../lib/api";

export type PasswordFormState = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

type ProfilePanelProps = {
  context: PermissionContext;
  avatar: string | null;
  roleLabel: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  isUploading: boolean;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  canEditAccountFields: boolean;
  displayName: string;
  setDisplayName: Dispatch<SetStateAction<string>>;
  phone: string;
  setPhone: Dispatch<SetStateAction<string>>;
  canEditDefaultOrganization: boolean;
  defaultOrganizationId: string;
  setDefaultOrganizationId: Dispatch<SetStateAction<string>>;
  enterpriseOrganizations: PermissionContext["organizations"];
  setProfileMessage: Dispatch<SetStateAction<string | null>>;
  isPasswordOpen: boolean;
  setIsPasswordOpen: Dispatch<SetStateAction<boolean>>;
  isPasswordSaving: boolean;
  passwordForm: PasswordFormState;
  setPasswordForm: Dispatch<SetStateAction<PasswordFormState>>;
  passwordError: string | null;
  setPasswordError: Dispatch<SetStateAction<string | null>>;
  passwordMessage: string | null;
  setPasswordMessage: Dispatch<SetStateAction<string | null>>;
  handlePasswordChange: () => void | Promise<void>;
  profileError: string | null;
  profileMessage: string | null;
  onClose: () => void;
  handleSave: () => void | Promise<void>;
  isSaving: boolean;
};

export function ProfilePanel({
  context,
  avatar,
  roleLabel,
  fileInputRef,
  isUploading,
  handleFileChange,
  canEditAccountFields,
  displayName,
  setDisplayName,
  phone,
  setPhone,
  canEditDefaultOrganization,
  defaultOrganizationId,
  setDefaultOrganizationId,
  enterpriseOrganizations,
  setProfileMessage,
  isPasswordOpen,
  setIsPasswordOpen,
  isPasswordSaving,
  passwordForm,
  setPasswordForm,
  passwordError,
  setPasswordError,
  passwordMessage,
  setPasswordMessage,
  handlePasswordChange,
  profileError,
  profileMessage,
  onClose,
  handleSave,
  isSaving,
}: ProfilePanelProps) {
  return (
    <div>
      <header>
        <p className="text-sm font-medium text-muted-foreground">账号中心</p>
        <h2 className="mt-1 text-2xl font-semibold tracking-normal text-foreground">
          账号与个人资料
        </h2>
      </header>

      <section className="mt-7 flex flex-col gap-5 lg:flex-row">
        <div className="flex w-full shrink-0 flex-col items-center rounded-2xl border border-border bg-muted/50 p-5 lg:w-56">
          <div className="relative">
            <div className="relative flex h-24 w-24 overflow-hidden rounded-full bg-muted text-muted-foreground">
              {avatar ? (
                <img src={avatar} alt="Avatar" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <UserIcon className="h-10 w-10" />
                </div>
              )}

              {isUploading ? (
                <div className="absolute inset-0 flex items-center justify-center bg-background/70 backdrop-blur-sm">
                  <LoaderCircle className="h-6 w-6 animate-spin text-foreground" />
                </div>
              ) : null}
            </div>
            <button
              type="button"
              aria-label="上传头像"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform hover:scale-105 disabled:opacity-60"
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
            <div className="text-sm font-semibold text-foreground">
              {context.actor.displayName || context.actor.id}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{roleLabel}</div>
          </div>
        </div>

        <div className="min-w-0 flex-1 space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-foreground">用户名</span>
              {canEditAccountFields ? (
                <input
                  type="text"
                  value={displayName}
                  onChange={(event) => {
                    setDisplayName(event.currentTarget.value);
                    setProfileMessage(null);
                  }}
                  maxLength={30}
                  className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                  placeholder="输入用户名"
                />
              ) : (
                <div className="flex h-11 items-center rounded-lg border border-border bg-muted px-3 text-sm text-muted-foreground">
                  {context.actor.displayName || context.actor.id}
                </div>
              )}
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-foreground">邮箱</span>
              <div className="flex h-11 items-center gap-2 rounded-lg border border-border bg-muted px-3 text-sm text-muted-foreground">
                <Mail className="h-4 w-4 shrink-0" />
                <span className="min-w-0 truncate">{context.actor.email || "未绑定邮箱"}</span>
              </div>
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-foreground">手机号</span>
              {canEditAccountFields ? (
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(event) => {
                      setPhone(event.currentTarget.value);
                      setProfileMessage(null);
                    }}
                    className="h-11 w-full rounded-lg border border-input bg-background py-0 pl-9 pr-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                    placeholder="可选"
                  />
                </div>
              ) : (
                <div className="flex h-11 items-center gap-2 rounded-lg border border-border bg-muted px-3 text-sm text-muted-foreground">
                  <Phone className="h-4 w-4 shrink-0" />
                  <span>{context.actor.phone || "未绑定手机号"}</span>
                </div>
              )}
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-foreground">身份</span>
              <div className="flex h-11 items-center gap-2 rounded-lg border border-border bg-muted px-3 text-sm text-muted-foreground">
                <ShieldCheck className="h-4 w-4 shrink-0" />
                {roleLabel}
              </div>
            </label>
          </div>

          {canEditAccountFields && canEditDefaultOrganization ? (
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-foreground">默认组织</span>
              <div className="relative">
                <Building2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <select
                  value={defaultOrganizationId}
                  onChange={(event) => {
                    setDefaultOrganizationId(event.currentTarget.value);
                    setProfileMessage(null);
                  }}
                  className="h-11 w-full appearance-none rounded-lg border border-input bg-background py-0 pl-9 pr-9 text-sm text-foreground outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/20"
                >
                  <option value="">不默认进入企业</option>
                  {enterpriseOrganizations.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.name}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              </div>
            </label>
          ) : null}

          {canEditAccountFields ? (
            <section className="rounded-2xl border border-border bg-muted/50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-card text-muted-foreground shadow-sm">
                    <KeyRound className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">登录密码</h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">
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
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
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
                    className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
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
                      className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
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
                      className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20"
                      placeholder="确认新密码"
                    />
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handlePasswordChange()}
                      disabled={isPasswordSaving}
                      className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      {isPasswordSaving ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : null}
                      保存新密码
                    </button>
                  </div>
                </div>
              ) : null}

              {passwordError ? (
                <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {passwordError}
                </div>
              ) : null}
              {passwordMessage ? (
                <div className="mt-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">
                  {passwordMessage}
                </div>
              ) : null}
            </section>
          ) : null}

          {profileError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {profileError}
            </div>
          ) : null}
          {profileMessage ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
              {profileMessage}
            </div>
          ) : null}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              取消
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || isUploading || (canEditAccountFields && !displayName.trim())}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              {canEditAccountFields ? "保存修改" : "保存头像"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
