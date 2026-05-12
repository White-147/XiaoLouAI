import {
  Image as ImageIcon,
  LoaderCircle,
  Trash2,
} from "lucide-react";
import type { Storyboard } from "../../../lib/api";

type StoryboardShotActionColumnProps = {
  item: Storyboard;
  isImgPending: boolean;
  isDelPending: boolean;
  onGenerateImage: (item: Storyboard) => void | Promise<void>;
  onDeleteShot: (item: Storyboard) => void | Promise<void>;
};

export function StoryboardShotActionColumn({
  item,
  isImgPending,
  isDelPending,
  onGenerateImage,
  onDeleteShot,
}: StoryboardShotActionColumnProps) {
  return (
    <div className="flex w-20 shrink-0 flex-col gap-2 border-l border-border pl-3">
      <button
        type="button"
        onClick={() => void onGenerateImage(item)}
        disabled={isImgPending || isDelPending}
        className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-2 text-[11px] font-medium text-primary-foreground shadow-sm shadow-primary/20 transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
      >
        {isImgPending ? (
          <LoaderCircle className="h-3 w-3 animate-spin" />
        ) : (
          <ImageIcon className="h-3 w-3" />
        )}
        {isImgPending ? "生成中" : "生成图"}
      </button>

      {item.imageStatus && item.imageStatus !== "pending" && (
        <div className="rounded-md bg-secondary px-1.5 py-1 text-center text-[10px] text-muted-foreground">
          {item.imageStatus}
        </div>
      )}

      <button
        type="button"
        onClick={() => void onDeleteShot(item)}
        disabled={isImgPending || isDelPending}
        className="mt-auto flex h-8 w-full items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
        title="删除此分镜"
      >
        {isDelPending ? (
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
      </button>
    </div>
  );
}
