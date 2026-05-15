import { Download, X } from "lucide-react";
import {
  GeneratedMediaPlaceholder,
  getGeneratedMediaUrl,
} from "../../assets-media-projects/media/GenerationPlaceholder";
import type { CreateImageResult } from "./api/create-image";
import { resultImage } from "./imageCreateHelpers";

type ReferencePreview = {
  url: string;
  title: string;
};

type ImageCreatePreviewModalProps = {
  previewItem: CreateImageResult | null;
  previewReferences: string[];
  referencePreview: ReferencePreview | null;
  onClosePreview: () => void;
  onCloseReferencePreview: () => void;
  onDownloadPreview: (item: CreateImageResult) => void;
};

export function ImageCreatePreviewModal({
  previewItem,
  previewReferences,
  referencePreview,
  onClosePreview,
  onCloseReferencePreview,
  onDownloadPreview,
}: ImageCreatePreviewModalProps) {
  return (
    <>
      {previewItem ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold">结果预览</h3>
                <p className="text-xs text-muted-foreground">{previewItem.taskId || previewItem.id}</p>
              </div>
              <button
                onClick={onClosePreview}
                className="rounded-md p-2 transition-colors hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-6 overflow-y-auto p-5 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="overflow-hidden rounded-xl border border-border bg-black">
                {resultImage(previewItem) ? (
                  <img
                    src={resultImage(previewItem) || undefined}
                    alt={previewItem.prompt}
                    className="h-full w-full object-contain"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <GeneratedMediaPlaceholder
                    kind="image"
                    className="h-full min-h-[360px] w-full bg-black text-zinc-300"
                    description="当前结果还没有生成真实图片"
                  />
                )}
              </div>

              <div className="space-y-4">
                <div>
                  <div className="mb-1 text-xs text-muted-foreground">提示词</div>
                  <p className="text-sm leading-6">{previewItem.prompt}</p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">模型</div>
                    <div className="mt-1 font-medium">{previewItem.model}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">清晰度</div>
                    <div className="mt-1 font-medium">{previewItem.resolution}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">比例</div>
                    <div className="mt-1 font-medium">{previewItem.aspectRatio}</div>
                  </div>
                  <div className="rounded-lg border border-border p-3">
                    <div className="text-muted-foreground">风格</div>
                    <div className="mt-1 font-medium">{previewItem.style}</div>
                  </div>
                </div>
                {previewReferences.length ? (
                  <div className="space-y-2">
                    <div className="text-xs text-muted-foreground">{previewReferences.length} 张参考图</div>
                    {previewReferences.length > 1 ? (
                      <div className="grid grid-cols-2 gap-2">
                        {previewReferences.map((url, index) => (
                          <div
                            key={`${previewItem.id}_preview_ref_${index}`}
                            className="overflow-hidden rounded-lg border border-border bg-muted/20"
                          >
                            <img
                              src={url}
                              alt={`reference-${index + 1}`}
                              className="aspect-video w-full object-cover"
                              referrerPolicy="no-referrer"
                            />
                            <div className="flex items-center justify-between px-3 py-2 text-[11px] text-muted-foreground">
                              <span>参考图 {index + 1}</span>
                              {index === 0 ? <span className="text-primary">主参考</span> : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div className="text-xs text-muted-foreground">参考图</div>
                    {previewReferences[0] ? (
                      <img
                        src={previewReferences[0]}
                        alt="reference"
                        className="w-full rounded-lg border border-border object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : null}
                  </div>
                ) : null}
                {resultImage(previewItem) ? (
                  <button
                    type="button"
                    onClick={() => onDownloadPreview(previewItem)}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    <Download className="h-4 w-4" />
                    下载到本地
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {referencePreview ? (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
          <div className="flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-lg font-semibold">参考图预览</h3>
                <p className="text-xs text-muted-foreground">{referencePreview.title}</p>
              </div>
              <button
                onClick={onCloseReferencePreview}
                className="rounded-md p-2 transition-colors hover:bg-accent"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex min-h-[360px] items-center justify-center overflow-auto bg-black p-4">
              <img
                src={getGeneratedMediaUrl(referencePreview.url) || undefined}
                alt={referencePreview.title}
                className="max-h-[80vh] max-w-full object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
