import {
  ArrowRight,
  BadgeCheck,
  Building2,
  CreditCard,
  KeyRound,
  LoaderCircle,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserPlus,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createOrganizationMember,
  deleteOrganizationMemberAccount,
  getMe,
  getOrganizationWallet,
  listOrganizationMembers,
  listProjects,
  type CreateOrganizationMemberInput,
  type OrganizationMember,
  type PermissionContext,
  type Project,
  type UpdateOrganizationMemberAccountInput,
  type Wallet as WalletInfo,
  updateOrganizationMemberAccount,
} from "../lib/api";
import { rememberKnownActor, setCurrentActorId, useActorId } from "../lib/actor-session";

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

type MemberSearchTarget = "monitor" | "accounts";

type MemberAccountForm = {
  displayName: string;
  email: string;
  phone: string;
  department: string;
  membershipRole: "member" | "admin";
  canUseOrganizationWallet: boolean;
  newPassword: string;
  confirmPassword: string;
};

function memberAccountFormFrom(member: OrganizationMember): MemberAccountForm {
  return {
    displayName: member.displayName || "",
    email: member.email || "",
    phone: member.phone || "",
    department: member.department || "",
    membershipRole: member.membershipRole || "member",
    canUseOrganizationWallet: member.canUseOrganizationWallet !== false,
    newPassword: "",
    confirmPassword: "",
  };
}

function normalizeSearchText(value: string) {
  return value.trim().toLowerCase();
}

function memberMatchesSearch(member: OrganizationMember, query: string) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return true;
  return [
    member.displayName,
    member.userId,
    member.phone,
    member.email,
  ].some((value) => value?.toLowerCase().includes(normalized));
}

function mergeOrganizationMembers(
  current: OrganizationMember[],
  incoming: OrganizationMember[],
) {
  const next = new Map(current.map((member) => [member.userId, member]));
  for (const member of incoming) {
    next.set(member.userId, member);
  }
  return Array.from(next.values()).sort((left, right) =>
    (right.updatedAt || "").localeCompare(left.updatedAt || ""),
  );
}

