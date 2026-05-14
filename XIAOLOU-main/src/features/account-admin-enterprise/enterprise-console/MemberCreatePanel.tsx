import { LoaderCircle, UserPlus } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { CreateOrganizationMemberInput } from "./api/enterprise-console";

type CreatedMemberHint = {
  title: string;
  detail: string;
  actorId: string;
  tempPassword: string | null;
};

type MemberCreatePanelProps = {
  canManageOrganization: boolean;
  memberForm: CreateOrganizationMemberInput;
  setMemberForm: Dispatch<SetStateAction<CreateOrganizationMemberInput>>;
  formError: string | null;
  createdHint: CreatedMemberHint | null;
  creatingMember: boolean;
  onCreateMember: () => void | Promise<void>;
};

export function MemberCreatePanel({
  canManageOrganization,
  memberForm,
  setMemberForm,
  formError,
  createdHint,
  creatingMember,
  onCreateMember,
}: MemberCreatePanelProps) {
  return (
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

      {canManageOrganization ? (
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
            onClick={() => void onCreateMember()}
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
  );
}
