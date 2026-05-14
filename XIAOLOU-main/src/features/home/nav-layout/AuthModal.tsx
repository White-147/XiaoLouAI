import {
  ArrowRight,
  Eye,
  EyeOff,
  Film,
  KeyRound,
  LoaderCircle,
  LogIn,
  X,
} from "lucide-react";
import { type Dispatch, type SetStateAction } from "react";
import { motion } from "motion/react";
import type { RegisterEnterpriseAdminInput, RegisterPersonalInput } from "../../../lib/api";
import { cn } from "../../../lib/utils";
import { GoogleLoginButton } from "../../account-admin-enterprise/auth/GoogleLoginButton";

export type AuthTab = "login" | "register" | "reset";
export type AuthRegisterMode = "personal" | "enterprise_admin";
export type ResetStep = "request" | "complete";

export type LoginFormState = {
  email: string;
  password: string;
};

export type ResetFormState = {
  email: string;
  resetToken: string;
  newPassword: string;
  confirmPassword: string;
};

type AuthModalProps = {
  isOpen: boolean;
  onClose: () => void;
  returnTo: string;
  authTab: AuthTab;
  setAuthTab: Dispatch<SetStateAction<AuthTab>>;
  authRegisterMode: AuthRegisterMode;
  setAuthRegisterMode: Dispatch<SetStateAction<AuthRegisterMode>>;
  authPending: boolean;
  authError: string | null;
  setAuthError: Dispatch<SetStateAction<string | null>>;
  authNotice: string | null;
  setAuthNotice: Dispatch<SetStateAction<string | null>>;
  showPassword: boolean;
  setShowPassword: Dispatch<SetStateAction<boolean>>;
  loginForm: LoginFormState;
  setLoginForm: Dispatch<SetStateAction<LoginFormState>>;
  resetStep: ResetStep;
  setResetStep: Dispatch<SetStateAction<ResetStep>>;
  resetForm: ResetFormState;
  setResetForm: Dispatch<SetStateAction<ResetFormState>>;
  personalForm: RegisterPersonalInput;
  setPersonalForm: Dispatch<SetStateAction<RegisterPersonalInput>>;
  enterpriseForm: RegisterEnterpriseAdminInput;
  setEnterpriseForm: Dispatch<SetStateAction<RegisterEnterpriseAdminInput>>;
  onLogin: () => void | Promise<void>;
  onRequestPasswordReset: () => void | Promise<void>;
  onCompletePasswordReset: () => void | Promise<void>;
  onRegister: () => void | Promise<void>;
};

function AuthField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{props.label}</span>
      <input
        type={props.type || "text"}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder={props.placeholder}
        className="h-10 w-full rounded-xl border border-border/70 bg-background/55 px-3.5 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
      />
    </label>
  );
}

