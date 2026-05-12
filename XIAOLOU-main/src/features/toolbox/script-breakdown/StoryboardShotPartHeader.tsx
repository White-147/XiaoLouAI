import type { Storyboard } from "../../../lib/api";

type StoryboardShotPartHeaderProps = {
  item: Storyboard;
  previousItem?: Storyboard;
};

export function StoryboardShotPartHeader({
  item,
  previousItem,
}: StoryboardShotPartHeaderProps) {
  const isNewPart = item.partNo != null && item.partNo !== previousItem?.partNo;
  if (!isNewPart || !item.partTitle) return null;

  return (
    <div className="mb-3 mt-1 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-primary/20 px-2.5 py-0.5 text-[10px] font-bold text-primary">
          第 {item.partNo} 部分
        </span>
        {item.weather && (
          <span className="text-[10px] text-muted-foreground">{item.weather}</span>
        )}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/80">
        {item.partTitle}
      </p>
      {item.blocking && (
        <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/70">
          {item.blocking}
        </p>
      )}
      {item.camera && (
        <p className="mt-0.5 text-[10px] text-indigo-300/70">{item.camera}</p>
      )}
    </div>
  );
}
