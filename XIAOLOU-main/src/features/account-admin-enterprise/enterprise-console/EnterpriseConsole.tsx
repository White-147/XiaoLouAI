import {
  ArrowRight,
  LoaderCircle,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  createOrganizationMember,
  deleteOrganizationMemberAccount,
  getMe,
  getOrganizationWallet,
  listWalletLedger,
  listOrganizationMembers,
  listProjects,
  type CreateOrganizationMemberInput,
  type OrganizationMember,
  type PermissionContext,
  type Project,
  type UpdateOrganizationMemberAccountInput,
  type Wallet as WalletInfo,
  type WalletLedgerEntry,
  updateOrganizationMemberAccount,
} from "./api/enterprise-console";
import { EnterpriseBillingPanel } from "./EnterpriseBillingPanel";
import { EnterpriseSummary } from "./EnterpriseSummary";
import { MemberAccountsPanel, type MemberAccountForm } from "./MemberAccountsPanel";
import { MemberCreatePanel } from "./MemberCreatePanel";
import { MemberMonitorPanel } from "./MemberMonitorPanel";
import { rememberKnownActor, setCurrentActorId, useActorId } from "../../../lib/actor-session";

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

function ledgerEntryLabel(entry: WalletLedgerEntry) {
  const labelMap: Record<string, string> = {
    recharge: "充值入账",
    grant: "额度发放",
    freeze: "任务冻结",
    settle: "任务结算",
    refund: "积分退回",
  };
  return labelMap[entry.entryType] || entry.entryType.replace(/_/g, " ");
}

function ledgerReference(entry: WalletLedgerEntry) {
  if (entry.orderId) return `订单 ${entry.orderId}`;
  if (entry.projectId) return `项目 ${entry.projectId}`;
  if (entry.sourceId) return `${entry.sourceType || "来源"} ${entry.sourceId}`;
  return entry.sourceType || "--";
}

function formatSignedCredits(value: number) {
  return `${value > 0 ? "+" : ""}${formatCredits(value)}`;
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

type MemberModule = "create" | "monitor" | "billing" | "accounts";
type MemberSearchTarget = "monitor" | "accounts";

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
  const [walletLedgerEntries, setWalletLedgerEntries] = useState<WalletLedgerEntry[]>([]);
  const [walletLedgerLoading, setWalletLedgerLoading] = useState(false);
  const [walletLedgerError, setWalletLedgerError] = useState<string | null>(null);
  const [walletLedgerRefreshKey, setWalletLedgerRefreshKey] = useState(0);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [memberModule, setMemberModule] = useState<MemberModule>("create");
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

  useEffect(() => {
    let active = true;
    const walletId = wallet?.id;

    if (!walletId) {
      setWalletLedgerEntries([]);
      setWalletLedgerError(null);
      setWalletLedgerLoading(false);
      return () => {
        active = false;
      };
    }

    setWalletLedgerLoading(true);
    setWalletLedgerError(null);
    void listWalletLedger(walletId)
      .then((response) => {
        if (active) setWalletLedgerEntries(response.items);
      })
      .catch((error) => {
        if (active) {
          setWalletLedgerEntries([]);
          setWalletLedgerError(error instanceof Error ? error.message : "企业账单加载失败，请稍后重试。");
        }
      })
      .finally(() => {
        if (active) setWalletLedgerLoading(false);
      });

    return () => {
      active = false;
    };
  }, [wallet?.id, walletLedgerRefreshKey]);

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
  const walletLedgerSummary = useMemo(() => {
    return walletLedgerEntries.reduce(
      (summary, entry) => {
        if (entry.amount > 0) summary.income += entry.amount;
        if (entry.amount < 0) summary.expense += Math.abs(entry.amount);
        return summary;
      },
      { income: 0, expense: 0 },
    );
  }, [walletLedgerEntries]);
  const recentWalletLedgerEntries = walletLedgerEntries.slice(0, 12);

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
        <EnterpriseSummary
          organization={currentOrganization}
          context={me}
          wallet={wallet}
          membersCount={members.length}
          usageSummary={usageSummary}
          roleLabel={roleLabel}
          formatCredits={formatCredits}
          onOpenRecharge={() => navigate("/wallet/recharge")}
          onOpenBilling={() => {
            setMemberModule("billing");
            window.requestAnimationFrame(() => {
              document.getElementById("enterprise-management-modules")?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
            });
          }}
        />

        <section id="enterprise-management-modules" className="glass-panel rounded-[28px] p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-h-10 flex-wrap items-center rounded-xl border border-border/70 bg-background/35 p-1">
              {[
                ["create", "成员创建"],
                ["monitor", "成员监管"],
                ["billing", "账单与流水"],
                ["accounts", "账号管理"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setMemberModule(value as MemberModule);
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
            <MemberCreatePanel
              canManageOrganization={me.permissions.canManageOrganization}
              memberForm={memberForm}
              setMemberForm={setMemberForm}
              formError={formError}
              createdHint={createdHint}
              creatingMember={creatingMember}
              onCreateMember={handleCreateMember}
            />
          ) : null}

          {memberModule === "monitor" ? (
            <MemberMonitorPanel
              projectsCount={projects.length}
              monitorSearch={monitorSearch}
              setMonitorSearch={setMonitorSearch}
              searching={searchingMembersFor === "monitor"}
              members={monitorMembers}
              canManageOrganization={me.permissions.canManageOrganization}
              actorId={actorId}
              onSearch={() => handleSearchMembers("monitor")}
              onPreviewMember={(member) => {
                rememberKnownActor({
                  id: member.userId,
                  label: member.displayName,
                  detail: member.role === "enterprise_admin" ? "企业管理员" : "企业成员",
                });
                setCurrentActorId(member.userId);
                navigate("/home");
              }}
              formatCredits={formatCredits}
              formatShortDate={formatShortDate}
              roleLabel={roleLabel}
            />
          ) : null}

          {memberModule === "billing" ? (
            <EnterpriseBillingPanel
              wallet={wallet}
              walletLedgerEntries={walletLedgerEntries}
              recentWalletLedgerEntries={recentWalletLedgerEntries}
              walletLedgerSummary={walletLedgerSummary}
              walletLedgerLoading={walletLedgerLoading}
              walletLedgerError={walletLedgerError}
              onRefreshLedger={() => setWalletLedgerRefreshKey((value) => value + 1)}
              onOpenRecharge={() => navigate("/wallet/recharge")}
              formatCredits={formatCredits}
              formatShortDate={formatShortDate}
              formatSignedCredits={formatSignedCredits}
              ledgerEntryLabel={ledgerEntryLabel}
              ledgerReference={ledgerReference}
            />
          ) : null}

          {memberModule === "accounts" ? (
            <MemberAccountsPanel
              accountSearch={accountSearch}
              setAccountSearch={setAccountSearch}
              searching={searchingMembersFor === "accounts"}
              accountError={accountError}
              accountHint={accountHint}
              accountMembers={accountMembers}
              memberAccountForms={memberAccountForms}
              canManageOrganization={me.permissions.canManageOrganization}
              actorId={actorId}
              savingMemberId={savingMemberId}
              deletingMemberId={deletingMemberId}
              onSearch={() => handleSearchMembers("accounts")}
              getMemberAccountForm={memberAccountFormFrom}
              updateMemberAccountForm={updateMemberAccountForm}
              onSaveMemberAccount={handleSaveMemberAccount}
              onDeleteMemberAccount={handleDeleteMemberAccount}
              roleLabel={roleLabel}
            />
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
