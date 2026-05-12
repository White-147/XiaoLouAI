import { ZoomIn } from "lucide-react";
import {
  GeneratedMediaPlaceholder,
  getGeneratedMediaUrl,
} from "../../assets-media-projects/media/GenerationPlaceholder";
import type { Storyboard } from "../../../lib/api";

type StoryboardShotMediaPreviewProps = {
  item: Storyboard;
  lightboxLabel: string;
  onOpenLightbox: (url: string, label: string) => void;
};

export function StoryboardShotMediaPreview({
  item,
  lightboxLabel,
  onOpenLightbox,
}: StoryboardShotMediaPreviewProps) {
  const cover = getGeneratedMediaUrl(item.imageUrl);

  return (
    <div
      className="group/img relative aspect-video w-52 shrink-0 overflow-hidden rounded-lg bg-muted"
      onDoubleClick={() => cover && onOpenLightbox(cover, lightboxLabel)}
    >
      {cover ? (
        <img
          src={cover}
          alt={item.title}
          className="h-full w-full object-cover transition-transform duration-300 group-hover/img:scale-[1.03]"
          referrerPolicy="no-referrer"
        />
      ) : (
        <GeneratedMediaPlaceholder
          kind="image"
          className="h-full w-full"
          description="生成后展示"
        />
      )}
      <div className="absolute left-2 top-2 rounded bg-background/80 px-1.5 py-0.5 font-mono text-[10px] backdrop-blur">
        {lightboxLabel}
      </div>
      {cover && (
        <button
          type="button"
          onClick={() => onOpenLightbox(cover, lightboxLabel)}
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md bg-background/70 text-foreground opacity-0 backdrop-blur transition-opacity hover:bg-background/90 group-hover/img:opacity-100"
          title="放大查看（双击也可放大）"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
      )}
      {item.durationSeconds ? (
        <div className="absolute bottom-2 right-2 rounded bg-background/80 px-1.5 py-0.5 text-[10px] backdrop-blur">
          {item.durationSeconds}s
        </div>
      ) : null}
    </div>
  );
}