export default function EnterpriseConsole() {
  const navigate = useNavigate();
  const actorId = useActorId();
  const [me, setMe] = useState<PermissionContext | null>(null);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [memberModule, setMemberModule] = useState<"create" | "monitor" | "accounts">("create");
  const [memberForm, setMemberForm] = useState<CreateOrganizationMemberInput>(defaultMemberForm);
  const [creatingMember, setCreatingMember] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountHint, setAccountHint] = useState<string | null>(null);
  const [monitorSearch, setMonitorSearch] = useState("");
  const [accountSearch, setAccountSearch] = useState("");
  const [searchingMembersFor, setSearchingMembersFor] = useState<MemberSearchTarget | null>(null);
  const [savingMemberId, setSavingMemberId] = useState<string | null>(null);
  const [deletingMemberId, setDeletingMemberId] = useState<string | null>(null);
  const [deleteMemberTarget, setDeleteMemberTarget] = useState<OrganizationMember | null>(null);
  const [memberAccountForms, setMemberAccountForms] = useState<Record<string, MemberAccountForm>>({});
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
  const isSuperAdmin = me?.platformRole === "super_admin";
  const canUseEnterpriseManagement = me?.currentOrganizationRole === "enterprise_admin";

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

  const monitorMembers = useMemo(
    () => members.filter((member) => memberMatchesSearch(member, monitorSearch)),
    [members, monitorSearch],
  );
  const accountMembers = useMemo(
    () => members.filter((member) => memberMatchesSearch(member, accountSearch)),
    [members, accountSearch],
  );

  const handleSearchMembers = async (target: MemberSearchTarget) => {
    if (!me?.currentOrganizationId) return;
    const query = target === "monitor" ? monitorSearch : accountSearch;
    setSearchingMembersFor(target);
    setAccountError(null);
    setAccountHint(null);
    try {
      const response = await listOrganizationMembers(me.currentOrganizationId, query);
      if (query.trim()) {
        setMembers((current) => mergeOrganizationMembers(current, response.items));
        if (response.items.length === 0) {
          setAccountHint("没有找到匹配的成员账号。");
        }
      } else {
        setMembers(response.items);
      }
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "成员查询失败，请稍后重试。");
    } finally {
      setSearchingMembersFor(null);
    }
  };

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

  const updateMemberAccountForm = (member: OrganizationMember, patch: Partial<MemberAccountForm>) => {
    setMemberAccountForms((current) => ({
      ...current,
      [member.userId]: {
        ...(current[member.userId] ?? memberAccountFormFrom(member)),
        ...patch,
      },
    }));
  };

  const handleSaveMemberAccount = async (member: OrganizationMember) => {
    if (!me?.currentOrganizationId || !me.permissions.canManageOrganization) return;
    const form = memberAccountForms[member.userId] ?? memberAccountFormFrom(member);
    setAccountError(null);
    setAccountHint(null);

    if (!form.displayName.trim()) {
      setAccountError("请填写用户名。");
      return;
    }

    if (!form.email.trim()) {
      setAccountError("请填写邮箱。");
      return;
    }

    if (form.newPassword.trim() && form.newPassword !== form.confirmPassword) {
      setAccountError("两次输入的新密码不一致。");
      return;
    }

    setSavingMemberId(member.userId);
    try {
      const input: UpdateOrganizationMemberAccountInput = {
        displayName: form.displayName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        department: form.department.trim() || null,
        membershipRole: form.membershipRole,
        canUseOrganizationWallet: form.canUseOrganizationWallet,
        ...(form.newPassword.trim() ? { newPassword: form.newPassword } : {}),
      };
      const updated = await updateOrganizationMemberAccount(
        me.currentOrganizationId,
        member.userId,
        input,
      );
      setMembers((current) =>
        current.map((item) => (item.userId === updated.userId ? updated : item)),
      );
      setMemberAccountForms((current) => ({
        ...current,
        [updated.userId]: memberAccountFormFrom(updated),
      }));
      setAccountHint(`已保存 ${updated.displayName || updated.email || updated.userId} 的账号资料。`);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "保存员工账号失败，请稍后重试。");
    } finally {
      setSavingMemberId(null);
    }
  };

  const handleDeleteMemberAccount = (member: OrganizationMember) => {
    if (!me?.currentOrganizationId || !me.permissions.canManageOrganization) return;
    if (member.userId === actorId) {
      setAccountError("不能在这里删除当前管理员账号。");
      return;
    }

    setAccountError(null);
    setAccountHint(null);
    setDeleteMemberTarget(member);
  };

  const confirmDeleteMemberAccount = async () => {
    if (!me?.currentOrganizationId || !deleteMemberTarget) return;
    const member = deleteMemberTarget;

    setDeletingMemberId(member.userId);
    setAccountError(null);
    setAccountHint(null);
    try {
      await deleteOrganizationMemberAccount(me.currentOrganizationId, member.userId);
      setMembers((current) => current.filter((item) => item.userId !== member.userId));
      setMemberAccountForms((current) => {
        const next = { ...current };
        delete next[member.userId];
        return next;
      });
      setAccountHint(`已删除 ${member.displayName || member.email || member.userId} 的员工账号。`);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "删除员工账号失败，请稍后重试。");
    } finally {
      setDeletingMemberId(null);
      setDeleteMemberTarget(null);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (isSuperAdmin && !currentOrganization) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-8 custom-scrollbar sm:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="glass-panel rounded-[32px] p-8 sm:p-10">
            <span className="dashboard-pill inline-flex bg-primary/12 text-primary">管理面板</span>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              超级管理员后台
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
              超级管理员不绑定单个企业上下文，平台级审核与统计建议放在后台入口中统一处理。
            </p>
            <button
              type="button"
              onClick={() => navigate("/admin/orders")}
              className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              进入后台
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!canUseEnterpriseManagement || !currentOrganization) {
    return (
      <div className="flex-1 overflow-y-auto px-6 py-8 custom-scrollbar sm:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="glass-panel rounded-[32px] p-8 sm:p-10">
            <span className="dashboard-pill inline-flex bg-primary/12 text-primary">管理面板</span>
            <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              当前账号没有管理面板权限
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground">
              只有企业管理员和超级管理员可以进入管理面板。企业成员可继续使用企业项目，但成员监管、账号管理和企业钱包统计由企业管理员处理。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate("/home")}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
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
                这里集中处理企业成员创建、企业积分监管、共享权限与企业钱包扣费。企业成员由企业管理员统一创建，不走公开注册入口。
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
                  ? "当前身份可创建员工账号、查看全员积分使用与企业钱包扣费。"
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

        <section className="glass-panel rounded-[28px] p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex h-10 items-center rounded-xl border border-border/70 bg-background/35 p-1">
              {[
                ["create", "成员创建"],
                ["monitor", "成员监管"],
                ["accounts", "员工账号管理"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setMemberModule(value as "create" | "monitor" | "accounts");
                    setFormError(null);
                    setAccountError(null);
                    setAccountHint(null);
                  }}
                  className={`h-8 rounded-lg px-3 text-sm font-medium transition ${
                    memberModule === value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="text-xs text-muted-foreground">
              {members.length} 个账号 · {projects.length} 个企业项目
            </div>
          </div>

          <div className="mt-6">
          {memberModule === "create" ? (
          <div>
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
          ) : null}

          {memberModule === "monitor" ? (
          <div>
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

            <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/35 p-3 sm:flex-row sm:items-center">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  value={monitorSearch}
                  onChange={(event) => setMonitorSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      void handleSearchMembers("monitor");
                    }
                  }}
                  className="h-10 w-full rounded-xl border border-border/70 bg-background/55 pl-9 pr-3 text-sm text-foreground outline-none transition focus:border-primary/35"
                  placeholder="按用户名 / User ID / 手机号 / 邮箱查询"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleSearchMembers("monitor")}
                disabled={searchingMembersFor === "monitor"}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border/70 bg-background/60 px-4 text-sm font-medium text-foreground transition hover:bg-secondary/70 disabled:opacity-60"
              >
                {searchingMembersFor === "monitor" ? (
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
                查询
              </button>
            </div>

            <div className="mt-6 space-y-3">
              {monitorMembers.length ? (
                monitorMembers.map((member) => {
                  const usage = member.usageSummary;
                  const usageSeries = (usage?.series ?? []).slice(-14);
                  const maxSeriesCredits = Math.max(
                    1,
                    ...usageSeries.map((point) => point.consumedCredits + point.refundedCredits),
                  );
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

                      <div className="mt-4 rounded-2xl border border-border/60 bg-background/30 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-xs font-medium text-foreground">分时消耗</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">最近 14 天按日聚合</p>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            合计 {formatCredits(usage?.totalUsedCredits)}
                          </div>
                        </div>
                        {usageSeries.length ? (
                          <div className="mt-3 flex h-20 items-end gap-1.5">
                            {usageSeries.map((point) => {
                              const consumedHeight = Math.max(
                                4,
                                Math.round((point.consumedCredits / maxSeriesCredits) * 64),
                              );
                              return (
                                <div key={point.bucketStart} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                                  <div className="flex h-16 w-full items-end justify-center rounded-md bg-background/45 px-1">
                                    <div
                                      className="w-full max-w-5 rounded-t bg-primary/70"
                                      style={{ height: `${consumedHeight}px` }}
                                      title={`${point.bucketLabel} · ${formatCredits(point.consumedCredits)}`}
                                    />
                                  </div>
                                  <span className="w-full truncate text-center text-[10px] text-muted-foreground">
                                    {point.bucketLabel}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="mt-3 rounded-xl border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">
                            暂无分时消耗记录
                          </div>
                        )}
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
                  {monitorSearch.trim()
                    ? "没有找到匹配的成员。"
                    : "当前企业下还没有成员账号。你可以先在左侧表单中创建企业员工账号。"}
                </div>
              )}
            </div>
          </div>
          ) : null}

          {memberModule === "accounts" ? (
            <div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">员工账号管理</p>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
                    编辑员工账号
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    企业管理员可以统一维护员工用户名、邮箱、手机号、企业角色和登录密码，离职账号可直接删除。
                  </p>
                </div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 text-primary">
                  <KeyRound className="h-5 w-5" />
                </div>
              </div>

              <div className="mt-6 flex flex-col gap-3 rounded-2xl border border-border/70 bg-background/35 p-3 sm:flex-row sm:items-center">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    value={accountSearch}
                    onChange={(event) => setAccountSearch(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void handleSearchMembers("accounts");
                      }
                    }}
                    className="h-10 w-full rounded-xl border border-border/70 bg-background/55 pl-9 pr-3 text-sm text-foreground outline-none transition focus:border-primary/35"
                    placeholder="按用户名 / User ID / 手机号 / 邮箱查询"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => void handleSearchMembers("accounts")}
                  disabled={searchingMembersFor === "accounts"}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border/70 bg-background/60 px-4 text-sm font-medium text-foreground transition hover:bg-secondary/70 disabled:opacity-60"
                >
                  {searchingMembersFor === "accounts" ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  查询
                </button>
              </div>

              {accountError ? (
                <div className="mt-5 rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                  {accountError}
                </div>
              ) : null}

              {accountHint ? (
                <div className="mt-5 rounded-2xl border border-primary/20 bg-primary/8 px-4 py-3 text-sm text-primary">
                  {accountHint}
                </div>
              ) : null}

              <div className="mt-6 space-y-3">
                {accountMembers.length ? (
                  accountMembers.map((member) => {
                    const form = memberAccountForms[member.userId] ?? memberAccountFormFrom(member);
                    const isSavingThisMember = savingMemberId === member.userId;
                    const isDeletingThisMember = deletingMemberId === member.userId;
                    const canDeleteThisMember = member.userId !== actorId;

                    return (
                      <div key={member.id} className="rounded-2xl border border-border/70 bg-background/35 p-4">
                        <div className="flex flex-col gap-4">
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
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                {member.email || member.userId}
                                {member.phone ? ` · ${member.phone}` : ""}
                              </p>
                              <p className="mt-1 text-[11px] text-muted-foreground">User ID: {member.userId}</p>
                            </div>
                          </div>

                          {me.permissions.canManageOrganization ? (
                            <div className="space-y-4">
                              <div className="grid gap-3 md:grid-cols-3">
                                <label className="block">
                                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">用户名</span>
                                  <input
                                    type="text"
                                    value={form.displayName}
                                    onChange={(event) => updateMemberAccountForm(member, { displayName: event.target.value })}
                                    className="h-10 w-full rounded-xl border border-border/70 bg-background/55 px-3 text-sm text-foreground outline-none transition focus:border-primary/35"
                                  />
                                </label>
                                <label className="block">
                                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">邮箱</span>
                                  <input
                                    type="email"
                                    value={form.email}
                                    onChange={(event) => updateMemberAccountForm(member, { email: event.target.value })}
                                    className="h-10 w-full rounded-xl border border-border/70 bg-background/55 px-3 text-sm text-foreground outline-none transition focus:border-primary/35"
                                  />
                                </label>
                                <label className="block">
                                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">手机号</span>
                                  <input
                                    type="tel"
                                    value={form.phone}
                                    onChange={(event) => updateMemberAccountForm(member, { phone: event.target.value })}
                                    className="h-10 w-full rounded-xl border border-border/70 bg-background/55 px-3 text-sm text-foreground outline-none transition focus:border-primary/35"
                                    placeholder="可为空"
                                  />
                                </label>
                              </div>

                              <div className="grid gap-3 md:grid-cols-3">
                                <label className="block">
                                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">部门</span>
                                  <input
                                    type="text"
                                    value={form.department}
                                    onChange={(event) => updateMemberAccountForm(member, { department: event.target.value })}
                                    className="h-10 w-full rounded-xl border border-border/70 bg-background/55 px-3 text-sm text-foreground outline-none transition focus:border-primary/35"
                                    placeholder="可为空"
                                  />
                                </label>
                                <label className="block">
                                  <span className="mb-1.5 block text-xs font-medium text-muted-foreground">角色</span>
                                  <select
                                    value={form.membershipRole}
                                    onChange={(event) =>
                                      updateMemberAccountForm(member, {
                                        membershipRole: event.target.value as "member" | "admin",
                                      })
                                    }
                                    className="h-10 w-full rounded-xl border border-border/70 bg-background/55 px-3 text-sm text-foreground outline-none transition focus:border-primary/35"
                                  >
                                    <option value="member">企业成员</option>
                                    <option value="admin">企业管理员</option>
                                  </select>
                                </label>
                                <label className="flex h-10 items-center gap-3 self-end rounded-xl border border-border/70 bg-background/35 px-3 text-sm text-foreground">
                                  <input
                                    type="checkbox"
                                    checked={form.canUseOrganizationWallet}
                                    onChange={(event) =>
                                      updateMemberAccountForm(member, {
                                        canUseOrganizationWallet: event.target.checked,
                                      })
                                    }
                                    className="h-4 w-4 rounded border-border"
                                  />
                                  企业钱包权限
                                </label>
                              </div>

                              <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
                                <input
                                  type="password"
                                  value={form.newPassword}
                                  onChange={(event) => updateMemberAccountForm(member, { newPassword: event.target.value })}
                                  className="h-10 rounded-xl border border-border/70 bg-background/55 px-3 text-sm text-foreground outline-none transition focus:border-primary/35"
                                  placeholder="新密码（不填则不修改）"
                                />
                                <input
                                  type="password"
                                  value={form.confirmPassword}
                                  onChange={(event) => updateMemberAccountForm(member, { confirmPassword: event.target.value })}
                                  className="h-10 rounded-xl border border-border/70 bg-background/55 px-3 text-sm text-foreground outline-none transition focus:border-primary/35"
                                  placeholder="确认新密码"
                                />
                                <button
                                  type="button"
                                  onClick={() => void handleSaveMemberAccount(member)}
                                  disabled={isSavingThisMember || isDeletingThisMember}
                                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:opacity-60"
                                >
                                  {isSavingThisMember ? (
                                    <LoaderCircle className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Save className="h-4 w-4" />
                                  )}
                                  保存
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handleDeleteMemberAccount(member)}
                                  disabled={!canDeleteThisMember || isSavingThisMember || isDeletingThisMember}
                                  className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 text-sm font-medium text-rose-200 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {isDeletingThisMember ? (
                                    <LoaderCircle className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                  删除
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="rounded-xl border border-dashed border-border/70 px-4 py-3 text-sm text-muted-foreground">
                              仅企业管理员可编辑员工账号
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/70 bg-background/20 p-5 text-sm text-muted-foreground">
                    {accountSearch.trim()
                      ? "没有找到匹配的员工账号。"
                      : "当前企业下还没有员工账号。"}
                  </div>
                )}
              </div>
            </div>
          ) : null}
          </div>
        </section>

        <section className="glass-panel rounded-[28px] p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">企业项目</p>
              <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">项目扣费归属</h2>
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
                        扣费方式：{billingPolicyLabel(project.billingPolicy)}
                      </p>
                    </div>
                    <span className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground">
                      直接扣除钱包
                    </span>
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

      {deleteMemberTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">确认删除员工账号</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  删除后会禁用该员工账号，并清空邮箱、手机号和登录密码。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteMemberTarget(null)}
                disabled={Boolean(deletingMemberId)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 rounded-xl border border-border/70 bg-background/55 px-3 py-3 text-sm text-foreground">
              <p>{deleteMemberTarget.displayName || deleteMemberTarget.email || "未命名员工"}</p>
              <p className="mt-1 text-xs text-muted-foreground">{deleteMemberTarget.userId}</p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteMemberTarget(null)}
                disabled={Boolean(deletingMemberId)}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-border/70 bg-background px-4 text-sm font-medium text-foreground transition hover:bg-accent disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void confirmDeleteMemberAccount()}
                disabled={Boolean(deletingMemberId)}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-rose-600 px-4 text-sm font-medium text-white transition hover:bg-rose-500 disabled:opacity-50"
              >
                {deletingMemberId ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                确认删除
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
