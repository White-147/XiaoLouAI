import { LoaderCircle, Search, UserRound } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { OrganizationMember } from "./api/enterprise-console";

type MemberMonitorPanelProps = {
  projectsCount: number;
  monitorSearch: string;
  setMonitorSearch: Dispatch<SetStateAction<string>>;
  searching: boolean;
  members: OrganizationMember[];
  canManageOrganization: boolean;
  actorId: string;
  onSearch: () => void | Promise<void>;
  onPreviewMember: (member: OrganizationMember) => void;
  formatCredits: (value: number | null | undefined) => string;
  formatShortDate: (value: string | null | undefined) => string;
  roleLabel: (role: OrganizationMember["role"]) => string;
};

export function MemberMonitorPanel({
  projectsCount,
  monitorSearch,
  setMonitorSearch,
  searching,
  members,
  canManageOrganization,
  actorId,
  onSearch,
  onPreviewMember,
  formatCredits,
  formatShortDate,
  roleLabel,
}: MemberMonitorPanelProps) {
  return (
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
          <p className="mt-2 text-sm font-medium text-foreground">{projectsCount} 个</p>
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

      <div className="mt-6 space-y-3">
        {members.length ? (
          members.map((member) => {
            const usage = member.usageSummary;
            const usageSeries = (usage?.series ?? []).slice(-14);
            const maxSeriesCredits = Math.max(
              1,
              ...usageSeries.map((point) => point.consumedCredits + point.refundedCredits),
            );
            const canPreviewSwitch = canManageOrganization && member.userId !== actorId;

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
                        onClick={() => onPreviewMember(member)}
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
  );
}