export function AuthModal({
  isOpen,
  onClose,
  returnTo,
  authTab,
  setAuthTab,
  authRegisterMode,
  setAuthRegisterMode,
  authPending,
  authError,
  setAuthError,
  authNotice,
  setAuthNotice,
  showPassword,
  setShowPassword,
  loginForm,
  setLoginForm,
  resetStep,
  setResetStep,
  resetForm,
  setResetForm,
  personalForm,
  setPersonalForm,
  enterpriseForm,
  setEnterpriseForm,
  onLogin,
  onRequestPasswordReset,
  onCompletePasswordReset,
  onRegister,
}: AuthModalProps) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 16 }}
        transition={{ duration: 0.2 }}
        onClick={(event) => event.stopPropagation()}
        className="mx-4 w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
      >
        <div className="relative border-b border-border px-6 pt-6">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary">
                <Film className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">欢迎来到小楼</p>
                <p className="text-xs text-muted-foreground">AI 漫剧创作平台</p>
              </div>
            </div>
            <button
              type="button"
              aria-label="关闭"
              onClick={onClose}
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex">
            <button
              type="button"
              onClick={() => {
                setAuthTab("login");
                setAuthError(null);
                setAuthNotice(null);
              }}
              className={cn(
                "flex-1 border-b-2 pb-3 text-sm font-medium transition-colors",
                authTab === "login" || authTab === "reset"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              登录
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthTab("register");
                setAuthError(null);
                setAuthNotice(null);
              }}
              className={cn(
                "flex-1 border-b-2 pb-3 text-sm font-medium transition-colors",
                authTab === "register"
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              注册
            </button>
          </div>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-6 custom-scrollbar">
          {authTab === "login" ? (
            <div className="space-y-4">
              <GoogleLoginButton returnTo={returnTo} />
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                <span>或使用邮箱登录</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">邮箱</label>
                <input
                  type="email"
                  value={loginForm.email}
                  onChange={(event) => setLoginForm((prev) => ({ ...prev, email: event.target.value }))}
                  placeholder="请输入邮箱地址"
                  className="h-10 w-full rounded-xl border border-border/70 bg-background/55 px-3.5 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">密码</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={loginForm.password}
                    onChange={(event) => setLoginForm((prev) => ({ ...prev, password: event.target.value }))}
                    placeholder="请输入密码"
                    className="h-10 w-full rounded-xl border border-border/70 bg-background/55 px-3.5 pr-10 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    const email = loginForm.email.trim();
                    setResetForm((current) => ({ ...current, email }));
                    setResetStep("request");
                    setAuthTab("reset");
                    setAuthError(null);
                    setAuthNotice(null);
                  }}
                  className="text-xs font-medium text-primary transition hover:text-primary/80"
                >
                  忘记密码？
                </button>
              </div>

              <button
                type="button"
                disabled={authPending || !loginForm.email || !loginForm.password}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
                onClick={() => void onLogin()}
              >
                {authPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <LogIn className="h-4 w-4" />
                )}
                {authPending ? "登录中…" : "登录"}
              </button>

              {authError && authTab === "login" ? (
                <div className="rounded-xl border border-amber-600/40 bg-amber-500/15 px-4 py-3 text-xs leading-5 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200">
                  {authError}
                </div>
              ) : null}

              {authNotice && authTab === "login" ? (
                <div className="rounded-xl border border-primary/20 bg-primary/8 px-4 py-3 text-xs leading-5 text-primary">
                  {authNotice}
                </div>
              ) : null}

              <p className="text-center text-xs text-muted-foreground">
                还没有账号？
                <button
                  type="button"
                  onClick={() => { setAuthTab("register"); setAuthError(null); setAuthNotice(null); }}
                  className="ml-1 text-primary transition hover:text-primary/80"
                >
                  立即注册
                </button>
              </p>
            </div>
          ) : authTab === "reset" ? (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">重置密码</h3>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  输入账号邮箱后获取重置 token，再设置新密码。
                </p>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-muted-foreground">邮箱</label>
                <input
                  type="email"
                  value={resetForm.email}
                  onChange={(event) =>
                    setResetForm((current) => ({ ...current, email: event.target.value }))
                  }
                  placeholder="name@example.com"
                  className="h-10 w-full rounded-xl border border-border/70 bg-background/55 px-3.5 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                />
              </div>

              {resetStep === "complete" ? (
                <div className="space-y-3">
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-muted-foreground">重置 token</label>
                    <input
                      value={resetForm.resetToken}
                      onChange={(event) =>
                        setResetForm((current) => ({ ...current, resetToken: event.target.value }))
                      }
                      className="h-10 w-full rounded-xl border border-border/70 bg-background/55 px-3.5 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                      placeholder="请输入重置 token"
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">新密码</label>
                      <input
                        type="password"
                        value={resetForm.newPassword}
                        onChange={(event) =>
                          setResetForm((current) => ({ ...current, newPassword: event.target.value }))
                        }
                        className="h-10 w-full rounded-xl border border-border/70 bg-background/55 px-3.5 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                        placeholder="设置新密码"
                      />
                    </div>
                    <div>
                      <label className="mb-1.5 block text-xs font-medium text-muted-foreground">确认新密码</label>
                      <input
                        type="password"
                        value={resetForm.confirmPassword}
                        onChange={(event) =>
                          setResetForm((current) => ({ ...current, confirmPassword: event.target.value }))
                        }
                        className="h-10 w-full rounded-xl border border-border/70 bg-background/55 px-3.5 text-sm text-foreground outline-none transition focus:border-primary/50 focus:ring-1 focus:ring-primary/20"
                        placeholder="再次输入新密码"
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              {authError && authTab === "reset" ? (
                <div className="rounded-xl border border-rose-600/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
                  {authError}
                </div>
              ) : null}

              {authNotice && authTab === "reset" ? (
                <div className="rounded-xl border border-primary/20 bg-primary/8 px-4 py-3 text-xs leading-5 text-primary">
                  {authNotice}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() =>
                  resetStep === "request"
                    ? void onRequestPasswordReset()
                    : void onCompletePasswordReset()
                }
                disabled={
                  authPending ||
                  !resetForm.email.trim() ||
                  (resetStep === "complete" &&
                    (!resetForm.resetToken.trim() ||
                      !resetForm.newPassword.trim() ||
                      !resetForm.confirmPassword.trim()))
                }
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
              >
                {authPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {resetStep === "request" ? "发送重置请求" : "保存新密码"}
              </button>

              <p className="text-center text-xs text-muted-foreground">
                想起密码了？
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab("login");
                    setAuthError(null);
                    setAuthNotice(null);
                  }}
                  className="ml-1 text-primary transition hover:text-primary/80"
                >
                  返回登录
                </button>
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <GoogleLoginButton
                returnTo={returnTo}
                label="使用 Google 注册/登录个人账号"
              />
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                <span>或填写资料注册</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="flex h-10 items-center rounded-xl border border-border/70 bg-background/40 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setAuthRegisterMode("personal");
                    setAuthError(null);
                  }}
                  className={cn(
                    "flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition",
                    authRegisterMode === "personal"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  个人用户
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthRegisterMode("enterprise_admin");
                    setAuthError(null);
                  }}
                  className={cn(
                    "flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition",
                    authRegisterMode === "enterprise_admin"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  企业管理员
                </button>
              </div>

              <div className="rounded-xl border border-primary/20 bg-primary/8 px-4 py-3 text-xs leading-5 text-primary">
                {authRegisterMode === "personal"
                  ? "注册后自动开通积分钱包与创作权限。"
                  : "注册后自动创建企业组织、企业积分钱包和管理员身份。"}
              </div>

              {authRegisterMode === "personal" ? (
                <div className="space-y-3">
                  <AuthField
                    label="昵称"
                    value={personalForm.displayName}
                    onChange={(value) => setPersonalForm((prev) => ({ ...prev, displayName: value }))}
                    placeholder="请输入昵称"
                  />
                  <AuthField
                    label="邮箱"
                    value={personalForm.email}
                    onChange={(value) => setPersonalForm((prev) => ({ ...prev, email: value }))}
                    type="email"
                    placeholder="name@example.com"
                  />
                  <AuthField
                    label="手机号（选填）"
                    value={personalForm.phone || ""}
                    onChange={(value) => setPersonalForm((prev) => ({ ...prev, phone: value }))}
                    type="tel"
                    placeholder="用于接收通知"
                  />
                  <AuthField
                    label="密码"
                    value={personalForm.password}
                    onChange={(value) => setPersonalForm((prev) => ({ ...prev, password: value }))}
                    type="password"
                    placeholder="至少 8 位"
                  />
                </div>
              ) : (
                <div className="space-y-3">
                  <AuthField
                    label="企业名称"
                    value={enterpriseForm.companyName}
                    onChange={(value) => setEnterpriseForm((prev) => ({ ...prev, companyName: value }))}
                    placeholder="请输入企业名称"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <AuthField
                      label="管理员姓名"
                      value={enterpriseForm.adminName}
                      onChange={(value) => setEnterpriseForm((prev) => ({ ...prev, adminName: value }))}
                      placeholder="负责人姓名"
                    />
                    <AuthField
                      label="手机号"
                      value={enterpriseForm.phone || ""}
                      onChange={(value) => setEnterpriseForm((prev) => ({ ...prev, phone: value }))}
                      type="tel"
                      placeholder="手机号"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <AuthField
                      label="邮箱"
                      value={enterpriseForm.email}
                      onChange={(value) => setEnterpriseForm((prev) => ({ ...prev, email: value }))}
                      type="email"
                      placeholder="admin@company.com"
                    />
                    <AuthField
                      label="密码"
                      value={enterpriseForm.password}
                      onChange={(value) => setEnterpriseForm((prev) => ({ ...prev, password: value }))}
                      type="password"
                      placeholder="设置密码"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <AuthField
                      label="信用代码（选填）"
                      value={enterpriseForm.licenseNo || ""}
                      onChange={(value) => setEnterpriseForm((prev) => ({ ...prev, licenseNo: value }))}
                      placeholder="统一社会信用代码"
                    />
                    <AuthField
                      label="团队规模（选填）"
                      value={enterpriseForm.teamSize || ""}
                      onChange={(value) => setEnterpriseForm((prev) => ({ ...prev, teamSize: value }))}
                      placeholder="如 11-50"
                    />
                  </div>
                  <AuthField
                    label="行业（选填）"
                    value={enterpriseForm.industry || ""}
                    onChange={(value) => setEnterpriseForm((prev) => ({ ...prev, industry: value }))}
                    placeholder="如 影视、动漫、广告"
                  />
                </div>
              )}

              {authError && authTab === "register" ? (
                <div className="rounded-xl border border-rose-600/40 bg-rose-500/15 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-200">
                  {authError}
                </div>
              ) : null}

              <button
                type="button"
                onClick={() => void onRegister()}
                disabled={authPending}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {authPending ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowRight className="h-4 w-4" />
                )}
                {authRegisterMode === "personal" ? "注册个人用户" : "注册企业管理员"}
              </button>

              <p className="text-center text-xs text-muted-foreground">
                已有账号？
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab("login");
                    setAuthError(null);
                  }}
                  className="ml-1 text-primary transition hover:underline"
                >
                  立即登录
                </button>
              </p>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
