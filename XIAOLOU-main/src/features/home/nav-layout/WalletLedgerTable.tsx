import { LoaderCircle } from "lucide-react";
import type { Wallet, WalletLedgerEntry } from "../../../lib/api";
import { cn } from "../../../lib/utils";

const ledgerActionLabels: Record<string, string> = {
  script_rewrite: "剧本改写",
  asset_extract: "资产提取",
  asset_image_generate: "资产出图",
  storyboard_auto_generate: "自动拆分分镜",
  storyboard_image_generate: "分镜出图",
  video_generate: "视频生成",
  dubbing_generate: "配音生成",
  lipsync_generate: "对口型",
  project_export: "成片导出",
  character_replace: "人物替换",
  motion_transfer: "动作迁移",
  upscale_restore: "超清修复",
  storyboard_grid25_generate: "25 格分镜",
  toolbox_image_generate: "工具箱出图",
  create_image_generate: "独立出图",
  create_video_generate: "独立视频生成",
};

type WalletLedgerTableProps = {
  entries: WalletLedgerEntry[];
  emptyText: string;
  walletLoading: boolean;
  ledgerLoading: boolean;
  walletError: string | null;
  activeWallet: Wallet | null;
};

export function formatCredits(value: number | undefined, unlimited?: boolean) {
  if (unlimited) return "无限";
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 2,
  }).format(value ?? 0);
}

export function getWalletBalance(wallet: Wallet | null | undefined) {
  if (!wallet) return 0;
  return wallet.availableCredits ?? wallet.creditsAvailable ?? 0;
}

export function getWalletFrozen(wallet: Wallet | null | undefined) {
  if (!wallet) return 0;
  return wallet.frozenCredits ?? wallet.creditsFrozen ?? 0;
}

export function getWalletName(wallet: Wallet | null | undefined) {
  if (!wallet) return "当前钱包";
  if (wallet.displayName) return wallet.displayName;
  if (wallet.ownerType === "organization" || wallet.walletOwnerType === "organization") return "企业钱包";
  if (wallet.ownerType === "platform" || wallet.walletOwnerType === "platform") return "平台钱包";
  return "个人钱包";
}

export function isConsumptionEntry(entry: WalletLedgerEntry) {
  const entryType = String(entry.entryType || "").toLowerCase();
  if (entryType === "freeze") return false;
  if (entryType === "settle") return true;
  return entry.amount < 0;
}

export function isSameLocalDay(value: string, now = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function formatLedgerDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(date)
    .replace(/\//g, "-");
}

function getMetadataText(entry: WalletLedgerEntry, keys: string[]) {
  for (const key of keys) {
    const value = entry.metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function getLedgerTitle(entry: WalletLedgerEntry) {
  const actionCode = getMetadataText(entry, ["actionCode", "sourceTaskType"]);
  if (actionCode) return ledgerActionLabels[actionCode] ?? actionCode.replace(/_/g, " ");

  return (
    getMetadataText(entry, ["label", "title", "actionLabel", "actionName", "description", "taskType"]) ||
    entry.sourceType ||
    entry.entryType ||
    "积分变动"
  );
}

function getLedgerStatus(entry: WalletLedgerEntry) {
  const entryType = String(entry.entryType || "").toLowerCase();
  if (entryType === "freeze") return "冻结中";
  if (entryType === "settle") return "已消耗";
  if (entryType === "refund") return "已退回";
  if (entryType === "recharge" || entryType === "grant") return "已入账";
  if (entry.amount < 0) return "已消耗";
  if (entry.amount > 0) return "已入账";
  return "已记录";
}

function renderLedgerRows({
  entries,
  emptyText,
  walletLoading,
  ledgerLoading,
  walletError,
  activeWallet,
}: WalletLedgerTableProps) {
  if (walletLoading || ledgerLoading) {
    return (
      <tr>
        <td colSpan={4} className="h-32 text-center">
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="h-4 w-4 animate-spin" />
            正在加载积分记录
          </span>
        </td>
      </tr>
    );
  }

  if (walletError) {
    return (
      <tr>
        <td colSpan={4} className="h-32 text-center text-sm text-destructive">
          {walletError}
        </td>
      </tr>
    );
  }

  if (!activeWallet) {
    return (
      <tr>
        <td colSpan={4} className="h-32 text-center text-sm text-muted-foreground">
          暂无可用钱包
        </td>
      </tr>
    );
  }

  if (!entries.length) {
    return (
      <tr>
        <td colSpan={4} className="h-32 text-center text-sm text-muted-foreground">
          {emptyText}
        </td>
      </tr>
    );
  }

  return entries.map((entry) => (
    <tr key={entry.id} className="border-t border-border">
      <td className="max-w-[250px] truncate px-3 py-4 text-sm text-foreground" title={getLedgerTitle(entry)}>
        {getLedgerTitle(entry)}
      </td>
      <td className="px-3 py-4 text-sm text-muted-foreground">{getLedgerStatus(entry)}</td>
      <td className="whitespace-nowrap px-3 py-4 text-sm text-muted-foreground">
        {formatLedgerDate(entry.createdAt)}
      </td>
      <td
        className={cn(
          "whitespace-nowrap px-3 py-4 text-sm font-medium tabular-nums",
          entry.amount < 0 ? "text-foreground" : "text-emerald-600 dark:text-emerald-300",
        )}
      >
        {entry.amount > 0 ? "+" : ""}
        {formatCredits(entry.amount)}
      </td>
    </tr>
  ));
}

export function WalletLedgerTable(props: WalletLedgerTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-border">
        <thead className="bg-muted text-left text-xs font-medium text-muted-foreground">
          <tr>
            <th className="px-3 py-3">项目</th>
            <th className="px-3 py-3">状态</th>
            <th className="px-3 py-3">时间</th>
            <th className="px-3 py-3">积分</th>
          </tr>
        </thead>
        <tbody className="bg-card">{renderLedgerRows(props)}</tbody>
      </table>
    </div>
  );
}
