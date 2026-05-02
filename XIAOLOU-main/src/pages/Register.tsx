import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CreditCard,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UserRound,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  listProjects,
  registerEnterpriseAdmin,
  registerPersonalUser,
  type RegisterEnterpriseAdminInput,
  type RegisterPersonalInput,
} from "../lib/api";
import {
  rememberKnownActor,
  setAuthToken,
  setControlApiClientAssertion,
  setCurrentActorId,
} from "../lib/actor-session";
import { setCurrentProjectId } from "../lib/session";
import { cn } from "../lib/utils";
import { isLocalLoopbackAccess } from "../lib/local-loopback";
import { GoogleLoginButton } from "../components/auth/GoogleLoginButton";

type RegisterMode = "personal" | "enterprise_admin";

const ROLE_ROWS = [
  {
    title: "游客",
    scope: "浏览与登录入口",
    note: "不可创建作品",
    tone: "text-slate-200",
  },
  {
    title: "注册用户",
    scope: "创建作品、个人资产库、导出作品、充值",
    note: "默认个人版用户",
    tone: "text-indigo-300",
  },
  {
    title: "企业成员",
    scope: "使用公司资产库、共享项目、团队协作",
    note: "需由企业管理员创建或邀请加入",
    tone: "text-sky-300",
  },
  {
    title: "企业管理员",
    scope: "管理成员、企业积分资产、企业作品、共享权限",
    note: "公开注册只开放到这一层",
    tone: "text-amber-300",
  },
  {
    title: "运营管理员",
    scope: "平台后台角色",
    note: "不开放注册，仅后台配置",
    tone: "text-fuchsia-300",
  },
  {
    title: "超级管理员",
    scope: "系统级配置、审计、权限和风控",
    note: "内部运维 / 平台负责人",
    tone: "text-rose-300",
  },
];

function RegisterField(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  const { label, value, onChange, type = "text", placeholder, autoComplete } = props;

  return (
    <label className="block">
      <span className="mb-2 block text-sm font-medium text-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-12 w-full rounded-2xl border border-border/70 bg-background/55 px-4 text-sm text-foreground outline-none transition focus:border-primary/35 focus:bg-background"
      />
    </label>
  );
}

