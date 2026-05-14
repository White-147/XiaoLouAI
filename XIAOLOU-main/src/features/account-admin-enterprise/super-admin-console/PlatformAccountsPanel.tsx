import { KeyRound, LoaderCircle, Search, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { PlatformAccount, PlatformRole } from "./api/super-admin-console";
import { cn } from "../../../lib/utils";

export type PlatformAccountForm = {
  displayName: string;
  email: string;
  phone: string;
  platformRole: PlatformRole;
  newPassword: string;
  confirmPassword: string;
};

type PlatformAccountsPanelProps = {
  accounts: PlatformAccount[];
  accountSearch: string;
  setAccountSearch: Dispatch<SetStateAction<string>>;
  loadingAccounts: boolean;
  accountForms: Record<string, PlatformAccountForm>;
  currentActorId: string | undefined;
  savingAccountId: string | null;
  deletingAccountId: string | null;
  roleLabels: Record<PlatformRole, string>;
  setDeleteTarget: Dispatch<SetStateAction<PlatformAccount | null>>;
  onLoadAccounts: () => void | Promise<void>;
  getAccountForm: (account: PlatformAccount) => PlatformAccountForm;
  updateAccountForm: (account: PlatformAccount, patch: Partial<PlatformAccountForm>) => void;
  onSaveAccount: (account: PlatformAccount) => void | Promise<void>;
  formatTime: (value?: string | null) => string;
};

export function PlatformAccountsPanel({
  accounts,
  accountSearch,
  setAccountSearch,
  loadingAccounts,
  accountForms,
  currentActorId,
  savingAccountId,
  deletingAccountId,
  roleLabels,
  setDeleteTarget,
  onLoadAccounts,
  getAccountForm,
  updateAccountForm,
  onSaveAccount,
  formatTime,
}: PlatformAccountsPanelProps) {
  return (
    <section className="space-y-4">
      <div className="rounded-lg border border-border/70 bg-card p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">账号管理</h2>
            <p className="mt-1 text-sm text-muted-foreground">可按用户名、userId、手机号、邮箱查询。</p>
          </div>
          <div className="flex w-full gap-2 lg:w-[520px]">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={accountSearch}
                onChange={(event) => setAccountSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void onLoadAccounts();
                  }
                }}
                className="h-10 w-full rounded-lg border border-border/70 bg-background pl-9 pr-3 text-sm text-foreground outline-none transition focus:border-primary/35"
                placeholder="用户名 / userId / 手机号 / 邮箱"
              />
            </div>
            <button
              type="button"
              onClick={() => void onLoadAccounts()}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90"
            >
              {loadingAccounts ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "查询"}
            </button>
          </div>
        </div>
      </div>

      {accounts.length ? (
        accounts.map((account) => {
          const form = accountForms[account.userId] ?? getAccountForm(account);
          const disabled = Boolean(account.deleted) || account.status === "disabled" || account.accountStatus === "disabled";
          const isCurrentAdmin = account.userId === currentActorId;
          const isSaving = savingAccountId === account.userId;
          const isDeleting = deletingAccountId === account.userId;

          return (
            <article key={account.userId} className="rounded-lg border border-border/70 bg-card p-4">
              <div className="flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-foreground">
                        {disabled ? "已删除账号" : account.displayName || account.userId}
                      </h3>
                      <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
                        {account.userId}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2.5 py-1 text-xs",
                          disabled ? "bg-rose-500/12 text-rose-300" : "bg-emerald-500/12 text-emerald-300",
                        )}
                      >
                        {disabled ? "已删除" : "可用"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {disabled ? `删除时间：${formatTime(account.deletedAt)}` : roleLabels[account.platformRole]}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(account)}
                    disabled={disabled || isCurrentAdmin || isSaving || isDeleting}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 text-sm font-medium text-rose-200 transition hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isDeleting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    删除
                  </button>
                </div>

                <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-4">
                  <input
                    value={form.displayName}
                    onChange={(event) => updateAccountForm(account, { displayName: event.target.value })}
                    disabled={disabled}
                    className="h-10 rounded-lg border border-border/70 bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary/35 disabled:opacity-60"
                    placeholder="用户名"
                  />
                  <input
                    value={form.email}
                    onChange={(event) => updateAccountForm(account, { email: event.target.value })}
                    disabled={disabled}
                    className="h-10 rounded-lg border border-border/70 bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary/35 disabled:opacity-60"
                    placeholder="邮箱"
                  />
                  <input
                    value={form.phone}
                    onChange={(event) => updateAccountForm(account, { phone: event.target.value })}
                    disabled={disabled}
                    className="h-10 rounded-lg border border-border/70 bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary/35 disabled:opacity-60"
                    placeholder="手机号"
                  />
                  <select
                    value={form.platformRole}
                    onChange={(event) => updateAccountForm(account, { platformRole: event.target.value as PlatformRole })}
                    disabled={disabled}
                    className="h-10 rounded-lg border border-border/70 bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary/35 disabled:opacity-60"
                  >
                    {(["customer", "ops_admin", "super_admin"] as PlatformRole[]).map((role) => (
                      <option key={role} value={role}>
                        {roleLabels[role]}
                      </option>
                    ))}
                  </select>
                  <div className="relative xl:col-span-2">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="password"
                      value={form.newPassword}
                      onChange={(event) => updateAccountForm(account, { newPassword: event.target.value })}
                      disabled={disabled}
                      className="h-10 w-full rounded-lg border border-border/70 bg-background pl-9 pr-3 text-sm text-foreground outline-none transition focus:border-primary/35 disabled:opacity-60"
                      placeholder="新密码（不填则不修改）"
                    />
                  </div>
                  <input
                    type="password"
                    value={form.confirmPassword}
                    onChange={(event) => updateAccountForm(account, { confirmPassword: event.target.value })}
                    disabled={disabled}
                    className="h-10 rounded-lg border border-border/70 bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary/35 disabled:opacity-60"
                    placeholder="确认新密码"
                  />
                  <button
                    type="button"
                    onClick={() => void onSaveAccount(account)}
                    disabled={disabled || isSaving || isDeleting}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
                    保存
                  </button>
                </div>
              </div>
            </article>
          );
        })
      ) : (
        <div className="rounded-lg border border-dashed border-border/70 bg-card p-8 text-center text-sm text-muted-foreground">
          {loadingAccounts ? "正在加载账号..." : "暂无匹配账号。"}
        </div>
      )}
    </section>
  );
}
