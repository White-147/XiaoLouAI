import { KeyRound, LoaderCircle, Save, Search, Trash2, UserRound } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { OrganizationMember } from "./api/enterprise-console";

export type MemberAccountForm = {
  displayName: string;
  email: string;
  phone: string;
  department: string;
  membershipRole: "member" | "admin";
  canUseOrganizationWallet: boolean;
  newPassword: string;
  confirmPassword: string;
};

type MemberAccountsPanelProps = {
  accountSearch: string;
  setAccountSearch: Dispatch<SetStateAction<string>>;
  searching: boolean;
  accountError: string | null;
  accountHint: string | null;
  accountMembers: OrganizationMember[];
  memberAccountForms: Record<string, MemberAccountForm>;
  canManageOrganization: boolean;
  actorId: string;
  savingMemberId: string | null;
  deletingMemberId: string | null;
  onSearch: () => void | Promise<void>;
  getMemberAccountForm: (member: OrganizationMember) => MemberAccountForm;
  updateMemberAccountForm: (member: OrganizationMember, patch: Partial<MemberAccountForm>) => void;
  onSaveMemberAccount: (member: OrganizationMember) => void | Promise<void>;
  onDeleteMemberAccount: (member: OrganizationMember) => void;
  roleLabel: (role: OrganizationMember["role"]) => string;
};

export function MemberAccountsPanel({
  accountSearch,
  setAccountSearch,
  searching,
  accountError,
  accountHint,
  accountMembers,
  memberAccountForms,
  canManageOrganization,
  actorId,
  savingMemberId,
  deletingMemberId,
  onSearch,
  getMemberAccountForm,
  updateMemberAccountForm,
  onSaveMemberAccount,
  onDeleteMemberAccount,
  roleLabel,
}: MemberAccountsPanelProps) {
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">账号管理</p>
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
                void onSearch();
              }
            }}
            className="h-10 w-full rounded-xl border border-border/70 bg-background/55 pl-9 pr-3 text-sm text-foreground outline-none transition focus:border-primary/35"
            placeholder="按用户名 / User ID / 手机号 / 邮箱查询"
          />
        </div>
        <button
          type="button"
          onClick={() => void onSearch()}
          disabled={searching}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border/70 bg-background/60 px-4 text-sm font-medium text-foreground transition hover:bg-secondary/70 disabled:opacity-60"
        >
          {searching ? (
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
            const form = memberAccountForms[member.userId] ?? getMemberAccountForm(member);
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

                  {canManageOrganization ? (
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
                          onClick={() => void onSaveMemberAccount(member)}
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
                          onClick={() => void onDeleteMemberAccount(member)}
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
  );
}