export default function Register() {
  const navigate = useNavigate();
  const showLocalOnlyRoleCopy = useMemo(() => isLocalLoopbackAccess(), []);
  const roleRows = useMemo(
    () =>
      showLocalOnlyRoleCopy
        ? ROLE_ROWS
        : ROLE_ROWS.filter((row) => row.title !== "超级管理员"),
    [showLocalOnlyRoleCopy],
  );
  const [mode, setMode] = useState<RegisterMode>("personal");
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [personalForm, setPersonalForm] = useState<RegisterPersonalInput>({
    displayName: "",
    email: "",
    phone: "",
    password: "",
  });
  const [enterpriseForm, setEnterpriseForm] = useState<RegisterEnterpriseAdminInput>({
    companyName: "",
    adminName: "",
    email: "",
    phone: "",
    password: "",
    licenseNo: "",
    industry: "",
    teamSize: "",
  });

  const handleSubmit = async () => {
    setPending(true);
    setErrorMessage(null);

    try {
      const result =
        mode === "personal"
          ? await registerPersonalUser(personalForm)
          : await registerEnterpriseAdmin(enterpriseForm);

      rememberKnownActor({
        id: result.actorId,
        label: result.permissionContext.actor.displayName,
        detail: mode === "personal" ? "注册用户" : "企业管理员",
        token: result.token ?? null,
        controlApiClientAssertion: result.controlApiClientAssertion ?? null,
      });
      if (result.token) {
        setAuthToken(result.token);
      }
      setControlApiClientAssertion(result.controlApiClientAssertion);
      setCurrentActorId(result.actorId);
      try {
        const projectResponse = await listProjects();
        const nextProjectId = projectResponse.items[0]?.id;
        if (nextProjectId) {
          setCurrentProjectId(nextProjectId, result.actorId);
        }
      } catch {}
      navigate(mode === "enterprise_admin" ? "/enterprise" : "/home");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "注册失败，请稍后重试。");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 custom-scrollbar sm:px-8">
      <div className="mx-auto grid max-w-7xl gap-8 xl:grid-cols-[minmax(0,1.05fr)_520px]">
        <section className="glass-panel relative overflow-hidden rounded-[32px] p-8 sm:p-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.22),transparent_40%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.16),transparent_35%)]" />

          <div className="relative">
            <span className="dashboard-pill inline-flex bg-primary/12 text-primary">账号注册</span>
            <h1 className="mt-5 max-w-3xl text-3xl font-semibold tracking-tight text-foreground sm:text-5xl">
              个人用户与企业管理员分流注册，平台后台角色不开放公开入口
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
              {showLocalOnlyRoleCopy
                ? "公开注册仅开放“个人用户”和“企业管理员”。企业成员由企业管理员统一创建或邀请加入，运营管理员和超级管理员仅支持后台配置。"
                : "公开注册仅开放“个人用户”和“企业管理员”。企业成员由企业管理员统一创建或邀请加入，运营管理员等后台角色仅支持后台配置。"}
            </p>

            <div className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-border/70 bg-background/40 p-5">
                <UserRound className="h-5 w-5 text-primary" />
                <p className="mt-3 text-base font-medium text-foreground">个人注册</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  默认开通积分钱包、个人资产库和创作能力。
                </p>
              </div>
              <div className="rounded-3xl border border-border/70 bg-background/40 p-5">
                <Building2 className="h-5 w-5 text-primary" />
                <p className="mt-3 text-base font-medium text-foreground">企业管理员注册</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  自动创建企业组织、企业积分钱包和管理员身份，成员由管理员后续创建。
                </p>
              </div>
              <div className="rounded-3xl border border-border/70 bg-background/40 p-5">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <p className="mt-3 text-base font-medium text-foreground">后台角色封闭配置</p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {showLocalOnlyRoleCopy
                    ? "运营管理员、超级管理员只允许平台内部配置，不进入公开注册。"
                    : "运营管理员等后台角色只允许平台内部配置，不进入公开注册。"}
                </p>
              </div>
            </div>

            <div className="mt-8 rounded-[28px] border border-border/70 bg-background/35 p-6">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium text-foreground">
                <BadgeCheck className="h-4 w-4 text-primary" />
                {showLocalOnlyRoleCopy ? "六类账号与权限建议" : "五类账号与权限建议"}
              </div>
              <div className="space-y-3">
                {roleRows.map((item) => (
                  <div
                    key={item.title}
                    className="grid gap-2 rounded-2xl border border-border/60 bg-background/35 px-4 py-4 md:grid-cols-[120px_minmax(0,1fr)_220px]"
                  >
                    <div className={cn("text-sm font-semibold", item.tone)}>{item.title}</div>
                    <div className="text-sm text-foreground">{item.scope}</div>
                    <div className="text-sm text-muted-foreground">{item.note}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="glass-panel rounded-[32px] p-6 sm:p-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">公开注册</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
                {mode === "personal" ? "注册个人用户" : "注册企业管理员"}
              </h2>
            </div>
            <div className="flex h-12 items-center rounded-2xl border border-border/70 bg-background/40 p-1">
              <button
                type="button"
                onClick={() => setMode("personal")}
                className={cn(
                  "rounded-2xl px-4 py-2 text-sm font-medium transition",
                  mode === "personal"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                个人用户
              </button>
              <button
                type="button"
                onClick={() => setMode("enterprise_admin")}
                className={cn(
                  "rounded-2xl px-4 py-2 text-sm font-medium transition",
                  mode === "enterprise_admin"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                企业管理员
              </button>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border border-primary/20 bg-primary/8 p-4 text-sm leading-6 text-primary">
            {mode === "personal"
              ? "注册完成后会自动开通积分钱包与创作权限。"
              : "企业管理员注册完成后，会自动创建企业组织、企业积分钱包和管理员身份。企业员工账号需在企业控制台中创建。"}
          </div>

          <div className="mt-6 space-y-3">
            <GoogleLoginButton
              returnTo="/home"
              label="使用 Google 注册/登录个人账号"
            />
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="h-px flex-1 bg-border" />
              <span>或填写资料注册</span>
              <span className="h-px flex-1 bg-border" />
            </div>
          </div>

          {mode === "personal" ? (
            <div className="mt-6 space-y-4">
              <RegisterField
                label="昵称"
                value={personalForm.displayName}
                onChange={(value) => setPersonalForm((current) => ({ ...current, displayName: value }))}
                placeholder="请输入你的昵称"
                autoComplete="name"
              />
              <RegisterField
                label="邮箱"
                value={personalForm.email}
                onChange={(value) => setPersonalForm((current) => ({ ...current, email: value }))}
                type="email"
                placeholder="name@company.com"
                autoComplete="email"
              />
              <RegisterField
                label="手机号"
                value={personalForm.phone || ""}
                onChange={(value) => setPersonalForm((current) => ({ ...current, phone: value }))}
                type="tel"
                placeholder="选填，用于后续通知"
                autoComplete="tel"
              />
              <RegisterField
                label="密码"
                value={personalForm.password}
                onChange={(value) => setPersonalForm((current) => ({ ...current, password: value }))}
                type="password"
                placeholder="至少 8 位"
                autoComplete="new-password"
              />
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              <RegisterField
                label="企业名称"
                value={enterpriseForm.companyName}
                onChange={(value) => setEnterpriseForm((current) => ({ ...current, companyName: value }))}
                placeholder="请输入企业名称"
                autoComplete="organization"
              />
              <div className="grid gap-4 md:grid-cols-2">
                <RegisterField
                  label="管理员姓名"
                  value={enterpriseForm.adminName}
                  onChange={(value) => setEnterpriseForm((current) => ({ ...current, adminName: value }))}
                  placeholder="请输入负责人姓名"
                  autoComplete="name"
                />
                <RegisterField
                  label="手机号"
                  value={enterpriseForm.phone || ""}
                  onChange={(value) => setEnterpriseForm((current) => ({ ...current, phone: value }))}
                  type="tel"
                  placeholder="请输入手机号"
                  autoComplete="tel"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <RegisterField
                  label="邮箱"
                  value={enterpriseForm.email}
                  onChange={(value) => setEnterpriseForm((current) => ({ ...current, email: value }))}
                  type="email"
                  placeholder="admin@company.com"
                  autoComplete="email"
                />
                <RegisterField
                  label="密码"
                  value={enterpriseForm.password}
                  onChange={(value) => setEnterpriseForm((current) => ({ ...current, password: value }))}
                  type="password"
                  placeholder="设置管理员密码"
                  autoComplete="new-password"
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <RegisterField
                  label="统一社会信用代码"
                  value={enterpriseForm.licenseNo || ""}
                  onChange={(value) => setEnterpriseForm((current) => ({ ...current, licenseNo: value }))}
                  placeholder="选填"
                />
                <RegisterField
                  label="团队规模"
                  value={enterpriseForm.teamSize || ""}
                  onChange={(value) => setEnterpriseForm((current) => ({ ...current, teamSize: value }))}
                  placeholder="例如 11-50"
                />
              </div>
              <RegisterField
                label="行业"
                value={enterpriseForm.industry || ""}
                onChange={(value) => setEnterpriseForm((current) => ({ ...current, industry: value }))}
                placeholder="例如 影视、动漫、广告"
              />

              <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                    <Users className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">企业员工不走公开注册</p>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      企业管理员注册完成后，可在企业控制台中直接创建员工账号，并查看所有员工的积分消耗、冻结和最近任务情况。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
              <CreditCard className="h-4 w-4 text-primary" />
              <p className="mt-3 text-sm font-medium text-foreground">积分钱包</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                注册即开通积分钱包，企业用户使用企业钱包。
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
              <Sparkles className="h-4 w-4 text-primary" />
              <p className="mt-3 text-sm font-medium text-foreground">角色不互斥</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                企业成员和企业管理员都建立在平台注册用户身份之上。
              </p>
            </div>
            <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
              <LockKeyhole className="h-4 w-4 text-primary" />
              <p className="mt-3 text-sm font-medium text-foreground">后台角色封闭</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {showLocalOnlyRoleCopy
                  ? "运营管理员与超级管理员只允许后台配置，不开放公开入口。"
                  : "运营管理员等后台角色只允许后台配置，不开放公开入口。"}
              </p>
            </div>
          </div>

          {errorMessage ? (
            <div className="mt-6 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {errorMessage}
            </div>
          ) : null}

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={pending}
              className="inline-flex min-h-12 items-center gap-2 rounded-2xl bg-primary px-6 py-3 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pending ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRight className="h-4 w-4" />
              )}
              {mode === "personal" ? "注册个人用户" : "注册企业管理员"}
            </button>
            <button
              type="button"
              onClick={() => navigate("/home")}
              className="inline-flex min-h-12 items-center rounded-2xl border border-border/70 bg-background/55 px-5 py-3 text-sm font-medium text-foreground transition hover:bg-secondary/70"
            >
              返回首页
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
