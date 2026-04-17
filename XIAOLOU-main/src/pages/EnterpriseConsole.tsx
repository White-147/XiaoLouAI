import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CreditCard,
  LoaderCircle,
  ShieldCheck,
  UserPlus,
  UserRound,
  Users,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createOrganizationMember,
  getMe,
  getOrganizationWallet,
  listOrganizationMembers,
  listProjects,
  type CreateOrganizationMemberInput,
  type OrganizationMember,
  type PermissionContext,
  type Project,
  type Wallet as WalletInfo,
} from "../lib/api";
import { rememberKnownActor, setCurrentActorId, useActorId } from "../lib/actor-session";
import { cn } from "../lib/utils";

function formatCredits(value: number | null | undefined) {
  if (typeof value !== "number") return "--";
  return `${value.toLocaleString("zh-CN")} 积分`;
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function roleLabel(role: PermissionContext["currentOrganizationRole"] | OrganizationMember["role"]) {
  if (role === "enterprise_admin") return "企业管理员";
  if (role === "enterprise_member") return "企业成员";
  return "未加入企业";
}

function billingPolicyLabel(policy: Project["billingPolicy"] | undefined) {
  if (policy === "personal_only") return "个人项目";
  if (policy === "organization_first_fallback_personal") return "企业优先";
  return "企业扣费";
}

const defaultMemberForm: CreateOrganizationMemberInput = {
  displayName: "",
  email: "",
  phone: "",
  department: "",
  password: "",
  membershipRole: "member",
  canUseOrganizationWallet: true,
};

export default function EnterpriseConsole() {
  const navigate = useNavigate();
  const actorId = useActorId();
  const [me, setMe] = useState<PermissionContext | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [memberForm, setMemberForm] = useState<CreateOrganizationMemberInput>(defaultMemberForm);
  const [creatingMember, setCreatingMember] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdHint, setCreatedHint] = useState<{
    title: string;
    detail: string;
    actorId: string;
    tempPassword: string | null;
  } | null>(null);

  useEffect(() => {
    let active = true;

    const loadEnterprise = async () => {
      setLoading(true);
      try {
        const meResponse = await getMe();
        if (!active) return;
        setMe(meResponse);

        if (!meResponse.currentOrganizationId) {
          setWallet(null);
          setMembers([]);
          setProjects([]);
          return;
        }

        const [walletResponse, memberResponse, projectResponse] = await Promise.all([
          getOrganizationWallet(meResponse.currentOrganizationId),
          listOrganizationMembers(meResponse.currentOrganizationId),
          listProjects(),
        ]);

        if (!active) return;
        setWallet(walletResponse);
        setMembers(memberResponse.items);
        setProjects(
          projectResponse.items.filter((item) => item.organizationId === meResponse.currentOrganizationId),
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadEnterprise();

    return () => {
      active = false;
    };
  }, [actorId]);

  const currentOrganization = useMemo(
    () => me?.organizations.find((item) => item.id === me.currentOrganizationId) ?? null,
    [me],
  );

  const usageSummary = useMemo(() => {
    return members.reduce(
      (summary, member) => {
        const usage = member.usageSummary;
        if (!usage) return summary;
        summary.today += usage.todayUsedCredits;
        summary.month += usage.monthUsedCredits;
        summary.pending += usage.pendingFrozenCredits;
        summary.total += usage.totalUsedCredits;
        return summary;
      },
      { today: 0, month: 0, pending: 0, total: 0 },
    );
  }, [members]);

  const handleCreateMember = async () => {
    if (!me?.currentOrganizationId) return;
    setCreatingMember(true);
    setFormError(null);
    setCreatedHint(null);

    try {
      const result = await createOrganizationMember(me.currentOrganizationId, memberForm);
      rememberKnownActor({
        id: result.actorId,
        label: result.member?.displayName || memberForm.displayName || "企业成员",
        detail: result.member?.role === "enterprise_admin" ? "企业管理员" : "企业成员",
      });
      setMembers((current) => [result.member!, ...current]);
      setMemberForm(defaultMemberForm);
      setCreatedHint({
        title: result.onboarding.title,
        detail: result.onboarding.detail,
        actorId: result.actorId,
        tempPassword: result.onboarding.tempPassword,
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "创建成员失败，请稍后重试。");
    } finally {
      setCreatingMember(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!me?.permissions.canUseEnterprise || !currentOrganization) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-8 custom-scrollbar sm:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="glass-panel rounded-[32px] p-8 sm:p-10">
            <span className="dashboard-pill inline-flex bg-primary/12 text-primary">企业控制台</span>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              当前账号还没有企业上下文
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
              如果你要管理企业成员、企业积分和共享项目，请先前往注册页创建企业管理员账号。企业成员不开放公开注册，只能由企业管理员创建或邀请加入。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate("/register")}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                前往注册页
                <ArrowRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => navigate("/home")}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border/70 bg-background/55 px-5 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary/70"
              >
                返回首页
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-8 custom-scrollbar sm:px-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="glass-panel rounded-[32px] p-8 sm:p-10">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_360px]">
            <div>
              <span className="dashboard-pill inline-flex bg-primary/12 text-primary">企业控制台</span>
              <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                {currentOrganization.name}
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-muted-foreground">
                这里集中处理企业成员创建、企业积分监管、项目预算与共享权限。企业成员由企业管理员统一创建，不走公开注册入口。
              </p>

              <div className="mt-8 grid gap-4 md:grid-cols-4">
                <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
                  <Building2 className="h-5 w-5 text-primary" />
                  <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">当前角色</p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {roleLabel(me.currentOrganizationRole)}
                  </p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
                  <Users className="h-5 w-5 text-primary" />
                  <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">成员总数</p>
                  <p className="mt-2 text-sm font-medium text-foreground">{members.length} 人</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
                  <CreditCard className="h-5 w-5 text-primary" />
                  <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">今日消耗</p>
                  <p className="mt-2 text-sm font-medium text-foreground">{formatCredits(usageSummary.today)}</p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/35 p-4">
                  <ShieldCheck className="h-5 w-5 text-primary" />
                  <p className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">资产库状态</p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {currentOrganization.assetLibraryStatus === "approved" ? "已批准" : "待审核"}
                  </p>
                </div>
              </div>

              <div className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs text-primary">
                <BadgeCheck className="h-4 w-4" />
                {me.permissions.canManageOrganization
                  ? "当前身份可创建员工账号、查看全员积分使用与监管企业预算。"
                  : "当前身份可参与企业项目，但成员创建与积分监管仅开放给企业管理员。"}
              </div>
            </div>

            <aside className="rounded-[28px] border border-border/70 bg-background/35 p-6">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                  <Wallet className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">企业钱包</p>
                  <p className="text-sm font-medium text-foreground">{wallet?.displayName || "企业钱包"}</p>
                </div>
              </div>

              <div className="mt-6 text-3xl font-semibold tracking-tight text-foreground">
                {formatCredits(wallet?.creditsAvailable)}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                冻结 {formatCredits(wallet?.creditsFrozen)}
              </p>

              <div className="mt-6 space-y-3 rounded-2xl border border-border/70 bg-background/30 p-4 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">本月累计消耗</span>
                  <span className="font-medium text-foreground">{formatCredits(usageSummary.month)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">待结算冻结</span>
                  <span className="font-medium text-foreground">{formatCredits(usageSummary.pending)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">累计企业消耗</span>
                  <span className="font-medium text-foreground">{formatCredits(usageSummary.total)}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => navigate("/wallet/recharge")}
                className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-primary transition-colors hover:bg-primary/15"
              >
                <CreditCard className="h-4 w-4" />
                进入充值页
              </button>
            </aside>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
          <div className="glass-panel rounded-[28px] p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">成员创建</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
                  企业员工账号入口
                </h2>
              </div>
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                <UserPlus className="h-5 w-5" />
              </div>
            </div>

            {me.permissions.canManageOrganization ? (
              <>
                <p className="mt-4 text-sm leading-6 text-muted-foreground">
                  创建后会自动加入当前企业，并默认继承企业项目可见范围。你也可以直接创建“企业管理员”角色用于分级管理。
                </p>

                <div className="mt-6 space-y-4">
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-foreground">成员姓名</span>
                    <input
                      value={memberForm.displayName || ""}
                      onChange={(event) =>
                        setMemberForm((current) => ({ ...current, displayName: event.target.value }))
                      }
                      className="h-12 w-full rounded-2xl border border-border/70 bg-background/55 px-4 text-sm text-foreground outline-none transition focus:border-primary/35"
                      placeholder="请输入成员姓名"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-foreground">邮箱</span>
                    <input
                      type="email"
                      value={memberForm.email || ""}
                      onChange={(event) =>
                        setMemberForm((current) => ({ ...current, email: event.target.value }))
                      }
                      className="h-12 w-full rounded-2xl border border-border/70 bg-background/55 px-4 text-sm text-foreground outline-none transition focus:border-primary/35"
                      placeholder="member@company.com"
                    />
                  </label>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-foreground">手机号</span>
                      <input
                        value={memberForm.phone || ""}
                        onChange={(event) =>
                          setMemberForm((current) => ({ ...current, phone: event.target.value }))
                        }
                        className="h-12 w-full rounded-2xl border border-border/70 bg-background/55 px-4 text-sm text-foreground outline-none transition focus:border-primary/35"
                        placeholder="选填"
                      />
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-foreground">部门</span>
                      <input
                        value={memberForm.department || ""}
                        onChange={(event) =>
                          setMemberForm((current) => ({ ...current, department: event.target.value }))
                        }
                        className="h-12 w-full rounded-2xl border border-border/70 bg-background/55 px-4 text-sm text-foreground outline-none transition focus:border-primary/35"
                        placeholder="例如 内容制作部"
                      />
                    </label>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-foreground">角色</span>
                      <select
                        value={memberForm.membershipRole || "member"}
                        onChange={(event) =>
                          setMemberForm((current) => ({
                            ...current,
                            membershipRole: event.target.value as "member" | "admin",
                          }))
                        }
                        className="h-12 w-full rounded-2xl border border-border/70 bg-background/55 px-4 text-sm text-foreground outline-none transition focus:border-primary/35"
                      >
                        <option value="member">企业成员</option>
                        <option value="admin">企业管理员</option>
                      </select>
                    </label>

                    <label className="block">
                      <span className="mb-2 block text-sm font-medium text-foreground">初始密码</span>
                      <input
                        type="text"
                        value={memberForm.password || ""}
                        onChange={(event) =>
                          setMemberForm((current) => ({ ...current, password: event.target.value }))
                        }
                        className="h-12 w-full rounded-2xl border border-border/70 bg-background/55 px-4 text-sm text-foreground outline-none transition focus:border-primary/35"
                        placeholder="留空则自动生成"
                      />
                    </label>
                  </div>

                  <label className="flex items-center gap-3 rounded-2xl border border-border/70 bg-background/35 px-4 py-3 text-sm text-foreground">
                    <input
                      type="checkbox"
                      checked={memberForm.canUseOrganizationWallet !== false}
                      onChange={(event) =>
                        setMemberForm((current) => ({
                          ...current,
                          canUseOrganizationWallet: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-border"
                    />
                    允许该成员使用企业钱包参与企业项目
                  </label>
                </div>

                {formError ? (
                  <div className="mt-5 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                    {formError}
                  </div>
                ) : null}

                {createdHint ? (
                  <div className="mt-5 rounded-2xl border border-indigo-500/20 bg-indigo-500/10 px-4 py-4 text-sm text-indigo-100">
                    <div className="font-medium">{createdHint.title}</div>
                    <div className="mt-1 text-indigo-100/90">{createdHint.detail}</div>
                    <div className="mt-3 space-y-1 text-xs text-indigo-100/80">
                      <div>新账号 Actor ID：{createdHint.actorId}</div>
                      {createdHint.tempPassword ? <div>初始密码：{createdHint.tempPassword}</div> : null}
                    </div>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => void handleCreateMember()}
                  disabled={creatingMember}
                  className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {creatingMember ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <UserPlus className="h-4 w-4" />
                  )}
                  创建成员账号
                </button>
              </>
            ) : (
              <div className="mt-6 rounded-2xl border border-dashed border-border/70 bg-background/20 p-5 text-sm leading-6 text-muted-foreground">
                当前身份是企业成员，只能查看企业数据和自己的积分使用情况；员工创建与权限调整仅开放给企业管理员。
              </div>
            )}
          </div>

          <div className="glass-panel rounded-[28px] p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">成员监管</p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
                  员工积分使用情况
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  企业管理员可以查看所有员工的今日消耗、本月消耗、待结算冻结和最近活动。
                </p>
              </div>
              <div className="rounded-2xl border border-border/70 bg-background/35 px-4 py-3 text-right">
                <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">企业项目</p>
                <p className="mt-2 text-sm font-medium text-foreground">{projects.length} 个</p>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              {members.length ? (
                members.map((member) => {
                  const usage = member.usageSummary;
                  const canPreviewSwitch = me.permissions.canManageOrganization && member.userId !== actorId;

                  return (
                    <div
                      key={member.id}
                      className="rounded-2xl border border-border/70 bg-background/35 p-4"
                    >
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <div className="flex items-start gap-3">
                          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                            <UserRound className="h-5 w-5" />
                          </div>
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-medium text-foreground">{member.displayName}</p>
                              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] text-primary">
                                {roleLabel(member.role)}
                              </span>
                              {member.department ? (
                                <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
                                  {member.department}
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {member.email || member.userId}
                              {member.phone ? ` · ${member.phone}` : ""}
                            </p>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <div className="rounded-2xl border border-border/60 bg-background/45 px-3 py-3">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                              今日消耗
                            </div>
                            <div className="mt-2 text-sm font-medium text-foreground">
                              {usage ? formatCredits(usage.todayUsedCredits) : "仅本人可见"}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-border/60 bg-background/45 px-3 py-3">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                              本月消耗
                            </div>
                            <div className="mt-2 text-sm font-medium text-foreground">
                              {usage ? formatCredits(usage.monthUsedCredits) : "仅本人可见"}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-border/60 bg-background/45 px-3 py-3">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                              待结算冻结
                            </div>
                            <div className="mt-2 text-sm font-medium text-foreground">
                              {usage ? formatCredits(usage.pendingFrozenCredits) : "仅本人可见"}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-border/60 bg-background/45 px-3 py-3">
                            <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                              最近活动
                            </div>
                            <div className="mt-2 text-sm font-medium text-foreground">
                              {usage ? formatShortDate(usage.lastActivityAt) : "仅本人可见"}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
                        <div className="text-muted-foreground">
                          企业钱包权限：{member.canUseOrganizationWallet === false ? "关闭" : "开启"} · 最近任务
                          {usage ? ` ${usage.recentTaskCount} 个` : " --"}
                        </div>

                        <div className="flex flex-wrap gap-3">
                          {canPreviewSwitch ? (
                            <button
                              type="button"
                              onClick={() => {
                                rememberKnownActor({
                                  id: member.userId,
                                  label: member.displayName,
                                  detail: member.role === "enterprise_admin" ? "企业管理员" : "企业成员",
                                });
                                setCurrentActorId(member.userId);
                                navigate("/home");
                              }}
                              className="inline-flex min-h-10 items-center rounded-xl border border-border/70 bg-background/60 px-4 py-2 text-sm font-medium text-foreground transition hover:bg-secondary/70"
                            >
                              切换为该成员预览
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed border-border/70 bg-background/20 p-5 text-sm text-muted-foreground">
                  当前企业下还没有成员账号。你可以先在左侧表单中创建企业员工账号。
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="glass-panel rounded-[28px] p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">企业项目</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">项目预算与扣费策略</h2>
            </div>
            <button
              type="button"
              onClick={() => navigate("/home")}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-border/70 bg-background/55 px-4 py-2 text-sm font-medium text-foreground transition hover:bg-secondary/70"
            >
              返回首页
            </button>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {projects.length ? (
              projects.map((project) => (
                <div key={project.id} className="rounded-2xl border border-border/70 bg-background/35 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">{project.title}</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        预算 {formatCredits(project.budgetLimitCredits ?? project.budgetCredits)} · 已用{" "}
                        {formatCredits(project.budgetUsedCredits ?? 0)}
                      </p>
                    </div>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
                      {billingPolicyLabel(project.billingPolicy)}
                    </span>
                  </div>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        "h-full rounded-full",
                        (project.budgetUsedCredits ?? 0) >= (project.budgetLimitCredits ?? project.budgetCredits)
                          ? "bg-rose-400"
                          : "bg-primary",
                      )}
                      style={{
                        width: `${Math.min(
                          100,
                          Math.round(
                            (((project.budgetUsedCredits ?? 0) /
                              Math.max(1, project.budgetLimitCredits ?? project.budgetCredits)) *
                              100),
                          ),
                        )}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-border/70 bg-background/20 p-5 text-sm text-muted-foreground">
                当前企业下还没有企业项目。企业管理员可以在首页直接创建企业项目。
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
