import { LoaderCircle } from "lucide-react";

type BreakdownProgressBannerProps = {
  elapsed: string;
  progress: number;
};

export function BreakdownProgressBanner({ elapsed, progress }: BreakdownProgressBannerProps) {
  return (
    <div className="relative shrink-0 overflow-hidden border-b border-amber-600/40 bg-amber-500/15 px-6 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
      <div
        className="absolute bottom-0 left-0 h-0.5 bg-amber-600 transition-all duration-1000 dark:bg-amber-400/60"
        style={{ width: `${progress}%` }}
      />
      <div className="flex items-center gap-3">
        <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-amber-700 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            AI 正在拆解分镜，请勿关闭或刷新页面
          </p>
          <p className="mt-0.5 text-[11px] text-amber-900/75 dark:text-amber-300/70">
            电影级文字分镜需要大模型深度推理，通常需要
            <span className="font-medium text-amber-800 dark:text-amber-300">2–5 分钟</span>
            ，最长等待约
            <span className="font-medium text-amber-800 dark:text-amber-300">5 分 30 秒</span>
            。关闭页面将导致本次拆解结果丢失。
          </p>
        </div>
        <div className="shrink-0 rounded-lg border border-amber-600/40 bg-amber-500/20 px-3 py-1.5 text-center dark:border-amber-500/30 dark:bg-amber-500/10">
          <p className="font-mono text-base font-bold tabular-nums text-amber-800 dark:text-amber-300">
            {elapsed}
          </p>
          <p className="text-[10px] text-amber-700/80 dark:text-amber-400/60">已等待</p>
        </div>
      </div>
    </div>
  );
}
